export interface ChargeRequest {
  amount: number;
  tip: number;
  cardData: CardData;
  transactionId: string;
}

export interface CardData {
  pan?: string;
  expiryDate?: string;
  cardholderName?: string;
  track1?: string;
  track2?: string;
  emvData?: string;
  entryMode: "swipe" | "chip" | "contactless" | "manual";
  last4?: string;
  cardBrand?: string;
}

export interface ChargeResponse {
  success: boolean;
  transactionId: string;
  authCode?: string;
  errorCode?: string;
  errorMessage?: string;
  amount: number;
  tip: number;
  total: number;
  timestamp: string;
}

// Environment selection — set EXPO_PUBLIC_CHARRG_ENV to "dev", "test", or "prod"
const ENV = process.env.EXPO_PUBLIC_CHARRG_ENV ?? "dev";

const API_URLS: Record<string, string> = {
  dev:  process.env.EXPO_PUBLIC_CHARRG_API_URL_DEV  ?? "",
  test: process.env.EXPO_PUBLIC_CHARRG_API_URL_TEST ?? "",
  prod: process.env.EXPO_PUBLIC_CHARRG_API_URL_PROD ?? "",
};

const API_TOKENS: Record<string, string> = {
  dev:  process.env.EXPO_PUBLIC_CHARRG_API_TOKEN_DEV  ?? "",
  test: process.env.EXPO_PUBLIC_CHARRG_API_TOKEN_TEST ?? "",
  prod: process.env.EXPO_PUBLIC_CHARRG_API_TOKEN_PROD ?? "",
};

export const CHARRG_ENV = ENV;
export const CHARRG_BASE_URL = API_URLS[ENV] ?? API_URLS.dev;
const CHARRG_TOKEN = API_TOKENS[ENV] ?? API_TOKENS.dev;

export async function processPayment(req: ChargeRequest): Promise<ChargeResponse> {
  const total = req.amount + req.tip;

  if (!CHARRG_BASE_URL) {
    throw new Error(`Charrg API URL not configured for environment: ${ENV}`);
  }

  const payload = {
    transaction_id: req.transactionId,
    amount: req.amount,
    tip: req.tip,
    total,
    card: {
      pan: req.cardData.pan,
      expiry: req.cardData.expiryDate,
      cardholder_name: req.cardData.cardholderName,
      track1: req.cardData.track1,
      track2: req.cardData.track2,
      emv_data: req.cardData.emvData,
      entry_mode: req.cardData.entryMode,
      last4: req.cardData.last4,
      brand: req.cardData.cardBrand,
    },
    timestamp: new Date().toISOString(),
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (CHARRG_TOKEN) {
    headers["Authorization"] = `Bearer ${CHARRG_TOKEN}`;
  }

  const response = await fetch(`${CHARRG_BASE_URL}/v1/charge`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  return {
    success: data.success ?? true,
    transactionId: data.transaction_id ?? req.transactionId,
    authCode: data.auth_code,
    errorCode: data.error_code,
    errorMessage: data.error_message,
    amount: req.amount,
    tip: req.tip,
    total,
    timestamp: new Date().toISOString(),
  };
}
