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