/**
 * Test to verify list file encoding
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('🧪 Testing List File Encoding\n');

// Create test path with Cyrillic
const testPath = 'C:\\Filestash Copy\\Тестовый файл для архива.txt';
console.log(`Test path: ${testPath}`);
console.log(`Path length: ${testPath.length}\n`);

// Write list file in UTF-8 (as archive-with-progress.js does)
const listFilePath = path.join(os.tmpdir(), `test_list_${Date.now()}.txt`);
const listContent = testPath;
fs.writeFileSync(listFilePath, listContent, 'utf8');

console.log(`✅ List file created: ${listFilePath}\n`);

// Read back and display
const readContent = fs.readFileSync(listFilePath, 'utf8');
console.log(`Read back (UTF-8): ${readContent}`);
console.log(`Matches original: ${readContent === testPath}\n`);

// Check for BOM
const buffer = fs.readFileSync(listFilePath);
const hasBOM = buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF;
console.log(`Has BOM: ${hasBOM}`);
console.log(`First 20 bytes (hex): ${buffer.slice(0, 20).toString('hex')}\n`);

// Display buffer content
console.log('Buffer content (first 100 bytes):');
console.log(buffer.slice(0, 100).toString('utf8'));

// Cleanup
fs.unlinkSync(listFilePath);
console.log('\n✅ Test complete');
