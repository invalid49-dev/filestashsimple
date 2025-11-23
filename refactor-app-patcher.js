/**
 * Патчер для рефакторинга app.js
 * Создание модулей клиентской части
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Начало рефакторинга app.js...\n');

// Пути
const APP_FILE = path.join(__dirname, 'public', 'app.js');
const BACKUP_FILE = path.join(__dirname, 'public', 'app.js.backup');

// Создание бекапа
console.log('📋 Создание бекапа...');
if (!fs.existsSync(BACKUP_FILE)) {
    fs.copyFileSync(APP_FILE, BACKUP_FILE);
    console.log('✅ Бекап создан: public/app.js.backup\n');
} else {
    console.log('ℹ️  Бекап уже существует\n');
}

// Создание структуры директорий
console.log('📁 Создание структуры директорий...');
const jsDir = path.join(__dirname, 'public', 'js');
if (!fs.existsSync(jsDir)) {
    fs.mkdirSync(jsDir, { recursive: true });
    console.log('   ✅ Создана: public/js/\n');
} else {
    console.log('   ℹ️  Существует: public/js/\n');
}

// Читаем app.js
console.log('📖 Чтение app.js...');
const appContent = fs.readFileSync(APP_FILE, 'utf8');
const lines = appContent.split('\n').length;
console.log(`   📊 Всего строк: ${lines}\n`);

// ==================== МОДУЛЬ 1: api-client.js ====================
console.log('📦 Создание модуля: public/js/api-client.js');

const apiClientContent = `/**
 * API Client Module
 * Обёртка для взаимодействия с серверным API
 */

// API helper functions
async function apiCall(endpoint, options = {}) {
    console.log('API Call:', endpoint, options);
    
    try {
        const response = await fetch(\`/api\${endpoint}\`, {
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
                
                throw new Error(errorData.error || \`HTTP \${response.status}\`);
            } catch (e) {
                if (e.message.startsWith('{')) {
                    throw e;
                }
                throw new Error(\`HTTP \${response.status} - \${response.statusText}\`);
            }
        }
        
        const result = await response.json();
        console.log('API Response data:', result);
        return result;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { apiCall };
}
`;

fs.writeFileSync(path.join(jsDir, 'api-client.js'), apiClientContent);
console.log('   ✅ Создан: public/js/api-client.js\n');

// ==================== МОДУЛЬ 2: ui-utils.js ====================
console.log('📦 Создание модуля: public/js/ui-utils.js');

const uiUtilsContent = `/**
 * UI Utilities Module
 * Вспомогательные функции для UI
 */

// Message display
function showMessage(message, type = 'info') {
    const statusDiv = document.getElementById('scan-status');
    if (statusDiv) {
        statusDiv.innerHTML = \`<div class="\${type}">\${message}</div>\`;
        
        // Auto-hide success/error messages
        if (type === 'success' || type === 'error') {
            setTimeout(() => {
                statusDiv.innerHTML = '';
            }, 5000);
        }
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
        return \`\${seconds} сек\`;
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return \`\${minutes} мин \${remainingSeconds} сек\`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;
        return \`\${hours} ч \${minutes} мин \${remainingSeconds} сек\`;
    }
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

// Show/hide progress modal
function showProgressModal(title, message) {
    const modal = document.getElementById('progress-modal');
    if (modal) {
        document.getElementById('progress-title').textContent = title;
        document.getElementById('progress-message').textContent = message;
        document.getElementById('progress-fill').style.width = '0%';
        document.getElementById('progress-fill').textContent = '0%';
        modal.style.display = 'block';
    }
}

function closeProgressModal() {
    const modal = document.getElementById('progress-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function updateProgress(percentage, message) {
    const progressFill = document.getElementById('progress-fill');
    const progressMessage = document.getElementById('progress-message');
    
    if (progressFill) {
        progressFill.style.width = percentage + '%';
        progressFill.textContent = percentage + '%';
    }
    
    if (progressMessage && message) {
        progressMessage.textContent = message;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        showMessage,
        formatBytes,
        formatDate,
        formatScanTime,
        formatDateTime,
        getStatusText,
        showProgressModal,
        closeProgressModal,
        updateProgress
    };
}
`;

fs.writeFileSync(path.join(jsDir, 'ui-utils.js'), uiUtilsContent);
console.log('   ✅ Создан: public/js/ui-utils.js\n');

// ==================== МОДУЛЬ 3: file-tree.js ====================
console.log('📦 Создание модуля: public/js/file-tree.js');

const fileTreeContent = `/**
 * File Tree Module
 * Управление деревом файлов
 */

// Global state for file tree
let selectedTreeFiles = new Set();

// Load file tree
async function loadFileTree(rootPath = null) {
    try {
        const endpoint = rootPath ? \`/files/tree?rootPath=\${encodeURIComponent(rootPath)}\` : '/files/tree';
        const tree = await apiCall(endpoint);
        renderFileTree(tree);
    } catch (error) {
        console.error('Failed to load file tree:', error);
        showMessage('Ошибка загрузки дерева файлов', 'error');
    }
}

// Render file tree
function renderFileTree(tree) {
    const container = document.getElementById('file-tree');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!tree || Object.keys(tree).length === 0) {
        container.innerHTML = '<div class="loading">Нет файлов в базе данных</div>';
        return;
    }
    
    renderTreeNodes(tree, container, 0);
}

// Render tree nodes recursively
function renderTreeNodes(nodes, container, level) {
    Object.values(nodes).forEach(node => {
        const nodeElement = createTreeNode(node, level);
        container.appendChild(nodeElement);
    });
}

// Create tree node element
function createTreeNode(node, level) {
    const div = document.createElement('div');
    div.className = 'tree-node';
    div.style.paddingLeft = (level * 20) + 'px';
    
    const icon = node.isDirectory ? '📁' : '📄';
    const name = node.name || '';
    
    div.innerHTML = \`
        <span class="tree-icon">\${icon}</span>
        <span class="tree-name">\${name}</span>
    \`;
    
    // Add click handler
    div.onclick = (e) => {
        e.stopPropagation();
        toggleTreeNode(node);
    };
    
    return div;
}

// Toggle tree node
function toggleTreeNode(node) {
    if (node.isDirectory) {
        // Load children if not loaded
        if (!node.children) {
            loadTreeNodeChildren(node);
        } else {
            node.expanded = !node.expanded;
            renderFileTree(currentTree);
        }
    }
}

// Load children for tree node
async function loadTreeNodeChildren(node) {
    try {
        const children = await apiCall(\`/files/tree?rootPath=\${encodeURIComponent(node.path)}\`);
        node.children = children;
        node.expanded = true;
        renderFileTree(currentTree);
    } catch (error) {
        console.error('Failed to load children:', error);
        showMessage('Ошибка загрузки подпапок', 'error');
    }
}

// Update selected count
function updateTreeSelectedCount() {
    const countElement = document.getElementById('tree-selected-count');
    if (countElement) {
        countElement.textContent = selectedTreeFiles.size;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        loadFileTree,
        renderFileTree,
        updateTreeSelectedCount,
        selectedTreeFiles
    };
}
`;

fs.writeFileSync(path.join(jsDir, 'file-tree.js'), fileTreeContent);
console.log('   ✅ Создан: public/js/file-tree.js\n');

console.log('✅ Патчер успешно создал базовые модули!\n');
console.log('📝 Продолжение следует...\n');
