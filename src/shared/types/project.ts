export type MonorepoType =
  | 'npm-workspaces'
  | 'pnpm-workspaces'
  | 'nx'
  | 'turborepo'
  | 'single';

export interface PackageInfo {
  name: string;
  path: string;
  version: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export interface MonorepoConfig {
  type: MonorepoType;
  root: string;
  packages: PackageInfo[];
  dependencyGraph: Map<string, string[]>;
}

export type ScanStatus = 'idle' | 'scanning' | 'ready' | 'error';

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'package';
  children?: FileTreeNode[];
  language?: string;
  symbolCount?: number;
}
