// One shelf: the stories filed under a category, and nothing else.
//
// The second half of the two-level browse the story index starts. It reads its list from the
// same `useShelves` the index does, so the count on the card and the stories behind it cannot
// drift apart — a shelf whose card says three stories opens on exactly those three.

import { Link, useParams } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from '@/components/ui/page';
import { StoryGrid, useShelves } from './StoryIndex';
import { lang } from '../content/store';

function StoryCategoryView() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const shelves = useShelves();
  const shelf = shelves.find(entry => entry.id === categoryId);

  // Covers a deleted category and an emptied one alike, and says the same thing about both,
  // because to a reader following a link they are the same thing: there is nothing here now.
  if (!shelf) {
    return (
      <Page>
        <Breadcrumb>
          <BreadcrumbLink to={`/${lang()}/stories`}>← Library</BreadcrumbLink>
        </Breadcrumb>
        <p className="py-6 text-center text-muted-foreground">
          There is nothing filed under that category.
        </p>
      </Page>
    );
  }

  return (
    <Page>
      <Breadcrumb>
        <BreadcrumbLink to={`/${lang()}/stories`}>← Library</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>{shelf.name}</span>
      </Breadcrumb>

      <header className="mb-6">
        <h1 className="mb-1.5 flex items-center gap-2.5 text-[26px] font-bold">
          <BookOpen className="size-[22px]" aria-hidden="true" />
          {shelf.name}
          {shelf.nameNative && (
            <span className="text-xl font-normal text-muted-foreground">{shelf.nameNative}</span>
          )}
        </h1>
        <p className="max-w-[62ch] text-muted-foreground">
          {shelf.note ||
            `${shelf.stories.length === 1 ? '1 story' : `${shelf.stories.length} stories`}, with every word linked back to the dictionary.`}
        </p>
      </header>

      <StoryGrid stories={shelf.stories} />

      <p className="mt-8 text-sm text-muted-foreground">
        <Link to={`/${lang()}/stories`}>← All categories</Link>
      </p>
    </Page>
  );
}

export default StoryCategoryView;
