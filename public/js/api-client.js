/**
 * API Client Module
 * Обёртка для взаимодействия с серверным API
 */

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
        throw error;
    }
}

// Make globally available
window.apiCall = apiCall;

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { apiCall };
}
