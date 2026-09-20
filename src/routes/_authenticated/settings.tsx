import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
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
import { Download, LogOut, Trash2 } from "lucide-react";
import { i18next } from "@/i18n";
import { LANGUAGES, type LanguageCode } from "@/i18n/locales";
import { useLanguage } from "@/lib/language";
import { useAsyncData } from "@/lib/use-async-data";
import { ErrorState } from "@/components/ErrorState";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { buildDiaryCsv, downloadCsv } from "@/lib/export-diary";
import { deleteAccount } from "@/lib/account.functions";

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
  const [exporting, setExporting] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const runDeleteAccount = useServerFn(deleteAccount);

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

  async function exportDiary() {
    setExporting(true);
    try {
      const csv = await buildDiaryCsv();
      if (!csv.includes("\n")) {
        toast.info(t("settings.exportEmpty"));
        return;
      }
      downloadCsv(`wine-diary-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast.success(t("settings.exportDone"));
    } catch {
      toast.error(t("settings.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  async function removeAccount() {
    const confirmationWord = t("settings.deleteConfirmWord");
    if (deleteText !== confirmationWord) return;
    setDeleting(true);
    try {
      const result = await runDeleteAccount();
      if (!result.ok) throw new Error(result.error);
      toast.success(t("settings.deleteDone"));
      await supabase.auth.signOut();
      navigate({ to: "/auth" });
    } catch {
      toast.error(t("settings.deleteFailed"));
    } finally {
      setDeleting(false);
    }
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

      <section className="mt-6 border-t border-border pt-6">
        <h2 className="font-serif text-xl text-foreground">{t("settings.exportTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("settings.exportHint")}</p>
        <Button variant="outline" className="mt-4" disabled={exporting} onClick={() => void exportDiary()}>
          <Download size={16} />
          {exporting ? t("settings.exportPreparing") : t("settings.exportButton")}
        </Button>
      </section>

      <section className="mt-6 border-t border-border pt-6">
        <h2 className="font-serif text-xl text-foreground">{t("settings.deleteTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("settings.deleteHint")}</p>
        <AlertDialog onOpenChange={(open) => !open && setDeleteText("")}>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="mt-4 text-destructive hover:text-destructive">
              <Trash2 size={16} /> {t("settings.deleteButton")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("settings.deleteDialogTitle")}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-left">
                  <p>{t("settings.deleteDialogBody")}</p>
                  <p>{t("settings.deleteKeeps")}</p>
                  <p>{t("settings.deletePhotos")}</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="delete-confirmation">
                {t("settings.deleteTypePrompt", { word: t("settings.deleteConfirmWord") })}
              </Label>
              <Input
                id="delete-confirmation"
                value={deleteText}
                onChange={(event) => setDeleteText(event.target.value)}
                placeholder={t("settings.deletePlaceholder", {
                  word: t("settings.deleteConfirmWord"),
                })}
                autoComplete="off"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>{t("settings.deleteCancel")}</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleting || deleteText !== t("settings.deleteConfirmWord")}
                onClick={(event) => {
                  event.preventDefault();
                  void removeAccount();
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? t("settings.deleteWorking") : t("settings.deleteConfirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>

      <button
        onClick={signOut}
        className="mt-6 w-full flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3 text-muted-foreground hover:text-destructive"
      >
        <LogOut size={18} /> {t("settings.signOut")}
      </button>

      <p className="text-center text-xs text-muted-foreground mt-8 font-serif">
        {t("settings.footer")}{" "}
        <Link to="/privacy" className="underline underline-offset-4 hover:text-foreground">
          {t("settings.privacyLink")}
        </Link>
      </p>
    </div>
  );
}
