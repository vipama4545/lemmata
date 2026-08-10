// The sign-in dialog: Discord, or a link mailed to an address.
//
// One dialog for both buttons in the header, because behind them there is only one flow.
// An address that has been here before gets a link that signs it in; one that has not gets
// a link that makes the account first. Nothing in the response says which — an answer that
// differed would turn this box into a way of asking the server whether a given person has
// an account — so the only thing `mode` changes is the wording someone reads on the way in.

import { useRef, useState } from 'react';
import { Check, Mail } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DiscordIcon } from '@/components/ui/discord-icon';
import { Input } from '@/components/ui/input';
import { sendSignInLink, signInWithDiscord } from '../api/client';

export type SignInMode = 'signin' | 'signup';

interface SignInDialogProps {
  open: boolean;
  mode: SignInMode;
  /** Shown on open, for a link that came back rejected. See Account.tsx. */
  initialError?: string | null;
  onClose: () => void;
}

export default function SignInDialog({ open, mode, initialError = null, onClose }: SignInDialogProps) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
    <Dialog open={open} onOpenChange={next => { if (!next) onClose(); }}>
      <DialogContent
        className="max-w-95 gap-0 rounded-lg p-6"
        // The address field is what almost everyone came here to fill in, so the caret starts
        // in it rather than one tab away.
        onOpenAutoFocus={event => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogHeader className="text-left">
          <DialogTitle className="text-xl font-bold">
            {mode === 'signup' ? 'Create an account' : 'Sign in'}
          </DialogTitle>
          <DialogDescription className="mb-5 text-[13px] leading-normal">
            {mode === 'signup'
              ? 'An email address and nothing else. No password to choose, and none to forget.'
              : 'Your progress is saved in this browser either way. An account is what makes it follow you to another device.'}
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          // Nothing left to do here but read a mail, so the form goes away rather than sit
          // there inviting a second send.
          <div
            className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-sm border border-border bg-muted p-4"
            role="status"
          >
            {/* The tick, and nothing else in this block, takes the "it worked" colour. */}
            <Check className="mt-px size-5 text-m-5" aria-hidden="true" />
            <div>
              <p className="text-sm leading-normal">
                A sign-in link is on its way to <strong className="wrap-anywhere">{sent}</strong>.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">It works once and expires in fifteen minutes.</p>
            </div>
            <button
              className="col-start-2 mt-2.5 cursor-pointer justify-self-start p-0 text-xs text-muted-foreground underline hover:text-foreground"
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
            {/* Discord's own blurple, because a sign-in button that does not look like the
                service it hands off to is a button people hesitate over. */}
            <button
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-sm border border-[#5865f2] bg-[#5865f2] px-3 py-[11px] text-sm font-semibold text-white transition-colors hover:not-disabled:border-[#4752c4] hover:not-disabled:bg-[#4752c4] disabled:cursor-default disabled:opacity-60"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void signInWithDiscord().catch(() => setBusy(false));
              }}
            >
              <DiscordIcon className="size-[18px]" />
              <span>{busy ? 'Opening Discord…' : 'Continue with Discord'}</span>
            </button>

            {/* A rule with the word sitting in a gap in it, rather than a word above a rule.
                The two ways in are alternatives and this is the whole of what says so. */}
            <p className="my-4 flex items-center gap-2.5 text-xs text-faint before:h-px before:flex-1 before:bg-border before:content-[''] after:h-px after:flex-1 after:bg-border after:content-['']">
              <span>or</span>
            </p>

            <form className="flex flex-col gap-[7px]" onSubmit={submit}>
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="signin-email">
                Email
              </label>
              <Input
                ref={inputRef}
                id="signin-email"
                className={[
                  'h-auto rounded-sm bg-background px-3 py-2.5 text-sm shadow-none md:text-sm',
                  'focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary-glow',
                  // The browser's own :invalid fires on the first keystroke, when every
                  // address is still half-typed. :not(:placeholder-shown) holds it back until
                  // there is something there, and :not(:focus) until they have moved on.
                  'user-invalid:not-placeholder-shown:not-focus:border-m-1',
                  'disabled:opacity-60',
                ].join(' ')}
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
              <button
                className="mt-[3px] flex w-full cursor-pointer items-center justify-center gap-2 rounded-sm border border-primary bg-primary px-3 py-[11px] text-sm font-semibold text-primary-foreground transition-colors hover:not-disabled:border-primary-dark hover:not-disabled:bg-primary-dark disabled:cursor-default disabled:opacity-60"
                type="submit"
                disabled={sending || !email.trim()}
              >
                <Mail className="size-[17px]" aria-hidden="true" />
                <span>{sending ? 'Sending…' : 'Email me a sign-in link'}</span>
              </button>
            </form>

            <p className="mt-3.5 text-xs leading-normal text-faint">
              {mode === 'signup'
                ? 'Following the link makes the account. If the address already has one, it signs you into that instead.'
                : 'No password. If the address is new here, following the link makes the account.'}
            </p>
          </>
        )}

        {error ? (
          <p className="mt-3.5 text-xs leading-normal text-m-1" role="alert">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
