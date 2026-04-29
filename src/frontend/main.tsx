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
