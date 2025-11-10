# Design Document: UI and Performance Improvements

## Overview

This design implements a modern, accessible user interface with optimized performance for handling millions of files through lazy loading, virtual scrolling, and efficient database queries.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Client Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Accessibility│  │  Virtual     │  │   Theme      │  │
│  │   Manager    │  │  Scroller    │  │   Manager    │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │         Lazy Tree Loader                         │  │
│  │  - Node Cache                                    │  │
│  │  - Pagination Handler                            │  │
│  │  - Progressive Renderer                          │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────┐
│                    API Layer                             │
│  ┌──────────────────────────────────────────────────┐  │
│  │  /api/tree/lazy (GET)                            │  │
│  │  - Cursor-based pagination                       │  │
│  │  - Parent-child relationships                    │  │
│  │  - Limit: 1000 nodes per request                 │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────┐
│                  Database Layer                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Optimized Indexes:                              │  │
│  │  - idx_directory_filename                        │  │
│  │  - idx_full_path_prefix                          │  │
│  │  Query Cache (LRU, 100MB limit)                  │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Theme Manager

**Purpose:** Manages visual themes and accessibility settings

**Interface:**
```javascript
class ThemeManager {
  constructor() {
    this.currentTheme = 'light';
    this.fontSize = 100; // percentage
    this.highContrast = false;
  }
  
  setTheme(theme) // 'light' | 'dark' | 'high-contrast'
  setFontSize(percentage) // 100-200
  toggleHighContrast()
  applyTheme()
  savePreferences()
  loadPreferences()
}
```

**CSS Variables:**
```css
:root {
  --primary-color: #2563eb;
  --background: #ffffff;
  --text-primary: #1f2937;
  --text-secondary: #6b7280;
  --border-color: #e5e7eb;
  --focus-ring: 2px solid #2563eb;
  --font-size-base: 16px;
  --spacing-unit: 8px;
}

[data-theme="high-contrast"] {
  --primary-color: #0000ff;
  --background: #ffffff;
  --text-primary: #000000;
  --border-color: #000000;
  --focus-ring: 3px solid #0000ff;
}
```

### 2. Lazy Tree Loader

**Purpose:** Loads tree nodes on-demand with caching

**Interface:**
```javascript
class LazyTreeLoader {
  constructor(apiClient, cache) {
    this.apiClient = apiClient;
    this.cache = cache; // LRU cache
    this.loadingNodes = new Set();
  }
  
  async loadRootNodes()
  async loadChildren(parentPath, cursor = null)
  getCachedNode(path)
  invalidateCache(path)
  prefetchSiblings(path)
}
```

**API Endpoint:**
```
GET /api/tree/lazy?parent={path}&cursor={cursor}&limit=1000

Response:
{
  nodes: [
    {
      path: string,
      name: string,
      isDirectory: boolean,
      hasChildren: boolean,
      size: number,
      existsOnDisk: boolean,
      childCount: number
    }
  ],
  nextCursor: string | null,
  hasMore: boolean,
  totalCount: number
}
```

### 3. Virtual Scroller

**Purpose:** Renders only visible items for performance

**Interface:**
```javascript
class VirtualScroller {
  constructor(container, itemHeight, bufferSize = 50) {
    this.container = container;
    this.itemHeight = itemHeight;
    this.bufferSize = bufferSize;
    this.visibleRange = { start: 0, end: 0 };
  }
  
  setItems(items)
  scrollToIndex(index)
  getVisibleItems()
  updateVisibleRange()
  recycleElements()
}
```

**Implementation Strategy:**
- Use `transform: translateY()` for positioning
- Recycle DOM elements (pool of 100 elements)
- Update only changed items
- Debounce scroll events (16ms)

### 4. Accessibility Manager

**Purpose:** Handles keyboard navigation and ARIA attributes

**Interface:**
```javascript
class AccessibilityManager {
  constructor() {
    this.focusedElement = null;
    this.keyboardMode = false;
  }
  
  enableKeyboardNavigation()
  handleKeyPress(event)
  setFocusIndicator(element)
  announceToScreenReader(message)
  updateAriaAttributes(element, attrs)
}
```

**Keyboard Shortcuts:**
- `Arrow Up/Down`: Navigate tree
- `Arrow Right`: Expand node
- `Arrow Left`: Collapse node
- `Enter/Space`: Select node
- `Ctrl + Plus/Minus`: Adjust font size
- `Ctrl + H`: Toggle high contrast

## Data Models

### Tree Node (Client-side)
```typescript
interface TreeNode {
  path: string;
  name: string;
  isDirectory: boolean;
  hasChildren: boolean;
  childCount: number;
  children: TreeNode[] | null; // null = not loaded yet
  expanded: boolean;
  selected: boolean;
  existsOnDisk: boolean;
  size: number;
  level: number; // depth in tree
}
```

### Cache Entry
```typescript
interface CacheEntry {
  nodes: TreeNode[];
  timestamp: number;
  cursor: string | null;
  hasMore: boolean;
}
```

## Database Optimizations

### New Indexes
```sql
-- Composite index for directory queries
CREATE INDEX idx_directory_filename ON files(directory, filename);

-- Index for path prefix queries (for lazy loading)
CREATE INDEX idx_full_path_prefix ON files(full_path);

-- Index for counting children
CREATE INDEX idx_parent_count ON files(directory, is_directory);
```

### Optimized Query for Lazy Loading
```sql
-- Get children of a directory with pagination
SELECT 
  full_path,
  filename,
  is_directory,
  size,
  (SELECT COUNT(*) FROM files f2 WHERE f2.directory = files.full_path) as child_count
FROM files
WHERE directory = ?
ORDER BY is_directory DESC, filename ASC
LIMIT ? OFFSET ?;
```

### Query Cache Strategy
- Cache queries for 5 minutes
- LRU eviction policy
- Maximum 100MB cache size
- Invalidate on database modifications

## UI Components

### Modern Card Layout
```html
<div class="card">
  <div class="card-header">
    <h2>File Tree</h2>
    <div class="card-actions">
      <button class="icon-btn" aria-label="Refresh">🔄</button>
      <button class="icon-btn" aria-label="Settings">⚙️</button>
    </div>
  </div>
  <div class="card-body">
    <!-- Tree content -->
  </div>
</div>
```

### Skeleton Loader
```html
<div class="skeleton-tree">
  <div class="skeleton-item"></div>
  <div class="skeleton-item"></div>
  <div class="skeleton-item"></div>
</div>
```

### Accessibility Toolbar
```html
<div class="accessibility-toolbar">
  <button onclick="adjustFontSize(10)">A+</button>
  <button onclick="adjustFontSize(-10)">A-</button>
  <button onclick="toggleHighContrast()">High Contrast</button>
  <button onclick="toggleTheme()">🌙 Dark Mode</button>
</div>
```

## Performance Targets

### Loading Performance
- Initial page load: < 2 seconds
- Tree root load: < 500ms
- Node expansion: < 300ms
- Scroll frame rate: 60fps (16ms per frame)

### Memory Usage
- Maximum tree cache: 100MB
- Virtual scroller pool: 100 elements
- Query result cache: 100MB

### Database Performance
- Single query: < 100ms
- Index usage: 100% for tree queries
- Connection pool: 10 connections

## Error Handling

### Network Errors
- Retry failed requests (3 attempts, exponential backoff)
- Show error toast with retry button
- Cache last successful state

### Performance Degradation
- Disable animations if frame rate < 30fps
- Reduce buffer size if memory > 500MB
- Show warning if query > 1000ms

## Testing Strategy

### Performance Tests
- Load tree with 1 million nodes
- Measure time to expand 100 nodes
- Test scroll performance with 10,000 visible items
- Memory leak detection (24-hour test)

### Accessibility Tests
- Keyboard navigation (all features accessible)
- Screen reader compatibility (NVDA, JAWS)
- Color contrast validation (WCAG AA)
- Font scaling (up to 200%)

### Browser Compatibility
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Migration Strategy

### Phase 1: Backend Optimization
1. Add new database indexes
2. Implement lazy loading API endpoint
3. Add query caching layer

### Phase 2: Frontend Core
1. Implement lazy tree loader
2. Add virtual scroller
3. Update tree rendering logic

### Phase 3: UI Modernization
1. Apply new theme system
2. Update all components to card layout
3. Add skeleton loaders

### Phase 4: Accessibility
1. Implement accessibility manager
2. Add keyboard navigation
3. Add high contrast mode
4. Test with screen readers

### Phase 5: Testing & Optimization
1. Performance testing with large datasets
2. Accessibility audit
3. Browser compatibility testing
4. Production deployment

## Rollback Plan

- Keep old tree loading as fallback
- Feature flag for new UI
- Database indexes are additive (safe to add)
- Can disable lazy loading via config
