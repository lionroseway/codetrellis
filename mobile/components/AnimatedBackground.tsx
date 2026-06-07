/**
 * AnimatedBackground — desktop-graph-inspired ambience behind the whole app.
 *
 * Two layers, echoing the desktop graph canvas:
 *   1. A faint static dot-grid (graph-paper texture).
 *   2. A few large, very soft glows anchored to the corners/edges that slowly
 *      breathe in and out on staggered loops — so glows "appear now and then".
 *
 * Rendered once globally (in the root layout) behind transparent screens, so
 * the dot grid's cost is paid a single time. Native-driver opacity/scale only;
 * `pointerEvents="none"` so it never intercepts touches.
 */

import { useEffect, useRef, useMemo } from 'react';
import { Animated, StyleSheet, Dimensions, Easing, View } from 'react-native';

const { width, height } = Dimensions.get('window');

// --- Soft corner/edge glows --------------------------------------------------

type Glow = {
  x: number; // fraction of width (can be <0 / >1 to anchor off the edge)
  y: number; // fraction of height
  size: number; // fraction of width
  color: string;
  period: number; // ms for a full in/out breath
  delay: number;
  max: number; // peak opacity
};

const GLOWS: Glow[] = [
  { x: -0.18, y: -0.06, size: 0.75, color: '#3b82f6', period: 9000, delay: 0, max: 0.16 },   // top-left
  { x: 0.82, y: -0.12, size: 0.62, color: '#a855f7', period: 11000, delay: 2600, max: 0.12 }, // top-right
  { x: 0.9, y: 0.5, size: 0.66, color: '#3b82f6', period: 10000, delay: 1300, max: 0.11 },    // right edge
  { x: -0.22, y: 0.72, size: 0.78, color: '#818cf8', period: 12000, delay: 3600, max: 0.13 }, // bottom-left
  { x: 0.62, y: 1.02, size: 0.6, color: '#a855f7', period: 10500, delay: 700, max: 0.11 },    // bottom edge
];

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
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1.06] });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: g.x * width,
        top: g.y * height,
        width: d,
        height: d,
        borderRadius: d / 2,
        backgroundColor: g.color,
        shadowColor: g.color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.9,
        shadowRadius: 60,
        opacity,
        transform: [{ scale }],
      }}
    />
  );
}

// --- Faint dot-grid texture --------------------------------------------------

const DOT_SPACING = 34;
const DOT = 1.5;

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
            backgroundColor: '#ffffff',
            opacity: 0.04,
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
