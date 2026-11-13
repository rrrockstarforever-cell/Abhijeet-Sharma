// Scope rules shared by the question writer's checks: the examiner, the fact planner and the subtopic split.
// The requested subject, topic and subtopic set the boundary. Related or same-disease content is not in scope.

export const SCOPE_RULE = [
 'Scope lock: the requested subject, topic and subtopic are the examination boundary, in that order.',
 'A related concept, a same-disease question or a neighbouring subject is not in scope.',
 'Test only the knowledge domain requested; every answer option must belong to that same domain.',
 'A question is out of scope if it tests another subject, topic, subtopic or domain, or if answering it needs knowledge outside the boundary.',
].join(' ');

// One line per subject: what may be tested, and what must not be tested for that subject.
export const SUBJECT_BOUNDARIES = [
 'Anatomy: structure, relations, blood, nerve and lymph supply, variations, applied and surface anatomy. Not physiological or pathological mechanisms, drugs or diagnostic investigations.',
 'Physiology: normal mechanisms, organ-system function, regulation, normal values. Not pathology, histopathology, drug treatment or microbiology.',
 'Biochemistry: biomolecules, enzymes, metabolic pathways and regulation, molecular biology, vitamins, inborn errors. Not histopathology, clinical management or drug treatment.',
 'Pathology: cell injury, inflammation, neoplasia, haematology, morphology, histopathology, specimens. Not organism identification, drug treatment or complete clinical management.',
 'Pharmacology: drug classes, mechanism, pharmacokinetics, indications, dose, adverse effects, interactions, resistance, toxicity, antidotes. Not disease diagnosis, microbiological identification, laboratory diagnosis, histopathology or etiology.',
 'Microbiology: organism morphology, culture, staining, identification, virulence, laboratory diagnosis, susceptibility testing. Not drug mechanisms, pharmacokinetics or clinical management.',
 'Forensic medicine and toxicology: medical jurisprudence, injuries, identification, postmortem changes, poisons and their medicolegal aspects. Not general pharmacology or routine clinical diagnosis.',
 'Community medicine (PSM): epidemiology, biostatistics, screening, prevention, national programmes, health indicators. Not individual diagnosis, individual prescription or drug mechanisms.',
 'General medicine: for a diagnosis topic, criteria and investigations; for a treatment topic, therapy and monitoring; for a clinical-features topic, signs and presentation. Not the other phases of the disease.',
 'General surgery: surgical principles, anatomy, indications, techniques, complications, trauma. Not pharmacological mechanisms or internal medicine management.',
 'Orthopaedics: fractures, dislocations, bone and joint disorders, classification, reduction and fixation. Not general rheumatology or unrelated pharmacology.',
 'ENT: ear, nose, throat, hearing and balance, ENT investigations and surgery. Not general neurology or unrelated pharmacology.',
 'Ophthalmology: eye anatomy, ocular disease, examination, visual fields, ocular surgery. Not general neurology or systemic medical management.',
 'Dermatology and STD: skin morphology, skin disease diagnosis, dermatological treatment, sexually transmitted infections. Not general microbiology or unrelated systemic medicine.',
 'Psychiatry: symptoms, classification, diagnostic criteria, psychotherapy, psychotropic drugs when requested. Not general neurology or unrelated medical diagnosis.',
 'Radiodiagnosis: imaging findings, signs, modality choice and interpretation. Not pharmacological treatment, surgery or radiotherapy protocols.',
 'Anaesthesiology: anaesthetic technique, agents, airway, monitoring, perioperative management. Not complete surgical procedures or unrelated drug pharmacology.',
 'Obstetrics and gynaecology: pregnancy, labour, puerperium, gynaecological disorders, contraception. Not paediatric management or unrelated pharmacology.',
 'Paediatrics: growth, development, neonatology, paediatric clinical features, diagnosis, immunisation, paediatric management. Not adult or obstetric management.',
];

export const DRUG_TOPIC_RULE =
 'A drug or drug-class topic is pharmacology only: test the drug itself, never the disease diagnosis, the microbiology, the clinical signs, the infection control or the nursing around it, even when the same disease is involved.';

export function scopeInstruction(): string {
  return `${SCOPE_RULE} ${DRUG_TOPIC_RULE} Subject boundaries: ${SUBJECT_BOUNDARIES.join(' ')}`;
}
