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

function renamePaths() {
    console.log('\n🔄 Начинаем безопасную замену путей D_Verified на D...\n');

    // Проверяем, сколько записей будет затронуто
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

        // Начинаем транзакцию
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            // Удаляем возможные конфликтующие записи (если они есть)
            // Это записи, которые уже существуют с путем D:
            db.run(`
                DELETE FROM files 
                WHERE full_path IN (
                    SELECT REPLACE(full_path, 'D_Verified', 'D')
                    FROM files 
                    WHERE full_path LIKE '%D_Verified%'
                )
                AND full_path NOT LIKE '%D_Verified%'
            `, function(err) {
                if (err) {
                    console.error('❌ Ошибка при удалении конфликтующих записей:', err.message);
                    db.run('ROLLBACK');
                    db.close();
                    return;
                }

                if (this.changes > 0) {
                    console.log(`⚠️  Удалено конфликтующих записей: ${this.changes}`);
                }

                // Теперь обновляем пути
                db.run(`
                    UPDATE files 
                    SET full_path = REPLACE(full_path, 'D_Verified', 'D'),
                        directory = REPLACE(directory, 'D_Verified', 'D')
                    WHERE full_path LIKE '%D_Verified%' OR directory LIKE '%D_Verified%'
                `, function(err) {
                    if (err) {
                        console.error('❌ Ошибка при обновлении путей:', err.message);
                        db.run('ROLLBACK');
                        db.close();
                        return;
                    }

                    console.log(`✅ Успешно обновлено записей: ${this.changes}`);

                    // Фиксируем транзакцию
                    db.run('COMMIT', (err) => {
                        if (err) {
                            console.error('❌ Ошибка при фиксации транзакции:', err.message);
                            db.close();
                            return;
                        }

                        // Показываем примеры обновленных путей
                        db.all(`
                            SELECT full_path, filename, size 
                            FROM files 
                            WHERE full_path LIKE 'D:%' OR full_path LIKE 'D\\%'
                            ORDER BY full_path
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

                            // Показываем статистику
                            db.get(`SELECT COUNT(*) as count FROM files WHERE full_path LIKE 'D:%' OR full_path LIKE 'D\\%'`, (err, row) => {
                                if (!err && row) {
                                    console.log(`\n📊 Всего записей с диском D: ${row.count}`);
                                }

                                console.log('\n✨ Готово! Пути успешно обновлены.');
                                db.close();
                            });
                        });
                    });
                });
            });
        });
    });
}

// Запускаем замену
renamePaths();
