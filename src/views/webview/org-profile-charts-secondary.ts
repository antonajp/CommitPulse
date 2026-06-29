/**
 * Secondary D3.js chart rendering functions for the Organization Profile Dashboard.
 * Contains inline JavaScript code for rendering secondary charts in the webview.
 * GITX-207: Technology Stack, Hygiene, Comments, Tests charts.
 * GITX-214: Technology Stack toggle between Languages and File Extensions.
 *
 * Split from org-profile-charts.ts to keep files under 600 lines.
 */

/**
 * Generate the JavaScript code for the Technology Stack doughnut chart.
 * GITX-207: Percentages relative to total.
 * GITX-214: Toggle between Languages (categories) and File Extensions views.
 */
export function generateOrgTechStackChartScript(): string {
  return `
      // ======================================================================
      // GITX-207, GITX-214: Technology Stack Doughnut Chart with Toggle
      // ======================================================================
      // GITX-214: State for tech stack toggle
      let cachedTechStackByExtension = [];
      let currentTechStackView = 'languages'; // 'languages' or 'extensions'

      function renderTechStackChart(data) {
        hideSkeleton('techStackSkeleton');
        cachedTechStack = data;

        // If currently showing languages view, render the chart
        if (currentTechStackView === 'languages') {
          renderTechStackLanguagesView(data);
        }
      }

      // GITX-214: Render languages (categories) view
      function renderTechStackLanguagesView(data) {
        document.getElementById('techStackExtEmpty').classList.add('hidden');

        if (!data || data.length === 0) {
          document.getElementById('techStackChart').classList.add('hidden');
          document.getElementById('techStackEmpty').classList.remove('hidden');
          return;
        }

        document.getElementById('techStackChart').classList.remove('hidden');
        document.getElementById('techStackEmpty').classList.add('hidden');

        // Aggregate by category (data may have multiple entries per category from different repos)
        var categoryMap = {};
        data.forEach(function(d) {
          if (!categoryMap[d.category]) {
            categoryMap[d.category] = { category: d.category, locCount: 0, percentage: 0 };
          }
          categoryMap[d.category].locCount += d.locCount;
          categoryMap[d.category].percentage += d.percentage;
        });
        var aggregatedData = Object.values(categoryMap).sort(function(a, b) { return b.locCount - a.locCount; });
        var chartData = aggregatedData.slice(0, 10); // Limit to top 10 for readability

        renderTechStackDoughnut(chartData, 'category');
      }

      // GITX-214: Render file extensions view
      function renderTechStackExtensionsView(data) {
        document.getElementById('techStackEmpty').classList.add('hidden');

        if (!data || data.length === 0) {
          document.getElementById('techStackChart').classList.add('hidden');
          document.getElementById('techStackExtEmpty').classList.remove('hidden');
          return;
        }

        document.getElementById('techStackChart').classList.remove('hidden');
        document.getElementById('techStackExtEmpty').classList.add('hidden');

        // Aggregate by extension (data may have multiple entries per extension from different repos)
        var extensionMap = {};
        data.forEach(function(d) {
          var ext = d.extension || '(no extension)';
          if (!extensionMap[ext]) {
            extensionMap[ext] = { extension: ext, locCount: 0, percentage: 0 };
          }
          extensionMap[ext].locCount += d.locCount;
          extensionMap[ext].percentage += d.percentage;
        });
        var aggregatedData = Object.values(extensionMap).sort(function(a, b) { return b.locCount - a.locCount; });
        // Top 15 extensions, rest grouped as "Other"
        var topExtensions = aggregatedData.slice(0, 15);
        var otherData = aggregatedData.slice(15);
        if (otherData.length > 0) {
          var otherTotal = otherData.reduce(function(acc, d) { return acc + d.locCount; }, 0);
          var otherPct = otherData.reduce(function(acc, d) { return acc + d.percentage; }, 0);
          topExtensions.push({ extension: 'Other', locCount: otherTotal, percentage: otherPct });
        }

        renderTechStackDoughnut(topExtensions, 'extension');
      }

      // GITX-214: Shared doughnut chart renderer for both views
      function renderTechStackDoughnut(chartData, labelKey) {
        var container = document.getElementById('techStackChart');
        container.innerHTML = '';
        var width = container.clientWidth;
        var height = 280;
        var radius = Math.min(width, height) / 2 - 40;

        var svg = d3.select(container)
          .append('svg')
          .attr('width', width)
          .attr('height', height)
          .append('g')
          .attr('transform', 'translate(' + (width / 3) + ',' + (height / 2) + ')');

        var color = d3.scaleOrdinal().domain(chartData.map(function(d) { return d[labelKey]; })).range(CHART_COLORS);

        var pie = d3.pie().value(function(d) { return d.locCount; }).sort(null);
        var arc = d3.arc().innerRadius(radius * 0.5).outerRadius(radius);
        var labelArc = d3.arc().innerRadius(radius * 0.75).outerRadius(radius * 0.75);

        var arcs = svg.selectAll('.arc')
          .data(pie(chartData))
          .enter()
          .append('g')
          .attr('class', 'arc');

        arcs.append('path')
          .attr('d', arc)
          .attr('fill', function(d) { return color(d.data[labelKey]); })
          .attr('stroke', 'var(--vscode-editor-background)')
          .attr('stroke-width', 2)
          .attr('tabindex', 0)
          .attr('role', 'img')
          .attr('aria-label', function(d) {
            return d.data[labelKey] + ': ' + formatNumber(d.data.locCount) + ' lines (' + d.data.percentage.toFixed(1) + '%)';
          })
          .append('title')
          .text(function(d) {
            return d.data[labelKey] + '\\n' + formatNumber(d.data.locCount) + ' lines\\n' + d.data.percentage.toFixed(1) + '%';
          });

        // Add percentage labels on segments (only for segments > 5%)
        arcs.filter(function(d) { return d.data.percentage > 5; })
          .append('text')
          .attr('transform', function(d) { return 'translate(' + labelArc.centroid(d) + ')'; })
          .attr('text-anchor', 'middle')
          .style('fill', 'var(--vscode-editor-background)')
          .style('font-size', '11px')
          .style('font-weight', '600')
          .text(function(d) { return d.data.percentage.toFixed(1) + '%'; });

        // Legend
        var legend = svg.append('g')
          .attr('transform', 'translate(' + (radius + 20) + ',' + (-chartData.length * 10) + ')');

        chartData.forEach(function(d, i) {
          var g = legend.append('g').attr('transform', 'translate(0,' + (i * 20) + ')');
          g.append('rect').attr('width', 12).attr('height', 12).attr('fill', color(d[labelKey]));
          g.append('text')
            .attr('x', 16).attr('y', 10)
            .style('fill', 'var(--vscode-foreground)')
            .style('font-size', '11px')
            .text(d[labelKey] + ' (' + d.percentage.toFixed(1) + '%)');
        });
      }

      // GITX-214: Handle tech stack by extension data response
      function handleTechStackByExtensionData(data) {
        cachedTechStackByExtension = data;
        hideSkeleton('techStackSkeleton');
        if (currentTechStackView === 'extensions') {
          renderTechStackExtensionsView(data);
        }
      }

      // GITX-214: Initialize tech stack toggle
      function initTechStackToggle() {
        var toggleContainer = document.querySelector('#techStackCard .metric-toggle');
        if (!toggleContainer) return;

        var buttons = toggleContainer.querySelectorAll('.metric-btn');
        buttons.forEach(function(btn) {
          btn.addEventListener('click', function() {
            var view = this.getAttribute('data-view');
            if (view === currentTechStackView) return;

            // Update toggle state
            buttons.forEach(function(b) {
              b.classList.remove('active');
              b.setAttribute('aria-checked', 'false');
              b.setAttribute('tabindex', '-1');
            });
            this.classList.add('active');
            this.setAttribute('aria-checked', 'true');
            this.setAttribute('tabindex', '0');

            // GITX-214: ARIA live region for screen reader announcement
            var announcement = view === 'languages' ? 'Showing Languages view' : 'Showing File Extensions view';
            announceToScreenReader(announcement);

            currentTechStackView = view;
            // Persist state in VS Code webview state
            var savedState = vscode.getState() || {};
            savedState.techStackView = view;
            vscode.setState(savedState);

            // Switch view
            if (view === 'languages') {
              if (cachedTechStack && cachedTechStack.length > 0) {
                renderTechStackLanguagesView(cachedTechStack);
              } else {
                // Request data if not cached
                vscode.postMessage({
                  type: 'requestOrgTechStack',
                  organizationId: currentOrgId,
                  timeframeDays: currentTimeframe
                });
              }
            } else {
              if (cachedTechStackByExtension && cachedTechStackByExtension.length > 0) {
                renderTechStackExtensionsView(cachedTechStackByExtension);
              } else {
                // Request extension data
                showSkeleton('techStackSkeleton');
                vscode.postMessage({
                  type: 'requestOrgTechStackByExtension',
                  organizationId: currentOrgId,
                  timeframeDays: currentTimeframe
                });
              }
            }
          });

          // GITX-214: Keyboard navigation (Tab to toggle, Enter/Space to activate)
          btn.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              this.click();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              var currentBtn = this;
              var allBtns = Array.from(buttons);
              var currentIndex = allBtns.indexOf(currentBtn);
              var nextIndex = e.key === 'ArrowRight' ? (currentIndex + 1) % allBtns.length : (currentIndex - 1 + allBtns.length) % allBtns.length;
              allBtns[nextIndex].focus();
            }
          });
        });
      }

      // GITX-214: Screen reader announcement helper
      function announceToScreenReader(message) {
        var announcement = document.getElementById('srAnnouncement');
        if (!announcement) {
          announcement = document.createElement('div');
          announcement.id = 'srAnnouncement';
          announcement.setAttribute('role', 'status');
          announcement.setAttribute('aria-live', 'polite');
          announcement.setAttribute('aria-atomic', 'true');
          announcement.className = 'sr-only';
          document.body.appendChild(announcement);
        }
        announcement.textContent = message;
      }

      // GITX-214: Restore tech stack toggle state from VS Code state
      function restoreTechStackToggleState() {
        var savedState = vscode.getState();
        if (savedState && savedState.techStackView) {
          currentTechStackView = savedState.techStackView;
          var toggleContainer = document.querySelector('#techStackCard .metric-toggle');
          if (toggleContainer) {
            var buttons = toggleContainer.querySelectorAll('.metric-btn');
            buttons.forEach(function(btn) {
              var view = btn.getAttribute('data-view');
              if (view === currentTechStackView) {
                btn.classList.add('active');
                btn.setAttribute('aria-checked', 'true');
                btn.setAttribute('tabindex', '0');
              } else {
                btn.classList.remove('active');
                btn.setAttribute('aria-checked', 'false');
                btn.setAttribute('tabindex', '-1');
              }
            });
          }
        }
      }
`;
}

/**
 * Generate the JavaScript code for the Commit Hygiene gauge.
 * GITX-207: Average across organization members.
 */
export function generateOrgHygieneChartScript(): string {
  return `
      // ======================================================================
      // GITX-207: Commit Hygiene Score Gauge
      // ======================================================================
      function renderHygieneScore(data) {
        hideSkeleton('hygieneSkeleton');
        cachedHygieneScore = data;

        if (!data || data.totalCommits === 0) {
          document.getElementById('hygieneGauge').classList.add('hidden');
          document.getElementById('hygieneBreakdown').classList.add('hidden');
          document.getElementById('hygieneEmpty').classList.remove('hidden');
          return;
        }

        document.getElementById('hygieneGauge').classList.remove('hidden');
        document.getElementById('hygieneBreakdown').classList.remove('hidden');
        document.getElementById('hygieneEmpty').classList.add('hidden');

        // Update score display
        var scoreValue = document.getElementById('hygieneScoreValue');
        scoreValue.textContent = data.avgHygieneScore.toFixed(0);

        // Color code based on score
        if (data.avgHygieneScore >= 80) {
          scoreValue.style.color = 'var(--vscode-testing-iconPassed, #4ec9b0)';
        } else if (data.avgHygieneScore >= 60) {
          scoreValue.style.color = 'var(--vscode-editorWarning-foreground, #cca700)';
        } else {
          scoreValue.style.color = 'var(--vscode-testing-iconFailed, #f48771)';
        }

        // GITX-216: Update tier badge (like Developer Profile)
        var tierBadge = document.getElementById('hygieneTierBadge');
        if (tierBadge && data.qualityTier) {
          tierBadge.textContent = data.qualityTier.charAt(0).toUpperCase() + data.qualityTier.slice(1);
          tierBadge.className = 'hygiene-tier-badge tier-' + data.qualityTier;
        }

        // GITX-216: Update breakdown bars (Jira Reference, Meaningful Message, Non-Merge)
        var jiraRefBar = document.getElementById('jiraRefBar');
        if (jiraRefBar) {
          jiraRefBar.style.width = (data.jiraRefPercentage || 0) + '%';
        }
        var jiraRefValue = document.getElementById('jiraRefValue');
        if (jiraRefValue) {
          jiraRefValue.textContent = (data.jiraRefPercentage || 0).toFixed(1) + '%';
        }

        var meaningfulMsgBar = document.getElementById('meaningfulMsgBar');
        if (meaningfulMsgBar) {
          meaningfulMsgBar.style.width = (data.meaningfulMsgPercentage || 0) + '%';
        }
        var meaningfulMsgValue = document.getElementById('meaningfulMsgValue');
        if (meaningfulMsgValue) {
          meaningfulMsgValue.textContent = (data.meaningfulMsgPercentage || 0).toFixed(1) + '%';
        }

        var nonMergeBar = document.getElementById('nonMergeBar');
        if (nonMergeBar) {
          nonMergeBar.style.width = (data.nonMergePercentage || 100) + '%';
        }
        var nonMergeValue = document.getElementById('nonMergeValue');
        if (nonMergeValue) {
          nonMergeValue.textContent = (data.nonMergePercentage || 100).toFixed(1) + '%';
        }

        // Update total commits
        var hygieneTotalCommits = document.getElementById('hygieneTotalCommits');
        if (hygieneTotalCommits) {
          hygieneTotalCommits.textContent = 'Based on ' + formatNumber(data.totalCommits) + ' commits';
        }
      }
`;
}

/**
 * Generate the JavaScript code for the Comments Added line chart.
 * GITX-207: Sum aggregation.
 */
export function generateOrgCommentsChartScript(): string {
  return `
      // ======================================================================
      // GITX-207: Comments Added Line Chart
      // ======================================================================
      function renderCommentsWeekChart(data) {
        hideSkeleton('commentsWeekSkeleton');
        cachedCommentsWeek = data;

        if (!data || data.length === 0) {
          document.getElementById('commentsWeekChart').classList.add('hidden');
          document.getElementById('commentsWeekEmpty').classList.remove('hidden');
          return;
        }

        document.getElementById('commentsWeekChart').classList.remove('hidden');
        document.getElementById('commentsWeekEmpty').classList.add('hidden');

        var container = document.getElementById('commentsWeekChart');
        container.innerHTML = '';
        var margin = { top: 20, right: 30, bottom: 60, left: 50 };
        var width = container.clientWidth - margin.left - margin.right;
        var height = 250 - margin.top - margin.bottom;

        var svg = d3.select(container)
          .append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom)
          .append('g')
          .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        var x = d3.scaleBand()
          .domain(data.map(function(d) { return d.weekStart; }))
          .range([0, width])
          .padding(0.1);

        var maxY = d3.max(data, function(d) { return d.commentLinesAdded; }) || 10;
        var y = d3.scaleLinear()
          .domain([0, maxY])
          .nice()
          .range([height, 0]);

        // Line
        var line = d3.line()
          .x(function(d) { return x(d.weekStart) + x.bandwidth() / 2; })
          .y(function(d) { return y(d.commentLinesAdded); })
          .curve(d3.curveMonotoneX);

        svg.append('path')
          .datum(data)
          .attr('fill', 'none')
          .attr('stroke', CHART_COLORS[1])
          .attr('stroke-width', 2)
          .attr('d', line);

        // Data points
        svg.selectAll('.point')
          .data(data)
          .enter()
          .append('circle')
          .attr('class', 'point')
          .attr('cx', function(d) { return x(d.weekStart) + x.bandwidth() / 2; })
          .attr('cy', function(d) { return y(d.commentLinesAdded); })
          .attr('r', 4)
          .attr('fill', CHART_COLORS[1])
          .attr('tabindex', 0)
          .attr('role', 'img')
          .attr('aria-label', function(d) { return formatWeekDate(d.weekStart) + ': ' + formatNumber(d.commentLinesAdded) + ' comment lines'; })
          .append('title')
          .text(function(d) { return d.weekStart + '\\n' + formatNumber(d.commentLinesAdded) + ' comment lines'; });

        // X axis
        svg.append('g')
          .attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).tickFormat(function(d) { return formatXAxisDate(d); }))
          .selectAll('text')
          .attr('transform', 'rotate(-45)')
          .style('text-anchor', 'end');

        // Y axis
        svg.append('g').call(d3.axisLeft(y).ticks(5));

        // Y axis label
        svg.append('text')
          .attr('transform', 'rotate(-90)')
          .attr('y', -margin.left + 15)
          .attr('x', -height / 2)
          .attr('text-anchor', 'middle')
          .style('fill', 'var(--vscode-foreground)')
          .text('Comment Lines Added');
      }
`;
}

/**
 * Generate the JavaScript code for the Test Files Modified line chart.
 * GITX-207: Sum aggregation.
 */
export function generateOrgTestsChartScript(): string {
  return `
      // ======================================================================
      // GITX-207: Test Files Modified Line Chart
      // ======================================================================
      function renderTestsWeekChart(data) {
        hideSkeleton('testsWeekSkeleton');
        cachedTestsWeek = data;

        if (!data || data.length === 0) {
          document.getElementById('testsWeekChart').classList.add('hidden');
          document.getElementById('testsWeekEmpty').classList.remove('hidden');
          return;
        }

        document.getElementById('testsWeekChart').classList.remove('hidden');
        document.getElementById('testsWeekEmpty').classList.add('hidden');

        var container = document.getElementById('testsWeekChart');
        container.innerHTML = '';
        var margin = { top: 20, right: 30, bottom: 60, left: 50 };
        var width = container.clientWidth - margin.left - margin.right;
        var height = 250 - margin.top - margin.bottom;

        var svg = d3.select(container)
          .append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom)
          .append('g')
          .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        var x = d3.scaleBand()
          .domain(data.map(function(d) { return d.weekStart; }))
          .range([0, width])
          .padding(0.1);

        var maxY = d3.max(data, function(d) { return d.testFilesModified; }) || 5;
        var y = d3.scaleLinear()
          .domain([0, maxY])
          .nice()
          .range([height, 0]);

        // Line
        var line = d3.line()
          .x(function(d) { return x(d.weekStart) + x.bandwidth() / 2; })
          .y(function(d) { return y(d.testFilesModified); })
          .curve(d3.curveMonotoneX);

        svg.append('path')
          .datum(data)
          .attr('fill', 'none')
          .attr('stroke', CHART_COLORS[2])
          .attr('stroke-width', 2)
          .attr('d', line);

        // Data points
        svg.selectAll('.point')
          .data(data)
          .enter()
          .append('circle')
          .attr('class', 'point')
          .attr('cx', function(d) { return x(d.weekStart) + x.bandwidth() / 2; })
          .attr('cy', function(d) { return y(d.testFilesModified); })
          .attr('r', 4)
          .attr('fill', CHART_COLORS[2])
          .attr('tabindex', 0)
          .attr('role', 'img')
          .attr('aria-label', function(d) { return formatWeekDate(d.weekStart) + ': ' + d.testFilesModified + ' test files'; })
          .append('title')
          .text(function(d) { return d.weekStart + '\\n' + d.testFilesModified + ' test files\\n' + formatNumber(d.testLinesAdded) + ' lines'; });

        // X axis
        svg.append('g')
          .attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).tickFormat(function(d) { return formatXAxisDate(d); }))
          .selectAll('text')
          .attr('transform', 'rotate(-45)')
          .style('text-anchor', 'end');

        // Y axis
        svg.append('g').call(d3.axisLeft(y).ticks(5));

        // Y axis label
        svg.append('text')
          .attr('transform', 'rotate(-90)')
          .attr('y', -margin.left + 15)
          .attr('x', -height / 2)
          .attr('text-anchor', 'middle')
          .style('fill', 'var(--vscode-foreground)')
          .text('Test Files');
      }
`;
}

/**
 * Generate all secondary chart rendering scripts combined.
 */
export function generateOrgProfileSecondaryChartScripts(): string {
  return generateOrgTechStackChartScript() +
    generateOrgHygieneChartScript() +
    generateOrgCommentsChartScript() +
    generateOrgTestsChartScript();
}
