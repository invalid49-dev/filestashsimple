# Quick Fix Guide - CRC32 Mismatches

## Problem
Integrity checks show CRC32 mismatches even though files haven't changed.

## Solution Applied
✅ Fixed CRC32 calculation to be deterministic
✅ Updated integrity check code to use correct function
✅ Created migration script for existing databases

## What To Do Now

### Option 1: Fresh Start (Recommended)
1. **Stop FileStash server**
2. **Delete database**: `del filestash.db`
3. **Start server**: `npm start`
4. **Rescan directories**
5. **Run integrity check** - Should show no mismatches

### Option 2: Fix Existing Database
1. **Stop FileStash server**
2. **Run fix script**: `node fix-crc32-mismatches.js`
3. **Start server**: `npm start`
4. **Run integrity check** - Should show no mismatches

## Verification

Test a file manually:
```bash
node test-crc32-consistency.js "P:\Video\A\Amelia Model.wmv"
```

Expected output:
```
✅ SUCCESS: All 5 hashes are identical!
```

## Files Changed
- `server.js` - Fixed CRC32 functions
- `server/file-operations.js` - Fixed CRC32 functions

## Need Help?
See `CRC32-FIX-DOCUMENTATION.md` for detailed information.
