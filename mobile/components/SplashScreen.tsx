/**
 * Animated splash screen — CodeTrellis branding.
 *
 * Shows the CodeTrellis logo mark (trellis-inspired grid icon),
 * wordmark, and tagline with staggered fade-in animations, then
 * fades out to reveal the main app.
 */

import { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Animated,
  StyleSheet,
  Dimensions,
} from 'react-native';

const { width } = Dimensions.get('window');

interface SplashScreenProps {
  onFinish: () => void;
}

export default function SplashScreen({ onFinish }: SplashScreenProps) {
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslateY = useRef(new Animated.Value(12)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const overallOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Staggered entrance
    Animated.sequence([
      // 1. Glow appears
      Animated.timing(glowOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      // 2. Logo fades in + scales up
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          tension: 60,
          friction: 8,
          useNativeDriver: true,
        }),
      ]),
      // 3. Title slides up
      Animated.parallel([
        Animated.timing(titleOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(titleTranslateY, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
      // 4. Tagline
      Animated.timing(taglineOpacity, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }),
      // 5. Hold for a beat
      Animated.delay(600),
      // 6. Fade everything out
      Animated.timing(overallOpacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onFinish();
    });
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity: overallOpacity }]}>
      {/* Background glow */}
      <Animated.View style={[styles.glow, { opacity: glowOpacity }]} />

      {/* Logo mark — trellis grid */}
      <Animated.View
        style={[
          styles.logoContainer,
          {
            opacity: logoOpacity,
            transform: [{ scale: logoScale }],
          },
        ]}
      >
        <View style={styles.trellisGrid}>
          {/* 3x3 grid of nodes with connecting lines implied by layout */}
          <View style={styles.trellisRow}>
            <View style={[styles.trellisNode, styles.nodeAccent]} />
            <View style={styles.trellisConnector} />
            <View style={[styles.trellisNode, styles.nodeDim]} />
            <View style={styles.trellisConnector} />
            <View style={[styles.trellisNode, styles.nodeAccent]} />
          </View>
          <View style={styles.trellisVerticals}>
            <View style={styles.trellisVertLine} />
            <View style={{ width: 24 }} />
            <View style={[styles.trellisVertLine, { backgroundColor: '#3b82f620' }]} />
            <View style={{ width: 24 }} />
            <View style={styles.trellisVertLine} />
          </View>
          <View style={styles.trellisRow}>
            <View style={[styles.trellisNode, styles.nodeDim]} />
            <View style={[styles.trellisConnector, { backgroundColor: '#3b82f620' }]} />
            <View style={[styles.trellisNode, styles.nodeHighlight]} />
            <View style={[styles.trellisConnector, { backgroundColor: '#3b82f620' }]} />
            <View style={[styles.trellisNode, styles.nodeDim]} />
          </View>
          <View style={styles.trellisVerticals}>
            <View style={[styles.trellisVertLine, { backgroundColor: '#3b82f620' }]} />
            <View style={{ width: 24 }} />
            <View style={styles.trellisVertLine} />
            <View style={{ width: 24 }} />
            <View style={[styles.trellisVertLine, { backgroundColor: '#3b82f620' }]} />
          </View>
          <View style={styles.trellisRow}>
            <View style={[styles.trellisNode, styles.nodeAccent]} />
            <View style={styles.trellisConnector} />
            <View style={[styles.trellisNode, styles.nodeDim]} />
            <View style={styles.trellisConnector} />
            <View style={[styles.trellisNode, styles.nodeAccent]} />
          </View>
        </View>
      </Animated.View>

      {/* Wordmark */}
      <Animated.View
        style={{
          opacity: titleOpacity,
          transform: [{ translateY: titleTranslateY }],
        }}
      >
        <Text style={styles.title}>
          <Text style={styles.titleCode}>Code</Text>
          <Text style={styles.titleTrellis}>Trellis</Text>
        </Text>
      </Animated.View>

      {/* Tagline */}
      <Animated.Text style={[styles.tagline, { opacity: taglineOpacity }]}>
        See what your agents are building
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#09090b',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },

  // Background glow
  glow: {
    position: 'absolute',
    width: width * 0.6,
    height: width * 0.6,
    borderRadius: width * 0.3,
    backgroundColor: '#3b82f6',
    opacity: 0.06,
  },

  // Logo
  logoContainer: {
    marginBottom: 28,
  },
  trellisGrid: {
    alignItems: 'center',
  },
  trellisRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trellisNode: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  nodeAccent: {
    backgroundColor: '#3b82f6',
  },
  nodeHighlight: {
    backgroundColor: '#60a5fa',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  nodeDim: {
    backgroundColor: '#3b82f640',
  },
  trellisConnector: {
    width: 24,
    height: 2,
    backgroundColor: '#3b82f650',
    marginHorizontal: 2,
  },
  trellisVerticals: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 20,
  },
  trellisVertLine: {
    width: 2,
    height: 20,
    backgroundColor: '#3b82f650',
  },

  // Title
  title: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  titleCode: {
    color: '#fafafa',
  },
  titleTrellis: {
    color: '#3b82f6',
  },

  // Tagline
  tagline: {
    color: '#52525b',
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
});
