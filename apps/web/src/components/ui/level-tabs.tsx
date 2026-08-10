import type { LevelFilter } from "@georgian/shared/types";

import { cn } from "@/lib/utils";

/**
 * All / A1 / A2, as one segmented control.
 *
 * The two levels keep the colours they wear as badges in the word list, so the filter and
 * the rows it narrows say the same thing. Not the shadcn Tabs: this filters a list that is
 * already on the page rather than switching between panels, so there is nothing for the
 * tablist role and its arrow-key navigation to describe. Three buttons with `aria-pressed`
 * is what it actually is.
 */
const LEVELS: { value: LevelFilter; label: string; on: string }[] = [
  { value: "all", label: "All", on: "bg-primary text-white" },
  { value: "A1", label: "A1", on: "bg-[#22c55e] text-white" },
  { value: "A2", label: "A2", on: "bg-[#f59e0b] text-white" },
];

export function LevelTabs({
  value,
  onChange,
  className,
}: {
  value: LevelFilter;
  onChange: (level: LevelFilter) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-1 rounded-sm border-2 border-border bg-card p-1", className)}>
      {LEVELS.map((level) => (
        <button
          key={level.value}
          type="button"
          onClick={() => onChange(level.value)}
          aria-pressed={value === level.value}
          className={cn(
            "cursor-pointer rounded-[6px] px-4 py-1.5 text-sm font-medium transition-all",
            value === level.value ? level.on : "text-muted-foreground hover:bg-muted",
          )}
        >
          {level.label}
        </button>
      ))}
    </div>
  );
}
