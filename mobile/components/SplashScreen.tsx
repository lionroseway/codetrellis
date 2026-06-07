/**
 * Animated splash screen — CodeTrellis branding.
 *
 * Shows the CodeTrellis logo mark (trellis-inspired grid icon),
 * wordmark, and tagline with staggered fade-in animations, then
 * fades out to reveal the main app.
 */

import { useEffect, useRef } from 'react';
import {
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

      {/* Logo mark — the real CodeTrellis node-graph icon, scaling/fading in */}
      <Animated.Image
        source={require('../assets/icon.png')}
        resizeMode="contain"
        style={[
          styles.logo,
          {
            opacity: logoOpacity,
            transform: [{ scale: logoScale }],
          },
        ]}
      />

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
    width: width * 0.8,
    height: width * 0.8,
    borderRadius: width * 0.4,
    backgroundColor: '#3b82f6',
    opacity: 0.09,
  },

  // Logo — the node-graph app icon
  logo: {
    width: width * 0.52,
    height: width * 0.52,
    marginBottom: 6,
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
