// The video section, in a chunk of its own.
//
// Lazily loaded from App for the same reason the library and the admin screens are, and with
// one more: this branch pulls in YouTube's player at runtime, and a reader who never opens a
// video should never pay for the code that would ask for it.

import { Route, Routes } from 'react-router-dom';
import MyVideos from './MyVideos';
import VideoReader from './VideoReader';

export default function VideoRoutes() {
  return (
    <Routes>
      <Route index element={<MyVideos />} />
      {/* A story id, because a video story is a story. The reader fetches the prose through
          exactly the call the library reader uses, and the video beside it through one more. */}
      <Route path=":storyId" element={<VideoReader />} />
      <Route path="*" element={<MyVideos />} />
    </Routes>
  );
}
