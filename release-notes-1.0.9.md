## Pulse Med 1.0.9

**Images now come from the internet only.** The bundled image library is gone; every picture on an image-based question is fetched at generation time, licence-checked, cached locally, and never repeated inside a module.

### Images
- Removed the 20 shipped images and the whole local-library pipeline.
- Live search: **Wikimedia Commons** (including CDC PHIL material) and **Open-i / NLM (PubMed Central)**.
- Only CC BY, CC BY-SA, CC0 and public domain results are used; NC/ND/unknown are rejected.
- Images are proxied through `/api/images/proxy` and cached in the app data folder — no hotlinking.
- Author, licence and a **Source ↗** link are shown with every picture.
- **No repeats**: each picture appears at most once per module; items stay text-only when nothing suitable is left.
- **No fixed quota**: the writer marks any item whose stem describes a visual finding (ECG, X-ray, CT/MRI, ultrasound, histology, blood film, clinical photo, fundus). If it omits the figure fields, the app derives a query from the clinical topic + modality.
- Lookups are logged to `logs/images.log` for diagnosis.

### AI providers
- **OpenCode Go fix**: OpenCode keys were sent to the Console (pay-as-you-go) endpoint, which answers “ran out of credits” even with an active Go subscription. The provider now uses `https://opencode.ai/inference/go/...` first, with a stable `x-opencode-session` and an identifying User-Agent, and only falls back to Console when the key has no Go allowance.
- Test connection now sends a normal one-line clinical question — subscription models such as Grok 4.7 refuse literal “reply with exactly OK” instructions, which caused false failures.

### Question generation
- Up to **two batches in flight** per instance (three queued badly on OpenCode Go), with a guard so a new batch is only started when the running ones cannot cover the remaining questions.
- Duplicate stems are removed before entering a module.
- Elapsed time and a “provider is still writing this batch” hint in the Practice Builder.
- Provider safety filters (`finishReason: content_filter`) are retried with an explicit professional-medical-education instruction instead of the identical prompt.

### Also
- Saved AI-instruction profiles (generate, save, reuse).
- OCR worker pool setting (1–16).
- Multi-date exam countdowns with auto-detection and a date picker.
- Working “Mark all read”, alerts close on outside click.
- Redesigned Ask AI rail in the PDF reader.
- Version 1.0.9.

### Install
`PulseMed-Setup-1.0.9.exe` — per-user NSIS installer, installs to `%LOCALAPPDATA%\Programs\Pulse Med` and keeps existing settings/sign-ins in `%APPDATA%\pulse-med`.

The installer is unsigned; Windows SmartScreen will warn. That is expected.

SHA-256 `1cc782bf36505bbd273242e9ca5a0e78b0409d1a9bc1e9dd89d2c11faff19bca`
