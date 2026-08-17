// One Russian verb, as a rule rather than a table.
//
// Its Georgian counterpart, VerbEditor.tsx, is a grid of 66 boxes because that is what a
// Georgian paradigm is: 66 facts, each of which somebody has to have written down. A Russian
// verb is not stored that way and must not be edited that way — the twenty-odd forms follow
// from a class, two or three stems and a stress pattern, and typing them out by hand would
// throw away the derivation that keeps them consistent. So the form here is the *rule*, and
// the paradigm underneath it is a preview: it moves as you type, and every cell of it says
// whether the rule produced it or a person did.
//
// The overrides table at the bottom is the escape hatch, and it has three states rather than
// two, which is the one thing worth reading twice. A blank input means "the rule is right".
// A filled one means "the rule is wrong, use this". Marking a cell *absent* — the third
// state — means "this verb has no such form at all", which is a different claim from either:
// the gerund rule happily builds ждя from ждать, and no one has ever said it. See the note in
// `conjugate()` for why an empty override is what removes a cell.

import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import type { RuVerbInput } from '@georgian/shared/contract';
import {
  RU_ASPECTS,
  RU_CLASSES,
  RU_CLASS_BY_ID,
  RU_CONJUGATIONS,
  RU_GROUP_LABELS,
  RU_SLOTS,
  accented,
  conjugate,
  presentLabel,
} from '@georgian/shared/grammar/ru';
import type {
  RuAspect,
  RuClassId,
  RuForm,
  RuSlot,
  RuSlotKey,
  RuStressPast,
  RuStressPresent,
  RuVerb,
  RuVerbRule,
} from '@georgian/shared/types';
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
import { cn } from '@/lib/utils';
import { KNOW_BUTTON } from '../components/StoryReader';
import { AspectTag } from '../components/RuVerbList';
import { api } from '../api/client';
import { ruVerbData } from '../content/store';
import {
  AdminActions,
  AdminCheck,
  AdminError,
  AdminField,
  AdminGrid,
  AdminHead,
  AdminHint,
  AdminInput,
  AdminLabel,
  AdminNote,
  AdminPage,
  AdminSection,
  AdminSectionTitle,
  AdminSub,
  AdminTextarea,
  AdminTitle,
  AdminWarning,
} from './ui';
import { useEdit } from './useAdmin';

/** The cases a verb can govern. Nominative is the subject's and is never one of these. */
const CASES = [
  { id: 'acc', label: 'Accusative' },
  { id: 'gen', label: 'Genitive' },
  { id: 'dat', label: 'Dative' },
  { id: 'ins', label: 'Instrumental' },
  { id: 'pre', label: 'Prepositional' },
];

/** The three present-tense stress patterns, with what each one does to the forms. */
const PRESENT_STRESS: { id: RuStressPresent; label: string; hint: string }[] = [
  { id: 'stem', label: 'Stem', hint: 'чита́ю, чита́ешь, чита́ют — fixed on the stem.' },
  { id: 'ending', label: 'Ending', hint: 'несу́, несёшь, несу́т. This is also what writes the ё.' },
  { id: 'shift', label: 'Shifting', hint: 'пишу́ but пи́шешь — the ending in the 1sg, the stem elsewhere.' },
];

const PAST_STRESS: { id: RuStressPast; label: string; hint: string }[] = [
  { id: 'stem', label: 'Stem', hint: 'де́лал, де́лала, де́лали.' },
  { id: 'ending', label: 'Ending', hint: 'Throughout the four forms.' },
  { id: 'fem', label: 'Feminine only', hint: 'был, была́, бы́ло, бы́ли — a closed group of common verbs.' },
];

const TRANSITIVITY = [
  { id: '', label: 'Unset' },
  { id: 'tr', label: 'Transitive' },
  { id: 'intr', label: 'Intransitive' },
];

const MOTION = [
  { id: '', label: 'Not a motion verb' },
  { id: 'uni', label: 'Unidirectional (идти)' },
  { id: 'multi', label: 'Multidirectional (ходить)' },
];

const LEVELS = ['', 'A1', 'A2', 'B1'];

interface Draft {
  infinitive: string;
  accented: string;
  english: string;
  senses: string;
  aspect: RuAspect;
  pairId: string | null;
  classId: RuClassId;
  stemPresent: string;
  stemPresent1sg: string;
  stemImperative: string;
  stemPast: string;
  stemPastM: string;
  stressPresent: RuStressPresent;
  stressPast: RuStressPast;
  /** Vowel indices, held as text: an empty box is "unset", which is not 0. */
  stemStress: string;
  stressInfinitive: string;
  reflexive: boolean;
  transitivity: string;
  government: string[];
  motion: string;
  level: string;
  /** Slot → form. A key that is present with an empty value says the cell does not exist. */
  overrides: Record<string, string>;
  check: boolean;
  note: string;
}

function draftFrom(verb: RuVerb | null): Draft {
  if (!verb) {
    return {
      infinitive: '',
      accented: '',
      english: '',
      senses: '',
      aspect: 'impf',
      pairId: null,
      // The big productive class, which is the right guess for a verb somebody is adding by
      // hand: if it were irregular they would not be starting from a blank form.
      classId: '1',
      stemPresent: '',
      stemPresent1sg: '',
      stemImperative: '',
      stemPast: '',
      stemPastM: '',
      stressPresent: 'stem',
      stressPast: 'stem',
      stemStress: '',
      stressInfinitive: '',
      reflexive: false,
      transitivity: '',
      government: [],
      motion: '',
      level: '',
      overrides: {},
      check: true,
      note: '',
    };
  }

  return {
    infinitive: verb.infinitive,
    accented: verb.accented,
    english: verb.english,
    senses: verb.senses.join('\n'),
    aspect: verb.aspect,
    pairId: verb.pairId,
    classId: verb.classId,
    stemPresent: verb.stemPresent,
    stemPresent1sg: verb.stemPresent1sg ?? '',
    stemImperative: verb.stemImperative ?? '',
    stemPast: verb.stemPast ?? '',
    stemPastM: verb.stemPastM ?? '',
    stressPresent: verb.stressPresent,
    stressPast: verb.stressPast,
    stemStress: verb.stemStress == null ? '' : String(verb.stemStress),
    stressInfinitive: verb.stressInfinitive == null ? '' : String(verb.stressInfinitive),
    reflexive: verb.reflexive,
    transitivity: verb.transitivity,
    government: [...verb.government],
    motion: verb.motion,
    level: verb.level,
    overrides: { ...(verb.overrides as Record<string, string>) },
    check: verb.check === true,
    note: verb.note ?? '',
  };
}

/** The half of the draft the conjugation engine reads. */
function ruleFrom(draft: Draft): RuVerbRule {
  return {
    infinitive: draft.infinitive.trim(),
    aspect: draft.aspect,
    classId: draft.classId,
    stemPresent: draft.stemPresent.trim(),
    stemPresent1sg: draft.stemPresent1sg.trim() || null,
    stemImperative: draft.stemImperative.trim() || null,
    stemPast: draft.stemPast.trim() || null,
    stemPastM: draft.stemPastM.trim() || null,
    stressPresent: draft.stressPresent,
    stressPast: draft.stressPast,
    stemStress: index(draft.stemStress),
    stressInfinitive: index(draft.stressInfinitive),
    reflexive: draft.reflexive,
    transitivity: draft.transitivity,
  };
}

/** A vowel index as the contract wants it: a number, or null for an empty box. */
function index(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

/**
 * Every slot the verb could have, in the order the reader shows them, gathered into sections.
 *
 * Driven off RU_SLOTS rather than off the forms the rule produced, because this is an editor:
 * a cell the rule does not reach is exactly the cell somebody is here to fill in, and it has
 * to have a row even when it is empty. The one exception is the compound future, which only
 * imperfectives have at all — буду + the infinitive is not a thing a perfective can be given.
 */
function sections(aspect: RuAspect): [RuSlot['group'], RuSlot[]][] {
  const out: [RuSlot['group'], RuSlot[]][] = [];

  for (const slot of RU_SLOTS) {
    if (slot.group === 'future' && aspect === 'pf') continue;

    const last = out[out.length - 1];
    if (last && last[0] === slot.group) last[1].push(slot);
    else out.push([slot.group, [slot]]);
  }

  return out;
}

export default function RuVerbEditor() {
  const { verbId } = useParams<{ verbId: string }>();
  const navigate = useNavigate();
  const verbs = ruVerbData().verbs;
  const { busy, error, run } = useEdit();

  const existing = useMemo(() => verbs.find(verb => verb.id === verbId) ?? null, [verbs, verbId]);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(existing));
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The whole paradigm, recomputed on every keystroke. It is twenty-five cells of string
  // work, which is cheap enough to do live — and doing it live is the point of the screen:
  // a stem typed into the box above is a table of forms before the finger leaves the key.
  const rule = useMemo(() => ruleFrom(draft), [draft]);
  const preview = useMemo(() => conjugate(rule, draft.overrides), [rule, draft.overrides]);
  const byslot = useMemo(() => new Map(preview.forms.map(form => [form.slot, form])), [preview]);

  const partner = useMemo(
    () => (draft.pairId ? (verbs.find(verb => verb.id === draft.pairId) ?? null) : null),
    [verbs, draft.pairId],
  );
  // The partner this save would take that verb away from. The server writes the reverse link
  // unconditionally, so pairing делать with сделать when сделать already points at доделать
  // leaves доделать pointing at a verb that no longer points back. Better said than found.
  const stolenFrom = useMemo(() => {
    if (!partner?.pairId || partner.pairId === existing?.id) return null;
    return verbs.find(verb => verb.id === partner.pairId) ?? null;
  }, [verbs, partner, existing]);

  if (verbId && !existing) {
    return (
      <Page>
        <Breadcrumb>
          <BreadcrumbLink to="/admin/verbs">← Verbs</BreadcrumbLink>
        </Breadcrumb>
        <p className="py-6 text-center text-muted-foreground">There is no verb with the id “{verbId}”.</p>
      </Page>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft(current => ({ ...current, [key]: value }));

  /**
   * Aspect, which takes the compound future with it.
   *
   * A perfective has no буду-future at all, so an override left over from a verb that was
   * imperfective a moment ago names a cell that can never be rendered. The server would take
   * it — `fut.1sg` is a real slot — and it would sit in the table meaning nothing.
   */
  const setAspect = (aspect: RuAspect) =>
    setDraft(current => {
      if (aspect === 'impf') return { ...current, aspect };
      const overrides = Object.fromEntries(
        Object.entries(current.overrides).filter(([slot]) => !slot.startsWith('fut.')),
      );
      return { ...current, aspect, overrides };
    });

  /** Types a form into one cell. Emptying the box removes the override rather than blanking it. */
  const setOverride = (slot: RuSlotKey, value: string) =>
    setDraft(current => {
      const next = { ...current.overrides };
      if (value) next[slot] = value;
      else delete next[slot];
      return { ...current, overrides: next };
    });

  /** The third state: this verb has no such form. Stored as an override with no text. */
  const toggleAbsent = (slot: RuSlotKey) =>
    setDraft(current => {
      const next = { ...current.overrides };
      if (next[slot] === '') delete next[slot];
      else next[slot] = '';
      return { ...current, overrides: next };
    });

  const toggleCase = (id: string) =>
    setDraft(current => ({
      ...current,
      government: current.government.includes(id)
        ? current.government.filter(one => one !== id)
        : [...current.government, id],
    }));

  const save = async () => {
    // Written out rather than spread from `ruleFrom`: the rule type leaves its stems optional,
    // because a stored rule may simply not carry one, while a draft always has an answer even
    // when that answer is null. Spelling it out is also what makes this the one place to look
    // for what actually goes over the wire.
    const payload: RuVerbInput = {
      ...(existing ? { id: existing.id } : {}),
      infinitive: draft.infinitive.trim(),
      accented: draft.accented.trim(),
      english: draft.english.trim(),
      senses: lines(draft.senses),

      aspect: draft.aspect,
      pairId: draft.pairId,

      classId: draft.classId,
      stemPresent: draft.stemPresent.trim(),
      stemPresent1sg: draft.stemPresent1sg.trim() || null,
      stemImperative: draft.stemImperative.trim() || null,
      stemPast: draft.stemPast.trim() || null,
      stemPastM: draft.stemPastM.trim() || null,

      stressPresent: draft.stressPresent,
      stressPast: draft.stressPast,
      stemStress: index(draft.stemStress),
      stressInfinitive: index(draft.stressInfinitive),

      reflexive: draft.reflexive,
      transitivity: draft.transitivity as RuVerbInput['transitivity'],
      government: draft.government,
      motion: draft.motion as RuVerbInput['motion'],
      level: draft.level as RuVerbInput['level'],

      overrides: draft.overrides,
      check: draft.check,
      note: draft.note.trim() || null,
    };

    const result = await run(() => api.admin.saveRuVerb(payload));
    if (result) navigate(`/admin/verbs/${encodeURIComponent(result.id)}`, { replace: true });
  };

  const remove = async () => {
    if (!existing) return;
    const result = await run(() => api.admin.deleteVerb({ lang: 'ru', id: existing.id }));
    if (result) navigate('/admin/verbs', { replace: true });
  };

  const cls = RU_CLASS_BY_ID.get(draft.classId);
  const conjugation = RU_CONJUGATIONS.find(entry => entry.id === (cls?.conjugation ?? 'mixed'));
  const stored = Object.keys(draft.overrides).length;

  return (
    <AdminPage>
      <Breadcrumb>
        <BreadcrumbLink to="/admin/verbs">← Verbs</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>{existing ? existing.infinitive : 'New verb'}</span>
      </Breadcrumb>

      <AdminHead>
        <AdminTitle lang="ru">{draft.accented || draft.infinitive || 'New verb'}</AdminTitle>
        <AdminSub>
          {existing ? (
            <>
              <code>{existing.id}</code> · {preview.derivedShare}% of the forms come from the rule ·{' '}
              {stored === 0 ? 'no stored cells' : `${stored} stored cell(s)`}
            </>
          ) : (
            <>
              The id is slugged from the infinitive and the aspect — делать becomes{' '}
              <code>ru-delat-impf</code> — and never changes after.
            </>
          )}
        </AdminSub>
      </AdminHead>

      {error && <AdminError>{error}</AdminError>}

      {/* ------------------------------------------------------------- the word */}

      <AdminSection>
        <AdminSectionTitle>The verb</AdminSectionTitle>

        <AdminGrid>
          <AdminField>
            <AdminLabel>Infinitive</AdminLabel>
            <AdminInput
              lang="ru"
              value={draft.infinitive}
              onChange={event => set('infinitive', event.target.value)}
              placeholder="делать"
            />
            <AdminHint>Unaccented, as a dictionary writes it — including the -ся of a reflexive.</AdminHint>
          </AdminField>

          <AdminField>
            <AdminLabel>Accented</AdminLabel>
            <AdminInput
              lang="ru"
              value={draft.accented}
              onChange={event => set('accented', event.target.value)}
              placeholder="де́лать"
            />
            <AdminHint>Display only. Leave it blank and the pages show the plain infinitive.</AdminHint>
          </AdminField>

          <AdminField>
            <AdminLabel>English</AdminLabel>
            <AdminInput
              value={draft.english}
              onChange={event => set('english', event.target.value)}
              placeholder="to do, to make"
            />
          </AdminField>

          <AdminField>
            <AdminLabel>Level</AdminLabel>
            <Select value={draft.level || UNSET} onValueChange={value => set('level', value === UNSET ? '' : value)}>
              <SelectTrigger className={SELECT}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEVELS.map(level => (
                  <SelectItem key={level || UNSET} value={level || UNSET}>
                    {level || 'Unset'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </AdminField>
        </AdminGrid>

        <AdminField>
          <AdminLabel>Other senses</AdminLabel>
          <AdminTextarea
            rows={3}
            value={draft.senses}
            onChange={event => set('senses', event.target.value)}
            placeholder={'One per line.'}
          />
        </AdminField>
      </AdminSection>

      {/* ------------------------------------------------------ aspect and pair */}

      <AdminSection>
        <AdminSectionTitle>Aspect and its pair</AdminSectionTitle>
        <AdminNote>
          Aspect decides what half this table means: a perfective verb has no present tense at all, and the
          six present-shaped cells below are its future. Changing it here changes the paradigm underneath.
        </AdminNote>

        <div className="mb-4 flex flex-wrap gap-2">
          {RU_ASPECTS.map(option => (
            <button
              key={option.id}
              type="button"
              className={cn(CHOICE, draft.aspect === option.id && CHOICE_ON)}
              aria-pressed={draft.aspect === option.id}
              onClick={() => setAspect(option.id)}
            >
              <span className="font-semibold">{option.label}</span>
              <span className="block text-[12.5px] text-muted-foreground">{option.hint}</span>
            </button>
          ))}
        </div>

        <AdminLabel>
          {draft.aspect === 'impf' ? 'Perfective partner' : 'Imperfective partner'}
        </AdminLabel>

        {partner ? (
          <div className={PICKED}>
            <span className="text-base font-semibold" lang="ru">
              {partner.accented || partner.infinitive}
            </span>
            <span className="flex-1 text-[13.5px] text-muted-foreground">{partner.english}</span>
            <AspectTag aspect={partner.aspect} />
            <button type="button" className={CLEAR} onClick={() => set('pairId', null)}>
              Clear
            </button>
          </div>
        ) : (
          <PartnerPicker
            verbs={verbs}
            want={draft.aspect === 'impf' ? 'pf' : 'impf'}
            exclude={existing?.id}
            onPick={id => set('pairId', id)}
          />
        )}

        <AdminHint>
          The link is written at both ends: saving also points {partner ? partner.infinitive : 'the partner'} back
          at this verb. A verb with no partner — быть, стоить — simply has none.
        </AdminHint>

        {partner && partner.aspect === draft.aspect && (
          <AdminWarning>
            Both of these are {draft.aspect === 'pf' ? 'perfective' : 'imperfective'}. An aspect pair is one of
            each; this is almost certainly wrong.
          </AdminWarning>
        )}

        {stolenFrom && (
          <AdminWarning>
            <span lang="ru">{partner?.infinitive}</span> is currently paired with{' '}
            <span lang="ru">{stolenFrom.infinitive}</span>. Saving re-points it here and leaves{' '}
            <span lang="ru">{stolenFrom.infinitive}</span> pointing at a verb that no longer points back — worth
            clearing that one afterwards.
          </AdminWarning>
        )}
      </AdminSection>

      {/* ----------------------------------------------------------- conjugation */}

      <AdminSection>
        <AdminSectionTitle>Conjugation class</AdminSectionTitle>
        <AdminNote>
          Zaliznyak’s classes are what predict the forms; the two conjugations every course teaches follow from
          the class rather than the other way round, which is why only this is stored. Pick the class and the
          conjugation below reports itself.
        </AdminNote>

        <AdminGrid className="mb-3">
          <AdminField>
            <AdminLabel>Class</AdminLabel>
            <Select value={draft.classId} onValueChange={value => set('classId', value as RuClassId)}>
              <SelectTrigger className={SELECT}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RU_CLASSES.map(option => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.id === 'irr' ? 'Irregular' : `Class ${option.id}`} — {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </AdminField>

          <AdminField>
            <AdminLabel>That makes it</AdminLabel>
            <p className="pt-2 text-sm font-semibold">{conjugation?.label ?? '—'}</p>
            <p className="font-mono text-[13px] text-muted-foreground" lang="ru">
              {conjugation?.endings}
            </p>
          </AdminField>
        </AdminGrid>

        {cls && (
          <p className="max-w-[78ch] text-[13.5px] leading-relaxed text-muted-foreground">
            {cls.description}
            <span className="mt-1 block text-faint">
              Model verb: <span lang="ru">{cls.example}</span> — {cls.exampleEnglish}
            </span>
          </p>
        )}
      </AdminSection>

      {/* ---------------------------------------------------------------- stems */}

      <AdminSection>
        <AdminSectionTitle>Stems</AdminSectionTitle>
        <AdminNote>
          Write the stem without its ending — <code>дела</code>, not <code>делаю</code>. Everything but the
          present stem is optional, and a blank box means “the ordinary thing for this class”, which is what it
          should be for most verbs.
        </AdminNote>

        <AdminGrid>
          <AdminField>
            <AdminLabel>Present stem</AdminLabel>
            <AdminInput
              lang="ru"
              value={draft.stemPresent}
              onChange={event => set('stemPresent', event.target.value)}
              placeholder="дела"
            />
            <AdminHint>The middle four cells: дела|ешь, пиш|ешь, говор|ишь.</AdminHint>
          </AdminField>

          <AdminField>
            <AdminLabel>1sg stem</AdminLabel>
            <AdminInput
              lang="ru"
              value={draft.stemPresent1sg}
              onChange={event => set('stemPresent1sg', event.target.value)}
              placeholder="любл"
            />
            <AdminHint>Only where the first person mutates: любл|ю against люб|ишь. Blank otherwise.</AdminHint>
          </AdminField>

          <AdminField>
            <AdminLabel>Imperative stem</AdminLabel>
            <AdminInput
              lang="ru"
              value={draft.stemImperative}
              onChange={event => set('stemImperative', event.target.value)}
              placeholder="дава"
            />
            <AdminHint>Class 13’s дава|й and the like — where the command is not built on the present.</AdminHint>
          </AdminField>

          <AdminField>
            <AdminLabel>Past stem</AdminLabel>
            <AdminInput
              lang="ru"
              value={draft.stemPast}
              onChange={event => set('stemPast', event.target.value)}
              placeholder="дела"
            />
            <AdminHint>Blank means the infinitive with its -ть / -ти / -чь taken off.</AdminHint>
          </AdminField>

          <AdminField>
            <AdminLabel>Masculine past stem</AdminLabel>
            <AdminInput
              lang="ru"
              value={draft.stemPastM}
              onChange={event => set('stemPastM', event.target.value)}
              placeholder="нёс"
            />
            <AdminHint>Where the vowel changes in the masculine alone: нес → нёс, пек → пёк.</AdminHint>
          </AdminField>
        </AdminGrid>
      </AdminSection>

      {/* --------------------------------------------------------------- stress */}

      <AdminSection>
        <AdminSectionTitle>Stress</AdminSectionTitle>
        <AdminNote>
          Modelled rather than typed onto each cell, because the pattern is the fact worth storing — and because
          the present pattern is also what decides -ешь against -ёшь.
        </AdminNote>

        <AdminLabel>Present</AdminLabel>
        <div className="mb-4 flex flex-wrap gap-2">
          {PRESENT_STRESS.map(option => (
            <button
              key={option.id}
              type="button"
              className={cn(CHOICE, draft.stressPresent === option.id && CHOICE_ON)}
              aria-pressed={draft.stressPresent === option.id}
              onClick={() => set('stressPresent', option.id)}
            >
              <span className="font-semibold">{option.label}</span>
              <span className="block text-[12.5px] text-muted-foreground" lang="ru">
                {option.hint}
              </span>
            </button>
          ))}
        </div>

        <AdminLabel>Past</AdminLabel>
        <div className="mb-4 flex flex-wrap gap-2">
          {PAST_STRESS.map(option => (
            <button
              key={option.id}
              type="button"
              className={cn(CHOICE, draft.stressPast === option.id && CHOICE_ON)}
              aria-pressed={draft.stressPast === option.id}
              onClick={() => set('stressPast', option.id)}
            >
              <span className="font-semibold">{option.label}</span>
              <span className="block text-[12.5px] text-muted-foreground" lang="ru">
                {option.hint}
              </span>
            </button>
          ))}
        </div>

        <AdminGrid className="mb-0">
          <AdminField>
            <AdminLabel>Stressed vowel of the stem</AdminLabel>
            <AdminInput
              inputMode="numeric"
              value={draft.stemStress}
              onChange={event => set('stemStress', event.target.value)}
              placeholder="0"
            />
            <AdminHint>0-based, counting vowels rather than letters. Blank where the ending carries it.</AdminHint>
          </AdminField>

          <AdminField>
            <AdminLabel>Stressed vowel of the infinitive</AdminLabel>
            <AdminInput
              inputMode="numeric"
              value={draft.stressInfinitive}
              onChange={event => set('stressInfinitive', event.target.value)}
              placeholder="1"
            />
            <AdminHint>
              {draft.infinitive.trim()
                ? `Gives ${accented(draft.infinitive.trim(), index(draft.stressInfinitive) ?? -1)}`
                : 'Also where the past takes its stress from.'}
            </AdminHint>
          </AdminField>
        </AdminGrid>
      </AdminSection>

      {/* -------------------------------------------------------------- grammar */}

      <AdminSection>
        <AdminSectionTitle>Grammar</AdminSectionTitle>

        <AdminGrid>
          <AdminField>
            <AdminLabel>Transitivity</AdminLabel>
            <Select
              value={draft.transitivity || UNSET}
              onValueChange={value => set('transitivity', value === UNSET ? '' : value)}
            >
              <SelectTrigger className={SELECT}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSITIVITY.map(option => (
                  <SelectItem key={option.id || UNSET} value={option.id || UNSET}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <AdminHint>Only a transitive verb forms a past passive participle.</AdminHint>
          </AdminField>

          <AdminField>
            <AdminLabel>Motion</AdminLabel>
            <Select value={draft.motion || UNSET} onValueChange={value => set('motion', value === UNSET ? '' : value)}>
              <SelectTrigger className={SELECT}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOTION.map(option => (
                  <SelectItem key={option.id || UNSET} value={option.id || UNSET}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </AdminField>
        </AdminGrid>

        <AdminCheck>
          <Checkbox checked={draft.reflexive} onCheckedChange={value => set('reflexive', value === true)} />
          Reflexive — ends in -ся / -сь, and forms no passive
        </AdminCheck>

        <AdminLabel>Governs</AdminLabel>
        <div className="mb-1 flex flex-wrap gap-2">
          {CASES.map(one => (
            <button
              key={one.id}
              type="button"
              className={cn(CHIP, draft.government.includes(one.id) && CHOICE_ON)}
              aria-pressed={draft.government.includes(one.id)}
              onClick={() => toggleCase(one.id)}
            >
              {one.label}
            </button>
          ))}
        </div>
        <AdminHint>The case its complement takes — помочь takes the dative. None for most verbs.</AdminHint>
      </AdminSection>

      {/* ------------------------------------------------------------- paradigm */}

      <AdminSection>
        <AdminSectionTitle>
          The paradigm
          <span className="ml-2 text-[12.5px] font-normal text-faint">
            {preview.derivedShare}% from the rule
          </span>
        </AdminSectionTitle>
        <AdminNote>
          Everything here is worked out from the fields above and nothing in it is stored — until you type in
          one of the boxes, which pins that cell and marks it as a correction on the verb’s page. Emptying the
          box hands the cell back to the rule. <strong>No such form</strong> is the third answer: it removes the
          cell entirely, which is how you say that a verb has no gerund rather than that its gerund is unknown.
        </AdminNote>

        {sections(draft.aspect).map(([group, slots]) => (
          <div key={group} className="mb-5">
            <h3 className={GROUP_TITLE}>
              {group === 'present' ? presentLabel(draft.aspect) : RU_GROUP_LABELS[group]}
            </h3>

            {group === 'present' && draft.aspect === 'pf' && (
              <p className={GROUP_NOTE}>
                A perfective has no present tense. These six are its future.
              </p>
            )}
            {group === 'future' && (
              <p className={GROUP_NOTE}>
                Generated from буду plus the infinitive. There is rarely anything to correct here.
              </p>
            )}

            <div className={TABLE_SCROLL}>
              <table className={TABLE}>
                <tbody>
                  {slots.map(slot => (
                    <Cell
                      key={slot.key}
                      slot={slot}
                      form={byslot.get(slot.key)}
                      override={draft.overrides[slot.key]}
                      onType={value => setOverride(slot.key, value)}
                      onAbsent={() => toggleAbsent(slot.key)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </AdminSection>

      {/* ----------------------------------------------------------------- meta */}

      <AdminSection>
        <AdminSectionTitle>Notes</AdminSectionTitle>

        <AdminCheck>
          <Checkbox checked={draft.check} onCheckedChange={value => set('check', value === true)} />
          The rule has not been checked against a reference — say so on the verb’s page
        </AdminCheck>

        <AdminField>
          <AdminLabel>Note</AdminLabel>
          <AdminTextarea rows={2} value={draft.note} onChange={event => set('note', event.target.value)} />
          <AdminHint>Shown at the foot of the verb’s page.</AdminHint>
        </AdminField>
      </AdminSection>

      <AdminActions>
        <Button
          variant="control"
          size="auto"
          className={KNOW_BUTTON}
          disabled={!draft.infinitive.trim() || !draft.english.trim() || busy}
          onClick={save}
        >
          <Check /> {busy ? 'Saving…' : existing ? 'Save changes' : 'Create verb'}
        </Button>

        {existing && !confirmDelete && (
          <Button variant="dangerOutline" size="auto" disabled={busy} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        )}
        {existing && confirmDelete && (
          <span className="flex flex-wrap items-center gap-2.5 text-sm">
            Delete this verb?
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

/**
 * One cell of the paradigm: what it currently is, and the box that overrides it.
 *
 * The left half is the live answer — the rule's, or the stored form where there is one, with
 * the same × the reader's page marks a stored cell with. The right half is the correction.
 */
function Cell({
  slot,
  form,
  override,
  onType,
  onAbsent,
}: {
  slot: RuSlot;
  form: RuForm | undefined;
  /** The stored value: a form, '' for a cell marked absent, or undefined for neither. */
  override: string | undefined;
  onType: (value: string) => void;
  onAbsent: () => void;
}) {
  const absent = override === '';

  return (
    <tr className={cn('border-b border-border last:border-b-0', absent && 'opacity-55')}>
      <th className={SLOT_CELL} scope="row">
        {slot.label}
      </th>

      <td className={FORM_CELL} lang="ru">
        {form ? (
          <>
            {form.analytic ? form.form : accented(form.form, form.stress)}
            {form.source === 'stored' && (
              <abbr className="ml-1 cursor-help text-[#f59e0b] no-underline" title="Stored rather than derived">
                ×
              </abbr>
            )}
          </>
        ) : (
          <span className="text-faint">{absent ? 'no such form' : '—'}</span>
        )}
      </td>

      <td className="px-2 py-1.5">
        <input
          className={CELL_INPUT}
          lang="ru"
          value={override ?? ''}
          disabled={absent}
          onChange={event => onType(event.target.value)}
          placeholder={form && form.source === 'rule' ? form.form : ''}
          aria-label={`${slot.key} override`}
        />
      </td>

      <td className="px-2 py-1.5">
        <button type="button" className={cn(CHIP, absent && CHOICE_ON)} aria-pressed={absent} onClick={onAbsent}>
          No such form
        </button>
      </td>
    </tr>
  );
}

/**
 * A search over the verbs of the *other* aspect.
 *
 * Filtered to the opposite aspect rather than showing everything and complaining afterwards:
 * a pair is one of each by definition, and the half of the dictionary that cannot be the
 * answer is only in the way.
 */
function PartnerPicker({
  verbs,
  want,
  exclude,
  onPick,
}: {
  verbs: RuVerb[];
  want: RuAspect;
  exclude: string | undefined;
  onPick: (id: string) => void;
}) {
  const [term, setTerm] = useState('');

  const results = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return [];
    return verbs
      .filter(
        verb =>
          verb.aspect === want &&
          verb.id !== exclude &&
          (verb.infinitive.includes(needle) || verb.english.toLowerCase().includes(needle)),
      )
      .slice(0, 25);
  }, [verbs, want, exclude, term]);

  return (
    <div className="mb-2">
      <SearchField
        wrapperClassName="mt-1"
        placeholder={want === 'pf' ? 'Search perfectives…' : 'Search imperfectives…'}
        value={term}
        onChange={event => setTerm(event.target.value)}
      />

      {term.trim() !== '' && (
        <ul className="mt-2 max-h-65 list-none overflow-y-auto rounded-sm border border-border">
          {results.length === 0 && <li className="px-3 py-2.5 text-[13px] text-faint">Nothing matches “{term}”.</li>}
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
                <span className="text-base font-semibold" lang="ru">
                  {verb.accented || verb.infinitive}
                </span>
                <span className="flex-1 text-[13.5px] text-muted-foreground">{verb.english}</span>
                <span className="text-[11.5px] text-faint">class {verb.classId}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Radix refuses an empty Select value, so "unset" travels as a sentinel and is mapped back. */
const UNSET = '__unset__';

const SELECT =
  'h-auto w-full rounded-sm border border-border-strong bg-background py-2.5 text-sm shadow-none data-[size=default]:h-auto';

/* A choice among a handful, each with a line of explanation under it — wider than a segmented
   control and worth the room here, where picking the wrong stress pattern is silent. */
const CHOICE =
  'max-w-[26ch] flex-1 cursor-pointer rounded-sm border border-border-strong bg-background px-3 py-2 text-left text-sm ' +
  'hover:border-primary';
const CHOICE_ON = 'border-primary bg-[color-mix(in_srgb,var(--primary)_7%,var(--card))] text-primary';
const CHIP =
  'cursor-pointer rounded-sm border border-border-strong bg-background px-2.5 py-1.5 text-[12.5px] hover:border-primary';

const PICKED =
  'flex flex-wrap items-baseline gap-2.5 rounded-sm border border-primary bg-[color-mix(in_srgb,var(--primary)_6%,var(--card))] px-3 py-2';
const CLEAR = 'cursor-pointer text-[12.5px] text-primary underline';
const PICKER_RESULT =
  'flex w-full cursor-pointer flex-wrap items-baseline gap-2.5 border-0 bg-transparent px-3 py-2 text-left ' +
  'font-[inherit] text-foreground hover:bg-muted';

const GROUP_TITLE = 'mb-1 text-sm font-bold';
const GROUP_NOTE = 'mb-1.5 text-[12.5px] text-muted-foreground';
const TABLE_SCROLL = 'overflow-x-auto rounded-sm border border-border';
const TABLE = 'w-full min-w-[560px] border-collapse';
const SLOT_CELL = 'w-[120px] px-2.5 py-1.5 text-left text-[12.5px] font-medium text-muted-foreground';
const FORM_CELL = 'w-[190px] px-2.5 py-1.5 text-[15px]';
const CELL_INPUT =
  'w-full min-w-[120px] rounded-[6px] border border-transparent bg-background px-2 py-1.5 font-[inherit] text-[15px] ' +
  'focus:border-primary focus:shadow-[0_0_0_2px_var(--primary-glow)] focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:bg-transparent';
