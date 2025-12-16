// HTML template for the visualization dashboard
import type { VisualizationData } from './index.js';

export function generateDashboardHTML(data: VisualizationData): string {
  // Escape JSON for safe embedding in HTML script tag
  // We use a script tag with type="application/json" to avoid parsing issues
  const jsonData = JSON.stringify(data)
    .replace(/</g, '\\u003c')         // Escape < to prevent </script> issues
    .replace(/>/g, '\\u003e')         // Escape > for safety
    .replace(/&/g, '\\u0026');        // Escape & for safety

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>aimem Dashboard - ${escapeHtml(data.project.name)}</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.28.1/cytoscape.min.js"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #1a1a2e;
      color: #eee;
      height: 100vh;
      overflow: hidden;
    }

    /* Header */
    .header {
      background: #16213e;
      padding: 12px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #0f3460;
    }

    .header h1 {
      font-size: 18px;
      font-weight: 500;
      color: #e94560;
    }

    .header h1 span {
      color: #eee;
      font-weight: 400;
    }

    .search-box {
      display: flex;
      gap: 8px;
    }

    .search-box input {
      background: #0f3460;
      border: 1px solid #1a1a2e;
      color: #eee;
      padding: 6px 12px;
      border-radius: 4px;
      width: 200px;
    }

    .search-box input::placeholder {
      color: #666;
    }

    /* View mode toggle */
    .view-toggle {
      display: flex;
      background: #0f3460;
      border-radius: 4px;
      overflow: hidden;
    }

    .view-toggle-btn {
      background: transparent;
      border: none;
      color: #888;
      padding: 6px 12px;
      cursor: pointer;
      font-size: 13px;
    }

    .view-toggle-btn:hover {
      color: #ccc;
    }

    .view-toggle-btn.active {
      background: #e94560;
      color: white;
    }

    .back-btn {
      background: #0f3460;
      border: 1px solid #1a1a2e;
      color: #aaa;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      display: none;
    }

    .back-btn:hover {
      background: #1a1a2e;
      color: #fff;
    }

    .back-btn.visible {
      display: inline-block;
    }

    .fullscreen-btn {
      background: #0f3460;
      border: 1px solid #1a1a2e;
      color: #aaa;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    }

    .fullscreen-btn:hover {
      background: #1a1a2e;
      color: #fff;
    }

    /* Fullscreen mode */
    body.fullscreen .sidebar,
    body.fullscreen .details-panel,
    body.fullscreen .header,
    body.fullscreen .tabs {
      display: none;
    }

    body.fullscreen .main {
      height: 100vh;
    }

    body.fullscreen .graph-container {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 1000;
    }

    body.fullscreen .view-description {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      z-index: 1001;
    }

    body.fullscreen .stats-bar {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 1001;
    }

    body.fullscreen .exit-fullscreen {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 1002;
      background: rgba(22, 33, 62, 0.9);
      color: #ccc;
      border: 1px solid #0f3460;
      padding: 10px 20px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      backdrop-filter: blur(4px);
      transition: all 0.2s ease;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    body.fullscreen .exit-fullscreen:hover {
      background: rgba(233, 69, 96, 0.9);
      color: white;
      border-color: #e94560;
    }

    /* Fullscreen details panel - slides in from right */
    body.fullscreen .details-panel {
      display: none;
      position: fixed;
      top: 60px;
      right: 16px;
      bottom: 16px;
      width: 380px;
      z-index: 1001;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      background: rgba(22, 33, 62, 0.95);
      backdrop-filter: blur(8px);
      border: 1px solid #0f3460;
    }

    body.fullscreen .details-panel.visible {
      display: flex;
    }

    body.fullscreen .details-panel .details-header {
      position: relative;
    }

    body.fullscreen .details-panel .close-details {
      display: block;
    }

    .close-details {
      display: none;
      background: none;
      border: none;
      color: #888;
      font-size: 20px;
      cursor: pointer;
      padding: 4px 8px;
    }

    .close-details:hover {
      color: #e94560;
    }

    /* Visualize button in details panel */
    .visualize-btn {
      background: #e94560;
      color: white;
      border: none;
      padding: 10px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      width: 100%;
      margin-top: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: background 0.2s;
    }

    .visualize-btn:hover {
      background: #d63d56;
    }

    .visualize-btn:disabled {
      background: #475569;
      cursor: not-allowed;
    }

    .visualize-btn-group {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }

    .visualize-btn-group .visualize-btn {
      flex: 1;
      margin-top: 0;
      padding: 8px 12px;
      font-size: 12px;
    }

    .visualize-btn-group .visualize-btn.secondary {
      background: #0f3460;
      color: #ccc;
    }

    .visualize-btn-group .visualize-btn.secondary:hover {
      background: #1a4a7a;
      color: #fff;
    }

    /* Smooth transitions for fullscreen */
    .main, .graph-container, #cy {
      transition: all 0.2s ease;
    }

    /* Tabs */
    .tabs {
      background: #16213e;
      display: flex;
      gap: 0;
      border-bottom: 1px solid #0f3460;
    }

    .tab {
      padding: 10px 20px;
      cursor: pointer;
      color: #888;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }

    .tab:hover {
      color: #ccc;
      background: rgba(233, 69, 96, 0.1);
    }

    .tab.active {
      color: #e94560;
      border-bottom-color: #e94560;
    }

    /* Main layout */
    .main {
      display: flex;
      height: calc(100vh - 90px);
      min-height: 0;
      overflow: hidden;
    }

    /* Sidebar */
    .sidebar {
      width: 220px;
      background: #16213e;
      padding: 16px;
      border-right: 1px solid #0f3460;
      overflow-y: auto;
    }

    .sidebar h3 {
      font-size: 12px;
      text-transform: uppercase;
      color: #666;
      margin-bottom: 12px;
    }

    .filter-group {
      margin-bottom: 20px;
    }

    .filter-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      cursor: pointer;
    }

    .filter-item input {
      accent-color: #e94560;
    }

    .filter-item label {
      font-size: 13px;
      cursor: pointer;
    }

    .filter-item .count {
      margin-left: auto;
      font-size: 11px;
      color: #666;
      background: #0f3460;
      padding: 2px 6px;
      border-radius: 10px;
    }

    .layout-select {
      width: 100%;
      background: #0f3460;
      border: 1px solid #1a1a2e;
      color: #eee;
      padding: 8px;
      border-radius: 4px;
      margin-top: 8px;
    }

    /* Graph container */
    .graph-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0; /* Important for flex overflow */
      min-width: 0;
      position: relative;
    }

    #cy {
      flex: 1;
      background: #1a1a2e;
      min-height: 0;
    }

    /* Details panel */
    .details-panel {
      width: 350px;
      background: #16213e;
      border-left: 1px solid #0f3460;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .details-header {
      padding: 12px 16px;
      border-bottom: 1px solid #0f3460;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .details-header h3 {
      font-size: 14px;
      font-weight: 500;
    }

    .details-content {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }

    .detail-row {
      margin-bottom: 12px;
    }

    .detail-label {
      font-size: 11px;
      text-transform: uppercase;
      color: #666;
      margin-bottom: 4px;
    }

    .detail-value {
      font-size: 13px;
      color: #eee;
    }

    .detail-value a {
      color: #e94560;
      text-decoration: none;
    }

    .detail-value a:hover {
      text-decoration: underline;
    }

    /* Code block */
    .code-block {
      background: #0f3460;
      border-radius: 4px;
      padding: 12px;
      font-family: 'Fira Code', 'Monaco', 'Consolas', monospace;
      font-size: 12px;
      line-height: 1.5;
      overflow-x: auto;
      white-space: pre;
      max-height: 300px;
      overflow-y: auto;
    }

    /* Tags */
    .tag {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 500;
    }

    .tag.function { background: #2563eb; color: white; }
    .tag.class { background: #7c3aed; color: white; }
    .tag.method { background: #0891b2; color: white; }
    .tag.interface { background: #059669; color: white; }
    .tag.type { background: #d97706; color: white; }
    .tag.variable { background: #dc2626; color: white; }
    .tag.module { background: #4f46e5; color: white; }
    .tag.file { background: #475569; color: white; }
    .tag.decision { background: #16a34a; color: white; }
    .tag.pattern { background: #0d9488; color: white; }
    .tag.rejection { background: #dc2626; color: white; }

    /* List view */
    #list-view {
      display: none;
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 16px;
      background: #1a1a2e;
      min-height: 0; /* Important for flex overflow */
    }

    #list-view.active {
      display: flex;
      flex-direction: column;
    }

    #list-view .list-content {
      flex: 1;
      overflow-y: auto;
    }

    #cy.hidden {
      display: none !important;
    }

    .list-section {
      margin-bottom: 24px;
    }

    .list-section h4 {
      font-size: 12px;
      text-transform: uppercase;
      color: #666;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #0f3460;
      position: sticky;
      top: 0;
      background: #1a1a2e;
      z-index: 10;
      padding-top: 8px;
    }

    .list-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 10px 12px;
      background: #16213e;
      border-radius: 4px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: background 0.2s;
      max-width: 100%;
      overflow: hidden;
    }

    .list-item:hover {
      background: #1e2a4a;
    }

    .list-item .tag {
      flex-shrink: 0;
    }

    .list-item-content {
      flex: 1;
      min-width: 0;
      overflow: hidden;
    }

    .list-item-name {
      font-weight: 500;
      color: #eee;
      margin-bottom: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .list-item-location {
      font-size: 12px;
      color: #666;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .list-item-signature {
      font-size: 11px;
      color: #888;
      font-family: 'Fira Code', monospace;
      margin-top: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Stats bar */
    .stats-bar {
      padding: 8px 16px;
      background: #0f3460;
      display: flex;
      gap: 20px;
      font-size: 12px;
      color: #888;
    }

    .stat {
      display: flex;
      gap: 4px;
    }

    .stat-value {
      color: #e94560;
      font-weight: 500;
    }

    /* Legend */
    .legend {
      position: absolute;
      bottom: 60px;
      left: 16px;
      background: rgba(22, 33, 62, 0.95);
      border: 1px solid #0f3460;
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 11px;
      z-index: 100;
      backdrop-filter: blur(4px);
      transition: opacity 0.2s;
    }

    /* Hide legend in list view */
    .legend.hidden {
      display: none;
    }

    .legend-title {
      font-weight: 600;
      color: #888;
      margin-bottom: 8px;
      text-transform: uppercase;
      font-size: 10px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 4px 0;
      color: #ccc;
    }

    .legend-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }

    .legend-shape {
      width: 16px;
      height: 10px;
      border-radius: 3px;
    }

    /* Breadcrumb */
    .breadcrumb {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: #0f3460;
      font-size: 12px;
      color: #888;
      border-bottom: 1px solid #1a1a2e;
    }

    .breadcrumb-item {
      color: #888;
      cursor: pointer;
      transition: color 0.2s;
    }

    .breadcrumb-item:hover {
      color: #e94560;
    }

    .breadcrumb-item.current {
      color: #eee;
      cursor: default;
    }

    .breadcrumb-sep {
      color: #444;
    }

    /* Tooltip */
    #tooltip {
      position: fixed;
      background: rgba(22, 33, 62, 0.98);
      border: 1px solid #0f3460;
      border-radius: 6px;
      padding: 10px 14px;
      font-size: 12px;
      color: #eee;
      pointer-events: none;
      z-index: 2000;
      max-width: 350px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      display: none;
    }

    #tooltip.visible {
      display: block;
    }

    #tooltip .tip-type {
      font-size: 10px;
      text-transform: uppercase;
      color: #888;
      margin-bottom: 4px;
    }

    #tooltip .tip-name {
      font-weight: 600;
      font-size: 14px;
      margin-bottom: 6px;
    }

    #tooltip .tip-location {
      font-size: 11px;
      color: #666;
      margin-bottom: 6px;
    }

    #tooltip .tip-hint {
      font-size: 10px;
      color: #e94560;
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid #0f3460;
    }

    /* Welcome overlay */
    .welcome-overlay {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(22, 33, 62, 0.98);
      border: 1px solid #0f3460;
      border-radius: 12px;
      padding: 32px 40px;
      text-align: center;
      z-index: 500;
      max-width: 400px;
    }

    .welcome-overlay h2 {
      color: #e94560;
      margin-bottom: 16px;
      font-size: 20px;
    }

    .welcome-overlay p {
      color: #aaa;
      margin-bottom: 12px;
      line-height: 1.5;
    }

    .welcome-overlay .hint {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: #0f3460;
      border-radius: 6px;
      margin: 8px 0;
      text-align: left;
      font-size: 13px;
    }

    .welcome-overlay .hint-icon {
      font-size: 18px;
    }

    .welcome-overlay button {
      background: #e94560;
      color: white;
      border: none;
      padding: 12px 32px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      margin-top: 16px;
    }

    .welcome-overlay button:hover {
      background: #d63d56;
    }

    /* View description */
    .view-description {
      padding: 10px 16px;
      background: #0f3460;
      border-bottom: 1px solid #1a1a2e;
      font-size: 13px;
      color: #aaa;
      line-height: 1.4;
    }

    .view-description strong {
      color: #e94560;
    }

    /* Empty state */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #666;
    }

    .empty-state h3 {
      margin-bottom: 8px;
    }

    /* Tooltip */
    .cy-tooltip {
      position: absolute;
      background: #16213e;
      border: 1px solid #0f3460;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      pointer-events: none;
      z-index: 1000;
      max-width: 300px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>aimem <span>Dashboard: ${escapeHtml(data.project.name)}</span></h1>
    <div class="search-box">
      <input type="text" id="search" placeholder="Search nodes...">
      <button class="back-btn" id="back-btn" title="Go back">← Back</button>
      <div class="view-toggle">
        <button class="view-toggle-btn active" data-mode="visual">Visual</button>
        <button class="view-toggle-btn" data-mode="list">List</button>
      </div>
      <button class="fullscreen-btn" id="fullscreen-btn" title="Toggle fullscreen">Fullscreen</button>
    </div>
  </div>

  <div class="tabs">
    <div class="tab active" data-view="overview">Overview</div>
    <div class="tab" data-view="callGraph">Call Graph</div>
    <div class="tab" data-view="dependencies">Dependencies</div>
    <div class="tab" data-view="classes">Classes</div>
    <div class="tab" data-view="decisions">Decisions</div>
  </div>

  <button class="exit-fullscreen" id="exit-fullscreen" style="display: none;">Exit Fullscreen (ESC)</button>

  <div class="main">
    <div class="sidebar">
      <div class="filter-group">
        <h3>Filter by Type</h3>
        <div class="filter-item">
          <input type="checkbox" id="filter-function" checked>
          <label for="filter-function">Functions</label>
          <span class="count">${data.stats.byType['function'] || 0}</span>
        </div>
        <div class="filter-item">
          <input type="checkbox" id="filter-class" checked>
          <label for="filter-class">Classes</label>
          <span class="count">${data.stats.byType['class'] || 0}</span>
        </div>
        <div class="filter-item">
          <input type="checkbox" id="filter-method" checked>
          <label for="filter-method">Methods</label>
          <span class="count">${data.stats.byType['method'] || 0}</span>
        </div>
        <div class="filter-item">
          <input type="checkbox" id="filter-interface" checked>
          <label for="filter-interface">Interfaces</label>
          <span class="count">${data.stats.byType['interface'] || 0}</span>
        </div>
        <div class="filter-item">
          <input type="checkbox" id="filter-type" checked>
          <label for="filter-type">Types</label>
          <span class="count">${data.stats.byType['type'] || 0}</span>
        </div>
        <div class="filter-item">
          <input type="checkbox" id="filter-file" checked>
          <label for="filter-file">Files</label>
          <span class="count">${data.stats.totalFiles}</span>
        </div>
      </div>

      <div class="filter-group">
        <h3>Layout</h3>
        <select class="layout-select" id="layout-select">
          <option value="grid">Grid</option>
          <option value="cose">Force Directed</option>
          <option value="breadthfirst">Hierarchical</option>
          <option value="circle">Circular</option>
          <option value="concentric">Concentric</option>
        </select>
      </div>

      <div class="filter-group" id="flow-mode-group" style="display: none;">
        <h3>Flow Mode</h3>
        <div class="filter-item">
          <input type="radio" name="flow-mode" id="flow-connections" value="connections" checked>
          <label for="flow-connections">Connections</label>
        </div>
        <div class="filter-item">
          <input type="radio" name="flow-mode" id="flow-downstream" value="downstream">
          <label for="flow-downstream">Downstream (calls)</label>
        </div>
        <div class="filter-item">
          <input type="radio" name="flow-mode" id="flow-upstream" value="upstream">
          <label for="flow-upstream">Upstream (callers)</label>
        </div>
        <p style="font-size: 11px; color: #666; margin-top: 8px;">Click a function to trace its flow</p>
      </div>
    </div>

    <div class="graph-container">
      <div class="breadcrumb" id="breadcrumb">
        <span class="breadcrumb-item current">Project</span>
      </div>
      <div class="view-description" id="view-description">
        <strong>Overview</strong> - All files in your codebase. Each node shows the file name and number of structures (functions, classes, etc.) it contains. Click a file to see details.
      </div>
      <div id="cy"></div>
      <div id="list-view"></div>

      <!-- Legend -->
      <div class="legend" id="legend">
        <div class="legend-title">Legend</div>
        <div class="legend-item"><span class="legend-shape" style="background: #475569;"></span> File</div>
        <div class="legend-item"><span class="legend-dot" style="background: #2563eb;"></span> Function</div>
        <div class="legend-item"><span class="legend-dot" style="background: #7c3aed;"></span> Class</div>
        <div class="legend-item"><span class="legend-dot" style="background: #0891b2;"></span> Method</div>
        <div class="legend-item"><span class="legend-dot" style="background: #059669;"></span> Interface</div>
      </div>

      <!-- Tooltip -->
      <div id="tooltip">
        <div class="tip-type"></div>
        <div class="tip-name"></div>
        <div class="tip-location"></div>
        <div class="tip-hint">Double-click to explore</div>
      </div>

      <!-- Welcome overlay (shown on first visit) -->
      <div class="welcome-overlay" id="welcome" style="display: none;">
        <h2>Explore Your Code</h2>
        <p>Navigate your codebase like a map:</p>
        <div class="hint"><strong>Click</strong> - See details and source code</div>
        <div class="hint"><strong>Double-click</strong> - Dive deeper into that item</div>
        <div class="hint"><strong>Hover</strong> - See what is connected</div>
        <div class="hint"><strong>Search</strong> - Find anything by name</div>
        <button onclick="dismissWelcome()">Start Exploring</button>
      </div>

      <div class="stats-bar">
        <div class="stat"><span class="stat-value">${data.stats.totalStructures}</span> structures</div>
        <div class="stat"><span class="stat-value">${data.stats.totalFiles}</span> files</div>
        <div class="stat"><span class="stat-value">${data.stats.totalLinks}</span> links</div>
        <div class="stat"><span class="stat-value">${data.stats.totalDecisions}</span> decisions</div>
      </div>
    </div>

    <div class="details-panel" id="details-panel">
      <div class="details-header">
        <h3>Details</h3>
        <button class="close-details" id="close-details" title="Close">&times;</button>
      </div>
      <div class="details-content" id="details-content">
        <div class="empty-state">
          <h3>No selection</h3>
          <p>Click a node to view details</p>
        </div>
      </div>
    </div>
  </div>

  <script id="viz-data" type="application/json">${jsonData}</script>
  <script>
    // Visualization data - parse from JSON script tag to avoid escaping issues
    const vizData = JSON.parse(document.getElementById('viz-data').textContent);

    // Initialize Cytoscape
    let cy = null;
    let currentView = 'overview';
    let currentViewMode = 'visual'; // 'visual' or 'list'

    // View descriptions - clear, action-oriented
    const viewDescriptions = {
      overview: '<strong>Files</strong> - Your codebase at a glance. Hover to see connections. <em>Double-click any file</em> to explore inside.',
      callGraph: '<strong>Call Graph</strong> - See how functions connect. Bigger nodes = more connections. <em>Double-click</em> to follow the flow.',
      dependencies: '<strong>Dependencies</strong> - File relationships. <em>Double-click</em> to see inside each file.',
      classes: '<strong>Classes</strong> - Your types and structures. <em>Double-click a class</em> to see its methods.',
      decisions: '<strong>Decisions</strong> - Why your code is the way it is. Connects decisions to the code they affect.',
    };

    // Store full graph data for focus mode filtering
    let fullCallGraphData = null;

    // Navigation history for back button
    let drillHistory = [];

    // Flow mode: 'connections' (default) or 'downstream' or 'upstream'
    let flowMode = 'connections';

    // Node colors
    const nodeColors = {
      function: '#2563eb',
      class: '#7c3aed',
      method: '#0891b2',
      interface: '#059669',
      type: '#d97706',
      variable: '#dc2626',
      module: '#4f46e5',
      file: '#475569',
      decision: '#16a34a',
      pattern: '#0d9488',
      rejection: '#dc2626',
    };

    // Cytoscape styles - node size based on weight (connections)
    const cyStyle = [
      {
        selector: 'node',
        style: {
          'label': 'data(label)',
          'text-valign': 'bottom',
          'text-halign': 'center',
          'font-size': '10px',
          'color': '#ccc',
          'text-margin-y': 4,
          'background-color': '#475569',
          'width': 'mapData(weight, 0, 10, 25, 60)',  // Size based on connections
          'height': 'mapData(weight, 0, 10, 25, 60)',
        }
      },
      {
        selector: 'node[type="function"]',
        style: { 'background-color': nodeColors.function }
      },
      {
        selector: 'node[type="class"]',
        style: { 'background-color': nodeColors.class, 'width': 40, 'height': 40 }
      },
      {
        selector: 'node[type="method"]',
        style: { 'background-color': nodeColors.method }
      },
      {
        selector: 'node[type="interface"]',
        style: { 'background-color': nodeColors.interface }
      },
      {
        selector: 'node[type="type"]',
        style: { 'background-color': nodeColors.type }
      },
      {
        selector: 'node[type="file"]',
        style: {
          'background-color': nodeColors.file,
          'width': 50,
          'height': 30,
          'shape': 'round-rectangle',
          'font-size': '11px',
          'text-wrap': 'ellipsis',
          'text-max-width': '80px',
        }
      },
      {
        selector: 'node[type="decision"]',
        style: { 'background-color': nodeColors.decision, 'shape': 'diamond' }
      },
      {
        selector: 'node[type="pattern"]',
        style: { 'background-color': nodeColors.pattern, 'shape': 'diamond' }
      },
      {
        selector: 'node[type="rejection"]',
        style: { 'background-color': nodeColors.rejection, 'shape': 'diamond' }
      },
      {
        selector: 'edge',
        style: {
          'width': 1.5,
          'line-color': '#334155',
          'target-arrow-color': '#334155',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'arrow-scale': 0.8,
        }
      },
      {
        selector: 'edge[type="calls"]',
        style: { 'line-color': '#2563eb', 'target-arrow-color': '#2563eb' }
      },
      {
        selector: 'edge[type="contains"]',
        style: { 'line-style': 'dashed', 'line-color': '#475569', 'target-arrow-shape': 'none' }
      },
      {
        selector: 'edge[type="decision"]',
        style: { 'line-color': '#16a34a', 'target-arrow-color': '#16a34a' }
      },
      {
        selector: ':selected',
        style: {
          'border-width': 3,
          'border-color': '#e94560',
        }
      },
      {
        selector: 'node.hover',
        style: {
          'border-width': 2,
          'border-color': '#e94560',
        }
      },
      {
        selector: 'node.faded',
        style: {
          'opacity': 0.2,
        }
      },
      {
        selector: 'edge.highlighted',
        style: {
          'width': 3,
          'line-color': '#e94560',
          'target-arrow-color': '#e94560',
          'z-index': 999,
        }
      },
      {
        selector: 'edge.faded',
        style: {
          'opacity': 0.1,
        }
      }
    ];

    function initCytoscape(graphData) {
      if (cy) {
        cy.destroy();
      }

      // Ensure all nodes have a weight for sizing
      const nodesWithWeight = graphData.nodes.map(n => ({
        ...n,
        data: {
          ...n.data,
          weight: n.data.weight || 1
        }
      }));

      cy = cytoscape({
        container: document.getElementById('cy'),
        elements: [...nodesWithWeight, ...graphData.edges],
        style: cyStyle,
        layout: { name: 'cose', animate: false, randomize: true },
        minZoom: 0.1,
        maxZoom: 3,
      });

      // Click handler
      cy.on('tap', 'node', function(evt) {
        const node = evt.target;
        const nodeData = node.data();
        showDetails(nodeData);

        // In call graph, handle flow mode
        if (currentView === 'callGraph' && fullCallGraphData && nodeData.id) {
          setTimeout(() => {
            if (node.selected()) {
              if (flowMode === 'downstream') {
                // Save history before tracing
                drillHistory.push({
                  view: currentView,
                  label: 'Call Graph',
                  description: document.getElementById('view-description').innerHTML
                });
                updateBackButton();
                updateBreadcrumb([{ label: 'Call Graph' }, { label: nodeData.label + ' (downstream)' }]);
                traceFlow(nodeData.id, 'downstream');
              } else if (flowMode === 'upstream') {
                // Save history before tracing
                drillHistory.push({
                  view: currentView,
                  label: 'Call Graph',
                  description: document.getElementById('view-description').innerHTML
                });
                updateBackButton();
                updateBreadcrumb([{ label: 'Call Graph' }, { label: nodeData.label + ' (upstream)' }]);
                traceFlow(nodeData.id, 'upstream');
              } else {
                // Default: focus on connections
                focusOnNode(nodeData.id);
              }
            }
          }, 300);
        }
      });

      // Double-click to drill down
      cy.on('dbltap', 'node', function(evt) {
        const nodeData = evt.target.data();
        drillDown(nodeData);
      });

      // Clear selection on background click
      cy.on('tap', function(evt) {
        if (evt.target === cy) {
          clearDetails();
        }
      });

      // Hover effects - show tooltip and highlight connections
      cy.on('mouseover', 'node', function(evt) {
        const node = evt.target;
        const nodeData = node.data();

        // Show tooltip
        showTooltip(evt.originalEvent, nodeData);

        // Highlight this node and its connections
        node.addClass('hover');

        // Get connected edges and nodes
        const connectedEdges = node.connectedEdges();
        const connectedNodes = connectedEdges.connectedNodes();

        // Fade everything else
        cy.elements().addClass('faded');
        node.removeClass('faded');
        connectedNodes.removeClass('faded');
        connectedEdges.removeClass('faded').addClass('highlighted');
      });

      cy.on('mouseout', 'node', function(evt) {
        hideTooltip();

        // Remove all highlight classes
        cy.elements().removeClass('faded hover highlighted');
      });

      // Update tooltip position on mouse move
      cy.on('mousemove', 'node', function(evt) {
        moveTooltip(evt.originalEvent);
      });

      runLayout();
    }

    function runLayout() {
      const layoutName = document.getElementById('layout-select').value;
      const nodeCount = cy.nodes(':visible').length;

      const layoutOptions = {
        name: layoutName,
        animate: nodeCount < 100,
        animationDuration: 300,
        nodeDimensionsIncludeLabels: true,
        fit: true,
        padding: 50,
      };

      // Layout-specific options for better spacing
      if (layoutName === 'cose') {
        Object.assign(layoutOptions, {
          nodeRepulsion: 8000,
          idealEdgeLength: 100,
          edgeElasticity: 100,
          nestingFactor: 1.2,
          gravity: 0.25,
          numIter: 1000,
          randomize: true,
        });
      } else if (layoutName === 'breadthfirst') {
        Object.assign(layoutOptions, {
          spacingFactor: 1.5,
          directed: true,
        });
      } else if (layoutName === 'circle') {
        Object.assign(layoutOptions, {
          spacingFactor: 1.2,
        });
      } else if (layoutName === 'grid') {
        Object.assign(layoutOptions, {
          spacingFactor: 1.5,
          condense: false,
        });
      } else if (layoutName === 'concentric') {
        Object.assign(layoutOptions, {
          spacingFactor: 2,
          minNodeSpacing: 50,
        });
      }

      cy.layout(layoutOptions).run();
    }

    // Store current selected node data for visualization buttons
    let currentSelectedData = null;

    function showDetails(data) {
      currentSelectedData = data;
      const content = document.getElementById('details-content');
      let html = '';

      // Type tag
      html += '<div class="detail-row">';
      html += '<span class="tag ' + data.type + '">' + data.type + '</span>';
      html += '</div>';

      // Name
      html += '<div class="detail-row">';
      html += '<div class="detail-label">Name</div>';
      html += '<div class="detail-value">' + escapeHtml(data.label) + '</div>';
      html += '</div>';

      // File location
      if (data.file) {
        html += '<div class="detail-row">';
        html += '<div class="detail-label">Location</div>';
        html += '<div class="detail-value">' + escapeHtml(data.file);
        if (data.line) {
          html += ':' + data.line;
        }
        html += '</div>';
        html += '</div>';
      }

      // Signature
      if (data.signature) {
        html += '<div class="detail-row">';
        html += '<div class="detail-label">Signature</div>';
        html += '<div class="detail-value"><code>' + escapeHtml(data.signature) + '</code></div>';
        html += '</div>';
      }

      // Visualize buttons for functions and methods
      if (data.type === 'function' || data.type === 'method') {
        html += '<div class="detail-row">';
        html += '<div class="detail-label">Visualize</div>';
        html += '<button class="visualize-btn" onclick="visualizeNode(\\'connections\\')">Show Connections</button>';
        html += '<div class="visualize-btn-group">';
        html += '<button class="visualize-btn secondary" onclick="visualizeNode(\\'downstream\\')">Trace Calls &#8594;</button>';
        html += '<button class="visualize-btn secondary" onclick="visualizeNode(\\'upstream\\')">&#8592; Trace Callers</button>';
        html += '</div>';
        html += '</div>';
      }
      // For files: show contents button
      else if (data.type === 'file') {
        html += '<div class="detail-row">';
        html += '<button class="visualize-btn" onclick="visualizeFile()">Show File Contents</button>';
        html += '</div>';
      }
      // For classes/interfaces: show methods button
      else if (data.type === 'class' || data.type === 'interface') {
        html += '<div class="detail-row">';
        html += '<button class="visualize-btn" onclick="visualizeClass()">Show Methods</button>';
        html += '</div>';
      }

      // Source code
      if (data.content) {
        html += '<div class="detail-row">';
        html += '<div class="detail-label">Source Code</div>';
        html += '<div class="code-block">' + escapeHtml(data.content) + '</div>';
        html += '</div>';
      }

      content.innerHTML = html;

      // Show panel in fullscreen mode
      if (document.body.classList.contains('fullscreen')) {
        document.getElementById('details-panel').classList.add('visible');
      }
    }

    // Visualize a node in the call graph
    function visualizeNode(mode) {
      if (!currentSelectedData) return;

      // Switch to visual mode if in list mode
      if (currentViewMode === 'list') {
        setViewMode('visual');
      }

      // Make sure we have call graph data
      fullCallGraphData = vizData.graphs.callGraph;

      // Save current state to history
      drillHistory.push({
        view: currentView,
        label: getBreadcrumbLabel(currentView),
        description: document.getElementById('view-description').innerHTML
      });
      updateBackButton();

      // Set flow mode and update UI
      flowMode = mode;
      document.querySelectorAll('input[name="flow-mode"]').forEach(radio => {
        radio.checked = radio.value === mode;
      });

      // Switch to call graph tab
      currentView = 'callGraph';
      document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.view === 'callGraph');
      });
      document.getElementById('flow-mode-group').style.display = 'block';

      // Perform the visualization
      if (mode === 'downstream') {
        updateBreadcrumb([{ label: 'Call Graph' }, { label: currentSelectedData.label + ' (downstream)' }]);
        traceFlow(currentSelectedData.id, 'downstream');
      } else if (mode === 'upstream') {
        updateBreadcrumb([{ label: 'Call Graph' }, { label: currentSelectedData.label + ' (upstream)' }]);
        traceFlow(currentSelectedData.id, 'upstream');
      } else {
        updateBreadcrumb([{ label: 'Call Graph' }, { label: currentSelectedData.label }]);
        focusOnNode(currentSelectedData.id);
      }
    }

    // Visualize file contents
    function visualizeFile() {
      if (!currentSelectedData || !currentSelectedData.file) return;

      // Switch to visual mode if in list mode
      if (currentViewMode === 'list') {
        setViewMode('visual');
      }

      drillDown(currentSelectedData);
    }

    // Visualize class methods
    function visualizeClass() {
      if (!currentSelectedData) return;

      // Switch to visual mode if in list mode
      if (currentViewMode === 'list') {
        setViewMode('visual');
      }

      drillDown(currentSelectedData);
    }

    function clearDetails() {
      document.getElementById('details-content').innerHTML = \`
        <div class="empty-state">
          <h3>No selection</h3>
          <p>Click a node to view details</p>
        </div>
      \`;
      // Hide panel in fullscreen mode
      document.getElementById('details-panel').classList.remove('visible');
    }

    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Tooltip functions
    function showTooltip(event, nodeData) {
      const tooltip = document.getElementById('tooltip');
      tooltip.querySelector('.tip-type').textContent = nodeData.type || '';
      tooltip.querySelector('.tip-name').textContent = nodeData.label || '';

      let location = '';
      if (nodeData.file) {
        location = nodeData.file.split('/').pop();
        if (nodeData.line) location += ':' + nodeData.line;
      }
      tooltip.querySelector('.tip-location').textContent = location;

      // Update hint based on type
      const hint = tooltip.querySelector('.tip-hint');
      if (nodeData.type === 'file') {
        hint.textContent = 'Double-click to see contents';
      } else if (nodeData.type === 'class' || nodeData.type === 'interface') {
        hint.textContent = 'Double-click to see methods';
      } else if (nodeData.type === 'function' || nodeData.type === 'method') {
        hint.textContent = 'Double-click to see call graph';
      } else {
        hint.textContent = 'Double-click to explore';
      }

      tooltip.classList.add('visible');
      moveTooltip(event);
    }

    function moveTooltip(event) {
      const tooltip = document.getElementById('tooltip');
      const x = event.clientX + 15;
      const y = event.clientY + 15;

      // Keep tooltip on screen
      const rect = tooltip.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width - 10;
      const maxY = window.innerHeight - rect.height - 10;

      tooltip.style.left = Math.min(x, maxX) + 'px';
      tooltip.style.top = Math.min(y, maxY) + 'px';
    }

    function hideTooltip() {
      document.getElementById('tooltip').classList.remove('visible');
    }

    // Breadcrumb functions
    function updateBreadcrumb(items) {
      const bc = document.getElementById('breadcrumb');
      let html = '';

      items.forEach((item, i) => {
        if (i > 0) html += '<span class="breadcrumb-sep">›</span>';

        const isLast = i === items.length - 1;
        if (isLast) {
          html += '<span class="breadcrumb-item current">' + escapeHtml(item.label) + '</span>';
        } else {
          html += '<span class="breadcrumb-item" onclick="goBackTo(' + i + ')">' + escapeHtml(item.label) + '</span>';
        }
      });

      bc.innerHTML = html;
    }

    function goBackTo(index) {
      // Pop history until we reach the target index
      while (drillHistory.length > index) {
        drillHistory.pop();
      }
      updateBackButton();

      if (drillHistory.length === 0) {
        switchView(currentView);
      } else {
        const target = drillHistory[drillHistory.length - 1];
        drillHistory.pop();
        switchView(target.view);
      }
    }

    // Welcome overlay
    function dismissWelcome() {
      document.getElementById('welcome').style.display = 'none';
      localStorage.setItem('aimem-welcome-dismissed', 'true');
    }

    function maybeShowWelcome() {
      if (!localStorage.getItem('aimem-welcome-dismissed')) {
        document.getElementById('welcome').style.display = 'block';
      }
    }

    function switchView(view) {
      currentView = view;

      // Update tabs
      document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.view === view);
      });

      // Update description
      document.getElementById('view-description').innerHTML = viewDescriptions[view] || '';

      // Show/hide flow mode controls for Call Graph
      const flowModeGroup = document.getElementById('flow-mode-group');
      if (view === 'callGraph') {
        flowModeGroup.style.display = 'block';
      } else {
        flowModeGroup.style.display = 'none';
      }

      // Special handling for call graph - focus mode
      if (view === 'callGraph') {
        fullCallGraphData = vizData.graphs.callGraph;
        if (cy) cy.destroy();

        // Find entry points: functions that call others but aren't called themselves
        const entryPoints = findEntryPoints();

        if (entryPoints.length > 0) {
          // Show entry points view
          showEntryPoints(entryPoints);
        } else {
          const stats = fullCallGraphData ? fullCallGraphData.nodes.length + ' functions, ' + fullCallGraphData.edges.length + ' call relationships' : 'No data';
          document.getElementById('cy').innerHTML =
            '<div class="empty-state">' +
              '<h3>Search for a function</h3>' +
              '<p>Type a function name in the search box above to explore its call relationships</p>' +
              '<p style="margin-top: 16px; font-size: 12px; color: #666;">' + stats + '</p>' +
            '</div>';
        }
        // Re-render list view if in list mode
        if (currentViewMode === 'list') {
          renderListView();
        }
        clearDetails();
        return;
      }

      fullCallGraphData = null;

      // Load graph data
      const graphData = vizData.graphs[view];
      if (graphData && (graphData.nodes.length > 0 || graphData.edges.length > 0)) {
        initCytoscape(graphData);
      } else {
        if (cy) cy.destroy();
        document.getElementById('cy').innerHTML = \`
          <div class="empty-state">
            <h3>No data</h3>
            <p>No nodes to display for this view</p>
          </div>
        \`;
      }

      // Re-render list view if in list mode
      if (currentViewMode === 'list') {
        renderListView();
      }

      clearDetails();
    }

    // Find entry points: functions that call others but aren't called
    function findEntryPoints() {
      if (!fullCallGraphData || !fullCallGraphData.edges.length) return [];

      const callers = new Set();  // nodes that call something
      const callees = new Set();  // nodes that are called

      for (const edge of fullCallGraphData.edges) {
        callers.add(edge.data.source);
        callees.add(edge.data.target);
      }

      // Entry points: call others but aren't called
      const entryPointIds = [];
      for (const callerId of callers) {
        if (!callees.has(callerId)) {
          entryPointIds.push(callerId);
        }
      }

      // Get the actual nodes, sorted by number of outgoing calls
      const outgoingCounts = {};
      for (const edge of fullCallGraphData.edges) {
        outgoingCounts[edge.data.source] = (outgoingCounts[edge.data.source] || 0) + 1;
      }

      return fullCallGraphData.nodes
        .filter(n => entryPointIds.includes(n.data.id))
        .sort((a, b) => (outgoingCounts[b.data.id] || 0) - (outgoingCounts[a.data.id] || 0));
    }

    // Show entry points with their immediate callees
    function showEntryPoints(entryPoints) {
      // Take top entry points (most outgoing calls)
      const topEntries = entryPoints.slice(0, 10);
      const entryIds = new Set(topEntries.map(n => n.data.id));

      // Get edges from entry points
      const relevantEdges = fullCallGraphData.edges.filter(e => entryIds.has(e.data.source));

      // Get called nodes
      const calledIds = new Set();
      for (const edge of relevantEdges) {
        calledIds.add(edge.data.target);
      }

      // Build node set
      const nodeIds = new Set([...entryIds, ...calledIds]);
      const nodes = fullCallGraphData.nodes.filter(n => nodeIds.has(n.data.id));

      if (nodes.length > 0) {
        initCytoscape({ nodes, edges: relevantEdges });

        // Update description
        document.getElementById('view-description').innerHTML =
          '<strong>Entry Points</strong> - Functions that call others but are not called. These are typically command handlers or main functions. Click any node to explore further.';
      }
    }

    // Focus mode: show only a node and its direct connections
    function focusOnNode(nodeId) {
      if (!fullCallGraphData) return;

      const nodeIdStr = nodeId.startsWith('structure:') ? nodeId : 'structure:' + nodeId;

      // Find the center node
      const centerNode = fullCallGraphData.nodes.find(n => n.data.id === nodeIdStr);
      if (!centerNode) return;

      // Find all edges connected to this node
      const connectedEdges = fullCallGraphData.edges.filter(e =>
        e.data.source === nodeIdStr || e.data.target === nodeIdStr
      );

      // Find all connected node IDs
      const connectedNodeIds = new Set([nodeIdStr]);
      for (const edge of connectedEdges) {
        connectedNodeIds.add(edge.data.source);
        connectedNodeIds.add(edge.data.target);
      }

      // Build focused graph
      const focusedNodes = fullCallGraphData.nodes.filter(n => connectedNodeIds.has(n.data.id));
      const focusedGraph = {
        nodes: focusedNodes,
        edges: connectedEdges,
      };

      if (focusedNodes.length > 0) {
        initCytoscape(focusedGraph);

        // Highlight the center node
        setTimeout(() => {
          if (cy) {
            const centerEle = cy.getElementById(nodeIdStr);
            if (centerEle) {
              centerEle.select();
              showDetails(centerEle.data());
            }
          }
        }, 100);
      }
    }

    // Trace code flow from a starting node
    function traceFlow(nodeId, direction) {
      if (!fullCallGraphData) return;

      const nodeIdStr = nodeId.startsWith('structure:') ? nodeId : 'structure:' + nodeId;
      const visited = new Set();
      const nodesToInclude = new Set([nodeIdStr]);
      const edgesToInclude = [];

      // BFS to trace flow
      const queue = [nodeIdStr];
      const maxDepth = 5; // Limit depth to avoid overwhelming
      const depthMap = { [nodeIdStr]: 0 };

      while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current)) continue;
        visited.add(current);

        const currentDepth = depthMap[current] || 0;
        if (currentDepth >= maxDepth) continue;

        for (const edge of fullCallGraphData.edges) {
          let nextNode = null;

          if (direction === 'downstream' && edge.data.source === current) {
            // Following calls: source -> target
            nextNode = edge.data.target;
          } else if (direction === 'upstream' && edge.data.target === current) {
            // Following callers: target <- source
            nextNode = edge.data.source;
          }

          if (nextNode && !visited.has(nextNode)) {
            nodesToInclude.add(nextNode);
            edgesToInclude.push(edge);
            queue.push(nextNode);
            depthMap[nextNode] = currentDepth + 1;
          }
        }
      }

      // Build flow graph
      const flowNodes = fullCallGraphData.nodes.filter(n => nodesToInclude.has(n.data.id));
      const flowGraph = {
        nodes: flowNodes,
        edges: edgesToInclude,
      };

      if (flowNodes.length > 0) {
        initCytoscape(flowGraph);

        // Use hierarchical layout for flow
        setTimeout(() => {
          if (cy) {
            cy.layout({
              name: 'breadthfirst',
              directed: true,
              roots: direction === 'downstream' ? [nodeIdStr] : undefined,
              spacingFactor: 1.5,
              animate: true,
              animationDuration: 300,
            }).run();
          }
        }, 100);

        // Highlight the starting node
        setTimeout(() => {
          if (cy) {
            const startNode = cy.getElementById(nodeIdStr);
            if (startNode) {
              startNode.select();
              showDetails(startNode.data());
            }
          }
        }, 200);

        const dirLabel = direction === 'downstream' ? 'calls from' : 'callers of';
        document.getElementById('view-description').innerHTML =
          '<strong>Flow: ' + dirLabel + '</strong> - Tracing ' + (flowNodes.length - 1) + ' ' + (direction === 'downstream' ? 'called functions' : 'calling functions') + '. Click nodes to see details.';
      }
    }

    // Drill down into a node to see related structures
    function drillDown(nodeData) {
      if (!nodeData) return;

      let nodes = [];
      let edges = [];
      let title = '';

      // For files: show all structures in that file
      if (nodeData.type === 'file' && nodeData.file) {
        const filePath = nodeData.file;
        title = 'Structures in ' + filePath.split('/').pop();

        // Find all structures in this file from callGraph data
        const allNodes = vizData.graphs.callGraph.nodes;
        nodes = allNodes.filter(n => n.data.file === filePath);

        // Find edges between these nodes
        const nodeIds = new Set(nodes.map(n => n.data.id));
        edges = vizData.graphs.callGraph.edges.filter(e =>
          nodeIds.has(e.data.source) && nodeIds.has(e.data.target)
        );
      }
      // For classes/interfaces: show methods in same file near the class
      else if ((nodeData.type === 'class' || nodeData.type === 'interface') && nodeData.file) {
        const filePath = nodeData.file;
        const classLine = nodeData.line || 0;
        const classLineEnd = nodeData.lineEnd || classLine + 1000;
        title = 'Contents of ' + nodeData.label;

        // Find methods in the same file within the class line range
        const allNodes = vizData.graphs.callGraph.nodes;
        nodes = allNodes.filter(n => {
          if (n.data.file !== filePath) return false;
          if (n.data.id === nodeData.id) return true; // Include the class itself
          if (n.data.type === 'method') {
            const line = n.data.line || 0;
            return line >= classLine && line <= classLineEnd;
          }
          return false;
        });

        // Find edges between these nodes
        const nodeIds = new Set(nodes.map(n => n.data.id));
        edges = vizData.graphs.callGraph.edges.filter(e =>
          nodeIds.has(e.data.source) && nodeIds.has(e.data.target)
        );
      }
      // For functions/methods: show what they call (focus mode)
      else if (nodeData.type === 'function' || nodeData.type === 'method') {
        // Save current state before drilling
        drillHistory.push({
          view: currentView,
          label: getBreadcrumbLabel(currentView),
          description: document.getElementById('view-description').innerHTML
        });
        updateBackButton();

        // Update breadcrumb
        const breadcrumbItems = drillHistory.map(h => ({ label: h.label }));
        breadcrumbItems.push({ label: nodeData.label });
        updateBreadcrumb(breadcrumbItems);

        fullCallGraphData = vizData.graphs.callGraph;
        focusOnNode(nodeData.id);

        document.getElementById('view-description').innerHTML =
          '<strong>' + nodeData.label + '</strong> - Shows calls to/from this function. Double-click to explore further.';
        return;
      }
      // Default: show structures in same file
      else if (nodeData.file) {
        const filePath = nodeData.file;
        title = 'Structures in ' + filePath.split('/').pop();

        const allNodes = vizData.graphs.callGraph.nodes;
        nodes = allNodes.filter(n => n.data.file === filePath);

        const nodeIds = new Set(nodes.map(n => n.data.id));
        edges = vizData.graphs.callGraph.edges.filter(e =>
          nodeIds.has(e.data.source) && nodeIds.has(e.data.target)
        );
      }

      if (nodes.length > 0) {
        // Save current state before drilling
        drillHistory.push({
          view: currentView,
          label: getBreadcrumbLabel(currentView),
          description: document.getElementById('view-description').innerHTML
        });
        updateBackButton();

        // Update breadcrumb
        const breadcrumbItems = drillHistory.map(h => ({ label: h.label }));
        breadcrumbItems.push({ label: title.replace('Structures in ', '').replace('Contents of ', '') });
        updateBreadcrumb(breadcrumbItems);

        initCytoscape({ nodes, edges });
        document.getElementById('view-description').innerHTML =
          '<strong>' + title + '</strong> - Double-click to drill deeper.';
      }
    }

    function getBreadcrumbLabel(view) {
      const labels = {
        overview: 'Files',
        callGraph: 'Call Graph',
        dependencies: 'Dependencies',
        classes: 'Classes',
        decisions: 'Decisions',
      };
      return labels[view] || view;
    }

    // Go back to previous view
    function goBack() {
      if (drillHistory.length === 0) return;

      const prev = drillHistory.pop();
      updateBackButton();

      // Restore the previous view
      switchView(prev.view);
    }

    // Update back button visibility
    function updateBackButton() {
      const btn = document.getElementById('back-btn');
      if (drillHistory.length > 0) {
        btn.classList.add('visible');
      } else {
        btn.classList.remove('visible');
      }
    }

    function applyFilters() {
      if (!cy) return;

      const filters = {
        function: document.getElementById('filter-function').checked,
        class: document.getElementById('filter-class').checked,
        method: document.getElementById('filter-method').checked,
        interface: document.getElementById('filter-interface').checked,
        type: document.getElementById('filter-type').checked,
        file: document.getElementById('filter-file').checked,
      };

      cy.nodes().forEach(node => {
        const type = node.data('type');
        const visible = filters[type] !== false;
        node.style('display', visible ? 'element' : 'none');
      });

      // Refit to show visible nodes
      setTimeout(() => {
        cy.fit(cy.nodes(':visible'), 50);
      }, 50);
    }

    // View mode toggle (visual vs list)
    function setViewMode(mode) {
      currentViewMode = mode;

      // Update toggle buttons
      document.querySelectorAll('.view-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
      });

      // Toggle visibility
      const cyEl = document.getElementById('cy');
      const listEl = document.getElementById('list-view');
      const legendEl = document.getElementById('legend');

      if (mode === 'visual') {
        cyEl.classList.remove('hidden');
        listEl.classList.remove('active');
        legendEl.classList.remove('hidden');
        if (cy) {
          setTimeout(() => {
            cy.resize();
            cy.fit(50);
          }, 50);
        }
      } else {
        cyEl.classList.add('hidden');
        listEl.classList.add('active');
        legendEl.classList.add('hidden');
        renderListView();
      }
    }

    // Render list view for current data
    function renderListView() {
      const listEl = document.getElementById('list-view');
      const graphData = currentView === 'callGraph' ? fullCallGraphData : vizData.graphs[currentView];

      if (!graphData || graphData.nodes.length === 0) {
        listEl.innerHTML = '<div class="empty-state"><h3>No data</h3><p>No items to display for this view</p></div>';
        return;
      }

      // Group nodes by type
      const byType = {};
      for (const node of graphData.nodes) {
        const type = node.data.type || 'other';
        if (!byType[type]) byType[type] = [];
        byType[type].push(node.data);
      }

      // Sort types
      const typeOrder = ['file', 'class', 'interface', 'function', 'method', 'type', 'variable', 'module', 'decision', 'pattern', 'rejection'];
      const sortedTypes = Object.keys(byType).sort((a, b) => {
        const aIdx = typeOrder.indexOf(a);
        const bIdx = typeOrder.indexOf(b);
        return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
      });

      let html = '';
      for (const type of sortedTypes) {
        const items = byType[type];
        html += '<div class="list-section">';
        html += '<h4>' + type + 's (' + items.length + ')</h4>';

        // Sort items by name
        items.sort((a, b) => (a.label || '').localeCompare(b.label || ''));

        for (const item of items) {
          html += '<div class="list-item" data-id="' + escapeHtml(item.id) + '">';
          html += '<span class="tag ' + type + '">' + type + '</span>';
          html += '<div class="list-item-content">';
          html += '<div class="list-item-name">' + escapeHtml(item.label) + '</div>';
          if (item.file) {
            html += '<div class="list-item-location">' + escapeHtml(item.file);
            if (item.line) html += ':' + item.line;
            html += '</div>';
          }
          if (item.signature) {
            html += '<div class="list-item-signature">' + escapeHtml(item.signature) + '</div>';
          }
          html += '</div></div>';
        }
        html += '</div>';
      }

      listEl.innerHTML = html;

      // Add click handlers
      listEl.querySelectorAll('.list-item').forEach(item => {
        item.addEventListener('click', () => {
          const id = item.dataset.id;
          const nodeData = graphData.nodes.find(n => n.data.id === id);
          if (nodeData) {
            showDetails(nodeData.data);
          }
        });

        // Double-click to drill down
        item.addEventListener('dblclick', () => {
          const id = item.dataset.id;
          const nodeData = graphData.nodes.find(n => n.data.id === id);
          if (nodeData) {
            drillDown(nodeData.data);
          }
        });
      });
    }

    function searchNodes(query) {
      const searchInput = document.getElementById('search');

      if (!query) {
        // Reset visual view
        if (cy) {
          cy.nodes().style('opacity', 1);
          cy.nodes().removeClass('search-match');
        }
        // Reset list view filter
        if (currentViewMode === 'list') {
          document.querySelectorAll('.list-item').forEach(item => {
            item.style.display = '';
          });
          document.querySelectorAll('.list-section').forEach(section => {
            section.style.display = '';
          });
        }
        return;
      }

      query = query.toLowerCase();

      // Get the data source for current view
      const graphData = currentView === 'callGraph' ? fullCallGraphData : vizData.graphs[currentView];

      if (!graphData) return;

      // Search across name, file, and signature
      const matches = graphData.nodes.filter(n => {
        const label = (n.data.label || '').toLowerCase();
        const file = (n.data.file || '').toLowerCase();
        const signature = (n.data.signature || '').toLowerCase();
        return label.includes(query) || file.includes(query) || signature.includes(query);
      });

      // Handle list view
      if (currentViewMode === 'list') {
        document.querySelectorAll('.list-item').forEach(item => {
          const name = item.querySelector('.list-item-name');
          const location = item.querySelector('.list-item-location');
          const signature = item.querySelector('.list-item-signature');
          const text = [
            name ? name.textContent : '',
            location ? location.textContent : '',
            signature ? signature.textContent : ''
          ].join(' ').toLowerCase();
          item.style.display = text.includes(query) ? '' : 'none';
        });

        // Hide empty sections
        document.querySelectorAll('.list-section').forEach(section => {
          const visibleItems = section.querySelectorAll('.list-item[style=""], .list-item:not([style])');
          const hasVisible = Array.from(section.querySelectorAll('.list-item')).some(
            item => item.style.display !== 'none'
          );
          section.style.display = hasVisible ? '' : 'none';
        });
        return;
      }

      // Handle visual view
      if (matches.length === 0) {
        // No matches - show message
        document.getElementById('details-content').innerHTML = \`
          <div class="empty-state">
            <h3>No matches</h3>
            <p>No results for "\${escapeHtml(query)}"</p>
          </div>
        \`;
        if (cy) cy.nodes().style('opacity', 0.2);
        return;
      }

      // For call graph, rebuild with matching nodes
      if (currentView === 'callGraph' && fullCallGraphData) {
        if (matches.length === 1) {
          focusOnNode(matches[0].data.id);
        } else if (matches.length <= 30) {
          // Show matching nodes with their connections
          const matchIds = new Set(matches.map(m => m.data.id));
          const relevantEdges = fullCallGraphData.edges.filter(e =>
            matchIds.has(e.data.source) || matchIds.has(e.data.target)
          );

          // Add connected nodes
          for (const edge of relevantEdges) {
            matchIds.add(edge.data.source);
            matchIds.add(edge.data.target);
          }

          const focusedNodes = fullCallGraphData.nodes.filter(n => matchIds.has(n.data.id));
          initCytoscape({ nodes: focusedNodes, edges: relevantEdges });

          document.getElementById('view-description').innerHTML =
            '<strong>Search results</strong> - Found ' + matches.length + ' matches for "' + escapeHtml(query) + '"';
        } else {
          // Too many - show clickable list
          const listHtml = matches.slice(0, 30).map(m =>
            '<div style="padding: 6px 0; cursor: pointer; color: #e94560; border-bottom: 1px solid #0f3460;" onclick="focusOnNode(\\'' + m.data.id + '\\')">' +
            escapeHtml(m.data.label) +
            '<span style="color: #666; font-size: 11px; margin-left: 8px;">' + (m.data.file ? m.data.file.split("/").pop() : '') + '</span></div>'
          ).join('');
          document.getElementById('details-content').innerHTML = \`
            <div class="detail-row">
              <div class="detail-label">\${matches.length} matches found</div>
              <div style="margin-top: 8px;">\${listHtml}</div>
              \${matches.length > 30 ? '<div style="color: #666; margin-top: 8px;">...and ' + (matches.length - 30) + ' more</div>' : ''}
            </div>
          \`;
        }
        return;
      }

      // For other views, highlight matches
      if (cy) {
        const matchIds = new Set(matches.map(m => m.data.id));
        cy.nodes().forEach(node => {
          const isMatch = matchIds.has(node.data('id'));
          node.style('opacity', isMatch ? 1 : 0.15);
        });

        // Fit to show matches
        const matchingNodes = cy.nodes().filter(n => matchIds.has(n.data('id')));
        if (matchingNodes.length > 0 && matchingNodes.length < 20) {
          cy.fit(matchingNodes, 80);
        }
      }
    }

    // Event listeners
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        // Clear history when manually switching tabs
        drillHistory = [];
        updateBackButton();
        switchView(tab.dataset.view);
        // Reset breadcrumb to just the view name
        updateBreadcrumb([{ label: getBreadcrumbLabel(tab.dataset.view) }]);
      });
    });

    document.getElementById('back-btn').addEventListener('click', goBack);

    document.getElementById('layout-select').addEventListener('change', runLayout);

    document.querySelectorAll('[id^="filter-"]').forEach(checkbox => {
      checkbox.addEventListener('change', applyFilters);
    });

    document.getElementById('search').addEventListener('input', (e) => {
      searchNodes(e.target.value);
    });

    // View mode toggle (visual/list)
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => setViewMode(btn.dataset.mode));
    });

    // Flow mode radio buttons
    document.querySelectorAll('input[name="flow-mode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        flowMode = e.target.value;
        // Update hint text based on mode
        const hint = document.querySelector('#flow-mode-group p');
        if (hint) {
          if (flowMode === 'connections') {
            hint.textContent = 'Click a function to see its connections';
          } else if (flowMode === 'downstream') {
            hint.textContent = 'Click a function to trace what it calls';
          } else if (flowMode === 'upstream') {
            hint.textContent = 'Click a function to trace what calls it';
          }
        }
      });
    });

    // Fullscreen toggle
    function toggleFullscreen() {
      const isFullscreen = document.body.classList.toggle('fullscreen');
      document.getElementById('exit-fullscreen').style.display = isFullscreen ? 'block' : 'none';

      // When exiting fullscreen, reinitialize the view to fix layout
      if (!isFullscreen) {
        setTimeout(() => {
          switchView(currentView);
        }, 300);
      } else if (cy && currentViewMode === 'visual') {
        // Entering fullscreen - just resize
        setTimeout(() => {
          cy.resize();
          cy.fit(50);
        }, 100);
      }
    }

    document.getElementById('fullscreen-btn').addEventListener('click', toggleFullscreen);
    document.getElementById('exit-fullscreen').addEventListener('click', toggleFullscreen);
    document.getElementById('close-details').addEventListener('click', clearDetails);

    // ESC key to exit fullscreen
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('fullscreen')) {
        toggleFullscreen();
      }
    });

    // Initialize
    switchView('overview');
    updateBreadcrumb([{ label: 'Files' }]);
    maybeShowWelcome();
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
