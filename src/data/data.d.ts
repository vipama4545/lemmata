// Binds the generated JSON data files to the shapes in src/types.ts.
//
// These are wildcard patterns rather than exact paths because the same file is imported
// from three depths — './data/verbs.json' from App, '../data/verbs.json' from a component,
// './verbs.json' from grammar.ts — and a '*' matches the leading segment in all three.
//
// The alternative, resolveJsonModule, is deliberately not used: see tsconfig.app.json.

declare module '*/words.json' {
  const data: import('../types').WordData;
  export default data;
}

declare module '*/verbs.json' {
  const data: import('../types').VerbData;
  export default data;
}

declare module '*/verbMorphemes.json' {
  const data: import('../types').MorphemeData;
  export default data;
}

declare module '*/images.json' {
  const data: import('../types').ImageMap;
  export default data;
}

declare module '*/categoryImages.json' {
  const data: import('../types').ImageMap;
  export default data;
}
