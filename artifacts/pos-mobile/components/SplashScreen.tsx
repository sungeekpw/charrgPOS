import React, { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";

const { width } = Dimensions.get("window");
const LOGO_W = Math.min(width * 0.62, 300);
const LOGO_H = LOGO_W * 0.32;

const native = Platform.OS !== "web";

interface Props {
  onDone: () => void;
}

export function AppSplashScreen({ onDone }: Props) {
  const containerOpacity = useRef(new Animated.Value(1)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(0.5)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.88)).current;
  const subtitleOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      // 1. Glow ring blooms in
      Animated.parallel([
        Animated.timing(ringOpacity, {
          toValue: 0.22,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: native,
        }),
        Animated.timing(ringScale, {
          toValue: 1,
          duration: 480,
          easing: Easing.out(Easing.back(1.4)),
          useNativeDriver: native,
        }),
      ]),
      // 2. Logo fades + scales in
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: native,
        }),
        Animated.timing(logoScale, {
          toValue: 1,
          duration: 440,
          easing: Easing.out(Easing.back(1.2)),
          useNativeDriver: native,
        }),
      ]),
      // 3. Subtitle slides in
      Animated.timing(subtitleOpacity, {
        toValue: 1,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: native,
      }),
      // 4. Hold
      Animated.delay(1000),
      // 5. Fade everything out
      Animated.timing(containerOpacity, {
        toValue: 0,
        duration: 380,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: native,
      }),
    ]).start(() => onDone());
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity: containerOpacity }]}>
      {/* Outer glow */}
      <Animated.View
        style={[
          styles.glowOuter,
          { opacity: ringOpacity, transform: [{ scale: ringScale }] },
        ]}
      />
      {/* Inner glow */}
      <Animated.View
        style={[
          styles.glowInner,
          {
            opacity: Animated.multiply(ringOpacity, new Animated.Value(0.6)),
            transform: [{ scale: ringScale }],
          },
        ]}
      />

      {/* Charrg logo */}
      <Animated.View
        style={{
          opacity: logoOpacity,
          transform: [{ scale: logoScale }],
          alignItems: "center",
          zIndex: 2,
        }}
      >
        <Image
          source={require("../assets/images/charrg-logo-color.png")}
          style={{ width: LOGO_W, height: LOGO_H }}
          resizeMode="contain"
        />
      </Animated.View>

      {/* Tagline */}
      <Animated.View
        style={{
          opacity: subtitleOpacity,
          alignItems: "center",
          marginTop: 28,
          zIndex: 2,
        }}
      >
        <View style={styles.divider} />
        <Text style={styles.subtitle}>POINT OF SALE</Text>
        <Text style={styles.version}>NexGo · Powered by Charrg</Text>
      </Animated.View>

      {/* Footer strip */}
      <Animated.View
        style={[styles.footer, { opacity: subtitleOpacity }]}
      >
        <View style={styles.dot} />
        <Text style={styles.footerText}>charrg.com</Text>
        <View style={styles.dot} />
      </Animated.View>
    </Animated.View>
  );
}

const BG = "#0D0D14";
const TEAL = "#00C896";
const BLUE = "#4A9FE8";

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
  },
  glowOuter: {
    position: "absolute",
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: BLUE,
  },
  glowInner: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: TEAL,
  },
  divider: {
    width: 40,
    height: 2,
    backgroundColor: TEAL,
    marginBottom: 12,
    borderRadius: 2,
    opacity: 0.7,
  },
  subtitle: {
    fontSize: 11,
    letterSpacing: 4,
    color: "#FFFFFF",
    fontFamily: Platform.OS === "web" ? "sans-serif" : "Inter_600SemiBold",
    opacity: 0.5,
    marginBottom: 6,
  },
  version: {
    fontSize: 12,
    color: TEAL,
    fontFamily: Platform.OS === "web" ? "sans-serif" : "Inter_400Regular",
    opacity: 0.8,
    letterSpacing: 0.4,
  },
  footer: {
    position: "absolute",
    bottom: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: TEAL,
    opacity: 0.4,
  },
  footerText: {
    fontSize: 11,
    color: "#FFFFFF",
    fontFamily: Platform.OS === "web" ? "sans-serif" : "Inter_400Regular",
    opacity: 0.28,
    letterSpacing: 1,
  },
});
