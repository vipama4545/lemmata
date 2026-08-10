// Finding one lexicon entry, by headword or by English.
//
// Used wherever something has to name a word: pinning a story token to an entry, and pointing
// a headword at a paradigm. It searches the snapshot rather than the server, because the whole
// word list is already in this browser — filtered as you type it is instant, and a round trip
// per keystroke would be slower and could fail. The snapshot is one language's, which is what
// keeps this from ever offering a Georgian entry to a Russian story.

import { useMemo, useState } from 'react';
import type { Word } from '@georgian/shared/types';
import { langName, wordData } from '../content/store';
import { searchWords } from './search';
import Icon from '../components/Icon';

interface WordPickerProps {
  /** Called with the chosen entry, or null when the Clear button is used. */
  onPick: (word: Word | null) => void;
  /** What is currently chosen, shown above the field. */
  value?: Word | null;
  label?: string;
  /** Offered as one-tap choices above the search — the resolver's own shortlist. */
  suggestions?: Word[];
  /** Whether to offer a "no entry" button at all. */
  clearable?: boolean;
  autoFocus?: boolean;
}

function WordPicker({
  onPick,
  value = null,
  label = 'Dictionary entry',
  suggestions = [],
  clearable = true,
  autoFocus = false,
}: WordPickerProps) {
  const [term, setTerm] = useState('');
  const { words } = wordData();

  const results = useMemo(() => searchWords(words, term), [words, term]);

  return (
    <div className="admin-picker">
      <div className="admin-field-head">
        <span className="admin-label">{label}</span>
        {value && clearable && (
          <button type="button" className="admin-link-btn" onClick={() => onPick(null)}>
            Clear
          </button>
        )}
      </div>

      {value && (
        <p className="admin-picker-current">
          <span className="admin-picker-geo">{value.headword}</span>
          <span className="admin-picker-en">{value.english}</span>
        </p>
      )}

      {suggestions.length > 0 && !term && (
        <div className="admin-picker-suggestions">
          <span className="admin-hint">Also claimed this spelling</span>
          {suggestions.map(word => (
            <button key={word.id} type="button" className="admin-chip" onClick={() => onPick(word)}>
              <span className="admin-chip-geo">{word.headword}</span>
              <span className="admin-chip-en">{word.english}</span>
            </button>
          ))}
        </div>
      )}

      <div className="search-field admin-picker-field">
        <Icon name="search" size={16} />
        <input
          type="text"
          className="search-input"
          placeholder={`Search ${langName()} or English…`}
          value={term}
          autoFocus={autoFocus}
          onChange={event => setTerm(event.target.value)}
        />
      </div>

      {term.trim() !== '' && (
        <ul className="admin-picker-results">
          {results.length === 0 && <li className="admin-picker-empty">Nothing matches “{term}”.</li>}
          {results.map(word => (
            <li key={word.id}>
              <button
                type="button"
                className={`admin-picker-result${value?.id === word.id ? ' is-current' : ''}`}
                onClick={() => {
                  onPick(word);
                  setTerm('');
                }}
              >
                <span className="admin-picker-geo">{word.headword}</span>
                <span className="admin-picker-en">{word.english}</span>
                {word.partOfSpeech && <span className="admin-picker-pos">{word.partOfSpeech}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default WordPicker;
