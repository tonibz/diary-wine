import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles } from "lucide-react";

type Taste = {
  type_split: Record<string, number>;
  top_countries: Array<{ key: string; count: number }>;
  top_grapes: Array<{ key: string; count: number }>;
  avg_vintage_age: number | null;
  avg_alcohol: number | null;
  entry_count: number;
};

export const Route = createFileRoute("/_authenticated/taste")({
  head: () => ({ meta: [{ title: "My Taste — Wine Diary" }, { name: "description", content: "A picture of what you like, built from your diary." }] }),
  component: TastePage,
});

function TastePage() {
  const [t, setT] = useState<Taste | null>(null);
  const [otherCount, setOtherCount] = useState(0);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: row } = await supabase.from("taste_profiles").select("*").eq("user_id", data.user.id).maybeSingle();
      if (row) setT(row as unknown as Taste);
      const { count } = await supabase
        .from("entries")
        .select("wine:wines!inner(wine_type)", { count: "exact", head: true })
        .not("wine.wine_type", "in", "(red,white)");
      setOtherCount(count ?? 0);
    });
  }, []);

  if (!t) {
    return <div className="px-5 pt-8 pb-8"><h1 className="text-4xl font-serif text-primary">My Taste</h1>
      <p className="text-muted-foreground mt-6">Log a few wines and this page will fill itself in.</p></div>;
  }

  if (t.entry_count < 5) {
    return (
      <div className="px-5 pt-8 pb-8">
        <h1 className="text-4xl font-serif text-primary">My Taste</h1>
        <div className="mt-8 rounded-2xl bg-card p-8 border border-border shadow-notebook text-center">
          <Sparkles className="mx-auto text-primary mb-3" size={32} />
          <p className="font-serif text-2xl text-foreground">{t.entry_count} of 5 so far</p>
          <p className="text-muted-foreground mt-2 text-sm">
            A few more bottles and your taste picture will appear here.
          </p>
        </div>
      </div>
    );
  }

  const red = t.type_split.red ?? 0;
  const white = t.type_split.white ?? 0;
  const other = Object.entries(t.type_split).filter(([k]) => k !== "red" && k !== "white").reduce((a, [, v]) => a + v, 0);
  const total = red + white + other;
  const summary = buildSummary(t, red, white);
  const maxGrape = Math.max(1, ...t.top_grapes.map((g) => g.count));

  return (
    <div className="px-5 pt-8 pb-8 space-y-6">
      <header>
        <h1 className="text-4xl font-serif text-primary">My Taste</h1>
        <p className="mt-3 text-foreground leading-relaxed">{summary}</p>
      </header>

      <section className="rounded-2xl bg-card p-5 border border-border shadow-notebook">
        <h2 className="font-serif text-lg mb-4">Colours you pour</h2>
        <Donut red={red} white={white} other={other} />
        <div className="mt-4 flex justify-center gap-4 text-xs">
          <Legend colour="var(--primary)" label={`Red · ${red}`} />
          <Legend colour="oklch(0.85 0.05 85)" label={`White · ${white}`} />
          {other > 0 && <Legend colour="var(--muted-foreground)" label={`Other · ${other}`} />}
        </div>
        {otherCount > 0 && (
          <p className="mt-3 text-xs text-muted-foreground text-center">
            Rosé, sparkling and other bottles are still in your diary; the stats here focus on red &amp; white for now.
          </p>
        )}
        <p className="sr-only">Total {total} entries used for split.</p>
      </section>

      {t.top_countries.length > 0 && (
        <section className="rounded-2xl bg-card p-5 border border-border shadow-notebook">
          <h2 className="font-serif text-lg mb-3">Top countries</h2>
          <ul className="space-y-2">
            {t.top_countries.map((c) => {
              const max = t.top_countries[0].count;
              return (
                <li key={c.key}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{c.key}</span>
                    <span className="text-muted-foreground">{c.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${(c.count / max) * 100}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {t.top_grapes.length > 0 && (
        <section className="rounded-2xl bg-card p-5 border border-border shadow-notebook">
          <h2 className="font-serif text-lg mb-3">Grapes you keep coming back to</h2>
          <div className="flex flex-wrap gap-2">
            {t.top_grapes.map((g) => {
              const scale = 0.9 + (g.count / maxGrape) * 0.9;
              return (
                <span
                  key={g.key}
                  style={{ fontSize: `${scale}rem` }}
                  className="rounded-full bg-primary/10 text-primary px-3 py-1 font-serif"
                >
                  {g.key}
                </span>
              );
            })}
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3">
        <Stat label="Average age" value={t.avg_vintage_age ? `${t.avg_vintage_age} yr` : "—"} />
        <Stat label="Average alcohol" value={t.avg_alcohol ? `${t.avg_alcohol}%` : "—"} />
      </section>
    </div>
  );
}

function buildSummary(t: Taste, red: number, white: number): string {
  const total = red + white;
  const bias = total === 0 ? "You're just getting started."
    : red > white * 1.3 ? "You lean red,"
    : white > red * 1.3 ? "You favour whites,"
    : "You split evenly between red and white,";
  const grape = t.top_grapes[0]?.key;
  const country = t.top_countries[0]?.key;
  const parts = [bias];
  if (grape) parts.push(`with a soft spot for ${grape}`);
  if (country) parts.push(`especially from ${country}`);
  return parts.join(" ") + ".";
}

function Donut({ red, white, other }: { red: number; white: number; other: number }) {
  const total = red + white + other || 1;
  const r = 46;
  const c = 2 * Math.PI * r;
  const segs = [
    { v: red, colour: "var(--primary)" },
    { v: white, colour: "oklch(0.85 0.05 85)" },
    { v: other, colour: "var(--muted-foreground)" },
  ];
  let offset = 0;
  return (
    <svg viewBox="0 0 120 120" className="mx-auto w-40 h-40 -rotate-90">
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--muted)" strokeWidth="14" />
      {segs.map((s, i) => {
        if (s.v === 0) return null;
        const dash = (s.v / total) * c;
        const el = (
          <circle key={i} cx="60" cy="60" r={r} fill="none" stroke={s.colour}
            strokeWidth="14" strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-offset} strokeLinecap="butt" />
        );
        offset += dash;
        return el;
      })}
    </svg>
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: colour }} />{label}</span>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-card p-4 border border-border shadow-notebook">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="font-serif text-2xl mt-1">{value}</p>
    </div>
  );
}
