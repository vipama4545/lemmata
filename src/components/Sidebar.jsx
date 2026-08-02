import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import Icon from './Icon';
import { groupedGrammarTopics } from '../data/grammar';

// The primary navigation. On a wide screen it is a column pinned beside the content; below
// 1024px it slides in over the page as a drawer, which is why it needs to know when the
// route changes — a tap on a link there should close it again.
function Sidebar({ open, onClose }) {
  const location = useLocation();

  useEffect(() => {
    onClose();
    // Closing is tied to the route, not to the callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Escape closes the drawer for keyboard users, who cannot reach the backdrop.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
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
          <SidebarLink to="/" icon="grid" label="Categories" end />
          <SidebarLink to="/verbs" icon="list" label="Verbs" />
          <SidebarLink to="/search" icon="search" label="Word search" />
          <SidebarLink to="/flashcards" icon="cards" label="Flashcards" />
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
      </nav>
    </>
  );
}

function SidebarLink({ to, icon, label, end = false, sub = false }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `sidebar-link ${sub ? 'sidebar-link-sub' : ''} ${isActive ? 'active' : ''}`
      }
    >
      <Icon name={icon} size={sub ? 16 : 18} />
      <span>{label}</span>
    </NavLink>
  );
}

export default Sidebar;
