/**
 * Патчер для добавления глобальных переменных и функций
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Добавление глобального доступа к переменным модулей...\n');

// 1. file-tree.js - сделать selectedTreeFiles глобальной
console.log('📝 Обновление file-tree.js...');
const fileTreePath = path.join(__dirname, 'public', 'js', 'file-tree.js');
let fileTreeContent = fs.readFileSync(fileTreePath, 'utf8');

// Заменить let на window.
fileTreeContent = fileTreeContent.replace(
    'let selectedTreeFiles = new Set();',
    'window.selectedTreeFiles = new Set();'
);

fs.writeFileSync(fileTreePath, fileTreeContent);
console.log('   ✅ selectedTreeFiles теперь глобальная\n');

// 2. api-client.js - сделать apiCall глобальной
console.log('📝 Обновление api-client.js...');
const apiClientPath = path.join(__dirname, 'public', 'js', 'api-client.js');
let apiClientContent = fs.readFileSync(apiClientPath, 'utf8');

// Добавить window.apiCall после определения функции
apiClientContent = apiClientContent.replace(
    '// Export for use in other modules',
    '// Make globally available\nwindow.apiCall = apiCall;\n\n// Export for use in other modules'
);

fs.writeFileSync(apiClientPath, apiClientContent);
console.log('   ✅ apiCall теперь глобальная\n');

// 3. ui-utils.js - сделать showMessage глобальной
console.log('📝 Обновление ui-utils.js...');
const uiUtilsPath = path.join(__dirname, 'public', 'js', 'ui-utils.js');
let uiUtilsContent = fs.readFileSync(uiUtilsPath, 'utf8');

// Добавить window. для всех функций
const functionsToGlobalize = [
    'showMessage',
    'formatBytes',
    'formatDate',
    'formatScanTime',
    'formatDateTime',
    'getStatusText',
    'showProgressModal',
    'closeProgressModal',
    'updateProgress'
];

let globalAssignments = '\n// Make globally available\n';
functionsToGlobalize.forEach(funcName => {
    globalAssignments += `window.${funcName} = ${funcName};\n`;
});
globalAssignments += '\n';

uiUtilsContent = uiUtilsContent.replace(
    '// Export for use in other modules',
    globalAssignments + '// Export for use in other modules'
);

fs.writeFileSync(uiUtilsPath, uiUtilsContent);
console.log('   ✅ UI функции теперь глобальные\n');

console.log('✅ Все переменные и функции теперь доступны глобально!\n');
