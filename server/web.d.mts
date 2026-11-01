// Type declarations for server/web.mjs (real web research: DuckDuckGo + PubMed).
export type ResearchSourceKind = 'web' | 'pubmed';

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

export interface PubmedAbstract {
  title: string;
  url: string;
  text: string;
}
export declare function pubmedSearch(query: string): Promise<PubmedAbstract[]>;

export interface SourceRegistryEntry {
  id: string;
  name: string;
  licence: string;
  fetch: string;
  status: string;
}
export declare const SOURCE_REGISTRY: SourceRegistryEntry[];
export declare function topicSources(query: string): Promise<PubmedAbstract[]>;
