// Every Russian verb, filterable by the thing that actually distinguishes them.
//
// Its Georgian counterpart filters by conjugation group, because that is the axis the
// spreadsheet gives. Here the first question is always aspect — делать and сделать are two
// entries and a learner needs to see which is which before anything else — and the second is
// the conjugation, in whichever of the two depths they want it. Same two-tier choice the verb
// page makes, and for the same reason: 1st/2nd is what you need to conjugate, and Zaliznyak's
// sixteen are what explain why.
//
// The chrome — breadcrumb, header, toolbar, card rows — is the word and verb indexes', so a
// reader who switches dictionaries lands on a page they already know how to read. Only the
// columns differ, because a Russian row carries one headword and an aspect where a Georgian
// one carries two forms: the space that buys goes to the aspect, which decides everything else.

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { RU_CLASSES, RU_CONJUGATIONS } from '@georgian/shared/grammar/ru';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from '@/components/ui/page';
import { Pagination, usePagination } from '@/components/ui/pagination';
import { SearchField } from '@/components/ui/search-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { lang, ruVerbData } from '../content/store';
import { useEntryState } from '../utils/entryState';
import { VERB_HEAD, VERB_ROW } from './VerbList';

type Grouping = 'conjugation' | 'class';
type Aspect = 'all' | 'impf' | 'pf';

/** The aspect filter wears the colours the tags do, so the control and the rows it narrows
    say the same thing. */
const ASPECTS: { id: Aspect; label: string; on: string }[] = [
  { id: 'all', label: 'Both', on: 'bg-primary text-white' },
  { id: 'impf', label: 'Imperfective', on: 'bg-[#3b82f6] text-white' },
  { id: 'pf', label: 'Perfective', on: 'bg-[#a855f7] text-white' },
];

/** The Russian row: one headword where a Georgian one carries two, and an aspect column. */
const ROW_GRID =
  'grid grid-cols-[76px_minmax(0,1.1fr)_minmax(0,1.7fr)_112px_24px] items-center gap-4 ' +
  // Headword and aspect on one line, English and conjugation beneath — the same fold the
  // Georgian index makes.
  'max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3 max-md:gap-y-1';

export default function RuVerbList() {
  // Remembered per history entry, like the Georgian index's: opening a verb and coming back
  // to page 1 of every verb, rather than the page of the handful you had narrowed to, loses
  // your place however carefully the scroll position is restored.
  const [search, setSearch] = useEntryState('search', '');
  const [aspect, setAspect] = useEntryState<Aspect>('aspect', 'all');
  const [grouping, setGrouping] = useEntryState<Grouping>('grouping', 'conjugation');
  const [group, setGroup] = useEntryState('group', 'all');

  const all = ruVerbData().verbs;

  // Which bucket each verb falls in under the current depth. Recomputed rather than stored,
  // because switching depth must not lose the list — only re-label it.
  const bucketOf = useMemo(() => {
    const conjugationOf = new Map(RU_CLASSES.map(cls => [cls.id, cls.conjugation]));
    return (classId: string) => (grouping === 'class' ? classId : (conjugationOf.get(classId as never) ?? 'mixed'));
  }, [grouping]);

  const buckets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const verb of all) {
      const key = bucketOf(verb.classId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return grouping === 'class'
      ? RU_CLASSES.filter(cls => counts.has(cls.id)).map(cls => ({
          id: cls.id,
          label: `Class ${cls.id} — ${cls.label}`,
          count: counts.get(cls.id) ?? 0,
        }))
      : RU_CONJUGATIONS.filter(entry => counts.has(entry.id)).map(entry => ({
          id: entry.id,
          label: entry.label,
          count: counts.get(entry.id) ?? 0,
        }));
  }, [all, bucketOf, grouping]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter(verb => {
      if (aspect !== 'all' && verb.aspect !== aspect) return false;
      if (group !== 'all' && bucketOf(verb.classId) !== group) return false;
      if (!needle) return true;
      return verb.infinitive.includes(needle) || verb.english.toLowerCase().includes(needle);
    });
  }, [all, search, aspect, group, bucketOf]);

  const pager = usePagination(shown, `${search}|${aspect}|${grouping}|${group}`);

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
          Г
        </span>
        <div>
          <h1 className="mb-1 text-[28px] font-bold">Verbs</h1>
          <p className="text-sm text-faint">глаголы</p>
          <span className="font-medium text-primary">{shown.length} verbs</span>
        </div>
      </div>

      <p className="mb-5 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
        Each verb stores a conjugation rule rather than a table of forms — open any of them to
        see the full paradigm.
      </p>

      <div className="mb-6 flex flex-wrap items-center gap-4 max-md:flex-col max-md:*:w-full">
        <SearchField
          placeholder="Filter verbs…"
          value={search}
          onChange={event => setSearch(event.target.value)}
        />

        <div
          className="flex gap-1 rounded-sm border-2 border-border bg-card p-1"
          role="group"
          aria-label="Aspect"
        >
          {ASPECTS.map(option => (
            <button
              key={option.id}
              type="button"
              className={cn(
                'cursor-pointer rounded-[6px] px-4 py-1.5 text-sm font-medium transition-all',
                aspect === option.id ? option.on : 'text-muted-foreground hover:bg-muted',
              )}
              aria-pressed={aspect === option.id}
              onClick={() => setAspect(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className={GROUP_LABEL}>Group by</span>
          <Select
            value={grouping}
            onValueChange={value => {
              setGrouping(value as Grouping);
              // The buckets change entirely, so the selected one no longer means anything.
              setGroup('all');
            }}
          >
            <SelectTrigger className={GROUP_TRIGGER}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="conjugation">Conjugation (2)</SelectItem>
              <SelectItem value="class">Zaliznyak class (16)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className={GROUP_LABEL}>Group</span>
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger className={GROUP_TRIGGER}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({all.length})</SelectItem>
              {buckets.map(bucket => (
                <SelectItem key={bucket.id} value={bucket.id}>
                  {bucket.label} ({bucket.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className={cn(ROW_GRID, VERB_HEAD)}>
          <span>Aspect</span>
          <span>Infinitive</span>
          <span>English</span>
          <span>{grouping === 'class' ? 'Class' : 'Conjugation'}</span>
        </div>

        {pager.items.map(verb => (
          <Link
            key={verb.id}
            to={`/${lang()}/verbs/${verb.id}`}
            className={cn(ROW_GRID, VERB_ROW, 'group')}
          >
            <span className="max-md:col-start-2 max-md:row-start-1 max-md:justify-self-end">
              <AspectTag aspect={verb.aspect} />
            </span>
            <span className="text-[17px] font-semibold max-md:col-start-1 max-md:row-start-1" lang="ru">
              {verb.accented || verb.infinitive}
            </span>
            <span className="text-[15px] text-muted-foreground">{verb.english}</span>
            <span className="text-[13px] whitespace-nowrap text-faint max-md:col-span-full">
              {grouping === 'class' ? `class ${verb.classId}` : conjugationLabel(verb.classId)}
            </span>
            <ArrowRight
              className="size-[18px] text-faint group-hover:text-primary max-md:hidden"
              aria-hidden="true"
            />
          </Link>
        ))}

        {shown.length === 0 && <p className="py-6 text-center text-muted-foreground">No verbs match that filter.</p>}
      </div>

      <Pagination pager={pager} noun="verbs" />
    </Page>
  );
}

const GROUP_LABEL = 'text-sm font-semibold text-muted-foreground';
const GROUP_TRIGGER =
  'h-auto max-w-[340px] rounded-sm border-2 border-border bg-card py-2.5 text-sm shadow-none data-[size=default]:h-auto max-md:max-w-none max-md:flex-1';

/**
 * Aspect is the fact the whole page turns on, so it is the one tag that carries colour.
 *
 * `label` is how the two screens differ: the index abbreviates it to fit a 76px column, the
 * verb's own page spells it out because there it is the first thing to read.
 */
export function AspectTag({ aspect, label }: { aspect: string; label?: string }) {
  return (
    <span
      className={cn(
        'rounded-full border px-2.5 py-[3px] text-[0.78rem]',
        aspect === 'pf' ? 'border-[#a855f7] text-[#a855f7]' : 'border-[#3b82f6] text-[#3b82f6]',
      )}
    >
      {label ?? (aspect === 'pf' ? 'pf' : 'impf')}
    </span>
  );
}

const CONJUGATION_OF = new Map(RU_CLASSES.map(cls => [cls.id, cls.conjugation]));

function conjugationLabel(classId: string): string {
  const which = CONJUGATION_OF.get(classId as never);
  return which === '1' ? '1st conj.' : which === '2' ? '2nd conj.' : 'irregular';
}
