#!/usr/bin/env python3
"""Aggregate style statistics of the PYQ database (read-only). Prints numbers only: no question text is copied.

    python tools/quality/pyq-analyze.py [--db path] [--json out.json]
"""
import argparse, collections, html, json, re, sqlite3, statistics
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('--db', default=r'C:\Users\Abhijeet Sharma\Downloads\Marrow-Catalogue\marrow_catalogue.sqlite')
ap.add_argument('--json', default='')
args = ap.parse_args()
c = sqlite3.connect('file:' + args.db + '?mode=ro', uri=True)

def text(h):
    h = re.sub(r'<br\s*/?>|</p>|</li>|</tr>', '\n', h or '', flags=re.I)
    h = re.sub(r'<[^>]+>', ' ', h)
    return re.sub(r'[ \t]+', ' ', html.unescape(h)).strip()

rows = c.execute("""
select q.id, q.stem_html, q.explanation_html, q.correct_option_id, m.title, s.name
from questions q join module_questions mq on mq.question_id=q.id
join modules m on m.id=mq.module_id join subjects s on s.id=m.subject_id
where s.name='PYQ'""").fetchall()
opts = collections.defaultdict(list)
for qid, pos, h in c.execute("select question_id, position, content_html from options order by question_id, position"):
    opts[qid].append((pos, h))

PATIENT = re.compile(r'\b(\d{1,3}[- ]?(?:year|yr|month|week|day)s?[- ]?(?:old)?|\d{1,3}\s?(?:y|yo|yrs)\b|a (?:man|woman|boy|girl|patient|child|infant|neonate|baby|male|female|lady|gentleman))', re.I)
NEG = re.compile(r'\b(NOT|EXCEPT|FALSE|INCORRECT|LEAST|UNTRUE|all of the following .* except)\b')
LEAD = {
    'diagnosis': re.compile(r'diagnosis|most likely (condition|disease|cause)|what is (this|the) (condition|disease)|identify the (condition|disease)', re.I),
    'next step': re.compile(r'next (best )?step|next line|initial management|best management|management of this|most appropriate (next )?(management|step|action)|how (will|would) you (manage|treat)', re.I),
    'drug of choice': re.compile(r'drug of choice|treatment of choice|best treatment|most appropriate (drug|treatment|medication)|first[- ]line|therapy of choice|antibiotic', re.I),
    'investigation': re.compile(r'investigation of choice|best (initial )?(investigation|test)|most (appropriate|sensitive|specific|useful) (test|investigation)|gold standard|diagnostic test|imaging of choice|modality of choice', re.I),
    'mechanism': re.compile(r'mechanism|pathogenesis|why |how does|due to|caused by|responsible for', re.I),
    'identify/image': re.compile(r'identify|shown (in|here)|image|picture|photograph|x-?ray|ecg|ct|mri|slide|histolog|marked|arrow', re.I),
}
STYLE_KEYS = ['vignette', 'one-liner', 'negative', 'match', 'multi-statement', 'assertion-reason', 'calculation', 'image', 'arrange-sequence', 'fill-blank']
stats = collections.defaultdict(lambda: collections.Counter())
lens = collections.defaultdict(list)
opt_counts = collections.defaultdict(collections.Counter)
letters = collections.defaultdict(collections.Counter)
exp_len = collections.defaultdict(list)
exp_mentions = collections.defaultdict(lambda: [0, 0])
per_year = collections.defaultdict(collections.Counter)
subject_ct = collections.defaultdict(collections.Counter)

def exam_of(title):
    if re.search(r'INI|AIIMS', title, re.I): return 'INI-CET/AIIMS'
    if re.search(r'NEET', title, re.I): return 'NEET-PG'
    return 'other'
seen = set()
for qid, stem_h, exp_h, correct, title, _ in rows:
    if qid in seen: continue
    seen.add(qid)
    ex = exam_of(title)
    subj = title.split(' NEET')[0].split(' INI')[0].split(' AIIMS')[0].strip()
    m = re.search(r'(20\d\d)', title); yr = m.group(1) if m else '?'
    stem = text(stem_h); exp = text(exp_h)
    os_ = opts.get(qid, [])
    otext = [text(h) for _, h in os_]
    kinds = set()
    has_img = bool(re.search(r'<img', stem_h or '', re.I))
    if re.search(r'match', stem, re.I) and (re.search(r'\bA[.)]', stem) or re.search(r'list[- ]?i', stem, re.I)): kinds.add('match')
    if re.search(r'(^|\s)1[.)]\s.*\s2[.)]\s', stem, re.S) and any(re.search(r'\b\d\b.*(only|and|,)', t) for t in otext): kinds.add('multi-statement')
    if re.search(r'assertion', stem, re.I) and re.search(r'reason', stem, re.I): kinds.add('assertion-reason')
    if NEG.search(stem): kinds.add('negative')
    if re.search(r'arrange|sequence|chronolog|order of', stem, re.I): kinds.add('arrange-sequence')
    nums = re.findall(r'\d+(?:\.\d+)?', stem)
    if len(nums) >= 3 and sum(bool(re.fullmatch(r'[\s~≈]*[\d.,/:]+\s*[%a-zA-Z/ ]{0,14}', t)) for t in otext) >= 3: kinds.add('calculation')
    if has_img or re.search(r'\b(image|picture|photograph|shown|seen in|ecg|x-?ray|ct scan|mri|histolog|slide)\b', stem, re.I): kinds.add('image')
    if re.search(r'_{3,}|\.{4,}', stem): kinds.add('fill-blank')
    patient = bool(PATIENT.search(stem))
    words = len(stem.split())
    if 'match' not in kinds and 'multi-statement' not in kinds and 'assertion-reason' not in kinds:
        kinds.add('vignette' if patient and words >= 22 else 'one-liner')
    for k in kinds: stats[ex][k] += 1
    stats[ex]['_n'] += 1
    for lk, rx in LEAD.items():
        if rx.search(stem): stats[ex]['lead:' + lk] += 1
    lens[ex].append(words)
    opt_counts[ex][len(os_)] += 1
    cm = re.search(r'_o(\d+)$', str(correct or ''))
    cpos = int(cm.group(1)) if cm else 0
    letters[ex][chr(64 + cpos) if cpos else '?'] += 1
    exp_len[ex].append(len(exp.split()))
    if len(os_) >= 3 and exp:
        el = exp.lower()
        covered = 0
        for (pos, h), t in zip(os_, otext):
            if pos == cpos: continue
            keys = [w for w in re.findall(r'[a-z]{6,}', t.lower())][:3]
            if keys and sum(k in el for k in keys) >= min(2, len(keys)): covered += 1
        exp_mentions[ex][1] += 1
        if covered >= 2: exp_mentions[ex][0] += 1
    per_year[ex][yr] += 1
    subject_ct[ex][subj] += 1

out = {}
for ex in sorted(stats):
    n = stats[ex]['_n']
    pct = lambda k: round(100 * stats[ex][k] / n, 1)
    w = sorted(lens[ex])
    out[ex] = {
        'questions': n,
        'style_share_pct': {k: pct(k) for k in STYLE_KEYS if stats[ex][k]},
        'lead_in_share_pct': {k[5:]: pct(k) for k in stats[ex] if k.startswith('lead:')},
        'stem_words': {'median': statistics.median(w), 'p25': w[len(w) // 4], 'p75': w[3 * len(w) // 4], 'p90': w[int(len(w) * .9)]},
        'option_counts': dict(opt_counts[ex]),
        'correct_letter_pct': {k: round(100 * v / n, 1) for k, v in sorted(letters[ex].items())},
        'explanation_words_median': statistics.median(exp_len[ex]),
        'explanation_mentions_other_options_pct': round(100 * exp_mentions[ex][0] / max(1, exp_mentions[ex][1]), 1),
        'by_year': dict(sorted(per_year[ex].items())),
        'top_subjects': subject_ct[ex].most_common(20),
    }
print(json.dumps(out, indent=1))
if args.json: Path(args.json).write_text(json.dumps(out, indent=1))
