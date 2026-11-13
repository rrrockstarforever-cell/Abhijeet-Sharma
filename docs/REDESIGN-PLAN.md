# Pulse Med Redesign Plan

## 1. Design direction
Calm clinical interface: white/ink light mode, deep navy dark mode, teal used sparingly for action and focus. High contrast, generous line-height, tabular numerals, and no low-contrast decorative text. Optimise for long study sessions: clear hierarchy, quiet surfaces, visible focus states, reduced motion. Brand accent remains `#0f8b8d`; dark canvas remains `#070d18`.

## 2. Design tokens

Ratios approximate WCAG contrast against the mode surface. All body-text pairs are ≥ 4.5:1.

| Role | Light hex | Ratio | Dark hex | Ratio |
|---|---:|---:|---:|---:|
| Surface | `#FFFFFF` | — | `#070D18` | — |
| Text | `#0B1B2B` | 17.4 | `#E6EEF8` | 16.6 |
| Accent | `#0B6B6D` | 6.3 | `#0F8B8D` | 4.7 |
| Success | `#146C43` | 6.5 | `#4ADE80` | 11.2 |
| Warning | `#8A5A00` | 5.9 | `#FBBF24` | 11.6 |
| Danger | `#B42318` | 6.6 | `#F87171` | 7.0 |

Notes: `#0F8B8D` stays the brand fill; `#0B6B6D` is the light-mode accent-text token. Use success/warning/danger for text and small badges only at the listed tokens; use tinted surfaces for larger fills.

**Typography:** Inter or system-ui; tabular numerals. Display 32/40, H1 28/36, H2 24/32, H3 20/28, Body 16/26, Small 14/22, Caption 12/18. Weights: 600 headings, 400 body, 500 UI labels.

**Spacing:** 4px base — `4, 8, 12, 16, 24, 32, 48, 64`. **Radius:** `6` inputs/badges, `10` buttons, `14` cards/dialogs, `20` hero panels, `999` pills.

## 3. Component plan — shadcn/ui
- **Button, Card, Badge, Input, Select:** Question Bank and Practice Builder first — filters, question cards, answer states, primary actions.
- **Tabs, Card, Select, Badge:** Performance Analytics first — score summaries, topic breakdowns, time-range selector.
- **Dialog, Button, Badge:** Test Runner first — submit/exit confirmations, timer/status badges; then AI Tutor and AI Subscriptions.
- **Input, Card, Button:** AI Tutor — prompt entry, response cards, actions.
- **Dialog, Button, Select, Tabs:** PDF Reader — toolbar actions, view controls, settings; rendering untouched.
- **Card, Badge, Button, Dialog:** AI Subscriptions — plan cards, current-plan state, upgrade confirmation.

## 4. Order of work

**Phase 1 — Foundations + core study flow**
Tokens, typography, spacing/radius, app shell, base Button/Card/Badge/Input/Select. Restyle Question Bank and Practice Builder first.
**Check:** `tsc --noEmit`; quality tests (lint/unit/a11y); browser smoke in light and dark.

**Phase 2 — Analytics + test experience**
Card/Tabs/Select/Badge and Dialog on Performance Analytics and Test Runner. Verify focus, timer states, result summaries.
**Check:** `tsc --noEmit`; quality tests; browser check light/dark, keyboard-only pass.

**Phase 3 — Study tools**
AI Tutor, PDF Reader controls, Tabs/Dialog/Input refinements. Keep PDF page rendering isolated.
**Check:** `tsc --noEmit`; quality tests; browser check light/dark, PDF smoke test.

**Phase 4 — Monetisation + polish**
AI Subscriptions, final Badge/Dialog/Button states, contrast audit, responsive pass, reduced-motion pass.
**Check:** `tsc --noEmit`; full quality suite; browser check every screen in light and dark.

## 5. What stays unchanged
Clinical content and copy, question data, analytics calculations, APIs/data schemas, routing, auth, and PDF rendering (page layout, annotations, zoom, text selection). UI chrome around PDFs may change; the renderer and output must not.
