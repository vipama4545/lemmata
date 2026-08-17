// The reader's own section, in a chunk of its own.
//
// Lazily loaded from App for the same reason the admin screens are: these are forms, and forms
// are a fair amount of code for a section that most visits never open. Somebody reading a story
// downloads none of it.

import { Route, Routes } from 'react-router-dom';
import ChapterForm from './ChapterForm';
import MyLibrary from './MyLibrary';
import StoryForm from './StoryForm';
import WordForm from './WordForm';

export default function LibraryRoutes() {
  return (
    <Routes>
      <Route index element={<MyLibrary />} />

      {/* "new" as a literal segment rather than an absent one, so the two forms are told apart
          in a URL bar, and so a story whose slug came out as "new" cannot be mistaken for the
          creation screen. `freeId` mints ids from titles, so that is a real possibility. */}
      <Route path="stories/new" element={<StoryForm />} />
      <Route path="stories/:storyId" element={<StoryForm />} />
      <Route path="stories/:storyId/chapters/new" element={<ChapterForm />} />
      <Route path="stories/:storyId/chapters/:position" element={<ChapterForm />} />

      <Route path="words/new" element={<WordForm />} />
      <Route path="words/:wordId" element={<WordForm />} />

      {/* Anything else under /library is the library. Better than a dead page for a stale link
          into a section this small. */}
      <Route path="*" element={<MyLibrary />} />
    </Routes>
  );
}
