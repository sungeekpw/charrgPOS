import React, { useEffect, useRef, useState } from "react";
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";
import Colors from "@/constants/colors";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface AmountInputProps {
  label: string;
  value: number;
  onChange: (cents: number) => void;
  disabled?: boolean;
  onKeypadToggle?: (visible: boolean) => void;
}

export function AmountInput({
  label,
  value,
  onChange,
  disabled = false,
  onKeypadToggle,
}: AmountInputProps) {
  const theme = Colors.dark;
  const inputRef = useRef<TextInput>(null);

  const [rawStr, setRawStr] = useState("");
  const [keypadVisible, setKeypadVisible] = useState(false);

  // Auto-focus the hidden input so hardware keypad works immediately
  useEffect(() => {
    if (!disabled) {
      const timer = setTimeout(() => inputRef.current?.focus(), 300);
      return () => clearTimeout(timer);
    }
  }, [disabled]);

  // Sync rawStr if parent resets value to 0 (e.g. clear button)
  useEffect(() => {
    if (value === 0) setRawStr("");
  }, [value]);

  const displayDollars = value > 0
    ? `$${(value / 100).toFixed(2)}`
    : "$0.00";

  // Handle input from EITHER the hidden TextInput (hardware keypad)
  // or the on-screen key buttons
  const applyDigits = (digits: string) => {
    if (digits.length > 8) return;
    setRawStr(digits);
    const cents = digits.length > 0 ? parseInt(digits, 10) : 0;
    onChange(cents);
  };

  // Called when hardware keypad types into the hidden TextInput
  const handleTextChange = (text: string) => {
    if (disabled) return;
    // Strip anything that isn't a digit
    const digits = text.replace(/\D/g, "");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    applyDigits(digits);
  };

  // On-screen keypad handlers
  const handleDigit = (digit: string) => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    applyDigits(rawStr + digit);
  };

  const handleBackspace = () => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    applyDigits(rawStr.slice(0, -1));
  };

  const handleClear = () => {
    if (disabled) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    applyDigits("");
  };

  const toggleKeypad = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const next = !keypadVisible;
    setKeypadVisible(next);
    onKeypadToggle?.(next);
    // Keep focus on hidden input so hardware keypad still works
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const keys: [string, string, string][] = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    [".", "0", "DEL"],
  ];

  return (
    <View style={styles.container}>
      {/* Hidden TextInput — receives hardware keypad input */}
      <TextInput
        ref={inputRef}
        value={rawStr}
        onChangeText={handleTextChange}
        keyboardType="numeric"
        showSoftInputOnFocus={false}
        caretHidden
        editable={!disabled}
        style={styles.hiddenInput}
        // Prevent web from showing a cursor box
        {...(Platform.OS === "web" ? { tabIndex: -1 } as any : {})}
      />

      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>

      {/* Tapping the amount re-focuses the hidden input */}
      <Pressable onPress={() => inputRef.current?.focus()}>
        <Text
          style={[styles.amount, { color: theme.text }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {displayDollars}
        </Text>
      </Pressable>

      {keypadVisible && (
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
                        // decimal not needed for cents entry
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
      )}

      <Pressable
        onPress={toggleKeypad}
        style={[styles.toggleBtn, { borderColor: theme.border }]}
      >
        <Feather
          name={keypadVisible ? "chevron-up" : "grid"}
          size={15}
          color={theme.textSecondary}
        />
        <Text style={[styles.toggleLabel, { color: theme.textSecondary }]}>
          {keypadVisible ? "Hide Keypad" : "Show Keypad"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    width: "100%",
  },
  // Invisible but focusable — receives hardware keyboard input
  hiddenInput: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    top: 0,
    left: 0,
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
    marginBottom: 24,
    paddingHorizontal: 16,
  },
  keypad: {
    width: "100%",
    gap: 10,
    marginBottom: 12,
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
  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 4,
  },
  toggleLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
});
