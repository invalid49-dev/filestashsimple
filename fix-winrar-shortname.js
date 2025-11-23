// fix-winrar-shortname.js
// Патчер, исправляющий логику получения короткого имени для WinRAR.
// Проблема: в archive-with-progress.js проверка result.includes('\\')
// отбрасывала корректные короткие имена, из‑за чего использовался оригинальный путь
// с кириллическими символами, что приводило к ошибке WinRAR (code 10).

const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, 'archive-with-progress.js');
const backupFile = `${targetFile}.backup_shortname_${Date.now()}`;

console.log('🔧 Запуск патчера fix-winrar-shortname.js');
fs.copyFileSync(targetFile, backupFile);
console.log(`✅ Бэкап создан: ${backupFile}`);

let content = fs.readFileSync(targetFile, 'utf8');

// Старый блок (примерный) – ищем строку "if (result && result.length > 0 && !result.includes('\\\\'))"
const oldSnippet = `if (result && result.length > 0 && !result.includes('\\\\')) {`;
const newSnippet = `if (result && result.length > 0) {`;

if (content.includes(oldSnippet)) {
    content = content.replace(oldSnippet, newSnippet);
    console.log('✅ Условие проверки короткого имени исправлено');
} else {
    console.warn('⚠️ Ожидаемый фрагмент не найден – возможно файл уже изменён');
}

fs.writeFileSync(targetFile, content);
console.log('✅ archive-with-progress.js обновлён');
