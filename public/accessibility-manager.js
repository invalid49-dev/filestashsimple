// Accessibility and Theme Manager

class AccessibilityManager {
    constructor() {
        this.currentTheme = 'light';
        this.fontSize = 100;
        this.highContrast = false;
        this.keyboardMode = false;
        
        this.loadPreferences();
        this.initializeKeyboardNavigation();
    }
    
    // Theme Management
    setTheme(theme) {
        this.currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        this.savePreferences();
        this.announceToScreenReader(`Тема изменена на ${theme}`);
        console.log(`🎨 Theme changed to: ${theme}`);
    }
    
    toggleTheme() {
        const themes = ['light', 'dark'];
        const currentIndex = themes.indexOf(this.currentTheme);
        const nextTheme = themes[(currentIndex + 1) % themes.length];
        this.setTheme(nextTheme);
    }
    
    toggleHighContrast() {
        this.highContrast = !this.highContrast;
        if (this.highContrast) {
            this.setTheme('high-contrast');
        } else {
            this.setTheme('light');
        }
    }
    
    // Font Size Management
    setFontSize(percentage) {
        // Clamp between 100% and 200%
        this.fontSize = Math.max(100, Math.min(200, percentage));
        
        // Remove all font size classes
        document.body.classList.remove(
            'font-size-110', 'font-size-120', 'font-size-130',
            'font-size-140', 'font-size-150', 'font-size-175', 'font-size-200'
        );
        
        // Add appropriate class
        if (this.fontSize > 100) {
            const roundedSize = Math.round(this.fontSize / 10) * 10;
            document.body.classList.add(`font-size-${roundedSize}`);
        }
        
        this.savePreferences();
        this.updateFontSizeDisplay();
        this.announceToScreenReader(`Размер шрифта: ${this.fontSize}%`);
        console.log(`📏 Font size changed to: ${this.fontSize}%`);
    }
    
    increaseFontSize() {
        this.setFontSize(this.fontSize + 10);
    }
    
    decreaseFontSize() {
        this.setFontSize(this.fontSize - 10);
    }
    
    resetFontSize() {
        this.setFontSize(100);
    }
    
    updateFontSizeDisplay() {
        const display = document.getElementById('font-size-display');
        if (display) {
            display.textContent = `${this.fontSize}%`;
        }
    }
    
    // Keyboard Navigation
    initializeKeyboardNavigation() {
        document.addEventListener('keydown', (e) => {
            // Enable keyboard mode on Tab press
            if (e.key === 'Tab') {
                this.keyboardMode = true;
                document.body.classList.add('keyboard-mode');
            }
            
            // Font size shortcuts
            if (e.ctrlKey || e.metaKey) {
                if (e.key === '+' || e.key === '=') {
                    e.preventDefault();
                    this.increaseFontSize();
                } else if (e.key === '-') {
                    e.preventDefault();
                    this.decreaseFontSize();
                } else if (e.key === '0') {
                    e.preventDefault();
                    this.resetFontSize();
                } else if (e.key === 'h' || e.key === 'H') {
                    e.preventDefault();
                    this.toggleHighContrast();
                }
            }
            
            // Escape key to close modals
            if (e.key === 'Escape') {
                this.closeAllModals();
            }
        });
        
        // Disable keyboard mode on mouse click
        document.addEventListener('mousedown', () => {
            this.keyboardMode = false;
            document.body.classList.remove('keyboard-mode');
        });
    }
    
    closeAllModals() {
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            modal.style.display = 'none';
        });
    }
    
    // Screen Reader Announcements
    announceToScreenReader(message) {
        const announcement = document.getElementById('sr-announcements');
        if (announcement) {
            announcement.textContent = message;
            
            // Clear after 1 second
            setTimeout(() => {
                announcement.textContent = '';
            }, 1000);
        }
    }
    
    // Preferences Management
    savePreferences() {
        const preferences = {
            theme: this.currentTheme,
            fontSize: this.fontSize,
            highContrast: this.highContrast
        };
        
        try {
            localStorage.setItem('accessibility-preferences', JSON.stringify(preferences));
            console.log('💾 Preferences saved:', preferences);
        } catch (error) {
            console.error('❌ Failed to save preferences:', error);
        }
    }
    
    loadPreferences() {
        try {
            const saved = localStorage.getItem('accessibility-preferences');
            if (saved) {
                const preferences = JSON.parse(saved);
                
                if (preferences.theme) {
                    this.setTheme(preferences.theme);
                }
                
                if (preferences.fontSize) {
                    this.setFontSize(preferences.fontSize);
                }
                
                if (preferences.highContrast !== undefined) {
                    this.highContrast = preferences.highContrast;
                }
                
                console.log('✅ Preferences loaded:', preferences);
            }
        } catch (error) {
            console.error('❌ Failed to load preferences:', error);
        }
    }
    
    // ARIA Attributes Helper
    updateAriaAttributes(element, attributes) {
        Object.keys(attributes).forEach(key => {
            element.setAttribute(`aria-${key}`, attributes[key]);
        });
    }
    
    // Focus Management
    setFocus(element) {
        if (element) {
            element.focus();
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
    
    // Keyboard Navigation for Lists
    handleListNavigation(event, items, currentIndex) {
        let newIndex = currentIndex;
        
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                newIndex = Math.min(currentIndex + 1, items.length - 1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                newIndex = Math.max(currentIndex - 1, 0);
                break;
            case 'Home':
                event.preventDefault();
                newIndex = 0;
                break;
            case 'End':
                event.preventDefault();
                newIndex = items.length - 1;
                break;
            default:
                return currentIndex;
        }
        
        if (items[newIndex]) {
            this.setFocus(items[newIndex]);
        }
        
        return newIndex;
    }
}

// Initialize on page load
let accessibilityManager;

document.addEventListener('DOMContentLoaded', () => {
    accessibilityManager = new AccessibilityManager();
    
    // Update display
    accessibilityManager.updateFontSizeDisplay();
    
    console.log('✅ Accessibility Manager initialized');
});

// Global functions for UI controls
function toggleTheme() {
    if (accessibilityManager) {
        accessibilityManager.toggleTheme();
    }
}

function toggleHighContrast() {
    if (accessibilityManager) {
        accessibilityManager.toggleHighContrast();
    }
}

function increaseFontSize() {
    if (accessibilityManager) {
        accessibilityManager.increaseFontSize();
    }
}

function decreaseFontSize() {
    if (accessibilityManager) {
        accessibilityManager.decreaseFontSize();
    }
}

function resetFontSize() {
    if (accessibilityManager) {
        accessibilityManager.resetFontSize();
    }
}
