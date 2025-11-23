// Quick script to check database contents
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./filestash.db');

console.log('=== Database Check Script ===\n');

// Check for Test Data entries
console.log('1. Checking for "Test Data" entries...\n');
db.all("SELECT id, full_path, filename, is_directory, is_dummy FROM files WHERE full_path LIKE '%Test Data%' ORDER BY full_path", [], (err, rows) => {
    if (err) {
        console.error('Error:', err);
        db.close();
        return;
    }
    
    console.log(`Found ${rows.length} entries with "Test Data":\n`);
    rows.forEach(row => {
        console.log(`  ID: ${row.id}`);
        console.log(`  Path: ${row.full_path}`);
        console.log(`  Filename: ${row.filename}`);
        console.log(`  Is Directory: ${row.is_directory ? 'YES' : 'NO'}`);
        console.log(`  Is Dummy: ${row.is_dummy ? 'YES' : 'NO'}`);
        console.log('  ---');
    });
    
    // Check total counts
    console.log('\n2. Database statistics:\n');
    db.get("SELECT COUNT(*) as total, SUM(is_directory) as dirs, SUM(CASE WHEN is_directory = 0 THEN 1 ELSE 0 END) as files, SUM(is_dummy) as dummies FROM files", [], (err, stats) => {
        if (err) {
            console.error('Error:', err);
            db.close();
            return;
        }
        
        console.log(`  Total entries: ${stats.total}`);
        console.log(`  Directories: ${stats.dirs || 0}`);
        console.log(`  Files: ${stats.files || 0}`);
        console.log(`  Dummy files: ${stats.dummies || 0}`);
        
        // Check P: drive entries
        console.log('\n3. All P: drive entries:\n');
        db.all("SELECT id, full_path, filename, is_directory, is_dummy FROM files WHERE full_path LIKE 'P:%' ORDER BY full_path LIMIT 20", [], (err, pRows) => {
            if (err) {
                console.error('Error:', err);
                db.close();
                return;
            }
            
            console.log(`  Found ${pRows.length} entries on P: drive (showing first 20):\n`);
            pRows.forEach(row => {
                const type = row.is_directory ? '[DIR]' : '[FILE]';
                const dummy = row.is_dummy ? '[DUMMY]' : '';
                console.log(`  ${type} ${dummy} ${row.full_path}`);
            });
            
            db.close();
            console.log('\n=== Check Complete ===');
        });
    });
});
