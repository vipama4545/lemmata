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
import { derived, lang, ruVerbData } from '../content/store';

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
      <div className="main-content verb-detail">
        <p className="verb-missing">There is no verb with that id.</p>
        <Link className="verb-back" to={`/${lang()}/verbs`}>
          Back to the verb list
        </Link>
      </div>
    );
  }

  const cls = RU_CLASS_BY_ID.get(verb.classId);
  const conjugation = RU_CONJUGATIONS.find(entry => entry.id === paradigm.conjugation);
  const byGroup = groupForms(paradigm.forms);
  const total = ruVerbData().verbs.length;

  return (
    <div className="main-content verb-detail">
      <Link className="verb-back" to={`/${lang()}/verbs`}>
        ← All {total} verbs
      </Link>

      <header className="verb-head">
        <h1 className="verb-title" lang="ru">
          {verb.accented || verb.infinitive}
        </h1>
        <p className="verb-english">{verb.english}</p>

        <ul className="verb-tags">
          {/* Aspect first, and on its own line, because it is the fact that decides what every
              row below means. A perfective's "present" is a future. */}
          <li className={`verb-tag verb-aspect-${verb.aspect}`}>
            {verb.aspect === 'pf' ? 'Perfective' : 'Imperfective'}
          </li>
          {verb.transitivity && (
            <li className="verb-tag">{verb.transitivity === 'tr' ? 'Transitive' : 'Intransitive'}</li>
          )}
          {verb.reflexive && <li className="verb-tag">Reflexive</li>}
          {verb.motion && (
            <li className="verb-tag">
              {verb.motion === 'uni' ? 'Unidirectional' : 'Multidirectional'} motion
            </li>
          )}
          {verb.government.map(one => (
            <li key={one} className="verb-tag">
              takes the {CASE_NAMES[one] ?? one}
            </li>
          ))}
        </ul>

        {pair && (
          <p className="verb-pair">
            {verb.aspect === 'impf' ? 'Perfective' : 'Imperfective'} partner:{' '}
            <Link to={`/${lang()}/verbs/${pair.id}`} lang="ru">
              {pair.accented || pair.infinitive}
            </Link>
          </p>
        )}
      </header>

      {/* -------------------------------------------------- which group it is */}

      <section className="verb-group">
        <div className="verb-group-head">
          <h2 className="verb-section-title">Conjugation</h2>
          <button
            type="button"
            className="verb-group-toggle"
            onClick={() => setAdvanced(on => !on)}
            aria-pressed={advanced}
          >
            {advanced ? 'Show the simple answer' : 'Show the full classification'}
          </button>
        </div>

        {!advanced && conjugation && (
          <div className="verb-group-simple">
            <p className="verb-group-name">{conjugation.label}</p>
            <p className="verb-group-endings" lang="ru">
              {conjugation.endings}
            </p>
            <p className="verb-group-hint">{conjugation.hint}</p>
          </div>
        )}

        {advanced && cls && (
          <div className="verb-group-advanced">
            <p className="verb-group-name">
              Class {cls.id} — <span lang="ru">{cls.label}</span>
            </p>
            <p className="verb-group-hint">{cls.description}</p>
            <dl className="verb-group-facts">
              <div>
                <dt>Conjugation</dt>
                <dd>{conjugation?.label ?? '—'}</dd>
              </div>
              <div>
                <dt>Model verb</dt>
                <dd lang="ru">
                  {cls.example} <span className="verb-group-gloss">{cls.exampleEnglish}</span>
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
        <p className="verb-check">
          This verb’s rule has not been checked against a reference. The forms below are what the
          class predicts.
        </p>
      )}

      {/* ------------------------------------------------------- the paradigm */}

      {byGroup.map(([group, forms]) => (
        <section key={group} className="verb-screeve">
          <h2 className="verb-section-title">
            {group === 'present' ? presentLabel(verb.aspect) : RU_GROUP_LABELS[group]}
          </h2>

          {group === 'present' && verb.aspect === 'pf' && (
            <p className="verb-section-note">
              A perfective verb has no present tense. These forms — which look like a present —
              are its future.
            </p>
          )}

          <div className={group === 'past' ? 'verb-grid verb-grid-past' : 'verb-grid'}>
            {forms.map(form => (
              <div key={form.slot} className="verb-cell">
                <span className="verb-person">{labelFor(form.slot)}</span>
                <span className="verb-form" lang="ru">
                  {accented(form.form, form.stress)}
                  {/* A cell the rule could not reach. Shown rather than hidden: it is a
                      standing note that this verb is irregular here, which is exactly what a
                      learner wants flagged. */}
                  {form.source === 'stored' && (
                    <abbr className="verb-irregular" title="Irregular — stored rather than derived">
                      ×
                    </abbr>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}

      {verb.note && <p className="verb-note">{verb.note}</p>}
    </div>
  );
}

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
