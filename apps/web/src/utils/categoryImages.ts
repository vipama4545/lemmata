// Category images come from a map built by scripts/buildCategoryImages.cjs: one
// hand-picked Wikipedia article per category, whose lead image lives on Wikimedia
// Commons under a free licence.
//
// As with word images there is no placeholder — a category with no entry returns null
// and the UI falls back to a typographic tile.

import type { Category, ImageInfo } from '@georgian/shared/types';
import { categoryImageMap } from '../content/store';

/** @param category  category object or bare id */
export function getCategoryImage(
  category: Category | string | null | undefined,
): ImageInfo | null {
  const id = typeof category === 'string' ? category : category && category.id;
  if (!id) return null;
  return categoryImageMap()[id] || null;
}

export interface CategoryCredit {
  category: Category;
  image: ImageInfo;
}

/**
 * Pairs each category with its image, dropping the ones that have none. Used to render
 * the attribution list the CC licences require.
 */
export function categoryImageCredits(categories: Category[]): CategoryCredit[] {
  return categories
    .map(category => ({ category, image: getCategoryImage(category) }))
    .filter((entry): entry is CategoryCredit => entry.image !== null);
}
