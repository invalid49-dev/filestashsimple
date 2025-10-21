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

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 FileStash Simple initialized');
    loadDrives();
    loadStats();
    loadFiles();
});

// Tab management
function showTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Show selected tab
    document.getElementById(tabName + '-tab').classList.add('active');
    event.target.classList.add('active');
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
    
    renderDirectoryTree();
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
    
    renderDirectoryTree();
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

// Expand all directories
async function expandAll() {
    showMessage('Разворачиваем все папки...', 'info');
    
    async function expandDir(dir) {
        if (!dir.expanded) {
            await toggleDirectory(dir);
            // Small delay to prevent overwhelming the server
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        // Expand children (limit depth to prevent infinite expansion)
        if (dir.children.length > 0) {
            for (const child of dir.children) {
                await expandDir(child);
            }
        }
    }
    
    try {
        for (const dir of directoryTree) {
            await expandDir(dir);
        }
        showMessage('Все папки развернуты', 'success');
    } catch (error) {
        showMessage('Ошибка при разворачивании папок', 'error');
    }
}

// Collapse all directories
function collapseAll() {
    function collapseDir(dir) {
        dir.expanded = false;
        dir.children.forEach(child => collapseDir(child));
    }
    
    directoryTree.forEach(dir => collapseDir(dir));
    renderDirectoryTree();
    showMessage('Все папки свернуты', 'success');
}

// Scan selected directories with batch processing
async function scanSelectedDirectories() {
    if (selectedDirectories.size === 0) {
        showMessage('Выберите папки для сканирования', 'error');
        return;
    }
    
    const threadCount = parseInt(document.getElementById('thread-count').value) || 4;
    const scanBtn = document.getElementById('scan-btn');
    scanBtn.disabled = true;
    scanBtn.textContent = 'Сканирование...';
    
    // Show progress modal
    showProgressModal('Пакетное сканирование', 'Инициализация сканирования...');
    
    try {
        const pathsArray = Array.from(selectedDirectories);
        updateProgress(0, `Сканирование ${pathsArray.length} папок...`);
        
        const result = await apiCall('/scan-multiple', { 
            method: 'POST',
            body: JSON.stringify({ 
                paths: pathsArray,
                threads: threadCount 
            })
        });
        
        if (result.scanId) {
            // Monitor progress
            await monitorScanProgress(result.scanId);
        }
        
        // Hide progress modal
        closeProgressModal();
        
        showMessage(`Сканирование завершено: ${pathsArray.length} папок обработано. Размер пакета: ${threadCount}`, 'success');
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
                    updateProgress(percentage, `Обработано: ${progress.processed}/${progress.total} папок`);
                }
                
                if (progress.status === 'completed' || progress.status === 'error') {
                    resolve();
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

// Search files
function searchFiles() {
    currentSearch = document.getElementById('search-input').value.trim();
    currentPage = 1;
    loadFiles();
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
    
    // Update all file checkboxes
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
    
    // Sync both select all checkboxes
    const selectAllMain = document.getElementById('select-all');
    const selectAllHeader = document.getElementById('header-select-all');
    if (selectAllMain) selectAllMain.checked = isChecked;
    if (selectAllHeader) selectAllHeader.checked = isChecked;
    
    updateSelectedFilesCount();
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
    if (selectedFiles.size === 0) {
        showMessage('Выберите файлы для копирования', 'error');
        return;
    }
    
    console.log('Copy action started, selected files:', Array.from(selectedFiles));
    
    currentOperation = 'copy';
    showModal(
        'Копирование файлов',
        `
        <p>Копировать ${selectedFiles.size} файлов в выбранную папку:</p>
        
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
    if (selectedFiles.size === 0) {
        showMessage('Выберите файлы для перемещения', 'error');
        return;
    }
    
    console.log('Move action started, selected files:', Array.from(selectedFiles));
    
    currentOperation = 'move';
    showModal(
        'Перемещение файлов',
        `
        <div style="background: #fff3cd; padding: 10px; border-radius: 4px; margin-bottom: 15px;">
            <strong>⚠️ ВНИМАНИЕ:</strong> Файлы будут перемещены (вырезаны) из текущего расположения!
        </div>
        
        <p>Переместить ${selectedFiles.size} файлов в выбранную папку:</p>
        
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
    if (selectedFiles.size === 0) {
        showMessage('Выберите файлы для архивирования', 'error');
        return;
    }
    
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
            <p>Создать архив из ${selectedFiles.size} файлов:</p>
            
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
    if (selectedFiles.size === 0) {
        showMessage('Выберите файлы для удаления', 'error');
        return;
    }
    
    currentOperation = 'delete';
    showModal(
        'Удаление файлов',
        `
        <p style="color: #e74c3c; font-weight: bold;">⚠️ ВНИМАНИЕ!</p>
        <p>Вы собираетесь удалить ${selectedFiles.size} файлов с диска.</p>
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
    
    const fileIds = Array.from(selectedFiles);
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
        renderFileBrowser();
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

function navigateToPath(path) {
    currentBrowserPath = path;
    loadFileBrowser(path);
}

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

// Backup database
async function backupDatabase() {
    try {
        showMessage('Создание резервной копии...', 'info');
        const result = await apiCall('/backup', { method: 'POST' });
        
        const statusDiv = document.getElementById('settings-status');
        statusDiv.innerHTML = `
            <div class="success">
                ✅ Резервная копия создана успешно<br>
                📁 Файл: ${result.filename}<br>
                📊 Записей: ${result.records}
            </div>
        `;
        
        showMessage(result.message, 'success');
    } catch (error) {
        showMessage('Ошибка создания резервной копии: ' + error.message, 'error');
    }
}