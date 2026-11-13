// Maps the subject names used in the topic-importance research to the subject names used by SUBTOPICS.
export const RESEARCH_TO_APP_SUBJECT: Record<string, string> = {
 'Forensic Medicine': 'Forensic Medicine & Toxicology',
 'Community Medicine (PSM)': 'Preventive & Social Medicine (PSM)',
 'ENT': 'Oto-Rhino-Laryngology (ENT)',
 'Obstetrics and Gynaecology': 'Obstetrics & Gynaecology',
 'Paediatrics': 'Pediatrics',
 'Orthopaedics': 'Orthopedics',
 'Dermatology': 'Dermatology & Venereology',
 'Anaesthesia': 'Anesthesiology',
 'Radiodiagnosis': 'Radiodiagnosis & Radiotherapy',
};

export function toAppSubject(researchName: string): string {
  return RESEARCH_TO_APP_SUBJECT[researchName] ?? researchName;
}
