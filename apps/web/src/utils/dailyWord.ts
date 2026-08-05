// The word of the day. Two things are required of the pick: everyone opening the page on a
// given date sees the same word, and a learner who comes back every morning does not keep
// meeting the same handful of words.
//
// Both fall out of treating the list as a permutation rather than as a bag to draw from.
// Every run of N days (N = the number of words) gets its own seeded shuffle of the whole
// list, and the day's offset into that run picks the entry. Within a run each word comes up
// exactly once, so with 1800 words the whole vocabulary goes past — about five years —
// before anything is reused. A plain `words[hash(date) % N]` would instead collide
// constantly: by the birthday bound you would expect a repeated word inside two months.
//
// The run boundary is guarded separately, see minGap below.
//
// Nothing here is specific to words: the functions are generic over the item type, and the
// only thing they ask of an item is that it can sit in a Set.

const DAY_MS = 86400000;

// mulberry32: small, fast, and — the point here — the same stream from the same seed in
// every browser and on every reload. Math.random cannot be used, because the pick has to be
// reproducible from the date alone.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], seed: number): T[] {
  const out = items.slice();
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Spread consecutive run numbers across the seed space; feeding 0, 1, 2… straight into the
// generator gives shuffles that are far too alike.
const seedForRun = (run: number): number => Math.imul(run + 1, 2654435761) >>> 0;

/**
 * How far apart two showings of the same word must stay. Only the seam between runs can
 * violate it — inside a run a word appears exactly once — but the seam is where a naive
 * version of this would fall down: two independent shuffles put roughly √N of the previous
 * run's last words back within a couple of months, which is exactly the "same word again
 * already" the permutation is meant to rule out.
 */
const minGap = (n: number): number => Math.min(180, Math.floor(n / 4));

// Keyed by list length and run number, so it is safe to share across item types; the cast
// on the way out is what that sharing costs.
const runCache = new Map<string, unknown[]>();

function orderForRun<T>(items: T[], run: number): T[] {
  const n = items.length;
  const key = `${n}:${run}`;
  const cached = runCache.get(key) as T[] | undefined;
  if (cached) return cached;

  const order = shuffled(items, seedForRun(run));
  const gap = minGap(n);

  if (gap > 0) {
    // Anything shown in the closing `gap` days of the previous run is pushed out of the
    // opening `gap` days of this one, swapped with a word from the middle. Two constraints
    // make that safe: the donor region stops short of the tail, so this run's own last
    // `gap` entries stay as shuffled — which is what lets the next run read them off the
    // plain shuffle instead of recursing back through every previous run — and the donor
    // pointer only ever moves forward, so the result is the same on every machine.
    const recent = new Set(shuffled(items, seedForRun(run - 1)).slice(n - gap));
    let donor = gap;
    for (let i = 0; i < gap; i++) {
      if (!recent.has(order[i])) continue;
      while (donor < n - gap && recent.has(order[donor])) donor++;
      if (donor >= n - gap) break;
      [order[i], order[donor]] = [order[donor], order[i]];
      donor++;
    }
  }

  runCache.set(key, order);
  return order;
}

/**
 * Days since the Unix epoch for a date's *local* calendar day, so the word turns over at the
 * reader's midnight rather than at UTC midnight.
 */
export function dayIndex(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS) + 2;
}

export function wordForDate<T>(words: T[] | null | undefined, date: Date): T | null {
  if (!words || words.length === 0) return null;
  const n = words.length;
  const day = dayIndex(date);
  const run = Math.floor(day / n);
  return orderForRun(words, run)[day - run * n];
}

/**
 * The `count` days before `date`, most recent first, as `{ date, word }` pairs.
 */
export function previousDays<T>(words: T[], date: Date, count: number): { date: Date; word: T }[] {
  const days: { date: Date; word: T }[] = [];
  for (let back = 1; back <= count; back++) {
    const then = new Date(date.getFullYear(), date.getMonth(), date.getDate() - back);
    const word = wordForDate(words, then);
    if (word) days.push({ date: then, word });
  }
  return days;
}

/** `YYYY-MM-DD` for the local calendar day — for <time dateTime>. */
export function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
