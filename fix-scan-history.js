const fs = require('fs');
const path = require('path');

const SCAN_HISTORY_FILE = './scan-history.json';

console.log('🔧 Fixing scan history file...\n');

try {
    // Read current history
    if (!fs.existsSync(SCAN_HISTORY_FILE)) {
        console.log('ℹ️  No scan history file found. Nothing to fix.');
        process.exit(0);
    }

    const historyData = JSON.parse(fs.readFileSync(SCAN_HISTORY_FILE, 'utf8'));
    
    if (!historyData.scans || !Array.isArray(historyData.scans)) {
        console.log('⚠️  Invalid history file format.');
        process.exit(1);
    }

    console.log(`📊 Found ${historyData.scans.length} scan records\n`);

    let fixedCount = 0;

    // Fix each scan record
    historyData.scans = historyData.scans.map(scan => {
        // Normalize paths to array of strings
        if (scan.paths) {
            const originalPaths = JSON.stringify(scan.paths);
            
            if (Array.isArray(scan.paths)) {
                // Convert objects to strings
                scan.paths = scan.paths.map(p => {
                    if (typeof p === 'string') {
                        return p;
                    } else if (typeof p === 'object' && p.path) {
                        fixedCount++;
                        return p.path;
                    } else {
                        fixedCount++;
                        return String(p);
                    }
                });
            } else {
                // Convert single value to array
                fixedCount++;
                scan.paths = [String(scan.paths)];
            }

            const newPaths = JSON.stringify(scan.paths);
            if (originalPaths !== newPaths) {
                console.log(`✅ Fixed scan ${scan.id}:`);
                console.log(`   Before: ${originalPaths}`);
                console.log(`   After:  ${newPaths}\n`);
            }
        }

        return scan;
    });

    // Write back to file
    fs.writeFileSync(SCAN_HISTORY_FILE, JSON.stringify(historyData, null, 2));

    console.log(`\n✨ Done! Fixed ${fixedCount} path entries.`);
    console.log(`📁 Updated file: ${SCAN_HISTORY_FILE}`);

} catch (error) {
    console.error('❌ Error fixing scan history:', error.message);
    process.exit(1);
}
