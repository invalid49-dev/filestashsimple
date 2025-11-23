/**
 * Optimized Database Cache Implementation
 * 
 * This module provides memory-efficient caching for large file databases.
 * It uses a three-tier approach:
 * 1. IndexCache - Minimal metadata for all files (~100MB for 1.3M records)
 * 2. HotDataCache - LRU cache for frequently accessed full records (~10MB)
 * 3. SearchIndex - Optimized search index (~80MB)
 * 
 * Total memory: ~190-230MB vs ~1000MB for full cache
 */

const sqlite3 = require('sqlite3').verbose();

/**
 * Helper function to promisify database queries
 */
function dbQuery(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

/**
 * IndexCache - Stores minimal file metadata for navigation and tree building
 * Memory: ~80 bytes per record = ~100MB for 1.3M records
 */
class IndexCache {
    constructor() {
        // Minimal data for each file
        this.index = new Map(); // key: id, value: { id, full_path, is_directory, directory }
        this.pathToId = new Map(); // key: full_path, value: id
        this.directoryIndex = new Map(); // key: directory, value: Set<id>
        this.isLoaded = false;
    }
    
    /**
     * Load minimal metadata from database
     */
    async load(db) {
        console.log('📥 Loading IndexCache...');
        const startTime = Date.now();
        
        const rows = await dbQuery(db, 'SELECT id, full_path, is_directory, directory FROM files WHERE (is_dummy IS NULL OR is_dummy = 0)');
        
        rows.forEach(row => {
            this.index.set(row.id, {
                id: row.id,
                full_path: row.full_path,
                is_directory: row.is_directory,
                directory: row.directory
            });
            
            this.pathToId.set(row.full_path, row.id);
            
            const dir = row.directory || '';
            if (!this.directoryIndex.has(dir)) {
                this.directoryIndex.set(dir, new Set());
            }
            this.directoryIndex.get(dir).add(row.id);
        });
        
        this.isLoaded = true;
        
        const duration = Date.now() - startTime;
        const memoryMB = this.estimateMemoryUsage();
        console.log(`✅ IndexCache loaded: ${rows.length} records in ${duration}ms (~${memoryMB}MB)`);
    }
    
    /**
     * Get file metadata by ID
     */
    getById(id) {
        return this.index.get(id);
    }
    
    /**
     * Get file metadata by path
     */
    getByPath(path) {
        const id = this.pathToId.get(path);
        return id ? this.index.get(id) : null;
    }
    
    /**
     * Get all child IDs for a directory
     */
    getChildrenIds(directory) {
        return this.directoryIndex.get(directory || '') || new Set();
    }
    
    /**
     * Get all file paths
     */
    getAllPaths() {
        return Array.from(this.pathToId.keys());
    }
    
    /**
     * Get all file IDs
     */
    getAllIds() {
        return Array.from(this.index.keys());
    }
    
    /**
     * Check if a path exists in the index
     */
    hasPath(path) {
        return this.pathToId.has(path);
    }
    
    /**
     * Get total number of indexed files
     */
    size() {
        return this.index.size;
    }
    
    /**
     * Estimate memory usage in MB
     */
    estimateMemoryUsage() {
        // Rough estimate: 80 bytes per record
        // (id: 8, full_path: 50, is_directory: 1, directory: 20, overhead: 1)
        const bytesPerRecord = 80;
        const totalBytes = this.index.size * bytesPerRecord;
        return Math.round(totalBytes / 1024 / 1024);
    }
    
    /**
     * Clear all cached data
     */
    clear() {
        this.index.clear();
        this.pathToId.clear();
        this.directoryIndex.clear();
        this.isLoaded = false;
    }
}

/**
 * HotDataCache - LRU cache for frequently accessed full file records
 * Memory: ~500 bytes per record × 10,000 = ~5MB + overhead = ~10MB
 */
class HotDataCache {
    constructor(maxSize = 10000) {
        this.cache = new Map(); // LRU cache using Map's insertion order
        this.maxSize = maxSize;
        this.hits = 0;
        this.misses = 0;
    }
    
    /**
     * Get cached data (returns null if not found or expired)
     */
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
    
    /**
     * Set cached data with LRU eviction
     */
    set(id, data) {
        // Remove if exists (to update position)
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
    
    /**
     * Remove specific entry from cache
     */
    delete(id) {
        return this.cache.delete(id);
    }
    
    /**
     * Check if cache contains an entry
     */
    has(id) {
        return this.cache.has(id);
    }
    
    /**
     * Get cache statistics
     */
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
    
    /**
     * Estimate memory usage in MB
     */
    estimateMemoryUsage() {
        // Rough estimate: 500 bytes per full record
        const bytesPerRecord = 500;
        const totalBytes = this.cache.size * bytesPerRecord;
        return Math.round(totalBytes / 1024 / 1024);
    }
    
    /**
     * Clear all cached data
     */
    clear() {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }
}

/**
 * SearchIndex - Optimized index for fast search operations
 * Memory: ~60 bytes per record = ~78MB for 1.3M records
 */
class SearchIndex {
    constructor() {
        this.filenameIndex = new Map(); // key: id, value: lowercase filename
        this.pathIndex = new Map(); // key: id, value: lowercase full_path
        this.isLoaded = false;
    }
    
    /**
     * Load search index from database
     */
    async load(db) {
        console.log('📥 Loading SearchIndex...');
        const startTime = Date.now();
        
        const rows = await dbQuery(db, 'SELECT id, filename, full_path FROM files WHERE (is_dummy IS NULL OR is_dummy = 0)');
        
        rows.forEach(row => {
            this.filenameIndex.set(row.id, row.filename.toLowerCase());
            this.pathIndex.set(row.id, row.full_path.toLowerCase());
        });
        
        this.isLoaded = true;
        
        const duration = Date.now() - startTime;
        const memoryMB = this.estimateMemoryUsage();
        console.log(`✅ SearchIndex loaded: ${rows.length} records in ${duration}ms (~${memoryMB}MB)`);
    }
    
    /**
     * Search for files matching the search term
     * Returns array of IDs sorted by relevance score
     */
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
            
            // Calculate relevance score
            let score = 0;
            
            // Exact filename match (highest priority)
            if (filename === lowerSearch) score += 1000;
            
            // Filename starts with search term
            if (filename.startsWith(lowerSearch)) score += 500;
            
            // Filename contains exact phrase
            if (filename.includes(lowerSearch)) score += 100;
            
            // Path contains exact phrase
            if (path.includes(lowerSearch)) score += 50;
            
            // Each word match in filename
            searchWords.forEach(word => {
                if (filename.includes(word)) score += 10;
            });
            
            results.push({ id, score });
            
            // Pre-filter to avoid processing too many results
            if (results.length >= limit * 2) break;
        }
        
        // Sort by score (descending) and return top results
        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(r => r.id);
    }
    
    /**
     * Get total number of indexed files
     */
    size() {
        return this.filenameIndex.size;
    }
    
    /**
     * Estimate memory usage in MB
     */
    estimateMemoryUsage() {
        // Rough estimate: 60 bytes per record
        // (id: 8, filename: 20, full_path: 30, overhead: 2)
        const bytesPerRecord = 60;
        const totalBytes = this.filenameIndex.size * bytesPerRecord;
        return Math.round(totalBytes / 1024 / 1024);
    }
    
    /**
     * Clear all cached data
     */
    clear() {
        this.filenameIndex.clear();
        this.pathIndex.clear();
        this.isLoaded = false;
    }
}

/**
 * OptimizedDatabaseCache - Main coordinator class that manages all cache components
 * Provides unified interface for memory-efficient database caching
 */
class OptimizedDatabaseCache {
    constructor(dbPath, options = {}) {
        this.dbPath = dbPath;
        this.db = null;
        
        // Initialize cache components
        this.indexCache = new IndexCache();
        this.hotDataCache = new HotDataCache(options.hotCacheSize || 10000);
        this.searchIndex = new SearchIndex();
        
        this.isLoaded = false;
        this.loadStartTime = null;
        this.loadDuration = null;
    }
    
    /**
     * Load all cache components in parallel
     */
    async load() {
        if (this.isLoaded) {
            console.log('⚠️  Cache already loaded');
            return;
        }
        
        console.log('📥 Loading OptimizedDatabaseCache...');
        this.loadStartTime = Date.now();
        
        try {
            // Open database connection
            this.db = await this._openDatabase();
            
            // Load IndexCache and SearchIndex in parallel
            await Promise.all([
                this.indexCache.load(this.db),
                this.searchIndex.load(this.db)
            ]);
            
            this.isLoaded = true;
            this.loadDuration = Date.now() - this.loadStartTime;
            
            const stats = this.getStats();
            console.log(`✅ OptimizedDatabaseCache loaded in ${this.loadDuration}ms`);
            console.log(`   Total memory: ~${stats.totalMemoryMB}MB`);
            console.log(`   Index: ${stats.indexCache.size} records (~${stats.indexCache.memoryMB}MB)`);
            console.log(`   Search: ${stats.searchIndex.size} records (~${stats.searchIndex.memoryMB}MB)`);
            console.log(`   Hot cache: ${stats.hotDataCache.size}/${stats.hotDataCache.maxSize} records`);
            
        } catch (error) {
            console.error('❌ Failed to load OptimizedDatabaseCache:', error);
            this.isLoaded = false;
            throw error;
        }
    }
    
    /**
     * Open database connection
     */
    _openDatabase() {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READONLY, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(db);
                }
            });
        });
    }
    
    /**
     * Get full file data by ID
     * Checks hot cache first, then falls back to database
     */
    async getFullData(id) {
        if (!this.isLoaded) {
            throw new Error('Cache not loaded. Call load() first.');
        }
        
        // Try hot cache first
        let data = this.hotDataCache.get(id);
        if (data) {
            return data;
        }
        
        // Load from database
        try {
            const rows = await dbQuery(this.db, 'SELECT * FROM files WHERE id = ?', [id]);
            if (rows && rows.length > 0) {
                const fileData = rows[0];
                this.hotDataCache.set(id, fileData);
                return fileData;
            }
        } catch (error) {
            console.error(`❌ Failed to load file ${id}:`, error);
            return null;
        }
        
        return null;
    }
    
    /**
     * Get full file data for multiple IDs in batch
     * Efficient batch loading from database for cache misses
     */
    async getFullDataBatch(ids) {
        if (!this.isLoaded) {
            throw new Error('Cache not loaded. Call load() first.');
        }
        
        if (!ids || ids.length === 0) {
            return [];
        }
        
        const results = [];
        const missingIds = [];
        
        // Check hot cache for each ID
        for (const id of ids) {
            const cached = this.hotDataCache.get(id);
            if (cached) {
                results.push(cached);
            } else {
                missingIds.push(id);
            }
        }
        
        // Batch load missing IDs from database
        if (missingIds.length > 0) {
            try {
                const placeholders = missingIds.map(() => '?').join(',');
                const rows = await dbQuery(
                    this.db,
                    `SELECT * FROM files WHERE id IN (${placeholders})`,
                    missingIds
                );
                
                // Add to hot cache and results
                rows.forEach(row => {
                    this.hotDataCache.set(row.id, row);
                    results.push(row);
                });
            } catch (error) {
                console.error(`❌ Failed to batch load ${missingIds.length} files:`, error);
            }
        }
        
        return results;
    }
    
    /**
     * Get minimal index data by ID
     */
    getIndexData(id) {
        return this.indexCache.getById(id);
    }
    
    /**
     * Get file by path
     */
    getByPath(path) {
        return this.indexCache.getByPath(path);
    }
    
    /**
     * Get all child IDs for a directory
     */
    getChildrenIds(directory) {
        return this.indexCache.getChildrenIds(directory);
    }
    
    /**
     * Search for files matching search term
     */
    async search(searchTerm, limit = 1000) {
        if (!this.isLoaded) {
            throw new Error('Cache not loaded. Call load() first.');
        }
        
        // Get matching IDs from search index
        const matchingIds = this.searchIndex.search(searchTerm, limit);
        
        // Load full data for results
        return await this.getFullDataBatch(matchingIds);
    }
    
    /**
     * Build file tree for a directory
     */
    async buildTree(directory = null) {
        if (!this.isLoaded) {
            throw new Error('Cache not loaded. Call load() first.');
        }
        
        // Use index cache for tree structure
        const childrenIds = this.indexCache.getChildrenIds(directory || '');
        
        // Load full data only for direct children
        return await this.getFullDataBatch(Array.from(childrenIds));
    }
    
    /**
     * Get all file paths
     */
    getAllPaths() {
        return this.indexCache.getAllPaths();
    }
    
    /**
     * Get all file IDs
     */
    getAllIds() {
        return this.indexCache.getAllIds();
    }
    
    /**
     * Check if path exists
     */
    hasPath(path) {
        return this.indexCache.hasPath(path);
    }
    
    /**
     * Get total number of files
     */
    size() {
        return this.indexCache.size();
    }
    
    /**
     * Invalidate all caches
     * Clears all cache components and resets state
     */
    invalidate() {
        console.log('🔄 Invalidating all cache components...');
        
        // Clear all cache components
        this.indexCache.clear();
        this.hotDataCache.clear();
        this.searchIndex.clear();
        
        // Reset loaded state
        this.isLoaded = false;
        this.loadStartTime = null;
        this.loadDuration = null;
        
        console.log('✅ All cache components invalidated');
    }
    
    /**
     * Reload all caches with proper sequencing
     * Invalidates existing caches and loads fresh data from database
     */
    async reload() {
        console.log('🔄 Reloading cache...');
        const reloadStartTime = Date.now();
        
        try {
            // Step 1: Invalidate all existing caches
            this.invalidate();
            
            // Step 2: Close existing database connection if open
            if (this.db) {
                await this.close();
                this.db = null;
            }
            
            // Step 3: Load fresh data from database
            await this.load();
            
            const reloadDuration = Date.now() - reloadStartTime;
            console.log(`✅ Cache reloaded successfully in ${reloadDuration}ms`);
            
        } catch (error) {
            console.error('❌ Failed to reload cache:', error);
            this.isLoaded = false;
            throw error;
        }
    }
    
    /**
     * Invalidate cache entries for a specific path
     * Removes entries from hot cache and marks for reload
     * @param {string} filePath - The file path to invalidate
     */
    invalidatePath(filePath) {
        if (!filePath) {
            console.warn('⚠️  Cannot invalidate empty path');
            return;
        }
        
        console.log(`🔄 Invalidating cache for path: ${filePath}`);
        
        // Get the file ID from index cache
        const indexData = this.indexCache.getByPath(filePath);
        
        if (indexData) {
            // Remove from hot cache
            this.hotDataCache.delete(indexData.id);
            console.log(`✅ Removed ${filePath} from hot cache`);
        } else {
            console.log(`⚠️  Path not found in index cache: ${filePath}`);
        }
    }
    
    /**
     * Invalidate cache entries for multiple paths
     * Batch invalidation for better performance
     * @param {string[]} filePaths - Array of file paths to invalidate
     */
    invalidatePaths(filePaths) {
        if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
            console.warn('⚠️  Cannot invalidate empty paths array');
            return;
        }
        
        console.log(`🔄 Invalidating cache for ${filePaths.length} paths...`);
        
        let invalidatedCount = 0;
        
        for (const filePath of filePaths) {
            const indexData = this.indexCache.getByPath(filePath);
            if (indexData) {
                this.hotDataCache.delete(indexData.id);
                invalidatedCount++;
            }
        }
        
        console.log(`✅ Invalidated ${invalidatedCount} paths from hot cache`);
    }
    
    /**
     * Invalidate cache entries for a directory and all its children
     * Recursively removes all entries under the specified directory
     * @param {string} directory - The directory path to invalidate
     */
    invalidateDirectory(directory) {
        if (!directory) {
            console.warn('⚠️  Cannot invalidate empty directory');
            return;
        }
        
        console.log(`🔄 Invalidating cache for directory: ${directory}`);
        
        let invalidatedCount = 0;
        const pathSeparator = process.platform === 'win32' ? '\\' : '/';
        
        // Get all paths from index cache
        const allPaths = this.indexCache.getAllPaths();
        
        // Find all paths that start with the directory path
        for (const filePath of allPaths) {
            // Check if path is under the directory
            if (filePath === directory || filePath.startsWith(directory + pathSeparator)) {
                const indexData = this.indexCache.getByPath(filePath);
                if (indexData) {
                    this.hotDataCache.delete(indexData.id);
                    invalidatedCount++;
                }
            }
        }
        
        console.log(`✅ Invalidated ${invalidatedCount} entries under directory ${directory}`);
    }
    
    /**
     * Invalidate cache entries for multiple directories
     * Batch directory invalidation for better performance
     * @param {string[]} directories - Array of directory paths to invalidate
     */
    invalidateDirectories(directories) {
        if (!directories || !Array.isArray(directories) || directories.length === 0) {
            console.warn('⚠️  Cannot invalidate empty directories array');
            return;
        }
        
        console.log(`🔄 Invalidating cache for ${directories.length} directories...`);
        
        let totalInvalidated = 0;
        
        for (const directory of directories) {
            const pathSeparator = process.platform === 'win32' ? '\\' : '/';
            const allPaths = this.indexCache.getAllPaths();
            
            for (const filePath of allPaths) {
                if (filePath === directory || filePath.startsWith(directory + pathSeparator)) {
                    const indexData = this.indexCache.getByPath(filePath);
                    if (indexData) {
                        this.hotDataCache.delete(indexData.id);
                        totalInvalidated++;
                    }
                }
            }
        }
        
        console.log(`✅ Invalidated ${totalInvalidated} entries under ${directories.length} directories`);
    }
    
    /**
     * Estimate total memory usage in MB
     */
    estimateMemoryUsage() {
        const indexSize = this.indexCache.estimateMemoryUsage();
        const hotSize = this.hotDataCache.estimateMemoryUsage();
        const searchSize = this.searchIndex.estimateMemoryUsage();
        return indexSize + hotSize + searchSize;
    }
    
    /**
     * Get comprehensive cache statistics
     */
    getStats() {
        return {
            isLoaded: this.isLoaded,
            loadDuration: this.loadDuration,
            indexCache: {
                size: this.indexCache.size(),
                memoryMB: this.indexCache.estimateMemoryUsage(),
                isLoaded: this.indexCache.isLoaded
            },
            hotDataCache: {
                ...this.hotDataCache.getStats(),
                memoryMB: this.hotDataCache.estimateMemoryUsage()
            },
            searchIndex: {
                size: this.searchIndex.size(),
                memoryMB: this.searchIndex.estimateMemoryUsage(),
                isLoaded: this.searchIndex.isLoaded
            },
            totalMemoryMB: this.estimateMemoryUsage()
        };
    }
    
    /**
     * Close database connection
     */
    async close() {
        if (this.db) {
            return new Promise((resolve, reject) => {
                this.db.close((err) => {
                    if (err) {
                        reject(err);
                    } else {
                        console.log('✅ Database connection closed');
                        resolve();
                    }
                });
            });
        }
    }
}

module.exports = {
    IndexCache,
    HotDataCache,
    SearchIndex,
    OptimizedDatabaseCache,
    dbQuery  // Export for use in other modules
};
