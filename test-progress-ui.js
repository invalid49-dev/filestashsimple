// Test progress UI functionality
const http = require('http');

function makeRequest(path, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000, // Default port
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                try {
                    const result = JSON.parse(body);
                    resolve(result);
                } catch (e) {
                    resolve(body);
                }
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

async function testProgressUI() {
    try {
        console.log('🧪 Testing integrity check progress UI...');
        
        const checkResult = await makeRequest('/api/files/integrity-check', 'POST', {
            path: '.',
            checkCRC32: false, // Disable CRC32 for faster testing
            checkExistence: true,
            threads: 4
        });
        
        console.log('Check result:', checkResult);
        
        if (checkResult.checkId) {
            console.log(`✅ Integrity check started: ${checkResult.totalFiles} files`);
            
            // Monitor progress for a few iterations
            for (let i = 0; i < 10; i++) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                try {
                    const progress = await makeRequest(`/api/files/integrity-check/progress/${checkResult.checkId}`);
                    
                    if (progress.total > 0) {
                        const percentage = Math.round((progress.processed / progress.total) * 100);
                        const elapsedTime = Math.round((Date.now() - progress.startTime) / 1000);
                        const speed = elapsedTime > 0 ? Math.round(progress.processed / elapsedTime) : 0;
                        
                        console.log(`📊 Progress: ${progress.processed}/${progress.total} (${percentage}%) | Speed: ${speed} files/sec | Time: ${elapsedTime}s`);
                    }
                    
                    if (progress.status === 'completed' || progress.status === 'error') {
                        const finalTime = progress.endTime ? Math.round((progress.endTime - progress.startTime) / 1000) : elapsedTime;
                        console.log(`✅ Completed in ${finalTime}s`);
                        console.log(`📋 Results: ${progress.results.checkedFiles} checked, ${progress.results.missingFiles.length} missing`);
                        break;
                    }
                } catch (err) {
                    console.error('❌ Error checking progress:', err.message);
                    break;
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

// Run test
testProgressUI();