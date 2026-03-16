import React, { useEffect } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import Colors from "@/constants/colors";
import { usePOS } from "@/context/pos-context";
import { generateTransactionId } from "@/services/transaction-storage";

function StatusDot({ active }: { active: boolean }) {
  return (
    <View
      style={[
        styles.statusDot,
        { backgroundColor: active ? Colors.success : Colors.dark.textMuted },
      ]}
    />
  );
}

export default function RemoteScreen() {
  const insets = useSafeAreaInsets();
  const theme = Colors.dark;
  const {
    tcpStatus,
    tcpPort,
    isTCPEnabled,
    pendingTCPRequest,
    startListening,
    stopListening,
    clearPendingRequest,
  } = usePOS();

  const isListening = tcpStatus === "listening";
  const isStarting = tcpStatus === "starting";

  const handleToggle = async (val: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (val) {
      await startListening();
    } else {
      await stopListening();
    }
  };

  useEffect(() => {
    if (!pendingTCPRequest) return;
    const req = pendingTCPRequest;
    clearPendingRequest();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.push({
      pathname: "/payment",
      params: {
        txId: req.transactionId,
        amountCents: Math.round((req.amount ?? 0) * 100).toString(),
        tipCents: Math.round((req.tip ?? 0) * 100).toString(),
        source: "tcp",
        reference: req.reference ?? "",
      },
    });
  }, [pendingTCPRequest]);

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
        <Text style={[styles.headerTitle, { color: theme.text }]}>Remote Pay</Text>
        <View style={styles.statusRow}>
          <StatusDot active={isListening} />
          <Text style={[styles.statusLabel, { color: theme.textSecondary }]}>
            {isStarting ? "Starting..." : isListening ? `TCP :${tcpPort}` : "Off"}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 80) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, { backgroundColor: theme.surfaceElevated }]}>
          <View style={styles.cardRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>
                TCP Listener
              </Text>
              <Text style={[styles.cardSub, { color: theme.textSecondary }]}>
                Accept payments from external systems via TCP
              </Text>
            </View>
            <Switch
              value={isTCPEnabled}
              onValueChange={handleToggle}
              trackColor={{ true: Colors.primary, false: theme.border }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {isListening && (
          <View style={[styles.infoCard, { backgroundColor: theme.surfaceElevated, borderColor: Colors.primary + "40" }]}>
            <MaterialCommunityIcons name="wifi" size={24} color={Colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.infoTitle, { color: theme.text }]}>Listening for Requests</Text>
              <Text style={[styles.infoPort, { color: Colors.primary }]}>
                Port {tcpPort}
              </Text>
              <Text style={[styles.infoDesc, { color: theme.textSecondary }]}>
                This device is ready to accept inbound payment requests from your POS system.
              </Text>
            </View>
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
            Integration Guide
          </Text>
        </View>

        {[
          {
            icon: "connection",
            title: "TCP Connection",
            desc: "Connect to this device on the network using its IP address and port 9090.",
          },
          {
            icon: "code-json",
            title: "Request Format",
            desc: `Send a JSON payload:\n{\n  "transaction_id": "TXN-123",\n  "amount": 12.50,\n  "tip": 2.00,\n  "reference": "ORDER-001"\n}`,
            mono: true,
          },
          {
            icon: "credit-card-wireless-outline",
            title: "Card Processing",
            desc: "The device will automatically prompt the customer to present their card and complete payment.",
          },
          {
            icon: "check-network",
            title: "Response",
            desc: "A JSON response is sent back with auth code, status, and transaction ID after processing.",
          },
        ].map((step, i) => (
          <View
            key={i}
            style={[styles.stepCard, { backgroundColor: theme.surfaceElevated }]}
          >
            <View style={[styles.stepIcon, { backgroundColor: Colors.primary + "20" }]}>
              <MaterialCommunityIcons name={step.icon as any} size={22} color={Colors.primary} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.stepTitle, { color: theme.text }]}>{step.title}</Text>
              <Text
                style={[
                  step.mono ? styles.stepDescMono : styles.stepDesc,
                  { color: theme.textSecondary },
                ]}
              >
                {step.desc}
              </Text>
            </View>
          </View>
        ))}

        <View style={[styles.card, { backgroundColor: theme.surfaceElevated }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>NexGo SDK</Text>
          <Text style={[styles.cardSub, { color: theme.textSecondary }]}>
            Place the NexGo AAR file in the{" "}
            <Text style={{ color: Colors.primary, fontFamily: "Inter_500Medium" }}>
              android/libs/
            </Text>{" "}
            directory and rebuild the app to enable hardware card reading.
          </Text>
        </View>
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
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 14,
  },
  card: {
    borderRadius: 16,
    padding: 18,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  cardTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 4,
  },
  cardSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
  },
  infoCard: {
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    alignItems: "flex-start",
  },
  infoTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 4,
  },
  infoPort: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    marginBottom: 6,
  },
  infoDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  sectionHeader: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  stepCard: {
    borderRadius: 14,
    padding: 16,
    flexDirection: "row",
    gap: 14,
    alignItems: "flex-start",
  },
  stepIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  stepTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  stepDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  stepDescMono: {
    fontSize: 11,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    lineHeight: 17,
  },
});
