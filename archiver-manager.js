const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Archiver Manager
 * Handles detection, path resolution, and format mapping for archive tools
 */
class ArchiverManager {
    constructor(options = {}) {
        this.baseDir = options.baseDir || __dirname;
        this.cache = null;
        this.config = {
            '7zip': {
                localPath: path.join(this.baseDir, 'bin', '7zip', '7z.exe'),
                systemPaths: [
                    '7z',
                    'C:\\Program Files\\7-Zip\\7z.exe',
                    'C:\\Program Files (x86)\\7-Zip\\7z.exe'
                ],
                formats: ['zip', '7z']
            }
        };
    }

    /**
     * Detect and cache available archivers
     * Priority: local archivers first, then system archivers
     */
    async detectArchivers() {
        if (this.cache) {
            return this.cache;
        }

        const archiverInfo = {
            archivers: {},
            formats: {}
        };

        // Check 7-Zip (only supported archiver)
        const sevenZipPath = this._findArchiver('7zip');
        if (sevenZipPath) {
            archiverInfo.archivers['7zip'] = {
                path: sevenZipPath.path,
                type: sevenZipPath.type,
                formats: this.config['7zip'].formats
            };
            // Map formats to archiver
            this.config['7zip'].formats.forEach(format => {
                archiverInfo.formats[format] = '7zip';
            });
        }

        this.cache = archiverInfo;
        return archiverInfo;
    }

    /**
     * Find archiver executable
     * Checks local path first, then system paths
     */
    _findArchiver(archiverName) {
        const config = this.config[archiverName];
        if (!config) {
            return null;
        }

        // Check local path first (priority)
        if (fs.existsSync(config.localPath)) {
            return {
                path: config.localPath,
                type: 'local',
                archiver: archiverName
            };
        }

        // Check system paths
        for (const systemPath of config.systemPaths) {
            if (this._checkSystemPath(systemPath)) {
                return {
                    path: systemPath,
                    type: 'system',
                    archiver: archiverName
                };
            }
        }

        return null;
    }

    /**
     * Check if a system path exists and is executable
     */
    _checkSystemPath(commandPath) {
        // If it's an absolute path, check if file exists
        if (path.isAbsolute(commandPath)) {
            return fs.existsSync(commandPath);
        }

        // If it's a command name, try to execute it
        try {
            execSync(`where ${commandPath}`, { stdio: 'ignore' });
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get archiver path for specific format
     */
    async getArchiverForFormat(format) {
        const info = await this.detectArchivers();
        
        const archiverName = info.formats[format];
        if (!archiverName) {
            return null;
        }

        const archiver = info.archivers[archiverName];
        if (!archiver) {
            return null;
        }

        return {
            path: archiver.path,
            type: archiver.type,
            archiver: archiverName
        };
    }

    /**
     * Get all supported formats
     */
    async getSupportedFormats() {
        const info = await this.detectArchivers();
        return Object.keys(info.formats);
    }

    /**
     * Get detailed archiver information
     */
    async getArchiverInfo() {
        return await this.detectArchivers();
    }

    /**
     * Refresh archiver detection (clear cache)
     */
    async refresh() {
        this.cache = null;
        return await this.detectArchivers();
    }

    /**
     * Log detected archivers to console
     */
    async logDetectedArchivers() {
        const info = await this.detectArchivers();
        
        console.log('📦 Archiver Detection:');
        
        if (info.archivers['7zip']) {
            const icon = info.archivers['7zip'].type === 'local' ? '✅' : '✓';
            const location = info.archivers['7zip'].type === 'local' 
                ? `Local (${path.relative(this.baseDir, info.archivers['7zip'].path)})`
                : 'System';
            console.log(`   7-Zip: ${icon} ${location}`);
        } else {
            console.log('   7-Zip: ❌ Not found');
        }

        const supportedFormats = await this.getSupportedFormats();
        if (supportedFormats.length > 0) {
            console.log(`   Supported formats: ${supportedFormats.join(', ')}`);
        } else {
            console.log('   ⚠️  No archivers available - archive creation will not work');
        }
    }
}

module.exports = ArchiverManager;
