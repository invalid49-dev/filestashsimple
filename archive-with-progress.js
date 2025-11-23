/**
 * Archive Creation with Progress Tracking
 * 
 * This module provides archive creation functionality with real-time progress tracking
 * and console output streaming.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const iconv = require('iconv-lite');
const os = require('os');

/**
 * Create archive with progress tracking
 * 
 * @param {Object} options - Archive options
 * @param {Array<string>} options.filePaths - Array of file paths to archive
 * @param {string} options.archivePath - Output archive path
 * @param {string} options.archiverPath - Path to archiver executable
 * @param {string} options.archiverType - Type of archiver (only '7zip' supported)
 * @param {string} options.format - Archive format ('zip' or '7z')
 * @param {string} options.password - Optional password for archive encryption
 * @param {number} options.volumeSize - Optional volume size in MB for multi-volume archives
 * @param {string} options.compression - Optional compression level (0-9)
 * @param {Function} options.onProgress - Progress callback
 * @param {Function} options.onConsoleOutput - Console output callback
 * @returns {Promise<Object>} Archive result
 */
async function createArchiveWithProgress(options) {
    const {
        filePaths,
        archivePath,
        archiverPath,
        archiverType,
        format = '7z', // Default to 7z format for backward compatibility
        password,
        volumeSize,
        compression,
        onProgress,
        onConsoleOutput
    } = options;

    // Validate format parameter - only 7-Zip formats supported
    const validFormats = ['zip', '7z'];
    if (!validFormats.includes(format)) {
        throw new Error(`Invalid format '${format}'. Supported formats: ${validFormats.join(', ')} (7-Zip only)`);
    }

    // Only 7-Zip is supported
    if (archiverType !== '7zip') {
        throw new Error(`Only 7-Zip archiver is supported. Got: ${archiverType}`);
    }

    return new Promise((resolve, reject) => {
        let command, args;
        let listFilePath = null;
        let tempArchivePath = null;
        let needsRename = false;

        // Validate path lengths before creating archive (Windows MAX_PATH limit)
        const MAX_PATH = 260;
        const tooLongPaths = filePaths.filter(p => p.length > MAX_PATH);
        if (tooLongPaths.length > 0) {
            const errorMsg = `The following paths exceed Windows MAX_PATH limit (${MAX_PATH} characters):\n${tooLongPaths.map(p => `  - ${p} (${p.length} chars)`).join('\n')
                }`;
            reject(new Error(errorMsg));
            return;
        }

        // Create temporary list file for file paths (to handle Cyrillic properly)
        // This is necessary because passing Cyrillic paths directly in command line causes encoding issues
        try {
            const timestamp = Date.now();
            listFilePath = path.join(os.tmpdir(), `archive_list_${timestamp}.txt`);

            // 7-Zip: Use UTF-8 with -scsUTF-8 switch for full Unicode support
            const listContent = filePaths.join('\r\n');
            fs.writeFileSync(listFilePath, listContent, 'utf8');
        } catch (error) {
            reject(new Error(`Failed to create list file: ${error.message}`));
            return;
        }

        // Check if archive path contains non-ASCII characters
        // If yes, create with temporary ASCII name and rename later
        const hasNonAscii = /[^\x00-\x7F]/.test(archivePath);
        if (hasNonAscii) {
            const archiveDir = path.dirname(archivePath);
            const archiveExt = path.extname(archivePath);
            tempArchivePath = path.join(archiveDir, `temp_archive_${Date.now()}${archiveExt}`);
            needsRename = true;
        } else {
            tempArchivePath = archivePath;
        }

        // Build format-specific commands
        if (archiverType === '7zip') {
            if (format === 'zip') {
                // 7-Zip command for ZIP format
                args = [
                    'a',                    // Add to archive
                    '-tzip',                // ZIP format
                    '-y',                   // Yes to all prompts
                    '-bsp1',                // Show progress (percentage)
                    '-bso1',                // Standard output
                    '-bse1',                // Error output
                    '-scsUTF-8'             // List file charset is UTF-8
                ];

                // Add password if provided
                if (password) {
                    args.push(`-p${password}`);
                    // Note: ZIP format does not support header encryption (-mhe)
                    // Only file content will be encrypted
                }

                // Add compression level if provided
                if (compression) {
                    args.push(`-mx=${compression}`);
                }

                // Add volume size if provided (multi-volume)
                if (volumeSize) {
                    args.push(`-v${volumeSize}m`);
                }

                args.push(tempArchivePath);     // Archive path (temporary if contains Cyrillic)
                args.push(`@${listFilePath}`); // Use list file for paths (handles Cyrillic)

            } else if (format === '7z') {
                // 7-Zip command for 7Z format
                args = [
                    'a',                    // Add to archive
                    '-y',                   // Yes to all prompts
                    '-bsp1',                // Show progress (percentage)
                    '-bso1',                // Standard output
                    '-bse1',                // Error output
                    '-scsUTF-8'             // List file charset is UTF-8
                ];

                // Add password if provided
                if (password) {
                    args.push(`-p${password}`);
                    args.push('-mhe=on');   // Encrypt headers (for 7z)
                }

                // Add compression level if provided
                if (compression) {
                    args.push(`-mx=${compression}`);
                }

                // Add volume size if provided (multi-volume)
                if (volumeSize) {
                    args.push(`-v${volumeSize}m`);
                }

                args.push(tempArchivePath);     // Archive path (temporary if contains Cyrillic)
                args.push(`@${listFilePath}`); // Use list file for paths (handles Cyrillic)

            } else {
                reject(new Error(`7-Zip does not support format: ${format}`));
                return;
            }
            command = archiverPath;
        } else {
            reject(new Error(`Unsupported archiver type: ${archiverType}. Only 7-Zip is supported.`));
            return;
        }

        onConsoleOutput(`🚀 Starting ${archiverType} archiver (${format.toUpperCase()} format)...`);

        // Log additional options
        if (password) {
            onConsoleOutput(`🔒 Password protection: enabled`);
        }
        if (volumeSize) {
            onConsoleOutput(`📦 Multi-volume: ${volumeSize} MB per volume`);
        }
        if (compression) {
            onConsoleOutput(`🗜️ Compression level: ${compression}`);
        }

        onConsoleOutput(`📦 Command: ${command} ${args.join(' ')}`);
        onProgress({ status: 'archiving', progress: 20 });

        const archiveProcess = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let filesProcessed = 0;
        let currentFile = '';

        // Parse stdout for progress
        archiveProcess.stdout.on('data', (data) => {
            // 7-Zip uses Windows ANSI encoding (CP1251) for console output
            const output = iconv.decode(data, 'cp1251');
            const lines = output.split('\n');

            lines.forEach(line => {
                if (!line.trim()) return;

                onConsoleOutput(line.trim());

                // Parse progress from 7-Zip output
                if (archiverType === '7zip') {
                    // 7-Zip outputs: "  5% - filename.ext"
                    const percentMatch = line.match(/(\d+)%/);
                    if (percentMatch) {
                        const percent = parseInt(percentMatch[1]);
                        onProgress({
                            status: 'archiving',
                            progress: 20 + (percent * 0.7), // 20-90%
                            currentFile: line.replace(/\d+%\s*-?\s*/, '').trim()
                        });
                    }

                    // Count files being added
                    if (line.includes('Compressing') || line.includes('Adding')) {
                        filesProcessed++;
                        onProgress({ filesProcessed });
                    }
                }


            });
        });

        // Parse stderr for errors
        archiveProcess.stderr.on('data', (data) => {
            // 7-Zip uses Windows ANSI encoding (CP1251) for console output
            const output = iconv.decode(data, 'cp1251');
            onConsoleOutput(`⚠️  ${output.trim()}`);
        });

        // Handle process completion
        archiveProcess.on('close', (code) => {
            // Clean up temporary list file
            if (listFilePath && fs.existsSync(listFilePath)) {
                try {
                    fs.unlinkSync(listFilePath);
                } catch (cleanupError) {
                    console.error('Failed to delete temporary list file:', cleanupError);
                }
            }

            if (code === 0) {
                onConsoleOutput('✅ Archive created successfully!');
                onProgress({ status: 'finalizing', progress: 95 });
            } else if (code === 1) {
                // Exit code 1 means warnings (non-fatal errors)
                // Archive was created but with some warnings (e.g., some files were locked)
                onConsoleOutput('⚠️  Archive created with warnings');
                onProgress({ status: 'finalizing', progress: 95 });
            }

            if (code === 0 || code === 1) {

                // Rename temporary archive to final name if needed
                if (needsRename) {
                    // Wait a bit for Windows to release file handles
                    // This is necessary because 7-Zip/WinRAR may still have the file locked
                    setTimeout(() => {
                        try {
                            onConsoleOutput(`📝 Renaming archive to final name...`);

                            const tempExt = path.extname(tempArchivePath);
                            const tempBase = path.basename(tempArchivePath, tempExt);
                            const tempDir = path.dirname(tempArchivePath);

                            const finalExt = path.extname(archivePath);
                            const finalBase = path.basename(archivePath, finalExt);
                            const finalDir = path.dirname(archivePath);

                            // Find all files related to this archive (main file + volumes)
                            const files = fs.readdirSync(tempDir);
                            let renamedCount = 0;

                            // Pattern for main archive file
                            const mainPattern = new RegExp(`^${tempBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${tempExt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

                            // Pattern for volume files (.001, .002, .zip.001, etc.)
                            const volumePattern1 = new RegExp(`^${tempBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.\\d{3}$`);
                            const volumePattern2 = new RegExp(`^${tempBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${tempExt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.\\d{3}$`);

                            files.forEach(file => {
                                let oldPath, newPath;

                                // Check if it's the main archive file
                                if (mainPattern.test(file)) {
                                    oldPath = path.join(tempDir, file);
                                    newPath = archivePath;
                                    fs.renameSync(oldPath, newPath);
                                    renamedCount++;
                                }
                                // Check if it's a volume file (format: name.001, name.002)
                                else if (volumePattern1.test(file)) {
                                    const volumeNum = file.match(/\.(\d{3})$/)[1];
                                    oldPath = path.join(tempDir, file);
                                    newPath = path.join(finalDir, `${finalBase}.${volumeNum}`);
                                    fs.renameSync(oldPath, newPath);
                                    renamedCount++;
                                }
                                // Check if it's a volume file (format: name.zip.001, name.zip.002)
                                else if (volumePattern2.test(file)) {
                                    const volumeNum = file.match(/\.(\d{3})$/)[1];
                                    oldPath = path.join(tempDir, file);
                                    newPath = path.join(finalDir, `${finalBase}${finalExt}.${volumeNum}`);
                                    fs.renameSync(oldPath, newPath);
                                    renamedCount++;
                                }
                            });

                            if (renamedCount > 0) {
                                onConsoleOutput(`✅ Renamed ${renamedCount} file(s) successfully`);
                            } else {
                                onConsoleOutput(`⚠️  No files found to rename`);
                            }
                        } catch (renameError) {
                            onConsoleOutput(`⚠️  Failed to rename archive: ${renameError.message}`);
                            // Continue anyway, archive was created successfully
                        }

                        // Get archive stats after rename
                        try {
                            const stats = fs.statSync(archivePath);
                            onConsoleOutput(`📊 Archive size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
                            onProgress({ status: 'completed', progress: 100 });

                            resolve({
                                success: true,
                                archivePath,
                                archiveSize: stats.size,
                                filesProcessed,
                                warnings: code === 1
                            });
                        } catch (error) {
                            onConsoleOutput(`⚠️  Could not get archive stats: ${error.message}`);
                            onProgress({ status: 'completed', progress: 100 });

                            resolve({
                                success: true,
                                archivePath,
                                filesProcessed,
                                warnings: code === 1
                            });
                        }
                    }, 500); // Wait 500ms for file handles to be released
                } else {
                    // No rename needed, get stats immediately
                    try {
                        const stats = fs.statSync(archivePath);
                        onConsoleOutput(`📊 Archive size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
                        onProgress({ status: 'completed', progress: 100 });

                        resolve({
                            success: true,
                            archivePath,
                            archiveSize: stats.size,
                            filesProcessed,
                            warnings: code === 1
                        });
                    } catch (error) {
                        onConsoleOutput(`⚠️  Could not get archive stats: ${error.message}`);
                        onProgress({ status: 'completed', progress: 100 });

                        resolve({
                            success: true,
                            archivePath,
                            filesProcessed,
                            warnings: code === 1
                        });
                    }
                }
            } else {
                // Clean up temporary archive if it exists
                if (needsRename && tempArchivePath && fs.existsSync(tempArchivePath)) {
                    try {
                        fs.unlinkSync(tempArchivePath);
                    } catch (cleanupError) {
                        console.error('Failed to delete temporary archive:', cleanupError);
                    }
                }

                onConsoleOutput(`❌ Archive creation failed with code ${code}`);
                onProgress({ status: 'failed', progress: 0 });

                reject(new Error(`Archiver exited with code ${code}`));
            }
        });

        // Handle process errors
        archiveProcess.on('error', (error) => {
            // Clean up temporary list file
            if (listFilePath && fs.existsSync(listFilePath)) {
                try {
                    fs.unlinkSync(listFilePath);
                } catch (cleanupError) {
                    console.error('Failed to delete temporary list file:', cleanupError);
                }
            }

            // Clean up temporary archive if it exists
            if (needsRename && tempArchivePath && fs.existsSync(tempArchivePath)) {
                try {
                    fs.unlinkSync(tempArchivePath);
                } catch (cleanupError) {
                    console.error('Failed to delete temporary archive:', cleanupError);
                }
            }

            onConsoleOutput(`❌ Process error: ${error.message}`);
            onProgress({ status: 'failed', progress: 0 });
            reject(error);
        });
    });
}

module.exports = {
    createArchiveWithProgress
};
