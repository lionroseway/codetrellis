/**
 * Spec-doc viewer — renders a plan document's markdown body.
 *
 * Navigated to from the Plan detail screen's "Spec Docs" section.
 * Fetches the full document via the `plan.document` RPC (the plan list
 * only carries summaries) and renders the markdown body with a dark
 * theme via react-native-markdown-display.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import Markdown from 'react-native-markdown-display';
import { rpc } from '../lib/rpc';

// --- Types -------------------------------------------------------------------

interface PlanDocument {
  uid: string;
  planUid: string;
  docType: string;
  title: string;
  body: string;
  version: number;
  author: string;
  authorType: string;
  updatedAt?: number | null;
}

function relTime(ts?: number | null): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// --- Component ---------------------------------------------------------------

export default function DocViewerScreen() {
  const { docUid, title } = useLocalSearchParams<{
    docUid: string;
    title?: string;
  }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<PlanDocument | null>(null);

  const fetchDoc = useCallback(async () => {
    if (!docUid) return;
    try {
      setError(null);
      const result = await rpc<PlanDocument>('plan.document', { docUid });
      setDoc(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [docUid]);

  useEffect(() => {
    setLoading(true);
    fetchDoc().finally(() => setLoading(false));
  }, [fetchDoc]);

  const headerTitle = doc?.title || title || 'Document';

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: headerTitle }} />
        <ActivityIndicator color="#3b82f6" size="large" />
        <Text style={styles.loadingText}>Loading document...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: headerTitle }} />
        <Text style={styles.errorIcon}>!</Text>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={fetchDoc}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!doc) return null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <Stack.Screen options={{ title: headerTitle }} />

      {/* Doc header */}
      <Text style={styles.docTitle}>{doc.title}</Text>
      <View style={styles.metaRow}>
        <View style={styles.typeBadge}>
          <Text style={styles.typeText}>{doc.docType}</Text>
        </View>
        <Text style={styles.metaText}>v{doc.version}</Text>
        {doc.author ? (
          <Text style={styles.metaText}>· {doc.author}</Text>
        ) : null}
        {doc.updatedAt ? (
          <Text style={styles.metaText}>· {relTime(doc.updatedAt)}</Text>
        ) : null}
      </View>

      {/* Markdown body */}
      {doc.body && doc.body.trim().length > 0 ? (
        <Markdown style={markdownStyles}>{doc.body}</Markdown>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>This document is empty.</Text>
        </View>
      )}
    </ScrollView>
  );
}

// --- Styles ------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  center: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  loadingText: {
    color: '#71717a',
    fontSize: 14,
    marginTop: 12,
  },
  errorIcon: {
    fontSize: 36,
    color: '#ef4444',
    fontWeight: '700',
    marginBottom: 12,
  },
  errorText: {
    color: '#a1a1aa',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryBtn: {
    backgroundColor: '#3b82f620',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  retryText: {
    color: '#3b82f6',
    fontWeight: '600',
    fontSize: 14,
  },
  docTitle: {
    color: '#e4e4e7',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  typeBadge: {
    backgroundColor: '#27272a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  typeText: {
    color: '#a1a1aa',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  metaText: {
    color: '#52525b',
    fontSize: 12,
  },
  emptyCard: {
    backgroundColor: '#18181b',
    borderRadius: 10,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#27272a',
  },
  emptyText: {
    color: '#52525b',
    fontSize: 13,
  },
});

// Markdown theme — dark, matches the rest of the app.
const markdownStyles = StyleSheet.create({
  body: {
    color: '#d4d4d8',
    fontSize: 14,
    lineHeight: 22,
  },
  heading1: {
    color: '#e4e4e7',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  heading2: {
    color: '#e4e4e7',
    fontSize: 17,
    fontWeight: '700',
    marginTop: 14,
    marginBottom: 6,
  },
  heading3: {
    color: '#e4e4e7',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 4,
  },
  hr: {
    backgroundColor: '#27272a',
    height: 1,
    marginVertical: 12,
  },
  strong: {
    color: '#e4e4e7',
    fontWeight: '700',
  },
  em: {
    fontStyle: 'italic',
  },
  link: {
    color: '#3b82f6',
  },
  blockquote: {
    backgroundColor: '#141416',
    borderLeftColor: '#3b82f6',
    borderLeftWidth: 3,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginVertical: 8,
  },
  bullet_list: {
    marginVertical: 4,
  },
  ordered_list: {
    marginVertical: 4,
  },
  list_item: {
    marginVertical: 2,
  },
  code_inline: {
    color: '#fbbf24',
    backgroundColor: '#18181b',
    borderRadius: 4,
    paddingHorizontal: 4,
    fontFamily: 'Menlo',
    fontSize: 13,
  },
  code_block: {
    color: '#d4d4d8',
    backgroundColor: '#18181b',
    borderRadius: 8,
    padding: 12,
    fontFamily: 'Menlo',
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  fence: {
    color: '#d4d4d8',
    backgroundColor: '#18181b',
    borderRadius: 8,
    padding: 12,
    fontFamily: 'Menlo',
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  table: {
    borderColor: '#27272a',
    borderWidth: 1,
    borderRadius: 6,
    marginVertical: 8,
  },
  thead: {
    backgroundColor: '#18181b',
  },
  th: {
    color: '#e4e4e7',
    padding: 6,
    fontWeight: '600',
  },
  td: {
    color: '#d4d4d8',
    padding: 6,
  },
  tr: {
    borderBottomWidth: 1,
    borderColor: '#27272a',
  },
});
