// Correcting one word where it stands in the story.
//
// This is the panel behind "Edit links" in the reader, and it is deliberately reached by
// clicking the word rather than from a list on another screen. The decisions it offers can
// only be made with the sentence in view: whether აბა is "let's" or "just try" here, and
// whether ნიფ-ნიფი is a word at all or the name of a pig.
//
// Three answers, and they are different claims rather than three ways of saying one thing:
//
//   a dictionary entry — this occurrence means that entry, in that sense
//   a name             — a proper noun, glossed here and kept out of the dictionary, because
//                        it is a character in this story and nothing in the next one
//   plain text         — deliberately not a dictionary word, which is not the same as the
//                        resolver having failed to find one
//
// And one modifier: whether the answer covers this occurrence alone or every occurrence of
// the spelling in this story. Those are the `at` and `forms` blocks of the offline overrides
// file, and the distinction is real — და is the conjunction all the way through, but აბა is
// two different words in two different lines.

import { useEffect, useMemo, useState } from 'react';
import type { StoryLinkResult } from '@georgian/shared/contract';
import type { Story, StoryToken, Word } from '@georgian/shared/types';
import { api } from '../api/client';
import Icon from '../components/Icon';
import { wordData } from '../content/store';
import { useEdit } from './useAdmin';
import WordPicker from './WordPicker';

type Choice = 'word' | 'name' | 'plain';

interface TokenEditorProps {
  story: Story;
  paragraph: number;
  position: number;
  token: StoryToken;
  onClose: () => void;
  /** Handed the relinked story, so the reader repaints from the server's answer. */
  onSaved: (result: StoryLinkResult) => void;
}

function TokenEditor({ story, paragraph, position, token, onClose, onSaved }: TokenEditorProps) {
  const { words } = wordData();
  const { busy, error, run } = useEdit();

  const byId = useMemo(() => new Map(words.map(word => [word.id, word])), [words]);
  const current = token.word ? byId.get(token.word) ?? null : null;

  const [choice, setChoice] = useState<Choice>(token.name ? 'name' : token.word ? 'word' : 'plain');
  const [picked, setPicked] = useState<Word | null>(current);
  const [sense, setSense] = useState<number>(token.sense ?? 1);
  const [name, setName] = useState(token.name ?? '');
  const [gram, setGram] = useState(token.gram ?? '');
  const [comment, setComment] = useState(token.comment ?? '');
  const [everywhere, setEverywhere] = useState(false);
  // Starts from what the token already claims: the resolver's own doubt if it guessed, and
  // the editor's if a previous one ticked this.
  const [check, setCheck] = useState(token.check === true);

  // The alternates the resolver already shortlisted for this spelling — usually the right
  // answer when it got one wrong, and one tap rather than a search.
  const suggestions = useMemo(
    () => (token.alts ?? []).map(alt => byId.get(alt.word)).filter((word): word is Word => Boolean(word)),
    [token.alts, byId],
  );

  const occurrences = useMemo(
    () => story.tokens.flat().filter(other => other.form === token.form).length,
    [story, token.form],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handMade = token.via === 'name' || token.via.startsWith('override');

  const save = async () => {
    const result = await run(() =>
      api.admin.setStoryToken({
        storyId: story.id,
        paragraph,
        position,
        form: token.form,
        wordId: choice === 'word' ? picked?.id ?? null : null,
        sense: choice === 'word' ? sense : null,
        gram: choice === 'word' ? gram.trim() : '',
        name: choice === 'name' ? name.trim() : null,
        comment: comment.trim() || null,
        check,
        everywhere,
      }),
    );
    if (result) onSaved(result);
  };

  const reset = async () => {
    const result = await run(() =>
      api.admin.resetStoryToken({
        storyId: story.id,
        paragraph,
        position,
        form: token.form,
        everywhere,
      }),
    );
    if (result) onSaved(result);
  };

  const canSave =
    (choice === 'word' && picked !== null) || (choice === 'name' && name.trim() !== '') || choice === 'plain';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content admin-token"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit the link on ${token.form}`}
        onClick={event => event.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>

        <header className="admin-token-head">
          <p className="admin-token-form">{token.form}</p>
          <p className="admin-token-where">
            paragraph {paragraph + 1}, word {position + 1}
            {occurrences > 1 && ` · ${occurrences} occurrences of this spelling`}
          </p>
          <p className="admin-token-via">
            {handMade ? (
              <span className="admin-badge is-admin">set by hand · {token.via}</span>
            ) : (
              <span className="admin-badge">
                {token.via === 'unresolved' ? 'nothing matched' : `matched by ${token.via}`}
              </span>
            )}
            {token.check && <span className="admin-badge is-flagged">a guess</span>}
          </p>
        </header>

        {error && <p className="admin-error">{error}</p>}

        <div className="admin-token-choices" role="radiogroup" aria-label="What this word is">
          {(
            [
              ['word', 'A dictionary word', 'Links to a lexicon entry and one of its meanings.'],
              ['name', 'A name', 'Glossed here only. Stays out of the dictionary.'],
              ['plain', 'Not a word', 'Left as plain text on purpose, rather than by failure.'],
            ] as [Choice, string, string][]
          ).map(([value, label, hint]) => (
            <label key={value} className={`admin-token-choice${choice === value ? ' is-on' : ''}`}>
              <input
                type="radio"
                name="token-choice"
                checked={choice === value}
                onChange={() => setChoice(value)}
              />
              <span className="admin-token-choice-label">{label}</span>
              <span className="admin-token-choice-hint">{hint}</span>
            </label>
          ))}
        </div>

        {choice === 'word' && (
          <div className="admin-token-body">
            <WordPicker value={picked} suggestions={suggestions} onPick={setPicked} clearable={false} autoFocus />

            {picked && (
              <>
                <div className="admin-field">
                  <span className="admin-label">Which meaning</span>
                  <ul className="admin-sense-list">
                    {picked.senses.map((item, index) => (
                      <li key={item.id}>
                        <label className={`admin-sense${sense === index + 1 ? ' is-on' : ''}`}>
                          <input
                            type="radio"
                            name="token-sense"
                            checked={sense === index + 1}
                            onChange={() => setSense(index + 1)}
                          />
                          <span className="admin-sense-number">{index + 1}</span>
                          <span>{item.english}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>

                <label className="admin-field">
                  <span className="admin-label">Grammatical label</span>
                  <input
                    className="admin-input"
                    value={gram}
                    onChange={event => setGram(event.target.value)}
                    placeholder="erg, dat.pl, Aorist 3sg"
                  />
                  <span className="admin-hint">How this form differs from the headword. Shown on the card.</span>
                </label>
              </>
            )}
          </div>
        )}

        {choice === 'name' && (
          <div className="admin-token-body">
            <label className="admin-field">
              <span className="admin-label">Who or what this is</span>
              <input
                className="admin-input"
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="Nif-Nif, one of the three pigs"
                autoFocus
              />
              <span className="admin-hint">
                Shown on the card in place of a definition. Case forms are named separately — ნიფ-ნიფმა can
                read “Nif-Nif (ergative)” — because nothing derives that from the nominative.
              </span>
            </label>
          </div>
        )}

        {choice === 'plain' && (
          <p className="admin-note admin-token-body">
            This occurrence will be left as ordinary text, and marked as a decision rather than a failure —
            so it stops showing up in the unresolved list and survives every relink.
          </p>
        )}

        <label className="admin-field">
          <span className="admin-label">Note</span>
          <input
            className="admin-input"
            value={comment}
            onChange={event => setComment(event.target.value)}
            placeholder="Why, for whoever reads this in a year."
          />
        </label>

        <label className="check admin-check admin-token-flag">
          <input type="checkbox" checked={check} onChange={event => setCheck(event.target.checked)} />
          <span>
            Still a guess — come back to this
            <span className="admin-hint">
              The same flag the linker sets on its own uncertain matches, so a doubt you have
              lands in the same list rather than needing the wrong link left in place to record it.
            </span>
          </span>
        </label>

        {occurrences > 1 && (
          <label className="check admin-check admin-token-everywhere">
            <input type="checkbox" checked={everywhere} onChange={event => setEverywhere(event.target.checked)} />
            Apply to all {occurrences} occurrences of “{token.form}” in this story
          </label>
        )}

        <div className="admin-actions">
          <button type="button" className="control-btn know" disabled={!canSave || busy} onClick={save}>
            <Icon name="check" /> {busy ? 'Saving…' : 'Save'}
          </button>

          {handMade && (
            <button type="button" className="control-btn" disabled={busy} onClick={reset}>
              <Icon name="refresh" /> Undo, and let the resolver decide
            </button>
          )}

          <button type="button" className="control-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default TokenEditor;
