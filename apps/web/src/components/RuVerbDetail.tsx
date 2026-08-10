// One Russian verb, in full.
//
// Its Georgian counterpart, VerbDetail.tsx, renders 66 cells that came out of a database. This
// one renders about twenty that did not exist until a moment ago: `conjugate()` expands the
// stored rule here, in the browser, off class definitions that are already in the bundle. The
// two are separate components rather than one with a branch because the *shapes* differ — an
// eleven-screeve grid against an aspect pair with a gender-marked past — and the only thing a
// shared abstraction would buy is a table that suits neither.
//
// The grouping question — "which conjugation is this?" — has two answers and this page gives
// both. Every course teaches two conjugations, and that is what shows by default. Zaliznyak's
// sixteen classes are what actually predict the forms, and they are one click away. Neither is
// more correct: the first is what a learner needs to conjugate the verb, and the second is
// what explains why it conjugates that way.

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  RU_CLASS_BY_ID,
  RU_CONJUGATIONS,
  RU_GROUP_LABELS,
  RU_SLOTS,
  accented,
  conjugate,
  presentLabel,
} from '@georgian/shared/grammar/ru';
import type { RuForm, RuSlot, RuVerb } from '@georgian/shared/types';
import { Page } from '@/components/ui/page';
import { derived, lang, ruVerbData } from '../content/store';
import { AspectTag } from './RuVerbList';

const verbsById = derived(from =>
  from.verbs.kind === 'ru' ? new Map(from.verbs.verbs.map(verb => [verb.id, verb])) : new Map<string, RuVerb>(),
);

/** The cases a verb governs, spelled out — "requires the dative" is the useful form of it. */
const CASE_NAMES: Record<string, string> = {
  acc: 'accusative',
  gen: 'genitive',
  dat: 'dative',
  ins: 'instrumental',
  pre: 'prepositional',
};

export default function RuVerbDetail() {
  const { verbId } = useParams<{ verbId: string }>();
  const [advanced, setAdvanced] = useState(false);

  const verb = verbId ? verbsById().get(verbId) : undefined;
  const pair = verb?.pairId ? verbsById().get(verb.pairId) : undefined;

  // The whole paradigm, worked out from the rule. Memoised on the verb rather than computed
  // in the body: it is cheap, but it is not free, and nothing about it changes while the page
  // is open.
  const paradigm = useMemo(
    () => (verb ? conjugate(verb, verb.overrides as Record<string, string>) : null),
    [verb],
  );

  if (!verb || !paradigm) {
    return (
      <Page>
        <p className="text-muted-foreground">There is no verb with that id.</p>
        <Link className={BACK} to={`/${lang()}/verbs`}>
          Back to the verb list
        </Link>
      </Page>
    );
  }

  const cls = RU_CLASS_BY_ID.get(verb.classId);
  const conjugation = RU_CONJUGATIONS.find(entry => entry.id === paradigm.conjugation);
  const byGroup = groupForms(paradigm.forms);
  const total = ruVerbData().verbs.length;

  return (
    <Page>
      <Link className={BACK} to={`/${lang()}/verbs`}>
        ← All {total} verbs
      </Link>

      <header className="mb-7">
        <h1 className="mb-1 text-[2rem] font-[650]" lang="ru">
          {verb.accented || verb.infinitive}
        </h1>
        <p className="mb-3 text-[1.05rem] text-muted-foreground">{verb.english}</p>

        <ul className="mb-2.5 flex list-none flex-wrap gap-1.5 p-0">
          {/* Aspect first, and on its own line, because it is the fact that decides what every
              row below means. A perfective's "present" is a future. */}
          <li>
            <AspectTag aspect={verb.aspect} label={verb.aspect === 'pf' ? 'Perfective' : 'Imperfective'} />
          </li>
          {verb.transitivity && (
            <li className={TAG}>{verb.transitivity === 'tr' ? 'Transitive' : 'Intransitive'}</li>
          )}
          {verb.reflexive && <li className={TAG}>Reflexive</li>}
          {verb.motion && (
            <li className={TAG}>
              {verb.motion === 'uni' ? 'Unidirectional' : 'Multidirectional'} motion
            </li>
          )}
          {verb.government.map(one => (
            <li key={one} className={TAG}>
              takes the {CASE_NAMES[one] ?? one}
            </li>
          ))}
        </ul>

        {pair && (
          <p className="text-[0.9rem] text-muted-foreground">
            {verb.aspect === 'impf' ? 'Perfective' : 'Imperfective'} partner:{' '}
            <Link className="text-primary hover:underline" to={`/${lang()}/verbs/${pair.id}`} lang="ru">
              {pair.accented || pair.infinitive}
            </Link>
          </p>
        )}
      </header>

      {/* -------------------------------------------------- which group it is */}

      <section className="mb-7 rounded-[10px] border border-border p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={SECTION_TITLE}>Conjugation</h2>
          <button
            type="button"
            className="cursor-pointer rounded-[6px] border border-border px-2.5 py-1 font-[inherit] text-[0.8rem] text-muted-foreground hover:text-foreground"
            onClick={() => setAdvanced(on => !on)}
            aria-pressed={advanced}
          >
            {advanced ? 'Show the simple answer' : 'Show the full classification'}
          </button>
        </div>

        {!advanced && conjugation && (
          <div>
            <p className={GROUP_NAME}>{conjugation.label}</p>
            <p className="mb-1.5 font-mono text-muted-foreground" lang="ru">
              {conjugation.endings}
            </p>
            <p className={HINT}>{conjugation.hint}</p>
          </div>
        )}

        {advanced && cls && (
          <div>
            <p className={GROUP_NAME}>
              Class {cls.id} — <span lang="ru">{cls.label}</span>
            </p>
            <p className={HINT}>{cls.description}</p>
            <dl className="mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-6 gap-y-2.5 [&_dd]:mt-0.5 [&_dt]:text-[0.75rem] [&_dt]:tracking-[0.04em] [&_dt]:text-faint [&_dt]:uppercase">
              <div>
                <dt>Conjugation</dt>
                <dd>{conjugation?.label ?? '—'}</dd>
              </div>
              <div>
                <dt>Model verb</dt>
                <dd lang="ru">
                  {cls.example} <span className="text-[0.85rem] text-faint">{cls.exampleEnglish}</span>
                </dd>
              </div>
              <div>
                <dt>Present stem</dt>
                <dd lang="ru">
                  {verb.stemPresent}-
                  {verb.stemPresent1sg && verb.stemPresent1sg !== verb.stemPresent && (
                    <> (1sg {verb.stemPresent1sg}-)</>
                  )}
                </dd>
              </div>
              <div>
                <dt>Stress</dt>
                <dd>{STRESS_NAMES[verb.stressPresent]}</dd>
              </div>
              <div>
                <dt>Built by rule</dt>
                {/* The honest number, and it is worth showing. 100% means every form on this
                    page was worked out from the class above; anything less means somebody had
                    to write a cell down, and the table marks which. */}
                <dd>{paradigm.derivedShare}% of the forms below</dd>
              </div>
            </dl>
          </div>
        )}
      </section>

      {verb.check && (
        <p className={ASIDE}>
          This verb’s rule has not been checked against a reference. The forms below are what the
          class predicts.
        </p>
      )}

      {/* ------------------------------------------------------- the paradigm */}

      {byGroup.map(([group, forms]) => (
        <section key={group} className="mb-6">
          <h2 className={SECTION_TITLE}>
            {group === 'present' ? presentLabel(verb.aspect) : RU_GROUP_LABELS[group]}
          </h2>

          {group === 'present' && verb.aspect === 'pf' && (
            <p className="mb-2.5 text-[0.85rem] text-muted-foreground">
              A perfective verb has no present tense. These forms — which look like a present —
              are its future.
            </p>
          )}

          <div className="mt-2.5 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2">
            {forms.map(form => (
              <div
                key={form.slot}
                className="flex items-baseline gap-2 rounded-lg border border-border px-2.5 py-[7px]"
              >
                <span className="min-w-[66px] text-[0.8rem] text-faint">{labelFor(form.slot)}</span>
                <span className="text-[1.05rem]" lang="ru">
                  {accented(form.form, form.stress)}
                  {/* A cell the rule could not reach. Shown rather than hidden: it is a
                      standing note that this verb is irregular here, which is exactly what a
                      learner wants flagged. */}
                  {form.source === 'stored' && (
                    <abbr
                      className="ml-[5px] cursor-help text-[#f59e0b] no-underline"
                      title="Irregular — stored rather than derived"
                    >
                      ×
                    </abbr>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}

      {verb.note && <p className={ASIDE}>{verb.note}</p>}
    </Page>
  );
}

const BACK = 'mb-4 inline-block text-[0.88rem] text-muted-foreground hover:text-primary';
const SECTION_TITLE = 'mb-1 text-base font-semibold';
const GROUP_NAME = 'mt-2.5 mb-1 font-semibold';
const HINT = 'text-[0.9rem] leading-normal text-muted-foreground';
const TAG = 'rounded-full border border-border px-2.5 py-[3px] text-[0.78rem] text-muted-foreground';
/* A standing caveat about the page, set off by a rule rather than a box: it qualifies what
   is below without competing with it. */
const ASIDE = 'mb-5 border-l-[3px] border-border px-3 py-2.5 text-[0.88rem] text-muted-foreground';

const STRESS_NAMES: Record<string, string> = {
  stem: 'fixed on the stem',
  ending: 'fixed on the ending',
  shift: 'on the ending in the first person, on the stem elsewhere',
};

const LABELS = new Map<string, string>(RU_SLOTS.map(slot => [slot.key, slot.label]));

function labelFor(slot: string): string {
  return LABELS.get(slot) ?? slot;
}

/**
 * The forms in display order, gathered into the sections the page draws.
 *
 * Driven off RU_SLOTS rather than off the forms themselves, so the order on the page is the
 * order declared in the grammar module and a verb missing a cell simply has a shorter section
 * rather than one whose rows have moved.
 */
function groupForms(forms: RuForm[]): [RuSlot['group'], RuForm[]][] {
  const bySlot = new Map(forms.map(form => [form.slot, form]));
  const out: [RuSlot['group'], RuForm[]][] = [];

  for (const slot of RU_SLOTS) {
    const form = bySlot.get(slot.key);
    if (!form) continue;

    const last = out[out.length - 1];
    if (last && last[0] === slot.group) last[1].push(form);
    else out.push([slot.group, [form]]);
  }

  return out;
}
