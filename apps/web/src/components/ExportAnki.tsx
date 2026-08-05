import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Category, Level, LevelFilter, Word } from '@georgian/shared/types';
import { PERSONS, SCREEVES } from '@georgian/shared/grammar';
import { derived, verbData } from '../content/store';
import { getWordImage } from '../utils/images';
import CategoryThumb from './CategoryThumb';
import Icon from './Icon';

/**
 * A row in the flashcard export. Verbs are folded in alongside the dictionary words, and
 * carry no CEFR level of their own — which is what the empty string in `level` means.
 * Only the fields a card actually prints are required, so a verb does not have to be
 * dressed up as a full lexicon entry to be exported.
 */
type ExportWord = Pick<Word, 'id' | 'georgian' | 'english' | 'georgianDefinition' | 'partOfSpeech' | 'category' | 'categoryId'>
  & { level: Level | '' };

// Verbs join the ordinary export as one more category, carrying only their headword: the
// verbal noun, the English, and the third person singular of the present. The full
// paradigm is far too wide for a flashcard and has its own download below.
const verbCategory = derived<Category>(content => ({
  id: 'verbs',
  name: 'Verbs',
  nameGeorgian: 'ზმნები',
  wordCount: content.verbs.verbs.length,
}));

const verbsAsWords = derived<ExportWord[]>(content =>
  content.verbs.verbs.map(verb => ({
    id: `verb-${verb.id}`,
    georgian: verb.verbalNoun,
    english: verb.english,
    level: '',
    partOfSpeech: 'verb',
    category: verbCategory().name,
    categoryId: verbCategory().id,
    georgianDefinition: verb.present3sg,
  })),
);

const exportCategories = derived<Category[]>(content => [verbCategory(), ...content.words.categories]);
const exportWords = derived<ExportWord[]>(content => [...content.words.words, ...verbsAsWords()]);

type ExportFormat = 'csv' | 'txt';

function ExportAnki() {
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [exporting, setExporting] = useState(false);
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);

  const allSelected = selectedCategories.length === 0;

  const filteredWords = useMemo(() => {
    return exportWords().filter(w => {
      const matchesLevel = levelFilter === 'all' || w.level === levelFilter;
      const matchesCategory = allSelected || selectedCategories.includes(w.categoryId);
      return matchesLevel && matchesCategory;
    });
  }, [levelFilter, selectedCategories, allSelected]);

  const toggleCategory = (catId: string) => {
    setSelectedCategories(prev => {
      if (prev.includes(catId)) {
        return prev.filter(id => id !== catId);
      }
      return [...prev, catId];
    });
  };

  const selectAll = () => setSelectedCategories([]);
  const deselectAll = () => setSelectedCategories(exportCategories().map(c => c.id));

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!categoryDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest('.multi-select')) {
        setCategoryDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [categoryDropdownOpen]);

  const handleExport = async () => {
    setExporting(true);
    try {
      if (format === 'csv') {
        exportAsCSV(filteredWords);
      } else {
        exportAsAnkiTxt(filteredWords);
      }
    } catch (err) {
      console.error('Export failed:', err);
    }
    setExporting(false);
  };

  return (
    <div className="main-content export-page">
      <div className="breadcrumb">
        <Link to="/">← Home</Link>
        <span className="breadcrumb-sep">/</span>
        <span>Export for Anki</span>
      </div>

      <h1>Export for Anki</h1>
      <p className="export-description">
        Select which words to export, then download them as a CSV or tab-separated file
        ready to import into Anki.
      </p>

      <div className="export-card">
        <div className="export-filters">
          <div className="filter-group">
            <label>CEFR Level</label>
            <div className="level-filter">
              <button className={`level-btn ${levelFilter === 'all' ? 'active' : ''}`}
                onClick={() => setLevelFilter('all')}>All</button>
              <button className={`level-btn ${levelFilter === 'A1' ? 'active a1' : ''}`}
                onClick={() => setLevelFilter('A1')}>A1</button>
              <button className={`level-btn ${levelFilter === 'A2' ? 'active a2' : ''}`}
                onClick={() => setLevelFilter('A2')}>A2</button>
            </div>
          </div>

          <div className="filter-group">
            <label>Category</label>
            <div className="multi-select">
              <button
                className="multi-select-trigger"
                onClick={() => setCategoryDropdownOpen(!categoryDropdownOpen)}
              >
                <span className="multi-select-label">
                  {allSelected
                    ? 'All Categories'
                    : `${selectedCategories.length} categor${selectedCategories.length === 1 ? 'y' : 'ies'} selected`}
                </span>
                <Icon name="chevron" className={`multi-select-arrow ${categoryDropdownOpen ? 'open' : ''}`} />
              </button>
              {categoryDropdownOpen && (
                <div className="multi-select-dropdown">
                  <div className="multi-select-actions">
                    <button className="multi-select-action" onClick={selectAll}>Select All</button>
                    <button className="multi-select-action" onClick={deselectAll}>Deselect All</button>
                  </div>
                  <div className="multi-select-list">
                    {exportCategories().map(cat => {
                      const checked = allSelected || selectedCategories.includes(cat.id);
                      return (
                        <label key={cat.id} className={`multi-select-option ${checked ? 'selected' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCategory(cat.id)}
                          />
                          <CategoryThumb category={cat} className="category-thumb-xs" />
                          <span className="multi-select-name">{cat.name}</span>
                          <span className="multi-select-count">{cat.wordCount}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="filter-group">
            <label>Export Format</label>
            <div className="format-options">
              <label className="format-option">
                <input
                  type="radio"
                  name="format"
                  value="csv"
                  checked={format === 'csv'}
                  onChange={() => setFormat('csv')}
                />
                <div className="format-info">
                  <strong>CSV</strong>
                  <span>Comma-separated, best for Anki's File → Import</span>
                </div>
              </label>
              <label className="format-option">
                <input
                  type="radio"
                  name="format"
                  value="txt"
                  checked={format === 'txt'}
                  onChange={() => setFormat('txt')}
                />
                <div className="format-info">
                  <strong>Tab-separated (.txt)</strong>
                  <span>With HTML formatting for rich Anki cards</span>
                </div>
              </label>
            </div>
          </div>
        </div>

        <div className="export-preview">
          <div className="preview-header">
            <h3><Icon name="list" /> Preview</h3>
            <span className="word-count">{filteredWords.length} words selected</span>
          </div>
          <div className="preview-list">
            {filteredWords.slice(0, 10).map(w => (
              <div key={w.id} className="preview-item">
                <span className="preview-geo">{w.georgian}</span>
                <span className="preview-arrow">→</span>
                <span className="preview-eng">{w.english}</span>
                {w.level && <span className={`level-badge ${w.level.toLowerCase()}`}>{w.level}</span>}
              </div>
            ))}
            {filteredWords.length > 10 && (
              <p className="preview-more">…and {filteredWords.length - 10} more</p>
            )}
          </div>
        </div>

        <div className="export-actions">
          <button
            className="export-btn anki-btn"
            onClick={handleExport}
            disabled={exporting || filteredWords.length === 0}
          >
            {exporting
              ? 'Exporting…'
              : <><Icon name="download" /> Export {filteredWords.length} words</>}
          </button>
        </div>

        <div className="export-help">
          <h3>How to import into Anki</h3>
          <p className="export-note">
            Verbs export as their verbal noun and English, with the third person singular
            of the present in the definition column. Their conjugations are not included —
            use the full verb database below for those.
          </p>
          <ol>
            <li>Download the file using the button above.</li>
            <li>Open Anki and choose your deck (or create a new one).</li>
            <li>Go to <strong>File → Import…</strong></li>
            <li>Select the downloaded file.</li>
            <li>
              In the import dialog:
              <ul>
                <li>Set <strong>Type</strong> to the number of fields (2 for CSV: Georgian, English)</li>
                <li>Enable <strong>Front: Column 1</strong> (Georgian), <strong>Back: Column 2</strong> (English)</li>
              </ul>
            </li>
            <li>Click <strong>Import</strong>.</li>
          </ol>
        </div>
      </div>

      <h2 className="export-section-title">Verb database</h2>
      <p className="export-description">
        The whole conjugation sheet as one CSV: a row per verb, a column for every person
        of every screeve, plus the imperative, the synonyms and the source link. This is a
        reference dump rather than a flashcard deck.
      </p>

      <div className="export-card export-card-verbs">
        <div className="export-preview">
          <div className="preview-header">
            <h3><Icon name="list" /> Contents</h3>
            <span className="word-count">{verbData().verbs.length} verbs</span>
          </div>
          <ul className="export-columns">
            <li>{SCREEVES.length} screeves × {PERSONS.length} persons</li>
            <li>Imperative and prohibitive</li>
            <li>Verbal noun and conjugation group</li>
            <li>English and Georgian synonyms</li>
          </ul>
        </div>

        <div className="export-actions">
          <button className="export-btn anki-btn" onClick={exportVerbConjugations}>
            <Icon name="download" /> Export all {verbData().verbs.length} verb conjugations
          </button>
        </div>
      </div>
    </div>
  );
}

// One row per verb, one column per person-and-screeve — the shape the spreadsheet has,
// flattened so a column header names exactly what is under it ("Aorist 3sg").
function buildVerbConjugationCsv() {
  const { verbs } = verbData();
  const screeves = SCREEVES;
  const persons = PERSONS;

  // The imperative has no first person singular, so that column would be dead weight.
  const imperativePersons = persons.filter(p =>
    verbs.some(v => v.imperative?.[p.key] || v.prohibitive?.[p.key]));

  const headers = [
    'English', 'Transitivity', 'Verbal Noun', 'Conjugation Group',
    ...screeves.flatMap(s => persons.map(p => `${s.label} ${p.label}`)),
    ...imperativePersons.map(p => `Imperative ${p.label}`),
    ...imperativePersons.map(p => `Prohibitive ${p.label}`),
    'English Synonyms', 'Georgian Synonyms', 'Source URL',
  ];

  const rows = verbs.map(verb => [
    verb.english,
    verb.transitivity,
    verb.verbalNoun,
    verb.group,
    ...screeves.flatMap(s => persons.map(p => verb.forms[s.key]?.[p.key] || '')),
    ...imperativePersons.map(p => verb.imperative?.[p.key] || ''),
    ...imperativePersons.map(p => verb.prohibitive?.[p.key] || ''),
    verb.synonymsEnglish.join('; '),
    verb.synonymsGeorgian.join('; '),
    verb.url,
  ]);

  return [headers, ...rows]
    .map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

function exportVerbConjugations() {
  const blob = new Blob(['\uFEFF' + buildVerbConjugationCsv()], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, 'georgian_verb_conjugations.csv');
}

function exportAsCSV(words: ExportWord[]) {
  const headers = ['Georgian', 'English', 'Level', 'Part of Speech', 'Category', 'Georgian Definition', 'Image URL'];
  const rows = words.map(w => [
    w.georgian,
    w.english,
    w.level,
    w.partOfSpeech,
    w.category,
    w.georgianDefinition,
    // Words with no matched image get an empty cell rather than a URL that 404s.
    getWordImage(w)?.url || '',
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, 'georgian_dictionary.csv');
}

// Anki reads this file a line per note, so neither field may contain a newline of its
// own — the HTML is emitted unbroken.
function exportAsAnkiTxt(words: ExportWord[]) {
  const lines = words.map(w => {
    const image = getWordImage(w);
    const front =
      `<div style="font-size:2em;text-align:center;padding:20px;">${w.georgian}</div>` +
      `<div style="text-align:center;color:#666;">${w.level} &bull; ${w.partOfSpeech}</div>`;

    // A card only carries a picture when one was actually matched to the word, and it
    // carries the credit with it — the licence follows the image off the site.
    const credit = [image?.author, image?.license].filter(Boolean).join(' · ');
    const picture = image
      ? `<div style="text-align:center;"><img src="${image.url}" /></div>` +
        (credit ? `<div style="text-align:center;font-size:0.75em;color:#999;">${credit}</div>` : '')
      : '';

    const back =
      `<div style="font-size:1.5em;text-align:center;padding:20px;">${w.english}</div>` +
      `<div style="text-align:center;color:#666;">${w.georgianDefinition}</div>` +
      picture;

    return `${front}\t${back}`;
  });

  const content = lines.join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, 'georgian_dictionary.txt');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default ExportAnki;
