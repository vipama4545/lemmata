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
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { KaVerbInput } from '@georgian/shared/contract';
import { PERSONS, SCREEVES, SERIES } from '@georgian/shared/grammar/ka';
import type { PersonKey, ScreeveKey, KaVerb } from '@georgian/shared/types';
import { api } from '../api/client';
import Icon from '../components/Icon';
import { kaVerbData } from '../content/store';
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
      <div className="main-content">
        <div className="breadcrumb">
          <Link to="/admin/verbs">← Verbs</Link>
        </div>
        <p className="empty-note">There is no paradigm with the id “{verbId}”.</p>
      </div>
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
    <div className="main-content admin-page">
      <div className="breadcrumb">
        <Link to="/admin/verbs">← Verbs</Link>
        <span className="breadcrumb-sep">/</span>
        <span>{existing ? existing.english : 'New paradigm'}</span>
      </div>

      <header className="admin-head">
        <h1 className="admin-title">{existing ? existing.english : 'New paradigm'}</h1>
        {existing && (
          <p className="admin-sub">
            <code>{existing.id}</code> · {filled} form(s) filled in
          </p>
        )}
      </header>

      {error && <p className="admin-error">{error}</p>}

      <section className="admin-section">
        <h2 className="admin-section-title">The verb</h2>

        <div className="admin-grid">
          <label className="admin-field">
            <span className="admin-label">English</span>
            <input
              className="admin-input"
              value={draft.english}
              onChange={event => set('english', event.target.value)}
              placeholder="builds"
            />
            <span className="admin-hint">A new paradigm’s id is slugged from this and never changes after.</span>
          </label>

          <label className="admin-field">
            <span className="admin-label">Present 3sg</span>
            <input
              className="admin-input admin-input-geo"
              value={draft.present3sg}
              onChange={event => set('present3sg', event.target.value)}
              placeholder="აშენებს"
            />
          </label>

          <label className="admin-field">
            <span className="admin-label">Verbal noun</span>
            <input
              className="admin-input admin-input-geo"
              value={draft.verbalNoun}
              onChange={event => set('verbalNoun', event.target.value)}
              placeholder="შენება"
            />
          </label>

          <label className="admin-field">
            <span className="admin-label">Transitivity</span>
            <input
              className="admin-input"
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
          </label>

          <label className="admin-field">
            <span className="admin-label">Conjugation group</span>
            <select className="admin-input" value={draft.groupId} onChange={event => set('groupId', event.target.value)}>
              <option value="">None</option>
              {groups.map(group => (
                <option key={group.id} value={group.id}>
                  {group.label} {group.name}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-field">
            <span className="admin-label">Source URL</span>
            <input className="admin-input" value={draft.url} onChange={event => set('url', event.target.value)} />
          </label>
        </div>

        <div className="admin-grid">
          <label className="admin-field">
            <span className="admin-label">Other senses</span>
            <textarea
              className="admin-input admin-textarea"
              rows={3}
              value={draft.senses}
              onChange={event => set('senses', event.target.value)}
              placeholder={'One per line.\nEach carries its own preverb where they differ.'}
            />
          </label>

          <label className="admin-field">
            <span className="admin-label">English synonyms</span>
            <textarea
              className="admin-input admin-textarea"
              rows={3}
              value={draft.synonymsEnglish}
              onChange={event => set('synonymsEnglish', event.target.value)}
              placeholder="One per line."
            />
          </label>

          <label className="admin-field">
            <span className="admin-label">Georgian synonyms</span>
            <textarea
              className="admin-input admin-textarea admin-input-geo"
              rows={3}
              value={draft.synonymsGeorgian}
              onChange={event => set('synonymsGeorgian', event.target.value)}
              placeholder="One per line."
            />
          </label>
        </div>
      </section>

      <section className="admin-section">
        <h2 className="admin-section-title">The paradigm</h2>
        <p className="admin-note">
          A screeve that is switched off does not inflect at all; a screeve that is on with empty cells is one
          the source has a gap in. Those are different things and the reader shows them differently, so
          clearing a cell is not the same as switching a screeve off.
        </p>

        {SERIES.map(series => (
          <div key={series.id} className="admin-series">
            <h3 className="admin-series-title">
              Series {series.id} <span className="admin-series-label">{series.label}</span>
            </h3>

            <div className="admin-table-scroll">
              <table className="admin-paradigm">
                <thead>
                  <tr>
                    <th className="admin-paradigm-screeve">Screeve</th>
                    {PERSONS.map(person => (
                      <th key={person.key}>
                        <span className="admin-person">{person.label}</span>
                        <span className="admin-person-pronoun">{person.pronoun}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SCREEVES.filter(screeve => series.screeves.includes(screeve.key)).map(screeve => {
                    const cells = draft.forms[screeve.key];
                    return (
                      <tr key={screeve.key} className={cells ? '' : 'is-off'}>
                        <th className="admin-paradigm-screeve">
                          <label className="check admin-screeve-toggle">
                            <input type="checkbox" checked={Boolean(cells)} onChange={() => toggleScreeve(screeve.key)} />
                            <span>
                              {screeve.label}
                              <span className="admin-screeve-gloss">{screeve.gloss}</span>
                            </span>
                          </label>
                        </th>
                        {PERSONS.map(person => (
                          <td key={person.key}>
                            <input
                              className="admin-cell admin-input-geo"
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

        <div className="admin-series">
          <h3 className="admin-series-title">
            Commands <span className="admin-series-label">not screeves, and with no first person singular</span>
          </h3>

          <div className="admin-table-scroll">
            <table className="admin-paradigm">
              <thead>
                <tr>
                  <th className="admin-paradigm-screeve">Form</th>
                  {COMMAND_PERSONS.map(person => (
                    <th key={person.key}>
                      <span className="admin-person">{person.label}</span>
                      <span className="admin-person-pronoun">{person.pronoun}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(['imperative', 'prohibitive'] as const).map(kind => (
                  <tr key={kind}>
                    <th className="admin-paradigm-screeve">
                      {kind === 'imperative' ? 'Imperative' : 'Prohibitive'}
                      <span className="admin-screeve-gloss">{kind === 'imperative' ? 'do it' : 'do not do it'}</span>
                    </th>
                    {COMMAND_PERSONS.map(person => (
                      <td key={person.key}>
                        <input
                          className="admin-cell admin-input-geo"
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
      </section>

      <div className="admin-actions">
        <button type="button" className="control-btn know" disabled={!draft.english.trim() || busy} onClick={save}>
          <Icon name="check" /> {busy ? 'Saving…' : existing ? 'Save changes' : 'Create paradigm'}
        </button>

        {existing && !confirmDelete && (
          <button type="button" className="admin-danger-btn" disabled={busy} onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
        {existing && confirmDelete && (
          <span className="admin-confirm">
            Delete this paradigm?
            <button type="button" className="admin-danger-btn" disabled={busy} onClick={remove}>
              Yes, delete
            </button>
            <button type="button" className="control-btn" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

export type { PersonKey, ScreeveKey };
export default VerbEditor;
