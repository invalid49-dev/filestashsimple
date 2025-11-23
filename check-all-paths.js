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

// Получаем общее количество записей
db.get(`SELECT COUNT(*) as count FROM files`, (err, row) => {
    if (!err) {
        console.log(`📊 Всего записей в базе: ${row.count}\n`);
    }
});

// Показываем примеры различных путей
db.all(`
    SELECT DISTINCT SUBSTR(full_path, 1, 20) as path_prefix, COUNT(*) as count
    FROM files 
    GROUP BY path_prefix
    ORDER BY count DESC
    LIMIT 20
`, (err, rows) => {
    if (err) {
        console.error('❌ Ошибка:', err.message);
    } else {
        console.log('📁 Префиксы путей в базе (топ 20):');
        rows.forEach(row => {
            console.log(`   ${row.path_prefix}... (${row.count} записей)`);
        });
    }
    
    // Показываем конкретные примеры
    db.all(`SELECT full_path FROM files LIMIT 10`, (err, rows) => {
        if (!err) {
            console.log('\n📄 Примеры полных путей:');
            rows.forEach(row => {
                console.log(`   ${row.full_path}`);
            });
        }
        db.close();
    });
});
