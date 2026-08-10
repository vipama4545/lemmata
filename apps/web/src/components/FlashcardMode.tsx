import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { LevelFilter } from '@georgian/shared/types';
import type { StudyItem } from '../study/items';
import { studyCategories, studyItem, studyItems } from '../study/items';
import type { CardRecord, Side } from '../study/store';
import {
  SIDES,
  cardId,
  cardOf,
  gradeCard,
  newTodayCount,
  progressNow,
  setCardMastery,
  splitCardId,
  undoCard,
  useProgress,
} from '../study/store';
import type { Grade } from '../study/mastery';
import { GRADES, GRADE_LABEL, KNOWN, formatDue, formatInterval, isDue, nextInterval } from '../study/mastery';
import { creditLine, getWordImage } from '../utils/images';
import MasteryBadge from './Mastery';
import Icon from './Icon';
import { lang } from '../content/store';

// The review session.
//
// A deck rather than a carousel: what you are shown is decided by when each card is next
// wanted, not by where you last stopped in a list. The four buttons under a revealed card are
// Anki's, and mean the same thing — they set the level *and* the wait, which is the whole
// point of grading rather than ticking "known".
//
// A card is one direction of one word, again as in Anki: recognising მგელი and producing it
// from "wolf" are different skills with their own levels and their own due dates, and the
// deck deals them separately. "Both sides" puts both in the pool and shuffles them together;
// it never shows you both halves of the same word at once, because seeing the answer is
// exactly what a review is not.
//
// Nothing flips. The answer appears under the question and the card grows to hold it, which
// is also what stops a tall picture from spilling out of a face that had to be a fixed size
// to have a back at all.

/** Which directions the session deals. */
type Mode = Side | 'both';

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'target', label: 'Target → English', hint: 'See the word, recall the meaning' },
  { id: 'en', label: 'English → Target', hint: 'See the meaning, recall the word' },
  { id: 'both', label: 'Both sides', hint: 'Both directions in one pool, one at a time' },
];

const SIDE_LABEL: Record<Side, string> = { target: 'Target → English', en: 'English → Target' };

/** The sides a mode deals. */
function sidesFor(mode: Mode): Side[] {
  return mode === 'both' ? SIDES : [mode];
}

type DeckKind = 'all' | 'words' | 'verbs';

const NEW_LIMITS = [10, 20, 50, 100, 0];

interface Settings {
  mode: Mode;
  deck: DeckKind;
  cefr: LevelFilter;
  categoryId: string;
  /** How many never-seen cards a *day* may introduce. 0 means all of them. */
  newLimit: number;
  /** Deal cards that are not due yet, once the ones that are have run out. */
  ahead: boolean;
  /** Deal the cards you retired at level 6. Off, or "known" would not mean anything. */
  includeKnown: boolean;
}

const DEFAULTS: Settings = {
  mode: 'target',
  deck: 'all',
  cefr: 'all',
  categoryId: 'all',
  newLimit: 20,
  ahead: false,
  includeKnown: false,
};

const SETTINGS_KEY = 'flashcard-settings';

function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return saved ? { ...DEFAULTS, ...(JSON.parse(saved) as Partial<Settings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

/** Filters a caller may pre-set through the router state when linking here. */
interface FlashcardState {
  level?: LevelFilter;
  categoryId?: string;
}

function shuffled(keys: string[]): string[] {
  const out = keys.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The order to work through, as card ids — one word in one direction each.
 *
 * Cards that are due lead, oldest first, because they are the ones about to be forgotten. New
 * cards follow, shuffled: they have no order of their own beyond the arbitrary one the word
 * list was scraped in, and shuffling is also what keeps the two directions of the same word
 * from landing back to back in "both sides", where the second would answer itself.
 *
 * The new-card cap is what is left of *today's* allowance rather than a fresh one per queue:
 * rebuilding — which changing any filter does — would otherwise hand out another twenty every
 * time, and the limit would only ever be a suggestion.
 *
 * Built from the store directly rather than from the rendered records: it has to be rebuilt
 * when the *filters* change and not when an answer changes a record, or the card just
 * answered would disappear and reshuffle everything under the cursor.
 */
function buildQueue(deck: StudyItem[], settings: Settings, now: number): string[] {
  const progress = progressNow();
  const allowance = settings.newLimit > 0 ? Math.max(0, settings.newLimit - newTodayCount(progress, now)) : Infinity;

  const due: { card: string; at: number }[] = [];
  const later: { card: string; at: number }[] = [];
  const fresh: string[] = [];
  const retired: string[] = [];

  for (const item of deck) {
    for (const side of sidesFor(settings.mode)) {
      const card = cardId(item.key, side);
      const record = cardOf(progress, item.key, side);
      if (!record) fresh.push(card);
      else if (record.level >= KNOWN) retired.push(card);
      else if (record.due <= now) due.push({ card, at: record.due });
      else later.push({ card, at: record.due });
    }
  }

  due.sort((a, b) => a.at - b.at);
  later.sort((a, b) => a.at - b.at);
  const newCards = allowance === Infinity ? shuffled(fresh) : shuffled(fresh).slice(0, allowance);

  return [
    ...due.map(entry => entry.card),
    ...newCards,
    ...(settings.ahead ? later.map(entry => entry.card) : []),
    ...(settings.includeKnown ? retired : []),
  ];
}

/** One answer, kept so it can be taken back: a misclick otherwise costs months of interval. */
interface UndoStep {
  /** The queue entry to restore. */
  card: string;
  /** Every record the answer touched — two of them when it was the Known button. */
  edits: { item: string; side: Side; before: CardRecord | null }[];
}

function FlashcardMode() {
  const location = useLocation();
  const progress = useProgress();

  const [settings, setSettings] = useState<Settings>(() => {
    const state = location.state as FlashcardState | null;
    return {
      ...loadSettings(),
      ...(state?.level ? { cefr: state.level } : {}),
      ...(state?.categoryId ? { categoryId: state.categoryId } : {}),
    };
  });
  const [showSettings, setShowSettings] = useState(false);

  const [queue, setQueue] = useState<string[]>([]);
  const [done, setDone] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [undoStep, setUndoStep] = useState<UndoStep | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // A browser that refuses to remember the filters still deals cards.
    }
  }, [settings]);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const deck = useMemo(
    () =>
      studyItems().filter(item => {
        if (settings.deck === 'words' && item.isVerb) return false;
        if (settings.deck === 'verbs' && !item.isVerb) return false;
        if (settings.cefr !== 'all' && item.cefr !== settings.cefr) return false;
        if (settings.categoryId !== 'all' && item.categoryId !== settings.categoryId) return false;
        return true;
      }),
    [settings.deck, settings.cefr, settings.categoryId],
  );

  const rebuild = useCallback(
    (shuffle = false) => {
      const next = buildQueue(deck, settings, Date.now());
      setQueue(shuffle ? shuffled(next) : next);
      setDone(0);
      setRevealed(false);
      setUndoStep(null);
    },
    [deck, settings],
  );

  // Only when the deck itself changes, or when the database has finished loading. Answering a
  // card must not land here; see buildQueue.
  useEffect(() => {
    if (progress.ready) rebuild();
  }, [rebuild, progress.ready]);

  const sides = useMemo(() => sidesFor(settings.mode), [settings.mode]);
  const currentCard = queue[0];
  const { item: currentKey, side: currentSide } = currentCard
    ? splitCardId(currentCard)
    : { item: '', side: 'ka' as Side };
  const current = currentKey ? studyItem(currentKey) : undefined;
  const record = currentKey ? (cardOf(progress, currentKey, currentSide) ?? null) : null;
  const image = getWordImage(current ? { id: current.imageId } : null);

  const finishTurn = useCallback((keep: boolean) => {
    setQueue(prev => (keep ? [...prev.slice(1), prev[0]] : prev.slice(1)));
    setDone(prev => prev + 1);
    setRevealed(false);
  }, []);

  const answer = useCallback(
    (grade: Grade) => {
      if (!currentCard) return;
      const before = gradeCard(currentKey, currentSide, grade);
      setUndoStep({ card: currentCard, edits: [{ item: currentKey, side: currentSide, before }] });
      // "Again" keeps the card in the session rather than putting it a day away.
      finishTurn(grade === 'again');
    },
    [currentCard, currentKey, currentSide, finishTurn],
  );

  // Retires both directions, not just the one on screen. "I know this" is a claim about the
  // word — the same one the checkbox at the end of a story makes — and leaving the other
  // direction in the pool would contradict the button you just pressed.
  const markKnown = useCallback(() => {
    if (!currentCard) return;
    const edits = SIDES.map(side => ({
      item: currentKey,
      side,
      before: cardOf(progressNow(), currentKey, side) ?? null,
    }));
    for (const side of SIDES) setCardMastery(currentKey, side, KNOWN);
    setUndoStep({ card: currentCard, edits });
    // The other direction may be sitting further down the queue; it is retired now too.
    setQueue(prev => prev.slice(1).filter(card => splitCardId(card).item !== currentKey));
    setDone(prev => prev + 1);
    setRevealed(false);
  }, [currentCard, currentKey]);

  const skip = useCallback(() => {
    setQueue(prev => (prev.length > 1 ? [...prev.slice(1), prev[0]] : prev));
    setRevealed(false);
  }, []);

  const undo = useCallback(() => {
    if (!undoStep) return;
    for (const edit of undoStep.edits) undoCard(edit.item, edit.side, edit.before);
    setQueue(prev => [undoStep.card, ...prev.filter(card => card !== undoStep.card)]);
    setDone(prev => Math.max(0, prev - 1));
    setRevealed(true);
    setUndoStep(null);
  }, [undoStep]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;

      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (revealed) answer('good');
        else setRevealed(true);
        return;
      }

      const grade = GRADES[Number(event.key) - 1];
      if (grade && revealed) {
        event.preventDefault();
        answer(grade);
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'k') markKnown();
      else if (key === 's' || event.key === 'ArrowRight') skip();
      else if (key === 'u') undo();
    },
    [revealed, answer, markKnown, skip, undo],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // What the deck as a whole looks like, counted per card — so "both sides" reports twice as
  // many as there are words, which is what it deals.
  const summary = useMemo(() => {
    const now = Date.now();
    const counts = { unseen: 0, weak: 0, solid: 0, known: 0, due: 0, total: 0 };
    for (const item of deck) {
      for (const side of sides) {
        counts.total += 1;
        const card = cardOf(progress, item.key, side);
        if (!card) counts.unseen += 1;
        else if (card.level >= KNOWN) counts.known += 1;
        else if (card.level >= 4) counts.solid += 1;
        else counts.weak += 1;
        if (card && isDue(card, now)) counts.due += 1;
      }
    }
    return counts;
    // `sides` is derived from settings.mode, which `progress` and `deck` do not cover.
  }, [deck, sides, progress]);

  const newToday = useMemo(() => newTodayCount(progress, Date.now()), [progress]);
  const sessionTotal = done + queue.length;
  const sessionPct = sessionTotal > 0 ? Math.round((done / sessionTotal) * 100) : 0;
  const pct = (value: number) => (summary.total > 0 ? (value / summary.total) * 100 : 0);

  return (
    <div className="main-content flashcard-page">
      <div className="breadcrumb">
        <Link to={`/${lang()}`}>← Home</Link>
        <span className="breadcrumb-sep">/</span>
        <span>Flashcards</span>
      </div>

      <div className="flashcard-container">
        <div className="flashcard-header">
          <div>
            <h2>Flashcards</h2>
            <p className="study-subtitle">
              {summary.due > 0 ? `${summary.due} due now` : 'Nothing overdue'} ·{' '}
              {settings.newLimit > 0 ? `${newToday}/${settings.newLimit} new today` : `${newToday} new today`} ·{' '}
              {summary.unseen} never seen · {summary.known} known
            </p>
          </div>
          <button className="settings-toggle" onClick={() => setShowSettings(!showSettings)} aria-expanded={showSettings}>
            <Icon name="sliders" /> Settings
          </button>
        </div>

        {showSettings && (
          <div className="flashcard-settings">
            <div className="settings-group">
              <label id="mode-label">Direction:</label>
              <div className="level-filter" role="group" aria-labelledby="mode-label">
                {MODES.map(mode => (
                  <button
                    key={mode.id}
                    className={`level-btn ${settings.mode === mode.id ? 'active' : ''}`}
                    onClick={() => update('mode', mode.id)}
                    title={mode.hint}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-group">
              <label id="deck-label">Deck:</label>
              <div className="level-filter" role="group" aria-labelledby="deck-label">
                <button className={`level-btn ${settings.deck === 'all' ? 'active' : ''}`} onClick={() => update('deck', 'all')}>
                  Everything
                </button>
                <button className={`level-btn ${settings.deck === 'words' ? 'active' : ''}`} onClick={() => update('deck', 'words')}>
                  Words only
                </button>
                <button className={`level-btn ${settings.deck === 'verbs' ? 'active' : ''}`} onClick={() => update('deck', 'verbs')}>
                  Verbs only
                </button>
              </div>
            </div>

            <div className="settings-group">
              <label id="cefr-label">CEFR level:</label>
              <div className="level-filter" role="group" aria-labelledby="cefr-label">
                <button className={`level-btn ${settings.cefr === 'all' ? 'active' : ''}`} onClick={() => update('cefr', 'all')}>
                  All
                </button>
                <button className={`level-btn ${settings.cefr === 'A1' ? 'active a1' : ''}`} onClick={() => update('cefr', 'A1')}>
                  A1
                </button>
                <button className={`level-btn ${settings.cefr === 'A2' ? 'active a2' : ''}`} onClick={() => update('cefr', 'A2')}>
                  A2
                </button>
              </div>
            </div>

            <div className="settings-group">
              <label htmlFor="category-select">Category:</label>
              <select
                id="category-select"
                value={settings.categoryId}
                onChange={event => update('categoryId', event.target.value)}
                className="category-select"
              >
                <option value="all">All categories</option>
                {studyCategories().map(category => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-group">
              <label htmlFor="new-limit">New cards per day:</label>
              <select
                id="new-limit"
                value={settings.newLimit}
                onChange={event => update('newLimit', Number(event.target.value))}
                className="category-select"
              >
                {NEW_LIMITS.map(limit => (
                  <option key={limit} value={limit}>
                    {limit === 0 ? 'No limit' : limit}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-group settings-checks">
              <label className="check">
                <input type="checkbox" checked={settings.ahead} onChange={event => update('ahead', event.target.checked)} />
                Study ahead — deal cards that are not due yet
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.includeKnown}
                  onChange={event => update('includeKnown', event.target.checked)}
                />
                Include words marked Known
              </label>
            </div>

            <p className="settings-shortcuts">
              <strong>Space</strong> reveal, then Good · <strong>1–4</strong> grade · <strong>K</strong> known ·{' '}
              <strong>S</strong> skip · <strong>U</strong> undo
            </p>
          </div>
        )}

        {/* What the deck looks like overall, and how far through the sitting you are. */}
        <div className="study-status">
          <div
            className="study-meter"
            role="img"
            aria-label={`${summary.known} known, ${summary.solid} solid, ${summary.weak} being learned, ${summary.unseen} never seen`}
          >
            <span className="study-meter-seg is-known" style={{ width: `${pct(summary.known)}%` }} />
            <span className="study-meter-seg is-solid" style={{ width: `${pct(summary.solid)}%` }} />
            <span className="study-meter-seg is-weak" style={{ width: `${pct(summary.weak)}%` }} />
          </div>
          <div className="study-legend">
            <span><i className="dot is-known" />{summary.known} known</span>
            <span><i className="dot is-solid" />{summary.solid} solid</span>
            <span><i className="dot is-weak" />{summary.weak} learning</span>
            <span><i className="dot is-unseen" />{summary.unseen} new</span>
            <span className="study-legend-session">{done}/{sessionTotal} this session ({sessionPct}%)</span>
          </div>
        </div>

        {current ? (
          <StudyCard
            item={current}
            side={currentSide}
            record={record}
            revealed={revealed}
            image={image}
            onReveal={() => setRevealed(true)}
            onAnswer={answer}
            onKnown={markKnown}
          />
        ) : !progress.ready ? (
          <div className="no-words">
            <h3>Loading your progress…</h3>
          </div>
        ) : (
          <div className="no-words">
            <h3>{summary.total === 0 ? 'Nothing in this deck' : 'All caught up'}</h3>
            <p>
              {summary.total === 0
                ? 'Try widening the filters in Settings.'
                : settings.newLimit > 0 && newToday >= settings.newLimit && summary.unseen > 0
                  ? `Today's ${settings.newLimit} new cards are done, and nothing else is due. Raise the daily limit in Settings, or come back tomorrow.`
                  : 'Everything due today is done. Come back tomorrow, or study ahead.'}
            </p>
            <div className="flashcard-controls">
              {!settings.ahead && summary.total > 0 && (
                <button className="control-btn" onClick={() => update('ahead', true)}>
                  <Icon name="clock" /> Study ahead
                </button>
              )}
              <button className="control-btn" onClick={() => rebuild()}>
                <Icon name="refresh" /> Rebuild queue
              </button>
            </div>
          </div>
        )}

        {current && (
          <div className="flashcard-controls">
            <button className="control-btn" onClick={skip} title="Put this card at the back of the queue">
              <Icon name="arrow-right" /> Skip
            </button>
            <button className="control-btn" onClick={() => rebuild(true)} title="Rebuild the queue in a random order">
              <Icon name="shuffle" /> Shuffle
            </button>
            <button className="control-btn" onClick={undo} disabled={!undoStep} title="Take back the last answer">
              <Icon name="refresh" /> Undo
            </button>
            <Link className="control-btn" to={current.href}>
              <Icon name="book" /> Full entry
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the card */

interface StudyCardProps {
  item: StudyItem;
  side: Side;
  record: CardRecord | null;
  revealed: boolean;
  image: ReturnType<typeof getWordImage>;
  onReveal: () => void;
  onAnswer: (grade: Grade) => void;
  onKnown: () => void;
}

function StudyCard({ item, side, record, revealed, image, onReveal, onAnswer, onKnown }: StudyCardProps) {
  // The question, then the answer under it. Which is which is the whole difference between
  // the two directions, so it is the only thing the card branches on.
  const order: Side[] = side === 'en' ? ['en', 'target'] : ['target', 'en'];

  const face = (face: Side) => {
    if (face !== side && !revealed) return null;
    return (
      <div key={face} className={`study-face${face === side ? '' : ' is-second'}`}>
        {face === 'target' ? (
          <>
            <p className="study-georgian">{item.headword}</p>
            {item.sub && <p className="study-georgian-sub">{item.sub}</p>}
          </>
        ) : (
          <>
            <p className="study-english">{item.english}</p>
            {item.senses.length > 1 && <p className="study-senses">{item.senses.slice(1, 4).join(' · ')}</p>}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="study-shell">
      <article className="study-card">
        <header className="study-card-top">
          <div className="study-tags">
            {item.cefr && <span className={`level-badge ${item.cefr.toLowerCase()}`}>{item.cefr}</span>}
            {item.partOfSpeech && <span className="pos-tag">{item.partOfSpeech}</span>}
            {item.kind === 'verb' && <span className="pos-tag">paradigm</span>}
          </div>
          <span className="study-direction">{SIDE_LABEL[side]}</span>
        </header>

        <div className="study-card-main">
          {order.map(face)}

          {!revealed && (
            <button type="button" className="study-reveal" onClick={onReveal}>
              Show answer <span className="study-reveal-key">Space</span>
            </button>
          )}
        </div>

        {revealed && (
          <div className="study-card-extra">
            {item.definition && <p className="study-definition">{item.definition}</p>}
            {image && (
              <figure className="study-image">
                <img src={image.url} alt={item.english} loading="lazy" />
                {creditLine(image) && <figcaption className="image-credit">{creditLine(image)}</figcaption>}
              </figure>
            )}
            <p className="study-category">{item.category}</p>
          </div>
        )}
      </article>

      {revealed && (
        <div className="study-grades">
          <GradeRow record={record} onGrade={onAnswer} />
          <button
            type="button"
            className="control-btn know study-known"
            onClick={onKnown}
            title="Retires both directions of this word"
          >
            <Icon name="check" /> Known — never ask again
          </button>
        </div>
      )}
    </div>
  );
}

// The four grades, each showing the wait it buys — the number is what makes the choice
// between Hard and Good a real one rather than a mood.
function GradeRow({ record, onGrade }: { record: CardRecord | null; onGrade: (grade: Grade) => void }) {
  const now = Date.now();
  return (
    <div className="grade-row">
      <div className="grade-row-head">
        <MasteryBadge level={record?.level ?? null} />
        {record && <span className="grade-row-due">{formatDue(record.due, now)}</span>}
      </div>
      <div className="grade-buttons" role="group" aria-label="Grade this card">
        {GRADES.map(grade => (
          <button key={grade} type="button" className={`grade-btn is-${grade}`} onClick={() => onGrade(grade)}>
            <span className="grade-btn-label">{GRADE_LABEL[grade]}</span>
            <span className="grade-btn-when">{formatInterval(nextInterval(record, grade))}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default FlashcardMode;
