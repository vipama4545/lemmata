import { useState, useMemo } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { Eye, EyeOff, Image as ImageIcon, Pencil } from 'lucide-react';
import type { LevelFilter, Word } from '@georgian/shared/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LevelTabs } from '@/components/ui/level-tabs';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from '@/components/ui/page';
import { PAGE_SIZE, Pagination, usePagination } from '@/components/ui/pagination';
import { SearchField } from '@/components/ui/search-field';
import { LevelBadge, MineTag, PosTag, WordCard, WordCardBody, WordCardTags } from '@/components/ui/word-card';
import { lang, wordData as allData } from '../content/store';
import { useSpeaks, wordAudioUrl } from '../data/wordAudio';
import { getWordImage, creditLine } from '../utils/images';
import { focusId } from '../utils/scroll';
import { useEntryState } from '../utils/entryState';
import { PlayButton, usePlayer } from './AudioButton';
import CategoryThumb from './CategoryThumb';

/** What the category cards on the browse page hand over in the link's router state. */
interface CategoryViewState {
  level?: LevelFilter;
  search?: string;
}

function CategoryView() {
  const { categoryId } = useParams();
  const location = useLocation();
  const state = location.state as CategoryViewState | null;
  const levelFilter = state?.level || 'all';
  const searchFilter = state?.search || '';
  // The word a link sent us here for, if any. It stays marked rather than flashing and
  // fading: the scroll was instant, so a flash would be over before the eye found it, and
  // a list of near-identical rows is exactly where you want to be shown which one is yours.
  const focusedWord = focusId(location.search);

  // Seeded from the browse page's filters, then remembered per history entry, so that
  // coming back from a word lands on the list you narrowed rather than the whole category.
  const [localLevel, setLocalLevel] = useEntryState<LevelFilter>('level', levelFilter);
  const [localSearch, setLocalSearch] = useEntryState('search', searchFilter);
  const [showTranslation, setShowTranslation] = useState(true);
  // One `<audio>` for the page rather than one per row: a category is fifty headwords and they
  // are by definition heard one at a time. See usePlayer.
  const { play, playing } = usePlayer();
  const speaks = useSpeaks();
  // The word whose picture is open, rather than its position in the list: the list is now one
  // page of a longer one, and a position in it stops meaning the same word as soon as the
  // reader turns a page.
  const [imageWord, setImageWord] = useState<Word | null>(null);

  const category = allData().categories.find(c => c.id === categoryId);
  const categoryWords = allData().words.filter(w => w.categoryId === categoryId);

  const filteredWords = useMemo(() => {
    return categoryWords.filter(w => {
      const matchesLevel = localLevel === 'all' || w.level === localLevel;
      const matchesSearch = !localSearch ||
        w.headword.toLowerCase().includes(localSearch.toLowerCase()) ||
        w.english.toLowerCase().includes(localSearch.toLowerCase());
      return matchesLevel && matchesSearch;
    });
  }, [categoryWords, localLevel, localSearch]);

  // A link that names a word — a search result, a word in a story, the day's word — has to
  // open on the page that word is on. ScrollManager looks for the row in the DOM, and a row
  // eight pages down was never rendered for it to find.
  const focusPage = useMemo(() => {
    if (!focusedWord) return 1;
    const at = filteredWords.findIndex(word => word.id === focusedWord);
    return at < 0 ? 1 : Math.floor(at / PAGE_SIZE) + 1;
  }, [filteredWords, focusedWord]);

  const pager = usePagination(filteredWords, `${localLevel}|${localSearch}`, { initialPage: focusPage });

  if (!category) {
    return (
      <Page>
        <div className="py-10 text-center">
          <h2 className="mb-2 text-2xl font-bold">Category not found</h2>
          <Link to={`/${lang()}/categories`} className="text-primary hover:underline">
            ← Back to categories
          </Link>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <Breadcrumb>
        <BreadcrumbLink to={`/${lang()}/categories`}>← Categories</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>{category.name}</span>
      </Breadcrumb>

      <div className="mb-6 flex items-center gap-4.5">
        <CategoryThumb category={category} size="sm" />
        <div>
          <h1 className="mb-1 text-[28px] font-bold">{category.name}</h1>
          <p className="text-sm text-faint">{category.nameNative}</p>
          <span className="font-medium text-primary">{filteredWords.length} words</span>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-4 max-md:flex-col max-md:*:w-full">
        <SearchField
          placeholder="Filter words…"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
        />
        <LevelTabs value={localLevel} onChange={setLocalLevel} />
        <Button variant="control" size="auto" onClick={() => setShowTranslation(!showTranslation)}>
          {showTranslation ? <EyeOff /> : <Eye />}
          {showTranslation ? 'Hide translations' : 'Show translations'}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {pager.items.map(word => {
          const audio = wordAudioUrl(word.id);
          return (
            <WordCard key={word.id} data-focus={word.id} focused={word.id === focusedWord}>
              <WordCardTags>
                <LevelBadge level={word.level} />
                <PosTag>{word.partOfSpeech}</PosTag>
                {word.mine && <MineTag />}
              </WordCardTags>
              <WordCardBody>
                <span className="text-xl font-semibold">{word.headword}</span>
                {showTranslation && (
                  <span className="text-[15px] text-muted-foreground">{word.english}</span>
                )}
              </WordCardBody>
              {/* The play button comes last because it is the one that is always there: a
                  picture is the exception, so hanging it off the left of the button keeps the
                  buttons themselves in a straight column down the page. Ordering them the
                  other way round would step the play button left on every row that has a
                  picture, which is most of a category like Food & Drink and none of one like
                  Qualities. */}
              <div className="flex shrink-0 items-center gap-1">
                {/* Only on your own entries, and the only way into the editor from a page of
                    words, which is where somebody notices a gloss of theirs is wrong. The
                    dictionary's own rows have no such button for anybody. */}
                {word.mine && (
                  <Link
                    to={`/${lang()}/library/words/${encodeURIComponent(word.id)}`}
                    className="inline-flex p-1 text-muted-foreground opacity-60 transition-opacity hover:opacity-100"
                    title="Edit this word of yours"
                    aria-label={`Edit ${word.headword}`}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </Link>
                )}
                {getWordImage(word) && (
                  <button
                    className="inline-flex cursor-pointer p-1 text-muted-foreground opacity-60 transition-opacity hover:opacity-100"
                    onClick={() => setImageWord(word)}
                    title="Show image"
                    aria-label={`Show image for ${word.english}`}
                  >
                    <ImageIcon className="size-5" aria-hidden="true" />
                  </button>
                )}
                {/* Drawn only where there is a voice for this dictionary — see useSpeaks. The
                    accented spelling is what Russian is read from, which is a fact about the
                    row and stays on the server; this end knows only the word's id. */}
                {speaks && (
                  <PlayButton
                    src={audio}
                    playing={playing === audio}
                    onPlay={play}
                    label={`Play ${word.headword}`}
                  />
                )}
              </div>
            </WordCard>
          );
        })}
      </div>

      <Pagination pager={pager} noun="words" />

      <WordImageDialog word={imageWord} onClose={() => setImageWord(null)} />
    </Page>
  );
}

function WordImageDialog({ word, onClose }: { word: Word | null; onClose: () => void }) {
  const image = word && getWordImage(word);

  return (
    <Dialog open={word !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[500px] gap-0 rounded-lg p-6">
        {word && (
          <>
            <DialogHeader className="text-left">
              <DialogTitle className="text-lg">
                {word.headword} — {word.english}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Picture and full definition for {word.english}
              </DialogDescription>
            </DialogHeader>
            {image && (
              <figure className="my-4 overflow-hidden rounded-sm">
                <img
                  src={image.url}
                  alt={word.english}
                  loading="lazy"
                  className="block h-auto max-h-80 w-full object-contain"
                />
                {/* Attribution required by the CC licences the Wikimedia images are published under. */}
                <figcaption className="px-0.5 pt-1.5 text-center text-[11px] leading-snug wrap-anywhere text-faint [&_a]:underline">
                  <a href={image.page} target="_blank" rel="noopener noreferrer">
                    {image.title}
                  </a>
                  {creditLine(image) && <> · {creditLine(image)}</>}
                </figcaption>
              </figure>
            )}
            <p className="mt-3 text-sm text-muted-foreground">{word.definition}</p>
            {word.englishFull.length > 1 && (
              <div className="mt-3 text-sm">
                <strong>All meanings:</strong>
                <ul className="list-disc pl-5">
                  {word.englishFull.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default CategoryView;
