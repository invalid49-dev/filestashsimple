#!/usr/bin/env node

// Enhanced startup script for FileStash Simple
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🚀 FileStash Simple - Enhanced Startup');
console.log('=====================================\n');

// Check if we're in the right directory
if (!fs.existsSync('package.json')) {
    console.error('❌ Error: package.json not found');
    console.error('Please run this script from the filestash-simple directory');
    process.exit(1);
}

// Check if node_modules exists
if (!fs.existsSync('node_modules')) {
    console.log('📦 Installing dependencies...');
    const install = spawn('npm', ['install'], { stdio: 'inherit' });
    
    install.on('close', (code) => {
        if (code !== 0) {
            console.error('❌ Failed to install dependencies');
            process.exit(1);
        }
        console.log('✅ Dependencies installed successfully\n');
        startServer();
    });
} else {
    startServer();
}

function startServer() {
    console.log('🔍 Starting server with automatic port detection...');
    console.log('🌐 Browser will open automatically when ready\n');
    
    // Start the server
    const server = spawn('node', ['server.js'], { stdio: 'inherit' });
    
    server.on('error', (err) => {
        console.error('❌ Failed to start server:', err.message);
        process.exit(1);
    });
    
    server.on('close', (code) => {
        if (code !== 0) {
            console.log(`\n⚠️  Server exited with code ${code}`);
        } else {
            console.log('\n✅ Server stopped gracefully');
        }
    });
    
    // Handle Ctrl+C
    process.on('SIGINT', () => {
        console.log('\n🛑 Stopping server...');
        server.kill('SIGINT');
    });
}