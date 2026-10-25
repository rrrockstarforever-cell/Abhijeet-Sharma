// Type declarations for server/oauth.mjs (plain-Node ESM implementation ported
// from the previous app's working subscription login + chat layer).
export type OAuthProvider = 'codex' | 'xai' | 'claude';

export interface OAuthChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface OAuthStartResult {
  id: string;
  userCode?: string;
  url?: string;
  interval?: number;
  mode?: 'code';
}

export interface OAuthPollResult {
  status: 'pending' | 'done' | 'error';
  error?: string;
}

export interface OAuthStatusResult {
  codex: boolean;
  xai: boolean;
  claude: boolean;
}

export interface OAuthChatOptions {
  provider: OAuthProvider;
  model?: string;
  system?: string;
  messages: OAuthChatMessage[];
  json?: boolean;
  effort?: string;
  search?: boolean;
  /** Aborts the upstream provider request (Stop button in the UI). */
  signal?: AbortSignal;
}

export declare function startLogin(provider: OAuthProvider): Promise<OAuthStartResult>;
export declare function pollLogin(id: string): Promise<OAuthPollResult>;
export declare function completeLogin(id: string, pastedCode: string): Promise<{ status: 'done' }>;
export declare function status(): OAuthStatusResult;
export declare function logout(provider: string): void;
export declare function chat(options: OAuthChatOptions): Promise<string>;
export declare function image(prompt: string): Promise<string>;

export interface OAuthModelInfo {
  id: string;
  name?: string;
  created?: number | null;
}

export interface OAuthListModelsResult {
  models: OAuthModelInfo[];
  error?: string;
}

/** Live model list for THIS account, queried with the stored token. */
export declare function listModels(provider: OAuthProvider): Promise<OAuthListModelsResult>;
