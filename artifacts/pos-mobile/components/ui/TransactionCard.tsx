import React from "react";
import { StyleSheet, Text, useColorScheme, View } from "react-native";
import { MaterialCommunityIcons, Feather } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import type { Transaction } from "@/services/transaction-storage";

interface TransactionCardProps {
  tx: Transaction;
}

function getCardIcon(brand?: string): string {
  const b = (brand ?? "").toLowerCase();
  if (b.includes("visa")) return "credit-card";
  if (b.includes("master")) return "credit-card";
  if (b.includes("amex")) return "credit-card";
  return "credit-card-outline";
}

function getEntryIcon(mode?: string) {
  switch (mode) {
    case "chip": return "credit-card-chip";
    case "contactless": return "contactless-payment";
    case "swipe": return "credit-card-scan";
    case "manual": return "keyboard-outline";
    default: return "credit-card-outline";
  }
}

function getStatusColor(status: Transaction["status"]): string {
  switch (status) {
    case "approved": return Colors.success;
    case "declined": return Colors.danger;
    case "error": return Colors.danger;
    case "cancelled": return Colors.warning;
    default: return Colors.primary;
  }
}

function getStatusLabel(status: Transaction["status"]): string {
  switch (status) {
    case "approved": return "Approved";
    case "declined": return "Declined";
    case "error": return "Error";
    case "cancelled": return "Cancelled";
    case "pending": return "Pending";
    default: return status;
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function TransactionCard({ tx }: TransactionCardProps) {
  const theme = Colors.dark;
  const statusColor = getStatusColor(tx.status);

  return (
    <View style={[styles.card, { backgroundColor: theme.surfaceElevated }]}>
      <View style={[styles.statusBar, { backgroundColor: statusColor }]} />

      <View style={styles.body}>
        <View style={styles.row}>
          <View style={styles.iconBox}>
            <MaterialCommunityIcons
              name={getCardIcon(tx.cardBrand) as any}
              size={22}
              color={theme.textSecondary}
            />
          </View>
          <View style={styles.info}>
            <Text style={[styles.cardLabel, { color: theme.text }]}>
              {tx.cardBrand ?? "Card"} •••• {tx.last4 ?? "????"}
            </Text>
            <View style={styles.metaRow}>
              <MaterialCommunityIcons
                name={getEntryIcon(tx.entryMode) as any}
                size={12}
                color={theme.textMuted}
              />
              <Text style={[styles.meta, { color: theme.textMuted }]}>
                {" "}{tx.entryMode ?? "card"} · {formatDate(tx.timestamp)} {formatTime(tx.timestamp)}
              </Text>
              {tx.source === "tcp" && (
                <View style={[styles.badge, { backgroundColor: Colors.accent }]}>
                  <Text style={styles.badgeText}>Remote</Text>
                </View>
              )}
            </View>
          </View>
          <View style={styles.amountCol}>
            <Text style={[styles.total, { color: theme.text }]}>
              ${(tx.total / 100).toFixed(2)}
            </Text>
            {tx.tip > 0 && (
              <Text style={[styles.tipLabel, { color: theme.textMuted }]}>
                +${(tx.tip / 100).toFixed(2)} tip
              </Text>
            )}
          </View>
        </View>

        <View style={[styles.footer, { borderTopColor: theme.border }]}>
          <View style={[styles.statusChip, { backgroundColor: statusColor + "20" }]}>
            <View style={[styles.dot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>
              {getStatusLabel(tx.status)}
            </Text>
          </View>
          {tx.authCode && (
            <Text style={[styles.authCode, { color: theme.textMuted }]}>
              Auth: {tx.authCode}
            </Text>
          )}
          {tx.errorMessage && (
            <Text style={[styles.errMsg, { color: Colors.danger }]} numberOfLines={1}>
              {tx.errorMessage}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 10,
    flexDirection: "row",
  },
  statusBar: {
    width: 4,
  },
  body: {
    flex: 1,
    padding: 14,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    flex: 1,
    gap: 4,
  },
  cardLabel: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  meta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 6,
  },
  badgeText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  amountCol: {
    alignItems: "flex-end",
  },
  total: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
  },
  tipLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  authCode: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  errMsg: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    flex: 1,
    textAlign: "right",
  },
});
