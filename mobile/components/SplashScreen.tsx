/**
 * Animated splash — CodeTrellis branding.
 *
 * The app-icon tile (the node-graph mark, as a rounded square) scales + fades
 * in over a soft, continuously pulsing glow — a diffused box-shadow that
 * breathes outward — with the CodeTrellis wordmark + tagline beneath. Holds a
 * beat, then fades to reveal the app.
 */

import { useEffect, useRef } from 'react';
import {
  Text,
  Animated,
  StyleSheet,
  Dimensions,
  Easing,
} from 'react-native';

const { width } = Dimensions.get('window');
const LOGO = Math.min(width * 0.42, 190);

interface SplashScreenProps {
  onFinish: () => void;
}

export default function SplashScreen({ onFinish }: SplashScreenProps) {
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.86)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslateY = useRef(new Animated.Value(12)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const glowPulse = useRef(new Animated.Value(0)).current;
  const overallOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Continuous soft glow pulse behind the logo tile.
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(glowPulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glowPulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    pulse.start();

    // Staggered entrance, then fade out.
    Animated.sequence([
      Animated.parallel([
        Animated.timing(logoOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(logoScale, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(titleOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(titleTranslateY, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]),
      Animated.timing(taglineOpacity, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.delay(700),
      Animated.timing(overallOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start(() => {
      pulse.stop();
      onFinish();
    });
  }, []);

  const glowOpacity = glowPulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.5] });
  const glowScale = glowPulse.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.14] });

  return (
    <Animated.View style={[styles.container, { opacity: overallOpacity }]}>
      <Animated.View style={styles.logoWrap}>
        {/* Diffused, pulsing glow behind the tile (soft box-shadow halo). */}
        <Animated.View
          style={[styles.glow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]}
        />
        {/* App-icon tile — the node-graph mark as a rounded square. */}
        <Animated.Image
          source={require('../assets/icon.png')}
          resizeMode="cover"
          style={[styles.logo, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}
        />
      </Animated.View>

      {/* Wordmark */}
      <Animated.View style={{ opacity: titleOpacity, transform: [{ translateY: titleTranslateY }] }}>
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
  logoWrap: {
    width: LOGO,
    height: LOGO,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  // Soft diffused glow — a rounded square with a big blur, NOT a hard circle.
  glow: {
    position: 'absolute',
    width: LOGO,
    height: LOGO,
    borderRadius: LOGO * 0.26,
    backgroundColor: '#3b82f6',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 44,
    elevation: 24,
  },
  // The icon tile — rounded-square (iOS squircle-ish).
  logo: {
    width: LOGO,
    height: LOGO,
    borderRadius: LOGO * 0.225,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  titleCode: { color: '#fafafa' },
  titleTrellis: { color: '#3b82f6' },
  tagline: {
    color: '#52525b',
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
});
