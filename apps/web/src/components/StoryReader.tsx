import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  Flag,
  Headphones,
  Layers,
  Link2,
  Pencil,
  SlidersHorizontal,
} from "lucide-react";
import type { Story, StorySummary, StoryToken } from "@georgian/shared/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from "@/components/ui/page";
import { Dot, LEGEND_ASIDE, StudyLegend, StudyMeter } from "@/components/ui/study-meter";
import { LevelBadge } from "@/components/ui/word-card";
import { cn } from "@/lib/utils";
import { useIsAdmin } from "../admin/useAdmin";
import { useLibraryEdit, useSignedIn } from "../library/store";
import { api } from "../api/client";
import { replaceStory, useStory } from "../data/stories";
import { chapterHref } from "../utils/story";
import { markUnseenKnown, useProgress } from "../study/store";
import { StoryAudioBar, useStoryAudio } from "./StoryAudio";
import { useShelves, type Shelf } from "./StoryIndex";
import StoryProse, { linkTally, masteryCounts, storyVocabulary } from "./StoryProse";
import { lang } from "../content/store";

// Only rendered for somebody who has turned editing on: an admin on a published story, or a
// reader on one of their own. So it rides in a chunk of its own rather than in the one every
// reader downloads. It still lives under admin/ because that is where it was written and it
// does the same job for both; see the note at the head of it.
const TokenEditor = lazy(() => import("../admin/TokenEditor"));

/** The panel under the controls: the progress bar, or the legend that replaces it. */
const PANEL = "mt-4 flex flex-col gap-2 rounded-sm border border-border bg-card px-3.5 py-3";

/** Which occurrence is being edited, and where in the text it is. */
interface Editing {
  token: StoryToken;
  paragraph: number;
  position: number;
}

/** The story to read after this one, and the shelf it is on when that is not this one's. */
interface Onward {
  story: StorySummary;
  /** Set only when the next story is filed under another category. */
  shelf?: Shelf;
}

/**
 * What there is to read after the last chapter of this story.
 *
 * The next story on the same shelf, or — at the end of a shelf — the first story on the next one,
 * in the order the library lays them out. The end of a chapter has always offered the chapter
 * after it; this is that same offer at the two boundaries above it, so that finishing a book
 * leads somewhere rather than stopping dead and sending the reader back to the index to work out
 * where they had got to.
 */
function following(shelves: Shelf[], storyId: string): Onward | undefined {
  const at = shelves.findIndex((shelf) => shelf.stories.some((entry) => entry.id === storyId));
  if (at < 0) return undefined;

  const here = shelves[at].stories;
  const along = here[here.findIndex((entry) => entry.id === storyId) + 1];
  if (along) return { story: along };

  const over = shelves[at + 1];
  return over?.stories[0] ? { story: over.stories[0], shelf: over } : undefined;
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
  const { storyId, chapter: chapterParam } = useParams<{ storyId: string; chapter: string }>();
  // 1-based in the URL and 0-based everywhere else: a reader's third chapter is "3", and a
  // link that said /2 for it would be the one part of this app that counts from zero in
  // public. Anything unparseable is the first chapter rather than an error.
  const asked = Math.max((Number(chapterParam) || 1) - 1, 0);
  // The text and its tokens are fetched rather than bundled — 120 KB for one story's worth,
  // which is not worth carrying around for the visits that never open it.
  const { story: fetched, loading, error } = useStory(storyId, asked);
  const progress = useProgress();
  const { isAdmin } = useIsAdmin();
  // The library's shelves, for the one question this page asks of them: what comes after this
  // book. Out of the snapshot that is already here, so it costs a `useMemo` rather than a fetch.
  const shelves = useShelves();

  const [lookup, setLookup] = useState(true);
  const [split, setSplit] = useState(false);
  const [highlight, setHighlight] = useState(true);
  const [finishing, setFinishing] = useState(false);

  // Editing links is a mode of its own rather than something always on for whoever may do it,
  // for the same reason lookup is: it turns every word into a control, and most visits to a
  // story are to read it. Off by default for an admin and for the owner alike.
  const [editing, setEditing] = useState(false);
  const [editingToken, setEditingToken] = useState<Editing | null>(null);
  // An edit comes back from the server as the whole relinked story, and that is what the page
  // shows from then on. Held here rather than pushed back through `useStory`, so the fetch
  // hook stays about fetching.
  const [edited, setEdited] = useState<Story | null>(null);
  // Only where it is this page's. The effect below clears it on a page turn, but an effect
  // runs after the render that caused it, and one render of another chapter's tokens over
  // this chapter's prose is one render too many — see the same reasoning in `useStory`.
  const story = edited && edited.id === storyId && edited.chapter === asked ? edited : fetched;

  // A different story — or a different chapter of it — means the edited copy is not this
  // page's. The edited story carries one chapter's tokens, so keeping it across a page turn
  // would paint chapter 2's prose with chapter 1's links.
  useEffect(() => {
    setEdited(null);
    setEditingToken(null);
  }, [storyId, asked]);

  // Leaving edit mode must take the panel with it, as turning lookup off takes the card.
  useEffect(() => {
    if (!editing) setEditingToken(null);
  }, [editing]);

  // A chapter number past the end of the book answers with the last chapter, which leaves
  // the address bar naming a page that is not on screen. Correcting it in place — replace,
  // not push — keeps the back button pointing where the reader came from.
  //
  // Safe to act on the moment there is a story, because `useStory` never hands back one that
  // answers a different question — see the guard at the end of it. Without that, this is the
  // line that would send a reader who asked for chapter 3 back to chapter 1: for one render
  // `fetched` would still be the chapter just left, and its number is not this one's.
  const navigate = useNavigate();
  const landed = fetched?.chapter;
  useEffect(() => {
    if (storyId && landed != null && landed !== asked) {
      navigate(chapterHref(storyId, landed), { replace: true });
    }
  }, [storyId, landed, asked, navigate]);
  // Keyed on the chapter that is actually on screen rather than the one in the URL, so the
  // queue is never built against a page that has already been turned. `storyId` is empty for
  // one render before the route resolves, which the hook reads as "no chapter" and skips.
  const audio = useStoryAudio(storyId ?? "", story?.chapter ?? 0);

  // Whether the player is on screen. Off by default: reading is what this page is for, and
  // a bar fixed over the foot of every story would be a permanent tax on the ordinary case
  // to serve the occasional one. The manifest is still fetched either way — it is a database
  // read with no synthesis behind it, and its answer is what decides whether the button that
  // opens this is worth showing at all.
  const [listening, setListening] = useState(false);

  // Closing has to stop the audio, not merely hide the controls: a bar put away mid-sentence
  // would otherwise keep talking with nothing left on screen to stop it.
  const stopListening = useCallback(() => {
    setListening(false);
    audio.stop();
  }, [audio]);

  // Turning the page must do the same, for the same reason.
  useEffect(() => {
    setListening(false);
  }, [storyId, asked]);

  // Every dictionary entry the story cites, once. This is the story's vocabulary — what the
  // counts below are out of, and what Finish acts on.
  const vocabulary = useMemo(() => storyVocabulary(story), [story]);
  const counts = useMemo(() => masteryCounts(vocabulary, progress), [vocabulary, progress]);

  if (loading || error || !story) {
    return (
      <Page>
        <Breadcrumb>
          <BreadcrumbLink to={`/${lang()}/stories`}>← Library</BreadcrumbLink>
        </Breadcrumb>
        <p className="py-6 text-center text-muted-foreground">
          {loading
            ? "Loading the story…"
            : error
              ? "That story could not be loaded. Check your connection and try again."
              : "That story does not exist."}
        </p>
      </Page>
    );
  }

  const hasTranslation = story.translation.length > 0;
  const showSplit = split && hasTranslation;

  // Whose story this is, and what that licenses on screen. An admin may correct the links in
  // anything the dictionary publishes; a reader may correct them in their own text and nowhere
  // else. Both decide only whether the *button* is drawn; every write re-reads the owner on
  // the server.
  const mine = story.mine === true;
  const mayEditLinks = mine || (isAdmin && !story.mine);

  const multiChapter = story.chapters.length > 1;
  const here = story.chapters.find((entry) => entry.position === story.chapter);
  // A story of one chapter has the same counts either way, and one with none at all — which
  // only an admin mid-upload ever sees — has the story's, which are zeroes.
  const stats = here?.stats ?? story.stats;
  const next = story.chapters.find((entry) => entry.position === story.chapter + 1);
  // Only at the end of the book: while there is another chapter, the next chapter is the only
  // thing worth offering, and a second forward button beside it would be a choice where there is
  // no decision to make.
  const onward = next ? undefined : following(shelves, story.id);

  return (
    <Page>
      <Breadcrumb>
        <BreadcrumbLink to={`/${lang()}/stories`}>← Library</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>{story.titleEnglish || story.title}</span>
      </Breadcrumb>

      <header className="mb-7">
        <h1 className="text-3xl font-bold max-md:text-2xl">{story.title}</h1>
        {story.titleEnglish && <p className="mt-1 text-muted-foreground">{story.titleEnglish}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {story.level && <LevelBadge level={story.level} />}
          {/* This chapter's counts once there is more than one, because they are what the
              page in front of you is made of. The whole book's are on the index card. */}
          <span className="text-xs text-faint">{stats.tokens} words</span>
          <span className="text-xs text-faint">{stats.coverage}% linked</span>
        </div>

        {multiChapter && <ChapterNav story={story} />}

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
          {/* Absent, rather than disabled, where the server has no voice: a control that
              cannot ever do anything on this deployment is not a control worth explaining. */}
          {audio.available && (
            <ReaderToggle
              on={listening}
              onClick={() => (listening ? stopListening() : setListening(true))}
              title="Read the story aloud and follow along"
            >
              <Headphones />
              Read aloud
            </ReaderToggle>
          )}
          <Button variant="controlOn" size="auto-sm" className="ml-auto" onClick={() => setFinishing(true)}>
            <Flag />
            Finish
          </Button>

          {mayEditLinks && (
            // Editing wears the "never seen" indigo rather than the accent blue, so the mode
            // that rewrites the page is not the same colour as the modes that only read it.
            <ReaderToggle
              on={editing}
              onClick={() => setEditing((v) => !v)}
              title={mine ? "Correct what each word in your own text links to" : "Correct what each word links to"}
              className={editing ? "border-m-unseen text-m-unseen" : undefined}
            >
              <Link2 />
              Edit links
            </ReaderToggle>
          )}
        </div>

        <OwnStoryActions story={story} />

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
        {/* The chapter's own heading, if it was given one. Inside the article rather than in
            the page header, because it belongs to the text below it and not to the book —
            and because that is where it would sit on the printed page. */}
        {story.chapterTitle && (
          <header className="mb-6 border-b border-border pb-4">
            <h2 className="text-2xl font-semibold max-md:text-xl">{story.chapterTitle}</h2>
            {story.chapterTitleEnglish && (
              <p className="mt-0.5 text-sm text-muted-foreground">{story.chapterTitleEnglish}</p>
            )}
          </header>
        )}

        <StoryProse
          story={story}
          lookup={lookup}
          highlight={highlight}
          translation={showSplit}
          spokenAt={audio.at}
          spokenLine={audio.lineKey}
          onPlayFrom={
            audio.available
              ? (paragraph, word) => {
                  setListening(true);
                  audio.playFrom(paragraph, word);
                }
              : undefined
          }
          editing={editing}
          onEditWord={(token, paragraph, position) => setEditingToken({ token, paragraph, position })}
        />
      </article>

      {/* Reaching the end of a chapter that has another after it is not reaching the end of
          the story, so the green button says so: carrying on is the expected thing and gets
          the affirmative colour, and finishing early is still offered beside it.

          At the end of the last chapter the same holds one level up — there is another story on
          the shelf, or another shelf — so the offer is the next book instead, in the same
          colour. Finish keeps the affirmative only when there is genuinely nothing after this. */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3.5 rounded-lg border border-dashed border-border-strong p-5">
        <p className="text-muted-foreground">
          {next ? "End of this chapter." : onward ? "End of this story." : "Reached the end?"}
        </p>
        {next && (
          <Button variant="control" size="auto" className={KNOW_BUTTON} asChild>
            <Link to={chapterHref(story.id, next.position)}>
              Next chapter <ArrowRight />
            </Link>
          </Button>
        )}
        {onward && (
          <Button variant="control" size="auto" className={KNOW_BUTTON} asChild>
            <Link
              to={chapterHref(onward.story.id, 0)}
              // The shelf it is on, where that has changed. Not in the label — a button whose
              // text is two names is a button nobody reads to the end of — but the reader is
              // being moved to another part of the library and something should say so.
              title={onward.shelf ? `Next on ${onward.shelf.name}` : undefined}
            >
              <span className="max-w-[34ch] truncate">Next: {onward.story.titleEnglish || onward.story.title}</span>
              <ArrowRight />
            </Link>
          </Button>
        )}
        <Button
          variant="control"
          size="auto"
          className={next || onward ? undefined : KNOW_BUTTON}
          onClick={() => setFinishing(true)}
        >
          <Flag /> Finish reading
        </Button>
      </div>

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
            chapter={story.chapter}
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

      {/* Fixed to the viewport, so it stays put while the text scrolls under it — following
          a recording means scrolling, and controls that scroll away with the paragraph they
          started on are controls you have to go and find. The spacer is what keeps the last
          line of the story from sitting underneath it, and goes away with the bar. */}
      {listening && audio.available && (
        <>
          <div aria-hidden className="h-24" />
          <StoryAudioBar audio={audio} onClose={stopListening} />
        </>
      )}
    </Page>
  );
}

/**
 * The row that says whose story this is and what can be done about it.
 *
 * Two buttons, and never both. On your own text it opens the editor. On one the dictionary
 * publishes it offers a copy, which is the honest answer to what a reader will try first: they
 * cannot edit this story, but they can have one just like it that they can edit.
 *
 * Nothing at all for a signed-out visitor, who has nowhere to copy anything to. The invitation
 * lives on the library index, where it can be explained in a sentence rather than in a button.
 */
function OwnStoryActions({ story }: { story: Story }) {
  const navigate = useNavigate();
  const signedIn = useSignedIn();
  const { busy, error, run } = useLibraryEdit();

  if (!signedIn) return null;

  if (story.mine) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <Button variant="control" size="auto-sm" asChild>
          <Link to={`/${lang()}/library/stories/${encodeURIComponent(story.id)}`}>
            <Pencil /> Edit this text
          </Link>
        </Button>
      </div>
    );
  }

  const copy = async () => {
    const result = await run(() => api.library.copyStory({ id: story.id }));
    // Straight into the copy, because that is the thing they now want to be looking at: the
    // same page, with the buttons that were missing a moment ago.
    if (result) navigate(chapterHref(result.id, 0));
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2.5">
      <Button variant="control" size="auto-sm" disabled={busy} onClick={copy}>
        <Copy /> {busy ? "Copying…" : "Copy to my library"}
      </Button>
      <span className="text-xs text-faint">Takes a copy you can edit, with its links already worked out.</span>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

/**
 * Moving between chapters: a step either way, and a menu for the rest.
 *
 * Drawn only for a story that has more than one. A short story is not a book with a single
 * chapter in it, and putting "Chapter 1 of 1" above one would be furniture describing the
 * shape of the database rather than anything a reader wants to know.
 */
function ChapterNav({ story }: { story: Story }) {
  const navigate = useNavigate();
  const previous = story.chapters.find((entry) => entry.position === story.chapter - 1);
  const next = story.chapters.find((entry) => entry.position === story.chapter + 1);

  return (
    <nav className="mt-4 flex flex-wrap items-center gap-2.5" aria-label="Chapters">
      {/* A real disabled Button at the ends rather than a Link wearing one: `asChild` hands
          its props to the child, and `disabled` on an anchor is not a thing — it would render
          as an attribute browsers ignore and screen readers do not announce. */}
      {previous ? (
        <Button variant="control" size="auto-sm" asChild>
          <Link to={chapterHref(story.id, previous.position)}>
            <ArrowLeft /> Previous
          </Link>
        </Button>
      ) : (
        <Button variant="control" size="auto-sm" disabled>
          <ArrowLeft /> Previous
        </Button>
      )}

      {/* A select rather than a list of links: forty chapters is a plausible book and forty
          buttons is not a navigation bar. It carries the titles, which is what makes it
          worth opening — the numbers are already on the two buttons either side. */}
      <Select value={String(story.chapter)} onValueChange={(value) => navigate(chapterHref(story.id, Number(value)))}>
        <SelectTrigger className="h-8 w-auto min-w-52 text-sm" aria-label="Go to a chapter">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {story.chapters.map((entry) => (
            <SelectItem key={entry.position} value={String(entry.position)}>
              {entry.title || entry.titleEnglish
                ? `${entry.position + 1}. ${entry.title || entry.titleEnglish}`
                : `Chapter ${entry.position + 1}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {next ? (
        <Button variant="control" size="auto-sm" asChild>
          <Link to={chapterHref(story.id, next.position)}>
            Next <ArrowRight />
          </Link>
        </Button>
      ) : (
        <Button variant="control" size="auto-sm" disabled>
          Next <ArrowRight />
        </Button>
      )}

      <span className="text-xs text-faint">
        {story.chapter + 1} of {story.chapters.length}
      </span>
    </nav>
  );
}

/** The affirmative action in this app: green rather than the accent blue. */
export const KNOW_BUTTON =
  "border-[#22c55e] bg-level-a1 text-level-a1-foreground hover:border-[#22c55e] hover:bg-level-a1 hover:brightness-97";

/** One of the reader's mode switches. Pressed state is the border and the label going accent. */
function ReaderToggle({ on, className, ...props }: React.ComponentProps<typeof Button> & { on: boolean }) {
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
  const tally = linkTally(story);

  return (
    <div className={PANEL}>
      <p className="max-w-[78ch] text-[13.5px] leading-relaxed text-muted-foreground">
        Every word is a button. Click one to link it to a dictionary entry, name it as a proper noun for this story
        only, or mark it as deliberately not a word.
      </p>
      <StudyLegend>
        <span>
          <Dot className="bg-m-1" />
          {tally.unresolved} nothing matched
        </span>
        <span>
          <Dot className="bg-m-3" />
          {tally.guessed} reached by a guess
        </span>
        <span>
          <Dot className="bg-m-unseen" />
          {tally.named} named
        </span>
        <span>
          <Dot className="bg-faint" />
          {tally.pinned} set by hand
        </span>
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
        <span>
          <Dot className="bg-m-6" />
          {counts.known} known
        </span>
        <span>
          <Dot className="bg-m-5" />
          {counts.solid} solid
        </span>
        <span>
          <Dot className="bg-m-3" />
          {counts.learning} learning
        </span>
        <span>
          <Dot className="bg-m-unseen" />
          {counts.unseen} never seen
        </span>
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
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
          They go to level 6 and never come up in flashcards again. Words you rated while reading are left as you rated
          them.
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

export default StoryReader;
