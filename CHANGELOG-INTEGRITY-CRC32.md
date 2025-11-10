# Changelog: Integrity Check & CRC32 Display

## Changes Made

### 1. Fixed Integrity Check Scope

**Problem**: When checking integrity of a specific file or folder, the system was checking ALL files in the database instead of just the selected path.

**Solution**: 
- Modified `/api/files/integrity-check` endpoint to properly scope the check
- Now checks:
  - **Single file**: Only that specific file
  - **Directory**: The directory itself + all files inside it
  - **Exact match first**: Checks if path exists exactly in database
  - **Fallback**: If no exact match, searches for files in that directory

**Implementation**:
```javascript
// 1. Check for exact match first
const exactMatch = await db.get('SELECT ... WHERE full_path = ?', [path]);

// 2. If it's a directory, get all files inside
if (exactMatch.is_directory) {
    query = 'WHERE full_path = ? OR full_path LIKE ?';
    params = [path, `${path}\\%`];
}

// 3. If it's a file, check only that file
else {
    query = 'WHERE full_path = ?';
    params = [path];
}
```

### 2. Added CRC32 Display

**Added CRC32 hash display in multiple locations**:

#### A. Database Table View
- ✅ Already had CRC32 column in table header
- ✅ Already displayed CRC32 in table rows
- Format: Monospace font, 12px, 8-character hash

#### B. File Tree View (NEW)
- ✅ Added CRC32 display next to file size
- Shows for files only (not directories)
- Format: Monospace font, 11px, gray color
- Tooltip: "CRC32 Hash"

**Example**:
```
📄 document.pdf  2.5 MB  a3f4b2c1  ✓
📄 image.jpg     1.2 MB  9e8d7c6b  ✓
📁 folder/
```

#### C. Search Results
- ✅ Already included in table view
- CRC32 shown in search results table

## Benefits

1. **Accurate Integrity Checks**:
   - No more checking entire database when you only want to check one folder
   - Faster checks for specific paths
   - More predictable behavior

2. **Better File Identification**:
   - CRC32 visible at a glance in tree view
   - Easy to compare file hashes
   - Helps identify duplicate files

3. **Improved UX**:
   - Clear visual feedback
   - Consistent display across all views
   - Monospace font for easy reading

## Testing

To test the changes:

1. **Integrity Check**:
   ```
   - Right-click on a specific file → Check Integrity
   - Should only check that file
   - Right-click on a folder → Check Integrity
   - Should check folder + all files inside
   ```

2. **CRC32 Display**:
   ```
   - Go to "База данных" tab
   - Switch to tree view
   - Expand folders to see files
   - CRC32 should appear next to file size
   ```

## Technical Details

### Files Modified:
- `server.js`: Fixed integrity check query logic
- `public/app.js`: Added CRC32 display in tree nodes

### Database Queries:
- Exact match: `WHERE full_path = ?`
- Directory contents: `WHERE full_path = ? OR full_path LIKE ?`
- Fallback search: `WHERE full_path LIKE ?`

### CSS Styling:
```css
.tree-crc32 {
    font-family: monospace;
    font-size: 11px;
    color: var(--text-tertiary);
    margin-left: 8px;
}
```

## Future Improvements

- [ ] Add CRC32 column sorting in table view
- [ ] Add CRC32 search/filter functionality
- [ ] Show CRC32 in file details modal
- [ ] Add option to copy CRC32 to clipboard
- [ ] Highlight duplicate CRC32 values


## Bug Fix: Path Escaping in Context Menu

### Problem
When right-clicking on a file in the tree view to check integrity, the path was being corrupted:
- Database: `P:\Cumshot\Gloryholeswallow 2016 part2.mp4`
- Received: `P:CumshotGloryholeswallow 2016 part2.mp4` (backslashes removed!)

This caused the integrity check to find 0 files because the path didn't match.

### Root Cause
Backslashes in Windows paths were being lost when passing through HTML attributes and JavaScript event handlers:
1. Path stored in `node.path`: `P:\Cumshot\file.mp4`
2. Inserted into HTML: `oncontextmenu="showTreeContextMenu(..., 'P:\Cumshot\file.mp4', ...)"`
3. Browser interprets `\C` as escape sequence
4. JavaScript receives: `P:Cumshotfile.mp4`

### Solution
Properly escape backslashes for JavaScript strings in HTML attributes:
```javascript
// Quadruple escape: \\ → \\\\ → \\\\\\\\ (for HTML → JS → String)
const escapedPath = node.path.replace(/\\/g, '\\\\\\\\').replace(/'/g, "\\'");
```

This ensures:
- HTML attribute: `'P:\\\\Cumshot\\\\file.mp4'`
- JavaScript string: `'P:\\Cumshot\\file.mp4'`
- Final value: `P:\Cumshot\file.mp4` ✓

### Testing
```bash
# Before fix:
Right-click file → Check Integrity → "Found 0 files" ❌

# After fix:
Right-click file → Check Integrity → "Found 1 file" ✓
```
