import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { CardReaderStatus } from "@/components/ui/CardReaderStatus";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import Colors from "@/constants/colors";
import { usePOS } from "@/context/pos-context";
import { processPayment } from "@/services/charrg-api";
import { startCardRead, cancelCardRead } from "@/services/nexgo-sdk";
import type { SDKEventType } from "@/services/nexgo-sdk";
import type { Transaction } from "@/services/transaction-storage";
import { generateTransactionId } from "@/services/transaction-storage";

type PaymentPhase =
  | "ready"
  | "reading"
  | "processing"
  | "success"
  | "error"
  | "cancelled";

export default function PaymentScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    txId: string;
    amountCents: string;
    tipCents: string;
    source: string;
    reference?: string;
  }>();
  const { addTransaction } = usePOS();
  const theme = Colors.dark;

  const amountCents = parseInt(params.amountCents ?? "0", 10);
  const tipCents = parseInt(params.tipCents ?? "0", 10);
  const totalCents = amountCents + tipCents;
  const txId = params.txId ?? generateTransactionId();
  const source = (params.source as Transaction["source"]) ?? "standalone";
  const reference = params.reference;

  const [phase, setPhase] = useState<PaymentPhase>("ready");
  const [sdkEvent, setSdkEvent] = useState<SDKEventType | null>(null);
  const [authCode, setAuthCode] = useState<string | undefined>();
  const [errorMsg, setErrorMsg] = useState<string | undefined>();

  const isCancelled = useRef(false);

  const resultScale = useSharedValue(0.7);
  const resultOpacity = useSharedValue(0);

  const animateResult = useCallback(() => {
    resultScale.value = withSpring(1, { damping: 12, stiffness: 200 });
    resultOpacity.value = withTiming(1, { duration: 300 });
  }, []);

  const resultStyle = useAnimatedStyle(() => ({
    transform: [{ scale: resultScale.value }],
    opacity: resultOpacity.value,
  }));

  const handleStartRead = useCallback(async () => {
    isCancelled.current = false;
    setPhase("reading");
    setSdkEvent(null);

    try {
      const cardData = await startCardRead(totalCents, (ev) => {
        setSdkEvent(ev);
      });

      if (isCancelled.current) return;

      setPhase("processing");
      setSdkEvent(null);

      const resp = await processPayment({
        amount: amountCents,
        tip: tipCents,
        cardData,
        transactionId: txId,
      });

      if (isCancelled.current) return;

      const tx: Transaction = {
        id: txId,
        amount: amountCents,
        tip: tipCents,
        total: totalCents,
        status: resp.success ? "approved" : "declined",
        authCode: resp.authCode,
        errorMessage: resp.errorMessage,
        last4: cardData.last4,
        cardBrand: cardData.cardBrand,
        entryMode: cardData.entryMode,
        timestamp: new Date().toISOString(),
        source,
        reference,
      };

      await addTransaction(tx);

      if (resp.success) {
        setAuthCode(resp.authCode);
        setPhase("success");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setErrorMsg(resp.errorMessage ?? "Payment declined");
        setPhase("error");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }

      animateResult();
    } catch (err: unknown) {
      if (isCancelled.current) return;
      const msg = err instanceof Error ? err.message : "Unknown error";
      setErrorMsg(msg);
      setPhase("error");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      animateResult();

      await addTransaction({
        id: txId,
        amount: amountCents,
        tip: tipCents,
        total: totalCents,
        status: "error",
        errorMessage: msg,
        timestamp: new Date().toISOString(),
        source,
        reference,
      });
    }
  }, [amountCents, tipCents, totalCents, txId, source, reference, addTransaction, animateResult]);

  const handleCancel = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (phase === "reading" || phase === "processing") {
      isCancelled.current = true;
      await cancelCardRead();
      await addTransaction({
        id: txId,
        amount: amountCents,
        tip: tipCents,
        total: totalCents,
        status: "cancelled",
        timestamp: new Date().toISOString(),
        source,
        reference,
      });
    }
    router.back();
  }, [phase, txId, amountCents, tipCents, totalCents, source, reference, addTransaction]);

  const handleNewCharge = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  }, []);

  const handleRetry = useCallback(() => {
    setPhase("ready");
    setSdkEvent(null);
    setErrorMsg(undefined);
    resultScale.value = 0.7;
    resultOpacity.value = 0;
  }, []);

  // Auto-start the card reader as soon as the screen appears — no extra tap needed.
  useEffect(() => {
    handleStartRead();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isActive = phase === "reading" || phase === "processing";
  const isDone = phase === "success" || phase === "error";

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
        <Pressable onPress={handleCancel} style={styles.backBtn}>
          <Feather
            name={isActive ? "x" : "arrow-left"}
            size={22}
            color={isActive ? Colors.danger : theme.text}
          />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]}>
          {phase === "processing" ? "Processing..." : "Payment"}
        </Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 24) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.amountCard, { backgroundColor: theme.surfaceElevated }]}>
          <Text style={[styles.amtLabel, { color: theme.textSecondary }]}>Total</Text>
          <Text style={[styles.amtValue, { color: Colors.primary }]}>
            ${(totalCents / 100).toFixed(2)}
          </Text>
          {tipCents > 0 && (
            <Text style={[styles.amtBreak, { color: theme.textMuted }]}>
              ${(amountCents / 100).toFixed(2)} + ${(tipCents / 100).toFixed(2)} tip
            </Text>
          )}
          <Text style={[styles.txIdText, { color: theme.textMuted }]}>{txId}</Text>
        </View>

        {(phase === "ready" || phase === "reading" || phase === "processing") && (
          <CardReaderStatus
            event={phase === "processing" ? "reading_complete" : sdkEvent}
            isReading={phase === "reading"}
          />
        )}

        {phase === "processing" && (
          <View style={styles.processingRow}>
            <MaterialCommunityIcons name="cloud-sync-outline" size={20} color={Colors.primary} />
            <Text style={[styles.processingText, { color: theme.textSecondary }]}>
              Sending to Charrg API...
            </Text>
          </View>
        )}

        {isDone && (
          <Animated.View style={[styles.resultBlock, resultStyle]}>
            {phase === "success" ? (
              <View style={styles.successContent}>
                <View style={[styles.resultIcon, { backgroundColor: Colors.success + "20" }]}>
                  <MaterialCommunityIcons name="check-circle" size={64} color={Colors.success} />
                </View>
                <Text style={[styles.resultTitle, { color: Colors.success }]}>Approved</Text>
                {authCode && (
                  <View style={[styles.authChip, { backgroundColor: theme.surfaceElevated }]}>
                    <Text style={[styles.authLabel, { color: theme.textSecondary }]}>Auth Code</Text>
                    <Text style={[styles.authValue, { color: theme.text }]}>{authCode}</Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.errorContent}>
                <View style={[styles.resultIcon, { backgroundColor: Colors.danger + "20" }]}>
                  <MaterialCommunityIcons name="close-circle" size={64} color={Colors.danger} />
                </View>
                <Text style={[styles.resultTitle, { color: Colors.danger }]}>
                  {phase === "error" ? "Error" : "Declined"}
                </Text>
                {errorMsg && (
                  <Text style={[styles.errDetail, { color: theme.textSecondary }]}>{errorMsg}</Text>
                )}
              </View>
            )}
          </Animated.View>
        )}

        {phase === "success" && (
          <PrimaryButton label="New Charge" onPress={handleNewCharge} />
        )}

        {phase === "error" && (
          <View style={styles.btnCol}>
            <PrimaryButton label="Retry" onPress={handleRetry} />
            <PrimaryButton label="Cancel" onPress={handleCancel} secondary />
          </View>
        )}

        {/* Cancel is always available while a read is in progress or pending */}
        {(phase === "ready" || isActive) && (
          <PrimaryButton
            label="Cancel"
            onPress={handleCancel}
            secondary
            danger={false}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 24,
  },
  amountCard: {
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    gap: 6,
  },
  amtLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  amtValue: {
    fontSize: 52,
    fontFamily: "Inter_700Bold",
    letterSpacing: -2,
  },
  amtBreak: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  txIdText: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    letterSpacing: 0.5,
    marginTop: 4,
  },
  processingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  processingText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  resultBlock: {
    alignItems: "center",
  },
  successContent: {
    alignItems: "center",
    gap: 16,
  },
  errorContent: {
    alignItems: "center",
    gap: 16,
  },
  resultIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  resultTitle: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
  },
  authChip: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    gap: 4,
  },
  authLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  authValue: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: 2,
  },
  errDetail: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 20,
  },
  btnCol: {
    gap: 12,
  },
});
