# Implementation Plan

- [x] 1. Remove short name conversion logic from archive-with-progress.js


  - Remove the entire short name conversion block (lines ~100-140)
  - Remove execSync import if only used for short names
  - Remove all debug console.log statements related to short paths
  - Remove comments mentioning "short names" or "8.3 format"
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 2. Update WinRAR file list creation to use UTF-8

  - Change fs.writeFileSync encoding from 'ascii' to 'utf8' for WinRAR
  - Simplify the WinRAR branch to match 7-Zip logic (direct UTF-8 write)
  - Update comments to explain UTF-8 usage for WinRAR
  - _Requirements: 1.2, 1.4, 3.4_

- [x] 3. Add -scul parameter to WinRAR command arguments


  - Add '-scul' to the args array in WinRAR command building section
  - Add comment explaining that -scul tells WinRAR to read list file as UTF-8
  - Verify parameter is added before archive path and list file arguments
  - _Requirements: 1.3_

- [x] 4. Fix output decoding for WinRAR console output


  - Change stdout decoding to use 'cp866' for WinRAR instead of 'cp1251'
  - Change stderr decoding to use 'cp866' for WinRAR instead of 'cp1251'
  - Add conditional encoding selection based on archiverType
  - Keep 'cp1251' for 7-Zip (no changes to 7-Zip logic)
  - Update comments to explain CP866 (OEM) vs CP1251 (Windows ANSI)
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.3, 5.4, 5.5_

- [x] 5. Add path length validation


  - Add validation before archive creation to check for paths exceeding 260 characters
  - Filter filePaths array to find paths longer than MAX_PATH (260)
  - If long paths found, reject with detailed error message listing the problematic paths
  - Include path length in error message for each problematic path
  - _Requirements: 4.5_

- [x] 6. Improve error handling for WinRAR exit codes


  - Update the archiveProcess 'close' event handler
  - Add specific handling for exit code 1 (warnings - treat as success with warning flag)
  - Keep existing handling for exit code 0 (success) and other codes (errors)
  - Add warning message to console output when exit code is 1
  - _Requirements: 2.1, 2.2, 2.3_

- [x]* 7. Create unit tests for UTF-8 encoding


  - Create new test file test-winrar-utf8.js
  - Write test for UTF-8 list file creation with Cyrillic paths
  - Write test for -scul parameter presence in command arguments
  - Write test for CP866 output decoding
  - Write test for path length validation
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 4.5_




- [ ]* 8. Create integration tests for Cyrillic file archiving
  - Create test files and folders with Cyrillic names
  - Test archiving single file with Cyrillic name
  - Test archiving folder with Cyrillic name and nested files
  - Test archiving mixed Latin and Cyrillic files
  - Test archiving nested folders with Cyrillic names
  - Verify archive creation success and correct file names in output
  - Clean up test files and archives after tests
  - _Requirements: 1.1, 1.5, 4.1, 4.2, 4.3, 4.4_

- [x] 9. Verify no regression in 7-Zip functionality


  - Test archiving with 7-Zip in ZIP format
  - Test archiving with 7-Zip in 7Z format
  - Verify Cyrillic file names work correctly with 7-Zip
  - Verify console output decoding is correct for 7-Zip (CP1251)
  - _Requirements: 3.5, 5.1, 5.2, 5.4_

- [x] 10. Test edge cases and special scenarios



  - Test archiving files with only ASCII names (backward compatibility)
  - Test archiving with password protection enabled
  - Test creating multi-volume archives
  - Test different compression levels (0-5)
  - Test archive name with Cyrillic characters (should use temp name and rename)
  - _Requirements: 4.1, 4.2, 4.4_
