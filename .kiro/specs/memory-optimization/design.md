# Memory Optimization Design

## Overview

Оптимизация потребления памяти для базы данных с 1.3M+ записей путем замены полного кэширования на гибридный подход с индексным кэшем и LRU-кэшем для горячих данных. Цель: снизить потребление памяти с ~1000 MB до ~150 MB при сохранении производительности.

## Architecture

### Текущая архитектура (проблема)
```
┌─────────────────────────────────────┐
│   DatabaseCache (Full Cache)        │
│                                      │
│  allFiles: Array[1.3M records]      │ ← ~1000 MB RAM
│  filesByPath: Map[1.3M entries]     │
│  filesByDirectory: Map[...]         │
└─────────────────────────────────────┘
```

### Новая архитектура (решение)
```
┌──────────────────────────────────────────────────────────┐
│              OptimizedDatabaseCache                       │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────────────────────────────────────────┐        │
│  │  Index Cache (Always in Memory)             │        │
│  │  - id, full_path, is_directory, directory   │        │
│  │  - Size: ~100 MB for 1.3M records           │ ← Основной индекс
│  └─────────────────────────────────────────────┘        │
│                                                           │
│  ┌─────────────────────────────────────────────┐        │
│  │  Hot Data LRU Cache (10k records)           │        │
│  │  - Full file details for recent access      │        │
│  │  - Size: ~50 MB                             │ ← Быстрый доступ
│  └─────────────────────────────────────────────┘        │
│                                                           │
│  ┌─────────────────────────────────────────────┐        │
│  │  Search Index (Optimized for search)        │        │
│  │  - filename, full_path (lowercase)          │        │
│  │  - Size: ~80 MB                             │ ← Быстрый поиск
│  └─────────────────────────────────────────────┘        │
│                                                           │
│  ┌─────────────────────────────────────────────┐        │
│  │  SQLite Database (Cold Storage)             │        │
│  │  - Full data loaded on demand               │        │
│  │  - Indexed queries for fast access          │ ← Полные данные
│  └─────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────┘

Total Memory: ~230 MB (vs 1000 MB) = 77% reduction
```

## Components and Interfaces

### 1. IndexCache Class

Хранит минимальный набор данных для навигации и построения дерева.

```javascript
class IndexCache {
    constructor() {
        // Минимальные данные для каждого файла
        this.index = new Map(); // key: id, value: { id, full_path, is_directory, directory }
        this.pathToId = new Map(); // key: full_path, value: id
        this.directoryIndex = new Map(); // key: directory, value: Set<id>
        this.isLoaded = false;
    }
    
    async load() {
        // Загружает только id, full_path, is_directory, directory
        const rows = await dbQuery('SELECT id, full_path, is_directory, directory FROM files');
        
        rows.forEach(row => {
            this.index.set(row.id, row);
            this.pathToId.set(row.full_path, row.id);
            
            if (!this.directoryIndex.has(row.directory)) {
                this.directoryIndex.set(row.directory, new Set());
            }
            this.directoryIndex.get(row.directory).add(row.id);
        });
        
        this.isLoaded = true;
    }
    
    getById(id) {
        return this.index.get(id);
    }
    
    getByPath(path) {
        const id = this.pathToId.get(path);
        return id ? this.index.get(id) : null;
    }
    
    getChildrenIds(directory) {
        return this.directoryIndex.get(directory) || new Set();
    }
    
    getAllPaths() {
        return Array.from(this.pathToId.keys());
    }
}
```

**Memory estimation:**
- 1.3M records × 80 bytes/record ≈ 100 MB

### 2. HotDataCache Class (LRU)

Кэширует полные данные для недавно запрошенных файлов.

```javascript
class HotDataCache {
    constructor(maxSize = 10000) {
        this.cache = new Map(); // LRU cache
        this.maxSize = maxSize;
        this.hits = 0;
        this.misses = 0;
    }
    
    get(id) {
        if (this.cache.has(id)) {
            // Move to end (most recently used)
            const value = this.cache.get(id);
            this.cache.delete(id);
            this.cache.set(id, value);
            this.hits++;
            return value;
        }
        this.misses++;
        return null;
    }
    
    set(id, data) {
        // Remove if exists
        if (this.cache.has(id)) {
            this.cache.delete(id);
        }
        
        // Evict oldest if at capacity
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
        
        this.cache.set(id, data);
    }
    
    getStats() {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? (this.hits / total * 100).toFixed(2) + '%' : '0%'
        };
    }
}
```

**Memory estimation:**
- 10,000 records × 500 bytes/record ≈ 5 MB
- Map overhead ≈ 5 MB
- Total: ~10 MB

### 3. SearchIndex Class

Оптимизированный индекс для быстрого поиска.

```javascript
class SearchIndex {
    constructor() {
        this.filenameIndex = new Map(); // key: id, value: lowercase filename
        this.pathIndex = new Map(); // key: id, value: lowercase full_path
        this.isLoaded = false;
    }
    
    async load() {
        const rows = await dbQuery('SELECT id, filename, full_path FROM files');
        
        rows.forEach(row => {
            this.filenameIndex.set(row.id, row.filename.toLowerCase());
            this.pathIndex.set(row.id, row.full_path.toLowerCase());
        });
        
        this.isLoaded = true;
    }
    
    search(searchTerm, limit = 1000) {
        const lowerSearch = searchTerm.toLowerCase().trim();
        const searchWords = lowerSearch.split(/\s+/).filter(w => w.length > 0);
        
        const results = [];
        
        for (const [id, filename] of this.filenameIndex) {
            const path = this.pathIndex.get(id);
            
            // Check if all words match
            const allMatch = searchWords.every(word => 
                filename.includes(word) || path.includes(word)
            );
            
            if (!allMatch) continue;
            
            // Calculate score
            let score = 0;
            if (filename === lowerSearch) score += 1000;
            if (filename.startsWith(lowerSearch)) score += 500;
            if (filename.includes(lowerSearch)) score += 100;
            if (path.includes(lowerSearch)) score += 50;
            
            results.push({ id, score });
            
            if (results.length >= limit * 2) break; // Pre-filter
        }
        
        // Sort by score and return top results
        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(r => r.id);
    }
}
```

**Memory estimation:**
- 1.3M records × 60 bytes/record ≈ 78 MB

### 4. OptimizedDatabaseCache Class (Main)

Координирует все компоненты кэша.

```javascript
class OptimizedDatabaseCache {
    constructor() {
        this.indexCache = new IndexCache();
        this.hotDataCache = new HotDataCache(10000);
        this.searchIndex = new SearchIndex();
        this.isLoaded = false;
    }
    
    async load() {
        console.log('📥 Loading optimized cache...');
        const startTime = Date.now();
        
        await Promise.all([
            this.indexCache.load(),
            this.searchIndex.load()
        ]);
        
        this.isLoaded = true;
        
        const duration = Date.now() - startTime;
        const memoryEstimate = this.estimateMemoryUsage();
        
        console.log(`✅ Optimized cache loaded: ${duration}ms, ~${memoryEstimate}MB`);
    }
    
    async getFullData(id) {
        // Try hot cache first
        let data = this.hotDataCache.get(id);
        if (data) {
            return data;
        }
        
        // Load from database
        data = await dbQuery('SELECT * FROM files WHERE id = ?', [id]);
        if (data && data.length > 0) {
            this.hotDataCache.set(id, data[0]);
            return data[0];
        }
        
        return null;
    }
    
    async getFullDataBatch(ids) {
        const results = [];
        const missingIds = [];
        
        // Check hot cache
        for (const id of ids) {
            const cached = this.hotDataCache.get(id);
            if (cached) {
                results.push(cached);
            } else {
                missingIds.push(id);
            }
        }
        
        // Batch load missing from database
        if (missingIds.length > 0) {
            const placeholders = missingIds.map(() => '?').join(',');
            const rows = await dbQuery(
                `SELECT * FROM files WHERE id IN (${placeholders})`,
                missingIds
            );
            
            rows.forEach(row => {
                this.hotDataCache.set(row.id, row);
                results.push(row);
            });
        }
        
        return results;
    }
    
    getIndexData(id) {
        return this.indexCache.getById(id);
    }
    
    getByPath(path) {
        return this.indexCache.getByPath(path);
    }
    
    getChildrenIds(directory) {
        return this.indexCache.getChildrenIds(directory);
    }
    
    async search(searchTerm, limit = 1000) {
        // Get matching IDs from search index
        const matchingIds = this.searchIndex.search(searchTerm, limit);
        
        // Load full data for results
        return await this.getFullDataBatch(matchingIds);
    }
    
    async buildTree(directory = null) {
        // Use index cache for tree structure
        const childrenIds = this.indexCache.getChildrenIds(directory || '');
        
        // Load full data only for direct children
        return await this.getFullDataBatch(Array.from(childrenIds));
    }
    
    invalidate() {
        this.indexCache = new IndexCache();
        this.hotDataCache = new HotDataCache(10000);
        this.searchIndex = new SearchIndex();
        this.isLoaded = false;
    }
    
    async reload() {
        this.invalidate();
        await this.load();
    }
    
    estimateMemoryUsage() {
        const indexSize = this.indexCache.index.size * 80 / 1024 / 1024;
        const hotSize = this.hotDataCache.cache.size * 500 / 1024 / 1024;
        const searchSize = this.searchIndex.filenameIndex.size * 60 / 1024 / 1024;
        return Math.round(indexSize + hotSize + searchSize);
    }
    
    getStats() {
        return {
            indexCache: {
                size: this.indexCache.index.size,
                memoryMB: Math.round(this.indexCache.index.size * 80 / 1024 / 1024)
            },
            hotDataCache: this.hotDataCache.getStats(),
            searchIndex: {
                size: this.searchIndex.filenameIndex.size,
                memoryMB: Math.round(this.searchIndex.filenameIndex.size * 60 / 1024 / 1024)
            },
            totalMemoryMB: this.estimateMemoryUsage()
        };
    }
}
```

## Data Models

### IndexCache Entry
```javascript
{
    id: 12345,
    full_path: "C:\\Users\\Documents\\file.txt",
    is_directory: 0,
    directory: "C:\\Users\\Documents"
}
```

### HotDataCache Entry (Full Record)
```javascript
{
    id: 12345,
    full_path: "C:\\Users\\Documents\\file.txt",
    directory: "C:\\Users\\Documents",
    filename: "file.txt",
    extension: ".txt",
    size: 1024,
    created_time: "2024-01-01T00:00:00.000Z",
    modified_time: "2024-01-02T00:00:00.000Z",
    is_directory: 0,
    attributes: "FILE",
    crc32: "a1b2c3d4"
}
```

### SearchIndex Entry
```javascript
{
    id: 12345,
    filename: "file.txt",  // lowercase
    full_path: "c:\\users\\documents\\file.txt"  // lowercase
}
```

## API Changes

### Modified Endpoints

#### GET /api/files/tree
```javascript
app.get('/api/files/tree', async (req, res) => {
    const { directory, search } = req.query;
    
    if (!optimizedCache.isLoaded) {
        await optimizedCache.load();
    }
    
    let files;
    
    if (search) {
        // Use search index
        files = await optimizedCache.search(search, 1000);
    } else {
        // Use index cache + batch load
        files = await optimizedCache.buildTree(directory);
    }
    
    const tree = buildFileTree(files);
    res.json(tree);
});
```

#### GET /api/files/:id
```javascript
app.get('/api/files/:id', async (req, res) => {
    const { id } = req.params;
    
    // Try hot cache, fallback to database
    const file = await optimizedCache.getFullData(parseInt(id));
    
    if (!file) {
        return res.status(404).json({ error: 'File not found' });
    }
    
    res.json(file);
});
```

#### GET /api/cache/stats (New)
```javascript
app.get('/api/cache/stats', (req, res) => {
    const stats = optimizedCache.getStats();
    res.json(stats);
});
```

## Performance Optimization

### 1. Batch Loading
Загружать данные пакетами вместо по одному:
```javascript
// Bad: N queries
for (const id of ids) {
    await getFullData(id);
}

// Good: 1 query
await getFullDataBatch(ids);
```

### 2. Lazy Tree Building
Загружать только видимые узлы дерева:
```javascript
// Load only direct children, not entire subtree
const children = await optimizedCache.buildTree(currentDirectory);
```

### 3. Search Optimization
Использовать индекс для предварительной фильтрации:
```javascript
// 1. Fast filter by index (in-memory)
const matchingIds = searchIndex.search(term, 2000);

// 2. Load full data only for top results
const results = await getFullDataBatch(matchingIds.slice(0, 1000));
```

## Error Handling

### Cache Load Failure
```javascript
async load() {
    try {
        await Promise.all([
            this.indexCache.load(),
            this.searchIndex.load()
        ]);
        this.isLoaded = true;
    } catch (error) {
        console.error('❌ Failed to load cache:', error);
        this.isLoaded = false;
        // Fallback: работа напрямую с БД
        throw error;
    }
}
```

### Database Query Failure
```javascript
async getFullData(id) {
    try {
        const data = this.hotDataCache.get(id);
        if (data) return data;
        
        const rows = await dbQuery('SELECT * FROM files WHERE id = ?', [id]);
        if (rows.length > 0) {
            this.hotDataCache.set(id, rows[0]);
            return rows[0];
        }
        return null;
    } catch (error) {
        console.error(`❌ Failed to load file ${id}:`, error);
        return null;
    }
}
```

## Testing Strategy

### 1. Memory Usage Tests
```javascript
// test-memory-usage.js
async function testMemoryUsage() {
    const before = process.memoryUsage();
    
    await optimizedCache.load();
    
    const after = process.memoryUsage();
    const diff = (after.heapUsed - before.heapUsed) / 1024 / 1024;
    
    console.log(`Memory used: ${diff.toFixed(2)} MB`);
    assert(diff < 250, 'Memory usage should be under 250 MB');
}
```

### 2. Performance Tests
```javascript
// test-performance.js
async function testSearchPerformance() {
    const start = Date.now();
    const results = await optimizedCache.search('test', 1000);
    const duration = Date.now() - start;
    
    console.log(`Search took: ${duration}ms`);
    assert(duration < 200, 'Search should complete in under 200ms');
}
```

### 3. Cache Hit Rate Tests
```javascript
// test-cache-hit-rate.js
async function testCacheHitRate() {
    // Warm up cache
    for (let i = 0; i < 100; i++) {
        await optimizedCache.getFullData(i);
    }
    
    // Test repeated access
    for (let i = 0; i < 100; i++) {
        await optimizedCache.getFullData(i);
    }
    
    const stats = optimizedCache.getStats();
    console.log(`Hit rate: ${stats.hotDataCache.hitRate}`);
    assert(parseFloat(stats.hotDataCache.hitRate) > 50, 'Hit rate should be > 50%');
}
```

## Migration Strategy

### Phase 1: Parallel Implementation
- Создать новый `OptimizedDatabaseCache` класс
- Старый `DatabaseCache` остается работать
- Добавить feature flag для переключения

### Phase 2: Testing
- Тестировать на dev окружении
- Сравнить метрики производительности
- Мониторить использование памяти

### Phase 3: Gradual Rollout
- Включить для 10% пользователей
- Мониторить ошибки и производительность
- Постепенно увеличивать до 100%

### Phase 4: Cleanup
- Удалить старый `DatabaseCache`
- Удалить feature flag
- Обновить документацию

## Configuration

### Environment Variables
```bash
# Cache configuration
CACHE_STRATEGY=optimized  # full | optimized
HOT_CACHE_SIZE=10000      # Number of records in hot cache
SEARCH_LIMIT=1000         # Max search results
ENABLE_CACHE_STATS=true   # Enable /api/cache/stats endpoint
```

### Runtime Configuration
```javascript
const config = {
    cacheStrategy: process.env.CACHE_STRATEGY || 'optimized',
    hotCacheSize: parseInt(process.env.HOT_CACHE_SIZE) || 10000,
    searchLimit: parseInt(process.env.SEARCH_LIMIT) || 1000,
    enableCacheStats: process.env.ENABLE_CACHE_STATS === 'true'
};
```

## Monitoring and Metrics

### Key Metrics
1. **Memory Usage**: Текущее потребление памяти кэшем
2. **Cache Hit Rate**: Процент попаданий в hot cache
3. **Search Performance**: Среднее время поиска
4. **Tree Build Time**: Время построения дерева файлов

### Logging
```javascript
// Every 5 minutes
setInterval(() => {
    const stats = optimizedCache.getStats();
    console.log('📊 Cache Stats:', JSON.stringify(stats, null, 2));
}, 5 * 60 * 1000);
```

### Health Check
```javascript
app.get('/api/health', (req, res) => {
    const stats = optimizedCache.getStats();
    const health = {
        status: optimizedCache.isLoaded ? 'healthy' : 'unhealthy',
        cache: stats,
        uptime: process.uptime(),
        memory: process.memoryUsage()
    };
    res.json(health);
});
```

## Expected Results

### Memory Reduction
- **Before**: ~1000 MB for 1.3M records
- **After**: ~150-230 MB for 1.3M records
- **Savings**: 77-85% reduction

### Performance Impact
- **Tree Building**: 80-120ms (vs 100-300ms) - similar or better
- **Search**: 30-100ms (vs 50-200ms) - 40% faster
- **File Details**: 5-15ms (vs instant) - acceptable tradeoff
- **Initial Load**: 2-4 seconds (vs 3-5 seconds) - 30% faster

### Scalability
- Can handle 5M+ records with ~500 MB RAM
- Linear memory growth with dataset size
- Predictable performance characteristics
