import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useEntryState } from '@/utils/entryState';

/**
 * Paging for the long lists — the verb indexes, a category's words, the search results.
 *
 * Those lists are hundreds to thousands of rows, and rendering all of them costs the reader
 * twice: the browser lays out a page it will never show the bottom of, and the scrollbar
 * stops meaning anything. Fifty rows is about two screens on a laptop and four on a phone,
 * which is as far as anyone scans before going back to the filter box.
 *
 * The page number is a control rather than an address, so it lives with the filters in
 * `useEntryState` rather than in the URL — see the note there. That is also what makes Back
 * from a word land on the page of the list it was on rather than the top of it.
 */
export const PAGE_SIZE = 50;

export interface Pager<T> {
  /** The rows of the current page. */
  items: T[];
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
  /** 1-based position of the first and last row shown, for the summary line. */
  first: number;
  last: number;
  /** Rows in the whole filtered list, not just this page. */
  total: number;
}

/**
 * The slice of `items` the reader is looking at.
 *
 * `filters` is the current state of every control that narrows the list, joined into one
 * string. When it changes the list underneath has been replaced, and the page number the
 * reader was on names nothing in the new one — so the pager returns to the first page.
 */
export function usePagination<T>(
  items: T[],
  filters: string,
  options?: { perPage?: number; initialPage?: number },
): Pager<T> {
  const perPage = options?.perPage ?? PAGE_SIZE;
  const [page, setPage] = useEntryState('page', options?.initialPage ?? 1);

  // Adjusted during the render that notices the change rather than in an effect, so the rows
  // and the pager never disagree — not even for the one frame an effect would take to catch
  // up, which is a frame of page 9 of a list that now has two.
  const [lastFilters, setLastFilters] = useState(filters);
  if (filters !== lastFilters) {
    setLastFilters(filters);
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(items.length / perPage));
  // Clamped rather than trusted: an admin's edit can shorten the list under a page that is
  // already open, and a remembered page number outlives the list it was counted against.
  const current = Math.min(Math.max(page, 1), pageCount);
  const from = (current - 1) * perPage;

  return {
    items: items.slice(from, from + perPage),
    page: current,
    pageCount,
    setPage,
    first: items.length === 0 ? 0 : from + 1,
    last: Math.min(from + perPage, items.length),
    total: items.length,
  };
}

/** How many consecutive page numbers are written out around the current one. */
const WINDOW = 5;

/**
 * Which page numbers the control shows: a run of five around the current page, the two ends,
 * and an ellipsis for each stretch in between. A stretch of exactly one page is written out
 * instead — hiding a single number behind "…" costs the same width and buys nothing.
 *
 * The run slides rather than shrinking at the ends, so the control keeps its width as the
 * reader walks through it and the Next button does not move out from under the cursor.
 */
function pageWindow(page: number, pageCount: number): (number | 'gap')[] {
  const end = Math.min(pageCount, Math.max(page + Math.floor(WINDOW / 2), WINDOW));
  const start = Math.max(1, end - WINDOW + 1);

  const shown: number[] = [];
  for (let n = 1; n <= pageCount; n += 1) {
    if (n === 1 || n === pageCount || (n >= start && n <= end)) shown.push(n);
  }

  const out: (number | 'gap')[] = [];
  shown.forEach((n, index) => {
    const previous = shown[index - 1];
    if (previous !== undefined && n - previous > 1) out.push(n - previous === 2 ? n - 1 : 'gap');
    out.push(n);
  });
  return out;
}

/**
 * The pager itself, at the foot of a list.
 *
 * Nothing is drawn when everything fits on one page: a control that can only say "page 1 of
 * 1" is furniture. On a phone the numbers collapse to "Page 3 of 27" — seven chips and two
 * labelled arrows do not fit on that width, and wrapping them reads as a second list.
 */
export function Pagination({
  pager,
  noun = 'entries',
  className,
}: {
  pager: Pager<unknown>;
  /** What the rows are, for the summary line: "51–100 of 1,342 verbs". */
  noun?: string;
  className?: string;
}) {
  const { page, pageCount, setPage, first, last, total } = pager;
  if (pageCount <= 1) return null;

  const go = (next: number) => {
    setPage(Math.min(Math.max(next, 1), pageCount));
    // The rows under the cursor have just been replaced by different ones, and the reader is
    // standing at the foot of them. Instant, like every other jump this app makes.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  };

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        'mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 max-md:justify-center',
        className,
      )}
    >
      <p className="text-sm text-muted-foreground max-md:order-2">
        {first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()} {noun}
      </p>

      <div className="flex items-center gap-1.5">
        <Button variant="control" size="auto-sm" disabled={page === 1} onClick={() => go(page - 1)}>
          <ChevronLeft />
          <span className="max-md:sr-only">Previous</span>
        </Button>

        <div className="flex items-center gap-1.5 max-md:hidden">
          {pageWindow(page, pageCount).map((entry, index) =>
            entry === 'gap' ? (
              <span key={`gap-${index}`} className="px-1 text-sm text-faint" aria-hidden="true">
                …
              </span>
            ) : (
              <Button
                key={entry}
                variant={entry === page ? 'controlOn' : 'control'}
                size="auto-sm"
                className="min-w-9 tabular-nums"
                aria-current={entry === page ? 'page' : undefined}
                aria-label={`Page ${entry}`}
                onClick={() => go(entry)}
              >
                {entry}
              </Button>
            ),
          )}
        </div>

        <span className="hidden text-sm whitespace-nowrap text-muted-foreground max-md:inline">
          Page {page} of {pageCount}
        </span>

        <Button
          variant="control"
          size="auto-sm"
          disabled={page === pageCount}
          onClick={() => go(page + 1)}
        >
          <span className="max-md:sr-only">Next</span>
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}
