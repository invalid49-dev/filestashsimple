/**
 * Финальный патчер - обновление server.js
 * Заменяет классы и функции импортами из модулей
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Обновление server.js для использования модулей...\n');

const SERVER_FILE = path.join(__dirname, 'server.js');
const NEW_SERVER_FILE = path.join(__dirname, 'server-new.js');

// Читаем оригинальный файл
console.log('📖 Чтение server.js...');
let content = fs.readFileSync(SERVER_FILE, 'utf8');
const originalLines = content.split('\n').length;
console.log(`   📊 Исходный размер: ${originalLines} строк\n`);

// Заменяем импорты - добавляем импорты модулей
console.log('🔄 Добавление импортов модулей...');
const moduleImports = `
// Модули рефакторинга
const { LRUCache, DatabaseCache, invalidateDatabaseCaches, loadCacheWithFallback } = require('./server/cache-manager');
const { getFileStats, getFileAttributes, calculateCRC32, getAvailableDrives, getFileStatsOptimized } = require('./server/file-operations');
const { getAllItemsNonRecursive, getAllItemsRecursivelyOptimized, scanMultipleDirectoriesAsync, batchInsertToDatabase } = require('./server/scanning');
const { buildFileTree, buildFileTreeOptimized, batchLoadTreeNodes } = require('./server/tree-builder');
`;

// Находим позицию после основных импортов (после db-utils)
const dbUtilsImportEnd = content.indexOf('} = require(\'./db-utils\');');
if (dbUtilsImportEnd === -1) {
    console.error('❌ Не найден импорт db-utils');
    process.exit(1);
}

const insertPosition = content.indexOf('\n', dbUtilsImportEnd) + 1;
content = content.slice(0, insertPosition) + moduleImports + content.slice(insertPosition);
console.log('   ✅ Импорты добавлены\n');

// Удаляем определение класса LRUCache (строки 57-145)
console.log('🗑️  Удаление класса LRUCache (теперь в cache-manager.js)...');
const lruCacheStart = content.indexOf('// Simple LRU Cache implementation');
const lruCacheEnd = content.indexOf('}\n\n// Initialize query cache', lruCacheStart);
if (lruCacheStart > -1 && lruCacheEnd > -1) {
    content = content.slice(0, lruCacheStart) + content.slice(lruCacheEnd);
    console.log('   ✅ Класс LRUCache удалён\n');
}

// Удаляем определение класса DatabaseCache (строки 151-325)
console.log('🗑️  Удаление класса DatabaseCache (теперь в cache-manager.js)...');
const dbCacheStart = content.indexOf('// In-memory database cache\nclass DatabaseCache {');
const dbCacheEnd = content.indexOf('}\n\n// Initialize database cache', dbCacheStart);
if (dbCacheStart > -1 && dbCacheEnd > -1) {
    content = content.slice(0, dbCacheStart) + content.slice(dbCacheEnd);
    console.log('   ✅ Класс DatabaseCache удалён\n');
}

// Удаляем функции работы с файлами (getFileStats, getFileAttributes, calculateCRC32)
console.log('🗑️  Удаление функций работы с файлами (теперь в file-operations.js)...');
const fileStatsStart = content.indexOf('// Helper function to get file stats\nfunction getFileStats(');
const fileStatsEnd = content.indexOf('}\n\n// Build hierarchical tree', fileStatsStart);
if (fileStatsStart > -1 && fileStatsEnd > -1) {
    content = content.slice(0, fileStatsStart) + content.slice(fileStatsEnd);
    console.log('   ✅ Функции работы с файлами удалены\n');
}

// Удаляем функции построения дерева (buildFileTree, buildFileTreeOptimized)
console.log('🗑️  Удаление функций построения дерева (теперь в tree-builder.js)...');
const treeStart = content.indexOf('// Build hierarchical tree structure');
const treeEnd = content.indexOf('}\n\n// Get available drives', treeStart);
if (treeStart > -1 && treeEnd > -1) {
    content = content.slice(0, treeStart) + content.slice(treeEnd);
    console.log('   ✅ Функции построения дерева удалены\n');
}

// Удаляем функцию getAvailableDrives (теперь импортируется)
console.log('🗑️  Удаление функции getAvailableDrives (теперь в file-operations.js)...');
const drivesStart = content.indexOf('// Get available drives (Windows specific)\nfunction getAvailableDrives() {');
const drivesEnd = content.indexOf('}\n\n// Helper function to collect', drivesStart);
if (drivesStart > -1 && drivesEnd > -1) {
    content = content.slice(0, drivesStart) + content.slice(drivesEnd);
    console.log('   ✅ Функция getAvailableDrives удалена\n');
}

// Обновляем использование loadCacheWithFallback
console.log('🔄 Обновление вызова loadCacheWithFallback...');
content = content.replace(
    /const result = await loadCacheWithFallback\(\);/g,
    'const result = await loadCacheWithFallback(db, optimizedCache, dbCache, activeCacheType);'
);
console.log('   ✅ Вызов loadCacheWithFallback обновлён\n');

// Обновляем использование invalidateDatabaseCaches
console.log('🔄 Обновление вызовов invalidateDatabaseCaches...');
content = content.replace(
    /await invalidateDatabaseCaches\(([^)]*)\);/g,
    'await invalidateDatabaseCaches(db, queryCache, optimizedCache, dbCache$1);'
);
console.log('   ✅ invariantДаvalid��������invalidateDatabaseCaches обновлены\n');

// Сохраняем новый файл
console.log('💾 Сохранение обновленного server.js...');
fs.writeFileSync(NEW_SERVER_FILE, content);

const newLines = content.split('\n').length;
const reduction = originalLines - newLines;
const reductionPercent = ((reduction / originalLines) * 100).toFixed(1);

console.log(`   ✅ Создан: server-new.js\n`);
console.log(`📊 Статистика рефакторинга:`);
console.log(`   Исходный размер: ${originalLines} строк`);
console.log(`   Новый размер: ${newLines} строк`);
console.log(`   Сокращение: ${reduction} строк (${reductionPercent}%)\n`);

console.log('📝 Следующие шаги:');
console.log('   1. Проверьте server-new.js');
console.log('   2. Если всё корректно, замените: move server-new.js server.js');
console.log('   3. Запустите сервер для тестирования\n');
