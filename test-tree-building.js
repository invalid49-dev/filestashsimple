/**
 * Test script for optimized tree building functions
 */

const { OptimizedDatabaseCache } = require('./optimized-cache');
const fs = require('fs');

async function testTreeBuilding() {
    console.log('Starting tree building tests...\n');
    
    const cache = new OptimizedDatabaseCache('./filestash.db', {
        hotCacheSize: 1000
    });
    
    try {
        // Load cache
        console.log('=== Loading OptimizedDatabaseCache ===');
        await cache.load();
        console.log('✓ Cache loaded successfully\n');
        
        // Test 1: Get root level directories
        console.log('=== Test 1: Get Root Level Directories ===');
        const rootChildren = cache.getChildrenIds('');
        console.log(`✓ Root has ${rootChildren.size} direct children`);
        
        if (rootChildren.size > 0) {
            const rootIds = Array.from(rootChildren).slice(0, 5);
            const rootFiles = await cache.getFullDataBatch(rootIds);
            console.log(`✓ Loaded ${rootFiles.length} root items:`);
            rootFiles.forEach(file => {
                console.log(`  - ${file.full_path} (${file.is_directory ? 'DIR' : 'FILE'})`);
            });
        }
        console.log('');
        
        // Test 2: Build tree for a specific directory
        console.log('=== Test 2: Build Tree for Specific Directory ===');
        const testDir = 'P:\\Photo';
        const testDirExists = cache.hasPath(testDir);
        
        if (testDirExists) {
            console.log(`✓ Directory "${testDir}" exists in cache`);
            
            const childrenIds = cache.getChildrenIds(testDir);
            console.log(`✓ Directory has ${childrenIds.size} direct children`);
            
            if (childrenIds.size > 0) {
                const startTime = Date.now();
                const children = await cache.getFullDataBatch(Array.from(childrenIds));
                const duration = Date.now() - startTime;
                
                console.log(`✓ Batch loaded ${children.length} children in ${duration}ms`);
                console.log(`  First 5 children:`);
                children.slice(0, 5).forEach(child => {
                    const hasChildren = child.is_directory === 1 && 
                        cache.getChildrenIds(child.full_path).size > 0;
                    console.log(`  - ${child.filename} (${child.is_directory ? 'DIR' : 'FILE'}, hasChildren: ${hasChildren})`);
                });
            }
        } else {
            console.log(`⚠ Directory "${testDir}" not found in cache`);
        }
        console.log('');
        
        // Test 3: Batch expansion of multiple directories
        console.log('=== Test 3: Batch Expansion of Multiple Directories ===');
        const directories = ['P:\\Photo', 'P:\\Photo\\Кристина Асмус'];
        const validDirs = directories.filter(dir => cache.hasPath(dir));
        
        if (validDirs.length > 0) {
            console.log(`✓ Testing batch expansion for ${validDirs.length} directories`);
            
            const startTime = Date.now();
            
            // Collect all child IDs
            const allChildIds = new Set();
            const dirChildMap = new Map();
            
            for (const dir of validDirs) {
                const childIds = cache.getChildrenIds(dir);
                dirChildMap.set(dir, Array.from(childIds));
                childIds.forEach(id => allChildIds.add(id));
            }
            
            // Batch load all children at once
            const allChildren = await cache.getFullDataBatch(Array.from(allChildIds));
            const duration = Date.now() - startTime;
            
            console.log(`✓ Batch loaded ${allChildren.length} total children in ${duration}ms`);
            
            // Show results per directory
            for (const dir of validDirs) {
                const childIds = dirChildMap.get(dir);
                console.log(`  - ${dir}: ${childIds.length} children`);
            }
        } else {
            console.log(`⚠ No valid directories found for batch expansion`);
        }
        console.log('');
        
        // Test 4: Lazy loading simulation
        console.log('=== Test 4: Lazy Loading Simulation ===');
        const lazyTestDir = 'P:\\Photo';
        
        if (cache.hasPath(lazyTestDir)) {
            console.log(`✓ Simulating lazy tree expansion for "${lazyTestDir}"`);
            
            // Step 1: Get minimal index data (no DB query)
            const indexData = cache.getIndexData(cache.getByPath(lazyTestDir).id);
            console.log(`  Step 1: Got index data (in-memory, instant)`);
            console.log(`    - Path: ${indexData.full_path}`);
            console.log(`    - Is Directory: ${indexData.is_directory === 1}`);
            
            // Step 2: Check if has children (no DB query)
            const hasChildren = cache.getChildrenIds(lazyTestDir).size > 0;
            console.log(`  Step 2: Checked hasChildren (in-memory, instant): ${hasChildren}`);
            
            // Step 3: Only load full data when user expands (single DB query)
            if (hasChildren) {
                const startTime = Date.now();
                const childIds = Array.from(cache.getChildrenIds(lazyTestDir));
                const children = await cache.getFullDataBatch(childIds);
                const duration = Date.now() - startTime;
                
                console.log(`  Step 3: Loaded full data on expansion (${duration}ms, 1 DB query)`);
                console.log(`    - Loaded ${children.length} children`);
            }
        }
        console.log('');
        
        // Test 5: Memory efficiency comparison
        console.log('=== Test 5: Memory Efficiency ===');
        const stats = cache.getStats();
        console.log(`✓ Total memory usage: ~${stats.totalMemoryMB}MB`);
        console.log(`  - IndexCache: ~${stats.indexCache.memoryMB}MB (${stats.indexCache.size} records)`);
        console.log(`  - HotDataCache: ~${stats.hotDataCache.memoryMB}MB (${stats.hotDataCache.size}/${stats.hotDataCache.maxSize} records)`);
        console.log(`  - SearchIndex: ~${stats.searchIndex.memoryMB}MB (${stats.searchIndex.size} records)`);
        console.log(`  - Hot cache hit rate: ${stats.hotDataCache.hitRate}`);
        console.log('');
        
        console.log('✅ All tree building tests completed successfully!\n');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    } finally {
        await cache.close();
    }
}

// Run tests
testTreeBuilding().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
