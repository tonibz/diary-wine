import { supabase } from "@/integrations/supabase/client";
import { withTimeout } from "@/lib/with-timeout";
import { i18next } from "@/i18n";

type Row = Record<string, string>;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = Array.isArray(value) ? value.join("; ") : String(value);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: Row[]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) lines.push(headers.map((h) => csvCell(r[h])).join(","));
  return `\ufeff${lines.join("\n")}`;
}

/** The signed-in user's own diary, every entry, as a CSV string. */
export async function buildDiaryCsv(): Promise<string> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase
        .from("entries")
        .select(
          `tasted_on, place, company, notes, rating, status, price_paid, price_currency, price_context,
           vintage_row:wine_vintages!inner(vintage, alcohol_percent,
             wine:wines!inner(name, producer, appellation, classification, region, country, wine_type, grapes))`,
        )
        .order("tasted_on", { ascending: false }),
    ),
    15_000,
    i18next.t("errorState.body"),
  );
  if (error) throw error;

  type Joined = {
    tasted_on: string | null;
    place: string | null;
    company: string | null;
    notes: string | null;
    rating: number | null;
    status: string | null;
    price_paid: number | null;
    price_currency: string | null;
    price_context: string | null;
    vintage_row: {
      vintage: number | null;
      alcohol_percent: number | null;
      wine: {
        name: string | null;
        producer: string | null;
        appellation: string | null;
        classification: string | null;
        region: string | null;
        country: string | null;
        wine_type: string | null;
        grapes: string[] | null;
      } | null;
    } | null;
  };

  const headers = [
    "wine",
    "producer",
    "appellation",
    "classification",
    "region",
    "country",
    "vintage",
    "type",
    "grapes",
    "alcohol_percent",
    "rating",
    "status",
    "tasted_on",
    "place",
    "company",
    "notes",
    "price_paid",
    "price_currency",
    "price_context",
  ];

  const rows: Row[] = ((data ?? []) as unknown as Joined[]).map((e) => {
    const w = e.vintage_row?.wine;
    return {
      wine: w?.name ?? "",
      producer: w?.producer ?? "",
      appellation: w?.appellation ?? "",
      classification: w?.classification ?? "",
      region: w?.region ?? "",
      country: w?.country ?? "",
      vintage: e.vintage_row?.vintage != null ? String(e.vintage_row.vintage) : "",
      type: w?.wine_type ?? "",
      grapes: (w?.grapes ?? []).join("; "),
      alcohol_percent:
        e.vintage_row?.alcohol_percent != null ? String(e.vintage_row.alcohol_percent) : "",
      rating: e.rating != null ? String(e.rating) : "",
      status: e.status ?? "",
      tasted_on: e.tasted_on ?? "",
      place: e.place ?? "",
      company: e.company ?? "",
      notes: e.notes ?? "",
      price_paid: e.price_paid != null ? String(e.price_paid) : "",
      price_currency: e.price_currency ?? "",
      price_context: e.price_context ?? "",
    };
  });

  return toCsv(headers, rows);
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
