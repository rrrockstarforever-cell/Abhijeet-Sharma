export interface UserSession {
  userId?: string;
  token?: string;
  expiresAt?: number;
}

export const loadActiveTest = (): any => {
  try {
    const saved = localStorage.getItem('activeTest');
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    console.error('Failed to load active test:', e);
    return null;
  }
};

export const saveActiveTest = (testData: any): void => {
  try {
    localStorage.setItem('activeTest', JSON.stringify(testData));
  } catch (e) {
    console.error('Failed to save active test:', e);
  }
};

export const loadRunSession = (sig: string): any => {
  try {
    const saved = localStorage.getItem('runSession-' + sig);
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    console.error('Failed to load run session:', e);
    return null;
  }
};

export const saveRunSession = (sessionData: any): void => {
  try {
    localStorage.setItem('runSession-' + sessionData.sig, JSON.stringify(sessionData));
  } catch (e) {
    console.error('Failed to save run session:', e);
  }
};

export const signature = (questions: any[]): string => {
  try {
    const qIds = questions.map(q => q.id).join(',');
    return 'sig-' + qIds;
  } catch (e) {
    console.error('Failed to create signature:', e);
    return 'sig-unknown';
  }
};

export const getSession = (): UserSession => {
  try {
    const saved = localStorage.getItem('userSession');
    return saved ? JSON.parse(saved) : {};
  } catch (e) {
    console.error('Failed to get session:', e);
    return {};
  }
};

export const setSession = (session: UserSession): void => {
  try {
    localStorage.setItem('userSession', JSON.stringify(session));
  } catch (e) {
    console.error('Failed to set session:', e);
  }
};

export const clearSession = (): void => {
  try {
    localStorage.removeItem('userSession');
    localStorage.removeItem('activeTest');
  } catch (e) {
    console.error('Failed to clear session:', e);
  }
};
