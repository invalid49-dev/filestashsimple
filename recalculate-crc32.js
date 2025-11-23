const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const crypto = require('crypto');
const db = new sqlite3.Database('./filestash.db');

// Copy of calculateCRC32 from server/file-operations.js
function calculateCRC32(filePath) {
    try {
        const stats = fs.statSync(filePath);
        const fileSize = stats.size;
        
        // For small files (< 10MB), read entire file
        if (fileSize < 10 * 1024 * 1024) {
            const data = fs.readFileSync(filePath);
            return crypto.createHash('md5').update(data).digest('hex').substring(0, 8);
        }
        
        // For large files (10MB+), use partial hashing
        const chunkSize = 1 * 1024 * 1024; // 1MB
        const hash = crypto.createHash('md5');
        
        hash.update(Buffer.from(fileSize.toString()));
        
        const fd = fs.openSync(filePath, 'r');
        
        try {
            // Read first 1MB
            const startBuffer = Buffer.alloc(Math.min(chunkSize, fileSize));
            fs.readSync(fd, startBuffer, 0, startBuffer.length, 0);
            hash.update(startBuffer);
            
            // Read middle 1MB
            if (fileSize > chunkSize * 2) {
                const middlePos = Math.floor(fileSize / 2) - Math.floor(chunkSize / 2);
                const middleBuffer = Buffer.alloc(chunkSize);
                fs.readSync(fd, middleBuffer, 0, middleBuffer.length, middlePos);
                hash.update(middleBuffer);
            }
            
            // Read last 1MB
            if (fileSize > chunkSize) {
                const endPos = Math.max(0, fileSize - chunkSize);
                const endBuffer = Buffer.alloc(Math.min(chunkSize, fileSize));
                fs.readSync(fd, endBuffer, 0, endBuffer.length, endPos);
                hash.update(endBuffer);
            }
            
            return hash.digest('hex').substring(0, 8);
        } finally {
            fs.closeSync(fd);
        }
    } catch (error) {
        console.error(`Error calculating CRC32 for ${filePath}:`, error.message);
        return null;
    }
}

const folderPath = 'K:\\Аудиокниги\\Дин Кунц - Симфония тьмы (BIGBAG)';

console.log(`🔄 Пересчет CRC32 для папки: ${folderPath}\n`);

db.all(`SELECT id, full_path, filename, crc32, is_directory FROM files WHERE full_path LIKE ? AND is_directory = 0`, 
    [`${folderPath}%`], 
    async (err, rows) => {
        if (err) {
            console.error('Ошибка:', err);
            db.close();
            return;
        }
        
        console.log(`Найдено ${rows.length} файлов\n`);
        
        let updated = 0;
        let errors = 0;
        let unchanged = 0;
        
        for (const row of rows) {
            try {
                if (!fs.existsSync(row.full_path)) {
                    console.log(`⚠️  Файл не существует: ${row.filename}`);
                    errors++;
                    continue;
                }
                
                const newCRC32 = calculateCRC32(row.full_path);
                
                if (!newCRC32) {
                    console.log(`❌ Не удалось вычислить CRC32: ${row.filename}`);
                    errors++;
                    continue;
                }
                
                if (newCRC32 !== row.crc32) {
                    console.log(`🔄 Обновление: ${row.filename}`);
                    console.log(`   Старый CRC32: ${row.crc32}`);
                    console.log(`   Новый CRC32:  ${newCRC32}`);
                    
                    await new Promise((resolve, reject) => {
                        db.run(`UPDATE files SET crc32 = ? WHERE id = ?`, [newCRC32, row.id], (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                    
                    updated++;
                } else {
                    unchanged++;
                }
            } catch (error) {
                console.error(`❌ Ошибка обработки ${row.filename}:`, error.message);
                errors++;
            }
        }
        
        console.log(`\n✅ Готово!`);
        console.log(`   Обновлено: ${updated}`);
        console.log(`   Без изменений: ${unchanged}`);
        console.log(`   Ошибок: ${errors}`);
        
        db.close();
    }
);
