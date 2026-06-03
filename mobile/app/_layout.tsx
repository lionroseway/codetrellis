/**
 * Root layout — dark theme, splash screen, navigation stack.
 *
 * Shows an animated CodeTrellis splash on first launch, then
 * reveals the navigation stack with a dark theme.
 */

import { useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet } from 'react-native';
import SplashScreen from '../components/SplashScreen';

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#09090b' },
          headerTintColor: '#e4e4e7',
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: '#09090b' },
          animation: 'slide_from_right',
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
          name="connection-switcher"
          options={{
            title: 'Connections',
            presentation: 'modal',
            headerStyle: { backgroundColor: '#09090b' },
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
