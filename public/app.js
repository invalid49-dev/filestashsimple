// FileStash Simple - Client-side JavaScript

// Global state
let currentPage = 1;
let pageSize = 50;
let totalFiles = 0;
let currentSearch = '';
let directoryTree = [];
let selectedDirectories = new Set();
let selectedFiles = new Set();
let currentFiles = [];
let currentOperation = null;
let availableArchivers = [];
let fileBrowserData = [];
let selectedDestinationPath = '';
let currentBrowserPath = 'drives';
// let currentScanId = null;
 // MOVED TO: scan-manager.js

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 FileStash Simple initialized');
    loadDrives();
    loadStats();

    
    // Initialize tree keyboard navigation
    addTreeKeyboardNavigation();
    
    // Global click handler to hide context menu
    document.addEventListener('click', function(event) {
        const contextMenu = document.getElementById('tree-context-menu');
        if (contextMenu && !contextMenu.contains(event.target)) {
            hideContextMenu();
        }
    });
});

// Tab management
function showTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Update tab buttons (both old and new styles)
    document.querySelectorAll('.tab, .tab-btn').forEach(tab => {
        tab.classList.remove('active');
        tab.setAttribute('aria-selected', 'false');
    });
    
    // Show selected tab
    const tabContent = document.getElementById(tabName + '-tab');
    if (tabContent) {
        tabContent.classList.add('active');
    }
    
    // Update active tab button
    const tabButton = document.getElementById('tab-' + tabName) || event.target;
    if (tabButton) {
        tabButton.classList.add('active');
        tabButton.setAttribute('aria-selected', 'true');
    }
    
    // Announce to screen reader
    if (window.accessibilityManager) {
        const tabNames = {
            'scan': 'Сканирование',
            'search': 'База данных',
            'history': 'История сканирования',
            'settings': 'Настройки'
        };
        accessibilityManager.announceToScreenReader(`Открыта вкладка: ${tabNames[tabName] || tabName}`);
    }
    
    // Load data for specific tabs
    if (tabName === 'history') {
        loadScanHistory();
    } else if (tabName === 'search') {
        // Load tree view for database tab
        loadFileTree();
    }
}

// API helper functions
async function apiCall(endpoint, options = {}) {
    console.log('API Call:', endpoint, options);
    
    try {
        const response = await fetch(`/api${endpoint}`, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });
        
        console.log('API Response status:', response.status);
        
        if (!response.ok) {
            let errorData;
            try {
                errorData = await response.json();
                
                // For validation errors, throw the full error object as JSON string
                if (errorData.code === 'INVALID_DESTINATION' && errorData.suggestions) {
                    throw new Error(JSON.stringify(errorData));
                }
                
                throw new Error(errorData.error || `HTTP ${response.status}`);
            } catch (e) {
                if (e.message.startsWith('{')) {
                    // Re-throw JSON errors as-is
                    throw e;
                }
                throw new Error(`HTTP ${response.status} - ${response.statusText}`);
            }
        }
        
        const result = await response.json();
        console.log('API Response data:', result);
        return result;
    } catch (error) {
        console.error('API Error:', error);
        showMessage(error.message, 'error');
        throw error;
    }
}

// Message display
function showMessage(message, type = 'info') {
    const statusDiv = document.getElementById('scan-status');
    statusDiv.innerHTML = `<div class="${type}">${message}</div>`;
    
    // Auto-hide success/error messages
    if (type === 'success' || type === 'error') {
        setTimeout(() => {
            statusDiv.innerHTML = '';
        }, 5000);
    }
}

// Format bytes to human readable
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Format date
function formatDate(dateString) {
    if (!dateString) return '';
    return new Date(dateString).toLocaleString('ru-RU');
}

// Format scan time
function formatScanTime(seconds) {
    if (seconds < 60) {
        return `${seconds} сек`;
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes} мин ${remainingSeconds} сек`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;
        return `${hours} ч ${minutes} мин ${remainingSeconds} сек`;
    }
}

// Load available drives
async function loadDrives() {
    try {
        const data = await apiCall('/drives');
        const select = document.getElementById('drive-select');
        select.innerHTML = '';
        
        data.drives.forEach(drive => {
            const option = document.createElement('option');
            option.value = drive;
            option.textContent = drive;
            select.appendChild(option);
        });
        
        if (data.drives.length > 0) {
            document.getElementById('path-input').value = data.drives[0];
        }
    } catch (error) {
        console.error('Failed to load drives:', error);
    }
}

// Handle drive change
function onDriveChange() {
    const select = document.getElementById('drive-select');
    document.getElementById('path-input').value = select.value;
}

// Browse directories
async function browseDirectories() {
    const path = document.getElementById('path-input').value.trim();
    if (!path) {
        showMessage('Пожалуйста, введите путь к папке', 'error');
        return;
    }
    
    showMessage('Загрузка папок...', 'info');
    
    try {
        const data = await apiCall(`/browse?path=${encodeURIComponent(path)}`);
        displayDirectoryTree(data.directories);
        showMessage(`Загружено ${data.directories.length} папок`, 'success');
    } catch (error) {
        document.getElementById('directory-tree').innerHTML = '<div class="loading">Ошибка загрузки папок</div>';
    }
}

// Display directory tree
function displayDirectoryTree(directories) {
    directoryTree = directories.map(dir => ({
        ...dir,
        expanded: false,
        children: [],
        selected: false
    }));
    
    renderDirectoryTreeWithStatus();
}

// Render directory tree
function renderDirectoryTree() {
    const container = document.getElementById('directory-tree');
    
    if (directoryTree.length === 0) {
        container.innerHTML = '<div class="loading">Папки не найдены</div>';
        return;
    }
    
    container.innerHTML = '';
    directoryTree.forEach(dir => {
        container.appendChild(createTreeItem(dir));
    });
    
    updateSelectedCount();
}

// Create tree item element
function createTreeItem(dir, level = 0) {
    const item = document.createElement('div');
    item.className = 'tree-item';
    item.style.marginLeft = (level * 20) + 'px';
    
    const header = document.createElement('div');
    header.className = 'tree-item-header';
    
    // Expand icon
    const expandIcon = document.createElement('div');
    expandIcon.className = 'expand-icon';
    expandIcon.innerHTML = dir.expanded ? '📂' : '📁';
    expandIcon.onclick = () => toggleDirectory(dir);
    
    // Checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = dir.selected;
    checkbox.onchange = () => toggleSelection(dir);
    
    // Folder icon and name
    const folderIcon = document.createElement('span');
    folderIcon.className = 'folder-icon';
    folderIcon.innerHTML = '📁';
    
    const folderName = document.createElement('span');
    folderName.className = 'folder-name';
    folderName.textContent = dir.name;
    folderName.onclick = () => toggleDirectory(dir);
    
    header.appendChild(expandIcon);
    header.appendChild(checkbox);
    header.appendChild(folderIcon);
    header.appendChild(folderName);
    
    item.appendChild(header);
    
    // Children container
    if (dir.expanded && dir.children.length > 0) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'tree-children';
        
        dir.children.forEach(child => {
            childrenContainer.appendChild(createTreeItem(child, level + 1));
        });
        
        item.appendChild(childrenContainer);
    }
    
    return item;
}

// Toggle directory expansion
async function toggleDirectory(dir) {
    console.log('Toggling directory:', dir.name);
    
    dir.expanded = !dir.expanded;
    
    // Load children if expanding and not loaded yet
    if (dir.expanded && dir.children.length === 0) {
        try {
            showMessage(`Загрузка подпапок для ${dir.name}...`, 'info');
            const data = await apiCall(`/browse?path=${encodeURIComponent(dir.path)}`);
            
            dir.children = data.directories.map(child => ({
                ...child,
                expanded: false,
                children: [],
                selected: false
            }));
            
            showMessage(`Загружено ${dir.children.length} подпапок`, 'success');
        } catch (error) {
            dir.children = [];
            dir.expanded = false;
        }
    }
    
    renderDirectoryTreeWithStatus();
}

// Toggle directory selection
function toggleSelection(dir) {
    dir.selected = !dir.selected;
    
    // Update selected directories set
    if (dir.selected) {
        selectedDirectories.add(dir.path);
    } else {
        selectedDirectories.delete(dir.path);
    }
    
    // Propagate to children
    function propagateToChildren(directory, selected) {
        directory.selected = selected;
        if (selected) {
            selectedDirectories.add(directory.path);
        } else {
            selectedDirectories.delete(directory.path);
        }
        
        directory.children.forEach(child => {
            propagateToChildren(child, selected);
        });
    }
    
    propagateToChildren(dir, dir.selected);
    updateSelectedCount();
    renderDirectoryTree();
}

// Update selected count
function updateSelectedCount() {
    const count = selectedDirectories.size;
    document.getElementById('selected-count').textContent = count;
    document.getElementById('scan-btn').disabled = count === 0;
}



// Show scan confirmation modal
function showScanConfirmModal() {
    if (selectedDirectories.size === 0) {
        showMessage('Выберите папки для сканирования', 'error');
        return;
    }
    
    // Populate folders list
    const foldersList = document.getElementById('scan-folders-list');
    const pathsArray = Array.from(selectedDirectories);
    
    foldersList.innerHTML = pathsArray.map(path => 
        `<div style="padding: 5px; border-bottom: 1px solid #eee;">📁 ${path}</div>`
    ).join('');
    
    // Set default values
    document.getElementById('scan-thread-count').value = 8;
    document.getElementById('scan-recursive-checkbox').checked = true;
    document.getElementById('scan-calculate-crc32').checked = true;
    
    // Show modal
    document.getElementById('scan-confirm-modal').style.display = 'block';
}

// Close scan confirmation modal
function closeScanConfirmModal() {
    document.getElementById('scan-confirm-modal').style.display = 'none';
}

// Confirm and start scan operation
async function confirmScanOperation() {
    closeScanConfirmModal();
    await performScan();
}

// Scan selected directories with batch processing
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
    
    // Show progress modal
    showProgressModal('Пакетное сканирование', 'Инициализация сканирования...');
    
    try {
        const pathsArray = Array.from(selectedDirectories);
        updateProgress(0, `Сканирование ${pathsArray.length} папок...`);
        
        // Use the checkbox value for all selected paths
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
            // Store current scan ID and show stop button
            currentScanId = result.scanId;
            document.getElementById('stop-scan-btn').style.display = 'inline-block';
            
            // Monitor progress
            const finalProgress = await monitorScanProgress(result.scanId);
            
            // Show final results with time
            if (finalProgress && finalProgress.duration) {
                const scanTime = formatScanTime(Math.round(finalProgress.duration / 1000));
                
                const scanMode = recursiveScan ? 'рекурсивно' : 'только верхний уровень';
                if (finalProgress.status === 'cancelled') {
                    showMessage(`Сканирование остановлено: обработано ${finalProgress.processed}/${finalProgress.total} файлов за ${scanTime}`, 'warning');
                } else {
                    showMessage(`Сканирование завершено (${scanMode}): ${pathsArray.length} папок обработано за ${scanTime}. Потоков: ${threadCount}`, 'success');
                }
                
                // Update last scan time in stats
                document.getElementById('last-scan-time').textContent = scanTime;
                
                // Calculate and display performance metrics
                const totalItems = finalProgress.total || 0;
                const durationSeconds = Math.round(finalProgress.duration / 1000);
                const itemsPerSecond = durationSeconds > 0 ? Math.round(totalItems / durationSeconds) : 0;
                document.getElementById('scan-performance').textContent = `${itemsPerSecond} файлов/сек`;
            } else {
                const scanMode = recursiveScan ? 'рекурсивно' : 'только верхний уровень';
                if (finalProgress && finalProgress.status === 'cancelled') {
                    showMessage(`Сканирование остановлено (${scanMode}): ${pathsArray.length} папок. Потоков: ${threadCount}`, 'warning');
                } else {
                    showMessage(`Сканирование завершено (${scanMode}): ${pathsArray.length} папок обработано. Потоков: ${threadCount}`, 'success');
                }
            }
        }
        
        // Hide progress modal
        closeProgressModal();
        loadStats();
        loadFiles();
        
    } catch (error) {
        closeProgressModal();
        showMessage('Ошибка сканирования: ' + error.message, 'error');
    }
    
    // Reset button
    scanBtn.disabled = false;
    scanBtn.innerHTML = `🚀 Сканировать выбранные папки (<span id="selected-count">${selectedDirectories.size}</span>)`;
    
    // Clear selection
    selectedDirectories.clear();
    directoryTree.forEach(dir => {
        function clearSelection(directory) {
            directory.selected = false;
            directory.children.forEach(child => clearSelection(child));
        }
        clearSelection(dir);
    });
    updateSelectedCount();
    renderDirectoryTree();
}

// Monitor scan progress
async function monitorScanProgress(scanId, path) {
    return new Promise((resolve) => {
        const checkProgress = async () => {
            try {
                const progress = await apiCall(`/scan/progress/${scanId}`);
                
                if (progress.total > 0) {
                    const percentage = Math.round((progress.processed / progress.total) * 100);
                    const currentTime = Date.now();
                    const elapsedTime = Math.round((currentTime - progress.startTime) / 1000);
                    const timeText = formatScanTime(elapsedTime);
                    
                    // Calculate processing speed
                    const itemsPerSecond = elapsedTime > 0 ? Math.round(progress.processed / elapsedTime) : 0;
                    const speedText = itemsPerSecond > 0 ? ` | Скорость: ${itemsPerSecond} файлов/сек` : '';
                    
                    // Estimate remaining time
                    const remaining = progress.total - progress.processed;
                    const etaSeconds = itemsPerSecond > 0 ? Math.round(remaining / itemsPerSecond) : 0;
                    const etaText = etaSeconds > 0 && etaSeconds < 3600 ? ` | Осталось: ~${formatScanTime(etaSeconds)}` : '';
                    
                    updateProgress(percentage, `Обработано: ${progress.processed}/${progress.total} файлов | Время: ${timeText}${speedText}${etaText}`);
                }
                
                if (progress.status === 'completed' || progress.status === 'error' || progress.status === 'cancelled') {
                    // Hide stop button
                    document.getElementById('stop-scan-btn').style.display = 'none';
                    currentScanId = null;
                    
                    // Show final time
                    if (progress.duration) {
                        const finalTime = formatScanTime(Math.round(progress.duration / 1000));
                        if (progress.status === 'cancelled') {
                            updateProgress(Math.round((progress.processed / progress.total) * 100), `Сканирование остановлено за ${finalTime}. Обработано: ${progress.processed}/${progress.total} файлов`);
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

// Stop scanning function
async function stopScanning() {
    if (!currentScanId) {
        showMessage('Нет активного сканирования для остановки', 'error');
        return;
    }
    
    try {
        const stopBtn = document.getElementById('stop-scan-btn');
        stopBtn.disabled = true;
        stopBtn.textContent = '⏳ Остановка...';
        
        const result = await apiCall(`/scan/stop/${currentScanId}`, { 
            method: 'POST'
        });
        
        showMessage('Запрос на остановку сканирования отправлен...', 'info');
        
    } catch (error) {
        showMessage('Ошибка при остановке сканирования: ' + error.message, 'error');
        
        // Reset button state
        const stopBtn = document.getElementById('stop-scan-btn');
        stopBtn.disabled = false;
        stopBtn.textContent = '⏹️ Остановить сканирование';
    }
}

// Rescan selected files/folders from database
let rescanSelectedItems = [];
let currentRescanId = null;

async function rescanSelected() {
    const selectedItems = getSelectedDatabaseItems();
    
    if (selectedItems.length === 0) {
        showMessage('Выберите файлы или папки для пересканирования', 'warning');
        return;
    }
    
    // Store selected items
    rescanSelectedItems = selectedItems;
    
    // Show items in modal
    const itemCount = selectedItems.length;
    const itemsList = selectedItems.map(item => {
        const name = item.full_path.split(/[\\\/]/).pop();
        return `<div style="padding: 5px;">${item.is_directory ? '📁' : '📄'} ${name}</div>`;
    }).slice(0, 10).join('');
    
    const moreText = itemCount > 10 ? `<div style="padding: 5px; color: #666;">... и еще ${itemCount - 10} элементов</div>` : '';
    
    document.getElementById('rescan-items-list').innerHTML = `
        <div style="font-weight: bold; margin-bottom: 10px;">Выбрано элементов: ${itemCount}</div>
        ${itemsList}
        ${moreText}
    `;
    
    // Show modal
    document.getElementById('rescan-modal').style.display = 'flex';
}

function closeRescanModal() {
    document.getElementById('rescan-modal').style.display = 'none';
}

async function startRescan() {
    // Get settings from modal
    const recursive = document.getElementById('rescan-recursive').checked;
    const threads = parseInt(document.getElementById('rescan-threads').value) || 4;
    const calculateCrc32 = document.getElementById('rescan-calculate-crc32').checked;
    
    // Close settings modal
    closeRescanModal();
    
    // Show progress modal
    document.getElementById('rescan-progress-modal').style.display = 'flex';
    document.getElementById('rescan-status').textContent = 'Инициализация...';
    document.getElementById('rescan-progress-fill').style.width = '0%';
    document.getElementById('rescan-progress-fill').textContent = '0%';
    
    try {
        // Extract full paths from selected items
        const paths = rescanSelectedItems.map(item => ({
            path: item.full_path,
            recursive: recursive
        }));
        
        // Call rescan API
        const response = await apiCall('/database/rescan', {
            method: 'POST',
            body: JSON.stringify({ 
                paths: paths.map(p => p.path),
                threads: threads,
                calculateCrc32: calculateCrc32
            })
        });
        
        if (response.success) {
            currentRescanId = response.scanId;
            document.getElementById('rescan-status').textContent = `Удалено старых записей: ${response.deletedRecords}`;
            
            // Monitor scan progress
            const scanResult = await monitorRescanProgress(response.scanId);
            
            // Close progress modal
            document.getElementById('rescan-progress-modal').style.display = 'none';
            
            // Show completion message
            if (scanResult && scanResult.status === 'completed') {
                showMessage(
                    `✅ Пересканирование завершено!\nОбработано файлов: ${scanResult.processed}\nВремя: ${formatScanTime(Math.round(scanResult.duration / 1000))}`,
                    'success'
                );
            } else if (scanResult && scanResult.status === 'cancelled') {
                showMessage(
                    `⚠️ Пересканирование остановлено\nОбработано файлов: ${scanResult.processed}`,
                    'warning'
                );
            }
            
            // Clear selection and refresh view after completion
            clearSelection();
            refreshCurrentView(true);
            loadStats();
        } else {
            document.getElementById('rescan-progress-modal').style.display = 'none';
            showMessage('❌ Ошибка при пересканировании', 'error');
        }
        
    } catch (error) {
        document.getElementById('rescan-progress-modal').style.display = 'none';
        showMessage('❌ Ошибка при пересканировании: ' + error.message, 'error');
        console.error('Rescan error:', error);
    }
}

async function monitorRescanProgress(scanId) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        let lastProcessed = 0;
        let lastTime = Date.now();
        
        const checkProgress = async () => {
            try {
                const progress = await apiCall(`/scan/progress/${scanId}`);
                
                if (progress.total > 0) {
                    const percentage = Math.round((progress.processed / progress.total) * 100);
                    document.getElementById('rescan-progress-fill').style.width = percentage + '%';
                    document.getElementById('rescan-progress-fill').textContent = percentage + '%';
                    
                    document.getElementById('rescan-processed').textContent = progress.processed;
                    document.getElementById('rescan-total').textContent = progress.total;
                    
                    // Calculate speed
                    const now = Date.now();
                    const timeDiff = (now - lastTime) / 1000;
                    const processedDiff = progress.processed - lastProcessed;
                    const speed = timeDiff > 0 ? Math.round(processedDiff / timeDiff) : 0;
                    document.getElementById('rescan-speed').textContent = speed;
                    
                    lastProcessed = progress.processed;
                    lastTime = now;
                    
                    // Calculate elapsed time
                    const elapsed = Math.round((now - startTime) / 1000);
                    const minutes = Math.floor(elapsed / 60);
                    const seconds = elapsed % 60;
                    document.getElementById('rescan-elapsed').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                    
                    // Calculate remaining time
                    if (speed > 0) {
                        const remaining = Math.round((progress.total - progress.processed) / speed);
                        const remMin = Math.floor(remaining / 60);
                        const remSec = remaining % 60;
                        document.getElementById('rescan-remaining').textContent = `${remMin}:${remSec.toString().padStart(2, '0')}`;
                    }
                    
                    document.getElementById('rescan-status').textContent = progress.status || 'Сканирование...';
                }
                
                if (progress.status === 'completed' || progress.status === 'cancelled') {
                    document.getElementById('rescan-stop-btn').style.display = 'none';
                    currentRescanId = null;
                    resolve(progress);
                } else {
                    setTimeout(checkProgress, 500);
                }
            } catch (error) {
                console.error('Error checking rescan progress:', error);
                setTimeout(checkProgress, 1000);
            }
        };
        
        checkProgress();
    });
}

async function stopRescan() {
    if (!currentRescanId) {
        showMessage('Нет активного пересканирования для остановки', 'error');
        return;
    }
    
    try {
        document.getElementById('rescan-stop-btn').disabled = true;
        document.getElementById('rescan-stop-btn').textContent = '⏳ Остановка...';
        
        await apiCall(`/scan/stop/${currentRescanId}`, { method: 'POST' });
        
        document.getElementById('rescan-status').textContent = 'Запрос на остановку отправлен...';
        showMessage('Запрос на остановку пересканирования отправлен...', 'info');
        
    } catch (error) {
        showMessage('Ошибка при остановке пересканирования: ' + error.message, 'error');
        document.getElementById('rescan-stop-btn').disabled = false;
        document.getElementById('rescan-stop-btn').textContent = '⏹️ Остановить';
    }
}

// Load statistics
async function loadStats() {
    try {
        const stats = await apiCall('/stats');
        document.getElementById('total-files').textContent = stats.total_files || 0;
        document.getElementById('total-dirs').textContent = stats.total_directories || 0;
        document.getElementById('total-size').textContent = formatBytes(stats.total_size_bytes || 0);
    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

// Load scan history
async function loadScanHistory() {
    try {
        const history = await apiCall('/scan-history');
        renderScanHistory(history.scans || []);
    } catch (error) {
        console.error('Failed to load scan history:', error);
        document.getElementById('scan-history-container').innerHTML = 
            '<div class="error">Ошибка загрузки истории сканирования</div>';
    }
}

// Render scan history table
function renderScanHistory(scans) {
    const container = document.getElementById('scan-history-container');
    
    if (scans.length === 0) {
        container.innerHTML = '<div class="loading">История сканирования пуста</div>';
        return;
    }
    
    const tableHTML = `
        <div class="history-table">
            <table>
                <thead>
                    <tr>
                        <th>Дата и время</th>
                        <th>Статус</th>
                        <th>Папки</th>
                        <th>Время выполнения</th>
                        <th>Потоки</th>
                        <th>Файлов обработано</th>
                        <th>Всего найдено</th>
                        <th>CRC32</th>
                    </tr>
                </thead>
                <tbody>
                    ${scans.map(scan => {
                        // Normalize paths to array of strings (handle both old and new format)
                        const pathsArray = Array.isArray(scan.paths) 
                            ? scan.paths.map(p => typeof p === 'string' ? p : (p.path || String(p)))
                            : [String(scan.paths)];
                        
                        const pathsText = pathsArray.join(', ');
                        
                        return `
                        <tr>
                            <td>${formatDateTime(scan.startTime)}</td>
                            <td><span class="status-badge status-${scan.status}">${getStatusText(scan.status)}</span></td>
                            <td class="paths-list" title="${pathsText}">${pathsText}</td>
                            <td>${formatScanTime(Math.round(scan.duration / 1000))}</td>
                            <td>${scan.threadCount}</td>
                            <td>${scan.filesProcessed.toLocaleString()}</td>
                            <td>${scan.totalFound.toLocaleString()}</td>
                            <td>${scan.calculateCrc32 ? '✅' : '❌'}</td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
    
    container.innerHTML = tableHTML;
}

// Format date and time for display
function formatDateTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// Get status text in Russian
function getStatusText(status) {
    switch (status) {
        case 'completed': return 'Завершено';
        case 'cancelled': return 'Отменено';
        case 'error': return 'Ошибка';
        default: return status;
    }
}

// Clear scan history
async function clearScanHistory() {
    if (!confirm('Вы уверены, что хотите очистить всю историю сканирования? Это действие нельзя отменить.')) {
        return;
    }
    
    try {
        // We'll need to add this endpoint to the server
        await apiCall('/scan-history', { method: 'DELETE' });
        showMessage('История сканирования очищена', 'success');
        loadScanHistory(); // Reload to show empty state
    } catch (error) {
        showMessage('Ошибка при очистке истории: ' + error.message, 'error');
    }
}

// Show archive modal
async function showArchiveModal(selectedFiles) {
    const modal = document.getElementById('archive-modal');
    const filesList = document.getElementById('archive-files-list');
    const archiveName = document.getElementById('archive-name');
    const destination = document.getElementById('archive-destination');
    const formatSelect = document.getElementById('archive-format');
    
    // Generate archive name from selected files with current date
    let baseName;
    if (selectedFiles.length === 1) {
        // Single file/folder - use only the last part of the path
        const pathParts = selectedFiles[0].path.split(/[\\\/]/).filter(part => part.length > 0);
        baseName = pathParts[pathParts.length - 1].replace(/\.[^/.]+$/, "");
    } else {
        // Multiple files - use "Files"
        baseName = "Files";
    }
    
    // Clean base name - remove invalid filename characters
    baseName = baseName.replace(/[<>:"/\\|?*]/g, '_');
    
    // Format date as DD.MM.YYYY
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const dateStr = `${day}.${month}.${year}`;
    
    archiveName.value = `${baseName}(${dateStr})`;
    
    // Set default destination
    destination.value = 'C:\\FileStash-Archives';
    
    // Reset multivolume settings
    document.getElementById('archive-multivolume').checked = false;
    document.getElementById('volume-size-group').style.display = 'none';
    document.getElementById('archive-compression').value = '3';
    
    // Fetch and populate available formats
    try {
        const archiverInfo = await apiCall('/archivers');
        populateFormatDropdown(archiverInfo);
    } catch (error) {
        console.error('Failed to load archiver info:', error);
        formatSelect.innerHTML = '<option value="">Ошибка загрузки форматов</option>';
    }
    
    // Populate files list with better formatting
    filesList.innerHTML = '<h4>Файлы для архивации:</h4>' + 
        selectedFiles.map(file => 
            `<div style="padding: 5px; border-bottom: 1px solid #eee;">
                <strong>${file.isDirectory ? '📁' : '📄'} ${file.path.split(/[\\\/]/).pop()}</strong>
                <br><small style="color: #666;">${file.path}</small>
            </div>`
        ).join('');
    
    modal.style.display = 'block';
}

// Populate format dropdown with available formats
function populateFormatDropdown(archiverInfo) {
    const formatSelect = document.getElementById('archive-format');
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
    
    // Add available formats in order
    formatOrder.forEach(format => {
        if (archiverInfo.supportedFormats.includes(format)) {
            const option = document.createElement('option');
            option.value = format;
            option.textContent = formatLabels[format] || format.toUpperCase();
            formatSelect.appendChild(option);
        }
    });
    
    // Add unavailable formats as disabled options
    formatOrder.forEach(format => {
        if (!archiverInfo.supportedFormats.includes(format)) {
            const option = document.createElement('option');
            option.value = format;
            option.textContent = `${formatLabels[format] || format.toUpperCase()} (недоступен)`;
            option.disabled = true;
            formatSelect.appendChild(option);
        }
    });
    
    // Select first available format
    if (archiverInfo.supportedFormats.length > 0) {
        formatSelect.value = formatOrder.find(f => archiverInfo.supportedFormats.includes(f)) || archiverInfo.supportedFormats[0];
    }
}

// Update archive filename extension based on selected format
function updateArchiveExtension() {
    const archiveName = document.getElementById('archive-name');
    const formatSelect = document.getElementById('archive-format');
    const selectedFormat = formatSelect.value;
    
    if (!selectedFormat || !archiveName.value) {
        return;
    }
    
    // Remove existing extension
    let baseName = archiveName.value.replace(/\.(zip|rar|7z)$/i, '');
    
    // Add new extension
    archiveName.value = `${baseName}.${selectedFormat}`;
}

// Close archive modal
function closeArchiveModal() {
    document.getElementById('archive-modal').style.display = 'none';
}

// Browse for archive destination
function browseArchiveDestination() {
    showFolderBrowserModal('archive-destination');
}

// Toggle multivolume archive options
function toggleMultivolume() {
    const checkbox = document.getElementById('archive-multivolume');
    const volumeGroup = document.getElementById('volume-size-group');
    
    if (checkbox.checked) {
        volumeGroup.style.display = 'block';
    } else {
        volumeGroup.style.display = 'none';
    }
}

// Create archive with enhanced options
async function createArchive() {
    const destination = document.getElementById('archive-destination').value;
    let archiveName = document.getElementById('archive-name').value;
    const password = document.getElementById('archive-password').value;
    const compression = document.getElementById('archive-compression').value;
    const isMultivolume = document.getElementById('archive-multivolume').checked;
    const volumeSize = document.getElementById('archive-volume-size').value;
    const format = document.getElementById('archive-format').value;
    
    if (!destination) {
        showMessage('Выберите папку для сохранения', 'error');
        return;
    }
    
    if (!archiveName) {
        showMessage('Введите имя архива', 'error');
        return;
    }
    
    if (!format) {
        showMessage('Выберите формат архива', 'error');
        return;
    }
    
    if (isMultivolume && (!volumeSize || volumeSize < 1)) {
        showMessage('Укажите размер тома для многотомного архива', 'error');
        return;
    }
    
    if (selectedTreeFiles.size === 0) {
        showMessage('Нет выбранных файлов для архивации', 'error');
        return;
    }
    
    // Ensure archive name has correct extension
    archiveName = archiveName.replace(/\.(zip|rar|7z)$/i, '');
    archiveName = `${archiveName}.${format}`;
    
    // Close archive modal and show progress modal
    closeArchiveModal();
    showArchiveProgressModal();
    
    try {
        // Get actual file IDs from database (including children of intermediate folders)
        const fileIds = await getFilesForSelectedPaths();
        
        if (fileIds.length === 0) {
            updateArchiveProgress(0, 'Нет файлов для архивации');
            appendArchiveLog(`❌ Нет файлов в базе данных для архивации`);
            document.getElementById('archive-close-btn').style.display = 'inline-block';
            return;
        }
        
        appendArchiveLog(`📦 Начало архивации ${fileIds.length} файлов...`);
        
        // Start archive creation (returns immediately with archiveId)
        const startResult = await apiCall('/files/archive', {
            method: 'POST',
            body: JSON.stringify({
                fileIds: fileIds,
                archiveName: archiveName,
                destinationPath: destination,
                format: format,
                password: password || undefined,
                volumeSize: isMultivolume ? volumeSize : undefined,
                compression: compression
            })
        });
        
        const archiveId = startResult.archiveId;
        const archiver = startResult.archiver;
        const archiveFormat = startResult.format;
        
        appendArchiveLog(`✅ Архивация запущена (ID: ${archiveId})`);
        
        // Display archiver type and format
        if (archiver) {
            const archiverNames = {
                '7zip': '7-Zip',
                'winrar': 'WinRAR'
            };
            appendArchiveLog(`🔧 Архиватор: ${archiverNames[archiver] || archiver}`);
        }
        if (archiveFormat) {
            appendArchiveLog(`📋 Формат: ${archiveFormat.toUpperCase()}`);
        }
        
        // Connect to progress stream using Server-Sent Events
        const eventSource = new EventSource(`/api/archive/progress/${archiveId}`);
        
        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                if (data.type === 'connected') {
                    appendArchiveLog('🔗 Подключено к потоку прогресса');
                } else if (data.type === 'progress') {
                    // Update progress bar
                    updateArchiveProgress(data.progress || 0, data.status || 'Processing...');
                    
                    // Update current file
                    if (data.currentFile) {
                        appendArchiveLog(`   ${data.currentFile}`);
                    }
                    
                    // Add new console output lines
                    if (data.consoleOutput && data.consoleOutput.length > 0) {
                        const lastOutputIndex = window.lastArchiveOutputIndex || 0;
                        const newLines = data.consoleOutput.slice(lastOutputIndex);
                        newLines.forEach(item => {
                            appendArchiveLog(item.line);
                        });
                        window.lastArchiveOutputIndex = data.consoleOutput.length;
                    }
                    
                    // Handle completion
                    if (data.status === 'completed') {
                        eventSource.close();
                        updateArchiveProgress(100, 'Архив создан успешно!');
                        if (data.archiveSize) {
                            appendArchiveLog(`📊 Размер архива: ${formatBytes(data.archiveSize)}`);
                        }
                        if (data.archivePath) {
                            appendArchiveLog(`📍 Расположение: ${data.archivePath}`);
                        }
                        document.getElementById('archive-close-btn').style.display = 'inline-block';
                        showMessage('Архив создан успешно!', 'success');
                        window.lastArchiveOutputIndex = 0;
                    }
                    
                    // Handle failure
                    if (data.status === 'failed') {
                        eventSource.close();
                        updateArchiveProgress(0, 'Ошибка создания архива');
                        if (data.error) {
                            appendArchiveLog(`❌ Ошибка: ${data.error}`);
                        }
                        document.getElementById('archive-close-btn').style.display = 'inline-block';
                        showMessage('Ошибка создания архива', 'error');
                        window.lastArchiveOutputIndex = 0;
                    }
                } else if (data.type === 'error') {
                    eventSource.close();
                    appendArchiveLog(`❌ Ошибка: ${data.message}`);
                    updateArchiveProgress(0, 'Ошибка');
                    document.getElementById('archive-close-btn').style.display = 'inline-block';
                    window.lastArchiveOutputIndex = 0;
                }
            } catch (error) {
                console.error('Error parsing progress data:', error);
            }
        };
        
        eventSource.onerror = (error) => {
            console.error('EventSource error:', error);
            eventSource.close();
            appendArchiveLog('❌ Потеряно соединение с сервером');
            document.getElementById('archive-close-btn').style.display = 'inline-block';
            window.lastArchiveOutputIndex = 0;
        };
        
    } catch (error) {
        updateArchiveProgress(0, 'Ошибка создания архива');
        
        // Handle format-specific errors
        let errorMessage = error.message;
        if (errorMessage.includes('requires') && errorMessage.includes('not available')) {
            // Format not supported error
            appendArchiveLog(`❌ Формат ${format.toUpperCase()} недоступен`);
            appendArchiveLog(`   ${errorMessage}`);
            showMessage(`Формат ${format.toUpperCase()} недоступен. Выберите другой формат.`, 'error');
        } else {
            appendArchiveLog(`❌ Ошибка: ${errorMessage}`);
            showMessage('Ошибка создания архива: ' + errorMessage, 'error');
        }
        
        document.getElementById('archive-close-btn').style.display = 'inline-block';
    }
}

// Show archive progress modal
function showArchiveProgressModal() {
    const modal = document.getElementById('archive-progress-modal');
    const log = document.getElementById('archive-log');
    
    log.innerHTML = '';
    updateArchiveProgress(0, 'Инициализация...');
    appendArchiveLog('🗜️ Начало создания архива...');
    
    modal.style.display = 'block';
}

// Close archive progress modal
function closeArchiveProgressModal() {
    document.getElementById('archive-progress-modal').style.display = 'none';
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
    const timestamp = new Date().toLocaleTimeString();
    log.textContent += `[${timestamp}] ${message}\n`;
    log.scrollTop = log.scrollHeight;
}

// Show destination modal for copy/move operations
function showDestinationModal(title, buttonText) {
    console.log('showDestinationModal called:', title, buttonText);
    console.log('selectedTreeFiles for modal:', Array.from(selectedTreeFiles));
    
    const modal = document.getElementById('destination-modal');
    const modalTitle = document.getElementById('destination-modal-title');
    const confirmBtn = document.getElementById('destination-confirm-btn');
    const filesList = document.getElementById('destination-files-list');
    const destinationPath = document.getElementById('destination-path');
    
    if (!modal) {
        console.error('destination-modal not found!');
        return;
    }
    
    modalTitle.textContent = title;
    confirmBtn.textContent = buttonText;
    
    // Clear previous destination
    destinationPath.value = '';
    
    // Populate files list
    filesList.innerHTML = '<h4>Выбранные элементы:</h4>' + 
        Array.from(selectedTreeFiles).map(file => 
            `<div style="padding: 5px; border-bottom: 1px solid #eee;">
                <strong>${file.isDirectory ? '📁' : '📄'} ${file.path.split(/[\\\/]/).pop()}</strong>
                <br><small style="color: #666;">${file.path}</small>
            </div>`
        ).join('');
    
    modal.style.display = 'block';
}

// Close destination modal
function closeDestinationModal() {
    document.getElementById('destination-modal').style.display = 'none';
    currentDestinationOperation = null;
}

// Browse for destination folder
function browseDestination() {
    // Create a simple folder browser using existing file tree API
    showFolderBrowserModal('destination-path');
}

// Show folder browser modal with full navigation
function showFolderBrowserModal(targetInputId) {
    // Remove any existing folder browser modal first
    const existingModal = document.querySelector('.folder-browser-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal folder-browser-modal';
    modal.style.display = 'block';
    modal.innerHTML = `
        <div class="modal-content" style="width: 80%; max-width: 800px;">
            <div class="modal-header">
                <h3>Выберите папку назначения</h3>
                <span class="close" onclick="closeFolderBrowser()">&times;</span>
            </div>
            <div style="padding: 20px;">
                <!-- Current path display -->
                <div style="margin-bottom: 15px;">
                    <label><strong>Текущий путь:</strong></label>
                    <div style="display: flex; gap: 10px; margin-top: 5px;">
                        <input type="text" id="browser-current-path" readonly style="flex: 1; padding: 8px; background: #f5f5f5;">
                        <button class="btn btn-secondary" onclick="navigateToParent()" id="up-button" disabled>⬆️ Вверх</button>
                    </div>
                </div>
                
                <!-- File browser area -->
                <div id="folder-browser-content" class="file-browser" style="height: 400px; border: 1px solid #ddd; border-radius: 6px; overflow-y: auto;">
                    <div class="file-browser-loading">Загрузка дисков...</div>
                </div>
                
                <!-- Manual path input -->
                <div style="margin-top: 15px;">
                    <label><strong>Или введите путь вручную:</strong></label>
                    <input type="text" id="manual-path-input" placeholder="Например: C:\\Users\\Username\\Documents" style="width: 100%; padding: 8px; margin-top: 5px;">
                </div>
            </div>
            <div style="text-align: right; padding: 20px; border-top: 1px solid #eee;">
                <button class="btn btn-secondary" onclick="closeFolderBrowser()">Отмена</button>
                <button class="btn btn-primary" onclick="confirmFolderSelection('${targetInputId}')">Выбрать папку</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Store target input ID for later use
    modal.setAttribute('data-target', targetInputId);
    
    // Initialize browser with drives
    currentBrowserPath = 'drives';
    loadFolderBrowserContent();
}

// Close folder browser modal
function closeFolderBrowser() {
    const modal = document.querySelector('.folder-browser-modal');
    if (modal) {
        modal.remove();
    }
}

// Load folder browser content
async function loadFolderBrowserContent() {
    console.log('Loading folder browser content for path:', currentBrowserPath);
    const container = document.getElementById('folder-browser-content');
    const pathInput = document.getElementById('browser-current-path');
    const upButton = document.getElementById('up-button');
    
    if (!container) {
        console.error('Container not found!');
        return;
    }
    
    container.innerHTML = '<div class="file-browser-loading">Загрузка...</div>';
    
    try {
        if (currentBrowserPath === 'drives') {
            console.log('Loading drives...');
            // Load available drives
            const data = await apiCall('/drives');
            console.log('Drives loaded:', data);
            
            if (pathInput) pathInput.value = 'Компьютер';
            if (upButton) upButton.disabled = true;
            
            container.innerHTML = '';
            data.drives.forEach(drive => {
                const item = document.createElement('div');
                item.className = 'file-browser-item';
                item.innerHTML = `
                    <span class="file-browser-icon">💾</span>
                    <span class="file-browser-name">Диск ${drive}</span>
                `;
                item.onclick = () => {
                    console.log('Clicking on drive:', drive);
                    navigateToPath(drive);
                };
                container.appendChild(item);
            });
        } else {
            console.log('Loading directories for path:', currentBrowserPath);
            // Load directories in current path
            const data = await apiCall(`/browse?path=${encodeURIComponent(currentBrowserPath)}`);
            pathInput.value = currentBrowserPath;
            upButton.disabled = false;
            
            container.innerHTML = '';
            
            // Add current directory selection option
            const currentItem = document.createElement('div');
            currentItem.className = 'file-browser-item';
            currentItem.style.backgroundColor = '#e3f2fd';
            currentItem.innerHTML = `
                <span class="file-browser-icon">📁</span>
                <span class="file-browser-name"><strong>📍 Выбрать эту папку</strong></span>
            `;
            currentItem.onclick = () => selectCurrentPath();
            container.appendChild(currentItem);
            
            // Add directories
            data.directories.forEach(dir => {
                const item = document.createElement('div');
                item.className = 'file-browser-item';
                item.innerHTML = `
                    <span class="file-browser-icon">📁</span>
                    <span class="file-browser-name">${dir.name}</span>
                `;
                item.onclick = () => navigateToPath(dir.path);
                container.appendChild(item);
            });
            
            if (data.directories.length === 0) {
                const emptyItem = document.createElement('div');
                emptyItem.className = 'file-browser-loading';
                emptyItem.textContent = 'Папка пуста или нет доступных подпапок';
                container.appendChild(emptyItem);
            }
        }
    } catch (error) {
        container.innerHTML = `<div class="file-browser-loading" style="color: red;">Ошибка загрузки: ${error.message}</div>`;
    }
}

// Navigate to specific path
async function navigateToPath(path) {
    console.log('Navigating to path:', path);
    currentBrowserPath = path;
    try {
        await loadFolderBrowserContent();
    } catch (error) {
        console.error('Error navigating to path:', error);
        const container = document.getElementById('folder-browser-content');
        if (container) {
            container.innerHTML = `<div class="file-browser-loading" style="color: red;">Ошибка: ${error.message}</div>`;
        }
    }
}

// Navigate to parent directory
async function navigateToParent() {
    if (currentBrowserPath === 'drives') return;
    
    const pathParts = currentBrowserPath.split(/[\\\/]/).filter(part => part.length > 0);
    
    if (pathParts.length <= 1) {
        // Go back to drives
        currentBrowserPath = 'drives';
    } else {
        // Go to parent directory
        pathParts.pop();
        currentBrowserPath = pathParts.join('\\') + '\\';
    }
    
    await loadFolderBrowserContent();
}

// Select current path
function selectCurrentPath() {
    const pathInput = document.getElementById('browser-current-path');
    const manualInput = document.getElementById('manual-path-input');
    
    if (pathInput && manualInput) {
        manualInput.value = currentBrowserPath;
    }
}

// Confirm folder selection
function confirmFolderSelection(targetInputId) {
    const manualPathInput = document.getElementById('manual-path-input');
    const targetInput = document.getElementById(targetInputId);
    
    if (manualPathInput && targetInput) {
        let selectedPath = manualPathInput.value.trim();
        
        // If no manual path entered, use current browser path
        if (!selectedPath && currentBrowserPath !== 'drives') {
            selectedPath = currentBrowserPath;
        }
        
        if (selectedPath) {
            targetInput.value = selectedPath;
            closeFolderBrowser();
        } else {
            showMessage('Выберите папку или введите путь', 'error');
        }
    }
}

// Get files from database for selected paths (including children of intermediate folders)
async function getFilesForSelectedPaths() {
    const allFiles = [];
    
    for (const item of selectedTreeFiles) {
        if (item.inDatabase && item.id.startsWith('path_')) {
            // This is an intermediate folder, get all files under this path
            try {
                const response = await apiCall(`/files/tree?rootPath=${encodeURIComponent(item.path)}`);
                const filesInPath = extractFilesFromTree(response, item.path);
                allFiles.push(...filesInPath);
            } catch (error) {
                console.error('Error getting files for path:', item.path, error);
            }
        } else if (item.inDatabase) {
            // This is a direct database file
            allFiles.push(item.id);
        }
    }
    
    return [...new Set(allFiles)]; // Remove duplicates
}

// Extract file IDs from tree structure
function extractFilesFromTree(treeData, basePath) {
    const fileIds = [];
    
    function traverseTree(nodes) {
        Object.values(nodes).forEach(node => {
            if (node.fileData && node.fileData.id) {
                fileIds.push(node.fileData.id);
            }
            if (node.children) {
                traverseTree(node.children);
            }
        });
    }
    
    traverseTree(treeData);
    return fileIds;
}

// Confirm destination operation (copy or move)
async function confirmDestinationOperation() {
    const destination = document.getElementById('destination-path').value.trim();
    
    if (!destination) {
        showMessage('Выберите папку назначения', 'error');
        return;
    }
    
    if (selectedTreeFiles.size === 0) {
        showMessage('Нет выбранных файлов', 'error');
        return;
    }
    
    // Save operation before closing modal (closeDestinationModal sets it to null)
    const operation = currentDestinationOperation;
    closeDestinationModal();
    
    try {
        // Get actual file IDs from database (including children of intermediate folders)
        const fileIds = await getFilesForSelectedPaths();
        
        if (fileIds.length === 0) {
            showMessage('Нет файлов в базе данных для выбранных элементов', 'error');
            return;
        }
        
        if (operation === 'copy') {
            showProgressModal('Копирование файлов', 'Копирование в процессе...');
            
            const result = await apiCall('/files/copy', {
                method: 'POST',
                body: JSON.stringify({
                    fileIds: fileIds,
                    destinationPath: destination
                })
            });
            
            closeProgressModal();
            
            const successCount = result.results.filter(r => r.status === 'success').length;
            const errorCount = result.results.filter(r => r.status === 'error').length;
            const notFoundCount = result.results.filter(r => r.error && r.error.includes('does not exist')).length;
            
            if (successCount > 0) {
                showMessage(`Копирование завершено: ${successCount} файлов${errorCount > 0 ? `, ${errorCount} ошибок` : ''}`, 'success');
            } else {
                showMessage(`Копирование не удалось: ${errorCount} ошибок`, 'error');
            }
            
            // If some files were not found, suggest cleanup
            if (notFoundCount > 0) {
                setTimeout(() => {
                    if (confirm(`Обнаружено ${notFoundCount} файлов, которые больше не существуют на диске.\n\nОчистить базу данных от таких записей?`)) {
                        cleanupDatabase();
                    }
                }, 1000);
            }
            
        } else if (operation === 'move') {
            showProgressModal('Перемещение файлов', 'Перемещение в процессе...');
            
            const result = await apiCall('/files/move', {
                method: 'POST',
                body: JSON.stringify({
                    fileIds: fileIds,
                    destinationPath: destination
                })
            });
            
            closeProgressModal();
            
            const successCount = result.results.filter(r => r.status === 'success').length;
            const errorCount = result.results.filter(r => r.status === 'error').length;
            
            if (successCount > 0) {
                // Remove moved files from database
                await apiCall('/files/remove-from-database', {
                    method: 'POST',
                    body: JSON.stringify({ fileIds: fileIds })
                });
                
                showMessage(`Перемещение завершено: ${successCount} файлов${errorCount > 0 ? `, ${errorCount} ошибок` : ''}`, 'success');
                
                // Clear selection and force refresh tree and stats
                selectedTreeFiles.clear();
                updateTreeSelectedCount();
                refreshCurrentView();
                loadStats();
            } else {
                showMessage(`Перемещение не удалось: ${errorCount} ошибок`, 'error');
            }
        }
        
        // Clear selection
        selectedTreeFiles.clear();
        updateTreeSelectedCount();
        
    } catch (error) {
        closeProgressModal();
        showMessage(`Ошибка операции: ${error.message}`, 'error');
    }
}

// Load files
async function loadFiles() {
    try {
        const skip = (currentPage - 1) * pageSize;
        const params = new URLSearchParams({
            skip: skip,
            limit: pageSize
        });
        
        if (currentSearch) {
            params.append('search', currentSearch);
        }
        
        const files = await apiCall(`/files?${params}`);
        displayFiles(files);
        updatePagination();
    } catch (error) {
        document.getElementById('files-tbody').innerHTML = 
            '<tr><td colspan="7" class="loading">Ошибка загрузки файлов</td></tr>';
    }
}

// Display files in table
function displayFiles(files) {
    const tbody = document.getElementById('files-tbody');
    currentFiles = files; // Store for later use
    
    if (files.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading">Файлы не найдены</td></tr>';
        return;
    }
    
    tbody.innerHTML = '';
    
    files.forEach(file => {
        const row = document.createElement('tr');
        
        const icon = file.is_directory ? '📁' : '📄';
        const size = file.is_directory ? '' : formatBytes(file.size);
        const crc32 = file.crc32 || '';
        const isSelected = selectedFiles.has(file.id);
        
        if (isSelected) {
            row.classList.add('selected-row');
        }
        
        row.innerHTML = `
            <td>
                <input type="checkbox" class="file-checkbox" data-file-id="${file.id}" 
                       ${isSelected ? 'checked' : ''} 
                       onchange="toggleFileSelection(${file.id}, this)">
            </td>
            <td>
                <span class="file-icon">${icon}</span>
                ${file.is_directory ? 
                    `<a href="#" onclick="openDirectory('${file.full_path}'); return false;" style="text-decoration: none; color: #007bff;">${file.filename}</a>` :
                    file.filename
                }
            </td>
            <td title="${file.full_path}">${file.full_path.length > 50 ? file.full_path.substring(0, 50) + '...' : file.full_path}</td>
            <td>${file.extension}</td>
            <td>${size}</td>
            <td style="font-family: monospace; font-size: 12px;">${crc32}</td>
            <td>${formatDate(file.modified_time)}</td>
            <td>
                <button class="btn btn-danger" onclick="deleteFile(${file.id})" style="padding: 5px 10px; font-size: 12px;">
                    🗑️ Удалить запись
                </button>
            </td>
        `;
        
        tbody.appendChild(row);
    });
    
    updateSelectedFilesCount();
}

// Load file tree with lazy loading
async function loadFileTree(searchQuery = '', forceRefresh = false) {
    try {
        const container = document.getElementById('files-tree-container');
        if (container) {
            container.innerHTML = '<div class="tree-loading">Загрузка файлового дерева...</div>';
        }
        
        const params = new URLSearchParams();
        
        // Only add parent parameter if not searching
        if (!searchQuery) {
            params.append('parent', 'root'); // Load only root level
        } else {
            params.append('search', searchQuery);
        }
        
        if (forceRefresh) {
            params.append('refresh', Date.now());
        }
        
        const response = await apiCall(`/files/tree?${params}`);
        renderLazyFileTree(response.nodes, searchQuery);
    } catch (error) {
        console.error('Failed to load file tree:', error);
        const container = document.getElementById('files-tree-container');
        if (container) {
            container.innerHTML = '<div class="tree-empty">Ошибка загрузки файлового дерева</div>';
        }
    }
}

// Load children of a specific node
async function loadTreeChildren(parentPath, nodeElement) {
    try {
        const params = new URLSearchParams();
        params.append('parent', parentPath);
        
        const response = await apiCall(`/files/tree?${params}`);
        return response.nodes;
    } catch (error) {
        console.error('Failed to load tree children:', error);
        return [];
    }
}

// Render file tree structure
function renderFileTree(treeData, searchQuery = '') {
    const container = document.getElementById('files-tree-container');
    if (!container) return;
    
    if (Object.keys(treeData).length === 0) {
        const emptyMessage = searchQuery ? 
            `<div class="tree-empty">Файлы не найдены для запроса "${searchQuery}"</div>` :
            `<div class="tree-empty">
                <h3>Nothing to show here</h3>
                <p>Start your first scan to see files and folders</p>
                <button class="btn btn-primary" onclick="showTab('scan')" style="margin-top: 10px;">
                    🔍 Go to Scan Tab
                </button>
            </div>`;
        container.innerHTML = emptyMessage;
        return;
    }
    
    let html = '';
    
    // Add search info if searching
    if (searchQuery) {
        const totalNodes = countTreeNodes(treeData);
        html += `<div class="tree-search-info">Найдено результатов: ${totalNodes} для "${searchQuery}"</div>`;
    }
    
    // Render tree nodes
    html += '<div class="tree-root">';
    html += renderTreeLevel(treeData, 0);
    html += '</div>';
    
    container.innerHTML = html;
    
    // Don't clear selection on re-render - preserve user's selection
    // selectedTreeFiles.clear(); // REMOVED - this was causing the bug!
    updateTreeSelectedCount();
    
    // Show tree controls
    const controls = container.querySelector('.tree-controls');
    if (controls) {
        controls.style.display = 'block';
    }
    
    // Make nodes focusable and add interactions
    setTimeout(() => {
        makeTreeNodesFocusable();
        // Restore checkbox states after re-render
        restoreTreeSelection();
    }, 100);
}

// Render lazy-loaded file tree
function renderLazyFileTree(nodes, searchQuery = '') {
    const container = document.getElementById('files-tree-container');
    if (!container) return;
    
    console.log(`🎨 Rendering lazy tree: ${nodes ? nodes.length : 0} nodes`);
    if (nodes && nodes.length > 0) {
        const dirs = nodes.filter(n => n.isDirectory).length;
        const files = nodes.filter(n => !n.isDirectory).length;
        console.log(`   Directories: ${dirs}, Files: ${files}`);
    }
    
    if (!nodes || nodes.length === 0) {
        const emptyMessage = searchQuery ? 
            `<div class="tree-empty">Файлы не найдены для запроса "${searchQuery}"</div>` :
            `<div class="tree-empty">
                <h3>Nothing to show here</h3>
                <p>Start your first scan to see files and folders</p>
                <button class="btn btn-primary" onclick="showTab('scan')" style="margin-top: 10px;">
                    🔍 Go to Scan Tab
                </button>
            </div>`;
        container.innerHTML = emptyMessage;
        return;
    }
    
    let html = '';
    
    // Add search info if searching
    if (searchQuery) {
        html += `<div class="tree-search-info">Найдено результатов: ${nodes.length} для "${searchQuery}"</div>`;
    }
    
    // Render tree nodes
    html += '<div class="tree-root">';
    nodes.forEach(node => {
        html += renderLazyTreeNode(node, 0);
    });
    html += '</div>';
    
    container.innerHTML = html;
    
    updateTreeSelectedCount();
    
    // Make nodes focusable and add interactions
    setTimeout(() => {
        makeTreeNodesFocusable();
        restoreTreeSelection();
    }, 100);
}

// Render individual lazy tree node
function renderLazyTreeNode(node, level) {
    const isDirectory = node.isDirectory;
    const hasChildren = node.hasChildren;
    const nodeId = `tree-node-${encodeURIComponent(node.path)}`;
    const inDatabase = node.inDatabase === true;
    const existsOnDisk = node.existsOnDisk !== false;
    
    let nodeClasses = `tree-node ${isDirectory ? 'directory' : 'file'}`;
    if (inDatabase) nodeClasses += ' in-database';
    if (!existsOnDisk) nodeClasses += ' missing-file';
    
    const fileId = node.id || `path_${encodeURIComponent(node.path)}`;
    const escapedPath = node.path.replace(/\\/g, '\\\\\\\\').replace(/'/g, "\\'");
    
    let html = `<div class="${nodeClasses}" data-level="${level}" data-path="${node.path}" data-file-id="${fileId}" data-is-directory="${isDirectory}" data-in-database="${inDatabase}" data-exists-on-disk="${existsOnDisk}" id="${nodeId}" oncontextmenu="showTreeContextMenu(event, '${fileId}', '${escapedPath}', ${isDirectory}, ${inDatabase})">`;
    
    // Checkbox
    html += `<input type="checkbox" class="tree-checkbox" data-file-id="${fileId}" data-path="${node.path}" data-is-directory="${isDirectory}" data-in-database="${inDatabase}" data-exists-on-disk="${existsOnDisk}" onchange="toggleTreeFileSelection('${fileId}', this)">`;
    
    // Expand/collapse icon for directories with children
    if (isDirectory && hasChildren) {
        html += `<span class="tree-expand-icon" onclick="toggleLazyTreeNode('${nodeId}', '${escapedPath}')">▶</span>`;
    } else {
        html += `<span class="tree-expand-icon"></span>`;
    }
    
    // File/folder icon
    let icon;
    if (isDirectory) {
        icon = node.name.match(/^[A-Z]:$/) ? '💾' : '📁';
    } else {
        const ext = node.name.split('.').pop().toLowerCase();
        icon = getFileIcon(ext);
    }
    html += `<span class="tree-icon">${icon}</span>`;
    
    // File/folder name
    html += `<span class="tree-name">${node.name}</span>`;
    
    // File info
    if (!isDirectory && node.size) {
        html += `<span class="tree-size">${formatBytes(node.size)}</span>`;
    }
    
    // Status indicators
    if (!existsOnDisk) {
        html += `<span class="tree-status missing" title="Файл не найден на диске">❌</span>`;
    }
    
    html += '</div>';
    
    // Placeholder for children (will be loaded on expand)
    if (isDirectory && hasChildren) {
        html += `<div class="tree-children" id="${nodeId}-children" style="display: none;"></div>`;
    }
    
    return html;
}

// Toggle lazy tree node (expand/collapse with lazy loading)
async function toggleLazyTreeNode(nodeId, nodePath) {
    const node = document.getElementById(nodeId);
    if (!node) return;
    
    const childrenContainer = document.getElementById(`${nodeId}-children`);
    if (!childrenContainer) return;
    
    const expandIcon = node.querySelector('.tree-expand-icon');
    const isExpanded = childrenContainer.style.display !== 'none';
    
    if (isExpanded) {
        // Collapse
        childrenContainer.style.display = 'none';
        if (expandIcon) expandIcon.textContent = '▶';
    } else {
        // Expand - load children if not loaded yet
        if (expandIcon) expandIcon.textContent = '⏳';
        
        // Check if children already loaded
        if (childrenContainer.children.length === 0) {
            // Load children from server
            const children = await loadTreeChildren(nodePath);
            
            console.log(`📂 Loaded ${children ? children.length : 0} children for "${nodePath}"`);
            
            if (children && children.length > 0) {
                const level = parseInt(node.dataset.level) + 1;
                let html = '';
                children.forEach(child => {
                    html += renderLazyTreeNode(child, level);
                });
                childrenContainer.innerHTML = html;
                
                console.log(`   Rendered ${children.length} children at level ${level}`);
                
                // Make new nodes focusable
                setTimeout(() => {
                    makeTreeNodesFocusable();
                    restoreTreeSelection();
                }, 50);
            } else {
                childrenContainer.innerHTML = '<div class="tree-empty-folder" style="padding-left: 40px; color: #888;">Пусто</div>';
            }
        }
        
        childrenContainer.style.display = 'block';
        if (expandIcon) expandIcon.textContent = '▼';
    }
}

// Render a level of the tree
function renderTreeLevel(nodes, level) {
    let html = '';
    
    // Sort nodes: directories first, then files, both alphabetically
    const sortedEntries = Object.entries(nodes).sort(([nameA, nodeA], [nameB, nodeB]) => {
        if (nodeA.isDirectory && !nodeB.isDirectory) return -1;
        if (!nodeA.isDirectory && nodeB.isDirectory) return 1;
        return nameA.toLowerCase().localeCompare(nameB.toLowerCase());
    });
    
    sortedEntries.forEach(([name, node]) => {
        html += createTreeNode(node, level);
    });
    
    return html;
}

// Create individual tree node
function createTreeNode(node, level) {
    const isDirectory = node.isDirectory;
    const hasChildren = isDirectory && node.children && Object.keys(node.children).length > 0;
    const nodeId = `tree-node-${encodeURIComponent(node.path)}`;
    const inDatabase = node.inDatabase === true; // Only true if explicitly set
    const existsOnDisk = node.existsOnDisk !== false; // Default to true if not specified
    
    // Add classes for styling
    let nodeClasses = `tree-node ${isDirectory ? 'directory' : 'file'}`;
    if (inDatabase) {
        nodeClasses += ' in-database';
    }
    if (!existsOnDisk) {
        nodeClasses += ' missing-file';
    }
    
    // Generate file ID first
    const fileId = node.fileData?.id || `path_${encodeURIComponent(node.path)}`;
    
    // Escape path for use in JavaScript string (double escape backslashes)
    const escapedPath = node.path.replace(/\\/g, '\\\\\\\\').replace(/'/g, "\\'");
    
    let html = `<div class="${nodeClasses}" data-level="${level}" data-path="${node.path}" data-file-id="${fileId}" data-is-directory="${isDirectory}" data-in-database="${inDatabase}" data-exists-on-disk="${existsOnDisk}" id="${nodeId}" oncontextmenu="showTreeContextMenu(event, '${fileId}', '${escapedPath}', ${isDirectory}, ${inDatabase})">`;
    
    // Checkbox for selection (for all items, including intermediate folders)
    html += `<input type="checkbox" class="tree-checkbox" data-file-id="${fileId}" data-path="${node.path}" data-is-directory="${isDirectory}" data-in-database="${inDatabase}" data-exists-on-disk="${existsOnDisk}" onchange="toggleTreeFileSelection('${fileId}', this)">`;
    
    // Expand/collapse icon for directories with children
    if (isDirectory) {
        if (hasChildren) {
            html += `<span class="tree-expand-icon" onclick="toggleTreeNode('${nodeId}')">▶</span>`;
        } else {
            html += `<span class="tree-expand-icon"></span>`;
        }
    } else {
        html += `<span class="tree-expand-icon"></span>`;
    }
    
    // File/folder icon with drive detection
    let icon;
    if (isDirectory) {
        // Check if this is a drive (like C:, D:, etc.)
        if (node.name.match(/^[A-Z]:$/)) {
            icon = '💾'; // Drive icon
        } else {
            icon = '📁'; // Folder icon
        }
    } else {
        icon = getFileIcon(node.fileData?.extension || '');
    }
    html += `<span class="tree-icon">${icon}</span>`;
    
    // Name with database and disk status indicator
    let nameTitle = node.path;
    let displayName = node.name;
    
    if (!existsOnDisk) {
        nameTitle += ' (MISSING - файл не найден на диске)';
        displayName += ' ❌';
    } else if (!inDatabase) {
        nameTitle += ' (not in database)';
    }
    
    html += `<span class="tree-name" title="${nameTitle}">${displayName}</span>`;
    
    // Size for files
    if (!isDirectory && node.fileData?.size !== undefined) {
        html += `<span class="tree-size">${formatBytes(node.fileData.size)}</span>`;
    }
    
    // CRC32 for files
    if (!isDirectory && node.fileData?.crc32) {
        html += `<span class="tree-crc32" title="CRC32 Hash" style="font-family: monospace; font-size: 11px; color: var(--text-tertiary); margin-left: 8px;">${node.fileData.crc32}</span>`;
    }
    
    // Database indicator
    if (inDatabase) {
        html += `<span class="tree-db-indicator" title="In database">✓</span>`;
    }
    
    html += '</div>';
    
    // Children container for directories
    if (hasChildren) {
        html += `<div class="tree-children collapsed" id="${nodeId}-children">`;
        html += renderTreeLevel(node.children, level + 1);
        html += '</div>';
    }
    
    return html;
}

// Toggle tree node expansion
function toggleTreeNode(nodeId) {
    const node = document.getElementById(nodeId);
    const children = document.getElementById(nodeId + '-children');
    const expandIcon = node.querySelector('.tree-expand-icon');
    
    if (children) {
        if (children.classList.contains('collapsed')) {
            children.classList.remove('collapsed');
            expandIcon.classList.add('expanded');
            expandIcon.textContent = '▼';
        } else {
            children.classList.add('collapsed');
            expandIcon.classList.remove('expanded');
            expandIcon.textContent = '▶';
        }
    }
}

// Get file icon based on extension
function getFileIcon(extension) {
    const ext = extension.toLowerCase();
    const iconMap = {
        '.txt': '📄',
        '.doc': '📄', '.docx': '📄',
        '.pdf': '📕',
        '.xls': '📊', '.xlsx': '📊',
        '.ppt': '📊', '.pptx': '📊',
        '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️', '.gif': '🖼️', '.bmp': '🖼️',
        '.mp4': '🎬', '.avi': '🎬', '.mkv': '🎬', '.mov': '🎬',
        '.mp3': '🎵', '.wav': '🎵', '.flac': '🎵',
        '.zip': '📦', '.rar': '📦', '.7z': '📦',
        '.exe': '⚙️', '.msi': '⚙️',
        '.js': '📜', '.html': '📜', '.css': '📜', '.json': '📜',
        '.py': '🐍', '.java': '☕', '.cpp': '⚡', '.c': '⚡'
    };
    
    return iconMap[ext] || '📄';
}

// Count total nodes in tree (for search results)
function countTreeNodes(nodes) {
    let count = 0;
    Object.values(nodes).forEach(node => {
        count++;
        if (node.children) {
            count += countTreeNodes(node.children);
        }
    });
    return count;
}

// Expand all tree nodes
function expandAllTreeNodes() {
    const allNodes = document.querySelectorAll('.tree-children.collapsed');
    const allIcons = document.querySelectorAll('.tree-expand-icon');
    
    allNodes.forEach(node => {
        node.classList.remove('collapsed');
    });
    
    allIcons.forEach(icon => {
        if (icon.textContent === '▶') {
            icon.classList.add('expanded');
            icon.textContent = '▼';
        }
    });
}

// Collapse all tree nodes
function collapseAllTreeNodes() {
    const allNodes = document.querySelectorAll('.tree-children:not(.collapsed)');
    const allIcons = document.querySelectorAll('.tree-expand-icon.expanded');
    
    allNodes.forEach(node => {
        node.classList.add('collapsed');
    });
    
    allIcons.forEach(icon => {
        icon.classList.remove('expanded');
        icon.textContent = '▶';
    });
}

// Add keyboard navigation for tree
function addTreeKeyboardNavigation() {
    document.addEventListener('keydown', function(event) {
        // Only work if we're on the database tab
        const activeTab = document.querySelector('.tab-content.active');
        if (!activeTab || activeTab.id !== 'search-tab') return;
        
        const activeElement = document.activeElement;
        if (!activeElement || !activeElement.classList.contains('tree-node')) return;
        
        switch(event.key) {
            case 'ArrowRight':
                // Expand node if it's a directory
                const expandIcon = activeElement.querySelector('.tree-expand-icon');
                if (expandIcon && expandIcon.textContent === '▶') {
                    expandIcon.click();
                }
                event.preventDefault();
                break;
                
            case 'ArrowLeft':
                // Collapse node if it's expanded
                const collapseIcon = activeElement.querySelector('.tree-expand-icon');
                if (collapseIcon && collapseIcon.textContent === '▼') {
                    collapseIcon.click();
                }
                event.preventDefault();
                break;
                
            case 'ArrowDown':
                // Move to next node
                const nextNode = getNextTreeNode(activeElement);
                if (nextNode) {
                    nextNode.focus();
                }
                event.preventDefault();
                break;
                
            case 'ArrowUp':
                // Move to previous node
                const prevNode = getPreviousTreeNode(activeElement);
                if (prevNode) {
                    prevNode.focus();
                }
                event.preventDefault();
                break;
        }
    });
}

// Get next visible tree node
function getNextTreeNode(currentNode) {
    const allNodes = Array.from(document.querySelectorAll('.tree-node'));
    const currentIndex = allNodes.indexOf(currentNode);
    
    for (let i = currentIndex + 1; i < allNodes.length; i++) {
        const node = allNodes[i];
        if (isNodeVisible(node)) {
            return node;
        }
    }
    return null;
}

// Get previous visible tree node
function getPreviousTreeNode(currentNode) {
    const allNodes = Array.from(document.querySelectorAll('.tree-node'));
    const currentIndex = allNodes.indexOf(currentNode);
    
    for (let i = currentIndex - 1; i >= 0; i--) {
        const node = allNodes[i];
        if (isNodeVisible(node)) {
            return node;
        }
    }
    return null;
}

// Check if tree node is visible (not in collapsed parent)
function isNodeVisible(node) {
    let parent = node.parentElement;
    while (parent) {
        if (parent.classList.contains('tree-children') && parent.classList.contains('collapsed')) {
            return false;
        }
        parent = parent.parentElement;
    }
    return true;
}

// Show copy dialog
function showCopyDialog() {
    console.log('showCopyDialog called, selectedTreeFiles.size:', selectedTreeFiles.size);
    console.log('selectedTreeFiles:', Array.from(selectedTreeFiles));
    
    if (selectedTreeFiles.size === 0) {
        showMessage('❌ Сначала выберите файлы или папки в дереве файлов (вкладка "Поиск"), затем нажмите "Копировать"', 'error');
        return;
    }
    
    currentDestinationOperation = 'copy';
    showDestinationModal('Копирование файлов', 'Копировать');
}

// Show move dialog
function showMoveDialog() {
    if (selectedTreeFiles.size === 0) {
        showMessage('❌ Сначала выберите файлы или папки в дереве файлов (вкладка "Поиск"), затем нажмите "Переместить"', 'error');
        return;
    }
    
    currentDestinationOperation = 'move';
    showDestinationModal('Перемещение файлов', 'Переместить');
}

// Confirm delete with dialog
function confirmDeleteTreeFiles() {
    if (selectedTreeFiles.size === 0) {
        showMessage('Выберите файлы для удаления', 'error');
        return;
    }
    
    const fileCount = selectedTreeFiles.size;
    const filesList = Array.from(selectedTreeFiles).map(item => item.path).join('\n');
    
    if (confirm(`Вы уверены, что хотите удалить ${fileCount} элементов?\n\n${filesList}\n\nЭто действие нельзя отменить.`)) {
        deleteTreeFiles();
    }
}

// Show archive dialog
function showArchiveDialog() {
    if (selectedTreeFiles.size === 0) {
        showMessage('❌ Сначала выберите файлы или папки в дереве файлов (вкладка "Поиск"), затем нажмите "Создать архив"', 'error');
        return;
    }
    
    showArchiveModal(Array.from(selectedTreeFiles));
}

// Delete selected tree files (internal function)
async function deleteTreeFiles() {
    try {
        showProgressModal('Удаление файлов', 'Удаление в процессе...');
        
        // Get actual file IDs from database (including children of intermediate folders)
        const fileIds = await getFilesForSelectedPaths();
        
        if (fileIds.length === 0) {
            closeProgressModal();
            showMessage('Нет файлов в базе данных для удаления', 'error');
            return;
        }
        
        // Use enhanced delete that removes both from disk and database
        const result = await apiCall('/files/delete-enhanced', {
            method: 'POST',
            body: JSON.stringify({ fileIds })
        });
        
        closeProgressModal();
        
        const successCount = result.results.filter(r => r.status === 'success').length;
        const errorCount = result.results.filter(r => r.status === 'error').length;
        
        if (successCount > 0) {
            showMessage(`Удаление завершено: ${successCount} файлов${errorCount > 0 ? `, ${errorCount} ошибок` : ''}`, 'success');
        } else {
            showMessage(`Удаление не удалось: ${errorCount} ошибок`, 'error');
        }
        
        // Clear selection and refresh tree and stats
        selectedTreeFiles.clear();
        updateTreeSelectedCount();
        refreshCurrentView();
        loadStats();
        
    } catch (error) {
        closeProgressModal();
        showMessage('Ошибка удаления: ' + error.message, 'error');
    }
}

// Current context menu target
let currentContextTarget = null;

// Toggle tree file selection
function toggleTreeFileSelection(fileId, checkbox) {
    const path = checkbox.getAttribute('data-path');
    const isDirectory = checkbox.getAttribute('data-is-directory') === 'true';
    const inDatabase = checkbox.getAttribute('data-in-database') === 'true';
    const existsOnDisk = checkbox.getAttribute('data-exists-on-disk') === 'true';
    
    // Get the tree node element
    const treeNode = checkbox.closest('.tree-node');
    
    if (checkbox.checked) {
        selectedTreeFiles.add({
            id: fileId,
            path: path,
            isDirectory: isDirectory,
            inDatabase: inDatabase,
            existsOnDisk: existsOnDisk
        });
        
        // Add visual selection to the row
        if (treeNode) {
            treeNode.classList.add('selected');
        }
    } else {
        // Remove from selection
        selectedTreeFiles.forEach(item => {
            if (item.id === fileId) {
                selectedTreeFiles.delete(item);
            }
        });
        
        // Remove visual selection from the row
        if (treeNode) {
            treeNode.classList.remove('selected');
        }
    }
    
    updateTreeSelectedCount();
}

// Show context menu
function showTreeContextMenu(event, fileId, path, isDirectory, inDatabase) {
    event.preventDefault();
    event.stopPropagation();
    
    const contextMenu = document.getElementById('tree-context-menu');
    const rescanItem = document.getElementById('context-rescan-item');
    
    // Store current target
    currentContextTarget = {
        id: fileId,
        path: path,
        isDirectory: isDirectory,
        inDatabase: inDatabase
    };
    
    // Show/hide Rescan option based on whether item is in database
    if (rescanItem) {
        if (inDatabase) {
            rescanItem.style.display = 'block';
        } else {
            rescanItem.style.display = 'none';
        }
    }
    
    // Position menu at mouse location
    contextMenu.style.left = event.pageX + 'px';
    contextMenu.style.top = event.pageY + 'px';
    contextMenu.style.display = 'block';
    
    // Hide menu when clicking elsewhere
    setTimeout(() => {
        document.addEventListener('click', hideContextMenu, { once: true });
        document.addEventListener('contextmenu', hideContextMenu, { once: true });
    }, 10);
    
    return false;
}

// Hide context menu
function hideContextMenu() {
    document.getElementById('tree-context-menu').style.display = 'none';
    currentContextTarget = null;
}

// Context menu actions
function contextCopyFile() {
    if (currentContextTarget) {
        // Don't clear selection, just ensure this file is selected
        ensureFileSelected(currentContextTarget);
        showCopyDialog();
    }
    hideContextMenu();
}

function contextMoveFile() {
    if (currentContextTarget) {
        // Don't clear selection, just ensure this file is selected
        ensureFileSelected(currentContextTarget);
        showMoveDialog();
    }
    hideContextMenu();
}

function contextDeleteFile() {
    if (currentContextTarget) {
        selectSingleFile(currentContextTarget);
        confirmDeleteTreeFiles();
    }
    hideContextMenu();
}

function contextArchiveFile() {
    if (currentContextTarget) {
        // Don't clear selection, just ensure this file is selected
        ensureFileSelected(currentContextTarget);
        showArchiveDialog();
    }
    hideContextMenu();
}

function contextIntegrityCheck() {
    if (currentContextTarget) {
        showIntegrityCheckModal(currentContextTarget.path);
    }
    hideContextMenu();
}

function contextRescan() {
    if (currentContextTarget) {
        // Ensure this file is selected
        ensureFileSelected(currentContextTarget);
        // Call rescan function
        rescanSelected();
    }
    hideContextMenu();
}

// Helper function to ensure file is selected (without clearing other selections)
function ensureFileSelected(target) {
    // Check if file is already selected
    let alreadySelected = false;
    selectedTreeFiles.forEach(selectedFile => {
        if (selectedFile.id === target.id) {
            alreadySelected = true;
        }
    });
    
    if (!alreadySelected) {
        // Add target to selection
        selectedTreeFiles.add(target);
        
        // Check the target's checkbox
        const checkbox = document.querySelector(`.tree-checkbox[data-file-id="${target.id}"]`);
        if (checkbox) {
            checkbox.checked = true;
        } else {
            // Try alternative selector
            const altCheckbox = document.querySelector(`[data-file-id="${target.id}"] .tree-checkbox`);
            if (altCheckbox) {
                altCheckbox.checked = true;
            }
        }
    }
    
    updateTreeSelectedCount();
}

// Helper function to select single file for context menu operations (legacy)
function selectSingleFile(target) {
    // Clear current selection
    selectedTreeFiles.clear();
    
    // Uncheck all checkboxes
    document.querySelectorAll('.tree-checkbox').forEach(cb => cb.checked = false);
    
    // Add target to selection
    selectedTreeFiles.add(target);
    
    // Check the target's checkbox
    const checkbox = document.querySelector(`.tree-checkbox[data-file-id="${target.id}"]`);
    if (checkbox) {
        checkbox.checked = true;
    } else {
        // Try alternative selector
        const altCheckbox = document.querySelector(`[data-file-id="${target.id}"] .tree-checkbox`);
        if (altCheckbox) {
            altCheckbox.checked = true;
        }
    }
    
    updateTreeSelectedCount();
}

// Update selected count and show/hide actions panel
function updateTreeSelectedCount() {
    const count = selectedTreeFiles.size;
    const countElement = document.getElementById('tree-selected-count');
    const actionsPanel = document.getElementById('tree-actions-panel');
    
    if (countElement) {
        countElement.textContent = `${count} элементов выбрано`;
    }
    
    if (actionsPanel) {
        if (count > 0) {
            actionsPanel.classList.add('show');
        } else {
            actionsPanel.classList.remove('show');
        }
    }
}

// Restore tree selection after re-render
function restoreTreeSelection() {
    console.log('Restoring tree selection for', selectedTreeFiles.size, 'items');
    
    selectedTreeFiles.forEach(selectedFile => {
        const checkbox = document.querySelector(`.tree-checkbox[data-file-id="${selectedFile.id}"]`);
        if (checkbox) {
            checkbox.checked = true;
            
            // Also restore visual selection on the tree node
            const treeNode = checkbox.closest('.tree-node');
            if (treeNode) {
                treeNode.classList.add('selected');
            }
            
            console.log('Restored checkbox for:', selectedFile.id);
        } else {
            // Try alternative selector
            const altCheckbox = document.querySelector(`[data-file-id="${selectedFile.id}"] .tree-checkbox`);
            if (altCheckbox) {
                altCheckbox.checked = true;
                
                // Also restore visual selection on the tree node
                const treeNode = altCheckbox.closest('.tree-node');
                if (treeNode) {
                    treeNode.classList.add('selected');
                }
                
                console.log('Restored checkbox with alternative selector for:', selectedFile.id);
            } else {
                console.warn('Could not find checkbox for:', selectedFile.id);
            }
        }
    });
}



// Make tree nodes focusable and add click handlers
function makeTreeNodesFocusable() {
    const treeNodes = document.querySelectorAll('.tree-node');
    treeNodes.forEach(node => {
        node.setAttribute('tabindex', '0');
        
        // Add click handler for selection
        node.addEventListener('click', function(event) {
            // Don't trigger if clicking on checkbox or expand icon
            if (event.target.classList.contains('tree-checkbox') || 
                event.target.classList.contains('tree-expand-icon')) {
                return;
            }
            
            // Remove selection from other nodes
            document.querySelectorAll('.tree-node.selected').forEach(n => {
                n.classList.remove('selected');
            });
            
            // Select this node
            this.classList.add('selected');
            this.focus();
            
            event.stopPropagation();
        });
        
        // Prevent default context menu on the node
        node.addEventListener('contextmenu', function(event) {
            event.preventDefault();
        });
    });
}

// Selected tree files
// let selectedTreeFiles = new Set();
 // MOVED TO: file-tree.js

// Helper function to get all selected items (from both table and tree views)
function getAllSelectedFiles() {
    // Extract IDs from tree files (which are objects)
    const treeFileIds = Array.from(selectedTreeFiles).map(item => item.id);
    // Combine with table file IDs
    const combined = new Set([...selectedFiles, ...treeFileIds]);
    return combined;
}

// Helper function to check if any files are selected
function hasSelectedFiles() {
    return selectedFiles.size > 0 || selectedTreeFiles.size > 0;
}

// Get selected database items (files/folders that are in database)
function getSelectedDatabaseItems() {
    const databaseItems = [];
    
    selectedTreeFiles.forEach(item => {
        // Only include items that are actually in the database
        if (item.inDatabase) {
            databaseItems.push({
                id: item.id,
                full_path: item.path,
                is_directory: item.isDirectory,
                exists_on_disk: item.existsOnDisk
            });
        }
    });
    
    return databaseItems;
}

// Clear selection
function clearSelection() {
    selectedTreeFiles.clear();
    
    // Uncheck all checkboxes
    document.querySelectorAll('.tree-checkbox').forEach(checkbox => {
        checkbox.checked = false;
    });
    
    updateTreeSelectedCount();
}

// Current operation type for destination modal
let currentDestinationOperation = null;

// Refresh current view (always tree)
function refreshCurrentView(forceRefresh = true) {
    const searchQuery = document.getElementById('search-input').value.trim();
    loadFileTree(searchQuery, forceRefresh);
}

// Search files (always in tree mode)
function searchFiles() {
    const searchQuery = document.getElementById('search-input').value.trim();
    loadFileTree(searchQuery);
}

// Handle search keyup
function handleSearchKeyup(event) {
    if (event.key === 'Enter') {
        searchFiles();
    }
}

// Delete file
async function deleteFile(fileId) {
    if (!confirm('Вы уверены, что хотите удалить эту запись?')) {
        return;
    }
    
    try {
        await apiCall(`/files/${fileId}`, { method: 'DELETE' });
        showMessage('Запись удалена', 'success');
        loadFiles();
        loadStats();
    } catch (error) {
        showMessage('Ошибка при удалении записи', 'error');
    }
}

// Backup database files (filestash.db, filestash.db-shm, filestash.db-wal)
async function backupDatabase() {
    if (!confirm('Создать резервную копию файлов базы данных?\n\nФайлы filestash.db, filestash.db-shm, filestash.db-wal будут заархивированы в формате 7z с максимальным сжатием.')) {
        return;
    }
    
    try {
        // Show progress modal
        showArchiveProgressModal();
        updateArchiveProgress(10, 'Подготовка...');
        appendArchiveLog('📦 Создание резервной копии файлов базы данных...');
        appendArchiveLog('📁 Файлы: filestash.db, filestash.db-shm, filestash.db-wal');
        appendArchiveLog('🗜️ Формат: 7Z (максимальное сжатие)');
        appendArchiveLog('📍 Папка: ./backups');
        appendArchiveLog('');
        
        updateArchiveProgress(30, 'Копирование файлов...');
        appendArchiveLog('📋 Копирование файлов базы данных...');
        
        const result = await apiCall('/database/backup', { method: 'POST' });
        
        updateArchiveProgress(100, 'Завершено');
        
        const archiveSizeMB = (result.archiveSize / 1024 / 1024).toFixed(2);
        
        appendArchiveLog('');
        appendArchiveLog('✅ Резервная копия создана успешно!');
        appendArchiveLog(`📁 Файл: ${result.filename}`);
        appendArchiveLog(`📊 Файлов: ${result.filesBackedUp}`);
        appendArchiveLog(`💾 Размер архива: ${archiveSizeMB} MB`);
        appendArchiveLog(`📍 Расположение: ./backups/${result.filename}`);
        
        document.getElementById('archive-close-btn').style.display = 'inline-block';
        
        showMessage('Резервная копия создана успешно!', 'success');
        
    } catch (error) {
        console.error('Backup error:', error);
        updateArchiveProgress(0, 'Ошибка');
        appendArchiveLog('');
        appendArchiveLog(`❌ Ошибка: ${error.message}`);
        document.getElementById('archive-close-btn').style.display = 'inline-block';
        showMessage(`Ошибка создания резервной копии: ${error.message}`, 'error');
    }
}

// Clear database
async function clearDatabase() {
    if (!confirm('Вы уверены, что хотите очистить всю базу данных? Это действие нельзя отменить.')) {
        return;
    }
    
    try {
        const result = await apiCall('/clear', { method: 'POST' });
        showMessage(result.message, 'success');
        loadFiles();
        loadStats();
    } catch (error) {
        showMessage('Ошибка при очистке базы данных', 'error');
    }
}

// Compact database - shrink database file size
async function compactDatabase() {
    if (!confirm('Сжать базу данных?\n\nЭто уменьшит размер файла базы данных, удалив неиспользуемое пространство.')) {
        return;
    }
    
    try {
        showMessage('Сжатие базы данных...', 'info');
        const result = await apiCall('/compact', { method: 'POST' });
        showMessage(result.message, 'success');
    } catch (error) {
        showMessage('Ошибка при сжатии базы данных: ' + error.message, 'error');
    }
}

// Cleanup database - remove records for non-existent files
async function cleanupDatabase() {
    if (!confirm('Очистить базу данных от записей о несуществующих файлах?\n\nЭто может занять некоторое время для больших баз данных.')) {
        return;
    }
    
    try {
        showProgressModal('Очистка базы данных', 'Проверка файлов на диске...');
        
        const result = await apiCall('/files/cleanup-database', { method: 'POST' });
        
        closeProgressModal();
        
        showMessage(
            `Очистка завершена!\n` +
            `Проверено файлов: ${result.totalFiles}\n` +
            `Удалено записей: ${result.removedFiles}\n` +
            `Осталось файлов: ${result.remainingFiles}`,
            'success'
        );
        
        // Refresh interface
        refreshCurrentView();
        loadStats();
        
    } catch (error) {
        closeProgressModal();
        showMessage('Ошибка при очистке базы данных: ' + error.message, 'error');
    }
}

// Show integrity check modal
function showIntegrityCheckModal(checkPath) {
    const modal = document.getElementById('integrity-check-modal');
    const pathDisplay = document.getElementById('check-path-display');
    const resultsDiv = document.getElementById('integrity-results');
    
    pathDisplay.textContent = checkPath;
    resultsDiv.style.display = 'none';
    
    // Reset checkboxes
    document.getElementById('check-existence').checked = true;
    document.getElementById('check-crc32').checked = true;
    
    modal.style.display = 'block';
}

// Close integrity check modal
function closeIntegrityCheckModal() {
    document.getElementById('integrity-check-modal').style.display = 'none';
}

// Start integrity check
// Global variable to store current integrity check ID
let currentIntegrityCheckId = null;

async function startIntegrityCheck() {
    const checkPath = document.getElementById('check-path-display').textContent;
    const checkExistence = document.getElementById('check-existence').checked;
    const checkCRC32 = document.getElementById('check-crc32').checked;
    const threadCount = document.getElementById('integrity-thread-count').value;
    const startBtn = document.getElementById('integrity-start-btn');
    const resultsDiv = document.getElementById('integrity-results');
    const progressSection = document.getElementById('integrity-progress-section');
    const stopBtn = document.getElementById('integrity-stop-btn');
    
    if (!checkExistence && !checkCRC32) {
        showMessage('Выберите хотя бы один тип проверки', 'error');
        return;
    }
    
    startBtn.disabled = true;
    startBtn.textContent = '⏳ Запуск...';
    resultsDiv.style.display = 'none';
    progressSection.style.display = 'block';
    stopBtn.style.display = 'inline-block';
    
    console.log('🚀 Starting integrity check, progress section shown:', progressSection.style.display);
    
    try {
        updateIntegrityProgress(0, 'Инициализация проверки...');
        
        const result = await apiCall('/files/integrity-check', {
            method: 'POST',
            body: JSON.stringify({
                path: checkPath,
                checkCRC32: checkCRC32,
                checkExistence: checkExistence,
                threads: threadCount
            })
        });
        
        if (result.checkId) {
            currentIntegrityCheckId = result.checkId;
            updateIntegrityProgress(0, `Проверка ${result.totalFiles} файлов с ${threadCount} потоками...`);
            
            // Monitor progress
            const finalResult = await monitorIntegrityProgress(result.checkId);
            
            // Hide progress section and show results
            progressSection.style.display = 'none';
            
            if (finalResult && finalResult.results) {
                displayIntegrityResults({
                    message: 'Integrity check completed',
                    totalFiles: finalResult.total,
                    results: finalResult.results,
                    logFile: finalResult.logFile
                });
            } else {
                showMessage('Проверка целостности завершена, но результаты недоступны', 'warning');
            }
        } else {
            showMessage('Не удалось запустить проверку целостности', 'error');
        }
        
    } catch (error) {
        showMessage('Ошибка при проверке целостности: ' + error.message, 'error');
    } finally {
        startBtn.disabled = false;
        startBtn.textContent = '🔍 Начать проверку';
        stopBtn.style.display = 'none';
        currentIntegrityCheckId = null;
    }
}

// Update integrity check progress
function updateIntegrityProgress(percentage, status, processed = 0, total = 0, speed = 0, timeElapsed = 0) {
    console.log(`🔄 Updating integrity progress: ${percentage}%, ${processed}/${total}, speed: ${speed}`);
    
    const progressFill = document.getElementById('integrity-progress-fill');
    const progressStatus = document.getElementById('integrity-progress-status');
    
    console.log('Progress elements found:', !!progressFill, !!progressStatus);
    
    if (progressFill) {
        progressFill.style.width = percentage + '%';
        progressFill.textContent = percentage + '%';
        console.log(`✅ Updated progress bar to ${percentage}%`);
    } else {
        console.error('❌ Progress fill element not found!');
    }
    
    if (progressStatus) {
        let statusText = status;
        
        // Add detailed progress info if available
        if (total > 0) {
            statusText = `Обработано: ${processed}/${total} файлов (${percentage}%)`;
            
            if (speed > 0) {
                statusText += ` | Скорость: ${speed} файлов/сек`;
            }
            
            if (timeElapsed > 0) {
                const timeText = formatScanTime(timeElapsed);
                statusText += ` | Время: ${timeText}`;
                
                // Calculate ETA
                if (speed > 0 && processed < total) {
                    const remaining = total - processed;
                    const etaSeconds = Math.round(remaining / speed);
                    if (etaSeconds > 0 && etaSeconds < 3600) {
                        statusText += ` | Осталось: ~${formatScanTime(etaSeconds)}`;
                    }
                }
            }
        }
        
        progressStatus.textContent = statusText;
        console.log(`✅ Updated status: ${statusText}`);
    } else {
        console.error('❌ Progress status element not found!');
    }
}

// Stop integrity check
async function stopIntegrityCheck() {
    if (!currentIntegrityCheckId) {
        showMessage('Нет активной проверки целостности для остановки', 'error');
        return;
    }
    
    try {
        const stopBtn = document.getElementById('integrity-stop-btn');
        stopBtn.disabled = true;
        stopBtn.textContent = '⏳ Остановка...';
        
        const result = await apiCall(`/files/integrity-check/stop/${currentIntegrityCheckId}`, { 
            method: 'POST'
        });
        
        updateIntegrityProgress(0, 'Запрос на остановку отправлен...');
        showMessage('Запрос на остановку проверки целостности отправлен...', 'info');
        
    } catch (error) {
        showMessage('Ошибка при остановке проверки целостности: ' + error.message, 'error');
        
        // Reset button state
        const stopBtn = document.getElementById('integrity-stop-btn');
        stopBtn.disabled = false;
        stopBtn.textContent = '⏹️ Остановить проверку';
    }
}

// Monitor integrity check progress
async function monitorIntegrityProgress(checkId) {
    return new Promise((resolve) => {
        const checkProgress = async () => {
            try {
                const progress = await apiCall(`/files/integrity-check/progress/${checkId}`);
                
                if (progress.total > 0) {
                    const percentage = Math.round((progress.processed / progress.total) * 100);
                    const currentTime = Date.now();
                    const elapsedTime = Math.round((currentTime - progress.startTime) / 1000);
                    
                    // Calculate processing speed
                    const itemsPerSecond = elapsedTime > 0 ? Math.round(progress.processed / elapsedTime) : 0;
                    
                    updateIntegrityProgress(
                        percentage, 
                        '', // Status will be generated automatically
                        progress.processed, 
                        progress.total, 
                        itemsPerSecond, 
                        elapsedTime
                    );
                }
                
                if (progress.status === 'completed' || progress.status === 'error' || progress.status === 'cancelled') {
                    // Hide stop button
                    document.getElementById('integrity-stop-btn').style.display = 'none';
                    currentIntegrityCheckId = null;
                    
                    // Show final status
                    if (progress.status === 'completed') {
                        const finalTime = progress.endTime ? formatScanTime(Math.round((progress.endTime - progress.startTime) / 1000)) : '';
                        updateIntegrityProgress(100, `Проверка завершена за ${finalTime}`);
                    } else if (progress.status === 'cancelled') {
                        const finalTime = progress.endTime ? formatScanTime(Math.round((progress.endTime - progress.startTime) / 1000)) : '';
                        updateIntegrityProgress(Math.round((progress.processed / progress.total) * 100), `Проверка остановлена за ${finalTime}. Обработано: ${progress.processed}/${progress.total} файлов`);
                    } else {
                        updateIntegrityProgress(0, 'Ошибка проверки');
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

// Display integrity check results
function displayIntegrityResults(result) {
    const resultsDiv = document.getElementById('integrity-results');
    const summaryDiv = document.getElementById('integrity-summary');
    const detailsDiv = document.getElementById('integrity-details');
    
    // Summary
    const { totalFiles, results } = result;
    const { missingFiles, crcMismatches, checkedFiles, renamedFiles } = results;
    
    summaryDiv.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 15px;">
            <div style="text-align: center; padding: 10px; background: #e3f2fd; border-radius: 4px;">
                <div style="font-size: 24px; font-weight: bold; color: #1976d2;">${checkedFiles}</div>
                <div style="font-size: 12px; color: #666;">Проверено файлов</div>
            </div>
            <div style="text-align: center; padding: 10px; background: #ffebee; border-radius: 4px;">
                <div style="font-size: 24px; font-weight: bold; color: #d32f2f;">${missingFiles.length}</div>
                <div style="font-size: 12px; color: #666;">Отсутствующих</div>
            </div>
            <div style="text-align: center; padding: 10px; background: #fff3e0; border-radius: 4px;">
                <div style="font-size: 24px; font-weight: bold; color: #f57c00;">${crcMismatches.length}</div>
                <div style="font-size: 12px; color: #666;">CRC несовпадений</div>
            </div>
            ${renamedFiles && renamedFiles.length > 0 ? `
            <div style="text-align: center; padding: 10px; background: #e8f5e0; border-radius: 4px;">
                <div style="font-size: 24px; font-weight: bold; color: #2e7d32;">${renamedFiles.length}</div>
                <div style="font-size: 12px; color: #666;">Переименованных</div>
            </div>
            ` : ''}
        </div>
    `;
    
    // Details
    let detailsHTML = '';
    
    if (missingFiles.length > 0) {
        detailsHTML += `
            <div style="margin-bottom: 20px;">
                <h5 style="color: #d32f2f; margin-bottom: 10px;">❌ Отсутствующие файлы (${missingFiles.length}):</h5>
                <div style="max-height: 150px; overflow-y: auto; border: 1px solid #ffcdd2; border-radius: 4px; padding: 10px; background: #ffebee;">
        `;
        missingFiles.forEach(file => {
            detailsHTML += `<div style="margin-bottom: 5px; font-family: monospace; font-size: 12px;">${file.path}</div>`;
        });
        detailsHTML += '</div></div>';
    }
    
    if (crcMismatches.length > 0) {
        detailsHTML += `
            <div style="margin-bottom: 20px;">
                <h5 style="color: #f57c00; margin-bottom: 10px;">⚠️ CRC32 несовпадения (${crcMismatches.length}):</h5>
                <div style="max-height: 150px; overflow-y: auto; border: 1px solid #ffcc02; border-radius: 4px; padding: 10px; background: #fff3e0;">
        `;
        crcMismatches.forEach(file => {
            detailsHTML += `
                <div style="margin-bottom: 10px; padding: 8px; border: 1px solid #ffb74d; border-radius: 4px; background: white;">
                    <div style="font-weight: bold; margin-bottom: 5px;">${file.filename}</div>
                    <div style="font-family: monospace; font-size: 11px; color: #666;">${file.path}</div>
                    <div style="margin-top: 5px; font-size: 12px;">
                        <span style="color: #666;">Оригинал:</span> <code>${file.originalCRC32}</code><br>
                        <span style="color: #666;">Текущий:</span> <code>${file.currentCRC32}</code>
                    </div>
                </div>
            `;
        });
        detailsHTML += '</div></div>';
    }
    
    if (renamedFiles && renamedFiles.length > 0) {
        detailsHTML += `
            <div style="margin-bottom: 20px;">
                <h5 style="color: #2e7d32; margin-bottom: 10px;">🔄 Переименованные файлы (${renamedFiles.length}):</h5>
                <div style="max-height: 150px; overflow-y: auto; border: 1px solid #c8e6c9; border-radius: 4px; padding: 10px; background: #e8f5e0;">
        `;
        renamedFiles.forEach(file => {
            detailsHTML += `
                <div style="margin-bottom: 10px; padding: 8px; border: 1px solid #81c784; border-radius: 4px; background: white;">
                    <div style="font-weight: bold; margin-bottom: 5px;">🔄 ${file.originalName} → ${file.newName}</div>
                    <div style="font-family: monospace; font-size: 11px; color: #666;">Было: ${file.originalPath}</div>
                    <div style="font-family: monospace; font-size: 11px; color: #666;">Стало: ${file.newPath}</div>
                    <div style="margin-top: 5px; font-size: 12px;">
                        <span style="color: #666;">CRC32:</span> <code>${file.crc32}</code> | 
                        <span style="color: #666;">Размер:</span> ${formatBytes(file.size)}
                    </div>
                </div>
            `;
        });
        detailsHTML += '</div></div>';
    }
    
    if (missingFiles.length === 0 && crcMismatches.length === 0) {
        detailsHTML = `
            <div style="text-align: center; padding: 20px; color: #2e7d32;">
                <div style="font-size: 48px; margin-bottom: 10px;">✅</div>
                <div style="font-size: 18px; font-weight: bold;">Все файлы в порядке!</div>
                <div style="font-size: 14px; color: #666;">Проблем не обнаружено</div>
            </div>
        `;
    }
    
    detailsDiv.innerHTML = detailsHTML;
    resultsDiv.style.display = 'block';
    
    // Show success message
    const issuesCount = missingFiles.length + crcMismatches.length;
    const renamedCount = renamedFiles ? renamedFiles.length : 0;
    if (issuesCount === 0 && renamedCount === 0) {
        showMessage('Проверка целостности завершена. Проблем не обнаружено!', 'success');
    } else if (issuesCount === 0 && renamedCount > 0) {
        showMessage(`Проверка завершена. Найдено ${renamedCount} переименованных файлов. Лог сохранен в папку scan-logs.`, 'info');
    } else {
        const message = `Проверка завершена. Обнаружено проблем: ${issuesCount}` + 
                       (renamedCount > 0 ? `, переименованных файлов: ${renamedCount}` : '') + 
                       '. Лог сохранен в папку scan-logs.';
        showMessage(message, 'warning');
    }
}



// Pagination
function updatePagination() {
    // This is a simplified pagination - in a real app you'd get total count from API
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const pageInfo = document.getElementById('page-info');
    
    prevBtn.disabled = currentPage <= 1;
    // nextBtn.disabled = files.length < pageSize; // Simplified logic
    
    pageInfo.textContent = `Страница ${currentPage}`;
}

function previousPage() {
    if (currentPage > 1) {
        currentPage--;
        loadFiles();
    }
}

function nextPage() {
    currentPage++;
    loadFiles();
}

// Change page size
function changePageSize() {
    const select = document.getElementById('page-size-select');
    pageSize = parseInt(select.value);
    currentPage = 1; // Reset to first page
    loadFiles();
}

// File selection functions
function toggleSelectAll() {
    const selectAllCheckbox = document.getElementById('select-all') || document.getElementById('header-select-all');
    const isChecked = selectAllCheckbox.checked;
    
    console.log('Toggle select all:', isChecked);
    
    // Clear current selection
    selectedFiles.clear();
    selectedTreeFiles.clear();
    
    // Update all file checkboxes (table view)
    document.querySelectorAll('.file-checkbox').forEach(checkbox => {
        checkbox.checked = isChecked;
        const fileId = parseInt(checkbox.dataset.fileId);
        
        if (isChecked) {
            selectedFiles.add(fileId);
            checkbox.closest('tr').classList.add('selected-row');
        } else {
            checkbox.closest('tr').classList.remove('selected-row');
        }
    });
    
    // Update all tree checkboxes (tree view)
    document.querySelectorAll('.tree-checkbox').forEach(checkbox => {
        checkbox.checked = isChecked;
        const fileId = checkbox.dataset.fileId;
        const path = checkbox.getAttribute('data-path');
        const isDirectory = checkbox.getAttribute('data-is-directory') === 'true';
        const inDatabase = checkbox.getAttribute('data-in-database') === 'true';
        const existsOnDisk = checkbox.getAttribute('data-exists-on-disk') === 'true';
        
        if (isChecked) {
            selectedTreeFiles.add({
                id: fileId,
                path: path,
                isDirectory: isDirectory,
                inDatabase: inDatabase,
                existsOnDisk: existsOnDisk
            });
            checkbox.closest('.tree-node')?.classList.add('selected');
        } else {
            // Remove from selection by finding matching object
            selectedTreeFiles.forEach(item => {
                if (item.id === fileId) {
                    selectedTreeFiles.delete(item);
                }
            });
            checkbox.closest('.tree-node')?.classList.remove('selected');
        }
    });
    
    // Sync both select all checkboxes
    const selectAllMain = document.getElementById('select-all');
    const selectAllHeader = document.getElementById('header-select-all');
    if (selectAllMain) selectAllMain.checked = isChecked;
    if (selectAllHeader) selectAllHeader.checked = isChecked;
    
    updateSelectedFilesCount();
    updateTreeSelectedCount();
}

function toggleFileSelection(fileId, checkbox) {
    if (checkbox.checked) {
        selectedFiles.add(fileId);
        checkbox.closest('tr').classList.add('selected-row');
    } else {
        selectedFiles.delete(fileId);
        checkbox.closest('tr').classList.remove('selected-row');
    }
    
    updateSelectedFilesCount();
    
    // Update select all checkbox
    const allCheckboxes = document.querySelectorAll('.file-checkbox');
    const checkedCheckboxes = document.querySelectorAll('.file-checkbox:checked');
    const selectAllCheckbox = document.getElementById('select-all') || document.getElementById('header-select-all');
    
    selectAllCheckbox.checked = allCheckboxes.length === checkedCheckboxes.length && allCheckboxes.length > 0;
}

function updateSelectedFilesCount() {
    const count = selectedFiles.size;
    const countElement = document.getElementById('selected-files-count');
    const actionsElement = document.getElementById('file-actions');
    
    if (countElement) {
        countElement.textContent = `${count} файлов выбрано`;
    }
    
    if (actionsElement) {
        actionsElement.style.display = count > 0 ? 'block' : 'none';
    }
}

// Modal functions
function showModal(title, content, confirmText = 'Подтвердить') {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = content;
    document.getElementById('modal-confirm-btn').textContent = confirmText;
    document.getElementById('file-operation-modal').style.display = 'block';
}

function closeModal() {
    document.getElementById('file-operation-modal').style.display = 'none';
    currentOperation = null;
}

function showProgressModal(title, status) {
    document.getElementById('progress-title').textContent = title;
    document.getElementById('progress-status').textContent = status;
    document.getElementById('progress-modal').style.display = 'block';
}

function closeProgressModal() {
    document.getElementById('progress-modal').style.display = 'none';
    
    // Clean up scan state
    document.getElementById('stop-scan-btn').style.display = 'none';
    const stopBtn = document.getElementById('stop-scan-btn');
    stopBtn.disabled = false;
    stopBtn.textContent = '⏹️ Остановить сканирование';
    currentScanId = null;
}

function updateProgress(percentage, status) {
    const progressFill = document.getElementById('progress-fill');
    const progressStatus = document.getElementById('progress-status');
    
    if (progressFill) {
        progressFill.style.width = percentage + '%';
        progressFill.textContent = percentage + '%';
    }
    
    if (progressStatus) {
        progressStatus.textContent = status;
    }
}

// File action functions
function openFileAction() {
    if (selectedFiles.size !== 1) {
        showMessage('Выберите один файл или папку для открытия', 'error');
        return;
    }
    
    const fileId = Array.from(selectedFiles)[0];
    const file = currentFiles.find(f => f.id === fileId);
    
    if (!file) {
        showMessage('Файл не найден', 'error');
        return;
    }
    
    if (file.is_directory) {
        // Open directory - show its contents
        currentSearch = `directory:"${file.full_path}"`;
        document.getElementById('search-input').value = file.full_path;
        searchFiles();
        showMessage(`Открыта папка: ${file.full_path}`, 'success');
    } else {
        // For files, show info and try to open
        const { shell } = require('electron');
        if (typeof shell !== 'undefined') {
            shell.openPath(file.full_path);
        } else {
            // Web version - show file info
            showModal(
                'Информация о файле',
                `
                <p><strong>Имя:</strong> ${file.filename}</p>
                <p><strong>Путь:</strong> ${file.full_path}</p>
                <p><strong>Размер:</strong> ${formatBytes(file.size)}</p>
                <p><strong>Расширение:</strong> ${file.extension}</p>
                <p><strong>Изменен:</strong> ${formatDate(file.modified_time)}</p>
                ${file.crc32 ? `<p><strong>CRC32:</strong> ${file.crc32}</p>` : ''}
                <p><em>В веб-версии файлы открываются через системные ассоциации.</em></p>
                `,
                'Закрыть'
            );
        }
    }
}

function copyFilesAction() {
    if (!hasSelectedFiles()) {
        showMessage('Выберите файлы для копирования', 'error');
        return;
    }
    
    const allSelected = getAllSelectedFiles();
    
    console.log('Copy action started, selected files:', Array.from(allSelected));
    
    currentOperation = 'copy';
    showModal(
        'Копирование файлов',
        `
        <p>Копировать ${allSelected.size} файлов в выбранную папку:</p>
        
        <div class="form-group">
            <label for="destination-path">Путь назначения:</label>
            <input type="text" id="destination-path" placeholder="Выберите папку ниже или введите путь" style="width: 100%; padding: 8px; margin-top: 5px;">
        </div>
        
        <div class="form-group">
            <label>Выберите папку:</label>
            <div id="file-browser" class="file-browser">
                <div class="file-browser-loading">Загрузка папок...</div>
            </div>
        </div>
        
        <div style="margin-top: 10px; font-size: 12px; color: #666;">
            💡 Дважды кликните на папку чтобы войти в неё, один клик - выбрать как место назначения
        </div>
        `,
        'Копировать'
    );
    
    // Load file browser after modal is shown
    setTimeout(() => loadFileBrowser(), 100);
}

function moveFilesAction() {
    if (!hasSelectedFiles()) {
        showMessage('Выберите файлы для перемещения', 'error');
        return;
    }
    
    const allSelected = getAllSelectedFiles();
    
    console.log('Move action started, selected files:', Array.from(allSelected));
    
    currentOperation = 'move';
    showModal(
        'Перемещение файлов',
        `
        <div style="background: #fff3cd; padding: 10px; border-radius: 4px; margin-bottom: 15px;">
            <strong>⚠️ ВНИМАНИЕ:</strong> Файлы будут перемещены (вырезаны) из текущего расположения!
        </div>
        
        <p>Переместить ${allSelected.size} файлов в выбранную папку:</p>
        
        <div class="form-group">
            <label for="destination-path">Путь назначения:</label>
            <input type="text" id="destination-path" placeholder="Выберите папку ниже или введите путь" style="width: 100%; padding: 8px; margin-top: 5px;">
        </div>
        
        <div class="form-group">
            <label>Выберите папку:</label>
            <div id="file-browser" class="file-browser">
                <div class="file-browser-loading">Загрузка папок...</div>
            </div>
        </div>
        
        <div style="margin-top: 10px; font-size: 12px; color: #666;">
            💡 Дважды кликните на папку чтобы войти в неё, один клик - выбрать как место назначения
        </div>
        `,
        'Переместить'
    );
    
    // Load file browser after modal is shown
    setTimeout(() => loadFileBrowser(), 100);
}

async function archiveFilesAction() {
    if (!hasSelectedFiles()) {
        showMessage('Выберите файлы для архивирования', 'error');
        return;
    }
    
    const allSelected = getAllSelectedFiles();
    
    // Check available archivers
    try {
        const archiversData = await apiCall('/archivers');
        availableArchivers = archiversData.archivers || [];
        
        if (!archiversData.available) {
            showModal(
                'Архиваторы не найдены',
                `
                <p style="color: #e74c3c;">⚠️ Внешние архиваторы не найдены!</p>
                <p>Для создания архивов необходимо установить один из следующих архиваторов:</p>
                <ul>
                    <li><strong>7-Zip</strong> - <a href="https://www.7-zip.org/" target="_blank">https://www.7-zip.org/</a></li>
                    <li><strong>WinRAR</strong> - <a href="https://www.win-rar.com/" target="_blank">https://www.win-rar.com/</a></li>
                </ul>
                <p>После установки перезапустите приложение.</p>
                `,
                'Понятно'
            );
            return;
        }
        
        currentOperation = 'archive';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        let archiverOptions = '';
        if (availableArchivers.length > 1) {
            archiverOptions = `
            <div class="form-group">
                <label for="archiver-select">Архиватор:</label>
                <select id="archiver-select" style="width: 100%;">
                    ${availableArchivers.map(arch => `<option value="${arch}">${arch === '7zip' ? '7-Zip (.7z)' : 'WinRAR (.rar)'}</option>`).join('')}
                </select>
            </div>
            `;
        }
        
        showModal(
            'Архивирование файлов',
            `
            <p>Создать архив из ${allSelected.size} файлов:</p>
            
            <div class="form-group">
                <label for="archive-name">Имя архива (без расширения):</label>
                <input type="text" id="archive-name" value="archive_${timestamp}" style="width: 100%; padding: 8px; margin-top: 5px;">
            </div>
            
            ${archiverOptions}
            
            <div class="form-group">
                <label for="destination-path">Папка для сохранения архива:</label>
                <input type="text" id="destination-path" placeholder="Выберите папку ниже или введите путь" style="width: 100%; padding: 8px; margin-top: 5px;">
            </div>
            
            <div class="form-group">
                <label>Выберите папку для сохранения:</label>
                <div id="file-browser" class="file-browser">
                    <div class="file-browser-loading">Загрузка папок...</div>
                </div>
            </div>
            
            <div style="margin-top: 10px; font-size: 12px; color: #666;">
                💡 Архив будет создан в консольном режиме без показа окна архиватора
            </div>
            `,
            'Создать архив'
        );
        
        // Load file browser after modal is shown
        setTimeout(() => loadFileBrowser(), 100);
        
    } catch (error) {
        showMessage('Ошибка проверки архиваторов: ' + error.message, 'error');
    }
}

function deleteFilesAction() {
    if (!hasSelectedFiles()) {
        showMessage('Выберите файлы для удаления', 'error');
        return;
    }
    
    const allSelected = getAllSelectedFiles();
    
    currentOperation = 'delete';
    showModal(
        'Удаление файлов',
        `
        <p style="color: #e74c3c; font-weight: bold;">⚠️ ВНИМАНИЕ!</p>
        <p>Вы собираетесь удалить ${allSelected.size} файлов с диска.</p>
        <p>Это действие нельзя отменить!</p>
        <p>Файлы будут удалены навсегда.</p>
        `,
        'Удалить навсегда'
    );
}

// Confirm operation
async function confirmOperation() {
    console.log('Confirm operation called, current operation:', currentOperation);
    
    if (!currentOperation) {
        showMessage('Нет активной операции', 'error');
        return;
    }
    
    const allSelected = getAllSelectedFiles();
    const fileIds = Array.from(allSelected);
    console.log('File IDs for operation:', fileIds);
    
    if (fileIds.length === 0) {
        showMessage('Нет выбранных файлов', 'error');
        return;
    }
    
    try {
        switch (currentOperation) {
            case 'copy':
                const copyDestination = document.getElementById('destination-path').value.trim();
                console.log('Copy destination:', copyDestination);
                
                if (!copyDestination) {
                    showMessage('Укажите путь назначения', 'error');
                    return;
                }
                
                closeModal();
                showProgressModal('Копирование файлов', 'Копирование в процессе...');
                
                console.log('Sending copy request...');
                const copyResult = await apiCall('/files/copy', {
                    method: 'POST',
                    body: JSON.stringify({ fileIds, destinationPath: copyDestination })
                });
                
                console.log('Copy result:', copyResult);
                closeProgressModal();
                
                const copySuccessCount = copyResult.results.filter(r => r.status === 'success').length;
                const copyErrorCount = copyResult.results.filter(r => r.status === 'error').length;
                
                if (copySuccessCount > 0) {
                    showMessage(`Копирование завершено: ${copySuccessCount} файлов успешно${copyErrorCount > 0 ? `, ${copyErrorCount} ошибок` : ''}`, 'success');
                } else {
                    showMessage(`Копирование не удалось: ${copyErrorCount} ошибок`, 'error');
                }
                break;
                
            case 'move':
                const moveDestination = document.getElementById('destination-path').value.trim();
                console.log('Move destination:', moveDestination);
                
                if (!moveDestination) {
                    showMessage('Укажите путь назначения', 'error');
                    return;
                }
                
                closeModal();
                showProgressModal('Перемещение файлов', 'Перемещение в процессе...');
                
                console.log('Sending move request...');
                const moveResult = await apiCall('/files/move', {
                    method: 'POST',
                    body: JSON.stringify({ fileIds, destinationPath: moveDestination })
                });
                
                console.log('Move result:', moveResult);
                closeProgressModal();
                
                const moveSuccessCount = moveResult.results.filter(r => r.status === 'success').length;
                const moveErrorCount = moveResult.results.filter(r => r.status === 'error').length;
                
                if (moveSuccessCount > 0) {
                    showMessage(`Перемещение завершено: ${moveSuccessCount} файлов успешно${moveErrorCount > 0 ? `, ${moveErrorCount} ошибок` : ''}`, 'success');
                    loadFiles(); // Reload to update paths
                } else {
                    showMessage(`Перемещение не удалось: ${moveErrorCount} ошибок`, 'error');
                }
                break;
                
            case 'archive':
                const archiveName = document.getElementById('archive-name').value.trim();
                if (!archiveName) {
                    showMessage('Укажите имя архива', 'error');
                    return;
                }
                
                const archiveDestination = document.getElementById('destination-path').value.trim();
                if (!archiveDestination) {
                    showMessage('Выберите папку для сохранения архива', 'error');
                    return;
                }
                
                const archiverSelect = document.getElementById('archiver-select');
                const selectedArchiver = archiverSelect ? archiverSelect.value : availableArchivers[0];
                
                showProgressModal('Создание архива', 'Архивирование в консольном режиме...');
                updateProgress(0, 'Запуск архиватора...');
                
                const archiveResult = await apiCall('/files/archive', {
                    method: 'POST',
                    body: JSON.stringify({ 
                        fileIds, 
                        archiveName,
                        archiver: selectedArchiver,
                        destinationPath: archiveDestination
                    })
                });
                
                closeProgressModal();
                showMessage(`Архив создан: ${archiveResult.archiveName} в ${archiveDestination} (${formatBytes(archiveResult.archiveSize)}) используя ${archiveResult.archiver}`, 'success');
                break;
                
            case 'delete':
                showProgressModal('Удаление файлов', 'Удаление в процессе...');
                const deleteResult = await apiCall('/files/delete', {
                    method: 'POST',
                    body: JSON.stringify({ fileIds })
                });
                closeProgressModal();
                showMessage(`Удаление завершено: ${deleteResult.results.filter(r => r.status === 'success').length} файлов`, 'success');
                loadFiles(); // Reload to remove deleted files
                loadStats(); // Update stats
                break;
        }
        
        // Clear selection
        selectedFiles.clear();
        updateSelectedFilesCount();
        
    } catch (error) {
        closeProgressModal();
        
        // Handle validation errors with suggestions
        if (error.message.includes('INVALID_DESTINATION') || error.message.includes('Access denied') || error.message.includes('operation not permitted')) {
            try {
                // Try to parse error response for suggestions
                const errorResponse = JSON.parse(error.message);
                if (errorResponse.suggestions) {
                    showPathSuggestionsModal(errorResponse.error, errorResponse.suggestions, currentOperation);
                    return;
                }
            } catch (e) {
                // Not a JSON error, show generic suggestions
            }
            
            showPathSuggestionsModal(
                'Нет доступа к указанной папке',
                [
                    `C:\\Users\\${navigator.userAgent.includes('Windows') ? process.env.USERNAME || 'User' : 'User'}\\Desktop\\FileStash-Copy`,
                    'C:\\Temp\\FileStash-Copy',
                    'C:\\FileStash-Copy'
                ],
                currentOperation
            );
        } else {
            showMessage(`Ошибка операции: ${error.message}`, 'error');
        }
    }
}

// Open directory (show its contents)
function openDirectory(directoryPath) {
    // Set search to show files in this directory
    document.getElementById('search-input').value = directoryPath;
    currentSearch = directoryPath;
    currentPage = 1;
    
    // Switch to search tab
    showTab('search');
    
    // Load files from this directory
    loadFiles();
    showMessage(`Открыта папка: ${directoryPath}`, 'success');
}

// Show path suggestions modal
function showPathSuggestionsModal(errorMessage, suggestions, operation) {
    const operationText = operation === 'copy' ? 'копирования' : 'перемещения';
    const operationAction = operation === 'copy' ? 'Копировать' : 'Переместить';
    
    showModal(
        `Ошибка ${operationText}`,
        `
        <div style="color: #e74c3c; margin-bottom: 15px;">
            <strong>⚠️ ${errorMessage}</strong>
        </div>
        
        <p>Попробуйте использовать один из безопасных путей:</p>
        
        <div style="margin: 15px 0;">
            ${suggestions.map((suggestion, index) => `
                <div style="margin: 8px 0; padding: 8px; background: #f8f9fa; border-radius: 4px; border-left: 3px solid #007bff;">
                    <code style="font-size: 13px;">${suggestion}</code>
                    <button onclick="useSuggestedPath('${suggestion.replace(/\\/g, '\\\\')}')" 
                            style="margin-left: 10px; padding: 2px 8px; font-size: 11px; background: #007bff; color: white; border: none; border-radius: 3px; cursor: pointer;">
                        Использовать
                    </button>
                </div>
            `).join('')}
        </div>
        
        <div style="margin-top: 15px; padding: 10px; background: #fff3cd; border-radius: 4px; font-size: 12px;">
            <strong>💡 Совет:</strong> Избегайте копирования в корень дисков (C:\\, E:\\) и системные папки. 
            Используйте папки в вашем профиле пользователя или создайте специальную папку для тестирования.
        </div>
        `,
        'Понятно'
    );
}

// File browser functions
async function loadFileBrowser(path = 'drives') {
    try {
        const response = await apiCall(`/directory-tree?path=${encodeURIComponent(path)}`);
        fileBrowserData = response.nodes || [];
        currentBrowserPath = response.currentPath || path;
        renderFileBrowserWithStatus();
    } catch (error) {
        console.error('Failed to load file browser:', error);
        document.getElementById('file-browser').innerHTML = 
            '<div class="file-browser-loading">Ошибка загрузки папок</div>';
    }
}

function renderFileBrowser() {
    const container = document.getElementById('file-browser');
    if (!container) return;
    
    let html = '';
    
    // Show current path
    if (currentBrowserPath !== 'drives') {
        html += `<div class="file-browser-path">📍 ${currentBrowserPath}</div>`;
        
        // Add back button
        const parentPath = currentBrowserPath.includes('\\') ? 
            currentBrowserPath.substring(0, currentBrowserPath.lastIndexOf('\\')) || 
            currentBrowserPath.substring(0, 3) : 'drives';
        
        html += `
            <div class="file-browser-item" onclick="navigateToPath('${parentPath.replace(/\\/g, '\\\\')}')">
                <span class="file-browser-icon">⬆️</span>
                <span class="file-browser-name">.. (Назад)</span>
            </div>
        `;
    }
    
    // Show directories
    fileBrowserData.forEach((item, index) => {
        const isSelected = selectedDestinationPath === item.path;
        html += `
            <div class="file-browser-item ${isSelected ? 'selected' : ''}" 
                 onclick="selectDestination('${item.path.replace(/\\/g, '\\\\')}', '${item.name}')"
                 ondblclick="navigateToPath('${item.path.replace(/\\/g, '\\\\')}')">
                <span class="file-browser-icon">${item.icon}</span>
                <span class="file-browser-name">${item.name}</span>
                ${item.hasChildren ? 
                    `<span class="file-browser-expand" onclick="event.stopPropagation(); navigateToPath('${item.path.replace(/\\/g, '\\\\')}')">▶</span>` : 
                    ''
                }
            </div>
        `;
    });
    
    if (fileBrowserData.length === 0) {
        html += '<div class="file-browser-loading">Папки не найдены</div>';
    }
    
    container.innerHTML = html;
}

// Duplicate function removed - using the async version above

function selectDestination(path, name) {
    selectedDestinationPath = path;
    
    // Update visual selection
    document.querySelectorAll('.file-browser-item').forEach(item => {
        item.classList.remove('selected');
    });
    event.target.closest('.file-browser-item').classList.add('selected');
    
    // Update path input if exists
    const pathInput = document.getElementById('destination-path');
    if (pathInput) {
        pathInput.value = path;
    }
    
    console.log('Selected destination:', path);
}

// Use suggested path
function useSuggestedPath(suggestedPath) {
    closeModal();
    
    // Re-open the appropriate modal with the suggested path
    if (currentOperation === 'copy') {
        copyFilesAction();
    } else if (currentOperation === 'move') {
        moveFilesAction();
    }
    
    // Set the suggested path after a small delay to ensure modal is open
    setTimeout(() => {
        const pathInput = document.getElementById('destination-path');
        if (pathInput) {
            pathInput.value = suggestedPath;
            pathInput.focus();
        }
    }, 100);
}

// Create test folder for copy/move operations
async function createTestFolder() {
    try {
        const testPath = 'C:\\FileStash-Test';
        const result = await apiCall('/create-test-folder', {
            method: 'POST',
            body: JSON.stringify({ path: testPath })
        });
        
        showMessage(`Тестовая папка создана: ${testPath}`, 'success');
    } catch (error) {
        // Fallback: show manual instructions
        showModal(
            'Создание тестовой папки',
            `
            <p>Создайте папку вручную для тестирования операций:</p>
            <ol>
                <li>Откройте Проводник Windows</li>
                <li>Перейдите на диск C:\\</li>
                <li>Создайте новую папку с именем "FileStash-Test"</li>
                <li>Используйте путь <code>C:\\FileStash-Test</code> при копировании/перемещении</li>
            </ol>
            <p><strong>Рекомендуемые безопасные пути:</strong></p>
            <ul>
                <li><code>C:\\Users\\${navigator.userAgent.includes('Windows') ? 'ВашеИмя' : 'Username'}\\Desktop\\FileStash-Test</code></li>
                <li><code>C:\\Temp\\FileStash-Test</code></li>
                <li><code>C:\\FileStash-Test</code></li>
            </ul>
            <div style="margin-top: 10px; padding: 8px; background: #fff3cd; border-radius: 4px; font-size: 12px;">
                <strong>⚠️ Избегайте:</strong> Корневые папки дисков (E:\\, F:\\) и системные папки требуют административных прав.
            </div>
            `,
            'Понятно'
        );
    }
}


// Load backup history
async function loadBackupHistory() {
    try {
        const result = await apiCall('/api/backups/list');
        const backups = result.backups || [];
        
        const container = document.getElementById('backup-history-container');
        if (!container) return;
        
        if (backups.length === 0) {
            container.innerHTML = '<p style="color: #888;">Резервные копии отсутствуют</p>';
            return;
        }
        
        let html = '<table style="width: 100%; border-collapse: collapse;">';
        html += '<thead><tr style="background: #f0f0f0; border-bottom: 2px solid #ddd;">';
        html += '<th style="padding: 10px; text-align: left;">Дата создания</th>';
        html += '<th style="padding: 10px; text-align: left;">Файл</th>';
        html += '<th style="padding: 10px; text-align: right;">Размер</th>';
        html += '<th style="padding: 10px; text-align: center;">Действия</th>';
        html += '</tr></thead><tbody>';
        
        backups.forEach(backup => {
            const sizeMB = (backup.size / 1024 / 1024).toFixed(2);
            html += '<tr style="border-bottom: 1px solid #eee;">';
            html += `<td style="padding: 10px;">${backup.createdFormatted}</td>`;
            html += `<td style="padding: 10px; font-family: monospace; font-size: 12px;">${backup.filename}</td>`;
            html += `<td style="padding: 10px; text-align: right;">${sizeMB} MB</td>`;
            html += `<td style="padding: 10px; text-align: center;">`;
            html += `<button class="btn btn-primary" onclick="restoreFromBackup('${backup.filename}')" style="padding: 5px 10px; font-size: 12px; margin-right: 5px;">📥 Восстановить</button>`;
            html += `<button class="btn btn-danger" onclick="deleteBackup('${backup.filename}')" style="padding: 5px 10px; font-size: 12px;">🗑️ Удалить</button>`;
            html += `</td>`;
            html += '</tr>';
        });
        
        html += '</tbody></table>';
        container.innerHTML = html;
        
    } catch (error) {
        console.error('Failed to load backup history:', error);
    }
}

// Restore from backup
async function restoreFromBackup(filename) {
    if (!confirm(
        `⚠️ ВНИМАНИЕ!\n\n` +
        `Восстановление базы данных из резервной копии:\n${filename}\n\n` +
        `Это действие:\n` +
        `1. Остановит сервер\n` +
        `2. Заменит текущую базу данных\n` +
        `3. Перезапустит сервер\n\n` +
        `Рекомендуется создать резервную копию текущей базы перед восстановлением!\n\n` +
        `Продолжить?`
    )) {
        return;
    }
    
    try {
        showMessage('Восстановление базы данных...', 'info');
        
        const result = await apiCall('/api/restore', {
            method: 'POST',
            body: JSON.stringify({ backupFile: filename })
        });
        
        showMessage(result.message, 'success');
        
        // Reload page after restore
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (error) {
        showMessage('Ошибка восстановления: ' + error.message, 'error');
    }
}

// Delete backup
async function deleteBackup(filename) {
    if (!confirm(`Удалить резервную копию:\n${filename}?`)) {
        return;
    }
    
    try {
        await apiCall('/api/backups/delete', {
            method: 'POST',
            body: JSON.stringify({ filename })
        });
        
        showMessage('Резервная копия удалена', 'success');
        loadBackupHistory();
        
    } catch (error) {
        showMessage('Ошибка удаления: ' + error.message, 'error');
    }
}

// Database status checking functions
let databaseStatusCache = new Map();
let databaseStatusDebounceTimer = null;

// Check database status for multiple paths
async function checkDatabaseStatus(paths) {
    if (!paths || paths.length === 0) {
        return {};
    }
    
    try {
        console.log('Checking database status for paths:', paths);
        const response = await apiCall('/files/database-status', {
            method: 'POST',
            body: JSON.stringify({ paths })
        });
        
        // Update cache
        Object.entries(response.statusMap).forEach(([path, status]) => {
            databaseStatusCache.set(path, status);
        });
        
        return response.statusMap;
    } catch (error) {
        console.error('Failed to check database status:', error);
        return {};
    }
}

// Apply database indicators to DOM elements
function applyDatabaseIndicators(statusMap) {
    if (!statusMap || Object.keys(statusMap).length === 0) {
        return;
    }
    
    console.log('Applying database indicators:', statusMap);
    
    // Apply to directory tree items
    document.querySelectorAll('.tree-item').forEach(item => {
        const folderName = item.querySelector('.folder-name');
        if (folderName) {
            // Find the corresponding directory data
            const dirPath = findDirectoryPath(folderName.textContent);
            if (dirPath && statusMap[dirPath]) {
                item.classList.add('in-database');
            } else {
                item.classList.remove('in-database');
            }
        }
    });
    
    // Apply to file browser items
    document.querySelectorAll('.file-browser-item').forEach(item => {
        const nameElement = item.querySelector('.file-browser-name');
        if (nameElement && nameElement.textContent !== '.. (Назад)') {
            // Get the full path from the item's onclick attribute
            const onclickAttr = item.getAttribute('onclick');
            if (onclickAttr) {
                const pathMatch = onclickAttr.match(/selectDestination\('([^']+)'/);
                if (pathMatch) {
                    const path = pathMatch[1].replace(/\\\\/g, '\\');
                    if (statusMap[path]) {
                        item.classList.add('in-database');
                    } else {
                        item.classList.remove('in-database');
                    }
                }
            }
        }
    });
}

// Find directory path by name (helper function)
function findDirectoryPath(name) {
    // Search in directoryTree for matching name
    function searchTree(dirs) {
        for (const dir of dirs) {
            if (dir.name === name) {
                return dir.path;
            }
            if (dir.children && dir.children.length > 0) {
                const found = searchTree(dir.children);
                if (found) return found;
            }
        }
        return null;
    }
    
    return searchTree(directoryTree);
}

// Get all visible directory paths (helper function)
function getAllVisiblePaths() {
    const paths = [];
    
    function collectPaths(dirs) {
        dirs.forEach(dir => {
            paths.push(dir.path);
            if (dir.expanded && dir.children.length > 0) {
                collectPaths(dir.children);
            }
        });
    }
    
    collectPaths(directoryTree);
    return paths;
}

// Debounced database status check
function debouncedDatabaseStatusCheck(paths) {
    if (databaseStatusDebounceTimer) {
        clearTimeout(databaseStatusDebounceTimer);
    }
    
    databaseStatusDebounceTimer = setTimeout(async () => {
        const statusMap = await checkDatabaseStatus(paths);
        applyDatabaseIndicators(statusMap);
    }, 300); // 300ms debounce
}

// Enhanced directory tree rendering with database status
async function renderDirectoryTreeWithStatus() {
    // First render the tree normally
    renderDirectoryTree();
    
    // Collect all visible directory paths
    const visiblePaths = getAllVisiblePaths();
    
    // Check database status for visible paths
    if (visiblePaths.length > 0) {
        debouncedDatabaseStatusCheck(visiblePaths);
    }
}

// Enhanced file browser rendering with database status
async function renderFileBrowserWithStatus() {
    // First render the browser normally
    renderFileBrowser();
    
    // Collect all visible paths
    const visiblePaths = fileBrowserData.map(item => item.path);
    
    // Check database status for visible paths
    if (visiblePaths.length > 0) {
        debouncedDatabaseStatusCheck(visiblePaths);
    }
}

// Database integrity check functions
let currentDatabaseIntegrityCheckId = null;

// Start database integrity check
async function checkDatabaseIntegrity() {
    const progressSection = document.getElementById('integrity-check-progress');
    const progressFill = document.getElementById('integrity-progress-fill');
    const progressStatus = document.getElementById('integrity-progress-status');
    const stopBtn = document.getElementById('integrity-stop-btn');
    
    // Show progress section
    progressSection.style.display = 'block';
    stopBtn.style.display = 'inline-block';
    
    // Reset progress
    progressFill.style.width = '0%';
    progressStatus.textContent = 'Инициализация проверки целостности...';
    
    try {
        console.log('🔍 Starting database integrity check...');
        
        const result = await apiCall('/database/integrity-check', {
            method: 'POST'
        });
        
        if (result.checkId) {
            currentDatabaseIntegrityCheckId = result.checkId;
            progressStatus.textContent = `Проверка ${result.totalFiles} записей в базе данных...`;
            
            // Monitor progress
            const finalResult = await monitorDatabaseIntegrityProgress(result.checkId);
            
            // Hide progress section and show results
            progressSection.style.display = 'none';
            
            if (finalResult && finalResult.results) {
                displayDatabaseIntegrityResults(finalResult.results);
            }
        }
        
    } catch (error) {
        console.error('❌ Database integrity check failed:', error);
        showMessage(`Ошибка проверки целостности: ${error.message}`, 'error');
        progressSection.style.display = 'none';
    } finally {
        currentDatabaseIntegrityCheckId = null;
        stopBtn.style.display = 'none';
    }
}

// Stop database integrity check
async function stopDatabaseIntegrityCheck() {
    if (!currentDatabaseIntegrityCheckId) {
        showMessage('Нет активной проверки целостности для остановки', 'error');
        return;
    }
    
    try {
        const stopBtn = document.getElementById('integrity-stop-btn');
        stopBtn.disabled = true;
        stopBtn.textContent = '⏳ Остановка...';
        
        const result = await apiCall(`/files/integrity-check/stop/${currentDatabaseIntegrityCheckId}`, { 
            method: 'POST'
        });
        
        const progressStatus = document.getElementById('integrity-progress-status');
        progressStatus.textContent = 'Запрос на остановку отправлен...';
        showMessage('Запрос на остановку проверки целостности отправлен...', 'info');
        
    } catch (error) {
        console.error('❌ Failed to stop integrity check:', error);
        showMessage(`Ошибка остановки проверки: ${error.message}`, 'error');
    } finally {
        // Reset button state
        const stopBtn = document.getElementById('integrity-stop-btn');
        stopBtn.disabled = false;
        stopBtn.textContent = '⏹️ Остановить проверку';
    }
}

// Monitor database integrity check progress
async function monitorDatabaseIntegrityProgress(checkId) {
    return new Promise((resolve) => {
        const checkProgress = async () => {
            try {
                const progress = await apiCall(`/files/integrity-check/progress/${checkId}`);
                
                if (progress.total > 0) {
                    const percentage = Math.round((progress.processed / progress.total) * 100);
                    const progressFill = document.getElementById('integrity-progress-fill');
                    const progressStatus = document.getElementById('integrity-progress-status');
                    
                    progressFill.style.width = `${percentage}%`;
                    
                    const elapsedTime = progress.startTime ? Math.round((Date.now() - progress.startTime) / 1000) : 0;
                    const itemsPerSecond = elapsedTime > 0 ? Math.round(progress.processed / elapsedTime) : 0;
                    
                    progressStatus.textContent = `Проверено ${progress.processed}/${progress.total} записей (${percentage}%) - ${itemsPerSecond} записей/сек`;
                }
                
                if (progress.status === 'completed' || progress.status === 'error' || progress.status === 'cancelled') {
                    // Hide stop button
                    document.getElementById('integrity-stop-btn').style.display = 'none';
                    currentDatabaseIntegrityCheckId = null;
                    
                    // Show final status
                    const progressStatus = document.getElementById('integrity-progress-status');
                    if (progress.status === 'completed') {
                        const finalTime = progress.endTime ? formatScanTime(Math.round((progress.endTime - progress.startTime) / 1000)) : '';
                        progressStatus.textContent = `Проверка завершена за ${finalTime}`;
                    } else if (progress.status === 'cancelled') {
                        const finalTime = progress.endTime ? formatScanTime(Math.round((progress.endTime - progress.startTime) / 1000)) : '';
                        progressStatus.textContent = `Проверка остановлена за ${finalTime}. Обработано: ${progress.processed}/${progress.total} записей`;
                    } else {
                        progressStatus.textContent = 'Ошибка проверки';
                    }
                    resolve(progress);
                } else {
                    setTimeout(checkProgress, 1000);
                }
            } catch (error) {
                console.error('❌ Error monitoring progress:', error);
                resolve(null);
            }
        };
        
        checkProgress();
    });
}

// Display database integrity check results
function displayDatabaseIntegrityResults(results) {
    const statusDiv = document.getElementById('settings-status');
    
    if (results.missingCount === 0) {
        statusDiv.innerHTML = `
            <div style="padding: 15px; background: #d4edda; border: 1px solid #c3e6cb; border-radius: 6px; color: #155724; margin-top: 15px;">
                <h4>✅ Проверка целостности завершена</h4>
                <p><strong>Все файлы найдены!</strong> Проверено записей: ${results.totalChecked}</p>
                <p>Все файлы и папки из базы данных существуют на диске.</p>
            </div>
        `;
    } else {
        statusDiv.innerHTML = `
            <div style="padding: 15px; background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px; color: #856404; margin-top: 15px;">
                <h4>⚠️ Проверка целостности завершена</h4>
                <p><strong>Найдено недостающих файлов:</strong> ${results.missingCount} из ${results.totalChecked}</p>
                <p><strong>Отчет сохранен в файл:</strong> <code>${results.reportFile}</code></p>
                <p>Записи в базе данных НЕ были удалены. Отчет содержит список всех недостающих файлов и папок.</p>
                <details style="margin-top: 10px;">
                    <summary style="cursor: pointer; font-weight: bold;">Показать первые 10 недостающих файлов</summary>
                    <ul style="margin-top: 10px; max-height: 200px; overflow-y: auto;">
                        ${results.missingFiles.slice(0, 10).map(file => 
                            `<li><code>${file.isDirectory ? '[DIR]' : '[FILE]'} ${file.path}</code></li>`
                        ).join('')}
                        ${results.missingFiles.length > 10 ? `<li><em>... и еще ${results.missingFiles.length - 10} файлов</em></li>` : ''}
                    </ul>
                </details>
            </div>
        `;
    }
    
    // Show success message
    if (results.missingCount === 0) {
        showMessage('Проверка целостности завершена. Все файлы найдены!', 'success');
    } else {
        showMessage(`Проверка целостности завершена. Найдено ${results.missingCount} недостающих файлов. Отчет сохранен в missed_files.txt`, 'warning');
    }
}

// Database restore functions

// Show database restore modal with list of available backups
async function showDatabaseRestoreModal() {
    try {
        // Get list of available database backups
        const result = await apiCall('/api/backups/list');
        const backups = result.backups || [];
        
        // Filter only 7z archives (database backups)
        const databaseBackups = backups.filter(b => b.filename.endsWith('.7z'));
        
        if (databaseBackups.length === 0) {
            showMessage('Резервные копии базы данных не найдены', 'warning');
            return;
        }
        
        // Create selection dialog
        let html = '<div style="max-width: 600px; margin: 20px auto;">';
        html += '<h3>Выберите резервную копию для восстановления</h3>';
        html += '<p style="color: #e74c3c; margin: 10px 0;"><strong>⚠️ ВНИМАНИЕ:</strong> Восстановление заменит текущие файлы базы данных!</p>';
        html += '<select id="backup-select" style="width: 100%; padding: 10px; margin: 10px 0; font-size: 14px;">';
        
        databaseBackups.forEach(backup => {
            const sizeMB = (backup.size / 1024 / 1024).toFixed(2);
            html += `<option value="${backup.filename}">${backup.createdFormatted} - ${backup.filename} (${sizeMB} MB)</option>`;
        });
        
        html += '</select>';
        html += '<div style="margin-top: 20px; text-align: right;">';
        html += '<button class="btn btn-secondary" onclick="closeMessage()" style="margin-right: 10px;">Отмена</button>';
        html += '<button class="btn btn-primary" onclick="restoreDatabaseFromBackup()">📥 Восстановить</button>';
        html += '</div>';
        html += '</div>';
        
        // Show in a custom modal
        const messageDiv = document.getElementById('message');
        messageDiv.innerHTML = html;
        messageDiv.className = 'message';
        messageDiv.style.display = 'block';
        
    } catch (error) {
        console.error('Error loading backups:', error);
        showMessage(`Ошибка загрузки списка резервных копий: ${error.message}`, 'error');
    }
}

// Restore database from selected backup
async function restoreDatabaseFromBackup() {
    const select = document.getElementById('backup-select');
    if (!select) return;
    
    const filename = select.value;
    
    if (!confirm(
        `⚠️ ВНИМАНИЕ!\n\n` +
        `Восстановление базы данных из резервной копии:\n${filename}\n\n` +
        `Это действие:\n` +
        `1. Распакует архив\n` +
        `2. Заменит текущие файлы базы данных\n` +
        `3. Потребует перезагрузки страницы\n\n` +
        `Продолжить?`
    )) {
        return;
    }
    
    try {
        closeMessage();
        showMessage('Восстановление базы данных...', 'info');
        
        const result = await apiCall('/database/restore', {
            method: 'POST',
            body: JSON.stringify({ filename })
        });
        
        showMessage(
            `✅ База данных восстановлена успешно!\n\n` +
            `Страница будет перезагружена через 3 секунды...`,
            'success'
        );
        
        // Reload page after 3 seconds
        setTimeout(() => {
            window.location.reload();
        }, 3000);
        
    } catch (error) {
        console.error('Restore error:', error);
        showMessage(`Ошибка восстановления: ${error.message}`, 'error');
    }
}

// Show restore modal (old JSON restore)
function showRestoreModal() {
    const modal = document.getElementById('restore-modal');
    const backupFileInput = document.getElementById('backup-file-path');
    
    // Clear previous input
    backupFileInput.value = '';
    
    // Set default to replace mode
    document.querySelector('input[name="restore-mode"][value="replace"]').checked = true;
    
    modal.style.display = 'block';
}

// Close restore modal
function closeRestoreModal() {
    document.getElementById('restore-modal').style.display = 'none';
}

// Start database restore
async function startRestore() {
    const backupFilePath = document.getElementById('backup-file-path').value.trim();
    const restoreMode = document.querySelector('input[name="restore-mode"]:checked').value;
    const startBtn = document.getElementById('restore-start-btn');
    
    if (!backupFilePath) {
        showMessage('Укажите путь к файлу резервной копии', 'error');
        return;
    }
    
    // Confirm the operation
    const modeText = restoreMode === 'replace' ? 'заменить все данные' : 'объединить с существующими данными';
    const confirmMessage = `Вы уверены, что хотите ${modeText} из файла:\n${backupFilePath}?\n\nЭта операция необратима!`;
    
    if (!confirm(confirmMessage)) {
        return;
    }
    
    // Disable button and show loading
    startBtn.disabled = true;
    startBtn.textContent = '⏳ Восстановление...';
    
    try {
        console.log(`🔄 Starting database restore from ${backupFilePath} in ${restoreMode} mode`);
        
        const result = await apiCall('/api/restore', {
            method: 'POST',
            body: JSON.stringify({
                backupFile: backupFilePath,
                mode: restoreMode
            })
        });
        
        console.log('✅ Restore completed:', result);
        
        // Close modal
        closeRestoreModal();
        
        // Show success message with details
        const details = `Восстановлено: ${result.restoredCount} записей`;
        const skipped = result.skippedCount > 0 ? `, пропущено: ${result.skippedCount}` : '';
        const errors = result.errorCount > 0 ? `, ошибок: ${result.errorCount}` : '';
        
        showMessage(`${result.message}. ${details}${skipped}${errors}`, 'success');
        
        // Reload stats and files
        loadStats();
        loadFiles();
        
        // If in tree view, reload tree
        if (document.getElementById('files-tree-container')) {
            loadFileTree('', true); // Force refresh
        }
        
    } catch (error) {
        console.error('❌ Database restore failed:', error);
        
        let errorMessage = 'Ошибка восстановления базы данных';
        if (error.message) {
            errorMessage += `: ${error.message}`;
        }
        
        showMessage(errorMessage, 'error');
    } finally {
        // Reset button
        startBtn.disabled = false;
        startBtn.textContent = '📥 Восстановить';
    }
}