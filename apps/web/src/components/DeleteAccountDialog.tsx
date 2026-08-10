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
//
// Red is used nowhere else in this app — the mastery ramp's --m-1 is the closest thing, and
// it means "you keep forgetting this word", not danger — so it is unambiguous here.

import { useState } from 'react';
import { WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { requestAccountDeletion } from '../api/client';
import { resetProgress } from '../study/store';

interface DeleteAccountDialogProps {
  /** The signed-in user's own address, in full — it is where the confirmation is going. */
  email: string;
  onClose: () => void;
}

const NOTE = 'text-[13px] leading-relaxed text-muted-foreground';

export default function DeleteAccountDialog({ email, onClose }: DeleteAccountDialogProps) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alsoLocal, setAlsoLocal] = useState(false);

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
    <Dialog open onOpenChange={next => { if (!next) onClose(); }}>
      <DialogContent className="max-w-130 rounded-lg p-6 text-left">
        {sent ? (
          <>
            <DialogHeader className="text-left">
              <DialogTitle className="text-xl">Check your inbox</DialogTitle>
              <DialogDescription className="text-[14.5px] leading-relaxed text-foreground">
                A confirmation has gone to <strong>{email}</strong>. Your account is deleted when
                you follow the link in it, and not before — until then nothing has changed.
              </DialogDescription>
            </DialogHeader>
            <p className={NOTE}>
              Open it <strong>in this browser</strong>, while still signed in. The link proves which
              account to delete by the session it is opened with, so following it somewhere you are
              signed out will not work.
            </p>
            {alsoLocal && (
              <p className={NOTE}>What this browser knew has already been erased, as you asked.</p>
            )}
            <DialogFooter>
              <Button variant="control" size="auto" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader className="text-left">
              <DialogTitle className="text-xl">Delete your account</DialogTitle>
              <DialogDescription className="text-[14.5px] leading-relaxed text-foreground">
                This removes the account behind <strong>{email}</strong> and every review record
                stored on it — what you know, and when each word is next due. It cannot be undone.
              </DialogDescription>
            </DialogHeader>

            {/* What is *kept* — deliberately a panel rather than another paragraph. It is the
                one thing in the dialog somebody is likely to have got wrong in their head, so
                it has to survive being skim-read. */}
            <div className="rounded-sm border border-border bg-muted p-3.5">
              <p className="mb-2 flex items-center gap-[7px] text-[13.5px] font-semibold">
                <WalletCards className="size-[15px]" aria-hidden="true" />
                What this browser knows is kept
              </p>
              <p className={`${NOTE} mb-2.5`}>
                Your progress lives here first and was here before you signed up. Deleting the
                account removes the copy that outlives this laptop; the copy on it stays, and you
                can carry on studying signed out exactly as you are now.
              </p>
              <label className="flex cursor-pointer items-start gap-2 text-[13.5px]">
                <Checkbox
                  className="mt-0.5"
                  checked={alsoLocal}
                  onCheckedChange={value => setAlsoLocal(value === true)}
                />
                <span>
                  Erase this browser’s copy too
                  <span className="mt-[3px] block text-[12.5px] leading-normal text-faint">
                    Every level, interval and due date on this device, gone as well. Other devices
                    you have used keep theirs.
                  </span>
                </span>
              </label>
            </div>

            {error && (
              <p className="rounded-sm border border-l-[3px] border-destructive bg-[color-mix(in_srgb,var(--m-1)_8%,var(--card))] px-3 py-2.5 text-[13.5px]">
                {error}
              </p>
            )}

            <p className={NOTE}>
              Nothing happens yet. We send a link to confirm it is you, the same as signing in.
            </p>

            <DialogFooter>
              <Button variant="control" size="auto" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="danger" size="auto" disabled={sending} onClick={submit}>
                {sending ? 'Sending…' : 'Email me the confirmation'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
