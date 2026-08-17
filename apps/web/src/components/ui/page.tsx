import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";

/**
 * The column every screen is written into: centred, capped, and padded away from the edge.
 *
 * A component rather than a repeated utility string because a handful of screens narrow it
 * — the flashcards to 960px, the export page to 800px — and a `className` on this is a
 * clearer way to say that than three utilities that have to be kept in agreement.
 */
export function Page({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mx-auto max-w-[1200px] p-6", className)} {...props} />;
}

/** The trail above a page title. Segments are separated by a slash, the last one is plain text. */
export function Breadcrumb({ className, ...props }: ComponentProps<"nav">) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("mb-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export function BreadcrumbLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-primary hover:underline">
      {children}
    </Link>
  );
}

export function BreadcrumbSeparator() {
  return (
    <span className="mx-2" aria-hidden="true">
      /
    </span>
  );
}

/**
 * The previous/next links at the foot of a page that is one of a sequence.
 *
 * A constant rather than a component because both users put their own arrow on either side of
 * the label and one of them puts a spacer where a link would be. It lived in GrammarTopic until
 * that page was replaced by the lessons, which is a poor home for something the verb pages also
 * use; here it sits with the rest of the page furniture.
 */
export const NAV_LINK = 'flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary';

/** A quiet heading over a band of cards — smaller and lighter than an <h2> would read. */
export function SectionHeading({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("mb-3 text-[15px] font-semibold text-muted-foreground", className)} {...props} />;
}
