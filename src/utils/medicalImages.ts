// Verified clinical image library (public/medical-images/manifest.json).
// Images are openly licensed (mostly Wikimedia Commons), fetched by
// tools/fetch-medical-images.mjs, and only used when an entry is marked verified.
// The matcher is deliberately strict: a question only gets a picture when its stem,
// options or the model's figure query clearly name the same diagnosis.

export interface MedicalImage {
  id: string;
  file: string;
  diagnosis: string;
  modality: string;
  subject: string;
  subtopic: string;
  tags: string[];
  caption: string;
  credit: string;
  license: string;
  sourceUrl: string;
  verified: boolean;
  width?: number;
  height?: number;
}

let cache: MedicalImage[] | null = null;
let loading: Promise<MedicalImage[]> | null = null;

export async function loadMedicalImages(): Promise<MedicalImage[]> {
  if (cache) return cache;
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch('/medical-images/manifest.json', { cache: 'force-cache' });
      if (!res.ok) return (cache = []);
      const rows = await res.json();
      cache = Array.isArray(rows)
        ? rows.filter(
            (r: any) =>
              r &&
              typeof r.file === 'string' &&
              r.verified === true &&
              typeof r.diagnosis === 'string',
          )
        : [];
      return cache;
    } catch {
      return (cache = []);
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export function medicalImageUrl(image: MedicalImage): string {
  return `/medical-images/${image.file}`;
}

/** One-line attribution that always travels with the picture. */
export function imageAttribution(image: MedicalImage): string {
  const who = image.credit && image.credit !== 'Wikimedia Commons contributor' ? image.credit : 'Wikimedia Commons';
  return `${who} · ${image.license || 'see source'}`;
}

const norm = (value: unknown): string =>
  ` ${String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

interface MatchableQuestion {
  subject?: string;
  subtopic?: string;
  stem?: string;
  questionText?: string;
  options?: { text: string }[];
  figureQuery?: string;
  figureModality?: string;
}

/**
 * Best verified image for a question, or null when nothing matches confidently.
 * Scoring favours the diagnosis by name, then tag overlap, then modality/subject.
 */
export function matchMedicalImage(question: MatchableQuestion, images: MedicalImage[]): MedicalImage | null {
  if (!images.length) return null;
  const haystack = norm(
    [
      question.stem,
      question.questionText,
      ...(question.options ?? []).map((o) => o.text),
      question.figureQuery,
    ].join(' '),
  );
  const query = norm(question.figureQuery);
  const modalityWant = norm(question.figureModality);

  let best: { image: MedicalImage; score: number } | null = null;

  for (const image of images) {
    let score = 0;
    const diagnosis = norm(image.diagnosis);
    const diagnosisCore = diagnosis.trim();

    if (diagnosisCore && haystack.includes(diagnosisCore)) score += 30;
    if (query && diagnosisCore && query.includes(diagnosisCore)) score += 22;

    for (const tag of image.tags ?? []) {
      const t = norm(tag).trim();
      if (!t) continue;
      if (haystack.includes(` ${t} `) || (t.length >= 5 && haystack.includes(t))) {
        score += 4 + Math.min(6, t.split(' ').length * 3);
      }
      if (query.includes(` ${t} `)) score += 4;
    }

    if (modalityWant.trim() && norm(image.modality).includes(modalityWant.trim())) score += 6;
    if (question.figureModality && image.modality.toLowerCase() === question.figureModality.toLowerCase()) score += 4;
    if (question.subject && image.subject && norm(question.subject).includes(norm(image.subject).trim())) score += 3;
    if (question.subtopic && image.subtopic && norm(question.subtopic).includes(norm(image.subtopic).trim())) score += 4;

    if (!best || score > best.score) best = { image, score };
  }

  return best && best.score >= 18 ? best.image : null;
}
