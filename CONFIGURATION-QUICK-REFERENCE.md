# Configuration Quick Reference

Quick reference for the most commonly used FileStash configuration options.

## Essential Configuration

```bash
# Cache Strategy (optimized recommended for large databases)
CACHE_STRATEGY=optimized

# Server Port
PORT=3000

# Enable Cache Statistics
ENABLE_CACHE_STATS=true
```

## Common Scenarios

### Default (Recommended)
```bash
CACHE_STRATEGY=optimized
HOT_CACHE_SIZE=10000
SEARCH_LIMIT=1000
PORT=3000
```

### Large Database (1M+ files)
```bash
CACHE_STRATEGY=optimized
HOT_CACHE_SIZE=20000
SEARCH_LIMIT=2000
SCAN_THREADS=8
```

### Low Memory System
```bash
CACHE_STRATEGY=optimized
HOT_CACHE_SIZE=5000
ENABLE_QUERY_CACHE=false
SEARCH_LIMIT=500
```

### Development
```bash
CACHE_STRATEGY=optimized
LOG_LEVEL=debug
LOG_CACHE_STATS_INTERVAL=60000
```

## Key Options

| Variable | Default | Description |
|----------|---------|-------------|
| `CACHE_STRATEGY` | `optimized` | Cache strategy: `full` or `optimized` |
| `HOT_CACHE_SIZE` | `10000` | Number of records in hot cache |
| `SEARCH_LIMIT` | `1000` | Max search results |
| `PORT` | `3000` | Server port |
| `ENABLE_CACHE_STATS` | `true` | Enable cache statistics |
| `LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |

## Cache Strategies

| Strategy | Memory Usage | Best For |
|----------|--------------|----------|
| `optimized` | ~200MB for 1.3M files | Large databases, limited RAM |
| `full` | ~1000MB for 1.3M files | Small databases, abundant RAM |

## Monitoring

### Cache Statistics Endpoint
```
GET http://localhost:3000/api/cache/stats
```

### Console Output
Configuration is printed on startup:
```
📋 Configuration:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Cache Strategy:   optimized
   Hot Cache Size:   10,000
   Query Cache Size: 100MB
   Search Limit:     1,000
   Scan Threads:     4
   Cache Stats:      Enabled
   Lazy Loading:     Enabled
   Query Cache:      Enabled
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Full Documentation

For complete documentation, see [CONFIGURATION.md](CONFIGURATION.md)

For all available options, see [.env.example](.env.example)
