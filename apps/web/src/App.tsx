import { useState, useMemo, useEffect, useCallback, lazy, Suspense } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { HashRouter, Routes, Route, Link, Navigate, useLocation, useParams } from "react-router-dom";
import type { Category, LevelFilter } from "@georgian/shared/types";
import CategoryView from "./components/CategoryView";
import FlashcardMode from "./components/FlashcardMode";
import ExportAnki from "./components/ExportAnki";
import WordSearch from "./components/WordSearch";
import CategoryThumb from "./components/CategoryThumb";
import VerbList from "./components/VerbList";
import VerbDetail from "./components/VerbDetail";
import WordOfTheDay from "./components/WordOfTheDay";
import StoryIndex from "./components/StoryIndex";
import StoryCategoryView from "./components/StoryCategoryView";
import StoryReader from "./components/StoryReader";
import QuizIndex from "./components/QuizIndex";
import QuizCategoryView from "./components/QuizCategoryView";
import QuizPage from "./components/QuizPage";
import LessonIndex from "./components/LessonIndex";
import LessonCategoryView from "./components/LessonCategoryView";
import LessonPage from "./components/LessonPage";
import Sidebar from "./components/Sidebar";
import ScrollManager from "./components/ScrollManager";
import Account from "./components/Account";
import { Menu, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from "@/components/ui/page";
import { LevelTabs } from "@/components/ui/level-tabs";
import { SearchField } from "@/components/ui/search-field";
import { AdminGate } from "./admin/AdminHome";
import { categoryImageCredits } from "./utils/categoryImages";
import { content, useContent, lang, wordData as allData } from "./content/store";
import { useLibrarySync } from "./library/store";
import { isLang } from "@georgian/shared/grammar";
import RuVerbDetail from "./components/RuVerbDetail";
import RuVerbList from "./components/RuVerbList";
import LanguageSwitcher from "./components/LanguageSwitcher";

// Verbs come from the conjugation spreadsheet rather than the scraped dictionary, so they
// are their own category rather than an entry in words.json. It carries no CEFR level,
// which is why the card drops out whenever a level filter is on.
const VERB_CATEGORY: Category = {
  id: "verbs",
  lang: "ka",
  name: "Verbs",
  nameNative: "ზმნები",
  // Never read. `Category` requires the field, but this card renders `verbMatches` — the
  // count after the current search — rather than a fixed total, so there is nothing to put
  // here that would ever be shown.
  wordCount: 0,
};

const AdminRoutes = lazy(() => import("./admin/AdminRoutes"));

// The reader's own stories and words. In a chunk of its own for the reason the admin screens
// are: forms are a fair amount of code, and most visits never open one.
const LibraryRoutes = lazy(() => import("./library/LibraryRoutes"));

function useTheme() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  const toggle = () => setDark((prev) => !prev);
  return { dark, toggle };
}

/**
 * Whichever verb page the loaded dictionary calls for.
 *
 * A component rather than a branch in the route table, because the route has to exist before
 * anything knows which language is loaded — and because the two pages take the same URL.
 * The narrowing itself lives in the two components; this only picks one.
 */
function VerbPage() {
  return content().verbs.kind === "ru" ? <RuVerbDetail /> : <VerbDetail />;
}

/**
 * The home page — but only if that first segment really is a language.
 *
 * `/:lang` is a single-segment pattern and matches anything, so a bare `/verbs` lands here
 * with `lang="verbs"` and would render the word of the day rather than the verb list. React
 * Router has no way to constrain a param to a set, so the check is here: anything that is not
 * a language is an unprefixed path, and goes where the catch-all would have sent it.
 */
function LangHome() {
  const { lang: segment } = useParams<{ lang: string }>();
  if (!isLang(segment)) return <Navigate to={`/${lang()}/${segment ?? ""}`} replace />;
  return <WordOfTheDay />;
}

/** The verb index, likewise. Georgian filters by conjugation group, Russian by aspect. */
function VerbsPage() {
  return content().verbs.kind === "ru" ? <RuVerbList /> : <VerbList />;
}

/**
 * Sends an unprefixed path into the current language.
 *
 * Every internal link in this app was written before languages existed and still says
 * `/verbs`, `/stories/three-little-pigs` and so on. Rewriting all of them to interpolate a
 * language would have touched a dozen components to say the same thing each time, and would
 * have made every future link a chance to forget. This says it once: a path that names no
 * language means the one already loaded, so `/verbs` lands on `/ka/verbs` for a Georgian
 * reader and `/ru/verbs` for a Russian one — which is what those links always meant.
 *
 * Old bookmarks keep working for the same reason, which is the other half of why it is a
 * redirect rather than a rename.
 */
function RedirectToLang() {
  const { pathname, search } = useLocation();

  // A path that already names a language got here because nothing matched *after* the
  // language — `/ru/nonsense`. Prefixing again would give `/ru/ru/nonsense`, which also
  // matches nothing, which redirects again: the one way this component can hang the tab.
  // So an unknown page inside a language goes to that language's home instead.
  const first = pathname.split("/")[1];
  if (isLang(first)) return <Navigate to={`/${first}`} replace />;

  return <Navigate to={`/${lang()}${pathname}${search}`} replace />;
}

/**
 * The same redirect, but *above* the router rather than as its fallback.
 *
 * `RedirectToLang` on the catch-all cannot do this job alone, and the reason is worth
 * writing down because it is invisible until it bites. React Router ranks routes by
 * specificity rather than by order, and a static segment outranks a dynamic one — so
 * `/admin/stories/new` is a perfectly good match for `/:lang/stories/:storyId` with `:lang`
 * set to "admin". It scores 16 and the catch-all scores 0, so the reader renders and
 * reports that there is no story called "new", which is true and useless.
 *
 * Every link written before languages existed is in that position whenever its first
 * segment happens to be some route's second: /admin/stories, /admin/verbs, /category/verbs.
 * The admin section is where it hurts, because half of it is reached by exactly those paths.
 *
 * So the question "does this path name a language" is asked before the ranking, where it
 * cannot lose to it. It is a render-time redirect rather than an effect, so the page it
 * would otherwise have matched never mounts and never fetches anything.
 */
function LangGate({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();

  const first = pathname.split("/")[1];
  if (first && !isLang(first)) return <Navigate to={`/${lang()}${pathname}${search}`} replace />;

  return <>{children}</>;
}

function App() {
  const { dark, toggle } = useTheme();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLevel, setSelectedLevel] = useState<LevelFilter>("all");
  // Only used below 1024px, where the sidebar is a drawer rather than a column. The close
  // callback is stable because the sidebar hangs an escape-key listener off it.
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = useCallback(() => setNavOpen(false), []);

  // Re-renders the whole tree when the dictionary is replaced — which now happens whenever an
  // admin saves something. Every screen below reads the content synchronously, so one
  // subscription at the top is all it takes for an edit to reach the one showing that word.
  useContent();

  // And fetches this reader's own stories and words on top of it, again whenever the session or
  // the language changes. One call, mounted once: everything below reads the two as one object.
  useLibrarySync();

  const { categories, words } = allData();

  // One pass over the dictionary, tallying into a map, rather than a scan of all of it per
  // category. The nested version read better but did 45 x 4,083 = 183,735 comparisons for
  // every keystroke — and a `toLowerCase()` allocation inside all of them, since the same word
  // was lowercased again for each category it did not belong to. That was 72ms a keystroke on
  // a mid-range phone, which is a filter you can feel lagging behind your typing. This is the
  // same answer in 4,083 comparisons and one `toLowerCase()` per word.
  const filteredCategories = useMemo(() => {
    if (!searchTerm && selectedLevel === "all") return categories;
    const lowerSearch = searchTerm.toLowerCase();

    const counts = new Map<string, number>();
    for (const w of words) {
      if (selectedLevel !== "all" && w.level !== selectedLevel) continue;
      // Georgian has no case, so the headword is compared as it is; the gloss is English and
      // has to be folded. Same test as before, just not repeated per category.
      if (searchTerm && !w.headword.includes(lowerSearch) && !w.english.toLowerCase().includes(lowerSearch)) continue;
      counts.set(w.categoryId, (counts.get(w.categoryId) ?? 0) + 1);
    }

    // `wordCount` is the count after the filter rather than the category's total, which is what
    // the card shows and why this rebuilds the objects instead of returning the rows as they are.
    return categories
      .filter((cat) => counts.has(cat.id))
      .map((cat) => ({ ...cat, wordCount: counts.get(cat.id)! }));
  }, [categories, words, searchTerm, selectedLevel]);

  // Verbs are filtered on their own fields, and only when no level is selected. The fields
  // differ by language — a Georgian paradigm has a verbal noun and a Russian one an
  // infinitive — so the match is written once per shape rather than over a common subset that
  // would search neither language well.
  const verbMatches = useMemo(() => {
    if (selectedLevel !== "all") return 0;
    const verbs = content().verbs;
    if (!searchTerm) return verbs.verbs.length;
    const needle = searchTerm.toLowerCase();

    return verbs.kind === "ka"
      ? verbs.verbs.filter(
          (v) =>
            v.english.toLowerCase().includes(needle) || v.verbalNoun.includes(needle) || v.present3sg.includes(needle),
        ).length
      : verbs.verbs.filter((v) => v.english.toLowerCase().includes(needle) || v.infinitive.includes(needle)).length;
  }, [searchTerm, selectedLevel]);

  return (
    <HashRouter>
      <ScrollManager />
      <div className="flex min-h-screen flex-col">
        {/* The header sticks and the sidebar sticks below it, so the wordmark and the stats
            stay visible while a long conjugation table scrolls. */}
        <header className="sticky top-0 z-100 flex min-h-header items-center bg-(image:--header-bg) px-6 py-4 text-white shadow-pop">
          <div className="flex w-full items-center justify-between gap-4 max-md:flex-wrap max-md:gap-2.5">
            {/* Opens the sidebar as a drawer, and only exists at the widths where the
                sidebar has stopped being a column. */}
            <Button
              variant="header"
              size="icon"
              className="lg:hidden"
              onClick={() => setNavOpen(true)}
              aria-label="Open menu"
              aria-controls="sidebar"
              aria-expanded={navOpen}
            >
              <Menu />
            </Button>
            {/* The product, not the dictionary. Naming the language here made the masthead
                change out from under you on every switch, and said the same thing the
                switcher two inches to the right already says. */}
            <Link to={`/${lang()}`} className="flex items-baseline gap-3 max-md:flex-1">
              <span className="bg-[linear-gradient(135deg,#38bdf8,#818cf8)] bg-clip-text text-[28px] font-bold tracking-[-0.01em] text-transparent">
                Lemmata
              </span>
            </Link>
            {/* On a narrow screen this whole group wraps to its own centred row, and the
                stats go with it: they are ambient, and worth dropping there. */}
            <div className="flex items-center gap-4 max-md:w-full max-md:flex-wrap max-md:justify-center max-md:gap-2">
              <Button
                variant="header"
                size="icon"
                onClick={toggle}
                title={dark ? "Switch to light mode" : "Switch to dark mode"}
                aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              >
                {dark ? <Sun /> : <Moon />}
              </Button>
              <LanguageSwitcher />
              <Account />
            </div>
          </div>
        </header>

        <div className="flex flex-1 items-start">
          <Sidebar open={navOpen} onClose={closeNav} />

          <main className="min-w-0 flex-1">
            <LangGate>
              <Routes>
                {/* Every page lives under its language. That is what makes a link to a Russian
                    verb a link to a Russian verb when somebody else opens it — and what keeps
                    the address bar and the screen from disagreeing after a refresh. A visitor
                    arriving at a bare path is sent to whichever dictionary they read last. */}
                <Route path="/" element={<Navigate to={`/${lang()}`} replace />} />
                <Route path="/:lang" element={<LangHome />} />
                <Route
                  path="/:lang/categories"
                  element={
                    <CategoryBrowser
                      searchTerm={searchTerm}
                      setSearchTerm={setSearchTerm}
                      selectedLevel={selectedLevel}
                      setSelectedLevel={setSelectedLevel}
                      categories={filteredCategories}
                      verbMatches={verbMatches}
                    />
                  }
                />
                <Route path="/:lang/verbs" element={<VerbsPage />} />
                {/* The one route that forks on the language, because the two verb systems have
                        nothing in common to render with one component. See RuVerbDetail.tsx. */}
                <Route path="/:lang/verbs/:verbId" element={<VerbPage />} />
                {/* Verbs are a category on the home grid, so the category URL has to land
                    somewhere sensible too. */}
                <Route path="/:lang/category/verbs" element={<Navigate to={`/${lang()}/verbs`} replace />} />
                <Route path="/:lang/category/:categoryId" element={<CategoryView />} />
                <Route path="/:lang/flashcards" element={<FlashcardMode />} />
                <Route path="/:lang/export" element={<ExportAnki />} />
                <Route path="/:lang/search" element={<WordSearch />} />
                <Route path="/:lang/stories" element={<StoryIndex />} />
                {/* Above the reader's routes in specificity, not merely in order: a static
                    third segment outranks `:storyId`, so a shelf can never be mistaken for a
                    story. `saveStory` refuses to mint "category" as an id, which is the other
                    half of that guarantee. */}
                <Route path="/:lang/stories/category" element={<Navigate to={`/${lang()}/stories`} replace />} />
                <Route path="/:lang/stories/category/:categoryId" element={<StoryCategoryView />} />
                <Route path="/:lang/stories/:storyId" element={<StoryReader />} />
                {/* 1-based, and absent for the first: a story that never gains a second
                    chapter keeps the address it has always had. */}
                <Route path="/:lang/stories/:storyId/:chapter" element={<StoryReader />} />
                <Route path="/:lang/quizzes" element={<QuizIndex />} />
                {/* Above the quiz's own route in specificity, not merely in order — the same
                    arrangement the stories have, and `saveQuiz` refuses to mint "category" as
                    an id, which is the other half of that guarantee. */}
                <Route path="/:lang/quizzes/category" element={<Navigate to={`/${lang()}/quizzes`} replace />} />
                <Route path="/:lang/quizzes/category/:categoryId" element={<QuizCategoryView />} />
                <Route path="/:lang/quizzes/:quizId" element={<QuizPage />} />
                {/* Two sections, one set of components, one table behind them. The section is
                    a prop rather than something read out of the URL inside the components,
                    because it is the *route* that decides which of the two a reader is in — a
                    lesson filed under grammar is reached at /grammar even though the row it
                    comes from is indistinguishable from any other. `LessonPage` checks the two
                    agree and redirects when they do not; see the note there. */}
                <Route path="/:lang/lessons" element={<LessonIndex section="lessons" />} />
                <Route path="/:lang/lessons/category" element={<Navigate to={`/${lang()}/lessons`} replace />} />
                <Route
                  path="/:lang/lessons/category/:categoryId"
                  element={<LessonCategoryView section="lessons" />}
                />
                <Route path="/:lang/lessons/:lessonId" element={<LessonPage section="lessons" />} />

                <Route path="/:lang/grammar" element={<LessonIndex section="grammar" />} />
                <Route path="/:lang/grammar/category" element={<Navigate to={`/${lang()}/grammar`} replace />} />
                <Route
                  path="/:lang/grammar/category/:categoryId"
                  element={<LessonCategoryView section="grammar" />}
                />
                <Route path="/:lang/grammar/:lessonId" element={<LessonPage section="grammar" />} />

                {/* A reader's own stories and words. Signed-in only, and the section says so
                    itself rather than being hidden: somebody following a link to it should be
                    told what it is and offered a way in, not sent to the home page. */}
                <Route
                  path="/:lang/library/*"
                  element={
                    <Suspense fallback={<Page />}>
                      <LibraryRoutes />
                    </Suspense>
                  }
                />

                {/* Admin-only, and in a chunk of its own — the editors are a fair amount of
                    code for a section almost nobody who opens this app will reach, so it is
                    fetched when /admin is, not before.

                    The gate hides it; the server enforces it. Every procedure under `admin`
                    re-reads is_admin from the table, so a route reached by typing the URL
                    still gets nothing done. */}
                <Route
                  path="/:lang/admin/*"
                  element={
                    <AdminGate>
                      <Suspense fallback={<Page />}>
                        <AdminRoutes />
                      </Suspense>
                    </AdminGate>
                  }
                />

                {/* Anything else: an unprefixed path, or one naming a language this build does
                    not have. Both mean "the dictionary that is loaded". */}
                <Route path="*" element={<RedirectToLang />} />
              </Routes>
            </LangGate>
          </main>
        </div>
      </div>
    </HashRouter>
  );
}

// The category grid, with the search box and level filter that narrow it. The filtering
// state stays in App so that it survives a trip into a category and back — this component
// is remounted by the router on every such return.
interface CategoryBrowserProps {
  searchTerm: string;
  setSearchTerm: Dispatch<SetStateAction<string>>;
  selectedLevel: LevelFilter;
  setSelectedLevel: Dispatch<SetStateAction<LevelFilter>>;
  categories: Category[];
  verbMatches: number;
}

function CategoryBrowser({
  searchTerm,
  setSearchTerm,
  selectedLevel,
  setSelectedLevel,
  categories,
  verbMatches,
}: CategoryBrowserProps) {
  return (
    <Page>
      <Breadcrumb>
        <BreadcrumbLink to="/">← Home</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>Categories</span>
      </Breadcrumb>

      <div className="mb-6 flex flex-wrap items-center gap-4 max-md:flex-col max-md:*:w-full">
        <SearchField
          placeholder="Search words in Georgian or English…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <LevelTabs value={selectedLevel} onChange={setSelectedLevel} />
      </div>

      <div className="mb-8 grid grid-cols-[repeat(auto-fill,minmax(215px,1fr))] gap-4.5 max-md:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] max-md:gap-3">
        {verbMatches > 0 && (
          <Link to="/verbs" className={CATEGORY_CARD}>
            <CategoryThumb category={VERB_CATEGORY} />
            <CategoryCardBody
              name={VERB_CATEGORY.name}
              native={VERB_CATEGORY.nameNative}
              count={`${verbMatches} verbs`}
            />
          </Link>
        )}
        {categories.map((cat) => (
          <Link
            key={cat.id}
            to={`/category/${cat.id}`}
            className={CATEGORY_CARD}
            state={{ level: selectedLevel, search: searchTerm }}
          >
            <CategoryThumb category={cat} />
            <CategoryCardBody name={cat.name} native={cat.nameNative} count={`${cat.wordCount} words`} />
          </Link>
        ))}
      </div>

      <ImageCredits categories={categories} />
    </Page>
  );
}

/* Exported because the category list on a word's own page draws the same tile. The picture
   fills the top of the card and eases up a little under the cursor, which is the whole of
   what says the tile is a link — there is no other affordance on it. */
export const CATEGORY_CARD =
  "group flex flex-col overflow-hidden rounded-lg border-2 border-border bg-card transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-pop";

function CategoryCardBody({ name, native, count }: { name: string; native: string; count: string }) {
  return (
    <div className="flex flex-col items-start gap-1 px-4 pt-3.5 pb-4 max-md:p-3">
      <h3 className="text-[15px] leading-tight font-semibold">{name}</h3>
      <p className="text-xs leading-snug text-faint">{native}</p>
      <span className="mt-1 rounded-full bg-primary-glow px-2.5 py-0.5 text-[13px] font-medium text-primary">
        {count}
      </span>
    </div>
  );
}

// The category pictures are CC-licensed, which obliges us to name the photographer and
// the licence wherever they appear. A collapsed list keeps that visible without putting
// a caption under all 43 cards.
function ImageCredits({ categories }: { categories: Category[] }) {
  const credits = categoryImageCredits(categories);
  if (!credits.length) return null;

  return (
    <details className="mt-9 border-t border-border pt-4 [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:text-primary">
      <summary className="cursor-pointer text-[13px] text-muted-foreground hover:text-primary">
        Image credits ({credits.length})
      </summary>
      <ul className="mt-3.5 columns-2 gap-x-9 max-md:columns-1">
        {credits.map(({ category, image }) => (
          <li key={category.id} className="mb-2 break-inside-avoid text-xs leading-normal text-faint">
            <span className="block font-medium text-muted-foreground">{category.name}</span>
            <a href={image.page} target="_blank" rel="noopener noreferrer">
              {image.title}
            </a>
            {image.author && <> · {image.author}</>}
            {image.license && (
              <>
                {" · "}
                {image.licenseUrl ? (
                  <a href={image.licenseUrl} target="_blank" rel="noopener noreferrer">
                    {image.license}
                  </a>
                ) : (
                  image.license
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-faint">Images from Wikipedia and Wikimedia Commons.</p>
    </details>
  );
}

export default App;
