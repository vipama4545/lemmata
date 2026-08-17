// The furniture the library's own screens are built from.
//
// Almost all of it is the app's editing furniture, which lives in admin/ui.tsx for historical
// reasons; see the note at the head of that file. It is imported through here rather than
// directly by five screens, so there is one place to look when it moves and so these screens
// read as what they are: a reader editing their own things, not an admin editing everybody's.
//
// What is added below is the little that is particular to this section: the panel that stands
// in for a list nobody has filled yet, and the sign-in prompt that stands in for the whole
// section when nobody is signed in.

import { useState, type ComponentProps, type ReactNode } from 'react';
import { LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from '@/components/ui/page';
import { cn } from '@/lib/utils';
import { lang } from '../content/store';
import SignInDialog from '../components/SignInDialog';

export {
  ADMIN_INPUT_GEO as INPUT_TARGET,
  AdminActions as Actions,
  AdminBadge as Badge,
  AdminCheck as Check,
  AdminCount as Count,
  AdminError as ErrorLine,
  AdminField as Field,
  AdminGrid as Grid,
  AdminHead as Head,
  AdminHeadRow as HeadRow,
  AdminHint as Hint,
  AdminLabel as Label,
  AdminLinkButton as LinkButton,
  AdminNote as Note,
  AdminPage as EditorPage,
  AdminRowEn as RowEn,
  AdminRowGeo as RowTarget,
  AdminRowMeta as RowMeta,
  AdminRows as Rows,
  AdminSection as Section,
  AdminSectionTitle as SectionTitle,
  AdminSub as Sub,
  AdminTextarea as Textarea,
  AdminInput as Input,
  AdminTitle as Title,
  AdminWarning as Warning,
} from '../admin/ui';

/** Where the library's own screens live. One place, so a rename is one edit. */
export function libraryHref(rest = ''): string {
  return `/${lang()}/library${rest}`;
}

/** The trail every screen in this section starts with. */
export function LibraryCrumb({ children }: { children?: ReactNode }) {
  return (
    <Breadcrumb>
      <BreadcrumbLink to={libraryHref()}>← My library</BreadcrumbLink>
      {children && (
        <>
          <BreadcrumbSeparator />
          <span>{children}</span>
        </>
      )}
    </Breadcrumb>
  );
}

/** A list with nothing in it yet, saying what would put something there. */
export function Empty({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      className={cn(
        'rounded-sm border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

/**
 * What stands where the library would be for somebody with no account.
 *
 * A whole page rather than a disabled button, because there is nothing here to preview: every
 * word of this section is the reader's own, and somebody signed out has none.
 *
 * It opens the sign-in dialog itself rather than pointing at the header. The header's copy is
 * private to `Account` and lifting that state to the app to share it would be a lot of wiring
 * for a dialog that costs nothing to mount twice. The button in front of somebody is the one
 * they will press.
 */
export function SignInFirst({ what }: { what: string }) {
  const [dialog, setDialog] = useState(false);

  return (
    <Page>
      <Breadcrumb>
        <BreadcrumbLink to={`/${lang()}`}>← Home</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>My library</span>
      </Breadcrumb>

      <div className="mx-auto max-w-[52ch] py-10 text-center">
        <LogIn className="mx-auto mb-4 size-7 text-muted-foreground" aria-hidden="true" />
        <h1 className="mb-2 text-xl font-bold">Sign in to keep {what}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Your own stories and words are kept against your account, so they follow you from one
          device to the next. Nobody else can see them: not other readers, and not the people who
          write the dictionary.
        </p>
        <Button size="auto" className="mt-5 font-semibold" onClick={() => setDialog(true)}>
          Sign in or sign up
        </Button>
      </div>

      <SignInDialog open={dialog} mode="signup" onClose={() => setDialog(false)} />
    </Page>
  );
}
