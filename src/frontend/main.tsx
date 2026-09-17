// Fonts are BUNDLED, not fetched (Phase 19).
//
// These used to come from fonts.googleapis.com via a <link> in index.html.
// Two problems with that: the packaged app's CSP refuses it, so the desktop
// silently fell back to system fonts; and every launch announced itself to
// Google from the user's machine, which is not a thing a local-first developer
// tool should do.
//
// The variable builds are one file each and cover every weight the design
// uses, so this is fewer requests than the five static cuts it replaces.
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installElectronIpcShim } from './lib/electron-ipc-shim';
import './styles/globals.css';

// Must run BEFORE any code that calls fetch / new WebSocket. In web
// mode this is a no-op (the activation gate `?ipc=1` only appears in
// Electron-launched URLs). In Electron, this monkey-patches fetch +
// WebSocket so all `/api/*` and broadcast traffic flows through IPC
// instead of an exposed TCP port.
installElectronIpcShim();

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
