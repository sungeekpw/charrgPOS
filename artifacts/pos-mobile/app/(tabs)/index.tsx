import React, { useCallback, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";

import { AmountInput } from "@/components/ui/AmountInput";
import { TipSelector } from "@/components/ui/TipSelector";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import Colors from "@/constants/colors";
import { usePOS } from "@/context/pos-context";
import { generateTransactionId } from "@/services/transaction-storage";

export default function ChargeScreen() {
  const insets = useSafeAreaInsets();
  const { addTransaction } = usePOS();
  const theme = Colors.dark;

  const [amountCents, setAmountCents] = useState(0);
  const [tipCents, setTipCents] = useState(0);

  const totalCents = amountCents + tipCents;
  const totalDollars = (totalCents / 100).toFixed(2);

  const handleCharge = useCallback(() => {
    if (amountCents <= 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Enter Amount", "Please enter a charge amount before proceeding.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const txId = generateTransactionId();
    router.push({
      pathname: "/payment",
      params: {
        txId,
        amountCents: amountCents.toString(),
        tipCents: tipCents.toString(),
        source: "standalone",
      },
    });
  }, [amountCents, tipCents]);

  const handleClear = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAmountCents(0);
    setTipCents(0);
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + (Platform.OS === "web" ? 67 : 12),
            borderBottomColor: theme.border,
          },
        ]}
      >
        <View>
          <Text style={[styles.headerTitle, { color: theme.text }]}>New Charge</Text>
          <Text style={[styles.headerSub, { color: theme.textSecondary }]}>
            NexGo POS · CharrgPOS
          </Text>
        </View>
        <Pressable onPress={handleClear} style={styles.clearBtn}>
          <Feather name="x-circle" size={20} color={theme.textSecondary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 20) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <AmountInput
            label="Charge Amount"
            value={amountCents}
            onChange={setAmountCents}
          />

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <TipSelector
            baseAmountCents={amountCents}
            onTipChange={setTipCents}
          />

          <View
            style={[styles.totalRow, { backgroundColor: theme.surfaceElevated }]}
          >
            <View>
              <Text style={[styles.totalLabel, { color: theme.textSecondary }]}>
                Total
              </Text>
              <Text style={[styles.totalAmt, { color: Colors.primary }]}>
                ${totalDollars}
              </Text>
            </View>
            {tipCents > 0 && (
              <View style={styles.breakdown}>
                <Text style={[styles.breakdownLine, { color: theme.textMuted }]}>
                  Sale: ${(amountCents / 100).toFixed(2)}
                </Text>
                <Text style={[styles.breakdownLine, { color: theme.textMuted }]}>
                  Tip:  ${(tipCents / 100).toFixed(2)}
                </Text>
              </View>
            )}
          </View>

          <PrimaryButton
            label={`Charge $${totalDollars}`}
            onPress={handleCharge}
            disabled={amountCents <= 0}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  headerSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  clearBtn: {
    padding: 8,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 24,
  },
  divider: {
    height: 1,
    borderRadius: 1,
  },
  totalRow: {
    borderRadius: 16,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  totalLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  totalAmt: {
    fontSize: 40,
    fontFamily: "Inter_700Bold",
    letterSpacing: -1,
    marginTop: 4,
  },
  breakdown: {
    alignItems: "flex-end",
    gap: 4,
  },
  breakdownLine: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    fontVariant: ["tabular-nums"],
  },
});
