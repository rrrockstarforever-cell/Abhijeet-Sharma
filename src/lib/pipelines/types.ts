import type { ClinicalQuestion } from '../../types.ts';
import type { LeadIn, StyleId } from '../questionStyles.ts';
import type { Tier } from './shared.ts';

/**
 * One exam's question pipeline: everything the generator needs to write, shape, check and grade questions for that
 * exam. NEET PG and INI-CET each have their own (neetPg.ts, iniCet.ts), so a change for one exam never moves the other.
 */
export interface ExamPipeline {
  exam: 'NEET_PG' | 'INI_CET';
  name: string;
  optionCount: 4;
  /** Writer brief when a question has no planned style slot (subject/subtopic runs). */
  pattern: string;
  /** Exam rules added to every slotted question. */
  rules: string;
  /** Question shape for unslotted runs, by position in the set. */
  itemShape(idx: number): string;
  /** Default style mix (weights) when the learner picked no style, optionally by subject. */
  styleMix(subject?: string): [StyleId, number][];
  /** Default lead-in mix for case-style questions. */
  leadInMix: [LeadIn, number][];
  /** Difficulty mix used when the learner chose "All". Pitched harder than the real paper on purpose. */
  tierMix: [Tier, number][];
  /** Difficulty wording, by style and tier. */
  tierText(style: StyleId | undefined, tier: Tier): string;
  /** Extra exam-specific instruction appended to a style's own instruction. */
  styleAddendum: Partial<Record<StyleId, string>>;
  /** The exam's answer standard for the examiner. Not used when the learner's own books are the trusted source. */
  examinerFocus: string;
  /** Shape checks the examiner applies in every mode (answer given away, unused case, trivia, off-topic). */
  examinerChecks: string;
  /**
   * The checklist the writer runs on its own draft before replying. It mirrors the code checks below, so a draft that
   * follows it is not rejected afterwards (the main lever on the rejection rate).
   */
  selfCheck: string;
  /** Deterministic clean-ups applied before any check, so cosmetic slips are fixed instead of rejected. */
  normalize(q: ClinicalQuestion): void;
  /** Exam-specific hard checks: null when the question fits the exam, otherwise "reason-key: what to fix". */
  validate(q: ClinicalQuestion): string | null;
}
