# Pulse Med: Revised Exam Blueprint, High-Speed PDF Reader & Adaptive Engine Plan

A refined architectural plan incorporating granular multi-tier difficulty controls, dual-view syllabi for INI-CET, authentic 19-subject NEET-PG and 6-domain AMC CAT blueprints, and an interactive, high-speed searchable PDF reader with 10–16 parallel SIMD OCR worker threads and AI-powered chapter indexing.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following revisions have been incorporated based on your direct feedback:
> 1. **Granular Difficulty System**:
>    - Primary difficulty filter: **Low Difficulty**, **Medium Difficulty**, **High Difficulty**, or **All Levels (Adaptive Mix)**.
>    - Each difficulty tier contains explicit sub-levels (e.g., Low: Direct Recall vs. Keyword Association; Medium: 2-Step Pathophysiology vs. Plausible Distractor; High: 3-Step Management vs. High-Yield Board Trap).
> 2. **INI-CET Dual Syllabus Toggle**:
>    - Toggle between **19 Standard NMC Subjects View** (identical to NEET-PG) and **6 AIIMS Integrated Organ Domains View** (Molecular & Basic Sciences, Systemic Medicine, Surgical Specialties, Maternal & Child, Diagnostics, Ethics).
> 3. **High-Speed PDF Reader & Parallel SIMD OCR Pipeline**:
>    - Dedicated **Medical PDF Reader & Library** with 10–16 parallel WebAssembly SIMD worker threads for rapid page parsing.
>    - One-click **AI Chapter & Concept Indexing** to automatically construct a hierarchical table of contents with page coordinates.
>    - Beautiful, glare-free reading viewer with real-time text search, keyword highlighting, zoom, and instant "Extract Pearl" / "Generate MCQs from Page" actions.
> 4. **AI Subscription Sign-In Modals**:
>    - Interactive connection popups for Claude (Pro/Max), ChatGPT (Plus/Team), Gemini (AI Studio), Grok (SuperGrok), DeepSeek R1, and Ollama Local with latency pings.
> 5. **AMC CAT Adaptive Engine**:
>    - Computer Adaptive Testing (0–500 scale, 250 pass mark) with real-time difficulty calibration bar.

---

## 1. Overview & Core Features

### 1.1 Examination Blueprints & Syllabi
- **NEET-PG**: Full 19 NMC subjects arranged across Pre-clinical, Para-clinical, and Clinical phases with $+4 / -1$ scoring.
- **INI-CET**: Dual-mode syllabus:
  - *Standard Mode*: 19 NMC subjects with AIIMS-weighted high-yield tags.
  - *Integrated Mode*: 6 AIIMS integrated domains (Applied Basic Sciences, Systemic Therapeutics, Surgical Specialties, Maternal & Child Health, Diagnostics & Imaging, Medical Ethics).
  - Scoring: $+1 / -0.33$ with multiple completion and matrix assertions.
- **AMC CAT**: 6 official AMC patient-group domains:
  - Adult Health – Medicine (30%)
  - Adult Health – Surgery (20%)
  - Women's Health (12.5%)
  - Child Health (12.5%)
  - Mental Health (12.5%)
  - Population Health & Ethics (12.5%)
  - 5 options (A–E), adaptive difficulty scaling, no negative marking ($+1 / 0$).

### 1.2 Granular Difficulty Progression System
In the Practice Builder and Test Runner, users choose between:
- **Low Difficulty**:
  - *Sub-tier L1*: 1-Step Direct Retrieval (Definitions, standard drug classes, normal lab values).
  - *Sub-tier L2*: Characteristic Sign / Keyword Association (Pathognomonic signs, classical buzzwords).
- **Medium Difficulty**:
  - *Sub-tier M1*: Clinical 2-Step Reasoning (Presentation + lab result $\rightarrow$ definitive diagnosis).
  - *Sub-tier M2*: Plausible Distractor Discrimination (Differentiating closely paired mimickers).
- **High Difficulty**:
  - *Sub-tier H1*: Multi-Step Management & Complications (Condition $\rightarrow$ treatment complication $\rightarrow$ emergent countermeasure).
  - *Sub-tier H2*: Subtle Board Traps & Atypical Presentations (Misleading normal labs, paradoxical reactions, multi-organ failure).
- **All Levels (Adaptive Mix)**: Automatically scales difficulty up upon consecutive correct answers and scales down upon errors.

### 1.3 High-Speed PDF Reader & Neural OCR Engine
- **10–16 Parallel SIMD OCR Workers**: User-configurable slider from 1 to 16 threads, allowing multi-page background extraction in seconds using WebAssembly SIMD.
- **AI Chapter & Concept Indexing**:
  - Analyzes extracted page text to automatically build a structured table of contents (Chapters, Key Topics, Clinical Pearls, and Image Plates).
- **Searchable PDF Reading Workspace**:
  - Left Sidebar: Bookmarks, AI Chapter Index, and Extracted Pearls list.
  - Center Canvas: Clean, distraction-free, glare-free page viewer with pagination, text selection, zoom (75%–150%), and live search query with yellow highlight markers.
  - Quick Tools: "Search within Book", "Generate 10 MCQs from this Page", "Send Page to AI Socratic Tutor", "Save Highlight to Flashcards".

---

## 2. User Experience & Visual Design

```
┌────────────────────────────────────────────────────────────────────────┐
│               PERSISTENT CLINICAL NAVY SIDEBAR (220px)                 │
│  [Pulse Med Logo]                                                      │
│  Exam Switcher: [ NEET-PG ] [ INI-CET ] [ AMC CAT ]                    │
│                                                                        │
│  Navigation:                                                           │
│  • Performance Analytics (Cohort-specific breakdown)                   │
│  • Practice Module Builder (Granular difficulty & dual syllabus)       │
│  • Test Runner (Adaptive CAT Bar / Multi-Statement Dissection)         │
│  • Mistake Notebook (FSRS SRS Review, Root-Cause Attribution)          │
│  • Flashcards & Highlights (Leitner 4-button scheduler)                │
│  • Clinical AI Tutor (Socratic attending & board exam master)          │
│  • PDF Reader & Library (16-Worker SIMD OCR, AI Index, Searchable)     │
│  • AI Engine Settings (Subscription connect modals & latency pings)    │
└────────────────────────────────────────────────────────────────────────┘
```

### Visual Themes & Design Tokens
- **Canvas**: `#f8f9ff` glare-free reading background, `#ffffff` pristine paper cards, `#e3e7ee` clean borders.
- **Typography**: Inter / Plus Jakarta Sans for reading comfort; JetBrains Mono for timers, page numbers, and calibration metrics.
- **Accents**: Primary Navy `#001432` / `#13294b`, Clinical Teal `#0f8b8d` / `#8ff3f4`, High-Yield Amber `#f2a541`, Error Rose `#d64545`, Success Emerald `#1f9d55`.

---

## 3. Technical Architecture & Component Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                              APP STATE                                 │
│  • currentExam: 'NEET_PG' | 'INI_CET' | 'AMC_CAT'                      │
│  • iniSyllabusMode: '19_SUBJECTS' | '6_INTEGRATED_DOMAINS'             │
│  • difficultyTier: 'ALL' | 'LOW' | 'MEDIUM' | 'HIGH'                   │
│  • difficultySubLevel: 1 | 2                                           │
│  • ocrWorkers: 10 to 16 threads                                        │
│  • uploadedBooks: [{ id, title, pages, aiIndex, ocrText }]             │
│  • pdfReaderState: { currentBook, currentPage, zoom, searchQuery }     │
└───────┬────────────────────────────────────────────────────┬───────────┘
        │                                                    │
        ▼                                                    ▼
┌───────────────────────────────┐    ┌───────────────────────────────────┐
│     PRACTICE BUILDER          │    │         PDF READER VIEW           │
│  • Dual INI-CET Syllabus      │    │  • 10-16 Worker SIMD Status       │
│  • 19 NMC vs 6 AMC Domains    │    │  • AI Auto-Generated Index        │
│  • Low/Med/High & Sub-levels  │    │  • In-Document Live Keyword Search│
│  • Mode: Exam vs Tutor        │    │  • "Generate MCQs from Page" CTA  │
└───────────────────────────────┘    └───────────────────────────────────┘
        │                                                    │
        ▼                                                    ▼
┌───────────────────────────────┐    ┌───────────────────────────────────┐
│         TEST RUNNER           │    │       AI SETTINGS & CONNECT       │
│  • AMC CAT Adaptive Bar       │    │  • Modal Connect Popups:          │
│  • Scale 0-500, Pass 250      │    │    Claude, ChatGPT, Grok, Gemini, │
│  • Real-time Difficulty Shift │    │    DeepSeek, Ollama               │
│  • Statement Dissection       │    │  • Latency Ping & Validation      │
└───────────────────────────────┘    └───────────────────────────────────┘
```

---

## 4. Implementation Steps

1. **`src/types.ts`**:
   - Update `ExamType` to strictly `'NEET_PG' | 'INI_CET' | 'AMC_CAT'`.
   - Add `iniSyllabusMode: '19_SUBJECTS' | '6_INTEGRATED_DOMAINS'`.
   - Add granular difficulty types:
     ```ts
     export type DifficultyTier = 'ALL' | 'LOW' | 'MEDIUM' | 'HIGH';
     export type DifficultySubLevel = 'L1' | 'L2' | 'M1' | 'M2' | 'H1' | 'H2';
     ```
   - Add types for the PDF Reader and AI Indexer (`PDFDocument`, `PDFChapterIndex`, `PDFHighlight`).

2. **`src/data/mockClinicalData.ts`**:
   - Provide the complete 19 NMC subjects tree for NEET-PG.
   - Provide the dual syllabus for INI-CET (19 subjects and 6 AIIMS integrated domains).
   - Provide the 6 AMC CAT patient-group domains with official percentage weights.
   - Enrich question items with granular difficulty sub-levels (`L1`, `L2`, `M1`, `M2`, `H1`, `H2`) and 5 options (A–E) for AMC CAT.

3. **`src/components/PracticeModuleBuilderView.tsx`**:
   - Add the **INI-CET Syllabus View Switcher** (toggle between 19 NMC Subjects and 6 AIIMS Integrated Domains).
   - Add the **Difficulty Tier Selector** with explicit buttons for:
     - *All Levels (Adaptive Mix)*
     - *Low Difficulty (L1 Recall / L2 Buzzwords)*
     - *Medium Difficulty (M1 2-Step / M2 Distractor Discrimination)*
     - *High Difficulty (H1 Multi-Step Management / H2 Board Traps)*
   - Dynamic subject checklist that adjusts automatically based on active exam.

4. **`src/components/TestRunnerView.tsx`**:
   - Integrate the **Real-Time Difficulty Calibration Bar** for AMC CAT:
     - Displays current tier (`Low`, `Medium`, `High`, `Extreme`) and theta scale score.
     - Adjusts dynamically when user submits correct/incorrect answers.
   - Support 5 options (A–E) for AMC CAT questions and 4 options for NEET/INI.

5. **`src/components/PDFReaderView.tsx` (New Dedicated Component)**:
   - Built to deliver a fast, beautiful, glare-free PDF reading experience.
   - **SIMD OCR Worker Controller**: Parallel pool slider (10 to 16 workers, displaying simulated pages/sec throughput).
   - **AI Chapter & Topic Index Drawer**: One-click "Generate AI Index" producing clickable chapter headings and key concept markers with page jumps.
   - **Search Bar**: Live search with yellow keyword highlights across pages.
   - **Quick Action Bar**: "Generate 10 MCQs from this Page", "Ask AI Socratic Tutor", "Save Clinical Pearl".

6. **`src/components/SettingsAIView.tsx`**:
   - Dedicated **Subscription Connect Modals** for Claude, ChatGPT, Grok, Gemini, DeepSeek, and Ollama.
   - Interactive modal popup with input for API key or session token, live ping button, latency indicator, and connection status.

7. **`src/components/PerformanceAnalyticsView.tsx`**:
   - Separate tabs and metrics for NEET-PG (+4/-1, AIR rank), INI-CET (+1/-0.33, percentile), and AMC CAT (0–500 score, 250 pass threshold).

8. **`src/components/Sidebar.tsx` & `src/App.tsx`**:
   - Streamlined sidebar: Analytics, Practice Builder, Test Runner, Mistake Notebook, Flashcards, AI Tutor, PDF Reader & Library, AI Settings.
   - Wire all view transitions and state synchronization.

9. **Verification**:
   - Verify zero lint/compilation errors using `lint_applet` and `compile_applet`.
