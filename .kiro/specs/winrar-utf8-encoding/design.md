# Design Document

## Overview

Данный дизайн описывает решение проблемы с кодировкой кириллических символов при архивации файлов с помощью WinRAR 7.13. Текущая реализация использует устаревший подход с конвертацией путей в короткие имена (8.3 формат) и ASCII кодировкой, что приводит к ошибкам. Решение заключается в использовании нативной UTF-8 поддержки WinRAR 7.13 через параметр `-scul` и правильной кодировке временного файла со списком путей.

### Key Changes

1. **Удаление логики коротких имен**: Полное удаление кода, который конвертирует пути в формат 8.3
2. **UTF-8 для списка файлов**: Использование UTF-8 кодировки вместо ASCII для WinRAR
3. **Параметр -scul**: Добавление параметра `-scul` для указания WinRAR использовать UTF-8 для чтения списка файлов
4. **Правильное декодирование вывода**: Использование CP866 (OEM) для декодирования stdout/stderr WinRAR

## Architecture

### Current Architecture Issues

```
User selects files with Cyrillic names
         ↓
Archive Module creates temp list file
         ↓
[PROBLEM] Converts paths to short names (8.3) using cmd.exe
         ↓
[PROBLEM] Writes list file in ASCII encoding
         ↓
[PROBLEM] WinRAR reads ASCII file without UTF-8 flag
         ↓
ERROR: Cannot open files (encoding mismatch)
```

### Proposed Architecture

```
User selects files with Cyrillic names
         ↓
Archive Module creates temp list file
         ↓
Writes list file in UTF-8 encoding (no BOM)
         ↓
Passes -scul parameter to WinRAR
         ↓
WinRAR reads UTF-8 list file correctly
         ↓
Archives files successfully
         ↓
Decodes WinRAR output from CP866 to UTF-8
         ↓
Displays correct file names in console
```

## Components and Interfaces

### 1. File List Creation (Modified)

**Location**: `archive-with-progress.js`, lines ~90-150

**Current Implementation**:
```javascript
if (archiverType === 'winrar') {
    // Converts to short names using cmd.exe
    const shortPaths = filePaths.map((filePath) => {
        const cmd = `"C:\\Windows\\System32\\cmd.exe" /c for %I in ("${filePath}") do @echo %~sI`;
        const buffer = execSync(cmd, { encoding: 'buffer' });
        const result = iconv.decode(buffer, 'cp866').trim();
        return result;
    });
    const listContent = shortPaths.join('\r\n');
    fs.writeFileSync(listFilePath, listContent, 'ascii');
}
```

**New Implementation**:
```javascript
if (archiverType === 'winrar') {
    // WinRAR 7.13+ supports UTF-8 with -scul parameter
    const listContent = filePaths.join('\r\n');
    fs.writeFileSync(listFilePath, listContent, 'utf8');
}
```

**Changes**:
- Remove entire short name conversion logic (lines ~100-140)
- Remove `execSync` calls to cmd.exe
- Remove `iconv.decode` for CP866 during path conversion
- Change encoding from 'ascii' to 'utf8'
- Remove debug console.log statements for short paths

### 2. WinRAR Command Arguments (Modified)

**Location**: `archive-with-progress.js`, lines ~220-250

**Current Implementation**:
```javascript
if (archiverType === 'winrar') {
    args = [
        'a',                    // Add to archive
        '-y',                   // Yes to all prompts
        '-ep1',                 // Exclude base folder
        '-ibck',                // Run in background
        '-ilog'                 // Log to stdout
    ];
    // ... rest of args
}
```

**New Implementation**:
```javascript
if (archiverType === 'winrar') {
    args = [
        'a',                    // Add to archive
        '-y',                   // Yes to all prompts
        '-ep1',                 // Exclude base folder
        '-ibck',                // Run in background
        '-ilog',                // Log to stdout
        '-scul'                 // Use UTF-8 for list file
    ];
    // ... rest of args
}
```

**Changes**:
- Add `-scul` parameter to args array
- Update comment to explain UTF-8 usage

### 3. Output Decoding (Modified)

**Location**: `archive-with-progress.js`, lines ~280-320

**Current Implementation**:
```javascript
archiveProcess.stdout.on('data', (data) => {
    const output = iconv.decode(data, 'cp1251'); // Wrong encoding for WinRAR
    // ... process output
});

archiveProcess.stderr.on('data', (data) => {
    const output = iconv.decode(data, 'cp1251'); // Wrong encoding for WinRAR
    // ... process output
});
```

**New Implementation**:
```javascript
archiveProcess.stdout.on('data', (data) => {
    // WinRAR uses OEM encoding (CP866) for console output on Windows
    const encoding = archiverType === 'winrar' ? 'cp866' : 'cp1251';
    const output = iconv.decode(data, encoding);
    // ... process output
});

archiveProcess.stderr.on('data', (data) => {
    // WinRAR uses OEM encoding (CP866) for console output on Windows
    const encoding = archiverType === 'winrar' ? 'cp866' : 'cp1251';
    const output = iconv.decode(data, encoding);
    // ... process output
});
```

**Changes**:
- Change encoding from 'cp1251' to 'cp866' for WinRAR
- Keep 'cp1251' for 7-Zip (Windows ANSI encoding)
- Add conditional encoding selection based on archiver type
- Apply same logic to both stdout and stderr

## Data Models

### File List Format

**Before** (ASCII with short names):
```
C:\PROGRA~1\SOMEFOLDER\FILE~1.TXT
D:\DOCUME~1\USER~1\FILE~2.DOC
```

**After** (UTF-8 with full paths):
```
C:\Program Files\Папка с файлами\Документ.txt
D:\Documents\Пользователь\Файл с данными.doc
```

### WinRAR Command Line

**Before**:
```
Rar.exe a -y -ep1 -ibck -ilog C:\Archives\output.rar @C:\Temp\list.txt
```

**After**:
```
Rar.exe a -y -ep1 -ibck -ilog -scul C:\Archives\output.rar @C:\Temp\list.txt
```

### Encoding Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    File Path Processing                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  JavaScript String (UTF-16)                                  │
│         ↓                                                     │
│  fs.writeFileSync(path, content, 'utf8')                    │
│         ↓                                                     │
│  Temp File (UTF-8, no BOM)                                   │
│         ↓                                                     │
│  WinRAR reads with -scul flag                                │
│         ↓                                                     │
│  WinRAR interprets as UTF-8                                  │
│         ↓                                                     │
│  Files archived correctly                                    │
│                                                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Console Output Processing                 │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  WinRAR stdout/stderr (CP866/OEM)                           │
│         ↓                                                     │
│  iconv.decode(buffer, 'cp866')                              │
│         ↓                                                     │
│  JavaScript String (UTF-16)                                  │
│         ↓                                                     │
│  onConsoleOutput callback                                    │
│         ↓                                                     │
│  Display in UI (correct Cyrillic)                           │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Error Handling

### 1. File List Creation Errors

**Scenario**: Cannot create temporary list file

**Handling**:
```javascript
try {
    const listContent = filePaths.join('\r\n');
    fs.writeFileSync(listFilePath, listContent, 'utf8');
} catch (error) {
    reject(new Error(`Failed to create list file: ${error.message}`));
    return;
}
```

**Error Message**: "Failed to create list file: [error details]"

### 2. Long Path Errors

**Scenario**: File path exceeds Windows MAX_PATH (260 characters)

**Current Handling**: No explicit check, relies on WinRAR error

**Improved Handling**:
```javascript
// Validate path lengths before creating archive
const tooLongPaths = filePaths.filter(p => p.length > 260);
if (tooLongPaths.length > 0) {
    const errorMsg = `The following paths exceed Windows MAX_PATH limit (260 characters):\n${
        tooLongPaths.map(p => `  - ${p} (${p.length} chars)`).join('\n')
    }`;
    reject(new Error(errorMsg));
    return;
}
```

**Error Message**: "The following paths exceed Windows MAX_PATH limit (260 characters): ..."

### 3. WinRAR Exit Codes

**Exit Code 0**: Success
- Action: Resolve promise with success result

**Exit Code 1**: Warning (non-fatal errors)
- Action: Log warning but treat as success
- Example: Some files were locked but archive was created

**Exit Code 2**: Fatal error
- Action: Reject promise with error
- Example: Cannot create archive file

**Exit Code 10**: No files to archive / Cannot open files
- Action: Reject promise with detailed error
- Example: Encoding issues, file not found

**Handling**:
```javascript
archiveProcess.on('close', (code) => {
    if (code === 0) {
        resolve({ success: true, ... });
    } else if (code === 1) {
        onConsoleOutput('⚠️  Archive created with warnings');
        resolve({ success: true, warnings: true, ... });
    } else {
        const errorMsg = `Archiver exited with code ${code}`;
        reject(new Error(errorMsg));
    }
});
```

### 4. Encoding Detection Errors

**Scenario**: Cannot decode WinRAR output

**Handling**:
```javascript
archiveProcess.stdout.on('data', (data) => {
    try {
        const encoding = archiverType === 'winrar' ? 'cp866' : 'cp1251';
        const output = iconv.decode(data, encoding);
        onConsoleOutput(output.trim());
    } catch (decodeError) {
        // Fallback to raw buffer display
        onConsoleOutput(`[Raw output]: ${data.toString('hex')}`);
        console.error('Failed to decode output:', decodeError);
    }
});
```

## Testing Strategy

### 1. Unit Tests

**Test File**: `test-winrar-utf8.js` (new file)

**Test Cases**:

1. **Test UTF-8 List File Creation**
   - Input: Array of paths with Cyrillic characters
   - Expected: Temp file created with UTF-8 encoding
   - Validation: Read file and verify encoding

2. **Test Command Arguments**
   - Input: WinRAR archiver type
   - Expected: Args array contains `-scul` parameter
   - Validation: Check args array content

3. **Test Output Decoding**
   - Input: Mock WinRAR output in CP866
   - Expected: Correctly decoded Cyrillic text
   - Validation: Compare decoded string with expected

4. **Test Long Path Validation**
   - Input: Path with 300 characters
   - Expected: Error thrown before WinRAR execution
   - Validation: Check error message

### 2. Integration Tests

**Test Scenarios**:

1. **Archive Single File with Cyrillic Name**
   - Create test file: `Тестовый файл.txt`
   - Archive with WinRAR
   - Verify: Archive created, no errors in console

2. **Archive Folder with Cyrillic Name**
   - Create test folder: `Папка с файлами`
   - Add files inside
   - Archive with WinRAR
   - Verify: All files archived correctly

3. **Archive Mixed Latin and Cyrillic**
   - Create files: `File1.txt`, `Файл2.txt`, `Test Тест.doc`
   - Archive with WinRAR
   - Verify: All files archived correctly

4. **Archive Nested Folders with Cyrillic**
   - Create structure: `Папка1/Папка2/Файл.txt`
   - Archive with WinRAR
   - Verify: Folder structure preserved

5. **Archive with Long Cyrillic Path**
   - Create path with 250+ characters including Cyrillic
   - Archive with WinRAR
   - Verify: Appropriate error or success

### 3. Manual Testing

**Test Environment**:
- Windows 10/11
- WinRAR 7.13 installed at `bin/winrar/Rar.exe`
- FileStash application running

**Test Steps**:

1. Start FileStash server
2. Navigate to folder with Cyrillic files
3. Select files: `Дин Кунц - Симфония тьмы (BIGBAG)` folder
4. Click "Create Archive" → Select RAR format
5. Observe console output
6. Verify:
   - No encoding errors in console
   - Cyrillic characters displayed correctly
   - Archive created successfully
   - Archive can be opened and files extracted

**Expected Console Output**:
```
🗜️ Начало создания архива...
📦 Начало архивации 2 файлов...
✅ Архивация запущена (ID: archive_xxx)
🔧 Архиватор: WinRAR
📋 Формат: RAR
🚀 Starting winrar archiver (RAR format)...
📦 Command: C:\...\Rar.exe a -y -ep1 -ibck -ilog -scul C:\...\Files.rar @C:\...\list.txt
RAR 7.13 x64    Авторские права (c) 1993-2025 Александр Рошал
Зарегистрировано: Alexander Roshal
Создание архива C:\...\Files.rar
Добавление    Дин Кунц - Симфония тьмы (BIGBAG)\00_Дин Кунц - Симфония тьмы.mp3    OK
✅ Archive created successfully!
📊 Archive size: X.XX MB
```

### 4. Regression Tests

**Verify No Breaking Changes**:

1. **7-Zip Still Works**
   - Archive files with 7-Zip (ZIP and 7Z formats)
   - Verify: No regression in 7-Zip functionality

2. **ASCII Paths Still Work**
   - Archive files with only ASCII characters
   - Verify: Works as before

3. **Password Protection**
   - Archive with password using WinRAR
   - Verify: Password protection works

4. **Multi-Volume Archives**
   - Create multi-volume RAR archive
   - Verify: Volumes created correctly

5. **Compression Levels**
   - Test different compression levels (0-5)
   - Verify: Compression works correctly

## Implementation Notes

### Code Removal Checklist

Lines to remove from `archive-with-progress.js`:

- [ ] Lines ~100-140: Short name conversion logic
- [ ] Import of `execSync` (if only used for short names)
- [ ] Debug console.log statements for short paths
- [ ] Comments mentioning "short names" or "8.3 format"

### Code Addition Checklist

Changes to make in `archive-with-progress.js`:

- [ ] Line ~120: Change `fs.writeFileSync(listFilePath, listContent, 'ascii')` to `'utf8'`
- [ ] Line ~230: Add `-scul` to WinRAR args array
- [ ] Line ~285: Change stdout decoding to use conditional encoding
- [ ] Line ~295: Change stderr decoding to use conditional encoding
- [ ] Add comment explaining `-scul` parameter
- [ ] Update comment about list file encoding

### Dependencies

**Required**:
- `iconv-lite`: Already installed, used for CP866/CP1251 decoding
- `fs`: Node.js built-in
- `path`: Node.js built-in

**Not Required** (can be removed if only used for short names):
- `child_process.execSync`: Remove if only used for short name conversion

### Backward Compatibility

**WinRAR Version Requirements**:
- Minimum: WinRAR 5.0 (first version with `-scul` support)
- Recommended: WinRAR 7.13 (current version)
- Fallback: If older WinRAR detected, show warning message

**Detection Logic**:
```javascript
// Optional: Detect WinRAR version
function getWinRARVersion(rarPath) {
    try {
        const output = execSync(`"${rarPath}" -?`, { encoding: 'buffer' });
        const text = iconv.decode(output, 'cp866');
        const match = text.match(/RAR\s+([\d.]+)/);
        return match ? match[1] : null;
    } catch (error) {
        return null;
    }
}

// Warn if version is too old
const version = getWinRARVersion(archiverPath);
if (version && parseFloat(version) < 5.0) {
    onConsoleOutput('⚠️  WinRAR version is old, UTF-8 support may be limited');
}
```

### Performance Considerations

**Before** (with short names):
- Time: ~50-100ms per file for short name conversion
- For 100 files: ~5-10 seconds overhead
- CPU: High (spawning cmd.exe for each file)

**After** (UTF-8 direct):
- Time: ~1ms for entire list file creation
- For 100 files: ~1ms overhead
- CPU: Minimal (single file write operation)

**Performance Improvement**: ~99% faster list file creation

### Security Considerations

1. **Path Injection**: List file prevents command injection
2. **Temp File Security**: Use `os.tmpdir()` with unique names
3. **File Cleanup**: Always delete temp list file in finally block
4. **Path Validation**: Validate paths before adding to list

## Migration Path

### Phase 1: Implementation (This Spec)
- Remove short name conversion code
- Add UTF-8 support for WinRAR
- Update output decoding
- Add unit tests

### Phase 2: Testing
- Run integration tests
- Perform manual testing
- Verify no regressions

### Phase 3: Deployment
- Deploy to production
- Monitor error logs
- Collect user feedback

### Phase 4: Cleanup (Optional)
- Remove unused dependencies
- Remove old backup files
- Update documentation

## References

### WinRAR Documentation

**Command Line Parameters**:
- `-scul`: Use UTF-8 for list files
- `-scuc`: Use UTF-8 for console output (not needed, we decode manually)
- `-sccUTF-8`: Use UTF-8 for console charset (alternative)

**Exit Codes**:
- 0: Successful operation
- 1: Warning (non-fatal error)
- 2: Fatal error
- 3: Invalid checksum (CRC error)
- 4: Attempt to modify locked archive
- 5: Write error
- 6: File open error
- 7: Wrong command line option
- 8: Not enough memory
- 9: File create error
- 10: No files matching specified mask
- 255: User stopped the process

### Windows Encoding

**CP866 (OEM Cyrillic)**:
- Used by: Console applications (cmd.exe, WinRAR console output)
- Character set: Cyrillic + box-drawing characters
- Also known as: DOS Cyrillic, OEM 866

**CP1251 (Windows Cyrillic)**:
- Used by: Windows GUI applications (7-Zip GUI output)
- Character set: Cyrillic + Windows-specific characters
- Also known as: Windows-1251, ANSI Cyrillic

**UTF-8**:
- Universal encoding
- Supported by: Modern applications (WinRAR 5.0+, 7-Zip 9.0+)
- Recommended for: File names, list files, modern APIs
