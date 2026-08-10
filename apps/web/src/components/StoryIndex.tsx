import { Link } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from "@/components/ui/page";
import { LevelBadge } from "@/components/ui/word-card";
import { stories } from "../data/stories";
import { lang, langName } from '../content/store';

// The list of things to read. Each card leads with the share of its words that resolve to
// a dictionary entry, because that is what decides whether a story is worth opening yet:
// the rest of the text still reads, it just has nothing to offer on a double-click.
function StoryIndex() {
  const storyList = stories();

  return (
    <Page>
      <Breadcrumb>
        <BreadcrumbLink to={`/${lang()}`}>← Home</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>Stories</span>
      </Breadcrumb>

      <header className="mb-6">
        <h1 className="mb-1.5 flex items-center gap-2.5 text-[26px] font-bold">
          <BookOpen className="size-[22px]" aria-hidden="true" />
          Stories
        </h1>
        <p className="max-w-[62ch] text-muted-foreground">
          {langName()} short stories with every word linked back to the dictionary.
        </p>
      </header>

      {storyList.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">No stories yet.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {storyList.map((story) => {
            const linked = Math.round(story.stats.coverage);
            return (
              <Link
                key={story.id}
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
                  <span>{story.stats.tokens} words</span>
                  <span>{story.stats.distinctForms} distinct</span>
                  <span>{linked}% linked</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-[2px] bg-border" aria-hidden="true">
                  <span className="block h-full bg-(image:--progress-bg)" style={{ width: `${linked}%` }} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Page>
  );
}

export default StoryIndex;
