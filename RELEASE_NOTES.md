# Pulse Med v1.0.15 — AI-Powered Medical PDF Reader

## Overview
Pulse Med is a desktop PDF reader built for medical students and clinicians preparing for postgraduate exams (NEET-PG, INI-CET, AMC CAT, USMLE). Import your textbooks, highlight key passages, and use AI to generate MCQs, revision notes, and clinical explanations — all from your desktop.

## Key Features

### PDF Reading Engine
- **Real pdf.js rendering** — Pages render on demand using the real pdf.js library (not mock documents)
- **Continuous scroll** with IntersectionObserver-driven lazy rendering and LRU eviction (max 24 rendered pages)
- **Page navigation** — Arrow keys, Page Up/Down, on-screen controls, and jump-to-page input
- **Zoom controls** — Zoom in/out, fit width, fit whole page, and keyboard +/- shortcuts
- **Fullscreen mode** — In-app immersive mode with native browser fullscreen fallback
- **Print & Download** — Print the current document or download the original file from the local library

### Text Selection & Highlights
- **Real text selection** via pdf.js TextLayer — select any text on rendered pages
- **Highlight with 4 colors** — Yellow, Green, Pink, Blue (saved to local IndexedDB)
- **Highlights panel** — View all highlights for a document, jump to any highlighted page, delete highlights
- **Copy selection** — Copy selected text to clipboard

### Document Library
- **Import PDF & DOCX** — Files stored locally in IndexedDB (`PulseMedFilesDB`)
- **Document list** — View all imported books with subject categorization
- **Subject editing** — Manually set/edit the subject/discipline for each book
- **Auto subject detection** — Heuristic-based categorization from filename (Anatomy, Physiology, Pathology, etc.)

### OCR (On-Device)
- **OCR Matrix** — tesseract.js OCR runs entirely on-device (no server calls)
- **OCR current page** or OCR all pages without text
- **Force OCR** option to re-run OCR even where native text exists
- **OCR overlay** — Recognized words displayed as a selectable text layer over scanned pages

### Revision Notes
- **Generate notes from page ranges** — Select From/To pages and pages-per-part
- **Download notes as PDF** — Export generated revision notes

### AI-Powered Learning
- **AI MCQ Generator** — Turn any page into exam-style single-best-answer questions with options, answer keys, and explanations
- **Clinical Copilot** — Ask questions about your reading, get explanations of mechanisms, exam pearls, and high-yield concepts
- **Quick Prompts** — One-tap "Explain" and "Key points" buttons for instant AI assistance
- **Web-enabled answers** — Optionally include live web sources in AI responses
- **Provider selection** — Choose from Gemini, ChatGPT, Claude, Grok, OpenCode, or NVIDIA NIM in Settings

### Navigation
- **Keyboard shortcuts** — Arrows/PageUp/PageDown turn pages, +/- zoom, Escape closes popups
- **Page thumbnails** — Lazy-rendered thumbnails for quick page jumping

## Bug Fixes (v1.0.15)
- Fixed AI provider logout — disconnecting a provider now correctly clears the active provider selection
- Fixed provider switching — changing AI provider in Settings now correctly persists and takes effect immediately

## Installation
Download `PulseMed-Setup-1.0.15.exe` from this release and run it. No installation dependencies required.

## Technical
- Built with Electron + Vite + React + pdf.js + tesseract.js
- All data stored locally in IndexedDB — no cloud dependency
- AI calls go through a local Express server; your API keys never leave your machine
- Single-click NSIS installer for Windows (x64)
