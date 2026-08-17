// Every admin screen, in one chunk.
//
// This module exists to be lazy-loaded. The editors are a fair amount of code — a paradigm
// grid, a word form, a story linker's report — and almost nobody who opens this app is an
// admin, so shipping it to everyone would put weight in the first paint for a section they
// will never reach. `App` imports it through `React.lazy`, which puts the whole of it behind
// one request made only when /admin is opened.
//
// The routes are nested under /admin/* rather than listed in App, so adding a screen here
// does not mean touching the router as well.

import { Route, Routes } from 'react-router-dom';
import { AdminHome, StoryList, UserList, VerbList, WordList } from './AdminHome';
import ChapterEditor from './ChapterEditor';
import LessonCategoryList from './LessonCategoryList';
import LessonEditor from './LessonEditor';
import LessonList from './LessonList';
import QuizCategoryList from './QuizCategoryList';
import QuizEditor from './QuizEditor';
import QuizList from './QuizList';
import RuVerbEditor from './RuVerbEditor';
import StoryCategoryList from './StoryCategoryList';
import StoryEditor from './StoryEditor';
import VerbEditor from './VerbEditor';
import WordEditor from './WordEditor';
import { verbKind } from '../content/store';

/**
 * Whichever verb editor the loaded dictionary calls for.
 *
 * The reader forks the same way at `VerbPage` in App.tsx, and the reason is the same twice
 * over: a Georgian paradigm is 66 stored cells and a Russian one is a rule that generates
 * about twenty-five, so the two screens have neither a shape nor a payload in common. One
 * route, because "the verb editor" is one idea however many tables are behind it.
 */
function VerbEditorPage() {
  return verbKind() === 'ru' ? <RuVerbEditor /> : <VerbEditor />;
}

export default function AdminRoutes() {
  return (
    <Routes>
      <Route index element={<AdminHome />} />
      <Route path="words" element={<WordList />} />
      <Route path="words/new" element={<WordEditor />} />
      <Route path="words/:wordId" element={<WordEditor />} />
      <Route path="verbs" element={<VerbList />} />
      <Route path="verbs/new" element={<VerbEditorPage />} />
      <Route path="verbs/:verbId" element={<VerbEditorPage />} />
      <Route path="stories" element={<StoryList />} />
      <Route path="stories/new" element={<StoryEditor />} />
      <Route path="stories/:storyId" element={<StoryEditor />} />
      {/* "new" before ":position" is only documentation — React Router ranks a static
          segment above a dynamic one regardless of the order they are written in. */}
      <Route path="stories/:storyId/chapters/new" element={<ChapterEditor />} />
      <Route path="stories/:storyId/chapters/:position" element={<ChapterEditor />} />
      <Route path="story-categories" element={<StoryCategoryList />} />
      <Route path="quizzes" element={<QuizList />} />
      {/* As above, "new" before ":quizId" is documentation: React Router ranks a static
          segment above a dynamic one whatever order they are written in. */}
      <Route path="quizzes/new" element={<QuizEditor />} />
      <Route path="quizzes/:quizId" element={<QuizEditor />} />
      <Route path="quiz-categories" element={<QuizCategoryList />} />
      <Route path="lessons" element={<LessonList />} />
      {/* As above, "new" before ":lessonId" is documentation: React Router ranks a static
          segment above a dynamic one whatever order they are written in. */}
      <Route path="lessons/new" element={<LessonEditor />} />
      <Route path="lessons/:lessonId" element={<LessonEditor />} />
      <Route path="lesson-categories" element={<LessonCategoryList />} />
      <Route path="users" element={<UserList />} />
    </Routes>
  );
}
