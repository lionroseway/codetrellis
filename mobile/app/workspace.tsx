/**
 * Workspace screen — the core of the mobile app.
 *
 * A WebView loads the bundled mobile-optimized UI. State arrives over
 * WebRTC and is injected via postMessage. User actions flow back to
 * the desktop via the same bridge.
 *
 * Falls back to a native status view when the WebView bundle isn't
 * available (development mode without a pre-built bundle).
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useRouter } from 'expo-router';
import { WebViewBridge } from '../lib/bridge';
import { connection } from '../lib/connection';
import type { ConnectionState, WorkspaceSnapshot } from '../lib/types';

// The bundled mobile UI HTML. In production, this would be loaded from
// expo-asset. For now, we use a minimal inline HTML that receives state
// via the bridge and renders a basic dashboard.
const MOBILE_UI_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      background: #09090b; color: #e4e4e7;
      padding: 16px; padding-top: 8px;
    }
    .section { margin-bottom: 20px; }
    .section-title { font-size: 13px; color: #71717a; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .card { background: #18181b; border-radius: 8px; padding: 12px; margin-bottom: 8px; border: 1px solid #27272a; }
    .plan-name { font-size: 15px; font-weight: 600; color: #e4e4e7; }
    .plan-meta { font-size: 12px; color: #71717a; margin-top: 4px; }
    .progress-bar { height: 4px; background: #27272a; border-radius: 2px; margin-top: 8px; overflow: hidden; }
    .progress-fill { height: 100%; background: #3b82f6; border-radius: 2px; transition: width 0.3s; }
    .event-type { font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-bottom: 4px; }
    .event-stuck { background: #ef444420; color: #ef4444; }
    .event-need-decision { background: #f59e0b20; color: #f59e0b; }
    .event-need-context { background: #8b5cf620; color: #8b5cf6; }
    .event-steer { background: #22c55e20; color: #22c55e; }
    .event-weigh-in { background: #3b82f620; color: #3b82f6; }
    .event-handing-off { background: #71717a20; color: #a1a1aa; }
    .event-msg { font-size: 13px; color: #d4d4d8; margin-top: 4px; }
    .event-meta { font-size: 11px; color: #52525b; margin-top: 4px; }
    .agent-dot { width: 8px; height: 8px; border-radius: 4px; background: #22c55e; display: inline-block; margin-right: 6px; }
    .agent-name { font-size: 14px; color: #e4e4e7; }
    .agent-model { font-size: 12px; color: #71717a; }
    .empty { text-align: center; color: #52525b; padding: 24px; font-size: 13px; }
    .audio-status { display: flex; align-items: center; gap: 8px; }
    .audio-dot { width: 8px; height: 8px; border-radius: 4px; }
    .audio-active { background: #ef4444; animation: pulse 1.5s infinite; }
    .audio-inactive { background: #52525b; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
  </style>
</head>
<body>
  <div id="app">
    <div class="empty">Waiting for desktop connection...</div>
  </div>
  <script>
    // Bridge: receives state from React Native
    window.__CODETRELLIS_BRIDGE__ = {
      receive: function(jsonStr) {
        try {
          var msg = JSON.parse(jsonStr);
          if (msg.type === 'state-snapshot') {
            renderSnapshot(msg.snapshot);
          }
        } catch(e) { console.warn('Bridge error:', e); }
      }
    };

    function renderSnapshot(s) {
      var html = '';

      // Agents
      if (s.agents && s.agents.length > 0) {
        html += '<div class="section"><div class="section-title">Agents</div>';
        s.agents.forEach(function(a) {
          html += '<div class="card"><span class="agent-dot"></span><span class="agent-name">' +
            esc(a.agentType) + '</span>' +
            (a.model ? ' <span class="agent-model">(' + esc(a.model) + ')</span>' : '') +
            '</div>';
        });
        html += '</div>';
      }

      // Plans
      if (s.plans && s.plans.length > 0) {
        html += '<div class="section"><div class="section-title">Plans</div>';
        s.plans.forEach(function(p) {
          var pct = p.itemCount > 0 ? Math.round((p.doneCount / p.itemCount) * 100) : 0;
          html += '<div class="card"><div class="plan-name">' + esc(p.name) + '</div>' +
            '<div class="plan-meta">' + p.doneCount + '/' + p.itemCount + ' items done' +
            (p.inProgressCount > 0 ? ' · ' + p.inProgressCount + ' in progress' : '') + '</div>' +
            '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div></div>';
        });
        html += '</div>';
      }

      // Channel events
      if (s.channelEvents && s.channelEvents.length > 0) {
        html += '<div class="section"><div class="section-title">Recent Events</div>';
        s.channelEvents.slice(0, 10).forEach(function(e) {
          html += '<div class="card"><span class="event-type event-' + esc(e.eventType) + '">' +
            esc(e.eventType) + '</span>' +
            '<div class="event-msg">' + esc(e.message || '(no message)') + '</div>' +
            '<div class="event-meta">' + esc(e.author) + ' · ' + esc(e.status) + '</div></div>';
        });
        html += '</div>';
      }

      // Audio
      html += '<div class="section"><div class="section-title">Audio</div>' +
        '<div class="card"><div class="audio-status">' +
        '<span class="audio-dot ' + (s.audio && s.audio.capturing ? 'audio-active' : 'audio-inactive') + '"></span>' +
        '<span>' + (s.audio && s.audio.capturing ? 'Capturing (' + (s.audio.bufferedSeconds || 0) + 's buffered)' : 'Not capturing') + '</span>' +
        '</div></div></div>';

      if (!html) html = '<div class="empty">No data from desktop yet</div>';
      document.getElementById('app').innerHTML = html;
    }

    function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  </script>
</body>
</html>
`;

export default function WorkspaceScreen() {
  const router = useRouter();
  const webViewRef = useRef<WebView>(null);
  const bridgeRef = useRef<WebViewBridge | null>(null);
  const [connState, setConnState] = useState<ConnectionState>(connection.state);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(connection.snapshot);

  useEffect(() => {
    // Create and start the bridge
    const bridge = new WebViewBridge(webViewRef);
    bridgeRef.current = bridge;
    bridge.start();

    const unsubState = connection.onStateChange((state) => {
      setConnState(state);
    });

    const unsubSnapshot = connection.onSnapshot((snap) => {
      setSnapshot(snap);
    });

    return () => {
      bridge.stop();
      unsubState();
      unsubSnapshot();
    };
  }, []);

  const handleWebViewMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    bridgeRef.current?.handleWebViewMessage(event.nativeEvent.data);
  }, []);

  // Disconnected state — show native fallback
  if (connState === 'disconnected' || connState === 'failed') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.disconnected}>
          <Text style={styles.disconnectedIcon}>{'\u{1F50C}'}</Text>
          <Text style={styles.disconnectedTitle}>
            {connState === 'failed' ? 'Connection Failed' : 'Disconnected'}
          </Text>
          <Text style={styles.disconnectedBody}>
            The connection to your desktop was lost.
          </Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Text style={styles.backButtonText}>Back to Devices</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Connecting state
  if (connState === 'connecting' || connState === 'reconnecting') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.disconnected}>
          <Text style={styles.connectingText}>
            {connState === 'reconnecting' ? 'Reconnecting...' : 'Connecting...'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Connected — show WebView
  return (
    <SafeAreaView style={styles.container}>
      {/* Connection status bar */}
      <View style={styles.statusBar}>
        <View style={styles.statusDot} />
        <Text style={styles.statusText}>Connected</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.closeText}>Close</Text>
        </TouchableOpacity>
      </View>

      <WebView
        ref={webViewRef}
        source={{ html: MOBILE_UI_HTML }}
        style={styles.webview}
        originWhitelist={['*']}
        onMessage={handleWebViewMessage}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        setBuiltInZoomControls={false}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <Text style={styles.loadingText}>Loading workspace...</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#18181b',
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
    marginRight: 8,
  },
  statusText: {
    color: '#a1a1aa',
    fontSize: 13,
    flex: 1,
  },
  closeText: {
    color: '#3b82f6',
    fontSize: 14,
    fontWeight: '600',
  },
  webview: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#09090b',
  },
  loadingText: {
    color: '#71717a',
    fontSize: 14,
  },
  disconnected: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  disconnectedIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  disconnectedTitle: {
    color: '#e4e4e7',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  disconnectedBody: {
    color: '#71717a',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  backButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  connectingText: {
    color: '#a1a1aa',
    fontSize: 16,
  },
});
