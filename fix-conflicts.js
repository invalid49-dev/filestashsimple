/**
 * Патчер для исправления конфликтов после рефакторинга
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Исправление конфликтов переменных...\n');

const APP_FILE = path.join(__dirname, 'public', 'app.js');

// Читаем файл
let content = fs.readFileSync(APP_FILE, 'utf8');
let lines = content.split('\n');

console.log(`📊 Исходный размер: ${lines.length} строк\n`);

// Находим и комментируем дублирующиеся объявления
let changesMade = 0;

// 1. Комментируем currentScanId (строка 17)
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('let currentScanId = null;') && !lines[i].startsWith('//')) {
        console.log(`   Найдено: строка ${i + 1}: ${lines[i]}`);
        lines[i] = '// ' + lines[i] + ' // MOVED TO: scan-manager.js';
        changesMade++;
        console.log(`   ✅ Закомментировано: let currentScanId\n`);
        break; // Только первое вхождение
    }
}

// 2. Комментируем selectedTreeFiles
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('let selectedTreeFiles = new Set();') && !lines[i].startsWith('//')) {
        console.log(`   Найдено: строка ${i + 1}: ${lines[i]}`);
        lines[i] = '// ' + lines[i] + ' // MOVED TO: file-tree.js';
        changesMade++;
        console.log(`   ✅ Закомментировано: let selectedTreeFiles\n`);
        break;
    }
}

// Сохраняем
content = lines.join('\n');
fs.writeFileSync(APP_FILE, content);

console.log(`✅ Исправлено конфликтов: ${changesMade}\n`);
console.log('📝 Изменения сохранены в app.js\n');
