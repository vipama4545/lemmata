import { useState, useMemo, useEffect, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { HashRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import type { Category, LevelFilter } from './types';
import CategoryView from './components/CategoryView';
import FlashcardMode from './components/FlashcardMode';
import ExportAnki from './components/ExportAnki';
import WordSearch from './components/WordSearch';
import CategoryThumb from './components/CategoryThumb';
import VerbList from './components/VerbList';
import VerbDetail from './components/VerbDetail';
import GrammarIndex from './components/GrammarIndex';
import GrammarTopic from './components/GrammarTopic';
import WordOfTheDay from './components/WordOfTheDay';
import Sidebar from './components/Sidebar';
import Icon from './components/Icon';
import { categoryImageCredits } from './utils/categoryImages';
import allData from './data/words.json';
import verbData from './data/verbs.json';
import './App.css';

// Verbs come from the conjugation spreadsheet rather than the scraped dictionary, so they
// are their own category rather than an entry in words.json. It carries no CEFR level,
// which is why the card drops out whenever a level filter is on.
const VERB_CATEGORY: Category = {
  id: 'verbs',
  name: 'Verbs',
  nameGeorgian: 'ზმნები',
  wordCount: verbData.verbs.length,
};

function useTheme() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  const toggle = () => setDark(prev => !prev);
  return { dark, toggle };
}

function App() {
  const { dark, toggle } = useTheme();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<LevelFilter>('all');
  // Only used below 1024px, where the sidebar is a drawer rather than a column. The close
  // callback is stable because the sidebar hangs an escape-key listener off it.
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = useCallback(() => setNavOpen(false), []);

  const categories = allData.categories;
  const words = allData.words;

  const filteredCategories = useMemo(() => {
    if (!searchTerm && selectedLevel === 'all') return categories;
    const lowerSearch = searchTerm.toLowerCase();
    return categories
      .map(cat => ({
        ...cat,
        wordCount: words.filter(w => {
          const inCategory = w.categoryId === cat.id;
          const matchesSearch = !searchTerm ||
            w.georgian.includes(lowerSearch) ||
            w.english.toLowerCase().includes(lowerSearch);
          const matchesLevel = selectedLevel === 'all' || w.level === selectedLevel;
          return inCategory && matchesSearch && matchesLevel;
        }).length,
      }))
      .filter(cat => cat.wordCount > 0);
  }, [categories, words, searchTerm, selectedLevel]);

  // Verbs are filtered on their own fields, and only when no level is selected.
  const verbMatches = useMemo(() => {
    if (selectedLevel !== 'all') return 0;
    if (!searchTerm) return verbData.verbs.length;
    const needle = searchTerm.toLowerCase();
    return verbData.verbs.filter(v =>
      v.english.toLowerCase().includes(needle) ||
      v.verbalNoun.includes(needle) ||
      v.present3sg.includes(needle),
    ).length;
  }, [searchTerm, selectedLevel]);

  const totalWords = words.length;
  const a1Count = words.filter(w => w.level === 'A1').length;
  const a2Count = words.filter(w => w.level === 'A2').length;

  return (
    <HashRouter>
      <div className="app">
        <header className="header">
          <div className="header-content">
            <button
              className="nav-toggle"
              onClick={() => setNavOpen(true)}
              aria-label="Open menu"
              aria-controls="sidebar"
              aria-expanded={navOpen}
            >
              <Icon name="menu" />
            </button>
            <Link to="/" className="logo">
              <span className="logo-georgian">ქართული</span>
              <span className="logo-sub">Georgian Dictionary</span>
            </Link>
            <div className="header-right">
              <div className="header-stats">
                <span className="stat">{totalWords} words</span>
                <span className="stat">{verbData.verbs.length} verbs</span>
                <span className="stat stat-a1">A1: {a1Count}</span>
                <span className="stat stat-a2">A2: {a2Count}</span>
              </div>
              <button
                className="theme-toggle"
                onClick={toggle}
                title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
                aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                <Icon name={dark ? 'sun' : 'moon'} />
              </button>
            </div>
          </div>
        </header>

        <div className="app-body">
          <Sidebar open={navOpen} onClose={closeNav} />

          <main className="app-main">
            <Routes>
              <Route path="/" element={<WordOfTheDay />} />
              <Route
                path="/categories"
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
              <Route path="/verbs" element={<VerbList />} />
              <Route path="/verbs/:verbId" element={<VerbDetail />} />
              {/* Verbs are a category on the home grid, so the category URL has to land
                  somewhere sensible too. */}
              <Route path="/category/verbs" element={<Navigate to="/verbs" replace />} />
              <Route path="/category/:categoryId" element={<CategoryView />} />
              <Route path="/flashcards" element={<FlashcardMode />} />
              <Route path="/export" element={<ExportAnki />} />
              <Route path="/search" element={<WordSearch />} />
              <Route path="/grammar" element={<GrammarIndex />} />
              <Route path="/grammar/:topicId" element={<GrammarTopic />} />
            </Routes>
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
    <div className="main-content">
      <div className="breadcrumb">
        <Link to="/">← Word of the day</Link>
        <span className="breadcrumb-sep">/</span>
        <span>Categories</span>
      </div>

      <div className="toolbar">
        <div className="search-field">
          <Icon name="search" />
          <input
            type="text"
            className="search-input"
            placeholder="Search words in Georgian or English…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="level-filter">
          <button
            className={`level-btn ${selectedLevel === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedLevel('all')}
          >
            All
          </button>
          <button
            className={`level-btn ${selectedLevel === 'A1' ? 'active a1' : ''}`}
            onClick={() => setSelectedLevel('A1')}
          >
            A1
          </button>
          <button
            className={`level-btn ${selectedLevel === 'A2' ? 'active a2' : ''}`}
            onClick={() => setSelectedLevel('A2')}
          >
            A2
          </button>
        </div>
      </div>

      <div className="category-grid">
        {verbMatches > 0 && (
          <Link to="/verbs" className="category-card">
            <CategoryThumb category={VERB_CATEGORY} />
            <div className="category-card-body">
              <h3 className="category-name">{VERB_CATEGORY.name}</h3>
              <p className="category-name-geo">{VERB_CATEGORY.nameGeorgian}</p>
              <span className="category-count">{verbMatches} verbs</span>
            </div>
          </Link>
        )}
        {categories.map(cat => (
          <Link
            key={cat.id}
            to={`/category/${cat.id}`}
            className="category-card"
            state={{ level: selectedLevel, search: searchTerm }}
          >
            <CategoryThumb category={cat} />
            <div className="category-card-body">
              <h3 className="category-name">{cat.name}</h3>
              <p className="category-name-geo">{cat.nameGeorgian}</p>
              <span className="category-count">{cat.wordCount} words</span>
            </div>
          </Link>
        ))}
      </div>

      <ImageCredits categories={categories} />
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
    <details className="credits">
      <summary>Image credits ({credits.length})</summary>
      <ul>
        {credits.map(({ category, image }) => (
          <li key={category.id}>
            <span className="credit-category">{category.name}</span>
            <a href={image.page} target="_blank" rel="noopener noreferrer">{image.title}</a>
            {image.author && <> · {image.author}</>}
            {image.license && (
              <>
                {' · '}
                {image.licenseUrl
                  ? <a href={image.licenseUrl} target="_blank" rel="noopener noreferrer">{image.license}</a>
                  : image.license}
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="credits-source">Images from Wikipedia and Wikimedia Commons.</p>
    </details>
  );
}

export default App;
