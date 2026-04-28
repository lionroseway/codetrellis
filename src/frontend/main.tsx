import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installElectronOriginShim } from './lib/electron-origin-shim';
import './styles/globals.css';

// Must run BEFORE any code that calls fetch / new WebSocket. In dev
// (Vite at :5173) this is a no-op; in the packaged Electron app it
// rewrites relative URLs to the backend's actual origin.
installElectronOriginShim();

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
