import React, { useCallback, useRef, useState } from "react";
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

// Height of the fixed footer on native (button + padding)
const FOOTER_HEIGHT = 88;

export default function ChargeScreen() {
  const insets = useSafeAreaInsets();
  const { addTransaction } = usePOS();
  const theme = Colors.dark;
  const scrollRef = useRef<ScrollView>(null);

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

  const handleKeypadToggle = useCallback((visible: boolean) => {
    if (visible) {
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 400);
    }
  }, []);

  const isWeb = Platform.OS === "web";

  // On native: scroll content must clear the fixed footer + safe area
  // On web: button is inline in scroll, no fixed footer
  const scrollBottomPad = isWeb ? 24 : FOOTER_HEIGHT + insets.bottom + 16;

  const payButton = (
    <PrimaryButton
      label={amountCents > 0 ? `Pay Now · $${totalDollars}` : "Pay Now"}
      onPress={handleCharge}
      disabled={amountCents <= 0}
    />
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + (isWeb ? 67 : 12),
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

      {/* Scrollable content */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.scroll, { paddingBottom: scrollBottomPad }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <AmountInput
            label="Charge Amount"
            value={amountCents}
            onChange={setAmountCents}
            onKeypadToggle={handleKeypadToggle}
          />

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <TipSelector
            baseAmountCents={amountCents}
            onTipChange={setTipCents}
          />

          {/* Total row */}
          <View style={[styles.totalRow, { backgroundColor: theme.surfaceElevated }]}>
            <View>
              <Text style={[styles.totalLabel, { color: theme.textSecondary }]}>Total</Text>
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

          {/* Web only: button inline in scroll */}
          {isWeb && payButton}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Native only: fixed footer always visible above tab bar */}
      {!isWeb && (
        <View
          style={[
            styles.footer,
            {
              bottom: insets.bottom,
              borderTopColor: theme.border,
              backgroundColor: theme.background,
            },
          ]}
        >
          {payButton}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
  clearBtn: { padding: 8 },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 24,
  },
  divider: { height: 1, borderRadius: 1 },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
  },
  totalRow: {
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
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
    fontSize: 36,
    fontFamily: "Inter_700Bold",
    letterSpacing: -1,
    marginTop: 2,
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
