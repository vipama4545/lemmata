import type { ComponentProps } from "react";
import type { Level } from "@georgian/shared/types";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * One row of the word list, shared by the category page and the search results.
 *
 * `focused` marks the word a link from elsewhere — a search result, a story, the day's card
 * — was aiming at. Marked rather than flashed: the scroll to it is instant, so an animation
 * would be over before the eye arrived, and in a column of near-identical rows the mark is
 * what says which one you were sent to.
 */
export function WordCard({
  focused = false,
  className,
  ...props
}: ComponentProps<"div"> & { focused?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-sm border border-border bg-card px-4 py-3 transition-all hover:border-primary hover:shadow-card",
        focused && "border-primary bg-primary-light shadow-[0_0_0_3px_var(--primary-glow)]",
        className,
      )}
      {...props}
    />
  );
}

/** The column of tags on the left of a row: level, then part of speech. */
export function WordCardTags({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex shrink-0 items-center gap-1.5", className)} {...props} />;
}

/** The headword and its translations — the only part of the row that grows. */
export function WordCardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-1 flex-col gap-0.5", className)} {...props} />;
}

/**
 * The word's CEFR level.
 *
 * Only A1 and A2 have a colour: they are the two levels this dictionary is graded for, and
 * they are the two the filter offers. Anything else — a word marked B1, an unmarked word,
 * or a story, which carries a free-text level because stories are not confined to the
 * A1/A2 list — falls back to the neutral tag rather than borrowing one of their colours and
 * claiming a level it does not have. Hence the loose `string`: the callers genuinely differ.
 */
export function LevelBadge({ level, className }: { level: Level | "" | string; className?: string }) {
  if (!level) return null;
  const variant = level === "A1" ? "a1" : level === "A2" ? "a2" : "tag";
  return (
    <Badge variant={variant} className={cn("rounded-[10px] px-2 py-0.5 font-bold uppercase", className)}>
      {level}
    </Badge>
  );
}

export function PosTag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="tag" className={cn("rounded-[10px] px-2 py-0.5", className)}>
      {children}
    </Badge>
  );
}

/**
 * Marks an entry as the reader's own rather than the dictionary's.
 *
 * Worth saying on a row that otherwise looks exactly like every other one, because it *is*
 * exactly like every other one. That is the point of how private vocabulary is stored. The
 * badge answers "why can I edit this one", and "where did this come from" for somebody who
 * added it three months ago.
 */
export function MineTag({ className }: { className?: string }) {
  return (
    <Badge
      variant="tag"
      className={cn("rounded-[10px] border-primary px-2 py-0.5 text-primary", className)}
      title="One of your own words"
    >
      yours
    </Badge>
  );
}
