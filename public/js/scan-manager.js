/**
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
        updateProgress(0, `Сканирование ${pathsArray.length} папок...`);
        
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
                    showMessage(`Сканирование остановлено: обработано ${finalProgress.processed}/${finalProgress.total} файлов за ${scanTime}`, 'warning');
                } else {
                    showMessage(`Сканирование завершено (${scanMode}): ${pathsArray.length} папок обработано за ${scanTime}`, 'success');
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
                const progress = await apiCall(`/scan/progress/${scanId}`);
                
                if (progress.total > 0) {
                    const percentage = Math.round((progress.processed / progress.total) * 100);
                    const currentTime = Date.now();
                    const elapsedTime = Math.round((currentTime - progress.startTime) / 1000);
                    const timeText = formatScanTime(elapsedTime);
                    
                    const itemsPerSecond = elapsedTime > 0 ? Math.round(progress.processed / elapsedTime) : 0;
                    const speedText = itemsPerSecond > 0 ? ` | Скорость: ${itemsPerSecond} файлов/сек` : '';
                    
                    const remaining = progress.total - progress.processed;
                    const etaSeconds = itemsPerSecond > 0 ? Math.round(remaining / itemsPerSecond) : 0;
                    const etaText = etaSeconds > 0 && etaSeconds < 3600 ? ` | Осталось: ~${formatScanTime(etaSeconds)}` : '';
                    
                    updateProgress(percentage, `Обработано: ${progress.processed}/${progress.total} файлов | Время: ${timeText}${speedText}${etaText}`);
                }
                
                if (progress.status === 'completed' || progress.status === 'error' || progress.status === 'cancelled') {
                    const stopBtn = document.getElementById('stop-scan-btn');
                    if (stopBtn) stopBtn.style.display = 'none';
                    currentScanId = null;
                    
                    if (progress.duration) {
                        const finalTime = formatScanTime(Math.round(progress.duration / 1000));
                        if (progress.status === 'cancelled') {
                            updateProgress(Math.round((progress.processed / progress.total) * 100), `Сканирование остановлено за ${finalTime}`);
                        } else {
                            updateProgress(100, `Завершено за ${finalTime}`);
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
        
        await apiCall(`/scan/stop/${currentScanId}`, { method: 'POST' });
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
