import React, { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";

const TIP_PRESETS = [0, 15, 18, 20, 25];

interface TipSelectorProps {
  baseAmountCents: number;
  onTipChange: (tipCents: number) => void;
  disabled?: boolean;
}

export function TipSelector({
  baseAmountCents,
  onTipChange,
  disabled = false,
}: TipSelectorProps) {
  const isDark = useColorScheme() === "dark";
  const theme = isDark ? Colors.dark : Colors.dark;
  const [selectedPct, setSelectedPct] = useState<number | null>(0);
  const [customStr, setCustomStr] = useState("");
  const [isCustom, setIsCustom] = useState(false);

  const handlePreset = (pct: number) => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedPct(pct);
    setIsCustom(false);
    setCustomStr("");
    const tip = Math.round(baseAmountCents * (pct / 100));
    onTipChange(tip);
  };

  const handleCustom = () => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedPct(null);
    setIsCustom(true);
  };

  const handleCustomChange = (val: string) => {
    const cleaned = val.replace(/[^0-9.]/g, "");
    setCustomStr(cleaned);
    const parsed = parseFloat(cleaned);
    if (!isNaN(parsed)) {
      onTipChange(Math.round(parsed * 100));
    } else {
      onTipChange(0);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: theme.textSecondary }]}>Tip</Text>
      <View style={styles.presets}>
        {TIP_PRESETS.map((pct) => {
          const isSelected = !isCustom && selectedPct === pct;
          const tipCents = Math.round(baseAmountCents * (pct / 100));
          return (
            <Pressable
              key={pct}
              onPress={() => handlePreset(pct)}
              disabled={disabled}
              style={({ pressed }) => [
                styles.presetBtn,
                {
                  backgroundColor: isSelected
                    ? Colors.primary
                    : pressed
                    ? theme.border
                    : theme.surfaceElevated,
                  opacity: disabled ? 0.4 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.presetPct,
                  { color: isSelected ? "#fff" : theme.text },
                ]}
              >
                {pct === 0 ? "No Tip" : `${pct}%`}
              </Text>
              {pct > 0 && (
                <Text
                  style={[
                    styles.presetAmt,
                    {
                      color: isSelected
                        ? "rgba(255,255,255,0.7)"
                        : theme.textSecondary,
                    },
                  ]}
                >
                  ${(tipCents / 100).toFixed(2)}
                </Text>
              )}
            </Pressable>
          );
        })}
        <Pressable
          onPress={handleCustom}
          disabled={disabled}
          style={({ pressed }) => [
            styles.presetBtn,
            {
              backgroundColor: isCustom
                ? Colors.primary
                : pressed
                ? theme.border
                : theme.surfaceElevated,
              opacity: disabled ? 0.4 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.presetPct,
              { color: isCustom ? "#fff" : theme.text },
            ]}
          >
            Custom
          </Text>
        </Pressable>
      </View>

      {isCustom && (
        <View
          style={[
            styles.customRow,
            { backgroundColor: theme.inputBackground, borderColor: Colors.primary },
          ]}
        >
          <Text style={[styles.dollarSign, { color: theme.text }]}>$</Text>
          <TextInput
            style={[styles.customInput, { color: theme.text }]}
            value={customStr}
            onChangeText={handleCustomChange}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={theme.textMuted}
            autoFocus
            editable={!disabled}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  presets: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  presetBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    minWidth: 70,
    alignItems: "center",
  },
  presetPct: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  presetAmt: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  customRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 12,
  },
  dollarSign: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    marginRight: 4,
  },
  customInput: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
});
