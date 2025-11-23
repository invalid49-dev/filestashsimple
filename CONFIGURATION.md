# FileStash Configuration Guide

This document describes all available configuration options for FileStash, including environment variables, feature flags, and cache strategies.

## Table of Contents

- [Quick Start](#quick-start)
- [Cache Strategies](#cache-strategies)
- [Environment Variables](#environment-variables)
- [Feature Flags](#feature-flags)
- [Performance Tuning](#performance-tuning)
- [Examples](#examples)

## Quick Start

FileStash uses environment variables for configuration. Create a `.env` file in the project root or set environment variables directly:

```bash
# Minimal configuration (uses defaults)
CACHE_STRATEGY=optimized
PORT=3000
```

## Cache Strategies

FileStash supports multiple caching strategies to balance memory usage and performance:

### Optimized Cache (Recommended)

**Strategy:** `CACHE_STRATEGY=optimized`

Memory-efficient three-tier caching system:
- **Index Cache**: Minimal metadata for all files (~100MB for 1.3M records)
- **Hot Data Cache**: LRU cache for frequently accessed records (~10MB)
- **Search Index**: Optimized search index (~80MB)

**Total Memory**: ~190-230MB for 1.3M records (77% reduction vs full cache)

**Best for**: Large databases (500K+ files), systems with limited RAM

### Full Cache (Legacy)

**Strategy:** `CACHE_STRATEGY=full`

Loads entire database into memory for maximum speed.

**Total Memory**: ~1000MB for 1.3M records

**Best for**: Small databases (<100K files), systems with abundant RAM

### Future Strategies

- `minimal`: Minimal caching (not yet implemented)
- `tiered`: Advanced tiered caching (not yet implemented)

## Environment Variables

### Cache Configuration

#### CACHE_STRATEGY
- **Type**: String
- **Default**: `optimized`
- **Options**: `full`, `optimized`, `minimal`, `tiered`
- **Description**: Selects the caching strategy

```bash
CACHE_STRATEGY=optimized
```

#### HOT_CACHE_SIZE
- **Type**: Integer
- **Default**: `10000`
- **Range**: 1,000 - 100,000
- **Description**: Number of records to keep in hot cache (optimized strategy only)

```bash
HOT_CACHE_SIZE=20000  # Increase for better hit rate
```

#### QUERY_CACHE_SIZE
- **Type**: Integer (bytes)
- **Default**: `104857600` (100MB)
- **Range**: 10MB - 500MB
- **Description**: Maximum size of query result cache

```bash
QUERY_CACHE_SIZE=209715200  # 200MB
```

### Search Configuration

#### SEARCH_LIMIT
- **Type**: Integer
- **Default**: `1000`
- **Range**: 100 - 10,000
- **Description**: Maximum number of search results to return

```bash
SEARCH_LIMIT=2000
```

#### SEARCH_TIMEOUT
- **Type**: Integer (milliseconds)
- **Default**: `5000`
- **Range**: 1,000 - 30,000
- **Description**: Search operation timeout

```bash
SEARCH_TIMEOUT=10000  # 10 seconds
```

### Performance Configuration

#### SCAN_THREADS
- **Type**: Integer
- **Default**: `4`
- **Range**: 1 - 16
- **Description**: Number of threads for file system scanning

```bash
SCAN_THREADS=8  # Use more threads on powerful systems
```

#### BATCH_SIZE
- **Type**: Integer
- **Default**: `1000`
- **Range**: 100 - 10,000
- **Description**: Batch size for database operations

```bash
BATCH_SIZE=2000
```

### Feature Flags

#### ENABLE_CACHE_STATS
- **Type**: Boolean
- **Default**: `true`
- **Options**: `true`, `false`, `1`, `0`, `yes`, `no`
- **Description**: Enable cache statistics endpoint and logging

```bash
ENABLE_CACHE_STATS=true
```

#### ENABLE_LAZY_LOADING
- **Type**: Boolean
- **Default**: `true`
- **Description**: Enable lazy loading for tree view

```bash
ENABLE_LAZY_LOADING=true
```

#### ENABLE_QUERY_CACHE
- **Type**: Boolean
- **Default**: `true`
- **Description**: Enable query result caching

```bash
ENABLE_QUERY_CACHE=true
```

### Server Configuration

#### PORT
- **Type**: Integer
- **Default**: `3000`
- **Range**: 1024 - 65535
- **Description**: HTTP server port

```bash
PORT=8080
```

#### AUTO_OPEN_BROWSER
- **Type**: Boolean
- **Default**: `true`
- **Description**: Automatically open browser on server start

```bash
AUTO_OPEN_BROWSER=false
```

### Logging Configuration

#### LOG_LEVEL
- **Type**: String
- **Default**: `info`
- **Options**: `debug`, `info`, `warn`, `error`
- **Description**: Logging verbosity level

```bash
LOG_LEVEL=debug
```

#### LOG_CACHE_STATS_INTERVAL
- **Type**: Integer (milliseconds)
- **Default**: `300000` (5 minutes)
- **Range**: 60,000 - 3,600,000 (1 minute - 1 hour)
- **Description**: Interval for periodic cache statistics logging

```bash
LOG_CACHE_STATS_INTERVAL=600000  # 10 minutes
```

## Performance Tuning

### For Large Databases (1M+ files)

```bash
# Use optimized cache with larger hot cache
CACHE_STRATEGY=optimized
HOT_CACHE_SIZE=20000
QUERY_CACHE_SIZE=209715200  # 200MB

# Increase search limit for better results
SEARCH_LIMIT=2000

# Use more threads for faster scanning
SCAN_THREADS=8
BATCH_SIZE=2000
```

### For Small Databases (<100K files)

```bash
# Use full cache for maximum speed
CACHE_STRATEGY=full

# Smaller cache sizes are sufficient
HOT_CACHE_SIZE=5000
QUERY_CACHE_SIZE=52428800  # 50MB

# Standard settings
SEARCH_LIMIT=1000
SCAN_THREADS=4
```

### For Memory-Constrained Systems

```bash
# Use optimized cache with minimal settings
CACHE_STRATEGY=optimized
HOT_CACHE_SIZE=5000
QUERY_CACHE_SIZE=52428800  # 50MB

# Disable query cache to save memory
ENABLE_QUERY_CACHE=false

# Reduce search limit
SEARCH_LIMIT=500

# Use fewer threads
SCAN_THREADS=2
```

### For High-Performance Systems

```bash
# Use optimized cache with maximum settings
CACHE_STRATEGY=optimized
HOT_CACHE_SIZE=50000
QUERY_CACHE_SIZE=524288000  # 500MB

# Enable all features
ENABLE_CACHE_STATS=true
ENABLE_LAZY_LOADING=true
ENABLE_QUERY_CACHE=true

# Maximum search results
SEARCH_LIMIT=5000

# Use all available threads
SCAN_THREADS=16
BATCH_SIZE=5000
```

## Examples

### Development Environment

```bash
# .env.development
CACHE_STRATEGY=optimized
PORT=3000
AUTO_OPEN_BROWSER=true
LOG_LEVEL=debug
ENABLE_CACHE_STATS=true
LOG_CACHE_STATS_INTERVAL=60000  # 1 minute for testing
```

### Production Environment

```bash
# .env.production
CACHE_STRATEGY=optimized
PORT=8080
AUTO_OPEN_BROWSER=false
LOG_LEVEL=info
ENABLE_CACHE_STATS=true
LOG_CACHE_STATS_INTERVAL=300000  # 5 minutes

# Optimized for large database
HOT_CACHE_SIZE=20000
QUERY_CACHE_SIZE=209715200
SEARCH_LIMIT=2000
SCAN_THREADS=8
```

### Testing Environment

```bash
# .env.test
CACHE_STRATEGY=optimized
PORT=3001
AUTO_OPEN_BROWSER=false
LOG_LEVEL=warn
ENABLE_CACHE_STATS=false

# Minimal settings for faster tests
HOT_CACHE_SIZE=1000
QUERY_CACHE_SIZE=10485760  # 10MB
SEARCH_LIMIT=100
```

## Configuration Validation

FileStash automatically validates configuration on startup:

- **Errors**: Invalid values that prevent startup (e.g., invalid cache strategy)
- **Warnings**: Values outside recommended ranges (automatically adjusted)

Example validation output:

```
📋 Configuration:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Cache Strategy:  optimized
   Hot Cache Size:  10,000
   Query Cache Size: 100MB
   Search Limit:    1,000
   Scan Threads:    4
   Cache Stats:     Enabled
   Lazy Loading:    Enabled
   Query Cache:     Enabled
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Monitoring

### Cache Statistics Endpoint

When `ENABLE_CACHE_STATS=true`, access cache statistics at:

```
GET http://localhost:3000/api/cache/stats
```

Response example:

```json
{
  "cacheStrategy": "optimized",
  "isLoaded": true,
  "loadDuration": 2341,
  "indexCache": {
    "size": 1300000,
    "memoryMB": 100,
    "isLoaded": true
  },
  "hotDataCache": {
    "size": 10000,
    "maxSize": 10000,
    "hits": 45678,
    "misses": 12345,
    "hitRate": "78.73%",
    "memoryMB": 5
  },
  "searchIndex": {
    "size": 1300000,
    "memoryMB": 78,
    "isLoaded": true
  },
  "totalMemoryMB": 183,
  "timestamp": "2025-11-15T10:30:00.000Z",
  "uptime": 3600,
  "processMemory": {
    "heapUsed": 250,
    "heapTotal": 300,
    "rss": 350
  }
}
```

### Periodic Logging

Cache statistics are logged at the configured interval:

```
📊 Cache Statistics (5-minute update):
   Strategy: Optimized
   Total Memory: ~183MB
   Index Cache: 1300000 records (~100MB)
   Hot Cache: 10000/10000 records (~5MB)
   Hot Cache Hit Rate: 78.73%
   Hot Cache Hits: 45678, Misses: 12345
   Search Index: 1300000 records (~78MB)
   Load Duration: 2341ms
   Process Memory: Heap 250MB / 300MB, RSS 350MB
```

## Troubleshooting

### High Memory Usage

1. Switch to optimized cache: `CACHE_STRATEGY=optimized`
2. Reduce hot cache size: `HOT_CACHE_SIZE=5000`
3. Disable query cache: `ENABLE_QUERY_CACHE=false`
4. Reduce query cache size: `QUERY_CACHE_SIZE=52428800`

### Slow Search Performance

1. Increase search limit: `SEARCH_LIMIT=2000`
2. Increase hot cache size: `HOT_CACHE_SIZE=20000`
3. Enable query cache: `ENABLE_QUERY_CACHE=true`
4. Increase query cache size: `QUERY_CACHE_SIZE=209715200`

### Slow File Scanning

1. Increase scan threads: `SCAN_THREADS=8`
2. Increase batch size: `BATCH_SIZE=2000`

### Cache Not Loading

1. Check database file exists: `./filestash.db`
2. Check database file permissions
3. Enable debug logging: `LOG_LEVEL=debug`
4. Check cache statistics: `GET /api/cache/stats`

## Migration Guide

### From Full Cache to Optimized Cache

1. Update configuration:
   ```bash
   CACHE_STRATEGY=optimized
   HOT_CACHE_SIZE=10000
   ```

2. Restart server

3. Monitor memory usage:
   ```bash
   GET /api/cache/stats
   ```

4. Adjust hot cache size based on hit rate:
   - Hit rate < 50%: Increase `HOT_CACHE_SIZE`
   - Hit rate > 90%: Can reduce `HOT_CACHE_SIZE`

### Rollback to Full Cache

1. Update configuration:
   ```bash
   CACHE_STRATEGY=full
   ```

2. Restart server

## Best Practices

1. **Start with defaults**: Default configuration works well for most use cases
2. **Monitor cache hit rate**: Aim for >70% hit rate in hot cache
3. **Adjust based on usage**: Increase hot cache size if hit rate is low
4. **Enable cache stats**: Always enable in production for monitoring
5. **Use optimized cache**: Recommended for databases >100K files
6. **Regular monitoring**: Check cache statistics periodically
7. **Test configuration changes**: Test in development before production

## Support

For issues or questions:
- Check logs: `LOG_LEVEL=debug`
- Check cache stats: `GET /api/cache/stats`
- Review this documentation
- Check GitHub issues
