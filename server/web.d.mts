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

export declare function research(query: string): Promise<ResearchResult>;
