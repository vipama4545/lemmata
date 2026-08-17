// One shelf: the lessons filed under a category, and nothing else.
//
// The second half of the two-level browse each index starts, and it reads its list from the
// same `useLessonShelves` the index does — so a shelf whose heading says four lessons opens on
// exactly those four. One component for both sections, as the index is.

import { Link, useParams } from 'react-router-dom';
import type { LessonSection } from '@georgian/shared/types';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from '@/components/ui/page';
import { lang } from '../content/store';
import { LessonGrid, SECTIONS, useLessonShelves, usePassedQuizzes } from './LessonIndex';

export default function LessonCategoryView({ section }: { section: LessonSection }) {
  const { categoryId } = useParams<{ categoryId: string }>();
  const shelves = useLessonShelves(section);
  const passed = usePassedQuizzes();
  const shelf = shelves.find(entry => entry.id === categoryId);
  const { label, path, icon: Icon } = SECTIONS[section];
  const home = `/${lang()}/${path}`;

  // Covers a deleted category and an emptied one alike, and says the same thing about both,
  // because to a reader following a link they are the same thing: there is nothing here now.
  if (!shelf) {
    return (
      <Page>
        <Breadcrumb>
          <BreadcrumbLink to={home}>← {label}</BreadcrumbLink>
        </Breadcrumb>
        <p className="py-6 text-center text-muted-foreground">There is nothing filed under that category.</p>
      </Page>
    );
  }

  return (
    <Page>
      <Breadcrumb>
        <BreadcrumbLink to={home}>← {label}</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>{shelf.name}</span>
      </Breadcrumb>

      <header className="mb-6">
        <h1 className="mb-1.5 flex items-center gap-2.5 text-[26px] font-bold">
          <Icon className="size-[22px]" aria-hidden="true" />
          {shelf.name}
          {shelf.nameNative && <span className="text-xl font-normal text-muted-foreground">{shelf.nameNative}</span>}
        </h1>
        <p className="max-w-[62ch] text-muted-foreground">
          {shelf.note || `${shelf.lessons.length === 1 ? '1 lesson' : `${shelf.lessons.length} lessons`}.`}
        </p>
      </header>

      <LessonGrid lessons={shelf.lessons} passed={passed} />

      <p className="mt-8 text-sm text-muted-foreground">
        <Link to={home}>← All categories</Link>
      </p>
    </Page>
  );
}
