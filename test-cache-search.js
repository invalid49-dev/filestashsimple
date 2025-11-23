/**
 * Test cache hit/miss tracking with search operations
 */

const http = require('http');

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (error) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        }).on('error', reject);
    });
}

async function getCacheStats() {
    const result = await httpGet(`${BASE_URL}/api/cache/stats`);
    return result.status === 200 ? result.data : null;
}

async function searchFiles(query) {
    const result = await httpGet(`${BASE_URL}/api/files/tree?search=${encodeURIComponent(query)}`);
    return result.status === 200 ? result.data : null;
}

async function testCacheWithSearch() {
    console.log('🧪 Testing cache hit/miss tracking with search...\n');
    
    try {
        // Initial stats
        const initial = await getCacheStats();
        console.log('📊 Initial cache stats:');
        console.log(`   Hot Cache: ${initial.hotDataCache.size}/${initial.hotDataCache.maxSize}`);
        console.log(`   Hits: ${initial.hotDataCache.hits}, Misses: ${initial.hotDataCache.misses}`);
        console.log(`   Hit Rate: ${initial.hotDataCache.hitRate}`);
        
        // Perform search
        console.log('\n🔍 Searching for "test"...');
        const results = await searchFiles('test');
        console.log(`   Found ${results ? results.length : 0} results`);
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Check stats after search
        const afterSearch = await getCacheStats();
        console.log('\n📊 After first search:');
        console.log(`   Hot Cache: ${afterSearch.hotDataCache.size}/${afterSearch.hotDataCache.maxSize}`);
        console.log(`   Hits: ${afterSearch.hotDataCache.hits}, Misses: ${afterSearch.hotDataCache.misses}`);
        console.log(`   Hit Rate: ${afterSearch.hotDataCache.hitRate}`);
        console.log(`   Change: +${afterSearch.hotDataCache.size - initial.hotDataCache.size} cached items`);
        
        // Search again (should hit cache)
        console.log('\n🔍 Searching for "test" again...');
        await searchFiles('test');
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const afterSecond = await getCacheStats();
        console.log('\n📊 After second search:');
        console.log(`   Hot Cache: ${afterSecond.hotDataCache.size}/${afterSecond.hotDataCache.maxSize}`);
        console.log(`   Hits: ${afterSecond.hotDataCache.hits}, Misses: ${afterSecond.hotDataCache.misses}`);
        console.log(`   Hit Rate: ${afterSecond.hotDataCache.hitRate}`);
        console.log(`   New Hits: +${afterSecond.hotDataCache.hits - afterSearch.hotDataCache.hits}`);
        
        if (afterSecond.hotDataCache.hits > afterSearch.hotDataCache.hits) {
            console.log('\n✅ Cache hit tracking is working! Repeated searches are hitting the cache.');
        } else {
            console.log('\n⚠️  No cache hits detected on repeated search');
        }
        
    } catch (error) {
        console.log(`\n❌ Error: ${error.message}`);
    }
}

console.log('🚀 Starting cache search test...\n');
testCacheWithSearch().then(() => {
    console.log('\n✅ Test completed!\n');
}).catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
});
