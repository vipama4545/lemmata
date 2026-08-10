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

import { useMemo, useState } from 'react';
import type { StoryLinkResult } from '@georgian/shared/contract';
import type { Story, StoryToken, Word } from '@georgian/shared/types';
import { Check, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { KNOW_BUTTON } from '../components/StoryReader';
import { api } from '../api/client';
import { wordData } from '../content/store';
import {
  AdminActions,
  AdminBadge,
  AdminCheck,
  AdminError,
  AdminField,
  AdminHint,
  AdminInput,
  AdminLabel,
  AdminNote,
} from './ui';
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
    <Dialog open onOpenChange={next => { if (!next) onClose(); }}>
      <DialogContent className="max-w-140 gap-0 rounded-lg p-6 text-left">
        <DialogHeader className="mb-4.5 text-left">
          <DialogTitle className="text-[26px] font-bold">{token.form}</DialogTitle>
          <DialogDescription className="text-[12.5px] text-faint">
            paragraph {paragraph + 1}, word {position + 1}
            {occurrences > 1 && ` · ${occurrences} occurrences of this spelling`}
          </DialogDescription>
          <p className="mt-2 flex flex-wrap gap-1.5">
            {handMade ? (
              <AdminBadge admin>set by hand · {token.via}</AdminBadge>
            ) : (
              <AdminBadge>
                {token.via === 'unresolved' ? 'nothing matched' : `matched by ${token.via}`}
              </AdminBadge>
            )}
            {token.check && <AdminBadge flagged>a guess</AdminBadge>}
          </p>
        </DialogHeader>

        {error && <AdminError>{error}</AdminError>}

        <div className="mb-4.5 grid gap-2" role="radiogroup" aria-label="What this word is">
          {(
            [
              ['word', 'A dictionary word', 'Links to a lexicon entry and one of its meanings.'],
              ['name', 'A name', 'Glossed here only. Stays out of the dictionary.'],
              ['plain', 'Not a word', 'Left as plain text on purpose, rather than by failure.'],
            ] as [Choice, string, string][]
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className={cn(
                'grid cursor-pointer grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5 rounded-sm border px-3 py-2.5',
                choice === value
                  ? 'border-primary bg-[color-mix(in_srgb,var(--primary)_6%,transparent)]'
                  : 'border-border',
              )}
            >
              <input
                type="radio"
                name="token-choice"
                className="row-span-2 self-center accent-primary"
                checked={choice === value}
                onChange={() => setChoice(value)}
              />
              <span className="text-sm font-semibold">{label}</span>
              <span className="col-start-2 text-[12.5px] text-muted-foreground">{hint}</span>
            </label>
          ))}
        </div>

        {choice === 'word' && (
          <div className="mb-4">
            <WordPicker value={picked} suggestions={suggestions} onPick={setPicked} clearable={false} autoFocus />

            {picked && (
              <>
                <div className="block">
                  <AdminLabel>Which meaning</AdminLabel>
                  <ul className="grid list-none gap-1">
                    {picked.senses.map((item, index) => (
                      <li key={item.id}>
                        <label
                          className={cn(
                            'flex cursor-pointer items-baseline gap-2 rounded-sm border px-2.5 py-1.5 text-[13.5px]',
                            sense === index + 1
                              ? 'border-primary bg-[color-mix(in_srgb,var(--primary)_6%,transparent)]'
                              : 'border-transparent hover:bg-muted',
                          )}
                        >
                          <input
                            type="radio"
                            name="token-sense"
                            className="accent-primary"
                            checked={sense === index + 1}
                            onChange={() => setSense(index + 1)}
                          />
                          <span className="text-xs tabular-nums text-faint">{index + 1}</span>
                          <span>{item.english}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>

                <AdminField className="mt-3">
                  <AdminLabel>Grammatical label</AdminLabel>
                  <AdminInput
                    value={gram}
                    onChange={event => setGram(event.target.value)}
                    placeholder="erg, dat.pl, Aorist 3sg"
                  />
                  <AdminHint>How this form differs from the headword. Shown on the card.</AdminHint>
                </AdminField>
              </>
            )}
          </div>
        )}

        {choice === 'name' && (
          <div className="mb-4">
            <AdminField>
              <AdminLabel>Who or what this is</AdminLabel>
              <AdminInput
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="Nif-Nif, one of the three pigs"
                autoFocus
              />
              <AdminHint>
                Shown on the card in place of a definition. Case forms are named separately — ნიფ-ნიფმა can
                read “Nif-Nif (ergative)” — because nothing derives that from the nominative.
              </AdminHint>
            </AdminField>
          </div>
        )}

        {choice === 'plain' && (
          <AdminNote>
            This occurrence will be left as ordinary text, and marked as a decision rather than a failure —
            so it stops showing up in the unresolved list and survives every relink.
          </AdminNote>
        )}

        <AdminField>
          <AdminLabel>Note</AdminLabel>
          <AdminInput
            value={comment}
            onChange={event => setComment(event.target.value)}
            placeholder="Why, for whoever reads this in a year."
          />
        </AdminField>

        <AdminCheck className={BOXED}>
          <Checkbox className="mt-0.5" checked={check} onCheckedChange={value => setCheck(value === true)} />
          <span>
            Still a guess — come back to this
            <AdminHint>
              The same flag the linker sets on its own uncertain matches, so a doubt you have
              lands in the same list rather than needing the wrong link left in place to record it.
            </AdminHint>
          </span>
        </AdminCheck>

        {occurrences > 1 && (
          <AdminCheck className={BOXED}>
            <Checkbox
              className="mt-0.5"
              checked={everywhere}
              onCheckedChange={value => setEverywhere(value === true)}
            />
            Apply to all {occurrences} occurrences of “{token.form}” in this story
          </AdminCheck>
        )}

        <AdminActions>
          <Button variant="control" size="auto" className={KNOW_BUTTON} disabled={!canSave || busy} onClick={save}>
            <Check /> {busy ? 'Saving…' : 'Save'}
          </Button>

          {handMade && (
            <Button variant="control" size="auto" disabled={busy} onClick={reset}>
              <RotateCcw /> Undo, and let the resolver decide
            </Button>
          )}

          <Button variant="control" size="auto" onClick={onClose}>
            Cancel
          </Button>
        </AdminActions>
      </DialogContent>
    </Dialog>
  );
}

/** The two flags at the foot get a box each: they modify the save rather than describe it. */
const BOXED = 'mb-2.5 items-start rounded-sm border border-border-strong px-3 py-2.5';

export default TokenEditor;
