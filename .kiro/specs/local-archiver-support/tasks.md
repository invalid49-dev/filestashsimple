# Implementation Plan

- [x] 1. Create Archiver Manager module





  - Create new file `archiver-manager.js` with ArchiverManager class
  - Implement archiver detection logic with local-first priority
  - Implement format-to-archiver mapping
  - Add caching for detection results
  - Add startup logging for detected archivers
  - _КуйгшкуьутеыЖ 1ю1б 1ю2б 1ю3б 1ю4б 1ю5б 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 2. Enhance archive creation module





  - [x] 2.1 Add format parameter to createArchiveWithProgress function


    - Update function signature to accept format parameter
    - Add format validation
    - _Requirements: 2.1_
  
  - [x] 2.2 Implement format-specific command builders

    - Create command builder for ZIP format using 7-Zip
    - Create command builder for 7Z format using 7-Zip
    - Create command builder for RAR format using WinRAR
    - _Requirements: 2.2, 2.3, 2.4_
  
  - [x] 2.3 Update archiver type detection

    - Modify archiverType logic to work with format parameter
    - Ensure correct archiver is selected based on format
    - _Requirements: 2.2, 2.3, 2.4_

- [x] 3. Update server endpoints







  - [x] 3.1 Enhance GET /api/archivers endpoint


    - Integrate ArchiverManager to get archiver information
    - Return detailed archiver info including paths and types
    - Return format-to-archiver mapping
    - Return list of supported formats
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  
  - [x] 3.2 Enhance POST /api/files/archive endpoint



    - Add format parameter handling
    - Validate format parameter
    - Use ArchiverManager to get appropriate archiver for format
    - Return error if format requires unavailable archiver
    - Update archive file extension based on format
    - Pass format to createArchiveWithProgress
    - _Requirements: 2.1, 2.5, 2.6, 4.1, 4.2, 4.3, 4.4_
  
  - [x] 3.3 Replace checkArchivers function


    - Remove old checkArchivers function from server.js
    - Replace all calls with ArchiverManager
    - Update backup endpoint to use ArchiverManager
    - _Requirements: 5.1, 5.2_

- [x] 4. Update client-side UI





  - [x] 4.1 Add format selection to archive dialog


    - Add format dropdown to archive modal
    - Fetch available formats from /api/archivers on dialog open
    - Populate format dropdown with available options
    - Disable unavailable format options
    - _Requirements: 2.1, 3.1, 3.2, 3.3, 3.4_
  
  - [x] 4.2 Update archive creation logic


    - Include selected format in archive request
    - Update archive filename extension based on selected format
    - Handle format-specific errors from server
    - _Requirements: 2.1, 4.1, 4.2, 4.3, 4.4_
  
  - [x] 4.3 Update UI feedback


    - Display archiver type in progress console
    - Show format in archive creation messages
    - _Requirements: 2.1_

- [x] 5. Integrate ArchiverManager into server startup







  - Initialize ArchiverManager on server startup
  - Log detected archivers and supported formats
  - Handle case when no archivers are available
  - _Requirements: 5.5_

- [x] 6. Update configuration and documentation





  - [x] 6.1 Update .env.example with archiver paths

    - Add comments about local archiver support
    - Document bin directory structure
    - _Requirements: 5.5_
  
  - [x] 6.2 Update README with archiver setup instructions


    - Document local archiver installation
    - Explain format selection feature
    - Add troubleshooting section
    - _Requirements: 5.3_
