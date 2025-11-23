/**
 * Патчер для добавления debug логирования CMD вывода
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Добавление debug логирования...\n');

const targetFile = path.join(__dirname, 'archive-with-progress.js');
let content = fs.readFileSync(targetFile, 'utf8');

// Находим блок с iconv.decode
const oldCode = `                        const result = iconv.decode(buffer, 'cp866').trim();
                        
                        if (result && result.length > 0) {
                            console.log(\`  ✅ \${index + 1}. \${result}\`);
                            return result;
                        }
                        throw new Error('No short path');`;

const newCode = `                        const result = iconv.decode(buffer, 'cp866').trim();
                        
                        // Debug: показываем RAW и decoded результат
                        console.log(\`  🔍 RAW buffer[\${index + 1}]: \${buffer.toString('hex').substring(0, 100)}\`);
                        console.log(\`  🔍 Decoded[\${index + 1}]: "\${result}"\`);
                        console.log(\`  🔍 Length[\${index + 1}]: \${result.length}\`);
                        
                        if (result && result.length > 0 && !result.includes('\\\\')) {
                            // Короткое имя должно содержать ~ и не должно совпадать с оригиналом
                            if (result.includes('~') || result === filePath) {
                                console.log(\`  ✅ Short path[\${index + 1}]: \${result}\`);
                                return result;
                            } else {
                                console.log(\`  ⚠️ Not a short path, using original[\${index + 1}]\`);
                                return filePath;
                            }
                        }
                        console.log(\`  ⚠️ Empty result, using original[\${index + 1}]\`);
                        return filePath;`;

if (content.includes('if (result && result.length > 0) {')) {
    content = content.replace(oldCode, newCode);
    fs.writeFileSync(targetFile, content);
    console.log('✅ Debug логирование добавлено!\n');
    console.log('📝 Теперь будет показывать:');
    console.log('   - RAW buffer (hex)');
    console.log('   - Decoded строку');
    console.log('   - Длину результата');
    console.log('   - Проверку на короткое имя (~)\n');
} else {
    console.log('⚠️ Код не найден\n');
}
