import * as vscode from 'vscode';
import { LoggerService } from '../logging/logger.js';
import type {
  PipelineRunRow,
  PipelineTableCountRow,
  PipelineRunTreeNodeData,
} from './pipeline-run-tree-types.js';
import { MAX_RECENT_RUNS } from './pipeline-run-tree-types.js';
import {
  PIPELINE_ICONS,
  getStatusIcon,
  formatDateTime,
  calculateDuration,
} from './pipeline-run-utils.js';
import { PipelineRepository } from '../database/pipeline-repository.js';
import { DatabaseService, buildConfigFromSettings } from '../database/database-service.js';
import { SecretStorageService } from '../config/secret-storage.js';
import { getSettings } from '../config/settings.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'PipelineRunTreeProvider';

/**
 * PipelineRunTreeItem extends vscode.TreeItem with typed node data.
 * Each item carries a PipelineRunTreeNodeData payload for context menu
 * discrimination and child resolution.
 */
export class PipelineRunTreeItem extends vscode.TreeItem {
  public readonly nodeData: PipelineRunTreeNodeData;

  constructor(
    nodeData: PipelineRunTreeNodeData,
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
 * PipelineRunTreeProvider implements vscode.TreeDataProvider<PipelineRunTreeItem>
 * for the gitrx-pipeline-runs TreeView. Displays recent pipeline run history
 * with status icons, duration, and table count snapshots.
 *
 * Root nodes: recent pipeline runs (last 20) with status icon.
 * Child nodes per run: class_name, start_time, end_time, duration, status.
 * Grandchild nodes: table counts from gitja_pipeline_table_counts.
 *
 * Ticket: IQS-868
 */
export class PipelineRunTreeProvider
  implements vscode.TreeDataProvider<PipelineRunTreeItem>, vscode.Disposable
{
  private readonly logger: LoggerService;
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<PipelineRunTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<PipelineRunTreeItem | undefined | void> =
    this._onDidChangeTreeData.event;

  private runCache: PipelineRunRow[] = [];
  private tableCountCache: Map<number, PipelineTableCountRow[]> = new Map();
  private dataLoaded = false;
  private readonly secretService: SecretStorageService;

  constructor(secretService: SecretStorageService) {
    this.logger = LoggerService.getInstance();
    this.secretService = secretService;
    this.logger.debug(CLASS_NAME, 'constructor', 'PipelineRunTreeProvider created');
  }

  /** Signal the TreeView to refresh its contents. */
  refresh(): void {
    this.logger.info(CLASS_NAME, 'refresh', 'Refreshing Pipeline Runs TreeView');
    this.runCache = [];
    this.tableCountCache.clear();
    this.dataLoaded = false;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PipelineRunTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PipelineRunTreeItem): Promise<PipelineRunTreeItem[]> {
    this.logger.debug(
      CLASS_NAME, 'getChildren',
      element
        ? `Getting children for: ${element.nodeData.type}/${element.nodeData.label}`
        : 'Getting root nodes',
    );

    if (!this.dataLoaded) {
      await this.loadPipelineRuns();
    }

    if (!element) {
      return this.getRootNodes();
    }
    if (element.nodeData.type === 'pipelineRun') {
      return this.getRunChildNodes(element.nodeData.pipelineRunId ?? 0);
    }
    if (element.nodeData.type === 'tableCountGroup') {
      return this.getTableCountNodes(element.nodeData.pipelineRunId ?? 0);
    }
    return [];
  }

  // --------------------------------------------------------------------------
  // Root node builders
  // --------------------------------------------------------------------------

  private getRootNodes(): PipelineRunTreeItem[] {
    if (this.runCache.length === 0) {
      this.logger.info(CLASS_NAME, 'getRootNodes', 'No pipeline run data available');
      return [this.buildEmptyNode()];
    }

    this.logger.debug(CLASS_NAME, 'getRootNodes', `Building ${this.runCache.length} run nodes`);
    return this.runCache.map((run) => this.buildRunNode(run));
  }

  private buildRunNode(run: PipelineRunRow): PipelineRunTreeItem {
    const startLabel = run.startTime ? formatDateTime(run.startTime) : 'Unknown start';
    const durationStr = calculateDuration(run.startTime, run.endTime);
    const statusLabel = run.status ?? 'unknown';

    const tooltipParts = [
      `Pipeline Run #${run.id}`,
      `Class: ${run.className ?? 'N/A'}`,
      `Context: ${run.context ?? 'N/A'}`,
      `Status: ${statusLabel}`,
      `Start: ${run.startTime?.toISOString() ?? 'N/A'}`,
      `End: ${run.endTime?.toISOString() ?? 'Still running'}`,
      `Duration: ${durationStr}`,
    ];
    if (run.detail) {
      tooltipParts.push(`Detail: ${run.detail}`);
    }

    const node = new PipelineRunTreeItem(
      {
        type: 'pipelineRun',
        label: `Run #${run.id}`,
        description: `${startLabel} (${durationStr})`,
        tooltip: tooltipParts.join('\n'),
        pipelineRunId: run.id,
        runData: run,
      },
      vscode.TreeItemCollapsibleState.Collapsed,
    );

    node.iconPath = getStatusIcon(statusLabel);
    node.command = {
      command: 'gitrx.showPipelineRunLog',
      title: 'Show Pipeline Run Log',
      arguments: [run.id],
    };

    return node;
  }

  // --------------------------------------------------------------------------
  // Child node builders
  // --------------------------------------------------------------------------

  private getRunChildNodes(pipelineRunId: number): PipelineRunTreeItem[] {
    const run = this.runCache.find((r) => r.id === pipelineRunId);
    if (!run) {
      this.logger.warn(CLASS_NAME, 'getRunChildNodes', `Run not found: ${pipelineRunId}`);
      return [];
    }

    this.logger.debug(CLASS_NAME, 'getRunChildNodes', `Building details for run #${pipelineRunId}`);
    const children: PipelineRunTreeItem[] = [];

    // Class Name
    children.push(this.buildDetailNode('Class', run.className ?? 'N/A',
      `Class Name: ${run.className ?? 'N/A'}`, pipelineRunId, PIPELINE_ICONS.className));

    // Start Time
    const startStr = run.startTime ? formatDateTime(run.startTime) : 'N/A';
    children.push(this.buildDetailNode('Start Time', startStr,
      `Start Time: ${run.startTime?.toISOString() ?? 'N/A'}`, pipelineRunId, PIPELINE_ICONS.clock));

    // End Time
    const endStr = run.endTime ? formatDateTime(run.endTime) : 'Still running';
    children.push(this.buildDetailNode('End Time', endStr,
      `End Time: ${run.endTime?.toISOString() ?? 'Still running'}`, pipelineRunId, PIPELINE_ICONS.clock));

    // Duration
    const durationStr = calculateDuration(run.startTime, run.endTime);
    children.push(this.buildDetailNode('Duration', durationStr,
      `Duration: ${durationStr}`, pipelineRunId, PIPELINE_ICONS.duration));

    // Status
    const statusLabel = run.status ?? 'unknown';
    children.push(this.buildDetailNode('Status', statusLabel,
      `Status: ${statusLabel}`, pipelineRunId, getStatusIcon(statusLabel)));

    // Table Counts group
    const tableCounts = this.tableCountCache.get(pipelineRunId);
    const tcLabel = tableCounts ? `${tableCounts.length} tables` : 'No table counts';
    const hasData = tableCounts && tableCounts.length > 0;

    const tableGroupNode = new PipelineRunTreeItem(
      {
        type: 'tableCountGroup',
        label: 'Table Counts',
        description: tcLabel,
        tooltip: 'Table count snapshots recorded during this pipeline run',
        pipelineRunId,
      },
      hasData ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    tableGroupNode.iconPath = PIPELINE_ICONS.tableGroup;
    children.push(tableGroupNode);

    return children;
  }

  private buildDetailNode(
    label: string,
    description: string,
    tooltip: string,
    pipelineRunId: number,
    icon: vscode.ThemeIcon,
  ): PipelineRunTreeItem {
    const node = new PipelineRunTreeItem(
      { type: 'runDetail', label, description, tooltip, pipelineRunId },
      vscode.TreeItemCollapsibleState.None,
    );
    node.iconPath = icon;
    return node;
  }

  // --------------------------------------------------------------------------
  // Grandchild node builders
  // --------------------------------------------------------------------------

  private getTableCountNodes(pipelineRunId: number): PipelineRunTreeItem[] {
    const counts = this.tableCountCache.get(pipelineRunId);
    if (!counts || counts.length === 0) {
      this.logger.debug(CLASS_NAME, 'getTableCountNodes', `No counts for run #${pipelineRunId}`);
      const noDataNode = new PipelineRunTreeItem(
        {
          type: 'tableCount',
          label: 'No table counts recorded',
          description: '',
          tooltip: 'No table count snapshots were recorded for this pipeline run.',
          pipelineRunId,
        },
        vscode.TreeItemCollapsibleState.None,
      );
      noDataNode.iconPath = PIPELINE_ICONS.warning;
      return [noDataNode];
    }

    this.logger.debug(CLASS_NAME, 'getTableCountNodes', `Building ${counts.length} nodes for run #${pipelineRunId}`);
    return counts.map((tc) => {
      const node = new PipelineRunTreeItem(
        {
          type: 'tableCount',
          label: tc.gitrTable,
          description: tc.rowCount.toLocaleString(),
          tooltip: `Table: ${tc.gitrTable}\nRow Count: ${tc.rowCount.toLocaleString()}\nCounted: ${tc.countDate?.toISOString() ?? 'N/A'}`,
          pipelineRunId,
        },
        vscode.TreeItemCollapsibleState.None,
      );
      node.iconPath = PIPELINE_ICONS.tableCount;
      return node;
    });
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private buildEmptyNode(): PipelineRunTreeItem {
    const node = new PipelineRunTreeItem(
      {
        type: 'empty',
        label: 'No pipeline runs',
        description: 'Run pipeline to populate',
        tooltip: 'Run "Gitr: Run Pipeline" to execute the analytics pipeline and see run history here.',
      },
      vscode.TreeItemCollapsibleState.None,
    );
    node.iconPath = PIPELINE_ICONS.info;
    return node;
  }

  // --------------------------------------------------------------------------
  // Data loading
  // --------------------------------------------------------------------------

  private async loadPipelineRuns(): Promise<void> {
    this.logger.debug(CLASS_NAME, 'loadPipelineRuns', 'Loading pipeline run data from database');
    let dbService: DatabaseService | undefined;

    try {
      const settings = getSettings();
      const dbPassword = await this.secretService.getDatabasePassword();
      if (!dbPassword) {
        this.logger.warn(CLASS_NAME, 'loadPipelineRuns', 'Database password not configured. TreeView will be empty.');
        this.dataLoaded = true;
        return;
      }

      dbService = new DatabaseService();
      const dbConfig = buildConfigFromSettings(settings.database, dbPassword);
      this.logger.debug(CLASS_NAME, 'loadPipelineRuns', `Connecting to database: ${settings.database.host}:${settings.database.port}`);
      await dbService.initialize(dbConfig);

      const pipelineRepo = new PipelineRepository(dbService);
      this.runCache = await pipelineRepo.getRecentPipelineRuns(MAX_RECENT_RUNS);

      this.tableCountCache.clear();
      for (const run of this.runCache) {
        try {
          const counts = await pipelineRepo.getPipelineTableCounts(run.id);
          if (counts.length > 0) {
            this.tableCountCache.set(run.id, counts);
          }
          this.logger.trace(CLASS_NAME, 'loadPipelineRuns', `Loaded ${counts.length} table counts for run #${run.id}`);
        } catch (countError: unknown) {
          const msg = countError instanceof Error ? countError.message : String(countError);
          this.logger.warn(CLASS_NAME, 'loadPipelineRuns', `Failed to load table counts for run #${run.id}: ${msg}`);
        }
      }

      this.logger.info(CLASS_NAME, 'loadPipelineRuns', `Loaded ${this.runCache.length} pipeline runs with table counts`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(CLASS_NAME, 'loadPipelineRuns', `Failed to load pipeline runs: ${message}. TreeView will be empty.`);
      this.runCache = [];
      this.tableCountCache.clear();
    } finally {
      if (dbService) {
        try {
          await dbService.shutdown();
          this.logger.debug(CLASS_NAME, 'loadPipelineRuns', 'Database connection shut down');
        } catch (shutdownError: unknown) {
          const msg = shutdownError instanceof Error ? shutdownError.message : String(shutdownError);
          this.logger.warn(CLASS_NAME, 'loadPipelineRuns', `Database shutdown warning: ${msg}`);
        }
      }
      this.dataLoaded = true;
    }
  }

  dispose(): void {
    this.logger.debug(CLASS_NAME, 'dispose', 'Disposing PipelineRunTreeProvider');
    this._onDidChangeTreeData.dispose();
    this.runCache = [];
    this.tableCountCache.clear();
  }
}
