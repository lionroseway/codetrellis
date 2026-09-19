/**
 * WebView bridge — connects React Native ↔ WebView.
 *
 * State flows:
 *   Desktop → WebRTC `ui` channel → React Native → postMessage → WebView
 *
 * User interactions flow back:
 *   WebView → postMessage → React Native → WebRTC `control` channel → Desktop
 *
 * The WebView loads a bundled mobile-optimized UI from the app binary.
 * This bridge injects state into it and handles actions coming back.
 */

import type { RefObject } from 'react';
import type WebView from 'react-native-webview';
import { connection } from './connection';
import type {
  BridgeToWebView,
  BridgeFromWebView,
} from './types';

// --- Bridge ------------------------------------------------------------------

export class WebViewBridge {
  private webViewRef: RefObject<WebView | null>;
  private unsubSnapshot: (() => void) | null = null;
  private unsubPatch: (() => void) | null = null;
  private unsubState: (() => void) | null = null;
  private unsubTerminal: (() => void) | null = null;

  constructor(webViewRef: RefObject<WebView | null>) {
    this.webViewRef = webViewRef;
  }

  /**
   * Start the bridge — subscribes to connection events and forwards
   * state into the WebView.
   */
  start(): void {
    this.unsubSnapshot = connection.onSnapshot((snapshot) => {
      this.postToWebView({
        type: 'state-snapshot',
        snapshot,
      });
    });

    this.unsubPatch = connection.onPatch((patch) => {
      this.postToWebView({
        type: 'state-patch',
        patch,
      });
    });

    this.unsubState = connection.onStateChange((state, fingerprint) => {
      this.postToWebView({
        type: 'connection-state',
        state,
        fingerprint,
      });
    });

    this.unsubTerminal = connection.onTerminalOutput((terminalIndex, data) => {
      this.postToWebView({
        type: 'terminal-output',
        terminalIndex,
        data,
      });
    });

    // Send the current snapshot if we already have one
    if (connection.snapshot) {
      this.postToWebView({
        type: 'state-snapshot',
        snapshot: connection.snapshot,
      });
    }
  }

  /**
   * Stop the bridge.
   */
  stop(): void {
    if (this.unsubSnapshot) { this.unsubSnapshot(); this.unsubSnapshot = null; }
    if (this.unsubPatch) { this.unsubPatch(); this.unsubPatch = null; }
    if (this.unsubState) { this.unsubState(); this.unsubState = null; }
    if (this.unsubTerminal) { this.unsubTerminal(); this.unsubTerminal = null; }
  }

  /**
   * Handle a message from the WebView. Called from the WebView's
   * `onMessage` prop.
   */
  handleWebViewMessage(messageData: string): void {
    try {
      const msg = JSON.parse(messageData) as BridgeFromWebView;

      switch (msg.type) {
        case 'channel-event':
          connection.sendChannelEvent(msg.event);
          break;

        case 'terminal-input':
          connection.sendTerminalInput(msg.terminalIndex, msg.data);
          break;

        case 'user-input-response':
          connection.sendInputResponse(msg.requestId, msg.response);
          break;

        case 'navigate':
          // Navigation within the WebView — no action needed on the RN side
          // unless it's a cross-screen navigation
          break;

        default:
          console.warn('[Bridge] Unknown message type from WebView:', (msg as { type: string }).type);
      }
    } catch {
      console.warn('[Bridge] Invalid message from WebView');
    }
  }

  // --- Internals -------------------------------------------------------------

  private postToWebView(message: BridgeToWebView): void {
    const webView = this.webViewRef.current;
    if (!webView) return;

    const json = JSON.stringify(message);
    webView.injectJavaScript(`
      (function() {
        try {
          window.__CODETRELLIS_BRIDGE__.receive(${JSON.stringify(json)});
        } catch(e) {
          console.warn('[Bridge] WebView handler error:', e);
        }
      })();
      true;
    `);
  }
}
