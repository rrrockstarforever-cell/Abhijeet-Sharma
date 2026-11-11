// Corrects spelling of medical terms in speech transcripts. Whisper often misspells drug names
// ("Vorico-Nazel" for voriconazole, "oxycholate" for deoxycholate). A transcribed word is replaced
// only when it is a close spelling of a known term, so ordinary English is left alone.

const TERMS = [
  // Antifungals and antivirals
  'voriconazole', 'posaconazole', 'isavuconazole', 'fluconazole', 'itraconazole', 'amphotericin',
  'deoxycholate', 'flucytosine', 'caspofungin', 'micafungin', 'anidulafungin', 'acyclovir', 'valaciclovir',
  'ganciclovir', 'oseltamivir', 'tenofovir', 'lamivudine', 'emtricitabine', 'efavirenz', 'dolutegravir',
  'bictegravir', 'raltegravir', 'abacavir', 'zidovudine', 'darunavir', 'lopinavir', 'ritonavir',
  // Transplant and immunosuppressants
  'tacrolimus', 'cyclosporine', 'sirolimus', 'mycophenolate', 'azathioprine', 'everolimus',
  // Tuberculosis
  'rifampicin', 'rifabutin', 'isoniazid', 'pyrazinamide', 'ethambutol', 'bedaquiline',
  // Diabetes and cardiovascular
  'metformin', 'sitagliptin', 'dapagliflozin', 'empagliflozin', 'linagliptin', 'pioglitazone',
  'warfarin', 'enoxaparin', 'rivaroxaban', 'apixaban', 'dabigatran', 'clopidogrel', 'atorvastatin',
  'rosuvastatin', 'amlodipine', 'losartan', 'ramipril', 'furosemide', 'spironolactone', 'digoxin',
  'amiodarone', 'levothyroxine', 'carbimazole', 'nifedipine', 'labetalol', 'methyldopa',
  // Oncology
  'cyclophosphamide', 'cisplatin', 'carboplatin', 'oxaliplatin', 'pemetrexed', 'methotrexate',
  'leucovorin', 'bevacizumab', 'cetuximab', 'panitumumab', 'trastuzumab', 'pertuzumab', 'rituximab',
  'imatinib', 'erlotinib', 'osimertinib', 'tamoxifen', 'letrozole', 'anastrozole', 'mercaptopurine',
  'doxorubicin', 'vincristine', 'bleomycin', 'etoposide', 'docetaxel', 'paclitaxel',
  // Neurology, psychiatry, pain, anaesthesia
  'levetiracetam', 'valproate', 'phenytoin', 'carbamazepine', 'gabapentin', 'pregabalin', 'lithium',
  'sertraline', 'fluoxetine', 'amitriptyline', 'olanzapine', 'risperidone', 'haloperidol', 'morphine',
  'fentanyl', 'paracetamol', 'ibuprofen', 'diclofenac', 'naloxone', 'atropine', 'adrenaline',
  'noradrenaline', 'vasopressin', 'propofol', 'ketamine', 'midazolam', 'bupivacaine', 'lignocaine',
  'sevoflurane', 'isoflurane', 'succinylcholine', 'rocuronium', 'neostigmine', 'pyridostigmine',
  // GI, endocrine, others
  'pantoprazole', 'omeprazole', 'vonoprazan', 'metoclopramide', 'ondansetron', 'rifaximin',
  'lactulose', 'dexamethasone', 'hydrocortisone', 'prednisolone', 'hydroxychloroquine', 'colchicine',
  'allopurinol', 'febuxostat', 'tranexamic', 'oxytocin', 'misoprostol', 'methylergometrine',
  // Conditions and organisms
  'tuberculous', 'tuberculosis', 'meningitis', 'cryptococcal', 'aspergillosis', 'mucormycosis',
  'candidiasis', 'pneumocystis', 'toxoplasmosis', 'cytomegalovirus', 'pyelonephritis', 'pancreatitis',
  'cholangitis', 'endocarditis', 'pheochromocytoma', 'acromegaly', 'hyperparathyroidism',
  'thyrotoxicosis', 'carcinoma', 'lymphoma', 'leukaemia', 'sarcoma', 'glioblastoma', 'mesothelioma',
  'thrombocytopenia', 'agranulocytosis', 'rhabdomyolysis', 'hyperkalaemia', 'hyponatraemia',
  'sarcoidosis', 'amyloidosis', 'haemochromatosis', 'myasthenia', 'Guillain', 'Parkinson',
  'Creutzfeldt', 'Hirschsprung', 'Wilms', 'neuroblastoma', 'retinoblastoma', 'histoplasmosis',
  'leishmaniasis', 'schistosomiasis', 'filariasis', 'plasmodium', 'falciparum', 'leptospirosis',
  'rickettsia', 'HAART', 'cholestyramine', 'nitrous',
];

const WORDS = [...new Set(TERMS.flatMap((t) => t.toLowerCase().split(/\s+/)))].filter((w) => w.length >= 6);

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Misrecognitions seen in testing that the spelling match cannot reach. Add to this as they are found. */
const ALIASES: Record<string, string> = {
  amphitris: 'amphotericin',
};

/** Returns the known term a spoken word most likely meant, or null if nothing is close enough. */
function closestTerm(word: string): string | null {
  const lower = word.toLowerCase();
  if (ALIASES[lower]) return ALIASES[lower];
  // Longer words tolerate more error; short words must be close to avoid false matches.
  const allowed = lower.length >= 10 ? 2 : lower.length >= 6 ? 1 : 0;
  if (allowed === 0) return null;
  let best: { term: string; d: number } | null = null;
  for (const term of WORDS) {
    if (Math.abs(term.length - lower.length) > allowed) continue;
    const d = levenshtein(lower, term);
    if (d <= allowed && (!best || d < best.d)) best = { term, d };
  }
  return best && best.d > 0 ? best.term : null;
}

/** Corrects medical terms in a transcript. Hyphenated words are also tried with the hyphen removed. */
export function correctMedicalTerms(text: string): string {
  // Keep the capital letter the speaker's word had ("Tacrolimus", "Guillain").
  const withCase = (original: string, term: string) =>
    original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()
      ? term[0].toUpperCase() + term.slice(1)
      : term;
  return text.replace(/[A-Za-z][A-Za-z-]*[A-Za-z]/g, (token) => {
    const direct = closestTerm(token);
    if (direct) return withCase(token, direct);
    if (token.includes('-')) {
      const joined = closestTerm(token.replace(/-/g, ''));
      if (joined) return withCase(token, joined);
    }
    return token;
  });
}
