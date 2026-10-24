import { 
  ClinicalQuestion, 
  MedicalTopic, 
  SavedHighlight, 
  AIProvider, 
  PDFDocument 
} from '../types.ts';

// ==========================================
// 1. AUTHENTIC SYLLABI DEFINITIONS
// ==========================================

export const NEET_PG_SUBJECTS = [
  // Pre-Clinical
  { id: 'ANAT', name: 'Anatomy', phase: 'Pre-Clinical', weightage: '17 Qs', highYield: true },
  { id: 'PHYS', name: 'Physiology', phase: 'Pre-Clinical', weightage: '17 Qs', highYield: true },
  { id: 'BIO', name: 'Biochemistry', phase: 'Pre-Clinical', weightage: '16 Qs', highYield: true },
  
  // Para-Clinical
  { id: 'PATH', name: 'Pathology', phase: 'Para-Clinical', weightage: '25 Qs', highYield: true },
  { id: 'PHARM', name: 'Pharmacology', phase: 'Para-Clinical', weightage: '20 Qs', highYield: true },
  { id: 'MICRO', name: 'Microbiology', phase: 'Para-Clinical', weightage: '20 Qs', highYield: true },
  { id: 'FMT', name: 'Forensic Medicine & Toxicology', phase: 'Para-Clinical', weightage: '10 Qs', highYield: false },
  { id: 'PSM', name: 'Preventive & Social Medicine (PSM)', phase: 'Para-Clinical', weightage: '25 Qs', highYield: true },
  
  // Clinical
  { id: 'MED', name: 'General Medicine', phase: 'Clinical', weightage: '35 Qs', highYield: true },
  { id: 'SURG', name: 'General Surgery', phase: 'Clinical', weightage: '30 Qs', highYield: true },
  { id: 'OBG', name: 'Obstetrics & Gynaecology', phase: 'Clinical', weightage: '30 Qs', highYield: true },
  { id: 'PED', name: 'Pediatrics', phase: 'Clinical', weightage: '10 Qs', highYield: true },
  { id: 'ORTHO', name: 'Orthopedics', phase: 'Clinical', weightage: '10 Qs', highYield: false },
  { id: 'ENT', name: 'Oto-Rhino-Laryngology (ENT)', phase: 'Clinical', weightage: '10 Qs', highYield: false },
  { id: 'OPHTH', name: 'Ophthalmology', phase: 'Clinical', weightage: '10 Qs', highYield: false },
  { id: 'DERM', name: 'Dermatology & Venereology', phase: 'Clinical', weightage: '6 Qs', highYield: false },
  { id: 'PSYCH', name: 'Psychiatry', phase: 'Clinical', weightage: '6 Qs', highYield: false },
  { id: 'ANES', name: 'Anesthesiology', phase: 'Clinical', weightage: '6 Qs', highYield: false },
  { id: 'RADIO', name: 'Radiodiagnosis & Radiotherapy', phase: 'Clinical', weightage: '7 Qs', highYield: true },
];

export const INI_CET_DOMAINS_6 = [
  {
    id: 'AIIMS_BASIC',
    name: 'Applied Basic Sciences & Molecular Genetics',
    desc: 'Molecular pathology, genomic variants, autonomic/receptor pharmacology, neuroanatomy.',
    weightage: '22%',
    highYieldFocus: 'Transposons, CRISPR, Enzymopathies, Microscopic IBQs'
  },
  {
    id: 'AIIMS_MED',
    name: 'Systemic Therapeutics & Critical Care Medicine',
    desc: 'Internal medicine, cardiology, pulmonology, emergency resuscitation protocols, ICU sepsis.',
    weightage: '26%',
    highYieldFocus: 'Hemodynamic titration, Arrhythmia algorithms, Endocrine crises'
  },
  {
    id: 'AIIMS_SURG',
    name: 'Surgical Specialties, Trauma & Operative Anatomy',
    desc: 'General surgery, polytrauma triage, vascular reconstruction, oncology staging.',
    weightage: '20%',
    highYieldFocus: 'ATLS guidelines, TNM staging, surgical margins'
  },
  {
    id: 'AIIMS_MCH',
    name: 'Maternal, Fetal & Child Health',
    desc: 'Obstetrics emergencies, congenital inborn errors, neonatal intensive care protocols.',
    weightage: '15%',
    highYieldFocus: 'Neonatal sepsis, Eclampsia, PPH protocol, Genetic dysmorphism'
  },
  {
    id: 'AIIMS_DIAG',
    name: 'Diagnostic Sciences & Interventional Radiology',
    desc: 'Immunofluorescence, special histological stains, CT/MRI sign identification, flow cytometry.',
    weightage: '10%',
    highYieldFocus: 'Jones Methenamine Silver, Apple-green birefringence, CT Signs'
  },
  {
    id: 'AIIMS_ETHICS',
    name: 'Medical Ethics, Forensic Jurisprudence & Biostatistics',
    desc: 'Consent laws, clinical trial phase statistics, patient confidentiality protocols.',
    weightage: '7%',
    highYieldFocus: 'Declaration of Helsinki, Sensitivity/Specificity, Bias & Confounding'
  }
];

export const AMC_CAT_DOMAINS_6 = [
  {
    id: 'AMC_MED',
    name: 'Adult Health – Medicine',
    officialWeight: '30%',
    questionRatio: '45 of 150 Qs',
    desc: 'Acute medical emergencies, chronic disease management, pharmacotherapy (eTG guidelines).',
    highYield: true
  },
  {
    id: 'AMC_SURG',
    name: 'Adult Health – Surgery',
    officialWeight: '20%',
    questionRatio: '30 of 150 Qs',
    desc: 'Acute abdomen, surgical trauma, post-operative complications, surgical oncology.',
    highYield: true
  },
  {
    id: 'AMC_WOMEN',
    name: "Women's Health (Obstetrics & Gynaecology)",
    officialWeight: '12.5%',
    questionRatio: '19 of 150 Qs',
    desc: 'Antenatal screening, obstetric emergencies, contraception, abnormal uterine bleeding.',
    highYield: true
  },
  {
    id: 'AMC_CHILD',
    name: 'Child Health (Paediatrics)',
    officialWeight: '12.5%',
    questionRatio: '19 of 150 Qs',
    desc: 'Developmental milestones, neonatal sepsis, pediatric immunization (Australian schedule), acute stridor.',
    highYield: true
  },
  {
    id: 'AMC_PSYCH',
    name: 'Mental Health (Psychiatry)',
    officialWeight: '12.5%',
    questionRatio: '19 of 150 Qs',
    desc: 'Major depression, psychosis, acute mania, deliberate self-harm triage, Mental Health Act.',
    highYield: true
  },
  {
    id: 'AMC_POP',
    name: 'Population Health, General Practice & Ethics',
    officialWeight: '12.5%',
    questionRatio: '19 of 150 Qs',
    desc: 'RACGP preventive health, infectious disease notification, Australian legal consent & Aboriginal health.',
    highYield: true
  }
];

// ==========================================
// 2. CLINICAL QUESTIONS BANK WITH DIFFICULTY
// ==========================================

export const INITIAL_QUESTIONS: ClinicalQuestion[] = [
  {
    id: 'Q10',
    moduleCode: 'INI-CET / AIIMS HIGH-YIELD #MCQ-8842',
    examType: 'INI_CET',
    subject: 'PHARMACOLOGY',
    subtopic: 'Antimicrobials: Glycopeptides & Beta-Lactams',
    cognitiveTier: 'Multi-Step & IBQ',
    difficultyTier: 'HIGH',
    difficultySubLevel: 'H2',
    questionText: 'Regarding glycopeptide resistance mechanisms in Enterococci, which of the following statements is/are correct?',
    stem: 'VRE & Resistance Genetics: A 54-year-old critically ill ICU patient with central line-associated bacteremia is found to have vancomycin-resistant Enterococcus faecium. Genomic profiling reveals the VanA operon.',
    statements: [
      {
        num: 1,
        text: 'The VanA phenotype confers high-level resistance to both vancomycin and teicoplanin.',
        isCorrect: true,
        statusBadge: 'VANA',
        explanation: 'VanA phenotype yields substitution of the terminal D-Ala-D-Ala cell wall peptidoglycan target with D-Ala-D-Lac, reducing vancomycin binding affinity ~1,000-fold. It confers inducible, high-level resistance to both vancomycin (MIC ≥ 64 µg/mL) and teicoplanin (MIC ≥ 16 µg/mL).',
      },
      {
        num: 2,
        text: 'The VanB phenotype confers vancomycin resistance while teicoplanin often remains active.',
        isCorrect: true,
        statusBadge: 'VANB',
        explanation: 'The VanB phenotype is inducible strictly by vancomycin, not teicoplanin. Hence, teicoplanin susceptibility is clinically retained in vitro, although breakout mutations can emerge during monotherapy.',
      },
      {
        num: 3,
        text: 'The VanC phenotype is intrinsic to Enterococcus gallinarum and Enterococcus casseliflavus and gives low-level vancomycin resistance.',
        isCorrect: true,
        statusBadge: 'VANC (INTRINSIC)',
        explanation: 'VanC is intrinsic, chromosomal, non-transferable resistance seen specifically in motile enterococci (E. gallinarum, E. casseliflavus). It utilizes a D-Ala-D-Ser ligase causing low-level resistance (MIC 2–32 µg/mL). Teicoplanin remains universally susceptible.',
      },
      {
        num: 4,
        text: 'The VanA gene cluster is chromosomally encoded in Enterococcus faecium.',
        isCorrect: false,
        statusBadge: 'TRAP POINT',
        explanation: 'The VanA resistance determinant is carried on the Tn1546 transposon located primarily on conjugative plasmids (readily transferable to Staphylococcus aureus creating VRSA), not inherently chromosomal.',
      },
    ],
    options: [
      { id: 'A', text: '1 and 2 only' },
      { id: 'B', text: '1, 2 and 3 only' },
      { id: 'C', text: '2, 3 and 4 only' },
      { id: 'D', text: '3 and 4 only' },
    ],
    correctOption: 'B',
    selectedOption: 'B',
    trapType: 'TRANSPOSON VS CHROMOSOME TRANSLOCATION PITFALL',
    trapExplanation: 'You committed a classical Board Distractor error. VanB is chromosome- or plasmid-borne and confers resistance to Vancomycin but remains susceptible to Teicoplanin. VanA confers resistance to both via substitution of D-Ala-D-Ala with D-Ala-D-Lac.',
    boardPearl: 'Drug of Choice for VanA VRE bacteremia: Linezolid (Oxazolidinone: 50S subunit inhibitor) or Daptomycin (cyclic lipopeptide for bactericidal clearance, contraindicated in pneumonia due to pulmonary surfactant inactivation).',
    citations: [
      "Harrison's Principles of Internal Medicine 21st Ed. · Ch. 142 (Enterococcal Infections, pp. 1120-1124)",
      'Robbins & Cotran Pathologic Basis of Disease 10th Ed. · p. 344',
    ],
    targetAccuracy: 68,
    nationalPercentile: 82,
  },
  {
    id: 'Q-PA-1049',
    moduleCode: 'NEET-PG Histopathology Stem #PA-1049',
    examType: 'NEET_PG',
    subject: 'PATHOLOGY',
    subtopic: 'Renal System · Histopathology Stem',
    cognitiveTier: 'Multi-Step & IBQ',
    difficultyTier: 'HIGH',
    difficultySubLevel: 'H1',
    questionText: 'A 42-year-old male presents with hemoptysis, recurrent sinusitis, acute oliguria, and serum creatinine 4.8 mg/dL. Renal core biopsy stained with Silver Methenamine reveals cellular crescent formation compressing the glomerular capillary tuft in >65% of glomeruli. Immunofluorescence shows faint, non-specific immunoglobulin deposition. Which diagnostic marker and classification is most accurate?',
    stem: 'Pauci-Immune Crescentic Glomerulonephritis (Granulomatosis with Polyangiitis)',
    image: '/assets/aistudio/Image_9_fc76a8d4.jpeg',
    imageCaption: 'H&E / Silver Methenamine Stain: Glomerular Crescent',
    options: [
      { id: 'A', text: 'Goodpasture Syndrome: Linear IgG along basement membrane' },
      { id: 'B', text: 'Anti-GBM Disease with granular subepithelial immune complex humps' },
      { id: 'C', text: 'GPA / c-ANCA (PR3) Pauci-Immune RPGN Type III' },
      { id: 'D', text: 'Lupus Nephritis Class IV: Full house immunofluorescence' },
    ],
    correctOption: 'C',
    selectedOption: 'A',
    trapType: 'IMAGE DISTRACTOR AMBIGUITY • IF PATTERN OVERLOOK',
    trapExplanation: 'You latched onto hemoptysis + renal failure and jumped to Anti-GBM (Goodpasture). However, the stem specified "faint, non-specific immunoglobulin deposition" (Pauci-Immune). Goodpasture requires smooth linear IgG deposition.',
    boardPearl: 'Pauci-immune RPGN Type III is characterized by c-ANCA (PR3) antibodies directed against proteinase-3 neutrophils. The silver stain demarcates ruptured Bowman capsule basement membranes with exuberant parietal cell proliferation.',
    citations: [
      'Robbins 10th Ed · Glomerular Diseases (p. 912)',
      "Harrison's 21st Ed · Vasculitis & Nephritic Syndromes (p. 2310)",
    ],
    targetAccuracy: 52,
    isFlagged: true,
    timesFailed: 1,
  },
  {
    id: 'Q-AMC-501',
    moduleCode: 'AMC CAT Examination · Core Clinical Block #501',
    examType: 'AMC_CAT',
    subject: 'Adult Health – Medicine',
    subtopic: 'Cardiology & Emergency Pharmacology (eTG)',
    cognitiveTier: 'Clinical 2-Step',
    difficultyTier: 'MEDIUM',
    difficultySubLevel: 'M1',
    questionText: 'A 64-year-old male presents to the Emergency Department in Sydney with acute central chest pain, diaphoresis, and ST-elevation in leads II, III, and aVF. Blood pressure is 84/50 mmHg with heart rate 54 bpm. Jugular venous pulse is elevated to 6 cm above sternal angle, but lung fields are clear to auscultation bilaterally. Which initial pharmacological management is contraindicated?',
    stem: 'Right Ventricular Infarction with Hypotension & Clear Lung Bases',
    options: [
      { id: 'A', text: 'Intravenous normal saline 500 mL fluid challenge' },
      { id: 'B', text: 'Sublingual glyceryl trinitrate (GTN) 400 mcg spray' },
      { id: 'C', text: 'Oral Aspirin 300 mg chewable' },
      { id: 'D', text: 'Immediate activation of cardiac catheterization laboratory for primary PCI' },
      { id: 'E', text: 'Supplemental oxygen titrated only if oxygen saturation drops below 92%' },
    ],
    correctOption: 'B',
    trapType: 'PRELOAD REDUCTION COLLAPSE IN RV INFARCTION',
    trapExplanation: 'Right ventricular infarctions are strictly preload-dependent. Administering vasodilators (GTN / Nitrates or Morphine) causes acute venodilation, plunging right ventricular filling pressures and precipitating catastrophic refractory cardiogenic shock.',
    boardPearl: 'Triad of RV Infarction: Hypotension, Raised JVP, and Clear Lungs in the presence of inferior STEMI. Mandatory initial therapy: Aggressive IV normal saline loading to maintain RV preload. Inotropes (Dobutamine) if fluid fails.',
    citations: [
      'Australian Therapeutic Guidelines (eTG) · Cardiovascular: STEMI 2024',
      "Harrison's Internal Medicine 21st Ed. · Acute Myocardial Infarction",
    ],
    targetAccuracy: 64,
  },
  {
    id: 'Q-AMC-502',
    moduleCode: 'AMC CAT Examination · Paediatric Sepsis #502',
    examType: 'AMC_CAT',
    subject: 'Child Health (Paediatrics)',
    subtopic: 'Neonatal Antimicrobial Protocols',
    cognitiveTier: 'Direct Recall',
    difficultyTier: 'LOW',
    difficultySubLevel: 'L1',
    questionText: 'A 10-day-old neonate with jaundice is admitted to a regional hospital in Queensland with temperature 38.6°C, poor feeding, and lethargy. Full blood examination shows elevated white cell count and CRP 42 mg/L. According to Australian Therapeutic Guidelines (eTG), which empirical intravenous regimen is recommended?',
    stem: 'Empirical Regimen for Early/Late-Onset Neonatal Sepsis (<28 Days)',
    options: [
      { id: 'A', text: 'Intravenous Ampicillin plus Gentamicin' },
      { id: 'B', text: 'Intravenous Ceftriaxone monotherapy' },
      { id: 'C', text: 'Intravenous Vancomycin plus Meropenem' },
      { id: 'D', text: 'Oral Amoxicillin-Clavulanate' },
      { id: 'E', text: 'Intravenous Ciprofloxacin plus Metronidazole' },
    ],
    correctOption: 'A',
    trapType: 'CEFTRIAXONE BINDING DISPLACEMENT KERNICTERUS',
    trapExplanation: 'Ceftriaxone is explicitly contraindicated in jaundiced neonates <28 days due to displacement of bilirubin from albumin binding sites (Kernicterus) and calcium salt precipitation. Ampicillin + Gentamicin or Ampicillin + Cefotaxime is the standard protocol.',
    boardPearl: 'Ampicillin covers Listeria monocytogenes and Group B Streptococcus (S. agalactiae). Gentamicin provides synergistic bactericidal coverage for Gram-negative enteric bacilli (E. coli).',
    citations: [
      'Australian Therapeutic Guidelines (eTG) · Paediatric Sepsis Guidelines 2024',
      'Royal Children’s Hospital Melbourne Clinical Guidelines',
    ],
    targetAccuracy: 78,
  },
  {
    id: 'Q-GM-4120',
    moduleCode: 'NEET-PG Cardiology & Endocrine Emergencies #GM-4120',
    examType: 'NEET_PG',
    subject: 'GENERAL MEDICINE',
    subtopic: 'Cardiology • Endocrine Emergencies',
    cognitiveTier: 'Clinical 2-Step',
    difficultyTier: 'MEDIUM',
    difficultySubLevel: 'M2',
    questionText: 'A 38-year-old woman with severe paroxysmal hypertension, palpitations, and elevated 24-hour urinary metanephrines is scheduled for adrenalectomy. Blood pressure is 198/112 mmHg with heart rate 124 bpm. Which pharmacological sequence is mandatory before operating?',
    stem: 'Sequencing of Adrenergic Blockade in Pheochromocytoma Resection',
    options: [
      { id: 'A', text: 'Initiate labetalol or carvedilol combined alpha/beta blockade simultaneously on day 1' },
      { id: 'B', text: 'Initiate Propranolol or Atenolol immediately to control severe reflex tachycardia, then titrate Phenoxybenzamine' },
      { id: 'C', text: 'Administer oral clonidine and verapamil for 7 days followed by beta-blockade' },
      { id: 'D', text: 'Alpha-blockade FIRST with Phenoxybenzamine for 10-14 days; Beta-blockers added ONLY after effective alpha blockade is established' },
    ],
    correctOption: 'D',
    selectedOption: 'B',
    trapType: 'UNOPPOSED ALPHA-1 VASOCONSTRICTION LETHAL CONTRAINDICATION',
    trapExplanation: 'Classic board lethal error: Beta-blockade before alpha-blockade eliminates beta-2 mediated vasodilation in skeletal muscle vascular beds, leaving pure, unopposed alpha-1 stimulation. This precipitates fatal hypertensive crises and acute pulmonary edema.',
    boardPearl: 'Rule of tens for Pheochromocytoma: 10% bilateral, 10% extra-adrenal (paraganglioma), 10% malignant, 10% familial (MEN 2A/2B, VHL, NF1). Always alpha-block first!',
    citations: [
      "Harrison's Internal Medicine 21st Ed. · Ch. 379 (Adrenal Medulla)",
      'Goodman & Gilman Pharmacology 14th Ed. · Adrenergic Antagonists',
    ],
    targetAccuracy: 61,
    isFlagged: true,
    timesFailed: 3,
  },
];

// ==========================================
// 3. AI PROVIDERS & SUBSCRIPTION STATUS
// ==========================================

export const AI_PROVIDERS: AIProvider[] = [
  {
    id: 'gemini',
    name: 'Gemini (Google AI & Advanced)',
    brand: 'google',
    model: 'gemini-3.8-flash',
    status: 'active',
    latencyMs: 110,
    type: 'Google Workspace / AI Studio Auth',
    features: ['Active Server SDK', '1M-2M Context Window', 'Verified Citations'],
    isDefault: true,
    isSignedIn: true,
    userEmail: 'dr.arya.sharma@hospital.org',
    subscriptionPlan: 'Google One AI Premium (2TB)',
    hasTokenConfigured: true,
    availableModels: [
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', badge: 'Active Default', description: 'Sub-second clinical RAG & low-latency MCQ generation', latencyEstimate: '110ms', contextWindow: '1M tokens' },
      { id: 'gemini-3.8-pro', name: 'Gemini 3.8 Pro', badge: 'Deep Reasoning', description: 'Multi-modal diagnostic reasoning & complex differential', latencyEstimate: '280ms', contextWindow: '2M tokens' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', badge: 'Next-Gen Speed', description: 'Real-time multi-assertion clinical evaluation', latencyEstimate: '95ms', contextWindow: '1M tokens' },
      { id: 'gemini-2.0-flash-thinking', name: 'Gemini 2.0 Flash Thinking', badge: 'Chain-of-Thought', description: 'Explicit pathophysiologic step-by-step thinking', latencyEstimate: '320ms', contextWindow: '1M tokens' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', badge: '2M Long-RAG', description: 'Ingest and cross-analyze entire medical textbooks in one prompt', latencyEstimate: '450ms', contextWindow: '2M tokens' },
    ]
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT (OpenAI Subscription)',
    brand: 'openai',
    model: 'gpt-4o-2024-08-06',
    status: 'connected',
    latencyMs: 290,
    type: 'OpenAI Plus / Team Account',
    features: ['Multi-Step Reasoning', 'Vision Stains', 'STEM Benchmark Apex'],
    isDefault: false,
    isSignedIn: true,
    userEmail: 'dr.arya.sharma@hospital.org',
    subscriptionPlan: 'ChatGPT Plus ($20/mo)',
    hasTokenConfigured: true,
    availableModels: [
      { id: 'gpt-4o-2024-08-06', name: 'GPT-4o (Omni Multimodal Flagship)', badge: 'Default', description: 'High-speed diagnostic analysis & image-based question parsing', latencyEstimate: '290ms', contextWindow: '128k tokens' },
      { id: 'o1', name: 'OpenAI o1 (Full Reasoning Engine)', badge: 'Deep Thinker', description: 'Spends thinking time to eliminate subtle board distractor traps', latencyEstimate: '850ms', contextWindow: '128k tokens' },
      { id: 'o1-mini', name: 'OpenAI o1-mini (Fast Logic & Math)', badge: 'Pharmacology', description: 'High-speed acid-base, fluid balance & receptor kinetics', latencyEstimate: '340ms', contextWindow: '128k tokens' },
      { id: 'o3-mini', name: 'OpenAI o3-mini (High-Yield Medical STEM)', badge: 'Latest', description: 'State-of-the-art medical reasoning benchmark performance', latencyEstimate: '260ms', contextWindow: '200k tokens' },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', badge: 'High-Speed', description: 'Lightweight rapid MCQ generation and memory flashcards', latencyEstimate: '140ms', contextWindow: '128k tokens' },
    ]
  },
  {
    id: 'claude',
    name: 'Claude (Anthropic Subscription)',
    brand: 'anthropic',
    model: 'claude-3-7-sonnet',
    status: 'connected',
    latencyMs: 240,
    type: 'Anthropic Pro Web Subscription',
    features: ['Topper Diagnostic Reasoning', 'Thinking Budgets', 'Extended Differential'],
    isDefault: false,
    isSignedIn: true,
    userEmail: 'dr.arya.sharma@hospital.org',
    subscriptionPlan: 'Claude Pro Subscription',
    hasTokenConfigured: true,
    availableModels: [
      { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet (Thinking Engine)', badge: 'Latest Flagship', description: 'Hybrid instant response and extended clinical diagnostic thinking', latencyEstimate: '310ms', contextWindow: '200k tokens' },
      { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', badge: 'Resident Choice', description: 'Exceptional clinical nuance and medical board question parsing', latencyEstimate: '240ms', contextWindow: '200k tokens' },
      { id: 'claude-3-5-haiku', name: 'Claude 3.5 Haiku', badge: 'Ultra-Fast', description: 'Instant factual retrieval and buzzword verification', latencyEstimate: '110ms', contextWindow: '200k tokens' },
      { id: 'claude-3-opus', name: 'Claude 3 Opus', badge: 'Comprehensive', description: 'Deep synthesis across multi-organ complex medical monographs', latencyEstimate: '620ms', contextWindow: '200k tokens' },
    ]
  },
  {
    id: 'grok',
    name: 'Grok (xAI SuperGrok)',
    brand: 'xai',
    model: 'grok-3',
    status: 'ready',
    latencyMs: 195,
    type: 'xAI SuperGrok Subscription',
    features: ['Real-time Web Grounding', 'Uncensored Clinical Stems', 'PubMed Live Access'],
    isDefault: false,
    isSignedIn: false,
    userEmail: undefined,
    subscriptionPlan: undefined,
    hasTokenConfigured: false,
    availableModels: [
      { id: 'grok-3', name: 'Grok 3 (xAI Next-Gen Reasoner)', badge: 'Flagship', description: 'Frontier reasoning with deep mathematical and biochemical accuracy', latencyEstimate: '220ms', contextWindow: '128k tokens' },
      { id: 'grok-3-mini', name: 'Grok 3 Mini', badge: 'Fast Logic', description: 'Rapid clinical triage and fast question resolution', latencyEstimate: '130ms', contextWindow: '128k tokens' },
      { id: 'grok-2', name: 'Grok 2 (PubMed & Web Grounded)', badge: 'Live Literature', description: 'Queries live medical papers and current outbreak guidelines', latencyEstimate: '195ms', contextWindow: '128k tokens' },
      { id: 'grok-2-vision', name: 'Grok 2 Vision', badge: 'IBQ Specialist', description: 'Analyzes radiographic signs and microscopic pathology plates', latencyEstimate: '270ms', contextWindow: '128k tokens' },
    ]
  },
  {
    id: 'deepseek',
    name: 'DeepSeek (R1 & V3)',
    brand: 'deepseek',
    model: 'deepseek-r1',
    status: 'ready',
    latencyMs: 280,
    type: 'DeepSeek Platform Auth',
    features: ['Open-weight Medical Math', 'Pure Chain-of-Thought', 'Low Cost'],
    isDefault: false,
    isSignedIn: false,
    hasTokenConfigured: false,
    availableModels: [
      { id: 'deepseek-r1', name: 'DeepSeek R1 (Pure Reasoning CoT)', badge: 'CoT Reasoning', description: 'Outputs complete step-by-step diagnostic proof trace', latencyEstimate: '380ms', contextWindow: '64k tokens' },
      { id: 'deepseek-v3', name: 'DeepSeek V3 (671B MoE General)', badge: 'High-Throughput', description: 'Broad general clinical knowledge base', latencyEstimate: '180ms', contextWindow: '64k tokens' },
    ]
  },
  {
    id: 'ollama',
    name: 'Ollama Local Sandbox (127.0.0.1:11434)',
    brand: 'ollama',
    model: 'meditron-70b',
    status: 'offline_ready',
    latencyMs: 18,
    type: 'Localhost GGUF Offline Service',
    features: ['100% HIPAA Private', 'Zero Cloud Egress', 'Offline Clinic Mode'],
    isDefault: false,
    isSignedIn: true,
    userEmail: 'local-daemon@127.0.0.1',
    subscriptionPlan: 'Local Hardware GPU Engine',
    hasTokenConfigured: true,
    availableModels: [
      { id: 'meditron-70b', name: 'Meditron 70B (Clinical Llama-2)', badge: 'Medical Specialist', description: 'Grounded on clinical guidelines & PubMed Central', latencyEstimate: '22ms', contextWindow: '8k tokens' },
      { id: 'llama-3.3-70b', name: 'Llama 3.3 70B Instruct', badge: 'Local Flagship', description: 'Highest accuracy open-weights local model', latencyEstimate: '35ms', contextWindow: '128k tokens' },
      { id: 'deepseek-r1-32b', name: 'DeepSeek R1 32B Distill', badge: 'Local Reasoning', description: 'Local chain-of-thought without internet connection', latencyEstimate: '18ms', contextWindow: '64k tokens' },
    ]
  },
];

// ==========================================
// 4. RICH PDF DOCUMENTS FOR OCR & READER
// ==========================================

export const MOCK_PDF_DOCUMENTS: PDFDocument[] = [
  {
    id: 'PDF-HARRISON-21',
    title: "Harrison's Principles of Internal Medicine",
    author: 'Loscalzo, Fauci, Kasper, Hauser, Longo, Jameson',
    edition: '21st Edition · McGraw Hill',
    discipline: 'Internal Medicine',
    totalPages: 1240,
    ocrConfidence: 99.4,
    highYieldSnippets: 418,
    chapters: [
      { id: 'C142', title: 'Chapter 142: Enterococcal Infections & Glycopeptide Resistance', pageNumber: 1120, level: 1, pearlCount: 14, isHighYield: true },
      { id: 'C142-1', title: '142.1 Genetics of VanA, VanB, and VanC Operons', pageNumber: 1122, level: 2, pearlCount: 8, isHighYield: true },
      { id: 'C379', title: 'Chapter 379: Disorders of the Adrenal Medulla & Pheochromocytoma', pageNumber: 2840, level: 1, pearlCount: 22, isHighYield: true },
      { id: 'C312', title: 'Chapter 312: Glomerular Diseases & Rapidly Progressive Glomerulonephritis', pageNumber: 2310, level: 1, pearlCount: 18, isHighYield: true },
    ],
    pagesContent: [
      {
        pageNumber: 1120,
        title: 'Chapter 142: Enterococcal Infections & Glycopeptide Resistance (p. 1120)',
        text: `Enterococcus faecalis and Enterococcus faecium are responsible for 10-15% of nosocomial endocarditis and line-associated bacteremias. While intrinsic resistance to cephalosporins, low-level aminoglycosides, and clindamycin is standard across enterococci, acquired glycopeptide resistance (Vancomycin-Resistant Enterococci, VRE) represents a significant board-tested barrier to therapeutic eradication.

The VanA phenotype is the most clinically prevalent variant worldwide. Carried on the transposon Tn1546 (typically localized on conjugative plasmids), VanA synthesizes modified peptidoglycan precursors terminating in D-alanyl-D-lactate (D-Ala-D-Lac) rather than the normal D-alanyl-D-alanine (D-Ala-D-Ala). This modification eliminates the critical hydrogen bond required for glycopeptide binding, resulting in a >1,000-fold reduction in vancomycin binding affinity.

VanA confers high-level inducible resistance to both vancomycin (MIC >= 64 mcg/mL) and teicoplanin (MIC >= 16 mcg/mL). By contrast, the VanB operon (inducible strictly by vancomycin) retains in vitro susceptibility to teicoplanin. However, emergence of promoter mutations during teicoplanin therapy frequently leads to clinical failure.`,
        pearls: [
          'VanA = Transposon Tn1546 on plasmid; resistant to both Vancomycin and Teicoplanin.',
          'VanB = Inducible strictly by Vancomycin; Teicoplanin susceptible in vitro.',
          'VanC = Intrinsic chromosomal resistance in E. gallinarum and E. casseliflavus; D-Ala-D-Ser; low level.',
        ]
      },
      {
        pageNumber: 1122,
        title: 'Section 142.1: Genetics of VanA, VanB, and VanC Operons (p. 1122)',
        text: `Genomic regulation of the VanA cluster involves a two-component regulatory system consisting of the membrane-bound sensor kinase VanS and the transcriptional response regulator VanR. Upon exposure to extracellular glycopeptides, VanS autophosphorylates and transfers a high-energy phosphate group to VanR, which subsequently activates transcription of the structural genes: vanH (dehydrogenase synthesizing D-lactate), vanA (ligase linking D-alanine to D-lactate), and vanX (dipeptidase hydrolyzing normal D-Ala-D-Ala).

Therapeutic management of VanA VRE bacteremia relies primarily on Linezolid (600 mg IV q12h) or high-dose Daptomycin (8-12 mg/kg/day). Daptomycin is contraindicated in VRE pneumonia due to inactivation by pulmonary surfactant. Quinupristin-dalfopristin is active against E. faecium but inactive against E. faecalis due to intrinsic efflux pump mechanisms.`,
        pearls: [
          'Linezolid: 50S ribosome inhibitor; monitor for myelosuppression and serotonin syndrome with SSRIs.',
          'Daptomycin: Cyclic lipopeptide; contraindicated in pneumonia due to surfactant binding.',
        ]
      },
      {
        pageNumber: 2840,
        title: 'Chapter 379: Pheochromocytoma & Paraganglioma (p. 2840)',
        text: `Pheochromocytomas are neuroendocrine catecholamine-secreting tumors of chromaffin tissue. Clinical presentation classically features the triad of headache, sweating, and paroxysmal palpitations associated with severe hypertension.

Preoperative medical preparation is mandatory to avoid intraoperative catastrophic hypertensive crises and postoperative refractory hypotension. Phenoxybenzamine (non-competitive, irreversible alpha-1 and alpha-2 adrenergic blocker) must be initiated 10-14 days prior to surgery, accompanied by high-salt intake to restore circulating intravascular volume.

CRITICAL BOARD RULE: Beta-blockers (e.g. Propranolol, Atenolol) should NEVER be started before effective alpha-blockade is established. Administering a beta-blocker first eliminates beta-2 mediated peripheral vasodilation, resulting in unopposed alpha-1 stimulation that precipitates acute pulmonary edema and lethal hypertensive crisis.`,
        pearls: [
          'Preoperative Rule: Alpha-blocker FIRST (Phenoxybenzamine), Beta-blocker SECOND.',
          'Rule of 10s: 10% bilateral, 10% extra-adrenal, 10% malignant, 10% familial (MEN 2A/2B, VHL).',
        ]
      }
    ]
  },
  {
    id: 'PDF-ROBBINS-10',
    title: 'Robbins & Cotran Pathologic Basis of Disease',
    author: 'Kumar, Abbas, Aster',
    edition: '10th Edition · Elsevier',
    discipline: 'Pathology',
    totalPages: 1392,
    ocrConfidence: 99.1,
    highYieldSnippets: 520,
    chapters: [
      { id: 'C14', title: 'Chapter 14: Diseases of Immunity & Vasculitis', pageNumber: 490, level: 1, pearlCount: 26, isHighYield: true },
      { id: 'C20', title: 'Chapter 20: The Kidney & Its Collecting System', pageNumber: 890, level: 1, pearlCount: 38, isHighYield: true },
      { id: 'C20-3', title: '20.3 Rapidly Progressive (Crescentic) Glomerulonephritis', pageNumber: 912, level: 2, pearlCount: 16, isHighYield: true },
    ],
    pagesContent: [
      {
        pageNumber: 912,
        title: 'Section 20.3: Rapidly Progressive Glomerulonephritis (p. 912)',
        text: `Rapidly progressive glomerulonephritis (RPGN) is a clinical syndrome characterized by rapid, progressive loss of renal function associated with severe oliguria and signs of nephritic syndrome. The histological hallmark is the presence of crescents in the majority of glomeruli (typically >50%).

Crescents are formed by the proliferation of parietal epithelial cells lining Bowman's capsule and by the migration of monocytes and macrophages into the urinary space. Fibrin strands leakage through ruptured capillary basement membranes triggers this exuberant cellular reaction. Over weeks, cellular crescents organize into fibrocellular and ultimately dense fibrous scars.

Jones Methenamine Silver (JMS) or Periodic Acid-Methenamine Silver (PAMS) is the stain of choice for evaluating crescentic RPGN because it stains the glomerular basement membrane deep black, clearly illustrating fragmentation and breaks in the capillary loop wall.

RPGN is classified into three immunological categories:
1. Type I (Anti-GBM Disease / Goodpasture): Linear deposition of IgG and C3 along basement membrane.
2. Type II (Immune Complex Mediated): Granular immune complex deposition (Lupus, Post-streptococcal, IgA nephropathy).
3. Type III (Pauci-Immune RPGN): Lack of significant anti-GBM or immune complexes (<1+ IF). Strongly associated with circulating Antineutrophil Cytoplasmic Antibodies (ANCA) – c-ANCA (PR3) in Granulomatosis with Polyangiitis and p-ANCA (MPO) in Microscopic Polyangiitis.`,
        pearls: [
          'Silver Methenamine stain: Delineates black capillary basement membrane rupture.',
          'Pauci-Immune RPGN = Faint or negative IF; c-ANCA (PR3) or p-ANCA (MPO).',
          'Goodpasture = Smooth linear IgG along capillary walls.',
        ]
      }
    ]
  }
];

export const SAVED_HIGHLIGHTS: SavedHighlight[] = [
  {
    id: 'H1',
    subject: 'Pharmacology',
    subtopic: 'Antimicrobials',
    yieldTier: 'NEET-PG Tier 1 Yield',
    sourceContext: 'Saved from AI Conversation (resident session #9042)',
    citation: 'Antimicrobials Simplified, p. 118',
    quote: '"VanA and VanB phenotypes mediate resistance via reprogramming of peptidoglycan synthesis from D-Ala-D-Ala to D-Ala-D-Lac, reducing vancomycin binding affinity by >1,000-fold in Enterococcus faecium."',
    visualizer: {
      title: 'Target Shift Affinity Falloff',
      note: 'Terminal ester oxygen modification eliminates key hydrogen bonding pocket required for glycopeptide stabilization.',
      susceptible: 'D-Ala-D-Ala: 5 H-Bonds',
      resistant: 'D-Ala-D-Lac: <1/1000 Binding Affinity',
    },
    memoryAnchor: "DR. SHARMA'S MEMORY ANCHOR: Must remember: VanA is transposon-mediated (Tn1546), inducible, confers dual resistance to both Vancomycin and Teicoplanin. High frequency INI-CET question!",
    tags: ['#VRE', '#Glycopeptides', '#Transposon'],
    srsIntervalDays: 3,
    lastReviewed: 'Today, 08:30 AM',
  },
  {
    id: 'H2',
    subject: 'General Medicine',
    subtopic: 'Cardiology & Endocrine',
    yieldTier: 'High Risk Exam Trap',
    sourceContext: 'Saved from Test Runner Exam Q10',
    citation: "Harrison's 21st Ed. Ch. 379 (Adrenal Medulla)",
    quote: '"In Pheochromocytoma resection, alpha-blockade (Phenoxybenzamine) must precede beta-blockade by at least 10–14 days to prevent catastrophic unopposed alpha-1 vasoconstriction and acute hypertensive crisis."',
    boardTrapAlert: 'Classic trap: Beta blocker first is a lethal error in exam stems. Beta-2 mediated peripheral vasodilation is blocked while massive circulating catecholamines relentlessly stimulate alpha-1, triggering lethal blood pressure spikes (>250 mmHg systolic) and acute pulmonary edema.',
    tags: ['#Endocrine', '#EmergencyManagement', '#BoardTrap'],
    srsIntervalDays: 1,
    lastReviewed: 'Yesterday',
  },
  {
    id: 'H3',
    subject: 'Adult Health – Medicine (AMC)',
    subtopic: 'Cardiology Emergency',
    yieldTier: 'AMC CAT High-Frequency',
    sourceContext: 'Saved from AMC Practice Module',
    citation: 'Australian Therapeutic Guidelines (eTG) · Cardiovascular: STEMI 2024',
    quote: '"In Right Ventricular Myocardial Infarction presenting with hypotension, raised JVP and clear lung fields, Nitrates and Morphine are contraindicated. Preload must be preserved with IV fluids."',
    memoryAnchor: 'AMC GUIDELINE PEARL: Never give GTN to inferior STEMI with elevated neck veins and low BP; load normal saline first!',
    tags: ['#RVInfarction', '#AMC', '#eTG'],
    srsIntervalDays: 7,
    lastReviewed: '3 days ago',
  }
];

export const MOCK_HIGHLIGHTS: SavedHighlight[] = SAVED_HIGHLIGHTS;
export const MOCK_AI_PROVIDERS: AIProvider[] = AI_PROVIDERS;
export const MOCK_BOOKS = MOCK_PDF_DOCUMENTS;
export const INGESTED_BOOKS = MOCK_PDF_DOCUMENTS;
export const MEDICAL_TOPICS: MedicalTopic[] = [];
