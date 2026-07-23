export interface LinkItem {
  name: string;
  target: string;
  source: string;
  exists: boolean;
  isLinked: boolean;
  hasBakFile?: boolean;
}

export interface CategorizedLinks {
  [category: string]: LinkItem[] | undefined;
  harness: LinkItem[];
  skills: LinkItem[];
  mcp: LinkItem[];
  agents: LinkItem[];
  loops: LinkItem[];
  memory: LinkItem[];
}

export interface ClientStatus {
  id: string;
  name: string;
  icon: string;
  detectedPath: string;
  isDetected: boolean;
  isFullyLinked: boolean;
  isPartiallyLinked: boolean;
  categorizedLinks: CategorizedLinks;
}

export interface KitTarget {
  client: string;
  targetPath: string;
}

export interface KitItem {
  name: string;
  isDir: boolean;
  path: string;
  readmeSnippet: string;
  mcpServers?: string[];
  mcpServersDetail?: { name: string; disabled: boolean; command?: string }[];
  targets?: KitTarget[];
}

export interface CategorizedKits {
  [key: string]: KitItem[];
  skills: KitItem[];
  mcp: KitItem[];
  agents: KitItem[];
  harness: KitItem[];
  loops: KitItem[];
  memory: KitItem[];
}

export interface PreviewModalData {
  title: string;
  targetPath: string;
  readPath?: string;
  content: string;
  message?: string;
  isEditable?: boolean;
  category?: string;
}

export interface DiffModalData {
  title: string;
  targetPath: string;
  sourcePath: string;
  existingContent: string;
  masterContent: string;
  hasExisting: boolean;
}

export interface DeploymentChange {
  clientId: string;
  clientName?: string;
  category?: string;
  action: string;
  target: string;
  source: string;
  backupPath?: string;
  previousSource?: string;
}

export interface DeploymentPlanData {
  title: string;
  changes: DeploymentChange[];
}

export interface GitStatus {
  isRepo: boolean;
  isConnected: boolean;
  userName: string;
  userEmail: string;
  remoteUrl: string;
  remoteConfigured: boolean;
  remoteVerified: boolean;
  remoteRepository: string;
  remotePermission: string;
  remoteError: string;
  branch: string;
  changedFiles: { status: string; file: string }[];
  recentCommits: string[];
}
