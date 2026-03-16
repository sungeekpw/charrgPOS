import React, { useEffect } from "react";
import { StyleSheet, Text, useColorScheme, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import type { SDKEventType } from "@/services/nexgo-sdk";

interface CardReaderStatusProps {
  event: SDKEventType | null;
  isReading: boolean;
}

function getStatusInfo(event: SDKEventType | null) {
  switch (event) {
    case "reading_started":
      return { icon: "contactless-payment", text: "Present card to reader", color: Colors.primary };
    case "card_inserted":
      return { icon: "credit-card-chip", text: "Card inserted — reading...", color: Colors.primary };
    case "card_swiped":
      return { icon: "credit-card-scan", text: "Card swiped — processing...", color: Colors.primary };
    case "card_tapped":
      return { icon: "contactless-payment", text: "Card detected — processing...", color: Colors.primary };
    case "pin_requested":
      return { icon: "lock-outline", text: "Enter PIN on device", color: Colors.warning };
    case "pin_entered":
      return { icon: "lock-check-outline", text: "PIN accepted", color: Colors.success };
    case "reading_complete":
      return { icon: "check-circle-outline", text: "Card read complete", color: Colors.success };
    case "reading_failed":
      return { icon: "alert-circle-outline", text: "Card read failed", color: Colors.danger };
    case "timeout":
      return { icon: "clock-alert-outline", text: "Timed out — try again", color: Colors.danger };
    default:
      return { icon: "contactless-payment", text: "Tap, insert, or swipe card", color: Colors.primary };
  }
}

export function CardReaderStatus({ event, isReading }: CardReaderStatusProps) {
  const isDark = useColorScheme() === "dark";
  const theme = Colors.dark;
  const { icon, text, color } = getStatusInfo(event);

  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (isReading && event !== "reading_complete" && event !== "reading_failed") {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.08, { duration: 700, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) })
        ),
        -1
      );
      opacity.value = withRepeat(
        withSequence(
          withTiming(0.7, { duration: 700 }),
          withTiming(1, { duration: 700 })
        ),
        -1
      );
    } else {
      scale.value = withTiming(1, { duration: 300 });
      opacity.value = withTiming(1, { duration: 300 });
    }
  }, [isReading, event]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.iconRing,
          { borderColor: color + "40", backgroundColor: color + "15" },
          animStyle,
        ]}
      >
        <MaterialCommunityIcons name={icon as any} size={52} color={color} />
      </Animated.View>
      <Text style={[styles.statusText, { color: theme.text }]}>{text}</Text>
      {isReading && event !== "reading_complete" && event !== "reading_failed" && (
        <Text style={[styles.subText, { color: theme.textSecondary }]}>
          Do not remove card
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 16,
  },
  iconRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  statusText: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  subText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});
