---
name: Clinical Focus
colors:
  surface: '#f8f9ff'
  surface-dim: '#d2daeb'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff3ff'
  surface-container: '#e6eeff'
  surface-container-high: '#e1e8f9'
  surface-container-highest: '#dbe3f3'
  on-surface: '#141c28'
  on-surface-variant: '#44474e'
  inverse-surface: '#29313d'
  inverse-on-surface: '#ebf1ff'
  outline: '#74777f'
  outline-variant: '#c4c6cf'
  surface-tint: '#4b5f84'
  primary: '#001432'
  on-primary: '#ffffff'
  primary-container: '#13294b'
  on-primary-container: '#7d91b9'
  inverse-primary: '#b2c7f1'
  secondary: '#00696b'
  on-secondary: '#ffffff'
  secondary-container: '#8ff3f4'
  on-secondary-container: '#007072'
  tertiary: '#221100'
  on-tertiary: '#ffffff'
  tertiary-container: '#3e2300'
  on-tertiary-container: '#c7811d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d7e3ff'
  primary-fixed-dim: '#b2c7f1'
  on-primary-fixed: '#021b3d'
  on-primary-fixed-variant: '#33476a'
  secondary-fixed: '#8ff3f4'
  secondary-fixed-dim: '#72d6d8'
  on-secondary-fixed: '#002020'
  on-secondary-fixed-variant: '#004f51'
  tertiary-fixed: '#ffddb9'
  tertiary-fixed-dim: '#ffb963'
  on-tertiary-fixed: '#2b1700'
  on-tertiary-fixed-variant: '#663e00'
  background: '#f8f9ff'
  on-background: '#141c28'
  surface-variant: '#dbe3f3'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '800'
    lineHeight: 34px
  display-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '800'
    lineHeight: 30px
  headline-h1:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '700'
    lineHeight: 28px
  headline-h2:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '700'
    lineHeight: 24px
  subheading-h3:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
  body-reading:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
  body-compact:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  caption-meta:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
  badge-label:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
  stat-numeral:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '800'
    lineHeight: 36px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-tablet: 1.25rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-tablet: 1.5rem
  margin-desktop: 2.25rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system is tailored for medical professionals preparing for intense postgraduate medical examinations such as NEET-PG, INI-CET, and USMLE. The brand mood delivers clinical authority, visual calm, and cognitive endurance during long study marathons. 

The aesthetic is Modern Corporate mixed with Functional Clinical Utility:
- Grounded in Deep Clinical Navy for rigor and prestige, paired with an energetic Clinical Teal interactive driver.
- Calibrated to reduce screen fatigue through an off-white glare-free canvas, high-contrast typography, and hair-thin clinical dividers.
- Pedagogical tools leverage distinct semantic cues: High-Yield Amber for board pearls and Cognitive Mnemonic Violet for memory recall aids.

## Colors

The palette establishes clinical clarity, readability, and functional feedback:

- **Primary (`#13294b`)**: Deep Clinical Navy anchors screen headers, desktop sidebars, category badges, and authoritative marks.
- **Secondary (`#0f8b8d`)**: Clinical Teal serves as the primary action catalyst, active tabs, progress indicators, selected states, and CTA buttons. Container tint: `#e3f4f4`.
- **Tertiary (`#f2a541`)**: High-Yield Amber highlights exam-critical points, pearls, and revision tags. Soft wash: `#fff5e3`, text: `#8a5a00`.
- **Neutral (`#1c2430`)**: Deep slate for high-density reading and maximum legible contrast. Secondary text: `#667085`. Canvas background: `#f6f7f9`. Card surface: `#ffffff`. Structural border: `#e3e7ee`.

### Semantic Role Overrides
- **Mnemonic Violet**: Base `#8b6fd6`, wash `#f1ecfb`, text `#583c99` for pharmacological mnemonics and memory retention anchors.
- **Success / Validated Green**: Base `#1f9d55`, wash `#e7f6ee`, text `#14663a` for correct MCQ options and mastery bars.
- **Error / Danger Red**: Base `#d64545`, wash `#fdecec`, text `#8f1f1f` for incorrect MCQ options, weak subjects, and alerts.

## Typography

The type system prioritizes unambiguous legibility across clinical case vignettes, lab values, and drug dosages. 

- Use generous line spacing (`1.6x`) on body text to eliminate ocular fatigue during lengthy case presentations.
- MCQ options and diagnostic comparison tables rely on compact body styling for density without cramping.
- Numerical statistics, countdown timers, and percentile rankings require tabular spacing with tight tracking.
- Drug dosages, genetic markers, and lab reference units require strict numerical visual separation.

## Layout & Spacing

A mobile-first fluid layout standardizing rapid one-handed navigation and comfortable scanning:

- **Mobile (360px – 640px)**: Single-column fluid stack with `1rem` outer canvas padding. Interactive touch targets maintain a minimum vertical height of `48px`.
- **Tablet (641px – 1024px)**: 2-column adaptive layout (Syllabus/Index navigation on left 35%, Reading/Question Pane on right 65%) with `1.5rem` outer margins.
- **Desktop (1025px+)**: Fixed `220px` navigation sidebar, with a centered reading container capped at `720px` for optimal question stem scan speed and `1100px` for multi-metric analytics dashboards.
- Spatial rhythm adheres to a strict 4px/8px incremental scale for component padding and element gaps.

## Elevation & Depth

Visual depth is achieved through layered tonal surfaces and low-contrast outlines rather than heavy drop shadows:

- **Canvas & Surface Layering**: Neutral canvas sits at `#f6f7f9`. Active question containers, flashcard bodies, and metric cards sit at pure `#ffffff`.
- **Dividers & Structural Borders**: Crisp, hairline strokes (`1px solid #e3e7ee`) outline cards, table rows, and selectable options to provide precise structural definition under bright medical ambient light.
- **Ambient Shadow Depth**:
  - Interactive cards & flashcards: subtle ambient drop shadow of `0 4px 14px rgba(19, 41, 75, 0.06)`.
  - Floating overlays, drawers, and popovers: `0 14px 40px rgba(19, 41, 75, 0.18)` over a 90% navy scrim (`rgba(10, 20, 40, 0.85)`).

## Shapes

The interface balances clinical structure with modern touch friendliness:

- Base elements (buttons, inputs, option rows, cards) use `0.5rem` (8px) corner radius.
- Larger interactive cards, flashcard wrappers, and question shells use `1rem` (16px).
- Navigation pills, category badges, and quick filter chips feature full pill shaping (`9999px`).

## Components

### Buttons
- **Primary**: Background `#0f8b8d`, text `#ffffff`, height 44px (touch-friendly on mobile), rounded 8px. Hover shifts to brightness 1.08; pressed to 0.95.
- **Secondary**: Paper white `#ffffff`, border `1px solid #e3e7ee`, text `#1c2430`. Hover border shifts to `#0f8b8d`.
- **Ghost / Subtle**: Transparent, no border, text `#667085`, hover wash `#f6f7f9`.

### Chips & Subject Filters
- Pill-shaped (`border-radius: 9999px`), `1px solid #e3e7ee`, background `#ffffff`, color `#13294b`, font size 12.5px.
- Selected state: solid `#0f8b8d` background, `#ffffff` text, `#0f8b8d` border.

### Question Bank & MCQ Stems
- **Container**: White paper card, `1px solid #e3e7ee`, rounded 16px, padding `1rem` on mobile, `1.25rem` on desktop.
- **Option Button**: Full-width row with minimum 48px height, `1px solid #e3e7ee`, rounded 8px, padding `10px 14px`. Contains an option identifier badge (A, B, C, D) in bold 14px font.
  - Hover: background `#e3f4f4`, border `#0f8b8d`.
  - Correct State: background `#e7f6ee`, border `2px solid #1f9d55`, text `#14663a`.
  - Incorrect State: background `#fdecec`, border `2px solid #d64545`, text `#8f1f1f`.
- **Explanation Panel**: Auto-revealed accordion below options. Correct variant uses `#e7f6ee`; incorrect variant uses `#fdecec`. Includes reference citations and rationale breakdown.

### Flashcards & Spaced Repetition (SRS)
- Elevated card surface with `0 6px 20px rgba(19, 41, 75, 0.08)`, rounded 16px.
- Four bottom feedback triggers:
  - *Again (<10m)*: `#fdecec` wash, `#d64545` border & label.
  - *Hard (1d)*: `#fff5e3` wash, `#f2a541` border & label.
  - *Good (3d)*: `#e3f4f4` wash, `#0f8b8d` border & label.
  - *Easy (7d)*: `#e7f6ee` wash, `#1f9d55` border & label.

### High-Yield & Pedagogical Callouts
- **High-Yield Pearl**: Left border `4px solid #f2a541`, background `#fff5e3`, text `#8a5a00`, rounded `0 8px 8px 0`, padding `12px 16px`.
- **Mnemonic Hook**: Left border `4px solid #8b6fd6`, background `#f1ecfb`, text `#583c99`, rounded `0 8px 8px 0`, padding `12px 16px`.

### Performance Analytics & Trackers
- **Metric Cards**: Background `#ffffff`, border `1px solid #e3e7ee`, rounded 12px, padding `14px 16px`. Display numerals at 30px bold Navy (`#13294b`).
- **Progress Trackers**: 8px track height, rounded 9999px, background `#e3e7ee`. Green fill (`#1f9d55`) for proficiency >75%; red fill (`#d64545`) for weak subjects under 50%.

### Form Inputs & Checkboxes
- **Input Fields**: Background `#ffffff`, border `1px solid #e3e7ee`, rounded 8px, padding `10px 14px`. Focused state: border `1.5px solid #0f8b8d` with subtle teal outline.
- **Checkboxes & Radios**: 20px dimensions, rounded 4px (checkbox) or circle (radio), border `1.5px solid #667085`. Checked state fills with `#0f8b8d` with sharp white glyph.