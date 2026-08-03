# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

## Types for the data files

`src/data/*.json` is generated, and large — `verbs.json` alone is 2.7 MB. Rather than let
TypeScript infer a type per file, `resolveJsonModule` is off and `src/data/data.d.ts` binds
each JSON module to a hand-written shape in `src/types.ts`. Adding a new data file means
adding a declaration there too, otherwise the import will not resolve.

Run `npm run typecheck` (or `npm run build`, which does it first) to check types.

## The lexicon and the stories

`words.json` is the one word list, and a story holds no meanings of its own. Every word
occurrence in a story records a `words.json` id and a *sense number*, so the same spelling
can mean different things in different lines — აბა is "let's" where the pigs egg each other
on and "just try" where the wolf threatens them. Correcting a definition is done once, in
the lexicon, and every story that cites it follows.

An inflected form may also carry a meaning of its own, which the card shows above the
headword: `იყო` reads as "was", filed under `არის` "is". Nothing can derive that — the
paradigm knows the frame ("I -ed") but not that the past of "build" is "built" — so it is
written down, as `"იყო": { "gram": "Aorist 3sg", "en": "was; there was" }`. Case forms of a
nominal get none: `მგელმა` means what `მგელი` means, and the `erg` tag says the rest.

Nothing generated is edited by hand. The sources are:

| File | Holds |
| --- | --- |
| `scripts/wordsBase.json` | the scraped A1–A2 dictionary; replace wholesale from a re-scrape |
| `scripts/posOverrides.json` | part of speech for the entries the scrape left untagged |
| `scripts/lexicon.json` | lemmas, senses and paradigm links written by hand |
| `scripts/lexiconForms.json` | inflected forms the story builder has resolved, grown by `--learn` |
| `scripts/storyOverrides.json` | what is true of one story: its names, and the spellings or positions to pin |

`npm run build:data` runs the whole thing: build the lexicon, resolve the stories, learn the
forms they turned up, and fold those back in so the next story links itself. `npm run
build:stories -- --report` prints every link the matcher had to guess, for a read-through.

Adding a story means dropping `<id>.txt` (and optionally `<id>.en.txt`, one paragraph per
Georgian paragraph) in `src/data/stories/`, running `build:data`, and adding a line to
`src/data/stories.ts` and a module declaration in `src/data/data.d.ts`. The build reports
what it could not resolve, and prints the one-line `lexicon.json` entry for any verb
paradigm no headword has claimed yet.

## What you know

`src/study/` is the one part of the app that is *yours* rather than generated. It keeps a
review record per word in the browser's IndexedDB, and the rest of it is arithmetic over
those records:

| File | Holds |
| --- | --- |
| `mastery.ts` | the 1–6 scale and the scheduler — no storage, no React |
| `db.ts` | the IndexedDB store, which resolves rather than throws when there is none |
| `items.ts` | words.json and verbs.json as one list of things to learn |
| `store.ts` | those records in memory, written through, read with `useProgress()` |

Two things about the scale are worth knowing before changing anything:

**A word never met has no record at all**, rather than a level of 0. That absence is a state
in its own right — it is what a story paints as new and what the checkbox at the end of one
acts on — and keeping it out of the scale means it can never be confused with level 1, "I
have seen this and it keeps slipping away".

**Level 6 is only ever set by hand**: the Known button on a card, the level picker over a
word in a story, the checkbox at the end of one. Answering well takes a card to 5 and no
further, because "I got this right three times" and "stop showing me this" are different
claims and only the second should retire a word for good.

Each word carries a level *per direction*, since recognising მგელი and producing it from
"wolf" are different skills. Those are two cards off one word, as in Anki, and the deck only
ever deals one of them at a time. A story colours words by the recognition side, falling
back to the other, because reading is recognition.

The new-card allowance is per calendar day, and it caps only never-seen cards — reviews are
never withheld, however many are due. It is counted off the records themselves rather than a
tally, so it cannot drift; that is what `introduced` on a record is for, since a story
finished with 400 unstudied words in it writes 400 records that were never *learned*.

The two files are joined by `items.ts` rather than merged: 165 of the 603 paradigms already
have a headword in words.json, so `verbKey()` resolves a paradigm to its headword's key
where one claims it. Drilling a verb from the verb list and meeting it in a story are then
the same card, which is the only way a level can mean anything.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

Oxlint's `typescript` plugin is enabled in `.oxlintrc.json`. For type-aware rules on top of
that, see the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts).
