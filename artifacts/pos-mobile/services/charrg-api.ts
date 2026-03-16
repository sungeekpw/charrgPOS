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

const CHARRG_BASE_URL = "https://api.charrg.com";

export async function processPayment(req: ChargeRequest): Promise<ChargeResponse> {
  const total = req.amount + req.tip;

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

  const response = await fetch(`${CHARRG_BASE_URL}/v1/charge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
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
