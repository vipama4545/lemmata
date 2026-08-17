import { useMemo } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Plus } from "lucide-react";
import type { StorySummary } from "@georgian/shared/types";
import { Button } from "@/components/ui/button";
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from "@/components/ui/page";
import { LevelBadge } from "@/components/ui/word-card";
import { lang, langName, myStories, publishedStories, storyCategories } from '../content/store';
import { useSignedIn } from '../library/store';

/**
 * The id the unfiled stories are gathered under.
 *
 * Not a category — there is no row for it and there never will be, because "has no category"
 * is the absence of one rather than a category called nothing. It gets an id here only
 * because it needs a URL, and `-` cannot collide with a slug: `slug()` strips leading and
 * trailing hyphens from every id it mints.
 */
export const UNFILED = '-';

/** Where a shelf lives. Static "category" outranks `:storyId`, so the two never collide. */
export function shelfHref(categoryId: string): string {
  return `/${lang()}/stories/category/${encodeURIComponent(categoryId)}`;
}

/**
 * One shelf's worth of stories, with the heading that names it. Built here rather than in
 * each view so the index and the shelf page can never disagree about what is on it.
 */
export interface Shelf {
  id: string;
  name: string;
  nameNative: string;
  note: string;
  stories: StorySummary[];
}

/**
 * The shelves, in the order they were made, with the unfiled stories last.
 *
 * An empty shelf is dropped. It is worth seeing in the admin list, where it is a thing you
 * made and have not filled yet; it is worth nothing to a reader, who would open it to find
 * out that there is nothing to read.
 */
export function useShelves(): Shelf[] {
  // The published stories alone. A reader's own are never filed on one of these shelves, since
  // the shelves belong to the dictionary, and letting them fall into "Everything else" would put
  // one person's private notebook in the middle of what everybody sees. They have a section of
  // their own below, and `following()` in the reader still walks these.
  const storyList = publishedStories();
  const categories = storyCategories();

  return useMemo(() => {
    const filed: Shelf[] = categories
      .map(category => ({
        id: category.id,
        name: category.name,
        nameNative: category.nameNative,
        note: category.note,
        stories: storyList.filter(story => story.categoryId === category.id),
      }))
      .filter(shelf => shelf.stories.length > 0);

    const unfiled = storyList.filter(
      story => !story.categoryId || !categories.some(category => category.id === story.categoryId),
    );
    if (!unfiled.length) return filed;

    return [
      ...filed,
      {
        id: UNFILED,
        // Only ever seen next to real shelves — when there are none, the index does not draw
        // shelves at all — so it never has to stand on its own and explain itself.
        name: 'Everything else',
        nameNative: '',
        note: '',
        stories: unfiled,
      },
    ];
  }, [storyList, categories]);
}

// What there is to read, by category.
//
// Two levels rather than one long list, because a category is the question a reader actually
// arrives with — "is there a folk tale I can manage?" — and answering it by scrolling past
// everything else stops working at about a page of stories.
//
// Until a category exists there is nothing to browse *by*, so the flat list is what shows.
// That is not a fallback: a dozen stories on one screen is better than one card that has to
// be opened to reach them, and it is exactly what this page has always been.
function StoryIndex() {
  const storyList = publishedStories();
  const shelves = useShelves();
  const filed = shelves.some(shelf => shelf.id !== UNFILED);
  const mine = myStories();
  const signedIn = useSignedIn();

  return (
    <Page>
      <Breadcrumb>
        <BreadcrumbLink to={`/${lang()}`}>← Home</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>Library</span>
      </Breadcrumb>

      <header className="mb-6">
        <h1 className="mb-1.5 flex items-center gap-2.5 text-[26px] font-bold">
          <BookOpen className="size-[22px]" aria-hidden="true" />
          Library
        </h1>
        <p className="max-w-[62ch] text-muted-foreground">
          {langName()} stories and dialogues, with every word linked back to the dictionary. The
          lessons read from these shelves too — a dialogue taught in a lesson is the same text you
          can open here.
        </p>
      </header>

      {storyList.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">No stories yet.</p>
      ) : filed ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {shelves.map(shelf => (
            <ShelfCard key={shelf.id} shelf={shelf} />
          ))}
        </div>
      ) : (
        <StoryGrid stories={storyList} />
      )}

      <YourStories stories={mine} signedIn={signedIn} />
    </Page>
  );
}

/**
 * Your own texts, under the dictionary's.
 *
 * Below rather than beside, and always the same way round. What is here is a shelf nobody else
 * has, so putting it above the library proper would make the page open on a different thing for
 * every reader, and for most on an empty box. Underneath, it reads as what it is: the same
 * library, with your own end of it at the bottom.
 *
 * Shown to a signed-out visitor as an offer rather than hidden, because "you can put your own
 * texts in here" is not discoverable from anywhere else, and this is the page they would be
 * looking at when the thought occurs.
 */
function YourStories({ stories: mine, signedIn }: { stories: StorySummary[]; signedIn: string | null }) {
  if (!signedIn && mine.length === 0) {
    return (
      <section className="mt-10 border-t border-border pt-6">
        <h2 className="mb-1.5 text-lg font-semibold">Your own texts</h2>
        <p className="max-w-[62ch] text-sm text-muted-foreground">
          Sign in to paste in anything you are reading: a news item, a page of a book, a message
          from a friend. It is linked back to the dictionary word by word, exactly as the stories
          above are, and only you can see it.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-10 border-t border-border pt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Your own texts</h2>
        <Button variant="control" size="auto" asChild>
          <Link to={`/${lang()}/library/stories/new`}>
            <Plus /> New story
          </Link>
        </Button>
      </div>

      {mine.length === 0 ? (
        <p className="rounded-sm border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Nothing of yours yet. Paste something in and every word of it is linked to the dictionary.
        </p>
      ) : (
        <StoryGrid stories={mine} />
      )}
    </section>
  );
}

/**
 * One category, as a card.
 *
 * It leads with the titles of what is on it rather than with a picture. A word category has a
 * photograph because "Food & drink" is a thing that can be photographed; a story category is
 * a shelf, and what a reader wants to know before opening one is what is on it. Three titles
 * answer that in the space a thumbnail would have taken.
 */
function ShelfCard({ shelf }: { shelf: Shelf }) {
  const shown = shelf.stories.slice(0, 3);
  const rest = shelf.stories.length - shown.length;

  return (
    <Link
      to={shelfHref(shelf.id)}
      className="flex flex-col rounded-lg border border-border bg-card p-5 shadow-card transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:border-primary hover:shadow-pop"
    >
      <h2 className="text-lg leading-tight font-semibold">{shelf.name}</h2>
      {shelf.nameNative && <p className="mt-0.5 text-sm text-muted-foreground">{shelf.nameNative}</p>}

      <ul className="mt-3 flex flex-1 list-none flex-col gap-1">
        {shown.map(story => (
          <li key={story.id} className="truncate text-sm text-muted-foreground">
            {story.title}
          </li>
        ))}
        {rest > 0 && <li className="text-sm text-faint">and {rest} more</li>}
      </ul>

      <span className="mt-3 self-start rounded-full bg-primary-glow px-2.5 py-0.5 text-[13px] font-medium text-primary">
        {shelf.stories.length === 1 ? '1 story' : `${shelf.stories.length} stories`}
      </span>
    </Link>
  );
}

/** The grid of story cards, drawn by the flat index and by a shelf alike. */
export function StoryGrid({ stories: list }: { stories: StorySummary[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
      {list.map(story => (
        <StoryCard key={story.id} story={story} />
      ))}
    </div>
  );
}

// Each card leads with the share of its words that resolve to a dictionary entry, because
// that is what decides whether a story is worth opening yet: the rest of the text still
// reads, it just has nothing to offer on a double-click.
function StoryCard({ story }: { story: StorySummary }) {
  const linked = Math.round(story.stats.coverage);

  return (
    <Link
      to={`/${lang()}/stories/${story.id}`}
      className="block rounded-lg border border-border bg-card p-5 shadow-card transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:border-primary hover:shadow-pop"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{story.title}</h2>
        {story.level && <LevelBadge level={story.level} />}
      </div>
      {story.titleEnglish && <p className="mt-0.5 text-sm text-muted-foreground">{story.titleEnglish}</p>}
      {/* Two lines of the opening paragraph, as a taster. */}
      <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{story.excerpt}</p>
      <div className="mt-3.5 flex flex-wrap gap-3 text-xs text-faint">
        {/* Said only when there is more than one. "1 chapter" is a fact about the shape of
            the data rather than about the story, and every short story would carry it. */}
        {story.chapters.length > 1 && <span>{story.chapters.length} chapters</span>}
        <span>{story.stats.tokens} words</span>
        <span>{story.stats.distinctForms} distinct</span>
        <span>{linked}% linked</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-[2px] bg-border" aria-hidden="true">
        <span className="block h-full bg-(image:--progress-bg)" style={{ width: `${linked}%` }} />
      </div>
    </Link>
  );
}

export default StoryIndex;
