import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TCPPaymentRequest } from "@/services/tcp-server";
import {
  addPaymentRequestListener,
  addStatusListener,
  getServerPort,
  getServerStatus,
  startTCPServer,
  stopTCPServer,
  type TCPServerStatus,
} from "@/services/tcp-server";
import type { Transaction } from "@/services/transaction-storage";
import {
  getAllTransactions,
  generateTransactionId,
  saveTransaction,
} from "@/services/transaction-storage";

export interface POSContextValue {
  transactions: Transaction[];
  tcpStatus: TCPServerStatus;
  tcpPort: number | null;
  isTCPEnabled: boolean;
  pendingTCPRequest: TCPPaymentRequest | null;
  refreshTransactions: () => Promise<void>;
  addTransaction: (tx: Transaction) => Promise<void>;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  clearPendingRequest: () => void;
}

const POSContext = createContext<POSContextValue | null>(null);

export function POSProvider({ children }: { children: React.ReactNode }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [tcpStatus, setTcpStatus] = useState<TCPServerStatus>(getServerStatus());
  const [tcpPort, setTcpPort] = useState<number | null>(getServerPort());
  const [isTCPEnabled, setIsTCPEnabled] = useState(false);
  const [pendingTCPRequest, setPendingTCPRequest] = useState<TCPPaymentRequest | null>(null);

  const refreshTransactions = useCallback(async () => {
    const all = await getAllTransactions();
    setTransactions(all);
  }, []);

  const addTransaction = useCallback(async (tx: Transaction) => {
    await saveTransaction(tx);
    setTransactions((prev) => [tx, ...prev].slice(0, 200));
  }, []);

  const startListening = useCallback(async () => {
    setIsTCPEnabled(true);
    await startTCPServer(9090);
  }, []);

  const stopListening = useCallback(async () => {
    setIsTCPEnabled(false);
    await stopTCPServer();
  }, []);

  const clearPendingRequest = useCallback(() => {
    setPendingTCPRequest(null);
  }, []);

  useEffect(() => {
    refreshTransactions();
  }, [refreshTransactions]);

  useEffect(() => {
    const unsub = addStatusListener((status, port) => {
      setTcpStatus(status);
      if (port !== undefined) setTcpPort(port);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = addPaymentRequestListener((req: TCPPaymentRequest) => {
      setPendingTCPRequest(req);
    });
    return unsub;
  }, []);

  const value = useMemo<POSContextValue>(
    () => ({
      transactions,
      tcpStatus,
      tcpPort,
      isTCPEnabled,
      pendingTCPRequest,
      refreshTransactions,
      addTransaction,
      startListening,
      stopListening,
      clearPendingRequest,
    }),
    [
      transactions,
      tcpStatus,
      tcpPort,
      isTCPEnabled,
      pendingTCPRequest,
      refreshTransactions,
      addTransaction,
      startListening,
      stopListening,
      clearPendingRequest,
    ]
  );

  return <POSContext.Provider value={value}>{children}</POSContext.Provider>;
}

export function usePOS(): POSContextValue {
  const ctx = useContext(POSContext);
  if (!ctx) throw new Error("usePOS must be used within POSProvider");
  return ctx;
}
