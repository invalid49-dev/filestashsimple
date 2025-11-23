/**
 * Configuration Test Suite
 * Tests configuration loading, validation, and feature flags
 */

const { 
    config, 
    CACHE_STRATEGIES,
    useOptimizedCache,
    useLegacyCache,
    getOptimizedCacheOptions,
    getLegacyCacheOptions,
    parseBoolean,
    parseInteger,
    validateCacheStrategy
} = require('./config');

console.log('🧪 Testing Configuration Module\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (error) {
        console.error(`❌ ${name}`);
        console.error(`   Error: ${error.message}`);
        failed++;
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

// Test 1: Configuration object exists
test('Configuration object is loaded', () => {
    assert(config !== null && config !== undefined, 'Config should exist');
    assert(typeof config === 'object', 'Config should be an object');
});

// Test 2: Cache strategy validation
test('Cache strategy is valid', () => {
    const validStrategies = Object.values(CACHE_STRATEGIES);
    assert(validStrategies.includes(config.cacheStrategy), 
        `Cache strategy should be one of: ${validStrategies.join(', ')}`);
});

// Test 3: Numeric values are in valid ranges
test('Hot cache size is in valid range', () => {
    assert(config.hotCacheSize >= 1000 && config.hotCacheSize <= 100000,
        'Hot cache size should be between 1,000 and 100,000');
});

test('Search limit is in valid range', () => {
    assert(config.searchLimit >= 100 && config.searchLimit <= 10000,
        'Search limit should be between 100 and 10,000');
});

test('Port is in valid range', () => {
    assert(config.port >= 1024 && config.port <= 65535,
        'Port should be between 1024 and 65535');
});

// Test 4: Boolean parsing
test('parseBoolean handles true values', () => {
    assert(parseBoolean('true', false) === true);
    assert(parseBoolean('1', false) === true);
    assert(parseBoolean('yes', false) === true);
    assert(parseBoolean('TRUE', false) === true);
});

test('parseBoolean handles false values', () => {
    assert(parseBoolean('false', true) === false);
    assert(parseBoolean('0', true) === false);
    assert(parseBoolean('no', true) === false);
    assert(parseBoolean('FALSE', true) === false);
});

test('parseBoolean handles invalid values', () => {
    assert(parseBoolean('invalid', true) === true);
    assert(parseBoolean('invalid', false) === false);
    assert(parseBoolean('', true) === true);
    assert(parseBoolean(null, false) === false);
});

// Test 5: Integer parsing
test('parseInteger handles valid integers', () => {
    assert(parseInteger('100', 50) === 100);
    assert(parseInteger('0', 50) === 0);
    assert(parseInteger('-10', 50) === -10);
});

test('parseInteger handles invalid integers', () => {
    assert(parseInteger('abc', 50) === 50);
    assert(parseInteger('', 50) === 50);
    assert(parseInteger(null, 50) === 50);
});

test('parseInteger respects min/max bounds', () => {
    assert(parseInteger('50', 100, 0, 100) === 50);
    assert(parseInteger('150', 100, 0, 100) === 100); // Clamped to max
    assert(parseInteger('-10', 100, 0, 100) === 0);   // Clamped to min
});

// Test 6: Cache strategy validation
test('validateCacheStrategy accepts valid strategies', () => {
    assert(validateCacheStrategy('full') === 'full');
    assert(validateCacheStrategy('optimized') === 'optimized');
});

test('validateCacheStrategy rejects invalid strategies', () => {
    const result = validateCacheStrategy('invalid');
    assert(result === CACHE_STRATEGIES.OPTIMIZED, 
        'Invalid strategy should return default');
});

test('validateCacheStrategy handles unimplemented strategies', () => {
    const result = validateCacheStrategy('minimal');
    assert(result === CACHE_STRATEGIES.OPTIMIZED,
        'Unimplemented strategy should return default');
});

// Test 7: Cache selection helpers
test('useOptimizedCache returns correct value', () => {
    const testConfig = { cacheStrategy: 'optimized' };
    assert(useOptimizedCache(testConfig) === true);
    
    const testConfig2 = { cacheStrategy: 'full' };
    assert(useOptimizedCache(testConfig2) === false);
});

test('useLegacyCache returns correct value', () => {
    const testConfig = { cacheStrategy: 'full' };
    assert(useLegacyCache(testConfig) === true);
    
    const testConfig2 = { cacheStrategy: 'optimized' };
    assert(useLegacyCache(testConfig2) === false);
});

// Test 8: Cache options helpers
test('getOptimizedCacheOptions returns correct options', () => {
    const testConfig = {
        hotCacheSize: 20000,
        searchLimit: 2000,
        enableCacheStats: true
    };
    
    const options = getOptimizedCacheOptions(testConfig);
    assert(options.hotCacheSize === 20000);
    assert(options.searchLimit === 2000);
    assert(options.enableStats === true);
});

test('getLegacyCacheOptions returns correct options', () => {
    const testConfig = {
        enableCacheStats: false
    };
    
    const options = getLegacyCacheOptions(testConfig);
    assert(options.enableStats === false);
});

// Test 9: Feature flags
test('Feature flags are boolean values', () => {
    assert(typeof config.enableCacheStats === 'boolean');
    assert(typeof config.enableLazyLoading === 'boolean');
    assert(typeof config.enableQueryCache === 'boolean');
    assert(typeof config.autoOpenBrowser === 'boolean');
});

// Test 10: Log level validation
test('Log level is valid', () => {
    const validLevels = ['debug', 'info', 'warn', 'error'];
    assert(validLevels.includes(config.logLevel),
        `Log level should be one of: ${validLevels.join(', ')}`);
});

// Print summary
console.log('\n' + '='.repeat(50));
console.log(`Tests passed: ${passed}`);
console.log(`Tests failed: ${failed}`);
console.log('='.repeat(50));

if (failed > 0) {
    console.log('\n❌ Some tests failed');
    process.exit(1);
} else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
}
