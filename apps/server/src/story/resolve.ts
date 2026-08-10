// Binding every word of a story to a lexicon entry and to the sense that applies there.
//
// This file is the part that is the same in any language: walk the paragraphs, keep the
// records a person made, ask the matcher about everything else, count what happened. The
// matching itself is not the same in any language and lives next door — resolve-ka.ts and
// resolve-ru.ts — with the head of each explaining why the two differ as much as they do.
//
// Resolution order for a token, first hit wins:
//
//   1. an existing hand-made record   — a name or an override already on the token
//   2. …whatever the language's matcher makes of the spelling
//
// Step 1 is here, and it is the difference from the offline script this all started as.
// There, hand corrections come from storyOverrides.json and are applied on top; here they
// are already *in* the story as tokens marked `via: "name"` or `via: "override"`, so
// relinking preserves them instead of recomputing them. Same mechanism, one fewer file.

import type { Lang } from '@georgian/shared/grammar';
import type { StoryAlt, StoryToken } from '@georgian/shared/types';
import type { Tag, Tags } from './analyser.ts';
import type { Contested } from './lexicon.ts';
import type { Resolved } from './lexicon.ts';
import { buildKaIndexes, resolveKa, type KaIndexes } from './resolve-ka.ts';
import { buildRuIndexes, resolveRu, type RuIndexes } from './resolve-ru.ts';
import { tokenise } from './tokenise.ts';

/**
 * One language's view of the dictionary, ready to match against.
 *
 * A union rather than a common interface, because the two matchers want different things
 * out of it and neither should be able to read the other's. What they do share — the words,
 * the senses, the confirmed forms — is in `Lexicon`, which both of these extend.
 */
export type Indexes = KaIndexes | RuIndexes;

/**
 * Every index the matcher needs, built fresh per relink.
 *
 * Not cached: a relink happens when somebody presses a button and takes a second either way,
 * while a cache would have to be invalidated by every word edit — and a stale form index is
 * exactly the failure that would be hardest to see.
 */
export async function buildIndexes(lang: Lang): Promise<Indexes> {
  return lang === 'ru' ? buildRuIndexes() : buildKaIndexes();
}

/** Spellings two lemmas both claim, for whoever wants to know. See `loadLexicon`. */
export type { Contested };

/* ------------------------------------------------------------------ linking */

/** A token row as it is stored, minus the story it belongs to. */
export interface ResolvedToken {
  paragraph: number;
  position: number;
  form: string;
  wordId: string | null;
  sense: number | null;
  gram: string | null;
  name: string | null;
  via: string;
  needsCheck: boolean;
  alts: StoryAlt[];
  comment: string | null;
}

/**
 * A record a person made rather than the resolver, carried across a relink untouched.
 *
 * Keyed by `${paragraph}:${position}:${form}` — the spelling is part of the key on purpose.
 * If the prose is edited, the words after the edit shift along, and a pin re-applied by
 * position alone would land on a different word and assert something nobody said. Including
 * the form makes that case drop the pin instead, which is recoverable; the other is not.
 */
export type Pinned = Map<string, StoryToken>;

/** True of the tokens a person decided. See the note on `story_tokens.via`. */
export function isHandMade(via: string): boolean {
  return via === 'name' || via.startsWith('override');
}

export function pinKey(paragraph: number, position: number, form: string): string {
  return `${paragraph}:${position}:${form}`;
}

export interface LinkReport {
  tokens: ResolvedToken[];
  stats: {
    tokens: number;
    distinctForms: number;
    covered: number;
    coverage: number;
    names: number;
    unresolved: number;
    flagged: number;
  };
  /** Spellings nothing matched, commonest first. */
  unresolved: { form: string; count: number }[];
  /** Links reached by a guess, commonest first. */
  flagged: { form: string; count: number }[];
  /** Paradigms that matched but that no lexicon entry claims, commonest first. */
  unclaimedVerbs: { verbId: string; count: number }[];
}

/** The matcher for whichever language the indexes were built for. */
function matcherFor(indexes: Indexes) {
  return (token: string, unclaimed: Map<string, number>, tag?: Tag): Resolved | null =>
    indexes.lang === 'ru' ? resolveRu(token, indexes, unclaimed, tag) : resolveKa(token, indexes, unclaimed, tag);
}

/**
 * Links a whole story: one record per word occurrence, in reading order.
 *
 * `pinned` is applied first and short-circuits everything else, which is what makes this
 * safe to run again after any change to the lexicon — the words a person placed stay where
 * they were placed, and every other token is worked out afresh against the dictionary as it
 * now stands.
 */
export function linkStory(
  lang: Lang,
  paragraphs: string[],
  indexes: Indexes,
  pinned: Pinned,
  tags?: Tags | null,
): LinkReport {
  const tokens: ResolvedToken[] = [];
  const unclaimed = new Map<string, number>();
  const unresolvedCounts = new Map<string, number>();
  const flaggedCounts = new Map<string, number>();
  const distinct = new Set<string>();
  const resolveForm = matcherFor(indexes);

  let linked = 0;
  let named = 0;

  // Resolved once per distinct spelling: a story of 976 tokens holds around 575 spellings,
  // and reconstructing a lemma is the expensive step. A pin is applied on top of the shared
  // result.
  //
  // Keyed on the tag as well as the spelling. A tagger exists precisely so that one spelling
  // can resolve two ways in one story, and a cache on the spelling alone would hand the
  // first occurrence's answer to every later one and quietly undo the whole thing.
  const cache = new Map<string, Resolved | null>();
  const resolveOnce = (form: string, tag?: Tag): Resolved | null => {
    const key = tag ? `${form}\0${tag.upos}\0${tag.lemma}` : form;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const resolved = resolveForm(form, unclaimed, tag);
    cache.set(key, resolved);
    return resolved;
  };

  paragraphs.forEach((paragraph, p) => {
    const words = tokenise(lang, paragraph);

    // Tags are read back by position, so a paragraph is only tagged if the reply still has
    // exactly one entry per word in it. The client checks this against what it sent; this
    // checks it against what is actually being linked, which is not the same claim if the
    // prose was edited between the two. Same rule as `at()` on the web side: a position is
    // believed only when something independent of it agrees.
    const tagged = tags?.[p]?.length === words.length ? tags[p] : undefined;

    words.forEach((form, t) => {
      distinct.add(form);

      // 1. A record a person made. Carried straight across, exactly as it was.
      const pin = pinned.get(pinKey(p, t, form));
      if (pin) {
        if (pin.name) named += 1;
        else if (pin.word) linked += 1;
        // Counted as flagged, exactly as the resolver's own guesses are: an editor who
        // marked a pin "come back to this" wants it in the same list.
        if (pin.check) flaggedCounts.set(form, (flaggedCounts.get(form) ?? 0) + 1);
        tokens.push({
          paragraph: p,
          position: t,
          form,
          wordId: pin.word ?? null,
          sense: pin.sense ?? null,
          gram: pin.gram ?? null,
          name: pin.name ?? null,
          via: pin.via,
          // Carried across, not cleared. Deciding something and being sure of it are
          // different claims, and only the editor knows which one they made.
          needsCheck: pin.check === true,
          alts: pin.alts ?? [],
          comment: pin.comment ?? null,
        });
        return;
      }

      // Absent for every token when no tagger is reachable, which is the null that makes
      // all of this optional: a matcher without a tag is the matcher as it was.
      const resolved = resolveOnce(form, tagged?.[t]);

      if (!resolved) {
        unresolvedCounts.set(form, (unresolvedCounts.get(form) ?? 0) + 1);
        tokens.push({
          paragraph: p,
          position: t,
          form,
          wordId: null,
          sense: null,
          gram: null,
          name: null,
          via: 'unresolved',
          needsCheck: false,
          alts: [],
          comment: null,
        });
        return;
      }

      linked += 1;
      if (resolved.check) flaggedCounts.set(form, (flaggedCounts.get(form) ?? 0) + 1);

      tokens.push({
        paragraph: p,
        position: t,
        form,
        wordId: resolved.word.id,
        sense: resolved.sense,
        gram: resolved.gram || null,
        name: null,
        via: resolved.via,
        needsCheck: resolved.check,
        // Kept so a wrong default can be corrected by pointing at one of these, and so the
        // editing screen has the shortlist it would otherwise have to recompute.
        alts: resolved.alts.slice(0, 4).map(word => ({ word: word.id, english: word.english })),
        comment: null,
      });
    });
  });

  const total = tokens.length;
  const covered = linked + named;
  const byCount = (a: { count: number; form: string }, b: { count: number; form: string }) =>
    b.count - a.count || a.form.localeCompare(b.form, lang);

  return {
    tokens,
    stats: {
      tokens: total,
      distinctForms: distinct.size,
      covered,
      coverage: total ? Number(((covered / total) * 100).toFixed(1)) : 0,
      names: named,
      unresolved: total - covered,
      flagged: [...flaggedCounts.values()].reduce((sum, n) => sum + n, 0),
    },
    unresolved: [...unresolvedCounts].map(([form, count]) => ({ form, count })).sort(byCount),
    flagged: [...flaggedCounts].map(([form, count]) => ({ form, count })).sort(byCount),
    unclaimedVerbs: [...unclaimed]
      .map(([verbId, count]) => ({ verbId, count }))
      .sort((a, b) => b.count - a.count || a.verbId.localeCompare(b.verbId)),
  };
}
