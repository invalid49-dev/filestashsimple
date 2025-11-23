/**
 * Cache Hit Rate Test
 * 
 * Tests that the hot cache achieves a hit rate above 50%
 * Tests both standalone cache and HTTP API endpoints
 */

const { OptimizedDatabaseCache } = require('./optimized-cache');
const http = require('http');

const DB_PATH = './filestash.db';
const HIT_RATE_THRESHOLD = 50; // 50% minimum hit rate
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

// Get cache stats
async function getCacheStats() {
    const result = await httpGet(`${BASE_URL}/api/cache/stats`);
    if (result.status === 200 && result.data.hotDataCache) {
        return result.data.hotDataCache;
    }
    return null;
}

// Get file tree to trigger cache usage
async function getFileTree(directory = '') {
    const url = directory 
        ? `${BASE_URL}/api/files/tree?parent=${encodeURIComponent(directory)}`
        : `${BASE_URL}/api/files/tree`;
    
    const result = await httpGet(url);
    return result.status === 200 ? result.data : null;
}

// Test cache hit/miss tracking
async function testCacheHitMissTracking() {
    console.log('\n🧪 Testing cache hit/miss ratio tracking...\n');
    
    try {
        // Get initial stats
        console.log('📊 Getting initial cache stats...');
        const initialStats = await getCacheStats();
        
        if (!initialStats) {
            console.log('   ❌ Could not get cache stats');
            return;
        }
        
        console.log(`   Initial state:`);
        console.log(`   - Size: ${initialStats.size}/${initialStats.maxSize}`);
        console.log(`   - Hits: ${initialStats.hits}`);
        console.log(`   - Misses: ${initialStats.misses}`);
        console.log(`   - Hit Rate: ${initialStats.hitRate}`);
        
        // Trigger some cache operations by loading file tree
        console.log('\n🔄 Loading file tree to trigger cache operations...');
        const tree = await getFileTree();
        
        if (!tree) {
            console.log('   ❌ Could not load file tree');
            return;
        }
        
        console.log(`   ✅ Loaded tree with ${tree.length || 0} items`);
        
        // Wait a moment for cache to update
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Get updated stats
        console.log('\n📊 Getting updated cache stats...');
        const updatedStats = await getCacheStats();
        
        if (!updatedStats) {
            console.log('   ❌ Could not get updated cache stats');
            return;
        }
        
        console.log(`   Updated state:`);
        console.log(`   - Size: ${updatedStats.size}/${updatedStats.maxSize}`);
        console.log(`   - Hits: ${updatedStats.hits}`);
        console.log(`   - Misses: ${updatedStats.misses}`);
        console.log(`   - Hit Rate: ${updatedStats.hitRate}`);
        
        // Calculate changes
        const hitsDelta = updatedStats.hits - initialStats.hits;
        const missesDelta = updatedStats.misses - initialStats.misses;
        const sizeDelta = updatedStats.size - initialStats.size;
        
        console.log('\n📈 Changes:');
        console.log(`   - Hits: +${hitsDelta}`);
        console.log(`   - Misses: +${missesDelta}`);
        console.log(`   - Cache Size: +${sizeDelta}`);
        
        // Load the same tree again to test cache hits
        console.log('\n🔄 Loading file tree again to test cache hits...');
        await getFileTree();
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const finalStats = await getCacheStats();
        
        if (!finalStats) {
            console.log('   ❌ Could not get final cache stats');
            return;
        }
        
        console.log('\n📊 Final cache stats:');
        console.log(`   - Size: ${finalStats.size}/${finalStats.maxSize}`);
        console.log(`   - Hits: ${finalStats.hits}`);
        console.log(`   - Misses: ${finalStats.misses}`);
        console.log(`   - Hit Rate: ${finalStats.hitRate}`);
        
        const finalHitsDelta = finalStats.hits - updatedStats.hits;
        const finalMissesDelta = finalStats.misses - updatedStats.misses;
        
        console.log('\n📈 Second load changes:');
        console.log(`   - Hits: +${finalHitsDelta}`);
        console.log(`   - Misses: +${finalMissesDelta}`);
        
        // Verify hit/miss tracking is working
        if (finalStats.hits > initialStats.hits || finalStats.misses > initialStats.misses) {
            console.log('\n✅ Cache hit/miss tracking is working correctly!');
        } else {
            console.log('\n⚠️  No cache activity detected (this may be normal if no data was accessed)');
        }
        
    } catch (error) {
        console.log(`\n❌ Error: ${error.message}`);
    }
}

/**
 * Test standalone cache hit rate
 */
async function testStandaloneCacheHitRate() {
    console.log('\n🎯 Testing Standalone Cache Hit Rate...\n');
    
    try {
        // Load cache
        const cache = new OptimizedDatabaseCache(DB_PATH, { hotCacheSize: 1000 });
        await cache.load();
        
        const allIds = cache.getAllIds();
        
        if (allIds.length === 0) {
            console.log('   ❌ No files in database');
            return { passed: false, hitRate: 0 };
        }
        
        // Select a subset of IDs to test (simulate realistic access pattern)
        const testSize = Math.min(500, allIds.length);
        const testIds = allIds.slice(0, testSize);
        
        console.log(`Testing with ${testSize} files...`);
        
        // Phase 1: Initial access (all misses expected)
        console.log('\n📥 Phase 1: Initial access (warming up cache)...');
        for (const id of testIds) {
            await cache.getFullData(id);
        }
        
        let stats = cache.getStats();
        console.log(`   Cache size: ${stats.hotDataCache.size}/${stats.hotDataCache.maxSize}`);
        console.log(`   Hits: ${stats.hotDataCache.hits}`);
        console.log(`   Misses: ${stats.hotDataCache.misses}`);
        console.log(`   Hit Rate: ${stats.hotDataCache.hitRate}`);
        
        // Phase 2: Repeated access (high hit rate expected)
        console.log('\n🔄 Phase 2: Repeated access (testing cache hits)...');
        
        // Access the same files multiple times
        for (let round = 0; round < 3; round++) {
            for (const id of testIds.slice(0, Math.min(100, testIds.length))) {
                await cache.getFullData(id);
            }
        }
        
        stats = cache.getStats();
        console.log(`   Cache size: ${stats.hotDataCache.size}/${stats.hotDataCache.maxSize}`);
        console.log(`   Hits: ${stats.hotDataCache.hits}`);
        console.log(`   Misses: ${stats.hotDataCache.misses}`);
        console.log(`   Hit Rate: ${stats.hotDataCache.hitRate}`);
        
        // Phase 3: Mixed access pattern (realistic usage)
        console.log('\n🔀 Phase 3: Mixed access pattern (realistic usage)...');
        
        // 70% access to recently used files, 30% new files
        const recentIds = testIds.slice(0, Math.min(100, testIds.length));
        const newIds = testIds.slice(100, Math.min(200, testIds.length));
        
        for (let i = 0; i < 200; i++) {
            const id = Math.random() < 0.7 
                ? recentIds[Math.floor(Math.random() * recentIds.length)]
                : newIds[Math.floor(Math.random() * Math.min(newIds.length, 1))];
            
            if (id) {
                await cache.getFullData(id);
            }
        }
        
        stats = cache.getStats();
        console.log(`   Cache size: ${stats.hotDataCache.size}/${stats.hotDataCache.maxSize}`);
        console.log(`   Hits: ${stats.hotDataCache.hits}`);
        console.log(`   Misses: ${stats.hotDataCache.misses}`);
        console.log(`   Hit Rate: ${stats.hotDataCache.hitRate}`);
        
        // Final verdict
        const hitRateValue = parseFloat(stats.hotDataCache.hitRate);
        
        console.log('\n📊 Final Results:');
        console.log(`   Total Accesses: ${stats.hotDataCache.hits + stats.hotDataCache.misses}`);
        console.log(`   Cache Hits: ${stats.hotDataCache.hits}`);
        console.log(`   Cache Misses: ${stats.hotDataCache.misses}`);
        console.log(`   Hit Rate: ${stats.hotDataCache.hitRate}`);
        console.log(`   Threshold: ${HIT_RATE_THRESHOLD}%`);
        
        const passed = hitRateValue >= HIT_RATE_THRESHOLD;
        
        if (passed) {
            console.log(`   ✅ PASS: Hit rate ${hitRateValue}% exceeds ${HIT_RATE_THRESHOLD}% threshold`);
        } else {
            console.log(`   ❌ FAIL: Hit rate ${hitRateValue}% below ${HIT_RATE_THRESHOLD}% threshold`);
        }
        
        // Close database
        await cache.close();
        
        return { passed, hitRate: hitRateValue, stats: stats.hotDataCache };
        
    } catch (error) {
        console.error('\n❌ Test failed with error:', error);
        return { passed: false, hitRate: 0, error: error.message };
    }
}

/**
 * Test batch loading hit rate
 */
async function testBatchLoadingHitRate() {
    console.log('\n📦 Testing Batch Loading Hit Rate...\n');
    
    try {
        // Load cache
        const cache = new OptimizedDatabaseCache(DB_PATH, { hotCacheSize: 1000 });
        await cache.load();
        
        const allIds = cache.getAllIds();
        const testIds = allIds.slice(0, Math.min(100, allIds.length));
        
        console.log(`Testing batch loading with ${testIds.length} files...`);
        
        // First batch load (all misses)
        console.log('\n📥 First batch load...');
        await cache.getFullDataBatch(testIds);
        
        let stats = cache.getStats();
        console.log(`   Hits: ${stats.hotDataCache.hits}`);
        console.log(`   Misses: ${stats.hotDataCache.misses}`);
        console.log(`   Hit Rate: ${stats.hotDataCache.hitRate}`);
        
        // Second batch load (should be mostly hits)
        console.log('\n🔄 Second batch load (same files)...');
        await cache.getFullDataBatch(testIds);
        
        stats = cache.getStats();
        console.log(`   Hits: ${stats.hotDataCache.hits}`);
        console.log(`   Misses: ${stats.hotDataCache.misses}`);
        console.log(`   Hit Rate: ${stats.hotDataCache.hitRate}`);
        
        const hitRateValue = parseFloat(stats.hotDataCache.hitRate);
        const passed = hitRateValue >= HIT_RATE_THRESHOLD;
        
        if (passed) {
            console.log(`   ✅ PASS: Hit rate ${hitRateValue}% exceeds ${HIT_RATE_THRESHOLD}% threshold`);
        } else {
            console.log(`   ⚠️  Hit rate ${hitRateValue}% below ${HIT_RATE_THRESHOLD}% threshold`);
        }
        
        // Close database
        await cache.close();
        
        return { passed, hitRate: hitRateValue };
        
    } catch (error) {
        console.error('\n❌ Test failed with error:', error);
        return { passed: false, hitRate: 0, error: error.message };
    }
}

/**
 * Test LRU eviction behavior
 */
async function testLRUEviction() {
    console.log('\n♻️  Testing LRU Eviction Behavior...\n');
    
    try {
        // Create cache with small size for testing
        const cache = new OptimizedDatabaseCache(DB_PATH, { hotCacheSize: 50 });
        await cache.load();
        
        const allIds = cache.getAllIds();
        const testIds = allIds.slice(0, Math.min(100, allIds.length));
        
        console.log(`Testing LRU with cache size 50, accessing 100 files...`);
        
        // Fill cache beyond capacity
        console.log('\n📥 Filling cache beyond capacity...');
        for (const id of testIds) {
            await cache.getFullData(id);
        }
        
        let stats = cache.getStats();
        console.log(`   Cache size: ${stats.hotDataCache.size}/${stats.hotDataCache.maxSize}`);
        console.log(`   Misses: ${stats.hotDataCache.misses}`);
        
        // Access recent files again (should be hits)
        console.log('\n🔄 Accessing recent files (should be cached)...');
        const recentIds = testIds.slice(-30); // Last 30 files
        
        for (const id of recentIds) {
            await cache.getFullData(id);
        }
        
        stats = cache.getStats();
        const hitRateValue = parseFloat(stats.hotDataCache.hitRate);
        
        console.log(`   Hits: ${stats.hotDataCache.hits}`);
        console.log(`   Misses: ${stats.hotDataCache.misses}`);
        console.log(`   Hit Rate: ${stats.hotDataCache.hitRate}`);
        
        // Access old files (should be evicted)
        console.log('\n🔄 Accessing old files (should be evicted)...');
        const oldIds = testIds.slice(0, 30); // First 30 files
        
        const beforeMisses = stats.hotDataCache.misses;
        
        for (const id of oldIds) {
            await cache.getFullData(id);
        }
        
        stats = cache.getStats();
        const newMisses = stats.hotDataCache.misses - beforeMisses;
        
        console.log(`   New misses: ${newMisses}/${oldIds.length}`);
        console.log(`   LRU eviction working: ${newMisses > 0 ? '✅ Yes' : '❌ No'}`);
        
        // Close database
        await cache.close();
        
        return { 
            passed: newMisses > 0 && hitRateValue >= 30, // Lower threshold for LRU test
            evictionWorking: newMisses > 0 
        };
        
    } catch (error) {
        console.error('\n❌ Test failed with error:', error);
        return { passed: false, evictionWorking: false, error: error.message };
    }
}

/**
 * Run all cache hit rate tests
 */
async function runAllTests() {
    console.log('\n🔬 Cache Hit Rate Test Suite\n');
    console.log('='.repeat(60));
    
    try {
        // Test standalone cache
        const standaloneResults = await testStandaloneCacheHitRate();
        
        // Test batch loading
        const batchResults = await testBatchLoadingHitRate();
        
        // Test LRU eviction
        const lruResults = await testLRUEviction();
        
        // Test HTTP API (if server is running)
        console.log('\n🌐 Testing HTTP API...');
        const httpResults = await testCacheHitMissTracking();
        
        // Summary
        console.log('\n' + '='.repeat(60));
        console.log('\n🎯 TEST SUMMARY\n');
        
        console.log('Standalone Cache:');
        console.log(`   Hit Rate: ${standaloneResults.hitRate}%`);
        console.log(`   Status: ${standaloneResults.passed ? '✅ PASS' : '❌ FAIL'}`);
        
        console.log('\nBatch Loading:');
        console.log(`   Hit Rate: ${batchResults.hitRate}%`);
        console.log(`   Status: ${batchResults.passed ? '✅ PASS' : '⚠️  Below threshold'}`);
        
        console.log('\nLRU Eviction:');
        console.log(`   Working: ${lruResults.evictionWorking ? '✅ Yes' : '❌ No'}`);
        console.log(`   Status: ${lruResults.passed ? '✅ PASS' : '⚠️  Needs review'}`);
        
        console.log('\n' + '='.repeat(60));
        
        const allPassed = standaloneResults.passed && batchResults.passed && lruResults.passed;
        
        if (allPassed) {
            console.log('\n✅ ALL TESTS PASSED\n');
        } else {
            console.log('\n⚠️  SOME TESTS FAILED OR NEED REVIEW\n');
        }
        
        return allPassed;
        
    } catch (error) {
        console.error('\n❌ Test suite failed:', error);
        return false;
    }
}

// Run test
if (require.main === module) {
    console.log('🚀 Starting Cache Hit Rate Tests...');
    console.log(`   Hit rate threshold: ${HIT_RATE_THRESHOLD}%\n`);
    
    runAllTests()
        .then(passed => {
            process.exit(passed ? 0 : 1);
        })
        .catch(error => {
            console.error('❌ Test suite failed:', error);
            process.exit(1);
        });
}

module.exports = { 
    testStandaloneCacheHitRate,
    testBatchLoadingHitRate,
    testLRUEviction,
    testCacheHitMissTracking,
    runAllTests 
};
