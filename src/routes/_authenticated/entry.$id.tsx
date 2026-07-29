import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getSignedPhotoUrl } from "@/lib/wine-photo";
import { StarRating } from "@/components/StarRating";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Wine, Pencil, Trash2, Check } from "lucide-react";
import { format } from "date-fns";
import { recomputeTasteProfile } from "@/lib/taste-profile";

export const Route = createFileRoute("/_authenticated/entry/$id")({
  head: () => ({ meta: [{ title: "Wine detail — Wine Diary" }, { name: "description", content: "A bottle you tasted." }] }),
  component: EntryDetail,
});

type Entry = {
  id: string;
  photo_url: string | null;
  rating: number | null;
  tasted_on: string;
  place: string | null;
  company: string | null;
  notes: string | null;
  wine_id: string;
  wine: {
    id: string; name: string; producer: string | null; appellation: string | null;
    region: string | null; country: string | null; vintage: number | null;
    wine_type: string | null; grapes: string[] | null; alcohol_percent: number | null;
    label_image_url: string | null;
  } | null;
};

const bottleFields: Array<{ key: keyof NonNullable<Entry["wine"]>; label: string; type?: string; options?: string[] }> = [
  { key: "producer", label: "Producer" },
  { key: "appellation", label: "Appellation" },
  { key: "region", label: "Region" },
  { key: "country", label: "Country" },
  { key: "vintage", label: "Vintage", type: "number" },
  { key: "wine_type", label: "Type", options: ["red", "white", "rose", "sparkling", "dessert", "fortified"] },
  { key: "alcohol_percent", label: "Alcohol %", type: "number" },
];


function EntryDetail() {
  const { id } = useParams({ from: "/_authenticated/entry/$id" });
  const navigate = useNavigate();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [editingTasting, setEditingTasting] = useState(false);
  const [rating, setRating] = useState(0);
  const [notes, setNotes] = useState("");
  const [place, setPlace] = useState("");
  const [company, setCompany] = useState("");

  async function load() {
    const { data } = await supabase
      .from("entries")
      .select("id, photo_url, rating, tasted_on, place, company, notes, wine_id, wine:wines(id, name, producer, appellation, region, country, vintage, wine_type, grapes, alcohol_percent, label_image_url)")
      .eq("id", id).single();
    setEntry(data as unknown as Entry);
    if (data) {
      setRating(data.rating ?? 0);
      setNotes(data.notes ?? "");
      setPlace(data.place ?? "");
      setCompany(data.company ?? "");
      const ref = data.photo_url ?? data.wine?.label_image_url ?? null;
      setPhotoUrl(await getSignedPhotoUrl(ref));
    }
  }
  useEffect(() => { load(); }, [id]);

  async function saveTasting() {
    if (!entry) return;
    const { error } = await supabase.from("entries").update({
      rating: rating || null, notes: notes || null, place: place || null, company: company || null,
    }).eq("id", entry.id);
    if (error) return toast.error(error.message);
    toast.success("Updated");
    setEditingTasting(false);
    load();
    const { data } = await supabase.auth.getUser();
    if (data.user) recomputeTasteProfile(data.user.id);
  }

  async function saveWineField(key: string, value: string) {
    if (!entry?.wine) return;
    const payload: Record<string, unknown> = {};
    payload[key] = key === "vintage" ? (value ? Number(value) : null)
      : key === "alcohol_percent" ? (value ? Number(value) : null)
      : value.trim() || null;
    const { error } = await supabase.from("wines").update(payload as never).eq("id", entry.wine.id);
    if (error) return toast.error(error.message);
    load();
    const { data } = await supabase.auth.getUser();
    if (data.user) recomputeTasteProfile(data.user.id);
  }

  async function onDelete() {
    if (!entry) return;
    if (!confirm("Remove this from your diary?")) return;
    const { error } = await supabase.from("entries").delete().eq("id", entry.id);
    if (error) return toast.error(error.message);
    const { data } = await supabase.auth.getUser();
    if (data.user) await recomputeTasteProfile(data.user.id);
    navigate({ to: "/diary" });
  }

  if (!entry) return <div className="p-6 text-center text-muted-foreground">Loading…</div>;
  const w = entry.wine;

  return (
    <div className="pb-12">
      <div className="relative">
        {photoUrl ? (
          <img src={photoUrl} alt={w?.name ?? "wine"} className="w-full h-64 object-cover" />

        ) : (
          <div className="w-full h-40 bg-parchment flex items-center justify-center">
            <Wine className="text-primary/30" size={48} />
          </div>
        )}
        <button onClick={() => navigate({ to: "/diary" })} className="absolute top-4 left-4 bg-background/90 rounded-full p-2 shadow">
          <ArrowLeft size={20} />
        </button>
        <button onClick={onDelete} className="absolute top-4 right-4 bg-background/90 rounded-full p-2 shadow text-destructive">
          <Trash2 size={18} />
        </button>
      </div>

      <div className="px-5 pt-5">
        <h1 className="text-3xl font-serif text-foreground leading-tight">{w?.name}</h1>
        {w?.producer && <p className="text-muted-foreground mt-1">{w.producer}{w.vintage ? ` · ${w.vintage}` : ""}</p>}
        <div className="mt-2"><StarRating value={entry.rating ?? 0} size={20} /></div>

        <section className="mt-6 rounded-2xl bg-card p-4 border border-border shadow-notebook">
          <h2 className="font-serif text-lg mb-3">The bottle</h2>
          <dl className="space-y-2 text-sm">
            {bottleFields.map((f) => {
              const val = (w?.[f.key] ?? null) as string | number | null;
              return (
                <FieldRow key={f.key} label={f.label} value={val} type={f.type} options={f.options} onSave={(v) => saveWineField(f.key, v)} />
              );
            })}
            <FieldRow
              label="Grapes"
              value={w?.grapes?.length ? w.grapes.join(", ") : null}
              onSave={(v) => {
                const arr = v.split(",").map((s) => s.trim()).filter(Boolean);
                if (!w) return;
                supabase.from("wines").update({ grapes: arr }).eq("id", w.id).then(() => load());
              }}
            />
          </dl>
        </section>

        <section className="mt-4 rounded-2xl bg-card p-4 border border-border shadow-notebook">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-serif text-lg">My tasting</h2>
            <button onClick={() => setEditingTasting((s) => !s)} className="text-muted-foreground hover:text-primary">
              {editingTasting ? <Check size={18} onClick={saveTasting} /> : <Pencil size={16} />}
            </button>
          </div>
          {editingTasting ? (
            <div className="space-y-3">
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">Rating</Label><StarRating value={rating} onChange={setRating} /></div>
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">Place</Label><Input value={place} onChange={(e) => setPlace(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">With</Label><Input value={company} onChange={(e) => setCompany(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">Notes</Label><Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
              <Button onClick={saveTasting} className="w-full">Save</Button>
            </div>
          ) : (
            <dl className="space-y-2 text-sm">
              <Row label="Tasted on" value={format(new Date(entry.tasted_on), "d MMMM yyyy")} />
              <Row label="Place" value={entry.place} />
              <Row label="With" value={entry.company} />
              {entry.notes && (
                <div className="pt-2 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="whitespace-pre-wrap leading-relaxed">{entry.notes}</p>
                </div>
              )}
            </dl>
          )}
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function FieldRow({
  label, value, type, onSave,
}: {
  label: string;
  value: string | number | null;
  type?: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value != null ? String(value) : "");
  useEffect(() => { setV(value != null ? String(value) : ""); }, [value]);
  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-24 shrink-0">{label}</span>
        <Input type={type} value={v} onChange={(e) => setV(e.target.value)} className="h-8" autoFocus />
        <button onClick={() => { onSave(v); setEditing(false); }} className="text-primary p-1"><Check size={16} /></button>
      </div>
    );
  }
  if (value == null || value === "") {
    return (
      <button onClick={() => setEditing(true)} className="flex justify-between w-full items-center py-0.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-xs rounded-full bg-muted px-2 py-0.5 text-muted-foreground hover:bg-primary/10 hover:text-primary">+ add</span>
      </button>
    );
  }
  return (
    <button onClick={() => setEditing(true)} className="flex justify-between w-full text-left group">
      <span className="text-muted-foreground">{label}</span>
      <span className="group-hover:text-primary">{String(value)}</span>
    </button>
  );
}
