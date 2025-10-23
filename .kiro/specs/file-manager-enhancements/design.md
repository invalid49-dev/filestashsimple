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