// Who may edit, and what an edit does to the rest of the app.
//
// Both halves are small and both are needed by every screen under admin/, which is why they
// are here rather than repeated.

import { useCallback, useState } from 'react';
import { useSession } from '../api/client';
import { refreshContent } from '../content/store';

/**
 * Whether the signed-in account may edit the dictionary.
 *
 * `isPending` matters: the session resolves a beat after the first paint, and a guard that
 * treated "not yet known" as "not an admin" would bounce an admin off their own page on
 * every reload.
 */
export function useIsAdmin(): { isAdmin: boolean; isPending: boolean } {
  const { data: session, isPending } = useSession();
  const user = session?.user as { isAdmin?: boolean } | undefined;
  return { isAdmin: user?.isAdmin === true, isPending };
}

/**
 * Runs one edit: busy while it is in flight, the server's message when it fails, and the
 * dictionary re-fetched when it succeeds.
 *
 * That last part is the reason this exists rather than a try/catch per button. Every mutation
 * bumps the content version on the server, so the copy in this browser is stale the moment
 * one returns — and a save that left the screen showing the old word would look like it had
 * not worked.
 */
export function useEdit(): {
  busy: boolean;
  error: string | null;
  clearError: () => void;
  run: <T>(action: () => Promise<T>, options?: { refresh?: boolean }) => Promise<T | null>;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(async <T,>(action: () => Promise<T>, options?: { refresh?: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (options?.refresh !== false) await refreshContent();
      return result;
    } catch (thrown) {
      // oRPC puts the server's message on the error. It is written to be read — "მგელი is
      // still used by three-little-pigs (14)" — so it is shown as it is rather than replaced
      // with something generic.
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      setError(message || 'That did not work. Try again.');
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, clearError, run };
}
