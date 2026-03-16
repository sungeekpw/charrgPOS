import AsyncStorage from "@react-native-async-storage/async-storage";

const TRANSACTIONS_KEY = "charrg_transactions";
const MAX_STORED = 200;

export type TransactionStatus = "pending" | "approved" | "declined" | "error" | "cancelled";

export interface Transaction {
  id: string;
  amount: number;
  tip: number;
  total: number;
  status: TransactionStatus;
  authCode?: string;
  errorMessage?: string;
  last4?: string;
  cardBrand?: string;
  entryMode?: string;
  timestamp: string;
  source: "standalone" | "tcp";
  reference?: string;
}

export async function saveTransaction(tx: Transaction): Promise<void> {
  const all = await getAllTransactions();
  const updated = [tx, ...all].slice(0, MAX_STORED);
  await AsyncStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(updated));
}

export async function updateTransaction(
  id: string,
  patch: Partial<Transaction>
): Promise<void> {
  const all = await getAllTransactions();
  const updated = all.map((tx) => (tx.id === id ? { ...tx, ...patch } : tx));
  await AsyncStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(updated));
}

export async function getAllTransactions(): Promise<Transaction[]> {
  try {
    const raw = await AsyncStorage.getItem(TRANSACTIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Transaction[];
  } catch {
    return [];
  }
}

export async function clearTransactions(): Promise<void> {
  await AsyncStorage.removeItem(TRANSACTIONS_KEY);
}

export function generateTransactionId(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `TXN-${timestamp}-${rand}`;
}

export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatCurrencyRaw(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}
