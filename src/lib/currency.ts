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

/** Country names as reverse geocoding (English) or the user (Spanish) may write them. */
const COUNTRY_NAME_CODE: Record<string, string> = {
  "united states": "US", "united states of america": "US", usa: "US", "estados unidos": "US",
  "united kingdom": "GB", uk: "GB", "reino unido": "GB", ireland: "IE", irlanda: "IE",
  france: "FR", francia: "FR", germany: "DE", deutschland: "DE", alemania: "DE",
  spain: "ES", espana: "ES", italy: "IT", italia: "IT", portugal: "PT",
  netherlands: "NL", "paises bajos": "NL", belgium: "BE", belgica: "BE", austria: "AT",
  finland: "FI", finlandia: "FI", greece: "GR", grecia: "GR", slovenia: "SI", eslovenia: "SI",
  slovakia: "SK", eslovaquia: "SK", estonia: "EE", latvia: "LV", letonia: "LV",
  lithuania: "LT", lituania: "LT", luxembourg: "LU", luxemburgo: "LU", malta: "MT",
  cyprus: "CY", chipre: "CY", croatia: "HR", croacia: "HR", switzerland: "CH", suiza: "CH",
  sweden: "SE", suecia: "SE", norway: "NO", noruega: "NO", denmark: "DK", dinamarca: "DK",
  poland: "PL", polonia: "PL", czechia: "CZ", "czech republic": "CZ", "republica checa": "CZ",
  hungary: "HU", hungria: "HU", romania: "RO", rumania: "RO", canada: "CA",
  australia: "AU", "new zealand": "NZ", "nueva zelanda": "NZ", "south africa": "ZA",
  sudafrica: "ZA", japan: "JP", japon: "JP", china: "CN", "hong kong": "HK",
  singapore: "SG", singapur: "SG", india: "IN", brazil: "BR", brasil: "BR",
  mexico: "MX", argentina: "AR", chile: "CL", turkey: "TR", turkiye: "TR", turquia: "TR",
  israel: "IL", "south korea": "KR", "corea del sur": "KR", "united arab emirates": "AE",
  "emiratos arabes unidos": "AE",
  armenia: "AM", azerbaijan: "AZ", azerbaiyan: "AZ", bolivia: "BO", bulgaria: "BG",
  georgia: "GE", lebanon: "LB", libano: "LB", moldova: "MD", moldavia: "MD",
  morocco: "MA", marruecos: "MA", "north macedonia": "MK", "macedonia del norte": "MK",
  peru: "PE", serbia: "RS", ukraine: "UA", ucrania: "UA", uruguay: "UY",
};

/** ISO 3166-1 alpha-2 code for a country name (English or Spanish), or null. */
export function countryCode(country: string | null | undefined): string | null {
  if (!country) return null;
  const key = country
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  return COUNTRY_NAME_CODE[key] ?? null;
}

/**
 * Currency for a country, from its ISO code (preferred) or its name.
 * Returns null when the country is unknown — never a guess.
 */
export function currencyForCountry(
  country: string | null | undefined,
  countryCode?: string | null,
): string | null {
  const code = countryCode?.trim().toUpperCase();
  if (code && REGION_CURRENCY[code]) return REGION_CURRENCY[code];
  const fromName = countryCode(country);
  return (fromName && REGION_CURRENCY[fromName]) || null;
}

export const CURRENCY_OPTIONS = ["EUR", "GBP", "USD", "CHF", "SEK", "AUD", "CAD", "JPY"];
