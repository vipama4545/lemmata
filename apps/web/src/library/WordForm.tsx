// A word of your own.
//
// The same record the dictionary's entries are: headword, senses, forms, grammar. It goes into
// the same table and is read by the same everything, including the search box, the flashcard
// deck, the Anki export and the resolver that links your own stories. That last one is why this
// form is longer than "a word and what it means", and why the forms list is worth the trouble:
//
//   the headword    is what you look up and what you study.
//   the forms       are what a *text* contains. Georgian and Russian both bury the headword
//                   under case endings, so a story full of მგელს and волка finds nothing at all
//                   unless somebody has said which lemma those belong to.
//
// A word added with no forms is still a card in your deck. A word added with them turns up in
// the next thing you paste in, and the form is arranged to say so.

import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Lang } from '@georgian/shared/grammar';
import type { WordForm as InflectedForm } from '@georgian/shared/types';
import { Check, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchField } from '@/components/ui/search-field';
import { api } from '../api/client';
import { content, lang, langName, myWords, wordData } from '../content/store';
import { useLibraryEdit, useSignedIn } from './store';
import {
  Actions,
  EditorPage,
  ErrorLine,
  Field,
  Grid,
  Head,
  Hint,
  INPUT_TARGET,
  Input,
  Label,
  LibraryCrumb,
  LinkButton,
  Note,
  Section,
  SectionTitle,
  SignInFirst,
  Sub,
  Textarea,
  Title,
  libraryHref,
} from './ui';

/** A `Select` cannot hold an empty value, so the two that mean "nothing" need names. */
const NONE = '__none__';

/** What the grammar boxes offer. Russian only: Georgian's nominal grammar is not modelled. */
const GENDERS = [
  { value: 'm', label: 'masculine' },
  { value: 'f', label: 'feminine' },
  { value: 'n', label: 'neuter' },
  { value: 'pl', label: 'plural only' },
];

const DECLENSIONS = [
  { value: '1', label: '1st (стол, окно)' },
  { value: '2', label: '2nd (мама)' },
  { value: '3', label: '3rd (ночь)' },
  { value: 'indecl', label: 'indeclinable' },
  { value: 'adj', label: 'adjectival' },
];

/** The gram labels these two languages actually use, as a starting point rather than a list. */
const GRAM_HINTS: Record<Lang, string[]> = {
  ka: ['erg', 'dat', 'gen', 'ins', 'adv', 'voc', 'pl', 'dat.pl', 'gen.pl'],
  ru: ['gen.sg', 'dat.sg', 'acc.sg', 'ins.sg', 'pre.sg', 'nom.pl', 'gen.pl', 'dat.pl', 'ins.pl', 'pre.pl'],
};

interface Draft {
  headword: string;
  accented: string;
  english: string;
  senses: string[];
  definition: string;
  level: string;
  partOfSpeech: string;
  categoryId: string;
  verbId: string | null;
  note: string;
  forms: InflectedForm[];
  gender: string;
  animacy: string;
  declension: string;
  stressPattern: string;
}

export default function WordForm() {
  const signedIn = useSignedIn();
  const { wordId } = useParams<{ wordId: string }>();
  if (!signedIn) return <SignInFirst what="words of your own" />;

  // Keyed, so going from one of your words to another remounts the form rather than keeping the
  // first one's draft. The route pattern is the same for both, so React would otherwise reuse
  // the component, and `useState`'s initialiser runs once. You would be editing кот under a
  // heading that says соба́ка.
  return <Form key={wordId ?? 'new'} />;
}

function Form() {
  const { wordId } = useParams<{ wordId: string }>();
  const navigate = useNavigate();
  const { busy, error, run } = useLibraryEdit();

  const word = myWords().find(entry => entry.id === wordId) ?? null;
  const categories = wordData().categories;

  const [draft, setDraft] = useState<Draft>(() => ({
    headword: word?.headword ?? '',
    accented: word?.accented ?? '',
    english: word?.english ?? '',
    senses: word?.senses.map(sense => sense.english) ?? [''],
    definition: word?.definition ?? '',
    level: word?.level ?? '',
    partOfSpeech: word?.partOfSpeech ?? '',
    categoryId: word?.categoryId ?? '',
    verbId: word?.verbId ?? null,
    note: word?.note ?? '',
    forms: word?.forms ? word.forms.map(form => ({ ...form })) : [],
    gender: word?.ru?.gender ?? '',
    animacy: word?.ru?.animacy ?? '',
    declension: word?.ru?.declension ?? '',
    stressPattern: word?.ru?.stressPattern ?? '',
  }));
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (wordId && !word) {
    return (
      <EditorPage>
        <LibraryCrumb />
        <p className="py-6 text-center text-muted-foreground">There is no word of yours with that address.</p>
      </EditorPage>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft(current => ({ ...current, [key]: value }));

  const russian = lang() === 'ru';

  const save = async () => {
    const senses = draft.senses.map(sense => sense.trim()).filter(Boolean);
    if (!draft.headword.trim()) return;
    if (!senses.length) return;

    const result = await run(() =>
      api.library.saveWord({
        ...(wordId ? { id: wordId } : {}),
        lang: lang(),
        headword: draft.headword.trim(),
        accented: draft.accented.trim(),
        english: draft.english.trim(),
        definition: draft.definition.trim(),
        level: draft.level as 'A1' | 'A2' | 'B1' | '',
        partOfSpeech: draft.partOfSpeech.trim(),
        categoryId: draft.categoryId,
        defaultSense: null,
        verbId: draft.verbId,
        check: false,
        note: draft.note.trim() || null,
        senses,
        forms: draft.forms
          .filter(form => form.form.trim())
          .map(form => ({
            form: form.form.trim(),
            gram: form.gram?.trim() ?? '',
            english: form.english?.trim() ?? '',
            accented: form.accented?.trim() ?? '',
          })),
        ru: russian
          ? {
              gender: draft.gender as 'm' | 'f' | 'n' | 'pl' | '',
              animacy: draft.animacy as 'anim' | 'inanim' | '',
              declension: draft.declension as '1' | '2' | '3' | 'indecl' | 'adj' | '',
              stressPattern: draft.stressPattern.trim(),
              check: false,
            }
          : null,
      }),
    );

    if (result && !wordId) navigate(libraryHref(`/words/${encodeURIComponent(result.id)}`), { replace: true });
  };

  const remove = async () => {
    if (!wordId) return;
    const done = await run(() => api.library.deleteWord({ id: wordId }));
    if (done) navigate(libraryHref(), { replace: true });
  };

  const ready = draft.headword.trim() !== '' && draft.senses.some(sense => sense.trim() !== '');

  return (
    <EditorPage>
      <LibraryCrumb>{word ? word.headword : 'New word'}</LibraryCrumb>

      <Head>
        <Title>{word ? word.accented || word.headword : 'New word'}</Title>
        <Sub>
          {word
            ? 'Yours alone: searched, studied and linked into your own stories, and invisible to everybody else.'
            : `A ${langName()} word you have met, kept against your account.`}
        </Sub>
      </Head>

      {error && <ErrorLine>{error}</ErrorLine>}

      <Section>
        <SectionTitle>The word</SectionTitle>
        <Grid>
          <Field>
            <Label>{langName()}</Label>
            <Input
              className={INPUT_TARGET}
              value={draft.headword}
              autoFocus
              onChange={event => set('headword', event.target.value)}
              placeholder={russian ? 'кот' : 'კატა'}
            />
            <Hint>
              {russian
                ? 'Without the stress mark. This is what a text is matched against, and кот is what stands in one.'
                : 'The dictionary form, exactly as it is spelled.'}
            </Hint>
          </Field>

          {russian && (
            <Field>
              <Label>With the stress</Label>
              <Input
                className={INPUT_TARGET}
                value={draft.accented}
                onChange={event => set('accented', event.target.value)}
                placeholder="ко́т"
              />
              <Hint>Shown on screen and read aloud. Never searched.</Hint>
            </Field>
          )}

          <Field>
            <Label>Part of speech</Label>
            <Input
              value={draft.partOfSpeech}
              list="library-pos"
              onChange={event => set('partOfSpeech', event.target.value)}
              placeholder="Noun"
            />
            <PartsOfSpeech />
          </Field>

          <Field>
            <Label>Level</Label>
            <Select value={draft.level || NONE} onValueChange={value => set('level', value === NONE ? '' : value)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not graded</SelectItem>
                <SelectItem value="A1">A1</SelectItem>
                <SelectItem value="A2">A2</SelectItem>
                <SelectItem value="B1">B1</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <Label>Filed under</Label>
            <Select
              value={draft.categoryId || NONE}
              onValueChange={value => set('categoryId', value === NONE ? '' : value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>My words</SelectItem>
                {categories.map(category => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                    {category.mine ? ' (yours)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Hint>
              One of the dictionary's shelves is fine. Its own count does not move, and the card
              you see includes your own.
            </Hint>
          </Field>
        </Grid>
      </Section>

      <Senses draft={draft} set={set} />

      <Section>
        <SectionTitle>Its forms</SectionTitle>
        <Note className="mb-3">
          What this word looks like in a sentence. Every form listed here is one the resolver will
          recognise in your own stories and point back at this entry, which is the difference
          between a text that finds it and one that does not.
        </Note>
        <Forms draft={draft} set={set} />
      </Section>

      {russian && (
        <Section>
          <SectionTitle>Grammar</SectionTitle>
          <Note className="mb-3">
            Optional, and only for nouns and adjectives. It is what lets the entry say “masculine,
            animate” where the dictionary's own do.
          </Note>
          <Grid>
            <Field>
              <Label>Gender</Label>
              <Select
                value={draft.gender || NONE}
                onValueChange={value => set('gender', value === NONE ? '' : value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not set</SelectItem>
                  {GENDERS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <Label>Animacy</Label>
              <Select
                value={draft.animacy || NONE}
                onValueChange={value => set('animacy', value === NONE ? '' : value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not set</SelectItem>
                  <SelectItem value="anim">animate</SelectItem>
                  <SelectItem value="inanim">inanimate</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <Label>Declension</Label>
              <Select
                value={draft.declension || NONE}
                onValueChange={value => set('declension', value === NONE ? '' : value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not set</SelectItem>
                  {DECLENSIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <Label>Stress pattern</Label>
              <Input
                className="max-w-40"
                value={draft.stressPattern}
                onChange={event => set('stressPattern', event.target.value)}
                placeholder="a"
              />
              <Hint>Zaliznyak's letter, a–f. Leave it empty if you do not know it.</Hint>
            </Field>
          </Grid>
        </Section>
      )}

      <Paradigm draft={draft} set={set} />

      <Section>
        <SectionTitle>Notes</SectionTitle>
        <Field>
          <Label>Definition in {langName()}</Label>
          <Textarea
            className={INPUT_TARGET}
            rows={2}
            value={draft.definition}
            onChange={event => set('definition', event.target.value)}
          />
        </Field>
        <Field>
          <Label>Your own note</Label>
          <Textarea rows={2} value={draft.note} onChange={event => set('note', event.target.value)} />
        </Field>
      </Section>

      <Actions>
        <Button
          variant="control"
          size="auto"
          className="font-semibold"
          disabled={busy || !ready}
          onClick={save}
        >
          <Check /> {busy ? 'Saving…' : wordId ? 'Save' : 'Add it'}
        </Button>

        {wordId && !confirmDelete && (
          <Button variant="dangerOutline" size="auto" disabled={busy} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        )}
        {wordId && confirmDelete && (
          <span className="flex flex-wrap items-center gap-2.5 text-sm">
            Delete this word? Anywhere it was linked goes back to being plain text.
            <Button variant="dangerOutline" size="auto" disabled={busy} onClick={remove}>
              Yes, delete
            </Button>
            <Button variant="control" size="auto" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </span>
        )}
      </Actions>
    </EditorPage>
  );
}

type Setter = <K extends keyof Draft>(key: K, value: Draft[K]) => void;

/**
 * Every part of speech the loaded dictionary uses, as suggestions.
 *
 * Built from the content rather than written out here, so it cannot drift from the convention
 * the lexicon actually follows, and so a Russian entry is not offered Georgian's labels.
 */
function PartsOfSpeech() {
  const options = useMemo(() => {
    const seen = new Set<string>();
    for (const word of content().words.words) {
      if (word.partOfSpeech) seen.add(word.partOfSpeech);
    }
    return [...seen].sort();
  }, []);

  return (
    <datalist id="library-pos">
      {options.map(option => (
        <option key={option} value={option} />
      ))}
    </datalist>
  );
}

/* ------------------------------------------------------------------- senses */

/**
 * What it means, in order.
 *
 * A list rather than one box because the order is load-bearing: a story token cites a sense by
 * its *position*, so "1" and "2" are addresses rather than presentation. The first is the one
 * that leads.
 */
function Senses({ draft, set }: { draft: Draft; set: Setter }) {
  const update = (index: number, value: string) =>
    set('senses', draft.senses.map((sense, at) => (at === index ? value : sense)));

  return (
    <Section>
      <SectionTitle>What it means</SectionTitle>
      <div className="flex flex-col gap-2">
        {draft.senses.map((sense, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-sm text-faint tabular-nums">{index + 1}</span>
            <Input
              value={sense}
              onChange={event => update(index, event.target.value)}
              placeholder={index === 0 ? 'cat' : 'another meaning'}
            />
            {draft.senses.length > 1 && (
              <Button
                variant="control"
                size="auto-sm"
                aria-label="Remove this meaning"
                onClick={() => set('senses', draft.senses.filter((_, at) => at !== index))}
              >
                <X />
              </Button>
            )}
          </div>
        ))}
      </div>

      <LinkButton className="mt-3" onClick={() => set('senses', [...draft.senses, ''])}>
        Add another meaning
      </LinkButton>

      <Field className="mt-4">
        <Label>Headline gloss</Label>
        <Input
          value={draft.english}
          onChange={event => set('english', event.target.value)}
          placeholder={draft.senses[0]?.trim() || 'the first meaning'}
        />
        <Hint>What a card and a search result show. Left empty, it is the first meaning above.</Hint>
      </Field>
    </Section>
  );
}

/* -------------------------------------------------------------------- forms */

function Forms({ draft, set }: { draft: Draft; set: Setter }) {
  const russian = lang() === 'ru';

  const update = (index: number, patch: Partial<InflectedForm>) =>
    set('forms', draft.forms.map((form, at) => (at === index ? { ...form, ...patch } : form)));

  return (
    <>
      {draft.forms.length === 0 ? (
        <p className="mb-3 text-[13px] text-faint">
          None yet. Without them this entry is still searched and still studied. It is only texts
          that will not find it under an ending.
        </p>
      ) : (
        <ul className="mb-3 flex list-none flex-col gap-2">
          {draft.forms.map((form, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2">
              <Input
                className={`${INPUT_TARGET} w-44`}
                value={form.form}
                onChange={event => update(index, { form: event.target.value })}
                placeholder={russian ? 'кота́' : 'კატას'}
              />
              <Input
                className="w-32"
                list="library-gram"
                value={form.gram ?? ''}
                onChange={event => update(index, { gram: event.target.value })}
                placeholder={russian ? 'gen.sg' : 'dat'}
              />
              <Input
                className="min-w-40 flex-1"
                value={form.english ?? ''}
                onChange={event => update(index, { english: event.target.value })}
                placeholder="what this form means, if the headword does not say it"
              />
              <Button
                variant="control"
                size="auto-sm"
                aria-label="Remove this form"
                onClick={() => set('forms', draft.forms.filter((_, at) => at !== index))}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <datalist id="library-gram">
        {GRAM_HINTS[lang()].map(label => (
          <option key={label} value={label} />
        ))}
      </datalist>

      <Button
        variant="control"
        size="auto-sm"
        onClick={() => set('forms', [...draft.forms, { form: '', gram: '', english: '', accented: '' }])}
      >
        <Plus /> Add a form
      </Button>
    </>
  );
}

/* ----------------------------------------------------------------- paradigm */

/**
 * The conjugation table this entry claims, if any.
 *
 * A pointer at one of the dictionary's paradigms rather than a table of your own. Writing a
 * Georgian paradigm is sixty-six cells and a Russian one is a stress rule. Neither is a thing to
 * ask of somebody who wants to write down a verb they heard, while finding the one that already
 * exists takes a search box. An entry that claims one gets the whole conjugation table on its
 * page.
 */
function Paradigm({ draft, set }: { draft: Draft; set: Setter }) {
  const [term, setTerm] = useState('');
  const verbs = content().verbs;

  const results = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return [];
    if (verbs.kind === 'ka') {
      return verbs.verbs
        .filter(
          verb =>
            verb.english.toLowerCase().includes(needle) ||
            verb.present3sg.includes(term.trim()) ||
            verb.verbalNoun.includes(term.trim()),
        )
        .slice(0, 15)
        .map(verb => ({ id: verb.id, target: verb.present3sg || verb.verbalNoun, english: verb.english }));
    }
    return verbs.verbs
      .filter(verb => verb.english.toLowerCase().includes(needle) || verb.infinitive.includes(term.trim()))
      .slice(0, 15)
      .map(verb => ({ id: verb.id, target: verb.accented || verb.infinitive, english: verb.english }));
  }, [verbs, term]);

  const claimed = draft.verbId
    ? verbs.kind === 'ka'
      ? verbs.verbs.find(verb => verb.id === draft.verbId)?.present3sg
      : verbs.verbs.find(verb => verb.id === draft.verbId)?.infinitive
    : null;

  return (
    <Section>
      <SectionTitle>Conjugation</SectionTitle>
      <Note className="mb-3">
        For a verb: point this entry at a paradigm the dictionary already has, and its page shows
        the whole table. Leave it alone for everything else.
      </Note>

      {draft.verbId ? (
        <p className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-base font-semibold">{claimed ?? draft.verbId}</span>
          <LinkButton onClick={() => set('verbId', null)}>Clear</LinkButton>
        </p>
      ) : (
        <>
          <SearchField
            placeholder="Search paradigms…"
            value={term}
            onChange={event => setTerm(event.target.value)}
          />

          {term.trim() !== '' && (
            <ul className="mt-2 max-h-65 list-none overflow-y-auto rounded-sm border border-border">
              {results.length === 0 && (
                <li className="px-3 py-2.5 text-[13px] text-faint">Nothing matches “{term}”.</li>
              )}
              {results.map(result => (
                <li key={result.id}>
                  <button
                    type="button"
                    className="flex w-full cursor-pointer flex-wrap items-baseline gap-2.5 border-0 bg-transparent px-3 py-2 text-left font-[inherit] text-foreground hover:bg-muted"
                    onClick={() => {
                      set('verbId', result.id);
                      setTerm('');
                    }}
                  >
                    <span className="text-base font-semibold">{result.target}</span>
                    <span className="flex-1 text-[13.5px] text-muted-foreground">{result.english}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}
