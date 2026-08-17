// Asking Wikimedia for the size we are actually going to draw.
//
// Every picture in the app is a Wikimedia URL stored in the snapshot, and the build scripts
// stored whatever width the API happened to hand back — 960px for every category image. The
// category grid draws those in a 268x201 tile, so the browse page was downloading 6.3MB
// above the fold and holding 75MB of decoded bitmap to fill a wall of thumbnails, thirteen
// times more pixels than any of them shows. This rewrites the width in the URL instead.
//
// Two things about the URL format are worth knowing before changing anything here.
//
// The first is that a thumbnail URL names its own width — /thumb/8/8b/File.jpg/960px-File.jpg
// — and an original does not: /commons/8/8b/File.jpg. Both shapes are in the snapshot, so both
// have to be handled, and turning an original into a thumbnail means building the /thumb/
// path rather than editing it.
//
// The second is that the width is not free-form. Wikimedia serves an allow-list of widths and
// answers anything else with a 400 and a page reading "use thumbnail sizes listed on
// w.wiki/GHai", which as an <img> src is a broken picture rather than a slow one. That is why
// this rounds up to the next size on the list instead of asking for exactly what the tile is:
// a request for 268px fails, and 330px is the smallest thing that does not.

/**
 * The widths upload.wikimedia.org will actually generate, ascending.
 *
 * Anything absent from this list is a 400. It is longer than this at the top end, but nothing
 * in this app draws a picture wider than 500 CSS pixels, so 1280 is only here to be the
 * ceiling that stops `next` walking off the end.
 */
const WIKIMEDIA_WIDTHS = [120, 250, 330, 500, 960, 1280] as const;

/** The smallest allowed width that still covers `want`, or the largest there is. */
function next(want: number): number {
  return WIKIMEDIA_WIDTHS.find(allowed => allowed >= want) ?? WIKIMEDIA_WIDTHS.at(-1)!;
}

/**
 * The allowed width closest to `want`, over or under.
 *
 * For the 2x slot only, where rounding up is the wrong instinct. The gaps in the list are wide
 * — 500 then 960 — so a 268px tile asking for 536 gets rounded to 960, which is the width this
 * whole file exists to stop it fetching. Under-shooting to 500 is 1.87x on a 2x screen, which
 * nobody can see, against nearly four times the bytes for the 0.13x nobody can see either.
 *
 * Safe to under-shoot here in a way it is not at 1x, because the alternative the browser would
 * otherwise pick is the 1x asset — anything at all above that is sharper, never softer.
 */
function nearest(want: number): number {
  return WIKIMEDIA_WIDTHS.reduce((best, allowed) =>
    Math.abs(allowed - want) < Math.abs(best - want) ? allowed : best,
  );
}

/**
 * `url` re-pointed at roughly `width` CSS pixels — the real width is the next one up that
 * Wikimedia will serve, or `round: 'nearest'` for the closest either way.
 *
 * Returns the URL untouched rather than throwing when it is not a Wikimedia upload or does
 * not parse, because the fallback that matters is the picture still appearing. A lesson's own
 * uploaded media is served by this app and goes down that path.
 */
export function atWidth(url: string, width: number, round: 'up' | 'nearest' = 'up'): string {
  const parsed = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[a-z]+\/)(thumb\/)?(.+)$/.exec(url);
  if (!parsed) return url;

  const [, root, isThumb, rest] = parsed;
  const target = round === 'up' ? next(width) : nearest(width);

  // Already a thumbnail: the width is a segment of the path, so swap it. Anchored to the
  // slash before it because a *file* can be called 100px-something.jpg, and the trailing
  // segment is the only place the size is authoritative.
  if (isThumb) {
    // No width to swap means a shape this does not know — a page-1 PDF render, say. Leave it,
    // rather than hand an <img> a path Wikimedia will 400.
    if (!/\/\d+px-/.test(rest)) return url;
    return `${root}thumb/${rest.replace(/\/(\d+)px-/, `/${target}px-`)}`;
  }

  // An original. The thumbnail lives under /thumb/<same path>/<width>px-<filename>, with the
  // one wrinkle that a vector is rasterised and gains a .png on the end.
  const file = rest.split('/').pop();
  if (!file) return url;
  const name = /\.svg$/i.test(file) ? `${target}px-${file}.png` : `${target}px-${file}`;
  return `${root}thumb/${rest}/${name}`;
}

/**
 * `src` and `srcSet` for a picture drawn `width` CSS pixels wide.
 *
 * The 2x entry is what keeps this from being a downgrade on a phone, which is where the
 * saving matters most and also where the screen has the most pixels to fill. Spreading the
 * result onto an `<img>` is the whole of the intended use:
 *
 *     <img {...sized(image.url, 268)} alt="" loading="lazy" />
 */
export function sized(url: string, width: number): { src: string; srcSet: string } {
  const one = atWidth(url, width);
  const two = atWidth(url, width * 2, 'nearest');
  return {
    src: one,
    // Nothing to offer a dense screen when both land on the same allowed width — which is what
    // happens for the two small tiles, where 2x is still inside the smallest size there is. A
    // srcSet whose entries are identical only invites the browser to fetch the same bytes
    // under a second name.
    srcSet: one === two ? `${one} 1x` : `${one} 1x, ${two} 2x`,
  };
}
