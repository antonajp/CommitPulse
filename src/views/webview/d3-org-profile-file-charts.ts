/**
 * D3.js horizontal stacked bar chart renderers for Organization Profile Dashboard.
 * Team-colored charts for complex and frequently modified files.
 * Uses extended Okabe-Ito colorblind-safe palette (12 colors).
 *
 * Ticket: GITX-208
 *
 * Features:
 * - Top 15 Complex Files: Horizontal stacked bar, segments proportional to TEAM contribution
 * - Top 20 Frequently Modified Files: Horizontal stacked bar, segments proportional to TEAM contribution
 * - Team color palette: Extended Okabe-Ito colorblind-friendly palette (12 distinct colors)
 * - Legend: Shows team names with color indicators
 * - Interactive legend: Click to toggle team visibility (filter from chart)
 * - Tooltip: File path, team name, contribution value, percentage
 * - File path click: Opens file in VS Code editor
 * - High-contrast mode support: Border around bars, pattern fills as secondary differentiator
 * - Max teams displayed: 10 (remaining grouped as "Other Teams")
 */

/**
 * Generate the extended Okabe-Ito team color palette (12 colors).
 * Returns JavaScript source for embedding in webview.
 */
export function getTeamColorPalette(): string[] {
  return [
    '#E69F00', // Orange
    '#56B4E9', // Sky Blue
    '#009E73', // Bluish Green
    '#F0E442', // Yellow
    '#0072B2', // Blue
    '#D55E00', // Vermillion
    '#CC79A7', // Reddish Purple
    '#999999', // Gray
    '#8B4513', // Saddle Brown
    '#6A5ACD', // Slate Blue
    '#FF6347', // Tomato
    '#20B2AA', // Light Sea Green
  ];
}

/**
 * Generate the JavaScript source for the Organization Profile file charts.
 * @returns JavaScript source string for embedding in a <script> block
 */
export function generateOrgProfileFileChartsScript(): string {
  return `
      // ======================================================================
      // GITX-208: Organization Profile File Charts - Team-Colored Stacked Bars
      // ======================================================================

      // Extended Okabe-Ito colorblind-safe palette (12 colors)
      var ORG_TEAM_COLORS = [
        '#E69F00', // Orange
        '#56B4E9', // Sky Blue
        '#009E73', // Bluish Green
        '#F0E442', // Yellow
        '#0072B2', // Blue
        '#D55E00', // Vermilion
        '#CC79A7', // Reddish Purple
        '#999999', // Gray
        '#8B4513', // Saddle Brown
        '#6A5ACD', // Slate Blue
        '#FF6347', // Tomato
        '#20B2AA'  // Light Sea Green
      ];

      // Other Teams color (for overflow beyond 10 teams)
      var OTHER_TEAMS_COLOR = '#666666';
      var MAX_TEAMS_DISPLAYED = 10;

      // High contrast pattern definitions (SVG patterns)
      var HIGH_CONTRAST_PATTERNS = [
        'url(#pattern-stripe)',
        'url(#pattern-dot)',
        'url(#pattern-diagonal)',
        'url(#pattern-cross)',
        'url(#pattern-zigzag)',
        'url(#pattern-wave)',
        'url(#pattern-diamond)',
        'url(#pattern-grid)',
        'url(#pattern-hatch)',
        'url(#pattern-circle)'
      ];

      /**
       * State for complex files chart - tracks hidden teams.
       */
      var complexFilesHiddenTeams = new Set();
      var cachedOrgComplexFilesData = [];

      /**
       * State for frequent files chart - tracks hidden teams.
       */
      var frequentFilesHiddenTeams = new Set();
      var cachedOrgFrequentFilesData = [];

      /**
       * Check if high contrast mode is enabled via VS Code body class.
       */
      function isHighContrastMode() {
        return document.body.classList.contains('vscode-high-contrast') ||
               document.body.classList.contains('vscode-high-contrast-light');
      }

      /**
       * Get color for a team index.
       * Uses Okabe-Ito palette for first 10, then gray for "Other Teams".
       *
       * @param {number} index - Team index (0-based)
       * @returns {string} Hex color string
       */
      function getOrgTeamColor(index) {
        if (index >= MAX_TEAMS_DISPLAYED) {
          return OTHER_TEAMS_COLOR;
        }
        return ORG_TEAM_COLORS[index % ORG_TEAM_COLORS.length];
      }

      /**
       * Get pattern for high contrast mode.
       *
       * @param {number} index - Team index (0-based)
       * @returns {string} Pattern URL or empty string
       */
      function getHighContrastPattern(index) {
        if (!isHighContrastMode()) {
          return '';
        }
        if (index >= MAX_TEAMS_DISPLAYED) {
          return 'url(#pattern-other)';
        }
        return HIGH_CONTRAST_PATTERNS[index % HIGH_CONTRAST_PATTERNS.length];
      }

      /**
       * Truncate file path for Y-axis display.
       * Shows the last N characters with ellipsis prefix.
       *
       * @param {string} path - Full file path
       * @param {number} maxLen - Maximum display length
       * @returns {string} Truncated path
       */
      function truncateOrgFilePath(path, maxLen) {
        if (!path || path.length <= maxLen) { return path || ''; }
        return '...' + path.slice(-(maxLen - 3));
      }

      /**
       * Format LOC value with k/M suffix for large numbers.
       *
       * @param {number} val - LOC value
       * @returns {string} Formatted value
       */
      function formatOrgLocValue(val) {
        if (val >= 1000000) {
          return (val / 1000000).toFixed(1) + 'M';
        }
        if (val >= 1000) {
          return (val / 1000).toFixed(1) + 'k';
        }
        return val.toLocaleString();
      }

      /**
       * Create SVG pattern definitions for high contrast mode.
       * Called once when creating the chart SVG.
       */
      function createHighContrastPatterns(svg) {
        var defs = svg.append('defs');

        // Stripe pattern
        var stripe = defs.append('pattern')
          .attr('id', 'pattern-stripe')
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', 4).attr('height', 4);
        stripe.append('path')
          .attr('d', 'M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2')
          .attr('stroke', 'var(--vscode-foreground, #000)')
          .attr('stroke-width', 1);

        // Dot pattern
        var dot = defs.append('pattern')
          .attr('id', 'pattern-dot')
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', 6).attr('height', 6);
        dot.append('circle')
          .attr('cx', 3).attr('cy', 3).attr('r', 1.5)
          .attr('fill', 'var(--vscode-foreground, #000)');

        // Diagonal pattern
        var diagonal = defs.append('pattern')
          .attr('id', 'pattern-diagonal')
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', 5).attr('height', 5);
        diagonal.append('path')
          .attr('d', 'M0,5 L5,0')
          .attr('stroke', 'var(--vscode-foreground, #000)')
          .attr('stroke-width', 1);

        // Cross pattern
        var cross = defs.append('pattern')
          .attr('id', 'pattern-cross')
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', 6).attr('height', 6);
        cross.append('path')
          .attr('d', 'M0,3 L6,3 M3,0 L3,6')
          .attr('stroke', 'var(--vscode-foreground, #000)')
          .attr('stroke-width', 0.5);

        // Zigzag pattern
        var zigzag = defs.append('pattern')
          .attr('id', 'pattern-zigzag')
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', 8).attr('height', 4);
        zigzag.append('path')
          .attr('d', 'M0,2 L2,0 L4,2 L6,0 L8,2')
          .attr('stroke', 'var(--vscode-foreground, #000)')
          .attr('stroke-width', 1)
          .attr('fill', 'none');

        // Wave pattern
        var wave = defs.append('pattern')
          .attr('id', 'pattern-wave')
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', 8).attr('height', 4);
        wave.append('path')
          .attr('d', 'M0,2 Q2,0 4,2 T8,2')
          .attr('stroke', 'var(--vscode-foreground, #000)')
          .attr('stroke-width', 1)
          .attr('fill', 'none');

        // Diamond pattern
        var diamond = defs.append('pattern')
          .attr('id', 'pattern-diamond')
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', 6).attr('height', 6);
        diamond.append('path')
          .attr('d', 'M3,0 L6,3 L3,6 L0,3 Z')
          .attr('stroke', 'var(--vscode-foreground, #000)')
          .attr('stroke-width', 0.5)
          .attr('fill', 'none');

        // Grid pattern
        var grid = defs.append('pattern')
          .attr('id', 'pattern-grid')
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', 5).attr('height', 5);
        grid.append('path')
          .attr('d', 'M5,0 L0,0 L0,5')
          .attr('stroke', 'var(--vscode-foreground, #000)')
          .attr('stroke-width', 0.5)
          .attr('fill', 'none');

        // Hatch pattern
        var hatch = defs.append('pattern')
          .attr('id', 'pattern-hatch')
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', 4).attr('height', 4);
        hatch.append('path')
          .attr('d', 'M0,0 L4,4 M4,0 L0,4')
          .attr('stroke', 'var(--vscode-foreground, #000)')
          .attr('stroke-width', 0.5);

        // Circle pattern
        var circle = defs.append('pattern')
          .attr('id', 'pattern-circle')
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', 8).attr('height', 8);
        circle.append('circle')
          .attr('cx', 4).attr('cy', 4).attr('r', 3)
          .attr('stroke', 'var(--vscode-foreground, #000)')
          .attr('stroke-width', 0.5)
          .attr('fill', 'none');

        // Other Teams pattern
        var other = defs.append('pattern')
          .attr('id', 'pattern-other')
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', 4).attr('height', 4);
        other.append('rect')
          .attr('width', 4).attr('height', 4)
          .attr('fill', 'var(--vscode-foreground, #000)')
          .attr('fill-opacity', 0.3);
      }

      // ======================================================================
      // GITX-208: Organization Profile File Chart Tooltip Functions
      // ======================================================================

      var orgFileTooltip = null;

      /**
       * Show tooltip for org file charts.
       * GITX-208: Security - HTML content is already escaped by callers.
       */
      function showOrgFileTooltip(event, html) {
        if (!orgFileTooltip) {
          orgFileTooltip = document.getElementById('orgFileTooltip');
        }
        if (!orgFileTooltip) { return; }

        orgFileTooltip.innerHTML = html;
        orgFileTooltip.classList.add('visible');
        orgFileTooltip.setAttribute('aria-hidden', 'false');
        moveOrgFileTooltip(event);
      }

      /**
       * Move tooltip to follow cursor with boundary detection.
       */
      function moveOrgFileTooltip(event) {
        if (!orgFileTooltip) { return; }

        var x = event.pageX + 12;
        var y = event.pageY - 28;

        // Viewport boundary detection
        var ttRect = orgFileTooltip.getBoundingClientRect();
        var viewportWidth = window.innerWidth;
        var viewportHeight = window.innerHeight;

        if (x + ttRect.width > viewportWidth - 20) {
          x = event.pageX - ttRect.width - 12;
        }
        if (x < 10) { x = 10; }
        if (y + ttRect.height > viewportHeight - 20) {
          y = event.pageY - ttRect.height - 12;
        }
        if (y < 10) { y = event.pageY + 20; }

        orgFileTooltip.style.left = x + 'px';
        orgFileTooltip.style.top = y + 'px';
      }

      /**
       * Hide the org file chart tooltip.
       */
      function hideOrgFileTooltip() {
        if (!orgFileTooltip) {
          orgFileTooltip = document.getElementById('orgFileTooltip');
        }
        if (orgFileTooltip) {
          orgFileTooltip.classList.remove('visible');
          orgFileTooltip.setAttribute('aria-hidden', 'true');
        }
      }

      // ======================================================================
      // GITX-208: Top Complex Files Horizontal Stacked Bar Chart (by Team)
      // ======================================================================

      /**
       * Aggregate data by filename for complex files.
       * Groups team contributions, limits to MAX_TEAMS_DISPLAYED.
       */
      function aggregateComplexFilesData(data, hiddenTeams) {
        if (!data || data.length === 0) { return { files: [], teams: [], stackData: [] }; }

        // Group by filename
        var fileMap = {};
        data.forEach(function(row) {
          if (!fileMap[row.filename]) {
            fileMap[row.filename] = {
              filename: row.filename,
              complexity: row.complexity,
              teamContributions: {}
            };
          }
          var teamName = row.teamName || '(Unknown)';
          if (!fileMap[row.filename].teamContributions[teamName]) {
            fileMap[row.filename].teamContributions[teamName] = 0;
          }
          fileMap[row.filename].teamContributions[teamName] += row.loc || 0;
        });

        // Extract unique teams and sort by total LOC contribution
        var teamTotals = {};
        Object.values(fileMap).forEach(function(file) {
          Object.entries(file.teamContributions).forEach(function(entry) {
            var team = entry[0];
            var loc = entry[1];
            teamTotals[team] = (teamTotals[team] || 0) + loc;
          });
        });

        var allTeams = Object.keys(teamTotals).sort(function(a, b) {
          return teamTotals[b] - teamTotals[a];
        });

        // Limit to MAX_TEAMS_DISPLAYED and group remaining as "Other Teams"
        var displayTeams = allTeams.slice(0, MAX_TEAMS_DISPLAYED);
        var otherTeams = allTeams.slice(MAX_TEAMS_DISPLAYED);
        var hasOtherTeams = otherTeams.length > 0;

        if (hasOtherTeams) {
          displayTeams.push('Other Teams');
        }

        // Filter out hidden teams
        var visibleTeams = displayTeams.filter(function(t) {
          return !hiddenTeams.has(t);
        });

        // Build stack data
        var files = Object.values(fileMap).sort(function(a, b) {
          return b.complexity - a.complexity;
        });

        var stackData = files.map(function(file) {
          var entry = {
            filename: file.filename,
            complexity: file.complexity,
            totalLoc: 0
          };

          visibleTeams.forEach(function(team) {
            if (team === 'Other Teams') {
              var otherLoc = 0;
              otherTeams.forEach(function(ot) {
                otherLoc += file.teamContributions[ot] || 0;
              });
              entry[team] = otherLoc;
            } else {
              entry[team] = file.teamContributions[team] || 0;
            }
            entry.totalLoc += entry[team];
          });

          return entry;
        });

        return { files: files, teams: visibleTeams, allTeams: displayTeams, stackData: stackData };
      }

      /**
       * Render the Top Complex Files horizontal stacked bar chart.
       * GITX-208: Team-colored, with interactive legend toggle.
       *
       * @param {Array} data - Array of OrgProfileComplexFile
       */
      function renderOrgComplexFilesChart(data) {
        hideSkeleton('orgComplexFilesSkeleton');
        cachedOrgComplexFilesData = data;

        var container = document.getElementById('orgComplexFilesChart');
        var emptyMsg = document.getElementById('orgComplexFilesEmpty');

        if (!data || data.length === 0) {
          container.classList.add('hidden');
          emptyMsg.classList.remove('hidden');
          return;
        }

        container.classList.remove('hidden');
        emptyMsg.classList.add('hidden');
        container.innerHTML = '';

        var aggregated = aggregateComplexFilesData(data, complexFilesHiddenTeams);
        var files = aggregated.files;
        var teams = aggregated.teams;
        var allTeams = aggregated.allTeams;
        var stackData = aggregated.stackData;

        if (teams.length === 0 || files.length === 0) {
          container.classList.add('hidden');
          emptyMsg.classList.remove('hidden');
          return;
        }

        // Chart dimensions
        var barHeight = 22;
        var maxLabelLen = 35;
        var margin = { top: 30, right: 180, bottom: 50, left: Math.min(250, Math.max(150, maxLabelLen * 6)) };
        var width = Math.max(500, container.clientWidth) - margin.left - margin.right;
        var height = Math.max(200, files.length * (barHeight + 6)) + 20;

        var svg = d3.select(container).append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom)
          .attr('role', 'img')
          .attr('aria-label', 'Top Complex Files horizontal stacked bar chart showing per-team LOC contributions');

        // Add high contrast patterns
        createHighContrastPatterns(svg);

        var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        // Scales
        var filenames = stackData.map(function(d) { return d.filename; });
        var y = d3.scaleBand().domain(filenames).range([0, height]).padding(0.15);
        var color = d3.scaleOrdinal().domain(teams).range(teams.map(function(t, i) {
          if (t === 'Other Teams') return OTHER_TEAMS_COLOR;
          return getOrgTeamColor(allTeams.indexOf(t));
        }));

        // Stack generator
        var stack = d3.stack().keys(teams);
        var series = stack(stackData);
        var maxVal = d3.max(series, function(s) { return d3.max(s, function(d) { return d[1]; }); }) || 1;
        var x = d3.scaleLinear().domain([0, maxVal]).nice().range([0, width]);

        // Grid lines
        g.append('g').attr('class', 'grid')
          .call(d3.axisBottom(x).tickSize(height).tickFormat(''))
          .selectAll('line')
          .attr('stroke', 'var(--vscode-panel-border, #444)')
          .attr('stroke-opacity', 0.3)
          .attr('stroke-dasharray', '2,2');
        g.selectAll('.grid .domain').remove();

        // Render stacked horizontal bars
        series.forEach(function(teamSeries, teamIdx) {
          var teamName = teamSeries.key;
          var teamColorIdx = teamName === 'Other Teams' ? MAX_TEAMS_DISPLAYED : allTeams.indexOf(teamName);

          g.selectAll('.hbar-complex-' + teamIdx)
            .data(teamSeries).enter().append('rect')
            .attr('y', function(d) { return y(d.data.filename); })
            .attr('x', function(d) { return x(d[0]); })
            .attr('height', y.bandwidth())
            .attr('width', function(d) { return Math.max(0, x(d[1]) - x(d[0])); })
            .attr('fill', function() {
              var pattern = getHighContrastPattern(teamColorIdx);
              return pattern || (color(teamName) + 'cc');
            })
            .attr('stroke', color(teamName))
            .attr('stroke-width', isHighContrastMode() ? 2 : 1)
            .attr('tabindex', '0')
            .attr('role', 'button')
            .attr('data-filepath', function(d) { return d.data.filename; })
            .attr('data-team', teamName)
            .attr('aria-label', function(d) {
              var loc = d[1] - d[0];
              var pct = d.data.totalLoc > 0 ? ((loc / d.data.totalLoc) * 100).toFixed(1) : '0';
              return escapeHtml(teamName) + ': ' + formatOrgLocValue(loc) + ' LOC (' + pct + '%) in ' + truncateOrgFilePath(d.data.filename, 30);
            })
            .on('mouseover', function(event, d) {
              var loc = d[1] - d[0];
              var pct = d.data.totalLoc > 0 ? ((loc / d.data.totalLoc) * 100).toFixed(1) : '0';
              showOrgFileTooltip(event,
                '<strong>' + escapeHtml(teamName) + '</strong><br>' +
                escapeHtml(truncateOrgFilePath(d.data.filename, 45)) + '<br>' +
                'LOC: ' + formatOrgLocValue(loc) + ' (' + pct + '%)<br>' +
                '<small>Complexity: ' + escapeHtml(String(d.data.complexity)) + '</small><br>' +
                '<small style="opacity:0.7;">Click to open file</small>'
              );
            })
            .on('mousemove', moveOrgFileTooltip)
            .on('mouseout', hideOrgFileTooltip)
            .on('click', function(event, d) {
              vscode.postMessage({
                type: 'openFile',
                filePath: d.data.filename,
                repository: ''
              });
            })
            .on('keydown', function(event, d) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                vscode.postMessage({
                  type: 'openFile',
                  filePath: d.data.filename,
                  repository: ''
                });
              }
            });
        });

        // Y axis (file names, truncated)
        var yAxis = g.append('g').call(d3.axisLeft(y));
        yAxis.selectAll('text')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '10px')
          .each(function() {
            var t = d3.select(this);
            var fullPath = t.text();
            t.text(truncateOrgFilePath(fullPath, maxLabelLen));
          });
        // Add full path on hover via title
        yAxis.selectAll('.tick').append('title').text(function(d) { return d; });

        // X axis
        g.append('g').attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).ticks(6).tickFormat(function(d) {
            return formatOrgLocValue(d);
          }))
          .selectAll('text')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '10px');

        // X axis label
        svg.append('text')
          .attr('x', margin.left + width / 2)
          .attr('y', height + margin.top + 40)
          .attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '11px')
          .text('Lines of Code');

        // Interactive Legend (right side, all display teams)
        var legendX = margin.left + width + 10;
        var legendY = margin.top;
        var legendG = svg.append('g')
          .attr('class', 'org-file-legend')
          .attr('transform', 'translate(' + legendX + ',' + legendY + ')');

        allTeams.forEach(function(team, i) {
          var isHidden = complexFilesHiddenTeams.has(team);
          var teamColorIdx = team === 'Other Teams' ? MAX_TEAMS_DISPLAYED : i;
          var lg = legendG.append('g')
            .attr('class', 'legend-item')
            .attr('transform', 'translate(0,' + (i * 20) + ')')
            .attr('cursor', 'pointer')
            .attr('tabindex', '0')
            .attr('role', 'checkbox')
            .attr('aria-checked', !isHidden)
            .attr('aria-label', 'Toggle visibility of ' + team);

          lg.append('rect')
            .attr('width', 14)
            .attr('height', 14)
            .attr('rx', 2)
            .attr('fill', isHidden ? 'transparent' : getOrgTeamColor(teamColorIdx))
            .attr('stroke', getOrgTeamColor(teamColorIdx))
            .attr('stroke-width', 2)
            .attr('opacity', isHidden ? 0.4 : 1);

          lg.append('text')
            .attr('x', 18)
            .attr('y', 11)
            .attr('fill', 'var(--vscode-foreground, #ccc)')
            .attr('font-size', '11px')
            .attr('opacity', isHidden ? 0.4 : 1)
            .text(team.length > 16 ? team.slice(0, 15) + '...' : team)
            .append('title').text(team);

          // Click handler for toggling team visibility
          lg.on('click', function() {
            if (complexFilesHiddenTeams.has(team)) {
              complexFilesHiddenTeams.delete(team);
            } else {
              complexFilesHiddenTeams.add(team);
            }
            renderOrgComplexFilesChart(cachedOrgComplexFilesData);
          });

          // Keyboard handler
          lg.on('keydown', function(event) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              if (complexFilesHiddenTeams.has(team)) {
                complexFilesHiddenTeams.delete(team);
              } else {
                complexFilesHiddenTeams.add(team);
              }
              renderOrgComplexFilesChart(cachedOrgComplexFilesData);
            }
          });
        });
      }

      // ======================================================================
      // GITX-208: Top Frequently Modified Files Horizontal Stacked Bar Chart
      // ======================================================================

      /**
       * Aggregate data by filename for frequent files.
       * Groups team contributions, limits to MAX_TEAMS_DISPLAYED.
       */
      function aggregateFrequentFilesData(data, hiddenTeams) {
        if (!data || data.length === 0) { return { files: [], teams: [], stackData: [] }; }

        // Group by filename
        var fileMap = {};
        data.forEach(function(row) {
          if (!fileMap[row.filename]) {
            fileMap[row.filename] = {
              filename: row.filename,
              totalChurn: row.totalChurn,
              teamContributions: {}
            };
          }
          var teamName = row.teamName || '(Unknown)';
          if (!fileMap[row.filename].teamContributions[teamName]) {
            fileMap[row.filename].teamContributions[teamName] = 0;
          }
          fileMap[row.filename].teamContributions[teamName] += row.churn || 0;
        });

        // Extract unique teams and sort by total churn contribution
        var teamTotals = {};
        Object.values(fileMap).forEach(function(file) {
          Object.entries(file.teamContributions).forEach(function(entry) {
            var team = entry[0];
            var churn = entry[1];
            teamTotals[team] = (teamTotals[team] || 0) + churn;
          });
        });

        var allTeams = Object.keys(teamTotals).sort(function(a, b) {
          return teamTotals[b] - teamTotals[a];
        });

        // Limit to MAX_TEAMS_DISPLAYED and group remaining as "Other Teams"
        var displayTeams = allTeams.slice(0, MAX_TEAMS_DISPLAYED);
        var otherTeams = allTeams.slice(MAX_TEAMS_DISPLAYED);
        var hasOtherTeams = otherTeams.length > 0;

        if (hasOtherTeams) {
          displayTeams.push('Other Teams');
        }

        // Filter out hidden teams
        var visibleTeams = displayTeams.filter(function(t) {
          return !hiddenTeams.has(t);
        });

        // Build stack data
        var files = Object.values(fileMap).sort(function(a, b) {
          return b.totalChurn - a.totalChurn;
        });

        var stackData = files.map(function(file) {
          var entry = {
            filename: file.filename,
            totalChurn: file.totalChurn,
            displayedChurn: 0
          };

          visibleTeams.forEach(function(team) {
            if (team === 'Other Teams') {
              var otherChurn = 0;
              otherTeams.forEach(function(ot) {
                otherChurn += file.teamContributions[ot] || 0;
              });
              entry[team] = otherChurn;
            } else {
              entry[team] = file.teamContributions[team] || 0;
            }
            entry.displayedChurn += entry[team];
          });

          return entry;
        });

        return { files: files, teams: visibleTeams, allTeams: displayTeams, stackData: stackData };
      }

      /**
       * Render the Top Frequently Modified Files horizontal stacked bar chart.
       * GITX-208: Team-colored, with interactive legend toggle.
       *
       * @param {Array} data - Array of OrgProfileFrequentFile
       */
      function renderOrgFrequentFilesChart(data) {
        hideSkeleton('orgFrequentFilesSkeleton');
        cachedOrgFrequentFilesData = data;

        var container = document.getElementById('orgFrequentFilesChart');
        var emptyMsg = document.getElementById('orgFrequentFilesEmpty');

        if (!data || data.length === 0) {
          container.classList.add('hidden');
          emptyMsg.classList.remove('hidden');
          return;
        }

        container.classList.remove('hidden');
        emptyMsg.classList.add('hidden');
        container.innerHTML = '';

        var aggregated = aggregateFrequentFilesData(data, frequentFilesHiddenTeams);
        var files = aggregated.files;
        var teams = aggregated.teams;
        var allTeams = aggregated.allTeams;
        var stackData = aggregated.stackData;

        if (teams.length === 0 || files.length === 0) {
          container.classList.add('hidden');
          emptyMsg.classList.remove('hidden');
          return;
        }

        // Chart dimensions
        var barHeight = 22;
        var maxLabelLen = 35;
        var margin = { top: 30, right: 180, bottom: 50, left: Math.min(250, Math.max(150, maxLabelLen * 6)) };
        var width = Math.max(500, container.clientWidth) - margin.left - margin.right;
        var height = Math.max(200, files.length * (barHeight + 6)) + 20;

        var svg = d3.select(container).append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom)
          .attr('role', 'img')
          .attr('aria-label', 'Top Frequently Modified Files horizontal stacked bar chart showing per-team churn contributions');

        // Add high contrast patterns
        createHighContrastPatterns(svg);

        var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        // Scales
        var filenames = stackData.map(function(d) { return d.filename; });
        var y = d3.scaleBand().domain(filenames).range([0, height]).padding(0.15);
        var color = d3.scaleOrdinal().domain(teams).range(teams.map(function(t, i) {
          if (t === 'Other Teams') return OTHER_TEAMS_COLOR;
          return getOrgTeamColor(allTeams.indexOf(t));
        }));

        // Stack generator
        var stack = d3.stack().keys(teams);
        var series = stack(stackData);
        var maxVal = d3.max(series, function(s) { return d3.max(s, function(d) { return d[1]; }); }) || 1;
        var x = d3.scaleLinear().domain([0, maxVal]).nice().range([0, width]);

        // Grid lines
        g.append('g').attr('class', 'grid')
          .call(d3.axisBottom(x).tickSize(height).tickFormat(''))
          .selectAll('line')
          .attr('stroke', 'var(--vscode-panel-border, #444)')
          .attr('stroke-opacity', 0.3)
          .attr('stroke-dasharray', '2,2');
        g.selectAll('.grid .domain').remove();

        // Render stacked horizontal bars
        series.forEach(function(teamSeries, teamIdx) {
          var teamName = teamSeries.key;
          var teamColorIdx = teamName === 'Other Teams' ? MAX_TEAMS_DISPLAYED : allTeams.indexOf(teamName);

          g.selectAll('.hbar-freq-' + teamIdx)
            .data(teamSeries).enter().append('rect')
            .attr('y', function(d) { return y(d.data.filename); })
            .attr('x', function(d) { return x(d[0]); })
            .attr('height', y.bandwidth())
            .attr('width', function(d) { return Math.max(0, x(d[1]) - x(d[0])); })
            .attr('fill', function() {
              var pattern = getHighContrastPattern(teamColorIdx);
              return pattern || (color(teamName) + 'cc');
            })
            .attr('stroke', color(teamName))
            .attr('stroke-width', isHighContrastMode() ? 2 : 1)
            .attr('tabindex', '0')
            .attr('role', 'button')
            .attr('data-filepath', function(d) { return d.data.filename; })
            .attr('data-team', teamName)
            .attr('aria-label', function(d) {
              var churn = d[1] - d[0];
              var pct = d.data.displayedChurn > 0 ? ((churn / d.data.displayedChurn) * 100).toFixed(1) : '0';
              return escapeHtml(teamName) + ': ' + formatOrgLocValue(churn) + ' churn (' + pct + '%) in ' + truncateOrgFilePath(d.data.filename, 30);
            })
            .on('mouseover', function(event, d) {
              var churn = d[1] - d[0];
              var pct = d.data.displayedChurn > 0 ? ((churn / d.data.displayedChurn) * 100).toFixed(1) : '0';
              showOrgFileTooltip(event,
                '<strong>' + escapeHtml(teamName) + '</strong><br>' +
                escapeHtml(truncateOrgFilePath(d.data.filename, 45)) + '<br>' +
                'Churn: ' + formatOrgLocValue(churn) + ' (' + pct + '%)<br>' +
                '<small>Total File Churn: ' + formatOrgLocValue(d.data.totalChurn) + '</small><br>' +
                '<small style="opacity:0.7;">Click to open file</small>'
              );
            })
            .on('mousemove', moveOrgFileTooltip)
            .on('mouseout', hideOrgFileTooltip)
            .on('click', function(event, d) {
              vscode.postMessage({
                type: 'openFile',
                filePath: d.data.filename,
                repository: ''
              });
            })
            .on('keydown', function(event, d) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                vscode.postMessage({
                  type: 'openFile',
                  filePath: d.data.filename,
                  repository: ''
                });
              }
            });
        });

        // Y axis (file names, truncated)
        var yAxis = g.append('g').call(d3.axisLeft(y));
        yAxis.selectAll('text')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '10px')
          .each(function() {
            var t = d3.select(this);
            var fullPath = t.text();
            t.text(truncateOrgFilePath(fullPath, maxLabelLen));
          });
        // Add full path on hover via title
        yAxis.selectAll('.tick').append('title').text(function(d) { return d; });

        // X axis
        g.append('g').attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).ticks(6).tickFormat(function(d) {
            return formatOrgLocValue(d);
          }))
          .selectAll('text')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '10px');

        // X axis label
        svg.append('text')
          .attr('x', margin.left + width / 2)
          .attr('y', height + margin.top + 40)
          .attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '11px')
          .text('Lines Changed (Churn)');

        // Interactive Legend (right side, all display teams)
        var legendX = margin.left + width + 10;
        var legendY = margin.top;
        var legendG = svg.append('g')
          .attr('class', 'org-file-legend')
          .attr('transform', 'translate(' + legendX + ',' + legendY + ')');

        allTeams.forEach(function(team, i) {
          var isHidden = frequentFilesHiddenTeams.has(team);
          var teamColorIdx = team === 'Other Teams' ? MAX_TEAMS_DISPLAYED : i;
          var lg = legendG.append('g')
            .attr('class', 'legend-item')
            .attr('transform', 'translate(0,' + (i * 20) + ')')
            .attr('cursor', 'pointer')
            .attr('tabindex', '0')
            .attr('role', 'checkbox')
            .attr('aria-checked', !isHidden)
            .attr('aria-label', 'Toggle visibility of ' + team);

          lg.append('rect')
            .attr('width', 14)
            .attr('height', 14)
            .attr('rx', 2)
            .attr('fill', isHidden ? 'transparent' : getOrgTeamColor(teamColorIdx))
            .attr('stroke', getOrgTeamColor(teamColorIdx))
            .attr('stroke-width', 2)
            .attr('opacity', isHidden ? 0.4 : 1);

          lg.append('text')
            .attr('x', 18)
            .attr('y', 11)
            .attr('fill', 'var(--vscode-foreground, #ccc)')
            .attr('font-size', '11px')
            .attr('opacity', isHidden ? 0.4 : 1)
            .text(team.length > 16 ? team.slice(0, 15) + '...' : team)
            .append('title').text(team);

          // Click handler for toggling team visibility
          lg.on('click', function() {
            if (frequentFilesHiddenTeams.has(team)) {
              frequentFilesHiddenTeams.delete(team);
            } else {
              frequentFilesHiddenTeams.add(team);
            }
            renderOrgFrequentFilesChart(cachedOrgFrequentFilesData);
          });

          // Keyboard handler
          lg.on('keydown', function(event) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              if (frequentFilesHiddenTeams.has(team)) {
                frequentFilesHiddenTeams.delete(team);
              } else {
                frequentFilesHiddenTeams.add(team);
              }
              renderOrgFrequentFilesChart(cachedOrgFrequentFilesData);
            }
          });
        });
      }
  `;
}
