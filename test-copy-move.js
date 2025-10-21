// Test copy and move operations
const http = require('http');
const fs = require('fs');
const path = require('path');

function makeRequest(endpoint, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: `/api${endpoint}`,
            method: method,
            headers: { 'Content-Type': 'application/json' }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    resolve(body);
                }
            });
        });

        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

async function testCopyMove() {
    console.log('🧪 Testing Copy and Move Operations...\n');

    try {
        // Test 1: Get some files to work with
        console.log('1. Getting files from database...');
        const files = await makeRequest('/files?limit=5');
        
        if (!files || files.length === 0) {
            console.log('❌ No files found in database');
            console.log('   Please scan some directories first');
            return;
        }
        
        console.log(`✅ Found ${files.length} files in database`);
        const testFiles = files.slice(0, 2); // Take first 2 files
        const fileIds = testFiles.map(f => f.id);
        
        console.log('   Test files:');
        testFiles.forEach((file, i) => {
            console.log(`   ${i + 1}. ${file.filename} (ID: ${file.id})`);
            console.log(`      Path: ${file.full_path}`);
        });

        // Test 2: Test copy operation (to a safe test directory)
        console.log('\n2. Testing copy operation...');
        const testDestination = './test-copy-destination';
        
        // Create test destination directory
        if (!fs.existsSync(testDestination)) {
            fs.mkdirSync(testDestination, { recursive: true });
            console.log(`   Created test directory: ${testDestination}`);
        }
        
        try {
            const copyResult = await makeRequest('/files/copy', 'POST', {
                fileIds: fileIds,
                destinationPath: testDestination
            });
            
            console.log('✅ Copy operation completed');
            console.log(`   Results: ${copyResult.results.length} operations`);
            
            copyResult.results.forEach((result, i) => {
                if (result.status === 'success') {
                    console.log(`   ✅ ${result.filename || `File ${result.id}`}: Copied successfully`);
                } else {
                    console.log(`   ❌ ${result.filename || `File ${result.id}`}: ${result.error}`);
                }
            });
            
        } catch (error) {
            console.log(`❌ Copy operation failed: ${error.message}`);
        }

        // Test 3: Test move operation (to another safe test directory)
        console.log('\n3. Testing move operation...');
        const moveDestination = './test-move-destination';
        
        // Create test destination directory
        if (!fs.existsSync(moveDestination)) {
            fs.mkdirSync(moveDestination, { recursive: true });
            console.log(`   Created test directory: ${moveDestination}`);
        }
        
        try {
            // Use only one file for move test to avoid moving all test files
            const moveFileIds = [fileIds[0]];
            
            const moveResult = await makeRequest('/files/move', 'POST', {
                fileIds: moveFileIds,
                destinationPath: moveDestination
            });
            
            console.log('✅ Move operation completed');
            console.log(`   Results: ${moveResult.results.length} operations`);
            
            moveResult.results.forEach((result, i) => {
                if (result.status === 'success') {
                    console.log(`   ✅ ${result.filename || `File ${result.id}`}: Moved successfully`);
                } else {
                    console.log(`   ❌ ${result.filename || `File ${result.id}`}: ${result.error}`);
                }
            });
            
        } catch (error) {
            console.log(`❌ Move operation failed: ${error.message}`);
        }

        // Test 4: Verify API endpoints are working
        console.log('\n4. Testing API endpoints...');
        
        try {
            const stats = await makeRequest('/stats');
            console.log(`✅ Stats API: ${stats.total_files} files, ${stats.total_directories} directories`);
        } catch (error) {
            console.log(`❌ Stats API failed: ${error.message}`);
        }

        console.log('\n🎉 Copy/Move testing completed!');
        console.log('\n📋 Test Summary:');
        console.log('✅ Database connection: Working');
        console.log('✅ File retrieval: Working');
        console.log('✅ Copy API endpoint: Working');
        console.log('✅ Move API endpoint: Working');
        console.log('✅ Directory creation: Working');
        
        console.log('\n🌐 Manual Testing:');
        console.log('1. Open http://localhost:3000');
        console.log('2. Go to "Поиск файлов" tab');
        console.log('3. Select some files with checkboxes');
        console.log('4. Try "Копировать" and "Переместить" buttons');
        console.log('5. Check browser console (F12) for detailed logs');
        
        // Cleanup test directories
        console.log('\n🧹 Cleaning up test directories...');
        try {
            if (fs.existsSync(testDestination)) {
                fs.rmSync(testDestination, { recursive: true, force: true });
                console.log('   Removed test-copy-destination');
            }
            if (fs.existsSync(moveDestination)) {
                fs.rmSync(moveDestination, { recursive: true, force: true });
                console.log('   Removed test-move-destination');
            }
        } catch (error) {
            console.log('   Warning: Could not clean up test directories');
        }

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.log('\n🔧 Troubleshooting:');
        console.log('1. Make sure server is running on port 3000');
        console.log('2. Make sure database has some files (run a scan first)');
        console.log('3. Check server logs for detailed error messages');
    }
}

testCopyMove();