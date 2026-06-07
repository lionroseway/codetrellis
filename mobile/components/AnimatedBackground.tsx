/**
 * AnimatedBackground — desktop-graph-inspired ambience behind the whole app.
 *
 * Two layers, matching the desktop graph canvas:
 *   1. A blue dot-grid, mirroring the desktop's ReactFlow background
 *      (`<Background color="rgba(59,130,246,0.06)" gap={24} size={1} />`).
 *   2. A few large, *feathered* glows anchored to the corners/edges that slowly
 *      breathe in and out on staggered loops — built from stacked concentric
 *      rings so the falloff is a soft radial gradient (no hard disc edge).
 *
 * Rendered once globally (root layout) behind transparent screens, so the grid
 * is paid for once. Native-driver opacity/scale only; pointerEvents none.
 */

import { useEffect, useRef, useMemo } from 'react';
import { Animated, StyleSheet, Dimensions, Easing, View } from 'react-native';

const { width, height } = Dimensions.get('window');

// --- Feathered corner/edge glows ---------------------------------------------

type Glow = {
  x: number; // fraction of width (can be <0 / >1 to anchor off the edge)
  y: number; // fraction of height
  size: number; // fraction of width
  color: string;
  period: number; // ms for a full in/out breath
  delay: number;
  max: number; // peak group opacity
};

const GLOWS: Glow[] = [
  { x: -0.25, y: -0.12, size: 0.95, color: '#3b82f6', period: 9000, delay: 0, max: 0.95 },    // top-left
  { x: 0.78, y: -0.18, size: 0.8, color: '#a855f7', period: 11000, delay: 2600, max: 0.7 },   // top-right
  { x: 0.9, y: 0.45, size: 0.85, color: '#3b82f6', period: 10000, delay: 1300, max: 0.6 },    // right edge
  { x: -0.3, y: 0.7, size: 1.0, color: '#818cf8', period: 12000, delay: 3600, max: 0.75 },    // bottom-left
  { x: 0.55, y: 1.05, size: 0.8, color: '#a855f7', period: 10500, delay: 700, max: 0.6 },     // bottom edge
];

// Concentric ring radii (outer → inner). Each ring is faint; overlapping them
// builds a smooth radial falloff — a feathered glow rather than a hard disc.
const RING_FRACS = [1.0, 0.84, 0.68, 0.53, 0.4, 0.28, 0.17];
const RING_OPACITY = 0.02;

function SoftGlow({ g }: { g: Glow }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(g.delay),
        Animated.timing(t, { toValue: 1, duration: g.period / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: g.period / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t, g.delay, g.period]);

  const d = width * g.size;
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0, g.max] });
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.08] });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: g.x * width,
        top: g.y * height,
        width: d,
        height: d,
        opacity,
        transform: [{ scale }],
      }}
    >
      {RING_FRACS.map((f, i) => {
        const rd = d * f;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: (d - rd) / 2,
              top: (d - rd) / 2,
              width: rd,
              height: rd,
              borderRadius: rd / 2,
              backgroundColor: g.color,
              opacity: RING_OPACITY,
            }}
          />
        );
      })}
    </Animated.View>
  );
}

// --- Blue dot-grid (matches the desktop graph canvas) ------------------------

const DOT_SPACING = 26; // desktop uses gap=24
const DOT = 1.4;
const DOT_COLOR = 'rgba(59, 130, 246, 0.08)';

function DotGrid() {
  const dots = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    for (let y = DOT_SPACING; y < height; y += DOT_SPACING) {
      for (let x = DOT_SPACING; x < width; x += DOT_SPACING) {
        out.push({ x, y });
      }
    }
    return out;
  }, []);

  return (
    <View style={StyleSheet.absoluteFill}>
      {dots.map((p, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: p.x,
            top: p.y,
            width: DOT,
            height: DOT,
            borderRadius: DOT / 2,
            backgroundColor: DOT_COLOR,
          }}
        />
      ))}
    </View>
  );
}

export default function AnimatedBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <DotGrid />
      {GLOWS.map((g, i) => (
        <SoftGlow key={i} g={g} />
      ))}
    </View>
  );
}
