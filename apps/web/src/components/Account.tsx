// The account control in the top right of the header, and the one place that tells the
// sync who is signed in.
//
// Signed out it is two buttons and no explanation. An account is not required to use
// anything here — what you know is kept in this browser whether or not you have one — so
// the case for having one belongs in the dialog those buttons open, not in a paragraph
// standing between somebody and the dictionary they came for.
//
// Signed in it collapses to the username, with everything else behind it.

import { useEffect, useState } from 'react';
import { Check, ChevronDown, RotateCcw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { flushNow, setSyncUser } from '../study/sync';
import { DELETED_FLAG, signOut, useSession } from '../api/client';
import DeleteAccountDialog from './DeleteAccountDialog';
import SignInDialog from './SignInDialog';
import type { SignInMode } from './SignInDialog';
import { KNOW_BUTTON } from './StoryReader';

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

/* Everything in this first group sits on the header's dark gradient rather than on a
   surface, so the colours are white at low alpha rather than the theme's own. The slot
   holds its height while the session resolves, so the header does not jump when two
   buttons turn into a username. */
const SLOT = 'relative flex min-h-9 items-center gap-2 max-md:min-h-0 max-md:gap-1.5';

export default function Account() {
  const { data: session, isPending } = useSession();
  const user = session?.user ?? null;

  const [dialog, setDialog] = useState<SignInMode | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);

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

  const close = () => {
    setDialog(null);
    setLinkError(null);
  };

  // Nothing at all until the session resolves. A pair of sign-in buttons that appear for a
  // moment and then turn into a username is worse than a beat of empty space.
  if (isPending) return <div className={SLOT} />;

  if (!user) {
    return (
      <div className={SLOT}>
        {/* Sign in is the quieter of the two: it is for people who already know they have an
            account, and they are not the ones who need to be able to find it. */}
        <Button variant="header" className={ACCOUNT_BUTTON} onClick={() => setDialog('signin')}>
          Sign in
        </Button>
        <Button
          className={`${ACCOUNT_BUTTON} border-2 border-white bg-white text-[#0f172a] hover:border-[#dbeafe] hover:bg-[#dbeafe]`}
          onClick={() => setDialog('signup')}
        >
          Sign up
        </Button>
        <SignInDialog
          open={dialog !== null}
          mode={dialog ?? 'signin'}
          initialError={linkError}
          onClose={close}
        />
        {/* Shown signed out, which is the only state it can be shown in — the account it is
            reporting on no longer exists. */}
        <DeletedNotice open={deleted} onClose={() => setDeleted(false)} />
      </div>
    );
  }

  return (
    <div className={SLOT}>
      {/* A DropdownMenu rather than a div and a mousedown listener: dismissal, Escape, focus
          return and the menu roles are the parts that were hand-written here before. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* The name truncates rather than wraps, and truncates sooner on a phone: a long one
              would otherwise be the thing that pushes this row off the side of the screen. */}
          <button className="flex max-w-50 cursor-pointer items-center gap-2 rounded-full border-2 border-white/20 bg-white/5 py-[5px] pr-2.5 pl-1.5 text-[13px] font-semibold text-white transition-colors hover:border-white/40 hover:bg-white/15 max-md:max-w-32">
            {user.image ? (
              <img
                className="size-6.5 shrink-0 rounded-full object-cover"
                src={user.image}
                alt=""
                width={26}
                height={26}
              />
            ) : (
              <span className="grid size-6.5 shrink-0 place-items-center rounded-full bg-white/12 text-white/70">
                <Users className="size-3.5" aria-hidden="true" />
              </span>
            )}
            {/* The username as the provider gave it, or the one taken off the front of the
                address for an account that came in by mail. There is no other name here. */}
            <span className="truncate">{user.name}</span>
            <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>

        {/* The menu leaves the header's dark band, so from here down it is theme colours. */}
        <DropdownMenuContent align="end" className="min-w-55 rounded-sm shadow-pop">
          <div className="flex flex-col gap-0.5 px-2.5 pt-2 pb-1.5">
            <span className="truncate text-[13px] font-semibold text-foreground">{user.name}</span>
            {/* Your own, in full. Saying which account you are signed in as is the whole job
                of this line. Other people's addresses are masked wherever they appear, which
                is the admin user list and nowhere else. */}
            <span className="text-[11px] wrap-anywhere text-faint">{user.email}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 pb-2 text-[11px] text-faint">
            <RotateCcw className="size-3" aria-hidden="true" />
            <span>Progress is syncing</span>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={busy}
            onSelect={event => {
              event.preventDefault();
              setBusy(true);
              // Whatever has not reached the server yet goes now — signing out is exactly
              // when an unflushed answer would be lost for good.
              flushNow();
              void signOut().finally(() => setBusy(false));
            }}
          >
            {busy ? 'Signing out…' : 'Sign out'}
          </DropdownMenuItem>

          {/* Last, under a rule, and the only red thing in here. It is the one irreversible
              action in the app and should not sit a pixel from Sign out. */}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            Delete account
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {deleting ? <DeleteAccountDialog email={user.email} onClose={() => setDeleting(false)} /> : null}
    </div>
  );
}

/* Tighter on a phone, where this pair is now the only thing to the right of the wordmark and
   still has to fit beside it on a 360px screen. Both stay: signing up is what the loud one is
   for, and dropping it on the size of screen most people arrive on would drop it for most
   people. */
const ACCOUNT_BUTTON =
  'h-auto rounded-sm px-3.5 py-[7px] text-[13px] font-semibold whitespace-nowrap max-md:px-2.5 max-md:py-1.5 max-md:text-[12.5px]';

/**
 * What you come back to after following the confirmation link.
 *
 * The account is gone and the session with it, so without this the app would simply be
 * showing Sign in / Sign up again — indistinguishable from having been signed out, which is
 * a poor way to learn that something irreversible worked.
 */
function DeletedNotice({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose(); }}>
      <DialogContent className="max-w-130 rounded-lg p-6 text-left">
        <DialogHeader className="text-left">
          <DialogTitle className="text-xl">Your account has been deleted</DialogTitle>
          <DialogDescription className="text-[14.5px] leading-relaxed text-foreground">
            The account and every review record on it are gone, and so is the address we had.
            Nothing is left to sign back in to.
          </DialogDescription>
        </DialogHeader>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Unless you asked for it to be erased too, what this browser knows is still here — so
          the dictionary works exactly as it did, and your progress with it. Signing up again
          later would upload this browser’s copy to the new account.
        </p>

        <DialogFooter>
          <Button variant="control" size="auto" className={KNOW_BUTTON} onClick={onClose}>
            <Check /> Carry on
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
