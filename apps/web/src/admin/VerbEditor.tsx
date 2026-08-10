// Adding and editing a paradigm: the metadata, and all 66 cells of the conjugation table.
//
// The grid is the whole screen and it is laid out the way the verb pages read one — a row per
// screeve, six columns for the persons, grouped by series. Anyone correcting a paradigm is
// looking at a spreadsheet or a textbook laid out that way, and a form that is one row down
// from where the eye expects it is a form that gets typed into the wrong cell.
//
// A blank cell is kept, not dropped. A screeve listing all six persons with three of them
// blank is a paradigm the source has a gap in; a screeve with no cells at all is one that does
// not inflect for them. Those are different claims and the reader shows them differently, so
// clearing a cell and deleting a screeve are two different actions here as well.

import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { KaVerbInput } from '@georgian/shared/contract';
import { PERSONS, SCREEVES, SERIES } from '@georgian/shared/grammar/ka';
import type { PersonKey, ScreeveKey, KaVerb } from '@georgian/shared/types';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from '@/components/ui/page';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { KNOW_BUTTON } from '../components/StoryReader';
import { api } from '../api/client';
import { kaVerbData } from '../content/store';
import {
  ADMIN_INPUT_GEO,
  AdminActions,
  AdminError,
  AdminField,
  AdminGrid,
  AdminHead,
  AdminHint,
  AdminInput,
  AdminLabel,
  AdminNote,
  AdminPage,
  AdminSection,
  AdminSectionTitle,
  AdminSub,
  AdminTextarea,
  AdminTitle,
} from './ui';
import { useEdit } from './useAdmin';

type Cells = Record<string, Record<string, string>>;

interface Draft {
  english: string;
  senses: string;
  transitivity: string;
  verbalNoun: string;
  groupId: string;
  present3sg: string;
  url: string;
  synonymsEnglish: string;
  synonymsGeorgian: string;
  forms: Cells;
  imperative: Record<string, string>;
  prohibitive: Record<string, string>;
}

/** The persons the imperative and prohibitive have: you cannot command yourself. */
const COMMAND_PERSONS = PERSONS.filter(person => person.key !== '1sg');

function draftFrom(verb: KaVerb | null): Draft {
  if (!verb) {
    return {
      english: '',
      senses: '',
      transitivity: '',
      verbalNoun: '',
      groupId: '',
      present3sg: '',
      url: '',
      synonymsEnglish: '',
      synonymsGeorgian: '',
      forms: {},
      imperative: {},
      prohibitive: {},
    };
  }

  const forms: Cells = {};
  for (const [screeve, cells] of Object.entries(verb.forms)) {
    if (cells) forms[screeve] = { ...cells };
  }

  return {
    english: verb.english,
    // Lists go in and out as one-per-line text. A row of inputs with add and remove buttons
    // for something that is edited by pasting three lines is more chrome than the job needs.
    senses: verb.senses.join('\n'),
    transitivity: verb.transitivity,
    verbalNoun: verb.verbalNoun,
    groupId: verb.groupId,
    present3sg: verb.present3sg,
    url: verb.url,
    synonymsEnglish: verb.synonymsEnglish.join('\n'),
    synonymsGeorgian: verb.synonymsGeorgian.join('\n'),
    forms,
    imperative: { ...(verb.imperative ?? {}) },
    prohibitive: { ...(verb.prohibitive ?? {}) },
  };
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function VerbEditor() {
  const { verbId } = useParams<{ verbId: string }>();
  const navigate = useNavigate();
  const { verbs, groups } = kaVerbData();
  const { busy, error, run } = useEdit();

  const existing = useMemo(() => verbs.find(verb => verb.id === verbId) ?? null, [verbs, verbId]);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(existing));
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (verbId && !existing) {
    return (
      <Page>
        <Breadcrumb>
          <BreadcrumbLink to="/admin/verbs">← Verbs</BreadcrumbLink>
        </Breadcrumb>
        <p className="py-6 text-center text-muted-foreground">There is no paradigm with the id “{verbId}”.</p>
      </Page>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));

  const setCell = (screeve: string, person: string, value: string) =>
    setDraft(current => ({
      ...current,
      forms: { ...current.forms, [screeve]: { ...(current.forms[screeve] ?? {}), [person]: value } },
    }));

  const toggleScreeve = (screeve: string) =>
    setDraft(current => {
      const next = { ...current.forms };
      if (next[screeve]) delete next[screeve];
      // A screeve that exists holds all six persons, blank or not — that is the promise the
      // types make and the reader relies on.
      else next[screeve] = Object.fromEntries(PERSONS.map(person => [person.key, '']));
      return { ...current, forms: next };
    });

  const save = async () => {
    const payload: KaVerbInput = {
      ...(existing ? { id: existing.id } : {}),
      english: draft.english.trim(),
      senses: lines(draft.senses),
      transitivity: draft.transitivity.trim(),
      verbalNoun: draft.verbalNoun.trim(),
      groupId: draft.groupId || null,
      present3sg: draft.present3sg.trim(),
      url: draft.url.trim(),
      synonymsEnglish: lines(draft.synonymsEnglish),
      synonymsGeorgian: lines(draft.synonymsGeorgian),
      forms: draft.forms,
      imperative: draft.imperative,
      prohibitive: draft.prohibitive,
    };

    const result = await run(() => api.admin.saveKaVerb(payload));
    if (result) navigate(`/admin/verbs/${encodeURIComponent(result.id)}`, { replace: true });
  };

  const remove = async () => {
    if (!existing) return;
    const result = await run(() => api.admin.deleteVerb({ lang: 'ka', id: existing.id }));
    if (result) navigate('/admin/verbs', { replace: true });
  };

  const filled = Object.values(draft.forms).reduce(
    (total, cells) => total + Object.values(cells).filter(Boolean).length,
    0,
  );

  return (
    <AdminPage>
      <Breadcrumb>
        <BreadcrumbLink to="/admin/verbs">← Verbs</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>{existing ? existing.english : 'New paradigm'}</span>
      </Breadcrumb>

      <AdminHead>
        <AdminTitle>{existing ? existing.english : 'New paradigm'}</AdminTitle>
        {existing && (
          <AdminSub>
            <code>{existing.id}</code> · {filled} form(s) filled in
          </AdminSub>
        )}
      </AdminHead>

      {error && <AdminError>{error}</AdminError>}

      <AdminSection>
        <AdminSectionTitle>The verb</AdminSectionTitle>

        <AdminGrid>
          <AdminField>
            <AdminLabel>English</AdminLabel>
            <AdminInput
              value={draft.english}
              onChange={event => set('english', event.target.value)}
              placeholder="builds"
            />
            <AdminHint>A new paradigm’s id is slugged from this and never changes after.</AdminHint>
          </AdminField>

          <AdminField>
            <AdminLabel>Present 3sg</AdminLabel>
            <AdminInput
              className={ADMIN_INPUT_GEO}
              value={draft.present3sg}
              onChange={event => set('present3sg', event.target.value)}
              placeholder="აშენებს"
            />
          </AdminField>

          <AdminField>
            <AdminLabel>Verbal noun</AdminLabel>
            <AdminInput
              className={ADMIN_INPUT_GEO}
              value={draft.verbalNoun}
              onChange={event => set('verbalNoun', event.target.value)}
              placeholder="შენება"
            />
          </AdminField>

          <AdminField>
            <AdminLabel>Transitivity</AdminLabel>
            {/* A datalist rather than a Select: these three are the usual answers, not the
                only legal ones. */}
            <AdminInput
              list="admin-transitivity"
              value={draft.transitivity}
              onChange={event => set('transitivity', event.target.value)}
              placeholder="v.t."
            />
            <datalist id="admin-transitivity">
              <option value="v.t." />
              <option value="v.i." />
              <option value="v.t.i." />
            </datalist>
          </AdminField>

          <AdminField>
            <AdminLabel>Conjugation group</AdminLabel>
            {/* An empty string is not a legal Radix Select value, so "no group" travels as a
                sentinel and is mapped back at both edges. */}
            <Select
              value={draft.groupId || NO_GROUP}
              onValueChange={value => set('groupId', value === NO_GROUP ? '' : value)}
            >
              <SelectTrigger className={SELECT}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GROUP}>None</SelectItem>
                {groups.map(group => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.label} {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </AdminField>

          <AdminField>
            <AdminLabel>Source URL</AdminLabel>
            <AdminInput value={draft.url} onChange={event => set('url', event.target.value)} />
          </AdminField>
        </AdminGrid>

        <AdminGrid className="mb-0 grid-cols-[repeat(auto-fit,minmax(320px,1fr))]">
          <AdminField>
            <AdminLabel>Other senses</AdminLabel>
            <AdminTextarea
              rows={3}
              value={draft.senses}
              onChange={event => set('senses', event.target.value)}
              placeholder={'One per line.\nEach carries its own preverb where they differ.'}
            />
          </AdminField>

          <AdminField>
            <AdminLabel>English synonyms</AdminLabel>
            <AdminTextarea
              rows={3}
              value={draft.synonymsEnglish}
              onChange={event => set('synonymsEnglish', event.target.value)}
              placeholder="One per line."
            />
          </AdminField>

          <AdminField>
            <AdminLabel>Georgian synonyms</AdminLabel>
            <AdminTextarea
              className={ADMIN_INPUT_GEO}
              rows={3}
              value={draft.synonymsGeorgian}
              onChange={event => set('synonymsGeorgian', event.target.value)}
              placeholder="One per line."
            />
          </AdminField>
        </AdminGrid>
      </AdminSection>

      <AdminSection>
        <AdminSectionTitle>The paradigm</AdminSectionTitle>
        <AdminNote>
          A screeve that is switched off does not inflect at all; a screeve that is on with empty cells is one
          the source has a gap in. Those are different things and the reader shows them differently, so
          clearing a cell is not the same as switching a screeve off.
        </AdminNote>

        {SERIES.map(series => (
          <div key={series.id} className="mb-6">
            <h3 className={SERIES_TITLE}>
              Series {series.id} <span className={SERIES_LABEL}>{series.label}</span>
            </h3>

            {/* Seven columns do not fit a phone, so the table scrolls inside its own box
                rather than pushing the page sideways — the same treatment the verb pages
                give a paradigm. */}
            <div className={TABLE_SCROLL}>
              <table className={PARADIGM}>
                <thead>
                  <tr>
                    <th className={SCREEVE_CELL}>Screeve</th>
                    {PERSONS.map(person => (
                      <th key={person.key} className={PERSON_HEAD}>
                        <span className="block">{person.label}</span>
                        <span className="block text-xs font-normal text-faint">{person.pronoun}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SCREEVES.filter(screeve => series.screeves.includes(screeve.key)).map(screeve => {
                    const cells = draft.forms[screeve.key];
                    return (
                      <tr key={screeve.key}>
                        <th className={cn(SCREEVE_CELL, !cells && 'font-normal text-faint')}>
                          <label className="flex cursor-pointer items-start gap-2 text-[13px]">
                            <Checkbox
                              className="mt-0.5"
                              checked={Boolean(cells)}
                              onCheckedChange={() => toggleScreeve(screeve.key)}
                            />
                            <span>
                              {screeve.label}
                              <span className="block text-[11.5px] font-normal text-faint">{screeve.gloss}</span>
                            </span>
                          </label>
                        </th>
                        {PERSONS.map(person => (
                          <td key={person.key} className={CELL_WRAP}>
                            <input
                              className={CELL}
                              value={cells?.[person.key] ?? ''}
                              disabled={!cells}
                              onChange={event => setCell(screeve.key, person.key, event.target.value)}
                              aria-label={`${screeve.label} ${person.label}`}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        <div className="mb-6">
          <h3 className={SERIES_TITLE}>
            Commands <span className={SERIES_LABEL}>not screeves, and with no first person singular</span>
          </h3>

          <div className={TABLE_SCROLL}>
            <table className={PARADIGM}>
              <thead>
                <tr>
                  <th className={SCREEVE_CELL}>Form</th>
                  {COMMAND_PERSONS.map(person => (
                    <th key={person.key} className={PERSON_HEAD}>
                      <span className="block">{person.label}</span>
                      <span className="block text-xs font-normal text-faint">{person.pronoun}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(['imperative', 'prohibitive'] as const).map(kind => (
                  <tr key={kind}>
                    <th className={SCREEVE_CELL}>
                      {kind === 'imperative' ? 'Imperative' : 'Prohibitive'}
                      <span className="block text-[11.5px] font-normal text-faint">
                        {kind === 'imperative' ? 'do it' : 'do not do it'}
                      </span>
                    </th>
                    {COMMAND_PERSONS.map(person => (
                      <td key={person.key} className={CELL_WRAP}>
                        <input
                          className={CELL}
                          value={draft[kind][person.key] ?? ''}
                          onChange={event => set(kind, { ...draft[kind], [person.key]: event.target.value })}
                          aria-label={`${kind} ${person.label}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </AdminSection>

      <AdminActions>
        <Button
          variant="control"
          size="auto"
          className={KNOW_BUTTON}
          disabled={!draft.english.trim() || busy}
          onClick={save}
        >
          <Check /> {busy ? 'Saving…' : existing ? 'Save changes' : 'Create paradigm'}
        </Button>

        {existing && !confirmDelete && (
          <Button variant="dangerOutline" size="auto" disabled={busy} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        )}
        {existing && confirmDelete && (
          <span className="flex flex-wrap items-center gap-2.5 text-sm">
            Delete this paradigm?
            <Button variant="dangerOutline" size="auto" disabled={busy} onClick={remove}>
              Yes, delete
            </Button>
            <Button variant="control" size="auto" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </span>
        )}
      </AdminActions>
    </AdminPage>
  );
}

const NO_GROUP = '__none__';
const SELECT =
  'h-auto w-full rounded-sm border border-border-strong bg-background py-2.5 text-sm shadow-none data-[size=default]:h-auto';
const SERIES_TITLE = 'mb-2 text-sm font-bold';
const SERIES_LABEL = 'ml-1.5 text-[12.5px] font-normal text-faint';
const TABLE_SCROLL = 'overflow-x-auto rounded-sm border border-border';
const PARADIGM = 'w-full min-w-[720px] border-collapse';
const PERSON_HEAD = 'border-b border-border bg-muted px-2 py-1.5 text-left text-[11.5px] font-semibold';
const SCREEVE_CELL = 'min-w-[170px] border-b border-border px-2 py-1.5 text-left text-[13px] font-semibold';
const CELL_WRAP = 'border-b border-border px-2 py-1.5';
/* Borderless until focused: a grid of 66 outlined boxes reads as a wall, and the row and
   column rules already say where each cell is. */
const CELL =
  'w-full min-w-[92px] rounded-[6px] border border-transparent bg-background px-2 py-1.5 font-[inherit] text-[15px] ' +
  'focus:border-primary focus:shadow-[0_0_0_2px_var(--primary-glow)] focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:bg-transparent';

export type { PersonKey, ScreeveKey };
export default VerbEditor;
