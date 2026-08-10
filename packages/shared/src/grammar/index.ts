// Which languages this app knows how to render, and how to reach each one's grammar.
//
// The `languages` table is what says which of these are *switched on* — a row there carries
// the name, the native name and the script, and the switcher is built from it. This file is
// the other half: a language can only be turned on if there is code here that knows what a
// verb of it looks like, and that is not something a row can supply.
//
// So `Lang` is a compile-time union of the languages with a grammar module, and the seed
// refuses to insert a `languages` row whose id is not one of them. The two cannot drift into
// a state where the database offers a language the app cannot draw.

export type Lang = 'ka' | 'ru';

export const LANGS: readonly Lang[] = ['ka', 'ru'];

/**
 * What a visitor with no stated preference gets.
 *
 * Georgian, because that is what this dictionary was and every existing bookmark points at
 * it. Content rows written before there was any such thing as a language carry 'ka' by
 * column default for the same reason.
 */
export const DEFAULT_LANG: Lang = 'ka';

export function isLang(value: string | undefined | null): value is Lang {
  return value === 'ka' || value === 'ru';
}

/**
 * Languages only an administrator may open.
 *
 * Russian is here while it is being built: the verbs conjugate and the word list is still
 * being checked, and neither is something to hand a learner yet. It is not a half-measure —
 * the switcher does not list it, and the server does not serve it to anyone else, so a
 * hand-typed `#/ru/verbs` gets the Georgian dictionary rather than a preview.
 *
 * Taking Russian out of this array is the whole of releasing it. Nothing else has to change.
 */
export const ADMIN_ONLY_LANGS: readonly Lang[] = ['ru'];

export function isAdminOnlyLang(lang: Lang): boolean {
  return ADMIN_ONLY_LANGS.includes(lang);
}

/** The language of a route segment, falling back rather than throwing on a bad URL. */
export function langOr(value: string | undefined | null, fallback: Lang = DEFAULT_LANG): Lang {
  return isLang(value) ? value : fallback;
}

/**
 * Enough to label a language before its content has loaded — the switcher has to draw itself
 * on a cold start, and the `languages` rows arrive with the snapshot, which arrives after.
 * The database row is what the app uses once it has one; this is the bootstrap copy.
 */
export const LANG_LABELS: Record<Lang, { name: string; nativeName: string; script: string }> = {
  ka: { name: 'Georgian', nativeName: 'ქართული', script: 'geor' },
  ru: { name: 'Russian', nativeName: 'Русский', script: 'cyrl' },
};

export * as ka from './ka.ts';
export * as ru from './ru.ts';
