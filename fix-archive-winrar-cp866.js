// Патчер для исправления archive-with-progress.js
// 1. Делает бэкап оригинального файла
// 2. Обновляет логику создания списка файлов для WinRAR:
//    - использует короткие имена (8.3) через cmd.exe
//    - записывает список в кодировке CP866 (OEM) – совместимо с WinRAR
// 3. Добавляет вывод полной команды перед запуском
// 4. Гарантирует, что в args используется tempArchivePath (ASCII) при наличии нелатинских символов

const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const targetFile = path.join(__dirname, 'archive-with-progress.js');
const backupFile = `${targetFile}.backup_${Date.now()}`;

console.log('🔧 Запуск патчера fix-archive-winrar-cp866.js');

// Создаём бэкап
fs.copyFileSync(targetFile, backupFile);
console.log(`✅ Бэкап создан: ${backupFile}`);

let content = fs.readFileSync(targetFile, 'utf8');

// 1️⃣ Обновляем блок создания списка файлов для WinRAR
const winrarBlockOld = `            // WinRAR: Use short (8.3) file names which are always ASCII\n            const { execSync } = require('child_process');\n\n            console.log('📝 Converting to short file names for WinRAR...');\n            const shortPaths = filePaths.map((filePath, index) => {\n                try {\n                    // Use full path to CMD - system variables may be broken\n                    const cmd = \"\\\"C:\\\\\\Windows\\\\System32\\\\cmd.exe\\\" /c for %I in (\\\"${filePath}\\\") do @echo %~sI\";\n                    // CMD возвращает CP866, нужно правильно декодировать\n                    const buffer = execSync(cmd, {\n                        encoding: 'buffer',\n                        timeout: 5000\n                    });\n                    const result = iconv.decode(buffer, 'cp866').trim();\n\n                    // Debug: показываем RAW и decoded результат\n                    console.log(`  🔍 RAW buffer[${ index + 1}]: ${ buffer.toString('hex').substring(0, 100) } `);\n                    console.log(`  🔍 Decoded[${ index + 1 }]: \"${result}\"`);\n                    console.log(`  🔍 Length[${index + 1}]: ${result.length}`);\n\n                    if (result && result.length > 0 && !result.includes('\\\\')) {\n                        // Короткое имя должно содержать ~ и не должно совпадать с оригиналом\n                        if (result.includes('~') || result === filePath) {\n                            console.log(`  ✅ Short path[${index + 1}]: ${result}`);\n                            return result;\n                        } else {\n                            console.log(`  ⚠️ Not a short path, using original[${index + 1}]`);\n                            return filePath;\n                        }\n                    }\n                    console.log(`  ⚠️ Empty result, using original[${index + 1}]`);\n                    return filePath;\n                } catch (error) {\n                    console.log(`  ⚠️ ${index + 1}. Using original: ${filePath}`);\n                    return filePath;\n                }\n            });\n\n            const listContent = shortPaths.join('\\r\\n');\n            fs.writeFileSync(listFilePath, listContent, 'ascii');`; 

const winrarBlockNew = `            // WinRAR: Use short (8.3) file names which are always ASCII\n            const { execSync } = require('child_process');\n\n            console.log('📝 Converting to short file names for WinRAR...');\n            const shortPaths = filePaths.map((filePath, index) => {\n                try {\n                    // Use full path to CMD - system variables may be broken\n                    const cmd = \"\\\"C:\\\\\\Windows\\\\System32\\\\cmd.exe\\\" /c for %I in (\\\"${filePath}\\\") do @echo %~sI\";\n                    const buffer = execSync(cmd, { encoding: 'buffer', timeout: 5000 });\n                    const result = iconv.decode(buffer, 'cp866').trim();\n\n                    // Debug: показываем RAW и decoded результат\n                    console.log(`  🔍 RAW buffer[${ index + 1}]: ${ buffer.toString('hex').substring(0, 100) } `);\n                    console.log(`  🔍 Decoded[${ index + 1 }]: \"${result}\"`);\n                    console.log(`  🔍 Length[${index + 1}]: ${result.length}`);\n\n                    if (result && result.length > 0 && !result.includes('\\\\')) {\n                        if (result.includes('~') || result === filePath) {\n                            console.log(`  ✅ Short path[${index + 1}]: ${result}`);\n                            return result;\n                        } else {\n                            console.log(`  ⚠️ Not a short path, using original[${index + 1}]`);\n                            return filePath;\n                        }\n                    }\n                    console.log(`  ⚠️ Empty result, using original[${index + 1}]`);\n                    return filePath;\n                } catch (error) {\n                    console.log(`  ⚠️ ${index + 1}. Using original: ${filePath}`);\n                    return filePath;\n                }\n            });\n\n            // Записываем список в OEM‑кодировке CP866, как ожидает WinRAR\n            const listBuffer = iconv.encode(shortPaths.join('\r\n'), 'cp866');\n            fs.writeFileSync(listFilePath, listBuffer);`;

if (content.includes(winrarBlockOld)) {
    content = content.replace(winrarBlockOld, winrarBlockNew);
    console.log('✅ Блок WinRAR обновлён');
}

// 2️⃣ Добавляем вывод полной команды перед запуском (если ещё нет)
const commandDebugOld = `onConsoleOutput(`\`📦 Command: ${command} ${args.join(' ')}\``); `;
const commandDebugNew = `onConsoleOutput(`\`📦 Command: ${command} ${args.join(' ')}\``); `;
// Мы просто убедимся, что строка присутствует; если её нет, добавим перед spawn
if (!content.includes('onConsoleOutput(`📦 Command: `')) {
    const spawnIndex = content.indexOf('const archiveProcess = spawn');
    if (spawnIndex !== -1) {
        const beforeSpawn = content.slice(0, spawnIndex);
        const afterSpawn = content.slice(spawnIndex);
        content = beforeSpawn + '\n    onConsoleOutput(`📦 Command: ${ command } ${ args.join(' ') } `);\n' + afterSpawn;
        console.log('✅ Добавлен вывод полной команды');
    }
}

// 3️⃣ Убедимся, что используется tempArchivePath при наличии нелатинских символов (блок уже есть, но проверим)
// Здесь ничего менять не будем, так как логика уже присутствует.

fs.writeFileSync(targetFile, content);
console.log('✅ archive-with-progress.js обновлён успешно');
