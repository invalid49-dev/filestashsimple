// Test script for FileStash Simple API
const http = require('http');

function makeRequest(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: `/api${path}`,
            method: 'GET'
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.end();
    });
}

async function testAPI() {
    console.log('🧪 Testing FileStash Simple API...\n');

    try {
        // Test drives endpoint
        console.log('1. Testing /api/drives');
        const drives = await makeRequest('/drives');
        console.log('✅ Drives:', drives.drives);

        // Test browse endpoint
        console.log('\n2. Testing /api/browse');
        const browse = await makeRequest('/browse?path=E:\\');
        console.log(`✅ Browse E:\\ - Found ${browse.directories.length} directories`);
        
        if (browse.directories.length > 0) {
            console.log('   First few directories:');
            browse.directories.slice(0, 3).forEach((dir, i) => {
                console.log(`   ${i + 1}. ${dir.name}`);
            });
        }

        // Test specific directory
        console.log('\n3. Testing specific directory');
        const testPath = 'E:\\7 Days To Die v1.4 (b8) by Pioneer';
        try {
            const specific = await makeRequest(`/browse?path=${encodeURIComponent(testPath)}`);
            console.log(`✅ Browse specific directory - Found ${specific.directories.length} subdirectories`);
        } catch (e) {
            console.log('⚠️  Specific directory not found or inaccessible');
        }

        // Test stats endpoint
        console.log('\n4. Testing /api/stats');
        const stats = await makeRequest('/stats');
        console.log('✅ Stats:', stats);

        console.log('\n🎉 All API tests completed successfully!');
        console.log('\n📖 Next steps:');
        console.log('1. Open http://localhost:3000 in your browser');
        console.log('2. Try the directory browsing functionality');
        console.log('3. Test the expand/collapse buttons');

    } catch (error) {
        console.error('❌ API test failed:', error.message);
    }
}

testAPI();