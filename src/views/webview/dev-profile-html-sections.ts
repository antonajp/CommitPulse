/**
 * HTML section generators for Developer Profile Dashboard.
 * Extracted to keep main HTML file under 600 lines.
 *
 * Ticket: GITX-156, GITX-157, GITX-172, GITX-188, GITX-199, GITX-214
 */

/**
 * Generate the HTML for the primary Sprint Velocity chart (GITX-199).
 * This is the primary chart displayed right after KPI cards.
 * Shows developer's story points as colored bars against team total with LOC trend line.
 */
export function generatePrimaryVelocityChartHtml(): string {
  return `
      <!-- Sprint Velocity vs LOC Chart - Primary Position (GITX-199) -->
      <section class="card card-wide chart-lazy" id="velocityCard" aria-label="Sprint Velocity vs Lines of Code" data-chart-id="velocity">
        <h2>Sprint Velocity vs Lines of Code</h2>
        <div class="chart-container">
          <div class="chart-skeleton" id="velocitySkeleton" aria-hidden="true"></div>
          <div id="velocityChart" class="d3-chart d3-dual-axis hidden" role="img" aria-label="Stacked bar chart showing your story points against team total with lines of code trend"></div>
        </div>
        <p class="card-empty hidden" id="velocityEmpty">Sprint velocity data requires Linear/Jira issue assignment to this developer.</p>
        <p class="velocity-no-jira hidden" id="velocityNoJira">
          <span class="hint-icon" aria-hidden="true">i</span>
          <span class="hint-text">Connect Jira to see Sprint Velocity. Showing Lines of Code only.</span>
        </p>
        <p class="velocity-hint hidden" id="velocityHint">
          <span class="hint-icon" aria-hidden="true">i</span>
          <span class="hint-text">Colored bars show your contribution. Muted bars show rest of team.</span>
        </p>
      </section>`;
}

/**
 * Generate the HTML for GITX-156 and GITX-157 chart sections (without Test Debt).
 * GITX-188: Used by Team Profile to exclude Test Debt section.
 * GITX-199: Velocity chart moved to primary position, removed from this section.
 */
export function generateGitx156HtmlSectionsForTeamProfile(): string {
  return `

      <!-- Technology Stack Doughnut Chart (GITX-156, GITX-214) -->
      <section class="card" id="techStackCard" aria-label="Technology Stack">
        <div class="card-header-with-toggle">
          <h2>Technology Stack</h2>
          <div class="metric-toggle" role="radiogroup" aria-label="Technology stack grouping">
            <button class="metric-btn active" data-view="languages" role="radio" aria-checked="true" tabindex="0">
              Languages
            </button>
            <button class="metric-btn" data-view="extensions" role="radio" aria-checked="false" tabindex="-1">
              File Extensions
            </button>
          </div>
        </div>
        <div class="chart-container">
          <div class="chart-skeleton" id="techStackSkeleton" aria-hidden="true"></div>
          <div id="techStackChart" class="d3-chart d3-doughnut hidden" role="img" aria-label="Doughnut chart showing technology stack contributions"></div>
        </div>
        <p class="card-empty hidden" id="techStackEmpty">No technology stack data available for the selected timeframe.</p>
        <p class="card-empty hidden" id="techStackExtEmpty">No file extension data for selected timeframe.</p>
      </section>

      <!-- Commit Hygiene Score Gauge (GITX-156) -->
      <section class="card" id="hygieneCard" aria-label="Commit Hygiene Score">
        <h2>Commit Hygiene Score</h2>
        <div class="hygiene-container">
          <div class="chart-skeleton" id="hygieneSkeleton" aria-hidden="true"></div>
          <div id="hygieneGauge" class="hygiene-gauge hidden" role="img" aria-label="Gauge showing commit hygiene score">
            <div class="hygiene-score-display">
              <span class="hygiene-score-value" id="hygieneScoreValue">0</span>
              <span class="hygiene-score-label">Hygiene Score</span>
            </div>
            <div class="hygiene-tier-badge" id="hygieneTierBadge">-</div>
          </div>
          <div id="hygieneBreakdown" class="hygiene-breakdown hidden">
            <div class="hygiene-breakdown-item">
              <span class="breakdown-label">Jira Reference</span>
              <div class="breakdown-bar-container">
                <div class="breakdown-bar" id="jiraRefBar" ></div>
              </div>
              <span class="breakdown-value" id="jiraRefValue">0%</span>
            </div>
            <div class="hygiene-breakdown-item">
              <span class="breakdown-label">Meaningful Message</span>
              <div class="breakdown-bar-container">
                <div class="breakdown-bar" id="meaningfulMsgBar" ></div>
              </div>
              <span class="breakdown-value" id="meaningfulMsgValue">0%</span>
            </div>
            <div class="hygiene-breakdown-item">
              <span class="breakdown-label">Non-Merge Commits</span>
              <div class="breakdown-bar-container">
                <div class="breakdown-bar" id="nonMergeBar" ></div>
              </div>
              <span class="breakdown-value" id="nonMergeValue">0%</span>
            </div>
            <div class="hygiene-total-commits" id="hygieneTotalCommits">Based on 0 commits</div>
          </div>
        </div>
        <p class="card-empty hidden" id="hygieneEmpty">No hygiene data available for the selected timeframe.</p>
      </section>

      <!-- Comments Per Week Line Chart (GITX-156) -->
      <section class="card" id="commentsWeekCard" aria-label="Comments Added">
        <h2>Comments Added</h2>
        <div class="chart-container">
          <div class="chart-skeleton" id="commentsWeekSkeleton" aria-hidden="true"></div>
          <div id="commentsWeekChart" class="d3-chart hidden" role="img" aria-label="Line chart showing comments added"></div>
        </div>
        <p class="card-empty hidden" id="commentsWeekEmpty">No comment data available for the selected timeframe.</p>
      </section>

      <!-- Tests Per Week Line Chart (GITX-156) -->
      <section class="card" id="testsWeekCard" aria-label="Test Files Modified">
        <h2>Test Files Modified</h2>
        <div class="chart-container">
          <div class="chart-skeleton" id="testsWeekSkeleton" aria-hidden="true"></div>
          <div id="testsWeekChart" class="d3-chart hidden" role="img" aria-label="Line chart showing test files modified"></div>
        </div>
        <p class="card-empty hidden" id="testsWeekEmpty">No test data available for the selected timeframe.</p>
      </section>`;
}

/**
 * Generate the HTML for GITX-156 chart sections (without velocity - moved to primary position).
 * GITX-199: Velocity chart is now generated separately via generatePrimaryVelocityChartHtml().
 * GITX-216: Test Debt chart removed.
 */
export function generateGitx156HtmlSections(): string {
  return `
      <!-- Technology Stack Doughnut Chart (GITX-156, GITX-214) -->
      <section class="card" id="techStackCard" aria-label="Technology Stack">
        <div class="card-header-with-toggle">
          <h2>Technology Stack</h2>
          <div class="metric-toggle" role="radiogroup" aria-label="Technology stack grouping">
            <button class="metric-btn active" data-view="languages" role="radio" aria-checked="true" tabindex="0">
              Languages
            </button>
            <button class="metric-btn" data-view="extensions" role="radio" aria-checked="false" tabindex="-1">
              File Extensions
            </button>
          </div>
        </div>
        <div class="chart-container">
          <div class="chart-skeleton" id="techStackSkeleton" aria-hidden="true"></div>
          <div id="techStackChart" class="d3-chart d3-doughnut hidden" role="img" aria-label="Doughnut chart showing technology stack contributions"></div>
        </div>
        <p class="card-empty hidden" id="techStackEmpty">No technology stack data available for the selected timeframe.</p>
        <p class="card-empty hidden" id="techStackExtEmpty">No file extension data for selected timeframe.</p>
      </section>

      <!-- Commit Hygiene Score Gauge (GITX-156) -->
      <section class="card" id="hygieneCard" aria-label="Commit Hygiene Score">
        <h2>Commit Hygiene Score</h2>
        <div class="hygiene-container">
          <div class="chart-skeleton" id="hygieneSkeleton" aria-hidden="true"></div>
          <div id="hygieneGauge" class="hygiene-gauge hidden" role="img" aria-label="Gauge showing commit hygiene score">
            <div class="hygiene-score-display">
              <span class="hygiene-score-value" id="hygieneScoreValue">0</span>
              <span class="hygiene-score-label">Hygiene Score</span>
            </div>
            <div class="hygiene-tier-badge" id="hygieneTierBadge">-</div>
          </div>
          <div id="hygieneBreakdown" class="hygiene-breakdown hidden">
            <div class="hygiene-breakdown-item">
              <span class="breakdown-label">Jira Reference</span>
              <div class="breakdown-bar-container">
                <div class="breakdown-bar" id="jiraRefBar" ></div>
              </div>
              <span class="breakdown-value" id="jiraRefValue">0%</span>
            </div>
            <div class="hygiene-breakdown-item">
              <span class="breakdown-label">Meaningful Message</span>
              <div class="breakdown-bar-container">
                <div class="breakdown-bar" id="meaningfulMsgBar" ></div>
              </div>
              <span class="breakdown-value" id="meaningfulMsgValue">0%</span>
            </div>
            <div class="hygiene-breakdown-item">
              <span class="breakdown-label">Non-Merge Commits</span>
              <div class="breakdown-bar-container">
                <div class="breakdown-bar" id="nonMergeBar" ></div>
              </div>
              <span class="breakdown-value" id="nonMergeValue">0%</span>
            </div>
            <div class="hygiene-total-commits" id="hygieneTotalCommits">Based on 0 commits</div>
          </div>
        </div>
        <p class="card-empty hidden" id="hygieneEmpty">No hygiene data available for the selected timeframe.</p>
      </section>

      <!-- Comments Per Week Line Chart (GITX-156) -->
      <section class="card" id="commentsWeekCard" aria-label="Comments Added">
        <h2>Comments Added</h2>
        <div class="chart-container">
          <div class="chart-skeleton" id="commentsWeekSkeleton" aria-hidden="true"></div>
          <div id="commentsWeekChart" class="d3-chart hidden" role="img" aria-label="Line chart showing comments added"></div>
        </div>
        <p class="card-empty hidden" id="commentsWeekEmpty">No comment data available for the selected timeframe.</p>
      </section>

      <!-- Tests Per Week Line Chart (GITX-156) -->
      <section class="card" id="testsWeekCard" aria-label="Test Files Modified">
        <h2>Test Files Modified</h2>
        <div class="chart-container">
          <div class="chart-skeleton" id="testsWeekSkeleton" aria-hidden="true"></div>
          <div id="testsWeekChart" class="d3-chart hidden" role="img" aria-label="Line chart showing test files modified"></div>
        </div>
        <p class="card-empty hidden" id="testsWeekEmpty">No test data available for the selected timeframe.</p>
      </section>`;
}
