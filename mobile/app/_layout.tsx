/**
 * Root layout — dark theme, splash screen, navigation stack.
 *
 * Shows an animated CodeTrellis splash on first launch, then
 * reveals the navigation stack with a dark theme.
 */

import { useState, useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet } from 'react-native';
import SplashScreen from '../components/SplashScreen';
import AnimatedBackground from '../components/AnimatedBackground';
import { initPrefs } from '../lib/prefs';

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true);

  // Hydrate on-device preferences (e.g. the configurable RPC timeout) once at
  // startup so the cached values are ready before the first request.
  useEffect(() => { void initPrefs(); }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {/* Global living-graph background — sits behind every screen (screens
          render transparent over it). Terminal/WebView screens stay opaque. */}
      <AnimatedBackground />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#09090b' },
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
            headerStyle: { backgroundColor: '#09090b' },
          }}
        />
        <Stack.Screen
          name="terminal-detail"
          options={{
            title: 'Terminal',
            headerStyle: { backgroundColor: '#09090b' },
          }}
        />
        <Stack.Screen
          name="item-detail"
          options={{
            title: 'Item',
            headerStyle: { backgroundColor: '#09090b' },
          }}
        />
        <Stack.Screen
          name="event-detail"
          options={{
            title: 'Event',
            headerStyle: { backgroundColor: '#09090b' },
          }}
        />
        <Stack.Screen
          name="graph-file-detail"
          options={{
            title: 'File',
            headerStyle: { backgroundColor: '#09090b' },
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
            headerStyle: { backgroundColor: '#09090b' },
          }}
        />
        <Stack.Screen
          name="doc-viewer"
          options={{
            title: 'Document',
            headerStyle: { backgroundColor: '#09090b' },
          }}
        />
        <Stack.Screen
          name="plan-channel"
          options={{
            title: 'Discussion',
            headerStyle: { backgroundColor: '#09090b' },
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
            headerStyle: { backgroundColor: '#09090b' },
          }}
        />
        <Stack.Screen
          name="settings"
          options={{ title: 'Settings', headerStyle: { backgroundColor: '#09090b' } }}
        />
        <Stack.Screen
          name="projects"
          options={{ title: 'Projects', headerStyle: { backgroundColor: '#09090b' } }}
        />
        <Stack.Screen
          name="system-docs"
          options={{ title: 'System Docs', headerStyle: { backgroundColor: '#09090b' } }}
        />
        <Stack.Screen
          name="system-doc-detail"
          options={{ title: 'Document', headerStyle: { backgroundColor: '#09090b' } }}
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
    backgroundColor: '#09090b',
  },
});
