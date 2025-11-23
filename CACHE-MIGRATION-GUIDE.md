# Cache Migration Guide

## Overview

FileStash supports two cache strategies:
- **Legacy Cache (full)**: Loads entire database into memory (~1000MB for 1.3M records)
- **Optimized Cache**: Three-tier caching system (~150-230MB for 1.3M records)

This guide explains how to migrate between cache strategies and handle rollback scenarios.

## Quick Start

### Check Current Cache Strategy

```bash
# Via API
curl http://localhost:3000/api/cache/strategy

# Via environment variable
echo $CACHE_STRATEGY
```

### Switch Cache Strategy

#### Option 1: Environment Variable (Recommended)

Edit your `.env` file:

```bash
# Use optimized cache (low memory)
CACHE_STRATEGY=optimized

# Use legacy cache (high memory)
CACHE_STRATEGY=full
```

Then restart the server:

```bash
npm start
```

#### Option 2: Runtime API (No Restart Required)

```bash
# Switch to optimized cache
curl -X POST http://localhost:3000/api/cache/strategy \
  -H "Content-Type: application/json" \
  -d '{"strategy": "optimized"}'

# Switch to legacy cache
curl -X POST http://localhost:3000/api/cache/strategy \
  -H "Content-Type: application/json" \
  -d '{"strategy": "legacy"}'
```

## Migration Strategies

### Gradual Rollout

For production environments, use a gradual rollout approach:

1. **Test in Development**
   ```bash
   # Set environment variable
   CACHE_STRATEGY=optimized npm start
   
   # Run migration tests
   node test-cache-migration.js
   ```

2. **Monitor Performance**
   ```bash
   # Check cache statistics
   curl http://localhost:3000/api/cache/stats
   
   # Run performance tests
   curl http://localhost:3000/api/cache/test
   ```

3. **Deploy to Staging**
   - Update `.env` file with `CACHE_STRATEGY=optimized`
   - Monitor memory usage and response times
   - Validate search functionality

4. **Deploy to Production**
   - Update production `.env` file
   - Monitor application health
   - Keep rollback plan ready

### Rollback Procedure

If issues occur after migration:

#### Automatic Fallback

The application automatically falls back to the alternative cache if the primary cache fails to load:

```
🚀 Cache Strategy Selected: optimized
❌ Failed to load optimized cache: [error]
⚠️  Attempting fallback to legacy cache...
✅ Fallback to legacy cache successful
```

#### Manual Rollback

1. **Via Environment Variable**
   ```bash
   # Edit .env file
   CACHE_STRATEGY=full
   
   # Restart server
   npm start
   ```

2. **Via API (Immediate)**
   ```bash
   curl -X POST http://localhost:3000/api/cache/strategy \
     -H "Content-Type: application/json" \
     -d '{"strategy": "legacy"}'
   ```

## Testing Migration

### Run Migration Test Suite

```bash
node test-cache-migration.js
```

This test suite validates:
- ✅ Legacy cache loading and performance
- ✅ Optimized cache loading and performance
- ✅ Memory usage comparison
- ✅ Search performance comparison
- ✅ Migration and rollback functionality

### Expected Test Results

For a database with 1.3M records:

```
Legacy Cache:
  Load Time:    3000-5000ms
  Search Time:  50-200ms
  Memory:       800-1200MB
  Records:      1,300,000

Optimized Cache:
  Load Time:    2000-4000ms
  Search Time:  30-100ms
  Cache Memory: 150-230MB
  Process Mem:  200-300MB
  Records:      1,300,000
  Hit Rate:     50-90%

Improvement:
  Load Time:    20-40% faster
  Search Time:  40-60% faster
  Memory:       70-80% reduction
```

## Monitoring

### Cache Statistics

Monitor cache performance in real-time:

```bash
# Get detailed cache statistics
curl http://localhost:3000/api/cache/stats

# Check application health
curl http://localhost:3000/api/health
```

### Key Metrics to Monitor

1. **Memory Usage**
   - Process heap used
   - Cache memory estimate
   - RSS (Resident Set Size)

2. **Cache Performance**
   - Hit rate (optimized cache only)
   - Search response time
   - Load duration

3. **Application Health**
   - Cache loaded status
   - Error rates
   - Response times

### Logging

Cache statistics are logged periodically (default: every 5 minutes):

```
📊 Cache Stats: {
  "cacheStrategy": "optimized",
  "totalMemoryMB": 180,
  "hotDataCache": {
    "hitRate": "75.5%",
    "size": 8500,
    "maxSize": 10000
  }
}
```

Configure logging interval in `.env`:

```bash
# Log cache stats every 10 minutes
LOG_CACHE_STATS_INTERVAL=600000
```

## Troubleshooting

### Issue: Cache Fails to Load

**Symptoms:**
- Error message: "Failed to load cache"
- Application status: degraded

**Solutions:**
1. Check database file exists: `./filestash.db`
2. Verify database is not corrupted: `sqlite3 filestash.db "PRAGMA integrity_check;"`
3. Check available memory: `node -e "console.log(process.memoryUsage())"`
4. Try alternative cache strategy

### Issue: High Memory Usage with Optimized Cache

**Symptoms:**
- Memory usage higher than expected
- Process memory > 500MB

**Solutions:**
1. Reduce hot cache size:
   ```bash
   HOT_CACHE_SIZE=5000
   ```

2. Disable query cache:
   ```bash
   ENABLE_QUERY_CACHE=false
   ```

3. Check for memory leaks:
   ```bash
   node --inspect server.js
   ```

### Issue: Poor Search Performance

**Symptoms:**
- Search takes > 500ms
- Low cache hit rate

**Solutions:**
1. Increase hot cache size:
   ```bash
   HOT_CACHE_SIZE=20000
   ```

2. Increase search limit:
   ```bash
   SEARCH_LIMIT=2000
   ```

3. Verify database indexes:
   ```bash
   sqlite3 filestash.db ".indexes"
   ```

### Issue: Migration Fails

**Symptoms:**
- Error during cache strategy switch
- Application becomes unresponsive

**Solutions:**
1. Check logs for specific error
2. Verify sufficient memory available
3. Restart application with known-good configuration
4. Contact support with error logs

## Best Practices

### When to Use Optimized Cache

✅ **Use optimized cache when:**
- Database has > 500K records
- System has limited memory (< 4GB RAM)
- Memory efficiency is priority
- Acceptable 10-20% performance tradeoff

### When to Use Legacy Cache

✅ **Use legacy cache when:**
- Database has < 100K records
- System has abundant memory (> 8GB RAM)
- Maximum performance is critical
- Memory usage is not a concern

### Configuration Recommendations

#### Large Database (1M+ files)
```bash
CACHE_STRATEGY=optimized
HOT_CACHE_SIZE=20000
QUERY_CACHE_SIZE=209715200  # 200MB
SEARCH_LIMIT=2000
```

#### Small Database (<100K files)
```bash
CACHE_STRATEGY=full
HOT_CACHE_SIZE=5000
QUERY_CACHE_SIZE=52428800   # 50MB
SEARCH_LIMIT=1000
```

#### Memory-Constrained System
```bash
CACHE_STRATEGY=optimized
HOT_CACHE_SIZE=5000
QUERY_CACHE_SIZE=52428800   # 50MB
ENABLE_QUERY_CACHE=false
SEARCH_LIMIT=500
```

## API Reference

### GET /api/cache/strategy

Get current cache strategy and status.

**Response:**
```json
{
  "currentStrategy": "optimized",
  "configuredStrategy": "optimized",
  "loadFailed": false,
  "isLoaded": true,
  "availableStrategies": ["optimized", "legacy", "full"],
  "timestamp": "2024-11-15T10:30:00.000Z"
}
```

### POST /api/cache/strategy

Switch cache strategy at runtime.

**Request:**
```json
{
  "strategy": "optimized"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully switched cache strategy to optimized",
  "previousStrategy": "legacy",
  "currentStrategy": "optimized",
  "timestamp": "2024-11-15T10:30:00.000Z"
}
```

### GET /api/cache/test

Test cache performance.

**Response:**
```json
{
  "cacheType": "optimized",
  "timestamp": "2024-11-15T10:30:00.000Z",
  "tests": {
    "cacheSize": {
      "duration": 1,
      "result": 1300000
    },
    "search": {
      "duration": 45,
      "resultCount": 100
    },
    "memory": {
      "heapUsedMB": 250,
      "heapTotalMB": 300,
      "rssMB": 280
    }
  }
}
```

### GET /api/cache/stats

Get detailed cache statistics (requires `ENABLE_CACHE_STATS=true`).

**Response:**
```json
{
  "cacheStrategy": "optimized",
  "configuredStrategy": "optimized",
  "loadFailed": false,
  "isLoaded": true,
  "loadDuration": 3500,
  "indexCache": {
    "size": 1300000,
    "memoryMB": 100,
    "isLoaded": true
  },
  "hotDataCache": {
    "size": 8500,
    "maxSize": 10000,
    "hits": 15000,
    "misses": 5000,
    "hitRate": "75.00%",
    "memoryMB": 4
  },
  "searchIndex": {
    "size": 1300000,
    "memoryMB": 78,
    "isLoaded": true
  },
  "totalMemoryMB": 182,
  "timestamp": "2024-11-15T10:30:00.000Z",
  "uptime": 3600,
  "processMemory": {
    "heapUsed": 250,
    "heapTotal": 300,
    "rss": 280
  }
}
```

## Support

For issues or questions:
1. Check logs for error messages
2. Run migration test suite: `node test-cache-migration.js`
3. Review this guide's troubleshooting section
4. Check GitHub issues for similar problems
5. Create new issue with logs and configuration

## Changelog

### Version 2.0.0
- ✅ Added optimized cache implementation
- ✅ Added automatic fallback mechanism
- ✅ Added runtime cache strategy switching
- ✅ Added migration test suite
- ✅ Added comprehensive monitoring and logging
