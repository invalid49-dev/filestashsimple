/**
 * Tree Builder Module
 * Построение иерархического дерева файлов
 */

const fs = require('fs');
const path = require('path');

/**
 * Build hierarchical tree structure from flat file list
 */
function buildFileTree(files) {
    const tree = {};
    const pathSeparator = process.platform === 'win32' ? '\\' : '/';
    
    const existingPaths = new Set();
    files.forEach(file => {
        if (file.full_path) {
            existingPaths.add(file.full_path);
        }
    });
    
    files.forEach(file => {
        if (!file.full_path) return;
        
        const normalizedPath = file.full_path.replace(/[\/\\]/g, pathSeparator);
        const pathParts = normalizedPath.split(pathSeparator).filter(part => part.length > 0);
        
        if (pathParts.length === 0) return;
        
        let currentLevel = tree;
        let currentPath = '';
        
        pathParts.forEach((part, index) => {
            const previousPath = currentPath;
            currentPath += (currentPath ? pathSeparator : '') + part;
            
            const isLastPart = index === pathParts.length - 1;
            const pathExistsInDB = existingPaths.has(currentPath);
            
            if (isLastPart || pathExistsInDB) {
                if (!currentLevel[part]) {
                    currentLevel[part] = {
                        name: part,
                        path: currentPath,
                        isDirectory: file.is_directory || !isLastPart,
                        children: {},
                        expanded: false,
                        inDatabase: pathExistsInDB
                    };
                }
                
                if (isLastPart) {
                    let existsOnDisk = false;
                    try {
                        existsOnDisk = fs.existsSync(file.full_path);
                    } catch (error) {
                        existsOnDisk = false;
                    }
                    
                    currentLevel[part].fileData = {
                        id: file.id,
                        filename: file.filename,
                        extension: file.extension,
                        size: file.size,
                        created_time: file.created_time,
                        modified_time: file.modified_time,
                        crc32: file.crc32
                    };
                    currentLevel[part].isDirectory = file.is_directory === 1;
                    currentLevel[part].inDatabase = true;
                    currentLevel[part].existsOnDisk = existsOnDisk;
                    
                    if (!file.is_directory) {
                        delete currentLevel[part].children;
                    }
                }
                
                if (currentLevel[part].isDirectory) {
                    currentLevel = currentLevel[part].children;
                }
            } else {
                if (!currentLevel[part]) {
                    currentLevel[part] = {
                        name: part,
                        path: currentPath,
                        isDirectory: true,
                        children: {},
                        expanded: false,
                        inDatabase: false
                    };
                }
                currentLevel = currentLevel[part].children;
            }
        });
    });
    
    return tree;
}

/**
 * Build tree structure using OptimizedCache
 */
async function buildFileTreeOptimized(directory, optimizedCache) {
    if (!optimizedCache.isLoaded) {
        throw new Error('OptimizedCache not loaded');
    }
    
    const childrenIds = optimizedCache.getChildrenIds(directory || '');
    
    if (childrenIds.size === 0) {
        return [];
    }
    
    const children = await optimizedCache.getFullDataBatch(Array.from(childrenIds));
    
    return children.map(file => {
        const hasChildren = file.is_directory === 1 && 
            optimizedCache.getChildrenIds(file.full_path).size > 0;
        
        let existsOnDisk = false;
        try {
            existsOnDisk = fs.existsSync(file.full_path);
        } catch (error) {
            existsOnDisk = false;
        }
        
        return {
            id: file.id,
            path: file.full_path,
            name: file.filename,
            isDirectory: file.is_directory === 1,
            hasChildren: hasChildren,
            size: file.size,
            extension: file.extension,
            createdTime: file.created_time,
            modifiedTime: file.modified_time,
            crc32: file.crc32,
            existsOnDisk: existsOnDisk,
            inDatabase: true,
            children: null
        };
    });
}

/**
 * Batch load tree nodes with full details
 */
async function batchLoadTreeNodes(nodeIds, optimizedCache) {
    if (!optimizedCache.isLoaded) {
        throw new Error('OptimizedCache not loaded');
    }
    
    const nodes = await optimizedCache.getFullDataBatch(nodeIds);
    
    return nodes.map(file => {
        const hasChildren = file.is_directory === 1 && 
            optimizedCache.getChildrenIds(file.full_path).size > 0;
        
        let existsOnDisk = false;
        try {
            existsOnDisk = fs.existsSync(file.full_path);
        } catch (error) {
            existsOnDisk = false;
        }
        
        return {
            id: file.id,
            path: file.full_path,
            name: file.filename,
            isDirectory: file.is_directory === 1,
            hasChildren: hasChildren,
            size: file.size,
            extension: file.extension,
            createdTime: file.created_time,
            modifiedTime: file.modified_time,
            crc32: file.crc32,
            existsOnDisk: existsOnDisk,
            inDatabase: true
        };
    });
}

module.exports = {
    buildFileTree,
    buildFileTreeOptimized,
    batchLoadTreeNodes
};
