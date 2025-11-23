# Filestash Super Beta 2.0.1 - Rar Removed (Need UI Fixes)

## 🎯 Critical Bug Fix Release

This release fixes a **critical CRC32 consistency bug** that caused false positive integrity check failures.

---

## 🐛 Critical Fixes

### CRC32 Calculation Consistency ✅ FIXED

**Problem:** Integrity checks reported CRC32 mismatches even when files hadn't changed.

**Root Cause:** 
- Scanning used `calculateCRC32Optimized()` with one formula
- Integrity checking used old `calculateCRC32()` with different formula
- Result: Same file produced different hashes

**Solution:**
- ✅ Fixed deterministic position calculations for partial hashing
- ✅ Unified all code to use `calculateCRC32Optimized()`
- ✅ Tested on files from 16MB to 1067MB - all consistent

**Impact:**
- No more false positive CRC32 mismatches
- Reliable integrity checking for all file sizes
- Same performance (partial hashing still used for speed)

---

## 🗜️ WinRAR Removal

- ❌ **Removed WinRAR support** completely
- ✅ **7-Zip only** - simpler, more reliable
- ✅ **Full UTF-8 support** - no more encoding issues with Cyrillic/Chinese filenames
- ✅ **Smaller codebase** - easier to maintain

---

## 🛠️ New Tools & Scripts

### Testing Tools
- **`test-crc32-consistency.js`** - Verify CRC32 calculation for any file
  ```bash
  node test-crc32-consistency.js "path/to/file.mp4"
  ```

- **`fix-crc32-mismatches.js`** - Update all CRC32 values in existing database
  ```bash
  node fix-crc32-mismatches.js
  ```

- **`verify-fix.bat`** - Quick verification script

### Documentation
- **`CRC32-FIX-DOCUMENTATION.md`** - Complete technical documentation
- **`QUICK-FIX-GUIDE.md`** - Quick start guide for users

---

## 📊 Test Results

| File | Size | Hash | Consistency |
|------|------|------|-------------|
| Amelia Model.wmv | 16.17 MB | `b926bca7` | ✅ 5/5 |
| Julia-030p.4K.mp4 | 1067.12 MB | `cb084a53` | ✅ 5/5 |
| DSCF6963.AVI | 67.98 MB | `333ffc84` | ✅ 5/5 |
| DSCF7308.AVI | 66.14 MB | `1b933ece` | ✅ 5/5 |

---

## 🚀 Migration Guide

### For Existing Databases

**Option A: Fresh Start (Recommended)**
1. Stop FileStash server
2. Delete `filestash.db`
3. Start server
4. Rescan directories
5. Run integrity check ✅

**Option B: Fix Existing Database**
1. Stop FileStash server
2. Run `node fix-crc32-mismatches.js`
3. Start server
4. Run integrity check ✅

### For New Installations
- Just install and use - works correctly out of the box!

---

## ⚠️ Known Issues

- **UI needs improvements** (noted in release title)
- Some UI elements may need refinement in future releases
- This is a **beta release** - please report any issues

---

## 📁 Files Changed

### Core Fixes
- `server.js` - Fixed `calculateCRC32Optimized()` and integrity check
- `server/file-operations.js` - Fixed `calculateCRC32()` function

### WinRAR Removal
- `archive-with-progress.js` - Removed WinRAR code
- `archiver-manager.js` - Simplified to 7-Zip only

### New Files
- `test-crc32-consistency.js` - Testing tool
- `fix-crc32-mismatches.js` - Migration script
- `CRC32-FIX-DOCUMENTATION.md` - Technical docs
- `QUICK-FIX-GUIDE.md` - Quick guide

---

## 🔧 Technical Details

### Partial Hashing Strategy

For large files (>100MB), FileStash uses **partial hashing** for speed:

1. **File size** - Added to hash
2. **First 1MB** - Bytes 0 to 1,048,576
3. **Middle 1MB** - Position: `Math.floor((fileSize - chunkSize) / 2)`
4. **Last 1MB** - Position: `fileSize - chunkSize`

This provides:
- ⚡ **Fast scanning** - Only reads 3MB per file
- ✅ **Deterministic** - Same file = same hash
- 🎯 **Reliable** - Detects file changes

---

## 📦 Installation

```bash
# Clone repository
git clone https://github.com/yourusername/filestash.git
cd filestash

# Install dependencies
npm install

# Start server
npm start
```

---

## 🐛 Bug Reports

Found a bug? Please report it:
- **GitHub Issues**: https://github.com/yourusername/filestash/issues
- Include: OS version, Node.js version, steps to reproduce

---

## 📝 Full Changelog

See [CHANGELOG.md](CHANGELOG.md) for complete version history.

---

## 🙏 Credits

Thanks to all users who reported the CRC32 mismatch issue!

---

**Download:** [v2.0.1 Release](https://github.com/yourusername/filestash/releases/tag/v2.0.1)

**Previous Release:** [v2.0.0](https://github.com/yourusername/filestash/releases/tag/v2.0.0)

---

Made with ❤️ for reliable file management
