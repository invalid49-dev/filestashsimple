/**
 * Патчер для восстановления archive-with-progress.js
 * Исправляет создание списка файлов для WinRAR с использованием коротких имён
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Восстановление archive-with-progress.js...\n');

const targetFile = path.join(__dirname, 'archive-with-progress.js');

// Читаем текущий файл
let content = fs.readFileSync(targetFile, 'utf8');

// Находим блок создания файла списка (строка 64-110 примерно)
const searchPattern = /\/\/ Create temporary list file[\s\S]*?\/\/ Check if archive path contains non-ASCII/;

const replacementCode = `// Create temporary list file for file paths (to handle Cyrillic properly)
        // This is necessary because passing Cyrillic paths directly in command line causes encoding issues
        try {
            const timestamp = Date.now();
            listFilePath = path.join(os.tmpdir(), \`archive_list_\${timestamp}.txt\`);

            // Different encoding for different archivers
            if (archiverType === '7zip') {
                // 7-Zip: Use UTF-8 with -scsUTF-8 switch
                const listContent = filePaths.join('\\r\\n');
                fs.writeFileSync(listFilePath, listContent, 'utf8');
            } else if (archiverType === 'winrar') {
                // WinRAR: Use short (8.3) file names which are always ASCII
                const { execSync } = require('child_process');
                
                console.log('📝 Converting to short file names for WinRAR...');
                const shortPaths = filePaths.map((filePath, index) => {
                    try {
                        // Use full path to CMD - system variables may be broken
                        const cmd = \`"C:\\\\Windows\\\\System32\\\\cmd.exe" /c for %I in ("\${filePath}") do @echo %~sI\`;
                        const result = execSync(cmd, {
                            encoding: 'utf8',
                            timeout: 5000
                        }).trim();
                        
                        if (result && result.length > 0) {
                            console.log(\`  ✅ \${index + 1}. \${result}\`);
                            return result;
                        }
                        throw new Error('No short path');
                    } catch (error) {
                        console.log(\`  ⚠️ \${index + 1}. Using original: \${filePath}\`);
                        return filePath;
                    }
                });
                
                const listContent = shortPaths.join('\\r\\n');
                fs.writeFileSync(listFilePath, listContent, 'ascii');
            } else {
                // Default: UTF-8
                const listContent = filePaths.join('\\r\\n');
                fs.writeFileSync(listFilePath, listContent, 'utf8');
            }
        } catch (error) {
            reject(new Error(\`Failed to create list file: \${error.message}\`));
            return;
        }

        // Check if archive path contains non-ASCII`;

// Проверяем есть ли pattern
if (searchPattern.test(content)) {
    content = content.replace(searchPattern, replacementCode);
    console.log('✅ Блок создания файла списка обновлён\n');
} else {
    console.log('⚠️ Паттерн не найден, файл может быть повреждён\n');
    console.log('Создаём новый файл с нуля...\n');

    // Если файл слишком повреждён, восстанавливаем из шаблона
    // (здесь можно было бы создать полный файл, но проще попросить пользователя восстановить из git)
    console.log('❌ Файл сильно повреждён. Рекомендации:');
    console.log('   1. Восстановите из Git: git checkout archive-with-progress.js');
    console.log('   2. Или используйте только 7-Zip (форматы ZIP/7Z работают отлично)');
    process.exit(1);
}

// Сохраняем
fs.writeFileSync(targetFile, content);

console.log('✅ Файл восстановлен: archive-with-progress.js\n');
console.log('📝 Изменения:');
console.log('   - Для WinRAR: короткие имена файлов через CMD');
console.log('   - Полный путь к cmd.exe: C:\\Windows\\System32\\cmd.exe');
console.log('   - Для 7-Zip: UTF-8 кодировка (без изменений)\n');
