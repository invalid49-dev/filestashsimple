# Design Document

## Overview

This design document outlines the technical approach for implementing three key enhancements to the FileStash Simple file manager:

1. **Visual Database Indicators**: Add soft green background color to files and folders that exist in the SQLite database
2. **Interface Simplification**: Remove "Expand All" and "Collapse All" buttons from the directory browser
3. **Scan Control**: Add ability to stop scanning operations in progress

The solution maintains the existing Node.js/Express backend with SQLite database and vanilla JavaScript frontend architecture.

## Architecture

### Current System Architecture
- **Backend**: Node.js with Express.js framework
- **Database**: SQLite with optimized WAL mode and indexing
- **Frontend**: Vanilla HTML/CSS/JavaScript with responsive design
- **File Operations**: fs-extra for enhanced file system operations
- **Scanning**: Multi-threaded async scanning with progress tracking

### Enhancement Integration Points
- **Database Layer**: Extend existing SQLite queries for tracking status
- **API Layer**: Add new endpoints for database status checks and scan control
- **Frontend Layer**: Modify existing UI components and add new visual indicators
- **Scanning System**: Extend existing scan progress tracking with cancellation support

## Components and Interfaces

### 1. Database Status Indicator System

#### Backend Components

**New API Endpoint**: `/api/files/database-status`
```javascript
// Check if files/folders exist in database
app.post('/api/files/database-status', (req, res) => {
    const { paths } = req.body; // Array of file/folder paths
    // Query database for each path
    // Return object mapping path -> boolean (exists in DB)
});
```

**Database Query Enhancement**:
```sql
-- New optimized query for batch path checking
SELECT full_path FROM files WHERE full_path IN (?, ?, ?, ...);
```

#### Frontend Components

**Visual Indicator CSS**:
```css
.tree-item.in-database {
    background-color: #e8f5e8; /* Soft green background */
}

.file-browser-item.in-database {
    background-color: #e8f5e8;
}
```

**JavaScript Enhancement**:
```javascript
// New function to check database status for displayed items
async function checkDatabaseStatus(paths) {
    const response = await apiCall('/files/database-status', {
        method: 'POST',
        body: JSON.stringify({ paths })
    });
    return response.statusMap;
}

// Apply visual indicators based on database status
function applyDatabaseIndicators(statusMap) {
    // Update DOM elements with in-database class
}
```

### 2. Interface Simplification

#### HTML Template Changes
Remove buttons from directory browser section:
```html
<!-- REMOVE THESE BUTTONS -->
<button class="btn btn-secondary" onclick="expandAll()">📂 Развернуть все</button>
<button class="btn btn-secondary" onclick="collapseAll()">📁 Свернуть все</button>
```

#### JavaScript Cleanup
- Remove `expandAll()` function
- Remove `collapseAll()` function  
- Remove any references to these functions

### 3. Scan Control System

#### Backend Components

**Enhanced Scan Progress Tracking**:
```javascript
// Extend existing scanProgress Map structure
scanProgress.set(scanId, {
    // ... existing fields
    cancelled: false,        // New cancellation flag
    cancellationRequested: false  // New cancellation request flag
});
```

### 4. Integrity Check Enhancement System

#### Backend Components

**Modified Integrity Check Function**:
```javascript
// New non-destructive integrity check
app.post('/api/database/integrity-check', async (req, res) => {
    const missingFiles = [];
    
    // Check all database records without deleting
    db.all('SELECT * FROM files', (err, rows) => {
        rows.forEach(file => {
            if (!fs.existsSync(file.full_path)) {
                missingFiles.push({
                    id: file.id,
                    path: file.full_path,
                    filename: file.filename,
                    isDirectory: file.is_directory
                });
            }
        });
        
        // Create missed_files.txt report
        const reportContent = missingFiles.map(file => 
            `${file.isDirectory ? '[DIR]' : '[FILE]'} ${file.path}`
        ).join('\n');
        
        fs.writeFileSync('./missed_files.txt', reportContent);
        
        res.json({
            totalChecked: rows.length,
            missingCount: missingFiles.length,
            reportFile: './missed_files.txt',
            missingFiles: missingFiles
        });
    });
});
```

### 5. Interface Scaling System

#### CSS Enhancements

**Increased Container and Font Sizes**:
```css
.container {
    max-width: 1600px; /* Increased from 1200px */
    margin: 0 auto;
    padding: 30px; /* Increased padding */
}

body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 16px; /* Increased base font size */
    background-color: #f5f5f5;
    color: #333;
}

.header h1 {
    font-size: 2.5rem; /* Larger header */
    color: #2c3e50;
    margin-bottom: 15px;
}

.tab {
    padding: 15px 30px; /* Increased padding */
    font-size: 16px; /* Larger tab font */
    font-weight: 500;
}

.btn {
    padding: 12px 24px; /* Larger buttons */
    font-size: 16px; /* Larger button text */
    font-weight: 500;
}

table {
    font-size: 15px; /* Larger table text */
}

th, td {
    padding: 15px 18px; /* Increased cell padding */
}
```

**New API Endpoint**: `/api/scan/stop/:scanId`
```javascript
app.post('/api/scan/stop/:scanId', (req, res) => {
    const { scanId } = req.params;
    const progress = scanProgress.get(scanId);
    
    if (progress && progress.status === 'scanning') {
        progress.cancellationRequested = true;
        // Graceful shutdown logic
    }
});
```

**Scanning Function Enhancement**:
```javascript
// Modify existing scanMultipleDirectoriesAsync function
async function scanMultipleDirectoriesAsync(rootPaths, scanId, threadCount, calculateCrc32) {
    const progress = scanProgress.get(scanId);
    
    // Add cancellation checks in scanning loops
    for (const itemPath of chunk) {
        if (progress.cancellationRequested) {
            progress.status = 'cancelled';
            progress.cancelled = true;
            return; // Exit gracefully
        }
        // ... existing scanning logic
    }
}
```

#### Frontend Components

**Stop Button UI**:
```html
<!-- Add to scan status area -->
<button id="stop-scan-btn" class="btn btn-danger" onclick="stopScanning()" style="display: none;">
    ⏹️ Остановить сканирование
</button>
```

**JavaScript Enhancement**:
```javascript
// New function to stop scanning
async function stopScanning() {
    if (currentScanId) {
        await apiCall(`/scan/stop/${currentScanId}`, { method: 'POST' });
        showMessage('Запрос на остановку сканирования отправлен...', 'info');
    }
}

// Modify existing scan progress monitoring
function monitorScanProgress(scanId) {
    // Show stop button when scanning starts
    document.getElementById('stop-scan-btn').style.display = 'inline-block';
    
    // Hide stop button when scanning completes/stops
    // ... existing progress monitoring logic
}
```

## Data Models

### Database Status Response Model
```javascript
{
    statusMap: {
        "C:\\Users\\Documents\\file1.txt": true,
        "C:\\Users\\Documents\\folder1": false,
        // ... more path -> boolean mappings
    }
}
```

### Enhanced Scan Progress Model
```javascript
{
    scanId: "1698123456789",
    total: 15000,
    processed: 8500,
    errors: [],
    status: "scanning", // "scanning" | "completed" | "cancelled" | "error"
    cancelled: false,
    cancellationRequested: false,
    paths: ["C:\\Users\\Documents"],
    startTime: 1698123456789,
    endTime: null,
    duration: 0,
    calculateCrc32: true
}
```

## Error Handling

### Database Status Checking
- **Connection Errors**: Graceful fallback to no indicators if database unavailable
- **Query Timeouts**: Implement reasonable timeout (5 seconds) for status checks
- **Large Path Lists**: Batch process paths in chunks of 100 to avoid query limits

### Scan Cancellation
- **Graceful Shutdown**: Allow current file processing to complete before stopping
- **Data Integrity**: Ensure partially scanned data is properly committed to database
- **Progress Preservation**: Maintain accurate progress counts even when cancelled
- **Resource Cleanup**: Properly close file handles and database connections

### UI Error States
- **Network Failures**: Show retry options for database status checks
- **Cancellation Failures**: Inform user if stop request fails
- **Visual Indicator Failures**: Degrade gracefully without breaking core functionality

## Testing Strategy

### Unit Tests
- Database status query performance with various path list sizes
- Scan cancellation logic with different timing scenarios
- Visual indicator application and removal

### Integration Tests
- End-to-end database status checking workflow
- Complete scan start-to-stop workflow
- UI responsiveness during database status updates

### Performance Tests
- Database status checking with 1000+ paths
- Memory usage during scan cancellation
- UI rendering performance with visual indicators

### User Acceptance Tests
- Visual verification of soft green indicators
- Scan cancellation responsiveness testing
- Interface cleanliness after button removal

## Implementation Considerations

### Performance Optimization
- **Batch Database Queries**: Check multiple paths in single query using IN clause
- **Debounced Status Checks**: Avoid excessive API calls during rapid UI updates
- **Efficient DOM Updates**: Use DocumentFragment for bulk DOM modifications
- **Memory Management**: Clean up cancelled scan data from memory

### Backward Compatibility
- All existing API endpoints remain unchanged
- Database schema requires no modifications
- Existing scan functionality preserved
- No breaking changes to file operations

### Security Considerations
- **Path Validation**: Sanitize file paths in database status requests
- **Scan Control**: Validate scan ID ownership before allowing cancellation
- **Resource Limits**: Prevent abuse of database status checking endpoint

### Accessibility
- **Visual Indicators**: Ensure sufficient color contrast for green indicators
- **Keyboard Navigation**: Maintain keyboard accessibility after button removal
- **Screen Readers**: Add appropriate ARIA labels for new UI elements

## 4. Scan History System

### Backend Components

**JSON Database File**: `./scan-history.json`
```javascript
// Scan history data structure
{
    "scans": [
        {
            "id": "scan_1698123456789",
            "startTime": "2023-10-24T10:30:00.000Z",
            "endTime": "2023-10-24T10:35:30.000Z",
            "duration": 330000,
            "status": "completed",
            "paths": ["C:\\Users\\Documents", "D:\\Photos"],
            "threadCount": 8,
            "filesProcessed": 15420,
            "foldersProcessed": 1250,
            "totalSize": 2147483648,
            "calculateCrc32": true,
            "errors": []
        }
    ]
}
```

**New API Endpoints**:
```javascript
// Get scan history
app.get('/api/scan-history', (req, res) => {
    // Read and return scan history from JSON file
});

// Add scan to history (called internally when scan completes)
function addScanToHistory(scanData) {
    // Append new scan record to JSON file
}
```

**Integration with Existing Scan System**:
```javascript
// Modify scanMultipleDirectoriesAsync to record history
async function scanMultipleDirectoriesAsync(rootPaths, scanId, threadCount, calculateCrc32) {
    // ... existing scanning logic
    
    // On completion, record to history
    const scanRecord = {
        id: scanId,
        startTime: progress.startTime,
        endTime: progress.endTime,
        duration: progress.duration,
        status: progress.status,
        paths: rootPaths,
        threadCount: threadCount,
        filesProcessed: progress.processed,
        // ... other metrics
    };
    
    await addScanToHistory(scanRecord);
}
```

### Frontend Components

**New Tab in HTML**:
```html
<button class="tab" onclick="showTab('history')">📊 История сканирования</button>

<div id="history-tab" class="tab-content">
    <h2>История сканирования</h2>
    <div id="scan-history-container">
        <!-- Scan history will be populated here -->
    </div>
</div>
```

**History Display JavaScript**:
```javascript
// Load and display scan history
async function loadScanHistory() {
    const history = await apiCall('/scan-history');
    renderScanHistory(history.scans);
}

// Render scan history table
function renderScanHistory(scans) {
    // Create table with columns:
    // - Date/Time
    // - Scanned Paths
    // - Duration
    // - Thread Count
    // - Files/Folders Count
    // - Status
}
```

## 5. Hierarchical File Display System

### Backend Components

**New API Endpoint**: `/api/files/tree`
```javascript
app.get('/api/files/tree', (req, res) => {
    const { search, rootPath } = req.query;
    
    // Query database to build hierarchical structure
    const query = `
        SELECT DISTINCT directory, filename, is_directory, full_path
        FROM files 
        WHERE full_path LIKE ? 
        ORDER BY directory, is_directory DESC, filename ASC
    `;
    
    // Build tree structure from flat file list
    const tree = buildFileTree(rows);
    res.json(tree);
});
```

**Tree Building Algorithm**:
```javascript
function buildFileTree(files) {
    const tree = {};
    
    files.forEach(file => {
        const pathParts = file.full_path.split(path.sep);
        let currentLevel = tree;
        
        pathParts.forEach((part, index) => {
            if (!currentLevel[part]) {
                currentLevel[part] = {
                    name: part,
                    path: pathParts.slice(0, index + 1).join(path.sep),
                    isDirectory: index < pathParts.length - 1 || file.is_directory,
                    children: {},
                    files: []
                };
            }
            
            if (index === pathParts.length - 1 && !file.is_directory) {
                currentLevel[part].files.push(file);
            } else {
                currentLevel = currentLevel[part].children;
            }
        });
    });
    
    return tree;
}
```

### Frontend Components

**Tree Display HTML Structure**:
```html
<!-- Replace existing files table with tree view -->
<div id="files-tree-container" class="files-tree">
    <div id="files-tree-root">
        <!-- Tree structure will be populated here -->
    </div>
</div>
```

**Tree Rendering CSS**:
```css
.files-tree {
    border: 1px solid #ddd;
    border-radius: 6px;
    max-height: 600px;
    overflow-y: auto;
}

.tree-node {
    padding: 8px 12px;
    border-bottom: 1px solid #eee;
    cursor: pointer;
}

.tree-node.directory {
    font-weight: 500;
    background: #f8f9fa;
}

.tree-node.file {
    padding-left: 30px;
    font-size: 14px;
}

.tree-children {
    margin-left: 20px;
    border-left: 2px solid #ecf0f1;
}

.expand-icon {
    display: inline-block;
    width: 16px;
    margin-right: 8px;
    text-align: center;
    cursor: pointer;
}
```

**Tree Interaction JavaScript**:
```javascript
// Load and render file tree
async function loadFileTree(searchQuery = '') {
    const tree = await apiCall(`/files/tree?search=${encodeURIComponent(searchQuery)}`);
    renderFileTree(tree);
}

// Render tree structure
function renderFileTree(treeData) {
    const container = document.getElementById('files-tree-root');
    container.innerHTML = '';
    
    Object.values(treeData).forEach(node => {
        const nodeElement = createTreeNode(node);
        container.appendChild(nodeElement);
    });
}

// Create individual tree node
function createTreeNode(node) {
    const nodeDiv = document.createElement('div');
    nodeDiv.className = 'tree-node';
    
    if (node.isDirectory) {
        nodeDiv.className += ' directory';
        nodeDiv.innerHTML = `
            <span class="expand-icon" onclick="toggleNode(this)">▶</span>
            <span class="folder-icon">📁</span>
            <span class="node-name">${node.name}</span>
        `;
        
        // Add children container
        const childrenDiv = document.createElement('div');
        childrenDiv.className = 'tree-children';
        childrenDiv.style.display = 'none';
        
        Object.values(node.children).forEach(child => {
            childrenDiv.appendChild(createTreeNode(child));
        });
        
        node.files.forEach(file => {
            const fileNode = createFileNode(file);
            childrenDiv.appendChild(fileNode);
        });
        
        nodeDiv.appendChild(childrenDiv);
    }
    
    return nodeDiv;
}

// Toggle node expansion
function toggleNode(expandIcon) {
    const childrenDiv = expandIcon.parentElement.querySelector('.tree-children');
    if (childrenDiv.style.display === 'none') {
        childrenDiv.style.display = 'block';
        expandIcon.textContent = '▼';
    } else {
        childrenDiv.style.display = 'none';
        expandIcon.textContent = '▶';
    }
}
```

## Enhanced Data Models

### Scan History Record Model
```javascript
{
    id: "scan_1698123456789",
    startTime: "2023-10-24T10:30:00.000Z",
    endTime: "2023-10-24T10:35:30.000Z", 
    duration: 330000, // milliseconds
    status: "completed" | "cancelled" | "error",
    paths: ["C:\\Users\\Documents", "D:\\Photos"],
    threadCount: 8,
    filesProcessed: 15420,
    foldersProcessed: 1250,
    totalSize: 2147483648, // bytes
    calculateCrc32: true,
    errors: ["Error message 1", "Error message 2"]
}
```

### File Tree Node Model
```javascript
{
    name: "Documents",
    path: "C:\\Users\\Documents",
    isDirectory: true,
    children: {
        "Photos": { /* nested node */ },
        "Videos": { /* nested node */ }
    },
    files: [
        {
            id: 123,
            filename: "document.pdf",
            full_path: "C:\\Users\\Documents\\document.pdf",
            size: 1024000,
            // ... other file properties
        }
    ]
}
```


## 6. Database Rescan System

### Overview

The rescan system allows users to update database records for files and folders that have been modified on disk. This includes handling renamed files, moved folders, size changes, and deleted items. The system integrates with the existing scanning infrastructure while providing targeted updates to specific database entries.

### Backend Components

**New API Endpoint**: `/api/database/rescan`
```javascript
app.post('/api/database/rescan', async (req, res) => {
    const { paths } = req.body; // Array of full paths to rescan
    const scanId = Date.now().toString();
    
    try {
        // 1. Collect all paths to rescan (expand folders recursively)
        const pathsToRescan = await collectRescanPaths(paths);
        
        // 2. Delete old database records for these paths
        await deleteOldRecords(pathsToRescan);
        
        // 3. Initiate new scan for these paths
        const result = await scanMultipleDirectoriesAsync(
            paths, 
            scanId, 
            threadCount, 
            calculateCrc32
        );
        
        res.json({
            success: true,
            scanId: scanId,
            pathsProcessed: pathsToRescan.length,
            message: 'Rescan initiated successfully'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
```

**Helper Function: Collect Rescan Paths**
```javascript
async function collectRescanPaths(selectedPaths) {
    const allPaths = new Set();
    
    for (const selectedPath of selectedPaths) {
        // Query database for all records matching this path
        const query = `
            SELECT full_path, is_directory 
            FROM files 
            WHERE full_path = ? OR full_path LIKE ?
        `;
        
        const rows = await db.all(query, [
            selectedPath,
            selectedPath + path.sep + '%'
        ]);
        
        rows.forEach(row => allPaths.add(row.full_path));
    }
    
    return Array.from(allPaths);
}
```

**Helper Function: Delete Old Records**
```javascript
async function deleteOldRecords(paths) {
    // Build parameterized query for batch deletion
    const placeholders = paths.map(() => '?').join(',');
    const query = `DELETE FROM files WHERE full_path IN (${placeholders})`;
    
    return new Promise((resolve, reject) => {
        db.run(query, paths, function(err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}
```

**Integration with Existing Scan System**
```javascript
// Modify scanMultipleDirectoriesAsync to handle rescan mode
async function scanMultipleDirectoriesAsync(rootPaths, scanId, threadCount, calculateCrc32, isRescan = false) {
    // ... existing scanning logic
    
    // During rescan, check if files still exist
    for (const itemPath of chunk) {
        if (!fs.existsSync(itemPath)) {
            // File was deleted - skip it (already removed from DB)
            continue;
        }
        
        // Process existing or new files normally
        // ... existing file processing logic
    }
}
```

### Frontend Components

**Context Menu Enhancement**
```javascript
// Add Rescan option to database tab context menu
function showDatabaseContextMenu(event, selectedItems) {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = `
        <div class="context-menu-item" onclick="rescanSelected()">
            🔄 Rescan
        </div>
        <!-- ... other menu items -->
    `;
    
    // Position and show menu
    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';
    document.body.appendChild(menu);
}
```

**Rescan Execution Function**
```javascript
async function rescanSelected() {
    const selectedItems = getSelectedDatabaseItems();
    
    if (selectedItems.length === 0) {
        showMessage('Выберите файлы или папки для пересканирования', 'warning');
        return;
    }
    
    // Confirm action
    const confirmed = confirm(
        `Пересканировать ${selectedItems.length} элемент(ов)?\n` +
        'Старые записи будут удалены и заменены новыми данными.'
    );
    
    if (!confirmed) return;
    
    try {
        // Extract full paths from selected items
        const paths = selectedItems.map(item => item.full_path);
        
        // Call rescan API
        const response = await apiCall('/database/rescan', {
            method: 'POST',
            body: JSON.stringify({ paths })
        });
        
        // Monitor scan progress
        monitorScanProgress(response.scanId);
        
        showMessage('Пересканирование начато...', 'info');
    } catch (error) {
        showMessage('Ошибка при пересканировании: ' + error.message, 'error');
    }
}
```

**Selection Management**
```javascript
// Track selected items in database tab
let selectedDatabaseItems = [];

function getSelectedDatabaseItems() {
    return selectedDatabaseItems;
}

// Add selection handling to database table rows
function renderDatabaseTable(files) {
    // ... existing table rendering
    
    // Add click handler for row selection
    row.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) {
            // Multi-select mode
            toggleRowSelection(row, file);
        } else {
            // Single select mode
            clearSelection();
            selectRow(row, file);
        }
    });
}

function toggleRowSelection(row, file) {
    const index = selectedDatabaseItems.findIndex(
        item => item.full_path === file.full_path
    );
    
    if (index >= 0) {
        selectedDatabaseItems.splice(index, 1);
        row.classList.remove('selected');
    } else {
        selectedDatabaseItems.push(file);
        row.classList.add('selected');
    }
}

function selectRow(row, file) {
    selectedDatabaseItems = [file];
    row.classList.add('selected');
}

function clearSelection() {
    selectedDatabaseItems = [];
    document.querySelectorAll('.database-row.selected').forEach(row => {
        row.classList.remove('selected');
    });
}
```

**CSS for Selection and Context Menu**
```css
/* Row selection styling */
.database-row.selected {
    background-color: #e3f2fd;
    border-left: 3px solid #2196f3;
}

.database-row:hover {
    background-color: #f5f5f5;
    cursor: pointer;
}

/* Context menu styling */
.context-menu {
    position: absolute;
    background: white;
    border: 1px solid #ccc;
    border-radius: 4px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    z-index: 1000;
    min-width: 150px;
}

.context-menu-item {
    padding: 10px 15px;
    cursor: pointer;
    border-bottom: 1px solid #eee;
}

.context-menu-item:hover {
    background-color: #f0f0f0;
}

.context-menu-item:last-child {
    border-bottom: none;
}
```

### Data Flow

**Rescan Operation Flow**:
1. User selects one or more files/folders in Database tab
2. User right-clicks and selects "Rescan" from context menu
3. Frontend collects full paths of selected items
4. Frontend sends POST request to `/api/database/rescan` with paths array
5. Backend queries database to find all records matching selected paths (including nested items)
6. Backend deletes all matching records from database
7. Backend initiates new scan operation for the selected paths
8. Scanning system processes files/folders:
   - Skips files that no longer exist on disk
   - Calculates new hashes, sizes, and metadata for existing files
   - Inserts new records into database
9. Frontend monitors scan progress and updates UI
10. On completion, database tab refreshes to show updated records

### Error Handling

**Path Validation**
- Validate that selected paths exist in database before rescan
- Handle cases where paths have been manually deleted from database
- Provide clear error messages for invalid selections

**File System Errors**
- Handle permission errors when accessing files during rescan
- Skip files that cannot be read and log errors
- Continue processing remaining files even if some fail

**Database Errors**
- Handle deletion failures gracefully
- Ensure transaction integrity during delete-and-rescan operation
- Rollback changes if critical errors occur

**Concurrent Operations**
- Prevent multiple rescan operations on same paths simultaneously
- Queue rescan requests if scan is already in progress
- Provide feedback when rescan cannot start immediately

### Performance Considerations

**Batch Operations**
- Delete old records in single batch query using IN clause
- Minimize database round-trips during path collection
- Use existing multi-threaded scanning infrastructure

**Progress Tracking**
- Reuse existing scan progress monitoring system
- Show accurate progress for rescan operations
- Update UI efficiently without blocking

**Memory Management**
- Process large folder rescans in chunks
- Clean up temporary data structures after rescan
- Avoid loading entire directory trees into memory

### Security Considerations

**Path Sanitization**
- Validate and sanitize all input paths
- Prevent path traversal attacks
- Ensure paths are within allowed directories

**Access Control**
- Verify user has permission to access selected paths
- Handle permission errors gracefully
- Log security-related errors for audit

### User Experience

**Visual Feedback**
- Highlight selected items clearly in database table
- Show context menu at cursor position
- Display progress bar during rescan operation
- Provide confirmation dialog before starting rescan

**Error Communication**
- Show clear error messages for failed operations
- Indicate which files failed during rescan
- Provide actionable suggestions for resolving errors

**State Management**
- Disable rescan option when no items selected
- Clear selection after successful rescan
- Refresh database view automatically after rescan completes
