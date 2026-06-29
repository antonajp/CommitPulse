/**
 * HTML section generators for Organization Profile Dashboard.
 * Extracted to keep main HTML file under 600 lines.
 *
 * Ticket: GITX-207, GITX-208, GITX-214, GITX-201
 */

/**
 * Generate the HTML for GITX-207 and GITX-201 chart sections.
 * Includes:
 * - GITX-201: Sprint Velocity chart (stacked bars by TEAM with LOC trend line)
 * - GITX-201: Lines of Code chart (team-colored lines)
 * - Technology Stack doughnut chart
 * - Commit Hygiene gauge
 * - Comments Added line chart
 * - Test Files Modified line chart
 */
export function generateOrgProfileChartSections(): string {
  return `
      <!-- GITX-201: Sprint Velocity with Team Colors (PRIMARY CHART - below KPI cards) -->
      <section class="card card-wide" id="orgVelocityTeamsCard" aria-label="Sprint Velocity vs Lines of Code">
        <h2>Sprint Velocity vs Lines of Code</h2>
        <div class="chart-container">
          <div class="chart-skeleton" id="orgVelocityTeamsSkeleton" aria-hidden="true"></div>
          <div id="orgVelocityTeamsChart" class="d3-chart d3-dual-axis hidden" role="img" aria-label="Stacked bar chart showing story points per team with LOC trend line"></div>
        </div>
        <p class="card-empty hidden" id="orgVelocityTeamsEmpty">Sprint velocity data requires Linear/Jira issue assignment to organization members.</p>
        <p class="velocity-hint hidden" id="orgVelocityTeamsHint">
          <span class="hint-icon" aria-hidden="true">i</span>
          <span class="hint-text">Velocity uses COALESCE(jira_name, full_name) for accurate Jira assignee matching.</span>
        </p>
        <p class="velocity-hint hidden" id="orgVelocityTeamsNoJira">
          <span class="hint-icon" aria-hidden="true">i</span>
          <span class="hint-text">Connect Jira to see Sprint Velocity. Showing LOC only.</span>
        </p>
      </section>

      <!-- GITX-201: Lines of Code by Team (team-colored lines, after Sprint Velocity) -->
      <section class="card card-wide" id="orgLocByTeamCard" aria-label="Lines of Code by Team">
        <h2>Lines of Code by Team</h2>
        <div class="chart-container">
          <div class="chart-skeleton" id="orgLocByTeamSkeleton" aria-hidden="true"></div>
          <div id="orgLocByTeamChart" class="d3-chart hidden" role="img" aria-label="Line chart showing lines of code per team"></div>
        </div>
        <p class="card-empty hidden" id="orgLocByTeamEmpty">No data for selected timeframe.</p>
      </section>

      <!-- Technology Stack Doughnut Chart (GITX-207, GITX-214) -->
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
        <p class="card-empty hidden" id="techStackEmpty">No data for selected timeframe.</p>
        <p class="card-empty hidden" id="techStackExtEmpty">No file extension data for selected timeframe.</p>
      </section>

      <!-- Commit Hygiene Score Gauge (GITX-207, GITX-216: Enhanced metrics) -->
      <section class="card" id="hygieneCard" aria-label="Commit Hygiene Score">
        <h2>Commit Hygiene Score</h2>
        <div class="hygiene-container">
          <div class="chart-skeleton" id="hygieneSkeleton" aria-hidden="true"></div>
          <div id="hygieneGauge" class="hygiene-gauge hidden" role="img" aria-label="Gauge showing average commit hygiene score">
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
                <div class="breakdown-bar" id="jiraRefBar"></div>
              </div>
              <span class="breakdown-value" id="jiraRefValue">0%</span>
            </div>
            <div class="hygiene-breakdown-item">
              <span class="breakdown-label">Meaningful Message</span>
              <div class="breakdown-bar-container">
                <div class="breakdown-bar" id="meaningfulMsgBar"></div>
              </div>
              <span class="breakdown-value" id="meaningfulMsgValue">0%</span>
            </div>
            <div class="hygiene-breakdown-item">
              <span class="breakdown-label">Non-Merge Commits</span>
              <div class="breakdown-bar-container">
                <div class="breakdown-bar" id="nonMergeBar"></div>
              </div>
              <span class="breakdown-value" id="nonMergeValue">0%</span>
            </div>
            <div class="hygiene-total-commits" id="hygieneTotalCommits">Based on 0 commits</div>
          </div>
        </div>
        <p class="card-empty hidden" id="hygieneEmpty">No data for selected timeframe.</p>
      </section>

      <!-- Comments Added Line Chart (GITX-207) -->
      <section class="card" id="commentsWeekCard" aria-label="Comments Added">
        <h2>Comments Added</h2>
        <div class="chart-container">
          <div class="chart-skeleton" id="commentsWeekSkeleton" aria-hidden="true"></div>
          <div id="commentsWeekChart" class="d3-chart hidden" role="img" aria-label="Line chart showing comments added over time"></div>
        </div>
        <p class="card-empty hidden" id="commentsWeekEmpty">No data for selected timeframe.</p>
      </section>

      <!-- Test Files Modified Line Chart (GITX-207) -->
      <section class="card" id="testsWeekCard" aria-label="Test Files Modified">
        <h2>Test Files Modified</h2>
        <div class="chart-container">
          <div class="chart-skeleton" id="testsWeekSkeleton" aria-hidden="true"></div>
          <div id="testsWeekChart" class="d3-chart hidden" role="img" aria-label="Line chart showing test files modified over time"></div>
        </div>
        <p class="card-empty hidden" id="testsWeekEmpty">No data for selected timeframe.</p>
      </section>

      <!-- Top Complex Files by Team (GITX-208) -->
      <section class="card card-wide" id="orgComplexFilesCard" aria-label="Top Complex Files by Team">
        <h2>Top Complex Files (by Team)</h2>
        <div class="chart-container">
          <div class="chart-skeleton" id="orgComplexFilesSkeleton" aria-hidden="true"></div>
          <div id="orgComplexFilesChart" class="d3-chart d3-horizontal-bar hidden" role="img" aria-label="Horizontal stacked bar chart showing complex files by team contribution"></div>
        </div>
        <p class="card-empty hidden" id="orgComplexFilesEmpty">No complex file data available.</p>
      </section>

      <!-- Top Frequently Modified Files by Team (GITX-208) -->
      <section class="card card-wide" id="orgFrequentFilesCard" aria-label="Top Frequently Modified Files by Team">
        <h2>Top Frequently Modified Files (by Team)</h2>
        <div class="chart-container">
          <div class="chart-skeleton" id="orgFrequentFilesSkeleton" aria-hidden="true"></div>
          <div id="orgFrequentFilesChart" class="d3-chart d3-horizontal-bar hidden" role="img" aria-label="Horizontal stacked bar chart showing frequently modified files by team contribution"></div>
        </div>
        <p class="card-empty hidden" id="orgFrequentFilesEmpty">No frequently modified file data available.</p>
      </section>

      <!-- Hot Spots Bubble Chart (GITX-209) -->
      <section class="card card-wide" id="orgHotSpotsCard" aria-label="Hot Spots">
        <h2>Hot Spots</h2>
        <p class="chart-description">Top 10 risky files: X=complexity, Y=churn, size=LOC, color=risk tier</p>
        <div class="chart-container">
          <div class="chart-skeleton" id="orgHotSpotsSkeleton" aria-hidden="true"></div>
          <div id="orgHotSpotsChart" class="d3-chart d3-bubble hidden" role="img" aria-label="Bubble chart showing hot spots: X=complexity, Y=churn, size=LOC, color=risk tier"></div>
        </div>
        <p class="card-empty hidden" id="orgHotSpotsEmpty">No hot spots identified</p>
      </section>

      <!-- Knowledge Concentration Treemap (GITX-209) -->
      <section class="card card-wide" id="orgKnowledgeCard" aria-label="Knowledge Concentration">
        <h2>Knowledge Concentration</h2>
        <p class="chart-description">Files with high single-contributor ownership risk. Color-coded by team member.</p>
        <div class="chart-container">
          <div class="chart-skeleton" id="orgKnowledgeSkeleton" aria-hidden="true"></div>
          <div id="orgKnowledgeChart" class="d3-chart d3-treemap hidden" role="img" aria-label="Treemap showing knowledge concentration risks, color-coded by team member"></div>
        </div>
        <div id="orgKnowledgeLegend" class="org-knowledge-legend hidden" role="img" aria-label="Team member color legend"></div>
        <p class="card-empty hidden" id="orgKnowledgeEmpty">No concentration risks</p>
      </section>`;
}
