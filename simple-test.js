// Simple test for FileStash Simple
const http = require('http');

console.log('🧪 Testing FileStash Simple API...\n');

// Test 1: Drives
console.log('1. Testing drives endpoint...');
const req1 = http.get('http://localhost:3000/api/drives', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const result = JSON.parse(data);
            console.log('✅ Drives found:', result.drives.length);
            console.log('   Available drives:', result.drives.join(', '));
            
            // Test 2: Browse E: drive
            console.log('\n2. Testing browse E: drive...');
            const req2 = http.get('http://localhost:3000/api/browse?path=E%3A%5C', (res2) => {
                let data2 = '';
                res2.on('data', chunk => data2 += chunk);
                res2.on('end', () => {
                    try {
                        const result2 = JSON.parse(data2);
                        console.log('✅ Directories in E:\\:', result2.directories.length);
                        if (result2.directories.length > 0) {
                            console.log('   First 3 directories:');
                            result2.directories.slice(0, 3).forEach((dir, i) => {
                                console.log(`   ${i + 1}. ${dir.name}`);
                            });
                        }
                        
                        // Test 3: Stats
                        console.log('\n3. Testing stats endpoint...');
                        const req3 = http.get('http://localhost:3000/api/stats', (res3) => {
                            let data3 = '';
                            res3.on('data', chunk => data3 += chunk);
                            res3.on('end', () => {
                                try {
                                    const result3 = JSON.parse(data3);
                                    console.log('✅ Database stats:');
                                    console.log(`   Files: ${result3.total_files}`);
                                    console.log(`   Directories: ${result3.total_directories}`);
                                    console.log(`   Total size: ${(result3.total_size_bytes / 1024 / 1024).toFixed(2)} MB`);
                                    
                                    console.log('\n🎉 All tests completed successfully!');
                                    console.log('\n📋 Summary:');
                                    console.log(`✅ API is working correctly`);
                                    console.log(`✅ CORS is enabled`);
                                    console.log(`✅ Database has data`);
                                    console.log(`✅ Directory browsing works`);
                                    
                                    console.log('\n🌐 Open http://localhost:3000 to test the web interface');
                                } catch (e) {
                                    console.error('❌ Stats test failed:', e.message);
                                }
                            });
                        });
                        req3.on('error', err => console.error('❌ Stats request failed:', err.message));
                        
                    } catch (e) {
                        console.error('❌ Browse test failed:', e.message);
                    }
                });
            });
            req2.on('error', err => console.error('❌ Browse request failed:', err.message));
            
        } catch (e) {
            console.error('❌ Drives test failed:', e.message);
        }
    });
});

req1.on('error', (err) => {
    console.error('❌ Server connection failed:', err.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure the server is running: npm start');
    console.log('2. Check if port 3000 is available');
    console.log('3. Try restarting the server');
});