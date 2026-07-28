import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export function StarRating({
  value,
  onChange,
  size = 20,
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: number;
}) {
  const readonly = !onChange;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(n === value ? 0 : n)}
          className={cn(
            "transition-transform",
            !readonly && "hover:scale-110 active:scale-95 cursor-pointer",
          )}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
        >
          <Star
            size={size}
            className={cn(
              n <= value ? "fill-primary stroke-primary" : "stroke-muted-foreground/50 fill-transparent",
            )}
          />
        </button>
      ))}
    </div>
  );
}
