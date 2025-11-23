# Последовательность запуска FileStash

## Обзор

FileStash теперь использует правильную последовательность инициализации, гарантируя что браузер откроется только после полной загрузки всех компонентов.

## Последовательность запуска

### 1. Загрузка конфигурации
```
📋 Configuration:
   Cache Strategy:   optimized
   Hot Cache Size:   10 000
   Query Cache Size: 100MB
   ...
```

### 2. Инициализация базы данных
```
🔧 Initializing database...
✅ Database tables initialized
🔧 Optimizing database indexes...
✅ Database indexes optimized
📊 Analyzing database...
✅ Database optimization complete
```

### 3. Загрузка кеша
```
🚀 Cache Strategy Selected: optimized
📥 Loading OptimizedDatabaseCache...
📥 Loading IndexCache...
📥 Loading SearchIndex...
✅ IndexCache loaded: 1452838 records in 36526ms (~111MB)
✅ SearchIndex loaded: 1452838 records in 41944ms (~83MB)
✅ Cache initialized successfully: optimized
```

### 4. Запуск сервера
```
🚀 All components initialized, starting server...
🚀 FileStash Simple server running on http://localhost:3000
```

### 5. Открытие браузера
```
🌐 Opening browser automatically...
✅ Browser opened successfully
```

### 6. Готов к работе
```
📋 Server Information:
   URL: http://localhost:3000
   Port: 3000
   Database: ./filestash.db
   Archives: ./archives/
   Backups: ./backups/

🎯 Ready to use! Press Ctrl+C to stop the server
📊 Cache statistics logging started (every 5 minutes)
```

## Технические детали

### Функция initializeAndStart()

Новая функция `initializeAndStart()` обеспечивает правильную последовательность:

```javascript
async function initializeAndStart() {
    return new Promise((resolve, reject) => {
        db.serialize(async () => {
            try {
                // 1. Initialize database
                // 2. Optimize indexes
                // 3. Load cache
                // 4. Start server
                // 5. Open browser
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    });
}
```

### Преимущества

1. **Надежность** - браузер открывается только когда сервер готов
2. **Предсказуемость** - четкая последовательность инициализации
3. **Отказоустойчивость** - ошибки обрабатываются на каждом этапе
4. **Информативность** - подробные логи каждого этапа

### Время запуска

Для базы с 1.4M записей:
- Инициализация БД: ~1-2 секунды
- Загрузка кеша: ~40-45 секунд
- Запуск сервера: ~1 секунда
- **Общее время: ~45-50 секунд**

## Обработка ошибок

Если инициализация не удалась, приложение завершится с ошибкой:

```
❌ All cache initialization attempts failed
⚠️  Cannot start server without cache
```

Это предотвращает запуск сервера в нерабочем состоянии.


## Подробности о Database Analysis

### Что такое ANALYZE?

`ANALYZE` - это команда SQLite, которая:

1. **Собирает статистику** о распределении данных в таблицах и индексах
2. **Обновляет таблицы статистики** (`sqlite_stat1`, `sqlite_stat3`, `sqlite_stat4`)
3. **Помогает оптимизатору запросов** выбирать оптимальные планы выполнения

### Зачем это нужно?

После создания индексов, SQLite нужно знать:
- Сколько уникальных значений в каждом столбце
- Как распределены данные
- Какие индексы наиболее эффективны для конкретных запросов

Эта информация помогает оптимизатору запросов принимать правильные решения.

### Почему может возникать SQLITE_BUSY?

База данных может быть заблокирована если:
- Предыдущие операции (создание индексов) еще не завершились
- WAL (Write-Ahead Logging) блокирует базу
- Другое соединение выполняет операцию записи

### Retry логика

Система автоматически повторяет попытку анализа:
```
⚠️  Database busy during analysis, retrying in 500ms (attempt 1/3)...
⚠️  Database busy during analysis, retrying in 500ms (attempt 2/3)...
```

Если все попытки неудачны:
```
⚠️  Database analysis skipped: SQLITE_BUSY: database is locked
   This is not critical - the database will still work correctly
```

### Это критично?

**Нет!** Пропуск анализа не критичен:
- База данных будет работать корректно
- SQLite использует эвристики для оптимизации запросов
- Анализ можно выполнить позже вручную: `PRAGMA optimize;`
- При следующем запуске анализ может пройти успешно

### Когда анализ важен?

Анализ особенно полезен для:
- Больших баз данных (>1M записей)
- Сложных запросов с JOIN
- Запросов с множественными условиями WHERE
- Оптимизации производительности поиска

В FileStash с оптимизированным кешем влияние минимально, так как большинство запросов идут через кеш.
