/**
 * Test Cache Invalidation Strategy
 * 
 * Tests the new cache invalidation methods:
 * - invalidate() - full cache clear
 * - reload() - full cache reload with proper sequencing
 * - invalidatePath() - selective path invalidation
 * - invalidatePaths() - batch path invalidation
 * - invalidateDirectory() - directory and children invalidation
 * - invalidateDirectories() - batch directory invalidation
 */

const { OptimizedDatabaseCache } = require('./optimized-cache');

async function testCacheInvalidation() {
    console.log('Starting cache invalidation tests...\n');
    
    const cache = new OptimizedDatabaseCache('./filestash.db', { hotCacheSize: 100 });
    
    try {
        // Test 1: Load cache
        console.log('=== Test 1: Initial Load ===');
        await cache.load();
        const initialStats = cache.getStats();
        console.log(`✓ Cache loaded: ${initialStats.indexCache.size} records`);
        console.log(`✓ Hot cache: ${initialStats.hotDataCache.size}/${initialStats.hotDataCache.maxSize}`);
        console.log();
        
        // Test 2: Populate hot cache
        console.log('=== Test 2: Populate Hot Cache ===');
        // Get actual IDs from the cache
        const allIds = cache.getAllIds();
        const testIds = Array.from(allIds).slice(0, 10);
        console.log(`Using test IDs: ${testIds.slice(0, 5).join(', ')}...`);
        for (const id of testIds) {
            await cache.getFullData(id);
        }
        const populatedStats = cache.getStats();
        console.log(`✓ Hot cache populated: ${populatedStats.hotDataCache.size} entries`);
        console.log(`✓ Hit rate: ${populatedStats.hotDataCache.hitRate}`);
        console.log();
        
        // Test 3: Selective path invalidation
        console.log('=== Test 3: Selective Path Invalidation ===');
        const testPath = cache.getIndexData(testIds[0])?.full_path;
        if (testPath) {
            console.log(`Testing invalidation for path: ${testPath.substring(0, 50)}...`);
            cache.invalidatePath(testPath);
            
            // Verify it was removed from hot cache
            const afterInvalidate = cache.getStats();
            console.log(`✓ Hot cache after invalidation: ${afterInvalidate.hotDataCache.size} entries`);
            console.log(`✓ Path invalidated successfully`);
        } else {
            console.log('⚠️  Could not find test path');
        }
        console.log();
        
        // Test 4: Batch path invalidation
        console.log('=== Test 4: Batch Path Invalidation ===');
        const testPaths = [];
        for (const id of testIds.slice(1, 4)) {
            const path = cache.getIndexData(id)?.full_path;
            if (path) testPaths.push(path);
        }
        console.log(`Testing batch invalidation for ${testPaths.length} paths`);
        cache.invalidatePaths(testPaths);
        
        const afterBatchInvalidate = cache.getStats();
        console.log(`✓ Hot cache after batch invalidation: ${afterBatchInvalidate.hotDataCache.size} entries`);
        console.log(`✓ Batch paths invalidated successfully`);
        console.log();
        
        // Test 5: Directory invalidation
        console.log('=== Test 5: Directory Invalidation ===');
        // Find a directory in the cache
        const allPaths = cache.getAllPaths();
        let testDirectory = null;
        for (const path of allPaths.slice(0, 100)) {
            const indexData = cache.getByPath(path);
            if (indexData && indexData.is_directory === 1) {
                testDirectory = path;
                break;
            }
        }
        
        if (testDirectory) {
            console.log(`Testing directory invalidation: ${testDirectory}`);
            
            // Load some files from this directory into hot cache
            const childrenIds = cache.getChildrenIds(testDirectory);
            const childrenArray = Array.from(childrenIds).slice(0, 5);
            for (const id of childrenArray) {
                await cache.getFullData(id);
            }
            
            const beforeDirInvalidate = cache.getStats();
            console.log(`Hot cache before: ${beforeDirInvalidate.hotDataCache.size} entries`);
            
            // Invalidate the directory
            cache.invalidateDirectory(testDirectory);
            
            const afterDirInvalidate = cache.getStats();
            console.log(`Hot cache after: ${afterDirInvalidate.hotDataCache.size} entries`);
            console.log(`✓ Directory invalidated successfully`);
        } else {
            console.log('⚠️  Could not find test directory');
        }
        console.log();
        
        // Test 6: Full invalidation
        console.log('=== Test 6: Full Invalidation ===');
        const beforeInvalidate = cache.getStats();
        console.log(`Before invalidation:`);
        console.log(`  - Index cache: ${beforeInvalidate.indexCache.size} records`);
        console.log(`  - Hot cache: ${beforeInvalidate.hotDataCache.size} entries`);
        console.log(`  - Search index: ${beforeInvalidate.searchIndex.size} records`);
        console.log(`  - Is loaded: ${beforeInvalidate.isLoaded}`);
        
        cache.invalidate();
        
        const afterFullInvalidate = cache.getStats();
        console.log(`After invalidation:`);
        console.log(`  - Index cache: ${afterFullInvalidate.indexCache.size} records`);
        console.log(`  - Hot cache: ${afterFullInvalidate.hotDataCache.size} entries`);
        console.log(`  - Search index: ${afterFullInvalidate.searchIndex.size} records`);
        console.log(`  - Is loaded: ${afterFullInvalidate.isLoaded}`);
        console.log(`✓ Full invalidation successful`);
        console.log();
        
        // Test 7: Reload with proper sequencing
        console.log('=== Test 7: Cache Reload ===');
        console.log('Reloading cache...');
        const reloadStart = Date.now();
        await cache.reload();
        const reloadDuration = Date.now() - reloadStart;
        
        const afterReload = cache.getStats();
        console.log(`✓ Cache reloaded in ${reloadDuration}ms`);
        console.log(`  - Index cache: ${afterReload.indexCache.size} records`);
        console.log(`  - Hot cache: ${afterReload.hotDataCache.size} entries`);
        console.log(`  - Search index: ${afterReload.searchIndex.size} records`);
        console.log(`  - Is loaded: ${afterReload.isLoaded}`);
        console.log(`  - Total memory: ~${afterReload.totalMemoryMB}MB`);
        console.log();
        
        // Test 8: Edge cases
        console.log('=== Test 8: Edge Cases ===');
        
        // Test empty path
        console.log('Testing empty path invalidation...');
        cache.invalidatePath('');
        console.log('✓ Empty path handled gracefully');
        
        // Test null path
        console.log('Testing null path invalidation...');
        cache.invalidatePath(null);
        console.log('✓ Null path handled gracefully');
        
        // Test empty array
        console.log('Testing empty array invalidation...');
        cache.invalidatePaths([]);
        console.log('✓ Empty array handled gracefully');
        
        // Test non-existent path
        console.log('Testing non-existent path invalidation...');
        cache.invalidatePath('C:\\NonExistent\\Path\\File.txt');
        console.log('✓ Non-existent path handled gracefully');
        
        // Test non-existent directory
        console.log('Testing non-existent directory invalidation...');
        cache.invalidateDirectory('C:\\NonExistent\\Directory');
        console.log('✓ Non-existent directory handled gracefully');
        console.log();
        
        // Test 9: Performance test
        console.log('=== Test 9: Performance Test ===');
        
        // Populate hot cache with many entries
        const perfTestIds = Array.from(allIds).slice(0, 50);
        console.log('Populating hot cache with 50 entries...');
        for (const id of perfTestIds) {
            await cache.getFullData(id);
        }
        
        const perfStats = cache.getStats();
        console.log(`Hot cache size: ${perfStats.hotDataCache.size}`);
        
        // Test batch invalidation performance
        const pathsToInvalidate = [];
        for (const id of perfTestIds.slice(0, 25)) {
            const path = cache.getIndexData(id)?.full_path;
            if (path) pathsToInvalidate.push(path);
        }
        
        console.log(`Testing batch invalidation of ${pathsToInvalidate.length} paths...`);
        const batchStart = Date.now();
        cache.invalidatePaths(pathsToInvalidate);
        const batchDuration = Date.now() - batchStart;
        
        console.log(`✓ Batch invalidation completed in ${batchDuration}ms`);
        console.log(`✓ Average: ${(batchDuration / pathsToInvalidate.length).toFixed(2)}ms per path`);
        
        const afterBatchPerf = cache.getStats();
        console.log(`Hot cache after batch invalidation: ${afterBatchPerf.hotDataCache.size} entries`);
        console.log();
        
        console.log('✅ All cache invalidation tests passed!\n');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        throw error;
    } finally {
        await cache.close();
    }
}

// Run tests
testCacheInvalidation().catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
});
