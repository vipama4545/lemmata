import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import allData from '../data/words.json';

function ExportAnki() {
  const [levelFilter, setLevelFilter] = useState('all');
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [format, setFormat] = useState('csv');
  const [exporting, setExporting] = useState(false);
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);

  const allSelected = selectedCategories.length === 0;

  const filteredWords = useMemo(() => {
    return allData.words.filter(w => {
      const matchesLevel = levelFilter === 'all' || w.level === levelFilter;
      const matchesCategory = allSelected || selectedCategories.includes(w.categoryId);
      return matchesLevel && matchesCategory;
    });
  }, [levelFilter, selectedCategories, allSelected]);

  const toggleCategory = (catId) => {
    setSelectedCategories(prev => {
      if (prev.includes(catId)) {
        return prev.filter(id => id !== catId);
      }
      return [...prev, catId];
    });
  };

  const selectAll = () => setSelectedCategories([]);
  const deselectAll = () => setSelectedCategories(allData.categories.map(c => c.id));

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!categoryDropdownOpen) return;
    const handler = (e) => {
      if (!e.target.closest('.multi-select')) {
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
        <span>📥 Export for Anki</span>
      </div>

      <h1>📥 Export for Anki</h1>
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
                <span className="multi-select-arrow">{categoryDropdownOpen ? '▲' : '▼'}</span>
              </button>
              {categoryDropdownOpen && (
                <div className="multi-select-dropdown">
                  <div className="multi-select-actions">
                    <button className="multi-select-action" onClick={selectAll}>Select All</button>
                    <button className="multi-select-action" onClick={deselectAll}>Deselect All</button>
                  </div>
                  <div className="multi-select-list">
                    {allData.categories.map(cat => {
                      const checked = allSelected || selectedCategories.includes(cat.id);
                      return (
                        <label key={cat.id} className={`multi-select-option ${checked ? 'selected' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCategory(cat.id)}
                          />
                          <span className="multi-select-icon">{cat.icon}</span>
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
            <h3>📊 Preview</h3>
            <span className="word-count">{filteredWords.length} words selected</span>
          </div>
          <div className="preview-list">
            {filteredWords.slice(0, 10).map(w => (
              <div key={w.id} className="preview-item">
                <span className="preview-geo">{w.georgian}</span>
                <span className="preview-arrow">→</span>
                <span className="preview-eng">{w.english}</span>
                <span className={`level-badge ${w.level.toLowerCase()}`}>{w.level}</span>
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
            {exporting ? '⏳ Exporting...' : `📥 Export ${filteredWords.length} words`}
          </button>
        </div>

        <div className="export-help">
          <h3>How to import into Anki</h3>
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
    </div>
  );
}

function exportAsCSV(words) {
  const headers = ['Georgian', 'English', 'Level', 'Part of Speech', 'Category', 'Georgian Definition', 'Image URL'];
  const rows = words.map(w => [
    w.georgian,
    w.english,
    w.level,
    w.partOfSpeech,
    w.category,
    w.georgianDefinition,
    `https://source.unsplash.com/400x300/?${encodeURIComponent(w.english)}`,
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, 'georgian_dictionary.csv');
}

function exportAsAnkiTxt(words) {
  const lines = words.map(w => {
    const front = `<div style="font-size:2em;text-align:center;padding:20px;">${w.georgian}</div>
<div style="text-align:center;color:#666;">${w.level} &bull; ${w.partOfSpeech}</div>`;
    const back = `<div style="font-size:1.5em;text-align:center;padding:20px;">${w.english}</div>
<div style="text-align:center;color:#666;">${w.georgianDefinition}</div>
<div style="text-align:center;"><img src="https://source.unsplash.com/400x300/?${encodeURIComponent(w.english)}" /></div>`;
    return `${front}\t${back}`;
  });

  const content = lines.join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, 'georgian_dictionary.txt');
}

function downloadBlob(blob, filename) {
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
