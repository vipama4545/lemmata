// The video library: what has been imported, and the screen for importing more.
//
// A section of its own rather than a shelf in My library, and the reason is that these are not
// the same kind of thing to their owner. A story is something you keep and go back to; a video
// is something you watched, and the list is a history as much as a library. They also arrive
// completely differently — one is pasted, the other is a three-step dance with a bookmark — and
// putting both on one screen would make the story form apologise for the video one.
//
// Underneath they are the same rows. A video story is a story with a `story_videos` beside it,
// which is what buys the word cards, the coverage figure, the corrections and the mastery
// tinting without any of it being written twice.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MonitorPlay, Trash2 } from 'lucide-react';
import type { VideoSummary } from '@georgian/shared/contract';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from '@/components/ui/page';
import { Button } from '@/components/ui/button';
import { api } from '../api/client';
import { forgetStory } from '../data/stories';
import { lang, langName } from '../content/store';
import { useLibraryEdit, useSignedIn } from '../library/store';
import { Badge, Empty, ErrorLine, Rows, RowMeta, RowTarget, Section, SectionTitle, SignInFirst } from '../library/ui';
import VideoImport from './VideoImport';
import { videoHref } from './href';

export default function MyVideos() {
  const signedIn = useSignedIn();
  if (!signedIn) return <SignInFirst what="your video library" />;
  return <Videos />;
}

function Videos() {
  const [list, setList] = useState<VideoSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Which row is asking "are you sure". One at a time: two open confirmations is two chances to
  // press the wrong Yes.
  const [confirming, setConfirming] = useState<string | null>(null);
  const { busy, error, run } = useLibraryEdit();

  const load = useCallback(() => {
    let live = true;
    void api.library.videos({ lang: lang() }).then(
      found => {
        if (live) setList(found);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(load, [load]);

  /**
   * Removes a video from the library.
   *
   * `library.deleteStory` and not a video-shaped endpoint of its own, because a video story *is*
   * a story: the row it deletes is the same row, and `story_videos` hangs off it with
   * `on delete cascade`, so the subtitles and their timings go with the prose and the tokens.
   * A second procedure would be a second place for the two to fall out of step.
   */
  const remove = async (video: VideoSummary) => {
    const done = await run(() => api.library.deleteStory({ id: video.storyId }));
    if (!done) return;
    // The reader keeps chapters for the session, so without this a deleted video is still
    // readable from the cache until the page is reloaded.
    forgetStory(video.storyId);
    setConfirming(null);
    setList(current => current?.filter(row => row.storyId !== video.storyId) ?? null);
  };

  return (
    <Page>
      <Breadcrumb>
        <BreadcrumbLink to={`/${lang()}`}>{langName()}</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>My videos</span>
      </Breadcrumb>

      <h1 className="mt-2 mb-1 text-2xl font-bold">My videos</h1>
      <p className="mb-6 text-muted-foreground">
        A YouTube video and its subtitles, read the way a story is read: hover a word for what it
        means there, click a line to hear it said.
      </p>

      <Section>
        <SectionTitle>Imported</SectionTitle>
        {failed && <ErrorLine>Your videos could not be loaded. Reload the page.</ErrorLine>}
        {error && <ErrorLine>{error}</ErrorLine>}
        {list && list.length === 0 && <Empty>Nothing yet. The three steps below add the first one.</Empty>}
        {list && list.length > 0 && (
          <Rows>
            {list.map(video => (
              // A row rather than a link, with the link inside it: the whole row used to be one
              // anchor, and a Delete button inside an anchor is a button whose every press is
              // also a navigation.
              <div key={video.storyId} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent">
                <Link to={videoHref(video.storyId)} className="flex min-w-0 flex-1 items-center gap-3">
                  {/* YouTube's own still, at the smallest size it publishes. It is the one part of
                      this screen fetched from them at view time, and it is a plain <img> so that a
                      video that has gone away shows a gap rather than failing anything. */}
                  <img
                    src={`https://i.ytimg.com/vi/${video.youtubeId}/default.jpg`}
                    alt=""
                    loading="lazy"
                    width={80}
                    height={60}
                    className="h-[45px] w-[80px] shrink-0 rounded border border-border object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <RowTarget>{video.title}</RowTarget>
                    <RowMeta>
                      {video.paragraphs} line{video.paragraphs === 1 ? '' : 's'}
                    </RowMeta>
                  </div>
                  <Badge>{video.coverage}% linked</Badge>
                </Link>

                {confirming === video.storyId ? (
                  <span className="flex shrink-0 items-center gap-2 text-sm">
                    {/* Says what goes, because what goes is more than the video: every word you
                        corrected on it goes too, and that is the part worth a moment's pause. */}
                    <span className="max-sm:hidden">Delete this and your corrections on it?</span>
                    <Button variant="dangerOutline" size="auto-sm" disabled={busy} onClick={() => void remove(video)}>
                      Yes, delete
                    </Button>
                    <Button variant="control" size="auto-sm" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button
                    variant="dangerOutline"
                    size="icon-sm"
                    className="shrink-0"
                    disabled={busy}
                    onClick={() => setConfirming(video.storyId)}
                    aria-label={`Delete ${video.title}`}
                    title="Remove this video from your library"
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            ))}
          </Rows>
        )}
      </Section>

      <div className="mt-8 flex items-center gap-2 text-lg font-semibold">
        <MonitorPlay className="size-5 text-muted-foreground" />
        Add a video
      </div>
      <VideoImport />
    </Page>
  );
}
