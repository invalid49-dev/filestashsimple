/**
 * Патчер для исправления кодировки коротких имён WinRAR
 * Проблема: CMD возвращает текст в CP866, а Node читает как UTF-8
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Исправление кодировки для WinRAR...\n');

const targetFile = path.join(__dirname, 'archive-with-progress.js');
let content = fs.readFileSync(targetFile, 'utf8');

// Ищем блок с execSync для WinRAR
const oldCode = `                        const result = execSync(cmd, {
                            encoding: 'utf8',
                            timeout: 5000
                        }).trim();`;

const newCode = `                        // CMD возвращает CP866, нужно правильно декодировать
                        const buffer = execSync(cmd, {
                            encoding: 'buffer',
                            timeout: 5000
                        });
                        const result = iconv.decode(buffer, 'cp866').trim();`;

if (content.includes(oldCode)) {
    content = content.replace(oldCode, newCode);
    fs.writeFileSync(targetFile, content);
    console.log('✅ Кодировка исправлена!\n');
    console.log('📝 Изменения:');
    console.log('   - execSync теперь возвращает Buffer');
    console.log('   - Декодирование через iconv из CP866');
    console.log('   - Короткие имена будут читаться правильно\n');
} else {
    console.log('⚠️ Код не найден, возможно уже исправлено или файл изменён\n');
}
