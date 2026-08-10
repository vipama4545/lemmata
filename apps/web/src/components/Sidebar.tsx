import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import Icon from './Icon';
import type { IconName } from './Icon';
import { groupedGrammarTopics } from '../data/grammar';
import { dueCount, useProgress } from '../study/store';
import { useIsAdmin } from '../admin/useAdmin';
import { lang } from '../content/store';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

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
      {open && <div className="sidebar-backdrop" onClick={onClose} aria-hidden="true" />}

      <nav
        className={`sidebar ${open ? 'open' : ''}`}
        aria-label="Main navigation"
        id="sidebar"
      >
        <div className="sidebar-drawer-head">
          <span className="sidebar-drawer-title">Menu</span>
          <button className="sidebar-close" onClick={onClose} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>

        <div className="sidebar-section">
          <p className="sidebar-heading">Dictionary</p>
          <SidebarLink to="/" icon="calendar" label="Word of the day" end />
          <SidebarLink to="/categories" icon="grid" label="Categories" />
          <SidebarLink to="/verbs" icon="list" label="Verbs" />
          <SidebarLink to="/search" icon="search" label="Word search" />
          <SidebarLink to="/stories" icon="message" label="Stories" />
          <SidebarLink to="/flashcards" icon="cards" label="Flashcards" badge={due} />
          <SidebarLink to="/export" icon="download" label="Export to Anki" />
        </div>

        <div className="sidebar-section">
          <p className="sidebar-heading">Grammar</p>
          <SidebarLink to="/grammar" icon="book" label="Overview" end />
          {grammarGroups.map(group => (
            <div key={group.id} className="sidebar-subsection">
              <p className="sidebar-subheading">{group.label}</p>
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
        </div>

        {/* Last, and only for an admin. Editing is a different job from learning, and putting
            it above the grammar topics would make it look like part of the app everyone uses. */}
        {isAdmin && (
          <div className="sidebar-section">
            <p className="sidebar-heading">Admin</p>
            <SidebarLink to="/admin" icon="sliders" label="Overview" end />
            <SidebarLink to="/admin/words" icon="type" label="Words" />
            <SidebarLink to="/admin/verbs" icon="table" label="Verbs" />
            <SidebarLink to="/admin/stories" icon="message" label="Stories" />
            <SidebarLink to="/admin/users" icon="users" label="Admins" />
          </div>
        )}

      </nav>
    </>
  );
}

interface SidebarLinkProps {
  to: string;
  icon: IconName;
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
function SidebarLink({ to, icon, label, end = false, sub = false, badge = 0 }: SidebarLinkProps) {
  return (
    <NavLink
      to={`/${lang()}${to === '/' ? '' : to}`}
      end={end}
      className={({ isActive }) =>
        `sidebar-link ${sub ? 'sidebar-link-sub' : ''} ${isActive ? 'active' : ''}`
      }
    >
      <Icon name={icon} size={sub ? 16 : 18} />
      <span>{label}</span>
      {badge > 0 && <span className="sidebar-badge" title={`${badge} cards due`}>{badge}</span>}
    </NavLink>
  );
}

export default Sidebar;
