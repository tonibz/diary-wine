import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Wine } from "lucide-react";

type OAuthResult = { redirect_url?: string; redirect_to?: string; client?: { name?: string } };
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: OAuthResult | null; error: Error | null }>;
  approveAuthorization: (id: string) => Promise<{ data: OAuthResult | null; error: Error | null }>;
  denyAuthorization: (id: string) => Promise<{ data: OAuthResult | null; error: Error | null }>;
};

const oauthApi = () => (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    const next = location.pathname + location.searchStr;
    if (!data.session) throw redirect({ to: "/auth", search: { next } });
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
    if (error) throw error;
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen flex items-center justify-center px-6 bg-background">
      <p className="text-sm text-muted-foreground text-center">
        Could not load this authorization request: {String((error as Error)?.message ?? error)}
      </p>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientName = details?.client?.name ?? "this app";

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const api = oauthApi();
    const { data, error } = approve
      ? await api.approveAuthorization(authorization_id)
      : await api.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-10 bg-background">
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-notebook border border-border space-y-4">
        <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            <Wine size={24} />
          </div>
          <h1 className="text-2xl font-serif text-primary text-center">
            Connect {clientName} to Wine Diary
          </h1>
        </div>
        <p className="text-sm text-muted-foreground text-center">
          {clientName} will be able to read your diary, wishlist, taste profile and scanned wine
          lists, and add wines to your wishlist, acting as you.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive text-center">
            {error}
          </p>
        )}
        <div className="space-y-2">
          <Button className="w-full" disabled={busy} onClick={() => decide(true)}>
            {busy ? "…" : "Approve"}
          </Button>
          <Button
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => decide(false)}
          >
            Deny
          </Button>
        </div>
      </div>
    </main>
  );
}
