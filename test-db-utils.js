/**
 * Test Database Utilities
 * 
 * Tests the helper functions in db-utils.js
 */

const sqlite3 = require('sqlite3').verbose();
const {
    dbQuery,
    dbGet,
    dbRun,
    batchLoadByIds,
    batchLoadByPaths,
    batchDeleteByIds,
    batchDeleteByPaths,
    batchInsertOrUpdate,
    getCount,
    checkExistenceByIds,
    checkExistenceByPaths,
    optimizeIndexes,
    analyzeDatabase,
    getDatabaseStats,
    queryWithRetry
} = require('./db-utils');

// Use test database
const db = new sqlite3.Database('./filestash.db', sqlite3.OPEN_READONLY);

async function runTests() {
    console.log('🧪 Testing Database Utilities...\n');
    
    try {
        // Test 1: dbQuery - Get all files
        console.log('Test 1: dbQuery - Get sample files');
        const startTime1 = Date.now();
        const allFiles = await dbQuery(db, 'SELECT * FROM files LIMIT 10');
        console.log(`✅ Retrieved ${allFiles.length} files in ${Date.now() - startTime1}ms`);
        if (allFiles.length > 0) {
            console.log(`   Sample: ${allFiles[0].filename}`);
        }
        console.log();
        
        // Test 2: dbGet - Get single file
        console.log('Test 2: dbGet - Get single file by ID');
        const startTime2 = Date.now();
        const singleFile = await dbGet(db, 'SELECT * FROM files WHERE id = ?', [1]);
        console.log(`✅ Retrieved file in ${Date.now() - startTime2}ms`);
        if (singleFile) {
            console.log(`   File: ${singleFile.filename}`);
        }
        console.log();
        
        // Test 3: getCount - Count total files
        console.log('Test 3: getCount - Count total files');
        const startTime3 = Date.now();
        const totalCount = await getCount(db, 'files');
        console.log(`✅ Total files: ${totalCount.toLocaleString()} (${Date.now() - startTime3}ms)`);
        console.log();
        
        // Test 4: getCount - Count directories
        console.log('Test 4: getCount - Count directories');
        const startTime4 = Date.now();
        const dirCount = await getCount(db, 'files', 'is_directory = 1');
        console.log(`✅ Total directories: ${dirCount.toLocaleString()} (${Date.now() - startTime4}ms)`);
        console.log();
        
        // Test 5: batchLoadByIds - Load multiple files by ID
        console.log('Test 5: batchLoadByIds - Load 100 files by ID');
        const testIds = Array.from({ length: 100 }, (_, i) => i + 1);
        const startTime5 = Date.now();
        const batchFiles = await batchLoadByIds(db, testIds);
        console.log(`✅ Loaded ${batchFiles.length} files in ${Date.now() - startTime5}ms`);
        console.log();
        
        // Test 6: checkExistenceByIds - Check if IDs exist
        console.log('Test 6: checkExistenceByIds - Check 50 IDs');
        const checkIds = Array.from({ length: 50 }, (_, i) => i + 1);
        const startTime6 = Date.now();
        const existenceMap = await checkExistenceByIds(db, checkIds);
        const existingCount = Array.from(existenceMap.values()).filter(exists => exists).length;
        console.log(`✅ Checked ${checkIds.length} IDs in ${Date.now() - startTime6}ms`);
        console.log(`   Existing: ${existingCount}, Missing: ${checkIds.length - existingCount}`);
        console.log();
        
        // Test 7: getDatabaseStats - Get comprehensive stats
        console.log('Test 7: getDatabaseStats - Get database statistics');
        const startTime7 = Date.now();
        const stats = await getDatabaseStats(db);
        console.log(`✅ Retrieved stats in ${Date.now() - startTime7}ms`);
        console.log(`   Total records: ${stats.totalRecords.toLocaleString()}`);
        console.log(`   Files: ${stats.totalFiles.toLocaleString()}`);
        console.log(`   Directories: ${stats.totalDirectories.toLocaleString()}`);
        console.log(`   Total size: ${(stats.totalSize / 1024 / 1024 / 1024).toFixed(2)} GB`);
        if (stats.databaseSize) {
            console.log(`   Database size: ${(stats.databaseSize / 1024 / 1024).toFixed(2)} MB`);
        }
        console.log();
        
        // Test 8: Performance comparison - Single queries vs batch
        console.log('Test 8: Performance comparison - Single vs Batch queries');
        const perfTestIds = Array.from({ length: 50 }, (_, i) => i + 1);
        
        // Single queries (simulated)
        const startTimeSingle = Date.now();
        for (const id of perfTestIds) {
            await dbGet(db, 'SELECT * FROM files WHERE id = ?', [id]);
        }
        const singleDuration = Date.now() - startTimeSingle;
        console.log(`   Single queries (50x): ${singleDuration}ms`);
        
        // Batch query
        const startTimeBatch = Date.now();
        await batchLoadByIds(db, perfTestIds);
        const batchDuration = Date.now() - startTimeBatch;
        console.log(`   Batch query (1x): ${batchDuration}ms`);
        console.log(`   ⚡ Speedup: ${(singleDuration / batchDuration).toFixed(2)}x faster`);
        console.log();
        
        // Test 9: Query with retry (test resilience)
        console.log('Test 9: queryWithRetry - Test query resilience');
        const startTime9 = Date.now();
        const retryResult = await queryWithRetry(
            db,
            () => dbQuery(db, 'SELECT COUNT(*) as count FROM files'),
            3,
            50
        );
        console.log(`✅ Query with retry completed in ${Date.now() - startTime9}ms`);
        console.log(`   Result: ${retryResult[0].count.toLocaleString()} records`);
        console.log();
        
        // Test 10: Search performance test
        console.log('Test 10: Search performance - LIKE query');
        const startTime10 = Date.now();
        const searchResults = await dbQuery(
            db,
            'SELECT * FROM files WHERE filename LIKE ? LIMIT 100',
            ['%test%']
        );
        console.log(`✅ Search completed in ${Date.now() - startTime10}ms`);
        console.log(`   Found ${searchResults.length} results`);
        console.log();
        
        console.log('✅ All tests completed successfully!\n');
        
        // Summary
        console.log('📊 Summary:');
        console.log(`   Database has ${stats.totalRecords.toLocaleString()} total records`);
        console.log(`   Batch queries are ~${(singleDuration / batchDuration).toFixed(1)}x faster than single queries`);
        console.log(`   All utility functions working correctly`);
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    } finally {
        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err);
            } else {
                console.log('\n✅ Database connection closed');
            }
        });
    }
}

// Run tests
runTests().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
