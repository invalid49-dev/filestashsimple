/**
 * Script to fix CRC32 mismatches in database
 * Recalculates CRC32 for files that have mismatches
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const DB_PATH = './filestash.db';

// Fixed CRC32 calculation function
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
                const stream = fs.createReadStream(filePath, { highWaterMark: 256 * 1024 });

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

        // For large files (100MB+), use PARTIAL HASHING
        const chunkSize = 1 * 1024 * 1024; // 1MB chunks
        const hash = crypto.createHash('md5');

        hash.update(Buffer.from(fileSize.toString()));

        const fileHandle = await fs_promises.open(filePath, 'r');

        try {
            // Read first 1MB
            const startBuffer = Buffer.alloc(Math.min(chunkSize, fileSize));
            await fileHandle.read(startBuffer, 0, startBuffer.length, 0);
            hash.update(startBuffer);

            // Read middle 1MB (FIXED: deterministic position)
            if (fileSize > chunkSize * 2) {
                const middlePos = Math.floor((fileSize - chunkSize) / 2);
                const middleBuffer = Buffer.alloc(chunkSize);
                await fileHandle.read(middleBuffer, 0, middleBuffer.length, middlePos);
                hash.update(middleBuffer);
            }

            // Read last 1MB (FIXED: exact position)
            if (fileSize > chunkSize) {
                const endPos = fileSize - chunkSize;
                const endBuffer = Buffer.alloc(chunkSize);
                await fileHandle.read(endBuffer, 0, endBuffer.length, endPos);
                hash.update(endBuffer);
            }

            await fileHandle.close();
            return hash.digest('hex').substring(0, 8);

        } catch (error) {
            await fileHandle.close();
            throw error;
        }

    } catch (error) {
        console.error(`Error calculating CRC32 for ${filePath}:`, error.message);
        return null;
    }
}

// Main function
async function fixCRC32Mismatches() {
    console.log('\n🔧 Fixing CRC32 Mismatches\n');
    console.log('This script recalculates CRC32 for all files in the database.\n');

    const db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
            console.error('❌ Error opening database:', err.message);
            process.exit(1);
        }
    });

    // Get all files with CRC32
    const files = await new Promise((resolve, reject) => {
        db.all(
            `SELECT id, full_path, size, crc32 FROM files WHERE is_directory = 0 AND crc32 IS NOT NULL ORDER BY size DESC`,
            [],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            }
        );
    });

    console.log(`Found ${files.length} files with CRC32 in database.\n`);

    let updated = 0;
    let unchanged = 0;
    let errors = 0;
    let missing = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const filePath = file.full_path;
        const progress = `[${i + 1}/${files.length}]`;

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            console.log(`${progress} ⚠️  Missing: ${filePath}`);
            missing++;
            continue;
        }

        try {
            // Get current file size
            const stats = fs.statSync(filePath);
            const currentSize = stats.size;

            // Recalculate CRC32
            const newCRC32 = await calculateCRC32Optimized(filePath, currentSize);

            if (!newCRC32) {
                console.log(`${progress} ❌ Error calculating: ${filePath}`);
                errors++;
                continue;
            }

            // Compare with database
            if (newCRC32 !== file.crc32) {
                console.log(`${progress} 🔄 Update: ${path.basename(filePath)}`);
                console.log(`   Old CRC32: ${file.crc32}`);
                console.log(`   New CRC32: ${newCRC32}`);
                console.log(`   Size: ${(currentSize / 1024 / 1024).toFixed(2)} MB`);

                // Update database
                await new Promise((resolve, reject) => {
                    db.run(
                        `UPDATE files SET crc32 = ?, size = ? WHERE id = ?`,
                        [newCRC32, currentSize, file.id],
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });

                updated++;
            } else {
                unchanged++;
                if (i % 100 === 0) {
                    console.log(`${progress} ✓ Progress: ${unchanged} files verified...`);
                }
            }

        } catch (error) {
            console.log(`${progress} ❌ Error: ${filePath}`);
            console.log(`   ${error.message}`);
            errors++;
        }
    }

    db.close();

    console.log('\n' + '='.repeat(80));
    console.log('✅ Done!');
    console.log(`   Updated: ${updated}`);
    console.log(`   Unchanged: ${unchanged}`);
    console.log(`   Missing: ${missing}`);
    console.log(`   Errors: ${errors}`);
    console.log('='.repeat(80) + '\n');
}

fixCRC32Mismatches().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
