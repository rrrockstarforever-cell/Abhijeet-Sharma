// The quality grid, built once. Three groups of 12 cases:
//   st-*  one forced style each, on a topic that suits it (checks the style is really delivered)
//   mx-*  no style asked, so the exam's own mix applies (checks the mix per exam)
//   tp-*  topic shapes across subjects (checks facts, accuracy and relevance outside the usual topics)
// `style` is what the judge is told the question must be; `styles` is what the app is asked for.
export const GRID = [
  // ---- forced styles ----
  { id: 'st-vignette', topic: 'nephrotic syndrome', exam: 'INI_CET', count: 8, styles: ['vignette'], style: 'vignette' },
  { id: 'st-oneliner', topic: 'brachial plexus injuries', exam: 'NEET_PG', count: 8, styles: ['one-liner'], style: 'one-liner' },
  { id: 'st-negative', topic: 'side effects of antitubercular drugs', exam: 'INI_CET', count: 8, styles: ['negative'], style: 'negative' },
  { id: 'st-match', topic: 'types of necrosis', exam: 'INI_CET', count: 8, styles: ['match'], style: 'match' },
  { id: 'st-multi', topic: 'diabetic ketoacidosis', exam: 'INI_CET', count: 8, styles: ['multi-statement'], style: 'multi-statement' },
  { id: 'st-assert', topic: 'pre-eclampsia', exam: 'INI_CET', count: 8, styles: ['assertion-reason'], style: 'assertion-reason' },
  { id: 'st-calc', topic: 'screening tests sensitivity and specificity', exam: 'NEET_PG', count: 8, styles: ['calculation'], style: 'calculation' },
  { id: 'st-nextstep', topic: 'acute appendicitis', exam: 'NEET_PG', count: 8, styles: ['vignette'], leadIns: ['next-step'], style: 'vignette:next-step' },
  { id: 'st-drug', topic: 'malaria diagnosis and treatment', exam: 'NEET_PG', count: 8, styles: ['vignette'], leadIns: ['drug-of-choice'], style: 'vignette:drug-of-choice' },
  { id: 'st-invest', topic: 'acute pancreatitis', exam: 'NEET_PG', count: 8, styles: ['vignette'], leadIns: ['investigation-of-choice'], style: 'vignette:investigation-of-choice' },
  { id: 'st-ecg', topic: 'myocardial infarction ECG changes', exam: 'NEET_PG', count: 8, styles: ['image'], style: 'image' },
  { id: 'st-histo', topic: 'glomerular diseases histology', exam: 'INI_CET', count: 8, styles: ['image'], style: 'image' },
  // ---- the exam's own mix ----
  { id: 'mx-neet-ppi', topic: 'adverse effects of proton pump inhibitors', exam: 'NEET_PG', count: 10, style: 'mix' },
  { id: 'mx-neet-cardiac', topic: 'cardiac cycle', exam: 'NEET_PG', count: 10, style: 'mix' },
  { id: 'mx-neet-anat', topic: 'cranial nerves', exam: 'NEET_PG', count: 10, style: 'mix' },
  { id: 'mx-neet-forensic', topic: 'postmortem changes and time since death', exam: 'NEET_PG', count: 10, style: 'mix' },
  { id: 'mx-ini-neph', topic: 'nephrotic syndrome', exam: 'INI_CET', count: 10, style: 'mix' },
  { id: 'mx-ini-urea', topic: 'urea cycle and its disorders', exam: 'INI_CET', count: 10, style: 'mix' },
  { id: 'mx-ini-obg', topic: 'pre-eclampsia', exam: 'INI_CET', count: 10, style: 'mix' },
  { id: 'mx-ini-lung', topic: 'lung chapter', exam: 'INI_CET', count: 10, style: 'mix' },
  { id: 'mx-amc-chest', topic: 'chest pain in general practice', exam: 'AMC_CAT', count: 10, style: 'mix' },
  { id: 'mx-amc-asthma', topic: 'asthma in adults', exam: 'AMC_CAT', count: 10, style: 'mix' },
  { id: 'mx-amc-depr', topic: 'depression in general practice', exam: 'AMC_CAT', count: 10, style: 'mix' },
  { id: 'mx-amc-dm', topic: 'type 2 diabetes management', exam: 'AMC_CAT', count: 10, style: 'mix' },
  // ---- topic shapes ----
  { id: 'tp-drug', topic: 'anticoagulants', exam: 'NEET_PG', count: 8, style: 'mix' },
  { id: 'tp-medicine', topic: 'thyroid disorders', exam: 'NEET_PG', count: 8, style: 'mix' },
  { id: 'tp-physio', topic: 'renal physiology', exam: 'NEET_PG', count: 8, style: 'mix' },
  { id: 'tp-biochem', topic: 'glycogen storage diseases', exam: 'NEET_PG', count: 8, style: 'mix' },
  { id: 'tp-path', topic: 'tumour markers', exam: 'NEET_PG', count: 8, style: 'mix' },
  { id: 'tp-micro', topic: 'hepatitis viruses', exam: 'INI_CET', count: 8, style: 'mix' },
  { id: 'tp-ortho', topic: 'fractures of the upper limb', exam: 'NEET_PG', count: 8, style: 'mix' },
  { id: 'tp-obg', topic: 'antenatal care', exam: 'NEET_PG', count: 8, style: 'mix' },
  { id: 'tp-psm', topic: 'epidemiological study designs', exam: 'NEET_PG', count: 8, style: 'mix' },
  { id: 'tp-forensic', topic: 'common poisonings', exam: 'NEET_PG', count: 8, style: 'mix' },
  { id: 'tp-chapter', topic: 'cardiovascular system chapter', exam: 'INI_CET', count: 8, style: 'mix' },
  { id: 'tp-few', topic: 'Kayser-Fleischer ring', exam: 'NEET_PG', count: 8, style: 'mix' },
  { id: 'tp-wall-40', topic: 'drugs acting on bacterial cell wall', exam: 'NEET_PG', count: 40, style: 'mix' },
];
