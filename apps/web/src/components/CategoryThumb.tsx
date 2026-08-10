import type { Category } from '@georgian/shared/types';
import { cn } from '@/lib/utils';
import { getCategoryImage } from '../utils/categoryImages';

// The picture that identifies a category. Decorative in every place it is used — the
// category name is always next to it — so the alt text is empty and screen readers skip
// straight to the heading.
//
// Categories without a resolved image fall back to their Georgian initial rather than an
// empty grey box, which keeps the grid readable if a build ever comes back short.

/** How much room the tile has: the top of a card, beside a heading, or inside a list row. */
type ThumbSize = 'card' | 'sm' | 'xs';

const SIZE: Record<ThumbSize, string> = {
  card: 'aspect-[4/3]',
  sm: 'aspect-square w-[72px] flex-none rounded-sm',
  xs: 'aspect-square w-7 flex-none rounded-[6px]',
};

/** The initial has to shrink with the tile or it overflows the two small ones. */
const LETTER_SIZE: Record<ThumbSize, string> = {
  card: 'text-[42px]',
  sm: 'text-[30px]',
  xs: 'text-sm',
};

interface CategoryThumbProps {
  category: Category;
  size?: ThumbSize;
  className?: string;
}

function CategoryThumb({ category, size = 'card', className }: CategoryThumbProps) {
  const image = getCategoryImage(category);
  const classes = cn('block overflow-hidden bg-muted', SIZE[size], className);

  if (!image) {
    return (
      <span
        className={cn(classes, 'flex items-center justify-center bg-primary-light font-semibold text-faint', LETTER_SIZE[size])}
        aria-hidden="true"
      >
        {(category.nameNative || category.name || '').trim().charAt(0)}
      </span>
    );
  }

  return (
    <span className={classes}>
      <img
        src={image.url}
        alt=""
        loading="lazy"
        width={image.width}
        height={image.height}
        // The `group` is the category card in App.tsx; the ease under the cursor is the only
        // thing on that tile that says it is a link.
        className="block size-full object-cover transition-transform duration-350 group-hover:scale-[1.04]"
      />
    </span>
  );
}

export default CategoryThumb;
