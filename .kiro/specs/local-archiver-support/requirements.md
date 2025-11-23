# Requirements Document

## Introduction

This feature adds support for using local archiver installations from the `bin` directory instead of relying on system-installed archivers. The application currently fails to create archives when 7-Zip or WinRAR are not installed system-wide. This enhancement will allow the application to use portable versions of 7-Zip and WinRAR located in `c:\filestash-simple\bin\7zip` and `c:\filestash-simple\bin\winrar`, and provide users with the ability to select archive formats (ZIP, RAR, 7Z).

## Glossary

- **FileStash Application**: The Node.js-based file management system that provides file scanning, searching, and archiving capabilities
- **Archiver**: A software tool that compresses and packages files into archive formats (7-Zip or WinRAR)
- **Archive Format**: The file format used for compressed archives (ZIP, RAR, or 7Z)
- **Local Archiver**: A portable version of archiving software located in the application's bin directory
- **System Archiver**: An archiver installed system-wide and accessible via PATH environment variable
- **Archive Endpoint**: The REST API endpoint `/api/files/archive` that handles archive creation requests
- **Archiver Detection Function**: The `checkArchivers()` function that locates available archiving tools
- **Archive Progress Tracker**: The system that monitors and reports archive creation progress via Server-Sent Events

## Requirements

### Requirement 1

**User Story:** As a user, I want the application to use local archivers from the bin directory, so that I can create archives without installing 7-Zip or WinRAR system-wide

#### Acceptance Criteria

1. WHEN the Archiver Detection Function executes, THE FileStash Application SHALL check for archiver executables in the `bin/7zip` directory before checking system PATH
2. WHEN the Archiver Detection Function executes, THE FileStash Application SHALL check for archiver executables in the `bin/winrar` directory before checking system PATH
3. WHEN a local 7-Zip executable is found at `bin/7zip/7z.exe`, THE FileStash Application SHALL register it as an available archiver with identifier "7zip"
4. WHEN a local WinRAR executable is found at `bin/winrar/Rar.exe`, THE FileStash Application SHALL register it as an available archiver with identifier "winrar"
5. IF no local archivers are found, THEN THE FileStash Application SHALL fall back to checking system-installed archivers

### Requirement 2

**User Story:** As a user, I want to select the archive format (ZIP, RAR, or 7Z), so that I can choose the compression format that best suits my needs

#### Acceptance Criteria

1. WHEN the Archive Endpoint receives a request, THE FileStash Application SHALL accept a "format" parameter with values "zip", "rar", or "7z"
2. WHEN the format parameter is "zip", THE FileStash Application SHALL use 7-Zip to create a ZIP archive
3. WHEN the format parameter is "rar", THE FileStash Application SHALL use WinRAR to create a RAR archive
4. WHEN the format parameter is "7z", THE FileStash Application SHALL use 7-Zip to create a 7Z archive
5. IF the format parameter is not provided, THEN THE FileStash Application SHALL default to "7z" format
6. IF the requested format requires an unavailable archiver, THEN THE FileStash Application SHALL return an error message indicating which archiver is needed

### Requirement 3

**User Story:** As a user, I want to see which archive formats are available, so that I can know which options I can use

#### Acceptance Criteria

1. WHEN the `/api/archivers` endpoint is called, THE FileStash Application SHALL return a list of available archivers
2. WHEN the `/api/archivers` endpoint is called, THE FileStash Application SHALL return a list of supported archive formats for each available archiver
3. WHEN 7-Zip is available, THE FileStash Application SHALL indicate that "zip" and "7z" formats are supported
4. WHEN WinRAR is available, THE FileStash Application SHALL indicate that "rar" format is supported
5. WHEN no archivers are available, THE FileStash Application SHALL return an empty list with a flag indicating no archivers are available

### Requirement 4

**User Story:** As a user, I want the archive file extension to match the selected format, so that the archive files are properly named

#### Acceptance Criteria

1. WHEN creating an archive with format "zip", THE FileStash Application SHALL append ".zip" extension to the archive filename
2. WHEN creating an archive with format "rar", THE FileStash Application SHALL append ".rar" extension to the archive filename
3. WHEN creating an archive with format "7z", THE FileStash Application SHALL append ".7z" extension to the archive filename
4. IF the user-provided archive name already contains an extension, THEN THE FileStash Application SHALL replace it with the correct extension for the selected format

### Requirement 5

**User Story:** As a developer, I want the archiver path resolution to be centralized, so that the code is maintainable and consistent

#### Acceptance Criteria

1. THE FileStash Application SHALL implement a single function that resolves archiver paths for both local and system installations
2. THE FileStash Application SHALL prioritize local archivers over system archivers when both are available
3. WHEN an archiver is not found locally or system-wide, THE FileStash Application SHALL log a clear message indicating which archiver is missing
4. THE FileStash Application SHALL cache archiver detection results to avoid repeated file system checks
5. WHEN the application starts, THE FileStash Application SHALL log which archivers are available and their locations
