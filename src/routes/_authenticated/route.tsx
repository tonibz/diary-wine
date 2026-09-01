import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { BottomTabs } from "@/components/BottomTabs";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { AuthLoading } from "@/components/AuthLoading";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: Layout,
});

/**
 * Three explicit states. The old guard resolved the session in `beforeLoad`,
 * so an OAuth return rendered nothing while the check was in flight (and
 * bounced to /auth when the tokens in the URL had not been read yet).
 */
function Gate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [loading, user, navigate]);

  if (loading) return <AuthLoading label="One moment…" />;
  if (!user) return <AuthLoading label="Taking you to sign in…" />;
  return <>{children}</>;
}

function Layout() {
  return (
    <AuthProvider>
      <Gate>
        <div className="min-h-screen bg-background pb-24">
          <div className="mx-auto max-w-md">
            <Outlet />
          </div>
          <BottomTabs />
        </div>
      </Gate>
    </AuthProvider>
  );
}
