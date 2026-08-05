// Deleting your account.
//
// Two things make this worth a screen of its own rather than a confirm() and a button.
//
// The first is that "delete my account" and "delete what I know" are different things here,
// and almost nobody would guess which one they are getting. An account in this app is a
// *second replica* of your review records — the first one is in this browser and was there
// before you ever signed up. Deleting the account removes the copy that outlives the laptop
// and leaves the laptop's copy exactly as it is, so you carry on studying, signed out, with
// everything you knew. That is the right default and it is completely invisible, so it is
// spelled out, and the other choice is offered next to it.
//
// The second is that nothing here deletes anything. It sends a link, the same as signing in
// does. This is the only irreversible action in the app, and a mistyped click or somebody
// else at an unlocked laptop should not be enough on its own.

import { useEffect, useState } from 'react';
import { requestAccountDeletion } from '../api/client';
import { resetProgress } from '../study/store';
import Icon from './Icon';

interface DeleteAccountDialogProps {
  /** The signed-in user's own address, in full — it is where the confirmation is going. */
  email: string;
  onClose: () => void;
}

export default function DeleteAccountDialog({ email, onClose }: DeleteAccountDialogProps) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alsoLocal, setAlsoLocal] = useState(false);

  // Escape closes it, as everywhere else here, and for the same reason: a keyboard user
  // cannot click the backdrop.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = () => {
    if (sending) return;
    setSending(true);
    setError(null);

    requestAccountDeletion()
      .then(() => {
        // Done here, not when the link is followed. The link may well be opened in another
        // tab, and this browser is the only one that has anything local to erase — so if it
        // is going to happen, it happens on the click that asked for it.
        if (alsoLocal) resetProgress();
        setSent(true);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'The confirmation could not be sent.');
      })
      .finally(() => setSending(false));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content danger-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Delete your account"
        onClick={event => event.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>

        {sent ? (
          <>
            <h2>Check your inbox</h2>
            <p className="danger-lead">
              A confirmation has gone to <strong>{email}</strong>. Your account is deleted when
              you follow the link in it, and not before — until then nothing has changed.
            </p>
            <p className="danger-note">
              Open it <strong>in this browser</strong>, while still signed in. The link proves which
              account to delete by the session it is opened with, so following it somewhere you are
              signed out will not work.
            </p>
            {alsoLocal && (
              <p className="danger-note">
                What this browser knew has already been erased, as you asked.
              </p>
            )}
            <div className="danger-actions">
              <button type="button" className="control-btn" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>Delete your account</h2>
            <p className="danger-lead">
              This removes the account behind <strong>{email}</strong> and every review record
              stored on it — what you know, and when each word is next due. It cannot be undone.
            </p>

            <div className="danger-panel">
              <p className="danger-panel-title">
                <Icon name="cards" size={15} />
                What this browser knows is kept
              </p>
              <p className="danger-note">
                Your progress lives here first and was here before you signed up. Deleting the
                account removes the copy that outlives this laptop; the copy on it stays, and you
                can carry on studying signed out exactly as you are now.
              </p>
              <label className="check danger-check">
                <input
                  type="checkbox"
                  checked={alsoLocal}
                  onChange={event => setAlsoLocal(event.target.checked)}
                />
                <span>
                  Erase this browser’s copy too
                  <span className="danger-hint">
                    Every level, interval and due date on this device, gone as well. Other devices
                    you have used keep theirs.
                  </span>
                </span>
              </label>
            </div>

            {error && <p className="danger-error">{error}</p>}

            <p className="danger-note">
              Nothing happens yet. We send a link to confirm it is you, the same as signing in.
            </p>

            <div className="danger-actions">
              <button type="button" className="control-btn" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="danger-btn" disabled={sending} onClick={submit}>
                {sending ? 'Sending…' : 'Email me the confirmation'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
