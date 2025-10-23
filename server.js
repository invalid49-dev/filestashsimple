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

const app = express();
let PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize SQLite database
const db = new sqlite3.Database('./filestash.db');

// Create tables with optimizations
db.serialize(() => {
    // Optimize SQLite for performance
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA synchronous = NORMAL');
    db.run('PRAGMA cache_size = 10000');
    db.run('PRAGMA temp_store = MEMORY');
    
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
        crc32 TEXT
    )`);
    
    // Create indexes for better query performance
    db.run('CREATE INDEX IF NOT EXISTS idx_filename ON files(filename)');
    db.run('CREATE INDEX IF NOT EXISTS idx_directory ON files(directory)');
    db.run('CREATE INDEX IF NOT EXISTS idx_extension ON files(extension)');
    db.run('CREATE INDEX IF NOT EXISTS idx_size ON files(size)');
    db.run('CREATE INDEX IF NOT EXISTS idx_is_directory ON files(is_directory)');
    db.run('CREATE INDEX IF NOT EXISTS idx_crc32 ON files(crc32)');
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
        const data = fs.readFileSync(filePath);
        return crypto.createHash('md5').update(data).digest('hex').substring(0, 8);
    } catch (error) {
        return null;
    }
}

// Build hierarchical tree structure from flat file list
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

// Scan multiple selected directories
app.post('/api/scan-multiple', async (req, res) => {
    const { paths, threads, calculateCrc32 } = req.body;
    const batchSize = parseInt(threads) || 4;
    const shouldCalculateCrc32 = calculateCrc32 !== false; // Default to true
    
    if (!paths || !Array.isArray(paths) || paths.length === 0) {
        return res.status(400).json({ error: 'Paths array is required' });
    }

    // Validate all paths exist
    for (const scanPath of paths) {
        if (!fs.existsSync(scanPath)) {
            return res.status(404).json({ error: `Path not found: ${scanPath}` });
        }
    }

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
        cancellationRequested: false
    });

    // Start scanning asynchronously
    scanMultipleDirectoriesAsync(paths, scanId, batchSize, shouldCalculateCrc32);

    res.json({
        scanId: scanId,
        message: `Scan started for ${paths.length} directories with ${batchSize} threads${shouldCalculateCrc32 ? ' (with CRC32)' : ' (without CRC32)'}`,
        paths: paths
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
                const scanRecord = {
                    id: scanId,
                    startTime: new Date(progress.startTime).toISOString(),
                    endTime: new Date(progress.endTime).toISOString(),
                    duration: progress.duration,
                    status: 'cancelled',
                    paths: rootPaths,
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
        const pathPromises = rootPaths.map(rootPath => getAllItemsRecursivelyOptimized(rootPath, scanId));
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
                const scanRecord = {
                    id: scanId,
                    startTime: new Date(progress.startTime).toISOString(),
                    endTime: new Date(progress.endTime).toISOString(),
                    duration: progress.duration,
                    status: 'cancelled',
                    paths: rootPaths,
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
                const scanRecord = {
                    id: scanId,
                    startTime: new Date(progress.startTime).toISOString(),
                    endTime: new Date(progress.endTime).toISOString(),
                    duration: progress.duration,
                    status: 'cancelled',
                    paths: rootPaths,
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
        
        console.log(`✅ Scan completed in ${Math.round(progress.duration / 1000)} seconds`);
        
    } catch (error) {
        progress.status = 'error';
        progress.endTime = Date.now();
        progress.duration = progress.endTime - progress.startTime;
        progress.errors.push(`Scan error: ${error.message}`);
        console.error('❌ Scan error:', error);
    } finally {
        // Record scan to history regardless of completion status
        try {
            const scanRecord = {
                id: scanId,
                startTime: new Date(progress.startTime).toISOString(),
                endTime: progress.endTime ? new Date(progress.endTime).toISOString() : new Date().toISOString(),
                duration: progress.duration || 0,
                status: progress.status || 'error',
                paths: rootPaths,
                threadCount: threadCount,
                filesProcessed: progress.processed || 0,
                totalFound: progress.total || 0,
                calculateCrc32: calculateCrc32,
                errors: progress.errors || [],
                cancelled: progress.cancelled || false
            };
            
            addScanToHistory(scanRecord);
        } catch (historyError) {
            console.error('❌ Failed to record scan history:', historyError);
        }
    }
}

// Optimized recursive directory enumeration using async operations
async function getAllItemsRecursivelyOptimized(rootPath, scanId) {
    const items = [];
    const directories = [rootPath];
    const fs_promises = require('fs').promises;
    const progress = scanProgress.get(scanId);

    while (directories.length > 0) {
        // Check for cancellation during enumeration
        if (progress && progress.cancellationRequested) {
            console.log(`🛑 Directory enumeration stopped due to cancellation request`);
            break;
        }
        
        const currentDir = directories.pop();
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
                    items.push(result.fullPath);
                    if (result.isDirectory) {
                        directories.push(result.fullPath);
                    }
                }
            }
        } catch (e) {
            // Skip inaccessible directories
        }
    }

    return items;
}

// Optimized file stats function using async operations
async function getFileStatsOptimized(filePath, calculateCrc32 = true) {
    const fs_promises = require('fs').promises;
    
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
            crc32: crc32Value
        };
    } catch (error) {
        console.error(`Error getting stats for ${filePath}:`, error.message);
        return null;
    }
}

// Optimized CRC32 calculation using streaming for all file sizes
async function calculateCRC32Optimized(filePath, fileSize) {
    const fs_promises = require('fs').promises;
    
    try {
        // For small files (< 10MB), read directly into memory
        if (fileSize < 10 * 1024 * 1024) {
            const data = await fs_promises.readFile(filePath);
            return crypto.createHash('md5').update(data).digest('hex').substring(0, 8);
        }
        
        // For larger files, use streaming to avoid memory issues
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('md5');
            const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 }); // 64KB chunks
            
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
    } catch (error) {
        console.error(`Error calculating CRC32 for ${filePath}:`, error.message);
        return null;
    }
}

// Batch database insert for better performance
async function batchInsertToDatabase(fileStatsArray) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            
            const stmt = db.prepare(`INSERT OR REPLACE INTO files 
                (full_path, directory, filename, extension, size, created_time, modified_time, is_directory, attributes, crc32)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            
            let completed = 0;
            const total = fileStatsArray.length;
            
            for (const fileStats of fileStatsArray) {
                stmt.run([
                    fileStats.full_path, fileStats.directory, fileStats.filename, fileStats.extension,
                    fileStats.size, fileStats.created_time, fileStats.modified_time, fileStats.is_directory,
                    fileStats.attributes, fileStats.crc32
                ], function(err) {
                    if (err) {
                        console.error('Database insert error:', err);
                    }
                    
                    completed++;
                    if (completed === total) {
                        stmt.finalize();
                        db.run('COMMIT', (err) => {
                            if (err) {
                                reject(err);
                            } else {
                                resolve();
                            }
                        });
                    }
                });
            }
        });
    });
}

// Check database status for multiple paths
app.post('/api/files/database-status', (req, res) => {
    const { paths } = req.body;
    
    if (!paths || !Array.isArray(paths) || paths.length === 0) {
        return res.status(400).json({ error: 'Paths array is required' });
    }
    
    // Limit batch size to prevent excessive queries
    if (paths.length > 1000) {
        return res.status(400).json({ error: 'Too many paths. Maximum 1000 paths per request.' });
    }
    
    // Sanitize and validate paths
    const sanitizedPaths = paths.map(p => {
        if (typeof p !== 'string') {
            throw new Error('All paths must be strings');
        }
        return path.normalize(p);
    });
    
    // Create placeholders for IN clause
    const placeholders = sanitizedPaths.map(() => '?').join(',');
    const query = `SELECT full_path FROM files WHERE full_path IN (${placeholders})`;
    
    // Set query timeout
    const queryTimeout = setTimeout(() => {
        return res.status(408).json({ error: 'Database query timeout' });
    }, 5000);
    
    db.all(query, sanitizedPaths, (err, rows) => {
        clearTimeout(queryTimeout);
        
        if (err) {
            console.error('Database status check error:', err.message);
            return res.status(500).json({ error: 'Database connection error' });
        }
        
        // Create status map
        const statusMap = {};
        const foundPaths = new Set(rows.map(row => row.full_path));
        
        sanitizedPaths.forEach(filePath => {
            statusMap[filePath] = foundPaths.has(filePath);
        });
        
        res.json({ statusMap });
    });
});

// Get files with search
app.get('/api/files', (req, res) => {
    const { search, skip = 0, limit = 100 } = req.query;
    
    let query = 'SELECT * FROM files';
    let params = [];
    
    if (search) {
        query += ' WHERE filename LIKE ? OR full_path LIKE ? OR extension LIKE ? OR crc32 LIKE ?';
        const searchPattern = `%${search}%`;
        params = [searchPattern, searchPattern, searchPattern, searchPattern];
    }
    
    query += ` ORDER BY is_directory DESC, filename ASC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(skip));
    
    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Get files in hierarchical tree structure
app.get('/api/files/tree', (req, res) => {
    const { search, rootPath } = req.query;
    
    let query = `
        SELECT id, full_path, directory, filename, extension, size, 
               created_time, modified_time, is_directory, crc32
        FROM files
    `;
    let params = [];
    
    // Add search filter if provided
    if (search) {
        query += ' WHERE (filename LIKE ? OR full_path LIKE ? OR extension LIKE ? OR crc32 LIKE ?)';
        const searchPattern = `%${search}%`;
        params = [searchPattern, searchPattern, searchPattern, searchPattern];
    }
    
    // Add root path filter if provided
    if (rootPath) {
        const rootFilter = search ? ' AND ' : ' WHERE ';
        query += rootFilter + 'full_path LIKE ?';
        params.push(`${rootPath}%`);
    }
    
    query += ' ORDER BY directory ASC, is_directory DESC, filename ASC';
    
    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('Tree query error:', err);
            return res.status(500).json({ error: err.message });
        }
        
        try {
            const tree = buildFileTree(rows);
            res.json(tree);
        } catch (buildError) {
            console.error('Tree building error:', buildError);
            res.status(500).json({ error: 'Failed to build file tree' });
        }
    });
});

// Get file by ID
app.get('/api/files/:id', (req, res) => {
    const { id } = req.params;
    
    db.get('SELECT * FROM files WHERE id = ?', [id], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.status(404).json({ error: 'File not found' });
        }
        res.json(row);
    });
});

// Delete file record
app.delete('/api/files/:id', (req, res) => {
    const { id } = req.params;
    
    db.run('DELETE FROM files WHERE id = ?', [id], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'File not found' });
        }
        res.json({ message: 'File record deleted' });
    });
});

// Get statistics
app.get('/api/stats', (req, res) => {
    db.all(`
        SELECT 
            COUNT(CASE WHEN is_directory = 0 THEN 1 END) as total_files,
            COUNT(CASE WHEN is_directory = 1 THEN 1 END) as total_directories,
            SUM(CASE WHEN is_directory = 0 THEN size ELSE 0 END) as total_size_bytes
        FROM files
    `, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows[0]);
    });
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
    db.run('DELETE FROM files', function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: `База данных очищена. Удалено ${this.changes} записей.` });
    });
});

// Backup database
app.post('/api/backup', (req, res) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `./backup_${timestamp}.json`;
    
    db.all('SELECT * FROM files', (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        try {
            fs.writeFileSync(backupPath, JSON.stringify(rows, null, 2));
            res.json({ 
                message: 'Резервная копия создана успешно',
                filename: path.basename(backupPath),
                path: backupPath,
                records: rows.length
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
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
        
        res.json({ message: 'Delete operation completed', results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Check for external archivers
function checkArchivers() {
    const { execSync } = require('child_process');
    const archivers = {};
    
    // Check for 7-Zip
    try {
        execSync('7z', { stdio: 'ignore' });
        archivers['7zip'] = '7z';
    } catch (e) {
        try {
            execSync('"C:\\Program Files\\7-Zip\\7z.exe"', { stdio: 'ignore' });
            archivers['7zip'] = '"C:\\Program Files\\7-Zip\\7z.exe"';
        } catch (e2) {
            // 7-Zip not found
        }
    }
    
    // Check for WinRAR
    try {
        execSync('winrar', { stdio: 'ignore' });
        archivers['winrar'] = 'winrar';
    } catch (e) {
        try {
            execSync('"C:\\Program Files\\WinRAR\\WinRAR.exe"', { stdio: 'ignore' });
            archivers['winrar'] = '"C:\\Program Files\\WinRAR\\WinRAR.exe"';
        } catch (e2) {
            // WinRAR not found
        }
    }
    
    return archivers;
}

// Get available archivers
app.get('/api/archivers', (req, res) => {
    const archivers = checkArchivers();
    res.json({ archivers: Object.keys(archivers), available: Object.keys(archivers).length > 0 });
});

// Archive files with external tools
app.post('/api/files/archive', async (req, res) => {
    const { fileIds, archiveName, archiver: selectedArchiver, destinationPath } = req.body;
    
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
        return res.status(400).json({ error: 'File IDs are required' });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultArchiveName = `archive_${timestamp}`;
    const baseName = archiveName || defaultArchiveName;
    
    try {
        // Ensure archives directory exists
        await fse.ensureDir('./archives');
        
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
        
        // Check available archivers
        const archivers = checkArchivers();
        
        if (Object.keys(archivers).length === 0) {
            return res.status(400).json({ 
                error: 'No external archivers found. Please install 7-Zip or WinRAR.',
                suggestion: 'Download 7-Zip from https://www.7-zip.org/ or WinRAR from https://www.win-rar.com/'
            });
        }
        
        // Use selected archiver or first available
        const useArchiver = selectedArchiver && archivers[selectedArchiver] ? selectedArchiver : Object.keys(archivers)[0];
        const archiverPath = archivers[useArchiver];
        
        let archivePath, command;
        const { execSync } = require('child_process');
        
        if (useArchiver === '7zip') {
            archivePath = path.join(destinationPath || './archives', `${baseName}.7z`);
            // Create file list for 7z
            const fileListPath = path.join('./archives', `filelist_${timestamp}.txt`);
            fs.writeFileSync(fileListPath, filePaths.join('\n'));
            // Use console version with progress and no GUI
            command = `${archiverPath} a -y -bsp1 -bso0 "${archivePath}" @"${fileListPath}"`;
        } else if (useArchiver === 'winrar') {
            archivePath = path.join(destinationPath || './archives', `${baseName}.rar`);
            // Use console version with no GUI
            command = `${archiverPath} a -y -ep1 -ibck "${archivePath}" ${filePaths.map(p => `"${p}"`).join(' ')}`;
        }
        
        console.log('Executing archiver command:', command);
        
        // Execute archiver with progress tracking
        const { spawn } = require('child_process');
        const archiveProcess = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
        
        let progressOutput = '';
        
        archiveProcess.stdout.on('data', (data) => {
            progressOutput += data.toString();
            console.log('Archive progress:', data.toString().trim());
        });
        
        archiveProcess.stderr.on('data', (data) => {
            console.log('Archive stderr:', data.toString().trim());
        });
        
        await new Promise((resolve, reject) => {
            archiveProcess.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Archive process exited with code ${code}`));
                }
            });
            
            archiveProcess.on('error', (error) => {
                reject(error);
            });
        });
        
        // Clean up file list if created
        if (useArchiver === '7zip') {
            const fileListPath = path.join('./archives', `filelist_${timestamp}.txt`);
            if (fs.existsSync(fileListPath)) {
                fs.unlinkSync(fileListPath);
            }
        }
        
        const stats = fs.statSync(archivePath);
        
        res.json({
            message: `Archive created successfully using ${useArchiver}`,
            archiveName: path.basename(archivePath),
            archivePath: archivePath,
            filesAdded: filePaths.length,
            archiveSize: stats.size,
            archiver: useArchiver,
            errors: errors.length > 0 ? errors : undefined
        });
        
    } catch (error) {
        res.status(500).json({ 
            error: `Archive creation failed: ${error.message}`,
            suggestion: 'Make sure the selected archiver is properly installed and accessible'
        });
    }
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
        
        // Check available archivers
        const archivers = checkArchivers();
        
        if (Object.keys(archivers).length === 0) {
            return res.status(400).json({ 
                error: 'No external archivers found. Please install 7-Zip or WinRAR.',
                suggestion: 'Download 7-Zip from https://www.7-zip.org/ or WinRAR from https://www.win-rar.com/'
            });
        }
        
        // Determine file extension based on format
        const extensions = { '7z': '.7z', 'zip': '.zip', 'rar': '.rar' };
        const extension = extensions[format] || '.7z';
        const archivePath = path.join(destination, `${archiveName}${extension}`);
        
        // Use appropriate archiver based on format
        let useArchiver = format === 'rar' ? 'winrar' : '7zip';
        if (!archivers[useArchiver]) {
            useArchiver = Object.keys(archivers)[0]; // Use first available
        }
        
        const archiverPath = archivers[useArchiver];
        
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

// Start the server
startServer();

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