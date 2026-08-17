// The round play button, and the one `<audio>` behind every one of them on a screen.
//
// Lifted out of QuizRunner when the lessons started drawing the same button beside a paragraph.
// Two copies of this would be two answers to "what happens when you press play while something
// else is playing", and they would drift the first time either was touched.
//
// What is *not* here is anything that knows where a sound comes from: this takes a URL. The
// quizzes build theirs in data/quizAudio.ts and the lessons in data/lessonMedia.ts, because
// what a URL means is a fact about the thing being played and not about the button.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * One `<audio>` for the whole screen, rather than one per button.
 *
 * A question with four spoken options is four play buttons, and four elements each holding a
 * decoded clip is four times the memory for a thing that is by definition played one at a
 * time. Pointing one element at a new source also stops whatever it was playing, which is the
 * behaviour wanted anyway: pressing option three while option two is still talking should
 * play option three.
 */
export function usePlayer(): { play: (src: string) => void; playing: string | null } {
  const element = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    const audio = new Audio();
    audio.addEventListener('ended', () => setPlaying(null));
    // A source that will not play is not worth reporting: the reader can see the button did
    // nothing, and a page must not break because one clip is missing.
    audio.addEventListener('error', () => setPlaying(null));
    element.current = audio;

    return () => {
      audio.pause();
      element.current = null;
    };
  }, []);

  const play = useCallback((src: string) => {
    const audio = element.current;
    if (!audio) return;

    // Re-pressing the button that is sounding restarts it rather than stopping it. Somebody
    // pressing play on a line they are half-way through hearing wants to hear it again.
    audio.pause();
    audio.src = src;
    setPlaying(src);
    void audio.play().catch(() => setPlaying(null));
  }, []);

  return { play, playing };
}

/** The round play button that appears wherever there is something to hear. */
export function PlayButton({
  src,
  playing,
  onPlay,
  big = false,
  label,
  className,
}: {
  src: string;
  playing: boolean;
  onPlay: (src: string) => void;
  big?: boolean;
  label: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant={playing ? 'controlOn' : 'control'}
      size={big ? 'auto' : 'icon-sm'}
      className={cn('rounded-full', big && 'gap-2.5 px-6 py-3.5', className)}
      aria-label={label}
      onClick={event => {
        // An option's play button sits inside the option's own button. Without this, playing
        // it would also answer the question.
        event.stopPropagation();
        // And a search result's sits inside the link to that word. `stopPropagation` alone is
        // not enough there: it keeps the click from reaching the Link's handler, and a Link
        // that never handles a click is an anchor the browser follows itself — so hearing a
        // word would navigate away from the list you are hearing it in.
        event.preventDefault();
        onPlay(src);
      }}
    >
      <Volume2 className={cn(big && 'size-5')} />
      {big && <span className="text-[15px] font-semibold">Play</span>}
    </Button>
  );
}
