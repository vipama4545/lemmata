// A story's text, as something you can read *at*: hover a word and it says what it means there,
// rate it without leaving the line, watch the highlight move as it is read aloud.
//
// Lifted out of StoryReader when the lessons started showing passages from the library. There is
// exactly one interesting thing about a word in this app — it carries a level, a sense that
// applies *here*, a card that opens under it — and two implementations of that would have been
// two answers to "what happens when you hover a word", drifting apart the first time either was
// touched. The library page and the lesson panel now differ in what surrounds the text and in
// nothing about the text itself.
//
// What is *not* here is anything that decides what to read. The chapter, the player, the mode
// switches, the admin's edit panel — all of that belongs to whoever is showing the prose, and is
// passed in. This renders paragraphs and opens cards over them.
//
// Words stay plain spans so a paragraph selects and copies like ordinary text. Only the
// underline and the pointer are added when lookup is on; nothing about the element itself
// changes, which is what keeps selection working in both modes.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Play } from "lucide-react";
import type { Story, StoryToken } from "@georgian/shared/types";
import { Button } from "@/components/ui/button";
import { MORPHEME_CLASS } from "@/components/ui/morpheme";
import { LevelBadge, PosTag } from "@/components/ui/word-card";
import { cn } from "@/lib/utils";
import { at, headword, isLinked, meaning, pieces, reading } from "../utils/story";
import type { Reading } from "../utils/story";
import { segmentForm } from "../utils/verbMorphology";
import { wordKey } from "../study/items";
import type { Mastery, MasteryValue } from "../study/mastery";
import { KNOWN, masteryAttr } from "../study/mastery";
import { forgetItem, readingMastery, setItemMastery, useProgress } from "../study/store";
import type { Progress } from "../study/store";
import { MasteryPicker } from "./Mastery";

const CARD_W = 320;
// Only the estimate the card is first placed with, before its real height is measurable.
const CARD_H = 300;
const MARGIN = 12;
// Long enough that sweeping the pointer across a line does not flash a card per word,
// short enough that stopping on a word feels like it answered immediately.
const OPEN_DELAY = 140;
// Covers the gap between leaving the word and reaching the card below it.
const CLOSE_DELAY = 180;

/** Prose is set large and loose: it is being read a word at a time, not skimmed. */
export const STORY_PARA = "mb-[18px] text-[19px] leading-[2] last:mb-0 max-md:text-[17px] max-md:leading-[1.9]";

/** The same text at the size a lesson sets its examples in — a panel, not a page. */
const COMPACT_PARA = "text-[17px] leading-[1.75] font-semibold";

/** Which occurrence is open, and the rectangle it was measured at. */
interface Selection {
  token: StoryToken;
  /** "paragraph:word" — identifies the exact occurrence, so only that one looks active. */
  at: string;
  rect: DOMRect;
}

/**
 * The classes on a word in reading mode.
 *
 * The tint for a level is a background rather than an outline, so a paragraph still reads as
 * a paragraph: the colour is behind the word and the text keeps its own weight and hue. A
 * word marked Known loses its tint entirely — the reward for learning the page is that the
 * page quiets down, and by the end of a story it should be mostly plain prose again.
 */
function wordClasses({
  live,
  name,
  graded,
  open,
  spoken,
}: {
  live: boolean;
  name: boolean;
  graded: boolean;
  open: boolean;
  spoken: boolean;
}) {
  return cn(
    live && "cursor-help border-b border-dotted border-border-strong transition-colors duration-100",
    live && "hover:border-primary hover:bg-primary-glow",
    live && "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
    // Proper names are looked up like any other word, but they are story furniture rather
    // than vocabulary — nothing to learn and no entry to open. A solid, fainter rule says as
    // much without breaking the run of dotted underlines the eye reads past.
    live && name && "border-solid border-border",
    // Dropped entirely while a word is being spoken, rather than overridden by the rule
    // below it. `cn` merges conflicting utilities by letting the last one win, but that only
    // settles ties between selectors of equal weight — and `data-[mastery=6]:bg-transparent`
    // is a class *and* an attribute, so it outranks a plain `bg-primary` however late that
    // comes. Leaving both on meant a Known word, whose whole reward is that it stops being
    // tinted, also refused to light up when it was read. The spoken style below restates the
    // geometry these lines set, so nothing shifts when they go.
    graded && !spoken && [
      "-mx-px rounded-[3px] px-0.5 py-px",
      "bg-[color-mix(in_srgb,var(--m)_15%,transparent)]",
      "shadow-[inset_0_-2px_0_color-mix(in_srgb,var(--m)_45%,transparent)]",
      "data-[mastery=6]:bg-transparent data-[mastery=6]:shadow-none",
    ],
    // Same reasoning: a hover rule is a class plus a pseudo-class, so it would repaint the
    // word the reader is listening to the moment the pointer crossed it.
    graded && live && !spoken && "hover:bg-[color-mix(in_srgb,var(--m)_38%,transparent)]",
    open && !spoken && "border-primary bg-primary-light",
    // The word being read. A filled block rather than an underline because it has to be
    // findable from across the paragraph, at a glance, while it is moving.
    spoken && "-mx-px rounded-[3px] bg-primary px-0.5 py-px text-primary-foreground shadow-none",
  );
}

/**
 * The classes on a word while an admin is editing links.
 *
 * Four states, and they are four different jobs. Nothing matched is a missing lemma or a
 * proper noun; a guess wants a read-through; a name and a pin are already decided and are
 * marked so they can be told from the resolver's own work at a glance.
 *
 * They are listed in order of who wins rather than as exclusive branches, because they are
 * not exclusive: a name can be marked as a guess, and a pinned link usually is not but may
 * be. Pinned beats plain — a word somebody has already settled drops its underline, so what
 * is left underlined is exactly what still wants a decision. A doubt then beats being
 * pinned: a link flagged "come back to this" is the one case where a decided word should
 * still catch the eye, which is the whole point of the flag.
 */
function editableClasses(token: StoryToken, open: boolean) {
  return cn(
    "cursor-pointer rounded-[3px] border-0 border-b-2 border-border-strong bg-transparent px-px font-[inherit] text-inherit",
    "hover:border-b-primary hover:bg-primary-glow",
    "focus-visible:border-b-primary focus-visible:bg-primary-glow focus-visible:outline-none",
    token.name && "border-b-m-unseen bg-[color-mix(in_srgb,var(--m-unseen)_12%,transparent)]",
    !token.name && !token.word && "border-b-m-1 bg-[color-mix(in_srgb,var(--m-1)_12%,transparent)]",
    (token.via === "name" || token.via.startsWith("override")) && "border-b-transparent",
    token.check && "border-b-m-3 border-dashed bg-[color-mix(in_srgb,var(--m-3)_14%,transparent)]",
    open && "border-b-primary bg-primary-light",
  );
}

export interface StoryProseProps {
  /** The chapter to draw — its prose, its translation and its tokens. */
  story: Story;
  /** Hover a word to see what it means there. Off leaves plain, selectable prose. */
  lookup?: boolean;
  /** Colour every word by how well it is known. */
  highlight?: boolean;
  /**
   * How the paragraphs are set.
   *
   * 'prose' is a page of running text — the library's own view. 'lines' gives each paragraph a
   * row of its own with a rule between, which is what a dialogue is: eight short turns, and
   * running them together as prose would lose who is speaking.
   */
  layout?: "prose" | "lines";
  /**
   * Whether the English is showing.
   *
   * Beside each paragraph in prose, under each line in a dialogue — the same fact, put where
   * there is room for it. A grid pairs by row so that a paragraph stays level with its
   * translation however differently the two languages wrap; short turns would leave two thin
   * columns of mostly white space, so those stack instead.
   */
  translation?: boolean;
  /**
   * "paragraph:word" of the word sounding now, and the line being read when the voice could
   * not be aligned to it — both straight off the player. Null where nothing is playing.
   */
  spokenAt?: string | null;
  spokenLine?: string | null;
  /** Read the story from a word. Absent where the deployment has no voice. */
  onPlayFrom?: (paragraph: number, word: number) => void;
  /** Admin link editing: every word becomes a button that opens the editor. */
  editing?: boolean;
  onEditWord?: (token: StoryToken, paragraph: number, position: number) => void;
  /** 'reader' is a page of prose; 'compact' is a passage inside something else. */
  size?: "reader" | "compact";
  className?: string;
}

export default function StoryProse({
  story,
  lookup = true,
  highlight = true,
  layout = "prose",
  translation = false,
  spokenAt = null,
  spokenLine = null,
  onPlayFrom,
  editing = false,
  onEditWord,
  size = "reader",
  className,
}: StoryProseProps) {
  const progress = useProgress();
  const [selected, setSelected] = useState<Selection | null>(null);

  // One shared timer: a pending open and a pending close can never both be wanted.
  const timer = useRef<number | undefined>(undefined);

  const cancel = useCallback(() => window.clearTimeout(timer.current), []);
  const close = useCallback(() => {
    cancel();
    setSelected(null);
  }, [cancel]);

  useEffect(() => cancel, [cancel]);

  // Turning lookup off must also take any open card with it — unless editing is on, where
  // the card is the reference you are editing against rather than a reading aid.
  useEffect(() => {
    if (!lookup && !editing) close();
  }, [lookup, editing, close]);

  // A different chapter under the same component — which is what a lesson with two passages
  // and a reader turning a page both do — must not leave a card open over the old text.
  useEffect(() => {
    close();
  }, [story.id, story.chapter, close]);

  // The card is anchored to a rectangle measured when it opened, which stops being where
  // the word is as soon as the page moves.
  useEffect(() => {
    if (!selected) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
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

  // The words of a line the voice could not be aligned to, which are marked together rather
  // than one at a time. Parsed once per change instead of per word: this is compared against
  // every span in the story on every render that moves the highlight.
  const lineSpan = (() => {
    if (!spokenLine) return null;
    const [paragraph, from, to] = spokenLine.split(":").map(Number);
    return { paragraph, from, to };
  })();

  const openLater = (token: StoryToken, key: string, target: HTMLElement) => {
    // Editing counts as a reason to open the card even with lookup switched off: choosing
    // what a word should mean is exactly when you need to see what it means now.
    if (!lookup && !editing) return;
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
      const key = `${p}:${piece.index}`;
      // Either the one word being said, or every word of a line that could not be timed.
      const spoken =
        spokenAt === key ||
        (lineSpan !== null &&
          lineSpan.paragraph === p &&
          piece.index >= lineSpan.from &&
          piece.index <= lineSpan.to);

      // In edit mode every word is a control, including the ones nothing matched — those are
      // the whole point, because an unresolved spelling is usually either a missing lemma or
      // a proper noun, and both are answered here. Reading mode keeps the old rule: only a
      // word with something to say is interactive.
      if (editing && token) {
        // Hovering still opens the real card. Deciding what a word should link to means
        // reading what it links to now — the sense that applies, the other senses, the
        // paradigm behind it — and none of that fits in a title attribute. So editing adds
        // the click without taking the card away: hover to see, click to change.
        const hoverable = isLinked(token);
        return (
          <button
            key={i}
            type="button"
            className={editableClasses(token, selected?.at === key)}
            onClick={() => {
              close();
              onEditWord?.(token, p, piece.index);
            }}
            onMouseEnter={hoverable ? (e) => openLater(token, key, e.currentTarget) : undefined}
            onMouseLeave={hoverable ? closeLater : undefined}
            onFocus={hoverable ? (e) => openLater(token, key, e.currentTarget) : undefined}
            onBlur={hoverable ? closeLater : undefined}
          >
            {piece.text}
          </button>
        );
      }

      // A word with nothing to say is still a word that gets read aloud, so the spoken
      // highlight goes on every *word* of the paragraph — not only the ones the lexicon
      // matched. An unlinked word is skipped by the card, never by the voice.
      //
      // Only where `piece.word`, though: the gaps between words are pieces too and carry
      // index -1, which is not a position the voice or the highlight could mean.
      if (!isLinked(token)) {
        if (!piece.word) return <span key={i}>{piece.text}</span>;
        return (
          <span
            key={i}
            className={wordClasses({ live: false, name: false, graded: false, open: false, spoken })}
          >
            {piece.text}
          </span>
        );
      }
      // Proper names are story furniture rather than vocabulary, so they carry no level.
      const item = token.word ? wordKey(token.word) : "";
      return (
        <span
          key={i}
          className={wordClasses({
            live: lookup,
            name: Boolean(token.name),
            graded: Boolean(highlight && item),
            open: selected?.at === key,
            spoken,
          })}
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

  const para = size === "reader" ? STORY_PARA : COMPACT_PARA;

  return (
    <>
      <div className={className}>
        {story.paragraphs.map((paragraph, p) => {
          const words = <>{renderParagraph(paragraph, p)}</>;
          const english = story.translation[p];

          // Pairing by row is what guarantees a paragraph stays level with its translation
          // however differently the two languages wrap. Two columns stop being readable well
          // before the sidebar drops away, so below 900px the pairs stack.
          if (layout === "prose" && translation && english !== undefined) {
            return (
              <div
                key={p}
                className="mb-[18px] grid grid-cols-2 gap-8 border-b border-border pb-[18px] last:mb-0 last:border-b-0 last:pb-0 max-[900px]:grid-cols-1 max-[900px]:gap-2"
              >
                <p className={cn(para, "mb-0")}>{words}</p>
                <p className="text-base leading-loose text-muted-foreground max-[900px]:border-l-2 max-[900px]:border-border max-[900px]:pl-3">
                  {english}
                </p>
              </div>
            );
          }

          if (layout === "lines") {
            return (
              <div
                key={p}
                className="border-b border-border py-2.5 first:pt-0 last:border-b-0 last:pb-0"
              >
                <p className={cn(para, "mb-0")}>{words}</p>
                {translation && english && (
                  <p className="mt-0.5 text-[14px] text-muted-foreground">{english}</p>
                )}
              </div>
            );
          }

          return (
            <p className={para} key={p}>
              {words}
            </p>
          );
        })}
      </div>

      {selected && (
        <GlossCard
          selection={selected}
          progress={progress}
          onClose={close}
          onHold={cancel}
          onRelease={closeLater}
          // Reading from here is an action you ask for on the card, not something a click
          // anywhere in the prose does. The text is for reading and selecting; taking its
          // click for playback would mean no word could be highlighted with the mouse.
          //
          // `at` is the "paragraph:word" key the span was built with, which is the pair the
          // player needs, so it is read back rather than threaded through the selection.
          onPlay={
            onPlayFrom
              ? () => {
                  const [paragraph, word] = selected.at.split(":").map(Number);
                  onPlayFrom(paragraph, word);
                  close();
                }
              : undefined
          }
        />
      )}
    </>
  );
}

/* ----------------------------------------------------------------- the card */

// The definition card. Anchored under the word it belongs to, flipped above when there is
// no room below, and clamped so it never hangs off either edge. Hovering it holds it open,
// so the level buttons and the link at the bottom can actually be reached.
//
// Positioned by hand rather than by a Popover: it is opened and closed on a hover timer
// shared with the word under it, and it is anchored to a rectangle measured at open time
// rather than to a live element, which is what lets the same card serve 976 spans without
// any of them being a trigger.
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
  onPlay,
}: {
  selection: Selection;
  progress: Progress;
  onClose: () => void;
  onHold: () => void;
  onRelease: () => void;
  /** Read the story from this word. Absent where the server has no voice. */
  onPlay?: () => void;
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
      className="fixed z-60 w-80 max-w-[calc(100vw-24px)] rounded-lg border border-border-strong bg-popover px-4.5 py-4 text-popover-foreground shadow-pop"
      style={style}
      ref={ref}
      role="dialog"
      aria-label={`Meaning of ${token.form}`}
      onMouseEnter={onHold}
      onMouseLeave={onRelease}
    >
      {/* The word, and — where there is a voice — the one control that starts the recording
          here. Beside the headword rather than down with "Full entry", because it acts on
          the word this card is about rather than taking you somewhere else. */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-[22px] leading-tight font-semibold">
          {item.verb && item.lex ? <VerbSegments form={token.form} item={item} /> : token.form}
        </p>
        {onPlay && (
          <Button
            type="button"
            variant="control"
            size="icon-sm"
            className="mt-0.5 shrink-0"
            onClick={onPlay}
            aria-label={`Read the story from ${token.form}`}
            title="Read from here"
          >
            <Play />
          </Button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {token.gram && (
          <span className="rounded-full bg-primary-light px-2 py-0.5 text-[11px] font-semibold text-primary-dark">
            {token.gram}
          </span>
        )}
        {token.name && <PosTag>Name</PosTag>}
        {item.pos && <PosTag>{item.pos}</PosTag>}
        {item.word?.level && <LevelBadge level={item.word.level} />}
      </div>

      {/* What the word says here, before what the dictionary calls it. იყო reads as "was";
          filing it under არის "is" is right, and is also not what the sentence said. */}
      {item.formMeaning && <p className="mt-2.5 text-base font-semibold">{item.formMeaning}</p>}

      {lemma && lemma !== token.form && (
        <p className="mt-2.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <ArrowRight className="size-3.5" aria-hidden="true" />
          <span className="text-[17px] text-foreground">{lemma}</span>
        </p>
      )}

      {/* Demoted to a caption under the headword once the form has said its own meaning
          above, so the card has one thing to read first rather than two of the same size. */}
      <p className={item.formMeaning ? "mt-0.5 text-sm text-muted-foreground" : "mt-2 text-base"}>
        {meaning(item)}
      </p>

      {item.otherSenses.length > 0 && (
        <p className={GLOSS_ASIDE}>
          <span className={GLOSS_ASIDE_LABEL}>Elsewhere</span> {item.otherSenses.slice(0, 3).join(" · ")}
        </p>
      )}

      {item.word?.definition && (
        <p className="mt-2 border-t border-border pt-2 text-[13px] text-muted-foreground">
          {item.word.definition}
        </p>
      )}

      {token.alts && token.alts.length > 0 && (
        <p className={GLOSS_ASIDE}>
          <span className={GLOSS_ASIDE_LABEL}>Could also be</span>{" "}
          {token.alts.map((alt) => alt.english).join(" · ")}
        </p>
      )}

      {/* Rating a word where you met it is the cheapest moment there is to rate it: the
          sentence is still on screen and you have just decided whether you understood it.
          The picker states the level once, here, where it is also changed — the word itself
          is already tinted its own colour in the text behind the card. */}
      {key && (
        <MasteryPicker
          level={level}
          onPick={(next: Mastery) => setItemMastery(key, next)}
          onForget={() => forgetItem(key)}
          label="How well do you know it?"
          tight
        />
      )}

      {item.href && (
        <Link
          className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline"
          to={item.href}
          onClick={onClose}
        >
          Full entry
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

const GLOSS_ASIDE = "mt-1.5 text-[13px] text-muted-foreground";
const GLOSS_ASIDE_LABEL = "mr-1 text-[11px] tracking-[0.04em] text-faint uppercase";

// The form cut into its morphemes, coloured the way the verb pages colour a paradigm. The
// screeve is left out on purpose: the token records it as a label ("Aorist 3sg") rather
// than as the key segmentForm expects, and the wrong key strips preverbs the form has.
function VerbSegments({ form, item }: { form: string; item: Reading }): ReactNode {
  const { segments } = segmentForm(form, item.lex);
  return segments.map((segment, i) => (
    <span key={i} className={MORPHEME_CLASS[segment.part]}>
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

/**
 * Every dictionary entry a chapter cites, once — the vocabulary the counts are out of.
 *
 * Here rather than in the reader because the mastery a passage reports and the words its
 * cards can rate have to be the same set, however the passage is being shown.
 */
export function storyVocabulary(story: Story | null): string[] {
  const keys = new Set<string>();
  for (const paragraph of story?.tokens ?? []) {
    for (const token of paragraph) if (token.word) keys.add(wordKey(token.word));
  }
  return [...keys];
}

/** How much of a vocabulary is known, solid, being learned, or never seen. */
export function masteryCounts(vocabulary: string[], progress: Progress) {
  const tally = { unseen: 0, learning: 0, solid: 0, known: 0, total: vocabulary.length };
  for (const key of vocabulary) {
    const level = readingMastery(progress, key);
    if (level === null) tally.unseen += 1;
    else if (level >= KNOWN) tally.known += 1;
    else if (level >= 4) tally.solid += 1;
    else tally.learning += 1;
  }
  return tally;
}
