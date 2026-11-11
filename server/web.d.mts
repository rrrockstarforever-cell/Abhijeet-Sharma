// Type declarations for server/web.mjs (web research and question evidence: DuckDuckGo + Europe PMC + openFDA).
export type ResearchSourceKind = 'web' | 'europepmc';

export interface ResearchSource {
  n: number;
  title: string;
  url: string;
  text: string;
  kind: ResearchSourceKind;
}

export interface ResearchResult {
  sources: ResearchSource[];
  retrievedAt: string;
}

export declare function research(query: string, pageChars?: number): Promise<ResearchResult>;

export interface EvidenceSource {
  title: string;
  url: string;
  text: string;
}

export declare function journalsFor(subject: string): string[];
export declare function literatureSources(query: string, subject?: string): Promise<EvidenceSource[]>;
export declare function topicSources(query: string, subject?: string): Promise<EvidenceSource[]>;

export interface SourceRegistryEntry {
  id: string;
  name: string;
  licence: string;
  fetch: string;
  status: string;
}
export declare const SOURCE_REGISTRY: SourceRegistryEntry[];
