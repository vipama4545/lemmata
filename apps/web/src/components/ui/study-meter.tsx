import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * How much of a deck you have an opinion about, as four states across one bar.
 *
 * The bar is only ever three segments wide: what is left of it is what you have never seen,
 * which is the point of leaving the track visible rather than filling it. The segments run
 * in the same order the colours run through a story's text, so the bar and the page are one
 * legend.
 */
export function StudyMeter({
  known,
  solid,
  learning,
  total,
}: {
  known: number;
  solid: number;
  learning: number;
  total: number;
}) {
  const width = (value: number) => `${(value / total) * 100}%`;

  return (
    <div
      className="flex h-2.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--m-unseen)_30%,var(--border))]"
      aria-hidden="true"
    >
      <span className="h-full bg-m-6 transition-[width] duration-400" style={{ width: width(known) }} />
      <span className="h-full bg-m-5 transition-[width] duration-400" style={{ width: width(solid) }} />
      <span className="h-full bg-m-3 transition-[width] duration-400" style={{ width: width(learning) }} />
    </div>
  );
}

/** The row of "N known · N solid · …" under a meter. */
export function StudyLegend({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1.5",
        className,
      )}
      {...props}
    />
  );
}

/** The last item in a legend, pushed to the far end — an aside rather than another state. */
export const LEGEND_ASIDE = "ml-auto text-faint max-md:ml-0";

/** The colour swatch in front of a legend entry. */
export function Dot({ className }: { className: string }) {
  return <i className={cn("size-2 rounded-full", className)} />;
}
