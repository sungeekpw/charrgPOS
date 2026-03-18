import { Platform, NativeEventEmitter } from "react-native";
import type { CardData } from "./charrg-api";

export type SDKEventType =
  | "card_inserted"
  | "card_swiped"
  | "card_tapped"
  | "card_removed"
  | "reading_started"
  | "reading_complete"
  | "reading_failed"
  | "pin_requested"
  | "pin_entered"
  | "timeout";

export type SDKListener = (event: SDKEventType, data?: unknown) => void;

export interface NexGoDeviceInfo {
  sn: string;
  ksn: string;
  model: string;
  vendor: string;
  osVer: string;
  sdkVer: string;
  firmwareVer: string;
  firmwareFullVer: string;
  kernelVer: string;
  spCoreVersion: string;
  spBootVersion: string;
}

let nexgoModule: NexGoNativeModule | null = null;

interface NexGoNativeModule {
  initialize: () => Promise<boolean>;
  getDeviceInfo: () => Promise<NexGoDeviceInfo>;
  startCardRead: (amount: number) => Promise<void>;
  cancelCardRead: () => Promise<void>;
  startKeypadListener: () => Promise<void>;
  stopKeypadListener: () => Promise<void>;
  addListener: (eventType: string, listener: SDKListener) => void;
  removeListener: (eventType: string, listener: SDKListener) => void;
}

type Subscription = { remove: () => void };

function createNexGoWrapper(
  nativeModule: Record<string, unknown>,
): NexGoNativeModule {
  const emitter = new NativeEventEmitter(nativeModule as never);
  const subscriptions = new Map<string, Map<SDKListener, Subscription>>();

  return {
    initialize: () =>
      (nativeModule.initialize as () => Promise<boolean>)(),

    getDeviceInfo: () =>
      (nativeModule.getDeviceInfo as () => Promise<NexGoDeviceInfo>)(),

    startCardRead: (amount: number) =>
      (nativeModule.startCardRead as (a: number) => Promise<void>)(amount),

    cancelCardRead: () =>
      (nativeModule.cancelCardRead as () => Promise<void>)(),

    startKeypadListener: () =>
      (nativeModule.startKeypadListener as () => Promise<void>)(),

    stopKeypadListener: () =>
      (nativeModule.stopKeypadListener as () => Promise<void>)(),

    addListener: (eventType: string, listener: SDKListener) => {
      const sub = emitter.addListener(eventType, (data?: unknown) => {
        listener(eventType as SDKEventType, data);
      });

      if (!subscriptions.has(eventType)) {
        subscriptions.set(eventType, new Map());
      }
      subscriptions.get(eventType)!.set(listener, sub);
    },

    removeListener: (eventType: string, listener: SDKListener) => {
      const eventSubs = subscriptions.get(eventType);
      if (!eventSubs) return;
      const sub = eventSubs.get(listener);
      if (sub) {
        sub.remove();
        eventSubs.delete(listener);
      }
    },
  };
}

export function isSDKAvailable(): boolean {
  if (Platform.OS !== "android") return false;
  try {
    const NativeModules = require("react-native").NativeModules;
    return !!NativeModules.NexGoSDK;
  } catch {
    return false;
  }
}

export function getNexGoModule(): NexGoNativeModule | null {
  if (!isSDKAvailable()) return null;
  if (nexgoModule) return nexgoModule;
  try {
    const NativeModules = require("react-native").NativeModules;
    nexgoModule = createNexGoWrapper(NativeModules.NexGoSDK);
    return nexgoModule;
  } catch {
    return null;
  }
}

export async function initializeSDK(): Promise<boolean> {
  const mod = getNexGoModule();
  if (!mod) return false;
  try {
    return await mod.initialize();
  } catch {
    return false;
  }
}

export async function startKeypadListener(): Promise<void> {
  const mod = getNexGoModule();
  if (!mod) return;
  try {
    await mod.startKeypadListener();
  } catch {
    // non-fatal — physical keypad will still work via TextInput fallback
  }
}

export async function stopKeypadListener(): Promise<void> {
  const mod = getNexGoModule();
  if (!mod) return;
  try {
    await mod.stopKeypadListener();
  } catch {}
}

/**
 * Subscribe to physical keypad events from the NexGo device.
 * Returns an unsubscribe function.
 * key: "0"-"9" | "BACKSPACE" | "CLEAR" | "ENTER"
 */
export function subscribeKeypadInput(
  handler: (key: string) => void
): () => void {
  if (!isSDKAvailable()) return () => {};
  const { NativeModules, NativeEventEmitter } = require("react-native");
  const emitter = new NativeEventEmitter(NativeModules.NexGoSDK);
  const sub = emitter.addListener("keypad_input", ({ key }: { key: string }) => {
    handler(key);
  });
  return () => sub.remove();
}

/**
 * Subscribe to debug events for key codes the native module doesn't recognise.
 * Useful for identifying what KEYCODE values the NexGo hardware actually sends.
 * Returns an unsubscribe function.
 */
export function subscribeKeypadDebug(
  handler: (keyCode: number, keyCodeName: string) => void
): () => void {
  if (!isSDKAvailable()) return () => {};
  const { NativeModules, NativeEventEmitter } = require("react-native");
  const emitter = new NativeEventEmitter(NativeModules.NexGoSDK);
  const sub = emitter.addListener(
    "keypad_debug",
    ({ keyCode, keyCodeName }: { keyCode: number; keyCodeName: string }) => {
      handler(keyCode, keyCodeName);
    }
  );
  return () => sub.remove();
}

export async function getDeviceInfo(): Promise<NexGoDeviceInfo> {
  const mod = getNexGoModule();
  if (!mod) throw new Error("NexGoSDK native module not available");
  return await mod.getDeviceInfo();
}

export async function startCardRead(
  amount: number,
  onEvent: SDKListener
): Promise<CardData> {
  const mod = getNexGoModule();

  if (!mod) {
    return simulateCardRead(amount, onEvent);
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      mod.removeListener("card_read_complete", handleComplete);
      mod.removeListener("reading_failed", handleFailed);
      mod.removeListener("timeout", handleTimeout);
      mod.removeListener("card_inserted", onEvent);
      mod.removeListener("card_swiped", onEvent);
      mod.removeListener("card_tapped", onEvent);
      mod.removeListener("reading_started", onEvent);
      mod.removeListener("pin_requested", onEvent);
      mod.removeListener("pin_entered", onEvent);
    };

    const handleComplete = (_: SDKEventType, data: unknown) => {
      cleanup();
      const raw = data as Record<string, string>;
      resolve({
        pan: raw.pan,
        expiryDate: raw.expiry,
        cardholderName: raw.cardholder_name,
        track1: raw.track1,
        track2: raw.track2,
        emvData: raw.emv_data,
        entryMode: (raw.entry_mode as CardData["entryMode"]) ?? "chip",
        last4: raw.pan?.slice(-4) ?? raw.last4,
        cardBrand: raw.card_brand,
      });
    };

    const handleFailed = (_: SDKEventType, data: unknown) => {
      cleanup();
      const raw = data as Record<string, string>;
      reject(new Error(raw.message ?? "Card read failed"));
    };

    const handleTimeout = () => {
      cleanup();
      reject(new Error("Card read timed out"));
    };

    mod.addListener("card_read_complete", handleComplete);
    mod.addListener("reading_failed", handleFailed);
    mod.addListener("timeout", handleTimeout);

    mod.addListener("card_inserted", onEvent);
    mod.addListener("card_swiped", onEvent);
    mod.addListener("card_tapped", onEvent);
    mod.addListener("reading_started", onEvent);
    mod.addListener("pin_requested", onEvent);
    mod.addListener("pin_entered", onEvent);

    mod.startCardRead(amount).catch((err: Error) => {
      cleanup();
      reject(err);
    });
  });
}

export async function cancelCardRead(): Promise<void> {
  const mod = getNexGoModule();
  if (mod) {
    await mod.cancelCardRead();
  }
}

async function simulateCardRead(
  _amount: number,
  onEvent: SDKListener
): Promise<CardData> {
  await delay(800);
  onEvent("reading_started");
  await delay(1200);
  onEvent("card_tapped");
  await delay(1000);
  onEvent("reading_complete");

  return {
    pan: "4111111111111111",
    expiryDate: "12/28",
    cardholderName: "TEST CARDHOLDER",
    track2: "4111111111111111=2812101234567890",
    emvData: "9F260821B0A2D04BE9D0F2",
    entryMode: "contactless",
    last4: "1111",
    cardBrand: "Visa",
  };
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
