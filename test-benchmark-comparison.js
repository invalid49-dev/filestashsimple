/**
 * Benchmark Comparison Test
 * 
 * Comprehensive comparison between old full cache and new optimized cache
 * Tests memory usage, performance, and cache hit rates
 * 
 * Note: Full cache comparison uses estimated values as server.js auto-starts
 */

const { testOptimizedCacheMemory, testFullCacheMemory } = require('./test-memory-usage');
const { testOptimizedCachePerformance, testFullCachePerformance } = require('./test-performance');
const { testStandaloneCacheHitRate } = require('./test-cache-hit-rate');

/**
 * Format bytes to human readable format
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Format duration to human readable format
 */
function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Calculate percentage difference
 */
function percentDiff(oldVal, newVal) {
    const diff = ((oldVal - newVal) / oldVal) * 100;
    return diff.toFixed(1);
}

/**
 * Run comprehensive benchmark comparison
 */
async function runBenchmarkComparison() {
    console.log('\n' + '='.repeat(70));
    console.log('🔬 COMPREHENSIVE BENCHMARK COMPARISON');
    console.log('   Old Full Cache vs New Optimized Cache');
    console.log('='.repeat(70) + '\n');
    
    const results = {
        memory: {},
        performance: {},
        hitRate: {},
        overall: { passed: true, failures: [] }
    };
    
    try {
        // ===== MEMORY TESTS =====
        console.log('📊 PART 1: MEMORY USAGE TESTS\n');
        console.log('-'.repeat(70));
        
        console.log('\n🔹 Testing Optimized Cache Memory...\n');
        const optimizedMemory = await testOptimizedCacheMemory();
        
        // Wait and clean up
        if (global.gc) global.gc();
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('\n🔹 Testing Full Cache Memory...\n');
        const fullMemory = await testFullCacheMemory();
        
        results.memory = {
            full: fullMemory,
            optimized: optimizedMemory,
            savings: fullMemory.memoryIncrease - optimizedMemory.memoryIncrease,
            savingsPercent: percentDiff(fullMemory.memoryIncrease, optimizedMemory.memoryIncrease)
        };
        
        if (!optimizedMemory.passed) {
            results.overall.passed = false;
            results.overall.failures.push('Memory usage exceeds 250MB limit');
        }
        
        // ===== PERFORMANCE TESTS =====
        console.log('\n' + '-'.repeat(70));
        console.log('\n⚡ PART 2: PERFORMANCE TESTS\n');
        console.log('-'.repeat(70));
        
        console.log('\n🔹 Testing Optimized Cache Performance...\n');
        const optimizedPerf = await testOptimizedCachePerformance();
        
        // Wait and clean up
        if (global.gc) global.gc();
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('\n🔹 Testing Full Cache Performance...\n');
        const fullPerf = await testFullCachePerformance();
        
        results.performance = {
            full: fullPerf,
            optimized: optimizedPerf,
            improvement: fullPerf.overallStats.avg - optimizedPerf.overallStats.avg,
            improvementPercent: percentDiff(fullPerf.overallStats.avg, optimizedPerf.overallStats.avg)
        };
        
        if (!optimizedPerf.allPassed) {
            results.overall.passed = false;
            results.overall.failures.push('Some search operations exceed 200ms limit');
        }
        
        // ===== HIT RATE TESTS =====
        console.log('\n' + '-'.repeat(70));
        console.log('\n🎯 PART 3: CACHE HIT RATE TESTS\n');
        console.log('-'.repeat(70));
        
        const hitRateResults = await testStandaloneCacheHitRate();
        
        results.hitRate = hitRateResults;
        
        if (!hitRateResults.passed) {
            results.overall.passed = false;
            results.overall.failures.push('Cache hit rate below 50% threshold');
        }
        
        // ===== FINAL SUMMARY =====
        console.log('\n' + '='.repeat(70));
        console.log('\n📋 FINAL BENCHMARK SUMMARY\n');
        console.log('='.repeat(70));
        
        // Memory Summary
        console.log('\n📊 Memory Usage:');
        console.log(`   Full Cache:      ${results.memory.full.memoryIncrease}MB`);
        console.log(`   Optimized Cache: ${results.memory.optimized.memoryIncrease}MB`);
        console.log(`   Savings:         ${results.memory.savings}MB (${results.memory.savingsPercent}% reduction)`);
        console.log(`   Status:          ${results.memory.optimized.passed ? '✅ PASS' : '❌ FAIL'}`);
        
        // Performance Summary
        console.log('\n⚡ Search Performance:');
        console.log(`   Full Cache:      ${results.performance.full.overallStats.avg}ms average`);
        console.log(`   Optimized Cache: ${results.performance.optimized.overallStats.avg}ms average`);
        
        if (results.performance.improvement > 0) {
            console.log(`   Improvement:     ${results.performance.improvement}ms faster (${results.performance.improvementPercent}%)`);
        } else {
            console.log(`   Difference:      ${Math.abs(results.performance.improvement)}ms slower (${Math.abs(results.performance.improvementPercent)}%)`);
        }
        console.log(`   Status:          ${results.performance.optimized.allPassed ? '✅ PASS' : '❌ FAIL'}`);
        
        // Hit Rate Summary
        console.log('\n🎯 Cache Hit Rate:');
        console.log(`   Achieved:        ${results.hitRate.hitRate}%`);
        console.log(`   Threshold:       50%`);
        console.log(`   Status:          ${results.hitRate.passed ? '✅ PASS' : '❌ FAIL'}`);
        
        // Load Time Comparison
        console.log('\n⏱️  Load Time:');
        console.log(`   Full Cache:      ${formatDuration(results.memory.full.loadDuration)}`);
        console.log(`   Optimized Cache: ${formatDuration(results.memory.optimized.loadDuration)}`);
        
        const loadTimeDiff = results.memory.full.loadDuration - results.memory.optimized.loadDuration;
        if (loadTimeDiff > 0) {
            console.log(`   Improvement:     ${formatDuration(loadTimeDiff)} faster`);
        } else {
            console.log(`   Difference:      ${formatDuration(Math.abs(loadTimeDiff))} slower`);
        }
        
        // Overall Verdict
        console.log('\n' + '='.repeat(70));
        console.log('\n🏆 OVERALL VERDICT\n');
        
        if (results.overall.passed) {
            console.log('✅ ALL BENCHMARKS PASSED');
            console.log('\nThe optimized cache successfully:');
            console.log(`   ✓ Reduces memory usage by ${results.memory.savingsPercent}%`);
            console.log(`   ✓ Maintains search performance under 200ms`);
            console.log(`   ✓ Achieves cache hit rate above 50%`);
        } else {
            console.log('❌ SOME BENCHMARKS FAILED\n');
            console.log('Failures:');
            results.overall.failures.forEach(failure => {
                console.log(`   ✗ ${failure}`);
            });
        }
        
        // Recommendations
        console.log('\n💡 Key Metrics:');
        console.log(`   Memory Efficiency:  ${results.memory.savingsPercent}% reduction`);
        console.log(`   Performance Impact: ${results.performance.improvementPercent}% ${results.performance.improvement > 0 ? 'faster' : 'slower'}`);
        console.log(`   Cache Efficiency:   ${results.hitRate.hitRate}% hit rate`);
        
        console.log('\n' + '='.repeat(70) + '\n');
        
        return results.overall.passed;
        
    } catch (error) {
        console.error('\n❌ Benchmark comparison failed:', error);
        console.error(error.stack);
        return false;
    }
}

/**
 * Run quick benchmark (optimized cache only)
 */
async function runQuickBenchmark() {
    console.log('\n' + '='.repeat(70));
    console.log('⚡ QUICK BENCHMARK - Optimized Cache Only');
    console.log('='.repeat(70) + '\n');
    
    try {
        // Memory test
        console.log('📊 Memory Usage Test...\n');
        const memoryResults = await testOptimizedCacheMemory();
        
        // Wait and clean up
        if (global.gc) global.gc();
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Performance test
        console.log('\n⚡ Performance Test...\n');
        const perfResults = await testOptimizedCachePerformance();
        
        // Wait and clean up
        if (global.gc) global.gc();
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Hit rate test
        console.log('\n🎯 Hit Rate Test...\n');
        const hitRateResults = await testStandaloneCacheHitRate();
        
        // Summary
        console.log('\n' + '='.repeat(70));
        console.log('\n📋 QUICK BENCHMARK SUMMARY\n');
        console.log('='.repeat(70));
        
        console.log('\n📊 Results:');
        console.log(`   Memory Usage:    ${memoryResults.memoryIncrease}MB ${memoryResults.passed ? '✅' : '❌'}`);
        console.log(`   Search Time:     ${perfResults.overallStats.avg}ms ${perfResults.allPassed ? '✅' : '❌'}`);
        console.log(`   Cache Hit Rate:  ${hitRateResults.hitRate}% ${hitRateResults.passed ? '✅' : '❌'}`);
        
        const allPassed = memoryResults.passed && perfResults.allPassed && hitRateResults.passed;
        
        console.log('\n' + '='.repeat(70));
        
        if (allPassed) {
            console.log('\n✅ ALL TESTS PASSED\n');
        } else {
            console.log('\n❌ SOME TESTS FAILED\n');
        }
        
        return allPassed;
        
    } catch (error) {
        console.error('\n❌ Quick benchmark failed:', error);
        return false;
    }
}

// Command line interface
if (require.main === module) {
    const args = process.argv.slice(2);
    const mode = args[0] || 'full';
    
    console.log('🚀 Starting Benchmark Tests...');
    
    if (mode === 'quick') {
        console.log('   Mode: Quick (optimized cache only)');
        console.log('   Note: Run with --expose-gc for accurate memory measurements\n');
        
        runQuickBenchmark()
            .then(passed => {
                process.exit(passed ? 0 : 1);
            })
            .catch(error => {
                console.error('❌ Benchmark failed:', error);
                process.exit(1);
            });
    } else {
        console.log('   Mode: Full comparison (old vs new cache)');
        console.log('   Note: Run with --expose-gc for accurate memory measurements');
        console.log('   Tip: Use "quick" argument for faster testing\n');
        
        runBenchmarkComparison()
            .then(passed => {
                process.exit(passed ? 0 : 1);
            })
            .catch(error => {
                console.error('❌ Benchmark failed:', error);
                process.exit(1);
            });
    }
}

module.exports = {
    runBenchmarkComparison,
    runQuickBenchmark
};
