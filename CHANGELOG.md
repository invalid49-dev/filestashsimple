# Changelog

## [v2.0.1] - 2025-11-23

### 🐛 Critical Bug Fixes

#### CRC32 Calculation Consistency (FIXED)
- **Fixed CRC32 mismatch for all files**: Corrected deterministic position calculation in partial hashing
- **Consistent results**: Same file now ALWAYS produces the same CRC32 value across scans and integrity checks
- **Affected files**: All files, especially video files and large files (>10MB)

**Root Cause:**
- Integrity check used old `calculateCRC32()` function with inconsistent position formulas
- Scanning used new `calculateCRC32Optimized()` with different calculations
- Result: False positive CRC32 mismatches even when files hadn't changed

**Technical Fix:**
- Updated middle position: `Math.floor((fileSize - chunkSize) / 2)` (was: `Math.floor(fileSize / 2) - Math.floor(chunkSize / 2)`)
- Updated end position: `fileSize - chunkSize` (was: `Math.max(0, fileSize - chunkSize)`)
- Unified integrity check to use `calculateCRC32Optimized()` instead of old function
- Applied fix to both `server.js` and `server/file-operations.js`

**Testing:**
- ✅ Tested on 16MB files: Consistent hash across 5 iterations
- ✅ Tested on 67MB files: Consistent hash across 5 iterations  
- ✅ Tested on 1067MB files: Consistent hash across 5 iterations
- ✅ Updated 26 files in test database with correct CRC32 values

#### WinRAR Removal
- **Removed WinRAR support**: Complete removal of WinRAR integration
- **7-Zip only**: Simplified to single archiver for better UTF-8 support
- **No encoding issues**: Full Unicode support for all filenames (Cyrillic, Chinese, etc.)

### 🛠️ Tools & Scripts

#### New Testing Tools
- `test-crc32-consistency.js` - Verify CRC32 calculation consistency for any file
- `fix-crc32-mismatches.js` - Recalculate and update CRC32 for all files in database
- `verify-fix.bat` - Quick verification script for testing fixes

#### Documentation
- `CRC32-FIX-DOCUMENTATION.md` - Complete technical documentation of the fix
- `QUICK-FIX-GUIDE.md` - Quick start guide for users

### 📝 Migration Notes

**For Existing Databases:**
1. Option A (Recommended): Delete database and rescan directories
2. Option B: Run `node fix-crc32-mismatches.js` to update existing CRC32 values

**For New Installations:**
- No migration needed - works correctly out of the box

### ⚠️ Known Issues
- UI needs improvements (noted in release tag)
- Some UI elements may need refinement

### 🔧 Files Modified
- `server.js` - Fixed `calculateCRC32Optimized()` and integrity check code
- `server/file-operations.js` - Fixed `calculateCRC32()` function
- `archive-with-progress.js` - Removed WinRAR code
- `archiver-manager.js` - Simplified to 7-Zip only

---

## [v2.0.0] - 2025-11-10

### 🚀 Major Features

#### Database Caching System
- **In-Memory Database Cache**: Вся база данных загружается в память при старте сервера
- **Instant Tree Loading**: Вкладка "База данных" открывается мгновенно (100-500ms вместо 15-30 секунд)
- **Automatic Cache Invalidation**: Кэш автоматически обновляется при любых изменениях
- **Performance**: 10-100x быстрее для больших баз данных (100k+ записей)

#### Lazy Tree Loading
- **On-Demand Loading**: Дерево файлов загружается по уровням (только при раскрытии папок)
- **No More Freezing**: Браузер не зависает даже с миллионами файлов
- **Memory Efficient**: Использует в 4-10 раз меньше памяти
- **Expandable Folders**: Папки раскрываются с индикатором загрузки

#### Smart Search
- **Intelligent Ranking**: Результаты поиска ранжируются по релевантности
- **Multi-Word Search**: Поиск по нескольким словам (все слова должны присутствовать)
- **Top-Level Results**: Показываются самые верхние совпадающие папки
- **Expandable Results**: Результаты поиска можно раскрывать как обычное дерево
- **Limited Results**: Максимум 1000 результатов для производительности

#### Selection & Operations
- **Select All in Tree**: Работает "Выбрать все" в дереве файлов
- **Unified Selection**: Операции работают с файлами из таблицы и дерева
- **Context Menu**: Все операции доступны для выбранных файлов
- **Batch Operations**: Копирование, перемещение, архивирование, удаление

### 🔧 Technical Improvements

#### Server-Side
- `DatabaseCache` class для управления кэшем в памяти
- Индексы по пути и директории для O(1) доступа
- Автоматическая инвалидация кэша при изменениях
- Нормализация путей (исправлены двойные слэши)
- Улучшенная логика определения корневых элементов

#### Client-Side
- `renderLazyFileTree()` для ленивого рендеринга
- `toggleLazyTreeNode()` для раскрытия с загрузкой
- `getAllSelectedFiles()` для объединения выборок
- `hasSelectedFiles()` для проверки наличия выбранных
- Улучшенная функция `toggleSelectAll()`

### 📊 Performance Metrics

**Database Loading:**
- 10k записей: ~50ms (было ~5 секунд)
- 20k записей: ~100ms (было ~15 секунд)
- 100k записей: ~500ms (было ~2 минуты)
- 392k записей: ~5 секунд (было бы ~10+ минут)

**Tree Loading:**
- Первая загрузка: 100-500ms (только корень)
- Раскрытие папки: 50-200ms
- Память: ~20-50MB (было ~200MB)

**Search:**
- Поиск "art modeling": 1 релевантный результат (было 1000+ нерелевантных)
- Время поиска: <100ms
- Результаты можно раскрывать

### 🐛 Bug Fixes
- Исправлена ошибка `formatFileSize is not defined`
- Исправлена работа "Выбрать все" в дереве
- Исправлена работа контекстного меню с выбранными файлами
- Исправлена навигация по вложенным папкам
- Исправлены двойные слэши в путях Windows

### 📚 Documentation
- `DATABASE-CACHE-OPTIMIZATION.md` - техническая документация кэша
- `CACHE-QUICK-START.md` - быстрый старт по кэшированию
- `LAZY-TREE-LOADING.md` - документация ленивой загрузки
- `LAZY-LOADING-QUICK-START.md` - быстрый старт
- Тесты: `test-cache-performance.js`, `test-lazy-tree.js`, `test-search.js`, `test-rescan.js`

### ⚠️ Breaking Changes
- Изменен формат ответа `/api/files/tree` (теперь возвращает `{nodes, parent}`)
- Параметр `parent` обязателен для загрузки детей
- `selectedTreeFiles` теперь хранит объекты вместо ID

### 🔄 Migration Guide
Для обновления с v1.x:
1. Перезапустите сервер - кэш загрузится автоматически
2. Очистите кэш браузера (Ctrl+F5)
3. База данных совместима, изменений не требуется

### 🎯 Next Steps
- Виртуализация списка для папок с тысячами файлов
- Предзагрузка при наведении на папку
- Пагинация для очень больших папок
- Индикаторы количества файлов в папках

---

## [v1.x] - Previous Versions
См. предыдущие релизы для истории изменений.
