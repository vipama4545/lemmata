import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import verbData from '../data/verbs.json';
import { useEntryState } from '../utils/entryState';
import Icon from './Icon';

// The verb index. Verbs are listed by their verbal noun — the form a dictionary would
// use as the headword — next to the third person singular of the present, which is the
// form you actually meet in a sentence. Everything else lives on the verb's own page.
function VerbList() {
  // The filters are remembered per history entry: opening a verb and coming back to a list
  // of all 1,300 rather than the six you had narrowed it to loses your place even when the
  // scroll position is restored exactly.
  const [search, setSearch] = useEntryState('search', '');
  const [groupId, setGroupId] = useEntryState('group', 'all');
  const [showTranslation, setShowTranslation] = useState(true);

  const filteredVerbs = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return verbData.verbs.filter(verb => {
      if (groupId !== 'all' && verb.groupId !== groupId) return false;
      if (!needle) return true;
      return (
        verb.english.toLowerCase().includes(needle) ||
        verb.verbalNoun.includes(needle) ||
        verb.present3sg.includes(needle) ||
        verb.synonymsEnglish.some(s => s.toLowerCase().includes(needle)) ||
        verb.synonymsGeorgian.some(s => s.includes(needle))
      );
    });
  }, [search, groupId]);

  return (
    <div className="main-content">
      <div className="breadcrumb">
        <Link to="/categories">← Categories</Link>
        <span className="breadcrumb-sep">/</span>
        <span>Verbs</span>
      </div>

      <div className="category-header">
        <span className="category-thumb category-thumb-sm category-thumb-letter" aria-hidden="true">ზ</span>
        <div className="category-header-text">
          <h1>Verbs</h1>
          <p className="category-header-geo">ზმნები</p>
          <span className="word-count">{filteredVerbs.length} verbs</span>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-field">
          <Icon name="search" />
          <input
            type="text"
            className="search-input"
            placeholder="Filter verbs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="group-select">
          <span className="group-select-label">Group</span>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="all">All groups ({verbData.verbs.length})</option>
            {verbData.groups.map(group => (
              <option key={group.id} value={group.id}>
                {group.label} — {group.name} ({group.verbCount})
              </option>
            ))}
          </select>
        </label>
        <button
          className="toggle-btn"
          onClick={() => setShowTranslation(!showTranslation)}
        >
          <Icon name={showTranslation ? 'eye-off' : 'eye'} />
          {showTranslation ? 'Hide translations' : 'Show translations'}
        </button>
      </div>

      <div className="verb-list">
        <div className="verb-list-head">
          <span className="verb-col-group">Group</span>
          <span className="verb-col-noun">Verbal noun</span>
          <span className="verb-col-third">3rd person sg. present</span>
          <span className="verb-col-english">English</span>
        </div>

        {filteredVerbs.map(verb => (
          <Link key={verb.id} to={`/verbs/${verb.id}`} className="verb-card">
            <span className="verb-col-group">
              <span className="group-tag">{verb.group || '—'}</span>
            </span>
            <span className="verb-col-noun verb-georgian">{verb.verbalNoun || '—'}</span>
            <span className="verb-col-third verb-georgian">{verb.present3sg || '—'}</span>
            <span className="verb-col-english">
              {showTranslation && (
                <>
                  {verb.english}
                  {verb.transitivity && <em className="verb-transitivity"> {verb.transitivity}</em>}
                </>
              )}
            </span>
            <Icon name="arrow-right" className="verb-card-arrow" />
          </Link>
        ))}

        {filteredVerbs.length === 0 && (
          <p className="empty-note">No verbs match that filter.</p>
        )}
      </div>
    </div>
  );
}

export default VerbList;
