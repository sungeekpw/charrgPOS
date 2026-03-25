import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import Colors from "@/constants/colors";
import { clearSDKDebugLog, getSDKDebugLog } from "@/services/nexgo-sdk";

export default function DebugLogScreen() {
  const insets = useSafeAreaInsets();
  const theme = Colors.dark;
  const scrollRef = useRef<ScrollView>(null);

  const [logText, setLogText] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const loadLog = useCallback(async () => {
    setLoading(true);
    try {
      const text = await getSDKDebugLog();
      setLogText(text);
      setLastRefreshed(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLog();
  }, [loadLog]);

  const handleShare = useCallback(async () => {
    if (!logText) {
      Alert.alert("Nothing to share", "The log is empty.");
      return;
    }
    try {
      await Share.share({
        message: logText,
        title: "CharrgPOS SDK Debug Log",
      });
    } catch (e: unknown) {
      Alert.alert("Share failed", e instanceof Error ? e.message : String(e));
    }
  }, [logText]);

  const handleClear = () => {
    Alert.alert(
      "Clear Debug Log",
      "This will permanently delete the log file on the device. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            setClearing(true);
            await clearSDKDebugLog();
            setClearing(false);
            await loadLog();
          },
        },
      ]
    );
  };

  const lineCount = logText ? logText.split("\n").filter(Boolean).length : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={theme.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>SDK Debug Log</Text>
          {lastRefreshed && (
            <Text style={[styles.headerSub, { color: theme.textMuted }]}>
              {lineCount} line{lineCount !== 1 ? "s" : ""} · refreshed {lastRefreshed.toLocaleTimeString()}
            </Text>
          )}
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={loadLog}
            disabled={loading}
            style={[styles.iconBtn, { opacity: loading ? 0.4 : 1 }]}
          >
            <MaterialCommunityIcons name="refresh" size={22} color={theme.text} />
          </Pressable>
          <Pressable
            onPress={handleShare}
            disabled={loading || !logText}
            style={[styles.iconBtn, { opacity: loading || !logText ? 0.4 : 1 }]}
          >
            <MaterialCommunityIcons name="share-variant" size={22} color={Colors.primary} />
          </Pressable>
          <Pressable
            onPress={handleClear}
            disabled={clearing || loading}
            style={[styles.iconBtn, { opacity: clearing || loading ? 0.4 : 1 }]}
          >
            <MaterialCommunityIcons name="delete-outline" size={22} color={Colors.danger} />
          </Pressable>
        </View>
      </View>

      {/* Log body */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="large" />
          <Text style={[styles.loadingText, { color: theme.textMuted }]}>
            Reading log file…
          </Text>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {logText ? (
            logText.split("\n").filter(Boolean).map((line, i) => (
              <LogLine key={i} line={line} theme={theme} />
            ))
          ) : (
            <Text style={[styles.emptyText, { color: theme.textMuted }]}>
              No log entries yet.{"\n"}Initialize the SDK or run a card read to generate logs.
            </Text>
          )}
        </ScrollView>
      )}

      {/* Bottom hint */}
      <View style={[styles.hint, { paddingBottom: insets.bottom + 8 }]}>
        <MaterialCommunityIcons name="information-outline" size={13} color={theme.textMuted} />
        <Text style={[styles.hintText, { color: theme.textMuted }]}>
          Log is also available via{" "}
          <Text style={styles.mono}>adb logcat -s NexGoSDK</Text>
        </Text>
      </View>
    </View>
  );
}

function LogLine({
  line,
  theme,
}: {
  line: string;
  theme: (typeof Colors)["dark"];
}) {
  const isError = line.includes("[ERROR/");
  const color = isError ? Colors.danger : theme.text;
  const opacity = isError ? 1 : 0.85;

  return (
    <Text
      selectable
      style={[styles.logLine, { color, opacity }]}
    >
      {line}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0A0A0A",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  backButton: {
    padding: 6,
    marginRight: 4,
  },
  headerCenter: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  headerSub: {
    fontSize: 11,
    marginTop: 1,
  },
  headerActions: {
    flexDirection: "row",
    gap: 4,
  },
  iconBtn: {
    padding: 6,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 12,
    gap: 1,
  },
  logLine: {
    fontFamily: "monospace",
    fontSize: 11,
    lineHeight: 17,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    paddingTop: 48,
  },
  hint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  hintText: {
    fontSize: 11,
    flex: 1,
  },
  mono: {
    fontFamily: "monospace",
  },
});
