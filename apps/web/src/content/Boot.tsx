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
import { loadContent } from './store';

const App = lazy(() => import('../App'));

type State = { status: 'loading' } | { status: 'ready' } | { status: 'failed'; error: Error };

export default function Boot() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
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
  }, [attempt]);

  if (state.status === 'failed') {
    return (
      <div className="boot boot-failed">
        <h1 className="boot-title">The dictionary could not be loaded</h1>
        <p className="boot-note">
          The server did not answer, and there is no copy saved in this browser yet.
        </p>
        <p className="boot-detail">{state.error.message}</p>
        <button className="boot-retry" onClick={() => setAttempt(n => n + 1)}>
          Try again
        </button>
      </div>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="boot">
        <p className="boot-title">Loading the dictionary…</p>
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
