export type ExamType = 'NEET_PG' | 'INI_CET' | 'AMC_CAT';

export type AppView =
  | 'analytics'
  | 'practice'
  | 'question-bank'
  | 'test-runner'
  | 'mistakes'
  | 'highlights'
  | 'ai-tutor'
  | 'pdf-reader'
  | 'research'
  | 'settings';

export type DifficultyTier = 'ALL' | 'LOW' | 'MEDIUM' | 'HIGH';

export type DifficultySubLevel = 'L1' | 'L2' | 'M1' | 'M2' | 'H1' | 'H2';

export type INISyllabusMode = '19_SUBJECTS' | '6_INTEGRATED_DOMAINS';

export interface MCQStatement {
  num: number;
  text: string;
  isCorrect: boolean;
  statusBadge: string;
  explanation: string;
}

export interface ClinicalQuestion {
  id: string;
  moduleCode?: string;
  sourceType?: 'ai-generator' | 'emedici' | 'success' | 'amc';
  examType: ExamType;
  subject: string;
  subtopic: string;
  cognitiveTier: 'Direct Recall' | 'Clinical 2-Step' | 'Multi-Step & IBQ';
  difficultyTier?: 'LOW' | 'MEDIUM' | 'HIGH';
  difficultySubLevel?: DifficultySubLevel;
  stem: string;
  questionText: string;
  question?: string;
  statements?: MCQStatement[];
  options: {
    id: 'A' | 'B' | 'C' | 'D' | 'E';
    text: string;
  }[];
  correctOption: 'A' | 'B' | 'C' | 'D' | 'E';
  selectedOption?: 'A' | 'B' | 'C' | 'D' | 'E';
  image?: string;
  imageCaption?: string;
  imageSourceUrl?: string;
  /** What the model asked to illustrate, used to pick a verified library picture. */
  figureQuery?: string;
  figureModality?: string;
  trapType?: string;
  trapExplanation?: string;
  boardPearl: string;
  citations: string[];
  targetAccuracy: number;
  nationalPercentile?: number;
  isFlagged?: boolean;
  isRemediated?: boolean;
  timesFailed?: number;
  remediatedInTest?: string;
  explanation?: string;
}

export interface MedicalTopic {
  id: string;
  code: string;
  title: string;
  discipline: string;
  frequency: 'High Frequency' | 'High-Yield Concept' | 'Foundational Must-Pass' | 'Clinical Blackbox Yield' | 'Board Favorite' | 'Metabolism Pearl';
  linkedVolumes: {
    bookName: string;
    pages: number[];
  }[];
  tags: string[];
  synthesisSnippet?: {
    entity: string;
    excerpts: {
      source: string;
      quote: string;
      tag: string;
    }[];
    pearl: string;
  };
}

export interface SavedHighlight {
  id: string;
  subject: string;
  subtopic: string;
  yieldTier: string;
  sourceContext: string;
  citation: string;
  quote: string;
  memoryAnchor?: string;
  visualizer?: {
    title: string;
    note: string;
    susceptible: string;
    resistant: string;
  };
  boardTrapAlert?: string;
  tags: string[];
  srsIntervalDays: number;
  lastReviewed: string;
}

export interface AvailableModel {
  id: string;
  name: string;
  badge?: string;
  description: string;
  latencyEstimate: string;
  contextWindow: string;
}

export interface AIProvider {
  id: string;
  name: string;
  brand: 'openai' | 'anthropic' | 'google' | 'xai' | 'deepseek' | 'ollama' | 'opencode';
  model: string;
  availableModels: AvailableModel[];
  status: 'active' | 'connected' | 'ready' | 'offline_ready' | 'standby';
  latencyMs?: number;
  type: string;
  features: string[];
  isDefault: boolean;
  isSignedIn: boolean;
  userEmail?: string;
  subscriptionPlan?: string;
  hasTokenConfigured?: boolean;
  tokenType?: 'api_key' | 'session_token' | 'endpoint_url' | 'subscription_auth';
}

export interface PDFChapterIndex {
  id: string;
  title: string;
  pageNumber: number;
  level: 1 | 2;
  pearlCount: number;
  isHighYield: boolean;
}

export interface PDFDocument {
  id: string;
  title: string;
  author: string;
  edition: string;
  discipline: string;
  totalPages: number;
  ocrConfidence: number;
  highYieldSnippets: number;
  chapters: PDFChapterIndex[];
  pagesContent: {
    pageNumber: number;
    title: string;
    text: string;
    pearls: string[];
  }[];
}
