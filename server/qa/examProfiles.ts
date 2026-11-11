// Stage 0 — ExamProfileRegistry.
// Versioned, data-driven configuration for each examination. Rules live here, not in code.

export interface ExamProfile {
  id: string;
  edition: string;
  label: string;
  options: number;
  multipleCorrect: boolean;
  allowedQuestionTypes: string[];
  guidelineJurisdiction: 'Australia' | 'India';
  learningObjectives: string[];
  curriculum: string[];
  difficultyRequirements: { easy: number; medium: number; hard: number };
  scoring: string;
  metadata: Record<string, string>;
  permittedMedia: string[];
  version: number;
}

const AMC_CAT: ExamProfile = {
  id: 'AMC_CAT',
  edition: '2026',
  label: 'AMC CAT MCQ',
  options: 5,
  multipleCorrect: false,
  allowedQuestionTypes: ['single-best-answer'],
  guidelineJurisdiction: 'Australia',
  learningObjectives: ['data gathering', 'data interpretation', 'management'],
  curriculum: ['adult health', 'child health', 'women’s health', 'mental health', 'emergency medicine', 'Aboriginal and Torres Strait Islander health'],
  difficultyRequirements: { easy: 20, medium: 45, hard: 35 },
  scoring: '+1 correct, no negative marking',
  metadata: { references: 'Therapeutic Guidelines (eTG), AMH, RACGP Red Book, Murtagh’s General Practice, NIP' },
  permittedMedia: ['image', 'table'],
  version: 1,
};

const NEET_PG: ExamProfile = {
  id: 'NEET_PG',
  edition: '2026',
  label: 'NEET PG',
  options: 4,
  multipleCorrect: false,
  allowedQuestionTypes: ['single-best-answer', 'clinical-vignette', 'one-liner', 'image-based'],
  guidelineJurisdiction: 'India',
  learningObjectives: ['diagnosis', 'next-best-step', 'drug-of-choice', 'investigation-of-choice', 'mechanism'],
  curriculum: ['Anatomy', 'Physiology', 'Biochemistry', 'Pathology', 'Pharmacology', 'Microbiology', 'Forensic Medicine', 'PSM', 'General Medicine', 'General Surgery', 'Obstetrics & Gynaecology', 'Pediatrics', 'Orthopedics', 'ENT', 'Ophthalmology', 'Dermatology', 'Psychiatry', 'Anesthesiology', 'Radiodiagnosis'],
  difficultyRequirements: { easy: 20, medium: 45, hard: 35 },
  scoring: '+4 correct, -1 wrong',
  metadata: { references: 'Harrison’s 21st Ed, Robbins 10th Ed, Goodman & Gilman, Nelson, Bailey & Love, Park PSM, Indian guidelines' },
  permittedMedia: ['image', 'table', 'lab-report'],
  version: 1,
};

const INI_CET: ExamProfile = {
  id: 'INI_CET',
  edition: '2026',
  label: 'INI-CET',
  options: 4,
  multipleCorrect: false,
  allowedQuestionTypes: ['single-best-answer', 'multiple-statement', 'match-the-following', 'assertion-reason', 'sequence'],
  guidelineJurisdiction: 'India',
  learningObjectives: ['diagnosis', 'next-best-step', 'drug-of-choice', 'investigation-of-choice', 'mechanism', 'recent-advances'],
  curriculum: ['19 NMC subjects', '6 AIIMS integrated domains'],
  difficultyRequirements: { easy: 20, medium: 45, hard: 35 },
  scoring: '+1 correct, -1/3 wrong',
  metadata: { references: 'Harrison’s 21st Ed, Robbins 10th Ed, Indian guidelines, AIIMS pattern' },
  permittedMedia: ['image', 'table', 'lab-report'],
  version: 1,
};

const REGISTRY: Record<string, ExamProfile> = { AMC_CAT, NEET_PG, INI_CET };

export function getExamProfile(examType: string): ExamProfile | null {
  return REGISTRY[examType] ?? null;
}

export function listExamProfiles(): ExamProfile[] {
  return Object.values(REGISTRY);
}
