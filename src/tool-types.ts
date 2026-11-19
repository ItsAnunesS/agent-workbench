export interface ToolScope {
  environmentId: string;
  projectId: string | null;
  conversationId: string | null;
}
export interface RecentPage {
  url: string;
  title: string;
}
export interface BrowserSnapshot {
  url: string | null;
  pages: RecentPage[];
}
export interface TerminalConfig {
  executable: string;
  args: string[];
}
export interface TerminalPreferences {
  global: TerminalConfig;
  environmentOverride: TerminalConfig | null;
  effective: TerminalConfig;
}
