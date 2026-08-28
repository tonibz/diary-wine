import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MapPin, X, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateMenuScanContext, type MenuScanRow } from "@/lib/menu-match";

/**
 * The venue never blocks a scan. It is either already known (from the menu or
 * the photo's location) and shown as one quiet line, or asked for once here in
 * a prompt the user can dismiss and ignore forever.
 */
export function ScanVenue({
  scan,
  onChange,
}: {
  scan: MenuScanRow;
  onChange: (patch: Partial<MenuScanRow>) => void;
}) {
  const { t } = useTranslation();
  const known = !!scan.restaurant_name?.trim();
  const [dismissed, setDismissed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(scan.restaurant_name ?? "");
  const [city, setCity] = useState(scan.city ?? "");
  const [country, setCountry] = useState(scan.country ?? "");
  const [note, setNote] = useState(scan.venue_note ?? "");

  async function save(patch: Partial<MenuScanRow>) {
    setSaving(true);
    try {
      await updateMenuScanContext(scan.id, {
        restaurant_name: (patch.restaurant_name as string | null) ?? null,
        city: (patch.city as string | null) ?? null,
        country: (patch.country as string | null) ?? null,
        venue_note: (patch.venue_note as string | null) ?? null,
      });
      onChange(patch);
      setEditing(false);
      toast.success(t("menu.venue.saved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("menu.venue.couldntSave"));
    } finally {
      setSaving(false);
    }
  }

  const place = [scan.restaurant_name, scan.city].filter(Boolean).join(", ");

  if (editing) {
    return (
      <section className="mb-5 rounded-2xl border border-border bg-card p-4 space-y-3 shadow-notebook">
        <div className="space-y-2">
          <Label htmlFor="venue-name">{t("menu.venue.place")}</Label>
          <Input
            id="venue-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("menu.venue.placeholderRestaurant")}
            className="bg-background"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="venue-city">{t("menu.venue.city")}</Label>
            <Input
              id="venue-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder={t("menu.venue.optional")}
              className="bg-background"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="venue-country">{t("menu.venue.country")}</Label>
            <Input
              id="venue-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder={t("menu.venue.optional")}
              className="bg-background"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="venue-note">{t("menu.venue.kindOfPlace")}</Label>
          <Input
            id="venue-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("menu.venue.kindPlaceholder")}
            className="bg-background"
          />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={saving}
            onClick={() =>
              void save({
                restaurant_name: name.trim() || null,
                city: city.trim() || null,
                country: country.trim() || null,
                venue_note: note.trim() || null,
              })
            }
          >
            {t("menu.venue.save")}
          </Button>
          <Button size="sm" variant="outline" disabled={saving} onClick={() => setEditing(false)}>
            {t("menu.venue.cancel")}
          </Button>
        </div>
      </section>
    );
  }

  if (known) {
    return (
      <p className="mb-5 flex items-center gap-2 text-xs text-muted-foreground">
        <MapPin size={13} /> {t("menu.venue.savedAs", { place })}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 underline"
        >
          <Pencil size={11} /> {t("menu.venue.edit")}
        </button>
      </p>
    );
  }

  if (dismissed) return null;

  return (
    <section className="mb-5 rounded-2xl border border-border bg-parchment/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-foreground">
          {t("menu.venue.prompt")}{" "}
          <span className="text-muted-foreground">{t("menu.venue.promptHint")}</span>
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t("menu.venue.dismiss")}
          className="text-muted-foreground"
        >
          <X size={15} />
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("menu.venue.placeholderRestaurant")}
          className="bg-background"
        />
        <Button
          disabled={saving || !name.trim()}
          onClick={() =>
            void save({
              restaurant_name: name.trim(),
              city: city.trim() || null,
              country: country.trim() || null,
              venue_note: note.trim() || null,
            })
          }
        >
          {t("menu.venue.save")}
        </Button>
      </div>
    </section>
  );
}
