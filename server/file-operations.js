/**
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
        console.error(`Error getting stats for ${filePath}:`, error.message);
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
            // FIXED: Use deterministic middle position
            if (fileSize > chunkSize * 2) {
                // Always calculate middle position the same way
                const middlePos = Math.floor((fileSize - chunkSize) / 2);
                const middleBuffer = Buffer.alloc(chunkSize);
                fs.readSync(fd, middleBuffer, 0, middleBuffer.length, middlePos);
                hash.update(middleBuffer);
            }
            
            // Read last 1MB
            // FIXED: Use exact position without Math.max
            if (fileSize > chunkSize) {
                const endPos = fileSize - chunkSize;
                const endBuffer = Buffer.alloc(chunkSize);
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
