import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  BookOpen,
  Calendar,
  Download,
  LayoutGrid,
  Library,
  List,
  MessageCircle,
  Search,
  SlidersHorizontal,
  Table,
  Type,
  Users,
  WalletCards,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { groupedGrammarTopics } from '../data/grammar';
import { dueCount, useProgress } from '../study/store';
import { useIsAdmin } from '../admin/useAdmin';
import { lang } from '../content/store';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

/**
 * A band of rows under a heading. Every band after the first is ruled off from the one above.
 *
 * The rule is a prop rather than `first:`, because the drawer header above these is in the DOM
 * at every width — it is only `display:none` on a wide screen — and `:first-child` counts it.
 * Keyed off `first:` the top band would carry a stray rule and a gap on the desktop layout,
 * where there is no drawer header visible for it to be separated from.
 */
function SidebarSection({ first = false, children }: { first?: boolean; children: ReactNode }) {
  return <div className={first ? undefined : 'mt-6 border-t border-border pt-5'}>{children}</div>;
}

const HEADING = 'mb-2 px-2.5 text-[11px] font-bold tracking-[0.08em] text-faint uppercase';

// The primary navigation. On a wide screen it is a column pinned beside the content; below
// 1024px it slides in over the page as a drawer, which is why it needs to know when the
// route changes — a tap on a link there should close it again.
function Sidebar({ open, onClose }: SidebarProps) {
  const location = useLocation();
  // Cards waiting is the one number worth carrying on every page: a spaced repetition deck
  // that has to be opened to find out whether it needs opening does not get opened.
  const due = dueCount(useProgress(), Date.now());
  const { isAdmin } = useIsAdmin();

  useEffect(() => {
    onClose();
    // Closing is tied to the route, not to the callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Escape closes the drawer for keyboard users, who cannot reach the backdrop.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const grammarGroups = groupedGrammarTopics();

  return (
    <>
      {open && <div className="fixed inset-0 z-150 bg-overlay lg:hidden" onClick={onClose} aria-hidden="true" />}

      {/* One element at both widths rather than a column and a Sheet. Below `lg` it leaves the
          flow and slides in from the left; above it, it is a sticky column that starts under
          the header and scrolls on its own. Two components would mean two trees, and the
          drawer would lose its scroll position every time the window crossed the breakpoint. */}
      <nav
        className={cn(
          'w-sidebar shrink-0 overflow-y-auto border-r border-border bg-card px-3 pt-5 pb-10',
          'sticky top-header h-[calc(100vh-var(--spacing-header))]',
          'max-lg:fixed max-lg:top-0 max-lg:left-0 max-lg:z-200 max-lg:h-screen max-lg:pt-4 max-lg:shadow-pop',
          'max-lg:-translate-x-full max-lg:transition-transform max-lg:duration-250 motion-reduce:transition-none',
          'max-md:w-[min(86vw,var(--spacing-sidebar))]',
          open && 'max-lg:translate-x-0',
        )}
        aria-label="Main navigation"
        id="sidebar"
      >
        {/* The drawer chrome only exists at the widths where this is a drawer. */}
        <div className="mb-2.5 hidden items-center justify-between border-b border-border pt-0 pr-1.5 pb-3.5 pl-2.5 max-lg:flex">
          <span className="text-[13px] font-bold tracking-[0.06em] text-faint uppercase">Menu</span>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close menu">
            <X />
          </Button>
        </div>

        <SidebarSection first>
          <p className={HEADING}>Dictionary</p>
          <SidebarLink to="/" icon={Calendar} label="Word of the day" end />
          <SidebarLink to="/categories" icon={LayoutGrid} label="Categories" />
          <SidebarLink to="/verbs" icon={List} label="Verbs" />
          <SidebarLink to="/search" icon={Search} label="Word search" />
          <SidebarLink to="/stories" icon={MessageCircle} label="Stories" />
          <SidebarLink to="/flashcards" icon={WalletCards} label="Flashcards" badge={due} />
          <SidebarLink to="/export" icon={Download} label="Export to Anki" />
        </SidebarSection>

        <SidebarSection>
          <p className={HEADING}>Grammar</p>
          <SidebarLink to="/grammar" icon={BookOpen} label="Overview" end />
          {grammarGroups.map(group => (
            <div key={group.id} className="mt-3">
              <p className="mb-1 px-2.5 text-[11px] font-semibold text-faint">{group.label}</p>
              {group.topics.map(topic => (
                <SidebarLink
                  key={topic.id}
                  to={`/grammar/${topic.id}`}
                  icon={topic.icon}
                  label={topic.title}
                  sub
                />
              ))}
            </div>
          ))}
        </SidebarSection>

        {/* Last, and only for an admin. Editing is a different job from learning, and putting
            it above the grammar topics would make it look like part of the app everyone uses. */}
        {isAdmin && (
          <SidebarSection>
            <p className={HEADING}>Admin</p>
            <SidebarLink to="/admin" icon={SlidersHorizontal} label="Overview" end />
            <SidebarLink to="/admin/words" icon={Type} label="Words" />
            <SidebarLink to="/admin/verbs" icon={Table} label="Verbs" />
            <SidebarLink to="/admin/stories" icon={MessageCircle} label="Stories" />
            <SidebarLink to="/admin/story-categories" icon={Library} label="Story categories" />
            <SidebarLink to="/admin/users" icon={Users} label="Admins" />
          </SidebarSection>
        )}

      </nav>
    </>
  );
}

interface SidebarLinkProps {
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
  sub?: boolean;
  /** A count to show at the right of the row. Hidden when it is zero. */
  badge?: number;
}

/**
 * Every row, with the language put on the front of its path.
 *
 * The `to` values above are written unprefixed — `/verbs`, `/stories` — because that is what
 * they have always been and what they mean: the verb list *of the dictionary you are in*. The
 * prefix is added in one place rather than interpolated at fifteen call sites, which is both
 * shorter and the only version that cannot be forgotten when a row is added.
 *
 * Doing it here rather than leaning on the catch-all redirect matters for two reasons. A
 * single-segment path like `/verbs` matches the `/:lang` route with `lang="verbs"` and never
 * reaches the redirect at all — it renders the home page instead, which is what broke these.
 * And `NavLink` compares `to` against the real URL, so an unprefixed link never marks itself
 * active however well the navigation lands.
 */
function SidebarLink({ to, icon: Icon, label, end = false, sub = false, badge = 0 }: SidebarLinkProps) {
  return (
    <NavLink
      to={`/${lang()}${to === '/' ? '' : to}`}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-[14.5px] font-medium transition-colors',
          'text-muted-foreground hover:bg-muted hover:text-foreground',
          sub && 'pl-3.5 text-[13.5px]',
          isActive && 'bg-primary-light font-semibold text-primary hover:bg-primary-light hover:text-primary',
        )
      }
    >
      <Icon className={cn('shrink-0', sub ? 'size-4' : 'size-[18px]')} aria-hidden="true" />
      <span>{label}</span>
      {badge > 0 && (
        <span
          className="ml-auto min-w-[22px] rounded-full bg-primary px-1.5 py-px text-center text-[11px] font-bold tabular-nums text-primary-foreground"
          title={`${badge} cards due`}
        >
          {badge}
        </span>
      )}
    </NavLink>
  );
}

export default Sidebar;
