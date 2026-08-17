// One shelf: the quizzes filed under a category, and nothing else.
//
// The second half of the two-level browse the quiz index starts, and it reads its list from the
// same `useQuizShelves` the index does — so a shelf whose heading says four quizzes opens on
// exactly those four.

import { Link, useParams } from 'react-router-dom';
import { ListChecks } from 'lucide-react';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from '@/components/ui/page';
import { lang } from '../content/store';
import { QuizGrid, useQuizResults, useQuizShelves } from './QuizIndex';

function QuizCategoryView() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const shelves = useQuizShelves();
  const results = useQuizResults();
  const shelf = shelves.find(entry => entry.id === categoryId);

  // Covers a deleted category and an emptied one alike, and says the same thing about both,
  // because to a reader following a link they are the same thing: there is nothing here now.
  if (!shelf) {
    return (
      <Page>
        <Breadcrumb>
          <BreadcrumbLink to={`/${lang()}/quizzes`}>← Quizzes</BreadcrumbLink>
        </Breadcrumb>
        <p className="py-6 text-center text-muted-foreground">There is nothing filed under that category.</p>
      </Page>
    );
  }

  return (
    <Page>
      <Breadcrumb>
        <BreadcrumbLink to={`/${lang()}/quizzes`}>← Quizzes</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>{shelf.name}</span>
      </Breadcrumb>

      <header className="mb-6">
        <h1 className="mb-1.5 flex items-center gap-2.5 text-[26px] font-bold">
          <ListChecks className="size-[22px]" aria-hidden="true" />
          {shelf.name}
          {shelf.nameNative && <span className="text-xl font-normal text-muted-foreground">{shelf.nameNative}</span>}
        </h1>
        <p className="max-w-[62ch] text-muted-foreground">
          {shelf.note || `${shelf.quizzes.length === 1 ? '1 quiz' : `${shelf.quizzes.length} quizzes`}.`}
        </p>
      </header>

      <QuizGrid quizzes={shelf.quizzes} results={results} />

      <p className="mt-8 text-sm text-muted-foreground">
        <Link to={`/${lang()}/quizzes`}>← All categories</Link>
      </p>
    </Page>
  );
}

export default QuizCategoryView;
