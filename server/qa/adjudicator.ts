// Stage 6 - QualityAdjudicator. Deterministic combination of the verification findings.
// The numeric score is an internal engineering heuristic, never a clinical-safety override.

export interface AdjudicationInput {
  structuralPassed: boolean;
  structuralFindings: Array<{ severity: string; message: string }>;
  solverAgreed: boolean;
  solverMissingInfo: number;
  evidenceContradicted: number;
  evidenceInsufficient: number;
  evidenceConflict: number;
  auditAmbiguous: boolean;
  auditFindings: Array<{ severity: string; message: string }>;
  examinerScore?: number;
  duplicates: number;
  hasExplanation: boolean;
  explanationLength: number;
  examRelevant: boolean;
}

export interface AdjudicationOutput {
  totalScore: number;
  breakdown: Record<string, number>;
  decision: 'approve' | 'revise' | 'reject' | 'human_review' | 'block';
  mandatoryFailures: string[];
  reason: string;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function adjudicate(input: AdjudicationInput): AdjudicationOutput {
  const mandatoryFailures: string[] = [];
  const breakdown: Record<string, number> = {};

  // 1. Clinical correctness and supporting evidence (35)
  let clinical = 35;
  if (!input.solverAgreed) { clinical -= 18; mandatoryFailures.push('Answer key disputed by the independent solver.'); }
  if (input.evidenceContradicted > 0) { clinical -= 25; mandatoryFailures.push('Evidence CONTRADICTED a key claim.'); }
  else if (input.evidenceConflict > 0) { clinical -= 15; }
  if (input.evidenceInsufficient > 0) clinical -= 4 * Math.min(3, input.evidenceInsufficient);
  if (input.solverMissingInfo > 0) clinical -= 3 * Math.min(3, input.solverMissingInfo);
  breakdown.clinical = clamp(clinical);

  // 2. Answer uniqueness and consistency (20)
  let uniqueness = 20;
  if (input.auditAmbiguous) { uniqueness -= 15; mandatoryFailures.push('Multiple defensible answers (ambiguous key).'); }
  if (input.duplicates > 0) uniqueness -= 8;
  breakdown.uniqueness = clamp(uniqueness);

  // 3. Exam relevance (10)
  breakdown.examRelevance = input.examRelevant ? 10 : 4;

  // 4. Distractor quality (10) - folded into examiner score when available
  breakdown.distractor = input.examinerScore != null ? clamp(input.examinerScore * 0.1) : 7;

  // 5. Clinical realism (10)
  breakdown.realism = input.structuralPassed ? 9 : 5;

  // 6. Difficulty appropriateness (10)
  breakdown.difficulty = 8;

  // 7. Explanation quality (5)
  breakdown.explanation = input.hasExplanation
    ? (input.explanationLength >= 40 ? 5 : 3)
    : 0;

  const total = clamp(Object.values(breakdown).reduce((a, b) => a + b, 0));

  // Mandatory gates override any score.
  const hasCritical = input.structuralFindings.some((f) => f.severity === 'critical');
  const hasError = input.structuralFindings.some((f) => f.severity === 'error');
  if (hasCritical) { mandatoryFailures.push('Critical structural defect.'); }

  let decision: AdjudicationOutput['decision'];
  let reason = '';
  if (mandatoryFailures.length) {
    decision = hasCritical ? 'block' : 'human_review';
    reason = mandatoryFailures.join(' ');
  } else if (!input.structuralPassed) {
    decision = 'reject';
    reason = 'Structural validation failed.';
  } else if (total >= 90) {
    decision = 'approve';
    reason = 'All gates passed and score >= 90.';
  } else if (total >= 80) {
    decision = 'revise';
    reason = 'Score in 80-89: revise and revalidate.';
  } else {
    decision = 'reject';
    reason = 'Score below 80: reject or reconstruct.';
  }

  return { totalScore: total, breakdown, decision, mandatoryFailures, reason };
}
