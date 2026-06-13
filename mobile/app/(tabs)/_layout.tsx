/**
 * Tab layout — bottom navigation for the workspace.
 *
 * Five tabs: Home, Plans, Activity, Terminals, Graph.
 * Dark theme matching the desktop CodeTrellis palette.
 */

import { useEffect, useRef } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import { useDebouncedConnectionState, useAttentionCount } from '../../lib/store';
import { useDrawerStore } from '../../lib/drawer';
import ConnectionStatusPill from '../../components/ConnectionStatusPill';

function MenuButton() {
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  return (
    <TouchableOpacity onPress={openDrawer} hitSlop={12} style={styles.menuBtn}>
      <Text style={styles.menuIcon}>{'☰'}</Text>
    </TouchableOpacity>
  );
}

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return (
    <Text style={[styles.tabIcon, focused && styles.tabIconFocused]}>
      {emoji}
    </Text>
  );
}

function BadgeIcon({ emoji, focused, count }: { emoji: string; focused: boolean; count: number }) {
  return (
    <View>
      <Text style={[styles.tabIcon, focused && styles.tabIconFocused]}>
        {emoji}
      </Text>
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
        </View>
      )}
    </View>
  );
}

export default function TabLayout() {
  const router = useRouter();
  // Plan items 5.4 + 10.6.a — consume the *debounced* state so sub-2s
  // blips don't kick the user back to the pairing screen. Combined
  // with the wasConnected gate below, only sustained drops navigate.
  const connState = useDebouncedConnectionState();
  const attentionCount = useAttentionCount();

  // Track whether we were ever connected. Only redirect home
  // if we *were* connected and then lost the connection — not
  // during the initial connection handshake (which briefly shows
  // 'disconnected' / 'connecting' before settling to 'connected').
  const wasConnected = useRef(false);

  useEffect(() => {
    if (connState === 'connected') {
      wasConnected.current = true;
    } else if (wasConnected.current && (connState === 'disconnected' || connState === 'failed')) {
      // Use dismissAll + navigate to fully pop out of the tab stack
      // back to the root pairing screen.
      try {
        router.dismissAll();
      } catch {
        // dismissAll may throw if there's nothing to dismiss
      }
      router.replace('/');
    }
  }, [connState]);

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: '#3b82f6',
        tabBarInactiveTintColor: '#71717a',
        tabBarLabelStyle: styles.tabLabel,
        headerStyle: styles.header,
        headerTintColor: '#e4e4e7',
        headerTitleStyle: styles.headerTitle,
        // Global nav drawer trigger — restores device/app traversal once
        // you've dropped into the connected tab stack.
        headerLeft: () => <MenuButton />,
        // Plan item 5.5 — persistent connection-status pill in the
        // header. Visible across every tab. Tap → connection-switcher.
        headerRight: () => <ConnectionStatusPill />,
        // Transparent scene so the root global background shows behind tabs.
        sceneStyle: { backgroundColor: 'transparent' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => (
            <BadgeIcon emoji="~" focused={focused} count={attentionCount} />
          ),
          headerTitle: 'CodeTrellis',
        }}
      />
      <Tabs.Screen
        name="plans"
        options={{
          title: 'Plans',
          tabBarIcon: ({ focused }) => <TabIcon emoji="=" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: ({ focused }) => <TabIcon emoji="*" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="terminals"
        options={{
          title: 'Terminals',
          tabBarIcon: ({ focused }) => <TabIcon emoji=">" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="graph"
        options={{
          title: 'Graph',
          tabBarIcon: ({ focused }) => <TabIcon emoji="#" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#111113',
    borderTopColor: '#27272a',
    borderTopWidth: 1,
    height: 88,
    paddingBottom: 28,
    paddingTop: 8,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  tabIcon: {
    fontSize: 20,
    color: '#71717a',
  },
  tabIconFocused: {
    color: '#3b82f6',
  },
  header: {
    backgroundColor: '#0a0c18',
    borderBottomWidth: 0,
    shadowOpacity: 0,
    elevation: 0,
  },
  headerTitle: {
    fontWeight: '700',
    fontSize: 17,
  },
  menuBtn: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  menuIcon: {
    color: '#e4e4e7',
    fontSize: 22,
    fontWeight: '400',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    backgroundColor: '#ef4444',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
});
