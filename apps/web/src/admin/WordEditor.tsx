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
import { useNavigate, useParams } from 'react-router-dom';
import type { WordInput } from '@georgian/shared/contract';
import type { Word } from '@georgian/shared/types';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from '@/components/ui/page';
import { SearchField } from '@/components/ui/search-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { KNOW_BUTTON } from '../components/StoryReader';
import { api } from '../api/client';
import { kaVerbData, lang, publishedWordData } from '../content/store';
import {
  ADMIN_INPUT_GEO,
  ADMIN_INPUT_NARROW,
  AdminActions,
  AdminCheck,
  AdminError,
  AdminField,
  AdminGrid,
  AdminHead,
  AdminHint,
  AdminIconButton,
  AdminInput,
  AdminLabel,
  AdminLinkButton,
  AdminList,
  AdminNote,
  AdminPage,
  AdminRow,
  AdminRowNumber,
  AdminRowWrap,
  AdminSection,
  AdminSectionTitle,
  AdminSub,
  AdminTextarea,
  AdminTitle,
} from './ui';
import { useEdit } from './useAdmin';

/** The part-of-speech tags already in use, so the field offers them rather than free text. */
function usedPartsOfSpeech(words: Word[]): string[] {
  return [...new Set(words.map(word => word.partOfSpeech).filter(Boolean))].sort();
}

interface Draft {
  headword: string;
  english: string;
  definition: string;
  accented: string;
  level: 'A1' | 'A2' | 'B1' | '';
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
      headword: '',
      english: '',
      definition: '',
      accented: '',
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
    headword: word.headword,
    accented: word.accented ?? '',
    english: word.english,
    definition: word.definition,
    level: word.level as '' | 'A1' | 'A2' | 'B1',
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
  const { categories, words } = publishedWordData();
  const { busy, error, run } = useEdit();

  const existing = useMemo(() => words.find(word => word.id === wordId) ?? null, [words, wordId]);
  const [draft, setDraft] = useState<Draft>(() =>
    draftFrom(existing, categories.some(c => c.id === 'story-vocabulary') ? 'story-vocabulary' : categories[0]?.id ?? ''),
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  const partsOfSpeech = useMemo(() => usedPartsOfSpeech(words), [words]);
  const paradigm = draft.verbId ? kaVerbData().verbs.find(verb => verb.id === draft.verbId) ?? null : null;

  if (wordId && !existing) {
    return (
      <Page>
        <Breadcrumb>
          <BreadcrumbLink to="/admin/words">← Words</BreadcrumbLink>
        </Breadcrumb>
        <p className="py-6 text-center text-muted-foreground">There is no word with the id “{wordId}”.</p>
      </Page>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));

  const senses = draft.senses.map(sense => sense.trim()).filter(Boolean);
  const canSave = draft.headword.trim() !== '' && senses.length > 0 && draft.categoryId !== '';

  const save = async () => {
    const payload: WordInput = {
      ...(existing ? { id: existing.id } : {}),
      // The dictionary currently loaded. An editor only ever sees one at a time, so there is
      // nothing to choose here — but the server needs it told, since the id it mints and the
      // snapshot it invalidates both follow from it.
      lang: lang(),
      headword: draft.headword.trim(),
      accented: draft.accented.trim(),
      english: draft.english.trim(),
      definition: draft.definition.trim(),
      level: draft.level,
      partOfSpeech: draft.partOfSpeech.trim(),
      categoryId: draft.categoryId,
      defaultSense: draft.defaultSense,
      verbId: draft.verbId,
      check: draft.check,
      note: draft.note.trim() || null,
      senses,
      ru: null,
      forms: draft.forms
        .filter(form => form.form.trim())
        .map(form => ({ form: form.form.trim(), gram: form.gram.trim(), english: form.english.trim(), accented: '' })),
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
    <AdminPage>
      <Breadcrumb>
        <BreadcrumbLink to="/admin/words">← Words</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>{existing ? existing.headword : 'New word'}</span>
      </Breadcrumb>

      <AdminHead>
        <AdminTitle>{existing ? existing.headword : 'New word'}</AdminTitle>
        {existing && (
          <AdminSub>
            <code>{existing.id}</code> ·{' '}
            {existing.origin === 'core'
              ? 'from the scrape'
              : existing.origin === 'wiktionary'
                ? 'imported from Wiktionary'
                : 'written by hand'}
          </AdminSub>
        )}
      </AdminHead>

      {error && <AdminError>{error}</AdminError>}

      <AdminSection>
        <AdminSectionTitle>The headword</AdminSectionTitle>

        <AdminGrid>
          <AdminField>
            <AdminLabel>Georgian</AdminLabel>
            <AdminInput
              className={ADMIN_INPUT_GEO}
              value={draft.headword}
              onChange={event => set('headword', event.target.value)}
              placeholder="მგელი"
            />
            <AdminHint>
              The headword as it is written. A trailing <code>*</code> or digit marks a homograph and is
              stripped everywhere it is shown.
            </AdminHint>
          </AdminField>

          <AdminField>
            <AdminLabel>Headline gloss</AdminLabel>
            <AdminInput
              value={draft.english}
              onChange={event => set('english', event.target.value)}
              placeholder={senses[0] ?? 'wolf'}
            />
            <AdminHint>Left blank, this becomes the first sense below.</AdminHint>
          </AdminField>

          <AdminField>
            <AdminLabel>Category</AdminLabel>
            <Select value={draft.categoryId} onValueChange={value => set('categoryId', value)}>
              <SelectTrigger className={SELECT}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map(category => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </AdminField>

          <AdminField>
            <AdminLabel>Part of speech</AdminLabel>
            {/* A datalist rather than a Select: the tags in use are suggestions, and a new
                entry must be able to introduce one this dictionary has not seen. */}
            <AdminInput
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
            <AdminHint>
              “Verb” keeps this entry out of the story linker’s nominal peeler, which is what stops a case
              ending being taken off a verb.
            </AdminHint>
          </AdminField>

          <AdminField>
            <AdminLabel>CEFR level</AdminLabel>
            {/* An empty string is not a legal Radix Select value, so "no level" travels as a
                sentinel and is mapped back at both edges. */}
            <Select
              value={draft.level || NO_LEVEL}
              onValueChange={value => set('level', (value === NO_LEVEL ? '' : value) as Draft['level'])}
            >
              <SelectTrigger className={SELECT}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_LEVEL}>None — added by hand</SelectItem>
                <SelectItem value="A1">A1</SelectItem>
                <SelectItem value="A2">A2</SelectItem>
              </SelectContent>
            </Select>
          </AdminField>

          <AdminField>
            <AdminLabel>Georgian definition</AdminLabel>
            <AdminInput
              className={ADMIN_INPUT_GEO}
              value={draft.definition}
              onChange={event => set('definition', event.target.value)}
            />
          </AdminField>
        </AdminGrid>

        <AdminCheck>
          <Checkbox checked={draft.check} onCheckedChange={value => set('check', value === true)} />
          The meaning is a guess and wants verifying
        </AdminCheck>

        <AdminField>
          <AdminLabel>Note</AdminLabel>
          <AdminTextarea
            rows={2}
            value={draft.note}
            onChange={event => set('note', event.target.value)}
            placeholder="Anything a reader of this entry needs told."
          />
        </AdminField>
      </AdminSection>

      <AdminSection>
        <AdminSectionTitle>Meanings</AdminSectionTitle>
        <AdminNote>
          In order. A story token cites a sense by <em>position</em>, so appending is safe and reordering
          changes what every story that cites this word says. The radio picks the one to lead with where a
          story does not pin one.
        </AdminNote>

        <AdminList>
          {draft.senses.map((sense, index) => (
            <AdminRow key={index}>
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5" title={`Lead with sense ${index + 1}`}>
                <input
                  type="radio"
                  name="default-sense"
                  className="accent-primary"
                  checked={(draft.defaultSense ?? 1) === index + 1}
                  onChange={() => set('defaultSense', index + 1 === 1 ? null : index + 1)}
                />
                <AdminRowNumber>{index + 1}</AdminRowNumber>
              </label>
              <AdminInput
                value={sense}
                onChange={event => {
                  const next = [...draft.senses];
                  next[index] = event.target.value;
                  set('senses', next);
                }}
                placeholder="wolf"
              />
              <AdminIconButton
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
                <X className="size-[15px]" aria-hidden="true" />
              </AdminIconButton>
            </AdminRow>
          ))}
        </AdminList>

        <Button variant="control" size="auto" onClick={() => set('senses', [...draft.senses, ''])}>
          Add a meaning
        </Button>
      </AdminSection>

      <AdminSection>
        <AdminSectionTitle>Inflected forms</AdminSectionTitle>
        <AdminNote>
          Spellings confirmed to belong here. This is the story linker’s first index and the only one it
          never guesses from — a form listed here <em>is</em> this lemma. The English column is for a form
          that means something the headword does not say: იყო reads as “was”, under a headword meaning “is”.
          Case forms of a noun need none.
        </AdminNote>

        <AdminList>
          {draft.forms.map((form, index) => (
            <AdminRowWrap key={index}>
              <AdminInput
                className={ADMIN_INPUT_GEO}
                value={form.form}
                onChange={event => {
                  const next = [...draft.forms];
                  next[index] = { ...form, form: event.target.value };
                  set('forms', next);
                }}
                placeholder="მგელმა"
              />
              <AdminInput
                className={ADMIN_INPUT_NARROW}
                value={form.gram}
                onChange={event => {
                  const next = [...draft.forms];
                  next[index] = { ...form, gram: event.target.value };
                  set('forms', next);
                }}
                placeholder="erg"
                aria-label="Grammatical label"
              />
              <AdminInput
                value={form.english}
                onChange={event => {
                  const next = [...draft.forms];
                  next[index] = { ...form, english: event.target.value };
                  set('forms', next);
                }}
                placeholder="English, only if it differs"
                aria-label="What this form means"
              />
              <AdminIconButton
                aria-label={`Remove form ${form.form || index + 1}`}
                onClick={() =>
                  set(
                    'forms',
                    draft.forms.filter((_, at) => at !== index),
                  )
                }
              >
                <X className="size-[15px]" aria-hidden="true" />
              </AdminIconButton>
            </AdminRowWrap>
          ))}
        </AdminList>

        <Button
          variant="control"
          size="auto"
          onClick={() => set('forms', [...draft.forms, { form: '', gram: '', english: '' }])}
        >
          Add a form
        </Button>
      </AdminSection>

      <AdminSection>
        <AdminSectionTitle>Paradigm</AdminSectionTitle>
        <AdminNote>
          The conjugation table this headword claims, for the entries that have one. Claiming a paradigm is
          what lets the story linker resolve all 66 of its conjugated forms to this word.
        </AdminNote>

        {paradigm ? (
          <p className={PICKED}>
            <span className="text-base font-semibold">{paradigm.present3sg || paradigm.verbalNoun}</span>
            <span className="flex-1 text-[13.5px] text-muted-foreground">{paradigm.english}</span>
            <AdminLinkButton onClick={() => set('verbId', null)}>Clear</AdminLinkButton>
          </p>
        ) : (
          <AdminHint>No paradigm claimed.</AdminHint>
        )}

        <ParadigmPicker onPick={id => set('verbId', id)} />
      </AdminSection>

      <AdminActions>
        <Button
          variant="control"
          size="auto"
          className={KNOW_BUTTON}
          disabled={!canSave || busy}
          onClick={save}
        >
          <Check /> {busy ? 'Saving…' : existing ? 'Save changes' : 'Create word'}
        </Button>

        {existing && !confirmDelete && (
          <Button variant="dangerOutline" size="auto" disabled={busy} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        )}
        {existing && confirmDelete && (
          <span className="flex flex-wrap items-center gap-2.5 text-sm">
            Delete “{existing.headword}”?
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

const NO_LEVEL = '__none__';
const SELECT =
  'h-auto w-full rounded-sm border border-border-strong bg-background py-2.5 text-sm shadow-none data-[size=default]:h-auto';
/* The paradigm currently claimed, outlined in the accent colour: it is a decision that has
   been made, not a field waiting to be filled. */
const PICKED =
  'flex flex-wrap items-baseline gap-2.5 rounded-sm border border-primary bg-[color-mix(in_srgb,var(--primary)_6%,var(--card))] px-3 py-2';

/** A search over the paradigms, by their English or their 3sg. */
function ParadigmPicker({ onPick }: { onPick: (id: string) => void }) {
  const [term, setTerm] = useState('');
  const verbs = kaVerbData().verbs;

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
    <div className="mb-2">
      <SearchField
        wrapperClassName="mt-2"
        placeholder="Search paradigms…"
        value={term}
        onChange={event => setTerm(event.target.value)}
      />

      {term.trim() !== '' && (
        <ul className="mt-2 max-h-65 list-none overflow-y-auto rounded-sm border border-border">
          {results.length === 0 && (
            <li className="px-3 py-2.5 text-[13px] text-faint">Nothing matches “{term}”.</li>
          )}
          {results.map(verb => (
            <li key={verb.id}>
              <button
                type="button"
                className={PICKER_RESULT}
                onClick={() => {
                  onPick(verb.id);
                  setTerm('');
                }}
              >
                <span className="text-base font-semibold">{verb.present3sg || verb.verbalNoun}</span>
                <span className="flex-1 text-[13.5px] text-muted-foreground">{verb.english}</span>
                <span className="text-[11.5px] text-faint">{verb.transitivity}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const PICKER_RESULT =
  'flex w-full cursor-pointer flex-wrap items-baseline gap-2.5 border-0 bg-transparent px-3 py-2 text-left ' +
  'font-[inherit] text-foreground hover:bg-muted';

export default WordEditor;
