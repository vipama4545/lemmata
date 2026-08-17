// The shapes an editing screen needs and a reading screen does not: dense forms, ordered lists
// of small things, and the index rows that lead into them.
//
// Everything else these screens use is the app's own — Button, Input, Badge, the Page shell —
// rather than a second set, so a control here behaves like a control everywhere else. What is
// below is only what has no counterpart out in the reader.
//
// It lives under admin/ because that is where every editing screen was when it was written, and
// it is no longer only theirs: the reader's own library has forms too, and library/ui.tsx takes
// what it needs from here rather than growing a second set that would drift. Nothing in this
// file knows anything about being an admin. It is furniture, and the name is history.

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Page } from "@/components/ui/page";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Padded at the foot: the save row should not sit on the bottom edge of the window. */
export function AdminPage({ className, ...props }: ComponentProps<"div">) {
  return <Page className={cn("pb-15", className)} {...props} />;
}

export function AdminHead({ className, ...props }: ComponentProps<"header">) {
  return <header className={cn("mb-7", className)} {...props} />;
}

/** A head with an action beside the title — "New word", "New paradigm". */
export function AdminHeadRow({ className, ...props }: ComponentProps<"header">) {
  return (
    <AdminHead
      className={cn("flex flex-wrap items-center justify-between gap-3", className)}
      {...props}
    />
  );
}

export function AdminTitle({ className, ...props }: ComponentProps<"h1">) {
  return <h1 className={cn("text-[26px] font-bold", className)} {...props} />;
}

export function AdminSub({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn("mt-1.5 max-w-[68ch] text-sm text-muted-foreground", CODE, className)}
      {...props}
    />
  );
}

export function AdminSection({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "mb-8 rounded-lg border border-border bg-card p-5 shadow-card max-sm:px-3.5 max-sm:py-4",
        className,
      )}
      {...props}
    />
  );
}

export function AdminSectionTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("mb-3 text-base font-bold", className)} {...props} />;
}

/**
 * The prose that says why a field is the way it is.
 *
 * There is a lot of it on these screens on purpose: the rules about senses being positional
 * and names being story-scoped are not guessable from the form, and finding them out by
 * breaking a story is expensive.
 */
export function AdminNote({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "mb-4 max-w-[78ch] text-[13.5px] leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline",
        CODE,
        className,
      )}
      {...props}
    />
  );
}

export function AdminHint({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("mt-1 block text-[12.5px] leading-normal text-faint", CODE, className)} {...props} />;
}

export function AdminError({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "mb-5 rounded-sm border border-l-[3px] border-destructive bg-[color-mix(in_srgb,var(--m-1)_8%,var(--card))] px-3.5 py-3 text-sm",
        className,
      )}
      {...props}
    />
  );
}

export function AdminWarning({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "mt-3 rounded-sm bg-[color-mix(in_srgb,var(--m-3)_14%,var(--card))] px-3 py-2.5 text-[13.5px]",
        className,
      )}
      {...props}
    />
  );
}

/** Inline `<code>` inside admin prose, applied through the parent rather than per element. */
const CODE = "[&_code]:rounded-[4px] [&_code]:bg-muted [&_code]:px-[5px] [&_code]:py-px [&_code]:text-[0.92em]";

/* ----- fields ----- */

export function AdminGrid({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("mb-4 grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4", className)}
      {...props}
    />
  );
}

export function AdminField({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("block min-w-0", className)} {...props} />;
}

export function AdminLabel({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "mb-[5px] block text-xs font-semibold tracking-[0.02em] text-muted-foreground uppercase",
        className,
      )}
      {...props}
    />
  );
}

/** A count beside a label — "3 of 6" — that turns red when the number is wrong. */
export function AdminCount({ wrong, className, ...props }: ComponentProps<"span"> & { wrong?: boolean }) {
  return (
    <span
      className={cn("ml-1.5 font-medium tracking-normal normal-case", wrong ? "text-m-1" : "text-faint", className)}
      {...props}
    />
  );
}

/**
 * A dense form field: one border, no shadow, and the page background rather than the card's,
 * so a filled row of them reads as a form rather than as a stack of cards.
 */
export const ADMIN_INPUT =
  "h-auto w-full rounded-sm border border-border-strong bg-background px-[11px] py-2.5 font-[inherit] text-sm shadow-none md:text-sm " +
  "focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary-glow " +
  "disabled:cursor-not-allowed disabled:opacity-45";

/** Georgian is set a size larger throughout the app; a field holding it follows, or a
    headword typed in reads smaller than the same headword displayed. */
export const ADMIN_INPUT_GEO = "text-base md:text-base";
export const ADMIN_INPUT_NARROW = "max-w-40";

export function AdminInput({ className, ...props }: ComponentProps<typeof Input>) {
  return <Input className={cn(ADMIN_INPUT, className)} {...props} />;
}

export function AdminTextarea({ className, ...props }: ComponentProps<typeof Textarea>) {
  return <Textarea className={cn(ADMIN_INPUT, "resize-y leading-relaxed", className)} {...props} />;
}

/** A checkbox and its label on one line, used for the flags dotted through these forms. */
export function AdminCheck({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      className={cn("my-1 mb-3 flex cursor-pointer items-center gap-2 text-[13.5px]", className)}
      {...props}
    />
  );
}

/** A link styled as text, for the "Clear" and "Remove" affordances inside a field. */
export function AdminLinkButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn("cursor-pointer text-[12.5px] text-primary underline", className)}
      {...props}
    />
  );
}

/** The square button at the end of a row that takes the row away. */
export function AdminIconButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "grid size-8 shrink-0 cursor-pointer place-items-center rounded-sm border border-border bg-card text-muted-foreground",
        "hover:not-disabled:border-destructive hover:not-disabled:text-destructive",
        "disabled:cursor-not-allowed disabled:opacity-35",
        className,
      )}
      {...props}
    />
  );
}

export function AdminActions({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mt-6 flex flex-wrap items-center gap-3", className)} {...props} />;
}

/* ----- ordered lists of small things: senses, forms ----- */

export function AdminList({ className, ...props }: ComponentProps<"ul">) {
  return <ul className={cn("mb-3 list-none", className)} {...props} />;
}

export function AdminRow({ className, ...props }: ComponentProps<"li">) {
  return <li className={cn("mb-2 flex items-center gap-2.5", className)} {...props} />;
}

/** A row whose fields wrap onto a second line rather than squeezing — the form editor. */
export function AdminRowWrap({ className, ...props }: ComponentProps<"li">) {
  return (
    <AdminRow
      className={cn("flex-wrap [&_input]:w-auto [&_input]:flex-[1_1_160px] max-sm:[&_input]:basis-full", className)}
      {...props}
    />
  );
}

export function AdminRowNumber({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("min-w-4 text-[13px] tabular-nums text-faint", className)} {...props} />;
}

/* ----- the index lists ----- */

export function AdminCountLine({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("my-3 text-[13px] text-muted-foreground", className)} {...props} />;
}

export function AdminRows({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      className={cn(
        "list-none overflow-hidden rounded-lg border border-border bg-card",
        "[&>li+li>*]:border-t [&>li+li>*]:border-border",
        className,
      )}
      {...props}
    />
  );
}

/** One row of an index. `static` for a row that is not a link — the account list. */
export const ADMIN_ROW_LINK = "flex flex-wrap items-center gap-3 px-4 py-[11px]";
export const ADMIN_ROW_LINK_HOVER = "cursor-pointer hover:bg-muted";

export function AdminRowGeo({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("min-w-35 text-base font-semibold", className)} {...props} />;
}

export function AdminRowEn({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("min-w-40 flex-1 text-[13.5px] text-muted-foreground", className)} {...props} />;
}

export function AdminRowMeta({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("flex flex-wrap items-center gap-1.5", className)} {...props} />;
}

/** A fact about a row. `flagged` for one that wants somebody's attention. */
export function AdminBadge({
  flagged,
  admin,
  className,
  ...props
}: ComponentProps<typeof Badge> & { flagged?: boolean; admin?: boolean }) {
  return (
    <Badge
      variant="tag"
      className={cn(
        "px-2 py-0.5 text-[11.5px] text-muted-foreground",
        flagged && "bg-[color-mix(in_srgb,var(--m-3)_22%,transparent)] text-foreground",
        admin && "bg-primary-light text-primary-dark",
        className,
      )}
      {...props}
    />
  );
}
