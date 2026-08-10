import { useState, useMemo } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { Eye, EyeOff, Image as ImageIcon } from 'lucide-react';
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
import { SearchField } from '@/components/ui/search-field';
import { LevelBadge, PosTag, WordCard, WordCardBody, WordCardTags } from '@/components/ui/word-card';
import { lang, wordData as allData } from '../content/store';
import { getWordImage, creditLine } from '../utils/images';
import { focusId } from '../utils/scroll';
import { useEntryState } from '../utils/entryState';
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
  const [currentWordIndex, setCurrentWordIndex] = useState<number | null>(null);

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
        {filteredWords.map((word, idx) => (
          <WordCard key={word.id} data-focus={word.id} focused={word.id === focusedWord}>
            <WordCardTags>
              <LevelBadge level={word.level} />
              <PosTag>{word.partOfSpeech}</PosTag>
            </WordCardTags>
            <WordCardBody>
              <span className="text-xl font-semibold">{word.headword}</span>
              {showTranslation && (
                <span className="text-[15px] text-muted-foreground">{word.english}</span>
              )}
            </WordCardBody>
            <div className="flex shrink-0 items-center">
              {getWordImage(word) && (
                <button
                  className="inline-flex cursor-pointer p-1 text-muted-foreground opacity-60 transition-opacity hover:opacity-100"
                  onClick={() => setCurrentWordIndex(idx)}
                  title="Show image"
                  aria-label={`Show image for ${word.english}`}
                >
                  <ImageIcon className="size-5" aria-hidden="true" />
                </button>
              )}
            </div>
          </WordCard>
        ))}
      </div>

      <WordImageDialog
        word={currentWordIndex === null ? null : filteredWords[currentWordIndex]}
        onClose={() => setCurrentWordIndex(null)}
      />
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
