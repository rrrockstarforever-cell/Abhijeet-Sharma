# Clinical image library (image-based questions)

Pulse Med can attach a real, openly-licensed picture to AI-generated image-based items. The
library lives in `public/medical-images/` and is served at `/medical-images/…`; the app only
uses entries whose `verified` flag is `true`.

## What ships

20 verified images across the high-yield visual topics:

| Modality | Images |
| --- | --- |
| ECG | anterior STEMI, atrial fibrillation, ventricular tachycardia, hyperkalaemia |
| X-ray | pneumothorax, lobar pneumonia, pleural effusion, pulmonary TB, Colles fracture, knee osteoarthritis, pneumoperitoneum |
| CT | ischaemic stroke (MCA infarct) |
| Ultrasound | acute cholecystitis |
| Histology | classic Hodgkin lymphoma, tuberculous granulomas |
| Clinical photo | Graves orbitopathy, herpes zoster, psoriasis |
| Fundus | diabetic retinopathy, papilloedema |

Every entry in `manifest.json` carries the diagnosis, modality, subject/subtopic, matching
tags, a hand-written exam caption, the author, the licence and the Commons file page. The
caption displayed under the picture includes the attribution.

## How an image reaches a question

1. The generator is asked for about one image-based item in five. Those items gain
   `figureModality` and `figureQuery` (e.g. `"anterior STEMI ST elevation"`).
2. `src/utils/medicalImages.ts` loads the verified manifest once per session.
3. `matchMedicalImage()` scores each entry against the stem, options and figure query —
   diagnosis name first, then tag overlap, then modality/subject. Below the threshold the
   item stays text-only rather than showing the wrong picture.
4. A match sets `image`, `imageCaption` and `imageSourceUrl` on the question; the Test
   Runner, Question Bank and Mistake Notebook already render those fields.

The Practice Builder has an **Include image-based questions** switch (on by default).

## Adding more images

The pipeline is a script, so coverage can grow without touching app code.

```bash
# 1. Add a seed (id, query, diagnosis, modality, subject, subtopic, tags)
#    to tools/medical-image-seeds.json

# 2. Download the best Commons hit for the new seeds
node tools/fetch-medical-images.mjs --only my-new-disease

# 3. Look at the result — verify it really shows the diagnosis
#    (public/medical-images/contact-sheet.html lists everything)

# 4. Write the caption and mark it verified in
#    tools/finalize-image-manifest.mjs, then:
node tools/finalize-image-manifest.mjs
node tools/medical-image-contact-sheet.mjs
```

`tools/refresh-image-metadata.mjs` re-reads author/licence from Commons for entries whose
attribution is missing.

## Licensing

Images are sourced from Wikimedia Commons (public domain, CC BY, CC BY-SA). The manifest
keeps the author, licence and source URL for every file — keep them when adding entries, and
check the licence allows redistribution before committing a new image.
