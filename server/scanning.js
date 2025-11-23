/**
 * Scanning Module
 * Логика сканирования файловой системы
 */

const fs = require('fs');
const path = require('path');
const { getFileStatsOptimized } = require('./file-operations');
const { batchInsertOrUpdate } = require('../db-utils');

/**
 * Batch insert to database
 */
async function batchInsertToDatabase(fileStats) {
    // Implement batch insert logic
    // This will use the existing batchInsertOrUpdate from db-utils
    console.log(`💾 Inserting ${fileStats.length} records to database...`);
    
    // TODO: Implement actual database insertion
    // For now, placeholder
}

/**
 * Non-recursive directory scan
 */
async function getAllItemsNonRecursive(rootPath, scanId, scanProgress) {
    const items = [];
    const fs_promises = require('fs').promises;
    const progress = scanProgress.get(scanId);

    try {
        await fs_promises.access(rootPath);
    } catch (error) {
        console.log(`⚠️ Path does not exist, skipping: ${rootPath}`);
        return items;
    }

    items.push(rootPath);
    console.log(`📁 Added directory itself for non-recursive scan: ${rootPath}`);

    try {
        const dirItems = await fs_promises.readdir(rootPath);
        
        const itemPromises = dirItems.map(async (item) => {
            const fullPath = path.join(rootPath, item);
            try {
                const stats = await fs_promises.stat(fullPath);
                return { fullPath, isDirectory: stats.isDirectory() };
            } catch (e) {
                return null;
            }
        });
        
        const itemResults = await Promise.all(itemPromises);
        
        for (const result of itemResults) {
            if (result && !result.isDirectory) {
                items.push(result.fullPath);
            }
        }
        
        console.log(`📊 Non-recursive scan of ${rootPath}: found ${items.length} items (including directory itself)`);
    } catch (e) {
        console.error(`❌ Error scanning directory: ${rootPath}`, e.message);
    }

    return items;
}

/**
 * Recursive directory scan (optimized)
 */
async function getAllItemsRecursivelyOptimized(rootPath, scanId, scanProgress) {
    const items = [];
    const directories = [rootPath];
    const fs_promises = require('fs').promises;
    const progress = scanProgress.get(scanId);

    try {
        await fs_promises.access(rootPath);
    } catch (error) {
        console.log(`⚠️ Path does not exist, skipping: ${rootPath}`);
        return items;
    }

    while (directories.length > 0) {
        if (progress && progress.cancellationRequested) {
            console.log(`🛑 Enumeration cancelled for ${rootPath}`);
            break;
        }

        const currentDir = directories.shift();
        items.push(currentDir);

        try {
            const dirItems = await fs_promises.readdir(currentDir);
            
            const itemPromises = dirItems.map(async (item) => {
                const fullPath = path.join(currentDir, item);
                try {
                    const stats = await fs_promises.stat(fullPath);
                    return { fullPath, isDirectory: stats.isDirectory() };
                } catch (e) {
                    return null;
                }
            });
            
            const itemResults = await Promise.all(itemPromises);
            
            for (const result of itemResults) {
                if (!result) continue;
                
                if (result.isDirectory) {
                    directories.push(result.fullPath);
                } else {
                    items.push(result.fullPath);
                }
            }
        } catch (e) {
            console.error(`❌ Error scanning directory: ${currentDir}`, e.message);
        }
    }

    return items;
}

/**
 * Scan multiple directories asynchronously
 */
async function scanMultipleDirectoriesAsync(rootPaths, scanId, threadCount, calculateCrc32, scanProgress, addScanToHistory) {
    const progress = scanProgress.get(scanId);
    let scannedCount = 0;
    
    try {
        if (progress.cancellationRequested) {
            progress.status = 'cancelled';
            progress.cancelled = true;
            progress.endTime = Date.now();
            progress.duration = progress.endTime - progress.startTime;
            console.log(`🛑 Scan ${scanId} cancelled before enumeration`);
            
            try {
                const pathsArray = Array.isArray(rootPaths) 
                    ? rootPaths.map(p => typeof p === 'string' ? p : p.path)
                    : [rootPaths];
                
                const scanRecord = {
                    id: scanId,
                    startTime: new Date(progress.startTime).toISOString(),
                    endTime: new Date(progress.endTime).toISOString(),
                    duration: progress.duration,
                    status: 'cancelled',
                    paths: pathsArray,
                    threadCount: threadCount,
                    filesProcessed: 0,
                    totalFound: 0,
                    calculateCrc32: calculateCrc32,
                    errors: progress.errors || [],
                    cancelled: true
                };
                
                addScanToHistory(scanRecord);
            } catch (historyError) {
                console.error('❌ Failed to record early cancelled scan history:', historyError);
            }
            
            return;
        }
        
        console.log(`🔍 Starting directory enumeration with ${threadCount} threads...`);
        let allItems = [];
        
        const pathPromises = rootPaths.map(pathItem => {
            const scanPath = typeof pathItem === 'string' ? pathItem : pathItem.path;
            const isRecursive = typeof pathItem === 'string' ? true : pathItem.recursive;
            
            if (isRecursive) {
                return getAllItemsRecursivelyOptimized(scanPath, scanId, scanProgress);
            } else {
                return getAllItemsNonRecursive(scanPath, scanId, scanProgress);
            }
        });
        const pathResults = await Promise.all(pathPromises);
        
        if (progress.cancellationRequested) {
            progress.status = 'cancelled';
            progress.cancelled = true;
            progress.endTime = Date.now();
            progress.duration = progress.endTime - progress.startTime;
            console.log(`🛑 Scan ${scanId} cancelled after enumeration`);
            return;
        }
        
        for (const items of pathResults) {
            allItems = allItems.concat(items);
        }
        
        progress.total = allItems.length;
        console.log(`📊 Found ${allItems.length} items to process`);
        
        const chunkSize = Math.ceil(allItems.length / threadCount);
        const chunks = [];
        
        for (let i = 0; i < allItems.length; i += chunkSize) {
            chunks.push(allItems.slice(i, i + chunkSize));
        }
        
        console.log(`⚡ Processing ${chunks.length} chunks in parallel...`);
        
        const chunkPromises = chunks.map(async (chunk, chunkIndex) => {
            const chunkResults = [];
            
            for (const itemPath of chunk) {
                if (progress.cancellationRequested) {
                    console.log(`🛑 Chunk ${chunkIndex} stopping due to cancellation request`);
                    break;
                }
                
                try {
                    const fileStats = await getFileStatsOptimized(itemPath, calculateCrc32);
                    
                    if (fileStats) {
                        chunkResults.push(fileStats);
                        scannedCount++;
                        progress.processed = scannedCount;
                        
                        if (scannedCount % 100 === 0) {
                            console.log(`📈 Processed ${scannedCount}/${allItems.length} items`);
                        }
                    }
                } catch (error) {
                    progress.errors.push(`Error processing ${itemPath}: ${error.message}`);
                }
            }
            
            return chunkResults;
        });
        
        const chunkResults = await Promise.all(chunkPromises);
        
        if (progress.cancellationRequested) {
            progress.status = 'cancelled';
            progress.cancelled = true;
            progress.endTime = Date.now();
            progress.duration = progress.endTime - progress.startTime;
            
            const allFileStats = chunkResults.flat();
            if (allFileStats.length > 0) {
                console.log(`💾 Inserting ${allFileStats.length} successfully scanned records before cancellation...`);
                await batchInsertToDatabase(allFileStats);
            }
            
            console.log(`🛑 Scan ${scanId} cancelled. Processed ${scannedCount} items before cancellation.`);
            return;
        }
        
        const allFileStats = chunkResults.flat();
        console.log(`💾 Batch inserting ${allFileStats.length} records to database...`);
        
        await batchInsertToDatabase(allFileStats);
        
        progress.status = 'completed';
        progress.endTime = Date.now();
        progress.duration = progress.endTime - progress.startTime;
        
        console.log(`✅ Scan completed in ${Math.round(progress.duration / 1000)} seconds`);
        
    } catch (error) {
        progress.status = 'error';
        progress.endTime = Date.now();
        progress.duration = progress.endTime - progress.startTime;
        progress.errors.push(`Scan error: ${error.message}`);
        console.error('❌ Scan error:', error);
    }
}

module.exports = {
    getAllItemsNonRecursive,
    getAllItemsRecursivelyOptimized,
    scanMultipleDirectoriesAsync,
    batchInsertToDatabase
};
