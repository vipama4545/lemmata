import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ImperativeForms, Screeve, ScreeveKey, Verb, VerbMorphemes } from '../types';
import verbData from '../data/verbs.json';
import morphemeData from '../data/verbMorphemes.json';
import { MORPHEME_PARTS, segmentForm } from '../utils/verbMorphology';
import Icon from './Icon';

const { persons, screeves, series, groups, verbs } = verbData;

const screeveByKey = Object.fromEntries(
  screeves.map(s => [s.key, s]),
) as Record<ScreeveKey, Screeve>;

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

  const { verb, index } = useMemo(() => {
    const i = verbs.findIndex(v => v.id === verbId);
    // findIndex returns -1 for an unknown id, so this really can come back empty.
    return { verb: verbs[i] as Verb | undefined, index: i };
  }, [verbId]);

  const lex = verbId ? morphemeData.verbs[verbId] : undefined;

  if (!verb) {
    return (
      <div className="main-content">
        <div className="not-found">
          <h2>Verb not found</h2>
          <Link to="/verbs">← Back to verbs</Link>
        </div>
      </div>
    );
  }

  const group = groups.find(g => g.id === verb.groupId);
  const previous: Verb | undefined = verbs[index - 1];
  const next: Verb | undefined = verbs[index + 1];

  return (
    <div className="main-content">
      <div className="breadcrumb">
        <Link to="/categories">← Categories</Link>
        <span className="breadcrumb-sep">/</span>
        <Link to="/verbs">Verbs</Link>
        <span className="breadcrumb-sep">/</span>
        <span>{verb.english}</span>
      </div>

      <div className="verb-detail-header">
        <div>
          <h1 className="verb-detail-noun">{verb.verbalNoun || verb.english}</h1>
          <p className="verb-detail-english">
            {verb.english}
            {verb.transitivity && <em className="verb-transitivity"> {verb.transitivity}</em>}
          </p>
          {verb.senses.length > 0 && (
            <ul className="verb-senses">
              {verb.senses.map((sense, i) => <li key={i}>{sense}</li>)}
            </ul>
          )}
        </div>
        <div className="verb-detail-meta">
          {verb.group && <span className="group-tag group-tag-lg">{verb.group}</span>}
          {group && <span className="verb-detail-group-name">{group.name}</span>}
        </div>
      </div>

      {lex && <MorphemeKey lex={lex} highlight={highlight} onToggle={() => setHighlight(h => !h)} />}

      {group && group.notes.length > 0 && (
        <details className="verb-group-notes">
          <summary>About {group.label} {group.name}</summary>
          <ul>
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
          <section key={block.id} className="verb-series">
            <h2 className="verb-series-title">{block.label}</h2>
            <ConjugationTable rows={rows} lex={highlight ? lex : null} />
          </section>
        );
      })}

      {(verb.imperative || verb.prohibitive) && (
        <section className="verb-series">
          <h2 className="verb-series-title">Imperative</h2>
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
        <section className="verb-synonyms">
          <h2 className="verb-series-title">Synonyms</h2>
          {verb.synonymsGeorgian.length > 0 && (
            <p className="verb-synonym-row">
              <span className="verb-synonym-label">Georgian</span>
              <span className="verb-georgian">{verb.synonymsGeorgian.join(' · ')}</span>
            </p>
          )}
          {verb.synonymsEnglish.length > 0 && (
            <p className="verb-synonym-row">
              <span className="verb-synonym-label">English</span>
              <span>{verb.synonymsEnglish.join(' · ')}</span>
            </p>
          )}
        </section>
      )}

      <div className="verb-detail-footer">
        <div className="verb-nav">
          {previous && (
            <Link to={`/verbs/${previous.id}`} className="verb-nav-link">
              <Icon name="arrow-left" /> {previous.english}
            </Link>
          )}
          {next && (
            <Link to={`/verbs/${next.id}`} className="verb-nav-link verb-nav-next">
              {next.english} <Icon name="arrow-right" />
            </Link>
          )}
        </div>
        {verb.url && (
          <a className="verb-source-link" href={verb.url} target="_blank" rel="noopener noreferrer">
            View on lingua.ge
          </a>
        )}
      </div>
    </div>
  );
}

// The verb's own morphemes, plus the colour key for the tables below. The parts are only
// listed here if this verb actually has them — plenty of verbs take no preverb and plenty
// take no version vowel.
function MorphemeKey({
  lex,
  highlight,
  onToggle,
}: {
  lex: VerbMorphemes;
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
    <section className="morph-key">
      <div className="morph-key-row">
        <div className="morph-anatomy">
          {anatomy.map(item => (
            <span key={item.part} className={`morph-chip mo-${item.part}`}>
              <span className="morph-chip-label">{item.label}</span>
              <span className="morph-chip-value verb-georgian">{item.value}</span>
            </span>
          ))}
        </div>
        <button
          type="button"
          className={`toggle-btn morph-toggle${highlight ? ' is-on' : ''}`}
          onClick={onToggle}
          aria-pressed={highlight}
        >
          <Icon name={highlight ? 'eye' : 'eye-off'} />
          Colour the parts
        </button>
      </div>

      {highlight && (
        <ul className="morph-legend">
          {MORPHEME_PARTS.map(part => (
            <li key={part.key} className="morph-legend-item">
              <span className={`morph-legend-name mo-${part.key}`}>{part.label}</span>
              <span className="morph-legend-hint">{part.hint}</span>
            </li>
          ))}
        </ul>
      )}

      {highlight && lex.check && (
        <p className="morph-warning">
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
  lex: VerbMorphemes | null | undefined;
  screeve: string;
}): ReactNode {
  if (!lex) return form;
  const { segments } = segmentForm(form, lex, screeve);
  return segments.map((segment, i) => (
    <span key={i} className={`mo mo-${segment.part}`}>
      {segment.text}
    </span>
  ));
}

// Screeves down the side, persons across the top. A cell the spreadsheet leaves blank
// shows a dash rather than collapsing, so the shape of a defective paradigm stays visible.
function ConjugationTable({
  rows,
  lex,
}: {
  rows: ConjugationRow[];
  lex: VerbMorphemes | null | undefined;
}) {
  return (
    <div className="conj-table-wrap">
      <table className="conj-table">
        <thead>
          <tr>
            <th scope="col" className="conj-corner"></th>
            {persons.map(person => (
              <th key={person.key} scope="col">
                <span className="conj-person">{person.label}</span>
                <span className="conj-pronoun">{person.pronoun}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.key}>
              <th scope="row" className="conj-screeve">{row.label}</th>
              {persons.map(person => {
                const form = row.forms[person.key];
                return (
                  <td key={person.key} className={form ? 'verb-georgian' : 'conj-empty'}>
                    {form ? <VerbForm form={form} lex={lex} screeve={row.key} /> : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default VerbDetail;
