// Which dictionary this browser is looking at.
//
// The URL is the answer, and everything else follows from it: `#/ru/verbs/delat-impf` is a
// Russian page whoever opens it, on whatever device, however their last visit ended. A
// language kept only in React state would have made the switcher a thing you could not link
// to, bookmark, or reach with the back button — and, worse, would have let the address bar
// and the screen disagree after a refresh.
//
// This module reads it out of the hash *before the router exists*, because the snapshot has to
// be fetched before the app mounts at all. See Boot.tsx. Once mounted, the router's `:lang`
// segment is the same value arrived at properly, and `useLang()` reads that instead.

import { DEFAULT_LANG, isLang, type Lang } from '@georgian/shared/grammar';

const REMEMBERED = 'dictionary-lang';

/**
 * The language named by the current URL, or the last one used, or Georgian.
 *
 * The fallback chain matters on exactly one visit: somebody arriving at the bare `/` who has
 * been here before should land back in the dictionary they were reading, and somebody
 * arriving for the first time should land in the one this app was originally built for.
 */
export function currentLang(): Lang {
  return fromHash(globalThis.location?.hash) ?? remembered() ?? DEFAULT_LANG;
}

/** The first path segment of a hash route, when it names a language. */
export function fromHash(hash: string | undefined): Lang | null {
  const segment = (hash ?? '').replace(/^#\/?/, '').split('/')[0];
  return isLang(segment) ? segment : null;
}

function remembered(): Lang | null {
  try {
    const saved = globalThis.localStorage?.getItem(REMEMBERED);
    return isLang(saved) ? saved : null;
  } catch {
    // Storage can be switched off, or blocked in a third-party frame. Not knowing which
    // dictionary somebody read last time is not a reason to fail to open.
    return null;
  }
}

/**
 * Remembers the choice, for the next visit that names no language.
 *
 * Signed in, the server has a copy of this on the account — see `user.lang` — and that is the
 * one that follows somebody to another device. This is the local answer, and the only one a
 * signed-out visitor has.
 */
export function rememberLang(lang: Lang): void {
  try {
    globalThis.localStorage?.setItem(REMEMBERED, lang);
  } catch {
    // As above.
  }
}

/** The same path under a different language — what the switcher navigates to. */
export function swapLang(hash: string, lang: Lang): string {
  const path = (hash ?? '').replace(/^#\/?/, '');
  const rest = isLang(path.split('/')[0]) ? path.split('/').slice(1).join('/') : path;
  return `/${lang}/${rest}`;
}
