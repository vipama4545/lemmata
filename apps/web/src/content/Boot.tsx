// The gate the whole app sits behind.
//
// Nothing under here renders until the dictionary is in hand, which is what lets every
// component below go on reading it synchronously — `wordData().words`, not a loading state
// in 300 places. The cost is one screen at startup, and after the first visit that screen
// lasts as long as one 55-byte round trip.
//
// The app is imported dynamically for the same reason. A static import would run every
// module in the tree — including the ones that build indexes off the dictionary — before
// this component ever mounted.

import { useEffect, useState, lazy, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { isEmbedRoute } from './embed';
import { loadContent } from './store';

const App = lazy(() => import('../App'));

/**
 * An embedded quiz, which is the one thing this app renders without a dictionary behind it.
 *
 * In its own chunk, so the ordinary visit does not carry it and the embed does not carry the
 * app. Between them that is the whole cost of the feature to somebody who never opens one.
 */
const QuizEmbed = lazy(() => import('../components/QuizEmbed'));

type State = { status: 'loading' } | { status: 'ready' } | { status: 'failed'; error: Error };

/* What is on screen between the page loading and the dictionary arriving. After the first
   visit that is one round trip, so this is deliberately plain: a spinner that appears and
   vanishes inside 100ms reads as a flicker, not as progress. */
const SCREEN =
  'flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-8 text-center text-muted-foreground';

export default function Boot() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // Decided once, from the URL the page was opened with, and never re-read. An embed is a whole
  // document that exists to show one quiz; there is nothing in it that could navigate out of the
  // embed and no reason to keep watching in case something did.
  const [embedded] = useState(() => isEmbedRoute(globalThis.location.hash));

  useEffect(() => {
    if (embedded) return undefined;

    let live = true;

    void loadContent().then(
      () => {
        if (live) setState({ status: 'ready' });
      },
      (error: unknown) => {
        if (live) setState({ status: 'failed', error: error as Error });
      },
    );

    return () => {
      live = false;
    };
  }, [attempt, embedded]);

  // Before every branch below, because all of them are about the dictionary and an embed is not
  // waiting for one. Its own Suspense rather than the app's: this chunk is the only thing that
  // has to arrive, and it is a fraction of the size.
  if (embedded) {
    return (
      <Suspense fallback={<div className={SCREEN} />}>
        <QuizEmbed />
      </Suspense>
    );
  }

  if (state.status === 'failed') {
    return (
      <div className={SCREEN}>
        <h1 className="text-base font-semibold text-foreground">The dictionary could not be loaded</h1>
        <p className="max-w-[40ch] text-sm leading-normal">
          The server did not answer, and there is no copy saved in this browser yet.
        </p>
        <p className="max-w-[60ch] font-mono text-xs break-words text-faint">{state.error.message}</p>
        <Button size="auto" className="mt-2 font-semibold" onClick={() => setAttempt(n => n + 1)}>
          Try again
        </Button>
      </div>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className={SCREEN}>
        <p className="text-base font-semibold text-foreground">Loading the dictionary…</p>
      </div>
    );
  }

  // Suspense covers the App chunk itself, which is already downloading by the time the
  // dictionary arrives — the two requests overlap rather than queue.
  return (
    <Suspense
      fallback={
        <div className="boot">
          <p className="boot-title">Loading the dictionary…</p>
        </div>
      }
    >
      <App />
    </Suspense>
  );
}
