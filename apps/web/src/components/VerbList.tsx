import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from '@/components/ui/page';
import { SearchField } from '@/components/ui/search-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { kaVerbData, lang } from '../content/store';
import { useEntryState } from '../utils/entryState';

/**
 * The index shares the shape of the word list, but every row carries two Georgian forms —
 * the verbal noun and the third person singular — so it is laid out on a grid with named
 * columns instead of the word card's free-flowing flex row.
 *
 * On a phone it drops to two columns: headword and third person, with the English
 * underneath rather than beside them.
 */
const ROW_GRID =
  'grid grid-cols-[92px_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1.6fr)_24px] items-center gap-4 ' +
  'max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-1';

/** Exported for the Russian index, which re-columns the same row. */
export const VERB_ROW =
  'rounded-sm border border-border bg-card px-4 py-3 text-inherit transition-all hover:border-primary hover:shadow-card ' +
  // The index is one unpaginated list of every verb, so rows scrolled out of view skip
  // layout and paint. The size hint keeps the scrollbar honest.
  '[content-visibility:auto] [contain-intrinsic-size:auto_49px]';

export const VERB_HEAD =
  'px-4 pb-1 text-[11px] font-semibold tracking-[0.04em] text-faint uppercase max-md:hidden';

// The verb index. Verbs are listed by their verbal noun — the form a dictionary would
// use as the headword — next to the third person singular of the present, which is the
// form you actually meet in a sentence. Everything else lives on the verb's own page.
function VerbList() {
  // The filters are remembered per history entry: opening a verb and coming back to a list
  // of all 1,300 rather than the six you had narrowed it to loses your place even when the
  // scroll position is restored exactly.
  const [search, setSearch] = useEntryState('search', '');
  const [groupId, setGroupId] = useEntryState('group', 'all');
  const [showTranslation, setShowTranslation] = useState(true);

  const filteredVerbs = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return kaVerbData().verbs.filter(verb => {
      if (groupId !== 'all' && verb.groupId !== groupId) return false;
      if (!needle) return true;
      return (
        verb.english.toLowerCase().includes(needle) ||
        verb.verbalNoun.includes(needle) ||
        verb.present3sg.includes(needle) ||
        verb.synonymsEnglish.some(s => s.toLowerCase().includes(needle)) ||
        verb.synonymsGeorgian.some(s => s.includes(needle))
      );
    });
  }, [search, groupId]);

  return (
    <Page>
      <Breadcrumb>
        <BreadcrumbLink to={`/${lang()}/categories`}>← Categories</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>Verbs</span>
      </Breadcrumb>

      <div className="mb-6 flex items-center gap-4.5">
        <span
          className="flex aspect-square w-18 flex-none items-center justify-center rounded-sm bg-primary-light text-[30px] font-semibold text-faint"
          aria-hidden="true"
        >
          ზ
        </span>
        <div>
          <h1 className="mb-1 text-[28px] font-bold">Verbs</h1>
          <p className="text-sm text-faint">ზმნები</p>
          <span className="font-medium text-primary">{filteredVerbs.length} verbs</span>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-4 max-md:flex-col max-md:*:w-full">
        <SearchField
          placeholder="Filter verbs…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-muted-foreground">Group</span>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger className="h-auto max-w-[340px] rounded-sm border-2 border-border bg-card py-2.5 text-sm shadow-none data-[size=default]:h-auto max-md:max-w-none max-md:flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All groups ({kaVerbData().verbs.length})</SelectItem>
              {kaVerbData().groups.map(group => (
                <SelectItem key={group.id} value={group.id}>
                  {group.label} — {group.name} ({group.verbCount})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="control" size="auto" onClick={() => setShowTranslation(!showTranslation)}>
          {showTranslation ? <EyeOff /> : <Eye />}
          {showTranslation ? 'Hide translations' : 'Show translations'}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <div className={cn(ROW_GRID, VERB_HEAD)}>
          <span>Group</span>
          <span>Verbal noun</span>
          <span>3rd person sg. present</span>
          <span>English</span>
        </div>

        {filteredVerbs.map(verb => (
          <Link key={verb.id} to={`/${lang()}/verbs/${verb.id}`} className={cn(ROW_GRID, VERB_ROW, 'group')}>
            <span className="max-md:col-span-full">
              <Badge variant="tagOutline">{verb.group || '—'}</Badge>
            </span>
            <span className="text-[17px] font-semibold">{verb.verbalNoun || '—'}</span>
            <span className="text-[17px] font-semibold text-muted-foreground">{verb.present3sg || '—'}</span>
            <span className="text-[15px] text-muted-foreground max-md:col-span-full">
              {showTranslation && (
                <>
                  {verb.english}
                  {verb.transitivity && <em className="text-[13px] text-faint"> {verb.transitivity}</em>}
                </>
              )}
            </span>
            <ArrowRight
              className="size-[18px] text-faint group-hover:text-primary max-md:hidden"
              aria-hidden="true"
            />
          </Link>
        ))}

        {filteredVerbs.length === 0 && (
          <p className="py-6 text-center text-muted-foreground">No verbs match that filter.</p>
        )}
      </div>
    </Page>
  );
}

export default VerbList;
