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
// A native <select> rather than a custom menu — including rather than the shadcn Select the
// rest of this app uses. It is one element, it is keyboard-navigable and screen-reader-labelled
// without any work, and on a phone it opens the platform picker instead of a div pretending to
// be one. The arrow and the framing are ours; the behaviour is the browser's. Everywhere the
// options are ours to draw, Select is the better control; this is the one place they are not.

import { ChevronDown } from "lucide-react";
import { isAdminOnlyLang, type Lang } from "@georgian/shared/grammar";
import { lang as currentLang, languages } from "../content/store";
import { swapLang } from "../content/lang";
import { useIsAdmin } from "../admin/useAdmin";

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
  ka: "🇬🇪",
  ru: "🇷🇺",
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
    (entry) => entry.enabled && (isAdmin || !isAdminOnlyLang(entry.id) || entry.id === here),
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
    <div className="relative inline-flex h-8.5 items-center gap-1.5 rounded-sm border border-border bg-card pr-6.5 pl-2.5 text-foreground hover:border-border-strong">
      {/* Windows has no flag glyphs and falls back to two letters. Fixing the width stops the
          control jumping between platforms, and between languages on the same one. */}
      <span className="min-w-[1.3em] text-center text-[1.05rem] leading-none" aria-hidden="true">
        {FLAG[here]}
      </span>
      {/* Laid over the whole control so the entire thing is the hit target, and transparent so
          what shows through is the flag and caret above. `appearance-none` is what removes the
          platform chrome without removing the platform behaviour. The open menu is drawn by the
          OS, which does not inherit the page's colours — so the options are given them
          explicitly or a dark theme shows black text on black. */}
      <select
        className="absolute inset-0 w-full cursor-pointer appearance-none rounded-sm border-0 bg-transparent pr-6.5 pl-8.5 font-[inherit] text-[0.85rem] text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current [&>option]:bg-popover [&>option]:text-popover-foreground"
        value={here}
        onChange={(event) => go(event.target.value as Lang)}
        aria-label="Dictionary language"
      >
        {available.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {FLAG[entry.id]} {entry.nativeName}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 size-3 text-faint" aria-hidden="true" />
    </div>
  );
}
