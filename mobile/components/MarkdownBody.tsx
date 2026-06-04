/**
 * MarkdownBody — renders a plan/item body that may contain inline chips,
 * mirroring the desktop BodyRenderer. Chip grammar (round-trips with the
 * desktop @-mention menu):
 *
 *   [[item:UID|title]] / [[action:UID|title]]  → plan item/action chip (tappable)
 *   [[file:path|label]]                        → code file chip
 *   [[symbol:name@path|label]]                 → code symbol chip
 *   [[attach:uid|label]]                       → attachment chip
 *
 * Text segments render through the shared Markdown renderer; chips render as
 * coloured pills. item/action chips navigate to that item when planUid is known.
 */

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Markdown from './Markdown';

const CHIP_PATTERN = /\[\[(item|action|file|symbol|attach):([^\]|]+)\|([^\]]*)\]\]/gi;

type Chip =
  | { type: 'item' | 'action'; uid: string; label: string }
  | { type: 'file'; path: string; label: string }
  | { type: 'symbol'; name: string; filePath: string; label: string }
  | { type: 'attach'; uid: string; label: string };

type Segment = { kind: 'md'; source: string } | { kind: 'chips'; chips: Chip[] };

function parse(source: string): Segment[] {
  if (!source) return [];
  const segments: Segment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  CHIP_PATTERN.lastIndex = 0;

  const pushChip = (chip: Chip) => {
    const tail = segments[segments.length - 1];
    if (tail && tail.kind === 'chips') tail.chips.push(chip);
    else segments.push({ kind: 'chips', chips: [chip] });
  };

  while ((m = CHIP_PATTERN.exec(source)) !== null) {
    const [full, kindRaw, value, titleRaw] = m;
    if (m.index > last) {
      const md = source.slice(last, m.index);
      if (md.trim()) segments.push({ kind: 'md', source: md });
    }
    const kind = kindRaw.toLowerCase();
    const label = (titleRaw || '').trim();
    if (kind === 'item' || kind === 'action') {
      pushChip({ type: kind, uid: value, label: label || 'untitled' });
    } else if (kind === 'file') {
      pushChip({ type: 'file', path: value, label: label || value.split('/').pop() || 'file' });
    } else if (kind === 'symbol') {
      const at = value.indexOf('@');
      pushChip({
        type: 'symbol',
        name: at >= 0 ? value.slice(0, at) : value,
        filePath: at >= 0 ? value.slice(at + 1) : '',
        label: label || (at >= 0 ? value.slice(0, at) : value),
      });
    } else if (kind === 'attach') {
      pushChip({ type: 'attach', uid: value, label: label || 'attachment' });
    }
    last = m.index + full.length;
  }
  if (last < source.length) {
    const md = source.slice(last);
    if (md.trim()) segments.push({ kind: 'md', source: md });
  }
  return segments;
}

export default function MarkdownBody({
  source,
  planUid,
  compact,
}: {
  source: string;
  planUid?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const segments = parse(source);

  // Fast path — no chips at all.
  if (segments.length === 0) return null;
  if (segments.length === 1 && segments[0].kind === 'md') {
    return <Markdown compact={compact}>{segments[0].source}</Markdown>;
  }

  return (
    <View>
      {segments.map((seg, i) => {
        if (seg.kind === 'md') {
          return <Markdown key={i} compact={compact}>{seg.source}</Markdown>;
        }
        return (
          <View key={i} style={styles.chipRow}>
            {seg.chips.map((chip, j) => {
              const tappable = (chip.type === 'item' || chip.type === 'action') && !!planUid;
              const visual = chipVisual(chip);
              const body = (
                <>
                  <Text style={styles.chipIcon}>{visual.icon}</Text>
                  <Text style={[styles.chipLabel, { color: visual.fg }]} numberOfLines={1}>
                    {chip.label}
                  </Text>
                </>
              );
              if (tappable) {
                const uid = (chip as { uid: string }).uid;
                return (
                  <TouchableOpacity
                    key={j}
                    style={[styles.chip, { borderColor: visual.border, backgroundColor: visual.bg }]}
                    activeOpacity={0.7}
                    onPress={() => router.push(`/item-detail?uid=${uid}&planUid=${planUid}`)}
                  >
                    {body}
                  </TouchableOpacity>
                );
              }
              return (
                <View
                  key={j}
                  style={[styles.chip, { borderColor: visual.border, backgroundColor: visual.bg }]}
                >
                  {body}
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

function chipVisual(chip: Chip): { icon: string; fg: string; bg: string; border: string } {
  switch (chip.type) {
    case 'action':
      return { icon: '⚡', fg: '#3b82f6', bg: '#3b82f614', border: '#3b82f640' };
    case 'item':
      return { icon: '▢', fg: '#a1a1aa', bg: '#ffffff08', border: '#ffffff14' };
    case 'file':
      return { icon: chip.path.endsWith('/') ? '📁' : '📄', fg: '#34d399', bg: '#10b98114', border: '#10b98140' };
    case 'symbol':
      return { icon: '#', fg: '#22d3ee', bg: '#06b6d414', border: '#06b6d440' };
    case 'attach':
      return { icon: '📎', fg: '#a1a1aa', bg: '#ffffff08', border: '#ffffff14' };
  }
}

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginVertical: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 7,
    borderWidth: 1,
    maxWidth: '100%',
  },
  chipIcon: { fontSize: 11 },
  chipLabel: { fontSize: 13, fontWeight: '500', flexShrink: 1 },
});
