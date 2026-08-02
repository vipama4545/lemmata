import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { LevelFilter } from '../types';
import allData from '../data/words.json';
import { getWordImage, creditLine } from '../utils/images';
import Icon from './Icon';

/** Filters a caller may pre-set through the router state when linking here. */
interface FlashcardState {
  level?: LevelFilter;
  categoryId?: string;
}

function FlashcardMode() {
  const location = useLocation();
  const state = location.state as FlashcardState | null;
  const initialLevel = state?.level || 'all';
  const initialCategory = state?.categoryId || 'all';

  const [levelFilter, setLevelFilter] = useState<LevelFilter>(initialLevel);
  const [categoryFilter, setCategoryFilter] = useState(initialCategory);
  const [isFlipped, setIsFlipped] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [knownWords, setKnownWords] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(true);

  const filteredWords = useMemo(() => {
    return allData.words.filter(w => {
      const matchesLevel = levelFilter === 'all' || w.level === levelFilter;
      const matchesCategory = categoryFilter === 'all' || w.categoryId === categoryFilter;
      return matchesLevel && matchesCategory;
    });
  }, [levelFilter, categoryFilter]);

  const remainingWords = filteredWords.filter(w => !knownWords.has(w.id));
  const currentWord = remainingWords[currentIndex] || filteredWords[currentIndex] || null;
  const currentImage = getWordImage(currentWord);

  const handleNext = useCallback(() => {
    setIsFlipped(false);
    if (remainingWords.length > 0) {
      setCurrentIndex((prev) => (prev + 1) % remainingWords.length);
    } else if (filteredWords.length > 0) {
      setCurrentIndex((prev) => (prev + 1) % filteredWords.length);
    }
  }, [remainingWords.length, filteredWords.length]);

  const handlePrev = useCallback(() => {
    setIsFlipped(false);
    if (remainingWords.length > 0) {
      setCurrentIndex((prev) => (prev - 1 + remainingWords.length) % remainingWords.length);
    } else if (filteredWords.length > 0) {
      setCurrentIndex((prev) => (prev - 1 + filteredWords.length) % filteredWords.length);
    }
  }, [remainingWords.length, filteredWords.length]);

  const handleKnow = useCallback(() => {
    if (currentWord) {
      setKnownWords(prev => new Set([...prev, currentWord.id]));
      if (remainingWords.length <= 1) {
        setCurrentIndex(0);
      } else {
        handleNext();
      }
    }
  }, [currentWord, remainingWords.length, handleNext]);

  const handleShuffle = useCallback(() => {
    setIsFlipped(false);
    setCurrentIndex(Math.floor(Math.random() * (remainingWords.length || filteredWords.length)));
  }, [remainingWords.length, filteredWords.length]);

  const handleReset = () => {
    setKnownWords(new Set());
    setCurrentIndex(0);
    setIsFlipped(false);
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      setIsFlipped(prev => !prev);
    } else if (e.key === 'ArrowRight') {
      handleNext();
    } else if (e.key === 'ArrowLeft') {
      handlePrev();
    } else if (e.key === 'k' || e.key === 'K') {
      handleKnow();
    } else if (e.key === 's' || e.key === 'S') {
      handleShuffle();
    }
  }, [handleNext, handlePrev, handleKnow, handleShuffle]);

  // Keyboard shortcuts. This has to be an effect: registering the listener from a
  // useState initialiser ran it once with the first render's handlers and never
  // unsubscribed, so the shortcuts acted on a stale card.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const progress = filteredWords.length > 0
    ? ((knownWords.size / filteredWords.length) * 100).toFixed(0)
    : '0';

  return (
    <div className="main-content flashcard-page">
      <div className="breadcrumb">
        <Link to="/">← Home</Link>
        <span className="breadcrumb-sep">/</span>
        <span>Flashcard Mode</span>
      </div>

      <div className="flashcard-container">
        <div className="flashcard-header">
          <h2>Flashcard Study Mode</h2>
          <button
            className="settings-toggle"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Icon name="sliders" /> Settings
          </button>
        </div>

        {showSettings && (
          <div className="flashcard-settings">
            <div className="settings-group">
              <label>CEFR Level:</label>
              <div className="level-filter">
                <button className={`level-btn ${levelFilter === 'all' ? 'active' : ''}`}
                  onClick={() => { setLevelFilter('all'); setCurrentIndex(0); }}>All</button>
                <button className={`level-btn ${levelFilter === 'A1' ? 'active a1' : ''}`}
                  onClick={() => { setLevelFilter('A1'); setCurrentIndex(0); }}>A1</button>
                <button className={`level-btn ${levelFilter === 'A2' ? 'active a2' : ''}`}
                  onClick={() => { setLevelFilter('A2'); setCurrentIndex(0); }}>A2</button>
              </div>
            </div>
            <div className="settings-group">
              <label>Category:</label>
              <select
                value={categoryFilter}
                onChange={(e) => { setCategoryFilter(e.target.value); setCurrentIndex(0); }}
                className="category-select"
              >
                <option value="all">All Categories</option>
                {allData.categories.map(cat => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name} ({cat.wordCount})
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-group">
              <label>Keyboard shortcuts: <small>Space = flip, ←→ = navigate, K = know, S = shuffle</small></label>
            </div>
          </div>
        )}

        <div className="progress-bar-container">
          <div className="progress-bar" style={{ width: `${progress}%` }}></div>
          <span className="progress-text">{progress}% mastered ({knownWords.size}/{filteredWords.length})</span>
        </div>

        {currentWord && (
          <div className="flashcard-area">
            <div
              ref={cardRef}
              className={`flashcard ${isFlipped ? 'flipped' : ''}`}
              onClick={() => setIsFlipped(!isFlipped)}
            >
              <div className="flashcard-front">
                <div className="flashcard-level">
                  <span className={`level-badge ${currentWord.level.toLowerCase()}`}>{currentWord.level}</span>
                  <span className="pos-tag">{currentWord.partOfSpeech}</span>
                </div>
                <div className="flashcard-word">{currentWord.georgian}</div>
                <div className="flashcard-hint">Click or press Space to flip</div>
              </div>
              <div className="flashcard-back">
                <div className="flashcard-word-english">{currentWord.english}</div>
                <div className="flashcard-definition">{currentWord.georgianDefinition}</div>
                {currentWord.englishFull.length > 1 && (
                  <div className="flashcard-translations">
                    {currentWord.englishFull.map((t, i) => (
                      <span key={i} className="translation-alt">• {t}</span>
                    ))}
                  </div>
                )}
                {currentImage && (
                  <figure className="flashcard-image-back">
                    <img
                      src={currentImage.url}
                      alt={currentWord.english}
                      loading="lazy"
                    />
                    {creditLine(currentImage) && (
                      <figcaption className="image-credit">{creditLine(currentImage)}</figcaption>
                    )}
                  </figure>
                )}
                <div className="flashcard-category">{currentWord.category}</div>
              </div>
            </div>
          </div>
        )}

        {!currentWord && (
          <div className="no-words">
            <h3>No words found</h3>
            <p>Try adjusting the filters above.</p>
          </div>
        )}

        <div className="flashcard-controls">
          <button className="control-btn" onClick={handlePrev}>
            <Icon name="arrow-left" /> Prev
          </button>
          <button className="control-btn shuffle" onClick={handleShuffle}>
            <Icon name="shuffle" /> Shuffle
          </button>
          <button className="control-btn know" onClick={handleKnow}>
            <Icon name="check" /> Know ({knownWords.size})
          </button>
          <button className="control-btn" onClick={handleNext}>
            Next <Icon name="arrow-right" />
          </button>
          <button className="control-btn reset" onClick={handleReset}>
            <Icon name="refresh" /> Reset
          </button>
        </div>

      </div>
    </div>
  );
}

export default FlashcardMode;
