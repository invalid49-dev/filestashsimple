/**
 * Cache Migration Test Script
 * 
 * Tests the migration and rollback mechanism between cache strategies.
 * Validates that both cache implementations work correctly and can be switched at runtime.
 */

const { OptimizedDatabaseCache } = require('./optimized-cache');
const sqlite3 = require('sqlite3').verbose();

// ANSI color codes for better output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
    log(`✅ ${message}`, 'green');
}

function logError(message) {
    log(`❌ ${message}`, 'red');
}

function logInfo(message) {
    log(`ℹ️  ${message}`, 'blue');
}

function logWarning(message) {
    log(`⚠️  ${message}`, 'yellow');
}

// Simple legacy cache implementation for testing
class LegacyDatabaseCache {
    constructor() {
        this.allFiles = null;
        this.filesByPath = null;
        this.isLoaded = false;
    }
    
    async loadFromDatabase(db) {
        return new Promise((resolve, reject) => {
            db.all('SELECT * FROM files', [], (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                this.allFiles = rows;
                this.filesByPath = new Map();
                
                rows.forEach(row => {
                    this.filesByPath.set(row.full_path, row);
                });
                
                this.isLoaded = true;
                resolve();
            });
        });
    }
    
    search(searchTerm) {
        if (!this.isLoaded) {
            throw new Error('Cache not loaded');
        }
        
        const lowerSearch = searchTerm.toLowerCase();
        return this.allFiles.filter(file => 
            file.filename.toLowerCase().includes(lowerSearch) ||
            file.full_path.toLowerCase().includes(lowerSearch)
        );
    }
    
    size() {
        return this.isLoaded ? this.allFiles.length : 0;
    }
}

// Test configuration
const TEST_DB_PATH = './filestash.db';
const TEST_SEARCH_TERM = 'test';
const TEST_SEARCH_LIMIT = 100;

// Test results
const testResults = {
    legacy: {},
    optimized: {},
    comparison: {}
};

/**
 * Test legacy cache implementation
 */
async function testLegacyCache() {
    logInfo('Testing Legacy Cache Implementation...');
    
    const db = new sqlite3.Database(TEST_DB_PATH, sqlite3.OPEN_READONLY);
    const cache = new LegacyDatabaseCache();
    
    try {
        // Test 1: Load cache
        logInfo('  Test 1: Loading legacy cache...');
        const loadStart = Date.now();
        await cache.loadFromDatabase(db);
        const loadDuration = Date.now() - loadStart;
        
        testResults.legacy.loadDuration = loadDuration;
        testResults.legacy.recordCount = cache.size();
        logSuccess(`  Loaded ${cache.size()} records in ${loadDuration}ms`);
        
        // Test 2: Search performance
        logInfo('  Test 2: Testing search performance...');
        const searchStart = Date.now();
        const searchResults = cache.search(TEST_SEARCH_TERM).slice(0, TEST_SEARCH_LIMIT);
        const searchDuration = Date.now() - searchStart;
        
        testResults.legacy.searchDuration = searchDuration;
        testResults.legacy.searchResults = searchResults.length;
        logSuccess(`  Found ${searchResults.length} results in ${searchDuration}ms`);
        
        // Test 3: Memory usage
        const memoryUsage = process.memoryUsage();
        testResults.legacy.memoryMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
        logInfo(`  Memory usage: ${testResults.legacy.memoryMB}MB`);
        
        db.close();
        return true;
        
    } catch (error) {
        logError(`  Legacy cache test failed: ${error.message}`);
        db.close();
        return false;
    }
}

/**
 * Test optimized cache implementation
 */
async function testOptimizedCache() {
    logInfo('Testing Optimized Cache Implementation...');
    
    const cache = new OptimizedDatabaseCache(TEST_DB_PATH, {
        hotCacheSize: 10000,
        searchLimit: 1000,
        enableStats: true
    });
    
    try {
        // Test 1: Load cache
        logInfo('  Test 1: Loading optimized cache...');
        const loadStart = Date.now();
        await cache.load();
        const loadDuration = Date.now() - loadStart;
        
        testResults.optimized.loadDuration = loadDuration;
        testResults.optimized.recordCount = cache.size();
        logSuccess(`  Loaded ${cache.size()} records in ${loadDuration}ms`);
        
        // Test 2: Search performance
        logInfo('  Test 2: Testing search performance...');
        const searchStart = Date.now();
        const searchResults = await cache.search(TEST_SEARCH_TERM, TEST_SEARCH_LIMIT);
        const searchDuration = Date.now() - searchStart;
        
        testResults.optimized.searchDuration = searchDuration;
        testResults.optimized.searchResults = searchResults.length;
        logSuccess(`  Found ${searchResults.length} results in ${searchDuration}ms`);
        
        // Test 3: Memory usage
        const stats = cache.getStats();
        testResults.optimized.memoryMB = stats.totalMemoryMB;
        testResults.optimized.cacheStats = stats;
        logInfo(`  Estimated cache memory: ${stats.totalMemoryMB}MB`);
        
        const processMemory = process.memoryUsage();
        testResults.optimized.processMemoryMB = Math.round(processMemory.heapUsed / 1024 / 1024);
        logInfo(`  Process memory usage: ${testResults.optimized.processMemoryMB}MB`);
        
        // Test 4: Hot cache hit rate
        logInfo('  Test 3: Testing hot cache...');
        
        // Warm up cache with some IDs
        const testIds = Array.from({ length: 100 }, (_, i) => i + 1);
        await cache.getFullDataBatch(testIds);
        
        // Test repeated access (should hit cache)
        const hotCacheStart = Date.now();
        await cache.getFullDataBatch(testIds);
        const hotCacheDuration = Date.now() - hotCacheStart;
        
        const hotStats = cache.getStats().hotDataCache;
        testResults.optimized.hotCacheHitRate = hotStats.hitRate;
        logSuccess(`  Hot cache hit rate: ${hotStats.hitRate} (${hotCacheDuration}ms for 100 records)`);
        
        await cache.close();
        return true;
        
    } catch (error) {
        logError(`  Optimized cache test failed: ${error.message}`);
        return false;
    }
}

/**
 * Compare cache implementations
 */
function compareImplementations() {
    logInfo('Comparing Cache Implementations...');
    
    // Compare load times
    const loadImprovement = ((testResults.legacy.loadDuration - testResults.optimized.loadDuration) / testResults.legacy.loadDuration * 100).toFixed(1);
    if (testResults.optimized.loadDuration < testResults.legacy.loadDuration) {
        logSuccess(`  Load time: ${Math.abs(loadImprovement)}% faster`);
    } else {
        logWarning(`  Load time: ${Math.abs(loadImprovement)}% slower`);
    }
    testResults.comparison.loadImprovement = loadImprovement;
    
    // Compare search times
    const searchImprovement = ((testResults.legacy.searchDuration - testResults.optimized.searchDuration) / testResults.legacy.searchDuration * 100).toFixed(1);
    if (testResults.optimized.searchDuration < testResults.legacy.searchDuration) {
        logSuccess(`  Search time: ${Math.abs(searchImprovement)}% faster`);
    } else {
        logWarning(`  Search time: ${Math.abs(searchImprovement)}% slower`);
    }
    testResults.comparison.searchImprovement = searchImprovement;
    
    // Compare memory usage
    const memoryReduction = ((testResults.legacy.memoryMB - testResults.optimized.processMemoryMB) / testResults.legacy.memoryMB * 100).toFixed(1);
    if (testResults.optimized.processMemoryMB < testResults.legacy.memoryMB) {
        logSuccess(`  Memory usage: ${Math.abs(memoryReduction)}% reduction`);
    } else {
        logWarning(`  Memory usage: ${Math.abs(memoryReduction)}% increase`);
    }
    testResults.comparison.memoryReduction = memoryReduction;
    
    // Overall assessment
    log('\n' + '='.repeat(60), 'cyan');
    log('MIGRATION TEST RESULTS', 'cyan');
    log('='.repeat(60), 'cyan');
    
    console.log('\nLegacy Cache:');
    console.log(`  Load Time:    ${testResults.legacy.loadDuration}ms`);
    console.log(`  Search Time:  ${testResults.legacy.searchDuration}ms`);
    console.log(`  Memory:       ${testResults.legacy.memoryMB}MB`);
    console.log(`  Records:      ${testResults.legacy.recordCount}`);
    
    console.log('\nOptimized Cache:');
    console.log(`  Load Time:    ${testResults.optimized.loadDuration}ms`);
    console.log(`  Search Time:  ${testResults.optimized.searchDuration}ms`);
    console.log(`  Cache Memory: ${testResults.optimized.memoryMB}MB`);
    console.log(`  Process Mem:  ${testResults.optimized.processMemoryMB}MB`);
    console.log(`  Records:      ${testResults.optimized.recordCount}`);
    console.log(`  Hit Rate:     ${testResults.optimized.hotCacheHitRate}`);
    
    console.log('\nImprovement:');
    console.log(`  Load Time:    ${loadImprovement}%`);
    console.log(`  Search Time:  ${searchImprovement}%`);
    console.log(`  Memory:       ${memoryReduction}%`);
    
    log('='.repeat(60), 'cyan');
    
    // Recommendation
    if (parseFloat(memoryReduction) > 30 && parseFloat(searchImprovement) > -20) {
        logSuccess('\n✅ RECOMMENDATION: Use optimized cache');
        logInfo('   Significant memory reduction with acceptable performance');
    } else if (parseFloat(memoryReduction) < 0) {
        logWarning('\n⚠️  RECOMMENDATION: Use legacy cache');
        logInfo('   Optimized cache uses more memory than legacy');
    } else {
        logInfo('\n💡 RECOMMENDATION: Test with your specific workload');
        logInfo('   Results are mixed, performance depends on usage patterns');
    }
}

/**
 * Test migration and rollback
 */
async function testMigrationRollback() {
    logInfo('\nTesting Migration and Rollback...');
    
    try {
        // Simulate migration: optimized -> legacy -> optimized
        logInfo('  Simulating cache strategy switches...');
        
        // Load optimized cache
        const optimizedCache = new OptimizedDatabaseCache(TEST_DB_PATH, { hotCacheSize: 10000 });
        await optimizedCache.load();
        logSuccess('  ✓ Optimized cache loaded');
        
        // Perform operation
        const results1 = await optimizedCache.search('test', 10);
        logSuccess(`  ✓ Search completed: ${results1.length} results`);
        
        await optimizedCache.close();
        
        // Switch to legacy cache
        const db = new sqlite3.Database(TEST_DB_PATH, sqlite3.OPEN_READONLY);
        const legacyCache = new LegacyDatabaseCache();
        await legacyCache.loadFromDatabase(db);
        logSuccess('  ✓ Switched to legacy cache');
        
        // Perform operation
        const results2 = legacyCache.search('test').slice(0, 10);
        logSuccess(`  ✓ Search completed: ${results2.length} results`);
        
        db.close();
        
        // Switch back to optimized cache
        const optimizedCache2 = new OptimizedDatabaseCache(TEST_DB_PATH, { hotCacheSize: 10000 });
        await optimizedCache2.load();
        logSuccess('  ✓ Switched back to optimized cache');
        
        // Perform operation
        const results3 = await optimizedCache2.search('test', 10);
        logSuccess(`  ✓ Search completed: ${results3.length} results`);
        
        await optimizedCache2.close();
        
        logSuccess('\n✅ Migration and rollback test passed');
        return true;
        
    } catch (error) {
        logError(`\n❌ Migration and rollback test failed: ${error.message}`);
        return false;
    }
}

/**
 * Main test runner
 */
async function runTests() {
    log('\n' + '='.repeat(60), 'cyan');
    log('CACHE MIGRATION TEST SUITE', 'cyan');
    log('='.repeat(60) + '\n', 'cyan');
    
    try {
        // Test legacy cache
        const legacySuccess = await testLegacyCache();
        if (!legacySuccess) {
            logError('Legacy cache tests failed, aborting');
            process.exit(1);
        }
        
        console.log('');
        
        // Test optimized cache
        const optimizedSuccess = await testOptimizedCache();
        if (!optimizedSuccess) {
            logError('Optimized cache tests failed, aborting');
            process.exit(1);
        }
        
        console.log('');
        
        // Compare implementations
        compareImplementations();
        
        // Test migration and rollback
        const migrationSuccess = await testMigrationRollback();
        if (!migrationSuccess) {
            logError('Migration tests failed');
            process.exit(1);
        }
        
        log('\n' + '='.repeat(60), 'green');
        log('ALL TESTS PASSED ✅', 'green');
        log('='.repeat(60) + '\n', 'green');
        
        process.exit(0);
        
    } catch (error) {
        logError(`\nTest suite failed: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

// Run tests
runTests();
