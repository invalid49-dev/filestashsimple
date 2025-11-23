const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./filestash.db');

console.log('Проверка путей в базе данных...\n');

db.all(`SELECT full_path, filename, crc32 FROM files WHERE full_path LIKE 'K:\\Аудиокниги\\Дин Кунц%' LIMIT 5`, [], (err, rows) => {
    if (err) {
        console.error('Ошибка:', err);
        db.close();
        return;
    }
    
    console.log(`Найдено ${rows.length} записей:\n`);
    
    rows.forEach((row, index) => {
        console.log(`${index + 1}. Путь: ${row.full_path}`);
        console.log(`   Имя: ${row.filename}`);
        console.log(`   CRC32: ${row.crc32}`);
        console.log(`   Длина пути: ${row.full_path.length}`);
        console.log(`   Байты пути: ${Buffer.from(row.full_path).toString('hex').substring(0, 100)}`);
        console.log('');
    });
    
    db.close();
});
