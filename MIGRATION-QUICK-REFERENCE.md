# Cache Migration Quick Reference

## Quick Commands

### Check Current Strategy
```bash
curl http://localhost:3000/api/cache/strategy
```

### Switch to Optimized Cache
```bash
curl -X POST http://localhost:3000/api/cache/strategy \
  -H "Content-Type: application/json" \
  -d '{"strategy": "optimized"}'
```

### Switch to Legacy Cache
```bash
curl -X POST http://localhost:3000/api/cache/strategy \
  -H "Content-Type: application/json" \
  -d '{"strategy": "legacy"}'
```

### Test Cache Performance
```bash
curl http://localhost:3000/api/cache/test
```

### Get Cache Statistics
```bash
curl http://localhost:3000/api/cache/stats
```

### Check Application Health
```bash
curl http://localhost:3000/api/health
```

### Run Migration Tests
```bash
node test-cache-migration.js
```

## Environment Variables

```bash
# .env file

# Cache strategy (optimized or full)
CACHE_STRATEGY=optimized

# Hot cache size (1,000 - 100,000)
HOT_CACHE_SIZE=10000

# Enable cache statistics
ENABLE_CACHE_STATS=true
```

## Cache Strategy Comparison

| Feature | Legacy (full) | Optimized |
|---------|--------------|-----------|
| Memory Usage | ~1000MB | ~200MB |
| Load Time | 15-20s | 10-15s |
| Search Speed | Fast | Fast (after warmup) |
| Best For | <100K files | >500K files |

## Automatic Fallback

The application automatically falls back if the primary cache fails:

```
Primary Cache Fails → Automatic Fallback → Application Continues
```

No manual intervention required!

## Troubleshooting

### Cache Won't Load
1. Check database exists: `ls -l filestash.db`
2. Verify database integrity: `sqlite3 filestash.db "PRAGMA integrity_check;"`
3. Check logs for errors
4. Try alternative strategy

### High Memory Usage
1. Reduce hot cache size: `HOT_CACHE_SIZE=5000`
2. Disable query cache: `ENABLE_QUERY_CACHE=false`
3. Switch to optimized strategy

### Slow Search
1. Increase hot cache size: `HOT_CACHE_SIZE=20000`
2. Wait for cache warmup
3. Check database indexes

## More Information

See `CACHE-MIGRATION-GUIDE.md` for complete documentation.
