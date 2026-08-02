import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ReactNode } from "react";
import type { Story } from "../types";
import { storyById } from "../data/stories";
import { headword, isLinked, meaning, pieces, reading } from "../utils/story";
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

/** Which word is open, and the rectangle of the occurrence that opened it. */
interface Selection {
  form: string;
  /** Identifies the exact occurrence, so only the hovered word is marked active. */
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

  const openLater = (form: string, at: string, target: HTMLElement) => {
    if (!lookup) return;
    cancel();
    const rect = target.getBoundingClientRect();
    timer.current = window.setTimeout(() => setSelected({ form, at, rect }), OPEN_DELAY);
  };

  const closeLater = () => {
    cancel();
    timer.current = window.setTimeout(() => setSelected(null), CLOSE_DELAY);
  };

  const renderParagraph = (paragraph: string, p: number) =>
    pieces(paragraph).map((piece, i) => {
      if (!piece.word || !isLinked(story, piece.text)) {
        return <span key={i}>{piece.text}</span>;
      }
      const at = `${p}:${i}`;
      return (
        <span
          key={i}
          className={`story-word${lookup ? " is-live" : ""}${selected?.at === at ? " is-open" : ""}`}
          // Focusable only in lookup mode: 575 stops in the tab order would otherwise sit
          // between the reader and the rest of the page for no gain.
          tabIndex={lookup ? 0 : undefined}
          onMouseEnter={(e) => openLater(piece.text, at, e.currentTarget)}
          onMouseLeave={closeLater}
          onFocus={(e) => openLater(piece.text, at, e.currentTarget)}
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
          <span className="story-stat">
            {Math.round((story.stats.linkedTokens / story.stats.tokens) * 100)}% linked
          </span>
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

      {selected && (
        <GlossCard story={story} selection={selected} onClose={close} onHold={cancel} onRelease={closeLater} />
      )}
    </div>
  );
}

// The definition card. Anchored under the word it belongs to, flipped above when there is
// no room below, and clamped so it never hangs off either edge. Hovering it holds it open,
// so the link at the bottom can actually be reached.
function GlossCard({
  story,
  selection,
  onClose,
  onHold,
  onRelease,
}: {
  story: Story;
  selection: Selection;
  onClose: () => void;
  onHold: () => void;
  onRelease: () => void;
}) {
  const item = reading(story, selection.form);
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState(() => place(selection.rect, CARD_H));

  // Re-place once the real height is known, so a card shorter than the estimate does not
  // sit with a gap under the word it belongs to.
  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight;
    if (height) setStyle(place(selection.rect, height));
  }, [selection]);

  if (!item) return null;

  const lemma = headword(item);
  const { entry } = item;

  return (
    <div
      className="gloss-card"
      style={style}
      ref={ref}
      role="dialog"
      aria-label={`Meaning of ${item.form}`}
      onMouseEnter={onHold}
      onMouseLeave={onRelease}
    >
      <p className="gloss-form">{item.verb && item.lex ? <VerbSegments form={item.form} item={item} /> : item.form}</p>

      <div className="gloss-tags">
        {entry.gram && <span className="gloss-gram">{entry.gram}</span>}
        {item.pos && <span className="pos-tag">{item.pos}</span>}
        {item.word && <span className={`level-badge ${item.word.level.toLowerCase()}`}>{item.word.level}</span>}
      </div>

      {lemma && lemma !== item.form && (
        <p className="gloss-lemma">
          <Icon name="arrow-right" size={14} />
          <span className="gloss-lemma-word">{lemma}</span>
        </p>
      )}

      <p className="gloss-meaning">{meaning(item)}</p>

      {item.senses.length > 0 && (
        <p className="gloss-senses">
          <span>Also</span> {item.senses.slice(0, 3).join(" · ")}
        </p>
      )}

      {item.word?.georgianDefinition && <p className="gloss-definition">{item.word.georgianDefinition}</p>}

      {entry.alts && entry.alts.length > 0 && (
        <p className="gloss-alts">
          <span>Could also be</span> {entry.alts.map((alt) => alt.gloss).join(" · ")}
        </p>
      )}

      {item.href ? (
        <Link className="gloss-link" to={item.href} onClick={onClose}>
          Full entry
          <Icon name="arrow-right" size={14} />
        </Link>
      ) : (
        // Supplement words live in scripts/storyOverrides.json and have no page to open.
        <p className="gloss-note">Not in the A1–A2 word list</p>
      )}
    </div>
  );
}

// The form cut into its morphemes, coloured the way the verb pages colour a paradigm. The
// screeve is left out on purpose: the glossary records it as a label ("Aorist 3sg") rather
// than as the key segmentForm expects, and the wrong key strips preverbs the form has.
function VerbSegments({ form, item }: { form: string; item: ReturnType<typeof reading> }): ReactNode {
  const { segments } = segmentForm(form, item?.lex);
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
