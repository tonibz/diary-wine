const REGION_CURRENCY: Record<string, string> = {
  US: "USD", GB: "GBP", IE: "EUR", FR: "EUR", DE: "EUR", ES: "EUR", IT: "EUR",
  PT: "EUR", NL: "EUR", BE: "EUR", AT: "EUR", FI: "EUR", GR: "EUR", SI: "EUR",
  SK: "EUR", EE: "EUR", LV: "EUR", LT: "EUR", LU: "EUR", MT: "EUR", CY: "EUR",
  HR: "EUR", CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK",
  HU: "HUF", RO: "RON", CA: "CAD", AU: "AUD", NZ: "NZD", ZA: "ZAR", JP: "JPY",
  CN: "CNY", HK: "HKD", SG: "SGD", IN: "INR", BR: "BRL", MX: "MXN", AR: "ARS",
  CL: "CLP", TR: "TRY", IL: "ILS", KR: "KRW", AE: "AED",
};

/** Best-effort currency guess from the browser locale. Never throws. */
export function localeCurrency(): string {
  try {
    const locale = typeof navigator !== "undefined" ? navigator.language : "en-US";
    const region = new Intl.Locale(locale).region ?? locale.split("-")[1]?.toUpperCase();
    return (region && REGION_CURRENCY[region]) || "EUR";
  } catch {
    return "EUR";
  }
}

export const CURRENCY_OPTIONS = ["EUR", "GBP", "USD", "CHF", "SEK", "AUD", "CAD", "JPY"];
