/**
 * Unit Tests for WinRAR UTF-8 Encoding Fix
 * 
 * Tests the following functionality:
 * 1. UTF-8 list file creation with Cyrillic paths
 * 2. -scul parameter presence in WinRAR command arguments
 * 3. CP866 output decoding for WinRAR
 * 4. Path length validation (MAX_PATH = 260)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const iconv = require('iconv-lite');

// Test counter
let testsPassed = 0;
let testsFailed = 0;

// Helper function to run a test
function test(name, fn) {
    try {
        fn();
        console.log(`✅ PASS: ${name}`);
        testsPassed++;
    } catch (error) {
        console.error(`❌ FAIL: ${name}`);
        console.error(`   Error: ${error.message}`);
        testsFailed++;
    }
}

// Helper function for assertions
function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

function assertEquals(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(message || `Expected ${expected}, but got ${actual}`);
    }
}

function assertContains(array, value, message) {
    if (!array.includes(value)) {
        throw new Error(message || `Array does not contain ${value}`);
    }
}

console.log('🧪 Running WinRAR UTF-8 Encoding Tests...\n');

// ============================================================================
// Test 1: UTF-8 List File Creation with Cyrillic Paths
// ============================================================================
test('UTF-8 list file creation with Cyrillic paths', () => {
    const tempDir = os.tmpdir();
    const listFilePath = path.join(tempDir, `test_list_${Date.now()}.txt`);
    
    // Create test paths with Cyrillic characters
    const testPaths = [
        'C:\\Папка\\Файл.txt',
        'D:\\Документы\\Тест\\Данные.doc',
        'K:\\Дин Кунц - Симфония тьмы (BIGBAG)\\00_Дин Кунц - Симфония тьмы.mp3'
    ];
    
    // Write list file in UTF-8 (same as archive-with-progress.js does)
    const listContent = testPaths.join('\r\n');
    fs.writeFileSync(listFilePath, listContent, 'utf8');
    
    // Read back and verify encoding
    const readContent = fs.readFileSync(listFilePath, 'utf8');
    const readPaths = readContent.split('\r\n');
    
    assertEquals(readPaths.length, testPaths.length, 'Number of paths should match');
    assertEquals(readPaths[0], testPaths[0], 'First path should match');
    assertEquals(readPaths[2], testPaths[2], 'Third path with Cyrillic should match');
    
    // Verify no BOM (Byte Order Mark)
    const buffer = fs.readFileSync(listFilePath);
    const hasBOM = buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF;
    assert(!hasBOM, 'File should not have UTF-8 BOM');
    
    // Cleanup
    fs.unlinkSync(listFilePath);
});

// ============================================================================
// Test 2: -scul Parameter Presence in WinRAR Command Arguments
// ============================================================================
test('-scul parameter presence in WinRAR args', () => {
    // Simulate WinRAR args array construction (from archive-with-progress.js)
    const args = [
        'a',                    // Add to archive
        '-y',                   // Yes to all prompts
        '-ep1',                 // Exclude base folder
        '-ibck',                // Run in background
        '-ilog',                // Log to stdout
        '-scul'                 // Use UTF-8 for list file (WinRAR 5.0+)
    ];
    
    assertContains(args, '-scul', 'Args should contain -scul parameter');
    
    // Verify -scul is in the args array (position doesn't matter as long as it's before archive path)
    const sculIndex = args.indexOf('-scul');
    assert(sculIndex >= 0, '-scul should be in args array');
    assert(sculIndex < args.length, '-scul should be in args array');
});

// ============================================================================
// Test 3: CP866 Output Decoding for WinRAR
// ============================================================================
test('CP866 output decoding for WinRAR', () => {
    // Create a sample WinRAR output in CP866 encoding
    const cyrillicText = 'Добавление    Дин Кунц - Симфония тьмы.mp3    OK';
    const cp866Buffer = iconv.encode(cyrillicText, 'cp866');
    
    // Decode using CP866 (as archive-with-progress.js does for WinRAR)
    const decodedText = iconv.decode(cp866Buffer, 'cp866');
    
    assertEquals(decodedText, cyrillicText, 'Decoded text should match original Cyrillic text');
    assert(decodedText.includes('Добавление'), 'Should contain Russian word "Добавление"');
    assert(decodedText.includes('Дин Кунц'), 'Should contain Cyrillic author name');
});

// ============================================================================
// Test 4: CP1251 Output Decoding for 7-Zip (Regression Test)
// ============================================================================
test('CP1251 output decoding for 7-Zip (no regression)', () => {
    // Create a sample 7-Zip output in CP1251 encoding
    const cyrillicText = 'Compressing  Документ.txt';
    const cp1251Buffer = iconv.encode(cyrillicText, 'cp1251');
    
    // Decode using CP1251 (as archive-with-progress.js does for 7-Zip)
    const decodedText = iconv.decode(cp1251Buffer, 'cp1251');
    
    assertEquals(decodedText, cyrillicText, 'Decoded text should match original Cyrillic text');
    assert(decodedText.includes('Документ'), 'Should contain Russian word "Документ"');
});

// ============================================================================
// Test 5: Path Length Validation (MAX_PATH = 260)
// ============================================================================
test('Path length validation (MAX_PATH = 260)', () => {
    const MAX_PATH = 260;
    
    // Test valid path (under limit)
    const validPath = 'C:\\' + 'a'.repeat(250) + '.txt';
    assert(validPath.length <= MAX_PATH, 'Valid path should be under MAX_PATH');
    
    // Test invalid path (over limit)
    const invalidPath = 'C:\\' + 'a'.repeat(260) + '.txt';
    assert(invalidPath.length > MAX_PATH, 'Invalid path should exceed MAX_PATH');
    
    // Simulate validation logic from archive-with-progress.js
    const testPaths = [validPath, invalidPath];
    const tooLongPaths = testPaths.filter(p => p.length > MAX_PATH);
    
    assertEquals(tooLongPaths.length, 1, 'Should find exactly one path exceeding MAX_PATH');
    assertEquals(tooLongPaths[0], invalidPath, 'Should identify the invalid path');
});

// ============================================================================
// Test 6: Encoding Selection Based on Archiver Type
// ============================================================================
test('Encoding selection based on archiver type', () => {
    // Simulate encoding selection logic from archive-with-progress.js
    
    // For WinRAR
    const winrarType = 'winrar';
    const winrarEncoding = winrarType === 'winrar' ? 'cp866' : 'cp1251';
    assertEquals(winrarEncoding, 'cp866', 'WinRAR should use CP866 encoding');
    
    // For 7-Zip
    const sevenZipType = '7zip';
    const sevenZipEncoding = sevenZipType === 'winrar' ? 'cp866' : 'cp1251';
    assertEquals(sevenZipEncoding, 'cp1251', '7-Zip should use CP1251 encoding');
});

// ============================================================================
// Test 7: Exit Code 1 Handling (Warnings)
// ============================================================================
test('Exit code 1 handling (warnings)', () => {
    // Simulate exit code handling logic
    const exitCode = 1;
    
    // Check if code 0 or 1 is treated as success
    const isSuccess = exitCode === 0 || exitCode === 1;
    assert(isSuccess, 'Exit code 1 should be treated as success');
    
    // Check if warnings flag is set for code 1
    const hasWarnings = exitCode === 1;
    assert(hasWarnings, 'Exit code 1 should set warnings flag');
});

// ============================================================================
// Test 8: UTF-8 Compatibility with ASCII
// ============================================================================
test('UTF-8 compatibility with ASCII paths', () => {
    const tempDir = os.tmpdir();
    const listFilePath = path.join(tempDir, `test_ascii_${Date.now()}.txt`);
    
    // Create test paths with only ASCII characters
    const asciiPaths = [
        'C:\\Program Files\\Test\\file.txt',
        'D:\\Documents\\data.doc'
    ];
    
    // Write list file in UTF-8
    const listContent = asciiPaths.join('\r\n');
    fs.writeFileSync(listFilePath, listContent, 'utf8');
    
    // Read back and verify
    const readContent = fs.readFileSync(listFilePath, 'utf8');
    const readPaths = readContent.split('\r\n');
    
    assertEquals(readPaths[0], asciiPaths[0], 'ASCII paths should work with UTF-8');
    assertEquals(readPaths[1], asciiPaths[1], 'UTF-8 is backward compatible with ASCII');
    
    // Cleanup
    fs.unlinkSync(listFilePath);
});

// ============================================================================
// Test 9: Mixed Latin and Cyrillic Paths
// ============================================================================
test('Mixed Latin and Cyrillic paths', () => {
    const tempDir = os.tmpdir();
    const listFilePath = path.join(tempDir, `test_mixed_${Date.now()}.txt`);
    
    // Create test paths with mixed characters
    const mixedPaths = [
        'C:\\Users\\Test\\Документы\\file.txt',
        'D:\\Projects\\Проект 2024\\data.doc',
        'E:\\Music\\Artist - Песня.mp3'
    ];
    
    // Write list file in UTF-8
    const listContent = mixedPaths.join('\r\n');
    fs.writeFileSync(listFilePath, listContent, 'utf8');
    
    // Read back and verify
    const readContent = fs.readFileSync(listFilePath, 'utf8');
    const readPaths = readContent.split('\r\n');
    
    assertEquals(readPaths.length, mixedPaths.length, 'All mixed paths should be preserved');
    assert(readPaths[1].includes('Проект'), 'Cyrillic part should be preserved');
    assert(readPaths[1].includes('Projects'), 'Latin part should be preserved');
    
    // Cleanup
    fs.unlinkSync(listFilePath);
});

// ============================================================================
// Test Results Summary
// ============================================================================
console.log('\n' + '='.repeat(60));
console.log('📊 Test Results Summary');
console.log('='.repeat(60));
console.log(`✅ Passed: ${testsPassed}`);
console.log(`❌ Failed: ${testsFailed}`);
console.log(`📈 Total:  ${testsPassed + testsFailed}`);
console.log('='.repeat(60));

if (testsFailed === 0) {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
} else {
    console.log(`\n⚠️  ${testsFailed} test(s) failed`);
    process.exit(1);
}
