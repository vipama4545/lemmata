import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { LevelFilter } from "@georgian/shared/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from "@/components/ui/page";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { SearchField } from "@/components/ui/search-field";
import { LevelBadge, MineTag, PosTag, WordCard, WordCardBody, WordCardTags } from "@/components/ui/word-card";
import { LevelTabs } from "@/components/ui/level-tabs";
import { lang, wordData as allData } from "../content/store";
import { useSpeaks, wordAudioUrl } from "../data/wordAudio";
import { focusHref } from "../utils/scroll";
import { useEntryState } from "../utils/entryState";
import { PlayButton, usePlayer } from "./AudioButton";

function WordSearch() {
  // The whole page is the search: leaving it and coming back to an empty box would throw
  // away the work of finding the word you then went to look at.
  const [searchTerm, setSearchTerm] = useEntryState("search", "");
  const [selectedLevel, setSelectedLevel] = useEntryState<LevelFilter>("level", "all");
  const [selectedCategory, setSelectedCategory] = useEntryState("category", "all");
  // One `<audio>` for the page, as the category list has. See usePlayer.
  const { play, playing } = usePlayer();
  const speaks = useSpeaks();

  // Every match rather than the first hundred. The cut used to be silent, so a word that was
  // in the dictionary could answer a search with nothing; paging is what makes showing them
  // all affordable, since only one page of cards is ever in the document.
  const results = useMemo(() => {
    if (!searchTerm.trim()) return [];
    const lower = searchTerm.toLowerCase();
    return allData()
      .words.filter((w) => {
        const matchesSearch =
          w.headword.toLowerCase().includes(lower) ||
          w.english.toLowerCase().includes(lower) ||
          (w.definition && w.definition.toLowerCase().includes(lower));
        const matchesLevel = selectedLevel === "all" || w.level === selectedLevel;
        const matchesCategory = selectedCategory === "all" || w.categoryId === selectedCategory;
        return matchesSearch && matchesLevel && matchesCategory;
      });
  }, [searchTerm, selectedLevel, selectedCategory]);

  const pager = usePagination(results, `${searchTerm}|${selectedLevel}|${selectedCategory}`);

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
          placeholder="Type to search…"
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
              {allData().categories.map((cat) => (
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
          {results.length} result{results.length !== 1 ? "s" : ""} found
        </p>
      )}

      <div className="flex flex-col gap-2">
        {pager.items.map((word) => {
          const audio = wordAudioUrl(word.id);
          return (
            <Link key={word.id} to={focusHref(`/category/${word.categoryId}`, word.id)}>
              <WordCard className="cursor-pointer">
                <WordCardTags>
                  <LevelBadge level={word.level} />
                  <PosTag>{word.partOfSpeech}</PosTag>
                  {/* A badge rather than a link to the editor, unlike the category page: this
                      whole row is already a link, and a link inside a link is not a thing a
                      browser can render. The row leads to the category, where the pencil is. */}
                  {word.mine && <MineTag />}
                </WordCardTags>
                <WordCardBody>
                  <span className="text-xl font-semibold">{word.headword}</span>
                  <span className="text-[15px] text-muted-foreground">{word.english}</span>
                  {word.definition && <span className="text-[13px] text-faint">{word.definition}</span>}
                </WordCardBody>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-faint">{word.category}</span>
                  {/* Inside the row's link, which is why PlayButton stops the click as well as
                      swallowing it: hearing a word must not also open it. */}
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
            </Link>
          );
        })}
      </div>

      <Pagination pager={pager} noun="words" />

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
