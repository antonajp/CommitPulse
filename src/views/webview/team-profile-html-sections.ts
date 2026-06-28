/**
 * HTML section generators for Team Profile Dashboard.
 * GITX-188: Adds Hot Spots and Knowledge Concentration charts,
 * excludes Test Debt Risk Analysis (team-specific version).
 *
 * Ticket: GITX-188
 */

/**
 * Generate the HTML for Team Profile-specific chart sections.
 * GITX-188: Includes Hot Spots and Knowledge Concentration,
 * excludes Test Debt Risk Analysis.
 */
export function generateTeamProfileChartSections(): string {
  return `
      <!-- GITX-188: Hot Spots Bubble Chart -->
      <section class="card card-wide" id="hotSpotsCard" aria-label="Hot Spots Analysis">
        <h2>Hot Spots (Top 10 Risky Files)</h2>
        <div class="chart-container">
          <div class="chart-skeleton" id="hotSpotsSkeleton" aria-hidden="true"></div>
          <div id="hotSpotsChart" class="d3-chart hidden" role="img" aria-label="Bubble chart showing hot spots: X=complexity, Y=churn, size=LOC, color=risk tier"></div>
        </div>
        <p class="card-empty hidden" id="hotSpotsEmpty">No hot spots data available. Run the pipeline to analyze repositories.</p>
        <details class="chart-explanation">
          <summary>What are Hot Spots?</summary>
          <p>Hot spots are files with high complexity and frequent changes (churn), indicating higher risk for bugs and maintenance issues. Files in the upper-right quadrant are the highest priority for refactoring.</p>
          <ul>
            <li><strong>X-axis (Complexity):</strong> Cyclomatic complexity of the file</li>
            <li><strong>Y-axis (Churn):</strong> Number of commits modifying the file</li>
            <li><strong>Bubble size:</strong> Lines of code in the file</li>
            <li><strong>Bubble color:</strong> Risk tier (Critical, High, Medium, Low)</li>
          </ul>
        </details>
      </section>

      <!-- GITX-188: Knowledge Concentration Treemap -->
      <section class="card card-wide" id="knowledgeCard" aria-label="Knowledge Concentration">
        <h2>Knowledge Concentration (Top 30 At-Risk Files)</h2>
        <div class="chart-container">
          <div class="chart-skeleton" id="knowledgeSkeleton" aria-hidden="true"></div>
          <div id="knowledgeChart" class="d3-chart hidden" role="img" aria-label="Treemap showing knowledge concentration: tile size=commits, color=concentration risk"></div>
        </div>
        <p class="card-empty hidden" id="knowledgeEmpty">No knowledge concentration data available. Run the pipeline to analyze repositories.</p>
        <details class="chart-explanation">
          <summary>What is Knowledge Concentration?</summary>
          <p>Knowledge concentration measures how much code ownership is concentrated in single contributors (bus factor risk). Files with high concentration risk may become maintenance issues if the primary contributor leaves.</p>
          <ul>
            <li><strong>Tile size:</strong> Number of commits to the file</li>
            <li><strong>Tile color:</strong> Concentration risk level</li>
            <li><span class="tier-badge tier-critical">Critical</span> Single contributor owns 90%+ of commits</li>
            <li><span class="tier-badge tier-high">High</span> Single contributor owns 80-90% of commits</li>
            <li><span class="tier-badge tier-medium">Medium</span> Single contributor owns 60-80% of commits</li>
            <li><span class="tier-badge tier-low">Low</span> No single contributor owns 60%+ (healthy distribution)</li>
          </ul>
        </details>
      </section>`;
}
