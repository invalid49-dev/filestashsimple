const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'filestash.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Ошибка подключения к базе данных:', err.message);
        process.exit(1);
    }
    console.log('✅ Подключено к базе данных');
});

// Функция для замены путей
function renamePaths() {
    console.log('\n🔄 Начинаем замену путей D_Verified на D...\n');

    // Сначала проверим, сколько записей будет затронуто
    db.get(`SELECT COUNT(*) as count FROM files WHERE full_path LIKE '%D_Verified%' OR directory LIKE '%D_Verified%'`, (err, row) => {
        if (err) {
            console.error('❌ Ошибка при подсчете записей:', err.message);
            db.close();
            return;
        }

        console.log(`📊 Найдено записей для обновления: ${row.count}`);

        if (row.count === 0) {
            console.log('ℹ️  Нет записей для обновления');
            db.close();
            return;
        }

        // Выполняем обновление для full_path
        db.run(`
            UPDATE files 
            SET full_path = REPLACE(full_path, 'D_Verified', 'D'),
                directory = REPLACE(directory, 'D_Verified', 'D')
            WHERE full_path LIKE '%D_Verified%' OR directory LIKE '%D_Verified%'
        `, function(err) {
            if (err) {
                console.error('❌ Ошибка при обновлении путей:', err.message);
                db.close();
                return;
            }

            console.log(`✅ Успешно обновлено записей: ${this.changes}`);

            // Показываем примеры обновленных путей
            db.all(`
                SELECT full_path, filename, size 
                FROM files 
                WHERE full_path LIKE 'D:%' OR full_path LIKE 'D\\%'
                LIMIT 10
            `, (err, rows) => {
                if (err) {
                    console.error('❌ Ошибка при получении примеров:', err.message);
                } else {
                    console.log('\n📁 Примеры обновленных путей:');
                    rows.forEach(row => {
                        console.log(`   ${row.full_path}`);
                    });
                }

                console.log('\n✨ Готово! Пути успешно обновлены.');
                db.close();
            });
        });
    });
}

// Запускаем замену
renamePaths();
