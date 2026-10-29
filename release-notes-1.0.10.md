## Pulse Med 1.0.10

Bug-fix release focused on data that used to disappear.

### Fixed
- **AI tool results (Explain / Note / Topic) no longer disappear** when you move to another question or reload the app. They are now cached per question (in-memory + localStorage `pulse.aiTools.<id>`) and a generation that finishes after you've switched questions still lands in the cache.
- Generated question modules, AI notes, highlights, mistakes, SRS cards, question-bank imports and PDF library were already persisted (sessionStore / IndexedDB / localStorage); this release only adds the missing per-question AI tool state.

### Also in this line
- Internet-only image sourcing, per-module no-repeat images, OpenCode Go endpoint, parallel question batches, OCR worker pool (1–16), saved AI-instruction profiles, multi-date exam countdowns, working clinical alerts.
- Version 1.0.10.

### Install
`PulseMed-Setup-1.0.10.exe` — per-user NSIS installer, installs to `%LOCALAPPDATA%\Programs\Pulse Med`, keeps existing settings/sign-ins in `%APPDATA%\pulse-med`.

Unsigned — Windows SmartScreen will warn (expected).

SHA-256 `3224e83bcef8ec39a8b9e459b9d212500a44d7a5052caac67044eaaa177c987d`
