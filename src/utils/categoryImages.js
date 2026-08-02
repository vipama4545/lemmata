// Category images come from a map built by scripts/buildCategoryImages.cjs: one
// hand-picked Wikipedia article per category, whose lead image lives on Wikimedia
// Commons under a free licence.
//
// As with word images there is no placeholder — a category with no entry returns null
// and the UI falls back to a typographic tile.

import categoryImageMap from '../data/categoryImages.json';

/**
 * @param {{id: string} | string} category  category object or bare id
 * @returns {{url: string, width: number, height: number, title: string,
 *            page: string, author: string, license: string, licenseUrl: string} | null}
 */
export function getCategoryImage(category) {
  const id = typeof category === 'string' ? category : category && category.id;
  if (!id) return null;
  return categoryImageMap[id] || null;
}

/**
 * Pairs each category with its image, dropping the ones that have none. Used to render
 * the attribution list the CC licences require.
 *
 * @param {Array<{id: string, name: string}>} categories
 */
export function categoryImageCredits(categories) {
  return categories
    .map(category => ({ category, image: getCategoryImage(category) }))
    .filter(entry => entry.image !== null);
}
