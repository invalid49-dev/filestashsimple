/**
 * Test script for optimized cache classes
 * 
 * This script tests the core functionality of IndexCache, HotDataCache, and SearchIndex
 */

const sqlite3 = require('sqlite3').verbose();
const { IndexCache, HotDataCache, SearchIndex, OptimizedDatabaseCache, dbQuery } = require('./optimized-cache');

// Test database connection
const db = new sqlite3.Database('./filestash.db');

async function testIndexCache() {
    console.log('\n=== Testing IndexCache ===');
    
    const indexCache = new IndexCache();
    
    // Test loading
    await indexCache.load(db);
    
    console.log(`✓ Loaded ${indexCache.size()} records`);
    console.log(`✓ Memory usage: ~${indexCache.estimateMemoryUsage()}MB`);
    
    // Test getById
    const allIds = indexCache.getAllIds();
    if (allIds.length > 0) {
        const testId = allIds[0];
        const record = indexCache.getById(testId);
        console.log(`✓ getById(${testId}):`, record ? 'Found' : 'Not found');
    }
    
    // Test getByPath
    const allPaths = indexCache.getAllPaths();
    if (allPaths.length > 0) {
        const testPath = allPaths[0];
        const record = indexCache.getByPath(testPath);
        console.log(`✓ getByPath("${testPath}"):`, record ? 'Found' : 'Not found');
    }
    
    // Test getChildrenIds
    const directories = Array.from(indexCache.directoryIndex.keys());
    if (directories.length > 0) {
        const testDir = directories[0];
        const children = indexCache.getChildrenIds(testDir);
        console.log(`✓ getChildrenIds("${testDir}"): ${children.size} children`);
    }
    
    // Test hasPath
    if (allPaths.length > 0) {
        const exists = indexCache.hasPath(allPaths[0]);
        console.log(`✓ hasPath: ${exists}`);
    }
    
    return indexCache;
}

async function testHotDataCache() {
    console.log('\n=== Testing HotDataCache ===');
    
    const hotCache = new HotDataCache(100); // Small size for testing
    
    // Test set and get
    const testData = {
        id: 1,
        full_path: 'C:\\test\\file.txt',
        filename: 'file.txt',
        size: 1024
    };
    
    hotCache.set(1, testData);
    console.log('✓ Set test data');
    
    const retrieved = hotCache.get(1);
    console.log('✓ Get test data:', retrieved ? 'Found' : 'Not found');
    
    // Test cache miss
    const missing = hotCache.get(999999);
    console.log('✓ Get missing data:', missing ? 'Found (ERROR!)' : 'Not found (correct)');
    
    // Test LRU eviction
    for (let i = 0; i < 150; i++) {
        hotCache.set(i, { id: i, data: `test${i}` });
    }
    console.log(`✓ Added 150 items to cache with maxSize=100`);
    
    // First item should be evicted
    const evicted = hotCache.get(0);
    console.log('✓ First item evicted:', evicted ? 'Still there (ERROR!)' : 'Evicted (correct)');
    
    // Recent items should still be there
    const recent = hotCache.get(149);
    console.log('✓ Recent item still cached:', recent ? 'Found (correct)' : 'Not found (ERROR!)');
    
    // Test stats
    const stats = hotCache.getStats();
    console.log('✓ Cache stats:', stats);
    console.log(`✓ Memory usage: ~${hotCache.estimateMemoryUsage()}MB`);
    
    return hotCache;
}

async function testSearchIndex() {
    console.log('\n=== Testing SearchIndex ===');
    
    const searchIndex = new SearchIndex();
    
    // Test loading
    await searchIndex.load(db);
    
    console.log(`✓ Loaded ${searchIndex.size()} records`);
    console.log(`✓ Memory usage: ~${searchIndex.estimateMemoryUsage()}MB`);
    
    // Test search with common terms
    const searchTerms = ['test', 'file', 'txt', 'doc'];
    
    for (const term of searchTerms) {
        const results = searchIndex.search(term, 10);
        console.log(`✓ Search "${term}": ${results.length} results`);
        
        if (results.length > 0) {
            console.log(`  Top result ID: ${results[0]}`);
        }
    }
    
    // Test multi-word search
    const multiWordResults = searchIndex.search('test file', 10);
    console.log(`✓ Multi-word search "test file": ${multiWordResults.length} results`);
    
    return searchIndex;
}

async function testMemoryFootprint() {
    console.log('\n=== Testing Memory Footprint ===');
    
    const before = process.memoryUsage();
    console.log('Memory before loading caches:');
    console.log(`  Heap Used: ${Math.round(before.heapUsed / 1024 / 1024)}MB`);
    console.log(`  Heap Total: ${Math.round(before.heapTotal / 1024 / 1024)}MB`);
    
    // Load all caches
    const indexCache = new IndexCache();
    const hotCache = new HotDataCache(10000);
    const searchIndex = new SearchIndex();
    
    await Promise.all([
        indexCache.load(db),
        searchIndex.load(db)
    ]);
    
    const after = process.memoryUsage();
    console.log('\nMemory after loading caches:');
    console.log(`  Heap Used: ${Math.round(after.heapUsed / 1024 / 1024)}MB`);
    console.log(`  Heap Total: ${Math.round(after.heapTotal / 1024 / 1024)}MB`);
    
    const diff = (after.heapUsed - before.heapUsed) / 1024 / 1024;
    console.log(`\n✓ Memory increase: ~${Math.round(diff)}MB`);
    
    // Estimated memory
    const estimated = indexCache.estimateMemoryUsage() + 
                     hotCache.estimateMemoryUsage() + 
                     searchIndex.estimateMemoryUsage();
    console.log(`✓ Estimated memory: ~${estimated}MB`);
    
    return { indexCache, hotCache, searchIndex };
}

async function testOptimizedDatabaseCache() {
    console.log('\n=== Testing OptimizedDatabaseCache ===');
    
    const cache = new OptimizedDatabaseCache('./filestash.db', { hotCacheSize: 1000 });
    
    // Test parallel loading
    console.log('Testing parallel loading...');
    await cache.load();
    console.log(`✓ Cache loaded successfully in ${cache.loadDuration}ms`);
    
    // Test getStats
    const stats = cache.getStats();
    console.log('✓ Cache statistics:', JSON.stringify(stats, null, 2));
    
    // Test getFullData with hot cache
    const allIds = cache.getAllIds();
    if (allIds.length > 0) {
        const testId = allIds[0];
        
        // First call - should be cache miss
        const data1 = await cache.getFullData(testId);
        console.log(`✓ getFullData(${testId}):`, data1 ? 'Found' : 'Not found');
        
        // Second call - should be cache hit
        const data2 = await cache.getFullData(testId);
        console.log(`✓ getFullData(${testId}) again:`, data2 ? 'Found (cached)' : 'Not found');
    }
    
    // Test getFullDataBatch
    if (allIds.length >= 10) {
        const testIds = allIds.slice(0, 10);
        const batchData = await cache.getFullDataBatch(testIds);
        console.log(`✓ getFullDataBatch([${testIds.length} ids]): ${batchData.length} records loaded`);
    }
    
    // Test search
    const searchResults = await cache.search('test', 10);
    console.log(`✓ search("test"): ${searchResults.length} results`);
    
    // Test buildTree
    const treeData = await cache.buildTree('');
    console.log(`✓ buildTree(""): ${treeData.length} root items`);
    
    // Test getByPath
    const allPaths = cache.getAllPaths();
    if (allPaths.length > 0) {
        const testPath = allPaths[0];
        const pathData = cache.getByPath(testPath);
        console.log(`✓ getByPath("${testPath}"):`, pathData ? 'Found' : 'Not found');
    }
    
    // Test getChildrenIds
    const childrenIds = cache.getChildrenIds('');
    console.log(`✓ getChildrenIds(""): ${childrenIds.size} children`);
    
    // Test hasPath
    if (allPaths.length > 0) {
        const exists = cache.hasPath(allPaths[0]);
        console.log(`✓ hasPath: ${exists}`);
    }
    
    // Test size
    console.log(`✓ size(): ${cache.size()} total files`);
    
    // Test memory estimation
    const memoryMB = cache.estimateMemoryUsage();
    console.log(`✓ estimateMemoryUsage(): ~${memoryMB}MB`);
    
    // Test cache hit rate after operations
    const finalStats = cache.getStats();
    console.log(`✓ Final hot cache hit rate: ${finalStats.hotDataCache.hitRate}`);
    
    // Close database
    await cache.close();
    console.log('✓ Database connection closed');
    
    return cache;
}

async function runAllTests() {
    try {
        console.log('Starting optimized cache tests...\n');
        
        await testIndexCache();
        await testHotDataCache();
        await testSearchIndex();
        await testMemoryFootprint();
        await testOptimizedDatabaseCache();
        
        console.log('\n✅ All tests completed successfully!');
        
    } catch (error) {
        console.error('\n❌ Test failed:', error);
    } finally {
        db.close();
    }
}

// Run tests
runAllTests();
