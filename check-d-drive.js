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

// Проверяем записи с D_Verified
db.get(`SELECT COUNT(*) as count FROM files WHERE full_path LIKE '%D_Verified%'`, (err, row) => {
    if (!err) {
        console.log(`📊 Записей с D_Verified: ${row.count}`);
    }
});

// Проверяем записи с D:
db.get(`SELECT COUNT(*) as count FROM files WHERE full_path LIKE 'D:%'`, (err, row) => {
    if (!err) {
        console.log(`📊 Записей с D:: ${row.count}`);
    }
});

// Проверяем записи с D\
db.get(`SELECT COUNT(*) as count FROM files WHERE full_path LIKE 'D\\%'`, (err, row) => {
    if (!err) {
        console.log(`📊 Записей с D\\: ${row.count}`);
    }
});

// Показываем примеры путей, начинающихся с D
db.all(`
    SELECT full_path, filename 
    FROM files 
    WHERE full_path LIKE 'D%'
    ORDER BY full_path
    LIMIT 20
`, (err, rows) => {
    if (err) {
        console.error('❌ Ошибка:', err.message);
    } else {
        console.log('\n📁 Примеры путей, начинающихся с D:');
        rows.forEach(row => {
            console.log(`   ${row.full_path}`);
        });
    }
    db.close();
});
