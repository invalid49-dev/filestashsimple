// test-archive.js
// Script to test createArchiveWithProgress with a Cyrillic‑named file.
// It creates a temporary folder/file, archives it with 7‑Zip (ZIP) and WinRAR (RAR) if WinRAR is present.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createArchiveWithProgress } = require('./archive-with-progress');

// Try to locate 7‑Zip executable in common locations
function find7z() {
    const candidates = [
        '7z',
        '7z.exe',
        'C:\\Program Files\\7-Zip\\7z.exe',
        'C:\\Program Files (x86)\\7-Zip\\7z.exe'
    ];
    for (const p of candidates) {
        try { if (fs.existsSync(p)) return p; } catch (_) { }
    }
    return null;
}

async function runTest() {
    // 1️⃣ Create temporary folder with Cyrillic name and a test file
    const tempRoot = os.tmpdir();
    const cyrillicFolder = path.join(tempRoot, `ТестоваяПапка_${Date.now()}`);
    fs.mkdirSync(cyrillicFolder, { recursive: true });
    const testFile = path.join(cyrillicFolder, 'пример.txt');
    fs.writeFileSync(testFile, 'Это тестовый файл с кириллическим именем.');
    console.log('✅ Created test folder and file:', testFile);

    const filePaths = [testFile];

    // 2️⃣ 7‑Zip (ZIP) – try to locate the executable
    const sevenZipPath = find7z();
    if (!sevenZipPath) {
        console.warn('⚠️ 7‑Zip executable not found – skipping 7‑Zip test');
    } else {
        const zipArchive = path.join(tempRoot, `archive_тест_${Date.now()}.zip`);
        try {
            const result7z = await createArchiveWithProgress({
                filePaths,
                archivePath: zipArchive,
                archiverPath: sevenZipPath,
                archiverType: '7zip',
                format: 'zip',
                onProgress: info => console.log('📊 7‑Zip progress:', info),
                onConsoleOutput: msg => console.log('🖥️', msg)
            });
            console.log('✅ 7‑Zip archive created:', result7z.archivePath);
        } catch (e) {
            console.error('❌ 7‑Zip failed:', e.message);
        }
    }

    // 3️⃣ WinRAR (RAR) – binary located in ./bin/winrar/rar.exe
    const winrarPath = "c:\\Filestash Copy\\bin\\winrar\\rar.exe";
    if (!fs.existsSync(winrarPath)) {
        // fallback to winrar without extension (some builds)
        winrarPath = path.join(__dirname, 'bin', 'winrar', 'winrar');
    }
    if (!fs.existsSync(winrarPath)) {
        console.warn('⚠️ WinRAR executable not found in ./bin/winrar – skipping WinRAR test');
    } else {
        const rarArchive = path.join(tempRoot, `archive_тест_${Date.now()}.rar`);
        try {
            const resultRar = await createArchiveWithProgress({
                filePaths,
                archivePath: rarArchive,
                archiverPath: winrarPath,
                archiverType: 'winrar',
                format: 'rar',
                onProgress: info => console.log('📊 WinRAR progress:', info),
                onConsoleOutput: msg => console.log('🖥️', msg)
            });
            console.log('✅ WinRAR archive created:', resultRar.archivePath);
        } catch (e) {
            console.error('❌ WinRAR failed:', e.message);
        }
    }
}

runTest();
