import { Platform } from "react-native";

export interface TCPPaymentRequest {
  transactionId: string;
  amount: number;
  tip?: number;
  reference?: string;
  source?: string;
}

export type TCPServerStatus = "stopped" | "starting" | "listening" | "error";
export type TCPServerListener = (req: TCPPaymentRequest) => void;
export type TCPStatusListener = (status: TCPServerStatus, port?: number, error?: string) => void;

let listeners: TCPServerListener[] = [];
let statusListeners: TCPStatusListener[] = [];
let currentStatus: TCPServerStatus = "stopped";
let currentPort: number | null = null;
let nativeServer: NativeTCPServer | null = null;

interface NativeTCPServer {
  start: (port: number) => Promise<void>;
  stop: () => Promise<void>;
  onRequest: (callback: (data: string) => void) => void;
}

function getNativeTCPServer(): NativeTCPServer | null {
  if (Platform.OS !== "android") return null;
  try {
    const { NativeModules } = require("react-native");
    return NativeModules.TCPServer ?? null;
  } catch {
    return null;
  }
}

export function addPaymentRequestListener(fn: TCPServerListener) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

export function addStatusListener(fn: TCPStatusListener) {
  statusListeners.push(fn);
  return () => {
    statusListeners = statusListeners.filter((l) => l !== fn);
  };
}

function emitStatus(status: TCPServerStatus, port?: number, error?: string) {
  currentStatus = status;
  if (port !== undefined) currentPort = port;
  statusListeners.forEach((fn) => fn(status, port ?? currentPort ?? undefined, error));
}

function handleRawRequest(raw: string) {
  try {
    const req = JSON.parse(raw) as TCPPaymentRequest;
    listeners.forEach((fn) => fn(req));
  } catch {
    console.warn("[TCPServer] Could not parse request:", raw);
  }
}

export async function startTCPServer(port = 9090): Promise<void> {
  if (currentStatus === "listening") return;
  emitStatus("starting", port);

  const native = getNativeTCPServer();
  if (native) {
    nativeServer = native;
    native.onRequest(handleRawRequest);
    await native.start(port);
    emitStatus("listening", port);
    return;
  }

  setTimeout(() => {
    emitStatus("listening", port);
  }, 500);
}

export async function stopTCPServer(): Promise<void> {
  if (currentStatus === "stopped") return;
  if (nativeServer) {
    await nativeServer.stop();
    nativeServer = null;
  }
  emitStatus("stopped");
  currentPort = null;
}

export function getServerStatus(): TCPServerStatus {
  return currentStatus;
}

export function getServerPort(): number | null {
  return currentPort;
}
