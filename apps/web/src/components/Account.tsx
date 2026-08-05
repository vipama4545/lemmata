// The account control in the top right of the header, and the one place that tells the
// sync who is signed in.
//
// Signed out it is two buttons and no explanation. An account is not required to use
// anything here — what you know is kept in this browser whether or not you have one — so
// the case for having one belongs in the dialog those buttons open, not in a paragraph
// standing between somebody and the dictionary they came for.
//
// Signed in it collapses to the username, with everything else behind it.

import { useEffect, useRef, useState } from 'react';
import { flushNow, setSyncUser } from '../study/sync';
import { DELETED_FLAG, signOut, useSession } from '../api/client';
import DeleteAccountDialog from './DeleteAccountDialog';
import SignInDialog from './SignInDialog';
import type { SignInMode } from './SignInDialog';
import Icon from './Icon';

/**
 * What went wrong with a link that was followed but not accepted.
 *
 * The verify endpoint has nowhere to put a message — it can only bounce the browser back
 * here with `?error=` — so the wording lives on this side. Every case ends with the same
 * instruction because the same thing fixes all of them.
 */
function describeLinkError(code: string): string {
  switch (code) {
    case 'INVALID_TOKEN':
      return 'That link had already been used, or it had expired. Send yourself another one.';
    case 'new_user_signup_disabled':
      return 'That address does not have an account here.';
    default:
      return 'That sign-in link did not work. Send yourself another one.';
  }
}

export default function Account() {
  const { data: session, isPending } = useSession();
  const user = session?.user ?? null;

  const [dialog, setDialog] = useState<SignInMode | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // The only caller of setSyncUser. Everything about syncing hangs off this one line: it
  // starts on sign-in, reconciles the two stores, and stops on sign-out.
  useEffect(() => {
    setSyncUser(user?.id ?? null);
  }, [user?.id]);

  // A tab being closed a second after an answer should not lose it. `pagehide` rather than
  // `beforeunload`, which browsers ignore on mobile and which blocks the back/forward cache.
  useEffect(() => {
    const send = () => flushNow();
    window.addEventListener('pagehide', send);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') send();
    });
    return () => window.removeEventListener('pagehide', send);
  }, []);

  // Two things can come back in the query string, and both are read the same way: a link
  // that failed verification arrives as `?error=`, and a completed account deletion as
  // `?deleted=1`. Without this the browser just returns to the app looking signed out, which
  // reads as the link having done nothing rather than as an expired one — or, for a
  // deletion, as everything having silently vanished.
  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    const code = params.get('error');
    const wasDeleted = params.get(DELETED_FLAG) === '1';
    if (!code && !wasDeleted) return;

    if (code) {
      setLinkError(describeLinkError(code));
      setDialog('signin');
    }
    if (wasDeleted) setDeleted(true);

    // Then take them out of the URL, or a refresh re-reports something from ten minutes ago.
    // replaceState rather than the router, because the query string sits outside the hash
    // that HashRouter owns and the router will not touch it.
    params.delete('error');
    params.delete(DELETED_FLAG);
    const query = params.toString();
    const { pathname, hash } = globalThis.location;
    globalThis.history.replaceState(null, '', `${pathname}${query ? `?${query}` : ''}${hash}`);
  }, []);

  // Click anywhere else, or press Escape, and the signed-in menu closes.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const close = () => {
    setDialog(null);
    setLinkError(null);
  };

  // Nothing at all until the session resolves. A pair of sign-in buttons that appear for a
  // moment and then turn into a username is worse than a beat of empty space.
  if (isPending) return <div className="account-slot" />;

  if (!user) {
    return (
      <div className="account-slot">
        <button className="account-btn account-btn-ghost" onClick={() => setDialog('signin')}>
          Sign in
        </button>
        <button className="account-btn account-btn-solid" onClick={() => setDialog('signup')}>
          Sign up
        </button>
        {dialog ? <SignInDialog mode={dialog} initialError={linkError} onClose={close} /> : null}
        {/* Shown signed out, which is the only state it can be shown in — the account it is
            reporting on no longer exists. */}
        {deleted ? <DeletedNotice onClose={() => setDeleted(false)} /> : null}
      </div>
    );
  }

  return (
    <div className="account-slot" ref={menuRef}>
      <button
        className="account-chip"
        onClick={() => setMenuOpen(open => !open)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        {user.image ? (
          <img className="account-avatar" src={user.image} alt="" width={26} height={26} />
        ) : (
          <span className="account-avatar account-avatar-blank">
            <Icon name="users" size={14} />
          </span>
        )}
        {/* The username as the provider gave it, or the one taken off the front of the
            address for an account that came in by mail. There is no other name here. */}
        <span className="account-chip-name">{user.name}</span>
        <Icon name="chevron" size={14} />
      </button>

      {menuOpen ? (
        <div className="account-menu" role="menu">
          <p className="account-menu-who">
            <span className="account-menu-name">{user.name}</span>
            {/* Your own, in full. Saying which account you are signed in as is the whole job
                of this line. Other people's addresses are masked wherever they appear, which
                is the admin user list and nowhere else. */}
            <span className="account-menu-email">{user.email}</span>
          </p>
          <p className="account-menu-status">
            <Icon name="refresh" size={13} />
            <span>Progress is syncing</span>
          </p>
          <button
            className="account-menu-item"
            role="menuitem"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              // Whatever has not reached the server yet goes now — signing out is exactly
              // when an unflushed answer would be lost for good.
              flushNow();
              void signOut().finally(() => {
                setBusy(false);
                setMenuOpen(false);
              });
            }}
          >
            {busy ? 'Signing out…' : 'Sign out'}
          </button>

          {/* Last, under a rule, and the only red thing in here. It is the one irreversible
              action in the app and should not sit a pixel from Sign out. */}
          <button
            className="account-menu-item is-danger"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setDeleting(true);
            }}
          >
            Delete account
          </button>
        </div>
      ) : null}

      {deleting ? <DeleteAccountDialog email={user.email} onClose={() => setDeleting(false)} /> : null}
    </div>
  );
}

/**
 * What you come back to after following the confirmation link.
 *
 * The account is gone and the session with it, so without this the app would simply be
 * showing Sign in / Sign up again — indistinguishable from having been signed out, which is
 * a poor way to learn that something irreversible worked.
 */
function DeletedNotice({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content danger-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Account deleted"
        onClick={event => event.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>

        <h2>Your account has been deleted</h2>
        <p className="danger-lead">
          The account and every review record on it are gone, and so is the address we had.
          Nothing is left to sign back in to.
        </p>
        <p className="danger-note">
          Unless you asked for it to be erased too, what this browser knows is still here — so
          the dictionary works exactly as it did, and your progress with it. Signing up again
          later would upload this browser’s copy to the new account.
        </p>

        <div className="danger-actions">
          <button type="button" className="control-btn know" onClick={onClose}>
            <Icon name="check" /> Carry on
          </button>
        </div>
      </div>
    </div>
  );
}
