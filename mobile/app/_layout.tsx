/**
 * Root layout — dark theme, status bar, navigation stack.
 */

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet } from 'react-native';

export default function RootLayout() {
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
          options={{ title: 'CodeTrellis' }}
        />
        <Stack.Screen
          name="pair"
          options={{ title: 'Pair Device', presentation: 'modal' }}
        />
        <Stack.Screen
          name="workspace"
          options={{ headerShown: false }}
        />
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
});
