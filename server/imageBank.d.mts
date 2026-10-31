// Type declarations for server/imageBank.mjs (curated clinical-image bank).
export interface Seed {
  subject: 'Radiology' | 'Dermatology' | 'Ophthalmology' | 'Pathology' | 'Cardiology' | 'Orthopaedics';
  modality: string;
  ground_truth: string;
  query: string;
}

export interface BankEntry {
  image_id: string;
  source: string;
  sourceUrl: string;
  imageUrl: string;
  previewUrl: string;
  licence: string;
  licenceUrl: string;
  attribution: string;
  ground_truth: string;
  modality: string;
  subject: string;
  body_part: string;
  addedAt: string;
  /** Set when the entry was vision-confirmed at harvest time. */
  verifiedAt?: string;
}

export interface BankBuildSummary {
  total: number;
  added: number;
  /** Candidates discarded because the optional verifier rejected them. */
  rejected?: number;
  bySubject: Record<string, number>;
  errors: string[];
}

export interface BankStats {
  total: number;
  bySubject: Record<string, number>;
  byModality: Record<string, number>;
  builtAt: string | null;
}

export declare const SEED_TOPICS: Seed[];

/** Image ids the verifier already rejected (image_id -> record). Never throws. */
export declare function loadRejected(): Map<string, { image_id: string; ground_truth: string; reason: string; rejectedAt: string }>;

/** Remember that an image failed verification against its claimed finding. */
export declare function rejectImage(image_id: string, ground_truth: string, reason: string): void;

export declare function buildImageBank(options?: {
  seeds?: Seed[];
  limitPerSeed?: number;
  /** Delay between seeds (ms) to avoid upstream rate limiting. Default 1200. */
  throttleMs?: number;
  /** Max attempts per seed with exponential backoff on HTTP 429. Default 4. */
  maxAttempts?: number;
  /**
   * Optional async verifier: return true to admit the entry. Used to vision-confirm at
   * harvest time so the bank only holds images that really show the claimed finding.
   */
  verify?: (entry: BankEntry) => boolean | Promise<boolean>;
  onProgress?: (done: number, total: number, added: number) => void;
}): Promise<BankBuildSummary>;

export declare function loadImageBank(): BankEntry[];

export declare function queryImageBank(options?: {
  subject?: string;
  modality?: string;
  limit?: number;
  /** Include images the verifier previously rejected (default false). */
  includeRejected?: boolean;
}): BankEntry[];

export declare function getBankImage(imageId: string): BankEntry | null;

/**
 * Token-overlap search over the trusted bank fields, for explanation image cues.
 * Returns candidates only — callers must vision-verify before showing one.
 */
export declare function searchBankByText(query: string, options?: { subject?: string; limit?: number }): BankEntry[];

export declare function bankStats(): BankStats;
