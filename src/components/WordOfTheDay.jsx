import { useMemo } from "react";
import { Link } from "react-router-dom";
import allData from "../data/words.json";
import { wordForDate, previousDays, isoDay } from "../utils/dailyWord";
import { getWordImage, creditLine } from "../utils/images";
import Icon from "./Icon";

const FULL_DATE = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
const SHORT_DATE = { weekday: "short", day: "numeric", month: "short" };
const PAST_DAYS = 4;

// The landing page: one word, picked from the date. The pick is computed once per mount —
// nobody leaves the tab open across midnight, and a card that is a few hours stale is
// better than one that swaps itself out while it is being read.
function WordOfTheDay() {
  const { today, word, earlier } = useMemo(() => {
    const now = new Date();
    return {
      today: now,
      word: wordForDate(allData.words, now),
      earlier: previousDays(allData.words, now, PAST_DAYS),
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
            <Link className="daily-category" to={`/category/${word.categoryId}`}>
              {word.category}
              <Icon name="arrow-right" size={16} />
            </Link>
          </div>
        </div>
      </section>

      {earlier.length > 0 && (
        <section className="daily-earlier" aria-labelledby="earlier-heading">
          <h2 id="earlier-heading" className="section-heading">
            Earlier days
          </h2>
          <div className="earlier-list">
            {earlier.map(({ date, word: past }) => (
              <Link key={isoDay(date)} to={`/category/${past.categoryId}`} className="earlier-card">
                <time className="earlier-date" dateTime={isoDay(date)}>
                  {date.toLocaleDateString(undefined, SHORT_DATE)}
                </time>
                <span className="earlier-georgian">{past.georgian}</span>
                <span className="earlier-english">{past.english}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

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

export default WordOfTheDay;
