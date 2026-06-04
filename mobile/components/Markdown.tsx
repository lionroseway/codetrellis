/**
 * Shared markdown renderer — a single dark-themed wrapper around
 * react-native-markdown-display so plan bodies, item descriptions, spec
 * docs, and comments all read like the desktop's Notion-style pages
 * (headings, lists, code blocks, tables, quotes) instead of raw text.
 */

import { StyleSheet } from 'react-native';
import RNMarkdown from 'react-native-markdown-display';

interface MarkdownProps {
  children: string;
  /** Slightly smaller type for inline contexts like comments. */
  compact?: boolean;
}

export default function Markdown({ children, compact }: MarkdownProps) {
  return (
    <RNMarkdown style={compact ? compactStyles : (markdownStyles as never)}>
      {children || ''}
    </RNMarkdown>
  );
}

// Dark theme matching the rest of the app (mirrors the desktop renderer).
export const markdownStyles = StyleSheet.create({
  body: { color: '#d4d4d8', fontSize: 14, lineHeight: 22 },
  heading1: { color: '#e4e4e7', fontSize: 20, fontWeight: '700', marginTop: 14, marginBottom: 8 },
  heading2: { color: '#e4e4e7', fontSize: 17, fontWeight: '700', marginTop: 12, marginBottom: 6 },
  heading3: { color: '#e4e4e7', fontSize: 15, fontWeight: '600', marginTop: 10, marginBottom: 4 },
  heading4: { color: '#e4e4e7', fontSize: 14, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  hr: { backgroundColor: '#27272a', height: 1, marginVertical: 12 },
  strong: { color: '#e4e4e7', fontWeight: '700' },
  em: { fontStyle: 'italic' },
  link: { color: '#3b82f6' },
  blockquote: {
    backgroundColor: '#141416',
    borderLeftColor: '#3b82f6',
    borderLeftWidth: 3,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginVertical: 8,
    borderRadius: 4,
  },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item: { marginVertical: 2 },
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
  table: { borderColor: '#27272a', borderWidth: 1, borderRadius: 6, marginVertical: 8 },
  thead: { backgroundColor: '#18181b' },
  th: { color: '#e4e4e7', padding: 6, fontWeight: '600' },
  td: { color: '#d4d4d8', padding: 6 },
  tr: { borderBottomWidth: 1, borderColor: '#27272a' },
});

const compactStyles = StyleSheet.create({
  ...markdownStyles,
  body: { color: '#d4d4d8', fontSize: 13, lineHeight: 19 },
  heading1: { color: '#e4e4e7', fontSize: 16, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  heading2: { color: '#e4e4e7', fontSize: 15, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  heading3: { color: '#e4e4e7', fontSize: 14, fontWeight: '600', marginTop: 6, marginBottom: 3 },
});
