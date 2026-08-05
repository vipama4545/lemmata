// Signing in, and the one place that tells the sync who is signed in.
//
// The panel is deliberately quiet about it. An account is not required to use anything
// here: what you know is kept in this browser whether or not you have one, and the only
// thing signing in buys you is that it follows you to another device. So this says that,
// rather than presenting a wall anyone has to get past to study a word.

import { useEffect, useState } from 'react';
import { signInWithDiscord, signOut, useSession } from '../api/client';
import { flushNow, setSyncUser } from '../study/sync';
import Icon from './Icon';

export default function Account() {
  const { data: session, isPending } = useSession();
  const user = session?.user ?? null;
  const [busy, setBusy] = useState(false);

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

  if (isPending) {
    return (
      <div className="account">
        <p className="account-note">…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="account">
        <p className="account-note">
          Your progress is saved in this browser. Sign in and it follows you to any device —
          everything you have already marked comes with you.
        </p>
        <button
          className="account-signin"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void signInWithDiscord().catch(() => setBusy(false));
          }}
        >
          <Icon name="discord" size={18} />
          <span>{busy ? 'Opening Discord…' : 'Sign in with Discord'}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="account">
      <div className="account-user">
        {user.image ? (
          <img className="account-avatar" src={user.image} alt="" width={32} height={32} />
        ) : (
          <span className="account-avatar account-avatar-blank">
            <Icon name="users" size={16} />
          </span>
        )}
        <div className="account-who">
          {/* The username as the provider gave it. There is no other name here. */}
          <span className="account-name">{user.name}</span>
          <span className="account-status">Progress is syncing</span>
        </div>
      </div>
      <button
        className="account-signout"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          flushNow();
          void signOut().finally(() => setBusy(false));
        }}
      >
        Sign out
      </button>
    </div>
  );
}
