## Pulse Med 1.0.16

Quality and tutor release: better generated questions, a topic request option, a benchmark against reference papers, voice input, and a QA gate on the runner.

### Question generation
- **Mix of item types:** INI-CET sets now mostly use single-best-answer items. About one in four asks which option is incorrect or NOT true, and numbered-statement items are capped at about one in eight. NEET-PG and AMC CAT sets stay single-best-answer.
- **Giveaway control:** options are written to similar length, and the refiner flags a correct answer that stands out as the longest option.
- **Less repetition:** near-identical scenarios are dropped, and each item is steered to a different part of its topic (drug class, system).
- **Topic request:** a "Request a topic" box in the Practice Builder generates MCQs on any typed topic, without choosing a speciality.
- **Expected time:** the builder shows an estimate before launch.

### Runner and QA
- **QA gate:** the Active Test Runner opens only questions that QA approved and that belong to a selected subject. Anything else is held back, with a note in the builder, and stays in the QA dashboard.

### Benchmark
- **QA & Benchmark view:** compares the latest module with the imported eMedici, AMC SUCCESS and AMC Recall banks on stem length, vignettes, negative stems, giveaways and near-duplicates.
- **Reference-free check:** without enough reference items, the longest-option giveaway is still flagged above 40%.

### Clinical AI Tutor
- **Full question panel:** "Show full question" displays the stem and options, without the answer key.
- **Quick actions:** Explain, Why are the others wrong?, Mnemonic, Similar question and Drug interactions.
- **Answers first:** replies open with a one-line answer, and citations name the edition and chapter.
- **Chat titles:** chats with an attached question are titled with its subtopic.
- **Voice input:** a mic button transcribes speech on this device with Whisper. Drug names are not yet reliable, so check the text before sending.

### Fixes
- **eMedici images:** figures now load from a local folder (`BANK_FIGURES_DIR`, default `~/.pulse-med/bank-figures`).
- **Generate profile:** the typed draft is no longer replaced by the generated profile.
- **Analytics:** opens on the exam you practised last, not always NEET-PG.
- **Image Question Review:** the counts in the header are labelled, so attempts, kept items and text-only fallbacks are no longer confused.
- **Dev server:** `DISABLE_HMR` turns off the HMR websocket, and `HMR_PORT` moves it when port 24678 is taken.

### Known limits
- Voice input is accurate for common words but not yet for every drug name.
- The subject check in the benchmark does not apply to topic requests.
- The wrong-subject run seen during testing is not yet reproduced; the QA gate prevents those questions reaching the runner.

- Version 1.0.16.
