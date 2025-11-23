# CRC32 Consistency Fix Documentation

## Problem Description

When performing integrity checks on scanned files, CRC32 mismatches were reported even though files had not changed. This was caused by inconsistent CRC32 calculation between scanning and integrity checking.

## Root Cause

The application had **two different CRC32 calculation functions**:

1. **`calculateCRC32Optimized()`** - Used during scanning (async, with fixed positions)
2. **`calculateCRC32()`** - Used during integrity checking (sync, with old formula)

The old `calculateCRC32()` function used inconsistent position calculations:
- Middle position: `Math.floor(fileSize / 2) - Math.floor(chunkSize / 2)`
- End position: `Math.max(0, fileSize - chunkSize)`

This caused different hash values for the same file.

## Solution

### 1. Fixed Position Calculations

Updated both functions to use **deterministic positions**:

```javascript
// Middle position (for files > 2MB)
const middlePos = Math.floor((fileSize - chunkSize) / 2);

// End position (for files > 1MB)
const endPos = fileSize - chunkSize;
```

### 2. Unified CRC32 Calculation

Updated integrity check code to use `calculateCRC32Optimized()` instead of `calculateCRC32()`:

**Before:**
```javascript
const currentCRC32 = calculateCRC32(file.full_path);
```

**After:**
```javascript
const stats = fs.statSync(file.full_path);
const currentCRC32 = await calculateCRC32Optimized(file.full_path, stats.size);
```

### 3. Files Modified

- `server.js` - Lines 1733-1815 (calculateCRC32Optimized function)
- `server.js` - Line 4656 (integrity check CRC32 calculation)
- `server.js` - Line 4722 (renamed files CRC32 calculation)
- `server/file-operations.js` - Lines 48-105 (calculateCRC32 function)

## Testing

### Test Script: `test-crc32-consistency.js`

Tests that the same file always produces the same hash:

```bash
node test-crc32-consistency.js "path/to/file.mp4"
```

**Expected Result:**
```
✅ SUCCESS: All 5 hashes are identical!
   Hash value: cb084a53
```

### Test Results

| File | Size | Hash | Status |
|------|------|------|--------|
| `P:\Video\A\Amelia Model.wmv` | 16.17 MB | `b926bca7` | ✅ Consistent |
| `p:\Video\S\StarSession\Julia\Julia-030p.4K.mp4` | 1067.12 MB | `cb084a53` | ✅ Consistent |
| `S:\Фото\Броневичек\Video\DSCF6963.AVI` | 67.98 MB | `333ffc84` | ✅ Consistent |
| `S:\Фото\Броневичек\Video\DSCF7308.AVI` | 66.14 MB | `1b933ece` | ✅ Consistent |

## Migration Steps

### For Existing Databases

Run the fix script to update all CRC32 values:

```bash
node fix-crc32-mismatches.js
```

This will:
1. Recalculate CRC32 for all files in database
2. Update mismatched values
3. Report statistics

**Example Output:**
```
✅ Done!
   Updated: 26
   Unchanged: 1145
   Missing: 0
   Errors: 0
```

### For New Installations

1. Start FileStash server
2. Scan directories normally
3. Run integrity checks - no mismatches should occur

## Technical Details

### Partial Hashing Strategy

For performance, large files (>100MB) use **partial hashing**:

1. **File size** - Added to hash for uniqueness
2. **First 1MB** - Bytes 0 to 1,048,576
3. **Middle 1MB** - Calculated as `Math.floor((fileSize - chunkSize) / 2)`
4. **Last 1MB** - Bytes from `fileSize - 1,048,576` to end

### Hash Algorithm

- Uses MD5 hash (first 8 characters)
- Not cryptographically secure, but fast and sufficient for file identification
- Deterministic - same file always produces same hash

### File Size Categories

| Size | Method | Speed |
|------|--------|-------|
| < 10MB | Full file read | Fast |
| 10-100MB | Streaming | Medium |
| > 100MB | Partial hashing | Very Fast |

## Verification

### Before Fix

```
⚠️ CRC MISMATCH: P:\Video\A\Amelia Model.wmv
  Original CRC32: b926bca7
  Current CRC32:  7157b2e3
```

### After Fix

```
✅ CRC OK: P:\Video\A\Amelia Model.wmv (b926bca7)
```

## Performance Impact

- **No performance degradation** - Same partial hashing strategy
- **Improved reliability** - Consistent results across scans
- **Faster integrity checks** - No false positives to investigate

## Future Improvements

1. Consider using actual CRC32 algorithm instead of MD5
2. Add option for full file hashing (slower but more accurate)
3. Store hash algorithm version in database for future migrations
4. Add progress bar for fix-crc32-mismatches.js script

## Related Files

- `test-crc32-consistency.js` - Consistency testing tool
- `fix-crc32-mismatches.js` - Database migration script
- `verify-fix.bat` - Quick verification script
- `CRC32-FIX-DOCUMENTATION.md` - This file

## Changelog

### v2.0.1 - 2025-11-23

- ✅ Fixed CRC32 calculation consistency
- ✅ Updated integrity check to use correct function
- ✅ Added testing and migration tools
- ✅ Documented fix and migration process

---

**Status:** ✅ FIXED

**Last Updated:** 2025-11-23

**Tested By:** Automated tests + Manual verification
