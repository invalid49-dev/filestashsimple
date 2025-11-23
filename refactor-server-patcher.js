/**
 * Скрипт-патчер для рефакторинга server.js
 * Разделяет монолитный файл на модули
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Запуск патчера для рефакторинга server.js...\n');

// Путь к оригинальному файлу
const SERVER_FILE = path.join(__dirname, 'server.js');
const BACKUP_FILE = path.join(__dirname, 'server.js.backup');

// Создание бекапа
console.log('📋 Создание бекапа...');
if (!fs.existsSync(BACKUP_FILE)) {
    fs.copyFileSync(SERVER_FILE, BACKUP_FILE);
    console.log('✅ Бекап создан: server.js.backup\n');
} else {
    console.log('ℹ️  Бекап уже существует: server.js.backup\n');
}

// Создание структуры директорий
console.log('📁 Создание структуры директорий...');
const dirs = [
    path.join(__dirname, 'server'),
    path.join(__dirname, 'server', 'routes')
];

dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`   ✅ Создана: ${path.relative(__dirname, dir)}`);
    } else {
        console.log(`   ℹ️  Существует: ${path.relative(__dirname, dir)}`);
    }
});
console.log('');

// Читаем оригинальный файл
console.log('📖 Чтение server.js...');
const serverContent = fs.readFileSync(SERVER_FILE, 'utf8');
const lines = serverContent.split('\n');
console.log(`   📊 Всего строк: ${lines.length}\n`);

// ==================== МОДУЛЬ 1: cache-manager.js ====================
console.log('📦 Создание модуля: server/cache-manager.js');

const cacheManagerContent = `/**
 * Cache Manager Module
 * Управление кешированием для оптимизации производительности
 */

const sqlite3 = require('sqlite3').verbose();
const { OptimizedDatabaseCache } = require('../optimized-cache');
const { config, useOptimizedCache, getOptimizedCacheOptions } = require('../config');
const { dbQuery } = require('../db-utils');

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
        
        console.log(\`✅ Cache HIT: \${key}\`);
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
            console.log(\`🗑️ Cache EVICT: \${oldestKey}\`);
        }
        
        // Add new entry
        this.cache.set(key, {
            data: data,
            timestamp: Date.now(),
            size: dataSize
        });
        this.currentSize += dataSize;
        
        console.log(\`💾 Cache SET: \${key} (\${Math.round(dataSize / 1024)}KB, total: \${Math.round(this.currentSize / 1024 / 1024)}MB)\`);
    }
    
    delete(key) {
        if (this.cache.has(key)) {
            const item = this.cache.get(key);
            this.currentSize -= item.size;
            this.cache.delete(key);
            console.log(\`🗑️ Cache DELETE: \${key}\`);
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
        console.log(\`🗑️ Cache INVALIDATED: \${keysToDelete.length} entries matching "\${pattern}"\`);
    }
}

// In-memory database cache
class DatabaseCache {
    constructor() {
        this.allFiles = null;
        this.filesByPath = null;
        this.filesByDirectory = null;
        this.isLoaded = false;
        this.isLoading = false;
        this.loadPromise = null;
    }
    
    async loadFromDatabase(db) {
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
                console.log(\`✅ Database loaded into memory: \${rows.length} records in \${duration}ms (~\${Math.round(memoryUsage / 1024 / 1024)}MB)\`);
                
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
    }
    
    async reload(db) {
        this.invalidate();
        await this.loadFromDatabase(db);
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
        const searchWords = lowerSearch.split(/\\s+/).filter(w => w.length > 0);
        
        const results = this.allFiles
            .map(file => {
                const lowerFilename = file.filename.toLowerCase();
                const lowerPath = file.full_path.toLowerCase();
                let score = 0;
                let matches = 0;
                
                const allWordsMatch = searchWords.every(word => 
                    lowerFilename.includes(word) || lowerPath.includes(word)
                );
                
                if (!allWordsMatch) return null;
                
                if (lowerFilename === lowerSearch) score += 1000;
                if (lowerFilename.startsWith(lowerSearch)) score += 500;
                if (lowerFilename.includes(lowerSearch)) score += 100;
                if (lowerPath.includes(lowerSearch)) score += 50;
                
                searchWords.forEach(word => {
                    if (lowerFilename.includes(word)) {
                        score += 10;
                        matches++;
                    }
                });
                
                if (file.is_directory === 1) score += 5;
                
                const pathDepth = (file.full_path.match(/[\\\\\\/]/g) || []).length;
                score -= pathDepth;
                
                return { file, score, matches };
            })
            .filter(result => result !== null)
            .sort((a, b) => b.score - a.score)
            .map(result => result.file);
        
        return results;
    }
}

/**
 * Helper function to invalidate caches after database modifications
 */
async function invalidateDatabaseCaches(db, queryCache, optimizedCache, dbCache, options = {}) {
    const { paths = null, directories = null, fullReload = true } = options;
    
    if (queryCache) {
        queryCache.invalidatePattern('^tree:');
    }
    
    const USE_OPTIMIZED_CACHE = useOptimizedCache(config);
    
    if (USE_OPTIMIZED_CACHE) {
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
            console.log('🔄 Reloading database cache after modification...');
            await optimizedCache.reload();
            console.log('✅ Database cache reloaded');
        }
    } else {
        console.log('🔄 Reloading database cache after modification...');
        await dbCache.reload(db);
        console.log('✅ Database cache reloaded');
    }
}

/**
 * Helper function to attempt cache load with automatic fallback
 */
async function loadCacheWithFallback(db, optimizedCache, dbCache, activeCacheType) {
    console.log(\`🚀 Attempting to load \${activeCacheType} cache...\`);
    
    try {
        if (activeCacheType === 'optimized') {
            await optimizedCache.load();
            console.log('✅ OptimizedDatabaseCache loaded successfully');
            return { success: true, cacheType: 'optimized', activeCacheType: 'optimized', loadFailed: false };
        } else {
            await dbCache.loadFromDatabase(db);
            console.log('✅ Legacy DatabaseCache loaded successfully');
            return { success: true, cacheType: 'legacy', activeCacheType: 'legacy', loadFailed: false };
        }
    } catch (error) {
        console.error(\`❌ Failed to load \${activeCacheType} cache:\`, error);
        
        const fallbackType = activeCacheType === 'optimized' ? 'legacy' : 'optimized';
        console.log(\`⚠️  Attempting fallback to \${fallbackType} cache...\`);
        
        try {
            if (fallbackType === 'legacy') {
                await dbCache.loadFromDatabase(db);
                console.log('✅ Fallback to legacy cache successful');
                return { success: true, cacheType: 'legacy', activeCacheType: 'legacy', loadFailed: false, fallback: true };
            } else {
                await optimizedCache.load();
                console.log('✅ Fallback to optimized cache successful');
                return { success: true, cacheType: 'optimized', activeCacheType: 'optimized', loadFailed: false, fallback: true };
            }
        } catch (fallbackError) {
            console.error(\`❌ Fallback to \${fallbackType} cache also failed:\`, fallbackError);
            return { 
                success: false, 
                error: error.message, 
                fallbackError: fallbackError.message,
                activeCacheType: activeCacheType,
                loadFailed: true
            };
        }
    }
}

module.exports = {
    LRUCache,
    DatabaseCache,
    invalidateDatabaseCaches,
    loadCacheWithFallback
};
`;

fs.writeFileSync(path.join(__dirname, 'server', 'cache-manager.js'), cacheManagerContent);
console.log('   ✅ Создан: server/cache-manager.js\n');

// ==================== МОДУЛЬ 2: file-operations.js ====================
console.log('📦 Создание модуля: server/file-operations.js');

const fileOperationsContent = `/**
 * File Operations Module
 * Операции с файлами и директориями
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Get file statistics
 */
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
        console.error(\`Error getting stats for \${filePath}:\`, error.message);
        return null;
    }
}

/**
 * Get file attributes
 */
function getFileAttributes(stats) {
    const attrs = [];
    if (stats.isDirectory()) attrs.push('DIR');
    if (stats.isFile()) attrs.push('FILE');
    return attrs.join(',');
}

/**
 * Calculate CRC32 checksum
 */
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

/**
 * Get available drives (Windows specific)
 */
function getAvailableDrives() {
    const drives = [];
    if (process.platform === 'win32') {
        for (let i = 65; i <= 90; i++) { // A-Z
            const drive = String.fromCharCode(i) + ':\\\\';
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

/**
 * Optimized file stats with optional CRC32
 */
async function getFileStatsOptimized(filePath, calculateCrc32 = true) {
    try {
        const stats = await fs.promises.stat(filePath);
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
            crc32: (stats.isDirectory() || !calculateCrc32) ? null : calculateCRC32(filePath)
        };
    } catch (error) {
        return null;
    }
}

module.exports = {
    getFileStats,
    getFileAttributes,
    calculateCRC32,
    getAvailableDrives,
    getFileStatsOptimized
};
`;

fs.writeFileSync(path.join(__dirname, 'server', 'file-operations.js'), fileOperationsContent);
console.log('   ✅ Создан: server/file-operations.js\n');

console.log('✅ Патчер успешно создал модули!\n');
console.log('📝 Следующие шаги:');
console.log('   1. Запустите: node refactor-server-patcher.js');
console.log('   2. Проверьте созданные файлы');
console.log('   3. Перезапустите сервер для тестирования\n');
