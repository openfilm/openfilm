import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { FocusNav } from './components/FocusNav';
import './globals.css';
import { applyStudioHost } from './lib/host';

applyStudioHost();

createRoot(document.getElementById('root')!).render(<StrictMode><FocusNav /><App /></StrictMode>);
