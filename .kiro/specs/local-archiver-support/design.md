# Design Document

## Overview

This design document describes the implementation of local archiver support for the FileStash application. The solution will enable the application to use portable versions of 7-Zip and WinRAR from the `bin` directory, provide format selection (ZIP, RAR, 7Z), and maintain backward compatibility with system-installed archivers.

The design follows a modular approach with clear separation of concerns:
- Archiver detection and path resolution
- Format-to-archiver mapping
- Archive creation with format-specific parameters
- API enhancements for format selection

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Client (Browser)                         │
│  - Archive format selection UI                               │
│  - Available formats display                                 │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP/REST
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                   Server (Express.js)                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Archive API Endpoints                                │   │
│  │  - POST /api/files/archive (enhanced)                 │   │
│  │  - GET /api/archivers (enhanced)                      │   │
│  └────────────┬─────────────────────────────────────────┘   │
│               │                                               │
│  ┌────────────▼─────────────────────────────────────────┐   │
│  │  Archiver Manager (NEW)                              │   │
│  │  - detectArchivers()                                  │   │
│  │  - getArchiverForFormat()                             │   │
│  │  - getSupportedFormats()                              │   │
│  └────────────┬─────────────────────────────────────────┘   │
│               │                                               │
│  ┌────────────▼─────────────────────────────────────────┐   │
│  │  Archive Creation Module                             │   │
│  │  - createArchiveWithProgress() (enhanced)            │   │
│  │  - Format-specific command builders                  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Local Archivers (bin directory)                 │
│  - bin/7zip/7z.exe                                           │
│  - bin/winrar/Rar.exe                                        │
└─────────────────────────────────────────────────────────────┘
```

### Component Interaction Flow

1. **Startup**: Application detects available archivers (local first, then system)
2. **Client Request**: User selects files and archive format
3. **Format Validation**: Server validates format and checks archiver availability
4. **Archive Creation**: Appropriate archiver is invoked with format-specific parameters
5. **Progress Tracking**: Real-time progress updates via SSE

## Components and Interfaces

### 1. Archiver Manager Module (NEW)

**File**: `archiver-manager.js`

**Purpose**: Centralized archiver detection, path resolution, and format mapping

**Interface**:

```javascript
class ArchiverManager {
    constructor(options = {})
    
    // Detect and cache available archivers
    detectArchivers(): Promise<ArchiverInfo>
    
    // Get archiver path for specific format
    getArchiverForFormat(format: string): ArchiverPath | null
    
    // Get all supported formats
    getSupportedFormats(): string[]
    
    // Get detailed archiver information
    getArchiverInfo(): ArchiverInfo
    
    // Refresh archiver detection
    refresh(): Promise<void>
}

// Type definitions
interface ArchiverInfo {
    archivers: {
        '7zip'?: {
            path: string,
            type: 'local' | 'system',
            formats: string[]
        },
        'winrar'?: {
            path: string,
            type: 'local' | 'system',
            formats: string[]
        }
    },
    formats: {
        'zip': string,    // archiver name
        'rar': string,
        '7z': string
    }
}

interface ArchiverPath {
    path: string,
    type: 'local' | 'system',
    archiver: '7zip' | 'winrar'
}
```

**Detection Priority**:
1. Local archiver in `bin/7zip/7z.exe`
2. Local archiver in `bin/winrar/Rar.exe`
3. System 7-Zip in PATH or `C:\Program Files\7-Zip\7z.exe`
4. System WinRAR in PATH or `C:\Program Files\WinRAR\Rar.exe`

### 2. Enhanced Archive Creation Module

**File**: `archive-with-progress.js` (modified)

**Changes**:
- Add `format` parameter to `createArchiveWithProgress()`
- Implement format-specific command builders
- Support ZIP format creation with 7-Zip

**New Interface**:

```javascript
async function createArchiveWithProgress(options) {
    // Existing parameters
    filePaths: string[],
    archivePath: string,
    archiverPath: string,
    archiverType: '7zip' | 'winrar',
    
    // NEW parameter
    format: 'zip' | 'rar' | '7z',
    
    // Callbacks
    onProgress: Function,
    onConsoleOutput: Function
}
```

**Format-Specific Commands**:

```javascript
// 7-Zip for ZIP format
7z.exe a -tzip -y -bsp1 -bso1 -bse1 archive.zip file1 file2 ...

// 7-Zip for 7Z format (existing)
7z.exe a -y -bsp1 -bso1 -bse1 archive.7z file1 file2 ...

// WinRAR for RAR format (existing)
Rar.exe a -y -ep1 -ibck -ilog archive.rar file1 file2 ...
```

### 3. Enhanced API Endpoints

#### GET `/api/archivers`

**Response**:
```json
{
    "archivers": {
        "7zip": {
            "available": true,
            "path": "C:\\filestash-simple\\bin\\7zip\\7z.exe",
            "type": "local",
            "formats": ["zip", "7z"]
        },
        "winrar": {
            "available": true,
            "path": "C:\\filestash-simple\\bin\\winrar\\Rar.exe",
            "type": "local",
            "formats": ["rar"]
        }
    },
    "formats": {
        "zip": "7zip",
        "rar": "winrar",
        "7z": "7zip"
    },
    "supportedFormats": ["zip", "rar", "7z"]
}
```

#### POST `/api/files/archive`

**Request**:
```json
{
    "fileIds": [1, 2, 3],
    "archiveName": "my-archive",
    "format": "zip",
    "destinationPath": "./archives"
}
```

**Response**:
```json
{
    "archiveId": "archive_1234567890_abc123",
    "message": "Archive creation started",
    "format": "zip",
    "archiver": "7zip"
}
```

### 4. Client-Side Enhancements

**File**: `public/app.js` (modified)

**Changes**:
- Add format selection dropdown in archive dialog
- Fetch and display available formats on dialog open
- Disable unavailable format options
- Update archive filename extension based on selected format

**UI Components**:
```html
<select id="archive-format">
    <option value="7z">7Z (7-Zip)</option>
    <option value="zip">ZIP (7-Zip)</option>
    <option value="rar">RAR (WinRAR)</option>
</select>
```

## Data Models

### Archiver Configuration

```javascript
const ARCHIVER_CONFIG = {
    '7zip': {
        localPath: path.join(__dirname, 'bin', '7zip', '7z.exe'),
        systemPaths: [
            '7z',
            'C:\\Program Files\\7-Zip\\7z.exe',
            'C:\\Program Files (x86)\\7-Zip\\7z.exe'
        ],
        formats: ['zip', '7z'],
        commands: {
            'zip': (archivePath, filePaths) => [
                'a', '-tzip', '-y', '-bsp1', '-bso1', '-bse1',
                archivePath, ...filePaths
            ],
            '7z': (archivePath, filePaths) => [
                'a', '-y', '-bsp1', '-bso1', '-bse1',
                archivePath, ...filePaths
            ]
        }
    },
    'winrar': {
        localPath: path.join(__dirname, 'bin', 'winrar', 'Rar.exe'),
        systemPaths: [
            'rar',
            'C:\\Program Files\\WinRAR\\Rar.exe',
            'C:\\Program Files (x86)\\WinRAR\\Rar.exe'
        ],
        formats: ['rar'],
        commands: {
            'rar': (archivePath, filePaths) => [
                'a', '-y', '-ep1', '-ibck', '-ilog',
                archivePath, ...filePaths
            ]
        }
    }
};
```

### Format-to-Extension Mapping

```javascript
const FORMAT_EXTENSIONS = {
    'zip': '.zip',
    'rar': '.rar',
    '7z': '.7z'
};
```

## Error Handling

### Error Scenarios and Responses

1. **No Archivers Available**
   - Error: "No archivers found. Please ensure 7-Zip or WinRAR is available in bin directory."
   - HTTP Status: 400
   - Action: Display installation instructions

2. **Format Not Supported**
   - Error: "Format 'rar' requires WinRAR which is not available."
   - HTTP Status: 400
   - Action: Show available formats

3. **Archiver Execution Failed**
   - Error: "Archive creation failed: [archiver error message]"
   - HTTP Status: 500
   - Action: Display error in progress console

4. **Invalid Format Parameter**
   - Error: "Invalid format 'xyz'. Supported formats: zip, rar, 7z"
   - HTTP Status: 400
   - Action: Validate on client-side

### Error Logging

```javascript
// Startup logging
console.log('📦 Archiver Detection:');
console.log('   7-Zip: ✅ Local (bin/7zip/7z.exe)');
console.log('   WinRAR: ✅ Local (bin/winrar/Rar.exe)');
console.log('   Supported formats: zip, rar, 7z');

// Runtime error logging
console.error('❌ Archive creation failed:');
console.error('   Format: zip');
console.error('   Archiver: 7zip');
console.error('   Error: [error message]');
```

## Testing Strategy

### Unit Tests

1. **Archiver Detection Tests**
   - Test local archiver detection
   - Test system archiver fallback
   - Test missing archiver handling
   - Test path resolution priority

2. **Format Mapping Tests**
   - Test format-to-archiver mapping
   - Test unsupported format handling
   - Test format validation

3. **Command Builder Tests**
   - Test ZIP command generation
   - Test RAR command generation
   - Test 7Z command generation

### Integration Tests

1. **Archive Creation Tests**
   - Create ZIP archive with 7-Zip
   - Create RAR archive with WinRAR
   - Create 7Z archive with 7-Zip
   - Verify archive integrity

2. **API Endpoint Tests**
   - Test `/api/archivers` response
   - Test `/api/files/archive` with different formats
   - Test error responses

3. **Progress Tracking Tests**
   - Verify progress updates for each format
   - Test console output streaming
   - Test completion status

### Manual Testing Checklist

- [ ] Verify local archivers are detected on startup
- [ ] Test archive creation with ZIP format
- [ ] Test archive creation with RAR format
- [ ] Test archive creation with 7Z format
- [ ] Verify correct file extensions
- [ ] Test with missing local archivers (fallback to system)
- [ ] Test with no archivers available (error handling)
- [ ] Verify UI shows available formats
- [ ] Test format selection in UI
- [ ] Verify progress tracking works for all formats

## Performance Considerations

1. **Archiver Detection Caching**
   - Detect archivers once at startup
   - Cache results in memory
   - Refresh only on explicit request

2. **Path Resolution**
   - Use synchronous file existence checks (fast for local paths)
   - Avoid repeated PATH searches

3. **Archive Creation**
   - No performance impact (same as current implementation)
   - Format parameter adds minimal overhead

## Security Considerations

1. **Path Validation**
   - Validate archiver paths to prevent command injection
   - Use absolute paths for local archivers
   - Sanitize user-provided archive names

2. **Format Validation**
   - Whitelist allowed formats: 'zip', 'rar', '7z'
   - Reject invalid format values

3. **File Path Sanitization**
   - Existing file path validation remains in place
   - No additional security concerns

## Migration Strategy

### Backward Compatibility

- Existing archive creation without format parameter defaults to '7z'
- System-installed archivers continue to work as fallback
- No breaking changes to existing API

### Deployment Steps

1. Add `archiver-manager.js` module
2. Update `archive-with-progress.js` with format support
3. Update `server.js` endpoints
4. Update client-side UI
5. Test with local archivers
6. Deploy to production

### Rollback Plan

- If issues occur, format parameter can be ignored
- Application falls back to current behavior (7z format only)
- No database changes required
