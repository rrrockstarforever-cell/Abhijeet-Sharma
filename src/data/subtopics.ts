export const SUBTOPICS: Record<string, string[]> = {
  // ==========================================
  // 19 NMC NEET-PG SUBJECTS (10-25 subtopics each)
  // ==========================================
  'Anatomy': [
    'General Anatomy & Histology Principles',
    'Embryology, Teratology & Pharyngeal Arches',
    'Neuroanatomy: Ventricles, Cranial Nerves & Brainstem',
    'Head & Neck: Cranial Triangles, Larynx & Oral Cavity',
    'Orbit, Eyeball & Auditory Apparatus',
    'Thorax: Mediastinum, Pericardium & Cardiac Valves',
    'Tracheobronchial Tree, Pleura & Bronchopulmonary Segments',
    'Anterior Abdominal Wall, Rectus Sheath & Inguinal Canal',
    'Gastrointestinal Tract: Peritoneal Folds & Gut Rotation',
    'Hepatobiliary System, Pancreas & Splenic Spaces',
    'Kidney, Ureter, Bladder & Pelvic Diaphragm',
    'Perineum, Ischiorectal Fossa & External Genitalia',
    'Upper Limb: Brachial Plexus, Spaces & Hand Spaces',
    'Lower Limb: Femoral Triangle, Gluteal Region & Compartments',
    'Osteology, Joints & Arthrology',
    'Cross-Sectional Imaging & Fascial Spaces'
  ],

  'Physiology': [
    'General Physiology & Cell Membrane Transport',
    'Nerve-Muscle Physiology, Action Potential & NMJ',
    'Blood Physiology: Hemostasis, Coagulation Cascade & Hemoglobin',
    'Cardiac Electrophysiology, Action Potential & Arrhythmias',
    'Cardiac Mechanics, Pressure-Volume Loops & Output',
    'Hemodynamics, Microcirculation & BP Regulation',
    'Respiratory Mechanics, Surfactant, Compliance & Volumes',
    'Pulmonary Gas Exchange & Oxygen-Hemoglobin Curve',
    'Renal Clearances, GFR, Autoregulation & Tubular Transport',
    'Countercurrent Multiplier, Concentrating Mechanism & Acid-Base',
    'Gastrointestinal Secretions, Motility & Gut Peptides',
    'Endocrine Hypothalamus, Pituitary & Feedback Loops',
    'Thyroid, Parathyroid, Calcium Homeostasis & Adrenal Axis',
    'Reproductive Physiology, Menstrual Hormones & Gametogenesis',
    'Sensory System, Pain Pathways, Ascending Tracts & Thalamus',
    'Motor Pathways, Basal Ganglia, Cerebellum & Special Senses'
  ],

  'Biochemistry': [
    'Amino Acid Chemistry, Peptide Bonds & Protein Folding',
    'Enzyme Kinetics, Lineweaver-Burk, Allostery & Coenzymes',
    'Glycolysis, Pyruvate Dehydrogenase & TCA Cycle',
    'Gluconeogenesis, Glycogen Metabolism & Storage Disorders',
    'HMP Shunt, G6PD Deficiency & Fructose/Galactose Pathways',
    'Fatty Acid Synthesis, Beta-Oxidation & Ketogenesis',
    'Lipoproteins, Dyslipidemias & Cholesterol Biosynthesis',
    'Inborn Errors of Amino Acid Metabolism (PKU, MSUD, Homocystinuria)',
    'Purine & Pyrimidine Metabolism, Gout & Lesch-Nyhan',
    'DNA Replication, Telomerase, DNA Damage & Repair Mechanisms',
    'Transcription, RNA Processing & Alternative Splicing',
    'Translation, Genetic Code, Ribosomes & Post-Translational Tweaks',
    'Molecular Diagnostics: PCR, RFLP, Blotting & Next-Gen Sequencing',
    'Fat-Soluble & Water-Soluble Vitamin Deficiencies',
    'Mineral Metabolism: Iron, Copper, Zinc & Trace Elements',
    'Biological Oxidation, Electron Transport Chain & Free Radicals'
  ],

  'Pathology': [
    'Cellular Adaptations, Irreversible Injury, Necrosis & Apoptosis',
    'Acute & Chronic Inflammation, Cytokines & Chemical Mediators',
    'Tissue Repair, Extracellular Matrix & Wound Healing',
    'Hemodynamic Disorders, Virchow Triad, Thrombosis & Embolism',
    'Molecular Basis of Cancer: Oncogenes, p53, Rb & DNA Repair Genes',
    'Invasion, Metastasis, Tumor Grading & Staging (TNM)',
    'Hypersensitivity Reactions, Autoimmunity, SLE & Amyloidosis',
    'Nutritional Anemias, Megaloblastic & Iron Deficiency Anemia',
    'Hemolytic Anemias, Sickle Cell, Thalassemia & PNH',
    'Leukemias: Acute Lymphoblastic, Myeloid (AML), CML & CLL',
    'Lymphomas: Hodgkin Reed-Sternberg vs Non-Hodgkin Subtypes',
    'Plasma Cell Neoplasms: Multiple Myeloma & MGUS',
    'Cardiovascular: Atherosclerosis, MI & Endocarditis Pathology',
    'Pulmonary: Obstructive, Restrictive ILD & Bronchogenic Carcinoma',
    'Renal: Nephritic vs Nephrotic Glomerulopathies & Crescents',
    'Gastrointestinal & Hepatic Pathology: Cirrhosis, Viral Hepatitis & HCC'
  ],

  'Pharmacology': [
    'General Pharmacokinetics: Bioavailability, Volume of Distribution & Clearance',
    'Pharmacodynamics: Receptors, Dose-Response & Therapeutic Index',
    'Autonomic: Cholinergic Agonists, Anticholinergics & Organophosphates',
    'Autonomic: Adrenergic Agonists, Alpha-Blockers & Beta-Blockers',
    'Cardiovascular: ACE Inhibitors, ARBs, Neprilysin & Calcium Blockers',
    'Cardiovascular: Antiarrhythmics, Digoxin, Nitrates & Statins',
    'Diuretics: Loop, Thiazide, Potassium-Sparing & Carbonic Anhydrase',
    'CNS: Antiepileptics (Sodium Channel, GABA Modulation)',
    'CNS: Antipsychotics, Antidepressants, Lithium & SSRIs',
    'Analgesics: Opioids, NSAIDs, Paracetamol & Gout Drugs',
    'Antimicrobial: Beta-Lactams, Penicillins & Cephalosporins',
    'Antimicrobial: Carbapenems, Aztreonam, Glycopeptides (Vancomycin)',
    'Antimicrobial: Aminoglycosides, Macrolides, Fluoroquinolones & Tetracyclines',
    'Antimycobacterial: First- & Second-Line ATT Regimens & MDR-TB',
    'Antifungal & Antiviral Drugs, Anti-HIV HAART Protocols',
    'Endocrine: Insulins, GLP-1 Agonists, SGLT-2, Steroids & Thyroid Drugs',
    'Anticancer Chemotherapy: Alkylating Agents, Antimetabolites & Targeted MAbs'
  ],

  'Microbiology': [
    'General Bacteriology: Bacterial Morphology, Staining & Culture Media',
    'Bacterial Genetics, Plasmids, Transposons & Resistance Mechanisms',
    'Gram-Positive Cocci: Staphylococci, Streptococci & Enterococci (VRE)',
    'Gram-Negative Bacilli: Enterobacteriaceae, Pseudomonas & Acinetobacter',
    'Anaerobic Infections: Clostridia (Tetanus, Botulism, C. diff) & Bacteroides',
    'Mycobacteria: Mycobacterium tuberculosis, Leprosy & Atypical NTM',
    'Spirochetes: Treponema pallidum (Syphilis), Leptospira & Borrelia',
    'Zoonotic & Rickettsial Infections, Scrub Typhus & Brucellosis',
    'Virology: Herpesviridae, Varicella & Cytomegalovirus',
    'Virology: Viral Hepatitis (HAV, HBV, HCV, HDV, HEV)',
    'Virology: Respiratory Viruses (Influenza, RSV, Coronaviruses)',
    'Virology: Arboviruses (Dengue, Chikungunya, Rabies) & Retroviruses (HIV)',
    'Mycology: Yeasts (Candida, Cryptococcus neoformans)',
    'Mycology: Filamentous Fungi, Aspergillus, Mucorales & Dimorphic Fungi',
    'Parasitology: Intestinal Protozoa (Entamoeba, Giardia, Cryptosporidium)',
    'Parasitology: Blood Protozoa (Plasmodium, Leishmania) & Helminths'
  ],

  'Forensic Medicine & Toxicology': [
    'Medical Jurisprudence, Consent, Medical Negligence & NMC Regulations',
    'Thanatology: Algor, Rigor & Livor Mortis, Post-Mortem Decomposition',
    'Mechanical Injuries: Abrasions, Contusions, Lacerations & Incised Wounds',
    'Firearm Ballistics, Wounding Patterns & Blast Injuries',
    'Regional Injuries: Head Injuries, Extradural & Subdural Hematomas',
    'Forensic Thanatology, Autopsy Technique & Exhumation Protocol',
    'Thermal Injuries: Burns, Scalds, Electrocution & Lightning Strike',
    'Mechanical Asphyxia: Hanging, Ligature Strangulation, Throttling & Drowning',
    'Sexual Jurisprudence: Virginity, Rape Examination & POCSO Act Guidelines',
    'General Toxicology: Poison Elimination, Gastric Lavage & Specific Antidotes',
    'Corrosive & Metal Poisons: Arsenic, Lead, Mercury & Copper',
    'Neurotoxic & Inebriant Poisons: Organophosphates, Carbamates & Snake Venom',
    'Plant & Agricultural Poisons: Oleander, Strychnine, Dhatura & Paraquat',
    'Forensic Psychiatry, Testamentary Capacity & Criminal Responsibility'
  ],

  'Preventive & Social Medicine (PSM)': [
    'Concept of Health, Disease Natural History & Levels of Prevention',
    'Epidemiological Study Designs: Cohort, Case-Control & Cross-Sectional',
    'Randomized Controlled Trials, Blinding & Consort Guidelines',
    'Measures of Morbidity, Mortality, Incidence, Prevalence & Attributable Risk',
    'Screening Principles, Sensitivity, Specificity, PPV, NPV & ROC Curves',
    'Infectious Disease Epidemiology, Herd Immunity & Quarantine Protocols',
    'National Immunization Schedule (NIS), Cold Chain & Vaccine Vial Monitor',
    'Non-Communicable Disease Epidemiology: CVD, Diabetes, Stroke & Cancers',
    'Demography, Fertility Indicators, Couple Protection Rate & Contraception',
    'Maternal & Child Health Care, Under-5 Mortality & Janani Suraksha Yojana',
    'Nutrition, Protein-Energy Malnutrition, Nutritional Anemias & Iodine Program',
    'Environmental Health: Water Purification, Air Quality Index & Solid Waste',
    'Biomedical Waste Management Guidelines (Color-Coded Segregation)',
    'National Health Programs: NHM, NTEP (TB), NVBDCP & Ayushman Bharat',
    'Biostatistics: Normal Distribution, P-value, Chi-Square & Student t-test'
  ],

  'General Medicine': [
    'Cardiology: Acute Coronary Syndrome (STEMI/NSTEMI) & Revascularization',
    'Cardiology: Heart Failure, Reduced Ejection Fraction (HFrEF) & GDMT',
    'Cardiology: Valvular Heart Disease, Rheumatic Fever & Endocarditis',
    'Pulmonology: COPD Exacerbations, Inhaler Regimens & NIV Indications',
    'Pulmonology: Bronchial Asthma, Severe Attacks & Biologic Therapies',
    'Pulmonology: Community & Hospital-Acquired Pneumonia, Tuberculosis',
    'Nephrology: Acute Kidney Injury, KDIGO Staging & Emergency Dialysis',
    'Nephrology: Chronic Kidney Disease, Renal Bone Disease & Glomerular Syndromes',
    'Gastroenterology: Cirrhosis, Ascites, Spontaneous Bacterial Peritonitis & Varices',
    'Gastroenterology: Inflammatory Bowel Disease (Crohn vs Ulcerative Colitis)',
    'Endocrinology: Type 1 & 2 Diabetes, DKA, HHS & Insulin Regimens',
    'Endocrinology: Thyroid Disorders, Adrenal Crisis & Pituitary Tumors',
    'Neurology: Acute Ischemic Stroke, Thrombolysis Window & Thrombectomy',
    'Neurology: Epilepsy, Status Epilepticus Algorithm & Movement Disorders',
    'Rheumatology: Rheumatoid Arthritis, SLE, Scleroderma & Vasculitides',
    'Critical Care: Sepsis 3.0 Guidelines, Shock Resuscitation & Vasopressors'
  ],

  'General Surgery': [
    'Fluid, Electrolyte Resuscitation, Acid-Base Imbalances & Transfusion',
    'Shock: Hypovolemic, Septic, Cardiogenic & Anaphylactic Management',
    'Trauma: ATLS Primary & Secondary Survey, FAST Exam & Tension Pneumothorax',
    'Surgical Site Infections, Sterilization & Prophylactic Antibiotics',
    'Burns: Wallace Rule of Nines, Parkland Formula & Tangential Excision',
    'Arterial Diseases: Acute Limb Ischemia, Peripheral Vascular Disease & Aneurysms',
    'Venous Disorders: Deep Vein Thrombosis, Pulmonary Embolism & Varicose Veins',
    'Thyroid & Parathyroid Surgery: Solitary Thyroid Nodule, Papillary Carcinoma',
    'Breast Diseases: Triple Assessment, Fibroadenoma & Carcinoma Staging',
    'Hernias: Inguinal Anatomy, Lichtenstein Mesh Repair & Strangulation',
    'Acute Abdomen: Acute Appendicitis, Peritonitis & Intestinal Obstruction',
    'Gastrointestinal Cancers: Esophagus, Gastric Adenocarcinoma & Colorectal',
    'Hepatobiliary: Gallstone Disease, Acute Cholecystitis & Cholangiocarcinoma',
    'Pancreas: Acute Necrotizing Pancreatitis (Atlanta Criteria) & Pseudocysts',
    'Urology: Urolithiasis, Renal Cell Carcinoma & Benign Prostatic Hyperplasia',
    'Pediatric Surgical Emergencies: Intussusception & Pyloric Stenosis'
  ],

  'Obstetrics & Gynaecology': [
    'Gametogenesis, Fertilization, Decidua & Placental Hormones',
    'Maternal Physiological Adaptations to Pregnancy (Cardiovascular, Renal, Blood)',
    'Antenatal Care, Down Syndrome Aneuploidy Screening & Anomaly Ultrasound',
    'Normal Labor, Partogram Stages, Mechanism of Labor & Cardinal Movements',
    'Abnormal Labor, Cephalopelvic Disproportion, Malpresentations & Instrumental Delivery',
    'Hypertensive Disorders: Preeclampsia, Eclampsia, Magnesium Sulfate & HELLP',
    'Antepartum Hemorrhage: Placenta Previa vs Abruptio Placentae Protocols',
    'Postpartum Hemorrhage: 4Ts Etiology, Uterotonics Bundle & Bakri Balloon',
    'Medical Disorders in Pregnancy: Gestational Diabetes, Cardiac Disease & Anemia',
    'Preterm Labor, Premature Rupture of Membranes (PPROM) & Steroids/Tocolysis',
    'Menstrual Disorders: Amenorrhea Algorithms & Polycystic Ovary Syndrome (PCOS)',
    'Abnormal Uterine Bleeding (PALM-COEIN Classification) & Fibroids',
    'Pelvic Inflammatory Disease, Tubo-Ovarian Abscess & Chronic Pelvic Pain',
    'Infertility: Ovulation Induction, Tubal Patency Tests & Assisted Reproduction',
    'Cervical Cancer: Bethesda Pap Smear System, Colposcopy & HPV Vaccination',
    'Endometrial Hyperplasia & Epithelial Ovarian Neoplasms'
  ],

  'Pediatrics': [
    'Normal Growth & Development, Milestone Screening & Developmental Red Flags',
    'Infant Nutrition: Exclusive Breastfeeding, Composition & Complementary Diet',
    'Protein-Energy Malnutrition: Severe Acute Malnutrition (SAM) F-75/F-100 Protocol',
    'Vitamin Deficiencies: Rickets, Scurvy & Hypervitaminosis',
    'Neonatal Resuscitation Program (NRP 8th Edition Steps & Compression)',
    'Neonatal Hyperbilirubinemia, Phototherapy Thresholds & Exchange Transfusion',
    'Neonatal Sepsis: Early vs Late Onset, Lumbar Puncture & Antimicrobials',
    'Congenital Heart Diseases: Acyanotic (VSD, ASD, PDA) vs Cyanotic (TOF, TGA)',
    'Pediatric Respiratory: Acute Laryngotracheobronchitis (Croup) & Bronchiolitis',
    'Pediatric Diarrhea, Dehydration Assessment (WHO Plan A, B, C) & Zinc',
    'Pediatric Nephrology: Minimal Change Disease, Steroid Regimens & Nephritic PSGN',
    'Pediatric Hematology: Thalassemia Major, Iron Chelation & Sickle Cell Crises',
    'Pediatric Neurology: Febrile Seizures, Bacterial Meningitis & Hydrocephalus',
    'Vaccinology: Special Immunization Schedules, High-Risk Vaccines & Adverse Events'
  ],

  'Orthopedics': [
    'Fracture Biomechanics, Bone Healing Stages & Nonunion / Compartment Syndrome',
    'Upper Limb Fractures: Clavicle, Proximal Humerus, Supracondylar & Distal Radius',
    'Lower Limb Fractures: Neck of Femur, Intertrochanteric, Shaft Femur & Tibia',
    'Pelvic Fractures, Acetabular Disruptions & Emergency Pelvic Binder',
    'Dislocations: Anterior Shoulder, Posterior Hip & Monteggia/Galeazzi Lesions',
    'Pediatric Orthopedics: Congenital Talipes Equinovarus (Ponseti), DDH & Perthes',
    'Bone & Joint Infections: Acute Hematogenous Osteomyelitis & Septic Arthritis',
    'Spinal Tuberculosis (Pott Spine), Neurological Deficits & Cold Abscesses',
    'Bone Tumors: Osteosarcoma, Ewing Sarcoma, Giant Cell Tumor & Osteochondroma',
    'Degenerative & Inflammatory Joint Disease: Osteoarthritis & Rheumatoid Knee',
    'Spinal Disorders: Disc Prolapse, Spondylolisthesis & Cervical Spondylosis',
    'Sports Injuries: ACL/PCL Tears, Meniscal Tears & Rotator Cuff Tendinopathy'
  ],

  'Oto-Rhino-Laryngology (ENT)': [
    'Ear Anatomy, Tuning Fork Tests (Rinne, Weber) & Audiometry Interpretation',
    'Diseases of External Ear: Otitis Externa, Malignant Otitis & Furuncle',
    'Acute Otitis Media, Otitis Media with Effusion & Tympanostomy Tubes',
    'Chronic Suppurative Otitis Media (Tubotympanic vs Atticoantral Cholesteatoma)',
    'Complications of Otitis Media: Mastoiditis, Petrositis & Intracranial Spread',
    'Inner Ear Disorders: Otosclerosis, Meniere Disease & Benign Paroxysmal Vertigo',
    'Epistaxis: Little Area (Kiesselbach Plexus), Sphenopalatine Artery & Packing',
    'Sinonasal: Acute & Chronic Sinusitis, Functional Endoscopic Sinus Surgery (FESS)',
    'Nasal Polyps: Antrochoanal vs Ethmoidal & Allergic Fungal Sinusitis',
    'Tonsils & Adenoids: Chronic Tonsillitis, Peritonsillar Abscess (Quinsy)',
    'Laryngeal Diseases: Vocal Nodules, Polyps, Papillomas & Vocal Cord Paralysis',
    'Laryngeal Cancer: Glottic vs Supraglottic Staging & Emergency Tracheostomy'
  ],

  'Ophthalmology': [
    'Optics & Refraction: Myopia, Hypermetropia, Astigmatism & Presbyopia',
    'Eyelids & Adnexa: Ptosis, Chalazion, Hordeolum & Blepharitis',
    'Conjunctiva: Bacterial, Viral (EKC), Chlamydial (Trachoma) & Vernal Keratoconjunctivitis',
    'Cornea: Bacterial vs Fungal Keratitis (Slit Lamp Signs) & Acanthamoeba',
    'Corneal Dystrophies, Keratoconus & Keratoplasty Techniques',
    'Sclera & Uvea: Episcleritis, Scleritis & Anterior/Posterior Uveitis Workup',
    'Cataract: Senile, Congenital, Phacoemulsification & Lens Implantation',
    'Glaucoma: Primary Open Angle (POAG) & Acute Angle Closure Crisis Algorithm',
    'Retina: Diabetic Retinopathy (NPDR vs PDR) & Anti-VEGF / Panretinal Laser',
    'Retina: Retinal Detachment (Rhegmatogenous vs Tractional) & Retinal Vascular Occlusions',
    'Neuro-Ophthalmology: Optic Neuritis, Papilledema vs Pseudopapilledema & Pupillary Reflexes',
    'Strabismus, Amblyopia & Ocular Trauma / Chemical Alkali Burns'
  ],

  'Dermatology & Venereology': [
    'Primary & Secondary Skin Lesions, Terminology & Dermatopathology Signs',
    'Papulosquamous Disorders: Plaque Psoriasis, Lichen Planus & Pityriasis Rosea',
    'Vesiculobullous Diseases: Pemphigus Vulgaris (Acantholysis) vs Bullous Pemphigoid',
    'Infectious Dermatology: Impetigo, Cellulitis, Leprosy Staging & Lepra Reactions',
    'Viral Dermatology: Herpes Simplex, Varicella-Zoster, Molluscum & HPV Warts',
    'Fungal Dermatoses: Dermatophytoses (Tinea), Candidiasis & Tinea Versicolor',
    'Parasitic Infestations: Scabies (Permethrin Protocol) & Pediculosis',
    'Eczemas: Atopic Dermatitis, Allergic Contact Dermatitis & Seborrheic Dermatitis',
    'Adnexal Disorders: Acne Vulgaris (Topicals to Isotretinoin) & Rosacea',
    'Connective Tissue Diseases: Cutaneous Lupus, Morphea & Dermatomyositis',
    'Sexually Transmitted Infections: Syphilis (VDRL/TPHA), Chancroid & Genital Ulcer Panels',
    'Severe Drug Eruptions: Stevens-Johnson Syndrome (SJS), TEN & DRESS Syndrome'
  ],

  'Psychiatry': [
    'Psychiatric Assessment, History Taking & Mental Status Examination (MSE)',
    'Schizophrenia: First-Rank Symptoms, Positive vs Negative Symptoms & Atypicals',
    'Bipolar Disorder: Acute Mania Management, Maintenance & Lithium Toxicity',
    'Depressive Disorders: Major Depressive Episode, Melancholic Signs & SSRI Initiation',
    'Anxiety Disorders: Panic Disorder, Agoraphobia, Social Anxiety & Generalized Anxiety',
    'Obsessive-Compulsive Disorder: Yale-Brown Scale, Exposure-Response & High-Dose SSRIs',
    'Stress-Related Conditions: Acute Stress Disorder & Post-Traumatic Stress Disorder',
    'Somatoform & Dissociative Disorders: Illness Anxiety & Conversion Disorder',
    'Substance Use Disorders: Alcohol Withdrawal (CIWA Scale), Delirium Tremens & Opioids',
    'Eating Disorders: Anorexia Nervosa (Refeeding Syndrome) & Bulimia Nervosa',
    'Sleep Disorders: Insomnia Evaluation, Sleep Hygiene & Polysomnography',
    'Child Psychiatry: ADHD (Methylphenidate), Autism Spectrum & Tic Disorders',
    'Emergency Psychiatry: Suicide Risk Assessment & Neuroleptic Malignant Syndrome'
  ],

  'Anesthesiology': [
    'Pre-Anesthetic Evaluation, Mallampati Score & ASA Physical Status Classification',
    'Airway Assessment, Difficult Airway Algorithm & Video-Laryngoscopy',
    'Inhalational Anesthetics: MAC Values, Nitrous Oxide, Sevoflurane & Desflurane',
    'Intravenous Anesthetics: Propofol, Ketamine, Etomidate & Dexmedetomidine',
    'Neuromuscular Blockers: Succinylcholine (Phase I/II) vs Non-Depolarizing Agents',
    'Reversal of Neuromuscular Blockade: Neostigmine-Glycopyrrolate & Sugammadex',
    'Local Anesthetics: Amino Esters vs Amides, Toxic Doses & Intralipid Rescue',
    'Spinal Anesthesia: Subarachnoid Spaces, Absolute Contraindications & Hypotension',
    'Epidural Anesthesia & Combined Spinal-Epidural Analgesia (Labor Analgesia)',
    'Intraoperative Monitoring: Capnography Tracings, Pulse Oximetry & Invasive Arterial Line',
    'Resuscitation: ACLS Cardiopulmonary Arrest Algorithms & Post-ROSC Care',
    'Perioperative Emergencies: Malignant Hyperthermia (Dantrolene) & Laryngospasm'
  ],

  'Radiodiagnosis & Radiotherapy': [
    'Physics of Medical Imaging: Radiation Units, Inverse Square Law & ALARA Concept',
    'Chest X-Ray Patterns: Consolidation, Silhouette Sign, Pleural Effusion & Pneumothorax',
    'Abdominal Radiography: Pneumoperitoneum (Rigler Sign, Gas Under Diaphragm) & Obstruction',
    'Fluoroscopy & Barium Studies: Achalasia Bird Beak, Corkscrew Esophagus & Apple Core Sign',
    'Computed Tomography: Principles, Hounsfield Units, Non-Contrast vs Dual-Phase Contrast',
    'Magnetic Resonance Imaging: T1 vs T2 Principles, FLAIR, Diffusion-Weighted Imaging (DWI)',
    'Ultrasound & Doppler Imaging: Acoustic Shadowing, Twinkle Artifact & Resistive Index',
    'Neuroradiology: Hyperacute Ischemic Stroke (CT vs MRI), EDH, SDH & SAH CT Scoring',
    'Musculoskeletal Imaging: Salter-Harris Classification, Fractures & Bone Tumor Radiographs',
    'Abdominal Imaging: Triple-Phase Liver CT, Acute Pancreatitis Balthazar Scoring',
    'Principles of Radiation Therapy: Linear Accelerator, Radiobiology (4 Rs) & Brachytherapy',
    'Radiation Safety: Occupational Exposure Limits, Shielding & Lead Apron Standards'
  ],

  // ==========================================
  // INI-CET 6 INTEGRATED DOMAINS (10-15 subtopics each)
  // Keyed by official name and short ID
  // ==========================================
  'Applied Basic Sciences & Molecular Genetics': [
    'Molecular Pathology, Transposons & Genomic Oncogenesis',
    'Enzymopathies, Inborn Errors & Newborn Screening Panels',
    'Autonomic & Receptor Pharmacodynamics, Signal Transduction',
    'Diagnostic Histochemistry, Special Stains & Microscopic IBQs',
    'Neuroanatomy: Cranial Nerve Nuclei & Functional Pathways',
    'CRISPR-Cas9, Gene Editing & Next-Generation Sequencing Panels',
    'Cell Cycle Regulators, Cyclins, CDKs & Apoptotic Pathways',
    'Immunofluorescence Signatures & Diagnostic Flow Cytometry',
    'Acid-Base Physiology: Anion Gap & Stewart Physico-Chemical Model',
    'Molecular Antimicrobial Resistance Genes (NDM-1, mecA, VanA)',
    'Developmental Teratology & Congenital Dysmorphology Syndromes',
    'Cellular Ultrastructure & Electron Microscopy Findings'
  ],

  'Systemic Therapeutics & Critical Care Medicine': [
    'ICU Sepsis Bundles, Hemodynamic Resuscitation & Inotropes',
    'Acute Coronary Syndromes: Invasive Strategies & Antithrombotic Dual Therapy',
    'Refractory Heart Failure, Cardiogenic Shock & Impella / IABP Support',
    'Mechanical Ventilation Strategies in ARDS (Protective TV & PEEP)',
    'Acute Kidney Replacement Therapy (CRRT Indications & Anticoagulation)',
    'Endocrine Crises: Thyroid Storm, Myxedema Coma & Acute Adrenal Failure',
    'Refractory Status Epilepticus & Sedative Infusion Algorithms',
    'Hypertensive Emergencies: Labetalol, Nicardipine & Nitroprusside Titration',
    'Acute Respiratory Failure: High-Flow Nasal Cannula vs Non-Invasive Ventilation',
    'Toxicology ICU Protocols: Toxic Alcohols, Paracetamol & Digoxin Toxicity',
    'Severe Acid-Base Derangements: Hyperkalemia Emergency Cardioprotection',
    'Parenteral & Enteral Nutrition Delivery in Critically Ill Patients'
  ],

  'Surgical Specialties, Trauma & Operative Anatomy': [
    'ATLS Polytrauma Resuscitation, Massive Transfusion Protocol & Damage Control',
    'Surgical Margins, Lymphadenectomy & TNM Staging in Oncologic Surgery',
    'Operative Anatomy: Retroperitoneum, Calot Triangle & Inguinal Canal',
    'Thoracic Surgical Emergencies: Flail Chest, Massive Hemothorax & Tracheobronchial Tear',
    'Vascular Trauma: Temporary Shunting, Compartment Syndrome & Fasciotomy',
    'Severe Burns Resuscitation: Inhalation Injury, Bronchoscopy & Tangential Debridement',
    'Diagnostic Laparoscopy in Acute Abdomen & Complicated Peritonitis',
    'Post-Operative Sepsis, Anastomotic Leaks & Enterocutaneous Fistula Care',
    'Emergency Neurosurgical Interventions: Craniotomy for Intracranial Mass & ICP Monitoring',
    'Pediatric Surgical Emergencies: Malrotation with Volvulus & Tracheoesophageal Fistula',
    'Urological Trauma: Renal Lacerations, Urethral Disruptions & Stenting',
    'Principles of Minimal Access Surgery & Robotic-Assisted Procedures'
  ],

  'Maternal, Fetal & Child Health': [
    'Severe Preeclampsia, Eclampsia Resuscitation & HELLP Syndrome Protocol',
    'Intrapartum Fetal Heart Rate Monitoring (CTG Categories I, II, III)',
    'Obstetric Hemorrhage: Medical, Mechanical & Surgical Bundle for PPH',
    'Extremely Low Birth Weight (ELBW) Neonatal ICU & Surfactant Delivery',
    'Neonatal Resuscitation Program (NRP) Advanced Airway & UVC Access',
    'Neonatal Encephalopathy, Therapeutic Hypothermia & aEEG Monitoring',
    'Pediatric Septic Shock: Rapid Fluid Boluses vs Early Epinephrine Protocol',
    'Congenital Diaphragmatic Hernia & Abdominal Wall Defects Management',
    'Pediatric Status Epilepticus & Inborn Error Emergency Decompensation',
    'Pediatric Cyanotic Spells (Tet Spells) & Acute Prostaglandin E1 Infusion',
    'Child Abuse, Safeguarding Protocols & Forensic Pediatric Examination',
    'Perinatal Infections (TORCH Screen, Congenital Syphilis & Cytomegalovirus)'
  ],

  'Diagnostic Sciences & Interventional Radiology': [
    'Histochemical Stains: Jones Silver, Congo Red & Masson Trichrome IBQs',
    'Flow Cytometry Immunophenotyping: Acute Leukemias & Lymphomas Panels',
    'High-Resolution CT (HRCT) Chest: Interstitial Patterns, Honeycombing & Tree-in-Bud',
    'Brain MRI Stroke Sequences: DWI vs ADC Mismatch & Perfusion Weighted Imaging',
    'Triple-Phase Abdominal CT: Hepatocellular Carcinoma & Hemangioma Dynamics',
    'PET-CT Whole Body Oncologic Staging & SUVmax Evaluation',
    'Catheter Angiography, Coil Embolization & GI Bleeding Interventions',
    'Image-Guided Biopsy: Ultrasound vs CT Guided Tru-Cut Protocols',
    'CSF Analysis: Cytology, Oligoclonal Bands, BioFire FilmArray & Cryptococcal Antigen',
    'Molecular Cytogenetics: Karyotyping, FISH & Chromosomal Microarray',
    'Point-of-Care Ultrasound (POCUS) Protocols: RUSH, BLUE & eFAST',
    'Therapeutic Nuclear Medicine: I-131 Thyroid, Lu-177 PSMA & Bone Scintigraphy'
  ],

  'Medical Ethics, Forensic Jurisprudence & Biostatistics': [
    'Informed Consent, Substituted Judgment & Emergency Doctrine in Critical Illness',
    'Declaration of Helsinki, Good Clinical Practice & Ethics Committee Mandate',
    'Clinical Trial Methodology: Phase I to IV Designs, Randomization & Blinding',
    'Diagnostic Accuracy Metrics: Sensitivity, Specificity, Likelihood Ratios & ROC',
    'Measures of Association: Odds Ratio, Relative Risk, Hazard Ratio & NNT',
    'Bias, Confounding, Effect Modification & Multivariable Regression Adjustments',
    'Medico-Legal Autopsy Standards, Chain of Custody & Dying Declarations',
    'Medical Negligence Jurisprudence: Bolam Test, Bolitho Principle & Consumer Law',
    'Brainstem Death Certification Criteria, Apnea Testing & Organ Retrieval Laws',
    'Epidemic Diseases Act, Public Health Surveillance & Quarantine Statutes',
    'Palliative Care Ethics: Do Not Resuscitate (DNR) Orders & Withholding Care'
  ],

  // ==========================================
  // AMC CAT 6 OFFICIAL DOMAINS (10-15 subtopics each)
  // Keyed by official name and short ID
  // ==========================================
  'Adult Health – Medicine': [
    'Acute Coronary Syndromes: Australian eTG Protocols & Primary PCI Pathways',
    'Chronic Heart Failure: GDMT Optimization, Sacubitril-Valsartan & SGLT2i',
    'Acute Exacerbations of COPD & Asthma Action Plans (National Asthma Council)',
    'Endocrine: Type 2 Diabetes Glycemic Targets, RACGP Guidelines & SGLT2/GLP-1 RA',
    'Gastroenterology: Reflux, Dyspepsia, H. pylori Eradication & Cirrhosis Surveillance',
    'Nephrology: Chronic Kidney Disease Staging, Albuminuria & Renal Protective Therapy',
    'Rheumatology: Giant Cell Arteritis, Polymyalgia Rheumatica & Crystal Arthropathies',
    'Infectious Diseases: Sepsis Recognition, Cellulitis, Community Pneumonia & eTG Antibiotics',
    'Neurology: TIA Risk Stratification (ABCD2), Stroke Thrombolysis & Bell Palsy',
    'Geriatric Medicine: Comprehensive Geriatric Assessment, Falls Risk & Polypharmacy',
    'Hematology: Iron Deficiency Anemia Diagnostic Workup, Iron Infusion & DVT Anticoagulation',
    'Acute Emergency Medicine: Anaphylaxis Management (Adrenaline Autoinjector) & Overdoses'
  ],

  'Adult Health – Surgery': [
    'Acute Abdomen: Triage of Acute Appendicitis, Cholecystitis & Perforated Viscus',
    'Trauma Management: Primary & Secondary Surveys, ATLS & Intercostal Catheter Insertion',
    'Head Injury: Canadian CT Head Rule, Concussion Guidelines & Traumatic Brain Injury',
    'Bowel Obstruction: Small vs Large Bowel Etiology, CT Findings & Conservative vs Operative',
    'Skin Cancer in Australia: Melanoma Excision Margins, BCC & SCC Guidelines',
    'Hernias: Inguinal & Femoral Hernias, Reducibility & Strangulation Emergency',
    'Peripheral Vascular Disease: Ankle-Brachial Index, Diabetic Foot Ulcer & Revascularization',
    'Orthopedic Trauma: Distal Radius Fractures, Fractured Neck of Femur & Neurovascular Assessment',
    'Post-Operative Complications: Day 1-5 Fever Workup (Wind, Water, Wound, Walking, Wonder)',
    'Urological Emergencies: Renal Colic, Acute Urinary Retention & Testicular Torsion',
    'Surgical Sepsis, Wound Management, Suturing Techniques & Tetanus Prophylaxis',
    'Day-Surgery Procedures: Pre-Operative Fasting Guidelines & Anticoagulant Bridging'
  ],

  "Women's Health (Obstetrics & Gynaecology)": [
    'Antenatal Care Schedule: First Trimester Combined Screening, NIPT & Morphology Ultrasound',
    'Hypertensive Disorders: Preeclampsia Risk Assessment, Aspirin Prophylaxis & Management',
    'Gestational Diabetes: ADIPS Diagnostic Criteria, Lifestyle vs Insulin Therapy',
    'Early Pregnancy Complications: Miscarriage Subtypes & Ectopic Pregnancy Workup',
    'Antepartum & Postpartum Hemorrhage: Early Detection, Uterotonics & Active Third Stage',
    'Contraceptive Counseling: Long-Acting Reversible Contraception (Implanon, IUD) & Emergency Pill',
    'Abnormal Uterine Bleeding: Investigation Pathways & Endometrial Biopsy Thresholds',
    'National Cervical Screening Program: HPV DNA Primary Screening & Colposcopy Referral',
    'Menopause: Vasomotor Symptoms, Menopausal Hormone Therapy (MHT) & Risk Balancing',
    'Pelvic Inflammatory Disease: Clinical Criteria, Empiric Treatment & Contact Tracing',
    'Infertility: Initial Assessment in General Practice & Specialist Referral Timing',
    'Pelvic Organ Prolapse & Urinary Incontinence (Stress vs Urge) Evaluation'
  ],

  'Child Health (Paediatrics)': [
    'Developmental Milestones: Ages 0 to 5 Normal Sequences & Red Flag Delays',
    'National Immunisation Program (NIP) Australian Schedule & Catch-Up Protocols',
    'The Febrile Child: NICE / Australian Traffic Light Risk Tool & Sepsis Red Flags',
    'Acute Pediatric Respiratory Illness: Croup (Dexamethasone), Bronchiolitis & Stridor',
    'Gastroenteritis & Dehydration: Assessment of Dehydration Severity & Oral Rehydration',
    'Neonatal Jaundice: Physiological vs Pathological & Transcutaneous Bilirubin Charts',
    'Pediatric Murmurs: Differentiating Innocent Flow Murmurs from Congenital Heart Defects',
    'Child Safeguarding: Mandatory Reporting Laws & Physical Abuse Red Flags',
    'Atopic Disease: Atopic Dermatitis, Food Allergies & Anaphylaxis Action Plans',
    'Pediatric Seizures: Febrile Convulsions vs Epilepsy & Status Epilepticus First-Line Steps',
    'Constipation & Encopresis in Children: Behavioral & Osmotic Laxative Strategies',
    'Urinary Tract Infection in Infants: Urine Collection Techniques & Renal Ultrasound Referral'
  ],

  'Mental Health (Psychiatry)': [
    'Assessment of Depression, Suicide Risk Assessment & Formulation of Safety Plans',
    'Anxiety Disorders: Panic Disorder, Social Phobia & Cognitive Behavioral Therapy Referrals',
    'First-Episode Psychosis: Early Recognition, Metabolic Screening & Second-Gen Antipsychotics',
    'Australian Mental Health Act: Involuntary Assessment Criteria & Community Treatment Orders',
    'Alcohol Use Disorder: AUDIT Score, CIWA Protocol, Thiamine Prophylaxis & Relapse Prevention',
    'Substance Misuse: Cannabis, Opioid Dependence, Naloxone Provision & Harm Minimization',
    'Eating Disorders: Anorexia Nervosa Medical Monitoring, Refeeding Risk & Specialist Care',
    'Dementia vs Delirium: Confusional State Diagnostic Algorithm & 4AT Tool in Elderly',
    'Borderline Personality Disorder: Emotion Dysregulation, Crisis Safety & Dialectical Behavior Therapy',
    'Perinatal Mental Health: Postnatal Depression Screening (EPDS) & Antidepressant Safety',
    'Psychopharmacology: Monitoring of SSRIs, Atypical Antipsychotics & Lithium Serum Levels',
    'Bipolar Disorder: Hypomania vs Mania, Mood Stabilizers & Psychoeducation'
  ],

  'Population Health, General Practice & Ethics': [
    'RACGP Guidelines for Preventive Activities in General Practice (Red Book)',
    'Australian Notifiable Conditions & Public Health Notification Timeframes',
    'Consent & Autonomy: Gillick Competence, Minors & Enduring Power of Attorney',
    'Mandatory Reporting Requirements for Health Professionals (AHPRA Guidelines)',
    'Aboriginal & Torres Strait Islander Health: Cultural Safety & Closing the Gap Initiatives',
    'Workplace Health & Injury: Return to Work Plans, WorkCover Certification & Ergonomics',
    'Chronic Disease Management in Australia: GP Management Plans (GPMP) & Team Care (TCA)',
    'Infection Control in Community Settings & Residential Aged Care Outbreak Management',
    'Travel Medicine: Pre-Travel Health Risk Assessment, Yellow Fever & Malaria Prophylaxis',
    'Quality Use of Medicines (NPS MedicineWise): Deprescribing Protocols in Elderly',
    'Open Disclosure Principles & Responding to Medical Adverse Events and Near-Misses'
  ]
};

// Also export short ID aliases for INI-CET and AMC-CAT domains so lookups by ID work seamlessly
SUBTOPICS['AIIMS_BASIC'] = SUBTOPICS['Applied Basic Sciences & Molecular Genetics'];
SUBTOPICS['AIIMS_MED'] = SUBTOPICS['Systemic Therapeutics & Critical Care Medicine'];
SUBTOPICS['AIIMS_SURG'] = SUBTOPICS['Surgical Specialties, Trauma & Operative Anatomy'];
SUBTOPICS['AIIMS_MCH'] = SUBTOPICS['Maternal, Fetal & Child Health'];
SUBTOPICS['AIIMS_DIAG'] = SUBTOPICS['Diagnostic Sciences & Interventional Radiology'];
SUBTOPICS['AIIMS_ETHICS'] = SUBTOPICS['Medical Ethics, Forensic Jurisprudence & Biostatistics'];

SUBTOPICS['AMC_MED'] = SUBTOPICS['Adult Health – Medicine'];
SUBTOPICS['AMC_SURG'] = SUBTOPICS['Adult Health – Surgery'];
SUBTOPICS['AMC_WOMEN'] = SUBTOPICS["Women's Health (Obstetrics & Gynaecology)"];
SUBTOPICS['AMC_CHILD'] = SUBTOPICS['Child Health (Paediatrics)'];
SUBTOPICS['AMC_PSYCH'] = SUBTOPICS['Mental Health (Psychiatry)'];
SUBTOPICS['AMC_POP'] = SUBTOPICS['Population Health, General Practice & Ethics'];
