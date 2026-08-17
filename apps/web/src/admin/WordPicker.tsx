// Finding one lexicon entry, by headword or by English.
//
// Used wherever something has to name a word: pinning a story token to an entry, and pointing
// a headword at a paradigm. It searches the snapshot rather than the server, because the whole
// word list is already in this browser — filtered as you type it is instant, and a round trip
// per keystroke would be slower and could fail. The snapshot is one language's, which is what
// keeps this from ever offering a Georgian entry to a Russian story.

import { useMemo, useState } from 'react';
import type { Word } from '@georgian/shared/types';
import { SearchField } from '@/components/ui/search-field';
import { cn } from '@/lib/utils';
import { langName } from '../content/store';
import { searchWords } from './search';
import { AdminHint, AdminLabel, AdminLinkButton } from './ui';

interface WordPickerProps {
  /**
   * The entries to search.
   *
   * Passed in rather than read here, because who may cite what depends on whose story is being
   * edited and this component cannot know that. The default is the published dictionary, which
   * is the only safe one: a caller that wants a reader's own words as well has to say so.
   */
  words: Word[];
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

/** The entry currently chosen, outlined in the accent colour: a decision, not an empty field. */
export const PICKED =
  'flex flex-wrap items-baseline gap-2.5 rounded-sm border border-primary bg-[color-mix(in_srgb,var(--primary)_6%,var(--card))] px-3 py-2';
export const PICKED_GEO = 'text-base font-semibold';
export const PICKED_EN = 'flex-1 text-[13.5px] text-muted-foreground';

function WordPicker({
  words,
  onPick,
  value = null,
  label = 'Dictionary entry',
  suggestions = [],
  clearable = true,
  autoFocus = false,
}: WordPickerProps) {
  const [term, setTerm] = useState('');

  const results = useMemo(() => searchWords(words, term), [words, term]);

  return (
    <div className="mb-2">
      <div className="flex items-baseline justify-between gap-2">
        <AdminLabel>{label}</AdminLabel>
        {value && clearable && <AdminLinkButton onClick={() => onPick(null)}>Clear</AdminLinkButton>}
      </div>

      {value && (
        <p className={PICKED}>
          <span className={PICKED_GEO}>{value.headword}</span>
          <span className={PICKED_EN}>{value.english}</span>
        </p>
      )}

      {suggestions.length > 0 && !term && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <AdminHint className="mt-0 inline">Also claimed this spelling</AdminHint>
          {suggestions.map(word => (
            <button
              key={word.id}
              type="button"
              className="flex cursor-pointer items-baseline gap-1.5 rounded-full border border-border-strong bg-card px-2.5 py-[5px] font-[inherit] hover:border-primary"
              onClick={() => onPick(word)}
            >
              <span className="text-sm font-semibold">{word.headword}</span>
              <span className="text-xs text-muted-foreground">{word.english}</span>
            </button>
          ))}
        </div>
      )}

      <SearchField
        wrapperClassName="mt-2"
        placeholder={`Search ${langName()} or English…`}
        value={term}
        autoFocus={autoFocus}
        onChange={event => setTerm(event.target.value)}
      />

      {term.trim() !== '' && (
        <ul className="mt-2 max-h-65 list-none overflow-y-auto rounded-sm border border-border">
          {results.length === 0 && <li className="px-3 py-2.5 text-[13px] text-faint">Nothing matches “{term}”.</li>}
          {results.map(word => (
            <li key={word.id}>
              <button
                type="button"
                className={cn(RESULT, value?.id === word.id && 'bg-muted')}
                onClick={() => {
                  onPick(word);
                  setTerm('');
                }}
              >
                <span className={PICKED_GEO}>{word.headword}</span>
                <span className={PICKED_EN}>{word.english}</span>
                {word.partOfSpeech && <span className="text-[11.5px] text-faint">{word.partOfSpeech}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const RESULT =
  'flex w-full cursor-pointer flex-wrap items-baseline gap-2.5 border-0 bg-transparent px-3 py-2 text-left font-[inherit] text-foreground hover:bg-muted';

export default WordPicker;
