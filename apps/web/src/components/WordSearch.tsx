import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { LevelFilter } from '@georgian/shared/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from '@/components/ui/page';
import { SearchField } from '@/components/ui/search-field';
import { LevelBadge, PosTag, WordCard, WordCardBody, WordCardTags } from '@/components/ui/word-card';
import { LevelTabs } from "@/components/ui/level-tabs";
import { lang, wordData as allData } from '../content/store';
import { focusHref } from '../utils/scroll';
import { useEntryState } from '../utils/entryState';

function WordSearch() {
  // The whole page is the search: leaving it and coming back to an empty box would throw
  // away the work of finding the word you then went to look at.
  const [searchTerm, setSearchTerm] = useEntryState('search', '');
  const [selectedLevel, setSelectedLevel] = useEntryState<LevelFilter>('level', 'all');
  const [selectedCategory, setSelectedCategory] = useEntryState('category', 'all');

  const results = useMemo(() => {
    if (!searchTerm.trim()) return [];
    const lower = searchTerm.toLowerCase();
    return allData().words
      .filter(w => {
        const matchesSearch = w.headword.toLowerCase().includes(lower) ||
          w.english.toLowerCase().includes(lower) ||
          (w.definition && w.definition.toLowerCase().includes(lower));
        const matchesLevel = selectedLevel === 'all' || w.level === selectedLevel;
        const matchesCategory = selectedCategory === 'all' || w.categoryId === selectedCategory;
        return matchesSearch && matchesLevel && matchesCategory;
      })
      .slice(0, 100);
  }, [searchTerm, selectedLevel, selectedCategory]);

  return (
    <Page>
      <Breadcrumb>
        <BreadcrumbLink to={`/${lang()}`}>← Home</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>Word Search</span>
      </Breadcrumb>

      <h2 className="mb-4 text-2xl font-bold">Word Search</h2>

      <div className="mb-5">
        <SearchField
          large
          placeholder="Type in Georgian or English…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          autoFocus
        />
        <div className="mt-3 flex flex-wrap gap-4">
          <LevelTabs value={selectedLevel} onChange={setSelectedLevel} />
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="h-auto flex-1 rounded-sm border-2 border-border bg-card py-2 text-sm shadow-none data-[size=default]:h-auto">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {allData().categories.map(cat => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {searchTerm && (
        <p className="mb-3 text-sm text-muted-foreground">
          {results.length} result{results.length !== 1 ? 's' : ''} found
        </p>
      )}

      <div className="flex flex-col gap-2">
        {results.map((word) => (
          <Link key={word.id} to={focusHref(`/category/${word.categoryId}`, word.id)}>
            <WordCard className="cursor-pointer">
              <WordCardTags>
                <LevelBadge level={word.level} />
                <PosTag>{word.partOfSpeech}</PosTag>
              </WordCardTags>
              <WordCardBody>
                <span className="text-xl font-semibold">{word.headword}</span>
                <span className="text-[15px] text-muted-foreground">{word.english}</span>
                {word.definition && (
                  <span className="text-[13px] text-faint">{word.definition}</span>
                )}
              </WordCardBody>
              <div className="flex shrink-0 items-center">
                <span className="text-xs text-faint">{word.category}</span>
              </div>
            </WordCard>
          </Link>
        ))}
      </div>

      {!searchTerm && (
        <div className="px-5 py-15 text-center text-faint">
          <p>Start typing to search across all {allData().words.length} Georgian words...</p>
          <p className="mt-2 text-[13px]">You can search in Georgian (₾) or English alphabets</p>
        </div>
      )}
    </Page>
  );
}

export default WordSearch;
