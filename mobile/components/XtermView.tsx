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
import { TERMINAL_HTML } from './xterm-bundle';

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
      source={{ html: TERMINAL_HTML }}
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
      // Fully offline — only the inlined document loads; block any navigation.
      onShouldStartLoadWithRequest={(req) => req.url.startsWith('about:') || req.url.startsWith('data:')}
    />
  );
});

export default XtermView;

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#0a0a0c' },
});
