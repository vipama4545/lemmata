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
import StoryCategoryList from './StoryCategoryList';
import StoryEditor from './StoryEditor';
import VerbEditor from './VerbEditor';
import WordEditor from './WordEditor';

export default function AdminRoutes() {
  return (
    <Routes>
      <Route index element={<AdminHome />} />
      <Route path="words" element={<WordList />} />
      <Route path="words/new" element={<WordEditor />} />
      <Route path="words/:wordId" element={<WordEditor />} />
      <Route path="verbs" element={<VerbList />} />
      <Route path="verbs/new" element={<VerbEditor />} />
      <Route path="verbs/:verbId" element={<VerbEditor />} />
      <Route path="stories" element={<StoryList />} />
      <Route path="stories/new" element={<StoryEditor />} />
      <Route path="stories/:storyId" element={<StoryEditor />} />
      {/* "new" before ":position" is only documentation — React Router ranks a static
          segment above a dynamic one regardless of the order they are written in. */}
      <Route path="stories/:storyId/chapters/new" element={<ChapterEditor />} />
      <Route path="stories/:storyId/chapters/:position" element={<ChapterEditor />} />
      <Route path="story-categories" element={<StoryCategoryList />} />
      <Route path="users" element={<UserList />} />
    </Routes>
  );
}
