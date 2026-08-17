// This reader's own content, on the browser side.
//
// Two jobs, and they are small because the hard part is elsewhere. The server answers every
// library mutation with the *whole* overlay rather than the row that changed (the head of the
// `library` contract says why), so nothing here has to merge a patch into anything. It fetches,
// it hands the result to `setPrivateContent`, and the app repaints because `content()` is now a
// different object.
//
// The other job is keeping the overlay honest about who is signed in. A private library is the
// one thing in this app that is wrong rather than merely stale when the session changes: sign
// out and somebody else's browser session would otherwise still be showing your stories in the
// index until a reload.

import { useCallback, useEffect, useState } from 'react';
import type { PrivateContent } from '@georgian/shared/contract';
import type { Lang } from '@georgian/shared/grammar';
import { api, useSession } from '../api/client';
import { lang, setPrivateContent } from '../content/store';
import { forgetStories } from '../data/stories';

/**
 * Fetches this reader's own content and swaps it in.
 *
 * Never throws. The overlay is an addition to a dictionary that has already loaded, and a
 * network failure here should leave the app exactly as usable as it was before any of this
 * existed: with the published library, and without yours.
 */
export async function loadLibrary(of: Lang): Promise<void> {
  try {
    setPrivateContent(await api.library.mine({ lang: of }));
  } catch (error) {
    console.warn('Could not load your own library; showing the published one only.', error);
  }
}

/**
 * Keeps the overlay in step with the session and the language on screen.
 *
 * Mounted once, in App. It waits for `isPending` to clear rather than firing on the unknown
 * state, because the session resolves a beat after the first paint and asking twice would mean
 * every signed-in visit fetching an empty overlay and then the real one.
 *
 * Signing out sets it to null through the same path: `library.mine` answers with nothing for a
 * request carrying no session, which is the true answer rather than a special case.
 */
export function useLibrarySync(): void {
  const { isPending } = useSession();
  const signedIn = useSignedIn();
  const of = lang();

  useEffect(() => {
    if (isPending) return;
    // The chapters fetched for this session go with it. See `forgetStories`: a private text
    // should not survive a sign-out in a cache the next person at the keyboard can walk back
    // into. Harmless on the way in, where there is nothing cached yet.
    forgetStories();
    void loadLibrary(of);
  }, [isPending, signedIn, of]);
}

/** The signed-in account's id, or null. What the sync above keys on. */
export function useSignedIn(): string | null {
  const { data } = useSession();
  return data?.user?.id ?? null;
}

/**
 * Runs one edit to your own library: busy while it is in flight, the server's message when it
 * fails, and the overlay swapped in when it succeeds.
 *
 * `useEdit`'s counterpart for content that is not the dictionary's, and the difference is the
 * last part. That one re-fetches the whole snapshot, because an admin's edit changed something
 * every visitor sees; this one applies the overlay the mutation already answered with, because
 * nothing outside this browser changed and the four megabytes are still perfectly current.
 */
export function useLibraryEdit(): {
  busy: boolean;
  error: string | null;
  clearError: () => void;
  run: <T extends { content?: PrivateContent }>(action: () => Promise<T>) => Promise<T | null>;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(async <T extends { content?: PrivateContent }>(action: () => Promise<T>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result?.content) setPrivateContent(result.content);
      return result;
    } catch (thrown) {
      // The server's own message, shown as it is. They are written to be read: "That category
      // still holds 4 word(s). Move them to another one first."
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      setError(message || 'That did not work. Try again.');
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, clearError, run };
}
