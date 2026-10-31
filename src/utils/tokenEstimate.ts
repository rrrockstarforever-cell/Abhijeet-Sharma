// Token estimation for large document attachments.
//
// The model window is up to 1M tokens, so a multi-hundred-page attach is genuinely
// possible — but it is not free. Every token is processed before the first word streams
// back, so a very large prompt can take minutes to start answering. This gives the learner
// an honest, visible estimate BEFORE they send, instead of a surprise wait.
//
// ~4 characters per token is the standard rule of thumb for English prose and is accurate
// enough to warn with. It is deliberately NOT presented as an exact figure.
const CHARS_PER_TOKEN = 4;

/** Rough token count for a block of text. */
export function estimateTokens(text: string): number {
  return Math.round(String(text || '').length / CHARS_PER_TOKEN);
}

/** Human-readable token count, e.g. "~12k tokens". */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `~${tokens} tokens`;
  if (tokens < 1_000_000) return `~${Math.round(tokens / 1000)}k tokens`;
  return `~${(tokens / 1_000_000).toFixed(2)}M tokens`;
}

export type AttachScale = 'small' | 'medium' | 'large' | 'huge';

export interface AttachAdvice {
  tokens: number;
  label: string;
  scale: AttachScale;
  /** shown to the learner before sending */
  warning?: string;
}

/**
 * Classify an attachment by size. Thresholds are chosen around observable behaviour:
 * a normal page is instant, a chapter is a few seconds, and the large/huge tiers are where
 * the request can outlast a reasonable wait on the free tier.
 */
export function adviseAttachment(text: string): AttachAdvice {
  const tokens = estimateTokens(text);
  const label = formatTokens(tokens);
  if (tokens < 8_000) return { tokens, label, scale: 'small' };
  if (tokens < 60_000) return { tokens, label, scale: 'medium' };
  if (tokens < 250_000) {
    return {
      tokens,
      label,
      scale: 'large',
      warning: 'Large attachment — the first reply may take noticeably longer than usual.',
    };
  }
  return {
    tokens,
    label,
    scale: 'huge',
    warning:
      'Very large attachment. On the free NVIDIA tier this may take several minutes, time out, ' +
      'or be rejected under load. Consider a smaller page range.',
  };
}
