import type { Category } from '../types';
import { getCategoryImage } from '../utils/categoryImages';

// The picture that identifies a category. Decorative in every place it is used — the
// category name is always next to it — so the alt text is empty and screen readers skip
// straight to the heading.
//
// Categories without a resolved image fall back to their Georgian initial rather than an
// empty grey box, which keeps the grid readable if a build ever comes back short.
interface CategoryThumbProps {
  category: Category;
  className?: string;
}

function CategoryThumb({ category, className = '' }: CategoryThumbProps) {
  const image = getCategoryImage(category);
  const classes = `category-thumb ${className}`.trim();

  if (!image) {
    const initial = (category.nameGeorgian || category.name || '').trim().charAt(0);
    return (
      <span className={`${classes} category-thumb-letter`} aria-hidden="true">
        {initial}
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
      />
    </span>
  );
}

export default CategoryThumb;
