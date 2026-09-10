import { useTranslation } from "react-i18next";
import { CloudOff } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Shown instead of an empty state whenever a read failed: "nothing here" and
 * "we couldn't look" must never look the same to the user.
 */
export function ErrorState({
  onRetry,
  className = "",
}: {
  onRetry: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  return (
    <div className={`text-center py-16 px-4 ${className}`} role="alert">
      <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-primary">
        <CloudOff size={28} />
      </div>
      <h2 className="text-2xl font-serif text-foreground">{t("errorState.title")}</h2>
      <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">
        {offline ? t("errorState.offline") : t("errorState.body")}
      </p>
      <Button variant="outline" className="mt-5" onClick={onRetry}>
        {t("errorState.retry")}
      </Button>
    </div>
  );
}
