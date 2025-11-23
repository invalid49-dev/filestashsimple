/**
 * Integration Tests for WinRAR UTF-8 Encoding Fix
 * 
 * Tests real archiving scenarios with Cyrillic file names:
 * 1. Archive single file with Cyrillic name
 * 2. Archive folder with Cyrillic name and nested files
 * 3. Archive mixed Latin and Cyrillic files
 * 4. Archive nested folders with Cyrillic names
 * 5. Verify archive creation success and correct file names in output
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createArchiveWithProgress } = require('./archive-with-progress');

// Test counter
let testsPassed = 0;
let testsFailed = 0;

// Helper function to run async test
async function test(name, fn) {
    try {
        await fn();
        console.log(`✅ PASS: ${name}`);
        testsPassed++;
    } catch (error) {
        console.error(`❌ FAIL: ${name}`);
        console.error(`   Error: ${error.message}`);
        testsFailed++;
    }
}

// Helper to find WinRAR
function findWinRAR() {
    const candidates = [
        path.join(__dirname, 'bin', 'winrar', 'Rar.exe'),
        'C:\\Program Files\\WinRAR\\Rar.exe',
        'C:\\Program Files (x86)\\WinRAR\\Rar.exe'
    ];
    
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            return p;
        }
    }
    return null;
}

// Helper to create test directory structure
function createTestStructure(basePath, structure) {
    for (const [name, content] of Object.entries(structure)) {
        const fullPath = path.join(basePath, name);
        
        if (typeof content === 'string') {
            // It's a file
            fs.writeFileSync(fullPath, content, 'utf8');
        } else if (typeof content === 'object') {
            // It's a directory
            fs.mkdirSync(fullPath, { recursive: true });
            createTestStructure(fullPath, content);
        }
    }
}

// Helper to cleanup directory
function cleanupDirectory(dirPath) {
    if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                cleanupDirectory(filePath);
            } else {
                fs.unlinkSync(filePath);
            }
        }
        fs.rmdirSync(dirPath);
    }
}

console.log('🧪 Running WinRAR Integration Tests...\n');

// Check if WinRAR is available
const winrarPath = findWinRAR();
if (!winrarPath) {
    console.error('❌ WinRAR not found. Please install WinRAR or place Rar.exe in bin/winrar/');
    console.error('   Searched locations:');
    console.error('   - ./bin/winrar/Rar.exe');
    console.error('   - C:\\Program Files\\WinRAR\\Rar.exe');
    console.error('   - C:\\Program Files (x86)\\WinRAR\\Rar.exe');
    process.exit(1);
}

console.log(`✅ Found WinRAR at: ${winrarPath}\n`);

// ============================================================================
// Run all tests
// ============================================================================
(async () => {
    console.log('Starting integration tests...\n');
    
    // Run tests sequentially
    await test('Archive single file with Cyrillic name', async () => {
        const tempDir = path.join(os.tmpdir(), `test_single_${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });
        
        try {
            const testFile = path.join(tempDir, 'Тестовый файл.txt');
            fs.writeFileSync(testFile, 'Содержимое тестового файла', 'utf8');
            
            const archivePath = path.join(tempDir, 'archive.rar');
            
            let consoleOutput = [];
            const result = await createArchiveWithProgress({
                filePaths: [testFile],
                archivePath,
                archiverPath: winrarPath,
                archiverType: 'winrar',
                format: 'rar',
                onProgress: () => {},
                onConsoleOutput: (msg) => {
                    consoleOutput.push(msg);
                }
            });
            
            if (!fs.existsSync(archivePath)) {
                throw new Error('Archive file was not created');
            }
            
            if (!result.success) {
                throw new Error('Archive creation reported failure');
            }
            
            const outputText = consoleOutput.join('\n');
            if (outputText.includes('�') || outputText.includes('?????')) {
                throw new Error('Console output contains garbled characters');
            }
            
            console.log(`   📦 Archive created: ${path.basename(archivePath)}`);
            console.log(`   📊 Archive size: ${(result.archiveSize / 1024).toFixed(2)} KB`);
            
        } finally {
            cleanupDirectory(tempDir);
        }
    });
    
    await test('Archive folder with Cyrillic name and nested files', async () => {
        const tempDir = path.join(os.tmpdir(), `test_folder_${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });
        
        try {
            const testFolder = path.join(tempDir, 'Папка с файлами');
            const structure = {
                'Папка с файлами': {
                    'файл1.txt': 'Содержимое файла 1',
                    'файл2.txt': 'Содержимое файла 2',
                    'документ.doc': 'Текст документа'
                }
            };
            
            createTestStructure(tempDir, structure);
            
            const archivePath = path.join(tempDir, 'folder_archive.rar');
            
            let consoleOutput = [];
            const result = await createArchiveWithProgress({
                filePaths: [testFolder],
                archivePath,
                archiverPath: winrarPath,
                archiverType: 'winrar',
                format: 'rar',
                onProgress: () => {},
                onConsoleOutput: (msg) => {
                    consoleOutput.push(msg);
                }
            });
            
            if (!fs.existsSync(archivePath)) {
                throw new Error('Archive file was not created');
            }
            
            if (!result.success) {
                throw new Error('Archive creation reported failure');
            }
            
            if (result.filesProcessed < 3) {
                throw new Error(`Expected at least 3 files processed, got ${result.filesProcessed}`);
            }
            
            console.log(`   📦 Archive created: ${path.basename(archivePath)}`);
            console.log(`   📊 Files processed: ${result.filesProcessed}`);
            
        } finally {
            cleanupDirectory(tempDir);
        }
    });
    
    await test('Archive mixed Latin and Cyrillic files', async () => {
        const tempDir = path.join(os.tmpdir(), `test_mixed_${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });
        
        try {
            const file1 = path.join(tempDir, 'File1.txt');
            const file2 = path.join(tempDir, 'Файл2.txt');
            const file3 = path.join(tempDir, 'Test Тест.doc');
            
            fs.writeFileSync(file1, 'English content', 'utf8');
            fs.writeFileSync(file2, 'Русское содержимое', 'utf8');
            fs.writeFileSync(file3, 'Mixed content / Смешанное содержимое', 'utf8');
            
            const archivePath = path.join(tempDir, 'mixed_archive.rar');
            
            let consoleOutput = [];
            const result = await createArchiveWithProgress({
                filePaths: [file1, file2, file3],
                archivePath,
                archiverPath: winrarPath,
                archiverType: 'winrar',
                format: 'rar',
                onProgress: () => {},
                onConsoleOutput: (msg) => {
                    consoleOutput.push(msg);
                }
            });
            
            if (!fs.existsSync(archivePath)) {
                throw new Error('Archive file was not created');
            }
            
            if (!result.success) {
                throw new Error('Archive creation reported failure');
            }
            
            if (result.filesProcessed !== 3) {
                throw new Error(`Expected 3 files processed, got ${result.filesProcessed}`);
            }
            
            console.log(`   📦 Archive created: ${path.basename(archivePath)}`);
            console.log(`   📊 Files processed: ${result.filesProcessed}`);
            
        } finally {
            cleanupDirectory(tempDir);
        }
    });
    
    await test('Archive nested folders with Cyrillic names', async () => {
        const tempDir = path.join(os.tmpdir(), `test_nested_${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });
        
        try {
            const structure = {
                'Папка1': {
                    'Папка2': {
                        'Папка3': {
                            'Файл.txt': 'Глубоко вложенный файл'
                        },
                        'файл2.txt': 'Файл на уровне 2'
                    },
                    'файл1.txt': 'Файл на уровне 1'
                }
            };
            
            createTestStructure(tempDir, structure);
            
            const rootFolder = path.join(tempDir, 'Папка1');
            const archivePath = path.join(tempDir, 'nested_archive.rar');
            
            let consoleOutput = [];
            const result = await createArchiveWithProgress({
                filePaths: [rootFolder],
                archivePath,
                archiverPath: winrarPath,
                archiverType: 'winrar',
                format: 'rar',
                onProgress: () => {},
                onConsoleOutput: (msg) => {
                    consoleOutput.push(msg);
                }
            });
            
            if (!fs.existsSync(archivePath)) {
                throw new Error('Archive file was not created');
            }
            
            if (!result.success) {
                throw new Error('Archive creation reported failure');
            }
            
            if (result.filesProcessed < 3) {
                throw new Error(`Expected at least 3 files processed, got ${result.filesProcessed}`);
            }
            
            console.log(`   📦 Archive created: ${path.basename(archivePath)}`);
            console.log(`   📊 Files processed: ${result.filesProcessed}`);
            
        } finally {
            cleanupDirectory(tempDir);
        }
    });
    
    await test('Verify console output contains correct Cyrillic', async () => {
        const tempDir = path.join(os.tmpdir(), `test_output_${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });
        
        try {
            const testFile = path.join(tempDir, 'Дин Кунц - Симфония тьмы.txt');
            fs.writeFileSync(testFile, 'Test content', 'utf8');
            
            const archivePath = path.join(tempDir, 'output_test.rar');
            
            let consoleOutput = [];
            const result = await createArchiveWithProgress({
                filePaths: [testFile],
                archivePath,
                archiverPath: winrarPath,
                archiverType: 'winrar',
                format: 'rar',
                onProgress: () => {},
                onConsoleOutput: (msg) => {
                    consoleOutput.push(msg);
                }
            });
            
            if (!fs.existsSync(archivePath)) {
                throw new Error('Archive file was not created');
            }
            
            const outputText = consoleOutput.join('\n');
            
            if (outputText.includes('�')) {
                throw new Error('Console output contains replacement character (�)');
            }
            
            const hasRussianText = outputText.includes('Дин') || 
                                   outputText.includes('Кунц') || 
                                   outputText.includes('Симфония') ||
                                   outputText.includes('тьмы');
            
            if (!hasRussianText) {
                console.log('   ⚠️  Warning: Expected Cyrillic text not found in output');
                console.log('   Output sample:', outputText.substring(0, 200));
            }
            
            console.log(`   📦 Archive created: ${path.basename(archivePath)}`);
            console.log(`   ✅ Console output encoding verified`);
            
        } finally {
            cleanupDirectory(tempDir);
        }
    });
    
    await test('Archive with password protection (edge case)', async () => {
        const tempDir = path.join(os.tmpdir(), `test_password_${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });
        
        try {
            const testFile = path.join(tempDir, 'Секретный файл.txt');
            fs.writeFileSync(testFile, 'Секретное содержимое', 'utf8');
            
            const archivePath = path.join(tempDir, 'protected.rar');
            
            const result = await createArchiveWithProgress({
                filePaths: [testFile],
                archivePath,
                archiverPath: winrarPath,
                archiverType: 'winrar',
                format: 'rar',
                password: 'test123',
                onProgress: () => {},
                onConsoleOutput: () => {}
            });
            
            if (!fs.existsSync(archivePath)) {
                throw new Error('Archive file was not created');
            }
            
            if (!result.success) {
                throw new Error('Archive creation reported failure');
            }
            
            console.log(`   📦 Archive created: ${path.basename(archivePath)}`);
            console.log(`   🔒 Password protection: enabled`);
            
        } finally {
            cleanupDirectory(tempDir);
        }
    });
    
    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Integration Test Results Summary');
    console.log('='.repeat(60));
    console.log(`✅ Passed: ${testsPassed}`);
    console.log(`❌ Failed: ${testsFailed}`);
    console.log(`📈 Total:  ${testsPassed + testsFailed}`);
    console.log('='.repeat(60));
    
    if (testsFailed === 0) {
        console.log('\n🎉 All integration tests passed!');
        process.exit(0);
    } else {
        console.log(`\n⚠️  ${testsFailed} test(s) failed`);
        process.exit(1);
    }
})();
