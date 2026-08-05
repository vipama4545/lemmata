// How well something is known, and when it should come round again.
//
// Nothing here touches storage or React: it is the arithmetic of the scheduler on its own,
// so the numbers can be reasoned about — and changed — without disturbing anything else.

/**
 * How well one side of one item is known, 6 down to 1.
 *
 * A word you have never met has *no record at all* rather than a level of 0. That absence
 * is a state in its own right — it is what the story reader paints as new, and what
 * "mark everything I have never studied as known" acts on — and keeping it out of the
 * scale means it can never be confused with "I saw it and it was hopeless", which is 1.
 */
export type Mastery = 1 | 2 | 3 | 4 | 5 | 6;

export const MASTERIES: Mastery[] = [1, 2, 3, 4, 5, 6];

/**
 * 6 is only ever reached by saying so — the Known button on a card, the level picker in a
 * story, the checkbox at the end of one. Answering well takes a card to 5 and no further,
 * because "I got this right three times" and "stop showing me this" are different claims
 * and only the second should retire a word for good.
 */
export const KNOWN: Mastery = 6;

/** The level a card is filed at the first time it is answered, before any grade applies. */
export const NEW_LEVEL: Mastery = 2;

/** The highest level answering a card can earn. Above it is the Known button's business. */
export const EARNED_MAX: Mastery = 5;

export const MASTERY_LABEL: Record<Mastery, string> = {
  6: 'Known',
  5: 'Very good',
  4: 'Good',
  3: 'Learning',
  2: 'New',
  1: 'Struggling',
};

/** What each level means, for the tooltips on a level picker. */
export const MASTERY_NOTE: Record<Mastery, string> = {
  6: 'Retired — never comes up again',
  5: 'Solid; only the occasional check',
  4: 'You know it',
  3: 'Currently learning it',
  2: 'Brand new to you',
  1: 'Keeps slipping away',
};

/** The label for a word with no record: never met, in a flashcard deck or anywhere else. */
export const UNSEEN_LABEL = 'Never seen';

/** A level, or null for the word that has never been met. What every reader deals in. */
export type MasteryValue = Mastery | null;

/** The value for a `data-mastery` attribute, which is what the stylesheet colours from. */
export function masteryAttr(level: MasteryValue): string {
  return level === null ? 'unseen' : String(level);
}

export function masteryLabel(level: MasteryValue): string {
  return level === null ? UNSEEN_LABEL : MASTERY_LABEL[level];
}

/* ------------------------------------------------------------------ grading */

/** The four buttons under a revealed card, worst first. */
export type Grade = 'again' | 'hard' | 'good' | 'easy';

export const GRADES: Grade[] = ['again', 'hard', 'good', 'easy'];

export const GRADE_LABEL: Record<Grade, string> = {
  again: 'Very hard',
  hard: 'Hard',
  good: 'Good',
  easy: 'Easy',
};

/** What one answer does to the level. `again` is absolute rather than a step. */
const LEVEL_STEP: Record<Grade, number> = { again: 0, hard: -1, good: 1, easy: 2 };

/** How an answer nudges the difficulty multiplier, SM-2 style. */
const EASE_STEP: Record<Grade, number> = { again: -0.2, hard: -0.15, good: 0, easy: 0.15 };

const MINUTE = 60_000;
const DAY = 86_400_000;

const START_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_EASE = 3;
/** Ten years is not a schedule, it is a promise never to ask again. */
const MAX_INTERVAL = 365;

/** How soon a card you got wrong comes back — within the session, as Anki does it. */
const AGAIN_DELAY = 10 * MINUTE;

/**
 * The first real interval, in days, for a card that has none yet. A card is "learning"
 * until it has earned an interval of at least a day, and these are the steps out of it.
 */
const FIRST_INTERVAL: Record<Exclude<Grade, 'again'>, number> = { hard: 1, good: 2, easy: 4 };

/** The interval a level implies, for the times a level is set by hand rather than earned. */
const INTERVAL_BY_LEVEL: Record<Mastery, number> = { 1: 0, 2: 1, 3: 2, 4: 7, 5: 21, 6: MAX_INTERVAL };

/** One side of one item's scheduling state. */
export interface Review {
  level: Mastery;
  /** Days until the next review. 0 while the card is still being learned today. */
  interval: number;
  /** SM-2's difficulty multiplier: how much the interval grows on a correct answer. */
  ease: number;
  /** When it is next wanted, epoch ms. */
  due: number;
  /** How many times it has been answered. */
  reps: number;
  /** How many times it has been forgotten after having been learned. */
  lapses: number;
  /** When it was last answered, epoch ms. */
  last: number;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

const clampLevel = (value: number): Mastery => clamp(Math.round(value), 1, 6) as Mastery;

/** The interval an answer earns, in days. Split out so the buttons can preview it. */
export function nextInterval(prev: Review | null, grade: Grade): number {
  if (grade === 'again') return 0;

  const interval = prev?.interval ?? 0;
  const ease = prev?.ease ?? START_EASE;

  // Still being learned: the first answers get fixed steps, because a multiple of nothing
  // is nothing and a card would never leave the same-day queue.
  if (interval < 1) return FIRST_INTERVAL[grade];

  const grown =
    grade === 'hard' ? interval * 1.2 : grade === 'good' ? interval * ease : interval * ease * 1.3;
  return clamp(Math.round(grown), 1, MAX_INTERVAL);
}

/** The state one answer leaves a card in. `prev` is null for a card never studied before. */
export function applyGrade(prev: Review | null, grade: Grade, now: number): Review {
  const level = prev?.level ?? NEW_LEVEL;
  const ease = clamp((prev?.ease ?? START_EASE) + EASE_STEP[grade], MIN_EASE, MAX_EASE);
  const reps = (prev?.reps ?? 0) + 1;
  const lapses = (prev?.lapses ?? 0) + (grade === 'again' && (prev?.interval ?? 0) >= 1 ? 1 : 0);

  if (grade === 'again') {
    return { level: 1, interval: 0, ease, due: now + AGAIN_DELAY, reps, lapses, last: now };
  }

  // The first time you meet a word, answering it at all leaves it at least New: only
  // failing outright — which is `again` above — or slipping back later files it below that.
  const floor = prev ? 1 : NEW_LEVEL;
  const interval = nextInterval(prev, grade);
  return {
    level: clampLevel(clamp(level + LEVEL_STEP[grade], floor, EARNED_MAX)),
    interval,
    ease,
    due: now + interval * DAY,
    reps,
    lapses,
    last: now,
  };
}

/**
 * The state a level chosen by hand leaves a card in. Saying "I am learning this" out loud
 * has to schedule it too, or the word would be labelled and then never asked about.
 */
export function applyLevel(prev: Review | null, level: Mastery, now: number): Review {
  const interval = INTERVAL_BY_LEVEL[level];
  return {
    level,
    interval,
    ease: prev?.ease ?? START_EASE,
    due: now + interval * DAY,
    reps: prev?.reps ?? 0,
    lapses: prev?.lapses ?? 0,
    last: now,
  };
}

/* --------------------------------------------------------------- formatting */

/** "10m", "3d", "1.5mo", "2.1y" — the wait a grade button is offering. */
export function formatInterval(days: number): string {
  if (days <= 0) return '10m';
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${(days / 30).toFixed(days < 90 ? 1 : 0)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/** How long until a card is wanted again, in words. */
export function formatDue(due: number, now: number): string {
  const ms = due - now;
  if (ms <= 0) return 'due now';
  if (ms < DAY) return 'due today';
  const days = Math.round(ms / DAY);
  if (days === 1) return 'due tomorrow';
  return `due in ${formatInterval(days)}`;
}

/** True when a card is wanted now. Cards at level 6 are never wanted; see `KNOWN`. */
export function isDue(review: Review, now: number): boolean {
  return review.level < KNOWN && review.due <= now;
}
