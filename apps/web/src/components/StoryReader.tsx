import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ReactNode } from "react";
import type { StoryToken } from "@georgian/shared/types";
import { useStory } from "../data/stories";
import { at, headword, isLinked, meaning, pieces, reading } from "../utils/story";
import type { Reading } from "../utils/story";
import { segmentForm } from "../utils/verbMorphology";
import { wordKey } from "../study/items";
import type { Mastery, MasteryValue } from "../study/mastery";
import { KNOWN, masteryAttr } from "../study/mastery";
import { forgetItem, markUnseenKnown, readingMastery, setItemMastery, useProgress } from "../study/store";
import type { Progress } from "../study/store";
import { MasteryPicker } from "./Mastery";
import Icon from "./Icon";

const CARD_W = 320;
// Only the estimate the card is first placed with, before its real height is measurable.
const CARD_H = 300;
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

// A story with its words linked to the dictionary, and coloured by how well you know them.
//
// Lookup is a mode rather than something always on, because the two things you want from a
// page of foreign prose fight each other: selecting a phrase to copy needs plain, inert
// text, and looking a word up needs every word to be its own control. So the words are
// always ordinary spans — selectable, copyable — and turning lookup on adds hover handlers
// to them rather than swapping them for buttons.
//
// Reading is also the cheapest way to fill in a vocabulary: a story is a few hundred words
// you have opinions about, most of which you will never stop on. So the words carry their
// level as a colour, the card that opens over one can set that level, and the Finish button
// at the end offers to retire everything you never had to look at.
function StoryReader() {
  const { storyId } = useParams<{ storyId: string }>();
  // The text and its tokens are fetched rather than bundled — 120 KB for this one story,
  // which is not worth carrying around for the visits that never open it.
  const { story, loading, error } = useStory(storyId);
  const progress = useProgress();

  const [lookup, setLookup] = useState(true);
  const [split, setSplit] = useState(false);
  const [highlight, setHighlight] = useState(true);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [finishing, setFinishing] = useState(false);
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

  // Every dictionary entry the story cites, once. This is the story's vocabulary — what the
  // counts below are out of, and what Finish acts on.
  const vocabulary = useMemo(() => {
    const keys = new Set<string>();
    for (const paragraph of story?.tokens ?? []) {
      for (const token of paragraph) if (token.word) keys.add(wordKey(token.word));
    }
    return [...keys];
  }, [story]);

  const counts = useMemo(() => {
    const tally = { unseen: 0, learning: 0, solid: 0, known: 0, total: vocabulary.length };
    for (const key of vocabulary) {
      const level = readingMastery(progress, key);
      if (level === null) tally.unseen += 1;
      else if (level >= KNOWN) tally.known += 1;
      else if (level >= 4) tally.solid += 1;
      else tally.learning += 1;
    }
    return tally;
  }, [vocabulary, progress]);

  if (loading || error || !story) {
    return (
      <div className="main-content">
        <div className="breadcrumb">
          <Link to="/stories">← Stories</Link>
        </div>
        <p className="empty-note">
          {loading
            ? 'Loading the story…'
            : error
              ? 'That story could not be loaded. Check your connection and try again.'
              : 'That story does not exist.'}
        </p>
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
      // Proper names are story furniture rather than vocabulary, so they carry no level.
      const item = token.word ? wordKey(token.word) : "";
      return (
        <span
          key={i}
          className={
            `story-word${token.name ? " is-name" : ""}${lookup ? " is-live" : ""}` +
            `${highlight && item ? " is-graded" : ""}${selected?.at === key ? " is-open" : ""}`
          }
          data-mastery={highlight && item ? masteryAttr(readingMastery(progress, item)) : undefined}
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
          <button
            type="button"
            className={`toggle-btn${highlight ? " is-on" : ""}`}
            onClick={() => setHighlight((on) => !on)}
            aria-pressed={highlight}
            title="Colour every word by how well you know it"
          >
            <Icon name="sliders" size={16} />
            Highlight
          </button>
          <button type="button" className="toggle-btn is-finish" onClick={() => setFinishing(true)}>
            <Icon name="flag" size={16} />
            Finish
          </button>
        </div>

        <StoryProgress counts={counts} shown={highlight} />
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

      <div className="story-end">
        <p className="story-end-note">Reached the end?</p>
        <button type="button" className="control-btn know" onClick={() => setFinishing(true)}>
          <Icon name="flag" /> Finish reading
        </button>
      </div>

      {selected && (
        <GlossCard
          selection={selected}
          progress={progress}
          onClose={close}
          onHold={cancel}
          onRelease={closeLater}
        />
      )}

      {finishing && <FinishDialog unseen={counts.unseen} vocabulary={vocabulary} onClose={() => setFinishing(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------- the progress bar */

interface Counts {
  unseen: number;
  learning: number;
  solid: number;
  known: number;
  total: number;
}

// How much of this story's vocabulary you have an opinion about. The bar reads left to
// right in the same order the colours run through the text, so the two are one legend.
function StoryProgress({ counts, shown }: { counts: Counts; shown: boolean }) {
  if (counts.total === 0) return null;
  const width = (value: number) => `${(value / counts.total) * 100}%`;

  return (
    <div className="story-progress">
      <div className="study-meter" aria-hidden="true">
        <span className="study-meter-seg is-known" style={{ width: width(counts.known) }} />
        <span className="study-meter-seg is-solid" style={{ width: width(counts.solid) }} />
        <span className="study-meter-seg is-weak" style={{ width: width(counts.learning) }} />
      </div>
      <div className="study-legend">
        <span><i className="dot is-known" />{counts.known} known</span>
        <span><i className="dot is-solid" />{counts.solid} solid</span>
        <span><i className="dot is-weak" />{counts.learning} learning</span>
        <span><i className="dot is-unseen" />{counts.unseen} never seen</span>
        <span className="study-legend-session">
          {counts.total} distinct words{shown ? "" : " · highlighting off"}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ finishing */

// What the Finish button opens.
//
// The checkbox is the point of it: having read the whole story, the words you never stopped
// on are the words you never needed to stop on, and saying so once is worth more than
// meeting each of them again in a deck. It only ever touches words with no record at all —
// anything you rated while reading is left exactly as you rated it.
//
// Confirming leaves the story rather than reporting back. Nothing it did needs acknowledging:
// the checkbox above the button already said what would happen, and being finished with a
// story means being somewhere else.
function FinishDialog({
  unseen,
  vocabulary,
  onClose,
}: {
  unseen: number;
  vocabulary: string[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [markKnown, setMarkKnown] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const finish = () => {
    if (markKnown) markUnseenKnown(vocabulary);
    navigate(-1);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content story-finish"
        role="dialog"
        aria-modal="true"
        aria-label="Finish reading"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>

        <h2>Finished reading?</h2>
        <p className="story-finish-lead">
          {unseen > 0
            ? `${unseen} of this story's words have never been studied.`
            : "You have an opinion about every word in this story."}
        </p>

        <label className={`check story-finish-check${unseen === 0 ? " is-disabled" : ""}`}>
          <input
            type="checkbox"
            checked={markKnown && unseen > 0}
            disabled={unseen === 0}
            onChange={(e) => setMarkKnown(e.target.checked)}
          />
          Mark those {unseen} words as known
        </label>
        <p className="story-finish-note">
          They go to level 6 and never come up in flashcards again. Words you rated while reading are left as
          you rated them.
        </p>

        <div className="story-finish-actions">
          <button type="button" className="control-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="control-btn know" onClick={finish}>
            <Icon name="check" /> Finish
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- the card */

// The definition card. Anchored under the word it belongs to, flipped above when there is
// no room below, and clamped so it never hangs off either edge. Hovering it holds it open,
// so the level buttons and the link at the bottom can actually be reached.
//
// It leads with the one meaning that applies here rather than the entry's first, which is
// the whole point of the story recording occurrences separately: აბა is "let's" where the
// pigs egg each other on and "just try" where the wolf threatens them.
function GlossCard({
  selection,
  progress,
  onClose,
  onHold,
  onRelease,
}: {
  selection: Selection;
  progress: Progress;
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
  const key = token.word ? wordKey(token.word) : "";
  const level: MasteryValue = key ? readingMastery(progress, key) : null;

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

      {/* Rating a word where you met it is the cheapest moment there is to rate it: the
          sentence is still on screen and you have just decided whether you understood it. */}
      {key && (
        <MasteryPicker
          level={level}
          onPick={(next: Mastery) => setItemMastery(key, next)}
          onForget={() => forgetItem(key)}
          label="How well do you know it?"
        />
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
