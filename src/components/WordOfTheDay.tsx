import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { Screeve, ScreeveForms, Verb } from "../types";
import allData from "../data/words.json";
import verbData from "../data/verbs.json";
import { wordForDate, previousDays, isoDay } from "../utils/dailyWord";
import { getWordImage, creditLine } from "../utils/images";
import { focusHref } from "../utils/scroll";
import Icon from "./Icon";

const FULL_DATE: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
const SHORT_DATE: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
const PAST_DAYS = 4;

// Verbs get a card of their own below, drawn from the conjugation spreadsheet rather than
// from the scraped dictionary, so they are kept out of the word pick: a words.json entry
// tagged Verb is a conjugated form (აარსებს "establishes") and belongs to that card, not
// this one. Verbal nouns stay — a masdar is a headword noun, which is why the tagging
// convention gives it its own tag rather than filing it under Verb.
//
// Filtered once at module scope, because the pick is a permutation of the whole list: a
// list rebuilt per mount would still be the same words in the same order, but there is no
// reason to redo it, and the run cache is keyed by length.
const DAILY_WORDS = allData.words.filter(word => word.partOfSpeech !== "Verb");

// The landing page: one word and one verb, both picked from the date. The picks are
// computed once per mount — nobody leaves the tab open across midnight, and a card that is
// a few hours stale is better than one that swaps itself out while it is being read.
function WordOfTheDay() {
  const { today, word, verb, earlierWords, earlierVerbs } = useMemo(() => {
    const now = new Date();
    return {
      today: now,
      word: wordForDate(DAILY_WORDS, now),
      verb: wordForDate(verbData.verbs, now),
      earlierWords: previousDays(DAILY_WORDS, now, PAST_DAYS).map(({ date, word: past }) => ({
        date,
        to: focusHref(`/category/${past.categoryId}`, past.id),
        georgian: past.georgian,
        english: past.english,
      })),
      earlierVerbs: previousDays(verbData.verbs, now, PAST_DAYS).map(({ date, word: past }) => ({
        date,
        to: `/verbs/${past.id}`,
        georgian: headword(past) || past.english,
        // The card would otherwise print the English twice for the handful of verbs the
        // spreadsheet gives no Georgian headword at all.
        english: headword(past) ? past.english : "",
      })),
    };
  }, []);

  if (!word) return null;

  const image = getWordImage(word);

  return (
    <div className="main-content">
      <section className="daily" aria-labelledby="daily-heading">
        <div className="daily-head">
          <h1 id="daily-heading">
            <Icon name="calendar" size={20} />
            Word of the day
          </h1>
          <time className="daily-date" dateTime={isoDay(today)}>
            {today.toLocaleDateString(undefined, FULL_DATE)}
          </time>
        </div>

        <div className={`daily-card ${image ? "has-image" : ""}`}>
          {image && (
            <figure className="daily-image">
              <img src={image.url} alt={word.english} />
              <figcaption className="image-credit">
                <a href={image.page} target="_blank" rel="noopener noreferrer">
                  {image.title}
                </a>
                {creditLine(image) && <> · {creditLine(image)}</>}
              </figcaption>
            </figure>
          )}

          <div className="daily-text">
            <div className="daily-tags">
              <span className={`level-badge ${word.level.toLowerCase()}`}>{word.level}</span>
              <span className="pos-tag">{word.partOfSpeech}</span>
            </div>
            <p className="daily-georgian">{word.georgian}</p>
            <p className="daily-english">{word.english}</p>
            {word.georgianDefinition && <p className="daily-definition">{word.georgianDefinition}</p>}
            {word.englishFull.length > 1 && (
              <p className="daily-more">
                <span>Also</span> {word.englishFull.slice(1).join(" · ")}
              </p>
            )}
            <Link className="daily-category" to={focusHref(`/category/${word.categoryId}`, word.id)}>
              {word.category}
              <Icon name="arrow-right" size={16} />
            </Link>
          </div>
        </div>
      </section>

      {verb && <VerbOfTheDay verb={verb} />}

      <EarlierDays id="earlier-words-heading" title="Earlier words" entries={earlierWords} />
      <EarlierDays id="earlier-verbs-heading" title="Earlier verbs" entries={earlierVerbs} />

      <div className="quick-links">
        <Link to="/categories" className="quick-link categories-link">
          <Icon name="grid" /> Browse Categories
        </Link>
        <Link to="/flashcards" className="quick-link flashcard-link">
          <Icon name="cards" /> Flashcard Mode
        </Link>
        <Link to="/search" className="quick-link search-link">
          <Icon name="search" /> Word Search
        </Link>
        <Link to="/export" className="quick-link export-link">
          <Icon name="download" /> Export Anki Deck
        </Link>
        <Link to="/grammar" className="quick-link grammar-link">
          <Icon name="book" /> Grammar Reference
        </Link>
      </div>
    </div>
  );
}

/** One past day in the strip below a card: what was picked, and where it lives. */
interface EarlierEntry {
  date: Date;
  to: string;
  georgian: string;
  english: string;
}

// The last few days of one of the two picks. Words and verbs go to different pages, so the
// entries arrive with their own link already worked out; everything else about the two
// strips is the same, down to the shape of the card.
function EarlierDays({ id, title, entries }: { id: string; title: string; entries: EarlierEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <section className="daily-earlier" aria-labelledby={id}>
      <h2 id={id} className="section-heading">
        {title}
      </h2>
      <div className="earlier-list">
        {entries.map(entry => (
          <Link key={isoDay(entry.date)} to={entry.to} className="earlier-card">
            <time className="earlier-date" dateTime={isoDay(entry.date)}>
              {entry.date.toLocaleDateString(undefined, SHORT_DATE)}
            </time>
            <span className="earlier-georgian">{entry.georgian}</span>
            {entry.english && <span className="earlier-english">{entry.english}</span>}
          </Link>
        ))}
      </div>
    </section>
  );
}

// The day's verb, under the day's word. It carries no CEFR level and no picture — the
// conjugation spreadsheet has neither — so what it shows instead is the paradigm: the
// headword, and one screeve across all six persons. Everything else is a click away.
function VerbOfTheDay({ verb }: { verb: Verb }) {
  const paradigm = dailyScreeve(verb);
  const name = headword(verb);

  return (
    <section className="daily daily-verb" aria-labelledby="verb-daily-heading">
      <div className="daily-head">
        <h2 id="verb-daily-heading">
          <Icon name="table" size={20} />
          Verb of the day
        </h2>
      </div>

      <div className="daily-card daily-verb-card">
        <div className="daily-text">
          <div className="daily-tags">
            {verb.group && <span className="group-tag">{verb.group}</span>}
            {verb.transitivity && <span className="pos-tag">{verb.transitivity}</span>}
          </div>
          <p className="daily-georgian">{name || verb.english}</p>
          {name && <p className="daily-english">{verb.english}</p>}
          {verb.senses.length > 0 && (
            <p className="daily-more">
              <span>Also</span> {verb.senses.join(" · ")}
            </p>
          )}
        </div>

        {paradigm && (
          <div className="daily-conj">
            <p className="daily-conj-label">{paradigm.screeve.label}</p>
            <div className="daily-conj-grid">
              {verbData.persons.map(person => {
                const form = paradigm.forms[person.key];
                return form ? (
                  <div key={person.key} className="daily-conj-cell">
                    <span className="daily-conj-pronoun">{person.pronoun}</span>
                    <span className="daily-conj-form">{form}</span>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        )}

        <Link className="daily-category" to={`/verbs/${verb.id}`}>
          Full conjugation
          <Icon name="arrow-right" size={16} />
        </Link>
      </div>
    </section>
  );
}

/**
 * The Georgian form to show a verb by: its verbal noun, which is the headword a dictionary
 * would list it under, or the third person present for the handful of entries the
 * spreadsheet leaves without one. Empty when it has neither.
 */
function headword(verb: Verb): string {
  return verb.verbalNoun || verb.present3sg;
}

/**
 * The screeve to show on the card: the present, or — for the few defective paradigms that
 * lack one — the first screeve the verb does fill in. verbData.screeves is in the
 * conventional order, present first, so the search only has to run down it.
 */
function dailyScreeve(verb: Verb): { screeve: Screeve; forms: ScreeveForms } | null {
  for (const screeve of verbData.screeves) {
    const forms = verb.forms[screeve.key];
    if (forms) return { screeve, forms };
  }
  return null;
}

export default WordOfTheDay;
