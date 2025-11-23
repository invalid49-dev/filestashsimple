/**
 * Test script for cache statistics endpoints
 * Tests the new /api/cache/stats and /api/health endpoints
 */

const http = require('http');

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

// Helper function to make HTTP GET requests
function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, data: parsed });
                } catch (error) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}

// Test cache stats endpoint
async function testCacheStats() {
    console.log('\n🧪 Testing /api/cache/stats endpoint...');
    
    try {
        const result = await httpGet(`${BASE_URL}/api/cache/stats`);
        
        console.log(`   Status: ${result.status}`);
        
        if (result.status === 200) {
            console.log('   ✅ Endpoint is working');
            console.log('\n   Response data:');
            console.log(`   - Cache Strategy: ${result.data.cacheStrategy}`);
            console.log(`   - Is Loaded: ${result.data.isLoaded}`);
            
            if (result.data.cacheStrategy === 'optimized' && result.data.isLoaded) {
                console.log(`   - Total Memory: ${result.data.totalMemoryMB}MB`);
                console.log(`   - Index Cache: ${result.data.indexCache.size} records (${result.data.indexCache.memoryMB}MB)`);
                console.log(`   - Hot Cache: ${result.data.hotDataCache.size}/${result.data.hotDataCache.maxSize} records`);
                console.log(`   - Hot Cache Hit Rate: ${result.data.hotDataCache.hitRate}`);
                console.log(`   - Search Index: ${result.data.searchIndex.size} records (${result.data.searchIndex.memoryMB}MB)`);
                console.log(`   - Load Duration: ${result.data.loadDuration}ms`);
            }
            
            console.log(`   - Process Memory: Heap ${result.data.processMemory.heapUsed}MB / ${result.data.processMemory.heapTotal}MB`);
            console.log(`   - Timestamp: ${result.data.timestamp}`);
        } else if (result.status === 503) {
            console.log('   ⚠️  Cache not loaded yet (expected during startup)');
        } else {
            console.log(`   ❌ Unexpected status code: ${result.status}`);
            console.log(`   Response: ${JSON.stringify(result.data, null, 2)}`);
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
    }
}

// Test health check endpoint
async function testHealthCheck() {
    console.log('\n🧪 Testing /api/health endpoint...');
    
    try {
        const result = await httpGet(`${BASE_URL}/api/health`);
        
        console.log(`   Status: ${result.status}`);
        
        if (result.status === 200) {
            console.log('   ✅ Endpoint is working');
            console.log('\n   Response data:');
            console.log(`   - Status: ${result.data.status}`);
            console.log(`   - Uptime: ${Math.round(result.data.uptime)}s`);
            console.log(`   - Memory: Heap ${result.data.memory.heapUsed}MB / ${result.data.memory.heapTotal}MB, RSS ${result.data.memory.rss}MB`);
            
            if (result.data.cache) {
                console.log(`   - Cache Strategy: ${result.data.cache.strategy}`);
                console.log(`   - Cache Loaded: ${result.data.cache.isLoaded}`);
                
                if (result.data.cache.stats) {
                    console.log(`   - Cache Total Memory: ${result.data.cache.stats.totalMemoryMB}MB`);
                    console.log(`   - Cache Hit Rate: ${result.data.cache.stats.hotDataCache.hitRate}`);
                }
            }
            
            console.log(`   - Timestamp: ${result.data.timestamp}`);
        } else {
            console.log(`   ❌ Unexpected status code: ${result.status}`);
            console.log(`   Response: ${JSON.stringify(result.data, null, 2)}`);
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
    }
}

// Run all tests
async function runTests() {
    console.log('🚀 Starting cache statistics endpoint tests...');
    console.log(`   Target: ${BASE_URL}`);
    
    // Wait a bit for server to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await testCacheStats();
    await testHealthCheck();
    
    console.log('\n✅ All tests completed!\n');
}

// Run tests
runTests().catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
});
