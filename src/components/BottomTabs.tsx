import { Link, useRouterState } from "@tanstack/react-router";
import { BookHeart, Sparkles, Settings, Plus, Bookmark } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const tabs = [
  { to: "/", labelKey: "nav.diary", icon: BookHeart },
  { to: "/wishlist", labelKey: "nav.wishlist", icon: Bookmark },
  { to: "/taste", labelKey: "nav.taste", icon: Sparkles },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
] as const;


export function BottomTabs() {
  const { t: translate } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Focused, single-task flows own the bottom of the screen.
  if (pathname.startsWith("/bulk")) return null;
  return (

    <>
      <Link
        to="/add"
        aria-label={translate("nav.add")}
        className="fixed bottom-24 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-notebook transition-transform active:scale-95 hover:bg-secondary"
      >
        <Plus size={26} />
      </Link>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto flex max-w-md justify-around px-2 py-2">
          {tabs.map((t) => {
            const active = pathname === t.to;
            const Icon = t.icon;
            return (
              <li key={t.to}>
                <Link
                  to={t.to}
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-xs transition-colors",
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
                  <span className={cn(active && "font-medium")}>{translate(t.labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
