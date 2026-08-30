import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Wine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { i18next } from "@/i18n";
import { useLanguage } from "@/lib/language";

export const Route = createFileRoute("/auth")({
  // Preserve where the user was heading (e.g. an OAuth consent screen) so they
  // land back there after signing in.
  validateSearch: (s: Record<string, unknown>): { next?: string } =>
    typeof s.next === "string" && s.next.startsWith("/") && !s.next.startsWith("//")
      ? { next: s.next }
      : {},

  head: () => ({
    meta: [
      { title: i18next.t("auth.metaTitle") },
      { name: "description", content: i18next.t("auth.metaDescription") },
      { property: "og:title", content: i18next.t("auth.metaTitle") },
      { property: "og:description", content: i18next.t("auth.tagline") },
    ],
  }),
  component: AuthPage,
});

function humanizeAuthError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("email not confirmed")) {
    return i18next.t("auth.toast.emailNotConfirmed");
  }
  if (lower.includes("invalid login credentials")) {
    return i18next.t("auth.toast.invalidCredentials");
  }
  if (lower.includes("user already registered")) {
    return i18next.t("auth.toast.userAlreadyRegistered");
  }
  return raw;
}

function AuthPage() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState<null | "google" | "apple" | "password" | "magic">(null);
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  // Computed lazily: this route is server-rendered, so `window` is absent at render.
  const returnTo = () => (next ? `${window.location.origin}${next}` : window.location.origin);

  function goAfterAuth() {
    if (next) {
      window.location.href = returnTo();
      return;
    }
    navigate({ to: "/diary" });
  }

  async function withProvider(provider: "google" | "apple") {
    setBusy(provider);
    try {
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: returnTo(),
      });
      if (result.error) throw result.error instanceof Error ? result.error : new Error(String(result.error));
      if (result.redirected) return;
      goAfterAuth();
    } catch (err) {
      toast.error(humanizeAuthError(err instanceof Error ? err.message : t("auth.toast.signInFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy("password");
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: returnTo(),
            data: { display_name: displayName || email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast.success(t("auth.toast.welcome"));
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      goAfterAuth();
    } catch (err) {
      toast.error(humanizeAuthError(err instanceof Error ? err.message : t("auth.toast.somethingWrong")));
    } finally {
      setBusy(null);
    }
  }

  async function sendMagicLink() {
    if (!email) {
      toast.error(t("auth.toast.enterEmailFirst"));
      return;
    }
    setBusy("magic");
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: returnTo() },
      });
      if (error) throw error;
      toast.success(t("auth.toast.checkInbox"));
    } catch (err) {
      toast.error(humanizeAuthError(err instanceof Error ? err.message : t("auth.toast.couldNotSendLink")));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-10 bg-background">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            <Wine size={28} />
          </div>
          <h1 className="text-4xl font-serif text-primary">{t("auth.appName")}</h1>
          <p className="text-sm text-muted-foreground text-center">
            {t("auth.tagline")}
          </p>
        </div>

        <div className="rounded-2xl bg-card p-6 shadow-notebook border border-border space-y-3">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy !== null}
            onClick={() => withProvider("google")}
          >
            {busy === "google" ? "…" : t("auth.continueWithGoogle")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy !== null}
            onClick={() => withProvider("apple")}
          >
            {busy === "apple" ? "…" : t("auth.continueWithApple")}
          </Button>

          <div className="flex items-center gap-3 py-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground font-serif">{t("auth.or")}</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="dn">{t("auth.yourName")}</Label>
                <Input
                  id="dn"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t("auth.namePlaceholder")}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw">{t("auth.password")}</Label>
              <Input
                id="pw"
                type="password"
                required
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy !== null} className="w-full">
              {busy === "password" ? "…" : mode === "signin" ? t("auth.signIn") : t("auth.createAccount")}
            </Button>
            <button
              type="button"
              onClick={sendMagicLink}
              disabled={busy !== null}
              className="w-full text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
            >
              {busy === "magic" ? t("auth.sendingLink") : t("auth.magicLink")}
            </button>
            <button
              type="button"
              className="w-full text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin" ? t("auth.newHere") : t("auth.alreadyHaveOne")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
