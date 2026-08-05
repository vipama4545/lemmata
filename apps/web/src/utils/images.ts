// Word images come from a pre-resolved map built by scripts/buildImageData.cjs, which
// matches each word to a Wikipedia article and takes its lead image from Wikimedia
// Commons. Only words that survived that script's checks appear in the map.
//
// There is deliberately no placeholder: a word with no suitable image renders nothing,
// so callers must handle a null return and hide their image UI entirely.

import type { ImageInfo } from '@georgian/shared/types';
import { imageMap } from '../content/store';

/** Anything with an id can be looked up — words, and the verb rows the export synthesises. */
interface Identified {
  id: string;
}

export function getWordImage(word: Identified | null | undefined): ImageInfo | null {
  if (!word || !word.id) return null;
  return imageMap()[word.id] || null;
}

export function hasWordImage(word: Identified | null | undefined): boolean {
  return getWordImage(word) !== null;
}

/**
 * Short credit string for the required CC/PD attribution.
 */
export function creditLine(image: ImageInfo | null | undefined): string {
  if (!image) return '';
  const parts: string[] = [];
  if (image.author) parts.push(image.author);
  if (image.license) parts.push(image.license);
  return parts.join(' · ');
}
