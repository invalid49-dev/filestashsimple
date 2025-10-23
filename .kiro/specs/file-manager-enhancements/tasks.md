# Implementation Plan

- [x] 1. Implement database status checking system










  - Create new API endpoint `/api/files/database-status` for batch path checking
  - Implement optimized SQL query using IN clause for multiple path lookup
  - Add error handling for database connection issues and query timeouts
  - _Requirements: 1.1, 1.2_

- [x] 2. Add visual indicators for database-tracked files


  - [x] 2.1 Create CSS styles for soft green background indicators


    - Add `.in-database` class with soft green background color (#e8f5e8)
    - Ensure proper contrast and accessibility compliance
    - _Requirements: 1.1, 1.3_

  - [x] 2.2 Implement frontend database status checking logic


    - Create `checkDatabaseStatus()` function to call new API endpoint
    - Implement `applyDatabaseIndicators()` function to update DOM elements
    - Add debouncing to prevent excessive API calls during UI updates
    - _Requirements: 1.1, 1.2, 1.4_

  - [x] 2.3 Integrate database status checking into directory browser


    - Modify `renderDirectoryTree()` function to check and apply database status
    - Update tree item rendering to include database status indicators
    - Handle loading states and error scenarios gracefully
    - _Requirements: 1.1, 1.2, 1.4_

- [x] 3. Remove expand/collapse all buttons from interface





  - [x] 3.1 Remove expand/collapse buttons from HTML template


    - Delete "Развернуть все" and "Свернуть все" buttons from scan tab
    - Clean up associated HTML structure and spacing
    - _Requirements: 2.1, 2.2_

  - [x] 3.2 Remove expand/collapse JavaScript functions


    - Delete `expandAll()` and `collapseAll()` functions from app.js
    - Remove any references or event handlers for these functions
    - Ensure individual folder expand/collapse functionality remains intact
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 4. Implement scan cancellation system





  - [x] 4.1 Extend backend scan progress tracking for cancellation


    - Add `cancelled` and `cancellationRequested` fields to scan progress structure
    - Modify existing `scanProgress` Map to include cancellation state
    - _Requirements: 3.1, 3.2_

  - [x] 4.2 Create scan stop API endpoint


    - Implement `/api/scan/stop/:scanId` POST endpoint
    - Add validation for scan ID existence and active status
    - Implement graceful cancellation request handling
    - _Requirements: 3.2, 3.4_

  - [x] 4.3 Modify scanning function to support cancellation


    - Update `scanMultipleDirectoriesAsync()` function with cancellation checks
    - Add cancellation check points in scanning loops
    - Ensure proper cleanup and data integrity when cancelled
    - Preserve successfully scanned data before cancellation
    - _Requirements: 3.2, 3.5_

  - [x] 4.4 Add stop scanning UI controls


    - Create "Stop Scanning" button in scan status area
    - Implement `stopScanning()` JavaScript function
    - Show/hide stop button based on scanning status
    - Display appropriate status messages during cancellation
    - _Requirements: 3.1, 3.3, 3.4_

  - [x] 4.5 Update scan progress monitoring for cancellation


    - Modify existing progress monitoring to handle cancelled status
    - Update UI to reflect cancellation state and final results
    - Ensure proper cleanup of UI elements when scan is stopped
    - _Requirements: 3.3, 3.4, 3.5_

- [ ]* 5. Add comprehensive testing for new features
  - [ ]* 5.1 Write unit tests for database status checking
    - Test batch path lookup with various path list sizes
    - Test error handling for database connection failures
    - Test performance with large path collections
    - _Requirements: 1.1, 1.2_

  - [ ]* 5.2 Write integration tests for scan cancellation
    - Test complete scan start-to-stop workflow
    - Test cancellation at different stages of scanning process
    - Test data integrity after cancellation
    - _Requirements: 3.2, 3.5_

  - [ ]* 5.3 Write UI tests for visual indicators
    - Test visual indicator application and removal
    - Test UI responsiveness during database status updates
    - Test accessibility compliance of new visual elements
    - _Requirements: 1.1, 1.3, 1.4_