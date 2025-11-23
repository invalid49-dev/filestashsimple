/**
 * Configuration Module for FileStash
 * 
 * Manages application configuration including cache strategies,
 * feature flags, and runtime settings.
 */

/**
 * Cache strategy options
 */
const CACHE_STRATEGIES = {
    FULL: 'full',           // Legacy full cache (high memory)
    OPTIMIZED: 'optimized', // New optimized cache (low memory)
    MINIMAL: 'minimal',     // Future: minimal cache
    TIERED: 'tiered'        // Future: tiered cache
};

/**
 * Default configuration values
 */
const DEFAULTS = {
    // Cache configuration
    CACHE_STRATEGY: CACHE_STRATEGIES.OPTIMIZED,
    HOT_CACHE_SIZE: 10000,
    QUERY_CACHE_SIZE: 100 * 1024 * 1024, // 100MB
    
    // Search configuration
    SEARCH_LIMIT: 1000,
    SEARCH_TIMEOUT: 5000, // ms
    
    // Performance configuration
    SCAN_THREADS: 4,
    BATCH_SIZE: 1000,
    
    // Feature flags
    ENABLE_CACHE_STATS: true,
    ENABLE_LAZY_LOADING: true,
    ENABLE_QUERY_CACHE: true,
    
    // Server configuration
    PORT: 3000,
    AUTO_OPEN_BROWSER: true,
    
    // Logging
    LOG_LEVEL: 'info', // 'debug', 'info', 'warn', 'error'
    LOG_CACHE_STATS_INTERVAL: 5 * 60 * 1000 // 5 minutes
};

/**
 * Parse boolean environment variable
 */
function parseBoolean(value, defaultValue) {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }
    
    const normalized = String(value).toLowerCase().trim();
    
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        return true;
    }
    
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        return false;
    }
    
    return defaultValue;
}

/**
 * Parse integer environment variable
 */
function parseInteger(value, defaultValue, min = null, max = null) {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }
    
    const parsed = parseInt(value, 10);
    
    if (isNaN(parsed)) {
        console.warn(`⚠️  Invalid integer value: ${value}, using default: ${defaultValue}`);
        return defaultValue;
    }
    
    if (min !== null && parsed < min) {
        console.warn(`⚠️  Value ${parsed} below minimum ${min}, using minimum`);
        return min;
    }
    
    if (max !== null && parsed > max) {
        console.warn(`⚠️  Value ${parsed} above maximum ${max}, using maximum`);
        return max;
    }
    
    return parsed;
}

/**
 * Validate cache strategy
 */
function validateCacheStrategy(strategy) {
    const validStrategies = Object.values(CACHE_STRATEGIES);
    
    if (!validStrategies.includes(strategy)) {
        console.warn(`⚠️  Invalid cache strategy: ${strategy}`);
        console.warn(`   Valid options: ${validStrategies.join(', ')}`);
        console.warn(`   Using default: ${DEFAULTS.CACHE_STRATEGY}`);
        return DEFAULTS.CACHE_STRATEGY;
    }
    
    // Warn about unimplemented strategies
    if (strategy === CACHE_STRATEGIES.MINIMAL || strategy === CACHE_STRATEGIES.TIERED) {
        console.warn(`⚠️  Cache strategy '${strategy}' is not yet implemented`);
        console.warn(`   Falling back to: ${DEFAULTS.CACHE_STRATEGY}`);
        return DEFAULTS.CACHE_STRATEGY;
    }
    
    return strategy;
}

/**
 * Load and validate configuration from environment variables
 */
function loadConfiguration() {
    const config = {
        // Cache configuration
        cacheStrategy: validateCacheStrategy(
            process.env.CACHE_STRATEGY || DEFAULTS.CACHE_STRATEGY
        ),
        hotCacheSize: parseInteger(
            process.env.HOT_CACHE_SIZE,
            DEFAULTS.HOT_CACHE_SIZE,
            1000,
            100000
        ),
        queryCacheSize: parseInteger(
            process.env.QUERY_CACHE_SIZE,
            DEFAULTS.QUERY_CACHE_SIZE,
            10 * 1024 * 1024, // 10MB min
            500 * 1024 * 1024 // 500MB max
        ),
        
        // Search configuration
        searchLimit: parseInteger(
            process.env.SEARCH_LIMIT,
            DEFAULTS.SEARCH_LIMIT,
            100,
            10000
        ),
        searchTimeout: parseInteger(
            process.env.SEARCH_TIMEOUT,
            DEFAULTS.SEARCH_TIMEOUT,
            1000,
            30000
        ),
        
        // Performance configuration
        scanThreads: parseInteger(
            process.env.SCAN_THREADS,
            DEFAULTS.SCAN_THREADS,
            1,
            16
        ),
        batchSize: parseInteger(
            process.env.BATCH_SIZE,
            DEFAULTS.BATCH_SIZE,
            100,
            10000
        ),
        
        // Feature flags
        enableCacheStats: parseBoolean(
            process.env.ENABLE_CACHE_STATS,
            DEFAULTS.ENABLE_CACHE_STATS
        ),
        enableLazyLoading: parseBoolean(
            process.env.ENABLE_LAZY_LOADING,
            DEFAULTS.ENABLE_LAZY_LOADING
        ),
        enableQueryCache: parseBoolean(
            process.env.ENABLE_QUERY_CACHE,
            DEFAULTS.ENABLE_QUERY_CACHE
        ),
        
        // Server configuration
        port: parseInteger(
            process.env.PORT,
            DEFAULTS.PORT,
            1024,
            65535
        ),
        autoOpenBrowser: parseBoolean(
            process.env.AUTO_OPEN_BROWSER,
            DEFAULTS.AUTO_OPEN_BROWSER
        ),
        
        // Logging
        logLevel: (process.env.LOG_LEVEL || DEFAULTS.LOG_LEVEL).toLowerCase(),
        logCacheStatsInterval: parseInteger(
            process.env.LOG_CACHE_STATS_INTERVAL,
            DEFAULTS.LOG_CACHE_STATS_INTERVAL,
            60000, // 1 minute min
            3600000 // 1 hour max
        )
    };
    
    return config;
}

/**
 * Get configuration summary for logging
 */
function getConfigSummary(config) {
    return {
        'Cache Strategy': config.cacheStrategy,
        'Hot Cache Size': config.hotCacheSize.toLocaleString(),
        'Query Cache Size': `${Math.round(config.queryCacheSize / 1024 / 1024)}MB`,
        'Search Limit': config.searchLimit,
        'Scan Threads': config.scanThreads,
        'Cache Stats': config.enableCacheStats ? 'Enabled' : 'Disabled',
        'Lazy Loading': config.enableLazyLoading ? 'Enabled' : 'Disabled',
        'Query Cache': config.enableQueryCache ? 'Enabled' : 'Disabled'
    };
}

/**
 * Print configuration to console
 */
function printConfiguration(config) {
    console.log('\n📋 Configuration:');
    console.log('━'.repeat(50));
    
    const summary = getConfigSummary(config);
    const maxKeyLength = Math.max(...Object.keys(summary).map(k => k.length));
    
    for (const [key, value] of Object.entries(summary)) {
        const padding = ' '.repeat(maxKeyLength - key.length);
        console.log(`   ${key}:${padding} ${value}`);
    }
    
    console.log('━'.repeat(50));
    console.log('');
}

/**
 * Validate configuration at runtime
 */
function validateConfiguration(config) {
    const errors = [];
    const warnings = [];
    
    // Validate cache strategy
    if (!Object.values(CACHE_STRATEGIES).includes(config.cacheStrategy)) {
        errors.push(`Invalid cache strategy: ${config.cacheStrategy}`);
    }
    
    // Validate numeric ranges
    if (config.hotCacheSize < 1000 || config.hotCacheSize > 100000) {
        warnings.push(`Hot cache size ${config.hotCacheSize} is outside recommended range (1000-100000)`);
    }
    
    if (config.searchLimit < 100 || config.searchLimit > 10000) {
        warnings.push(`Search limit ${config.searchLimit} is outside recommended range (100-10000)`);
    }
    
    if (config.scanThreads < 1 || config.scanThreads > 16) {
        warnings.push(`Scan threads ${config.scanThreads} is outside recommended range (1-16)`);
    }
    
    // Validate log level
    const validLogLevels = ['debug', 'info', 'warn', 'error'];
    if (!validLogLevels.includes(config.logLevel)) {
        warnings.push(`Invalid log level: ${config.logLevel}, using 'info'`);
        config.logLevel = 'info';
    }
    
    // Print validation results
    if (errors.length > 0) {
        console.error('\n❌ Configuration Errors:');
        errors.forEach(err => console.error(`   - ${err}`));
        throw new Error('Invalid configuration');
    }
    
    if (warnings.length > 0) {
        console.warn('\n⚠️  Configuration Warnings:');
        warnings.forEach(warn => console.warn(`   - ${warn}`));
    }
    
    return true;
}

/**
 * Check if optimized cache should be used
 */
function useOptimizedCache(config) {
    return config.cacheStrategy === CACHE_STRATEGIES.OPTIMIZED;
}

/**
 * Check if legacy cache should be used
 */
function useLegacyCache(config) {
    return config.cacheStrategy === CACHE_STRATEGIES.FULL;
}

/**
 * Get cache options for OptimizedDatabaseCache
 */
function getOptimizedCacheOptions(config) {
    return {
        hotCacheSize: config.hotCacheSize,
        searchLimit: config.searchLimit,
        enableStats: config.enableCacheStats
    };
}

/**
 * Get cache options for legacy DatabaseCache
 */
function getLegacyCacheOptions(config) {
    return {
        enableStats: config.enableCacheStats
    };
}

// Load configuration on module initialization
const config = loadConfiguration();

// Validate configuration
try {
    validateConfiguration(config);
} catch (error) {
    console.error('❌ Configuration validation failed:', error.message);
    process.exit(1);
}

// Export configuration and utilities
module.exports = {
    // Configuration object
    config,
    
    // Constants
    CACHE_STRATEGIES,
    DEFAULTS,
    
    // Utility functions
    loadConfiguration,
    validateConfiguration,
    printConfiguration,
    getConfigSummary,
    useOptimizedCache,
    useLegacyCache,
    getOptimizedCacheOptions,
    getLegacyCacheOptions,
    
    // Parsing utilities (for testing)
    parseBoolean,
    parseInteger,
    validateCacheStrategy
};
