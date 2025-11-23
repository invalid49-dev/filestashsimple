# Testing Quick Reference Guide

## Performance and Memory Tests

### Quick Start

```bash
# Run all tests (quick mode)
node test-benchmark-comparison.js quick

# Run all tests (full comparison)
node test-benchmark-comparison.js

# Run with accurate memory measurements
node --expose-gc test-benchmark-comparison.js quick
```

### Individual Tests

#### Memory Usage Test
```bash
# Basic test
node test-memory-usage.js

# With garbage collection (more accurate)
node --expose-gc test-memory-usage.js
```

**What it tests**:
- Memory consumption under 250 MB target
- Memory breakdown by cache component
- Comparison with old full cache

**Expected Results**:
- Optimized cache: ~173MB estimated, ~200-250MB actual
- Full cache: ~1000MB (estimated baseline)
- Savings: ~75% memory reduction

#### Performance Test
```bash
node test-performance.js
```

**What it tests**:
- Search operations complete under 200ms
- Tree building performance
- Batch loading performance
- Multiple search scenarios

**Expected Results**:
- Average search time: <200ms
- Tree building: <300ms
- Batch loading: <5ms per item

#### Cache Hit Rate Test
```bash
node test-cache-hit-rate.js
```

**What it tests**:
- Cache hit rate above 50% threshold
- LRU eviction behavior
- Batch loading hit rates
- HTTP API endpoints (if server running)

**Expected Results**:
- Hit rate: >50% (typically 60-80%)
- LRU eviction: Working correctly
- Batch operations: High hit rate on repeated access

#### Benchmark Comparison
```bash
# Full comparison (takes longer)
node test-benchmark-comparison.js

# Quick test (optimized cache only)
node test-benchmark-comparison.js quick

# With accurate memory measurements
node --expose-gc test-benchmark-comparison.js quick
```

**What it tests**:
- All memory, performance, and hit rate tests
- Comprehensive comparison with old cache
- Overall system validation

**Expected Results**:
- All tests pass
- Memory savings: ~75%
- Performance: Similar or better
- Hit rate: >50%

## Test Output Interpretation

### Success Indicators
- ✅ Green checkmarks indicate passed tests
- Metrics within target thresholds
- Exit code 0

### Failure Indicators
- ❌ Red X marks indicate failed tests
- Metrics exceeding thresholds
- Exit code 1

### Warning Indicators
- ⚠️ Yellow warnings indicate acceptable but suboptimal results
- May require investigation but not critical

## Common Issues and Solutions

### Issue: "Garbage collection not available"
**Solution**: Run with `--expose-gc` flag
```bash
node --expose-gc test-memory-usage.js
```

### Issue: High memory usage reported
**Cause**: JavaScript object overhead in V8 engine
**Expected**: Actual memory (200-250MB) > Estimated (173MB)
**Action**: This is normal; focus on relative improvements

### Issue: Search performance slower than expected
**Possible Causes**:
- Large database size
- Slow disk I/O
- System resource constraints
**Action**: Check system resources and database size

### Issue: Low cache hit rate
**Possible Causes**:
- Cache size too small
- Access pattern too random
- Test data not representative
**Action**: Adjust hot cache size or review access patterns

### Issue: Server starts during tests
**Cause**: server.js auto-starts when required
**Solution**: Tests now use estimated values for full cache comparison
**Action**: No action needed; this is expected behavior

## CI/CD Integration

### Basic Integration
```bash
#!/bin/bash
# Run quick benchmark
node test-benchmark-comparison.js quick

# Check exit code
if [ $? -eq 0 ]; then
    echo "✅ All tests passed"
    exit 0
else
    echo "❌ Tests failed"
    exit 1
fi
```

### GitHub Actions Example
```yaml
name: Performance Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: node --expose-gc test-benchmark-comparison.js quick
```

### Jenkins Example
```groovy
stage('Performance Tests') {
    steps {
        sh 'node --expose-gc test-benchmark-comparison.js quick'
    }
}
```

## Performance Targets

### Memory Usage
- **Target**: <250 MB
- **Optimized Cache**: ~173 MB estimated
- **Full Cache Baseline**: ~1000 MB
- **Savings**: ~75% reduction

### Search Performance
- **Target**: <200 ms average
- **Expected**: 50-150 ms for most searches
- **Tree Building**: <300 ms
- **Batch Loading**: <5 ms per item

### Cache Hit Rate
- **Target**: >50%
- **Expected**: 60-80% in realistic usage
- **Batch Operations**: >80% on repeated access

## Test Maintenance

### When to Run Tests
- Before committing cache-related changes
- Before releases
- After database schema changes
- When performance issues reported
- Weekly in CI/CD pipeline

### Updating Test Thresholds
If requirements change, update these constants:

**test-memory-usage.js**:
```javascript
const MEMORY_LIMIT_MB = 250;  // Adjust as needed
```

**test-performance.js**:
```javascript
const SEARCH_TIME_LIMIT_MS = 200;  // Adjust as needed
const TEST_ITERATIONS = 10;        // More iterations = more accurate
```

**test-cache-hit-rate.js**:
```javascript
const HIT_RATE_THRESHOLD = 50;  // Adjust as needed
```

## Advanced Usage

### Custom Test Scenarios
```javascript
// Import test functions
const { testOptimizedCacheMemory } = require('./test-memory-usage');
const { testOptimizedCachePerformance } = require('./test-performance');

// Run custom test sequence
async function customTest() {
    const memoryResults = await testOptimizedCacheMemory();
    const perfResults = await testOptimizedCachePerformance();
    
    // Custom analysis
    console.log('Custom metrics:', {
        memoryEfficiency: memoryResults.stats.totalMemoryMB,
        searchSpeed: perfResults.overallStats.avg
    });
}

customTest();
```

### Profiling Integration
```bash
# CPU profiling
node --prof test-performance.js
node --prof-process isolate-*.log > profile.txt

# Memory profiling
node --inspect test-memory-usage.js
# Open chrome://inspect in Chrome
```

### Debugging Tests
```bash
# Enable debug output
DEBUG=* node test-benchmark-comparison.js quick

# Run with inspector
node --inspect-brk test-performance.js
```

## Related Documentation

- [TASK-11-SUMMARY.md](.kiro/specs/memory-optimization/TASK-11-SUMMARY.md) - Detailed implementation summary
- [DATABASE-CACHE-OPTIMIZATION.md](DATABASE-CACHE-OPTIMIZATION.md) - Cache architecture
- [PERFORMANCE-OPTIMIZATION.md](PERFORMANCE-OPTIMIZATION.md) - Performance guide
- [CACHE-QUICK-START.md](CACHE-QUICK-START.md) - Cache usage guide

## Support

### Getting Help
1. Check test output for specific error messages
2. Review this guide for common issues
3. Check related documentation
4. Review test source code for implementation details

### Reporting Issues
When reporting test failures, include:
- Test command used
- Full test output
- System information (OS, Node version, RAM)
- Database size and record count
- Any error messages or stack traces
