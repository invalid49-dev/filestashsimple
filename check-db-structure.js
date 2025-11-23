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

// Получаем структуру таблицы files
db.all(`PRAGMA table_info(files)`, (err, rows) => {
    if (err) {
        console.error('❌ Ошибка:', err.message);
        db.close();
        return;
    }

    console.log('📋 Структура таблицы files:');
    rows.forEach(row => {
        console.log(`   ${row.name} (${row.type})`);
    });

    // Показываем пример записи
    db.get(`SELECT * FROM files LIMIT 1`, (err, row) => {
        if (err) {
            console.error('❌ Ошибка:', err.message);
        } else if (row) {
            console.log('\n📄 Пример записи:');
            console.log(JSON.stringify(row, null, 2));
        }
        db.close();
    });
});
