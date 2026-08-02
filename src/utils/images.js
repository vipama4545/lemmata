// Word images come from a pre-resolved map built by scripts/buildImageData.cjs, which
// matches each word to a Wikipedia article and takes its lead image from Wikimedia
// Commons. Only words that survived that script's checks appear in the map.
//
// There is deliberately no placeholder: a word with no suitable image renders nothing,
// so callers must handle a null return and hide their image UI entirely.

import imageMap from '../data/images.json';

/**
 * @param {{id: string}} word
 * @returns {{url: string, width: number, height: number, title: string,
 *            page: string, author: string, license: string, licenseUrl: string} | null}
 */
export function getWordImage(word) {
  if (!word || !word.id) return null;
  return imageMap[word.id] || null;
}

export function hasWordImage(word) {
  return getWordImage(word) !== null;
}

/**
 * Short credit string for the required CC/PD attribution.
 */
export function creditLine(image) {
  if (!image) return '';
  const parts = [];
  if (image.author) parts.push(image.author);
  if (image.license) parts.push(image.license);
  return parts.join(' · ');
}
