import { lang } from '../content/store';
// Where a link lands on the page it opens.
//
// A link that names one entry — a search result, a word in a story, the day's word — should
// put that entry under the header rather than dropping the reader at the top of a list of
// several hundred. The entry is named in the query string rather than in the router's
// state so that the link survives being copied, bookmarked or reloaded, and because
// HashRouter has already spent the fragment on the route: `#word-33` is not available to us.
//
// The page marks its entries with `data-focus`, ScrollManager finds one by it, and nothing
// else has to know how the two ends meet.

/** The query parameter naming the entry a link is aiming at. */
export const FOCUS_PARAM = 'w';

/** A link to `path` that lands on one particular entry rather than at the top of the page. */
export function focusHref(path: string, id: string): string {
  // The language goes on here rather than at the twenty call sites, all of which pass a bare
  // `/category/...`. Every link this builds is a link within the dictionary being read, so
  // there has never been a caller that meant anything else.
  const prefixed = path.startsWith('/') ? `/${lang()}${path}` : path;
  return `${prefixed}?${FOCUS_PARAM}=${encodeURIComponent(id)}`;
}

/** The entry the current location is aiming at, or '' when it names none. */
export function focusId(search: string): string {
  return new URLSearchParams(search).get(FOCUS_PARAM) ?? '';
}

/**
 * The selector for one marked entry. The value goes inside quotes, so only the quote and
 * the backslash need escaping — CSS.escape is for bare identifiers and would be wrong here.
 */
export function focusSelector(id: string): string {
  return `[data-focus="${id.replace(/["\\]/g, '\\$&')}"]`;
}
