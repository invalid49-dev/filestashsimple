/**
 * Улучшенный патчер - использует маркеры комментариев
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Упрощённый патчер: добавление импортов и комментирование старого кода...\n');

const SERVER_FILE = path.join(__dirname, 'server.js');
const SERVER_REFACTORED = path.join(__dirname, 'server-refactored.js');

// Читаем оригинальный файл
console.log('�� Чтение server.js...');
let lines = fs.readFileSync(SERVER_FILE, 'utf8').split(/\r?\n/);
console.log(`   📊 Исходный размер: ${lines.length} строк\n`);

// Наход��м строку с импортом db-utils и вставляем после неё
console.log('🔄 Добавление импортов модулей...');
let insertIndex = -1;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('} = require(\'./db-utils\');')) {
        insertIndex = i + 1;
        break;
    }
}

if (insertIndex === -1) {
    console.error('❌ Не найден импорт db-utils');
    process.exit(1);
}

const newImports = [
    '',
    '// ========== REFACTORED: Module Imports ==========',
    '// Cache management',
    'const { ',
    '    LRUCache: LRUCacheModule, ',
    '    DatabaseCache: DatabaseCacheModule,',
    '    invalidateDatabaseCaches: invalidateDatabaseCachesModule,',
    '    loadCacheWithFallback: loadCacheWithFallbackModule',
    '} = require(\'./server/cache-manager\');',
    '',
    '// File operations',
    'const {',
    '    getFileStats: getFileStatsModule,',
    '    getFileAttributes: getFileAttributesModule,',
    '    calculateCRC32: calculateCRC32Module,',
    '    getAvailableDrives: getAvailableDrivesModule,',
    '    getFileStatsOptimized: getFileStatsOptimizedModule',
    '} = require(\'./server/file-operations\');',
    '',
    '// Tree building',
    'const {',
    '    buildFileTree: buildFileTreeModule,',
    '    buildFileTreeOptimized: buildFileTreeOptimizedModule,',
    '    batchLoadTreeNodes: batchLoadTreeNodesModule',
    '} = require(\'./server/tree-builder\');',
    '',
    '// Scanning',
    'const {',
    '    getAllItemsNonRecursive: getAllItemsNonRecursiveModule,',
    '    getAllItemsRecursivelyOptimized: getAllItemsRecursivelyOptimizedModule,',
    '    scanMultipleDirectoriesAsync: scanMultipleDirectoriesAsyncModule',
    '} = require(\'./server/scanning\');',
    '// =============================================='
];

lines.splice(insertIndex, 0, ...newImports);
console.log(`   ✅ Добавлено ${newImports.length} строк импортов\n`);

// Комментируем старые определения классов
console.log('💬 Комментирование старых классов...');

function commentOutLines(lines, startMarker, endMarker) {
    let startIndex = -1;
    let endIndex = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(startMarker) && startIndex === -1) {
            startIndex = i;
        }
        if (startIndex !== -1 && lines[i].includes(endMarker)) {
            endIndex = i;
            break;
        }
    }

    if (startIndex !== -1 && endIndex !== -1) {
        for (let i = startIndex; i <= endIndex; i++) {
            if (!lines[i].startsWith('//')) {
                lines[i] = '// ' + lines[i];
            }
        }
        return endIndex - startIndex + 1;
    }
    return 0;
}

const commented1 = commentOutLines(lines, 'class LRUCache {', '// Initialize query cache');
console.log(`   ✅ Закомментировано ${commented1} строк LRUCache\n`);

const commented2 = commentOutLines(lines, 'class DatabaseCache {', '// Initialize database cache');
console.log(`   ✅ Закомментировано ${commented2} строк DatabaseCache\n`);

// Сохраняем результат
console.log('💾 Сохранение server-refactored.js...');
fs.writeFileSync(SERVER_REFACTORED, lines.join('\n'));

console.log(`\n📊 Результат:`);
console.log(`   Новый файл: server-refactored.js`);
console.log(`   Размер: ${lines.length} строк`);
console.log(`\n✅ Готово! Теперь можно заменить: move server-refactored.js server.js\n`);
