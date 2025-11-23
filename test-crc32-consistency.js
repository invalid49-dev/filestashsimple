/**
 * Test script to verify CRC32 calculation consistency
 * Tests that the same file always produces the same hash
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// Copy of the fixed calculateCRC32Optimized function
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

        // Add file size to hash
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
                console.log(`  Middle position: ${middlePos} (${Math.round(middlePos / 1024 / 1024)}MB)`);
            }

            // Read last 1MB (FIXED: exact position)
            if (fileSize > chunkSize) {
                const endPos = fileSize - chunkSize;
                const endBuffer = Buffer.alloc(chunkSize);
                await fileHandle.read(endBuffer, 0, endBuffer.length, endPos);
                hash.update(endBuffer);
                console.log(`  End position: ${endPos} (${Math.round(endPos / 1024 / 1024)}MB)`);
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

// Test function
async function testConsistency(filePath, iterations = 5) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Testing: ${filePath}`);
    console.log(`${'='.repeat(80)}`);

    if (!fs.existsSync(filePath)) {
        console.log(`❌ File not found: ${filePath}`);
        return;
    }

    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);

    console.log(`File size: ${fileSizeMB} MB (${fileSize} bytes)`);
    console.log(`\nCalculating hash ${iterations} times...\n`);

    const hashes = [];
    for (let i = 0; i < iterations; i++) {
        console.log(`Iteration ${i + 1}:`);
        const hash = await calculateCRC32Optimized(filePath, fileSize);
        hashes.push(hash);
        console.log(`  Hash: ${hash}\n`);
    }

    // Check consistency
    const allSame = hashes.every(h => h === hashes[0]);
    
    console.log(`${'='.repeat(80)}`);
    if (allSame) {
        console.log(`✅ SUCCESS: All ${iterations} hashes are identical!`);
        console.log(`   Hash value: ${hashes[0]}`);
    } else {
        console.log(`❌ FAILURE: Hashes are different!`);
        console.log(`   Unique hashes found:`);
        const unique = [...new Set(hashes)];
        unique.forEach((h, i) => {
            const count = hashes.filter(x => x === h).length;
            console.log(`   ${i + 1}. ${h} (appeared ${count} times)`);
        });
    }
    console.log(`${'='.repeat(80)}\n`);

    return allSame;
}

// Main test
async function main() {
    console.log('\n🧪 CRC32 Consistency Test\n');
    console.log('This script tests that the same file always produces the same hash.\n');

    // Test with command line argument or default path
    const testPath = process.argv[2];

    if (!testPath) {
        console.log('Usage: node test-crc32-consistency.js <file-path>');
        console.log('\nExample:');
        console.log('  node test-crc32-consistency.js "P:\\Video\\S\\some-video.mp4"');
        console.log('  node test-crc32-consistency.js "S:\\Фото\\Броневичек\\Video\\DSCF6963.AVI"');
        return;
    }

    const success = await testConsistency(testPath, 5);

    if (success) {
        console.log('✅ Test PASSED: CRC32 calculation is consistent!\n');
        process.exit(0);
    } else {
        console.log('❌ Test FAILED: CRC32 calculation is inconsistent!\n');
        process.exit(1);
    }
}

main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
});
