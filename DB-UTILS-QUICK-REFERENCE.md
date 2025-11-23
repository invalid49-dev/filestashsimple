# Database Utilities Quick Reference

## Import

```javascript
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
```

## Basic Queries

```javascript
// Get multiple rows
const files = await dbQuery(db, 'SELECT * FROM files WHERE directory = ?', ['/path']);

// Get single row
const file = await dbGet(db, 'SELECT * FROM files WHERE id = ?', [123]);

// Execute command
const result = await dbRun(db, 'DELETE FROM files WHERE id = ?', [123]);
console.log(`Deleted ${result.changes} records`);
```

## Batch Operations

```javascript
// Load by IDs (14x faster than individual queries)
const files = await batchLoadByIds(db, [1, 2, 3, 4, 5]);

// Load by paths
const files = await batchLoadByPaths(db, ['C:\\file1.txt', 'C:\\file2.txt']);

// Delete by IDs
const count = await batchDeleteByIds(db, [1, 2, 3]);

// Delete by paths
const count = await batchDeleteByPaths(db, ['C:\\old1.txt', 'C:\\old2.txt']);

// Insert/update with transaction
const records = [{ full_path: '...', directory: '...', /* ... */ }];
const count = await batchInsertOrUpdate(db, records);
```

## Existence Checks

```javascript
// Check IDs (25x faster than loading full records)
const map = await checkExistenceByIds(db, [1, 2, 999]);
console.log(map.get(1));   // true
console.log(map.get(999)); // false

// Check paths
const map = await checkExistenceByPaths(db, ['C:\\file1.txt', 'C:\\missing.txt']);
```

## Statistics

```javascript
// Get comprehensive stats
const stats = await getDatabaseStats(db);
console.log(`Total: ${stats.totalRecords}`);
console.log(`Files: ${stats.totalFiles}`);
console.log(`Dirs: ${stats.totalDirectories}`);
console.log(`Size: ${stats.totalSize} bytes`);

// Get count with condition
const count = await getCount(db, 'files', 'is_directory = 1');
```

## Optimization

```javascript
// Create/verify indexes
await optimizeIndexes(db);

// Update query planner statistics
await analyzeDatabase(db);
```

## Retry Logic

```javascript
// Retry on SQLITE_BUSY
const result = await queryWithRetry(
    db,
    () => dbQuery(db, 'SELECT * FROM files WHERE id = ?', [123]),
    3,    // max retries
    100   // delay in ms
);
```

## Performance Tips

✅ **DO**: Use batch operations for multiple records
```javascript
await batchLoadByIds(db, ids);  // 14x faster
```

❌ **DON'T**: Loop with individual queries
```javascript
for (const id of ids) {
    await dbGet(db, 'SELECT * FROM files WHERE id = ?', [id]);
}
```

✅ **DO**: Check existence before loading
```javascript
const exists = await checkExistenceByIds(db, [id]);
if (exists.get(id)) {
    const file = await dbGet(db, 'SELECT * FROM files WHERE id = ?', [id]);
}
```

✅ **DO**: Use transactions for multiple writes
```javascript
await batchInsertOrUpdate(db, records);  // Automatic transaction
```

## Testing

```bash
node test-db-utils.js
```

## Documentation

See [DATABASE-QUERY-OPTIMIZATION.md](./DATABASE-QUERY-OPTIMIZATION.md) for detailed documentation.
