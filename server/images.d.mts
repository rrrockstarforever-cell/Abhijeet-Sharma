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

export declare const REFERENCE_SOURCES: ReferenceSource[];
