// Type declarations for server/images.mjs (live clinical-image search).
export interface LiveImageResult {
  id: string;
  provider: string;
  title: string;
  caption: string;
  credit: string;
  licence: string;
  licenceUrl: string;
  articleUrl: string;
  modality: string;
  imageUrl: string;
  proxyUrl: string;
  thumbUrl: string;
}

export declare function searchImages(
  query: string,
  options?: { limit?: number },
): Promise<{ results: LiveImageResult[]; errors: string[] }>;

export declare function fetchImage(url: string): Promise<{ buffer: Buffer; type: string }>;

export interface ReferenceSource {
  name: string;
  url: string;
  note: string;
}

export declare function reusableLicense(label: string, url?: string): { label: 'CC0' | 'Public domain'; url: string } | null;
export declare function buildVisionVerificationPrompt(input: { claim: string; modality?: string; bodyPart?: string; questionStem?: string; questionText?: string; correctAnswer?: string; explanation?: string; boardPearl?: string }): string;
export declare function parseVisionVerdict(raw: string): { pass: boolean; shows: string; unsupportedQuestionClaims: string[]; reason: string } | null;
export declare function relevanceOf(item: Partial<LiveImageResult>, query: string): number;
export declare function reusableSearchResult(item: Partial<LiveImageResult>, query: string): boolean;

export declare const REFERENCE_SOURCES: ReferenceSource[];
