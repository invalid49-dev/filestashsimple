/**
 * UI Utilities Module
 * Вспомогательные функции для UI
 */

// Message display
function showMessage(message, type = 'info') {
    const statusDiv = document.getElementById('scan-status');
    if (statusDiv) {
        statusDiv.innerHTML = `<div class="${type}">${message}</div>`;
        
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


// Make globally available
window.showMessage = showMessage;
window.formatBytes = formatBytes;
window.formatDate = formatDate;
window.formatScanTime = formatScanTime;
window.formatDateTime = formatDateTime;
window.getStatusText = getStatusText;
window.showProgressModal = showProgressModal;
window.closeProgressModal = closeProgressModal;
window.updateProgress = updateProgress;

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
