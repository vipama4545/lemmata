import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Eye, EyeOff } from 'lucide-react';
import type { ImperativeForms, Screeve, ScreeveKey, KaVerb, KaVerbMorphemes } from '@georgian/shared/types';
import { PERSONS as persons, SCREEVES as screeves, SERIES as series } from '@georgian/shared/grammar/ka';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MORPHEME_CLASS } from '@/components/ui/morpheme';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, NAV_LINK, Page } from '@/components/ui/page';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { kaVerbData, lang, morphemeData } from '../content/store';
import { MORPHEME_PARTS, segmentForm } from '../utils/verbMorphology';

// The persons, screeves and series are constants rather than anything fetched, so the table
// they key can be built here at module scope as it always was. The paradigms themselves
// arrive with the dictionary, and are read inside the component.
const screeveByKey = Object.fromEntries(
  screeves.map(s => [s.key, s]),
) as Record<ScreeveKey, Screeve>;

/** Georgian is set a size larger and heavier than the English beside it — at matching sizes
    the letterforms read as too light. */
const KA = 'text-base font-semibold';
const SECTION_TITLE = 'mb-2.5 text-[15px] font-semibold text-muted-foreground';

/** One row of a conjugation table: a screeve (or the imperative) across the persons. */
interface ConjugationRow {
  key: string;
  label: string;
  forms: ImperativeForms;
}

// One verb's whole paradigm: every screeve the spreadsheet fills in, across all six
// persons, laid out a table per tense series. The imperative and prohibitive get their
// own table because they only exist for five of the persons.
function VerbDetail() {
  const { verbId } = useParams();
  const [highlight, setHighlight] = useState(() => localStorage.getItem('verbMorphemes') !== 'off');

  useEffect(() => {
    localStorage.setItem('verbMorphemes', highlight ? 'on' : 'off');
  }, [highlight]);

  const { groups, verbs } = kaVerbData();

  const { verb, index } = useMemo(() => {
    const i = verbs.findIndex(v => v.id === verbId);
    // findIndex returns -1 for an unknown id, so this really can come back empty.
    return { verb: verbs[i] as KaVerb | undefined, index: i };
  }, [verbId, verbs]);

  const lex = verbId ? morphemeData().verbs[verbId] : undefined;

  if (!verb) {
    return (
      <Page>
        <div className="py-10 text-center">
          <h2 className="mb-2 text-2xl font-bold">Verb not found</h2>
          <Link to={`/${lang()}/verbs`} className="text-primary hover:underline">← Back to verbs</Link>
        </div>
      </Page>
    );
  }

  const group = groups.find(g => g.id === verb.groupId);
  const previous: KaVerb | undefined = verbs[index - 1];
  const next: KaVerb | undefined = verbs[index + 1];

  return (
    <Page>
      <Breadcrumb>
        <BreadcrumbLink to={`/${lang()}/categories`}>← Categories</BreadcrumbLink>
        <BreadcrumbSeparator />
        <BreadcrumbLink to={`/${lang()}/verbs`}>Verbs</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>{verb.english}</span>
      </Breadcrumb>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[34px] leading-tight font-bold max-md:text-[28px]">
            {verb.verbalNoun || verb.english}
          </h1>
          <p className="mt-1 text-[17px] text-muted-foreground">
            {verb.english}
            {verb.transitivity && <em className="text-[13px] text-faint"> {verb.transitivity}</em>}
          </p>
          {verb.senses.length > 0 && (
            <ul className="mt-2 ml-[18px] list-disc text-sm text-muted-foreground">
              {verb.senses.map((sense, i) => <li key={i}>{sense}</li>)}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {verb.group && <Badge variant="tagOutline" className="px-3 py-1 text-[13px]">{verb.group}</Badge>}
          {group && <span className="text-sm text-muted-foreground">{group.name}</span>}
        </div>
      </div>

      {lex && <MorphemeKey lex={lex} highlight={highlight} onToggle={() => setHighlight(h => !h)} />}

      {group && group.notes.length > 0 && (
        <details className="mb-6 rounded-sm border border-border bg-card px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold">About {group.label} {group.name}</summary>
          <ul className="mt-3 ml-5 flex list-disc flex-col gap-2 text-sm whitespace-pre-line text-muted-foreground">
            {group.notes.map((note, i) => <li key={i}>{note}</li>)}
          </ul>
        </details>
      )}

      {series.map(block => {
        // A defective paradigm simply has fewer rows; the series drops out when it has none.
        const rows: ConjugationRow[] = block.screeves.flatMap(key => {
          const forms = verb.forms[key];
          return forms ? [{ key, label: screeveByKey[key].label, forms }] : [];
        });
        if (rows.length === 0) return null;
        return (
          <section key={block.id} className="mb-7">
            <h2 className={SECTION_TITLE}>{block.label}</h2>
            <ConjugationTable rows={rows} lex={highlight ? lex : null} />
          </section>
        );
      })}

      {(verb.imperative || verb.prohibitive) && (
        <section className="mb-7">
          <h2 className={SECTION_TITLE}>Imperative</h2>
          <ConjugationTable
            rows={[
              verb.imperative && { key: 'imperative', label: 'Affirmative', forms: verb.imperative },
              verb.prohibitive && { key: 'prohibitive', label: 'Prohibitive', forms: verb.prohibitive },
            ].filter((row): row is ConjugationRow => row !== null)}
            lex={highlight ? lex : null}
          />
        </section>
      )}

      {(verb.synonymsEnglish.length > 0 || verb.synonymsGeorgian.length > 0) && (
        <section className="mb-7">
          <h2 className={SECTION_TITLE}>Synonyms</h2>
          {verb.synonymsGeorgian.length > 0 && (
            <p className="flex items-baseline gap-3 py-1.5">
              <span className={SYNONYM_LABEL}>Georgian</span>
              <span className={KA}>{verb.synonymsGeorgian.join(' · ')}</span>
            </p>
          )}
          {verb.synonymsEnglish.length > 0 && (
            <p className="flex items-baseline gap-3 py-1.5">
              <span className={SYNONYM_LABEL}>English</span>
              <span>{verb.synonymsEnglish.join(' · ')}</span>
            </p>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
        <div className="flex flex-wrap gap-4">
          {previous && (
            <Link to={`/${lang()}/verbs/${previous.id}`} className={NAV_LINK}>
              <ArrowLeft className="size-[18px]" aria-hidden="true" /> {previous.english}
            </Link>
          )}
          {next && (
            <Link to={`/${lang()}/verbs/${next.id}`} className={NAV_LINK}>
              {next.english} <ArrowRight className="size-[18px]" aria-hidden="true" />
            </Link>
          )}
        </div>
        {verb.url && (
          <a
            className="text-sm text-primary underline underline-offset-2"
            href={verb.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on lingua.ge
          </a>
        )}
      </div>
    </Page>
  );
}

const SYNONYM_LABEL = 'min-w-20 text-xs tracking-[0.04em] text-faint uppercase';

// The verb's own morphemes, plus the colour key for the tables below. The parts are only
// listed here if this verb actually has them — plenty of verbs take no preverb and plenty
// take no version vowel.
function MorphemeKey({
  lex,
  highlight,
  onToggle,
}: {
  lex: KaVerbMorphemes;
  highlight: boolean;
  onToggle: () => void;
}) {
  const anatomy = [
    { part: 'root', label: 'Root', value: [lex.root, ...(lex.roots || [])].join(' · ') },
    { part: 'pfsf', label: 'PFSF', value: lex.pfsf },
    { part: 'preverb', label: 'Preverb', value: lex.preverbs?.join(' · ') },
    { part: 'version', label: 'Version', value: lex.version },
  ].filter(item => item.value);

  return (
    <section className="mb-6 rounded-sm border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {anatomy.map(item => (
            <span
              key={item.part}
              // The chip is tinted from its own text colour, so one class sets both.
              className={cn(
                'inline-flex items-baseline gap-1.5 rounded-full bg-[color-mix(in_srgb,currentColor_12%,transparent)] px-2.5 py-1',
                MORPHEME_CLASS[item.part as keyof typeof MORPHEME_CLASS],
              )}
            >
              <span className="text-[11px] font-bold tracking-[0.04em] uppercase">{item.label}</span>
              <span className="text-base font-semibold text-foreground">{item.value}</span>
            </span>
          ))}
        </div>
        <Button
          type="button"
          variant={highlight ? 'controlOn' : 'control'}
          size="auto-sm"
          onClick={onToggle}
          aria-pressed={highlight}
        >
          {highlight ? <Eye /> : <EyeOff />}
          Colour the parts
        </Button>
      </div>

      {/* Each slot gets its name in its own colour and a plain-language gloss beside it —
          the labels are jargon ("PFSF", "screeve") and the colour alone does not teach them. */}
      {highlight && (
        <ul className="mt-3 grid list-none grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-x-6 gap-y-2 border-t border-border pt-3 text-xs">
          {MORPHEME_PARTS.map(part => (
            <li key={part.key}>
              <span
                className={cn(
                  'font-bold',
                  "before:mr-1.5 before:inline-block before:size-2 before:rounded-full before:bg-current before:align-middle before:content-['']",
                  MORPHEME_CLASS[part.key as keyof typeof MORPHEME_CLASS],
                )}
              >
                {part.label}
              </span>
              <span className="text-muted-foreground before:content-['_—_']">{part.hint}</span>
            </li>
          ))}
        </ul>
      )}

      {highlight && lex.check && (
        <p className="mt-2.5 text-xs text-muted-foreground">
          This verb's stem is irregular, so the split below is a best guess — read it with
          an eye open.
        </p>
      )}
    </section>
  );
}

// One cell's form, cut into its morphemes. Without a lexicon entry — or with colouring
// switched off — it renders as plain text.
function VerbForm({
  form,
  lex,
  screeve,
}: {
  form: string;
  lex: KaVerbMorphemes | null | undefined;
  screeve: string;
}): ReactNode {
  if (!lex) return form;
  const { segments } = segmentForm(form, lex, screeve);
  return segments.map((segment, i) => (
    <span key={i} className={MORPHEME_CLASS[segment.part]}>
      {segment.text}
    </span>
  ));
}

// Screeves down the side, persons across the top. A cell the spreadsheet leaves blank
// shows a dash rather than collapsing, so the shape of a defective paradigm stays visible.
//
// Seven columns do not fit a phone, so the table scrolls inside its own box rather than
// pushing the page sideways.
function ConjugationTable({
  rows,
  lex,
}: {
  rows: ConjugationRow[];
  lex: KaVerbMorphemes | null | undefined;
}) {
  return (
    <Table containerClassName="rounded-sm border border-border bg-card" className="min-w-[720px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead scope="col" className={CONJ_HEAD} />
          {persons.map(person => (
            <TableHead key={person.key} scope="col" className={CONJ_HEAD}>
              <span className="block font-bold">{person.label}</span>
              <span className="block text-xs tracking-normal normal-case text-faint">{person.pronoun}</span>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(row => (
          <TableRow key={row.key} className="hover:bg-transparent">
            <TableHead scope="row" className="h-auto bg-muted px-3.5 py-2.5 text-[13px] font-semibold text-muted-foreground">
              {row.label}
            </TableHead>
            {persons.map(person => {
              const form = row.forms[person.key];
              return (
                <TableCell key={person.key} className={cn('px-3.5 py-2.5 text-base', !form && 'text-faint')}>
                  {form ? <VerbForm form={form} lex={lex} screeve={row.key} /> : '—'}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const CONJ_HEAD =
  'h-auto bg-muted px-3.5 py-2.5 text-[11px] tracking-[0.04em] text-faint uppercase align-top';

export default VerbDetail;
