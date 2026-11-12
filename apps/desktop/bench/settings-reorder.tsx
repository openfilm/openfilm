/** The actual Advanced library arrangement controls, using a test prefs endpoint. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LibraryCategoriesGroup } from '../../../packages/openfilm/studio/ui/src/components/settings/LibraryCategoriesGroup';
import '../shell/shell.css';

createRoot(document.getElementById('root')!).render(
  <div style={{ padding: 24, maxWidth: 900 }}><LibraryCategoriesGroup /></div>,
);
