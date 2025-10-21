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

// Create tables
db.serialize(() => {
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
});

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
    const { paths, threads } = req.body;
    const batchSize = parseInt(threads) || 4;
    
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
        duration: 0
    });

    // Start scanning asynchronously
    scanMultipleDirectoriesAsync(paths, scanId, batchSize);

    res.json({
        scanId: scanId,
        message: `Scan started for ${paths.length} directories with batch size ${batchSize}`,
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

// Async scanning function for multiple directories
async function scanMultipleDirectoriesAsync(rootPaths, scanId, batchSize) {
    const progress = scanProgress.get(scanId);
    let scannedCount = 0;
    
    try {
        // Get all files and directories from all root paths
        let allItems = [];
        for (const rootPath of rootPaths) {
            const items = await getAllItemsRecursively(rootPath);
            allItems = allItems.concat(items);
        }
        
        progress.total = allItems.length;
        
        // Process in batches
        for (let i = 0; i < allItems.length; i += batchSize) {
            const batch = allItems.slice(i, i + batchSize);
            
            // Process batch
            for (const itemPath of batch) {
                try {
                    const fileStats = getFileStats(itemPath);
                    
                    if (fileStats) {
                        // Insert into database
                        await new Promise((resolve, reject) => {
                            db.run(`INSERT OR REPLACE INTO files 
                                (full_path, directory, filename, extension, size, created_time, modified_time, is_directory, attributes, crc32)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                [fileStats.full_path, fileStats.directory, fileStats.filename, fileStats.extension,
                                 fileStats.size, fileStats.created_time, fileStats.modified_time, fileStats.is_directory,
                                 fileStats.attributes, fileStats.crc32],
                                function(err) {
                                    if (err) reject(err);
                                    else resolve();
                                }
                            );
                        });
                        
                        scannedCount++;
                        progress.processed = scannedCount;
                    }
                } catch (error) {
                    progress.errors.push(`Error processing ${itemPath}: ${error.message}`);
                }
            }
            
            // Small delay to prevent blocking
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        progress.status = 'completed';
        
    } catch (error) {
        progress.status = 'error';
        progress.errors.push(`Scan error: ${error.message}`);
    }
}

// Helper function to get all items recursively
async function getAllItemsRecursively(rootPath) {
    const items = [];
    const directories = [rootPath];

    while (directories.length > 0) {
        const currentDir = directories.pop();
        items.push(currentDir);

        try {
            const dirItems = fs.readdirSync(currentDir);
            for (const item of dirItems) {
                const fullPath = path.join(currentDir, item);
                try {
                    const stats = fs.statSync(fullPath);
                    items.push(fullPath);
                    
                    if (stats.isDirectory()) {
                        directories.push(fullPath);
                    }
                } catch (e) {
                    // Skip inaccessible items
                }
            }
        } catch (e) {
            // Skip inaccessible directories
        }
    }

    return items;
}

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