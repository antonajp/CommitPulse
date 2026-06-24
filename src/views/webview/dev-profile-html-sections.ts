/**
 * HTML section generators for Developer Profile Dashboard.
 * Extracted to keep main HTML file under 600 lines.
 *
 * Ticket: GITX-156, GITX-157, GITX-172
 */

/**
 * Generate the HTML for GITX-156 and GITX-157 chart sections.
 */
export function generateGitx156HtmlSections(): string {
  return `
      <!-- Sprint Velocity vs LOC Chart (GITX-157) -->
      <section class="card card-wide chart-lazy" id="velocityCard" aria-label="Sprint Velocity vs Lines of Code" data-chart-id="velocity">
        <h2>Sprint Velocity vs Lines of Code</h2>
        <div class="chart-container">
          <div class="chart-skeleton" id="velocitySkeleton" aria-hidden="true"></div>
          <div id="velocityChart" class="d3-chart d3-dual-axis hidden" role="img" aria-label="Dual-axis chart showing story points and lines of code per week"></div>
        </div>
        <p class="card-empty hidden" id="velocityEmpty">Sprint velocity data requires Linear/Jira issue assignment to this developer.</p>
        <p class="velocity-hint hidden" id="velocityHint">
          <span class="hint-icon" aria-hidden="true">i</span>
          <span class="hint-text">Click on data points to view sprint/week details.</span>
        </p>
      </section>

      <!-- Technology Stack Doughnut Chart (GITX-156) -->
      <section class="card" id="techStackCard" aria-label="Technology Stack">
        <h2>Technology Stack</h2>
        <div class="chart-container">
          <div class="chart-skeleton" id="techStackSkeleton" aria-hidden="true"></div>
          <div id="techStackChart" class="d3-chart d3-doughnut hidden" role="img" aria-label="Doughnut chart showing technology stack contributions"></div>
        </div>
        <p class="card-empty hidden" id="techStackEmpty">No technology stack data available for the selected timeframe.</p>
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
      </section>

      <!-- Test Debt Risk Analysis (GITX-172) -->
      <section class="card card-wide chart-lazy" id="testDebtCard" aria-label="Test Debt Risk Analysis" data-chart-id="testDebt">
        <h2>Test Debt Risk Analysis</h2>
        <div class="test-debt-container">
          <div class="chart-container test-debt-chart-container">
            <div class="chart-skeleton" id="testDebtSkeleton" aria-hidden="true"></div>
            <div id="testDebtChart" class="d3-chart d3-stacked-bar hidden" role="img" aria-label="Stacked bar chart showing weekly commits by test coverage tier"></div>
          </div>
          <div class="test-debt-metrics hidden" id="testDebtMetrics">
            <div class="test-debt-roi" id="testDebtRoi">
              <span class="roi-value" id="roiValue">-</span>
              <span class="roi-label">Your low-test commits cause <span id="roiMultiplier">0</span>x more bugs</span>
            </div>
            <div class="test-debt-comparison hidden" id="testDebtComparison">
              <span class="comparison-label">Team average: <span id="teamAvgRoi">-</span>x</span>
            </div>
            <div class="test-debt-summary" id="testDebtSummary">
              <span class="summary-item"><span id="lowTestCount">0</span> low-test commits</span>
              <span class="summary-item"><span id="totalTestCommits">0</span> total commits</span>
            </div>
          </div>
        </div>
        <p class="card-empty hidden" id="testDebtEmpty">No test coverage data available for this developer.</p>
        <p class="card-success hidden" id="testDebtSuccess">Great job! All commits have good test coverage.</p>
        <details class="chart-explanation">
          <summary>What is Test Debt?</summary>
          <p>Test debt occurs when production code is committed without adequate test coverage. This chart shows your commits by test coverage tier:</p>
          <ul>
            <li><span class="tier-badge tier-low">Low</span> Test ratio &lt; 10% (highest bug risk)</li>
            <li><span class="tier-badge tier-medium">Medium</span> Test ratio 10-50%</li>
            <li><span class="tier-badge tier-high">High</span> Test ratio &gt; 50% (lowest bug risk)</li>
          </ul>
          <p>The ROI metric shows how much more likely low-test commits are to result in bugs compared to well-tested commits.</p>
        </details>
      </section>`;
}
