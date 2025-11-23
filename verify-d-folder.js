const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'filestash.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Ошибка подключения к базе данных:', err.message);
        process.exit(1);
    }
    console.log('✅ Подключено к базе данных\n');
});

// Проверяем записи с P:\Photo\D
db.get(`SELECT COUNT(*) as count FROM files WHERE full_path LIKE 'P:\\Photo\\D\\%' OR full_path = 'P:\\Photo\\D'`, (err, row) => {
    if (!err) {
        console.log(`📊 Записей в P:\\Photo\\D: ${row.count}`);
    }
});

// Проверяем, остались ли записи с D_Verified
db.get(`SELECT COUNT(*) as count FROM files WHERE full_path LIKE '%D_Verified%'`, (err, row) => {
    if (!err) {
        console.log(`📊 Записей с D_Verified (должно быть 0): ${row.count}`);
    }
});

// Показываем подпапки в P:\Photo\D
db.all(`
    SELECT full_path, filename, is_directory
    FROM files 
    WHERE directory = 'P:\\Photo\\D' AND is_directory = 1
    ORDER BY filename
    LIMIT 20
`, (err, rows) => {
    if (err) {
        console.error('❌ Ошибка:', err.message);
    } else {
        console.log('\n📁 Подпапки в P:\\Photo\\D:');
        rows.forEach(row => {
            console.log(`   📂 ${row.filename}`);
        });
    }
    
    // Показываем статистику по подпапкам
    db.all(`
        SELECT SUBSTR(full_path, LENGTH('P:\\Photo\\D\\') + 1, 
               CASE 
                   WHEN INSTR(SUBSTR(full_path, LENGTH('P:\\Photo\\D\\') + 1), '\\') > 0 
                   THEN INSTR(SUBSTR(full_path, LENGTH('P:\\Photo\\D\\') + 1), '\\') - 1
                   ELSE LENGTH(SUBSTR(full_path, LENGTH('P:\\Photo\\D\\') + 1))
               END) as subfolder,
               COUNT(*) as count
        FROM files 
        WHERE full_path LIKE 'P:\\Photo\\D\\%'
        GROUP BY subfolder
        ORDER BY count DESC
        LIMIT 10
    `, (err, rows) => {
        if (!err) {
            console.log('\n📊 Статистика по подпапкам (топ 10):');
            rows.forEach(row => {
                console.log(`   ${row.subfolder}: ${row.count} файлов`);
            });
        }
        db.close();
    });
});
