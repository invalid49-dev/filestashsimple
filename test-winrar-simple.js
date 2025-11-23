/**
 * Simple Integration Test for WinRAR UTF-8 Fix
 * Tests archiving a real file with Cyrillic name
 */

const fs = require('fs');
const path = require('path');
const { createArchiveWithProgress } = require('./archive-with-progress');

// Find WinRAR
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

async function runTest() {
    console.log('🧪 Simple WinRAR UTF-8 Test\n');
    
    const winrarPath = findWinRAR();
    if (!winrarPath) {
        console.error('❌ WinRAR not found');
        process.exit(1);
    }
    
    console.log(`✅ Found WinRAR: ${winrarPath}\n`);
    
    // Create test file in current directory (not temp)
    const testFile = path.join(__dirname, 'Тестовый файл для архива.txt');
    fs.writeFileSync(testFile, 'Это тестовый файл с кириллическим именем.\nTest content with Cyrillic name.', 'utf8');
    console.log(`✅ Created test file: ${path.basename(testFile)}`);
    console.log(`   Full path: ${testFile}`);
    console.log(`   File exists: ${fs.existsSync(testFile)}\n`);
    
    const archivePath = path.join(__dirname, 'test_archive_cyrillic.rar');
    
    console.log('📦 Starting archiving...\n');
    
    try {
        const result = await createArchiveWithProgress({
            filePaths: [testFile],
            archivePath,
            archiverPath: winrarPath,
            archiverType: 'winrar',
            format: 'rar',
            onProgress: (info) => {
                if (info.progress) {
                    process.stdout.write(`\r   Progress: ${Math.round(info.progress)}%`);
                }
            },
            onConsoleOutput: (msg) => {
                // Clear progress line
                process.stdout.write('\r' + ' '.repeat(50) + '\r');
                console.log(`   ${msg}`);
            }
        });
        
        console.log('\n');
        
        if (result.success) {
            console.log('✅ SUCCESS: Archive created successfully!');
            console.log(`   Archive: ${path.basename(archivePath)}`);
            console.log(`   Size: ${(result.archiveSize / 1024).toFixed(2)} KB`);
            console.log(`   Files: ${result.filesProcessed}`);
            
            if (result.warnings) {
                console.log('   ⚠️  Created with warnings');
            }
            
            // Cleanup
            console.log('\n🧹 Cleaning up...');
            fs.unlinkSync(testFile);
            fs.unlinkSync(archivePath);
            console.log('✅ Test files removed');
            
            process.exit(0);
        } else {
            throw new Error('Archive creation failed');
        }
        
    } catch (error) {
        console.log('\n');
        console.error('❌ FAILED:', error.message);
        
        // Cleanup test file
        if (fs.existsSync(testFile)) {
            fs.unlinkSync(testFile);
        }
        if (fs.existsSync(archivePath)) {
            fs.unlinkSync(archivePath);
        }
        
        process.exit(1);
    }
}

runTest();
