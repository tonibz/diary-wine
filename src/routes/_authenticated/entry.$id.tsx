import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { i18next } from "@/i18n";
import { formatDate } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { getSignedPhotoUrl } from "@/lib/wine-photo";
import { compressImage } from "@/lib/image-compress";
import { StarRating } from "@/components/StarRating";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Wine, Pencil, Trash2, Check, ImagePlus, Camera, X } from "lucide-react";
import { format } from "date-fns";
import { recomputeTasteProfile } from "@/lib/taste-profile";
import { localeCurrency, CURRENCY_OPTIONS } from "@/lib/currency";
import { markFieldsAsUser } from "@/lib/field-provenance";
import { wineTypeLabel } from "@/lib/wine-type";

export const Route = createFileRoute("/_authenticated/entry/$id")({
  head: () => ({
    meta: [
      { title: i18next.t("entry.metaTitle") },
      { name: "description", content: i18next.t("entry.metaDescription") },
    ],
  }),
  component: EntryDetail,
});

type Entry = {
  id: string;
  photo_url: string | null;
  back_photo_url: string | null;
  rating: number | null;
  tasted_on: string;
  place: string | null;
  company: string | null;
  notes: string | null;
  status: "tasted" | "interested";
  price_paid: number | null;
  price_currency: string | null;
  price_context: string | null;
  wine_vintage_id: string;
  vintage_row: {
    id: string;
    vintage: number | null;
    alcohol_percent: number | null;
    wine: {
      id: string; name: string; producer: string | null; appellation: string | null;
      region: string | null; country: string | null;
      wine_type: string | null; grapes: string[] | null;
      label_image_url: string | null;
    } | null;
  } | null;
};

type WineRow = NonNullable<NonNullable<Entry["vintage_row"]>["wine"]>;

function useWineFields(): Array<{ key: keyof WineRow; label: string; options?: string[] }> {
  const { t } = useTranslation();
  return [
    { key: "producer", label: t("entry.fields.producer") },
    { key: "appellation", label: t("entry.fields.appellation") },
    { key: "region", label: t("entry.fields.region") },
    { key: "country", label: t("entry.fields.country") },
    { key: "wine_type", label: t("entry.fields.type"), options: ["red", "white", "rose", "sparkling", "dessert", "fortified"] },
  ];
}

const SELECT =
  "id, photo_url, back_photo_url, rating, tasted_on, place, company, notes, status, price_paid, price_currency, price_context, wine_vintage_id, vintage_row:wine_vintages(id, vintage, alcohol_percent, wine:wines(id, name, producer, appellation, region, country, wine_type, grapes, label_image_url))";

function EntryDetail() {
  const { t } = useTranslation();
  const wineFields = useWineFields();
  const { id } = useParams({ from: "/_authenticated/entry/$id" });
  const navigate = useNavigate();
  const backFileRef = useRef<HTMLInputElement>(null);
  const backLibraryRef = useRef<HTMLInputElement>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [backPhotoUrl, setBackPhotoUrl] = useState<string | null>(null);
  const [editingTasting, setEditingTasting] = useState(false);
  const [rating, setRating] = useState(0);
  const [notes, setNotes] = useState("");
  const [place, setPlace] = useState("");
  const [company, setCompany] = useState("");
  const [tastedOn, setTastedOn] = useState(format(new Date(), "yyyy-MM-dd"));
  const [pricePaid, setPricePaid] = useState("");
  const [priceCurrency, setPriceCurrency] = useState(localeCurrency());
  const [priceContext, setPriceContext] = useState("");
  const [converting, setConverting] = useState(false);

  async function load() {
    const { data } = await supabase.from("entries").select(SELECT).eq("id", id).single();
    const e = data as unknown as Entry | null;
    setEntry(e);
    if (e) {
      setRating(e.rating ?? 0);
      setNotes(e.notes ?? "");
      setPlace(e.place ?? "");
      setCompany(e.company ?? "");
      setTastedOn(e.tasted_on);
      setPricePaid(e.price_paid != null ? String(e.price_paid) : "");
      if (e.price_currency) setPriceCurrency(e.price_currency);
      setPriceContext(e.price_context ?? "");
      const ref = e.photo_url ?? e.vintage_row?.wine?.label_image_url ?? null;
      setPhotoUrl(await getSignedPhotoUrl(ref));
      setBackPhotoUrl(await getSignedPhotoUrl(e.back_photo_url));
    }
  }
  useEffect(() => { load(); }, [id]);

  async function saveTasting() {
    if (!entry) return;
    const { error } = await supabase.from("entries").update({
      rating: rating || null,
      notes: notes || null,
      place: place || null,
      company: company || null,
      tasted_on: tastedOn,
      price_paid: pricePaid ? Number(pricePaid) : null,
      price_currency: pricePaid ? priceCurrency : null,
      price_context: (priceContext || null) as never,
    }).eq("id", entry.id);
    if (error) return toast.error(error.message);
    toast.success(t("entry.toast.updated"));
    setEditingTasting(false);
    await load();
    const { data } = await supabase.auth.getUser();
    if (data.user) recomputeTasteProfile(data.user.id);
  }

  /** Wishlist → tasting: ask for rating, date and place, then flip the status. */
  async function convertToTasting() {
    if (!entry) return;
    const { error } = await supabase.from("entries").update({
      status: "tasted",
      rating: rating || null,
      tasted_on: tastedOn,
      place: place || null,
      company: company || null,
      notes: notes || null,
      price_paid: pricePaid ? Number(pricePaid) : null,
      price_currency: pricePaid ? priceCurrency : null,
      price_context: (priceContext || null) as never,
    }).eq("id", entry.id);
    if (error) return toast.error(error.message);
    setConverting(false);
    toast.success(t("entry.toast.convertedToTasting"));
    await load();
    const { data } = await supabase.auth.getUser();
    if (data.user) recomputeTasteProfile(data.user.id);
  }

  async function saveWineField(key: string, value: string) {
    const w = entry?.vintage_row?.wine;
    if (!w) return;
    const payload: Record<string, unknown> = { [key]: value.trim() || null };
    const { error } = await supabase.from("wines").update(payload as never).eq("id", w.id);
    if (error) return toast.error(error.message);
    await markFieldsAsUser(w.id, [key]);
    await load();
    const { data } = await supabase.auth.getUser();
    if (data.user) recomputeTasteProfile(data.user.id);
  }

  /** Vintage and alcohol live on the wine_vintages row, not on wines. */
  async function saveVintageField(key: "vintage" | "alcohol_percent", value: string) {
    if (!entry?.vintage_row) return;
    const num = value ? Number(value) : null;
    const wineIdForSources = entry.vintage_row.wine?.id;
    if (wineIdForSources) await markFieldsAsUser(wineIdForSources, [key]);
    if (key === "alcohol_percent") {
      const { error } = await supabase
        .from("wine_vintages")
        .update({ alcohol_percent: num })
        .eq("id", entry.vintage_row.id);
      if (error) return toast.error(error.message);
      await load();
      return;
    }
    // Changing the year means moving the entry to a different vintage row of the same wine.
    const wineId = entry.vintage_row.wine?.id;
    if (!wineId) return;
    let q = supabase.from("wine_vintages").select("id").eq("wine_id", wineId);
    q = num == null ? q.is("vintage", null) : q.eq("vintage", num);
    const { data: existing } = await q.maybeSingle();
    let vintageId = existing?.id;
    if (!vintageId) {
      const { data: created, error } = await supabase
        .from("wine_vintages")
        .insert({ wine_id: wineId, vintage: num, alcohol_percent: entry.vintage_row.alcohol_percent })
        .select("id")
        .single();
      if (error) return toast.error(error.message);
      vintageId = created.id;
    }
    const { error: linkErr } = await supabase
      .from("entries")
      .update({ wine_vintage_id: vintageId })
      .eq("id", entry.id);
    if (linkErr) return toast.error(linkErr.message);
    await load();
    const { data } = await supabase.auth.getUser();
    if (data.user) recomputeTasteProfile(data.user.id);
  }

  async function onBackPhoto(file: File) {
    if (!entry) return;
    try {
      const compressed = await compressImage(file);
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user!.id;
      const path = `${uid}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("wine-photos").upload(path, compressed, { contentType: "image/jpeg" });
      if (up.error) throw up.error;
      const { error } = await supabase.from("entries").update({ back_photo_url: path }).eq("id", entry.id);
      if (error) throw error;
      await load();
      toast.success(t("entry.backLabel.added"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("entry.toast.uploadFailed"));
    }
  }

  async function removeBackPhoto() {
    if (!entry) return;
    await supabase.from("entries").update({ back_photo_url: null }).eq("id", entry.id);
    await load();
  }

  async function onDelete() {
    if (!entry) return;
    if (!confirm(t("entry.toast.deleteConfirm"))) return;
    const { error } = await supabase.from("entries").delete().eq("id", entry.id);
    if (error) return toast.error(error.message);
    const { data } = await supabase.auth.getUser();
    if (data.user) await recomputeTasteProfile(data.user.id);
    navigate({ to: entry.status === "interested" ? "/wishlist" : "/diary" });
  }

  if (!entry) return <div className="p-6 text-center text-muted-foreground">{t("common.loading")}</div>;
  const w = entry.vintage_row?.wine;
  const isWishlist = entry.status === "interested";

  return (
    <div className="pb-12">
      <div className="relative">
        {photoUrl ? (
          <img src={photoUrl} alt={w?.name ?? t("entry.wineAltFallback")} className="w-full h-64 object-cover" />
        ) : (
          <div className="w-full h-40 bg-parchment flex items-center justify-center">
            <Wine className="text-primary/30" size={48} />
          </div>
        )}
        <button
          onClick={() => navigate({ to: isWishlist ? "/wishlist" : "/diary" })}
          className="absolute top-4 left-4 bg-background/90 rounded-full p-2 shadow"
        >
          <ArrowLeft size={20} />
        </button>
        <button onClick={onDelete} className="absolute top-4 right-4 bg-background/90 rounded-full p-2 shadow text-destructive">
          <Trash2 size={18} />
        </button>
      </div>

      <div className="px-5 pt-5">
        {isWishlist && (
          <span className="inline-block mb-2 rounded-full bg-primary/10 text-primary text-xs px-2.5 py-1">
            {t("entry.onWishlist")}
          </span>
        )}
        <h1 className="text-3xl font-serif text-foreground leading-tight">{w?.name}</h1>
        {w?.producer && (
          <p className="text-muted-foreground mt-1">
            {w.producer}{entry.vintage_row?.vintage ? ` · ${entry.vintage_row.vintage}` : ""}
          </p>
        )}
        {!isWishlist && <div className="mt-2"><StarRating value={entry.rating ?? 0} size={20} /></div>}

        <section className="mt-6 rounded-2xl bg-card p-4 border border-border shadow-notebook">
          <h2 className="font-serif text-lg mb-3">{t("entry.bottle.title")}</h2>
          <dl className="space-y-2 text-sm">
            {wineFields.map((f) => {
              const val = (w?.[f.key] ?? null) as string | number | null;
              return (
                <FieldRow key={f.key} label={f.label} value={val} options={f.options} onSave={(v) => saveWineField(f.key, v)} />
              );
            })}
            <FieldRow
              label={t("entry.fields.vintage")}
              type="number"
              value={entry.vintage_row?.vintage ?? null}
              onSave={(v) => saveVintageField("vintage", v)}
            />
            <FieldRow
              label={t("entry.fields.alcohol")}
              type="number"
              value={entry.vintage_row?.alcohol_percent ?? null}
              onSave={(v) => saveVintageField("alcohol_percent", v)}
            />
            <FieldRow
              label={t("entry.fields.grapes")}
              value={w?.grapes?.length ? w.grapes.join(", ") : null}
              onSave={(v) => {
                const arr = v.split(",").map((s) => s.trim()).filter(Boolean);
                if (!w) return;
                supabase
                  .from("wines")
                  .update({ grapes: arr })
                  .eq("id", w.id)
                  .then(() => markFieldsAsUser(w.id, ["grapes"]))
                  .then(() => load());
              }}
            />
          </dl>
        </section>

        {/* Optional back label */}
        <section className="mt-4 rounded-2xl bg-card p-4 border border-border shadow-notebook">
          <h2 className="font-serif text-lg mb-3">{t("entry.backLabel.title")}</h2>
          {backPhotoUrl ? (
            <div className="relative">
              <img src={backPhotoUrl} alt={t("entry.backLabel.alt")} className="w-full h-48 object-cover rounded-lg" />
              <button onClick={removeBackPhoto} className="absolute top-2 right-2 bg-background/90 rounded-full p-1">
                <X size={16} />
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={() => backFileRef.current?.click()}>
                <Camera size={14} /> {t("entry.backLabel.takePhoto")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => backLibraryRef.current?.click()}>
                <ImagePlus size={14} /> {t("entry.backLabel.chooseFromLibrary")}
              </Button>
            </div>
          )}
          <input
            ref={backFileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onBackPhoto(f); e.target.value = ""; }}
          />
          <input
            ref={backLibraryRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onBackPhoto(f); e.target.value = ""; }}
          />

        </section>

        {isWishlist ? (
          <section className="mt-4 rounded-2xl bg-card p-4 border border-border shadow-notebook">
            {entry.notes && !converting && (
              <p className="whitespace-pre-wrap leading-relaxed text-sm mb-3">{entry.notes}</p>
            )}
            {converting ? (
              <div className="space-y-3">
                <h2 className="font-serif text-lg">{t("entry.wishlistSection.howWasIt")}</h2>
                <div className="space-y-1"><Label className="text-xs text-muted-foreground">{t("entry.tasting.rating")}</Label><StarRating value={rating} onChange={setRating} /></div>
                <div className="space-y-1"><Label className="text-xs text-muted-foreground">{t("entry.tasting.date")}</Label><Input type="date" value={tastedOn} onChange={(e) => setTastedOn(e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs text-muted-foreground">{t("entry.tasting.place")}</Label><Input value={place} onChange={(e) => setPlace(e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs text-muted-foreground">{t("entry.tasting.notes")}</Label><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
                <PriceFields
                  pricePaid={pricePaid} setPricePaid={setPricePaid}
                  priceCurrency={priceCurrency} setPriceCurrency={setPriceCurrency}
                  priceContext={priceContext} setPriceContext={setPriceContext}
                />
                <div className="flex gap-2">
                  <Button onClick={convertToTasting} className="flex-1">{t("entry.wishlistSection.saveToDiary")}</Button>
                  <Button variant="ghost" onClick={() => setConverting(false)}>{t("entry.wishlistSection.cancel")}</Button>
                </div>
              </div>
            ) : (
              <Button onClick={() => setConverting(true)} className="w-full">{t("entry.wishlistSection.triedItNow")}</Button>
            )}
          </section>
        ) : (
          <section className="mt-4 rounded-2xl bg-card p-4 border border-border shadow-notebook">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-serif text-lg">{t("entry.tasting.title")}</h2>
              <button onClick={() => setEditingTasting((s) => !s)} className="text-muted-foreground hover:text-primary">
                {editingTasting ? <Check size={18} /> : <Pencil size={16} />}
              </button>
            </div>
            {editingTasting ? (
              <div className="space-y-3">
                <div className="space-y-1"><Label className="text-xs text-muted-foreground">{t("entry.tasting.rating")}</Label><StarRating value={rating} onChange={setRating} /></div>
                <div className="space-y-1"><Label className="text-xs text-muted-foreground">{t("entry.tasting.date")}</Label><Input type="date" value={tastedOn} onChange={(e) => setTastedOn(e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs text-muted-foreground">{t("entry.tasting.place")}</Label><Input value={place} onChange={(e) => setPlace(e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs text-muted-foreground">{t("entry.tasting.with")}</Label><Input value={company} onChange={(e) => setCompany(e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs text-muted-foreground">{t("entry.tasting.notes")}</Label><Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
                <PriceFields
                  pricePaid={pricePaid} setPricePaid={setPricePaid}
                  priceCurrency={priceCurrency} setPriceCurrency={setPriceCurrency}
                  priceContext={priceContext} setPriceContext={setPriceContext}
                />
                <Button onClick={saveTasting} className="w-full">{t("common.save")}</Button>
              </div>
            ) : (
              <dl className="space-y-2 text-sm">
                <Row label={t("entry.tasting.tastedOn")} value={formatDate(entry.tasted_on)} />
                <Row label={t("entry.tasting.place")} value={entry.place} />
                <Row label={t("entry.tasting.with")} value={entry.company} />
                {entry.notes && (
                  <div className="pt-2 border-t border-border">
                    <p className="text-xs text-muted-foreground mb-1">{t("entry.tasting.notes")}</p>
                    <p className="whitespace-pre-wrap leading-relaxed">{entry.notes}</p>
                  </div>
                )}
              </dl>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function PriceFields({
  pricePaid, setPricePaid, priceCurrency, setPriceCurrency, priceContext, setPriceContext,
}: {
  pricePaid: string; setPricePaid: (v: string) => void;
  priceCurrency: string; setPriceCurrency: (v: string) => void;
  priceContext: string; setPriceContext: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 pt-2 border-t border-border">
      <p className="text-xs text-muted-foreground">{t("entry.price.hint")}</p>
      <div className="flex gap-2">
        <Input
          type="number"
          step="0.01"
          inputMode="decimal"
          value={pricePaid}
          onChange={(e) => setPricePaid(e.target.value)}
          placeholder={t("entry.price.placeholder")}
        />
        <Select value={priceCurrency} onValueChange={setPriceCurrency}>
          <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CURRENCY_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Select value={priceContext} onValueChange={setPriceContext}>
        <SelectTrigger><SelectValue placeholder={t("entry.price.wherePlaceholder")} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="restaurant">{t("entry.price.restaurant")}</SelectItem>
          <SelectItem value="shop">{t("entry.price.shop")}</SelectItem>
          <SelectItem value="online">{t("entry.price.online")}</SelectItem>
          <SelectItem value="other">{t("entry.price.other")}</SelectItem>
        </SelectContent>
      </Select>
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

function FieldRowAddButton({ label, onClick }: { label: string; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button onClick={onClick} className="flex justify-between w-full items-center py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-xs rounded-full bg-muted px-2 py-0.5 text-muted-foreground hover:bg-primary/10 hover:text-primary">{t("entry.fields.add")}</span>
    </button>
  );
}

function FieldRow({
  label, value, type, options, onSave,
}: {
  label: string;
  value: string | number | null;
  type?: string;
  options?: string[];
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value != null ? String(value) : "");
  useEffect(() => { setV(value != null ? String(value) : ""); }, [value]);
  if (editing) {
    if (options) {
      return (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-24 shrink-0">{label}</span>
          <select
            className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
            value={v}
            autoFocus
            onChange={(e) => { setV(e.target.value); onSave(e.target.value); setEditing(false); }}
          >
            <option value="">—</option>
            {options.map((o) => <option key={o} value={o}>{wineTypeLabel(o)}</option>)}
          </select>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-24 shrink-0">{label}</span>
        <Input type={type} value={v} onChange={(e) => setV(e.target.value)} className="h-8" autoFocus />
        <button onClick={() => { onSave(v); setEditing(false); }} className="text-primary p-1"><Check size={16} /></button>
      </div>
    );
  }
  if (value == null || value === "") {
    return <FieldRowAddButton label={label} onClick={() => setEditing(true)} />;
  }
  return (
    <button onClick={() => setEditing(true)} className="flex justify-between w-full text-left group">
      <span className="text-muted-foreground">{label}</span>
      <span className="group-hover:text-primary">{options ? wineTypeLabel(String(value)) : String(value)}</span>
    </button>
  );
}
