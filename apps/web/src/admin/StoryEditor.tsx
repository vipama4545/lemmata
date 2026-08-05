// Adding and editing a story, and the report of how well it linked itself.
//
// Pasting prose in is the whole of adding a story. The server tokenises it and resolves every
// word against the lexicon — around 95% of them, on the evidence of the one story here — and
// what comes back is the list of what it could not do: the spellings nothing matched, and the
// links it reached by a guess. Those two lists are the work, and they are the point of this
// screen. Everything left over is either a word the dictionary is missing or a proper noun,
// and the second is fixed in the reader itself, on the word, where you can see the sentence.

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { StoryLinkResult } from '@georgian/shared/contract';
import { api } from '../api/client';
import Icon from '../components/Icon';
import { storySummaries } from '../content/store';
import { useEdit } from './useAdmin';

interface Draft {
  title: string;
  titleEnglish: string;
  level: string;
  source: string;
  note: string;
  text: string;
  translation: string;
}

function StoryEditor() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const { busy, error, run } = useEdit();

  const summary = useMemo(
    () => storySummaries().find(story => story.id === storyId) ?? null,
    [storyId],
  );

  const [draft, setDraft] = useState<Draft>({
    title: summary?.title ?? '',
    titleEnglish: summary?.titleEnglish ?? '',
    level: summary?.level ?? '',
    source: summary?.source ?? '',
    note: summary?.note ?? '',
    text: '',
    translation: '',
  });
  const [loadedText, setLoadedText] = useState(!storyId);
  const [report, setReport] = useState<StoryLinkResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The prose is not in the snapshot — only the summary is — so editing an existing story
  // needs the one extra fetch that the reader makes too.
  const loadText = async () => {
    if (!storyId) return;
    const story = await api.content.story({ id: storyId });
    if (!story) return;
    setDraft(current => ({
      ...current,
      text: [story.title, ...story.paragraphs].join('\n\n'),
      translation: story.translation.length ? [story.titleEnglish || story.title, ...story.translation].join('\n\n') : '',
    }));
    setLoadedText(true);
  };

  if (storyId && !summary) {
    return (
      <div className="main-content">
        <div className="breadcrumb">
          <Link to="/admin/stories">← Stories</Link>
        </div>
        <p className="empty-note">There is no story with the id “{storyId}”.</p>
      </div>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));

  const save = async () => {
    const result = await run(() =>
      api.admin.saveStory({
        ...(storyId ? { id: storyId } : {}),
        title: draft.title.trim(),
        titleEnglish: draft.titleEnglish.trim(),
        level: draft.level.trim(),
        source: draft.source.trim(),
        note: draft.note.trim(),
        text: draft.text,
        translation: draft.translation,
      }),
    );

    if (result) {
      setReport(result);
      if (!storyId) navigate(`/admin/stories/${encodeURIComponent(result.story.id)}`, { replace: true });
    }
  };

  const relink = async () => {
    if (!storyId) return;
    const result = await run(() => api.admin.relinkStory({ id: storyId }));
    if (result) setReport(result);
  };

  const remove = async () => {
    if (!storyId) return;
    const result = await run(() => api.admin.deleteStory({ id: storyId }));
    if (result) navigate('/admin/stories', { replace: true });
  };

  const paragraphCount = draft.text.split('\n').map(line => line.trim()).filter(line => line && line !== '-').length - 1;
  const translationCount =
    draft.translation.trim() === ''
      ? 0
      : draft.translation.split('\n').map(line => line.trim()).filter(line => line && line !== '-').length - 1;
  const mismatched = translationCount > 0 && translationCount !== paragraphCount;

  return (
    <div className="main-content admin-page">
      <div className="breadcrumb">
        <Link to="/admin/stories">← Stories</Link>
        <span className="breadcrumb-sep">/</span>
        <span>{summary ? summary.titleEnglish || summary.title : 'New story'}</span>
      </div>

      <header className="admin-head">
        <h1 className="admin-title">{summary ? summary.title : 'New story'}</h1>
        {summary && (
          <p className="admin-sub">
            <code>{summary.id}</code> · {summary.stats.tokens} words · {summary.stats.coverage}% linked ·{' '}
            {summary.stats.names} name(s)
          </p>
        )}
      </header>

      {error && <p className="admin-error">{error}</p>}

      <section className="admin-section">
        <h2 className="admin-section-title">About it</h2>
        <div className="admin-grid">
          <label className="admin-field">
            <span className="admin-label">Georgian title</span>
            <input
              className="admin-input admin-input-geo"
              value={draft.title}
              onChange={event => set('title', event.target.value)}
              placeholder="Taken from the first line of the text"
            />
          </label>

          <label className="admin-field">
            <span className="admin-label">English title</span>
            <input
              className="admin-input"
              value={draft.titleEnglish}
              onChange={event => set('titleEnglish', event.target.value)}
              placeholder="The Three Little Pigs"
            />
            <span className="admin-hint">A new story’s id is slugged from this.</span>
          </label>

          <label className="admin-field">
            <span className="admin-label">Level</span>
            <input
              className="admin-input"
              value={draft.level}
              onChange={event => set('level', event.target.value)}
              placeholder="A2"
            />
            <span className="admin-hint">Free text: a story is not confined to the A1/A2 word list.</span>
          </label>

          <label className="admin-field">
            <span className="admin-label">Source</span>
            <input className="admin-input" value={draft.source} onChange={event => set('source', event.target.value)} />
          </label>
        </div>

        <label className="admin-field">
          <span className="admin-label">Note</span>
          <textarea
            className="admin-input admin-textarea"
            rows={2}
            value={draft.note}
            onChange={event => set('note', event.target.value)}
          />
        </label>
      </section>

      <section className="admin-section">
        <h2 className="admin-section-title">The text</h2>
        <p className="admin-note">
          First line is the title, blank lines separate paragraphs, a lone “-” is a rule and is dropped —
          the same reading a <code>.txt</code> under <code>data/stories/</code> has always had. A translation
          must have one paragraph per Georgian paragraph, because the side-by-side view pairs them by position.
        </p>

        {storyId && !loadedText ? (
          <button type="button" className="control-btn" onClick={loadText}>
            <Icon name="type" /> Load the text to edit it
          </button>
        ) : (
          <div className="admin-grid admin-grid-prose">
            <label className="admin-field">
              <span className="admin-label">
                Georgian <span className="admin-count">{Math.max(paragraphCount, 0)} paragraph(s)</span>
              </span>
              <textarea
                className="admin-input admin-textarea admin-textarea-tall admin-input-geo"
                rows={16}
                value={draft.text}
                onChange={event => set('text', event.target.value)}
                placeholder={'სამი გოჭი\n\nიყო და არა იყო რა…'}
              />
            </label>

            <label className="admin-field">
              <span className="admin-label">
                English{' '}
                <span className={`admin-count${mismatched ? ' is-wrong' : ''}`}>
                  {translationCount > 0 ? `${translationCount} paragraph(s)` : 'optional'}
                </span>
              </span>
              <textarea
                className="admin-input admin-textarea admin-textarea-tall"
                rows={16}
                value={draft.translation}
                onChange={event => set('translation', event.target.value)}
                placeholder={'The Three Little Pigs\n\nOnce upon a time…'}
              />
            </label>
          </div>
        )}

        {mismatched && (
          <p className="admin-warning">
            The translation has {translationCount} paragraph(s) and the Georgian has {paragraphCount}. The
            side-by-side view pairs them by position, so they would drift out of step.
          </p>
        )}
      </section>

      <div className="admin-actions">
        <button
          type="button"
          className="control-btn know"
          disabled={busy || draft.text.trim() === '' || (Boolean(storyId) && !loadedText)}
          onClick={save}
        >
          <Icon name="check" /> {busy ? 'Linking…' : storyId ? 'Save and relink' : 'Create and link'}
        </button>

        {storyId && (
          <>
            <button type="button" className="control-btn" disabled={busy} onClick={relink}>
              <Icon name="refresh" /> Relink from the lexicon
            </button>
            <Link className="control-btn" to={`/stories/${encodeURIComponent(storyId)}`}>
              <Icon name="eye" /> Open the reader
            </Link>
          </>
        )}

        {storyId && !confirmDelete && (
          <button type="button" className="admin-danger-btn" disabled={busy} onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
        {storyId && confirmDelete && (
          <span className="admin-confirm">
            Delete this story and every link in it?
            <button type="button" className="admin-danger-btn" disabled={busy} onClick={remove}>
              Yes, delete
            </button>
            <button type="button" className="control-btn" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </span>
        )}
      </div>

      {report && <LinkReport result={report} />}
    </div>
  );
}

/**
 * What linking managed, and what it did not.
 *
 * Two lists, and they call for different things. An unresolved spelling is usually a word the
 * dictionary does not have — or a proper noun, which is not a dictionary word and never will
 * be. A flagged one did resolve, by a guess, and wants a read-through. Both are fixed on the
 * word itself in the reader, which is where the sentence is.
 */
function LinkReport({ result }: { result: StoryLinkResult }) {
  const { story, unresolved, flagged } = result;

  return (
    <section className="admin-section admin-report">
      <h2 className="admin-section-title">How it linked</h2>

      <div className="admin-report-stats">
        <span className="admin-stat">
          <strong>{story.stats.coverage}%</strong> linked
        </span>
        <span className="admin-stat">
          <strong>{story.stats.tokens}</strong> words
        </span>
        <span className="admin-stat">
          <strong>{story.stats.distinctForms}</strong> spellings
        </span>
        <span className="admin-stat">
          <strong>{story.stats.names}</strong> names
        </span>
        <span className="admin-stat">
          <strong>{story.stats.unresolved}</strong> unresolved
        </span>
        <span className="admin-stat">
          <strong>{story.stats.flagged}</strong> guessed
        </span>
      </div>

      <p className="admin-note">
        Fix these in the reader, on the word itself — <Link to={`/stories/${encodeURIComponent(story.id)}`}>open it</Link>{' '}
        and turn on Edit links. A proper noun is named there and stays out of the dictionary; a missing word
        is added to the lexicon and every story that uses it picks it up on the next relink.
      </p>

      <div className="admin-report-lists">
        <div>
          <h3 className="admin-report-title">Nothing matched ({unresolved.length})</h3>
          {unresolved.length === 0 ? (
            <p className="admin-hint">Every word resolved.</p>
          ) : (
            <ul className="admin-tag-list">
              {unresolved.slice(0, 60).map(item => (
                <li key={item.form} className="admin-tag">
                  <span className="admin-input-geo">{item.form}</span>
                  {item.count > 1 && <span className="admin-tag-count">{item.count}</span>}
                </li>
              ))}
              {unresolved.length > 60 && <li className="admin-hint">…and {unresolved.length - 60} more</li>}
            </ul>
          )}
        </div>

        <div>
          <h3 className="admin-report-title">Reached by a guess ({flagged.length})</h3>
          {flagged.length === 0 ? (
            <p className="admin-hint">Nothing was guessed.</p>
          ) : (
            <ul className="admin-tag-list">
              {flagged.slice(0, 60).map(item => (
                <li key={item.form} className="admin-tag is-flagged">
                  <span className="admin-input-geo">{item.form}</span>
                  {item.count > 1 && <span className="admin-tag-count">{item.count}</span>}
                </li>
              ))}
              {flagged.length > 60 && <li className="admin-hint">…and {flagged.length - 60} more</li>}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

export default StoryEditor;
