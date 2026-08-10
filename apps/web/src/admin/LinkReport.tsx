// What linking managed, and what it did not.
//
// Two lists, and they call for different things. An unresolved spelling is usually a word the
// dictionary does not have — or a proper noun, which is not a dictionary word and never will
// be. A flagged one did resolve, by a guess, and wants a read-through. Both are fixed on the
// word itself in the reader, which is where the sentence is.
//
// Its own module because two screens produce one: saving a chapter reports on that chapter,
// and relinking a story reports on all of them at once.

import { Link } from 'react-router-dom';
import type { StoryLinkResult } from '@georgian/shared/contract';
import { cn } from '@/lib/utils';
import { chapterHref } from '../utils/story';
import { AdminHint, AdminNote, AdminSection, AdminSectionTitle } from './ui';

export function LinkReport({ result }: { result: StoryLinkResult }) {
  const { story, unresolved, flagged } = result;
  const stats = story.chapters.find(entry => entry.position === story.chapter)?.stats ?? story.stats;

  return (
    <AdminSection>
      <AdminSectionTitle>
        How it linked
        {story.chapters.length > 1 && (
          <span className="ml-2 text-sm font-normal text-faint">chapter {story.chapter + 1}</span>
        )}
      </AdminSectionTitle>

      <div className="mb-4 flex flex-wrap gap-[18px]">
        <Stat value={`${stats.coverage}%`}>linked</Stat>
        <Stat value={stats.tokens}>words</Stat>
        <Stat value={stats.distinctForms}>spellings</Stat>
        <Stat value={stats.names}>names</Stat>
        <Stat value={stats.unresolved}>unresolved</Stat>
        <Stat value={stats.flagged}>guessed</Stat>
      </div>

      <AdminNote>
        Fix these in the reader, on the word itself —{' '}
        <Link to={chapterHref(story.id, story.chapter)}>open it</Link> and turn on Edit links. A proper noun
        is named there and stays out of the dictionary; a missing word is added to the lexicon and every
        story that uses it picks it up on the next relink.
      </AdminNote>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-5">
        <TagList title="Nothing matched" items={unresolved} empty="Every word resolved." />
        <TagList title="Reached by a guess" items={flagged} empty="Nothing was guessed." flagged />
      </div>
    </AdminSection>
  );
}

function Stat({ value, children }: { value: number | string; children: React.ReactNode }) {
  return (
    <span className="text-[13px] text-muted-foreground">
      <strong className="block text-xl text-foreground">{value}</strong>
      {children}
    </span>
  );
}

/** One of the two lists of spellings, capped so a badly linked story does not fill the page. */
function TagList({
  title,
  items,
  empty,
  flagged = false,
}: {
  title: string;
  items: { form: string; count: number }[];
  empty: string;
  flagged?: boolean;
}) {
  return (
    <div>
      <h3 className="mb-2 text-[13px] font-bold">
        {title} ({items.length})
      </h3>
      {items.length === 0 ? (
        <AdminHint>{empty}</AdminHint>
      ) : (
        <ul className="flex list-none flex-wrap gap-1.5">
          {items.slice(0, 60).map(item => (
            <li
              key={item.form}
              className={cn(
                'flex items-baseline gap-[5px] rounded-full px-[9px] py-[3px] text-sm',
                flagged ? 'bg-[color-mix(in_srgb,var(--m-3)_20%,transparent)]' : 'bg-muted',
              )}
            >
              <span className="text-base">{item.form}</span>
              {item.count > 1 && <span className="text-[11px] text-faint">{item.count}</span>}
            </li>
          ))}
          {items.length > 60 && <AdminHint>…and {items.length - 60} more</AdminHint>}
        </ul>
      )}
    </div>
  );
}
