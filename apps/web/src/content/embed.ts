// Whether this page is an embedded quiz, and which one.
//
// A module of its own holding two small functions, and it is worth saying why rather than
// leaving somebody to move them back into QuizEmbed.tsx where they look like they belong.
//
// `Boot` has to ask "is this an embed?" *before* it decides what to load — that is the whole
// point of the embed, which is that it does not fetch the dictionary. But `Boot` also loads
// `QuizEmbed` lazily, so that an ordinary visitor never downloads it. Those two are in direct
// conflict the moment the question and the answer live in one file: a static `import
// { isEmbedRoute }` from QuizEmbed.tsx makes the lazy import of the same file pointless, and
// the bundler says so —
//
//     [INEFFECTIVE_DYNAMIC_IMPORT] QuizEmbed.tsx is dynamically imported ... but also
//     statically imported, dynamic import will not move module into another chunk.
//
// — at which point the embed is in the main bundle and every reader pays for it. So the
// question lives here, where `Boot` can import it for a few bytes, and the answer stays in a
// chunk nobody fetches unless they are looking at one.

/** The route an embedded quiz is served at. A hash route; see the head of QuizEmbed.tsx. */
const PREFIX = '/embed/quiz/';

export function isEmbedRoute(hash: string): boolean {
  return hash.replace(/^#/, '').startsWith(PREFIX);
}

/**
 * The quiz id and the settings, out of the hash.
 *
 * Parsed by hand rather than with a router, because mounting one to read a single segment
 * would mean the embed chunk pulling in react-router — which is most of the reason it is small.
 *
 * `#/embed/quiz/<id>?theme=dark`
 */
export function readEmbedHash(hash: string): { id: string; theme: string | null } {
  const [path, query] = hash.replace(/^#/, '').split('?');
  return {
    id: decodeURIComponent(path.slice(PREFIX.length)),
    theme: new URLSearchParams(query ?? '').get('theme'),
  };
}
