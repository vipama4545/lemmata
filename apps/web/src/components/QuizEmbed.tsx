// One quiz, on somebody else's page.
//
// The same `QuizRunner` the app uses, in a shell with nothing else in it: no header, no sidebar,
// no dictionary. That last one is the point of this file existing at all. The app is mounted
// behind `Boot`, which will not render anything until the whole four-megabyte snapshot is in
// hand — a perfectly good trade for someone who came here to read Georgian, and an absurd one
// for an iframe showing eight questions on a blog. So `Boot` checks the hash before it fetches
// anything and renders this instead, and this asks only for the quiz.
//
// The URL is a hash route — `#/embed/quiz/<id>` — and that is not a stylistic choice. The app
// routes with `HashRouter`, so every path after the `#` is served by the same index.html the
// site already serves; a clean `/embed/quiz/<id>` would need whoever deploys this to add a
// rewrite rule, and an embed that 404s until the web server is reconfigured is an embed that
// gets reported as broken.
//
// Nothing here is recorded, whoever is watching. A third-party iframe is not sent the session
// cookie by any current browser, so an embedded run has no account behind it to attribute
// anything to — and a "your progress is saved" that quietly depended on whether the host page
// happened to be same-origin would be worse than not offering it. The admin's snippet panel
// says so plainly.

import { useEffect, useState } from 'react';
import type { Quiz } from '@georgian/shared/types';
import { api } from '../api/client';
import { readEmbedHash } from '../content/embed';
import QuizRunner from './QuizRunner';

const SCREEN = 'flex min-h-40 items-center justify-center p-8 text-center text-muted-foreground';

export default function QuizEmbed() {
  // Read once, from the URL this document was opened with. An embed is a whole page that exists
  // to show one quiz; nothing in it navigates, so nothing has to watch for it.
  const [{ id, theme }] = useState(() => readEmbedHash(globalThis.location.hash));
  const [quiz, setQuiz] = useState<Quiz | null | 'loading'>('loading');

  /*
   * The host page's theme is not readable from in here — an iframe cannot see across origins —
   * so it is either stated in the URL or guessed from the reader's own system setting, which is
   * the same guess the app makes for a first-time visitor. `?theme=dark` is what somebody
   * embedding this on a dark page passes.
   */
  useEffect(() => {
    const dark = theme ? theme === 'dark' : globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    // Transparent rather than the page colour, so an embed on a coloured page does not sit in a
    // white rectangle. The runner's own card supplies every surface that needs one.
    document.body.style.background = 'transparent';
  }, [theme]);

  useEffect(() => {
    if (!id) {
      setQuiz(null);
      return undefined;
    }

    let live = true;
    void api.quiz
      .get({ id })
      .then(found => {
        if (live) setQuiz(found);
      })
      .catch(() => {
        if (live) setQuiz(null);
      });

    return () => {
      live = false;
    };
  }, [id]);

  if (quiz === 'loading') return <div className={SCREEN}>Loading…</div>;
  if (!quiz) return <div className={SCREEN}>That quiz could not be found.</div>;

  return (
    <div className="p-3">
      <header className="mb-3">
        <h1 className="text-[17px] leading-tight font-bold">{quiz.title}</h1>
        {quiz.titleNative && <p className="text-[15px] text-muted-foreground">{quiz.titleNative}</p>}
      </header>

      <QuizRunner quiz={quiz} embedded />
    </div>
  );
}
