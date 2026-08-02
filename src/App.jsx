import { useState, useMemo, useEffect } from 'react';
import { HashRouter, Routes, Route, Link } from 'react-router-dom';
import CategoryView from './components/CategoryView';
import FlashcardMode from './components/FlashcardMode';
import ExportAnki from './components/ExportAnki';
import WordSearch from './components/WordSearch';
import allData from './data/words.json';
import './App.css';

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
  const [selectedLevel, setSelectedLevel] = useState('all');

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

  const totalWords = words.length;
  const a1Count = words.filter(w => w.level === 'A1').length;
  const a2Count = words.filter(w => w.level === 'A2').length;

  return (
    <HashRouter>
      <div className="app">
        <header className="header">
          <div className="header-content">
            <Link to="/" className="logo">
              <span className="logo-georgian">ქართული</span>
              <span className="logo-sub">Georgian Dictionary</span>
            </Link>
            <div className="header-right">
              <div className="header-stats">
                <span className="stat">{totalWords} words</span>
                <span className="stat stat-a1">A1: {a1Count}</span>
                <span className="stat stat-a2">A2: {a2Count}</span>
              </div>
              <button className="theme-toggle" onClick={toggle} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
                {dark ? '☀️' : '🌙'}
              </button>
            </div>
          </div>
        </header>

        <Routes>
          <Route
            path="/"
            element={
              <div className="main-content">
                <div className="toolbar">
                  <input
                    type="text"
                    className="search-input"
                    placeholder="🔍 Search words in Georgian or English..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
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
                  {filteredCategories.map(cat => (
                    <Link
                      key={cat.id}
                      to={`/category/${cat.id}`}
                      className="category-card"
                      state={{ level: selectedLevel, search: searchTerm }}
                    >
                      <span className="category-icon">{cat.icon}</span>
                      <h3 className="category-name">{cat.name}</h3>
                      <p className="category-name-geo">{cat.nameGeorgian}</p>
                      <span className="category-count">{cat.wordCount} words</span>
                    </Link>
                  ))}
                </div>

                <div className="quick-links">
                  <Link to="/flashcards" className="quick-link flashcard-link">
                    🃏 Flashcard Mode
                  </Link>
                  <Link to="/search" className="quick-link search-link">
                    🔍 Word Search
                  </Link>
                  <Link to="/export" className="quick-link export-link">
                    📥 Export Anki Deck
                  </Link>
                </div>
              </div>
            }
          />
          <Route path="/category/:categoryId" element={<CategoryView />} />
          <Route path="/flashcards" element={<FlashcardMode />} />
          <Route path="/export" element={<ExportAnki />} />
          <Route path="/search" element={<WordSearch />} />
        </Routes>
      </div>
    </HashRouter>
  );
}

export default App;
