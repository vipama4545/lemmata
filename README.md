# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

## Types for the data files

`src/data/*.json` is generated, and large — `verbs.json` alone is 2.7 MB. Rather than let
TypeScript infer a type per file, `resolveJsonModule` is off and `src/data/data.d.ts` binds
each JSON module to a hand-written shape in `src/types.ts`. Adding a new data file means
adding a declaration there too, otherwise the import will not resolve.

Run `npm run typecheck` (or `npm run build`, which does it first) to check types.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

Oxlint's `typescript` plugin is enabled in `.oxlintrc.json`. For type-aware rules on top of
that, see the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts).
