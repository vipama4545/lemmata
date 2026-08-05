// Signing in, and the one place that tells the sync who is signed in.
//
// The panel is deliberately quiet about it. An account is not required to use anything
// here: what you know is kept in this browser whether or not you have one, and the only
// thing signing in buys you is that it follows you to another device. So this says that,
// rather than presenting a wall anyone has to get past to study a word.
//
// Two ways in, and neither is a password. Discord, or a link mailed to an address — which
// is also how an account gets made, so there is no second form headed "sign up". Typing an
// address that has never been here before and following the link is the whole of signing
// up, and the panel says nothing about which of the two just happened, because an answer
// that differed would let anyone use this box to ask whether a given person has an account.

import { useEffect, useState } from 'react';
import { sendSignInLink, signInWithDiscord, signOut, useSession } from '../api/client';
import { flushNow, setSyncUser } from '../study/sync';
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
  const [busy, setBusy] = useState(false);

  // The email half. `sent` holds the address the link went to, which is worth showing back:
  // a typo in the domain is invisible while you are typing it and obvious once it is quoted
  // in a sentence about where the mail was sent.
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  // A link that failed verification lands back here as `?error=…`. Without this the browser
  // simply returns to the app looking signed out, which reads as the link having done
  // nothing at all rather than as an expired one.
  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    const code = params.get('error');
    if (!code) return;

    setError(describeLinkError(code));

    // Then take it out of the URL, or a refresh re-reports a failure from ten minutes ago.
    // replaceState rather than the router, because the query string sits outside the hash
    // that HashRouter owns and the router will not touch it.
    params.delete('error');
    const query = params.toString();
    const { pathname, hash } = globalThis.location;
    globalThis.history.replaceState(null, '', `${pathname}${query ? `?${query}` : ''}${hash}`);
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

        <p className="account-or">
          <span>or</span>
        </p>

        {sent ? (
          // Nothing to do here but wait for a mail, so the form is out of the way until it
          // is wanted again — a live input under "check your inbox" invites a second send.
          <div className="account-sent" role="status">
            <p className="account-sent-line">
              <Icon name="check" size={15} />
              <span>
                A sign-in link is on its way to <strong>{sent}</strong>. It works once and
                expires in fifteen minutes.
              </span>
            </p>
            <button
              className="account-linkish"
              onClick={() => {
                setSent(null);
                setError(null);
              }}
            >
              Use a different address
            </button>
          </div>
        ) : (
          <form
            className="account-email"
            onSubmit={event => {
              event.preventDefault();
              const address = email.trim();
              if (!address || sending) return;

              setSending(true);
              setError(null);
              sendSignInLink(address)
                .then(() => {
                  setSent(address);
                  setEmail('');
                })
                .catch((cause: unknown) => {
                  setError(cause instanceof Error ? cause.message : 'The link could not be sent.');
                })
                .finally(() => setSending(false));
            }}
          >
            <label className="account-label" htmlFor="account-email-input">
              Email
            </label>
            <input
              id="account-email-input"
              className="account-input"
              type="email"
              name="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              // A keyboard with an @ on it, and none of the autocapitalising or correcting
              // a phone does to what it takes for a word.
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              disabled={sending}
            />
            <button className="account-emailsend" type="submit" disabled={sending || !email.trim()}>
              <Icon name="mail" size={16} />
              <span>{sending ? 'Sending…' : 'Email me a sign-in link'}</span>
            </button>
            <p className="account-hint">
              No password. If the address is new here, this makes the account.
            </p>
          </form>
        )}

        {error ? (
          <p className="account-error" role="alert">
            {error}
          </p>
        ) : null}
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
          {/* The username as the provider gave it, or the one taken off the front of the
              address for an account that came in by mail. There is no other name here. */}
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
