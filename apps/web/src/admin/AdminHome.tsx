// The admin section: the guard, the hub, and the three lists that lead into the editors.
//
// The lists all read the snapshot rather than asking the server. The whole dictionary is
// already in this browser — that is the point of the snapshot — so filtering 2,096 words as
// you type costs nothing and works with the network down. Only the writes go over the wire.

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Library, MessageCircle, Table, Type, Users } from 'lucide-react';
import type { AdminUser } from '@georgian/shared/contract';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from '@/components/ui/page';
import { SearchField } from '@/components/ui/search-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LevelBadge } from '@/components/ui/word-card';
import { cn } from '@/lib/utils';
import { KNOW_BUTTON } from '../components/StoryReader';
import { api, useSession } from '../api/client';
import { storyCategories, storySummaries, kaVerbData, wordData } from '../content/store';
import { searchWords } from './search';
import {
  ADMIN_ROW_LINK,
  ADMIN_ROW_LINK_HOVER,
  AdminBadge,
  AdminCheck,
  AdminCountLine,
  AdminError,
  AdminHead,
  AdminHeadRow,
  AdminHint,
  AdminNote,
  AdminPage,
  AdminRowEn,
  AdminRowGeo,
  AdminRowMeta,
  AdminRows,
  AdminSection,
  AdminSectionTitle,
  AdminSub,
  AdminTitle,
} from './ui';
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
  if (isPending) return <Page />;
  if (!isAdmin) return <Navigate to="/" replace />;

  return <>{children}</>;
}

/** The trail every admin screen but the hub carries. */
function AdminCrumb({ children }: { children: ReactNode }) {
  return (
    <Breadcrumb>
      <BreadcrumbLink to="/admin">← Admin</BreadcrumbLink>
      <BreadcrumbSeparator />
      <span>{children}</span>
    </Breadcrumb>
  );
}

export function AdminHome() {
  const { words, categories } = wordData();
  const verbs = kaVerbData().verbs;
  const stories = storySummaries();
  const shelves = storyCategories();
  const chapters = stories.reduce((total, story) => total + story.chapters.length, 0);

  const needsCheck = words.filter(word => word.check).length;
  const withForms = words.filter(word => word.forms?.length).length;

  return (
    <AdminPage>
      <Breadcrumb>
        <BreadcrumbLink to="/">← Home</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>Admin</span>
      </Breadcrumb>

      <AdminHead>
        <AdminTitle>Editing the dictionary</AdminTitle>
        <AdminSub>
          Every change here is live the moment it saves: the content version moves, this browser re-fetches,
          and every other one does on its next visit.
        </AdminSub>
      </AdminHead>

      <div className="mb-8 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <HubCard to="/admin/words" icon={Type} title="Words" count={words.length}>
          {categories.length} categories · {withForms} with inflected forms · {needsCheck} flagged for checking
        </HubCard>
        <HubCard to="/admin/verbs" icon={Table} title="Verbs" count={verbs.length}>
          Paradigms and all 66 cells of each
        </HubCard>
        <HubCard to="/admin/stories" icon={MessageCircle} title="Stories" count={stories.length}>
          {chapters} chapters · paste prose in and it links itself against the lexicon
        </HubCard>
        <HubCard to="/admin/story-categories" icon={Library} title="Story categories" count={shelves.length}>
          The headings the story index groups by
        </HubCard>
        <HubCard to="/admin/users" icon={Users} title="Admins" count="—">
          Who else may edit all of this
        </HubCard>
      </div>

      <AdminSection>
        <AdminSectionTitle>Where the data lives now</AdminSectionTitle>
        <AdminNote className="mb-0">
          The database is the source of truth for content, not <code>data/*.json</code>. After editing here,
          <code> npm run db:export</code> writes it back out to those files so the authoring scripts have
          something current to work from, and <code>npm run db:seed</code> will refuse to overwrite these
          edits with the older files unless it is given <code>--force</code>.
        </AdminNote>
      </AdminSection>
    </AdminPage>
  );
}

function HubCard({
  to,
  icon: Icon,
  title,
  count,
  children,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  title: string;
  count: number | string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="rounded-lg border border-border bg-card p-5 text-muted-foreground shadow-card transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-primary"
    >
      <Icon className="size-[22px]" aria-hidden={true} />
      <h2 className="mt-2.5 mb-0.5 text-[15px] font-bold text-foreground">{title}</h2>
      <p className="text-[26px] leading-tight font-bold text-foreground">{count}</p>
      <p className="mt-1 text-[12.5px] leading-normal">{children}</p>
    </Link>
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
    <AdminPage>
      <AdminCrumb>Words</AdminCrumb>

      <AdminHeadRow>
        <AdminTitle>Words</AdminTitle>
        <Button variant="control" size="auto" className={KNOW_BUTTON} asChild>
          <Link to="/admin/words/new">
            <Type /> New word
          </Link>
        </Button>
      </AdminHeadRow>

      <div className="mb-6 flex flex-wrap items-center gap-4 max-md:flex-col max-md:*:w-full">
        <SearchField
          placeholder="Search Georgian or English…"
          value={term}
          onChange={event => setTerm(event.target.value)}
        />
        {/* An empty string is not a legal Radix Select value — it is how it says "nothing is
            chosen" — so "every category" travels as a sentinel and is mapped at the edges. */}
        <Select value={category || ALL} onValueChange={value => setCategory(value === ALL ? '' : value)}>
          <SelectTrigger className="h-auto w-auto min-w-40 rounded-sm border border-border-strong bg-background py-2.5 text-sm shadow-none data-[size=default]:h-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Every category</SelectItem>
            {categories.map(item => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <AdminCheck className="my-0 mb-0">
          <Checkbox checked={flaggedOnly} onCheckedChange={value => setFlaggedOnly(value === true)} />
          Only ones flagged for checking
        </AdminCheck>
      </div>

      <AdminCountLine>
        {shown.length === words.length ? `${words.length} entries` : `${shown.length} shown of ${words.length}`}
      </AdminCountLine>

      <AdminRows>
        {shown.map(word => (
          <li key={word.id}>
            <Link
              to={`/admin/words/${encodeURIComponent(word.id)}`}
              className={cn(ADMIN_ROW_LINK, ADMIN_ROW_LINK_HOVER)}
            >
              <AdminRowGeo>{word.headword}</AdminRowGeo>
              <AdminRowEn>{word.english}</AdminRowEn>
              <AdminRowMeta>
                {word.senses.length > 1 && <AdminBadge>{word.senses.length} senses</AdminBadge>}
                {word.forms?.length ? <AdminBadge>{word.forms.length} forms</AdminBadge> : null}
                {word.verbId && <AdminBadge>paradigm</AdminBadge>}
                {word.check && <AdminBadge flagged>check</AdminBadge>}
                <LevelBadge level={word.level} />
              </AdminRowMeta>
            </Link>
          </li>
        ))}
      </AdminRows>
    </AdminPage>
  );
}

const ALL = '__all__';

/* -------------------------------------------------------------------- verbs */

export function VerbList() {
  const verbs = kaVerbData().verbs;
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
    <AdminPage>
      <AdminCrumb>Verbs</AdminCrumb>

      <AdminHeadRow>
        <AdminTitle>Verbs</AdminTitle>
        <Button variant="control" size="auto" className={KNOW_BUTTON} asChild>
          <Link to="/admin/verbs/new">
            <Table /> New paradigm
          </Link>
        </Button>
      </AdminHeadRow>

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <SearchField
          placeholder="Search English or Georgian…"
          value={term}
          onChange={event => setTerm(event.target.value)}
        />
      </div>

      <AdminCountLine>
        {shown.length === verbs.length ? `${verbs.length} paradigms` : `${shown.length} shown of ${verbs.length}`}
      </AdminCountLine>

      <AdminRows>
        {shown.map(verb => (
          <li key={verb.id}>
            <Link
              to={`/admin/verbs/${encodeURIComponent(verb.id)}`}
              className={cn(ADMIN_ROW_LINK, ADMIN_ROW_LINK_HOVER)}
            >
              <AdminRowGeo>{verb.present3sg || verb.verbalNoun}</AdminRowGeo>
              <AdminRowEn>{verb.english}</AdminRowEn>
              <AdminRowMeta>
                {verb.transitivity && <AdminBadge>{verb.transitivity}</AdminBadge>}
                {verb.group && <AdminBadge>{verb.group}</AdminBadge>}
                <AdminBadge>{Object.keys(verb.forms).length} screeves</AdminBadge>
              </AdminRowMeta>
            </Link>
          </li>
        ))}
      </AdminRows>
    </AdminPage>
  );
}

/* ------------------------------------------------------------------ stories */

export function StoryList() {
  const stories = storySummaries();

  return (
    <AdminPage>
      <AdminCrumb>Stories</AdminCrumb>

      <AdminHeadRow>
        <AdminTitle>Stories</AdminTitle>
        <Button variant="control" size="auto" className={KNOW_BUTTON} asChild>
          <Link to="/admin/stories/new">
            <MessageCircle /> New story
          </Link>
        </Button>
      </AdminHeadRow>

      {stories.length === 0 && (
        <p className="py-6 text-center text-muted-foreground">
          No stories yet. Paste one in and it will link itself.
        </p>
      )}

      <AdminRows>
        {stories.map(story => (
          <li key={story.id}>
            <Link
              to={`/admin/stories/${encodeURIComponent(story.id)}`}
              className={cn(ADMIN_ROW_LINK, ADMIN_ROW_LINK_HOVER)}
            >
              <AdminRowGeo>{story.title}</AdminRowGeo>
              <AdminRowEn>{story.titleEnglish}</AdminRowEn>
              <AdminRowMeta>
                {story.level && <LevelBadge level={story.level} />}
                {story.category && <AdminBadge>{story.category}</AdminBadge>}
                {/* Flagged when there are none, because a story with no chapters has nothing
                    to read and is the one state this list should make obvious. */}
                <AdminBadge flagged={story.chapters.length === 0}>
                  {story.chapters.length} chapter(s)
                </AdminBadge>
                <AdminBadge>{story.stats.tokens} words</AdminBadge>
                <AdminBadge flagged={story.stats.coverage < 90}>{story.stats.coverage}% linked</AdminBadge>
                {story.stats.unresolved > 0 && (
                  <AdminBadge flagged>{story.stats.unresolved} unresolved</AdminBadge>
                )}
                {story.translated && <AdminBadge>translated</AdminBadge>}
              </AdminRowMeta>
            </Link>
          </li>
        ))}
      </AdminRows>
    </AdminPage>
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
    <AdminPage>
      <AdminCrumb>Admins</AdminCrumb>

      <AdminHead>
        <AdminTitle>Who may edit</AdminTitle>
        <AdminSub>
          An admin may add, change and delete every word, paradigm and story. There is no way back into an
          installation with no admins except a shell on the host, so the last one cannot be removed here.
        </AdminSub>
        <AdminSub>
          Accounts are listed by username. Email addresses are not shown — not partially, not to admins —
          and the server does not send them, so there is nothing here to reveal.
        </AdminSub>
      </AdminHead>

      {error && <AdminError>{error}</AdminError>}
      {users === null && <AdminHint>Loading accounts…</AdminHint>}

      {users !== null && (
        <AdminRows>
          {users.map(user => (
            <li key={user.id}>
              <div className={ADMIN_ROW_LINK}>
                <AdminRowGeo className="text-[14.5px] font-normal">{user.name}</AdminRowGeo>
                {/* The username, and nothing else about who they are. There is no address
                    here to show: `admin.users` does not send one. The join date is what
                    separates two people who picked the same name. */}
                <AdminRowEn>joined {joined(user.createdAt)}</AdminRowEn>
                <AdminRowMeta>
                  {user.id === me && <AdminBadge>you</AdminBadge>}
                  {user.isAdmin && <AdminBadge admin>admin</AdminBadge>}
                  <Button
                    type="button"
                    variant={user.isAdmin ? 'dangerOutline' : 'control'}
                    size="auto"
                    disabled={busy || user.id === me}
                    title={user.id === me ? 'You cannot change your own access.' : undefined}
                    onClick={() => toggle(user)}
                  >
                    {user.isAdmin ? 'Remove admin' : 'Make admin'}
                  </Button>
                </AdminRowMeta>
              </div>
            </li>
          ))}
        </AdminRows>
      )}
    </AdminPage>
  );
}

export default AdminHome;
