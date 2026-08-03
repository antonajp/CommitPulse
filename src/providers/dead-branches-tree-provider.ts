/**
 * Dead Branches TreeView provider for the gitrx-dead-branches view.
 *
 * Displays dead/stale branches organized by risk level for safe cleanup:
 * - Safe: Merged branches >90 days old (safest to delete)
 * - Low: Merged branches <90 days old
 * - Medium: Unmerged branches 90-180 days old
 * - High: Unmerged branches <90 days old or with open PRs
 *
 * Data sourced from commit_history table via BranchRepository (GITX-237).
 *
 * Ticket: GITX-239
 */

import * as vscode from 'vscode';
import { LoggerService } from '../logging/logger.js';
import { BranchRepository, type CommitHistoryBranch } from '../database/branch-repository.js';
import { DatabaseService, buildConfigFromSettings } from '../database/database-service.js';
import { SecretStorageService } from '../config/secret-storage.js';
import { getSettings } from '../config/settings.js';
import type {
  DeadBranchNodeData,
  DeadBranchItem,
  BranchRiskLevel,
} from './dead-branches-tree-types.js';
import {
  RISK_LEVEL_ORDER,
  RISK_LEVEL_LABELS,
  RISK_LEVEL_ICONS,
  RISK_LEVEL_TOOLTIPS,
} from './dead-branches-tree-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'DeadBranchesTreeProvider';

/**
 * DeadBranchesTreeItem extends vscode.TreeItem with typed node data.
 */
export class DeadBranchesTreeItem extends vscode.TreeItem {
  public readonly nodeData: DeadBranchNodeData;

  constructor(
    nodeData: DeadBranchNodeData,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(nodeData.label, collapsibleState);
    this.nodeData = nodeData;
    this.contextValue = nodeData.type;
    if (nodeData.description !== undefined) {
      this.description = nodeData.description;
    }
    if (nodeData.tooltip !== undefined) {
      this.tooltip = nodeData.tooltip;
    }
  }
}

/**
 * DeadBranchesTreeProvider implements vscode.TreeDataProvider<DeadBranchesTreeItem>
 * for the gitrx-dead-branches TreeView.
 *
 * Displays dead branches grouped by risk level (Safe -> Low -> Medium -> High).
 *
 * Ticket: GITX-239
 */
export class DeadBranchesTreeProvider
  implements vscode.TreeDataProvider<DeadBranchesTreeItem>, vscode.Disposable
{
  private readonly logger: LoggerService;

  /**
   * Event emitter that fires when the tree data changes.
   */
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<DeadBranchesTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<DeadBranchesTreeItem | undefined | void> =
    this._onDidChangeTreeData.event;

  /**
   * Cached branch data, loaded from database.
   */
  private branchCache: DeadBranchItem[] = [];

  /**
   * Whether data has been loaded at least once.
   */
  private dataLoaded = false;

  /**
   * Error message if data loading failed.
   */
  private loadError: string | null = null;

  /**
   * Reference to SecretStorageService for database password retrieval.
   */
  private readonly secretService: SecretStorageService;

  constructor(secretService: SecretStorageService) {
    this.logger = LoggerService.getInstance();
    this.secretService = secretService;
    this.logger.debug(CLASS_NAME, 'constructor', 'DeadBranchesTreeProvider created');
  }

  /**
   * Signal the TreeView to refresh its contents.
   * Clears the branch cache so the next getChildren() call re-queries the database.
   */
  refresh(): void {
    this.logger.info(CLASS_NAME, 'refresh', 'Refreshing Dead Branches TreeView');
    this.branchCache = [];
    this.dataLoaded = false;
    this.loadError = null;
    this._onDidChangeTreeData.fire();
  }

  /**
   * Get the TreeItem representation for a given element.
   */
  getTreeItem(element: DeadBranchesTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Get child elements for a given parent, or root elements if parent is undefined.
   */
  async getChildren(element?: DeadBranchesTreeItem): Promise<DeadBranchesTreeItem[]> {
    this.logger.debug(
      CLASS_NAME,
      'getChildren',
      element
        ? `Getting children for: ${element.nodeData.type}/${element.nodeData.label}`
        : 'Getting root nodes',
    );

    // Ensure data is loaded
    if (!this.dataLoaded) {
      await this.loadBranches();
    }

    // Handle error state
    if (this.loadError) {
      return this.getErrorNodes();
    }

    if (!element) {
      return this.getRiskCategoryNodes();
    }

    // Risk category nodes have branch children
    if (element.nodeData.type === 'riskCategory' && element.nodeData.riskLevel) {
      return this.getBranchNodes(element.nodeData.riskLevel);
    }

    // Branch nodes and other node types have no children
    return [];
  }

  // --------------------------------------------------------------------------
  // Root node builders
  // --------------------------------------------------------------------------

  /**
   * Build root-level risk category nodes.
   * Only shows categories that have branches (empty categories are hidden).
   */
  private getRiskCategoryNodes(): DeadBranchesTreeItem[] {
    // Handle empty state
    if (this.branchCache.length === 0) {
      this.logger.debug(CLASS_NAME, 'getRiskCategoryNodes', 'No dead branches found');
      return [this.buildEmptyNode()];
    }

    // Group branches by risk level
    const riskGroups = this.groupBranchesByRisk();

    const nodes: DeadBranchesTreeItem[] = [];

    for (const riskLevel of RISK_LEVEL_ORDER) {
      const branches = riskGroups.get(riskLevel);
      if (!branches || branches.length === 0) {
        // Hide empty risk groups
        continue;
      }

      const label = RISK_LEVEL_LABELS[riskLevel];
      const count = branches.length;
      const icon = RISK_LEVEL_ICONS[riskLevel];
      const riskDescription = RISK_LEVEL_TOOLTIPS[riskLevel];

      const node = new DeadBranchesTreeItem(
        {
          type: 'riskCategory',
          label: `${label} (${count})`,
          description: undefined, // Tooltip has the details
          tooltip: `${label} Risk\n${riskDescription}\n\n${count} branch${count !== 1 ? 'es' : ''} in this category`,
          riskLevel,
        },
        vscode.TreeItemCollapsibleState.Expanded,
      );
      node.iconPath = new vscode.ThemeIcon(icon);
      node.contextValue = `riskCategory-${riskLevel}`;

      // Accessibility: provide screen reader context
      node.accessibilityInformation = {
        label: `${label} risk category, ${count} branch${count !== 1 ? 'es' : ''}, ${riskDescription}`,
        role: undefined,
      };

      nodes.push(node);
    }

    this.logger.debug(
      CLASS_NAME,
      'getRiskCategoryNodes',
      `Built ${nodes.length} risk category nodes`,
    );

    return nodes;
  }

  /**
   * Build branch nodes for a given risk level.
   * Branches are sorted by days stale (oldest first).
   */
  private getBranchNodes(riskLevel: BranchRiskLevel): DeadBranchesTreeItem[] {
    const branches = this.branchCache
      .filter((b) => b.riskLevel === riskLevel)
      .sort((a, b) => b.daysSinceLastCommit - a.daysSinceLastCommit); // Oldest first

    const nodes: DeadBranchesTreeItem[] = [];

    for (const branch of branches) {
      const node = this.buildBranchNode(branch);
      nodes.push(node);
    }

    this.logger.debug(
      CLASS_NAME,
      'getBranchNodes',
      `Built ${nodes.length} branch nodes for ${riskLevel} risk`,
    );

    return nodes;
  }

  /**
   * Build a tree node for a single branch.
   */
  private buildBranchNode(branch: DeadBranchItem): DeadBranchesTreeItem {
    // Format: "branch-name" with description "repo · 180d old · merged into main"
    const ageLabel = `${branch.daysSinceLastCommit}d old`;
    const statusLabel = branch.isMerged
      ? `merged into ${branch.mergedInto ?? 'target'}`
      : branch.status;

    const description = `${branch.repository} · ${ageLabel} · ${statusLabel}`;

    // Build detailed tooltip
    const tooltipLines = [
      `Branch: ${branch.branchName}`,
      `Repository: ${branch.repository}`,
      `Age: ${branch.daysSinceLastCommit} days since last commit`,
      `Author: ${branch.lastCommitAuthor ?? 'Unknown'}`,
      `Commits: ${branch.commitCount}`,
      `Status: ${branch.isMerged ? `Merged into ${branch.mergedInto ?? 'target'}` : branch.status}`,
    ];
    if (branch.hasOpenPr) {
      tooltipLines.push('Has Open PR: Yes');
    }
    if (branch.isOrphaned) {
      tooltipLines.push('Orphaned: Yes (remote tracking branch deleted)');
    }
    const tooltip = tooltipLines.join('\n');

    const node = new DeadBranchesTreeItem(
      {
        type: 'branch',
        label: branch.branchName,
        description,
        tooltip,
        branch,
      },
      vscode.TreeItemCollapsibleState.None,
    );

    // Use git-branch icon for all branches
    node.iconPath = new vscode.ThemeIcon('git-branch');
    node.contextValue = 'deadBranch';

    // Accessibility: provide screen reader context
    node.accessibilityInformation = {
      label: `${branch.branchName}, ${description}`,
      role: undefined,
    };

    return node;
  }

  /**
   * Build empty state node when no dead branches are found.
   * Clicking the node runs the pipeline to populate data.
   */
  private buildEmptyNode(): DeadBranchesTreeItem {
    const node = new DeadBranchesTreeItem(
      {
        type: 'empty',
        label: 'No dead branches detected',
        description: 'Click to run pipeline',
        tooltip: 'No stale or merged branches found.\n\nClick to run the pipeline and extract branch data from commit history.',
      },
      vscode.TreeItemCollapsibleState.None,
    );
    node.iconPath = new vscode.ThemeIcon('info');
    node.command = {
      command: 'gitr.runPipeline',
      title: 'Run Pipeline',
    };
    return node;
  }

  /**
   * Build error state nodes when database connection fails.
   */
  private getErrorNodes(): DeadBranchesTreeItem[] {
    const node = new DeadBranchesTreeItem(
      {
        type: 'error',
        label: 'Unable to load branches',
        description: 'Database connection failed',
        tooltip: `Error: ${this.loadError}\n\nClick to retry.`,
        errorMessage: this.loadError ?? 'Unknown error',
      },
      vscode.TreeItemCollapsibleState.None,
    );
    node.iconPath = new vscode.ThemeIcon('error');
    node.command = {
      command: 'gitrx.refreshDeadBranches',
      title: 'Retry',
    };
    return [node];
  }

  // --------------------------------------------------------------------------
  // Data helpers
  // --------------------------------------------------------------------------

  /**
   * Group branches by risk level.
   */
  private groupBranchesByRisk(): Map<BranchRiskLevel, DeadBranchItem[]> {
    const groups = new Map<BranchRiskLevel, DeadBranchItem[]>();

    for (const branch of this.branchCache) {
      const existing = groups.get(branch.riskLevel);
      if (existing) {
        existing.push(branch);
      } else {
        groups.set(branch.riskLevel, [branch]);
      }
    }

    return groups;
  }

  // --------------------------------------------------------------------------
  // Data loading
  // --------------------------------------------------------------------------

  /**
   * Load branch data from the database into the cache.
   * Uses BranchRepository.getBranchesFromCommitHistory() (GITX-237).
   */
  private async loadBranches(): Promise<void> {
    this.logger.debug(CLASS_NAME, 'loadBranches', 'Loading branch data from database');

    let dbService: DatabaseService | undefined;

    try {
      const settings = getSettings();

      // Get database password from SecretStorage
      const dbPassword = await this.secretService.getDatabasePassword();
      if (!dbPassword) {
        this.logger.warn(
          CLASS_NAME,
          'loadBranches',
          'Database password not configured. Dead Branches TreeView will show error state.',
        );
        this.loadError = 'Database password not configured. Run "Gitr: Set Database Password" command.';
        this.dataLoaded = true;
        return;
      }

      // Initialize a short-lived database connection for the query
      dbService = new DatabaseService();
      const dbConfig = buildConfigFromSettings(settings.database, dbPassword);

      this.logger.debug(
        CLASS_NAME,
        'loadBranches',
        `Connecting to database: ${settings.database.host}:${settings.database.port}`,
      );
      await dbService.initialize(dbConfig);

      const branchRepo = new BranchRepository(dbService);

      // Query all branches from commit_history (GITX-237)
      const branches = await branchRepo.getBranchesFromCommitHistory();

      // Convert to DeadBranchItem format
      this.branchCache = branches.map((b) => this.convertToDeadBranchItem(b));

      this.logger.info(
        CLASS_NAME,
        'loadBranches',
        `Loaded ${this.branchCache.length} branches from commit_history`,
      );

      this.loadError = null;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        CLASS_NAME,
        'loadBranches',
        `Failed to load branches from database: ${message}`,
      );
      this.branchCache = [];
      this.loadError = message;
    } finally {
      // Always shut down the short-lived connection
      if (dbService) {
        try {
          await dbService.shutdown();
          this.logger.debug(CLASS_NAME, 'loadBranches', 'Short-lived database connection shut down');
        } catch (shutdownError: unknown) {
          const msg = shutdownError instanceof Error ? shutdownError.message : String(shutdownError);
          this.logger.warn(CLASS_NAME, 'loadBranches', `Database shutdown warning: ${msg}`);
        }
      }
      this.dataLoaded = true;
    }
  }

  /**
   * Convert CommitHistoryBranch to DeadBranchItem with risk level calculation.
   *
   * GITX-237: CommitHistoryBranch only has status/riskLevel of 'stale'|'active' and 'medium'|'high'
   * because merge status cannot be determined from commit_history alone.
   *
   * For full risk level calculation (safe/low), we would need live git merge-base checks.
   * This TreeView displays conservative risk levels from the database query.
   */
  private convertToDeadBranchItem(branch: CommitHistoryBranch): DeadBranchItem {
    // Map status to full status type
    let status: 'merged' | 'stale' | 'orphaned' | 'active';
    if (branch.isMerged) {
      status = 'merged';
    } else if (branch.isOrphaned) {
      status = 'orphaned';
    } else if (branch.status === 'stale') {
      status = 'stale';
    } else {
      status = 'active';
    }

    // Calculate risk level with full range
    // GITX-237 provides conservative levels; we can calculate full range here
    //
    // Risk level definitions:
    // - safe: Merged branches >90 days old (fully integrated, no active development)
    // - low: Merged branches <90 days old (recently integrated, might need reference)
    // - high: Unmerged branches <90 days OR with open PR (active work, do not delete)
    // - medium: Unmerged branches >=90 days old (stale but may contain unmerged work)
    //
    // Note: Very old unmerged branches (>180 days) are medium risk, not high, because
    // they represent abandoned work rather than active development.
    let riskLevel: BranchRiskLevel;
    if (branch.isMerged && branch.daysSinceLastCommit > 90) {
      riskLevel = 'safe';
    } else if (branch.isMerged) {
      riskLevel = 'low';
    } else if (branch.hasOpenPr || branch.daysSinceLastCommit < 90) {
      riskLevel = 'high';
    } else {
      // Unmerged branches >=90 days old: medium risk (stale, likely abandoned)
      riskLevel = 'medium';
    }

    return {
      branchName: branch.branchName,
      repository: branch.repository,
      lastCommitDate: branch.lastCommitDate,
      lastCommitAuthor: branch.lastCommitAuthor,
      lastCommitSha: branch.lastCommitSha,
      commitCount: branch.commitCount,
      daysSinceLastCommit: branch.daysSinceLastCommit,
      isMerged: branch.isMerged,
      mergedInto: branch.mergedInto,
      hasOpenPr: branch.hasOpenPr,
      isOrphaned: branch.isOrphaned,
      riskLevel,
      status,
    };
  }

  /**
   * Dispose resources held by this provider.
   */
  dispose(): void {
    this.logger.debug(CLASS_NAME, 'dispose', 'Disposing DeadBranchesTreeProvider');
    this._onDidChangeTreeData.dispose();
    this.branchCache = [];
  }
}
