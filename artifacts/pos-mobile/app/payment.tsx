import React, { useCallback, useEffect, useRef, useState } from "react";
import {
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
import { CHARRG_BASE_URL, processPayment } from "@/services/charrg-api";
import type { CardData } from "@/services/charrg-api";
import { startCardRead, cancelCardRead } from "@/services/nexgo-sdk";
import type { SDKEventType } from "@/services/nexgo-sdk";
import type { Transaction } from "@/services/transaction-storage";
import { generateTransactionId } from "@/services/transaction-storage";

// ─── Bypass flag ─────────────────────────────────────────────────────────────
// When the Charrg API URL is not configured we skip the network call entirely
// and display the raw card-read result so hardware can be tested independently.
const CHARRG_CONFIGURED = !!CHARRG_BASE_URL;

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
  const [lastCardData, setLastCardData] = useState<CardData | null>(null);

  const isCancelled = useRef(false);

  const resultScale = useSharedValue(0.7);
  const resultOpacity = useSharedValue(0);

  const animateResult = useCallback(() => {
    resultScale.value = withSpring(1, { damping: 12, stiffness: 200 });
    resultOpacity.value = withTiming(1, { duration: 300 });
  }, [resultScale, resultOpacity]);

  const resetAnimation = useCallback(() => {
    resultScale.value = 0.7;
    resultOpacity.value = 0;
  }, [resultScale, resultOpacity]);

  const resultStyle = useAnimatedStyle(() => ({
    transform: [{ scale: resultScale.value }],
    opacity: resultOpacity.value,
  }));

  const handleStartRead = useCallback(async () => {
    isCancelled.current = false;
    setPhase("reading");
    setSdkEvent(null);
    setLastCardData(null);

    try {
      const cardData = await startCardRead(totalCents, (ev) => {
        setSdkEvent(ev);
      });

      if (isCancelled.current) return;
      setLastCardData(cardData);

      if (!CHARRG_CONFIGURED) {
        // ── Test mode: API not configured — display the raw card read ──────
        setPhase("success");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        animateResult();

        await addTransaction({
          id: txId,
          amount: amountCents,
          tip: tipCents,
          total: totalCents,
          status: "approved",
          last4: cardData.last4,
          cardBrand: cardData.cardBrand,
          entryMode: cardData.entryMode,
          timestamp: new Date().toISOString(),
          source,
          reference,
        });
        return;
      }

      // ── Live mode: send to Charrg API ──────────────────────────────────
      setPhase("processing");
      setSdkEvent(null);

      const resp = await processPayment({
        amount: amountCents,
        tip: tipCents,
        cardData,
        transactionId: txId,
      });

      if (isCancelled.current) return;

      await addTransaction({
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
      });

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
    resetAnimation();
    setPhase("ready");
    setSdkEvent(null);
    setErrorMsg(undefined);
    setLastCardData(null);
    // Restart immediately — same as on first mount
    handleStartRead();
  }, [resetAnimation, handleStartRead]);

  // Auto-start card reader as soon as the screen appears
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
        {/* Amount summary */}
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

        {/* API bypass banner */}
        {!CHARRG_CONFIGURED && (
          <View style={[styles.testBanner, { backgroundColor: Colors.warning + "20", borderColor: Colors.warning + "50" }]}>
            <MaterialCommunityIcons name="test-tube" size={16} color={Colors.warning} />
            <Text style={[styles.testBannerText, { color: Colors.warning }]}>
              Test mode — Charrg API not configured. Card read data will be displayed only.
            </Text>
          </View>
        )}

        {/* Card reader status */}
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

        {/* Result */}
        {isDone && (
          <Animated.View style={[styles.resultBlock, resultStyle]}>
            {phase === "success" ? (
              <View style={styles.successContent}>
                <View style={[styles.resultIcon, { backgroundColor: Colors.success + "20" }]}>
                  <MaterialCommunityIcons name="check-circle" size={64} color={Colors.success} />
                </View>
                <Text style={[styles.resultTitle, { color: Colors.success }]}>
                  {CHARRG_CONFIGURED ? "Approved" : "Card Read OK"}
                </Text>

                {/* In live mode: show auth code */}
                {CHARRG_CONFIGURED && authCode && (
                  <View style={[styles.chip, { backgroundColor: theme.surfaceElevated }]}>
                    <Text style={[styles.chipLabel, { color: theme.textSecondary }]}>Auth Code</Text>
                    <Text style={[styles.chipValue, { color: theme.text }]}>{authCode}</Text>
                  </View>
                )}

                {/* In test mode: show full card read details */}
                {!CHARRG_CONFIGURED && lastCardData && (
                  <CardReadDebugView cardData={lastCardData} theme={theme} />
                )}
              </View>
            ) : (
              <View style={styles.errorContent}>
                <View style={[styles.resultIcon, { backgroundColor: Colors.danger + "20" }]}>
                  <MaterialCommunityIcons name="close-circle" size={64} color={Colors.danger} />
                </View>
                <Text style={[styles.resultTitle, { color: Colors.danger }]}>Error</Text>
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

        {(phase === "ready" || isActive) && (
          <PrimaryButton
            label="Cancel"
            onPress={handleCancel}
            secondary
          />
        )}
      </ScrollView>
    </View>
  );
}

// ─── Card Read Debug View ─────────────────────────────────────────────────────
function CardReadDebugView({
  cardData,
  theme,
}: {
  cardData: CardData;
  theme: typeof Colors.dark;
}) {
  const rows: { label: string; value: string }[] = [
    { label: "Card Brand",  value: cardData.cardBrand  ?? "—" },
    { label: "Last 4",      value: cardData.last4       ?? "—" },
    { label: "Entry Mode",  value: cardData.entryMode   ?? "—" },
    { label: "Expiry",      value: cardData.expiryDate  ?? "—" },
    { label: "Cardholder",  value: cardData.cardholderName || "—" },
    ...(cardData.track2
      ? [{ label: "Track 2", value: maskTrack(cardData.track2) }]
      : []),
    ...(cardData.emvData
      ? [{ label: "EMV Data", value: truncate(cardData.emvData, 32) }]
      : []),
  ];

  return (
    <View style={dbgStyles.container}>
      <Text style={[dbgStyles.heading, { color: theme.textSecondary }]}>
        Card Read Data
      </Text>
      {rows.map(({ label, value }) => (
        <View key={label} style={dbgStyles.row}>
          <Text style={[dbgStyles.label, { color: theme.textSecondary }]}>{label}</Text>
          <Text style={[dbgStyles.value, { color: theme.text }]} selectable>
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function maskTrack(track2: string): string {
  // Show first 6 and last 4 of the PAN, mask the rest
  const pan = track2.split("=")[0] ?? "";
  if (pan.length < 10) return "****";
  return pan.slice(0, 6) + "******" + pan.slice(-4);
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}

const dbgStyles = StyleSheet.create({
  container: {
    width: "100%",
    borderRadius: 14,
    overflow: "hidden",
    marginTop: 8,
  },
  heading: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 10,
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 5,
    gap: 12,
  },
  label: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    flexShrink: 0,
  },
  value: {
    fontSize: 12,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    flexShrink: 1,
    textAlign: "right",
  },
});

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
  testBanner: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  testBannerText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
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
  resultBlock: { alignItems: "center" },
  successContent: { alignItems: "center", gap: 16, width: "100%" },
  errorContent: { alignItems: "center", gap: 16 },
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
  chip: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    gap: 4,
  },
  chipLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  chipValue: {
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
  btnCol: { gap: 12 },
});
