/**
 * Mock for the vscode module used in unit tests.
 * Provides stub implementations of VS Code API surfaces used by the extension.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export enum ProgressLocation {
  Notification = 15,
  SourceControl = 1,
  Window = 10,
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
  Three = 3,
}

const registeredCommands: Map<string, (...args: any[]) => any> = new Map();
const configValues: Map<string, any> = new Map();

export const commands = {
  registerCommand: (commandId: string, callback: (...args: any[]) => any) => {
    registeredCommands.set(commandId, callback);
    return { dispose: () => registeredCommands.delete(commandId) };
  },
  executeCommand: async (commandId: string, ...args: any[]) => {
    const handler = registeredCommands.get(commandId);
    if (handler) {
      return handler(...args);
    }
    throw new Error(`Command not found: ${commandId}`);
  },
  getRegisteredCommands: () => registeredCommands,
};

export const window = {
  showInformationMessage: async (_message: string, ..._items: any[]) => undefined,
  showErrorMessage: async (_message: string, ..._items: any[]) => undefined,
  showWarningMessage: async (_message: string, ..._items: any[]) => undefined,
  showInputBox: async (_options?: any) => undefined,
  showQuickPick: async <T>(_items: T[] | Promise<T[]>, _options?: any): Promise<T | undefined> => undefined,
  createOutputChannel: (_name: string) => ({
    appendLine: (_value: string) => { /* noop */ },
    append: (_value: string) => { /* noop */ },
    clear: () => { /* noop */ },
    show: () => { /* noop */ },
    hide: () => { /* noop */ },
    dispose: () => { /* noop */ },
  }),
  withProgress: async <T>(
    _options: any,
    task: (progress: any, token: any) => Promise<T>,
  ): Promise<T> => {
    const progress = { report: (_value: any) => { /* noop */ } };
    const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => { /* noop */ } }) };
    return task(progress, token);
  },
  createTreeView: (_viewId: string, _options: any) => ({
    dispose: () => { /* noop */ },
    reveal: async () => { /* noop */ },
  }),
  createStatusBarItem: (_alignment?: StatusBarAlignment, _priority?: number) => ({
    text: '',
    tooltip: '',
    command: undefined as string | undefined,
    show: () => { /* noop */ },
    hide: () => { /* noop */ },
    dispose: () => { /* noop */ },
  }),
  createTerminal: (_options?: any) => ({
    show: () => { /* noop */ },
    hide: () => { /* noop */ },
    dispose: () => { /* noop */ },
    sendText: (_text: string) => { /* noop */ },
    name: _options?.name ?? 'Terminal',
  }),
  createWebviewPanel: (_viewType: string, _title: string, _showOptions: any, _options?: any) => {
    const messageListeners: ((...args: any[]) => any)[] = [];
    const disposeListeners: ((...args: any[]) => any)[] = [];
    return {
      webview: {
        html: '',
        cspSource: 'https://test.vscode-resource.vscode-cdn.net',
        asWebviewUri: (uri: any) => uri,
        postMessage: async (_message: any) => true,
        onDidReceiveMessage: (listener: any, _thisArg?: any, _disposables?: any[]) => {
          messageListeners.push(listener);
          return { dispose: () => { /* noop */ } };
        },
        _fireMessage: (msg: any) => { messageListeners.forEach(l => l(msg)); },
      },
      reveal: (_viewColumn?: any) => { /* noop */ },
      onDidDispose: (listener: any, _thisArg?: any, _disposables?: any[]) => {
        disposeListeners.push(listener);
        return { dispose: () => { /* noop */ } };
      },
      onDidChangeViewState: (_listener: any) => ({ dispose: () => { /* noop */ } }),
      dispose: () => { disposeListeners.forEach(l => l()); },
      _disposeListeners: disposeListeners,
      _messageListeners: messageListeners,
    };
  },
};

export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T | undefined => {
      const fullKey = _section ? `${_section}.${key}` : key;
      return (configValues.get(fullKey) as T) ?? defaultValue;
    },
    has: (key: string) => configValues.has(_section ? `${_section}.${key}` : key),
    update: async (_key: string, _value: any) => { /* noop */ },
    inspect: (_key: string) => undefined,
  }),
  onDidChangeConfiguration: (_listener: any) => ({ dispose: () => { /* noop */ } }),
  workspaceFolders: [],
};

export class Uri {
  static file(path: string): any {
    return { scheme: 'file', path, fsPath: path, toString: () => `file://${path}` };
  }
  /**
   * Parse a URI string into scheme, authority, and path components.
   * Updated to properly support URL validation (IQS-923).
   */
  static parse(value: string, _strict?: boolean): any {
    // Handle scheme-only URLs (e.g., javascript:, data:, file:)
    const schemeOnlyMatch = value.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):(?!\/\/)/);
    if (schemeOnlyMatch) {
      return {
        scheme: schemeOnlyMatch[1]!.toLowerCase(),
        authority: '',
        path: value.substring(schemeOnlyMatch[0].length),
        toString: () => value,
      };
    }

    // Handle standard URLs with :// (e.g., https://github.com/user/repo)
    const match = value.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/);
    if (match) {
      return {
        scheme: match[1]!.toLowerCase(),
        authority: match[2] || '',
        path: match[3] || '',
        query: match[4] || '',
        fragment: match[5] || '',
        toString: () => value,
      };
    }

    // Fallback for unrecognized formats
    return { scheme: '', authority: '', path: value, toString: () => value };
  }
  static joinPath(base: any, ...pathSegments: string[]): any {
    const joined = [base.path || base.fsPath || '', ...pathSegments].join('/');
    return { scheme: 'file', path: joined, fsPath: joined, toString: () => `file://${joined}` };
  }
}

export class Disposable {
  static from(...disposables: { dispose: () => any }[]): any {
    return {
      dispose: () => {
        for (const d of disposables) {
          d.dispose();
        }
      },
    };
  }
}

export class EventEmitter {
  private listeners: ((...args: any[]) => any)[] = [];

  get event() {
    return (listener: (...args: any[]) => any) => {
      this.listeners.push(listener);
      return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
    };
  }

  fire(...args: any[]): void {
    for (const listener of this.listeners) {
      listener(...args);
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}

export class ThemeColor {
  readonly id: string;
  constructor(id: string) {
    this.id = id;
  }
}

export class ThemeIcon {
  readonly id: string;
  readonly color?: ThemeColor;
  constructor(id: string, color?: ThemeColor) {
    this.id = id;
    this.color = color;
  }
}

export class TreeItem {
  label: string;
  collapsibleState?: TreeItemCollapsibleState;
  description?: string;
  tooltip?: string;
  contextValue?: string;
  iconPath?: ThemeIcon | any;
  command?: { command: string; title: string; arguments?: any[] };

  constructor(label: string, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

/**
 * Helper for tests to set mock configuration values.
 */
export function _setMockConfig(key: string, value: any): void {
  configValues.set(key, value);
}

/**
 * Helper for tests to clear all mock state.
 */
export function _clearMocks(): void {
  registeredCommands.clear();
  configValues.clear();
}
