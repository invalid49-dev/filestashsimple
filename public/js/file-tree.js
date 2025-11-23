/**
 * File Tree Module
 * Управление деревом файлов
 */

// Global state for file tree
window.selectedTreeFiles = new Set();

// Load file tree
async function loadFileTree(rootPath = null) {
    try {
        const endpoint = rootPath ? `/files/tree?rootPath=${encodeURIComponent(rootPath)}` : '/files/tree';
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
    
    div.innerHTML = `
        <span class="tree-icon">${icon}</span>
        <span class="tree-name">${name}</span>
    `;
    
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
        const children = await apiCall(`/files/tree?rootPath=${encodeURIComponent(node.path)}`);
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
        countElement.textContent = window.selectedTreeFiles.size;
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
