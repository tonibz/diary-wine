import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { BottomTabs } from "@/components/BottomTabs";
import { AuthProvider } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: Layout,
});

function Layout() {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-background pb-24">
        <div className="mx-auto max-w-md">
          <Outlet />
        </div>
        <BottomTabs />
      </div>
    </AuthProvider>
  );
}
