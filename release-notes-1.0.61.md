## Pulse Med 1.0.61

Saved question banks, persistent AI replies, and a smaller installer. Version 1.0.61 follows 1.0.16; the numbers between were not released.

### Question banks
- **Every generated bank is saved whole**, with its questions in their original order and your progress.
- **Saved question banks** panel at the top of the Question Bank screen: Start, Continue, Review, and Delete. Resuming restores your answers and position.
- **Earlier banks:** banks from before this release are rebuilt from saved sessions where all their questions are still stored. Rebuilt banks show the date they were rebuilt.
- **Generated question banks by category:** generated questions grouped by subject, with counts by exam and topic.

### AI replies keep running
- **Explain, notes and topic summaries** continue when you move to another question. The result is waiting when you come back, and is kept on this device.
- **Clinical AI Tutor:** a reply that is still generating is saved to its conversation when it arrives, even if you have left the tutor.

### Clinical AI Tutor (from 1.0.16)
- **Full question panel**, quick actions, answer-first replies, citations with chapters, and subtopic chat titles.

### Voice input (from 1.0.16)
- **Mic button** transcribes speech on this device with Whisper. Drug names are not yet reliable, so check the text before sending.

### Installer
- **About 213 MB**, down from 895 MB. The Whisper model cache and the Node-only speech runtime are no longer packaged. The model is downloaded on first use.

### Known limits
- Rebuilt banks cover only earlier runs whose questions are all still stored.
- Voice input is not yet accurate for every drug name.
- The installer is not code-signed, so Windows may show a SmartScreen warning.
