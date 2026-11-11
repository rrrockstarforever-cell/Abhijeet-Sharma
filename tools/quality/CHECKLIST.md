# What makes the topic-to-MCQ generator near perfect

Run `tools/quality/batch-test.mjs` (see its header) to score many cases at once. Targets are per case.

## 1. Facts (the plan)
- Facts come from an official label, textbook page or review, never from one case report or one trial.
- Each fact is definite and exam-weighted. No hedges ("may", "remains uncertain"), no study design, no percentages from papers.
- Every important subtopic of the topic appears at least once (compare against a hand-written subtopic list).
- The set size follows the number of good facts; a short set carries a notice.
- No two facts say the same thing; no two facts contradict each other.

## 2. Each question
- The marked answer is right (judge `wrong` = 0).
- Exactly one option is defensible (`ambiguous` <= 5%).
- It tests the fact, not a side detail; relevance >= 3.8 on average, none <= 2.
- Stem is complete, short, does not contain the answer, has no generic lead-in.
- Options are the same kind of thing, about the same length; the right one is not the longest.
- Explanation says why the answer is right and why the nearest distractor is wrong.

## 3. The set
- No repeated answers, no near-duplicate stems.
- Patient cases are at most about 60% (INI-CET and AMC lean higher, NEET-PG one-liners lower).
- Correct letters are spread (no letter above 40%).
- Difficulty mix matches the chosen tier.

## 4. Range to test
- Subjects: drugs, medicine, anatomy, physiology, biochemistry, pathology, microbiology, surgery, OBG, PSM, forensic, a whole chapter, AMC general practice.
- Styles: clinical vignette, one-liner recall, match the following, multiple statements, "NOT / EXCEPT", next best step, drug of choice, investigation of choice, calculation (PSM), image-based and ECG.
- Sizes: 10, 20, 50, 100 requested, including a topic that has fewer facts than asked.

## 5. Targets
| Measure | Target |
| --- | --- |
| Wrong answers | 0 |
| Ambiguous | <= 5% |
| Average relevance | >= 3.8 / 5 |
| Yield (kept / started) | >= 40% |
| Plain-check flags | <= 10% |
| Time for 20 questions | <= 4 min |
