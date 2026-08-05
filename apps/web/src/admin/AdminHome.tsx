// The admin section: the guard, the hub, and the three lists that lead into the editors.
//
// The lists all read the snapshot rather than asking the server. The whole dictionary is
// already in this browser — that is the point of the snapshot — so filtering 2,096 words as
// you type costs nothing and works with the network down. Only the writes go over the wire.

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import type { AdminUser } from '@georgian/shared/contract';
import { api, useSession } from '../api/client';
import Icon from '../components/Icon';
import { storySummaries, verbData, wordData } from '../content/store';
import { searchWords } from './search';
import { useEdit, useIsAdmin } from './useAdmin';

/**
 * Everything under /admin sits behind this.
 *
 * It is a courtesy, not the enforcement: every procedure checks the session for itself, and
 * re-reads `is_admin` from the table rather than trusting the cached session cookie. Hiding a
 * route only keeps it out of the way of people who have no business there.
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const { isAdmin, isPending } = useIsAdmin();

  // Nothing at all while the session resolves. Redirecting on "not yet known" would bounce an
  // admin off their own page on every reload.
  if (isPending) return <div className="main-content" />;
  if (!isAdmin) return <Navigate to="/" replace />;

  return <>{children}</>;
}

export function AdminHome() {
  const { words, categories } = wordData();
  const verbs = verbData().verbs;
  const stories = storySummaries();

  const needsCheck = words.filter(word => word.check).length;
  const withForms = words.filter(word => word.forms?.length).length;

  return (
    <div className="main-content admin-page">
      <div className="breadcrumb">
        <Link to="/">← Home</Link>
        <span className="breadcrumb-sep">/</span>
        <span>Admin</span>
      </div>

      <header className="admin-head">
        <h1 className="admin-title">Editing the dictionary</h1>
        <p className="admin-sub">
          Every change here is live the moment it saves: the content version moves, this browser re-fetches,
          and every other one does on its next visit.
        </p>
      </header>

      <div className="admin-cards">
        <Link to="/admin/words" className="admin-card">
          <Icon name="type" size={22} />
          <h2>Words</h2>
          <p className="admin-card-count">{words.length}</p>
          <p className="admin-card-note">
            {categories.length} categories · {withForms} with inflected forms · {needsCheck} flagged for checking
          </p>
        </Link>

        <Link to="/admin/verbs" className="admin-card">
          <Icon name="table" size={22} />
          <h2>Verbs</h2>
          <p className="admin-card-count">{verbs.length}</p>
          <p className="admin-card-note">Paradigms and all 66 cells of each</p>
        </Link>

        <Link to="/admin/stories" className="admin-card">
          <Icon name="message" size={22} />
          <h2>Stories</h2>
          <p className="admin-card-count">{stories.length}</p>
          <p className="admin-card-note">Paste prose in and it links itself against the lexicon</p>
        </Link>

        <Link to="/admin/users" className="admin-card">
          <Icon name="users" size={22} />
          <h2>Admins</h2>
          <p className="admin-card-count">—</p>
          <p className="admin-card-note">Who else may edit all of this</p>
        </Link>
      </div>

      <section className="admin-section">
        <h2 className="admin-section-title">Where the data lives now</h2>
        <p className="admin-note">
          The database is the source of truth for content, not <code>data/*.json</code>. After editing here,
          <code> npm run db:export</code> writes it back out to those files so the authoring scripts have
          something current to work from, and <code>npm run db:seed</code> will refuse to overwrite these
          edits with the older files unless it is given <code>--force</code>.
        </p>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------- words */

export function WordList() {
  const { words, categories } = wordData();
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState('');
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  const shown = useMemo(() => {
    let list = term.trim() ? searchWords(words, term, 400) : words;
    if (category) list = list.filter(word => word.categoryId === category);
    if (flaggedOnly) list = list.filter(word => word.check);
    return list.slice(0, 400);
  }, [words, term, category, flaggedOnly]);

  return (
    <div className="main-content admin-page">
      <div className="breadcrumb">
        <Link to="/admin">← Admin</Link>
        <span className="breadcrumb-sep">/</span>
        <span>Words</span>
      </div>

      <header className="admin-head admin-head-row">
        <h1 className="admin-title">Words</h1>
        <Link to="/admin/words/new" className="control-btn know">
          <Icon name="type" /> New word
        </Link>
      </header>

      <div className="toolbar">
        <div className="search-field">
          <Icon name="search" />
          <input
            type="text"
            className="search-input"
            placeholder="Search Georgian or English…"
            value={term}
            onChange={event => setTerm(event.target.value)}
          />
        </div>
        <select className="admin-input admin-input-narrow" value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">Every category</option>
          {categories.map(item => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <label className="check admin-check">
          <input type="checkbox" checked={flaggedOnly} onChange={event => setFlaggedOnly(event.target.checked)} />
          Only ones flagged for checking
        </label>
      </div>

      <p className="admin-count-line">
        {shown.length === words.length ? `${words.length} entries` : `${shown.length} shown of ${words.length}`}
      </p>

      <ul className="admin-rows">
        {shown.map(word => (
          <li key={word.id}>
            <Link to={`/admin/words/${encodeURIComponent(word.id)}`} className="admin-row-link">
              <span className="admin-row-geo">{word.georgian}</span>
              <span className="admin-row-en">{word.english}</span>
              <span className="admin-row-meta">
                {word.senses.length > 1 && <span className="admin-badge">{word.senses.length} senses</span>}
                {word.forms?.length ? <span className="admin-badge">{word.forms.length} forms</span> : null}
                {word.verbId && <span className="admin-badge">paradigm</span>}
                {word.check && <span className="admin-badge is-flagged">check</span>}
                {word.level && <span className={`level-badge ${word.level.toLowerCase()}`}>{word.level}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------- verbs */

export function VerbList() {
  const verbs = verbData().verbs;
  const [term, setTerm] = useState('');

  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return verbs.slice(0, 400);
    return verbs
      .filter(
        verb =>
          verb.english.toLowerCase().includes(needle) ||
          verb.present3sg.includes(needle) ||
          verb.verbalNoun.includes(needle),
      )
      .slice(0, 400);
  }, [verbs, term]);

  return (
    <div className="main-content admin-page">
      <div className="breadcrumb">
        <Link to="/admin">← Admin</Link>
        <span className="breadcrumb-sep">/</span>
        <span>Verbs</span>
      </div>

      <header className="admin-head admin-head-row">
        <h1 className="admin-title">Verbs</h1>
        <Link to="/admin/verbs/new" className="control-btn know">
          <Icon name="table" /> New paradigm
        </Link>
      </header>

      <div className="toolbar">
        <div className="search-field">
          <Icon name="search" />
          <input
            type="text"
            className="search-input"
            placeholder="Search English or Georgian…"
            value={term}
            onChange={event => setTerm(event.target.value)}
          />
        </div>
      </div>

      <p className="admin-count-line">
        {shown.length === verbs.length ? `${verbs.length} paradigms` : `${shown.length} shown of ${verbs.length}`}
      </p>

      <ul className="admin-rows">
        {shown.map(verb => (
          <li key={verb.id}>
            <Link to={`/admin/verbs/${encodeURIComponent(verb.id)}`} className="admin-row-link">
              <span className="admin-row-geo">{verb.present3sg || verb.verbalNoun}</span>
              <span className="admin-row-en">{verb.english}</span>
              <span className="admin-row-meta">
                {verb.transitivity && <span className="admin-badge">{verb.transitivity}</span>}
                {verb.group && <span className="admin-badge">{verb.group}</span>}
                <span className="admin-badge">{Object.keys(verb.forms).length} screeves</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ stories */

export function StoryList() {
  const stories = storySummaries();

  return (
    <div className="main-content admin-page">
      <div className="breadcrumb">
        <Link to="/admin">← Admin</Link>
        <span className="breadcrumb-sep">/</span>
        <span>Stories</span>
      </div>

      <header className="admin-head admin-head-row">
        <h1 className="admin-title">Stories</h1>
        <Link to="/admin/stories/new" className="control-btn know">
          <Icon name="message" /> New story
        </Link>
      </header>

      {stories.length === 0 && <p className="empty-note">No stories yet. Paste one in and it will link itself.</p>}

      <ul className="admin-rows">
        {stories.map(story => (
          <li key={story.id}>
            <Link to={`/admin/stories/${encodeURIComponent(story.id)}`} className="admin-row-link">
              <span className="admin-row-geo">{story.title}</span>
              <span className="admin-row-en">{story.titleEnglish}</span>
              <span className="admin-row-meta">
                {story.level && <span className={`level-badge ${story.level.toLowerCase()}`}>{story.level}</span>}
                <span className="admin-badge">{story.stats.tokens} words</span>
                <span className={`admin-badge${story.stats.coverage < 90 ? ' is-flagged' : ''}`}>
                  {story.stats.coverage}% linked
                </span>
                {story.stats.unresolved > 0 && (
                  <span className="admin-badge is-flagged">{story.stats.unresolved} unresolved</span>
                )}
                {story.translated && <span className="admin-badge">translated</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------- users */

/** A join date, which is all that separates two accounts with the same username. */
function joined(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function UserList() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const { busy, error, run } = useEdit();
  // Every address in this list is masked, your own included, so there has to be some other
  // way to find yourself in it — otherwise "which of these is me" is unanswerable, and this
  // is the screen where you might revoke the wrong person.
  const { data: session } = useSession();
  const me = session?.user?.id ?? null;

  // The account list is the one admin read that is not already in the snapshot, so it is the
  // one that has to be fetched. `refresh: false` on both calls here: neither touches content,
  // and re-downloading the dictionary to find out who is an admin would be absurd.
  useEffect(() => {
    void run(() => api.admin.users(), { refresh: false }).then(result => {
      if (result) setUsers(result.users);
    });
  }, [run]);

  const toggle = async (user: AdminUser) => {
    const result = await run(() => api.admin.setAdmin({ userId: user.id, isAdmin: !user.isAdmin }), {
      refresh: false,
    });
    if (result) setUsers(result.users);
  };

  return (
    <div className="main-content admin-page">
      <div className="breadcrumb">
        <Link to="/admin">← Admin</Link>
        <span className="breadcrumb-sep">/</span>
        <span>Admins</span>
      </div>

      <header className="admin-head">
        <h1 className="admin-title">Who may edit</h1>
        <p className="admin-sub">
          An admin may add, change and delete every word, paradigm and story. There is no way back into an
          installation with no admins except a shell on the host, so the last one cannot be removed here.
        </p>
        <p className="admin-sub">
          Accounts are listed by username. Email addresses are not shown — not partially, not to admins —
          and the server does not send them, so there is nothing here to reveal.
        </p>
      </header>

      {error && <p className="admin-error">{error}</p>}
      {users === null && <p className="admin-hint">Loading accounts…</p>}

      {users !== null && (
        <ul className="admin-rows">
          {users.map(user => (
            <li key={user.id}>
              <div className="admin-row-link is-static">
                <span className="admin-row-geo admin-row-plain">{user.name}</span>
                {/* The username, and nothing else about who they are. There is no address
                    here to show: `admin.users` does not send one. The join date is what
                    separates two people who picked the same name. */}
                <span className="admin-row-en">joined {joined(user.createdAt)}</span>
                <span className="admin-row-meta">
                  {user.id === me && <span className="admin-badge">you</span>}
                  {user.isAdmin && <span className="admin-badge is-admin">admin</span>}
                  <button
                    type="button"
                    className={user.isAdmin ? 'admin-danger-btn' : 'control-btn'}
                    disabled={busy || user.id === me}
                    title={user.id === me ? 'You cannot change your own access.' : undefined}
                    onClick={() => toggle(user)}
                  >
                    {user.isAdmin ? 'Remove admin' : 'Make admin'}
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default AdminHome;
