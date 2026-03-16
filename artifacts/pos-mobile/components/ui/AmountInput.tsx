import React, { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";

interface AmountInputProps {
  label: string;
  value: number;
  onChange: (cents: number) => void;
  disabled?: boolean;
}

export function AmountInput({
  label,
  value,
  onChange,
  disabled = false,
}: AmountInputProps) {
  const isDark = useColorScheme() === "dark";
  const theme = isDark ? Colors.dark : Colors.dark;

  const [rawStr, setRawStr] = useState("");

  const displayDollars = value > 0
    ? `$${(value / 100).toFixed(2)}`
    : "$0.00";

  const handleDigit = (digit: string) => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = rawStr + digit;
    if (next.length > 8) return;
    const cents = parseInt(next, 10);
    setRawStr(next);
    onChange(cents);
  };

  const handleBackspace = () => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (rawStr.length === 0) return;
    const next = rawStr.slice(0, -1);
    setRawStr(next);
    const cents = next.length > 0 ? parseInt(next, 10) : 0;
    onChange(cents);
  };

  const handleClear = () => {
    if (disabled) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setRawStr("");
    onChange(0);
  };

  const keys: [string, string, string][] = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    [".", "0", "DEL"],
  ];

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
      <Text
        style={[styles.amount, { color: theme.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {displayDollars}
      </Text>

      <View style={styles.keypad}>
        {keys.map((row, ri) => (
          <View key={ri} style={styles.row}>
            {row.map((key) => {
              const isBack = key === "DEL";
              const isDot = key === ".";
              return (
                <Pressable
                  key={key}
                  onPress={() => {
                    if (isBack) handleBackspace();
                    else if (isDot) {
                    } else handleDigit(key);
                  }}
                  onLongPress={isBack ? handleClear : undefined}
                  style={({ pressed }) => [
                    styles.key,
                    {
                      backgroundColor: pressed
                        ? theme.border
                        : theme.surfaceElevated,
                      opacity: disabled ? 0.4 : 1,
                    },
                  ]}
                  disabled={disabled}
                >
                  <Text
                    style={[
                      isBack ? styles.keyTextBack : styles.keyText,
                      { color: isBack ? Colors.danger : theme.text },
                    ]}
                  >
                    {isBack ? "⌫" : key}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    width: "100%",
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  amount: {
    fontSize: 56,
    fontFamily: "Inter_700Bold",
    letterSpacing: -2,
    marginBottom: 32,
    paddingHorizontal: 16,
  },
  keypad: {
    width: "100%",
    gap: 10,
  },
  row: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
  },
  key: {
    flex: 1,
    height: 64,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    maxWidth: 110,
  },
  keyText: {
    fontSize: 24,
    fontFamily: "Inter_600SemiBold",
  },
  keyTextBack: {
    fontSize: 22,
    fontFamily: "Inter_600SemiBold",
  },
});
