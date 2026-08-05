// Adding and editing a lemma: its meanings, its inflected forms, and what it is filed under.
//
// The two lists are what make this more than a form. A word's *senses* are ordered and their
// order is their identity — a story token cites "sense 2" — so reordering one silently
// changes what every story that cites it says. Adding at the end is therefore safe and moving
// one is not, which the screen says out loud rather than leaving to be discovered.
//
// A word's *forms* are the story linker's first and most trusted index: a spelling listed
// here is that lemma, full stop, with no guessing. Adding one is the single most effective
// way to raise a story's coverage, which is why the form list is here beside the meanings
// rather than on a page of its own.

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { WordInput } from '@georgian/shared/contract';
import type { Word } from '@georgian/shared/types';
import { api } from '../api/client';
import Icon from '../components/Icon';
import { verbData, wordData } from '../content/store';
import { useEdit } from './useAdmin';

/** The part-of-speech tags already in use, so the field offers them rather than free text. */
function usedPartsOfSpeech(words: Word[]): string[] {
  return [...new Set(words.map(word => word.partOfSpeech).filter(Boolean))].sort();
}

interface Draft {
  georgian: string;
  english: string;
  georgianDefinition: string;
  level: 'A1' | 'A2' | '';
  partOfSpeech: string;
  categoryId: string;
  defaultSense: number | null;
  verbId: string | null;
  check: boolean;
  note: string;
  senses: string[];
  forms: { form: string; gram: string; english: string }[];
}

function draftFrom(word: Word | null, fallbackCategory: string): Draft {
  if (!word) {
    return {
      georgian: '',
      english: '',
      georgianDefinition: '',
      level: '',
      partOfSpeech: '',
      // Where the offline pipeline files a hand-written lemma too, so a word added here and
      // one added in lexicon.json land in the same place.
      categoryId: fallbackCategory,
      defaultSense: null,
      verbId: null,
      check: false,
      note: '',
      senses: [''],
      forms: [],
    };
  }

  return {
    georgian: word.georgian,
    english: word.english,
    georgianDefinition: word.georgianDefinition,
    level: word.level,
    partOfSpeech: word.partOfSpeech,
    categoryId: word.categoryId,
    defaultSense: word.defaultSense ?? null,
    verbId: word.verbId ?? null,
    check: word.check === true,
    note: word.note ?? '',
    senses: word.senses.map(sense => sense.english),
    forms: (word.forms ?? []).map(form => ({
      form: form.form,
      gram: form.gram ?? '',
      english: form.english ?? '',
    })),
  };
}

function WordEditor() {
  const { wordId } = useParams<{ wordId: string }>();
  const navigate = useNavigate();
  const { categories, words } = wordData();
  const { busy, error, run } = useEdit();

  const existing = useMemo(() => words.find(word => word.id === wordId) ?? null, [words, wordId]);
  const [draft, setDraft] = useState<Draft>(() =>
    draftFrom(existing, categories.some(c => c.id === 'story-vocabulary') ? 'story-vocabulary' : categories[0]?.id ?? ''),
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  const partsOfSpeech = useMemo(() => usedPartsOfSpeech(words), [words]);
  const paradigm = draft.verbId ? verbData().verbs.find(verb => verb.id === draft.verbId) ?? null : null;

  if (wordId && !existing) {
    return (
      <div className="main-content">
        <div className="breadcrumb">
          <Link to="/admin/words">← Words</Link>
        </div>
        <p className="empty-note">There is no word with the id “{wordId}”.</p>
      </div>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));

  const senses = draft.senses.map(sense => sense.trim()).filter(Boolean);
  const canSave = draft.georgian.trim() !== '' && senses.length > 0 && draft.categoryId !== '';

  const save = async () => {
    const payload: WordInput = {
      ...(existing ? { id: existing.id } : {}),
      georgian: draft.georgian.trim(),
      english: draft.english.trim(),
      georgianDefinition: draft.georgianDefinition.trim(),
      level: draft.level,
      partOfSpeech: draft.partOfSpeech.trim(),
      categoryId: draft.categoryId,
      defaultSense: draft.defaultSense,
      verbId: draft.verbId,
      check: draft.check,
      note: draft.note.trim() || null,
      senses,
      forms: draft.forms
        .filter(form => form.form.trim())
        .map(form => ({ form: form.form.trim(), gram: form.gram.trim(), english: form.english.trim() })),
    };

    const result = await run(() => api.admin.saveWord(payload));
    if (result) navigate(`/admin/words/${encodeURIComponent(result.id)}`, { replace: true });
  };

  const remove = async () => {
    if (!existing) return;
    const result = await run(() => api.admin.deleteWord({ id: existing.id }));
    if (result) navigate('/admin/words', { replace: true });
  };

  return (
    <div className="main-content admin-page">
      <div className="breadcrumb">
        <Link to="/admin/words">← Words</Link>
        <span className="breadcrumb-sep">/</span>
        <span>{existing ? existing.georgian : 'New word'}</span>
      </div>

      <header className="admin-head">
        <h1 className="admin-title">{existing ? existing.georgian : 'New word'}</h1>
        {existing && (
          <p className="admin-sub">
            <code>{existing.id}</code> · {existing.origin === 'core' ? 'from the scrape' : 'written by hand'}
          </p>
        )}
      </header>

      {error && <p className="admin-error">{error}</p>}

      <section className="admin-section">
        <h2 className="admin-section-title">The headword</h2>

        <div className="admin-grid">
          <label className="admin-field">
            <span className="admin-label">Georgian</span>
            <input
              className="admin-input admin-input-geo"
              value={draft.georgian}
              onChange={event => set('georgian', event.target.value)}
              placeholder="მგელი"
            />
            <span className="admin-hint">
              The headword as it is written. A trailing <code>*</code> or digit marks a homograph and is
              stripped everywhere it is shown.
            </span>
          </label>

          <label className="admin-field">
            <span className="admin-label">Headline gloss</span>
            <input
              className="admin-input"
              value={draft.english}
              onChange={event => set('english', event.target.value)}
              placeholder={senses[0] ?? 'wolf'}
            />
            <span className="admin-hint">Left blank, this becomes the first sense below.</span>
          </label>

          <label className="admin-field">
            <span className="admin-label">Category</span>
            <select
              className="admin-input"
              value={draft.categoryId}
              onChange={event => set('categoryId', event.target.value)}
            >
              {categories.map(category => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-field">
            <span className="admin-label">Part of speech</span>
            <input
              className="admin-input"
              list="admin-pos-list"
              value={draft.partOfSpeech}
              onChange={event => set('partOfSpeech', event.target.value)}
              placeholder="Noun"
            />
            <datalist id="admin-pos-list">
              {partsOfSpeech.map(pos => (
                <option key={pos} value={pos} />
              ))}
            </datalist>
            <span className="admin-hint">
              “Verb” keeps this entry out of the story linker’s nominal peeler, which is what stops a case
              ending being taken off a verb.
            </span>
          </label>

          <label className="admin-field">
            <span className="admin-label">CEFR level</span>
            <select
              className="admin-input"
              value={draft.level}
              onChange={event => set('level', event.target.value as Draft['level'])}
            >
              <option value="">None — added by hand</option>
              <option value="A1">A1</option>
              <option value="A2">A2</option>
            </select>
          </label>

          <label className="admin-field">
            <span className="admin-label">Georgian definition</span>
            <input
              className="admin-input admin-input-geo"
              value={draft.georgianDefinition}
              onChange={event => set('georgianDefinition', event.target.value)}
            />
          </label>
        </div>

        <label className="check admin-check">
          <input type="checkbox" checked={draft.check} onChange={event => set('check', event.target.checked)} />
          The meaning is a guess and wants verifying
        </label>

        <label className="admin-field">
          <span className="admin-label">Note</span>
          <textarea
            className="admin-input admin-textarea"
            rows={2}
            value={draft.note}
            onChange={event => set('note', event.target.value)}
            placeholder="Anything a reader of this entry needs told."
          />
        </label>
      </section>

      <section className="admin-section">
        <h2 className="admin-section-title">Meanings</h2>
        <p className="admin-note">
          In order. A story token cites a sense by <em>position</em>, so appending is safe and reordering
          changes what every story that cites this word says. The radio picks the one to lead with where a
          story does not pin one.
        </p>

        <ul className="admin-list">
          {draft.senses.map((sense, index) => (
            <li key={index} className="admin-row">
              <label className="admin-row-lead" title={`Lead with sense ${index + 1}`}>
                <input
                  type="radio"
                  name="default-sense"
                  checked={(draft.defaultSense ?? 1) === index + 1}
                  onChange={() => set('defaultSense', index + 1 === 1 ? null : index + 1)}
                />
                <span className="admin-row-number">{index + 1}</span>
              </label>
              <input
                className="admin-input"
                value={sense}
                onChange={event => {
                  const next = [...draft.senses];
                  next[index] = event.target.value;
                  set('senses', next);
                }}
                placeholder="wolf"
              />
              <button
                type="button"
                className="admin-icon-btn"
                aria-label={`Remove sense ${index + 1}`}
                disabled={draft.senses.length === 1}
                onClick={() => {
                  set(
                    'senses',
                    draft.senses.filter((_, at) => at !== index),
                  );
                  if (draft.defaultSense && draft.defaultSense > index) set('defaultSense', null);
                }}
              >
                <Icon name="close" size={15} />
              </button>
            </li>
          ))}
        </ul>

        <button type="button" className="control-btn" onClick={() => set('senses', [...draft.senses, ''])}>
          Add a meaning
        </button>
      </section>

      <section className="admin-section">
        <h2 className="admin-section-title">Inflected forms</h2>
        <p className="admin-note">
          Spellings confirmed to belong here. This is the story linker’s first index and the only one it
          never guesses from — a form listed here <em>is</em> this lemma. The English column is for a form
          that means something the headword does not say: იყო reads as “was”, under a headword meaning “is”.
          Case forms of a noun need none.
        </p>

        <ul className="admin-list">
          {draft.forms.map((form, index) => (
            <li key={index} className="admin-row admin-row-form">
              <input
                className="admin-input admin-input-geo"
                value={form.form}
                onChange={event => {
                  const next = [...draft.forms];
                  next[index] = { ...form, form: event.target.value };
                  set('forms', next);
                }}
                placeholder="მგელმა"
              />
              <input
                className="admin-input admin-input-narrow"
                value={form.gram}
                onChange={event => {
                  const next = [...draft.forms];
                  next[index] = { ...form, gram: event.target.value };
                  set('forms', next);
                }}
                placeholder="erg"
                aria-label="Grammatical label"
              />
              <input
                className="admin-input"
                value={form.english}
                onChange={event => {
                  const next = [...draft.forms];
                  next[index] = { ...form, english: event.target.value };
                  set('forms', next);
                }}
                placeholder="English, only if it differs"
                aria-label="What this form means"
              />
              <button
                type="button"
                className="admin-icon-btn"
                aria-label={`Remove form ${form.form || index + 1}`}
                onClick={() =>
                  set(
                    'forms',
                    draft.forms.filter((_, at) => at !== index),
                  )
                }
              >
                <Icon name="close" size={15} />
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="control-btn"
          onClick={() => set('forms', [...draft.forms, { form: '', gram: '', english: '' }])}
        >
          Add a form
        </button>
      </section>

      <section className="admin-section">
        <h2 className="admin-section-title">Paradigm</h2>
        <p className="admin-note">
          The conjugation table this headword claims, for the entries that have one. Claiming a paradigm is
          what lets the story linker resolve all 66 of its conjugated forms to this word.
        </p>

        {paradigm ? (
          <p className="admin-picker-current">
            <span className="admin-picker-geo">{paradigm.present3sg || paradigm.verbalNoun}</span>
            <span className="admin-picker-en">{paradigm.english}</span>
            <button type="button" className="admin-link-btn" onClick={() => set('verbId', null)}>
              Clear
            </button>
          </p>
        ) : (
          <p className="admin-hint">No paradigm claimed.</p>
        )}

        <ParadigmPicker onPick={id => set('verbId', id)} />
      </section>

      <div className="admin-actions">
        <button type="button" className="control-btn know" disabled={!canSave || busy} onClick={save}>
          <Icon name="check" /> {busy ? 'Saving…' : existing ? 'Save changes' : 'Create word'}
        </button>

        {existing && !confirmDelete && (
          <button type="button" className="admin-danger-btn" disabled={busy} onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
        {existing && confirmDelete && (
          <span className="admin-confirm">
            Delete “{existing.georgian}”?
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

/** A search over the paradigms, by their English or their 3sg. */
function ParadigmPicker({ onPick }: { onPick: (id: string) => void }) {
  const [term, setTerm] = useState('');
  const verbs = verbData().verbs;

  const results = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return [];
    return verbs
      .filter(
        verb =>
          verb.english.toLowerCase().includes(needle) ||
          verb.present3sg.includes(needle) ||
          verb.verbalNoun.includes(needle),
      )
      .slice(0, 25);
  }, [verbs, term]);

  return (
    <div className="admin-picker">
      <div className="search-field admin-picker-field">
        <Icon name="search" size={16} />
        <input
          type="text"
          className="search-input"
          placeholder="Search paradigms…"
          value={term}
          onChange={event => setTerm(event.target.value)}
        />
      </div>

      {term.trim() !== '' && (
        <ul className="admin-picker-results">
          {results.length === 0 && <li className="admin-picker-empty">Nothing matches “{term}”.</li>}
          {results.map(verb => (
            <li key={verb.id}>
              <button
                type="button"
                className="admin-picker-result"
                onClick={() => {
                  onPick(verb.id);
                  setTerm('');
                }}
              >
                <span className="admin-picker-geo">{verb.present3sg || verb.verbalNoun}</span>
                <span className="admin-picker-en">{verb.english}</span>
                <span className="admin-picker-pos">{verb.transitivity}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default WordEditor;
