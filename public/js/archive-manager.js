/**
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
        const pathParts = selectedFiles[0].path.split(/[\\\/]/).filter(part => part.length > 0);
        baseName = pathParts[pathParts.length - 1].replace(/\.[^/.]+$/, "");
    } else {
        baseName = "Files";
    }
    
    baseName = baseName.replace(/[<>:"/\\|?*]/g, '_');
    
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const dateStr = `${day}.${month}.${year}`;
    
    if (archiveName) archiveName.value = `${baseName}(${dateStr})`;
    if (destination) destination.value = 'C:\\FileStash-Archives';
    
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
    
    archiveName = archiveName.replace(/\.(zip|rar|7z)$/i, '');
    archiveName = `${archiveName}.${format}`;
    
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
        
        appendArchiveLog(`📦 Архивация запущена (ID: ${startResult.archiveId})`);
        
        // Monitor progress using EventSource
        monitorArchiveProgress(startResult.archiveId);
        
    } catch (error) {
        updateArchiveProgress(0, 'Ошибка создания архива');
        appendArchiveLog(`❌ Ошибка: ${error.message}`);
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
        log.textContent += `[${timestamp}] ${message}\n`;
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
