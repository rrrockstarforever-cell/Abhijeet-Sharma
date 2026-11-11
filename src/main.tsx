import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
// TEMPORARY SAMPLE: the playful theme is opt-in via localStorage 'pulse-theme' = 'playful'.
import './theme-playful.css';

try {
  if (localStorage.getItem('pulse-theme') === 'playful') document.documentElement.classList.add('theme-playful');
} catch { /* storage blocked: default theme */ }

createRoot(document.getElementById('root')!).render(<App />);
