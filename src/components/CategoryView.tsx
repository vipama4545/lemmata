import { useState, useMemo } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import type { LevelFilter, Word } from '../types';
import allData from '../data/words.json';
import { getWordImage, creditLine } from '../utils/images';
import CategoryThumb from './CategoryThumb';
import Icon from './Icon';

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

  const [localLevel, setLocalLevel] = useState<LevelFilter>(levelFilter);
  const [localSearch, setLocalSearch] = useState(searchFilter);
  const [showTranslation, setShowTranslation] = useState(true);
  const [currentWordIndex, setCurrentWordIndex] = useState<number | null>(null);

  const category = allData.categories.find(c => c.id === categoryId);
  const categoryWords = allData.words.filter(w => w.categoryId === categoryId);

  const filteredWords = useMemo(() => {
    return categoryWords.filter(w => {
      const matchesLevel = localLevel === 'all' || w.level === localLevel;
      const matchesSearch = !localSearch ||
        w.georgian.toLowerCase().includes(localSearch.toLowerCase()) ||
        w.english.toLowerCase().includes(localSearch.toLowerCase());
      return matchesLevel && matchesSearch;
    });
  }, [categoryWords, localLevel, localSearch]);

  if (!category) {
    return (
      <div className="main-content">
        <div className="not-found">
          <h2>Category not found</h2>
          <Link to="/categories">← Back to categories</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="main-content">
      <div className="breadcrumb">
        <Link to="/categories">← Categories</Link>
        <span className="breadcrumb-sep">/</span>
        <span>{category.name}</span>
      </div>

      <div className="category-header">
        <CategoryThumb category={category} className="category-thumb-sm" />
        <div className="category-header-text">
          <h1>{category.name}</h1>
          <p className="category-header-geo">{category.nameGeorgian}</p>
          <span className="word-count">{filteredWords.length} words</span>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-field">
          <Icon name="search" />
          <input
            type="text"
            className="search-input"
            placeholder="Filter words…"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
          />
        </div>
        <div className="level-filter">
          <button
            className={`level-btn ${localLevel === 'all' ? 'active' : ''}`}
            onClick={() => setLocalLevel('all')}
          >
            All
          </button>
          <button
            className={`level-btn ${localLevel === 'A1' ? 'active a1' : ''}`}
            onClick={() => setLocalLevel('A1')}
          >
            A1
          </button>
          <button
            className={`level-btn ${localLevel === 'A2' ? 'active a2' : ''}`}
            onClick={() => setLocalLevel('A2')}
          >
            A2
          </button>
        </div>
        <button
          className="toggle-btn"
          onClick={() => setShowTranslation(!showTranslation)}
        >
          <Icon name={showTranslation ? 'eye-off' : 'eye'} />
          {showTranslation ? 'Hide translations' : 'Show translations'}
        </button>
      </div>

      <div className="word-list">
        {filteredWords.map((word, idx) => (
          <div key={word.id} className="word-card">
            <div className="word-card-left">
              <span className={`level-badge ${word.level.toLowerCase()}`}>{word.level}</span>
              <span className="pos-tag">{word.partOfSpeech}</span>
            </div>
            <div className="word-card-center">
              <span className="word-georgian">{word.georgian}</span>
              {showTranslation && (
                <span className="word-english">{word.english}</span>
              )}
            </div>
            <div className="word-card-right">
              {getWordImage(word) && (
                <button
                  className="img-btn"
                  onClick={() => {
                    setCurrentWordIndex(idx);
                  }}
                  title="Show image"
                  aria-label={`Show image for ${word.english}`}
                >
                  <Icon name="image" size={20} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {currentWordIndex !== null && (
        <WordImageModal
          word={filteredWords[currentWordIndex]}
          onClose={() => setCurrentWordIndex(null)}
        />
      )}
    </div>
  );
}

function WordImageModal({ word, onClose }: { word: Word; onClose: () => void }) {
  const image = getWordImage(word);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={20} />
        </button>
        <h3>{word.georgian} — {word.english}</h3>
        {image && (
          <figure className="modal-image">
            <img src={image.url} alt={word.english} loading="lazy" />
            <figcaption className="image-credit">
              <a href={image.page} target="_blank" rel="noopener noreferrer">
                {image.title}
              </a>
              {creditLine(image) && <> · {creditLine(image)}</>}
            </figcaption>
          </figure>
        )}
        <p className="modal-definition">{word.georgianDefinition}</p>
        {word.englishFull.length > 1 && (
          <div className="modal-translations">
            <strong>All meanings:</strong>
            <ul>
              {word.englishFull.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default CategoryView;
