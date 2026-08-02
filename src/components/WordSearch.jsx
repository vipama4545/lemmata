import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import allData from '../data/words.json';
import Icon from './Icon';

function WordSearch() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLevel, setSelectedLevel] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');

  const results = useMemo(() => {
    if (!searchTerm.trim()) return [];
    const lower = searchTerm.toLowerCase();
    return allData.words
      .filter(w => {
        const matchesSearch = w.georgian.toLowerCase().includes(lower) ||
          w.english.toLowerCase().includes(lower) ||
          (w.georgianDefinition && w.georgianDefinition.toLowerCase().includes(lower));
        const matchesLevel = selectedLevel === 'all' || w.level === selectedLevel;
        const matchesCategory = selectedCategory === 'all' || w.categoryId === selectedCategory;
        return matchesSearch && matchesLevel && matchesCategory;
      })
      .slice(0, 100);
  }, [searchTerm, selectedLevel, selectedCategory]);

  return (
    <div className="main-content">
      <div className="breadcrumb">
        <Link to="/">← Home</Link>
        <span className="breadcrumb-sep">/</span>
        <span>Word Search</span>
      </div>

      <h2>Word Search</h2>

      <div className="search-page-toolbar">
        <div className="search-field">
          <Icon name="search" size={20} />
          <input
            type="text"
            className="search-input large"
            placeholder="Type in Georgian or English…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoFocus
          />
        </div>
        <div className="search-filters">
          <div className="level-filter">
            <button className={`level-btn ${selectedLevel === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedLevel('all')}>All</button>
            <button className={`level-btn ${selectedLevel === 'A1' ? 'active a1' : ''}`}
              onClick={() => setSelectedLevel('A1')}>A1</button>
            <button className={`level-btn ${selectedLevel === 'A2' ? 'active a2' : ''}`}
              onClick={() => setSelectedLevel('A2')}>A2</button>
          </div>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="category-select"
          >
            <option value="all">All Categories</option>
            {allData.categories.map(cat => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {searchTerm && (
        <p className="search-results-count">
          {results.length} result{results.length !== 1 ? 's' : ''} found
        </p>
      )}

      <div className="word-list">
        {results.map((word) => (
          <Link
            key={word.id}
            to={`/category/${word.categoryId}`}
            className="word-card search-result"
          >
            <div className="word-card-left">
              <span className={`level-badge ${word.level.toLowerCase()}`}>{word.level}</span>
              <span className="pos-tag">{word.partOfSpeech}</span>
            </div>
            <div className="word-card-center">
              <span className="word-georgian">{word.georgian}</span>
              <span className="word-english">{word.english}</span>
              {word.georgianDefinition && (
                <span className="word-definition">{word.georgianDefinition}</span>
              )}
            </div>
            <div className="word-card-right">
              <span className="word-category-small">{word.category}</span>
            </div>
          </Link>
        ))}
      </div>

      {!searchTerm && (
        <div className="search-placeholder">
          <p>Start typing to search across all {allData.words.length} Georgian words...</p>
          <p className="search-hint">You can search in Georgian (₾) or English alphabets</p>
        </div>
      )}
    </div>
  );
}

export default WordSearch;
