// The sign-in dialog: Discord, or a link mailed to an address.
//
// One dialog for both buttons in the header, because behind them there is only one flow.
// An address that has been here before gets a link that signs it in; one that has not gets
// a link that makes the account first. Nothing in the response says which — an answer that
// differed would turn this box into a way of asking the server whether a given person has
// an account — so the only thing `mode` changes is the wording someone reads on the way in.

import { useEffect, useRef, useState } from 'react';
import { sendSignInLink, signInWithDiscord } from '../api/client';
import Icon from './Icon';

export type SignInMode = 'signin' | 'signup';

interface SignInDialogProps {
  mode: SignInMode;
  /** Shown on open, for a link that came back rejected. See Account.tsx. */
  initialError?: string | null;
  onClose: () => void;
}

export default function SignInDialog({ mode, initialError = null, onClose }: SignInDialogProps) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Escape closes it, the same as everywhere else in this app — and for the same reason,
  // that a keyboard user cannot click the backdrop.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The address field is what almost everyone came here to fill in, so the caret starts in
  // it rather than one tab away.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (event: React.FormEvent) => {
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
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content signin-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-heading"
        onClick={event => event.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>

        <h2 id="signin-heading" className="signin-heading">
          {mode === 'signup' ? 'Create an account' : 'Sign in'}
        </h2>
        <p className="signin-lead">
          {mode === 'signup'
            ? 'An email address and nothing else. No password to choose, and none to forget.'
            : 'Your progress is saved in this browser either way. An account is what makes it follow you to another device.'}
        </p>

        {sent ? (
          // Nothing left to do here but read a mail, so the form goes away rather than sit
          // there inviting a second send.
          <div className="signin-sent" role="status">
            <Icon name="check" size={20} />
            <div>
              <p className="signin-sent-line">
                A sign-in link is on its way to <strong>{sent}</strong>.
              </p>
              <p className="signin-sent-sub">It works once and expires in fifteen minutes.</p>
            </div>
            <button
              className="signin-linkish"
              onClick={() => {
                setSent(null);
                setError(null);
              }}
            >
              Use a different address
            </button>
          </div>
        ) : (
          <>
            <button
              className="signin-discord"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void signInWithDiscord().catch(() => setBusy(false));
              }}
            >
              <Icon name="discord" size={18} />
              <span>{busy ? 'Opening Discord…' : 'Continue with Discord'}</span>
            </button>

            <p className="signin-or">
              <span>or</span>
            </p>

            <form className="signin-form" onSubmit={submit}>
              <label className="signin-label" htmlFor="signin-email">
                Email
              </label>
              <input
                ref={inputRef}
                id="signin-email"
                className="signin-input"
                type="email"
                name="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                // A keyboard with an @ on it, and none of the autocapitalising or correcting
                // a phone does to what it takes for an ordinary word.
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                disabled={sending}
              />
              <button className="signin-send" type="submit" disabled={sending || !email.trim()}>
                <Icon name="mail" size={17} />
                <span>{sending ? 'Sending…' : 'Email me a sign-in link'}</span>
              </button>
            </form>

            <p className="signin-hint">
              {mode === 'signup'
                ? 'Following the link makes the account. If the address already has one, it signs you into that instead.'
                : 'No password. If the address is new here, following the link makes the account.'}
            </p>
          </>
        )}

        {error ? (
          <p className="signin-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
