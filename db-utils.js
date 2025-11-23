/**
 * Database Utilities Module
 * 
 * Provides helper functions for database operations including:
 * - Promisified database queries
 * - Batch query optimization
 * - Query result caching
 * - Database index optimization
 */

const sqlite3 = require('sqlite3').verbose();

/**
 * Promisified database query helper
 * Converts callback-based db.all() to Promise-based
 * 
 * @param {sqlite3.Database} db - Database instance
 * @param {string} sql - SQL query string
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>} Query results
 */
function dbQuery(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows || []);
            }
        });
    });
}

/**
 * Promisified database query for single row
 * Converts callback-based db.get() to Promise-based
 * 
 * @param {sqlite3.Database} db - Database instance
 * @param {string} sql - SQL query string
 * @param {Array} params - Query parameters
 * @returns {Promise<Object|null>} Single row result or null
 */
function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row || null);
            }
        });
    });
}

/**
 * Promisified database run command
 * Converts callback-based db.run() to Promise-based
 * 
 * @param {sqlite3.Database} db - Database instance
 * @param {string} sql - SQL command string
 * @param {Array} params - Command parameters
 * @returns {Promise<Object>} Result with lastID and changes
 */
function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve({
                    lastID: this.lastID,
                    changes: this.changes
                });
            }
        });
    });
}

/**
 * Batch query optimization - load multiple records by IDs
 * Uses a single query with IN clause instead of multiple queries
 * 
 * @param {sqlite3.Database} db - Database instance
 * @param {Array<number>} ids - Array of record IDs to load
 * @param {string} table - Table name (default: 'files')
 * @returns {Promise<Array>} Array of records
 */
async function batchLoadByIds(db, ids, table = 'files') {
    if (!ids || ids.length === 0) {
        return [];
    }
    
    // Remove duplicates
    const uniqueIds = [...new Set(ids)];
    
    // Create placeholders for IN clause
    const placeholders = uniqueIds.map(() => '?').join(',');
    const sql = `SELECT * FROM ${table} WHERE id IN (${placeholders})`;
    
    return await dbQuery(db, sql, uniqueIds);
}

/**
 * Batch query optimization - load multiple records by paths
 * Uses a single query with IN clause instead of multiple queries
 * 
 * @param {sqlite3.Database} db - Database instance
 * @param {Array<string>} paths - Array of file paths to load
 * @param {string} table - Table name (default: 'files')
 * @returns {Promise<Array>} Array of records
 */
async function batchLoadByPaths(db, paths, table = 'files') {
    if (!paths || paths.length === 0) {
        return [];
    }
    
    // Remove duplicates
    const uniquePaths = [...new Set(paths)];
    
    // Create placeholders for IN clause
    const placeholders = uniquePaths.map(() => '?').join(',');
    const sql = `SELECT * FROM ${table} WHERE full_path IN (${placeholders})`;
    
    return await dbQuery(db, sql, uniquePaths);
}

/**
 * Batch delete records by IDs
 * Uses a single DELETE query with IN clause
 * 
 * @param {sqlite3.Database} db - Database instance
 * @param {Array<number>} ids - Array of record IDs to delete
 * @param {string} table - Table name (default: 'files')
 * @returns {Promise<number>} Number of deleted records
 */
async function batchDeleteByIds(db, ids, table = 'files') {
    if (!ids || ids.length === 0) {
        return 0;
    }
    
    // Remove duplicates
    const uniqueIds = [...new Set(ids)];
    
    // Create placeholders for IN clause
    const placeholders = uniqueIds.map(() => '?').join(',');
    const sql = `DELETE FROM ${table} WHERE id IN (${placeholders})`;
    
    const result = await dbRun(db, sql, uniqueIds);
    return result.changes;
}

/**
 * Batch delete records by paths
 * Uses a single DELETE query with IN clause
 * 
 * @param {sqlite3.Database} db - Database instance
 * @param {Array<string>} paths - Array of file paths to delete
 * @param {string} table - Table name (default: 'files')
 * @returns {Promise<number>} Number of deleted records
 */
async function batchDeleteByPaths(db, paths, table = 'files') {
    if (!paths || paths.length === 0) {
        return 0;
    }
    
    // Remove duplicates
    const uniquePaths = [...new Set(paths)];
    
    // Create placeholders for IN clause
    const placeholders = uniquePaths.map(() => '?').join(',');
    const sql = `DELETE FROM ${table} WHERE full_path IN (${placeholders})`;
    
    const result = await dbRun(db, sql, uniquePaths);
    return result.changes;
}

/**
 * Batch insert/update records
 * Uses a transaction for better performance
 * 
 * @param {sqlite3.Database} db - Database instance
 * @param {Array<Object>} records - Array of records to insert/update
 * @param {string} table - Table name (default: 'files')
 * @param {boolean} replace - Use INSERT OR REPLACE (default: true)
 * @returns {Promise<number>} Number of inserted/updated records
 */
async function batchInsertOrUpdate(db, records, table = 'files', replace = true) {
    if (!records || records.length === 0) {
        return 0;
    }
    
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION', (err) => {
                if (err) {
                    reject(err);
                    return;
                }
            });
            
            const insertType = replace ? 'INSERT OR REPLACE' : 'INSERT';
            const stmt = db.prepare(`${insertType} INTO ${table} 
                (full_path, directory, filename, extension, size, created_time, modified_time, is_directory, attributes, crc32, is_dummy)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            
            let completed = 0;
            let errorOccurred = false;
            
            for (const record of records) {
                stmt.run([
                    record.full_path,
                    record.directory,
                    record.filename,
                    record.extension,
                    record.size,
                    record.created_time,
                    record.modified_time,
                    record.is_directory,
                    record.attributes,
                    record.crc32,
                    record.is_dummy || 0
                ], function(err) {
                    if (err && !errorOccurred) {
                        errorOccurred = true;
                        stmt.finalize();
                        db.run('ROLLBACK', () => {
                            reject(err);
                        });
                        return;
                    }
                    
                    completed++;
                    if (completed === records.length && !errorOccurred) {
                        stmt.finalize((finalizeErr) => {
                            if (finalizeErr) {
                                db.run('ROLLBACK', () => {
                                    reject(finalizeErr);
                                });
                                return;
                            }
                            
                            db.run('COMMIT', (commitErr) => {
                                if (commitErr) {
                                    reject(commitErr);
                                } else {
                                    resolve(completed);
                                }
                            });
                        });
                    }
                });
            }
        });
    });
}

/**
 * Get count of records matching a condition
 * 
 * @param {sqlite3.Database} db - Database instance
 * @param {string} table - Table name
 * @param {string} whereClause - WHERE clause (without WHERE keyword)
 * @param {Array} params - Query parameters
 * @returns {Promise<number>} Count of matching records
 */
async function getCount(db, table, whereClause = '', params = []) {
    const sql = whereClause 
        ? `SELECT COUNT(*) as count FROM ${table} WHERE ${whereClause}`
        : `SELECT COUNT(*) as count FROM ${table}`;
    
    const result = await dbGet(db, sql, params);
    return result ? result.count : 0;
}

/**
 * Check if records exist by IDs
 * Returns a map of id -> exists (boolean)
 * 
 * @param {sqlite3.Database} db - Database instance
 * @param {Array<number>} ids - Array of record IDs to check
 * @param {string} table - Table name (default: 'files')
 * @returns {Promise<Map<number, boolean>>} Map of id to existence
 */
async function checkExistenceByIds(db, ids, table = 'files') {
    if (!ids || ids.length === 0) {
        return new Map();
    }
    
    const uniqueIds = [...new Set(ids)];
    const placeholders = uniqueIds.map(() => '?').join(',');
    const sql = `SELECT id FROM ${table} WHERE id IN (${placeholders})`;
    
    const rows = await dbQuery(db, sql, uniqueIds);
    const existingIds = new Set(rows.map(row => row.id));
    
    const resultMap = new Map();
    uniqueIds.forEach(id => {
        resultMap.set(id, existingIds.has(id));
    });
    
    return resultMap;
}

/**
 * Check if records exist by paths
 * Returns a map of path -> exists (boolean)
 * 
 * @param {sqlite3.Database} db - Database instance
 * @param {Array<string>} paths - Array of file paths to check
 * @param {string} table - Table name (default: 'files')
 * @returns {Promise<Map<string, boolean>>} Map of path to existence
 */
async function checkExistenceByPaths(db, paths, table = 'files') {
    if (!paths || paths.length === 0) {
        return new Map();
    }
    
    const uniquePaths = [...new Set(paths)];
    const placeholders = uniquePaths.map(() => '?').join(',');
    const sql = `SELECT full_path FROM ${table} WHERE full_path IN (${placeholders})`;
    
    const rows = await dbQuery(db, sql, uniquePaths);
    const existingPaths = new Set(rows.map(row => row.full_path));
    
    const resultMap = new Map();
    uniquePaths.forEach(path => {
        resultMap.set(path, existingPaths.has(path));
    });
    
    return resultMap;
}

/**
 * Optimize database indexes for common query patterns
 * Creates indexes if they don't exist
 * 
 * @param {sqlite3.Database} db - Database instance
 * @returns {Promise<void>}
 */
async function optimizeIndexes(db) {
    console.log('🔧 Optimizing database indexes...');
    
    const indexes = [
        // Basic indexes
        'CREATE INDEX IF NOT EXISTS idx_filename ON files(filename)',
        'CREATE INDEX IF NOT EXISTS idx_directory ON files(directory)',
        'CREATE INDEX IF NOT EXISTS idx_extension ON files(extension)',
        'CREATE INDEX IF NOT EXISTS idx_size ON files(size)',
        'CREATE INDEX IF NOT EXISTS idx_is_directory ON files(is_directory)',
        'CREATE INDEX IF NOT EXISTS idx_crc32 ON files(crc32)',
        'CREATE INDEX IF NOT EXISTS idx_full_path ON files(full_path)',
        
        // Composite indexes for optimized queries
        'CREATE INDEX IF NOT EXISTS idx_directory_filename ON files(directory, is_directory DESC, filename ASC)',
        'CREATE INDEX IF NOT EXISTS idx_directory_isdir ON files(directory, is_directory)',
        'CREATE INDEX IF NOT EXISTS idx_parent_count ON files(directory, is_directory)',
        
        // Indexes for search optimization
        'CREATE INDEX IF NOT EXISTS idx_filename_lower ON files(LOWER(filename))',
        'CREATE INDEX IF NOT EXISTS idx_path_lower ON files(LOWER(full_path))',
        
        // Index for batch operations
        'CREATE INDEX IF NOT EXISTS idx_id_path ON files(id, full_path)',
        'CREATE INDEX IF NOT EXISTS idx_path_id ON files(full_path, id)'
    ];
    
    for (const indexSql of indexes) {
        try {
            await dbRun(db, indexSql);
        } catch (error) {
            console.error(`❌ Failed to create index: ${error.message}`);
        }
    }
    
    console.log('✅ Database indexes optimized');
}

/**
 * Analyze database tables to update statistics
 * Helps query planner choose optimal execution plans
 * 
 * @param {sqlite3.Database} db - Database instance
 * @param {number} maxRetries - Maximum number of retries (default: 3)
 * @param {number} retryDelay - Delay between retries in ms (default: 500)
 * @returns {Promise<void>}
 */
async function analyzeDatabase(db, maxRetries = 3, retryDelay = 500) {
    console.log('📊 Analyzing database...');
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            await dbRun(db, 'ANALYZE');
            console.log('✅ Database analysis complete');
            return;
        } catch (error) {
            if (error.code === 'SQLITE_BUSY' && attempt < maxRetries - 1) {
                console.log(`⚠️  Database busy during analysis, retrying in ${retryDelay}ms (attempt ${attempt + 1}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
            }
            
            // If all retries failed or it's a different error, log and continue
            console.warn(`⚠️  Database analysis skipped: ${error.message}`);
            console.log('   This is not critical - the database will still work correctly');
            return;
        }
    }
}

/**
 * Get database statistics
 * 
 * @param {sqlite3.Database} db - Database instance
 * @returns {Promise<Object>} Database statistics
 */
async function getDatabaseStats(db) {
    const stats = {};
    
    // Total records
    const totalResult = await dbGet(db, 'SELECT COUNT(*) as count FROM files');
    stats.totalRecords = totalResult ? totalResult.count : 0;
    
    // Files vs directories
    const filesResult = await dbGet(db, 'SELECT COUNT(*) as count FROM files WHERE is_directory = 0');
    const dirsResult = await dbGet(db, 'SELECT COUNT(*) as count FROM files WHERE is_directory = 1');
    stats.totalFiles = filesResult ? filesResult.count : 0;
    stats.totalDirectories = dirsResult ? dirsResult.count : 0;
    
    // Total size
    const sizeResult = await dbGet(db, 'SELECT SUM(size) as total FROM files WHERE is_directory = 0');
    stats.totalSize = sizeResult && sizeResult.total ? sizeResult.total : 0;
    
    // Database file size
    const pageCountResult = await dbGet(db, 'PRAGMA page_count');
    const pageSizeResult = await dbGet(db, 'PRAGMA page_size');
    if (pageCountResult && pageSizeResult) {
        stats.databaseSize = pageCountResult.page_count * pageSizeResult.page_size;
    }
    
    return stats;
}

/**
 * Execute a query with automatic retry on SQLITE_BUSY
 * 
 * @param {sqlite3.Database} db - Database instance
 * @param {Function} queryFn - Query function to execute
 * @param {number} maxRetries - Maximum number of retries (default: 3)
 * @param {number} retryDelay - Delay between retries in ms (default: 100)
 * @returns {Promise<any>} Query result
 */
async function queryWithRetry(db, queryFn, maxRetries = 3, retryDelay = 100) {
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await queryFn();
        } catch (error) {
            lastError = error;
            
            // Retry only on SQLITE_BUSY errors
            if (error.code === 'SQLITE_BUSY' && attempt < maxRetries - 1) {
                console.log(`⚠️  Database busy, retrying in ${retryDelay}ms (attempt ${attempt + 1}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
            }
            
            throw error;
        }
    }
    
    throw lastError;
}

module.exports = {
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
};
