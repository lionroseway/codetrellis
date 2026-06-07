/**
 * AnimatedBackground — a subtle "living graph" that sits behind content.
 *
 * Echoes the CodeTrellis node-graph mark (and the desktop graph view): a
 * handful of softly-glowing nodes drift and pulse slowly at low opacity over
 * the dark base. Purely decorative — `pointerEvents="none"` so it never eats
 * touches — and built on the native-driver `Animated` API (transform/opacity
 * only) so it stays cheap on the GPU and easy on the battery.
 */

import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Dimensions, Easing, View } from 'react-native';

const { width, height } = Dimensions.get('window');

type NodeSpec = {
  x: number; // 0..1 of width
  y: number; // 0..1 of height
  size: number;
  color: string;
  dx: number; // px drift
  dy: number;
  period: number; // ms for a full drift cycle
  minOpacity: number;
  maxOpacity: number;
};

// Deterministic layout — blue/purple to match the brand mark.
const NODES: NodeSpec[] = [
  { x: 0.14, y: 0.16, size: 10, color: '#3b82f6', dx: 14, dy: 20, period: 7000, minOpacity: 0.06, maxOpacity: 0.18 },
  { x: 0.84, y: 0.10, size: 7, color: '#a855f7', dx: -18, dy: 16, period: 9000, minOpacity: 0.05, maxOpacity: 0.16 },
  { x: 0.52, y: 0.26, size: 16, color: '#60a5fa', dx: 10, dy: -14, period: 8000, minOpacity: 0.08, maxOpacity: 0.22 },
  { x: 0.24, y: 0.46, size: 8, color: '#3b82f6', dx: 16, dy: 12, period: 10000, minOpacity: 0.05, maxOpacity: 0.15 },
  { x: 0.78, y: 0.40, size: 11, color: '#818cf8', dx: -12, dy: -18, period: 7500, minOpacity: 0.06, maxOpacity: 0.18 },
  { x: 0.42, y: 0.62, size: 9, color: '#a855f7', dx: -14, dy: 14, period: 8500, minOpacity: 0.05, maxOpacity: 0.16 },
  { x: 0.88, y: 0.70, size: 7, color: '#3b82f6', dx: -10, dy: -12, period: 9500, minOpacity: 0.04, maxOpacity: 0.14 },
  { x: 0.12, y: 0.74, size: 12, color: '#60a5fa', dx: 18, dy: -16, period: 8000, minOpacity: 0.06, maxOpacity: 0.18 },
  { x: 0.6, y: 0.86, size: 8, color: '#818cf8', dx: 12, dy: 18, period: 9000, minOpacity: 0.05, maxOpacity: 0.15 },
];

function GraphNode({ node }: { node: NodeSpec }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, {
          toValue: 1,
          duration: node.period,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(t, {
          toValue: 0,
          duration: node.period,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t, node.period]);

  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [0, node.dx] });
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, node.dy] });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [node.minOpacity, node.maxOpacity] });

  return (
    <Animated.View
      style={[
        styles.node,
        {
          left: node.x * width,
          top: node.y * height,
          width: node.size,
          height: node.size,
          borderRadius: node.size / 2,
          backgroundColor: node.color,
          shadowColor: node.color,
          shadowRadius: node.size * 2.2,
          transform: [{ translateX }, { translateY }],
          opacity,
        },
      ]}
    />
  );
}

export default function AnimatedBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {NODES.map((n, i) => (
        <GraphNode key={i} node={n} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  node: {
    position: 'absolute',
    // Soft glow (iOS); Android renders a flat dot, which is fine at this opacity.
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
  },
});
