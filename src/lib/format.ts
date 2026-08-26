import { i18next } from "@/i18n";

/** Full BCP-47 locale for the active language, used for dates/numbers/money. */
export function activeLocale(): string {
  const lng = i18next.resolvedLanguage ?? i18next.language ?? "en";
  return lng.startsWith("es") ? "es-ES" : "en-GB";
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 21 August 2026 / 21 de agosto de 2026 */
export function formatDate(
  value: string | number | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" },
): string {
  const d = toDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat(activeLocale(), opts).format(d);
}

/** Short form: 21 Aug 2026 / 21 ago 2026 */
export function formatDateShort(value: string | number | Date | null | undefined): string {
  return formatDate(value, { day: "numeric", month: "short", year: "numeric" });
}

export function formatMonth(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat(activeLocale(), { month: "long" }).format(d);
}

/** 24.50 / 24,50 */
export function formatNumber(
  value: number | string | null | undefined,
  opts: Intl.NumberFormatOptions = {},
): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  return new Intl.NumberFormat(activeLocale(), opts).format(n);
}

/** Currency in the position the locale expects: €24.50 / 24,50 € */
export function formatMoney(
  value: number | string | null | undefined,
  currency: string | null | undefined,
): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  const cur = (currency || "EUR").toUpperCase();
  try {
    return new Intl.NumberFormat(activeLocale(), {
      style: "currency",
      currency: cur,
      maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
    }).format(n);
  } catch {
    return `${formatNumber(n, { maximumFractionDigits: 2 })} ${cur}`;
  }
}
