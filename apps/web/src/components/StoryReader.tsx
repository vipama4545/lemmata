import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ReactNode } from "react";
import { ArrowRight, Check, Eye, EyeOff, Flag, Layers, Link2, SlidersHorizontal } from "lucide-react";
import type { Story, StoryToken } from "@georgian/shared/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MORPHEME_CLASS } from "@/components/ui/morpheme";
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from "@/components/ui/page";
import { Dot, LEGEND_ASIDE, StudyLegend, StudyMeter } from "@/components/ui/study-meter";
import { LevelBadge, PosTag } from "@/components/ui/word-card";
import { cn } from "@/lib/utils";
import { useIsAdmin } from "../admin/useAdmin";
import { replaceStory, useStory } from "../data/stories";
import { at, headword, isLinked, meaning, pieces, reading } from "../utils/story";
import type { Reading } from "../utils/story";
import { segmentForm } from "../utils/verbMorphology";
import { wordKey } from "../study/items";
import type { Mastery, MasteryValue } from "../study/mastery";
import { KNOWN, masteryAttr } from "../study/mastery";
import { forgetItem, markUnseenKnown, readingMastery, setItemMastery, useProgress } from "../study/store";
import type { Progress } from "../study/store";
import { MasteryPicker } from "./Mastery";
import { lang } from '../content/store';

// Only ever rendered for an admin who has turned editing on, so it rides in the admin chunk
// rather than in the one every reader downloads.
const TokenEditor = lazy(() => import("../admin/TokenEditor"));

const CARD_W = 320;
// Only the estimate the card is first placed with, before its real height is measurable.
const CARD_H = 300;
const MARGIN = 12;
// Long enough that sweeping the pointer across a line does not flash a card per word,
// short enough that stopping on a word feels like it answered immediately.
const OPEN_DELAY = 140;
// Covers the gap between leaving the word and reaching the card below it.
const CLOSE_DELAY = 180;

/** The panel under the controls: the progress bar, or the legend that replaces it. */
const PANEL = "mt-4 flex flex-col gap-2 rounded-sm border border-border bg-card px-3.5 py-3";

/** Which occurrence is open, and the rectangle it was measured at. */
interface Selection {
  token: StoryToken;
  /** "paragraph:word" — identifies the exact occurrence, so only that one looks active. */
  at: string;
  rect: DOMRect;
}

/** Which occurrence an admin is editing the link on, and where in the text it is. */
interface Editing {
  token: StoryToken;
  paragraph: number;
  position: number;
}

/**
 * The classes on a word in reading mode.
 *
 * Words stay plain spans so a paragraph selects and copies like ordinary text. Only the
 * underline and the pointer are added when lookup is on; nothing about the element itself
 * changes, which is what keeps selection working in both modes.
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
}: {
  live: boolean;
  name: boolean;
  graded: boolean;
  open: boolean;
}) {
  return cn(
    live && "cursor-help border-b border-dotted border-border-strong transition-colors duration-100",
    live && "hover:border-primary hover:bg-primary-glow",
    live && "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
    // Proper names are looked up like any other word, but they are story furniture rather
    // than vocabulary — nothing to learn and no entry to open. A solid, fainter rule says as
    // much without breaking the run of dotted underlines the eye reads past.
    live && name && "border-solid border-border",
    graded && [
      "-mx-px rounded-[3px] px-0.5 py-px",
      "bg-[color-mix(in_srgb,var(--m)_15%,transparent)]",
      "shadow-[inset_0_-2px_0_color-mix(in_srgb,var(--m)_45%,transparent)]",
      "data-[mastery=6]:bg-transparent data-[mastery=6]:shadow-none",
    ],
    graded && live && "hover:bg-[color-mix(in_srgb,var(--m)_38%,transparent)]",
    open && "border-primary bg-primary-light",
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
  const { story: fetched, loading, error } = useStory(storyId);
  const progress = useProgress();
  const { isAdmin } = useIsAdmin();

  const [lookup, setLookup] = useState(true);
  const [split, setSplit] = useState(false);
  const [highlight, setHighlight] = useState(true);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [finishing, setFinishing] = useState(false);

  // Editing links is a mode of its own rather than something an admin always has on, for the
  // same reason lookup is: it turns every word into a control, and most visits to a story are
  // to read it. Off by default even for an admin.
  const [editing, setEditing] = useState(false);
  const [editingToken, setEditingToken] = useState<Editing | null>(null);
  // An edit comes back from the server as the whole relinked story, and that is what the page
  // shows from then on. Held here rather than pushed back through `useStory`, so the fetch
  // hook stays about fetching.
  const [edited, setEdited] = useState<Story | null>(null);
  const story = edited ?? fetched;

  // A different story means the edited copy is not this one's.
  useEffect(() => {
    setEdited(null);
    setEditingToken(null);
  }, [storyId]);

  // Leaving edit mode must take the panel with it, as turning lookup off takes the card.
  useEffect(() => {
    if (!editing) setEditingToken(null);
  }, [editing]);
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
      <Page>
        <Breadcrumb>
          <BreadcrumbLink to={`/${lang()}/stories`}>← Stories</BreadcrumbLink>
        </Breadcrumb>
        <p className="py-6 text-center text-muted-foreground">
          {loading
            ? 'Loading the story…'
            : error
              ? 'That story could not be loaded. Check your connection and try again.'
              : 'That story does not exist.'}
        </p>
      </Page>
    );
  }

  const hasTranslation = story.translation.length > 0;
  const showSplit = split && hasTranslation;

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
              setEditingToken({ token, paragraph: p, position: piece.index });
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

      if (!isLinked(token)) {
        return <span key={i}>{piece.text}</span>;
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

  return (
    <Page>
      <Breadcrumb>
        <BreadcrumbLink to={`/${lang()}/stories`}>← Stories</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>{story.titleEnglish || story.title}</span>
      </Breadcrumb>

      <header className="mb-7">
        <h1 className="text-3xl font-bold max-md:text-2xl">{story.title}</h1>
        {story.titleEnglish && <p className="mt-1 text-muted-foreground">{story.titleEnglish}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {story.level && <LevelBadge level={story.level} />}
          <span className="text-xs text-faint">{story.stats.tokens} words</span>
          <span className="text-xs text-faint">{story.stats.coverage}% linked</span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <ReaderToggle on={lookup} onClick={() => setLookup((v) => !v)}>
            {lookup ? <Eye /> : <EyeOff />}
            Word lookup
          </ReaderToggle>
          <ReaderToggle
            on={showSplit}
            onClick={() => setSplit((v) => !v)}
            disabled={!hasTranslation}
            title={hasTranslation ? undefined : "This story has no translation yet"}
          >
            <Layers />
            Side by side
          </ReaderToggle>
          <ReaderToggle
            on={highlight}
            onClick={() => setHighlight((v) => !v)}
            title="Colour every word by how well you know it"
          >
            <SlidersHorizontal />
            Highlight
          </ReaderToggle>
          <Button variant="controlOn" size="auto-sm" className="ml-auto" onClick={() => setFinishing(true)}>
            <Flag />
            Finish
          </Button>

          {isAdmin && (
            // Editing wears the "never seen" indigo rather than the accent blue, so the mode
            // that rewrites the page is not the same colour as the modes that only read it.
            <ReaderToggle
              on={editing}
              onClick={() => {
                setEditing((v) => !v);
                close();
              }}
              title="Correct what each word links to"
              className={editing ? "border-m-unseen text-m-unseen" : undefined}
            >
              <Link2 />
              Edit links
            </ReaderToggle>
          )}
        </div>

        {editing ? <EditLegend story={story} /> : <StoryProgress counts={counts} shown={highlight} />}
      </header>

      {/* A grid rather than two columns of running text: pairing by row is what guarantees a
          paragraph stays level with its translation however differently the two languages
          wrap. Two columns stop being readable well before the sidebar drops away, so below
          900px the pairs stack — Georgian, then its translation directly under it. */}
      <article
        className={cn(
          "rounded-lg border border-border bg-card p-8 shadow-card max-md:p-5",
          showSplit ? "max-w-none" : "max-w-[68ch]",
        )}
      >
        {showSplit
          ? story.paragraphs.map((paragraph, p) => (
              <div
                className="mb-[18px] grid grid-cols-2 gap-8 border-b border-border pb-[18px] last:mb-0 last:border-b-0 last:pb-0 max-[900px]:grid-cols-1 max-[900px]:gap-2"
                key={p}
              >
                <p className={cn(STORY_PARA, "mb-0")}>{renderParagraph(paragraph, p)}</p>
                <p className="text-base leading-loose text-muted-foreground max-[900px]:border-l-2 max-[900px]:border-border max-[900px]:pl-3">
                  {story.translation[p]}
                </p>
              </div>
            ))
          : story.paragraphs.map((paragraph, p) => (
              <p className={STORY_PARA} key={p}>
                {renderParagraph(paragraph, p)}
              </p>
            ))}
      </article>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3.5 rounded-lg border border-dashed border-border-strong p-5">
        <p className="text-muted-foreground">Reached the end?</p>
        <Button variant="control" size="auto" className={KNOW_BUTTON} onClick={() => setFinishing(true)}>
          <Flag /> Finish reading
        </Button>
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

      <FinishDialog
        open={finishing}
        unseen={counts.unseen}
        vocabulary={vocabulary}
        onClose={() => setFinishing(false)}
      />

      {editingToken && (
        <Suspense fallback={null}>
          <TokenEditor
            story={story}
            paragraph={editingToken.paragraph}
            position={editingToken.position}
            token={editingToken.token}
            onClose={() => setEditingToken(null)}
            onSaved={(result) => {
              // The server hands back the whole relinked story. Showing that rather than
              // patching the one token in place is what keeps the screen and the database
              // agreeing — pinning a spelling "everywhere" changes tokens this panel never saw.
              setEdited(result.story);
              replaceStory(result.story);
              setEditingToken(null);
            }}
          />
        </Suspense>
      )}
    </Page>
  );
}

/** Prose is set large and loose: it is being read a word at a time, not skimmed. */
const STORY_PARA = "mb-[18px] text-[19px] leading-[2] last:mb-0 max-md:text-[17px] max-md:leading-[1.9]";

/** The affirmative action in this app: green rather than the accent blue. */
export const KNOW_BUTTON =
  "border-[#22c55e] bg-level-a1 text-level-a1-foreground hover:border-[#22c55e] hover:bg-level-a1 hover:brightness-97";

/** One of the reader's mode switches. Pressed state is the border and the label going accent. */
function ReaderToggle({
  on,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { on: boolean }) {
  return (
    <Button
      type="button"
      variant={on ? "controlOn" : "control"}
      size="auto-sm"
      aria-pressed={on}
      className={cn("disabled:opacity-50", className)}
      {...props}
    />
  );
}

/* --------------------------------------------------------------- edit mode */

// What the colours mean while links are being edited, and how much is left to do.
//
// It replaces the mastery bar rather than sitting under it, because the two say different
// things about the same words and showing both at once would put two colour schemes on one
// page of text.
function EditLegend({ story }: { story: Story }) {
  const tally = { unresolved: 0, guessed: 0, pinned: 0, named: 0, total: 0 };
  for (const token of story.tokens.flat()) {
    tally.total += 1;
    if (token.name) tally.named += 1;
    if (!token.word && !token.name) tally.unresolved += 1;
    else if (token.check) tally.guessed += 1;
    if (token.via === "name" || token.via.startsWith("override")) tally.pinned += 1;
  }

  return (
    <div className={PANEL}>
      <p className="max-w-[78ch] text-[13.5px] leading-relaxed text-muted-foreground">
        Every word is a button. Click one to link it to a dictionary entry, name it as a proper noun for this
        story only, or mark it as deliberately not a word.
      </p>
      <StudyLegend>
        <span><Dot className="bg-m-1" />{tally.unresolved} nothing matched</span>
        <span><Dot className="bg-m-3" />{tally.guessed} reached by a guess</span>
        <span><Dot className="bg-m-unseen" />{tally.named} named</span>
        <span><Dot className="bg-faint" />{tally.pinned} set by hand</span>
        <span className={LEGEND_ASIDE}>{tally.total} words</span>
      </StudyLegend>
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

  return (
    <div className={PANEL}>
      <StudyMeter known={counts.known} solid={counts.solid} learning={counts.learning} total={counts.total} />
      <StudyLegend>
        <span><Dot className="bg-m-6" />{counts.known} known</span>
        <span><Dot className="bg-m-5" />{counts.solid} solid</span>
        <span><Dot className="bg-m-3" />{counts.learning} learning</span>
        <span><Dot className="bg-m-unseen" />{counts.unseen} never seen</span>
        <span className={LEGEND_ASIDE}>
          {counts.total} distinct words{shown ? "" : " · highlighting off"}
        </span>
      </StudyLegend>
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
  open,
  unseen,
  vocabulary,
  onClose,
}: {
  open: boolean;
  unseen: number;
  vocabulary: string[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [markKnown, setMarkKnown] = useState(true);

  const finish = () => {
    if (markKnown) markUnseenKnown(vocabulary);
    navigate(-1);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-[500px] rounded-lg p-6">
        <DialogHeader className="text-left">
          <DialogTitle className="text-xl">Finished reading?</DialogTitle>
          <DialogDescription>
            {unseen > 0
              ? `${unseen} of this story's words have never been studied.`
              : "You have an opinion about every word in this story."}
          </DialogDescription>
        </DialogHeader>

        <label
          className={cn(
            "flex cursor-pointer items-center gap-2 text-[15px] font-medium",
            unseen === 0 && "cursor-not-allowed opacity-50",
          )}
        >
          <Checkbox
            checked={markKnown && unseen > 0}
            disabled={unseen === 0}
            onCheckedChange={(value) => setMarkKnown(value === true)}
          />
          Mark those {unseen} words as known
        </label>
        <p className="text-[13px] leading-relaxed text-faint">
          They go to level 6 and never come up in flashcards again. Words you rated while reading are left as
          you rated them.
        </p>

        <DialogFooter>
          <Button variant="control" size="auto" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="control" size="auto" className={KNOW_BUTTON} onClick={finish}>
            <Check /> Finish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      className="fixed z-60 w-80 max-w-[calc(100vw-24px)] rounded-lg border border-border-strong bg-popover px-4.5 py-4 text-popover-foreground shadow-pop"
      style={style}
      ref={ref}
      role="dialog"
      aria-label={`Meaning of ${token.form}`}
      onMouseEnter={onHold}
      onMouseLeave={onRelease}
    >
      <p className="text-[22px] leading-tight font-semibold">
        {item.verb && item.lex ? <VerbSegments form={token.form} item={item} /> : token.form}
      </p>

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

export default StoryReader;
