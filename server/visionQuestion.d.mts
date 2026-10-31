// Type declarations for server/visionQuestion.mjs (image-first question generation).
export interface VisionQuestionSpec {
  stem: string;
  questionText: string;
  options: Record<string, string>;
  correctOption: string;
  explanation: string;
  boardPearl: string;
  citations: string[];
}

export interface GenerateFromImageOptions {
  imageUrl: string;
  groundTruth: string;
  modality?: string;
  subject?: string;
  exam?: 'NEET_PG' | 'INI_CET' | 'AMC_CAT';
  difficultyTier?: 'LOW' | 'MEDIUM' | 'HIGH' | 'ALL';
  optionCount?: number;
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

export declare function generateQuestionFromImage(opts: GenerateFromImageOptions): Promise<VisionQuestionSpec>;

export declare function parseLooseJson(text: string): any | null;

export declare const DEFAULT_VISION_MODEL: string;
