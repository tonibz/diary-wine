import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { LogOut } from "lucide-react";
import { i18next } from "@/i18n";
import { LANGUAGES, type LanguageCode } from "@/i18n/locales";
import { useLanguage } from "@/lib/language";
import { useAsyncData } from "@/lib/use-async-data";
import { ErrorState } from "@/components/ErrorState";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: i18next.t("settings.metaTitle") },
      { name: "description", content: i18next.t("settings.metaDescription") },
      { property: "og:title", content: i18next.t("settings.title") },
      { property: "og:description", content: i18next.t("settings.metaDescription") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [gpsLookup, setGpsLookup] = useState(false);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  // Until the real settings are read, saving is blocked: overwriting the
  // user's own values with defaults would be worse than showing an error.
  const { error: loadError, loading, reload } = useAsyncData("/settings", async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!data.user) throw new Error("No session");
    setEmail(data.user.email ?? "");
    const { data: p, error: profileErr } = await supabase
      .from("profiles")
      .select("display_name, gps_lookup_enabled")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profileErr) throw profileErr;
    setDisplayName(p?.display_name ?? "");
    setGpsLookup(!!p?.gps_lookup_enabled);
    return true;
  });

  const blocked = loading || !!loadError;

  async function save() {
    if (blocked) return;
    setSaving(true);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) throw new Error("No session");
      const { error } = await supabase.from("profiles").upsert({
        id: data.user.id,
        display_name: displayName || null,
        gps_lookup_enabled: gpsLookup,
      });
      if (error) throw error;
      toast.success(t("settings.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errorState.body"));
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <div className="px-5 pt-8 pb-8">
      <h1 className="text-4xl font-serif text-primary mb-6">{t("settings.title")}</h1>

      <section className="rounded-2xl bg-card p-5 border border-border shadow-notebook space-y-4">
        <div className="space-y-1.5">
          <Label>{t("settings.displayName")}</Label>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("settings.email")}</Label>
          <Input value={email} disabled />
        </div>
        <div className="space-y-1.5 pt-2 border-t border-border">
          <Label>{t("settings.language")}</Label>
          <Select value={language} onValueChange={(v) => setLanguage(v as LanguageCode)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t("settings.languageHint")}</p>
        </div>
        <div className="flex items-start justify-between gap-4 pt-2 border-t border-border">
          <div className="space-y-1">
            <Label>{t("settings.gpsTitle")}</Label>
            <p className="text-xs text-muted-foreground">{t("settings.gpsHint")}</p>
          </div>
          <Switch checked={gpsLookup} onCheckedChange={setGpsLookup} />
        </div>
        {/* Saving defaults over the user's real settings is worse than not saving. */}
        {loadError && (
          <div className="pt-2 border-t border-border">
            <p className="text-sm text-destructive">{t("errorState.settingsBlocked")}</p>
            <ErrorState onRetry={reload} className="py-6" />
          </div>
        )}
        <Button onClick={save} disabled={saving || blocked}>
          {saving ? "…" : t("common.save")}
        </Button>
      </section>

      <button
        onClick={signOut}
        className="mt-6 w-full flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3 text-muted-foreground hover:text-destructive"
      >
        <LogOut size={18} /> {t("settings.signOut")}
      </button>

      <p className="text-center text-xs text-muted-foreground mt-8 font-serif">{t("settings.footer")}</p>
    </div>
  );
}
