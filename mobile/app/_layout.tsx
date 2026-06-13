/**
 * Root layout — dark theme, splash screen, navigation stack.
 *
 * Shows an animated CodeTrellis splash on first launch, then
 * reveals the navigation stack with a dark theme.
 */

import { useState, useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet } from 'react-native';
import SplashScreen from '../components/SplashScreen';
import AnimatedBackground from '../components/AnimatedBackground';
import { initPrefs } from '../lib/prefs';
import { onNotificationTap, getInitialNotification, routeForNotification } from '../lib/push';

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true);

  // Hydrate on-device preferences (e.g. the configurable RPC timeout) once at
  // startup so the cached values are ready before the first request.
  useEffect(() => { void initPrefs(); }, []);

  // Deep-link notification taps to the right screen — both while running and
  // from a cold start. (The push payload's `data` resolves to a route.)
  useEffect(() => {
    const go = (route: string | null) => { if (route) { try { router.navigate(route as never); } catch { /* not ready */ } } };
    const unsub = onNotificationTap((d) => go(routeForNotification(d)));
    void getInitialNotification().then((d) => { if (d) setTimeout(() => go(routeForNotification(d)), 600); });
    return unsub;
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {/* Global living-graph background — sits behind every screen (screens
          render transparent over it). Terminal/WebView screens stay opaque. */}
      <AnimatedBackground />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0a0c18' },
          headerTintColor: '#e4e4e7',
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: 'transparent' },
          animation: 'slide_from_right',
          // Show just the chevron — without this the back button inherits the
          // previous route's name and reads "(tabs)" everywhere.
          headerBackButtonDisplayMode: 'minimal',
          headerBackTitle: '',
        }}
      >
        <Stack.Screen
          name="index"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="pair"
          options={{
            title: 'Pair Device',
            presentation: 'modal',
            headerStyle: { backgroundColor: '#111113' },
          }}
        />
        <Stack.Screen
          name="(tabs)"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="plan-detail"
          options={{
            title: 'Plan',
            headerStyle: { backgroundColor: '#0a0c18' },
          }}
        />
        <Stack.Screen
          name="terminal-detail"
          options={{
            title: 'Terminal',
            headerStyle: { backgroundColor: '#0a0c18' },
          }}
        />
        <Stack.Screen
          name="item-detail"
          options={{
            title: 'Item',
            headerStyle: { backgroundColor: '#0a0c18' },
          }}
        />
        <Stack.Screen
          name="event-detail"
          options={{
            title: 'Event',
            headerStyle: { backgroundColor: '#0a0c18' },
          }}
        />
        <Stack.Screen
          name="graph-file-detail"
          options={{
            title: 'File',
            headerStyle: { backgroundColor: '#0a0c18' },
          }}
        />
        <Stack.Screen
          name="input-request"
          options={{
            title: 'Input Request',
            presentation: 'modal',
            headerStyle: { backgroundColor: '#111113' },
          }}
        />
        <Stack.Screen
          name="changes"
          options={{
            title: 'Changes',
            headerStyle: { backgroundColor: '#0a0c18' },
          }}
        />
        <Stack.Screen
          name="doc-viewer"
          options={{
            title: 'Document',
            headerStyle: { backgroundColor: '#0a0c18' },
          }}
        />
        <Stack.Screen
          name="plan-channel"
          options={{
            title: 'Discussion',
            headerStyle: { backgroundColor: '#0a0c18' },
          }}
        />
        <Stack.Screen
          name="project-browser"
          options={{
            title: 'Open Project',
            presentation: 'modal',
            headerStyle: { backgroundColor: '#111113' },
          }}
        />
        <Stack.Screen
          name="body-editor"
          options={{
            title: 'Edit',
            presentation: 'modal',
            headerStyle: { backgroundColor: '#111113' },
          }}
        />
        <Stack.Screen
          name="connection-switcher"
          options={{
            title: 'Connections',
            presentation: 'modal',
            headerStyle: { backgroundColor: '#0a0c18' },
          }}
        />
        <Stack.Screen
          name="settings"
          options={{ title: 'Settings', headerStyle: { backgroundColor: '#0a0c18' } }}
        />
        <Stack.Screen
          name="projects"
          options={{ title: 'Projects', headerStyle: { backgroundColor: '#0a0c18' } }}
        />
        <Stack.Screen
          name="system-docs"
          options={{ title: 'System Docs', headerStyle: { backgroundColor: '#0a0c18' } }}
        />
        <Stack.Screen
          name="system-doc-detail"
          options={{ title: 'Document', headerStyle: { backgroundColor: '#0a0c18' } }}
        />
        <Stack.Screen
          name="plan-templates"
          options={{
            title: 'New from template',
            presentation: 'modal',
            headerStyle: { backgroundColor: '#111113' },
          }}
        />
        <Stack.Screen
          name="workspace"
          options={{ headerShown: false }}
        />
      </Stack>

      {showSplash && (
        <SplashScreen onFinish={() => setShowSplash(false)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0c18',
  },
});
