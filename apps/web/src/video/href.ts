// Where the video section lives, in one place.
//
// Its own file rather than a corner of the routes component, because both the index and the
// reader build these and importing either from the other would be a cycle.

import { lang } from '../content/store';

/** The video library, or something under it. */
export function videosHref(rest = ''): string {
  return `/${lang()}/videos${rest}`;
}

/** One video story. The id is a story id, because a video story is a story. */
export function videoHref(storyId: string): string {
  return videosHref(`/${encodeURIComponent(storyId)}`);
}
