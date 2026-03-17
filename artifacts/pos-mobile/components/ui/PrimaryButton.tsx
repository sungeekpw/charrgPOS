import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Colors from "@/constants/colors";

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  danger?: boolean;
  secondary?: boolean;
  icon?: React.ReactNode;
}

export function PrimaryButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  danger = false,
  secondary = false,
  icon,
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading;
  const theme = Colors.dark;

  if (secondary) {
    return (
      <Pressable
        onPress={onPress}
        disabled={isDisabled}
        style={({ pressed }) => [
          styles.secondary,
          {
            backgroundColor: pressed ? theme.border : theme.surfaceElevated,
            opacity: isDisabled ? 0.6 : 1,
          },
        ]}
      >
        {icon && <View style={styles.iconWrap}>{icon}</View>}
        <Text style={[styles.secondaryText, { color: theme.text }]}>{label}</Text>
      </Pressable>
    );
  }

  const gradStart = danger ? Colors.danger : Colors.primary;
  const gradEnd   = danger ? "#C0392B" : Colors.primaryDark;

  const innerContent = (
    <>
      {loading ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <>
          {icon && <View style={styles.iconWrap}>{icon}</View>}
          <Text style={styles.primaryText}>{label}</Text>
        </>
      )}
    </>
  );

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.wrapper,
        { opacity: isDisabled ? 0.6 : pressed ? 0.85 : 1 },
      ]}
    >
      {Platform.OS === "web" ? (
        <View style={[styles.gradient, { backgroundColor: gradStart }]}>
          {innerContent}
        </View>
      ) : (
        <LinearGradient
          colors={[gradStart, gradEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          {innerContent}
        </LinearGradient>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: 16,
    overflow: "hidden",
    minHeight: 56,
  },
  gradient: {
    flex: 1,
    minHeight: 56,
    paddingVertical: 18,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  primaryText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    letterSpacing: 0.3,
  },
  secondary: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  secondaryText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  iconWrap: {
    marginRight: 2,
  },
});
