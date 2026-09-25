/**
 * The cited place in one piece of evidence, as the phone shows it
 * (Phase 31 §12).
 *
 * The desktop reads the file through the same confined reader agents use
 * and sends what it read: a sheet's cells around the cited range, a
 * document's page, lines of a file — or an image, scaled for a phone. So
 * a person judges the same words the agent cited, at the place it cited
 * them, without opening anything on the phone itself.
 */

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Platform,
  useWindowDimensions,
} from 'react-native';
import Markdown from './Markdown';
import { fetchPreview, type PhonePreview } from '../lib/approvals';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const MAX_TABLE_ROWS = 200;

export default function EvidencePreview({
  attachmentUid,
  locator,
}: {
  attachmentUid: string;
  locator: unknown;
}) {
  const [preview, setPreview] = useState<PhonePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setPreview(null);
    setError(null);
    fetchPreview(attachmentUid, locator)
      .then((p) => { if (live) setPreview(p); })
      .catch((err: unknown) => { if (live) setError(err instanceof Error ? err.message : String(err)); });
    return () => { live = false; };
  }, [attachmentUid, locator, attempt]);

  if (error) {
    return (
      <View style={styles.message}>
        <Text style={styles.messageText}>{error}</Text>
        <TouchableOpacity onPress={() => setAttempt((n) => n + 1)} style={styles.retry}>
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!preview) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#3b82f6" />
        <Text style={styles.loadingText}>Reading it on the desktop…</Text>
      </View>
    );
  }
  if (preview.kind === 'unavailable') {
    return (
      <View style={styles.message}>
        <Text style={styles.messageText}>{preview.reason}</Text>
      </View>
    );
  }
  if (preview.kind === 'image') return <ImagePreview preview={preview} />;

  return (
    <View>
      {!!preview.where && <Text style={styles.where}>{preview.where}</Text>}
      {preview.sections.map((s, i) => (
        <View key={`${s.heading}-${i}`} style={styles.section}>
          {!!s.heading && preview.sections.length > 1 && <Text style={styles.heading}>{s.heading}</Text>}
          {preview.format === 'csv' ? (
            <CsvTable source={s.body} grid={preview.grid} />
          ) : preview.format === 'markdown' ? (
            <Markdown compact>{s.body}</Markdown>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <Text style={styles.mono} selectable>{s.body}</Text>
            </ScrollView>
          )}
        </View>
      ))}
      {preview.notes.map((n, i) => (
        <Text key={i} style={styles.note}>{n}</Text>
      ))}
    </View>
  );
}

function ImagePreview({ preview }: { preview: Extract<PhonePreview, { kind: 'image' }> }) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [ratio, setRatio] = useState(4 / 3);
  const [full, setFull] = useState(false);
  const uri = `data:${preview.mime};base64,${preview.base64}`;

  useEffect(() => {
    Image.getSize(uri, (w, h) => { if (w > 0 && h > 0) setRatio(w / h); }, () => undefined);
  }, [uri]);

  return (
    <>
      <TouchableOpacity activeOpacity={0.85} onPress={() => setFull(true)}>
        <Image source={{ uri }} style={[styles.image, { aspectRatio: ratio }]} resizeMode="contain" />
        <Text style={styles.note}>Tap to see it full screen</Text>
      </TouchableOpacity>
      <Modal visible={full} animationType="fade" transparent={false} onRequestClose={() => setFull(false)}>
        <View style={styles.fullScreen}>
          <ScrollView
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
            contentContainerStyle={styles.fullContent}
          >
            <Image
              source={{ uri }}
              style={{ width: screenWidth, height: Math.min(screenHeight * 0.85, screenWidth / ratio) }}
              resizeMode="contain"
            />
          </ScrollView>
          <TouchableOpacity style={styles.close} onPress={() => setFull(false)}>
            <Text style={styles.closeText}>Done</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

/** A small, forgiving CSV reader: quoted fields, doubled quotes, CRLF. */
export function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

type Grid = Extract<PhonePreview, { kind: 'text' }>['grid'];

function colLetters(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/**
 * A sheet's cells. With a grid, columns and rows carry the sheet's own
 * letters and numbers and the cited cells are marked, as on the desktop;
 * without one (a plain CSV), the first row reads as the header.
 */
function CsvTable({ source, grid }: { source: string; grid?: Grid }) {
  const rows = parseCsv(source);
  const shown = rows.slice(0, MAX_TABLE_ROWS);
  const columns = shown.reduce((n, r) => Math.max(n, r.length), 0);
  const cited = grid?.cited ?? null;
  const isCited = (ri: number, ci: number) => {
    if (!grid || !cited) return false;
    const row = grid.firstRow + ri;
    const col = grid.firstCol + ci;
    return row >= cited.from.row && row <= cited.to.row && col >= cited.from.col && col <= cited.to.col;
  };
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          {grid && (
            <View style={[styles.row, styles.headerRow]}>
              <Text style={[styles.rowLabel, styles.headerCell]} />
              {Array.from({ length: columns }, (_, ci) => (
                <Text key={ci} style={[styles.cell, styles.headerCell, styles.colLabel]}>
                  {colLetters(grid.firstCol + ci)}
                </Text>
              ))}
            </View>
          )}
          {shown.map((r, ri) => (
            <View key={ri} style={[styles.row, !grid && ri === 0 && styles.headerRow]}>
              {grid && <Text style={[styles.rowLabel, styles.headerCell]}>{grid.firstRow + ri}</Text>}
              {Array.from({ length: columns }, (_, ci) => (
                <Text
                  key={ci}
                  style={[
                    styles.cell,
                    !grid && ri === 0 && styles.headerCell,
                    isCited(ri, ci) && styles.citedCell,
                  ]}
                  numberOfLines={2}
                  selectable
                >
                  {r[ci] ?? ''}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      {rows.length > shown.length && (
        <Text style={styles.note}>
          Showing {shown.length} of {rows.length} rows — the rest is on the desktop.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16 },
  loadingText: { color: '#71717a', fontSize: 13 },
  message: { backgroundColor: '#18181b', borderRadius: 10, padding: 12 },
  messageText: { color: '#a1a1aa', fontSize: 13, lineHeight: 19 },
  retry: { marginTop: 10, alignSelf: 'flex-start' },
  retryText: { color: '#3b82f6', fontSize: 13, fontWeight: '600' },
  where: { color: '#a1a1aa', fontSize: 12, fontWeight: '600', marginBottom: 8 },
  section: { marginBottom: 10 },
  heading: { color: '#d4d4d8', fontSize: 13, fontWeight: '700', marginBottom: 6 },
  mono: { color: '#e4e4e7', fontFamily: MONO, fontSize: 12, lineHeight: 18 },
  note: { color: '#71717a', fontSize: 11, marginTop: 6 },
  image: { width: '100%', borderRadius: 8, backgroundColor: '#0f0f12' },
  fullScreen: { flex: 1, backgroundColor: '#000' },
  fullContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  close: {
    position: 'absolute', top: 56, right: 20, backgroundColor: '#27272acc',
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18,
  },
  closeText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#27272a' },
  headerRow: { backgroundColor: '#1c1c20' },
  cell: {
    width: 110, paddingHorizontal: 8, paddingVertical: 6, color: '#e4e4e7', fontSize: 12,
    fontFamily: MONO, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: '#27272a',
  },
  headerCell: { color: '#a1a1aa', fontWeight: '700' },
  colLabel: { textAlign: 'center' },
  rowLabel: {
    width: 40, paddingHorizontal: 6, paddingVertical: 6, fontSize: 11, textAlign: 'right',
    fontFamily: MONO, backgroundColor: '#1c1c20',
    borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: '#27272a',
  },
  citedCell: { backgroundColor: '#3b82f633', color: '#fff', fontWeight: '700' },
});
