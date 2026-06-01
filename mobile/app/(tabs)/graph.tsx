/**
 * Graph tab — placeholder for M1.
 *
 * Shows a prompt to open a project on the desktop. The full
 * drill-down graph browser comes in M4.
 */

import {
  View,
  Text,
  StyleSheet,
} from 'react-native';
import { useActiveProject } from '../../lib/store';

export default function GraphTab() {
  const activeProject = useActiveProject();

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>#</Text>
      <Text style={styles.title}>Dependency Graph</Text>
      {activeProject ? (
        <>
          <Text style={styles.subtitle}>
            {activeProject.displayName}
          </Text>
          <Text style={styles.body}>
            Graph browsing comes in the next update. For now, use the desktop
            to explore the dependency graph.
          </Text>
        </>
      ) : (
        <Text style={styles.body}>
          Open a project on the desktop to explore the dependency graph.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  icon: {
    fontSize: 48,
    color: '#27272a',
    marginBottom: 16,
    fontWeight: '700',
  },
  title: {
    color: '#a1a1aa',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  subtitle: {
    color: '#3b82f6',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 12,
  },
  body: {
    color: '#52525b',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
