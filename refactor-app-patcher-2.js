/**
 * Патчер для создания остальных модулей app.js
 * Часть 2: scan-manager, archive-manager, file-operations
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Создание остальных модулей для app.js...\n');

const jsDir = path.join(__dirname, 'public', 'js');

// ==================== МОДУЛЬ 4: scan-manager.js ====================
console.log('📦 Создание модуля: public/js/scan-manager.js');

const scanManagerContent = `/**
 * Scan Manager Module
 * Управление сканированием
 */

let currentScanId = null;

// Perform scan
async function performScan() {
    if (selectedDirectories.size === 0) {
        showMessage('Выберите папки для сканирования', 'error');
        return;
    }
    
    const threadCount = parseInt(document.getElementById('scan-thread-count').value) || 8;
    const recursiveScan = document.getElementById('scan-recursive-checkbox').checked;
    const calculateCrc32 = document.getElementById('scan-calculate-crc32').checked;
    
    const scanBtn = document.getElementById('scan-btn');
    scanBtn.disabled = true;
    scanBtn.textContent = 'Сканирование...';
    
    showProgressModal('Пакетное сканирование', 'Инициализация сканирования...');
    
    try {
        const pathsArray = Array.from(selectedDirectories);
        updateProgress(0, \`Сканирование \${pathsArray.length} папок...\`);
        
        const pathsWithRecursion = pathsArray.map(parentPath => {
            return {
                path: parentPath,
                recursive: recursiveScan
            };
        });
        
        const result = await apiCall('/scan-multiple', { 
            method: 'POST',
            body: JSON.stringify({ 
                paths: pathsWithRecursion,
                threads: threadCount,
                calculateCrc32: calculateCrc32
            })
        });
        
        if (result.scanId) {
            currentScanId = result.scanId;
            const stopBtn = document.getElementById('stop-scan-btn');
            if (stopBtn) stopBtn.style.display = 'inline-block';
            
            const finalProgress = await monitorScanProgress(result.scanId);
            
            if (finalProgress && finalProgress.duration) {
                const scanTime = formatScanTime(Math.round(finalProgress.duration / 1000));
                const scanMode = recursiveScan ? 'рекурсивно' : 'только верхний уровень';
                
                if (finalProgress.status === 'cancelled') {
                    showMessage(\`Сканирование остановлено: обработано \${finalProgress.processed}/\${finalProgress.total} файлов за \${scanTime}\`, 'warning');
                } else {
                    showMessage(\`Сканирование завершено (\${scanMode}): \${pathsArray.length} папок обработано за \${scanTime}\`, 'success');
                }
                
                const lastScanTime = document.getElementById('last-scan-time');
                if (lastScanTime) lastScanTime.textContent = scanTime;
            }
        }
        
        closeProgressModal();
        if (typeof loadStats === 'function') loadStats();
        
    } catch (error) {
        closeProgressModal();
        showMessage('Ошибка сканирования: ' + error.message, 'error');
    }
    
    scanBtn.disabled = false;
    scanBtn.textContent = 'Сканировать';
}

// Monitor scan progress
async function monitorScanProgress(scanId) {
    return new Promise((resolve) => {
        const checkProgress = async () => {
            try {
                const progress = await apiCall(\`/scan/progress/\${scanId}\`);
                
                if (progress.total > 0) {
                    const percentage = Math.round((progress.processed / progress.total) * 100);
                    const currentTime = Date.now();
                    const elapsedTime = Math.round((currentTime - progress.startTime) / 1000);
                    const timeText = formatScanTime(elapsedTime);
                    
                    const itemsPerSecond = elapsedTime > 0 ? Math.round(progress.processed / elapsedTime) : 0;
                    const speedText = itemsPerSecond > 0 ? \` | Скорость: \${itemsPerSecond} файлов/сек\` : '';
                    
                    const remaining = progress.total - progress.processed;
                    const etaSeconds = itemsPerSecond > 0 ? Math.round(remaining / itemsPerSecond) : 0;
                    const etaText = etaSeconds > 0 && etaSeconds < 3600 ? \` | Осталось: ~\${formatScanTime(etaSeconds)}\` : '';
                    
                    updateProgress(percentage, \`Обработано: \${progress.processed}/\${progress.total} файлов | Время: \${timeText}\${speedText}\${etaText}\`);
                }
                
                if (progress.status === 'completed' || progress.status === 'error' || progress.status === 'cancelled') {
                    const stopBtn = document.getElementById('stop-scan-btn');
                    if (stopBtn) stopBtn.style.display = 'none';
                    currentScanId = null;
                    
                    if (progress.duration) {
                        const finalTime = formatScanTime(Math.round(progress.duration / 1000));
                        if (progress.status === 'cancelled') {
                            updateProgress(Math.round((progress.processed / progress.total) * 100), \`Сканирование остановлено за \${finalTime}\`);
                        } else {
                            updateProgress(100, \`Завершено за \${finalTime}\`);
                        }
                    }
                    resolve(progress);
                } else {
                    setTimeout(checkProgress, 1000);
                }
            } catch (error) {
                console.error('Progress check error:', error);
                resolve();
            }
        };
        
        checkProgress();
    });
}

// Stop scanning
async function stopScanning() {
    if (!currentScanId) {
        showMessage('Нет активного сканирования для остановки', 'error');
        return;
    }
    
    try {
        const stopBtn = document.getElementById('stop-scan-btn');
        if (stopBtn) {
            stopBtn.disabled = true;
            stopBtn.textContent = '⏳ Остановка...';
        }
        
        await apiCall(\`/scan/stop/\${currentScanId}\`, { method: 'POST' });
        showMessage('Запрос на остановку сканирования отправлен...', 'info');
        
    } catch (error) {
        showMessage('Ошибка при остановке: ' + error.message, 'error');
        
        const stopBtn = document.getElementById('stop-scan-btn');
        if (stopBtn) {
            stopBtn.disabled = false;
            stopBtn.textContent = '⏹️ Остановить';
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        performScan,
        monitorScanProgress,
        stopScanning,
        currentScanId
    };
}
`;

fs.writeFileSync(path.join(jsDir, 'scan-manager.js'), scanManagerContent);
console.log('   ✅ Создан: public/js/scan-manager.js\n');

// ==================== МОДУЛЬ 5: archive-manager.js ====================
console.log('📦 Создание модуля: public/js/archive-manager.js');

const archiveManagerContent = `/**
 * Archive Manager Module  
 * Управление созданием архивов
 */

// Show archive modal
async function showArchiveModal(selectedFiles) {
    const modal = document.getElementById('archive-modal');
    if (!modal) return;
    
    const archiveName = document.getElementById('archive-name');
    const destination = document.getElementById('archive-destination');
    
    // Generate archive name
    let baseName;
    if (selectedFiles.length === 1) {
        const pathParts = selectedFiles[0].path.split(/[\\\\\\/]/).filter(part => part.length > 0);
        baseName = pathParts[pathParts.length - 1].replace(/\\.[^/.]+$/, "");
    } else {
        baseName = "Files";
    }
    
    baseName = baseName.replace(/[<>:"/\\\\|?*]/g, '_');
    
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const dateStr = \`\${day}.\${month}.\${year}\`;
    
    if (archiveName) archiveName.value = \`\${baseName}(\${dateStr})\`;
    if (destination) destination.value = 'C:\\\\FileStash-Archives';
    
    // Fetch and populate available formats
    try {
        const archiverInfo = await apiCall('/archivers');
        populateFormatDropdown(archiverInfo);
    } catch (error) {
        console.error('Failed to load archiver info:', error);
    }
    
    modal.style.display = 'block';
}

// Populate format dropdown
function populateFormatDropdown(archiverInfo) {
    const formatSelect = document.getElementById('archive-format');
    if (!formatSelect) return;
    
    formatSelect.innerHTML = '';
    
    const formatLabels = {
        'zip': 'ZIP (7-Zip)',
        'rar': 'RAR (WinRAR)',
        '7z': '7Z (7-Zip)'
    };
    
    const formatOrder = ['7z', 'zip', 'rar'];
    
    if (!archiverInfo.supportedFormats || archiverInfo.supportedFormats.length === 0) {
        formatSelect.innerHTML = '<option value="">Нет доступных архиваторов</option>';
        formatSelect.disabled = true;
        return;
    }
    
    formatSelect.disabled = false;
    
    formatOrder.forEach(format => {
        if (archiverInfo.supportedFormats.includes(format)) {
            const option = document.createElement('option');
            option.value = format;
            option.textContent = formatLabels[format] || format.toUpperCase();
            formatSelect.appendChild(option);
        }
    });
    
    if (archiverInfo.supportedFormats.length > 0) {
        formatSelect.value = formatOrder.find(f => archiverInfo.supportedFormats.includes(f)) || archiverInfo.supportedFormats[0];
    }
}

// Close archive modal
function closeArchiveModal() {
    const modal = document.getElementById('archive-modal');
    if (modal) modal.style.display = 'none';
}

// Create archive
async function createArchive() {
    const destination = document.getElementById('archive-destination').value;
    let archiveName = document.getElementById('archive-name').value;
    const password = document.getElementById('archive-password').value;
    const compression = document.getElementById('archive-compression').value;
    const format = document.getElementById('archive-format').value;
    
    if (!destination || !archiveName || !format) {
        showMessage('Заполните все обязательные поля', 'error');
        return;
    }
    
    if (selectedTreeFiles.size === 0) {
        showMessage('Нет выбранных файлов для архивации', 'error');
        return;
    }
    
    archiveName = archiveName.replace(/\\.(zip|rar|7z)$/i, '');
    archiveName = \`\${archiveName}.\${format}\`;
    
    closeArchiveModal();
    showArchiveProgressModal();
    
    try {
        const fileIds = await getFilesForSelectedPaths();
        
        if (fileIds.length === 0) {
            updateArchiveProgress(0, 'Нет файлов для архивации');
            return;
        }
        
        const startResult = await apiCall('/files/archive', {
            method: 'POST',
            body: JSON.stringify({
                fileIds: fileIds,
                archiveName: archiveName,
                destinationPath: destination,
                format: format,
                password: password || undefined,
                compression: compression
            })
        });
        
        appendArchiveLog(\`📦 Архивация запущена (ID: \${startResult.archiveId})\`);
        
        // Monitor progress using EventSource
        monitorArchiveProgress(startResult.archiveId);
        
    } catch (error) {
        updateArchiveProgress(0, 'Ошибка создания архива');
        appendArchiveLog(\`❌ Ошибка: \${error.message}\`);
        showMessage('Ошибка создания архива', 'error');
    }
}

// Show archive progress modal
function showArchiveProgressModal() {
    const modal = document.getElementById('archive-progress-modal');
    if (modal) {
        const log = document.getElementById('archive-log');
        if (log) log.innerHTML = '';
        updateArchiveProgress(0, 'Инициализация...');
        modal.style.display = 'block';
    }
}

// Update archive progress
function updateArchiveProgress(percentage, status) {
    const progressFill = document.getElementById('archive-progress-fill');
    const progressStatus = document.getElementById('archive-progress-status');
    
    if (progressFill) {
        progressFill.style.width = percentage + '%';
        progressFill.textContent = percentage + '%';
    }
    
    if (progressStatus) {
        progressStatus.textContent = status;
    }
}

// Append to archive log
function appendArchiveLog(message) {
    const log = document.getElementById('archive-log');
    if (log) {
        const timestamp = new Date().toLocaleTimeString();
        log.textContent += \`[\${timestamp}] \${message}\\n\`;
        log.scrollTop = log.scrollHeight;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        showArchiveModal,
        closeArchiveModal,
        createArchive,
        showArchiveProgressModal,
        updateArchiveProgress,
        appendArchiveLog
    };
}
`;

fs.writeFileSync(path.join(jsDir, 'archive-manager.js'), archiveManagerContent);
console.log('   ✅ Создан: public/js/archive-manager.js\n');

console.log('✅ Все модули успешно созданы!\n');
console.log('📝 Следующий шаг: обновление app.js и index.html\n');
