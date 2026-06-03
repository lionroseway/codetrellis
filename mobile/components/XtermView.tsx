/**
 * XtermView — a real terminal emulator rendered with xterm.js inside a
 * WebView. Used for display: raw PTY output (ANSI, cursor moves, box
 * drawing) is streamed in via `write()` and xterm renders it correctly,
 * unlike a plain-text view. A fit addon sizes the grid to the viewport
 * and reports cols/rows so the PTY can be resized to match.
 *
 * NOTE: xterm is loaded from a CDN for now. TODO: bundle it as a local
 * asset for offline use.
 *
 * Bridge:
 *   RN → WebView : window.__recv(jsonString)  ({type:'write'|'reset'|'fit'})
 *   WebView → RN : postMessage  ({type:'ready'|'data'|'resize'})
 */

import { forwardRef, useImperativeHandle, useRef, useCallback } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { StyleSheet } from 'react-native';

export interface XtermHandle {
  write: (data: string) => void;
  reset: () => void;
  fit: () => void;
}

interface XtermViewProps {
  onReady?: () => void;
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

const XTERM_VERSION = '5.5.0';
const FIT_VERSION = '0.10.0';

const HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@${XTERM_VERSION}/css/xterm.css">
<style>
  html, body { height: 100%; margin: 0; background: #0a0a0c; overflow: hidden; }
  #t { height: 100%; width: 100%; padding: 6px; box-sizing: border-box; }
  .xterm-viewport::-webkit-scrollbar { width: 0; height: 0; }
  #err { color:#ef4444; font:12px Menlo,monospace; padding:12px; }
</style>
</head>
<body>
  <div id="t"></div>
  <div id="err"></div>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@${XTERM_VERSION}/lib/xterm.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@${FIT_VERSION}/lib/addon-fit.js"></script>
  <script>
    function post(m){ try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch(e){} }
    function boot() {
      if (typeof Terminal === 'undefined') {
        document.getElementById('err').textContent = 'Could not load terminal renderer (offline?).';
        post({ type: 'error', message: 'xterm failed to load' });
        return;
      }
      var term = new Terminal({
        fontSize: 12,
        fontFamily: 'Menlo, Monaco, monospace',
        cursorBlink: true,
        scrollback: 4000,
        theme: {
          background: '#0a0a0c', foreground: '#d4d4d8', cursor: '#3b82f6',
          black: '#3f3f46', red: '#ef4444', green: '#22c55e', yellow: '#eab308',
          blue: '#3b82f6', magenta: '#a855f7', cyan: '#06b6d4', white: '#d4d4d8',
          brightBlack: '#71717a', brightRed: '#f87171', brightGreen: '#4ade80',
          brightYellow: '#facc15', brightBlue: '#60a5fa', brightMagenta: '#c084fc',
          brightCyan: '#22d3ee', brightWhite: '#fafafa',
        },
      });
      var fit = new FitAddon.FitAddon();
      term.loadAddon(fit);
      term.open(document.getElementById('t'));
      function doFit(){
        try { fit.fit(); post({ type: 'resize', cols: term.cols, rows: term.rows }); } catch(e){}
      }
      term.onData(function(d){ post({ type: 'data', data: d }); });
      window.addEventListener('resize', doFit);
      window.__recv = function(json){
        try {
          var m = JSON.parse(json);
          if (m.type === 'write') term.write(m.data);
          else if (m.type === 'reset') term.reset();
          else if (m.type === 'fit') doFit();
        } catch(e){}
      };
      setTimeout(doFit, 60);
      post({ type: 'ready' });
    }
    boot();
  </script>
</body>
</html>`;

const XtermView = forwardRef<XtermHandle, XtermViewProps>(function XtermView(
  { onReady, onData, onResize },
  ref,
) {
  const webRef = useRef<WebView>(null);

  const inject = useCallback((msg: object) => {
    // Double-encode: __recv expects a JSON string; injectJavaScript needs a
    // JS string literal.
    const arg = JSON.stringify(JSON.stringify(msg));
    webRef.current?.injectJavaScript(`window.__recv && window.__recv(${arg}); true;`);
  }, []);

  useImperativeHandle(ref, () => ({
    write: (data: string) => inject({ type: 'write', data }),
    reset: () => inject({ type: 'reset' }),
    fit: () => inject({ type: 'fit' }),
  }), [inject]);

  const handleMessage = useCallback((e: WebViewMessageEvent) => {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.type === 'ready') onReady?.();
      else if (m.type === 'data') onData?.(m.data);
      else if (m.type === 'resize') onResize?.(m.cols, m.rows);
    } catch { /* ignore */ }
  }, [onReady, onData, onResize]);

  return (
    <WebView
      ref={webRef}
      source={{ html: HTML }}
      style={styles.web}
      originWhitelist={['*']}
      onMessage={handleMessage}
      javaScriptEnabled
      domStorageEnabled
      scrollEnabled={false}
      bounces={false}
      overScrollMode="never"
      keyboardDisplayRequiresUserAction
      hideKeyboardAccessoryView
      setBuiltInZoomControls={false}
      automaticallyAdjustContentInsets={false}
      // Block accidental navigations away from the terminal
      onShouldStartLoadWithRequest={(req) => req.url.startsWith('about:') || req.url.startsWith('data:') || req.url.includes('jsdelivr')}
    />
  );
});

export default XtermView;

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#0a0a0c' },
});
