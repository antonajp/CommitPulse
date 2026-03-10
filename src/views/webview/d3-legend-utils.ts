/**
 * D3 Legend rendering utilities shared across dashboard charts.
 * Provides consistent legend styling and behavior.
 *
 * Ticket: IQS-921, IQS-929
 */

/**
 * Maximum number of team members to show in the legend before truncating.
 * Prevents legend from overwhelming the chart.
 */
export const MAX_LEGEND_TEAM_MEMBERS = 15;

/**
 * Configuration for a legend item representing a metric series.
 */
export interface LegendSeriesConfig {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly strokeDasharray?: string;
  readonly marker?: 'circle' | 'square' | 'triangle' | 'diamond';
}

/**
 * Generate JavaScript source for legend rendering utilities.
 * @returns JavaScript source string for embedding in webview
 */
export function generateLegendUtilsScript(): string {
  return `
    // ======================================================================
    // Legend Rendering Utilities
    // ======================================================================

    var MAX_LEGEND_TEAM_MEMBERS = ${MAX_LEGEND_TEAM_MEMBERS};

    /**
     * Create a legend item DOM element.
     * @param {string} label - Display label
     * @param {string} color - Hex color code
     * @param {boolean} isClickable - Whether item responds to clicks
     * @param {string} ariaLabel - Accessible label
     * @returns {HTMLElement}
     */
    function createLegendItem(label, color, isClickable, ariaLabel) {
      var item = document.createElement('div');
      item.className = 'legend-item' + (isClickable ? ' legend-item-clickable' : '');
      if (isClickable) {
        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'button');
      }
      item.setAttribute('aria-label', ariaLabel || label);

      var colorSwatch = document.createElement('span');
      colorSwatch.className = 'legend-color';
      colorSwatch.style.backgroundColor = color;
      item.appendChild(colorSwatch);

      var labelSpan = document.createElement('span');
      labelSpan.className = 'legend-label';
      labelSpan.textContent = label;
      item.appendChild(labelSpan);

      return item;
    }

    /**
     * Create a truncation indicator for long team lists.
     * @param {number} remaining - Number of hidden team members
     * @returns {HTMLElement}
     */
    function createTruncationIndicator(remaining) {
      var item = document.createElement('div');
      item.className = 'legend-item legend-truncation';
      item.textContent = '... and ' + remaining + ' others';
      return item;
    }
  `;
}

/**
 * Generate CSS styles for legend components.
 * @returns CSS string for embedding in webview
 */
export function generateLegendStyles(): string {
  return `
    /* Legend Container */
    .legend-section {
      padding: 0.5rem;
    }

    .legend-section-title {
      font-weight: 600;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 0.5rem;
    }

    .legend-items {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    /* Legend Item */
    .legend-item {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.875rem;
      background: var(--vscode-editor-background);
    }

    .legend-item-clickable {
      cursor: pointer;
    }

    .legend-item-clickable:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .legend-item-clickable:focus {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .legend-item-hidden {
      opacity: 0.5;
      text-decoration: line-through;
    }

    .legend-color {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .legend-label {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 150px;
    }

    .legend-truncation {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
  `;
}
