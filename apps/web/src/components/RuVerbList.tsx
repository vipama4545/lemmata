// Every Russian verb, filterable by the thing that actually distinguishes them.
//
// Its Georgian counterpart filters by conjugation group, because that is the axis the
// spreadsheet gives. Here the first question is always aspect — делать and сделать are two
// entries and a learner needs to see which is which before anything else — and the second is
// the conjugation, in whichever of the two depths they want it. Same two-tier choice the verb
// page makes, and for the same reason: 1st/2nd is what you need to conjugate, and Zaliznyak's
// sixteen are what explain why.
//
// The chrome — breadcrumb, header, toolbar, card rows — is the word and verb indexes', so a
// reader who switches dictionaries lands on a page they already know how to read. Only the
// columns differ, because a Russian row carries one headword and an aspect where a Georgian
// one carries two forms.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RU_CLASSES, RU_CONJUGATIONS } from '@georgian/shared/grammar/ru';
import { lang, ruVerbData } from '../content/store';
import Icon from './Icon';

type Grouping = 'conjugation' | 'class';
type Aspect = 'all' | 'impf' | 'pf';

const ASPECTS: { id: Aspect; label: string }[] = [
  { id: 'all', label: 'Both' },
  { id: 'impf', label: 'Imperfective' },
  { id: 'pf', label: 'Perfective' },
];

export default function RuVerbList() {
  const [search, setSearch] = useState('');
  const [aspect, setAspect] = useState<Aspect>('all');
  const [grouping, setGrouping] = useState<Grouping>('conjugation');
  const [group, setGroup] = useState('all');

  const all = ruVerbData().verbs;

  // Which bucket each verb falls in under the current depth. Recomputed rather than stored,
  // because switching depth must not lose the list — only re-label it.
  const bucketOf = useMemo(() => {
    const conjugationOf = new Map(RU_CLASSES.map(cls => [cls.id, cls.conjugation]));
    return (classId: string) => (grouping === 'class' ? classId : (conjugationOf.get(classId as never) ?? 'mixed'));
  }, [grouping]);

  const buckets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const verb of all) {
      const key = bucketOf(verb.classId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return grouping === 'class'
      ? RU_CLASSES.filter(cls => counts.has(cls.id)).map(cls => ({
          id: cls.id,
          label: `Class ${cls.id} — ${cls.label}`,
          count: counts.get(cls.id) ?? 0,
        }))
      : RU_CONJUGATIONS.filter(entry => counts.has(entry.id)).map(entry => ({
          id: entry.id,
          label: entry.label,
          count: counts.get(entry.id) ?? 0,
        }));
  }, [all, bucketOf, grouping]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter(verb => {
      if (aspect !== 'all' && verb.aspect !== aspect) return false;
      if (group !== 'all' && bucketOf(verb.classId) !== group) return false;
      if (!needle) return true;
      return verb.infinitive.includes(needle) || verb.english.toLowerCase().includes(needle);
    });
  }, [all, search, aspect, group, bucketOf]);

  return (
    <div className="main-content">
      <div className="breadcrumb">
        <Link to={`/${lang()}/categories`}>← Categories</Link>
        <span className="breadcrumb-sep">/</span>
        <span>Verbs</span>
      </div>

      <div className="category-header">
        <span className="category-thumb category-thumb-sm category-thumb-letter" aria-hidden="true">Г</span>
        <div className="category-header-text">
          <h1>Verbs</h1>
          <p className="category-header-geo">глаголы</p>
          <span className="word-count">{shown.length} verbs</span>
        </div>
      </div>

      <p className="verb-list-intro">
        Each verb stores a conjugation rule rather than a table of forms — open any of them to
        see the full paradigm.
      </p>

      <div className="toolbar">
        <div className="search-field">
          <Icon name="search" />
          <input
            type="text"
            className="search-input"
            placeholder="Filter verbs…"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </div>

        <div className="level-filter" role="group" aria-label="Aspect">
          {ASPECTS.map(option => (
            <button
              key={option.id}
              className={`level-btn ${aspect === option.id ? `active ${option.id}` : ''}`}
              aria-pressed={aspect === option.id}
              onClick={() => setAspect(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="group-select">
          <span className="group-select-label">Group by</span>
          <select
            value={grouping}
            onChange={event => {
              setGrouping(event.target.value as Grouping);
              // The buckets change entirely, so the selected one no longer means anything.
              setGroup('all');
            }}
          >
            <option value="conjugation">Conjugation (2)</option>
            <option value="class">Zaliznyak class (16)</option>
          </select>
        </label>

        <label className="group-select">
          <span className="group-select-label">Group</span>
          <select value={group} onChange={event => setGroup(event.target.value)}>
            <option value="all">All ({all.length})</option>
            {buckets.map(bucket => (
              <option key={bucket.id} value={bucket.id}>
                {bucket.label} ({bucket.count})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="verb-list">
        {/* Unclassed spans: the head takes its type from .verb-list-head, and the cell rules
            below would otherwise resize its columns one at a time. */}
        <div className="verb-list-head verb-list-head-ru">
          <span>Aspect</span>
          <span>Infinitive</span>
          <span>English</span>
          <span>{grouping === 'class' ? 'Class' : 'Conjugation'}</span>
        </div>

        {shown.map(verb => (
          <Link key={verb.id} to={`/${lang()}/verbs/${verb.id}`} className="verb-card verb-card-ru">
            <span className="verb-col-aspect">
              <span className={`verb-tag verb-aspect-${verb.aspect}`}>
                {verb.aspect === 'pf' ? 'pf' : 'impf'}
              </span>
            </span>
            <span className="verb-col-infinitive" lang="ru">
              {verb.accented || verb.infinitive}
            </span>
            <span className="verb-col-english">{verb.english}</span>
            <span className="verb-col-class">
              {grouping === 'class' ? `class ${verb.classId}` : conjugationLabel(verb.classId)}
            </span>
            <Icon name="arrow-right" className="verb-card-arrow" />
          </Link>
        ))}

        {shown.length === 0 && <p className="empty-note">No verbs match that filter.</p>}
      </div>
    </div>
  );
}

const CONJUGATION_OF = new Map(RU_CLASSES.map(cls => [cls.id, cls.conjugation]));

function conjugationLabel(classId: string): string {
  const which = CONJUGATION_OF.get(classId as never);
  return which === '1' ? '1st conj.' : which === '2' ? '2nd conj.' : 'irregular';
}
