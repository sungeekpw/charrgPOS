/**
 * Module-level signal to tell the Charge screen to reset its form.
 * Set by payment.tsx (handleNewCharge) and consumed by index.tsx (useFocusEffect).
 */
let _pending = false;

export function signalChargeReset() {
  _pending = true;
}

/** Returns true once, then clears the flag. */
export function consumeChargeReset(): boolean {
  const val = _pending;
  _pending = false;
  return val;
}
