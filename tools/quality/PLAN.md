# Plan: exam-perfect question styles, tested once, in a loop

## What "perfect" means
A question is perfect when all of these hold. Each one is checked by a plain rule, a model judge, or both.

| # | Property | Checked by |
| - | - | - |
| 1 | The marked answer is right; exactly one option is defensible | per-question examiner (in the app) + judge (in the test) |
| 2 | It tests an exam-worthy fact, not research trivia | planner filters + examiner + judge relevance >= 3 |
| 3 | It has the style the learner asked for, or the exam's real mix when none was asked | style validators (plain rules) + judge `style_ok` |
| 4 | It is complete without a picture, or its picture is attached and correct | `dangling-picture` rule + picture verification |
| 5 | The stem has no hint; options are homogeneous, similar in length | existing hint and similar-options checks |
| 6 | Explanation says why the key is right and why each other option is wrong | `explains-distractors` rule + judge |
| 7 | The set has no repeats, even correct letters, the right difficulty mix, the exam's option count (4, or 5 for AMC) | set rules |

## Gaps found in the code (why styles are not perfect today)
1. Typed topics ignore the style chips: the writer gets "Question type focus: ..." but `typedShape()` overrides it.
2. `typedShape()` contradicts the exam patterns: 25% "NOT true" items (NEET-PG says avoid), a ban on patients in 3 of 8 slots (AMC says every item is a vignette).
3. Match-the-following, multiple-statement, calculation, assertion-reason and "identify the structure" items have no validator, so a malformed one passes.
4. A stem can say "in this biopsy" or "shown here" with no picture attached (seen in the matrix).
5. Difficulty "All" is treated as MEDIUM for every question; the UI promises 20/45/35.
6. A dropped question is rewritten from the same prompt, with no hint of why it was dropped.
7. Pictures: one source, one query, 12-20 s budget, serial verification, 8% hit rate.
8. Tests need the browser pane, stop when it closes, and reload on every file edit.

## Design

### A. One source of truth: `src/lib/questionStyles.ts`
For each style: id, UI label, writer instruction, plain validator, judge criteria, what it needs from the fact.
Styles: `vignette`, `short-case`, `one-liner`, `negative` (NOT/EXCEPT), `match`, `multi-statement`, `assertion-reason`, `calculation`, `mechanism`, `image` (ECG, X-ray, histology, identify the structure).
Lead-ins (stem patterns): next step, drug of choice, investigation of choice, treatment of choice, most likely diagnosis, advice.

### B. Style planner (one cheap model call per set)
After the fact plan, one call labels every planned fact with the styles it can carry (a match item needs 3+ related facts; a calculation needs numbers; an image item needs a picturable finding). Slots are then assigned:
- Learner picked styles: only those, round-robin, among the facts that fit; lead-ins rotate over the picked stem patterns.
- Nothing picked: the exam's own mix.
  - NEET-PG: 45% short vignette, 30% one-liner, 10% image, 10% calculation where numbers exist, 5% mechanism; no NOT, match or statement items (its pattern forbids them).
  - INI-CET: 35% vignette, 25% one-liner, 20% NOT, 10% multi-statement, 5% match, 5% assertion-reason.
  - AMC CAT: 100% vignette, 5 options; lead-ins 35% next step, 25% diagnosis, 20% investigation, 20% advice.
- Difficulty "All": 20% easy, 45% medium, 35% hard, per slot.
- Match, NOT and multi-statement slots receive the other planned facts of the same subtopic as their true statements, so these items are built from sourced facts.

### C. Validators and rewrite loop
Every accepted candidate passes its style validator plus the common rules (dangling picture, explains distractors, option count, similar options). A drop now records a reason, and the rewrite prompt says "your last attempt was rejected because ...". Three attempts per slot at most; a slot that keeps failing falls back to the plain recall style rather than disappearing.

### D. Pictures (tested offline, no model cost)
- Add two sources: the Wikipedia article's own images (via the API, licence read from Commons) and Commons category members for the diagnosis.
- The planner returns three queries per picture: specific, general, and the article title.
- Verify the top three candidates in parallel; accept the first that names the same specific condition.
- A picture-style slot whose picture cannot be found is rewritten as a text item that describes the finding in words, never left pointing at nothing.
- Offline script `tools/quality/image-hitrate.mjs` runs 60 typical queries and reports hit rate and time; target >= 70% of picturable queries within 12 s.

### E. Headless test runner (the thing that makes "test once" possible)
`tools/quality/run.mjs` runs under Node with a localStorage shim and a fetch that points at a private server on port 3100. No browser, no reload on edit, no pane to close, output to a JSON file, a notification when finished. Edits made while it runs do not affect it.

### F. Test grid (built once, 36 cases, about 330 questions)
- 12 style cases (one forced style each, on a topic that suits it): vignette, one-liner, NOT, match, multi-statement, assertion-reason, calculation, next step, drug of choice, investigation of choice, ECG/X-ray, histology.
- 12 default-mix cases: NEET-PG x 4 topics, INI-CET x 4, AMC x 4.
- 12 topic-shape cases: drug, anatomy, physiology, biochemistry, pathology, microbiology, surgery, OBG, PSM, forensic, whole chapter, few-facts topic.
Judge fields per question: correct, single-best, relevance 1-5, clear, `style_ok`, difficulty (easy/medium/hard), explanation_ok.

### G. The loop
1. Run the grid headless. 2. Aggregate failures by type. 3. Fix the largest cause. 4. Re-run only the failing cases. 5. Stop when every target is met or after 4 rounds, then report what is left.

## Targets (per case unless noted)
| Measure | Target |
| - | - |
| Wrong answers | 0 |
| Ambiguous | <= 5% |
| Style conformance (`style_ok`) | >= 95% |
| Average relevance | >= 3.8 |
| Dangling picture references | 0 |
| Explanation explains distractors | >= 90% |
| Correct letters | no letter above 35% |
| Option count | exactly 4 (NEET-PG, INI-CET) or 5 (AMC) |
| Picture hit rate (picturable queries) | >= 70% |
| Time for 12 questions, plan cached | <= 6 min |

## Order of work
1. Headless runner and fixtures (so every later step is cheap to test).
2. Picture hit-rate script and the new picture sources (no model calls).
3. `questionStyles.ts`, validators with unit fixtures (good and bad hand-written questions per style; plain Node, no model).
4. Style planner, slot assignment, difficulty mix, related-facts, rewrite loop.
5. Common rules: dangling picture, explains distractors, option count.
6. Grid run and the loop.
7. Installer 1.0.67, push, report.
