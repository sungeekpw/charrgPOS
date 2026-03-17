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
import {
  isSDKAvailable,
  startKeypadListener,
  stopKeypadListener,
  subscribeKeypadInput,
} from "@/services/nexgo-sdk";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
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
  const sdkActive = isSDKAvailable(); // true only on a real NexGo standalone build

  const [rawStr, setRawStr] = useState("");
  const [keypadVisible, setKeypadVisible] = useState(false);

  // ── Sync rawStr when parent resets value to 0 ──────────────────────────────
  useEffect(() => {
    if (value === 0) setRawStr("");
  }, [value]);

  // ── Apply digits (shared by all input paths) ───────────────────────────────
  const applyDigits = (digits: string) => {
    if (digits.length > 8) return;
    setRawStr(digits);
    onChange(digits.length > 0 ? parseInt(digits, 10) : 0);
  };

  // ── Path A: NexGo hardware keypad (native SDK available) ───────────────────
  // Hooks into the Activity's Window.Callback via the native module so that
  // physical key presses are forwarded as JS events — no TextInput needed.
  useEffect(() => {
    if (!sdkActive || disabled) return;

    let unsubscribe: () => void = () => {};
    startKeypadListener().then(() => {
      unsubscribe = subscribeKeypadInput((key) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setRawStr((prev) => {
          if (key === "BACKSPACE") {
            const next = prev.slice(0, -1);
            onChange(next.length > 0 ? parseInt(next, 10) : 0);
            return next;
          }
          if (key === "CLEAR") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            onChange(0);
            return "";
          }
          if (key === "ENTER") return prev; // handled by Pay Now button
          // digit
          if (prev.length >= 8) return prev;
          const next = prev + key;
          onChange(parseInt(next, 10));
          return next;
        });
      });
    });

    return () => {
      unsubscribe();
      stopKeypadListener();
    };
  }, [sdkActive, disabled]);

  // ── Path B: TextInput fallback (web / non-NexGo Android) ──────────────────
  // Hidden, auto-focused TextInput that receives hardware keyboard events when
  // the native SDK is not available (web preview or Expo Go).
  useEffect(() => {
    if (sdkActive || disabled) return; // SDK handles it instead
    const timer = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, [sdkActive, disabled]);

  const handleTextChange = (text: string) => {
    if (disabled || sdkActive) return;
    const digits = text.replace(/\D/g, "");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    applyDigits(digits);
  };

  // ── On-screen keypad ────────────────────────────────────────────────────────
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
    if (!sdkActive) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const displayDollars =
    value > 0 ? `$${(value / 100).toFixed(2)}` : "$0.00";

  const keys: [string, string, string][] = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    [".", "0", "DEL"],
  ];

  return (
    <View style={styles.container}>
      {/* TextInput fallback — only rendered when native SDK is not available */}
      {!sdkActive && (
        <TextInput
          ref={inputRef}
          value={rawStr}
          onChangeText={handleTextChange}
          keyboardType="numeric"
          showSoftInputOnFocus={false}
          caretHidden
          editable={!disabled}
          style={styles.hiddenInput}
          {...(Platform.OS === "web" ? ({ tabIndex: -1 } as any) : {})}
        />
      )}

      <Text style={[styles.label, { color: theme.textSecondary }]}>
        {label}
      </Text>

      {/* Tapping amount re-focuses hidden input (fallback path only) */}
      <Pressable
        onPress={() => {
          if (!sdkActive) inputRef.current?.focus();
        }}
      >
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
                return (
                  <Pressable
                    key={key}
                    onPress={() => {
                      if (isBack) handleBackspace();
                      else if (key !== ".") handleDigit(key);
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
