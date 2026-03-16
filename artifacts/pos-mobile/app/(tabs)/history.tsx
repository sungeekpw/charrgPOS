import React, { useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { TransactionCard } from "@/components/ui/TransactionCard";
import Colors from "@/constants/colors";
import { usePOS } from "@/context/pos-context";
import type { Transaction } from "@/services/transaction-storage";

function groupByDate(txs: Transaction[]): { date: string; items: Transaction[] }[] {
  const map = new Map<string, Transaction[]>();
  for (const tx of txs) {
    const d = new Date(tx.timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    let key: string;
    if (d.toDateString() === today.toDateString()) key = "Today";
    else if (d.toDateString() === yesterday.toDateString()) key = "Yesterday";
    else key = d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });

    const existing = map.get(key) ?? [];
    existing.push(tx);
    map.set(key, existing);
  }
  return Array.from(map.entries()).map(([date, items]) => ({ date, items }));
}

type ListItem =
  | { type: "header"; date: string; key: string }
  | { type: "tx"; tx: Transaction; key: string };

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const theme = Colors.dark;
  const { transactions, refreshTransactions } = usePOS();
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshTransactions();
    setRefreshing(false);
  }, [refreshTransactions]);

  const groups = groupByDate(transactions);

  const flatItems: ListItem[] = [];
  for (const g of groups) {
    flatItems.push({ type: "header", date: g.date, key: `header-${g.date}` });
    for (const tx of g.items) {
      flatItems.push({ type: "tx", tx, key: tx.id });
    }
  }

  const totalToday = transactions
    .filter((t) => {
      const d = new Date(t.timestamp);
      return d.toDateString() === new Date().toDateString() && t.status === "approved";
    })
    .reduce((sum, t) => sum + t.total, 0);

  const approvedToday = transactions.filter((t) => {
    const d = new Date(t.timestamp);
    return d.toDateString() === new Date().toDateString() && t.status === "approved";
  }).length;

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
        <Text style={[styles.headerTitle, { color: theme.text }]}>Transactions</Text>
        <View style={styles.todayBadge}>
          <Text style={[styles.todayAmt, { color: Colors.primary }]}>
            ${(totalToday / 100).toFixed(2)}
          </Text>
          <Text style={[styles.todayLabel, { color: theme.textSecondary }]}>
            {approvedToday} today
          </Text>
        </View>
      </View>

      <FlatList
        data={flatItems}
        keyExtractor={(item) => item.key}
        contentContainerStyle={[
          styles.list,
          {
            paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 80),
          },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
        renderItem={({ item }) => {
          if (item.type === "header") {
            return (
              <Text style={[styles.dateHeader, { color: theme.textSecondary }]}>
                {item.date}
              </Text>
            );
          }
          return <TransactionCard tx={item.tx} />;
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons
              name="receipt-text-outline"
              size={56}
              color={theme.textMuted}
            />
            <Text style={[styles.emptyTitle, { color: theme.textSecondary }]}>
              No transactions yet
            </Text>
            <Text style={[styles.emptyMsg, { color: theme.textMuted }]}>
              Process a payment to see it here
            </Text>
          </View>
        }
      />
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
  todayBadge: {
    alignItems: "flex-end",
  },
  todayAmt: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  todayLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  list: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  dateHeader: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 10,
    marginTop: 6,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
  },
  emptyMsg: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});
