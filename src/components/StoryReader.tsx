import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ReactNode } from "react";
import type { StoryToken } from "../types";
import { storyById } from "../data/stories";
import { at, headword, isLinked, meaning, pieces, reading } from "../utils/story";
import type { Reading } from "../utils/story";
import { segmentForm } from "../utils/verbMorphology";
import Icon from "./Icon";

const CARD_W = 320;
// Only the estimate the card is first placed with, before its real height is measurable.
const CARD_H = 240;
const MARGIN = 12;
// Long enough that sweeping the pointer across a line does not flash a card per word,
// short enough that stopping on a word feels like it answered immediately.
const OPEN_DELAY = 140;
// Covers the gap between leaving the word and reaching the card below it.
const CLOSE_DELAY = 180;

/** Which occurrence is open, and the rectangle it was measured at. */
interface Selection {
  token: StoryToken;
  /** "paragraph:word" — identifies the exact occurrence, so only that one looks active. */
  at: string;
  rect: DOMRect;
}

// A story with its words linked to the dictionary.
//
// Lookup is a mode rather than something always on, because the two things you want from a
// page of foreign prose fight each other: selecting a phrase to copy needs plain, inert
// text, and looking a word up needs every word to be its own control. So the words are
// always ordinary spans — selectable, copyable — and turning lookup on adds hover handlers
// to them rather than swapping them for buttons.
function StoryReader() {
  const { storyId } = useParams<{ storyId: string }>();
  const story = storyById(storyId);

  const [lookup, setLookup] = useState(true);
  const [split, setSplit] = useState(false);
  const [selected, setSelected] = useState<Selection | null>(null);
  // One shared timer: a pending open and a pending close can never both be wanted.
  const timer = useRef<number | undefined>(undefined);

  const cancel = useCallback(() => window.clearTimeout(timer.current), []);
  const close = useCallback(() => {
    cancel();
    setSelected(null);
  }, [cancel]);

  useEffect(() => cancel, [cancel]);

  // Turning lookup off must also take any open card with it.
  useEffect(() => {
    if (!lookup) close();
  }, [lookup, close]);

  // The card is anchored to a rectangle measured when it opened, which stops being where
  // the word is as soon as the page moves.
  useEffect(() => {
    if (!selected) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [selected, close]);

  if (!story) {
    return (
      <div className="main-content">
        <div className="breadcrumb">
          <Link to="/stories">← Stories</Link>
        </div>
        <p className="empty-note">That story does not exist.</p>
      </div>
    );
  }

  const hasTranslation = story.translation.length > 0;
  const showSplit = split && hasTranslation;

  const openLater = (token: StoryToken, key: string, target: HTMLElement) => {
    if (!lookup) return;
    cancel();
    const rect = target.getBoundingClientRect();
    timer.current = window.setTimeout(() => setSelected({ token, at: key, rect }), OPEN_DELAY);
  };

  const closeLater = () => {
    cancel();
    timer.current = window.setTimeout(() => setSelected(null), CLOSE_DELAY);
  };

  const renderParagraph = (paragraph: string, p: number) =>
    pieces(paragraph).map((piece, i) => {
      const token = piece.word ? at(story, p, piece.index, piece.text) : null;
      if (!isLinked(token)) {
        return <span key={i}>{piece.text}</span>;
      }
      const key = `${p}:${piece.index}`;
      return (
        <span
          key={i}
          className={
            `story-word${token.name ? " is-name" : ""}${lookup ? " is-live" : ""}` +
            `${selected?.at === key ? " is-open" : ""}`
          }
          // Focusable only in lookup mode: 976 stops in the tab order would otherwise sit
          // between the reader and the rest of the page for no gain.
          tabIndex={lookup ? 0 : undefined}
          onMouseEnter={(e) => openLater(token, key, e.currentTarget)}
          onMouseLeave={closeLater}
          onFocus={(e) => openLater(token, key, e.currentTarget)}
          onBlur={closeLater}
        >
          {piece.text}
        </span>
      );
    });

  return (
    <div className="main-content">
      <div className="breadcrumb">
        <Link to="/stories">← Stories</Link>
        <span className="breadcrumb-sep">/</span>
        <span>{story.titleEnglish || story.title}</span>
      </div>

      <header className="story-head">
        <h1 className="story-title">{story.title}</h1>
        {story.titleEnglish && <p className="story-title-en">{story.titleEnglish}</p>}
        <div className="story-meta">
          {story.level && <span className={`level-badge ${story.level.toLowerCase()}`}>{story.level}</span>}
          <span className="story-stat">{story.stats.tokens} words</span>
          <span className="story-stat">{story.stats.coverage}% linked</span>
        </div>

        <div className="story-controls">
          <button
            type="button"
            className={`toggle-btn${lookup ? " is-on" : ""}`}
            onClick={() => setLookup((on) => !on)}
            aria-pressed={lookup}
          >
            <Icon name={lookup ? "eye" : "eye-off"} size={16} />
            Word lookup
          </button>
          <button
            type="button"
            className={`toggle-btn${showSplit ? " is-on" : ""}`}
            onClick={() => setSplit((on) => !on)}
            disabled={!hasTranslation}
            aria-pressed={showSplit}
            title={hasTranslation ? undefined : "This story has no translation yet"}
          >
            <Icon name="layers" size={16} />
            Side by side
          </button>
        </div>
      </header>

      {showSplit ? (
        <article className="story-prose story-split">
          {story.paragraphs.map((paragraph, p) => (
            <div className="story-row" key={p}>
              <p className="story-para">{renderParagraph(paragraph, p)}</p>
              <p className="story-para story-para-en">{story.translation[p]}</p>
            </div>
          ))}
        </article>
      ) : (
        <article className="story-prose">
          {story.paragraphs.map((paragraph, p) => (
            <p className="story-para" key={p}>
              {renderParagraph(paragraph, p)}
            </p>
          ))}
        </article>
      )}

      {selected && <GlossCard selection={selected} onClose={close} onHold={cancel} onRelease={closeLater} />}
    </div>
  );
}

// The definition card. Anchored under the word it belongs to, flipped above when there is
// no room below, and clamped so it never hangs off either edge. Hovering it holds it open,
// so the link at the bottom can actually be reached.
//
// It leads with the one meaning that applies here rather than the entry's first, which is
// the whole point of the story recording occurrences separately: აბა is "let's" where the
// pigs egg each other on and "just try" where the wolf threatens them.
function GlossCard({
  selection,
  onClose,
  onHold,
  onRelease,
}: {
  selection: Selection;
  onClose: () => void;
  onHold: () => void;
  onRelease: () => void;
}) {
  const { token } = selection;
  const item = reading(token);
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState(() => place(selection.rect, CARD_H));

  // Re-place once the real height is known, so a card shorter than the estimate does not
  // sit with a gap under the word it belongs to.
  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight;
    if (height) setStyle(place(selection.rect, height));
  }, [selection]);

  const lemma = headword(item);

  return (
    <div
      className="gloss-card"
      style={style}
      ref={ref}
      role="dialog"
      aria-label={`Meaning of ${token.form}`}
      onMouseEnter={onHold}
      onMouseLeave={onRelease}
    >
      <p className="gloss-form">
        {item.verb && item.lex ? <VerbSegments form={token.form} item={item} /> : token.form}
      </p>

      <div className="gloss-tags">
        {token.gram && <span className="gloss-gram">{token.gram}</span>}
        {token.name && <span className="pos-tag">Name</span>}
        {item.pos && <span className="pos-tag">{item.pos}</span>}
        {item.word?.level && <span className={`level-badge ${item.word.level.toLowerCase()}`}>{item.word.level}</span>}
      </div>

      {/* What the word says here, before what the dictionary calls it. იყო reads as "was";
          filing it under არის "is" is right, and is also not what the sentence said. */}
      {item.formMeaning && <p className="gloss-form-meaning">{item.formMeaning}</p>}

      {lemma && lemma !== token.form && (
        <p className="gloss-lemma">
          <Icon name="arrow-right" size={14} />
          <span className="gloss-lemma-word">{lemma}</span>
        </p>
      )}

      <p className={`gloss-meaning${item.formMeaning ? " is-lemma-meaning" : ""}`}>{meaning(item)}</p>

      {item.otherSenses.length > 0 && (
        <p className="gloss-senses">
          <span>Elsewhere</span> {item.otherSenses.slice(0, 3).join(" · ")}
        </p>
      )}

      {item.word?.georgianDefinition && <p className="gloss-definition">{item.word.georgianDefinition}</p>}

      {token.alts && token.alts.length > 0 && (
        <p className="gloss-alts">
          <span>Could also be</span> {token.alts.map((alt) => alt.english).join(" · ")}
        </p>
      )}

      {item.href && (
        <Link className="gloss-link" to={item.href} onClick={onClose}>
          Full entry
          <Icon name="arrow-right" size={14} />
        </Link>
      )}
    </div>
  );
}

// The form cut into its morphemes, coloured the way the verb pages colour a paradigm. The
// screeve is left out on purpose: the token records it as a label ("Aorist 3sg") rather
// than as the key segmentForm expects, and the wrong key strips preverbs the form has.
function VerbSegments({ form, item }: { form: string; item: Reading }): ReactNode {
  const { segments } = segmentForm(form, item.lex);
  return segments.map((segment, i) => (
    <span key={i} className={`mo mo-${segment.part}`}>
      {segment.text}
    </span>
  ));
}

/** Puts the card below the word, or above it when it would not fit, clamped to the viewport. */
function place(rect: DOMRect, height: number): { top: number; left: number } {
  const below = rect.bottom + MARGIN;
  const fitsBelow = below + height <= window.innerHeight - MARGIN;
  return {
    top: fitsBelow ? below : Math.max(MARGIN, rect.top - MARGIN - height),
    left: Math.min(Math.max(MARGIN, rect.left + rect.width / 2 - CARD_W / 2), window.innerWidth - CARD_W - MARGIN),
  };
}

export default StoryReader;
