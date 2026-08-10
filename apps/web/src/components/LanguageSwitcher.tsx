// Which dictionary you are reading, and how to read another one.
//
// Switching is a *navigation*, not a state change: the language is the first segment of the
// URL, so changing it means going somewhere. That is what makes the back button undo a switch
// and a shared link open the dictionary the sender was looking at.
//
// It is also a full reload of the page rather than a React transition, and that is deliberate
// rather than lazy. Every index in this app is built from a snapshot held in a module-level
// variable — see `derived()` in content/store — and the snapshot for the other language has
// not been fetched yet. Swapping it under a mounted tree would mean every one of those indexes
// rebuilding mid-render against data whose ids do not resolve. A reload takes the app back
// through Boot, which is the one place designed to wait for a dictionary to arrive.
//
// A native <select> rather than a custom menu: it is one element, it is keyboard-navigable and
// screen-reader-labelled without any work, and on a phone it opens the platform picker instead
// of a div pretending to be one. The arrow and the framing are ours; the behaviour is the
// browser's.

import { isAdminOnlyLang, type Lang } from '@georgian/shared/grammar';
import { lang as currentLang, languages } from '../content/store';
import { swapLang } from '../content/lang';
import { useIsAdmin } from '../admin/useAdmin';

/**
 * Purely decorative, and deliberately not in the `languages` table.
 *
 * A flag is a country and a language is not — Russian is read in a dozen states that do not
 * fly that flag — so this is an ornament beside the name rather than the name itself. Each
 * option reads as the language's own word for itself, ქართული and Русский, which is the
 * label that means something to whoever is about to pick it. The flag never carries the
 * option on its own: Windows has no flag glyphs and shows the two letters instead.
 */
const FLAG: Record<Lang, string> = {
  ka: '🇬🇪',
  ru: '🇷🇺',
};

export default function LanguageSwitcher() {
  const here = currentLang();
  const { isAdmin } = useIsAdmin();

  // The server has already left an unreleased language out of this list for anyone who may
  // not read it, so the second test is a backstop rather than the rule: a snapshot cached
  // while signed in as an admin still lists Russian, and is answered "still current" on the
  // next visit — including the visit after signing out.
  //
  // A pending session counts as not an admin, so the option appears a beat after load for
  // the people who have it. Better than the reverse, which would offer a dictionary the
  // server then refuses. The language being *read* is never dropped, whatever the session
  // says yet — a select whose value names no option renders blank, and only an admin can be
  // reading an unreleased one in the first place.
  const available = languages().filter(
    entry => entry.enabled && (isAdmin || !isAdminOnlyLang(entry.id) || entry.id === here),
  );

  // Nothing to switch between. The control disappears rather than sitting there disabled: a
  // single-language install should not carry the furniture of a multilingual one.
  if (available.length < 2) return null;

  const go = (next: Lang) => {
    if (next === here) return;
    globalThis.location.hash = swapLang(globalThis.location.hash, next);
    globalThis.location.reload();
  };

  return (
    <div className="lang-switcher">
      <span className="lang-flag" aria-hidden="true">
        {FLAG[here]}
      </span>
      <select
        className="lang-select"
        value={here}
        onChange={event => go(event.target.value as Lang)}
        aria-label="Dictionary language"
      >
        {available.map(entry => (
          <option key={entry.id} value={entry.id}>
            {FLAG[entry.id]} {entry.nativeName}
          </option>
        ))}
      </select>
      <svg className="lang-caret" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
