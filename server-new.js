const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const net = require('net');
const open = require('open');
const os = require('os');
const iconv = require('iconv-lite');
const { OptimizedDatabaseCache } = require('./optimized-cache');
const { 
    config, 
    printConfiguration, 
    useOptimizedCache,
    getOptimizedCacheOptions 
} = require('./config');
const { createArchiveWithProgress } = require('./archive-with-progress');
const ArchiverManager = require('./archiver-manager');
const {
    dbQuery,
    dbGet,
    dbRun,
    batchLoadByIds,
    batchLoadByPaths,
    batchDeleteByIds,
    batchDeleteByPaths,
    batchInsertOrUpdate,
    getCount,
    checkExistenceByIds,
    checkExistenceByPaths,
    optimizeIndexes,
    analyzeDatabase,
    getDatabaseStats,
    queryWithRetry
} = require('./db-utils');

// Модули рефакторинга
const { LRUCache, DatabaseCache, invalidateDatabaseCaches, loadCacheWithFallback } = require('./server/cache-manager');
const { getFileStats, getFileAttributes, calculateCRC32, getAvailableDrives, getFileStatsOptimized } = require('./server/file-operations');
const { getAllItemsNonRecursive, getAllItemsRecursivelyOptimized, scanMultipleDirectoriesAsync, batchInsertToDatabase } = require('./server/scanning');
const { buildFileTree, buildFileTreeOptimized, batchLoadTreeNodes } = require('./server/tree-builder');

// Print configuration on startup
printConfiguration(config);

const app = express();
let PORT = config.port;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize SQLite database
const db = new sqlite3.Database('./filestash.db');

// Initialize Archiver Manager
const archiverManager = new ArchiverManager();

// Simple LRU Cache implementation for query results
class LRUCache {
    constructor(maxSize = 100 * 1024 * 1024) { // 100MB default
        this.cache = new Map();
        this.maxSize = maxSize;
        this.currentSize = 0;
    }
    
    get(key) {
        if (!this.cache.has(key)) {
            return null;
        }
        
        const item = this.cache.get(key);
        
        // Check if expired (5 minutes TTL)
        if (Date.now() - item.timestamp > 5 * 60 * 1000) {
            this.delete(key);
            return null;
        }
        
        // Move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, item);
        
        console.log(`✅ Cache HIT: ${key}`);
        return item.data;
    }
    
    set(key, data) {
        // Estimate size (rough approximation)
        const dataSize = JSON.stringify(data).length;
        
        // Remove old entry if exists
        if (this.cache.has(key)) {
            const oldItem = this.cache.get(key);
            this.currentSize -= oldItem.size;
            this.cache.delete(key);
        }
        
        // Evict oldest entries if needed
        while (this.currentSize + dataSize > this.maxSize && this.cache.size > 0) {
            const oldestKey = this.cache.keys().next().value;
            const oldestItem = this.cache.get(oldestKey);
            this.currentSize -= oldestItem.size;
            this.cache.delete(oldestKey);
            console.log(`🗑️ Cache EVICT: ${oldestKey}`);
        }
        
        // Add new entry
        this.cache.set(key, {
            data: data,
            timestamp: Date.now(),
            size: dataSize
        });
        this.currentSize += dataSize;
        
        console.log(`💾 Cache SET: ${key} (${Math.round(dataSize / 1024)}KB, total: ${Math.round(this.currentSize / 1024 / 1024)}MB)`);
    }
    
    delete(key) {
        if (this.cache.has(key)) {
            const item = this.cache.get(key);
            this.currentSize -= item.size;
            this.cache.delete(key);
            console.log(`🗑️ Cache DELETE: ${key}`);
        }
    }
    
    clear() {
        this.cache.clear();
        this.currentSize = 0;
        console.log('🗑️ Cache CLEARED');
    }
    
    invalidatePattern(pattern) {
        const regex = new RegExp(pattern);
        const keysToDelete = [];
        
        for (const key of this.cache.keys()) {
            if (regex.test(key)) {
                keysToDelete.push(key);
            }
        }
        
        keysToDelete.forEach(key => this.delete(key));
        console.log(`🗑️ Cache INVALIDATED: ${keysToDelete.length} entries matching "${pattern}"`);
    }
}

// Initialize query cache with configured size
const queryCache = config.enableQueryCache ? new LRUCache(config.queryCacheSize) : null;

// In-memory database cache
class DatabaseCache {
    constructor() {
        this.allFiles = null; // Массив всех файлов
        this.filesByPath = null; // Map для быстрого поиска по пути
        this.filesByDirectory = null; // Map для быстрого поиска по директории
        this.isLoaded = false;
        this.isLoading = false;
        this.loadPromise = null;
    }
    
    async loadFromDatabase() {
        if (this.isLoaded) {
            console.log('✅ Database cache already loaded');
            return;
        }
        
        if (this.isLoading) {
            console.log('⏳ Database cache is already loading, waiting...');
            return this.loadPromise;
        }
        
        this.isLoading = true;
        console.log('📥 Loading entire database into memory...');
        const startTime = Date.now();
        
        this.loadPromise = new Promise((resolve, reject) => {
            db.all('SELECT * FROM files WHERE (is_dummy IS NULL OR is_dummy = 0)', [], (err, rows) => {
                if (err) {
                    console.error('❌ Failed to load database into memory:', err);
                    this.isLoading = false;
                    reject(err);
                    return;
                }
                
                this.allFiles = rows;
                this.filesByPath = new Map();
                this.filesByDirectory = new Map();
                
                // Индексируем данные для быстрого доступа
                rows.forEach(row => {
                    this.filesByPath.set(row.full_path, row);
                    
                    const dir = row.directory || '';
                    if (!this.filesByDirectory.has(dir)) {
                        this.filesByDirectory.set(dir, []);
                    }
                    this.filesByDirectory.get(dir).push(row);
                });
                
                this.isLoaded = true;
                this.isLoading = false;
                
                const duration = Date.now() - startTime;
                const memoryUsage = JSON.stringify(rows).length;
                console.log(`✅ Database loaded into memory: ${rows.length} records in ${duration}ms (~${Math.round(memoryUsage / 1024 / 1024)}MB)`);
                
                resolve();
            });
        });
        
        return this.loadPromise;
    }
    
    invalidate() {
        console.log('🗑️ Invalidating database cache...');
        this.allFiles = null;
        this.filesByPath = null;
        this.filesByDirectory = null;
        this.isLoaded = false;
        this.isLoading = false;
        this.loadPromise = null;
        
        // Также очищаем query cache
        if (queryCache) {
            queryCache.clear();
        }
    }
    
    async reload() {
        this.invalidate();
        await this.loadFromDatabase();
    }
    
    getAll() {
        if (!this.isLoaded) {
            throw new Error('Database cache not loaded');
        }
        return this.allFiles;
    }
    
    getByPath(path) {
        if (!this.isLoaded) {
            throw new Error('Database cache not loaded');
        }
        return this.filesByPath.get(path);
    }
    
    getByDirectory(directory) {
        if (!this.isLoaded) {
            throw new Error('Database cache not loaded');
        }
        return this.filesByDirectory.get(directory || '') || [];
    }
    
    search(searchTerm) {
        if (!this.isLoaded) {
            throw new Error('Database cache not loaded');
        }
        
        const lowerSearch = searchTerm.toLowerCase().trim();
        
        // Split search into words for better matching
        const searchWords = lowerSearch.split(/\s+/).filter(w => w.length > 0);
        
        // Filter and score results
        const results = this.allFiles
            .map(file => {
                const lowerFilename = file.filename.toLowerCase();
                const lowerPath = file.full_path.toLowerCase();
                let score = 0;
                let matches = 0;
                
                // Check if ALL search words are present
                const allWordsMatch = searchWords.every(word => 
                    lowerFilename.includes(word) || lowerPath.includes(word)
                );
                
                if (!allWordsMatch) return null;
                
                // Score: exact filename match = highest
                if (lowerFilename === lowerSearch) {
                    score += 1000;
                }
                
                // Score: filename starts with search
                if (lowerFilename.startsWith(lowerSearch)) {
                    score += 500;
                }
                
                // Score: filename contains exact phrase
                if (lowerFilename.includes(lowerSearch)) {
                    score += 100;
                }
                
                // Score: path contains exact phrase
                if (lowerPath.includes(lowerSearch)) {
                    score += 50;
                }
                
                // Score: each word match in filename
                searchWords.forEach(word => {
                    if (lowerFilename.includes(word)) {
                        score += 10;
                        matches++;
                    }
                });
                
                // Score: prefer directories
                if (file.is_directory === 1) {
                    score += 5;
                }
                
                // Score: shorter paths are better
                const pathDepth = (file.full_path.match(/[\\\/]/g) || []).length;
                score -= pathDepth;
                
                return { file, score, matches };
            })
            .filter(result => result !== null)
            .sort((a, b) => b.score - a.score)
            .map(result => result.file);
        
        return results;
    }
}

// Initialize database cache
const dbCache = new DatabaseCache();

// Initialize optimized database cache using configuration
const optimizedCache = new OptimizedDatabaseCache('./filestash.db', getOptimizedCacheOptions(config));

// Helper function to check if optimized cache should be used
const USE_OPTIMIZED_CACHE = useOptimizedCache(config);

// Track which cache is currently active (for migration/rollback)
let activeCacheType = USE_OPTIMIZED_CACHE ? 'optimized' : 'legacy';
let activeCacheLoadFailed = false;

// Helper function to get active cache
function getActiveCache() {
    return activeCacheType === 'optimized' ? optimizedCache : dbCache;
}

// Helper function to switch cache strategy at runtime
async function switchCacheStrategy(strategy) {
    console.log(`🔄 Switching cache strategy to: ${strategy}`);
    
    const previousStrategy = activeCacheType;
    
    try {
        if (strategy === 'optimized') {
            // Switch to optimized cache
            if (!optimizedCache.isLoaded) {
                await optimizedCache.load();
            }
            activeCacheType = 'optimized';
            activeCacheLoadFailed = false;
            console.log('✅ Successfully switched to optimized cache');
        } else if (strategy === 'legacy' || strategy === 'full') {
            // Switch to legacy cache
            if (!dbCache.isLoaded) {
                await dbCache.loadFromDatabase();
            }
            activeCacheType = 'legacy';
            activeCacheLoadFailed = false;
            console.log('✅ Successfully switched to legacy cache');
        } else {
            throw new Error(`Unknown cache strategy: ${strategy}`);
        }
        
        return { success: true, previousStrategy, currentStrategy: activeCacheType };
        
    } catch (error) {
        console.error(`❌ Failed to switch to ${strategy} cache:`, error);
        
        // Rollback to previous strategy
        activeCacheType = previousStrategy;
        
        throw error;
    }
}

// Helper function to attempt cache load with automatic fallback
async function loadCacheWithFallback() {
    console.log(`🚀 Attempting to load ${activeCacheType} cache...`);
    
    try {
        if (activeCacheType === 'optimized') {
            await optimizedCache.load();
            console.log('✅ OptimizedDatabaseCache loaded successfully');
            activeCacheLoadFailed = false;
            return { success: true, cacheType: 'optimized' };
        } else {
            await dbCache.loadFromDatabase();
            console.log('✅ Legacy DatabaseCache loaded successfully');
            activeCacheLoadFailed = false;
            return { success: true, cacheType: 'legacy' };
        }
    } catch (error) {
        console.error(`❌ Failed to load ${activeCacheType} cache:`, error);
        activeCacheLoadFailed = true;
        
        // Attempt fallback to alternative cache
        const fallbackType = activeCacheType === 'optimized' ? 'legacy' : 'optimized';
        console.log(`⚠️  Attempting fallback to ${fallbackType} cache...`);
        
        try {
            if (fallbackType === 'legacy') {
                await dbCache.loadFromDatabase();
                activeCacheType = 'legacy';
                activeCacheLoadFailed = false;
                console.log('✅ Fallback to legacy cache successful');
                return { success: true, cacheType: 'legacy', fallback: true };
            } else {
                await optimizedCache.load();
                activeCacheType = 'optimized';
                activeCacheLoadFailed = false;
                console.log('✅ Fallback to optimized cache successful');
                return { success: true, cacheType: 'optimized', fallback: true };
            }
        } catch (fallbackError) {
            console.error(`❌ Fallback to ${fallbackType} cache also failed:`, fallbackError);
            activeCacheLoadFailed = true;
            return { 
                success: false, 
                error: error.message, 
                fallbackError: fallbackError.message 
            };
        }
    }
}

// Helper function to invalidate caches after database modifications
// Supports both full reload and selective invalidation
async function invalidateDatabaseCaches(options = {}) {
    const { paths = null, directories = null, fullReload = true } = options;
    
    // Always invalidate query cache patterns
    if (queryCache) {
        queryCache.invalidatePattern('^tree:');
    }
    
    if (USE_OPTIMIZED_CACHE) {
        // Use selective invalidation if paths or directories are provided
        if (!fullReload && (paths || directories)) {
            console.log('🔄 Selectively invalidating cache entries...');
            
            if (paths && Array.isArray(paths) && paths.length > 0) {
                optimizedCache.invalidatePaths(paths);
            }
            
            if (directories && Array.isArray(directories) && directories.length > 0) {
                optimizedCache.invalidateDirectories(directories);
            }
            
            console.log('✅ Selective cache invalidation completed');
        } else {
            // Full reload for major changes
            console.log('🔄 Reloading database cache after modification...');
            await optimizedCache.reload();
            console.log('✅ Database cache reloaded');
        }
    } else {
        // Legacy cache always does full reload
        console.log('🔄 Reloading database cache after modification...');
        await dbCache.reload();
        console.log('✅ Database cache reloaded');
    }
}

// Initialize database and start server
async function initializeAndStart() {
    return new Promise((resolve, reject) => {
        db.serialize(async () => {
            try {
                console.log('🔧 Initializing database...');
                
                // Optimize SQLite for performance
                db.run('PRAGMA journal_mode = WAL');
                db.run('PRAGMA synchronous = NORMAL');
                db.run('PRAGMA cache_size = 10000');
                db.run('PRAGMA temp_store = MEMORY');
                
                // Create tables
                await new Promise((res, rej) => {
                    db.run(`CREATE TABLE IF NOT EXISTS files (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        full_path TEXT UNIQUE,
                        directory TEXT,
                        filename TEXT,
                        extension TEXT,
                        size INTEGER,
                        created_time TEXT,
                        modified_time TEXT,
                        is_directory INTEGER,
                        attributes TEXT,
                        crc32 TEXT,
                        is_dummy INTEGER DEFAULT 0
                    )`, (err) => {
                        if (err) rej(err);
                        else res();
                    });
                });
                
                // Add is_dummy column if it doesn't exist (for existing databases)
                await new Promise((res) => {
                    db.run(`ALTER TABLE files ADD COLUMN is_dummy INTEGER DEFAULT 0`, (err) => {
                        if (err && !err.message.includes('duplicate column')) {
                            console.error('⚠️  Error adding is_dummy column:', err.message);
                        }
                        res(); // Continue even if column already exists
                    });
                });
                
                console.log('✅ Database tables initialized');
                
                // Use optimized index creation from db-utils
                try {
                    console.log('🔧 Optimizing database indexes...');
                    await optimizeIndexes(db);
                    
                    // Small delay to ensure indexes are fully created
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    // Analyze database for query optimization (with retry logic)
                    await analyzeDatabase(db);
                    console.log('✅ Database optimization complete');
                } catch (error) {
                    console.error('❌ Failed to optimize database:', error);
                }
                
                // Load database into memory cache after initialization with automatic fallback
                console.log(`🚀 Cache Strategy Selected: ${activeCacheType}`);
                console.log(`   Configuration: CACHE_STRATEGY=${config.cacheStrategy}`);
                
                const result = await loadCacheWithFallback(db, optimizedCache, dbCache, activeCacheType);
                
                if (result.success) {
                    if (result.fallback) {
                        console.log(`⚠️  Cache loaded with fallback to ${result.cacheType}`);
                        console.log(`   Original strategy (${USE_OPTIMIZED_CACHE ? 'optimized' : 'legacy'}) failed`);
                    } else {
                        console.log(`✅ Cache initialized successfully: ${result.cacheType}`);
                    }
                    
                    // Initialize and detect archivers
                    console.log('🔧 Detecting available archivers...');
                    try {
                        await archiverManager.detectArchivers();
                        await archiverManager.logDetectedArchivers();
                        
                        const supportedFormats = await archiverManager.getSupportedFormats();
                        if (supportedFormats.length === 0) {
                            console.log('⚠️  Warning: No archivers detected. Archive creation will not be available.');
                            console.log('   To enable archiving, install 7-Zip or WinRAR in the bin directory.');
                        }
                    } catch (error) {
                        console.error('❌ Error detecting archivers:', error.message);
                        console.log('⚠️  Archive creation may not work properly.');
                    }
                    
                    // Start server only after cache is fully loaded
                    console.log('🚀 All components initialized, starting server...');
                    await startServer();
                    resolve();
                    
                } else {
                    console.error('❌ All cache initialization attempts failed');
                    console.error(`   Primary error: ${result.error}`);
                    console.error(`   Fallback error: ${result.fallbackError}`);
                    console.error('⚠️  Cannot start server without cache');
                    reject(new Error('Cache initialization failed'));
                }
            } catch (err) {
                console.error('❌ Unexpected error during initialization:', err);
                reject(err);
            }
        });
    });
}

// Start initialization
initializeAndStart().catch(err => {
    console.error('❌ Failed to initialize application:', err);
    process.exit(1);
});

// Scan history management functions
const SCAN_HISTORY_FILE = './scan-history.json';

// Initialize scan history file if it doesn't exist
function initializeScanHistory() {
    if (!fs.existsSync(SCAN_HISTORY_FILE)) {
        const initialData = {
            scans: [],
            version: "1.0",
            created: new Date().toISOString()
        };
        fs.writeFileSync(SCAN_HISTORY_FILE, JSON.stringify(initialData, null, 2));
        console.log('📊 Scan history file initialized');
    }
}

// Read scan history from JSON file
function readScanHistory() {
    try {
        if (!fs.existsSync(SCAN_HISTORY_FILE)) {
            initializeScanHistory();
        }
        const data = fs.readFileSync(SCAN_HISTORY_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading scan history:', error);
        // Return default structure if file is corrupted
        return {
            scans: [],
            version: "1.0",
            created: new Date().toISOString()
        };
    }
}

// Write scan history to JSON file
function writeScanHistory(historyData) {
    try {
        fs.writeFileSync(SCAN_HISTORY_FILE, JSON.stringify(historyData, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing scan history:', error);
        return false;
    }
}

// Add new scan record to history
function addScanToHistory(scanRecord) {
    try {
        const history = readScanHistory();
        
        // Add the new scan record
        history.scans.unshift(scanRecord); // Add to beginning for newest first
        
        // Keep only last 100 scans to prevent file from growing too large
        if (history.scans.length > 100) {
            history.scans = history.scans.slice(0, 100);
        }
        
        // Write back to file
        const success = writeScanHistory(history);
        if (success) {
            console.log(`📊 Scan record added to history: ${scanRecord.id}`);
        }
        
        return success;
    } catch (error) {
        console.error('Error adding scan to history:', error);
        return false;
    }
}

// Initialize scan history
initializeScanHistory();

// Helper function to get file stats
function getFileStats(filePath) {
    try {
        const stats = fs.statSync(filePath);
        const parsed = path.parse(filePath);
        
        return {
            full_path: filePath,
            directory: parsed.dir,
            filename: parsed.base,
            extension: parsed.ext,
            size: stats.size,
            created_time: stats.birthtime.toISOString(),
            modified_time: stats.mtime.toISOString(),
            is_directory: stats.isDirectory() ? 1 : 0,
            attributes: getFileAttributes(stats),
            crc32: stats.isDirectory() ? null : calculateCRC32(filePath)
        };
    } catch (error) {
        console.error(`Error getting stats for ${filePath}:`, error.message);
        return null;
    }
}

// Helper function to get file attributes
function getFileAttributes(stats) {
    const attrs = [];
    if (stats.isDirectory()) attrs.push('DIR');
    if (stats.isFile()) attrs.push('FILE');
    // On Windows, you could add more attributes here
    return attrs.join(',');
}

// Helper function to calculate CRC32 (simplified)
function calculateCRC32(filePath) {
    try {
        const stats = fs.statSync(filePath);
        const fileSize = stats.size;
        
        // For small files (< 10MB), read entire file
        if (fileSize < 10 * 1024 * 1024) {
            const data = fs.readFileSync(filePath);
            return crypto.createHash('md5').update(data).digest('hex').substring(0, 8);
        }
        
        // For large files (10MB+), use partial hashing
        const chunkSize = 1 * 1024 * 1024; // 1MB
        const hash = crypto.createHash('md5');
        
        // Add file size to hash
        hash.update(Buffer.from(fileSize.toString()));
        
        const fd = fs.openSync(filePath, 'r');
        
        try {
            // Read first 1MB
            const startBuffer = Buffer.alloc(Math.min(chunkSize, fileSize));
            fs.readSync(fd, startBuffer, 0, startBuffer.length, 0);
            hash.update(startBuffer);
            
            // Read middle 1MB
            if (fileSize > chunkSize * 2) {
                const middlePos = Math.floor(fileSize / 2) - Math.floor(chunkSize / 2);
                const middleBuffer = Buffer.alloc(chunkSize);
                fs.readSync(fd, middleBuffer, 0, middleBuffer.length, middlePos);
                hash.update(middleBuffer);
            }
            
            // Read last 1MB
            if (fileSize > chunkSize) {
                const endPos = Math.max(0, fileSize - chunkSize);
                const endBuffer = Buffer.alloc(Math.min(chunkSize, fileSize - endPos));
                fs.readSync(fd, endBuffer, 0, endBuffer.length, endPos);
                hash.update(endBuffer);
            }
            
            fs.closeSync(fd);
            return hash.digest('hex').substring(0, 8);
            
        } catch (error) {
            fs.closeSync(fd);
            throw error;
        }
        
    } catch (error) {
        return null;
    }
}

// Build hierarchical tree structure from flat file list
// Optimized version that works with IndexCache for minimal memory usage
function buildFileTree(files) {
    const tree = {};
    const pathSeparator = process.platform === 'win32' ? '\\' : '/';
    
    // First, create a map of all existing paths in the database
    const existingPaths = new Set();
    files.forEach(file => {
        if (file.full_path) {
            existingPaths.add(file.full_path);
        }
    });
    
    files.forEach(file => {
        // Skip empty paths
        if (!file.full_path) return;
        
        // Normalize path separators
        const normalizedPath = file.full_path.replace(/[\/\\]/g, pathSeparator);
        const pathParts = normalizedPath.split(pathSeparator).filter(part => part.length > 0);
        
        if (pathParts.length === 0) return;
        
        let currentLevel = tree;
        let currentPath = '';
        
        // Build path step by step, but only create nodes that actually exist in DB
        pathParts.forEach((part, index) => {
            const previousPath = currentPath;
            currentPath += (currentPath ? pathSeparator : '') + part;
            
            // Only create intermediate directories if they exist in the database
            // or if this is the final part (the actual file/folder from DB)
            const isLastPart = index === pathParts.length - 1;
            const pathExistsInDB = existingPaths.has(currentPath);
            
            if (isLastPart || pathExistsInDB) {
                if (!currentLevel[part]) {
                    currentLevel[part] = {
                        name: part,
                        path: currentPath,
                        isDirectory: file.is_directory || !isLastPart,
                        children: {},
                        expanded: false,
                        inDatabase: pathExistsInDB
                    };
                }
                
                // If this is the actual file/folder from database, add its data
                if (isLastPart) {
                    // Check if file exists on disk
                    let existsOnDisk = false;
                    try {
                        existsOnDisk = fs.existsSync(file.full_path);
                    } catch (error) {
                        existsOnDisk = false;
                    }
                    
                    currentLevel[part].fileData = {
                        id: file.id,
                        filename: file.filename,
                        extension: file.extension,
                        size: file.size,
                        created_time: file.created_time,
                        modified_time: file.modified_time,
                        crc32: file.crc32
                    };
                    currentLevel[part].isDirectory = file.is_directory === 1;
                    currentLevel[part].inDatabase = true;
                    currentLevel[part].existsOnDisk = existsOnDisk;
                    
                    // Remove children for files
                    if (!file.is_directory) {
                        delete currentLevel[part].children;
                    }
                }
                
                // Move to next level only if it's a directory
                if (currentLevel[part].isDirectory) {
                    currentLevel = currentLevel[part].children;
                }
            } else {
                // For intermediate paths that don't exist in DB, we need to create them
                // but mark them as not in database
                if (!currentLevel[part]) {
                    currentLevel[part] = {
                        name: part,
                        path: currentPath,
                        isDirectory: true,
                        children: {},
                        expanded: false,
                        inDatabase: false
                    };
                }
                currentLevel = currentLevel[part].children;
            }
        });
    });
    
    return tree;
}

// Build tree structure using IndexCache (optimized for memory)
// Only loads minimal metadata, full details loaded on demand
async function buildFileTreeOptimized(directory = null) {
    if (!optimizedCache.isLoaded) {
        throw new Error('OptimizedCache not loaded');
    }
    
    // Get children IDs from IndexCache (fast, in-memory)
    const childrenIds = optimizedCache.getChildrenIds(directory || '');
    
    if (childrenIds.size === 0) {
        return [];
    }
    
    // Batch load full data for direct children only
    const children = await optimizedCache.getFullDataBatch(Array.from(childrenIds));
    
    // Build tree nodes with lazy loading support
    return children.map(file => {
        // Check if directory has children (using IndexCache, no DB query)
        const hasChildren = file.is_directory === 1 && 
            optimizedCache.getChildrenIds(file.full_path).size > 0;
        
        // Check if file exists on disk
        let existsOnDisk = false;
        try {
            existsOnDisk = fs.existsSync(file.full_path);
        } catch (error) {
            existsOnDisk = false;
        }
        
        return {
            id: file.id,
            path: file.full_path,
            name: file.filename,
            isDirectory: file.is_directory === 1,
            hasChildren: hasChildren,
            size: file.size,
            extension: file.extension,
            createdTime: file.created_time,
            modifiedTime: file.modified_time,
            crc32: file.crc32,
            existsOnDisk: existsOnDisk,
            inDatabase: true,
            // Lazy loading: children loaded on demand
            children: null
        };
    });
}

// Get children for a specific directory using optimized cache
// Returns only IDs for lazy loading
function getChildrenIdsOptimized(directory) {
    if (!optimizedCache.isLoaded) {
        return new Set();
    }
    
    return optimizedCache.getChildrenIds(directory || '');
}

// Batch load tree nodes with full details
// Efficiently loads multiple nodes at once using optimized cache
async function batchLoadTreeNodes(nodeIds) {
    if (!optimizedCache.isLoaded) {
        throw new Error('OptimizedCache not loaded');
    }
    
    // Batch load full data for all requested nodes
    const nodes = await optimizedCache.getFullDataBatch(nodeIds);
    
    // Transform to tree node format
    return nodes.map(file => {
        const hasChildren = file.is_directory === 1 && 
            optimizedCache.getChildrenIds(file.full_path).size > 0;
        
        let existsOnDisk = false;
        try {
            existsOnDisk = fs.existsSync(file.full_path);
        } catch (error) {
            existsOnDisk = false;
        }
        
        return {
            id: file.id,
            path: file.full_path,
            name: file.filename,
            isDirectory: file.is_directory === 1,
            hasChildren: hasChildren,
            size: file.size,
            extension: file.extension,
            createdTime: file.created_time,
            modifiedTime: file.modified_time,
            crc32: file.crc32,
            existsOnDisk: existsOnDisk,
            inDatabase: true
        };
    });
}

// Get available drives (Windows specific)
function getAvailableDrives() {
    const drives = [];
    if (process.platform === 'win32') {
        for (let i = 65; i <= 90; i++) { // A-Z
            const drive = String.fromCharCode(i) + ':\\';
            try {
                fs.accessSync(drive);
                drives.push(drive);
            } catch (e) {
                // Drive not available
            }
        }
    } else {
        drives.push('/'); // Unix-like systems
    }
    return drives;
}

// Helper function to collect all paths for rescan (including nested items)
async function collectRescanPaths(selectedPaths) {
    if (selectedPaths.length === 0) {
        return [];
    }
    
    const allPaths = new Set();
    
    // Use batch query optimization - collect all conditions
    const conditions = [];
    const params = [];
    
    selectedPaths.forEach(selectedPath => {
        conditions.push('(full_path = ? OR full_path LIKE ?)');
        params.push(selectedPath);
        params.push(selectedPath + path.sep + '%');
    });
    
    // Single query instead of multiple queries
    const query = `
        SELECT full_path 
        FROM files 
        WHERE ${conditions.join(' OR ')}
    `;
    
    try {
        const rows = await dbQuery(db, query, params);
        rows.forEach(row => allPaths.add(row.full_path));
        return Array.from(allPaths);
    } catch (error) {
        console.error('❌ Error collecting paths for rescan:', error);
        throw error;
    }
}

// Helper function to delete old records from database
async function deleteOldRecords(paths) {
    if (paths.length === 0) {
        return 0;
    }
    
    try {
        // Use batch delete utility
        const deletedCount = await batchDeleteByPaths(db, paths);
        console.log(`✅ Deleted ${deletedCount} records from database`);
        
        // Invalidate caches after deletion
        await invalidateDatabaseCaches(db, queryCache, optimizedCache, dbCache);
        
        return deletedCount;
    } catch (error) {
        console.error('❌ Error deleting old records:', error);
        throw error;
    }
}

// API Routes

// Get available drives
app.get('/api/drives', (req, res) => {
    const drives = getAvailableDrives();
    res.json({ drives });
});

// Browse directories
app.get('/api/browse', (req, res) => {
    const { path: dirPath } = req.query;
    
    if (!dirPath) {
        return res.status(400).json({ error: 'Path parameter is required' });
    }

    try {
        if (!fs.existsSync(dirPath)) {
            return res.status(404).json({ error: 'Path not found' });
        }

        const stats = fs.statSync(dirPath);
        if (!stats.isDirectory()) {
            return res.status(400).json({ error: 'Path is not a directory' });
        }

        const items = fs.readdirSync(dirPath);
        const directories = [];

        items.forEach(item => {
            const fullPath = path.join(dirPath, item);
            try {
                const itemStats = fs.statSync(fullPath);
                if (itemStats.isDirectory()) {
                    directories.push({
                        name: item,
                        path: fullPath,
                        selected: false
                    });
                }
            } catch (error) {
                // Skip items we can't access
            }
        });

        // Sort directories alphabetically
        directories.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

        res.json({
            path: dirPath,
            directories
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Global scan progress tracking
const scanProgress = new Map();

// Global archive progress tracking
const archiveProgress = new Map();

// Scan multiple selected directories
app.post('/api/scan-multiple', async (req, res) => {
    const { paths, threads, calculateCrc32 } = req.body;
    const batchSize = parseInt(threads) || 4;
    const shouldCalculateCrc32 = calculateCrc32 !== false; // Default to true
    
    if (!paths || !Array.isArray(paths) || paths.length === 0) {
        return res.status(400).json({ error: 'Paths array is required' });
    }

    // Normalize paths - support both string and object format
    const normalizedPaths = paths.map(p => {
        if (typeof p === 'string') {
            return { path: p, recursive: true }; // Old format - default to recursive
        }
        return p; // New format with recursive flag
    });

    // Validate all paths exist
    for (const scanItem of normalizedPaths) {
        if (!fs.existsSync(scanItem.path)) {
            return res.status(404).json({ error: `Path not found: ${scanItem.path}` });
        }
    }

    const scanId = Date.now().toString();
    const startTime = Date.now();
    
    scanProgress.set(scanId, {
        total: 0,
        processed: 0,
        errors: [],
        status: 'scanning',
        paths: normalizedPaths.map(p => p.path),
        startTime: startTime,
        endTime: null,
        duration: 0,
        calculateCrc32: shouldCalculateCrc32,
        cancelled: false,
        cancellationRequested: false
    });

    // Start scanning asynchronously
    scanMultipleDirectoriesAsync(normalizedPaths, scanId, batchSize, shouldCalculateCrc32);

    res.json({
        scanId: scanId,
        message: `Scan started for ${normalizedPaths.length} directories with ${batchSize} threads${shouldCalculateCrc32 ? ' (with CRC32)' : ' (without CRC32)'}`,
        paths: normalizedPaths.map(p => p.path)
    });
});

// Get scan progress
app.get('/api/scan/progress/:scanId', (req, res) => {
    const { scanId } = req.params;
    const progress = scanProgress.get(scanId);
    
    if (!progress) {
        return res.status(404).json({ error: 'Scan not found' });
    }
    
    res.json(progress);
});

// Get archive progress with Server-Sent Events
app.get('/api/archive/progress/:archiveId', (req, res) => {
    const { archiveId } = req.params;
    
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected', archiveId })}\n\n`);
    
    // Send progress updates every 500ms
    const intervalId = setInterval(() => {
        const progress = archiveProgress.get(archiveId);
        
        if (!progress) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: 'Archive not found' })}\n\n`);
            clearInterval(intervalId);
            res.end();
            return;
        }
        
        res.write(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`);
        
        // Close connection when complete or failed
        if (progress.status === 'completed' || progress.status === 'failed') {
            clearInterval(intervalId);
            setTimeout(() => {
                res.end();
            }, 1000);
        }
    }, 500);
    
    // Clean up on client disconnect
    req.on('close', () => {
        clearInterval(intervalId);
    });
});

// Stop scan operation
app.post('/api/scan/stop/:scanId', (req, res) => {
    const { scanId } = req.params;
    const progress = scanProgress.get(scanId);
    
    if (!progress) {
        return res.status(404).json({ error: 'Scan not found' });
    }
    
    if (progress.status !== 'scanning') {
        return res.status(400).json({ 
            error: 'Scan is not active', 
            currentStatus: progress.status 
        });
    }
    
    // Request cancellation
    progress.cancellationRequested = true;
    console.log(`🛑 Cancellation requested for scan ${scanId}`);
    
    res.json({ 
        message: 'Scan cancellation requested',
        scanId: scanId,
        status: 'cancellation_requested'
    });
});

// Rescan selected files/folders from database
app.post('/api/database/rescan', async (req, res) => {
    const { paths, threads, calculateCrc32 } = req.body;
    const batchSize = parseInt(threads) || 4;
    const shouldCalculateCrc32 = calculateCrc32 !== false;
    
    if (!paths || !Array.isArray(paths) || paths.length === 0) {
        return res.status(400).json({ error: 'Paths array is required' });
    }

    try {
        console.log(`🔄 Starting rescan for ${paths.length} path(s)...`);
        
        // Step 1: Collect all paths to rescan (including nested items)
        const pathsToRescan = await collectRescanPaths(paths);
        console.log(`📋 Found ${pathsToRescan.length} total records to rescan`);
        
        // Step 2: Delete old database records
        const deletedCount = await deleteOldRecords(pathsToRescan);
        console.log(`🗑️ Deleted ${deletedCount} old records from database`);
        
        // Step 3: Initiate new scan for these paths
        const scanId = Date.now().toString();
        const startTime = Date.now();
        
        scanProgress.set(scanId, {
            total: 0,
            processed: 0,
            errors: [],
            status: 'scanning',
            paths: paths,
            startTime: startTime,
            endTime: null,
            duration: 0,
            calculateCrc32: shouldCalculateCrc32,
            cancelled: false,
            cancellationRequested: false,
            isRescan: true
        });

        // Start scanning asynchronously
        scanMultipleDirectoriesAsync(paths, scanId, batchSize, shouldCalculateCrc32);

        res.json({
            success: true,
            scanId: scanId,
            pathsProcessed: pathsToRescan.length,
            deletedRecords: deletedCount,
            message: `Rescan started for ${paths.length} path(s). Deleted ${deletedCount} old records.`
        });
        
    } catch (error) {
        console.error('❌ Rescan error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Optimized async scanning function with true parallelism
async function scanMultipleDirectoriesAsync(rootPaths, scanId, threadCount, calculateCrc32 = true) {
    const progress = scanProgress.get(scanId);
    let scannedCount = 0;
    
    try {
        // Check for cancellation before starting
        if (progress.cancellationRequested) {
            progress.status = 'cancelled';
            progress.cancelled = true;
            progress.endTime = Date.now();
            progress.duration = progress.endTime - progress.startTime;
            console.log(`🛑 Scan ${scanId} cancelled before enumeration`);
            
            // Record early cancelled scan to history
            try {
                // Normalize paths to array of strings
                const pathsArray = Array.isArray(rootPaths) 
                    ? rootPaths.map(p => typeof p === 'string' ? p : p.path)
                    : [rootPaths];
                
                const scanRecord = {
                    id: scanId,
                    startTime: new Date(progress.startTime).toISOString(),
                    endTime: new Date(progress.endTime).toISOString(),
                    duration: progress.duration,
                    status: 'cancelled',
                    paths: pathsArray,
                    threadCount: threadCount,
                    filesProcessed: 0,
                    totalFound: 0,
                    calculateCrc32: calculateCrc32,
                    errors: progress.errors || [],
                    cancelled: true
                };
                
                addScanToHistory(scanRecord);
            } catch (historyError) {
                console.error('❌ Failed to record early cancelled scan history:', historyError);
            }
            
            return;
        }
        
        // Get all files and directories from all root paths using parallel processing
        console.log(`🔍 Starting directory enumeration with ${threadCount} threads...`);
        let allItems = [];
        
        // Process root paths in parallel
        const pathPromises = rootPaths.map(pathItem => {
            const scanPath = typeof pathItem === 'string' ? pathItem : pathItem.path;
            const isRecursive = typeof pathItem === 'string' ? true : pathItem.recursive;
            
            if (isRecursive) {
                return getAllItemsRecursivelyOptimized(scanPath, scanId);
            } else {
                // Non-recursive: scan only direct children
                return getAllItemsNonRecursive(scanPath, scanId);
            }
        });
        const pathResults = await Promise.all(pathPromises);
        
        // Check for cancellation after enumeration
        if (progress.cancellationRequested) {
            progress.status = 'cancelled';
            progress.cancelled = true;
            progress.endTime = Date.now();
            progress.duration = progress.endTime - progress.startTime;
            console.log(`🛑 Scan ${scanId} cancelled after enumeration`);
            
            // Record cancelled scan after enumeration to history
            try {
                // Normalize paths to array of strings
                const pathsArray = Array.isArray(rootPaths) 
                    ? rootPaths.map(p => typeof p === 'string' ? p : p.path)
                    : [rootPaths];
                
                const scanRecord = {
                    id: scanId,
                    startTime: new Date(progress.startTime).toISOString(),
                    endTime: new Date(progress.endTime).toISOString(),
                    duration: progress.duration,
                    status: 'cancelled',
                    paths: pathsArray,
                    threadCount: threadCount,
                    filesProcessed: 0,
                    totalFound: allItems.length,
                    calculateCrc32: calculateCrc32,
                    errors: progress.errors || [],
                    cancelled: true
                };
                
                addScanToHistory(scanRecord);
            } catch (historyError) {
                console.error('❌ Failed to record cancelled scan history:', historyError);
            }
            
            return;
        }
        
        // Flatten results
        for (const items of pathResults) {
            allItems = allItems.concat(items);
        }
        
        progress.total = allItems.length;
        console.log(`📊 Found ${allItems.length} items to process`);
        
        // Create worker pool for parallel processing
        const chunkSize = Math.ceil(allItems.length / threadCount);
        const chunks = [];
        
        for (let i = 0; i < allItems.length; i += chunkSize) {
            chunks.push(allItems.slice(i, i + chunkSize));
        }
        
        console.log(`⚡ Processing ${chunks.length} chunks in parallel...`);
        
        // Process chunks in parallel
        const chunkPromises = chunks.map(async (chunk, chunkIndex) => {
            const chunkResults = [];
            
            for (const itemPath of chunk) {
                // Check for cancellation in each chunk
                if (progress.cancellationRequested) {
                    console.log(`🛑 Chunk ${chunkIndex} stopping due to cancellation request`);
                    break;
                }
                
                try {
                    const fileStats = await getFileStatsOptimized(itemPath, calculateCrc32);
                    
                    if (fileStats) {
                        chunkResults.push(fileStats);
                        scannedCount++;
                        progress.processed = scannedCount;
                        
                        // Update progress every 100 items
                        if (scannedCount % 100 === 0) {
                            console.log(`📈 Processed ${scannedCount}/${allItems.length} items`);
                        }
                    }
                } catch (error) {
                    progress.errors.push(`Error processing ${itemPath}: ${error.message}`);
                }
            }
            
            return chunkResults;
        });
        
        // Wait for all chunks to complete
        const chunkResults = await Promise.all(chunkPromises);
        
        // Check for cancellation before database insertion
        if (progress.cancellationRequested) {
            progress.status = 'cancelled';
            progress.cancelled = true;
            progress.endTime = Date.now();
            progress.duration = progress.endTime - progress.startTime;
            
            // Still insert successfully scanned data
            const allFileStats = chunkResults.flat();
            if (allFileStats.length > 0) {
                console.log(`💾 Inserting ${allFileStats.length} successfully scanned records before cancellation...`);
                await batchInsertToDatabase(allFileStats);
            }
            
            console.log(`🛑 Scan ${scanId} cancelled. Processed ${scannedCount} items before cancellation.`);
            
            // Record cancelled scan to history
            try {
                // Normalize paths to array of strings
                const pathsArray = Array.isArray(rootPaths) 
                    ? rootPaths.map(p => typeof p === 'string' ? p : p.path)
                    : [rootPaths];
                
                const scanRecord = {
                    id: scanId,
                    startTime: new Date(progress.startTime).toISOString(),
                    endTime: new Date(progress.endTime).toISOString(),
                    duration: progress.duration,
                    status: 'cancelled',
                    paths: pathsArray,
                    threadCount: threadCount,
                    filesProcessed: scannedCount,
                    totalFound: progress.total || 0,
                    calculateCrc32: calculateCrc32,
                    errors: progress.errors || [],
                    cancelled: true
                };
                
                addScanToHistory(scanRecord);
            } catch (historyError) {
                console.error('❌ Failed to record cancelled scan history:', historyError);
            }
            
            return;
        }
        
        // Flatten results and batch insert to database
        const allFileStats = chunkResults.flat();
        console.log(`💾 Batch inserting ${allFileStats.length} records to database...`);
        
        await batchInsertToDatabase(allFileStats);
        
        progress.status = 'completed';
        progress.endTime = Date.now();
        progress.duration = progress.endTime - progress.startTime;
        
        if (progress.isRescan) {
            console.log(`✅ Rescan completed in ${Math.round(progress.duration / 1000)} seconds - ${allFileStats.length} records updated`);
        } else {
            console.log(`✅ Scan completed in ${Math.round(progress.duration / 1000)} seconds`);
        }
        
    } catch (error) {
        progress.status = 'error';
        progress.endTime = Date.now();
        progress.duration = progress.endTime - progress.startTime;
        progress.errors.push(`Scan error: ${error.message}`);
        console.error('❌ Scan error:', error);
    } finally {
        // Record scan to history regardless of completion status
        try {
            // Normalize paths to array of strings
            const pathsArray = Array.isArray(rootPaths) 
                ? rootPaths.map(p => typeof p === 'string' ? p : p.path)
                : [rootPaths];
            
            const scanRecord = {
                id: scanId,
                startTime: new Date(progress.startTime).toISOString(),
                endTime: progress.endTime ? new Date(progress.endTime).toISOString() : new Date().toISOString(),
                duration: progress.duration || 0,
                status: progress.status || 'error',
                paths: pathsArray,
                threadCount: threadCount,
                filesProcessed: progress.processed || 0,
                totalFound: progress.total || 0,
                calculateCrc32: calculateCrc32,
                errors: progress.errors || [],
                cancelled: progress.cancelled || false,
                isRescan: progress.isRescan || false
            };
            
            addScanToHistory(scanRecord);
        } catch (historyError) {
            console.error('❌ Failed to record scan history:', historyError);
        }
    }
}

// Non-recursive directory scan - only direct children
async function getAllItemsNonRecursive(rootPath, scanId) {
    const items = [];
    const fs_promises = require('fs').promises;
    const progress = scanProgress.get(scanId);

    // Check if root path exists
    try {
        await fs_promises.access(rootPath);
    } catch (error) {
        console.log(`⚠️ Path does not exist, skipping: ${rootPath}`);
        return items;
    }

    // Add the directory itself as an item to be processed
    items.push(rootPath);
    console.log(`📁 Added directory itself for non-recursive scan: ${rootPath}`);

    try {
        const dirItems = await fs_promises.readdir(rootPath);
        
        // Process only direct children (no recursion)
        const itemPromises = dirItems.map(async (item) => {
            const fullPath = path.join(rootPath, item);
            try {
                const stats = await fs_promises.stat(fullPath);
                return { fullPath, isDirectory: stats.isDirectory() };
            } catch (e) {
                return null;
            }
        });
        
        const itemResults = await Promise.all(itemPromises);
        
        for (const result of itemResults) {
            if (result && !result.isDirectory) {
                // Add only files from top level, not subdirectories
                items.push(result.fullPath);
            }
        }
        
        console.log(`📊 Non-recursive scan of ${rootPath}: found ${items.length} items (including directory itself)`);
    } catch (e) {
        console.error(`❌ Error scanning directory: ${rootPath}`, e.message);
    }

    return items;
}

// Optimized recursive directory enumeration using async operations
async function getAllItemsRecursivelyOptimized(rootPath, scanId) {
    const items = [];
    const directories = [rootPath];
    const fs_promises = require('fs').promises;
    const progress = scanProgress.get(scanId);

    // Check if root path exists (important for rescan operations)
    try {
        await fs_promises.access(rootPath);
    } catch (error) {
        console.log(`⚠️ Path does not exist, skipping: ${rootPath}`);
        return items; // Return empty array if path doesn't exist
    }

    while (directories.length > 0) {
        // Check for cancellation during enumeration
        if (progress && progress.cancellationRequested) {
            console.log(`🛑 Directory enumeration stopped due to cancellation request`);
            break;
        }
        
        const currentDir = directories.pop();
        // Add the directory itself to items
        items.push(currentDir);

        try {
            const dirItems = await fs_promises.readdir(currentDir);
            
            // Process directory items in parallel
            const itemPromises = dirItems.map(async (item) => {
                const fullPath = path.join(currentDir, item);
                try {
                    const stats = await fs_promises.stat(fullPath);
                    return { fullPath, isDirectory: stats.isDirectory() };
                } catch (e) {
                    return null; // Skip inaccessible items
                }
            });
            
            const itemResults = await Promise.all(itemPromises);
            
            for (const result of itemResults) {
                if (result) {
                    if (result.isDirectory) {
                        // Add subdirectory to queue for processing
                        directories.push(result.fullPath);
                    } else {
                        // Add only files to items list
                        items.push(result.fullPath);
                    }
                }
            }
        } catch (e) {
            // Skip inaccessible directories
        }
    }

    console.log(`📊 Recursive scan of ${rootPath}: found ${items.length} items (directories + files)`);
    return items;
}

// Optimized file stats function using async operations
async function getFileStatsOptimized(filePath, calculateCrc32 = true) {
    const fs_promises = require('fs').promises;
    
    // Check if this is a dummy placeholder file
    const isDummy = filePath.endsWith('.dummy_placeholder.txt');
    
    if (isDummy) {
        // Create dummy file entry without accessing filesystem
        const parsed = path.parse(filePath);
        const now = new Date().toISOString();
        
        return {
            full_path: filePath,
            directory: parsed.dir,
            filename: parsed.base,
            extension: parsed.ext,
            size: 0,
            created_time: now,
            modified_time: now,
            is_directory: 0,
            attributes: '',
            crc32: null,
            is_dummy: 1  // Mark as dummy
        };
    }
    
    try {
        const stats = await fs_promises.stat(filePath);
        const parsed = path.parse(filePath);
        
        let crc32Value = null;
        if (!stats.isDirectory() && calculateCrc32) {
            crc32Value = await calculateCRC32Optimized(filePath, stats.size);
        }
        
        return {
            full_path: filePath,
            directory: parsed.dir,
            filename: parsed.base,
            extension: parsed.ext,
            size: stats.size,
            created_time: stats.birthtime.toISOString(),
            modified_time: stats.mtime.toISOString(),
            is_directory: stats.isDirectory() ? 1 : 0,
            attributes: getFileAttributes(stats),
            crc32: crc32Value,
            is_dummy: 0  // Not a dummy
        };
    } catch (error) {
        console.error(`Error getting stats for ${filePath}:`, error.message);
        return null;
    }
}

// Optimized CRC32 calculation using partial hashing for large files
async function calculateCRC32Optimized(filePath, fileSize) {
    const fs_promises = require('fs').promises;
    
    try {
        // For small files (< 10MB), read entire file
        if (fileSize < 10 * 1024 * 1024) {
            const data = await fs_promises.readFile(filePath);
            return crypto.createHash('md5').update(data).digest('hex').substring(0, 8);
        }
        
        // For medium files (10MB - 100MB), use streaming
        if (fileSize < 100 * 1024 * 1024) {
            return new Promise((resolve, reject) => {
                const hash = crypto.createHash('md5');
                const stream = fs.createReadStream(filePath, { highWaterMark: 256 * 1024 }); // 256KB chunks
                
                stream.on('data', (chunk) => {
                    hash.update(chunk);
                });
                
                stream.on('end', () => {
                    resolve(hash.digest('hex').substring(0, 8));
                });
                
                stream.on('error', (error) => {
                    console.error(`Error reading file for CRC32: ${filePath}`, error.message);
                    resolve(null);
                });
            });
        }
        
        // For large files (100MB+), use PARTIAL HASHING for speed
        // Read: first 1MB + middle 1MB + last 1MB + file size
        // This is much faster and still provides good uniqueness
        const chunkSize = 1 * 1024 * 1024; // 1MB chunks
        const hash = crypto.createHash('md5');
        
        // Add file size to hash (important for uniqueness)
        hash.update(Buffer.from(fileSize.toString()));
        
        const fileHandle = await fs_promises.open(filePath, 'r');
        
        try {
            // Read first 1MB
            const startBuffer = Buffer.alloc(Math.min(chunkSize, fileSize));
            await fileHandle.read(startBuffer, 0, startBuffer.length, 0);
            hash.update(startBuffer);
            
            // Read middle 1MB (if file is large enough)
            if (fileSize > chunkSize * 2) {
                const middlePos = Math.floor(fileSize / 2) - Math.floor(chunkSize / 2);
                const middleBuffer = Buffer.alloc(chunkSize);
                await fileHandle.read(middleBuffer, 0, middleBuffer.length, middlePos);
                hash.update(middleBuffer);
            }
            
            // Read last 1MB (if file is large enough)
            if (fileSize > chunkSize) {
                const endPos = Math.max(0, fileSize - chunkSize);
                const endBuffer = Buffer.alloc(Math.min(chunkSize, fileSize - endPos));
                await fileHandle.read(endBuffer, 0, endBuffer.length, endPos);
                hash.update(endBuffer);
            }
            
            await fileHandle.close();
            
            const result = hash.digest('hex').substring(0, 8);
            console.log(`⚡ Fast hash for large file (${Math.round(fileSize / 1024 / 1024)}MB): ${path.basename(filePath)}`);
            return result;
            
        } catch (error) {
            await fileHandle.close();
            throw error;
        }
        
    } catch (error) {
        console.error(`Error calculating CRC32 for ${filePath}:`, error.message);
        return null;
    }
}

// Batch database insert for better performance
async function batchInsertToDatabase(fileStatsArray) {
    if (fileStatsArray.length === 0) {
        return;
    }
    
    try {
        // Use batch insert utility with transaction
        const insertedCount = await batchInsertOrUpdate(db, fileStatsArray, 'files', true);
        console.log(`✅ Inserted/updated ${insertedCount} records in database`);
        
        // Invalidate and reload database cache after successful insert
        await invalidateDatabaseCaches(db, queryCache, optimizedCache, dbCache);
    } catch (error) {
        console.error('❌ Database insert error:', error);
        throw error;
    }
}

// Check database status for multiple paths
app.post('/api/files/database-status', async (req, res) => {
    const { paths } = req.body;
    
    if (!paths || !Array.isArray(paths) || paths.length === 0) {
        return res.status(400).json({ error: 'Paths array is required' });
    }
    
    // Limit batch size to prevent excessive queries
    if (paths.length > 1000) {
        return res.status(400).json({ error: 'Too many paths. Maximum 1000 paths per request.' });
    }
    
    try {
        // Sanitize and validate paths
        const sanitizedPaths = paths.map(p => {
            if (typeof p !== 'string') {
                throw new Error('All paths must be strings');
            }
            return path.normalize(p);
        });
        
        // Use batch query utility with timeout
        const existenceMap = await queryWithRetry(
            db,
            () => checkExistenceByPaths(db, sanitizedPaths),
            3,
            100
        );
        
        // Convert Map to plain object for JSON response
        const statusMap = {};
        existenceMap.forEach((exists, filePath) => {
            statusMap[filePath] = exists;
        });
        
        res.json({ statusMap });
    } catch (error) {
        console.error('Database status check error:', error.message);
        res.status(500).json({ error: 'Database connection error' });
    }
});

// Get files with search
app.get('/api/files', async (req, res) => {
    const { search, skip = 0, limit = 100 } = req.query;
    
    try {
        let query = 'SELECT * FROM files WHERE (is_dummy IS NULL OR is_dummy = 0)';
        let params = [];
        
        if (search) {
            query += ' AND (filename LIKE ? OR full_path LIKE ? OR extension LIKE ? OR crc32 LIKE ?)';
            const searchPattern = `%${search}%`;
            params = [searchPattern, searchPattern, searchPattern, searchPattern];
        }
        
        query += ` ORDER BY is_directory DESC, filename ASC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), parseInt(skip));
        
        // Use promisified query
        const rows = await dbQuery(db, query, params);
        res.json(rows);
    } catch (error) {
        console.error('❌ Get files error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get files in hierarchical tree structure
// Lazy loading tree - returns only one level at a time
app.get('/api/files/tree', async (req, res) => {
    const { search, parent } = req.query;
    
    try {
        const activeCache = getActiveCache();
        const pathSep = path.sep;
        let nodes;
        let allFiles;
        
        // Ensure database cache is loaded
        if (USE_OPTIMIZED_CACHE) {
            if (!optimizedCache.isLoaded) {
                console.log('⏳ OptimizedDatabaseCache not loaded yet, loading now...');
                await optimizedCache.load();
            }
        } else {
            if (!dbCache.isLoaded) {
                console.log('⏳ Database cache not loaded yet, loading now...');
                await dbCache.loadFromDatabase();
            }
            allFiles = dbCache.getAll();
        }
        
        if (search) {
            // Search mode - use optimized search with batch loading
            const startTime = Date.now();
            let searchResults;
            
            if (USE_OPTIMIZED_CACHE) {
                // Use SearchIndex for initial filtering, then batch load full data
                const searchLimit = config.searchLimit;
                searchResults = await optimizedCache.search(search, searchLimit * 2); // Get more for filtering
                console.log(`🔍 SearchIndex found ${searchResults.length} results in ${Date.now() - startTime}ms`);
            } else {
                // Use old cache search
                searchResults = dbCache.search(search);
                console.log(`🔍 Legacy search found ${searchResults.length} results in ${Date.now() - startTime}ms`);
            }
            
            const lowerSearch = search.toLowerCase();
            const searchWords = lowerSearch.split(/\s+/);
            
            // Find the shallowest (closest to root) matching paths
            const pathsByDepth = new Map();
            
            searchResults.forEach(file => {
                const lowerPath = file.full_path.toLowerCase();
                const lowerFilename = file.filename.toLowerCase();
                
                // Find the first path component that matches ALL search words
                const pathParts = file.full_path.split(path.sep);
                let matchingPath = null;
                let matchingDepth = Infinity;
                
                for (let i = 0; i < pathParts.length; i++) {
                    const partialPath = pathParts.slice(0, i + 1).join(path.sep);
                    const partialLower = partialPath.toLowerCase();
                    
                    // Check if this path segment matches all search words
                    const allWordsMatch = searchWords.every(word => partialLower.includes(word));
                    
                    if (allWordsMatch && i < matchingDepth) {
                        matchingPath = partialPath;
                        matchingDepth = i;
                        break; // Found the shallowest match
                    }
                }
                
                if (matchingPath && !pathsByDepth.has(matchingPath)) {
                    // For optimized cache, we need to get the index data for this path
                    let entry;
                    if (USE_OPTIMIZED_CACHE) {
                        const indexData = optimizedCache.getByPath(matchingPath);
                        if (indexData) {
                            // We have the minimal data, use the full file data we already loaded
                            entry = searchResults.find(f => f.full_path === matchingPath);
                        }
                    } else {
                        entry = allFiles.find(f => f.full_path === matchingPath);
                    }
                    
                    if (entry) {
                        pathsByDepth.set(matchingPath, { file: entry, depth: matchingDepth });
                    }
                }
            });
            
            // Score and sort results using cached data
            const scoredResults = Array.from(pathsByDepth.values()).map(({ file, depth }) => {
                const lowerFilename = file.filename.toLowerCase();
                const lowerPath = file.full_path.toLowerCase();
                let score = 0;
                
                // Exact match in filename (highest priority)
                if (lowerFilename === lowerSearch) score += 1000;
                // Filename starts with search term
                else if (lowerFilename.startsWith(lowerSearch)) score += 750;
                // Filename contains exact phrase
                else if (lowerFilename.includes(lowerSearch)) score += 500;
                // Path contains exact phrase  
                if (lowerPath.includes(lowerSearch)) score += 100;
                // Prefer directories
                if (file.is_directory === 1) score += 50;
                // Strongly prefer shallower paths (closer to root)
                score -= depth * 10;
                
                return { file, score };
            });
            
            // Sort by score descending
            scoredResults.sort((a, b) => b.score - a.score);
            
            // Optimize: load only top N results instead of all matches
            const topN = parseInt(process.env.SEARCH_LIMIT) || 1000;
            const limitedResults = scoredResults.slice(0, topN).map(r => r.file);
            
            // Build response nodes
            nodes = limitedResults.map(file => {
                let existsOnDisk = false;
                try {
                    existsOnDisk = fs.existsSync(file.full_path);
                } catch (e) {
                    existsOnDisk = false;
                }
                
                // Check if has children
                let hasChildren = false;
                if (file.is_directory === 1) {
                    if (USE_OPTIMIZED_CACHE) {
                        const childrenIds = optimizedCache.getChildrenIds(file.full_path);
                        hasChildren = childrenIds.size > 0;
                    } else {
                        hasChildren = dbCache.getByDirectory(file.full_path).length > 0 ||
                                     allFiles.some(f => f.full_path.startsWith(file.full_path + path.sep));
                    }
                }
                
                return {
                    id: file.id,
                    path: file.full_path,
                    name: file.filename,
                    isDirectory: file.is_directory === 1,
                    hasChildren: hasChildren,
                    size: file.size,
                    existsOnDisk: existsOnDisk,
                    createdTime: file.created_time,
                    modifiedTime: file.modified_time,
                    crc32: file.crc32,
                    inDatabase: true
                };
            });
            
            const totalTime = Date.now() - startTime;
            console.log(`🔍 Search completed: ${searchResults.length} raw results → ${pathsByDepth.size} top-level paths → ${nodes.length} returned (${totalTime}ms)`);
        } else if (!parent || parent === 'root') {
            // Root level - get top-level directories (drives and root folders)
            
            // Collect unique root paths (first level only)
            const rootPaths = new Map();
            
            if (USE_OPTIMIZED_CACHE) {
                // Use index cache to get all paths
                const allPaths = optimizedCache.getAllPaths();
                
                allPaths.forEach(fullPath => {
                    if (!fullPath) return;
                    
                    // Extract root part (drive or first folder)
                    let rootPart;
                    if (process.platform === 'win32') {
                        // Windows: C:\, D:\, etc.
                        const match = fullPath.match(/^([A-Z]:)/i);
                        if (match) {
                            rootPart = match[1];
                        }
                    } else {
                        // Unix: /home, /var, etc.
                        const parts = fullPath.split(pathSep).filter(p => p);
                        if (parts.length > 0) {
                            rootPart = pathSep + parts[0];
                        }
                    }
                    
                    if (rootPart && !rootPaths.has(rootPart)) {
                        rootPaths.set(rootPart, rootPart);
                    }
                });
                
                // Batch load full data for root paths
                const rootPathsList = Array.from(rootPaths.keys());
                const rootFiles = [];
                
                for (const rootPath of rootPathsList) {
                    const indexData = optimizedCache.getByPath(rootPath);
                    if (indexData) {
                        const fullData = await optimizedCache.getFullData(indexData.id);
                        if (fullData) {
                            rootFiles.push(fullData);
                        }
                    } else {
                        // Create virtual root entry
                        rootFiles.push({
                            id: `virtual_${rootPath}`,
                            full_path: rootPath,
                            filename: rootPath,
                            is_directory: 1,
                            size: 0,
                            created_time: null,
                            modified_time: null,
                            crc32: null
                        });
                    }
                }
                
                nodes = rootFiles.map(file => {
                    // For root drives, check if there are any paths starting with drive letter
                    const isDrive = /^[A-Z]:$/i.test(file.full_path);
                    let hasChildren = false;
                    
                    if (isDrive) {
                        // Check if any paths start with this drive
                        const allPaths = optimizedCache.getAllPaths();
                        const drivePrefix = file.full_path + pathSep;
                        hasChildren = Array.from(allPaths).some(p => p.startsWith(drivePrefix));
                    } else {
                        const childrenIds = optimizedCache.getChildrenIds(file.full_path);
                        hasChildren = childrenIds.size > 0;
                    }
                    
                    console.log(`🔍 Root "${file.full_path}": hasChildren=${hasChildren}`);
                    
                    let existsOnDisk = false;
                    try {
                        existsOnDisk = fs.existsSync(file.full_path);
                    } catch (e) {
                        existsOnDisk = false;
                    }
                    
                    return {
                        id: file.id,
                        path: file.full_path,
                        name: file.filename,
                        isDirectory: true,
                        hasChildren: hasChildren,
                        size: file.size || 0,
                        existsOnDisk: existsOnDisk,
                        createdTime: file.created_time,
                        modifiedTime: file.modified_time,
                        crc32: file.crc32,
                        inDatabase: typeof file.id === 'number'
                    };
                });
            } else {
                // Use old cache
                allFiles.forEach(file => {
                    const fullPath = file.full_path || '';
                    if (!fullPath) return;
                    
                    // Extract root part (drive or first folder)
                    let rootPart;
                    if (process.platform === 'win32') {
                        // Windows: C:\, D:\, etc.
                        const match = fullPath.match(/^([A-Z]:)/i);
                        if (match) {
                            rootPart = match[1];
                        }
                    } else {
                        // Unix: /home, /var, etc.
                        const parts = fullPath.split(pathSep).filter(p => p);
                        if (parts.length > 0) {
                            rootPart = pathSep + parts[0];
                        }
                    }
                    
                    if (rootPart && !rootPaths.has(rootPart)) {
                        // Find the actual directory entry for this root
                        const rootDir = allFiles.find(f => 
                            f.full_path === rootPart && f.is_directory === 1
                        );
                        
                        if (rootDir) {
                            rootPaths.set(rootPart, rootDir);
                        } else {
                            // Create virtual root entry
                            rootPaths.set(rootPart, {
                                id: `virtual_${rootPart}`,
                                full_path: rootPart,
                                filename: rootPart,
                                is_directory: 1,
                                size: 0,
                                created_time: null,
                                modified_time: null,
                                crc32: null
                            });
                        }
                    }
                });
                
                nodes = Array.from(rootPaths.values()).map(file => {
                    const byDir = dbCache.getByDirectory(file.full_path).length;
                    const byPrefix = allFiles.filter(f => f.full_path.startsWith(file.full_path + pathSep)).length;
                    const hasChildren = byDir > 0 || byPrefix > 0;
                    
                    console.log(`🔍 Root "${file.full_path}": byDir=${byDir}, byPrefix=${byPrefix}, hasChildren=${hasChildren}`);
                    
                    let existsOnDisk = false;
                    try {
                        existsOnDisk = fs.existsSync(file.full_path);
                    } catch (e) {
                        existsOnDisk = false;
                    }
                    
                    return {
                        id: file.id,
                        path: file.full_path,
                        name: file.filename,
                        isDirectory: true,
                        hasChildren: hasChildren,
                        size: file.size || 0,
                        existsOnDisk: existsOnDisk,
                        createdTime: file.created_time,
                        modifiedTime: file.modified_time,
                        crc32: file.crc32,
                        inDatabase: typeof file.id === 'number'
                    };
                });
            }
        } else {
            // Load children of specific directory
            
            // Normalize parent path (remove double backslashes)
            const normalizedParent = parent.replace(/\\\\/g, '\\');
            
            console.log(`🔍 Loading children for parent: "${parent}"`);
            console.log(`   Normalized parent: "${normalizedParent}"`);
            console.log(`   Path separator: "${pathSep}"`);
            
            if (USE_OPTIMIZED_CACHE) {
                // Check if this is a root drive (e.g., "P:", "C:")
                const isDrive = /^[A-Z]:$/i.test(normalizedParent);
                
                if (isDrive) {
                    // For drives, find all first-level folders
                    console.log(`   Detected root drive: ${normalizedParent}`);
                    
                    const allPaths = optimizedCache.getAllPaths();
                    const firstLevelPaths = new Set();
                    const drivePrefix = normalizedParent + pathSep;
                    
                    // Find all unique first-level paths under this drive
                    allPaths.forEach(fullPath => {
                        if (fullPath.startsWith(drivePrefix)) {
                            // Extract first level: "P:\Photo\Sub" -> "P:\Photo"
                            const afterDrive = fullPath.substring(drivePrefix.length);
                            const firstPart = afterDrive.split(pathSep)[0];
                            if (firstPart) {
                                const firstLevelPath = drivePrefix + firstPart;
                                firstLevelPaths.add(firstLevelPath);
                            }
                        }
                    });
                    
                    console.log(`   Found ${firstLevelPaths.size} first-level paths`);
                    
                    // Load full data for these paths
                    const children = [];
                    for (const firstLevelPath of firstLevelPaths) {
                        const indexData = optimizedCache.getByPath(firstLevelPath);
                        if (indexData) {
                            const fullData = await optimizedCache.getFullData(indexData.id);
                            if (fullData) {
                                children.push(fullData);
                            }
                        } else {
                            // Path doesn't exist as a file entry, but has children
                            // Create virtual directory entry
                            const folderName = firstLevelPath.split(pathSep).pop();
                            children.push({
                                id: `virtual_${firstLevelPath}`,
                                full_path: firstLevelPath,
                                filename: folderName,
                                directory: normalizedParent,
                                is_directory: 1,
                                size: 0,
                                created_time: null,
                                modified_time: null,
                                crc32: null
                            });
                            console.log(`   Created virtual entry for: ${firstLevelPath}`);
                        }
                    }
                    
                    console.log(`   Loaded ${children.length} children with full data`);
                    
                    nodes = children.map(file => {
                        // For virtual entries, check if there are any files under this path
                        let hasChildren = false;
                        if (typeof file.id === 'string' && file.id.startsWith('virtual_')) {
                            // Virtual entry - check if any paths start with this path
                            const allPaths = optimizedCache.getAllPaths();
                            hasChildren = Array.from(allPaths).some(p => 
                                p.startsWith(file.full_path + pathSep) && p !== file.full_path
                            );
                        } else {
                            // Real entry - use normal logic
                            hasChildren = file.is_directory === 1 && 
                                optimizedCache.getChildrenIds(file.full_path).size > 0;
                        }
                        
                        let existsOnDisk = false;
                        try {
                            existsOnDisk = fs.existsSync(file.full_path);
                        } catch (e) {
                            existsOnDisk = false;
                        }
                        
                        return {
                            id: file.id,
                            path: file.full_path,
                            name: file.filename,
                            isDirectory: file.is_directory === 1,
                            hasChildren: hasChildren,
                            size: file.size,
                            existsOnDisk: existsOnDisk,
                            createdTime: file.created_time,
                            modifiedTime: file.modified_time,
                            crc32: file.crc32,
                            inDatabase: typeof file.id === 'number'
                        };
                    });
                } else {
                    // Regular directory - use normal logic
                    const childrenIds = optimizedCache.getChildrenIds(normalizedParent);
                    console.log(`   Children IDs from index: ${childrenIds.size}`);
                    
                    // Batch load full data for children
                    const children = await optimizedCache.getFullDataBatch(Array.from(childrenIds));
                    console.log(`   Loaded ${children.length} children with full data`);
                    
                    nodes = children.map(file => {
                        const hasChildren = file.is_directory === 1 && 
                            optimizedCache.getChildrenIds(file.full_path).size > 0;
                        
                        let existsOnDisk = false;
                        try {
                            existsOnDisk = fs.existsSync(file.full_path);
                        } catch (e) {
                            existsOnDisk = false;
                        }
                        
                        return {
                            id: file.id,
                            path: file.full_path,
                            name: file.filename,
                            isDirectory: file.is_directory === 1,
                            hasChildren: hasChildren,
                            size: file.size,
                            existsOnDisk: existsOnDisk,
                            createdTime: file.created_time,
                            modifiedTime: file.modified_time,
                            crc32: file.crc32,
                            inDatabase: true
                        };
                    });
                }
            } else {
                // Use old cache
                console.log(`   Total files in cache: ${allFiles.length}`);
                
                // Debug: Check what files exist for this parent
                const filesWithParentInPath = allFiles.filter(f => 
                    f.full_path && f.full_path.toLowerCase().startsWith(normalizedParent.toLowerCase())
                );
                console.log(`   Files starting with "${normalizedParent}": ${filesWithParentInPath.length}`);
                
                // Always show first 5 samples
                console.log(`   Sample files (first 5):`);
                filesWithParentInPath.slice(0, 5).forEach(f => {
                    console.log(`     - full_path: "${f.full_path}"`);
                    console.log(`       directory: "${f.directory}"`);
                    console.log(`       filename: "${f.filename}"`);
                });
                
                // Find direct children only (not nested)
                let children = [];
                
                // Method 1: Files where directory === normalizedParent
                const directChildren = allFiles.filter(file => 
                    file.full_path && file.full_path !== normalizedParent && file.directory === normalizedParent
                );
                
                console.log(`   Method 1 (directory === normalizedParent): ${directChildren.length} files`);
                
                // Method 2: If no direct children found, extract unique first-level items
                if (directChildren.length === 0 && filesWithParentInPath.length > 0) {
                    console.log(`   Using Method 2 (extract first-level from paths)`);
                    
                    const uniqueFirstLevel = new Map();
                    
                    filesWithParentInPath.forEach(file => {
                        if (file.full_path === normalizedParent) return;
                        
                        // Extract first level after parent
                        // Example: "P:\Photo\Subfolder\file.txt" -> "Subfolder"
                        const afterParent = file.full_path.substring(normalizedParent.length);
                        // Remove leading separator if present
                        const cleanPath = afterParent.startsWith(pathSep) ? afterParent.substring(1) : afterParent;
                        const firstPart = cleanPath.split(pathSep)[0];
                        
                        if (firstPart && !uniqueFirstLevel.has(firstPart)) {
                            // Build the full path for this first-level item
                            const firstLevelPath = normalizedParent + (normalizedParent.endsWith(pathSep) ? '' : pathSep) + firstPart;
                            const actualEntry = allFiles.find(f => f.full_path === firstLevelPath);
                            
                            if (actualEntry) {
                                uniqueFirstLevel.set(firstPart, actualEntry);
                                console.log(`     Found actual entry: ${firstLevelPath}`);
                            } else {
                                // Create virtual entry
                                uniqueFirstLevel.set(firstPart, {
                                    id: `virtual_${firstLevelPath}`,
                                    full_path: firstLevelPath,
                                    filename: firstPart,
                                    directory: normalizedParent,
                                    is_directory: 1,
                                    size: 0,
                                    created_time: null,
                                    modified_time: null,
                                    crc32: null
                                });
                                console.log(`     Created virtual entry: ${firstLevelPath}`);
                            }
                        }
                    });
                    
                    children = Array.from(uniqueFirstLevel.values());
                    console.log(`   Method 2 found ${children.length} unique first-level items`);
                } else {
                    children = directChildren;
                }
                
                console.log(`   Total direct children: ${children.length}`);
                
                nodes = children.map(file => {
                    const hasChildren = file.is_directory === 1 && 
                        (dbCache.getByDirectory(file.full_path).length > 0 ||
                         allFiles.some(f => f.full_path.startsWith(file.full_path + pathSep) && f.full_path !== file.full_path));
                    
                    let existsOnDisk = false;
                    try {
                        existsOnDisk = fs.existsSync(file.full_path);
                    } catch (e) {
                        existsOnDisk = false;
                    }
                    
                    return {
                        id: file.id,
                        path: file.full_path,
                        name: file.filename,
                        isDirectory: file.is_directory === 1,
                        hasChildren: hasChildren,
                        size: file.size,
                        existsOnDisk: existsOnDisk,
                        createdTime: file.created_time,
                        modifiedTime: file.modified_time,
                        crc32: file.crc32,
                        inDatabase: true
                    };
                });
            }
        }
        
        // Sort: directories first, then by name
        nodes.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) {
                return b.isDirectory ? 1 : -1;
            }
            return a.name.localeCompare(b.name);
        });
        
        // Prevent caching on client side
        res.set({
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        
        console.log(`✅ Lazy tree loaded: ${nodes.length} nodes for parent="${parent || 'root'}"`);
        res.json({ nodes, parent: parent || 'root' });
        
    } catch (error) {
        console.error('❌ Tree query error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Lazy loading API endpoint for tree
app.get('/api/tree/lazy', (req, res) => {
    const { parent, cursor, limit = 1000 } = req.query;
    
    // Validate limit
    const maxLimit = Math.min(parseInt(limit) || 1000, 1000);
    const offset = parseInt(cursor) || 0;
    
    console.log(`🌳 Lazy load request: parent="${parent}", cursor=${offset}, limit=${maxLimit}`);
    
    // Check cache first (if enabled)
    const cacheKey = `tree:${parent || 'root'}:${offset}:${maxLimit}`;
    if (queryCache) {
        const cachedResult = queryCache.get(cacheKey);
        
        if (cachedResult) {
            console.log(`✅ Returning cached result for ${cacheKey}`);
            return res.json(cachedResult);
        }
    }
    
    try {
        let query, countQuery, params;
        
        if (!parent || parent === 'root') {
            // Load root level nodes (directories and files at root)
            query = `
                SELECT 
                    full_path,
                    filename,
                    is_directory,
                    size,
                    created_time,
                    modified_time,
                    crc32,
                    (SELECT COUNT(*) FROM files f2 WHERE f2.directory = files.full_path AND files.is_directory = 1) as child_count
                FROM files
                WHERE directory = '' OR directory IS NULL OR full_path NOT LIKE '%${path.sep}%${path.sep}%'
                ORDER BY is_directory DESC, filename ASC
                LIMIT ? OFFSET ?
            `;
            
            countQuery = `
                SELECT COUNT(*) as total
                FROM files
                WHERE directory = '' OR directory IS NULL OR full_path NOT LIKE '%${path.sep}%${path.sep}%'
            `;
            
            params = [maxLimit, offset];
        } else {
            // Load children of specific directory
            query = `
                SELECT 
                    full_path,
                    filename,
                    is_directory,
                    size,
                    created_time,
                    modified_time,
                    crc32,
                    (SELECT COUNT(*) FROM files f2 WHERE f2.directory = files.full_path AND files.is_directory = 1) as child_count
                FROM files
                WHERE directory = ?
                ORDER BY is_directory DESC, filename ASC
                LIMIT ? OFFSET ?
            `;
            
            countQuery = `
                SELECT COUNT(*) as total
                FROM files
                WHERE directory = ?
            `;
            
            params = [parent, maxLimit, offset];
        }
        
        // Get total count first
        const countParams = parent && parent !== 'root' ? [parent] : [];
        db.get(countQuery, countParams, (countErr, countResult) => {
            if (countErr) {
                console.error('❌ Count query error:', countErr);
                return res.status(500).json({ error: countErr.message });
            }
            
            const totalCount = countResult.total;
            
            // Get paginated nodes
            db.all(query, params, (err, rows) => {
                if (err) {
                    console.error('❌ Lazy load query error:', err);
                    return res.status(500).json({ error: err.message });
                }
                
                // Check if files exist on disk and format response
                const nodes = rows.map(row => {
                    let existsOnDisk = false;
                    try {
                        existsOnDisk = fs.existsSync(row.full_path);
                    } catch (error) {
                        existsOnDisk = false;
                    }
                    
                    return {
                        path: row.full_path,
                        name: row.filename,
                        isDirectory: row.is_directory === 1,
                        hasChildren: row.is_directory === 1 && row.child_count > 0,
                        childCount: row.child_count || 0,
                        size: row.size,
                        existsOnDisk: existsOnDisk,
                        createdTime: row.created_time,
                        modifiedTime: row.modified_time,
                        crc32: row.crc32
                    };
                });
                
                const hasMore = offset + rows.length < totalCount;
                const nextCursor = hasMore ? offset + rows.length : null;
                
                console.log(`✅ Loaded ${rows.length} nodes (${offset}-${offset + rows.length} of ${totalCount})`);
                
                const result = {
                    nodes: nodes,
                    nextCursor: nextCursor,
                    hasMore: hasMore,
                    totalCount: totalCount,
                    currentOffset: offset,
                    limit: maxLimit
                };
                
                // Cache the result (if enabled)
                if (queryCache) {
                    queryCache.set(cacheKey, result);
                }
                
                res.json(result);
            });
        });
        
    } catch (error) {
        console.error('❌ Lazy load error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Batch tree expansion endpoint - optimized for loading multiple nodes at once
// Uses IndexCache for structure and batch loads full details only when needed
app.post('/api/tree/batch-expand', async (req, res) => {
    const { directories } = req.body;
    
    if (!directories || !Array.isArray(directories)) {
        return res.status(400).json({ error: 'directories array is required' });
    }
    
    try {
        // Ensure optimized cache is loaded
        if (USE_OPTIMIZED_CACHE) {
            if (!optimizedCache.isLoaded) {
                console.log('⏳ OptimizedDatabaseCache not loaded yet, loading now...');
                await optimizedCache.load();
            }
        } else {
            return res.status(400).json({ 
                error: 'Batch expansion requires optimized cache to be enabled' 
            });
        }
        
        const startTime = Date.now();
        const results = {};
        
        // Collect all child IDs for all requested directories
        const allChildIds = new Set();
        const directoryChildMap = new Map();
        
        for (const directory of directories) {
            const childrenIds = optimizedCache.getChildrenIds(directory);
            directoryChildMap.set(directory, Array.from(childrenIds));
            childrenIds.forEach(id => allChildIds.add(id));
        }
        
        // Batch load full data for all children at once (single DB query)
        const allChildren = await optimizedCache.getFullDataBatch(Array.from(allChildIds));
        
        // Create a map for quick lookup
        const childrenMap = new Map();
        allChildren.forEach(child => {
            childrenMap.set(child.id, child);
        });
        
        // Build response for each directory
        for (const directory of directories) {
            const childIds = directoryChildMap.get(directory);
            const children = childIds
                .map(id => childrenMap.get(id))
                .filter(child => child !== undefined);
            
            // Transform to tree node format
            results[directory] = children.map(file => {
                const hasChildren = file.is_directory === 1 && 
                    optimizedCache.getChildrenIds(file.full_path).size > 0;
                
                let existsOnDisk = false;
                try {
                    existsOnDisk = fs.existsSync(file.full_path);
                } catch (error) {
                    existsOnDisk = false;
                }
                
                return {
                    id: file.id,
                    path: file.full_path,
                    name: file.filename,
                    isDirectory: file.is_directory === 1,
                    hasChildren: hasChildren,
                    size: file.size,
                    extension: file.extension,
                    createdTime: file.created_time,
                    modifiedTime: file.modified_time,
                    crc32: file.crc32,
                    existsOnDisk: existsOnDisk,
                    inDatabase: true
                };
            });
            
            // Sort: directories first, then by name
            results[directory].sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) {
                    return b.isDirectory ? 1 : -1;
                }
                return a.name.localeCompare(b.name);
            });
        }
        
        const duration = Date.now() - startTime;
        const totalNodes = Object.values(results).reduce((sum, nodes) => sum + nodes.length, 0);
        
        console.log(`✅ Batch expanded ${directories.length} directories, ${totalNodes} total nodes in ${duration}ms`);
        
        res.json({
            results: results,
            stats: {
                directoriesExpanded: directories.length,
                totalNodes: totalNodes,
                duration: duration
            }
        });
        
    } catch (error) {
        console.error('❌ Batch expansion error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get file by ID
app.get('/api/files/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const activeCache = getActiveCache();
        let file;
        
        if (USE_OPTIMIZED_CACHE) {
            // Ensure cache is loaded
            if (!optimizedCache.isLoaded) {
                console.log('⏳ OptimizedDatabaseCache not loaded yet, loading now...');
                await optimizedCache.load();
            }
            
            // Try hot cache first, fallback to database
            file = await optimizedCache.getFullData(parseInt(id));
        } else {
            // Use old cache or direct database query
            if (!dbCache.isLoaded) {
                await dbCache.loadFromDatabase();
            }
            
            // Direct database query for old cache
            file = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM files WHERE id = ?', [id], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
        }
        
        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        res.json(file);
    } catch (error) {
        console.error('❌ Error fetching file by ID:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete file record
app.delete('/api/files/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        // Get file info before deletion for selective invalidation
        const fileId = parseInt(id);
        let filePath = null;
        let isDirectory = false;
        
        if (USE_OPTIMIZED_CACHE && optimizedCache.isLoaded) {
            const indexData = optimizedCache.getIndexData(fileId);
            if (indexData) {
                filePath = indexData.full_path;
                isDirectory = indexData.is_directory === 1;
            }
        }
        
        // Use batch delete utility (works for single ID too)
        const deletedCount = await batchDeleteByIds(db, [fileId]);
        
        if (deletedCount === 0) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        // Use selective invalidation if we have the file path
        if (filePath && USE_OPTIMIZED_CACHE) {
            if (isDirectory) {
                await invalidateDatabaseCaches(db, queryCache, optimizedCache, dbCache{ directories: [filePath], fullReload: false });
            } else {
                await invalidateDatabaseCaches(db, queryCache, optimizedCache, dbCache{ paths: [filePath], fullReload: false });
            }
        } else {
            await invalidateDatabaseCaches(db, queryCache, optimizedCache, dbCache);
        }
        
        res.json({ message: 'File record deleted' });
    } catch (error) {
        console.error('❌ Delete file error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get statistics
app.get('/api/stats', async (req, res) => {
    try {
        // Use database stats utility for comprehensive statistics
        const stats = await getDatabaseStats(db);
        
        // Prevent caching
        res.set({
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        
        res.json({
            total_files: stats.totalFiles,
            total_directories: stats.totalDirectories,
            total_size_bytes: stats.totalSize,
            database_size_bytes: stats.databaseSize || 0
        });
    } catch (error) {
        console.error('❌ Get stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get cache statistics
app.get('/api/cache/stats', (req, res) => {
    // Check if cache stats are enabled
    if (!config.enableCacheStats) {
        return res.status(403).json({
            error: 'Cache statistics are disabled',
            message: 'Set ENABLE_CACHE_STATS=true to enable cache statistics'
        });
    }
    
    try {
        const activeCache = getActiveCache();
        const isOptimized = activeCacheType === 'optimized';
        
        if (isOptimized) {
            if (!optimizedCache.isLoaded) {
                return res.status(503).json({ 
                    error: 'Cache not loaded yet',
                    cacheStrategy: activeCacheType,
                    configuredStrategy: config.cacheStrategy,
                    loadFailed: activeCacheLoadFailed,
                    isLoaded: false
                });
            }
            
            const stats = optimizedCache.getStats();
            
            // Add additional metadata
            const response = {
                cacheStrategy: activeCacheType,
                configuredStrategy: config.cacheStrategy,
                loadFailed: activeCacheLoadFailed,
                ...stats,
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                processMemory: {
                    heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                    heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
                    rss: Math.round(process.memoryUsage().rss / 1024 / 1024)
                }
            };
            
            res.json(response);
        } else {
            // Legacy cache doesn't have detailed stats
            res.json({
                cacheStrategy: activeCacheType,
                configuredStrategy: config.cacheStrategy,
                loadFailed: activeCacheLoadFailed,
                isLoaded: dbCache.isLoaded,
                totalRecords: dbCache.isLoaded ? dbCache.allFiles.length : 0,
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                processMemory: {
                    heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                    heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
                    rss: Math.round(process.memoryUsage().rss / 1024 / 1024)
                }
            });
        }
    } catch (error) {
        console.error('Error retrieving cache stats:', error);
        res.status(500).json({ 
            error: 'Failed to retrieve cache statistics',
            details: error.message 
        });
    }
});

// Health check endpoint with cache stats
app.get('/api/health', (req, res) => {
    try {
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: {
                heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
                rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
                external: Math.round(process.memoryUsage().external / 1024 / 1024)
            },
            cache: null
        };
        
        // Add cache statistics with migration info
        if (activeCacheType === 'optimized') {
            if (optimizedCache.isLoaded) {
                health.cache = {
                    strategy: activeCacheType,
                    configuredStrategy: config.cacheStrategy,
                    loadFailed: activeCacheLoadFailed,
                    isLoaded: true,
                    stats: optimizedCache.getStats()
                };
            } else {
                health.cache = {
                    strategy: activeCacheType,
                    configuredStrategy: config.cacheStrategy,
                    loadFailed: activeCacheLoadFailed,
                    isLoaded: false
                };
                health.status = 'degraded';
            }
        } else {
            if (dbCache.isLoaded) {
                health.cache = {
                    strategy: activeCacheType,
                    configuredStrategy: config.cacheStrategy,
                    loadFailed: activeCacheLoadFailed,
                    isLoaded: true,
                    totalRecords: dbCache.allFiles.length
                };
            } else {
                health.cache = {
                    strategy: activeCacheType,
                    configuredStrategy: config.cacheStrategy,
                    loadFailed: activeCacheLoadFailed,
                    isLoaded: false
                };
                health.status = 'degraded';
            }
        }
        
        res.json(health);
    } catch (error) {
        console.error('Error in health check:', error);
        res.status(500).json({ 
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get current cache strategy and status
app.get('/api/cache/strategy', (req, res) => {
    try {
        const response = {
            currentStrategy: activeCacheType,
            configuredStrategy: config.cacheStrategy,
            loadFailed: activeCacheLoadFailed,
            isLoaded: activeCacheType === 'optimized' ? optimizedCache.isLoaded : dbCache.isLoaded,
            availableStrategies: ['optimized', 'legacy', 'full'],
            timestamp: new Date().toISOString()
        };
        
        res.json(response);
    } catch (error) {
        console.error('Error retrieving cache strategy:', error);
        res.status(500).json({ 
            error: 'Failed to retrieve cache strategy',
            details: error.message 
        });
    }
});

// Switch cache strategy at runtime
app.post('/api/cache/strategy', async (req, res) => {
    const { strategy } = req.body;
    
    if (!strategy) {
        return res.status(400).json({ 
            error: 'Strategy parameter is required',
            availableStrategies: ['optimized', 'legacy', 'full']
        });
    }
    
    // Normalize strategy name
    const normalizedStrategy = strategy.toLowerCase();
    
    if (!['optimized', 'legacy', 'full'].includes(normalizedStrategy)) {
        return res.status(400).json({ 
            error: 'Invalid strategy',
            provided: strategy,
            availableStrategies: ['optimized', 'legacy', 'full']
        });
    }
    
    try {
        console.log(`🔄 API request to switch cache strategy to: ${normalizedStrategy}`);
        
        const result = await switchCacheStrategy(normalizedStrategy);
        
        res.json({
            success: true,
            message: `Successfully switched cache strategy to ${normalizedStrategy}`,
            previousStrategy: result.previousStrategy,
            currentStrategy: result.currentStrategy,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error switching cache strategy:', error);
        res.status(500).json({ 
            error: 'Failed to switch cache strategy',
            details: error.message,
            currentStrategy: activeCacheType
        });
    }
});

// Test cache performance (for migration validation)
app.get('/api/cache/test', async (req, res) => {
    try {
        const testResults = {
            cacheType: activeCacheType,
            timestamp: new Date().toISOString(),
            tests: {}
        };
        
        // Test 1: Get cache size
        const startSize = Date.now();
        const cacheSize = activeCacheType === 'optimized' 
            ? optimizedCache.size() 
            : (dbCache.isLoaded ? dbCache.allFiles.length : 0);
        testResults.tests.cacheSize = {
            duration: Date.now() - startSize,
            result: cacheSize
        };
        
        // Test 2: Search performance (if cache is loaded)
        if ((activeCacheType === 'optimized' && optimizedCache.isLoaded) || 
            (activeCacheType === 'legacy' && dbCache.isLoaded)) {
            
            const startSearch = Date.now();
            const searchResults = activeCacheType === 'optimized'
                ? await optimizedCache.search('test', 100)
                : dbCache.search('test').slice(0, 100);
            testResults.tests.search = {
                duration: Date.now() - startSearch,
                resultCount: searchResults.length
            };
        }
        
        // Test 3: Memory usage
        const memoryUsage = process.memoryUsage();
        testResults.tests.memory = {
            heapUsedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(memoryUsage.heapTotal / 1024 / 1024),
            rssMB: Math.round(memoryUsage.rss / 1024 / 1024)
        };
        
        // Test 4: Cache stats
        if (activeCacheType === 'optimized' && optimizedCache.isLoaded) {
            testResults.tests.cacheStats = optimizedCache.getStats();
        }
        
        res.json(testResults);
        
    } catch (error) {
        console.error('Error testing cache:', error);
        res.status(500).json({ 
            error: 'Failed to test cache',
            details: error.message 
        });
    }
});

// Get scan history
app.get('/api/scan-history', (req, res) => {
    try {
        const history = readScanHistory();
        res.json(history);
    } catch (error) {
        console.error('Error retrieving scan history:', error);
        res.status(500).json({ 
            error: 'Failed to retrieve scan history',
            details: error.message 
        });
    }
});

// Clear scan history
app.delete('/api/scan-history', (req, res) => {
    try {
        const emptyHistory = {
            scans: [],
            version: "1.0",
            created: new Date().toISOString()
        };
        
        const success = writeScanHistory(emptyHistory);
        if (success) {
            console.log('📊 Scan history cleared');
            res.json({ message: 'Scan history cleared successfully' });
        } else {
            res.status(500).json({ error: 'Failed to clear scan history' });
        }
    } catch (error) {
        console.error('Error clearing scan history:', error);
        res.status(500).json({ 
            error: 'Failed to clear scan history',
            details: error.message 
        });
    }
});

// Clear database
app.post('/api/clear', (req, res) => {
    const deletedCount = { count: 0 };
    let responseSent = false;
    
    const sendResponse = (statusCode, data) => {
        if (!responseSent) {
            responseSent = true;
            if (statusCode === 200) {
                res.json(data);
            } else {
                res.status(statusCode).json(data);
            }
        }
    };
    
    db.serialize(() => {
        // First, delete all records
        db.run('DELETE FROM files', function(err) {
            if (err) {
                return sendResponse(500, { error: err.message });
            }
            deletedCount.count = this.changes;
            console.log(`🗑️ Deleted ${this.changes} records from database`);
        });
        
        // Force WAL checkpoint before switching modes
        db.run('PRAGMA wal_checkpoint(TRUNCATE)', function(err) {
            if (err) {
                console.error('❌ WAL checkpoint failed:', err.message);
            } else {
                console.log('📝 WAL checkpoint completed');
            }
        });
        
        // Switch to DELETE mode to force WAL checkpoint
        db.run('PRAGMA journal_mode = DELETE', function(err) {
            if (err) {
                console.error('❌ Failed to switch journal mode:', err.message);
            } else {
                console.log('📝 Switched to DELETE journal mode');
            }
        });
        
        // Then, vacuum to physically remove deleted data and shrink file
        db.run('VACUUM', function(err) {
            if (err) {
                console.error('❌ VACUUM failed:', err.message);
                return sendResponse(500, { error: `Записи удалены, но не удалось сжать файл: ${err.message}` });
            }
            console.log('✅ Database file physically cleaned and compacted');
            
            // Switch back to WAL mode for better performance
            db.run('PRAGMA journal_mode = WAL', function(walErr) {
                if (walErr) {
                    console.error('❌ Failed to switch back to WAL mode:', walErr.message);
                } else {
                    console.log('📝 Switched back to WAL journal mode');
                }
                
                // Clear cache after database clear
                if (queryCache) {
                    queryCache.clear();
                }
                
                if (USE_OPTIMIZED_CACHE) {
                    optimizedCache.invalidate();
                    console.log('🔄 OptimizedDatabaseCache cleared after database clear');
                } else {
                    dbCache.invalidate();
                    console.log('🔄 DatabaseCache cleared after database clear');
                }
                
                sendResponse(200, { 
                    message: `База данных полностью очищена. Удалено ${deletedCount.count} записей. Файл базы данных физически сжат.` 
                });
            });
        });
    });
});

// Compact database - force shrink database file
app.post('/api/compact', (req, res) => {
    console.log('🗜️ Starting database compaction...');
    
    db.serialize(() => {
        // Force WAL checkpoint to merge WAL file into main database
        db.run('PRAGMA wal_checkpoint(TRUNCATE)', function(err) {
            if (err) {
                console.error('❌ WAL checkpoint failed:', err.message);
                return res.status(500).json({ error: `Ошибка checkpoint: ${err.message}` });
            }
            console.log('✅ WAL checkpoint completed');
            
            // Optimize database (similar to VACUUM but works with WAL mode)
            db.run('PRAGMA optimize', function(optimizeErr) {
                if (optimizeErr) {
                    console.error('❌ Optimize failed:', optimizeErr.message);
                } else {
                    console.log('✅ Database optimized');
                }
                
                res.json({ 
                    message: 'База данных успешно оптимизирована. WAL файл объединен с основной базой.' 
                });
            });
        });
    });
});

// Backup database
// Backup database files (filestash.db, filestash.db-shm, filestash.db-wal)
app.post('/api/database/backup', async (req, res) => {
    try {
        // Ensure backups directory exists
        await fse.ensureDir('./backups');
        
        console.log('📦 Starting database files backup...');
        
        // Generate backup name with timestamp
        const now = new Date();
        const dateStr = `${now.getDate().toString().padStart(2, '0')}.${(now.getMonth() + 1).toString().padStart(2, '0')}.${now.getFullYear()}`;
        const timeStr = `${now.getHours().toString().padStart(2, '0')}-${now.getMinutes().toString().padStart(2, '0')}-${now.getSeconds().toString().padStart(2, '0')}`;
        const backupName = `database_backup_${dateStr}_${timeStr}`;
        const backupPath = path.join('./backups', `${backupName}.7z`);
        
        // Check if 7-Zip is available
        const archiverFor7z = await archiverManager.getArchiverForFormat('7z');
        if (!archiverFor7z) {
            return res.status(500).json({ 
                error: '7-Zip не найден. Установите 7-Zip для создания резервных копий.' 
            });
        }
        
        // List of database files to backup
        const dbFiles = [
            './filestash.db',
            './filestash.db-shm',
            './filestash.db-wal'
        ];
        
        // Filter only existing files
        const existingFiles = dbFiles.filter(file => fs.existsSync(file));
        
        if (existingFiles.length === 0) {
            return res.status(404).json({ error: 'Файлы базы данных не найдены' });
        }
        
        console.log(`📦 Backing up ${existingFiles.length} database files...`);
        
        // Create temporary directory for database copies
        const tempDir = path.join(os.tmpdir(), `db_backup_${Date.now()}`);
        await fse.ensureDir(tempDir);
        
        console.log('📦 Copying database files to temporary directory...');
        const tempFiles = [];
        
        try {
            // Copy each database file to temp directory
            for (const dbFile of existingFiles) {
                const fileName = path.basename(dbFile);
                const tempFile = path.join(tempDir, fileName);
                await fse.copy(dbFile, tempFile);
                tempFiles.push(tempFile);
                console.log(`✅ Copied: ${fileName}`);
            }
            
            console.log('📦 Creating archive from copies...');
            
            // Create archive using createArchiveWithProgress
            const { createArchiveWithProgress } = require('./archive-with-progress');
            
            const result = await createArchiveWithProgress({
                filePaths: tempFiles,
                archivePath: backupPath,
                archiverPath: archiverFor7z.path,
                archiverType: archiverFor7z.archiver,
                format: '7z',
                compression: '5', // Normal compression (balance between speed and size)
                onProgress: (progress) => {
                    console.log(`Backup progress: ${progress.progress}%`);
                },
                onConsoleOutput: (line) => {
                    console.log(`Backup: ${line}`);
                }
            });
            
            // Clean up temp directory
            await fse.remove(tempDir);
            console.log('✅ Temporary files cleaned up');
            
        } catch (error) {
            // Clean up temp directory on error
            await fse.remove(tempDir);
            throw error;
        }
        
        // Get archive stats
        const archiveStats = fs.statSync(backupPath);
        
        console.log(`✅ Database backup completed successfully`);
        
        res.json({
            success: true,
            filename: `${backupName}.7z`,
            archivePath: backupPath,
            archiveSize: archiveStats.size,
            filesBackedUp: existingFiles.length,
            timestamp: now.toISOString()
        });
        
    } catch (error) {
        console.error('Backup error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Restore database from backup archive
app.post('/api/database/restore', async (req, res) => {
    try {
        const { filename } = req.body;
        
        if (!filename) {
            return res.status(400).json({ error: 'Filename is required' });
        }
        
        const backupPath = path.join('./backups', filename);
        
        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ error: 'Backup file not found' });
        }
        
        console.log(`📥 Restoring database from: ${filename}`);
        
        // Check if 7-Zip is available
        const archiverFor7z = await archiverManager.getArchiverForFormat('7z');
        if (!archiverFor7z) {
            return res.status(500).json({ 
                error: '7-Zip не найден. Установите 7-Zip для восстановления из резервных копий.' 
            });
        }
        
        // Create temporary extraction directory
        const tempDir = path.join(os.tmpdir(), `db_restore_${Date.now()}`);
        await fse.ensureDir(tempDir);
        
        try {
            // Extract archive using 7-Zip
            const { spawn } = require('child_process');
            const extractProcess = spawn(archiverFor7z.path, [
                'x',                    // Extract
                '-y',                   // Yes to all prompts
                `-o${tempDir}`,         // Output directory
                backupPath              // Archive path
            ]);
            
            await new Promise((resolve, reject) => {
                extractProcess.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`Extraction failed with code ${code}`));
                    }
                });
                
                extractProcess.on('error', reject);
            });
            
            console.log('✅ Archive extracted successfully');
            
            // Close database connections
            console.log('📦 Closing database connections...');
            await new Promise((resolve) => {
                db.close(() => {
                    console.log('✅ Database closed');
                    resolve();
                });
            });
            
            // Copy extracted files to root directory
            const dbFiles = ['filestash.db', 'filestash.db-shm', 'filestash.db-wal'];
            let restoredCount = 0;
            
            for (const dbFile of dbFiles) {
                const sourcePath = path.join(tempDir, dbFile);
                const destPath = path.join('./', dbFile);
                
                if (fs.existsSync(sourcePath)) {
                    await fse.copy(sourcePath, destPath, { overwrite: true });
                    console.log(`✅ Restored: ${dbFile}`);
                    restoredCount++;
                }
            }
            
            // Reopen database
            const sqlite3 = require('sqlite3').verbose();
            global.db = new sqlite3.Database('./filestash.db', sqlite3.OPEN_READWRITE);
            
            // Clean up temp directory
            await fse.remove(tempDir);
            
            console.log(`✅ Database restored successfully (${restoredCount} files)`);
            
            res.json({
                success: true,
                filesRestored: restoredCount,
                message: 'Database restored successfully'
            });
            
        } catch (extractError) {
            // Clean up temp directory on error
            await fse.remove(tempDir);
            throw extractError;
        }
        
    } catch (error) {
        console.error('Restore error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Old backup endpoint (keep for compatibility)
app.post('/api/backup', async (req, res) => {
    try {
        // Ensure backups directory exists
        if (!fs.existsSync('./backups')) {
            fs.mkdirSync('./backups');
        }
        
        console.log('📦 Starting database backup...');
        
        // Format date as DD.MM.YYYY.HH-MM
        const now = new Date();
        const dateStr = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}.${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
        const backupName = `filestash_database_backup(${dateStr})`;
        const backupPath = `./backups/${backupName}.rar`;
        
        // Check if WinRAR is available
        const winrarPath = await findWinRAR();
        if (!winrarPath) {
            return res.status(500).json({ 
                error: 'WinRAR не найден. Установите WinRAR для создания резервных копий.' 
            });
        }
        
        // Get database file info before backup
        const dbStats = fs.statSync('./filestash.db');
        const dbSize = dbStats.size;
        
        // Get record count
        const recordCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM files', (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
        
        // Close database connections temporarily to ensure clean backup
        console.log('📦 Closing database connections...');
        await new Promise((resolve) => {
            db.close(() => {
                console.log('✅ Database closed');
                resolve();
            });
        });
        
        // Reopen database
        const sqlite3 = require('sqlite3').verbose();
        db = new sqlite3.Database('./filestash.db', sqlite3.OPEN_READWRITE);
        
        // Create RAR archive with maximum compression
        // -m5 = maximum compression
        // -ma5 = RAR5 format
        // -ep1 = exclude base folder from paths
        const rarArgs = [
            'a',                    // Add to archive
            '-m5',                  // Maximum compression
            '-ma5',                 // RAR5 format
            '-ep1',                 // Exclude base folder
            '-y',                   // Yes to all
            backupPath,
            './filestash.db',
            './filestash.db-shm',
            './filestash.db-wal'
        ];
        
        console.log(`📦 Creating RAR archive: ${backupName}.rar`);
        console.log(`   Command: "${winrarPath}" ${rarArgs.join(' ')}`);
        
        const { spawn } = require('child_process');
        const rarProcess = spawn(winrarPath, rarArgs);
        
        let output = '';
        let errorOutput = '';
        
        rarProcess.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        rarProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        await new Promise((resolve, reject) => {
            rarProcess.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`WinRAR exited with code ${code}: ${errorOutput}`));
                }
            });
            
            rarProcess.on('error', (err) => {
                reject(err);
            });
        });
        
        // Get archive size
        const archiveStats = fs.statSync(backupPath);
        const archiveSize = archiveStats.size;
        const compressionRatio = ((1 - archiveSize / dbSize) * 100).toFixed(1);
        
        console.log(`✅ Backup completed:`);
        console.log(`   Archive: ${backupName}.rar`);
        console.log(`   Original size: ${(dbSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   Archive size: ${(archiveSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   Compression: ${compressionRatio}%`);
        console.log(`   Records: ${recordCount}`);
        
        res.json({ 
            message: 'Резервная копия создана успешно',
            filename: `${backupName}.rar`,
            path: backupPath,
            records: recordCount,
            originalSize: dbSize,
            archiveSize: archiveSize,
            compressionRatio: parseFloat(compressionRatio)
        });
        
    } catch (error) {
        console.error('❌ Backup failed:', error);
        
        // Ensure database is reopened even if backup fails
        if (!db || !db.open) {
            const sqlite3 = require('sqlite3').verbose();
            db = new sqlite3.Database('./filestash.db', sqlite3.OPEN_READWRITE);
        }
        
        res.status(500).json({ error: error.message });
    }
});

// Delete backup
app.post('/api/backups/delete', async (req, res) => {
    try {
        const { filename } = req.body;
        
        if (!filename || !filename.endsWith('.rar')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        
        const backupPath = path.join('./backups', filename);
        
        // Security check - ensure file is in backups directory
        if (!backupPath.startsWith('./backups')) {
            return res.status(400).json({ error: 'Invalid path' });
        }
        
        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ error: 'Backup not found' });
        }
        
        fs.unlinkSync(backupPath);
        console.log(`🗑️ Deleted backup: ${filename}`);
        
        res.json({ message: 'Backup deleted successfully' });
        
    } catch (error) {
        console.error('❌ Failed to delete backup:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get list of available backups
app.get('/api/backups/list', async (req, res) => {
    try {
        const backupsDir = './backups';
        
        // Ensure backups directory exists
        if (!fs.existsSync(backupsDir)) {
            return res.json({ backups: [] });
        }
        
        // Read all RAR files in backups directory
        const files = fs.readdirSync(backupsDir)
            .filter(file => file.endsWith('.rar'))
            .map(file => {
                const filePath = path.join(backupsDir, file);
                const stats = fs.statSync(filePath);
                
                // Parse date from filename: filestash_database_backup(DD.MM.YYYY.HH-MM).rar
                const dateMatch = file.match(/\((\d{2})\.(\d{2})\.(\d{4})\.(\d{2})-(\d{2})\)/);
                let createdDate = stats.mtime;
                
                if (dateMatch) {
                    const [, day, month, year, hour, minute] = dateMatch;
                    createdDate = new Date(year, month - 1, day, hour, minute);
                }
                
                return {
                    filename: file,
                    path: filePath,
                    size: stats.size,
                    created: createdDate.toISOString(),
                    createdFormatted: createdDate.toLocaleString('ru-RU')
                };
            })
            .sort((a, b) => new Date(b.created) - new Date(a.created)); // Newest first
        
        res.json({ backups: files });
        
    } catch (error) {
        console.error('❌ Failed to list backups:', error);
        res.status(500).json({ error: error.message });
    }
});

// Restore database from RAR backup
app.post('/api/restore', async (req, res) => {
    const { backupFile } = req.body;
    
    if (!backupFile) {
        return res.status(400).json({ error: 'Backup file path is required' });
    }
    
    // Validate mode (replace or merge)
    const restoreMode = mode || 'replace';
    if (!['replace', 'merge'].includes(restoreMode)) {
        return res.status(400).json({ error: 'Mode must be either "replace" or "merge"' });
    }
    
    try {
        // Check if backup file exists
        if (!fs.existsSync(backupFile)) {
            return res.status(404).json({ error: 'Backup file not found' });
        }
        
        // Read and parse backup file
        const backupData = fs.readFileSync(backupFile, 'utf8');
        let records;
        
        try {
            records = JSON.parse(backupData);
        } catch (parseError) {
            return res.status(400).json({ error: 'Invalid backup file format' });
        }
        
        // Validate backup data structure
        if (!Array.isArray(records)) {
            return res.status(400).json({ error: 'Backup file must contain an array of records' });
        }
        
        // Validate each record has required fields
        const requiredFields = ['full_path', 'directory', 'filename'];
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            for (const field of requiredFields) {
                if (!record.hasOwnProperty(field)) {
                    return res.status(400).json({ 
                        error: `Record ${i} is missing required field: ${field}` 
                    });
                }
            }
        }
        
        console.log(`🔄 Starting database restore from ${backupFile}`);
        console.log(`📊 Restore mode: ${restoreMode}`);
        console.log(`📄 Records to restore: ${records.length}`);
        
        // Perform restore operation
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            
            let restoredCount = 0;
            let skippedCount = 0;
            let errorCount = 0;
            
            // If replace mode, clear existing data first
            if (restoreMode === 'replace') {
                db.run('DELETE FROM files', function(deleteErr) {
                    if (deleteErr) {
                        console.error('❌ Error clearing database:', deleteErr);
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: 'Failed to clear database' });
                    }
                    console.log(`🗑️ Cleared ${this.changes} existing records`);
                });
            }
            
            // Prepare insert statement
            const insertStmt = db.prepare(`INSERT OR ${restoreMode === 'merge' ? 'IGNORE' : 'REPLACE'} INTO files 
                (full_path, directory, filename, extension, size, created_time, modified_time, is_directory, attributes, crc32)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            
            // Insert each record
            records.forEach((record, index) => {
                try {
                    insertStmt.run([
                        record.full_path,
                        record.directory,
                        record.filename,
                        record.extension || '',
                        record.size || 0,
                        record.created_time || new Date().toISOString(),
                        record.modified_time || new Date().toISOString(),
                        record.is_directory || 0,
                        record.attributes || '',
                        record.crc32 || null
                    ], function(insertErr) {
                        if (insertErr) {
                            if (restoreMode === 'merge' && insertErr.code === 'SQLITE_CONSTRAINT') {
                                // In merge mode, duplicates are expected and ignored
                                skippedCount++;
                            } else {
                                console.error(`❌ Error inserting record ${index}:`, insertErr);
                                errorCount++;
                            }
                        } else {
                            restoredCount++;
                        }
                        
                        // Check if this is the last record
                        if (index === records.length - 1) {
                            insertStmt.finalize();
                            
                            if (errorCount > 0 && restoreMode === 'replace') {
                                console.error(`❌ Restore failed with ${errorCount} errors`);
                                db.run('ROLLBACK');
                                return res.status(500).json({ 
                                    error: `Restore failed with ${errorCount} errors` 
                                });
                            } else {
                                db.run('COMMIT', (commitErr) => {
                                    if (commitErr) {
                                        console.error('❌ Commit failed:', commitErr);
                                        return res.status(500).json({ error: 'Failed to commit restore' });
                                    }
                                    
                                    console.log(`✅ Database restore completed successfully`);
                                    console.log(`📊 Restored: ${restoredCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`);
                                    
                                    // Invalidate cache after restore
                                    invalidateDatabaseCaches().then(() => {
                                        res.json({
                                            message: 'Database restored successfully',
                                            mode: restoreMode,
                                            backupFile: backupFile,
                                            totalRecords: records.length,
                                            restoredCount: restoredCount,
                                            skippedCount: skippedCount,
                                            errorCount: errorCount
                                        });
                                    });
                                });
                            }
                        }
                    });
                } catch (recordError) {
                    console.error(`❌ Error processing record ${index}:`, recordError);
                    errorCount++;
                }
            });
        });
        
    } catch (error) {
        console.error('❌ Restore operation failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Helper function to validate and suggest safe destination paths
function validateDestinationPath(destPath) {
    const normalizedPath = path.normalize(destPath);
    
    // Check if trying to write to root of drive (like C:\ or E:\)
    const isDriveRoot = /^[A-Z]:\\?$/i.test(normalizedPath);
    if (isDriveRoot) {
        return {
            valid: false,
            error: 'Cannot write to drive root. Access denied.',
            suggestions: [
                `${normalizedPath}FileStash-Copy`,
                `${normalizedPath}Users\\${process.env.USERNAME || 'User'}\\Desktop\\FileStash-Copy`,
                `${normalizedPath}Temp\\FileStash-Copy`
            ]
        };
    }
    
    // Check for other restricted paths
    const restrictedPaths = [
        /^[A-Z]:\\Windows/i,
        /^[A-Z]:\\Program Files/i,
        /^[A-Z]:\\System Volume Information/i
    ];
    
    for (const pattern of restrictedPaths) {
        if (pattern.test(normalizedPath)) {
            return {
                valid: false,
                error: 'Cannot write to system directory. Access denied.',
                suggestions: [
                    `C:\\Users\\${process.env.USERNAME || 'User'}\\Desktop\\FileStash-Copy`,
                    `C:\\Temp\\FileStash-Copy`,
                    `${normalizedPath.split('\\')[0]}\\FileStash-Copy`
                ]
            };
        }
    }
    
    return { valid: true };
}

// Copy files
app.post('/api/files/copy', async (req, res) => {
    console.log('Copy request received:', req.body);
    
    const { fileIds, destinationPath } = req.body;
    
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
        console.log('Invalid fileIds:', fileIds);
        return res.status(400).json({ error: 'File IDs are required' });
    }
    
    if (!destinationPath) {
        console.log('Missing destination path');
        return res.status(400).json({ error: 'Destination path is required' });
    }
    
    // Validate destination path
    const validation = validateDestinationPath(destinationPath);
    if (!validation.valid) {
        console.log('Invalid destination path:', destinationPath, validation.error);
        return res.status(400).json({ 
            error: validation.error,
            suggestions: validation.suggestions,
            code: 'INVALID_DESTINATION'
        });
    }
    
    console.log(`Copying ${fileIds.length} files to: ${destinationPath}`);
    
    try {
        // Ensure destination directory exists
        await fse.ensureDir(destinationPath);
        console.log('Destination directory ensured:', destinationPath);
        
        const results = [];
        
        for (const fileId of fileIds) {
            console.log(`Processing file ID: ${fileId}`);
            
            const file = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM files WHERE id = ?', [fileId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            
            if (!file) {
                console.log(`File not found in database: ${fileId}`);
                results.push({ id: fileId, status: 'error', error: 'File not found in database' });
                continue;
            }
            
            console.log(`Found file: ${file.full_path}`);
            
            if (!fs.existsSync(file.full_path)) {
                console.log(`File does not exist on disk: ${file.full_path}`);
                results.push({ id: fileId, status: 'error', error: 'File does not exist on disk' });
                continue;
            }
            
            const destPath = path.join(destinationPath, file.filename);
            console.log(`Copying to: ${destPath}`);
            
            try {
                if (file.is_directory) {
                    await fse.copy(file.full_path, destPath, { overwrite: true });
                } else {
                    await fse.copy(file.full_path, destPath, { overwrite: true });
                }
                console.log(`Successfully copied: ${file.filename}`);
                results.push({ id: fileId, status: 'success', path: destPath, filename: file.filename });
            } catch (error) {
                console.log(`Error copying ${file.filename}:`, error.message);
                results.push({ id: fileId, status: 'error', error: error.message, filename: file.filename });
            }
        }
        
        console.log('Copy operation completed, results:', results);
        res.json({ message: 'Copy operation completed', results });
    } catch (error) {
        console.error('Copy operation failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Move files
app.post('/api/files/move', async (req, res) => {
    console.log('Move request received:', req.body);
    
    const { fileIds, destinationPath } = req.body;
    
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
        console.log('Invalid fileIds:', fileIds);
        return res.status(400).json({ error: 'File IDs are required' });
    }
    
    if (!destinationPath) {
        console.log('Missing destination path');
        return res.status(400).json({ error: 'Destination path is required' });
    }
    
    // Validate destination path
    const validation = validateDestinationPath(destinationPath);
    if (!validation.valid) {
        console.log('Invalid destination path:', destinationPath, validation.error);
        return res.status(400).json({ 
            error: validation.error,
            suggestions: validation.suggestions,
            code: 'INVALID_DESTINATION'
        });
    }
    
    console.log(`Moving ${fileIds.length} files to: ${destinationPath}`);
    
    try {
        // Ensure destination directory exists
        await fse.ensureDir(destinationPath);
        console.log('Destination directory ensured:', destinationPath);
        
        const results = [];
        
        for (const fileId of fileIds) {
            console.log(`Processing file ID: ${fileId}`);
            
            const file = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM files WHERE id = ?', [fileId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            
            if (!file) {
                console.log(`File not found in database: ${fileId}`);
                results.push({ id: fileId, status: 'error', error: 'File not found in database' });
                continue;
            }
            
            console.log(`Found file: ${file.full_path}`);
            
            if (!fs.existsSync(file.full_path)) {
                console.log(`File does not exist on disk: ${file.full_path}`);
                results.push({ id: fileId, status: 'error', error: 'File does not exist on disk' });
                continue;
            }
            
            const destPath = path.join(destinationPath, file.filename);
            console.log(`Moving to: ${destPath}`);
            
            try {
                await fse.move(file.full_path, destPath, { overwrite: true });
                
                // Update database record
                await new Promise((resolve, reject) => {
                    db.run('UPDATE files SET full_path = ?, directory = ? WHERE id = ?', 
                        [destPath, destinationPath, fileId], function(err) {
                            if (err) reject(err);
                            else resolve();
                        });
                });
                
                console.log(`Successfully moved: ${file.filename}`);
                results.push({ id: fileId, status: 'success', path: destPath, filename: file.filename });
            } catch (error) {
                console.log(`Error moving ${file.filename}:`, error.message);
                results.push({ id: fileId, status: 'error', error: error.message, filename: file.filename });
            }
        }
        
        // Invalidate caches after move operation (database was updated)
        // Use selective invalidation for moved files
        const movedPaths = results
            .filter(r => r.status === 'success' && r.path)
            .map(r => r.path);
        
        if (movedPaths.length > 0 && USE_OPTIMIZED_CACHE) {
            await invalidateDatabaseCaches(db, queryCache, optimizedCache, dbCache{ paths: movedPaths, fullReload: false });
        } else {
            await invalidateDatabaseCaches(db, queryCache, optimizedCache, dbCache);
        }
        
        console.log('Move operation completed, results:', results);
        res.json({ message: 'Move operation completed', results });
    } catch (error) {
        console.error('Move operation failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete files (actual files, not just records)
app.post('/api/files/delete', async (req, res) => {
    const { fileIds } = req.body;
    
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
        return res.status(400).json({ error: 'File IDs are required' });
    }
    
    try {
        const results = [];
        
        for (const fileId of fileIds) {
            const file = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM files WHERE id = ?', [fileId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            
            if (file && fs.existsSync(file.full_path)) {
                try {
                    if (file.is_directory) {
                        await fse.remove(file.full_path);
                    } else {
                        await fse.remove(file.full_path);
                    }
                    
                    // Remove from database
                    db.run('DELETE FROM files WHERE id = ?', [fileId]);
                    
                    results.push({ id: fileId, status: 'success' });
                } catch (error) {
                    results.push({ id: fileId, status: 'error', error: error.message });
                }
            } else {
                // Remove from database even if file doesn't exist
                db.run('DELETE FROM files WHERE id = ?', [fileId]);
                results.push({ id: fileId, status: 'success', note: 'File not found, removed from database' });
            }
        }
        
        // Use full reload for delete operations since we need to rebuild indexes
        await invalidateDatabaseCaches(db, queryCache, optimizedCache, dbCache);
        res.json({ message: 'Delete operation completed', results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Enhanced delete files (removes from both disk and database)
app.post('/api/files/delete-enhanced', async (req, res) => {
    const { fileIds } = req.body;
    
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
        return res.status(400).json({ error: 'File IDs are required' });
    }
    
    try {
        const results = [];
        
        for (const fileId of fileIds) {
            const file = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM files WHERE id = ?', [fileId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            
            if (file) {
                try {
                    // Delete from disk if exists
                    if (fs.existsSync(file.full_path)) {
                        if (file.is_directory) {
                            await fse.remove(file.full_path);
                            console.log(`Deleted directory from disk: ${file.full_path}`);
                        } else {
                            await fse.remove(file.full_path);
                            console.log(`Deleted file from disk: ${file.full_path}`);
                        }
                    }
                    
                    // Delete from database
                    await new Promise((resolve, reject) => {
                        if (file.is_directory) {
                            // Delete all files in this directory from database
                            db.run('DELETE FROM files WHERE full_path LIKE ?', [`${file.full_path}%`], function(err) {
                                if (err) reject(err);
                                else {
                                    console.log(`Deleted ${this.changes} records from database for directory: ${file.full_path}`);
                                    resolve();
                                }
                            });
                        } else {
                            // Delete single file from database
                            db.run('DELETE FROM files WHERE id = ?', [fileId], function(err) {
                                if (err) reject(err);
                                else {
                                    console.log(`Deleted file record from database: ${file.full_path}`);
                                    resolve();
                                }
                            });
                        }
                    });
                    
                    results.push({ 
                        id: fileId, 
                        status: 'success', 
                        path: file.full_path,
                        type: file.is_directory ? 'directory' : 'file'
                    });
                    
                } catch (error) {
                    console.error(`Error deleting ${file.full_path}:`, error);
                    results.push({ 
                        id: fileId, 
                        status: 'error', 
                        error: error.message,
                        path: file.full_path
                    });
                }
            } else {
                results.push({ 
                    id: fileId, 
                    status: 'error', 
                    error: 'File not found in database'
                });
            }
        }
        
        // Use selective invalidation for deleted directories
        const deletedDirs = results
            .filter(r => r.status === 'success' && r.type === 'directory' && r.path)
            .map(r => r.path);
        
        const deletedFiles = results
            .filter(r => r.status === 'success' && r.type === 'file' && r.path)
            .map(r => r.path);
        
        if ((deletedDirs.length > 0 || deletedFiles.length > 0) && USE_OPTIMIZED_CACHE) {
            await invalidateDatabaseCaches(db, queryCache, optimizedCache, dbCache{ 
                directories: deletedDirs, 
                paths: deletedFiles, 
                fullReload: false 
            });
        } else {
            await invalidateDatabaseCaches(db, queryCache, optimizedCache, dbCache);
        }
        
        res.json({ message: 'Enhanced delete operation completed', results });
        
    } catch (error) {
        console.error('Enhanced delete operation failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Remove files from database only (for moved files)
app.post('/api/files/remove-from-database', async (req, res) => {
    const { fileIds } = req.body;
    
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
        return res.status(400).json({ error: 'File IDs are required' });
    }
    
    try {
        console.log('Removing files from database:', fileIds);
        
        // Get file paths before deletion for selective invalidation
        const selectPlaceholders = fileIds.map(() => '?').join(',');
        const selectQuery = `SELECT full_path, is_directory FROM files WHERE id IN (${selectPlaceholders})`;
        
        const filesToRemove = await new Promise((resolve, reject) => {
            db.all(selectQuery, fileIds, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        // Remove files from database
        const deletePlaceholders = fileIds.map(() => '?').join(',');
        const deleteQuery = `DELETE FROM files WHERE id IN (${deletePlaceholders})`;
        
        await new Promise((resolve, reject) => {
            db.run(deleteQuery, fileIds, function(err) {
                if (err) {
                    reject(err);
                } else {
                    console.log(`Removed ${this.changes} files from database`);
                    resolve();
                }
            });
        });
        
        // Use selective invalidation for removed files
        const removedDirs = filesToRemove
            .filter(f => f.is_directory === 1)
            .map(f => f.full_path);
        
        const removedFiles = filesToRemove
            .filter(f => f.is_directory === 0)
            .map(f => f.full_path);
        
        if ((removedDirs.length > 0 || removedFiles.length > 0) && USE_OPTIMIZED_CACHE) {
            await invalidateDatabaseCaches(db, queryCache, optimizedCache, dbCache{ 
                directories: removedDirs, 
                paths: removedFiles, 
                fullReload: false 
            });
        } else {
            await invalidateDatabaseCaches(db, queryCache, optimizedCache, dbCache);
        }
        
        res.json({ 
            message: 'Files removed from database successfully',
            removedCount: fileIds.length
        });
        
    } catch (error) {
        console.error('Remove from database operation failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Stop integrity check operation
app.post('/api/files/integrity-check/stop/:checkId', (req, res) => {
    const { checkId } = req.params;
    const progress = integrityProgress.get(checkId);
    
    if (!progress) {
        return res.status(404).json({ error: 'Integrity check not found' });
    }
    
    if (progress.status !== 'running') {
        return res.status(400).json({ 
            error: 'Integrity check is not active', 
            currentStatus: progress.status 
        });
    }
    
    // Request cancellation
    progress.cancellationRequested = true;
    console.log(`🛑 Cancellation requested for integrity check ${checkId}`);
    
    res.json({ 
        message: 'Integrity check cancellation requested',
        checkId: checkId,
        status: 'cancellation_requested'
    });
});

// Clean up database - remove records for files that no longer exist on disk
app.post('/api/files/cleanup-database', async (req, res) => {
    try {
        console.log('Starting database cleanup...');
        
        // Get all files from database
        const allFiles = await new Promise((resolve, reject) => {
            db.all('SELECT id, full_path FROM files', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        console.log(`Checking ${allFiles.length} files...`);
        
        const filesToRemove = [];
        let checkedCount = 0;
        
        // Check each file if it exists on disk
        for (const file of allFiles) {
            checkedCount++;
            if (checkedCount % 100 === 0) {
                console.log(`Checked ${checkedCount}/${allFiles.length} files...`);
            }
            
            try {
                if (!fs.existsSync(file.full_path)) {
                    filesToRemove.push(file.id);
                }
            } catch (error) {
                // If we can't check the file, assume it doesn't exist
                filesToRemove.push(file.id);
            }
        }
        
        console.log(`Found ${filesToRemove.length} files to remove from database`);
        
        if (filesToRemove.length > 0) {
            // Remove non-existent files from database
            const placeholders = filesToRemove.map(() => '?').join(',');
            const deleteQuery = `DELETE FROM files WHERE id IN (${placeholders})`;
            
            await new Promise((resolve, reject) => {
                db.run(deleteQuery, filesToRemove, function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        console.log(`Removed ${this.changes} files from database`);
                        resolve();
                    }
                });
            });
        }
        
        // If files were removed, vacuum the database to reclaim space
        if (filesToRemove.length > 0) {
            console.log('🗜️ Compacting database file...');
            await new Promise((resolve, reject) => {
                db.run('VACUUM', function(err) {
                    if (err) {
                        console.error('❌ VACUUM failed:', err.message);
                        reject(err);
                    } else {
                        console.log('✅ Database file compacted');
                        resolve();
                    }
                });
            });
        }
        
        // Use full reload for cleanup operations since many files may be affected
        if (filesToRemove.length > 0) {
            await invalidateDatabaseCaches(db, queryCache, optimizedCache, dbCache);
        }
        
        res.json({ 
            message: `Database cleanup completed${filesToRemove.length > 0 ? ' and compacted' : ''}`,
            totalFiles: allFiles.length,
            removedFiles: filesToRemove.length,
            remainingFiles: allFiles.length - filesToRemove.length
        });
        
    } catch (error) {
        console.error('Database cleanup failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Global integrity check progress tracking
const integrityProgress = new Map();

// File integrity check
app.post('/api/files/integrity-check', async (req, res) => {
    const { path: checkPath, checkCRC32, checkExistence, threads } = req.body;
    
    if (!checkPath) {
        return res.status(400).json({ error: 'Path is required for integrity check' });
    }
    
    const checkId = Date.now().toString();
    
    try {
        console.log(`Starting integrity check for: ${checkPath}`);
        console.log(`Original path length: ${checkPath.length}`);
        console.log(`Path characters: ${JSON.stringify(checkPath.split(''))}`);
        console.log(`Check CRC32: ${checkCRC32}, Check Existence: ${checkExistence}`);
        
        // Get files from database for the specified path
        let sqlQuery, sqlParams;
        
        // Normalize path: convert forward slashes to backslashes, remove double backslashes
        let normalizedPath = checkPath.replace(/\//g, '\\').replace(/\\\\/g, '\\');
        
        console.log(`Looking for path: ${normalizedPath}`);
        
        // First, check if this exact path exists in database
        const exactMatch = await new Promise((resolve, reject) => {
            db.get('SELECT id, full_path, filename, crc32, size, is_directory FROM files WHERE full_path = ?', 
                [normalizedPath], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (exactMatch) {
            console.log(`✅ Found exact match: ${exactMatch.full_path}`);
            
            if (exactMatch.is_directory) {
                // It's a directory - get all files inside it
                console.log(`📁 Checking directory and its contents`);
                sqlQuery = `SELECT id, full_path, filename, crc32, size, is_directory FROM files 
                           WHERE full_path = ? OR full_path LIKE ? 
                           ORDER BY full_path`;
                sqlParams = [normalizedPath, `${normalizedPath}\\%`];
            } else {
                // It's a file - check only this file
                console.log(`📄 Checking single file`);
                sqlQuery = 'SELECT id, full_path, filename, crc32, size, is_directory FROM files WHERE full_path = ?';
                sqlParams = [normalizedPath];
            }
        } else {
            // No exact match - try to find files in this directory
            console.log(`⚠️ No exact match, searching for files in directory`);
            sqlQuery = `SELECT id, full_path, filename, crc32, size, is_directory FROM files 
                       WHERE full_path LIKE ? 
                       ORDER BY full_path`;
            sqlParams = [`${normalizedPath}\\%`];
        }
        
        console.log(`🔍 Executing SQL query for path: ${checkPath}`);
        console.log(`📝 Normalized params: ${JSON.stringify(sqlParams)}`);
        console.log(`📝 SQL: ${sqlQuery}`);
        
        const files = await new Promise((resolve, reject) => {
            db.all(sqlQuery, sqlParams, (err, rows) => {
                if (err) {
                    console.error(`❌ SQL Error: ${err.message}`);
                    reject(err);
                } else {
                    console.log(`✅ Found ${rows.length} files in database`);
                    resolve(rows);
                }
            });
        });
        
        if (files.length === 0) {
            return res.json({
                message: 'No files found in database for the specified path',
                totalFiles: 0,
                results: {
                    missingFiles: [],
                    crcMismatches: [],
                    checkedFiles: 0
                }
            });
        }
        
        console.log(`Found ${files.length} files in database for integrity check`);
        
        // Parse thread count first
        const threadCount = parseInt(threads) || 4;
        
        // Initialize progress tracking
        integrityProgress.set(checkId, {
            total: files.length,
            processed: 0,
            status: 'running',
            startTime: Date.now(),
            checkPath: checkPath,
            checkCRC32: checkCRC32,
            checkExistence: checkExistence,
            threadCount: threadCount,
            cancellationRequested: false,
            cancelled: false
        });
        
        const results = {
            missingFiles: [],
            crcMismatches: [],
            checkedFiles: 0
        };
        
        // Start integrity check asynchronously
        performIntegrityCheckAsync(checkId, files, checkCRC32, checkExistence, checkPath, threadCount);
        
        // Return immediately with check ID
        res.json({
            checkId: checkId,
            message: 'Integrity check started',
            totalFiles: files.length
        });
        
    } catch (error) {
        console.error('Integrity check failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Async integrity check function
async function performIntegrityCheckAsync(checkId, files, checkCRC32, checkExistence, checkPath, threadCount = 4) {
    const progress = integrityProgress.get(checkId);
    
    if (!progress) {
        console.error(`❌ Progress not found for checkId: ${checkId}`);
        return;
    }
    
    console.log(`🔍 Starting integrity check async for ${files.length} files`);
    
    try {
        const results = {
            missingFiles: [],
            crcMismatches: [],
            checkedFiles: 0
        };
        
        // Create scan logs directory
        const scanLogsDir = './scan-logs';
        await fse.ensureDir(scanLogsDir);
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logFileName = `integrity-check-${timestamp}.log`;
        const logFilePath = path.join(scanLogsDir, logFileName);
        
        const logEntries = [];
        logEntries.push(`=== File Integrity Check Started ===`);
        logEntries.push(`Timestamp: ${new Date().toISOString()}`);
        logEntries.push(`Check Path: ${checkPath}`);
        logEntries.push(`Check CRC32: ${checkCRC32}`);
        logEntries.push(`Check Existence: ${checkExistence}`);
        logEntries.push(`Total Files in Database: ${files.length}`);
        logEntries.push(`==========================================\n`);
        
        // Multi-threaded integrity check
        console.log(`⚡ Processing ${files.length} files with ${threadCount} threads...`);
        
        // Create chunks for parallel processing
        const chunkSize = Math.ceil(files.length / threadCount);
        const chunks = [];
        
        for (let i = 0; i < files.length; i += chunkSize) {
            chunks.push(files.slice(i, i + chunkSize));
        }
        
        console.log(`📊 Created ${chunks.length} chunks for parallel processing`);
        
        // Process chunks in parallel
        const chunkPromises = chunks.map(async (chunk, chunkIndex) => {
            const chunkResults = {
                missingFiles: [],
                crcMismatches: [],
                checkedFiles: 0,
                logEntries: []
            };
            
            for (const file of chunk) {
                // Check for cancellation
                if (progress.cancellationRequested) {
                    console.log(`🛑 Chunk ${chunkIndex} stopping due to cancellation request`);
                    break;
                }
                
                let fileExists = false;
                let isDirectory = false;
                
                // Check file existence first
                try {
                    if (fs.existsSync(file.full_path)) {
                        fileExists = true;
                        const stats = fs.statSync(file.full_path);
                        isDirectory = stats.isDirectory();
                        chunkResults.logEntries.push(`OK: ${file.full_path}`);
                    } else {
                        fileExists = false;
                    }
                } catch (error) {
                    fileExists = false;
                    chunkResults.logEntries.push(`ERROR accessing ${file.full_path}: ${error.message}`);
                }
                
                // Record missing files
                if (checkExistence && !fileExists) {
                    chunkResults.missingFiles.push({
                        id: file.id,
                        path: file.full_path,
                        filename: file.filename
                    });
                    chunkResults.logEntries.push(`❌ MISSING: ${file.full_path}`);
                    console.log(`❌ Missing file: ${file.full_path}`);
                }
                
                // Check CRC32 if file exists and is not a directory
                if (checkCRC32 && fileExists && !isDirectory) {
                    try {
                        console.log(`🔍 Checking CRC32 for: ${file.filename}`);
                        const currentCRC32 = calculateCRC32(file.full_path);
                        
                        if (file.crc32 && currentCRC32 && currentCRC32 !== file.crc32) {
                            chunkResults.crcMismatches.push({
                                id: file.id,
                                path: file.full_path,
                                filename: file.filename,
                                originalCRC32: file.crc32,
                                currentCRC32: currentCRC32,
                                size: file.size
                            });
                            chunkResults.logEntries.push(`⚠️ CRC MISMATCH: ${file.full_path}`);
                            chunkResults.logEntries.push(`  Original CRC32: ${file.crc32}`);
                            chunkResults.logEntries.push(`  Current CRC32:  ${currentCRC32}`);
                            console.log(`⚠️ CRC mismatch: ${file.filename} (${file.crc32} → ${currentCRC32})`);
                        } else if (currentCRC32) {
                            chunkResults.logEntries.push(`✅ CRC OK: ${file.full_path} (${currentCRC32})`);
                            console.log(`✅ CRC OK: ${file.filename}`);
                        } else {
                            chunkResults.logEntries.push(`❌ ERROR: Could not calculate CRC32 for ${file.full_path}`);
                            console.log(`❌ Could not calculate CRC32 for: ${file.filename}`);
                        }
                    } catch (error) {
                        chunkResults.logEntries.push(`❌ ERROR checking CRC32 for ${file.full_path}: ${error.message}`);
                        console.error(`Error checking CRC32 for ${file.full_path}:`, error);
                    }
                }
                
                chunkResults.checkedFiles++;
                
                // Update global progress
                progress.processed++;
                
                // Log progress
                const progressPercent = Math.round((progress.processed / files.length) * 100);
                if (progress.processed % 50 === 0 || progress.processed === files.length) {
                    console.log(`🔍 Integrity check progress: ${progressPercent}% (${progress.processed}/${files.length})`);
                }
            }
            
            return chunkResults;
        });
        
        // Wait for all chunks to complete
        const chunkResults = await Promise.all(chunkPromises);
        
        // Merge results from all chunks
        for (const chunkResult of chunkResults) {
            results.missingFiles.push(...chunkResult.missingFiles);
            results.crcMismatches.push(...chunkResult.crcMismatches);
            results.checkedFiles += chunkResult.checkedFiles;
            logEntries.push(...chunkResult.logEntries);
        }
        
        // Additional check for renamed files (files with same CRC32 but different names)
        const renamedFiles = [];
        if (checkCRC32 && results.missingFiles.length > 0) {
            console.log('🔍 Checking for renamed files...');
            logEntries.push(`\n=== Checking for Renamed Files ===`);
            
            // Get all missing files that have CRC32
            const missingWithCRC = results.missingFiles.filter(f => {
                const dbFile = files.find(dbF => dbF.id === f.id);
                return dbFile && dbFile.crc32;
            });
            
            for (const missingFile of missingWithCRC) {
                const dbFile = files.find(f => f.id === missingFile.id);
                if (!dbFile || !dbFile.crc32) continue;
                
                // Look for files in the same directory with the same CRC32
                const dirPath = path.dirname(missingFile.path);
                try {
                    if (fs.existsSync(dirPath)) {
                        const dirFiles = fs.readdirSync(dirPath);
                        for (const dirFile of dirFiles) {
                            const fullPath = path.join(dirPath, dirFile);
                            try {
                                const stats = fs.statSync(fullPath);
                                if (!stats.isDirectory() && stats.size === dbFile.size) {
                                    const currentCRC32 = calculateCRC32(fullPath); // Remove await
                                    if (currentCRC32 && currentCRC32 === dbFile.crc32) {
                                        renamedFiles.push({
                                            originalPath: missingFile.path,
                                            newPath: fullPath,
                                            originalName: missingFile.filename,
                                            newName: dirFile,
                                            crc32: currentCRC32,
                                            size: dbFile.size
                                        });
                                        logEntries.push(`🔄 RENAMED: ${missingFile.path} → ${fullPath}`);
                                        console.log(`🔄 Found renamed file: ${missingFile.filename} → ${dirFile}`);
                                        break;
                                    }
                                }
                            } catch (error) {
                                // Skip files we can't access
                            }
                        }
                    }
                } catch (error) {
                    logEntries.push(`❌ ERROR checking directory ${dirPath}: ${error.message}`);
                }
            }
        }
        
        // Write summary to log
        logEntries.push(`\n=== Integrity Check Summary ===`);
        logEntries.push(`Files Checked: ${results.checkedFiles}`);
        logEntries.push(`Missing Files: ${results.missingFiles.length}`);
        logEntries.push(`CRC Mismatches: ${results.crcMismatches.length}`);
        logEntries.push(`Renamed Files: ${renamedFiles.length}`);
        logEntries.push(`Completed: ${new Date().toISOString()}`);
        logEntries.push(`================================`);
        
        // Add renamed files to results
        results.renamedFiles = renamedFiles;
        
        // Save log file
        await fse.writeFile(logFilePath, logEntries.join('\n'));
        
        console.log(`Integrity check completed. Log saved to: ${logFilePath}`);
        
        // Update progress to completed
        progress.status = 'completed';
        progress.endTime = Date.now();
        progress.results = results;
        progress.logFile = logFilePath;
        
    } catch (error) {
        console.error('Integrity check failed:', error);
        progress.status = 'error';
        progress.error = error.message;
        progress.endTime = Date.now();
    }
}

// Get integrity check progress
app.get('/api/files/integrity-check/progress/:checkId', (req, res) => {
    const { checkId } = req.params;
    const progress = integrityProgress.get(checkId);
    
    if (!progress) {
        return res.status(404).json({ error: 'Integrity check not found' });
    }
    
    res.json(progress);
});

// Non-destructive database integrity check
app.post('/api/database/integrity-check', async (req, res) => {
    console.log('🔍 Starting non-destructive database integrity check...');
    
    const checkId = Date.now().toString();
    
    try {
        // Get all files from database
        const files = await new Promise((resolve, reject) => {
            db.all('SELECT id, full_path, filename, is_directory FROM files ORDER BY full_path', (err, rows) => {
                if (err) {
                    console.error('❌ Database query error:', err.message);
                    reject(err);
                } else {
                    console.log(`✅ Found ${rows.length} records in database`);
                    resolve(rows);
                }
            });
        });
        
        if (files.length === 0) {
            return res.json({
                message: 'Database is empty',
                totalChecked: 0,
                missingCount: 0,
                reportFile: null,
                missingFiles: []
            });
        }
        
        // Initialize progress tracking
        integrityProgress.set(checkId, {
            total: files.length,
            processed: 0,
            status: 'running',
            startTime: Date.now(),
            checkType: 'database-integrity',
            cancellationRequested: false,
            cancelled: false
        });
        
        // Start integrity check asynchronously
        performDatabaseIntegrityCheckAsync(checkId, files);
        
        // Return immediately with check ID
        res.json({
            checkId: checkId,
            message: 'Database integrity check started',
            totalFiles: files.length
        });
        
    } catch (error) {
        console.error('❌ Database integrity check failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Helper function to calculate string similarity (0-1 scale)
function calculateStringSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) {
        return 1.0;
    }
    
    // Calculate Levenshtein distance
    const editDistance = levenshteinDistance(longer.toLowerCase(), shorter.toLowerCase());
    return (longer.length - editDistance) / longer.length;
}

// Levenshtein distance algorithm
function levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }
    
    return matrix[str2.length][str1.length];
}

// Async database integrity check function
async function performDatabaseIntegrityCheckAsync(checkId, files) {
    const progress = integrityProgress.get(checkId);
    
    if (!progress) {
        console.error(`❌ Progress not found for checkId: ${checkId}`);
        return;
    }
    
    console.log(`🔍 Starting database integrity check for ${files.length} records`);
    
    try {
        const missingFiles = [];
        const renamedFiles = [];
        let checkedCount = 0;
        
        // Build CRC32 index for non-missing files (for renamed detection)
        const crc32Index = new Map();
        
        // Check each file/directory existence
        for (const file of files) {
            // Check for cancellation
            if (progress.cancellationRequested) {
                console.log(`🛑 Database integrity check cancelled at ${checkedCount}/${files.length}`);
                progress.status = 'cancelled';
                progress.cancelled = true;
                progress.endTime = Date.now();
                return;
            }
            
            try {
                const exists = fs.existsSync(file.full_path);
                
                if (!exists) {
                    // File doesn't exist at recorded path
                    // Check if it might be renamed (for files with CRC32)
                    if (file.crc32 && file.is_directory === 0) {
                        // Look for files with same CRC32 in parent directory
                        const parentDir = path.dirname(file.full_path);
                        
                        try {
                            if (fs.existsSync(parentDir)) {
                                const filesInDir = fs.readdirSync(parentDir);
                                let foundRenamed = false;
                                
                                for (const filename of filesInDir) {
                                    const fullPath = path.join(parentDir, filename);
                                    
                                    try {
                                        const stats = fs.statSync(fullPath);
                                        
                                        // Only check files with similar size (±10%)
                                        if (stats.isFile() && 
                                            Math.abs(stats.size - file.size) / file.size < 0.1) {
                                            
                                            // Check if this file exists in database
                                            const existingFile = files.find(f => f.full_path === fullPath);
                                            
                                            if (!existingFile) {
                                                // Potential renamed file found
                                                renamedFiles.push({
                                                    id: file.id,
                                                    oldPath: file.full_path,
                                                    oldFilename: file.filename,
                                                    possibleNewPath: fullPath,
                                                    possibleNewFilename: filename,
                                                    size: file.size,
                                                    crc32: file.crc32,
                                                    isDirectory: false,
                                                    confidence: 'high' // Same parent dir, similar size
                                                });
                                                foundRenamed = true;
                                                console.log(`🔄 Possibly renamed: ${file.filename} → ${filename}`);
                                                break;
                                            }
                                        }
                                    } catch (err) {
                                        // Skip files we can't access
                                    }
                                }
                                
                                if (!foundRenamed) {
                                    // Not found in same directory, mark as missing
                                    missingFiles.push({
                                        id: file.id,
                                        path: file.full_path,
                                        filename: file.filename,
                                        isDirectory: file.is_directory === 1
                                    });
                                    console.log(`❌ Missing: ${file.full_path}`);
                                }
                            } else {
                                // Parent directory doesn't exist
                                missingFiles.push({
                                    id: file.id,
                                    path: file.full_path,
                                    filename: file.filename,
                                    isDirectory: file.is_directory === 1,
                                    reason: 'parent_directory_missing'
                                });
                                console.log(`❌ Missing (parent dir gone): ${file.full_path}`);
                            }
                        } catch (err) {
                            // Can't read directory
                            missingFiles.push({
                                id: file.id,
                                path: file.full_path,
                                filename: file.filename,
                                isDirectory: file.is_directory === 1,
                                error: err.message
                            });
                            console.log(`❌ Error checking ${file.full_path}: ${err.message}`);
                        }
                    } else if (file.is_directory === 1) {
                        // Directory - check for renamed directories
                        const parentDir = path.dirname(file.full_path);
                        
                        try {
                            if (fs.existsSync(parentDir)) {
                                const dirsInParent = fs.readdirSync(parentDir);
                                let foundRenamed = false;
                                
                                // Look for directories with similar names
                                for (const dirname of dirsInParent) {
                                    const fullPath = path.join(parentDir, dirname);
                                    
                                    try {
                                        const stats = fs.statSync(fullPath);
                                        
                                        if (stats.isDirectory()) {
                                            // Check if this directory exists in database
                                            const existingDir = files.find(f => f.full_path === fullPath);
                                            
                                            if (!existingDir) {
                                                // Calculate similarity (simple Levenshtein-like check)
                                                const similarity = calculateStringSimilarity(file.filename, dirname);
                                                
                                                if (similarity > 0.6) { // 60% similarity threshold
                                                    renamedFiles.push({
                                                        id: file.id,
                                                        oldPath: file.full_path,
                                                        oldFilename: file.filename,
                                                        possibleNewPath: fullPath,
                                                        possibleNewFilename: dirname,
                                                        isDirectory: true,
                                                        confidence: similarity > 0.8 ? 'high' : 'medium',
                                                        similarity: Math.round(similarity * 100)
                                                    });
                                                    foundRenamed = true;
                                                    console.log(`🔄 Possibly renamed directory: ${file.filename} → ${dirname} (${Math.round(similarity * 100)}% similar)`);
                                                    break;
                                                }
                                            }
                                        }
                                    } catch (err) {
                                        // Skip directories we can't access
                                    }
                                }
                                
                                if (!foundRenamed) {
                                    missingFiles.push({
                                        id: file.id,
                                        path: file.full_path,
                                        filename: file.filename,
                                        isDirectory: true
                                    });
                                    console.log(`❌ Missing directory: ${file.full_path}`);
                                }
                            } else {
                                missingFiles.push({
                                    id: file.id,
                                    path: file.full_path,
                                    filename: file.filename,
                                    isDirectory: true,
                                    reason: 'parent_directory_missing'
                                });
                                console.log(`❌ Missing directory (parent gone): ${file.full_path}`);
                            }
                        } catch (err) {
                            missingFiles.push({
                                id: file.id,
                                path: file.full_path,
                                filename: file.filename,
                                isDirectory: true,
                                error: err.message
                            });
                            console.log(`❌ Error checking directory ${file.full_path}: ${err.message}`);
                        }
                    } else {
                        // File without CRC32
                        missingFiles.push({
                            id: file.id,
                            path: file.full_path,
                            filename: file.filename,
                            isDirectory: false
                        });
                        console.log(`❌ Missing file: ${file.full_path}`);
                    }
                } else {
                    // File exists, add to CRC32 index if available
                    if (file.crc32) {
                        crc32Index.set(file.crc32, file.full_path);
                    }
                }
            } catch (error) {
                // If we can't check, assume it doesn't exist
                missingFiles.push({
                    id: file.id,
                    path: file.full_path,
                    filename: file.filename,
                    isDirectory: file.is_directory === 1,
                    error: error.message
                });
                console.log(`❌ Error checking ${file.full_path}: ${error.message}`);
            }
            
            checkedCount++;
            progress.processed = checkedCount;
            
            // Log progress every 100 files
            if (checkedCount % 100 === 0) {
                const progressPercent = Math.round((checkedCount / files.length) * 100);
                console.log(`🔍 Database integrity check progress: ${progressPercent}% (${checkedCount}/${files.length})`);
            }
        }
        
        // Generate comprehensive report
        const reportLines = [];
        
        reportLines.push('='.repeat(80));
        reportLines.push('DATABASE INTEGRITY CHECK REPORT');
        reportLines.push('='.repeat(80));
        reportLines.push(`Date: ${new Date().toISOString()}`);
        reportLines.push(`Total Checked: ${files.length}`);
        reportLines.push(`Missing: ${missingFiles.length}`);
        reportLines.push(`Possibly Renamed: ${renamedFiles.length}`);
        reportLines.push('='.repeat(80));
        reportLines.push('');
        
        if (renamedFiles.length > 0) {
            reportLines.push('POSSIBLY RENAMED FILES/DIRECTORIES:');
            reportLines.push('-'.repeat(80));
            renamedFiles.forEach(file => {
                const type = file.isDirectory ? '[DIR]' : '[FILE]';
                const confidence = file.confidence === 'high' ? '⭐⭐⭐' : '⭐⭐';
                reportLines.push(`${type} ${confidence} ${file.oldFilename}`);
                reportLines.push(`  Old: ${file.oldPath}`);
                reportLines.push(`  New: ${file.possibleNewPath}`);
                if (file.similarity) {
                    reportLines.push(`  Similarity: ${file.similarity}%`);
                }
                reportLines.push('');
            });
            reportLines.push('');
        }
        
        if (missingFiles.length > 0) {
            reportLines.push('MISSING FILES/DIRECTORIES:');
            reportLines.push('-'.repeat(80));
            missingFiles.forEach(file => {
                const prefix = file.isDirectory ? '[DIR]' : '[FILE]';
                reportLines.push(`${prefix} ${file.path}`);
                if (file.reason) {
                    reportLines.push(`  Reason: ${file.reason}`);
                }
                if (file.error) {
                    reportLines.push(`  Error: ${file.error}`);
                }
            });
        }
        
        const reportContent = reportLines.join('\n');
        const reportPath = './integrity_check_report.txt';
        await fse.writeFile(reportPath, reportContent);
        
        // Also save simple missed_files.txt for backward compatibility
        const simpleReport = missingFiles.map(file => {
            const prefix = file.isDirectory ? '[DIR]' : '[FILE]';
            return `${prefix} ${file.path}`;
        }).join('\n');
        await fse.writeFile('./missed_files.txt', simpleReport);
        
        console.log(`📄 Integrity check report saved to: ${reportPath}`);
        console.log(`✅ Database integrity check completed. Found ${missingFiles.length} missing and ${renamedFiles.length} possibly renamed files out of ${files.length} checked.`);
        
        // Update progress to completed
        progress.status = 'completed';
        progress.endTime = Date.now();
        progress.results = {
            totalChecked: files.length,
            missingCount: missingFiles.length,
            renamedCount: renamedFiles.length,
            reportFile: reportPath,
            missingFiles: missingFiles,
            renamedFiles: renamedFiles
        };
        
        console.log(`🔄 Found ${renamedFiles.length} possibly renamed files`);
        
    } catch (error) {
        console.error('❌ Database integrity check failed:', error);
        progress.status = 'error';
        progress.error = error.message;
        progress.endTime = Date.now();
    }
}



// checkArchivers function removed - now using ArchiverManager

// Helper function to find WinRAR using ArchiverManager
async function findWinRAR() {
    const archiverInfo = await archiverManager.getArchiverForFormat('rar');
    return archiverInfo ? archiverInfo.path : null;
}

// Get available archivers
app.get('/api/archivers', async (req, res) => {
    try {
        const archiverInfo = await archiverManager.getArchiverInfo();
        const supportedFormats = await archiverManager.getSupportedFormats();
        
        res.json({
            archivers: archiverInfo.archivers,
            formats: archiverInfo.formats,
            supportedFormats: supportedFormats,
            available: supportedFormats.length > 0
        });
    } catch (error) {
        console.error('Error getting archiver info:', error);
        res.status(500).json({ error: 'Failed to get archiver information' });
    }
});

// Archive files with external tools (with progress tracking)
app.post('/api/files/archive', async (req, res) => {
    const { fileIds, archiveName, destinationPath, format, password, volumeSize, compression } = req.body;
    
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
        return res.status(400).json({ error: 'File IDs are required' });
    }
    
    // Validate and default format
    const requestedFormat = format || '7z';
    const validFormats = ['zip', 'rar', '7z'];
    
    if (!validFormats.includes(requestedFormat)) {
        return res.status(400).json({ 
            error: `Invalid format '${requestedFormat}'. Supported formats: ${validFormats.join(', ')}` 
        });
    }
    
    // Check if archiver for requested format is available
    const archiverForFormat = await archiverManager.getArchiverForFormat(requestedFormat);
    if (!archiverForFormat) {
        const formatArchiverMap = {
            'zip': '7-Zip',
            '7z': '7-Zip',
            'rar': 'WinRAR'
        };
        return res.status(400).json({ 
            error: `Format '${requestedFormat}' requires ${formatArchiverMap[requestedFormat]} which is not available.`,
            format: requestedFormat,
            requiredArchiver: formatArchiverMap[requestedFormat]
        });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultArchiveName = `archive_${timestamp}`;
    const baseName = archiveName || defaultArchiveName;
    const archiveId = `archive_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Initialize progress tracking
    archiveProgress.set(archiveId, {
        archiveId,
        status: 'initializing',
        progress: 0,
        currentFile: '',
        filesProcessed: 0,
        totalFiles: fileIds.length,
        consoleOutput: [],
        startTime: Date.now()
    });
    
    // Return archive ID immediately so client can start monitoring
    res.json({ 
        archiveId, 
        message: 'Archive creation started',
        format: requestedFormat,
        archiver: archiverForFormat.archiver
    });
    
    // Process archive creation asynchronously
    (async () => {
        try {
            // Helper functions for progress tracking
            const updateProgress = (updates) => {
                const current = archiveProgress.get(archiveId);
                if (current) {
                    archiveProgress.set(archiveId, { ...current, ...updates });
                }
            };
            
            const addConsoleOutput = (line) => {
                const current = archiveProgress.get(archiveId);
                if (current) {
                    const output = [...current.consoleOutput, {
                        timestamp: Date.now(),
                        line: line
                    }];
                    // Keep only last 100 lines
                    if (output.length > 100) {
                        output.shift();
                    }
                    archiveProgress.set(archiveId, { ...current, consoleOutput: output });
                }
            };
            
            addConsoleOutput('📦 Starting archive creation...');
            updateProgress({ status: 'preparing' });
            
            // Ensure archives directory exists
            await fse.ensureDir('./archives');
            addConsoleOutput('✅ Archives directory ready');
            
            // Get file paths
            const filePaths = [];
            const errors = [];
            
            addConsoleOutput(`📋 Collecting ${fileIds.length} files...`);
            updateProgress({ status: 'collecting_files', progress: 5 });
            
            for (let i = 0; i < fileIds.length; i++) {
                const fileId = fileIds[i];
                const file = await new Promise((resolve, reject) => {
                    db.get('SELECT * FROM files WHERE id = ?', [fileId], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });
                
                if (file && fs.existsSync(file.full_path)) {
                    filePaths.push(file.full_path);
                    addConsoleOutput(`  ✓ ${file.filename}`);
                } else {
                    const errorMsg = `File not found: ${file ? file.filename : 'Unknown'}`;
                    errors.push(errorMsg);
                    addConsoleOutput(`  ✗ ${errorMsg}`);
                }
                
                updateProgress({ 
                    filesProcessed: i + 1,
                    progress: 5 + (i + 1) / fileIds.length * 10
                });
            }
            
            if (filePaths.length === 0) {
                addConsoleOutput('❌ No valid files found');
                updateProgress({ status: 'failed', progress: 0 });
                return;
            }
            
            addConsoleOutput(`✅ Collected ${filePaths.length} files`);
            
            // Use ArchiverManager to get archiver info
            addConsoleOutput(`🔧 Using archiver: ${archiverForFormat.archiver} (${archiverForFormat.type})`);
            addConsoleOutput(`📦 Format: ${requestedFormat.toUpperCase()}`);
            
            // Map format to file extension
            const formatExtensions = {
                'zip': '.zip',
                'rar': '.rar',
                '7z': '.7z'
            };
            
            // Remove existing extension from baseName if present
            const baseNameWithoutExt = baseName.replace(/\.(zip|rar|7z)$/i, '');
            
            // Build archive path with correct extension
            const extension = formatExtensions[requestedFormat];
            const archivePath = path.join(destinationPath || './archives', `${baseNameWithoutExt}${extension}`);
            
            // Check if archive already exists and delete it (including multi-volume parts)
            if (fs.existsSync(archivePath)) {
                addConsoleOutput(`⚠️  Archive already exists, deleting old version...`);
                try {
                    fs.unlinkSync(archivePath);
                    
                    // Also delete multi-volume parts if they exist (.001, .002, etc.)
                    const archiveDir = path.dirname(archivePath);
                    const archiveBase = path.basename(archivePath, extension);
                    const volumePattern = new RegExp(`^${archiveBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.\\d{3}$`);
                    
                    const files = fs.readdirSync(archiveDir);
                    let deletedVolumes = 0;
                    files.forEach(file => {
                        if (volumePattern.test(file)) {
                            fs.unlinkSync(path.join(archiveDir, file));
                            deletedVolumes++;
                        }
                    });
                    
                    if (deletedVolumes > 0) {
                        addConsoleOutput(`✅ Deleted old archive and ${deletedVolumes} volume(s)`);
                    } else {
                        addConsoleOutput(`✅ Old archive deleted`);
                    }
                } catch (deleteError) {
                    addConsoleOutput(`❌ Failed to delete old archive: ${deleteError.message}`);
                    throw new Error(`Cannot overwrite existing archive: ${deleteError.message}`);
                }
            }
            
            addConsoleOutput(`📦 Creating archive: ${path.basename(archivePath)}`);
            updateProgress({ status: 'archiving', progress: 15 });
            
            // Create archive with progress tracking
            const result = await createArchiveWithProgress({
                filePaths,
                archivePath,
                archiverPath: archiverForFormat.path,
                archiverType: archiverForFormat.archiver,
                format: requestedFormat,
                password: password,
                volumeSize: volumeSize,
                compression: compression,
                onProgress: updateProgress,
                onConsoleOutput: addConsoleOutput
            });
            
            addConsoleOutput(`✅ Archive created successfully!`);
            addConsoleOutput(`📊 Files processed: ${result.filesProcessed}`);
            if (result.archiveSize) {
                addConsoleOutput(`📊 Archive size: ${(result.archiveSize / 1024 / 1024).toFixed(2)} MB`);
            }
            
            updateProgress({ 
                status: 'completed', 
                progress: 100,
                archivePath: result.archivePath,
                archiveSize: result.archiveSize
            });
            
            // Clean up progress after 5 minutes
            setTimeout(() => {
                archiveProgress.delete(archiveId);
            }, 5 * 60 * 1000);
            
        } catch (error) {
            console.error('Archive creation failed:', error);
            const current = archiveProgress.get(archiveId);
            if (current) {
                current.consoleOutput.push({
                    timestamp: Date.now(),
                    line: `❌ Error: ${error.message}`
                });
                archiveProgress.set(archiveId, {
                    ...current,
                    status: 'failed',
                    progress: 0,
                    error: error.message
                });
            }
        }
    })();
});

// Enhanced archive creation with password and detailed logging
app.post('/api/files/archive-enhanced', async (req, res) => {
    const { fileIds, archiveName, destination, password, format } = req.body;
    
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
        return res.status(400).json({ error: 'File IDs are required' });
    }
    
    if (!archiveName || !destination) {
        return res.status(400).json({ error: 'Archive name and destination are required' });
    }
    
    try {
        // Ensure destination directory exists
        await fse.ensureDir(destination);
        
        // Get file paths
        const filePaths = [];
        const errors = [];
        
        for (const fileId of fileIds) {
            const file = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM files WHERE id = ?', [fileId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            
            if (file && fs.existsSync(file.full_path)) {
                filePaths.push(file.full_path);
            } else {
                errors.push(`File not found: ${file ? file.filename : 'Unknown'}`);
            }
        }
        
        if (filePaths.length === 0) {
            return res.status(400).json({ error: 'No valid files found' });
        }
        
        // Validate format
        const requestedFormat = format || '7z';
        const validFormats = ['zip', 'rar', '7z'];
        
        if (!validFormats.includes(requestedFormat)) {
            return res.status(400).json({ 
                error: `Invalid format '${requestedFormat}'. Supported formats: ${validFormats.join(', ')}` 
            });
        }
        
        // Check if archiver for requested format is available
        const archiverForFormat = await archiverManager.getArchiverForFormat(requestedFormat);
        if (!archiverForFormat) {
            const formatArchiverMap = {
                'zip': '7-Zip',
                '7z': '7-Zip',
                'rar': 'WinRAR'
            };
            return res.status(400).json({ 
                error: `Format '${requestedFormat}' requires ${formatArchiverMap[requestedFormat]} which is not available.`,
                format: requestedFormat,
                requiredArchiver: formatArchiverMap[requestedFormat],
                suggestion: 'Download 7-Zip from https://www.7-zip.org/ or WinRAR from https://www.win-rar.com/'
            });
        }
        
        // Determine file extension based on format
        const extensions = { '7z': '.7z', 'zip': '.zip', 'rar': '.rar' };
        const extension = extensions[requestedFormat] || '.7z';
        const archivePath = path.join(destination, `${archiveName}${extension}`);
        
        // Use archiver from ArchiverManager
        const useArchiver = archiverForFormat.archiver;
        const archiverPath = archiverForFormat.path;
        
        let command;
        const { spawn } = require('child_process');
        
        if (useArchiver === '7zip') {
            // 7-Zip command with optional password
            command = [archiverPath, 'a', '-y', '-bsp1', '-bso1', '-bse1'];
            if (password) {
                command.push(`-p${password}`);
            }
            if (format === 'zip') {
                command.push('-tzip');
            }
            command.push(archivePath);
            command.push(...filePaths.map(p => `"${p}"`));
        } else if (useArchiver === 'winrar') {
            // WinRAR command with optional password
            command = [archiverPath, 'a', '-y', '-ep1', '-ibck'];
            if (password) {
                command.push(`-hp${password}`);
            }
            command.push(archivePath);
            command.push(...filePaths.map(p => `"${p}"`));
        }
        
        console.log('Executing enhanced archiver command:', command.join(' '));
        
        // Execute archiver with detailed logging
        const archiveProcess = spawn(command[0], command.slice(1), { 
            shell: true, 
            stdio: ['pipe', 'pipe', 'pipe'] 
        });
        
        let progressOutput = '';
        let errorOutput = '';
        
        archiveProcess.stdout.on('data', (data) => {
            progressOutput += data.toString();
            console.log('Archive stdout:', data.toString().trim());
        });
        
        archiveProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
            console.log('Archive stderr:', data.toString().trim());
        });
        
        await new Promise((resolve, reject) => {
            archiveProcess.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Archive process exited with code ${code}. Error: ${errorOutput}`));
                }
            });
            
            archiveProcess.on('error', (error) => {
                reject(error);
            });
        });
        
        const stats = fs.statSync(archivePath);
        
        res.json({
            message: `Enhanced archive created successfully using ${useArchiver}`,
            archiveName: path.basename(archivePath),
            archivePath: archivePath,
            filesAdded: filePaths.length,
            archiveSize: stats.size,
            archiver: useArchiver,
            format: format,
            passwordProtected: !!password,
            log: progressOutput,
            errors: errors.length > 0 ? errors : undefined
        });
        
    } catch (error) {
        console.error('Enhanced archive creation failed:', error);
        res.status(500).json({ 
            error: `Enhanced archive creation failed: ${error.message}`,
            suggestion: 'Make sure the selected archiver is properly installed and accessible'
        });
    }
});

// WinRAR archive creation with full control
app.post('/api/files/archive-winrar', async (req, res) => {
    const { fileIds, archiveName, destination, password, compression, isMultivolume, volumeSize } = req.body;
    
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
        return res.status(400).json({ error: 'File IDs are required' });
    }
    
    if (!archiveName || !destination) {
        return res.status(400).json({ error: 'Archive name and destination are required' });
    }
    
    try {
        // Ensure destination directory exists
        await fse.ensureDir(destination);
        
        // Get file paths
        const filePaths = [];
        const errors = [];
        
        for (const fileId of fileIds) {
            const file = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM files WHERE id = ?', [fileId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            
            if (file && fs.existsSync(file.full_path)) {
                filePaths.push(file.full_path);
            } else {
                errors.push(`File not found: ${file ? file.filename : 'Unknown'}`);
            }
        }
        
        if (filePaths.length === 0) {
            return res.status(400).json({ error: 'No valid files found' });
        }
        
        // Check for WinRAR
        const winrarPath = 'C:\\Program Files\\WinRAR\\Rar.exe';
        console.log('Checking WinRAR at:', winrarPath);
        
        if (!fs.existsSync(winrarPath)) {
            console.error('WinRAR not found at:', winrarPath);
            return res.status(400).json({ 
                error: 'WinRAR not found at expected location',
                suggestion: 'Install WinRAR or check path: C:\\Program Files\\WinRAR\\Rar.exe',
                checkedPath: winrarPath
            });
        }
        
        console.log('WinRAR found successfully');
        
        const archivePath = path.join(destination, `${archiveName}.rar`);
        
        // Build WinRAR command
        const command = [winrarPath, 'a', '-y', '-ep1', '-ibck'];
        
        // Add compression level
        command.push(`-m${compression}`);
        
        // Add password if provided
        if (password) {
            command.push(`-hp${password}`);
        }
        
        // Add multivolume if enabled
        if (isMultivolume && volumeSize) {
            command.push(`-v${volumeSize}m`);
        }
        
        // Add archive path
        command.push(`"${archivePath}"`);
        
        // Add file paths
        filePaths.forEach(filePath => {
            command.push(`"${filePath}"`);
        });
        
        // Build command string for exec
        const commandStr = `"${winrarPath}" a -y -ep1 -ibck -m${compression}${password ? ` -hp${password}` : ''}${isMultivolume && volumeSize ? ` -v${volumeSize}m` : ''} "${archivePath}" ${filePaths.map(p => `"${p}"`).join(' ')}`;
        
        console.log('Executing WinRAR command:', commandStr);
        console.log('Files to archive:', filePaths);
        console.log('Archive destination:', archivePath);
        
        // Execute WinRAR with spawn for better encoding handling
        const { spawn } = require('child_process');
        const iconv = require('iconv-lite');
        
        let progressOutput = '';
        let errorOutput = '';
        
        await new Promise((resolve, reject) => {
            // Use spawn with proper encoding handling
            const archiveProcess = spawn(winrarPath, [
                'a', '-y', '-ep1', '-ibck', `-m${compression}`,
                ...(password ? [`-hp${password}`] : []),
                ...(isMultivolume && volumeSize ? [`-v${volumeSize}m`] : []),
                archivePath,
                ...filePaths
            ], {
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            // Handle stdout with proper encoding
            archiveProcess.stdout.on('data', (data) => {
                // Convert from Windows-1251 to UTF-8
                const decoded = iconv.decode(data, 'cp1251');
                progressOutput += decoded;
                console.log('WinRAR stdout:', decoded.trim());
            });
            
            // Handle stderr with proper encoding
            archiveProcess.stderr.on('data', (data) => {
                // Convert from Windows-1251 to UTF-8
                const decoded = iconv.decode(data, 'cp1251');
                errorOutput += decoded;
                console.log('WinRAR stderr:', decoded.trim());
            });
            
            archiveProcess.on('close', (code) => {
                if (code === 0) {
                    console.log('WinRAR completed successfully');
                    resolve();
                } else {
                    console.error('WinRAR execution error, exit code:', code);
                    reject(new Error(`WinRAR failed with exit code ${code}. Error: ${errorOutput}`));
                }
            });
            
            archiveProcess.on('error', (error) => {
                console.error('WinRAR process error:', error);
                reject(error);
            });
        });
        
        // Get archive stats
        let totalSize = 0;
        let archiveFiles = [];
        
        if (isMultivolume) {
            // For multivolume, find all parts
            const baseName = path.basename(archivePath, '.rar');
            const dirName = path.dirname(archivePath);
            const files = fs.readdirSync(dirName);
            
            files.forEach(file => {
                if (file.startsWith(baseName) && (file.endsWith('.rar') || file.match(/\.r\d+$/))) {
                    const filePath = path.join(dirName, file);
                    const stats = fs.statSync(filePath);
                    totalSize += stats.size;
                    archiveFiles.push(file);
                }
            });
        } else {
            const stats = fs.statSync(archivePath);
            totalSize = stats.size;
            archiveFiles.push(path.basename(archivePath));
        }
        
        res.json({
            message: `WinRAR archive created successfully`,
            archiveName: archiveFiles.join(', '),
            archivePath: archivePath,
            filesAdded: filePaths.length,
            archiveSize: totalSize,
            compression: compression,
            passwordProtected: !!password,
            multivolume: isMultivolume,
            volumeCount: archiveFiles.length,
            log: progressOutput,
            errors: errors.length > 0 ? errors : undefined
        });
        
    } catch (error) {
        console.error('WinRAR archive creation failed:', error);
        res.status(500).json({ 
            error: `WinRAR archive creation failed: ${error.message}`,
            suggestion: 'Make sure WinRAR is installed at C:\\Program Files\\WinRAR\\Rar.exe'
        });
    }
});

// Check for external archivers

// Open file (returns file info for client to handle)
app.get('/api/files/:id/open', (req, res) => {
    const { id } = req.params;
    
    db.get('SELECT * FROM files WHERE id = ?', [id], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        // Check if file still exists
        const exists = fs.existsSync(row.full_path);
        
        res.json({
            ...row,
            exists: exists,
            canOpen: exists && !row.is_directory
        });
    });
});

// Open file in system default program
app.get('/api/files/open-system', (req, res) => {
    const { path: filePath } = req.query;
    
    if (!filePath) {
        return res.status(400).json({ error: 'File path is required' });
    }
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    
    try {
        const { exec } = require('child_process');
        let command;
        
        if (process.platform === 'win32') {
            // Windows: use start command
            command = `start "" "${filePath}"`;
        } else if (process.platform === 'darwin') {
            // macOS: use open command
            command = `open "${filePath}"`;
        } else {
            // Linux: use xdg-open
            command = `xdg-open "${filePath}"`;
        }
        
        exec(command, (error) => {
            if (error) {
                console.error('Error opening file:', error);
                return res.status(500).json({ error: 'Failed to open file' });
            }
            
            res.json({ message: 'File opened successfully', path: filePath });
        });
        
    } catch (error) {
        console.error('Error opening file:', error);
        res.status(500).json({ error: 'Failed to open file' });
    }
});

// Get directory tree for file browser
app.get('/api/directory-tree', (req, res) => {
    const { path: rootPath = 'drives' } = req.query;
    
    try {
        if (rootPath === 'drives') {
            // Return available drives
            const drives = getAvailableDrives();
            const driveNodes = drives.map(drive => ({
                name: drive,
                path: drive,
                type: 'drive',
                hasChildren: true,
                icon: '💾'
            }));
            return res.json({ nodes: driveNodes });
        }
        
        if (!fs.existsSync(rootPath)) {
            return res.status(404).json({ error: 'Path not found' });
        }
        
        const stats = fs.statSync(rootPath);
        if (!stats.isDirectory()) {
            return res.status(400).json({ error: 'Path is not a directory' });
        }
        
        const items = fs.readdirSync(rootPath);
        const nodes = [];
        
        items.forEach(item => {
            const fullPath = path.join(rootPath, item);
            try {
                const itemStats = fs.statSync(fullPath);
                if (itemStats.isDirectory()) {
                    // Check if directory has subdirectories
                    let hasChildren = false;
                    try {
                        const subItems = fs.readdirSync(fullPath);
                        hasChildren = subItems.some(subItem => {
                            try {
                                return fs.statSync(path.join(fullPath, subItem)).isDirectory();
                            } catch (e) {
                                return false;
                            }
                        });
                    } catch (e) {
                        hasChildren = false;
                    }
                    
                    nodes.push({
                        name: item,
                        path: fullPath,
                        type: 'folder',
                        hasChildren: hasChildren,
                        icon: '📁'
                    });
                }
            } catch (error) {
                // Skip inaccessible items
            }
        });
        
        // Sort directories alphabetically
        nodes.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        
        res.json({ nodes, currentPath: rootPath });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create test folder
app.post('/api/create-test-folder', async (req, res) => {
    const { path: folderPath } = req.body;
    
    if (!folderPath) {
        return res.status(400).json({ error: 'Folder path is required' });
    }
    
    try {
        await fse.ensureDir(folderPath);
        res.json({ message: 'Test folder created successfully', path: folderPath });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Function to check if port is available
function isPortAvailable(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        
        server.listen(port, () => {
            server.once('close', () => {
                resolve(true);
            });
            server.close();
        });
        
        server.on('error', () => {
            resolve(false);
        });
    });
}

// Function to find available port
async function findAvailablePort(startPort = 3000) {
    let port = startPort;
    const maxAttempts = 100;
    
    for (let i = 0; i < maxAttempts; i++) {
        if (await isPortAvailable(port)) {
            return port;
        }
        port++;
    }
    
    // If no port found in range, try random ports
    for (let i = 0; i < 10; i++) {
        port = Math.floor(Math.random() * (65535 - 1024) + 1024);
        if (await isPortAvailable(port)) {
            return port;
        }
    }
    
    throw new Error('No available port found');
}

// Periodic cache statistics logging
let cacheStatsInterval = null;

function startCacheStatsLogging() {
    // Clear any existing interval
    if (cacheStatsInterval) {
        clearInterval(cacheStatsInterval);
    }
    
    // Only start logging if cache stats are enabled
    if (!config.enableCacheStats) {
        console.log('📊 Cache statistics logging disabled by configuration');
        return;
    }
    
    // Log cache stats at configured interval
    cacheStatsInterval = setInterval(() => {
        try {
            if (USE_OPTIMIZED_CACHE && optimizedCache.isLoaded) {
                const stats = optimizedCache.getStats();
                console.log('\n📊 Cache Statistics (5-minute update):');
                console.log(`   Strategy: Optimized`);
                console.log(`   Total Memory: ~${stats.totalMemoryMB}MB`);
                console.log(`   Index Cache: ${stats.indexCache.size} records (~${stats.indexCache.memoryMB}MB)`);
                console.log(`   Hot Cache: ${stats.hotDataCache.size}/${stats.hotDataCache.maxSize} records (~${stats.hotDataCache.memoryMB}MB)`);
                console.log(`   Hot Cache Hit Rate: ${stats.hotDataCache.hitRate}`);
                console.log(`   Hot Cache Hits: ${stats.hotDataCache.hits}, Misses: ${stats.hotDataCache.misses}`);
                console.log(`   Search Index: ${stats.searchIndex.size} records (~${stats.searchIndex.memoryMB}MB)`);
                console.log(`   Load Duration: ${stats.loadDuration}ms`);
                
                // Process memory info
                const mem = process.memoryUsage();
                console.log(`   Process Memory: Heap ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB, RSS ${Math.round(mem.rss / 1024 / 1024)}MB\n`);
            } else if (!USE_OPTIMIZED_CACHE && dbCache.isLoaded) {
                console.log('\n📊 Cache Statistics (5-minute update):');
                console.log(`   Strategy: Legacy`);
                console.log(`   Total Records: ${dbCache.allFiles.length}`);
                
                // Process memory info
                const mem = process.memoryUsage();
                console.log(`   Process Memory: Heap ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB, RSS ${Math.round(mem.rss / 1024 / 1024)}MB\n`);
            } else {
                console.log('\n📊 Cache Statistics: Cache not loaded yet\n');
            }
        } catch (error) {
            console.error('❌ Error logging cache stats:', error.message);
        }
    }, config.logCacheStatsInterval);
    
    const intervalMinutes = Math.round(config.logCacheStatsInterval / 60000);
    console.log(`📊 Cache statistics logging started (every ${intervalMinutes} minutes)`);
}

function stopCacheStatsLogging() {
    if (cacheStatsInterval) {
        clearInterval(cacheStatsInterval);
        cacheStatsInterval = null;
        console.log('📊 Cache statistics logging stopped');
    }
}

// Start server with automatic port detection
async function startServer() {
    try {
        // Try to find available port
        PORT = await findAvailablePort(3000);
        
        const server = app.listen(PORT, async () => {
            const url = `http://localhost:${PORT}`;
            
            console.log(`🚀 FileStash Simple server running on ${url}`);
            console.log(`📁 Database: ./filestash.db`);
            
            if (PORT !== 3000) {
                console.log(`⚠️  Port 3000 was busy, using port ${PORT} instead`);
            }
            
            console.log(`🌐 Opening browser automatically...`);
            
            // Automatically open browser
            try {
                await open(url);
                console.log(`✅ Browser opened successfully`);
            } catch (error) {
                console.log(`⚠️  Could not open browser automatically: ${error.message}`);
                console.log(`🌐 Please open your browser and go to: ${url}`);
            }
            
            console.log(`\n📋 Server Information:`);
            console.log(`   URL: ${url}`);
            console.log(`   Port: ${PORT}`);
            console.log(`   Database: ./filestash.db`);
            console.log(`   Archives: ./archives/`);
            console.log(`   Backups: ./backups/`);
            console.log(`\n🎯 Ready to use! Press Ctrl+C to stop the server`);
            
            // Start periodic cache statistics logging (every 5 minutes)
            startCacheStatsLogging();
        });
        
        // Handle server errors
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`❌ Port ${PORT} is still busy, trying another port...`);
                startServer(); // Retry with different port
            } else {
                console.error('Server error:', err);
            }
        });
        
    } catch (error) {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
}

// Server will be started automatically after cache initialization
// See db.once('open') handler above

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('✅ Database connection closed.');
        }
        process.exit(0);
    });
});

// Export for testing
module.exports = { DatabaseCache };