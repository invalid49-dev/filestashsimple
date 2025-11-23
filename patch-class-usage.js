/**
 * Патчер замены использования классов на импорты
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Замена использования классов на импорты...\n');

const SERVER_FILE = path.join(__dirname, 'server.js');

// Читаем файл
let content = fs.readFileSync(SERVER_FILE, 'utf8');

console.log('🔄 Замена LRUCache на LRUCacheModule...');
// Замена инициализации LRUCache
content = content.replace(
    'const queryCache = config.enableQueryCache ? new LRUCache(config.queryCacheSize) : null;',
    'const queryCache = config.enableQueryCache ? new LRUCacheModule(config.queryCacheSize) : null;'
);
console.log('   ✅ LRUCache заменён\n');

console.log('🔄 Замена DatabaseCache на DatabaseCacheModule...');
// Замена инициализации DatabaseCache
content = content.replace(
    'const dbCache = new DatabaseCache();',
    'const dbCache = new DatabaseCacheModule();'
);
console.log('   ✅ DatabaseCache заменён\n');

// Сохранение
fs.writeFileSync(SERVER_FILE, content);

console.log('✅ Патч применён успешно!\n');
