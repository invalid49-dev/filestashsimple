# Requirements Document

## Introduction

Система архивации FileStash не может корректно обрабатывать файлы и папки с кириллическими символами при использовании WinRAR 7.13. Несмотря на то, что WinRAR 7.13 поддерживает UTF-8, текущая реализация использует устаревший подход с короткими именами файлов (8.3 формат) и ASCII кодировкой, что приводит к ошибкам "Невозможно открыть" и "Синтаксическая ошибка в имени файла". Необходимо обновить модуль архивации для использования нативной UTF-8 поддержки WinRAR.

## Glossary

- **FileStash System**: Веб-приложение для управления файлами и создания архивов
- **WinRAR Archiver**: Внешний исполняемый файл WinRAR (rar.exe версии 7.13), используемый для создания RAR архивов
- **Archive Module**: Модуль archive-with-progress.js, отвечающий за создание архивов
- **File List**: Временный текстовый файл со списком путей к файлам для архивации
- **Short Name**: Короткое имя файла в формате 8.3 (например, PROGRA~1)
- **UTF-8**: Универсальная кодировка символов, поддерживающая кириллицу
- **CP866**: Устаревшая кодовая страница DOS для кириллицы
- **Cyrillic Characters**: Символы кириллического алфавита (русские буквы)

## Requirements

### Requirement 1

**User Story:** Как пользователь FileStash, я хочу архивировать файлы и папки с русскими названиями в RAR формат, чтобы сохранить их без потери данных

#### Acceptance Criteria

1. WHEN пользователь выбирает файлы с кириллическими символами в именах для архивации в RAR формат, THE Archive Module SHALL создать архив без ошибок кодировки
2. WHEN WinRAR Archiver обрабатывает File List, THE Archive Module SHALL передать пути к файлам в UTF-8 кодировке
3. WHEN WinRAR Archiver запускается, THE Archive Module SHALL использовать параметр -scul для указания UTF-8 кодировки списка файлов
4. THE Archive Module SHALL создать File List в UTF-8 кодировке без BOM (Byte Order Mark)
5. WHEN архивация завершается успешно, THE FileStash System SHALL отобразить сообщение об успешном создании архива

### Requirement 2

**User Story:** Как пользователь FileStash, я хочу видеть корректные имена файлов в логах архивации, чтобы понимать какие файлы обрабатываются

#### Acceptance Criteria

1. WHEN WinRAR Archiver выводит информацию в stdout, THE Archive Module SHALL декодировать вывод из кодировки OEM (CP866) в UTF-8
2. WHEN Archive Module отображает имена файлов в консоли, THE FileStash System SHALL показать кириллические символы без искажений
3. WHEN возникает ошибка архивации, THE Archive Module SHALL декодировать сообщение об ошибке из CP866 в UTF-8
4. THE Archive Module SHALL передать декодированный вывод через callback функцию onConsoleOutput

### Requirement 3

**User Story:** Как разработчик FileStash, я хочу удалить устаревший код конвертации в короткие имена, чтобы упростить поддержку и использовать современные возможности WinRAR

#### Acceptance Criteria

1. THE Archive Module SHALL удалить логику конвертации путей в Short Name формат для WinRAR
2. THE Archive Module SHALL удалить вызовы cmd.exe для получения коротких имен файлов
3. THE Archive Module SHALL удалить использование iconv-lite для декодирования CP866 при получении коротких имен
4. WHEN archiverType равен 'winrar', THE Archive Module SHALL использовать UTF-8 кодировку для File List вместо ASCII
5. THE Archive Module SHALL сохранить поддержку UTF-8 для 7-Zip без изменений

### Requirement 4

**User Story:** Как администратор системы, я хочу чтобы архивация работала с путями любой длины и сложности, чтобы не было ограничений на структуру файлов

#### Acceptance Criteria

1. THE Archive Module SHALL поддерживать пути к файлам длиной до 260 символов (ограничение Windows MAX_PATH)
2. THE Archive Module SHALL корректно обрабатывать пути с пробелами, специальными символами и кириллицей
3. WHEN путь к файлу содержит несколько вложенных папок с кириллическими именами, THE Archive Module SHALL создать архив без ошибок
4. THE Archive Module SHALL корректно обрабатывать имена файлов, содержащие одновременно латиницу и кириллицу
5. IF путь к файлу превышает 260 символов, THEN THE Archive Module SHALL вернуть понятное сообщение об ошибке

### Requirement 5

**User Story:** Как пользователь FileStash, я хочу чтобы система автоматически определяла правильную кодировку для разных архиваторов, чтобы не думать о технических деталях

#### Acceptance Criteria

1. WHEN archiverType равен 'winrar', THE Archive Module SHALL использовать UTF-8 для File List и параметр -scul
2. WHEN archiverType равен '7zip', THE Archive Module SHALL использовать UTF-8 для File List и параметр -scsUTF-8
3. THE Archive Module SHALL декодировать stdout WinRAR из CP866 (OEM кодировка)
4. THE Archive Module SHALL декодировать stdout 7-Zip из CP1251 (Windows кодировка)
5. THE Archive Module SHALL использовать одинаковую логику декодирования для stdout и stderr
