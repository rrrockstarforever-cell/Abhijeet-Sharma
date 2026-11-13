// Exam pipelines. NEET PG and INI-CET each have their own; AMC CAT keeps the generator's original behaviour.
import type { ExamType } from '../../types.ts';
import { INI_CET_PIPELINE } from './iniCet.ts';
import { NEET_PG_PIPELINE } from './neetPg.ts';
import type { ExamPipeline } from './types.ts';

export type { ExamPipeline } from './types.ts';
export { NEET_PG_PIPELINE } from './neetPg.ts';
export { INI_CET_PIPELINE } from './iniCet.ts';
export * from './shared.ts';

/** The pipeline for an exam, or null for exams that keep the original generator path (AMC CAT). */
export function pipelineFor(exam: ExamType): ExamPipeline | null {
  if (exam === 'NEET_PG') return NEET_PG_PIPELINE;
  if (exam === 'INI_CET') return INI_CET_PIPELINE;
  return null;
}
