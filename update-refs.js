/**
 * Патчер для обновления ссылок на глобальные переменные
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Обновление ссылок на глобальные переменные...\n');

// Обновить file-tree.js - заменить все selectedTreeFiles на window.selectedTreeFiles
console.log('📝 Обновление file-tree.js...');
const fileTreePath = path.join(__dirname, 'public', 'js', 'file-tree.js');
let content = fs.readFileSync(fileTreePath, 'utf8');

// Заменить selectedTreeFiles на window.selectedTreeFiles везде кроме определения
content = content.replace(/selectedTreeFiles\.size/g, 'window.selectedTreeFiles.size');
content = content.replace(/: selectedTreeFiles$/gm, ': window.selectedTreeFiles');

fs.writeFileSync(fileTreePath, content);
console.log('   ✅ Обновлены ссылки в file-tree.js\n');

console.log('✅ Обновление завершено!\n');
