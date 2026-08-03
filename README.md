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

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

Oxlint's `typescript` plugin is enabled in `.oxlintrc.json`. For type-aware rules on top of
that, see the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts).
