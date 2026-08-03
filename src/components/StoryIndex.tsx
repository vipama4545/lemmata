import { Link } from "react-router-dom";
import { stories } from "../data/stories";
import Icon from "./Icon";

// The list of things to read. Each card leads with the share of its words that resolve to
// a dictionary entry, because that is what decides whether a story is worth opening yet:
// the rest of the text still reads, it just has nothing to offer on a double-click.
function StoryIndex() {
  return (
    <div className="main-content">
      <div className="breadcrumb">
        <Link to="/">← Word of the day</Link>
        <span className="breadcrumb-sep">/</span>
        <span>Stories</span>
      </div>

      <header className="story-index-head">
        <h1 className="story-index-title">
          <Icon name="book" size={22} />
          Stories
        </h1>
        <p className="story-index-sub">Georgian short stories with every word linked back to the dictionary.</p>
      </header>

      {stories.length === 0 ? (
        <p className="empty-note">No stories yet.</p>
      ) : (
        <div className="story-grid">
          {stories.map((story) => {
            const linked = Math.round(story.stats.coverage);
            return (
              <Link key={story.id} to={`/stories/${story.id}`} className="story-card">
                <div className="story-card-head">
                  <h2 className="story-card-title">{story.title}</h2>
                  {story.level && <span className={`level-badge ${story.level.toLowerCase()}`}>{story.level}</span>}
                </div>
                {story.titleEnglish && <p className="story-card-en">{story.titleEnglish}</p>}
                <p className="story-card-excerpt">{story.paragraphs[0]}</p>
                <div className="story-card-stats">
                  <span>{story.stats.tokens} words</span>
                  <span>{story.stats.distinctForms} distinct</span>
                  <span>{linked}% linked</span>
                </div>
                <div className="story-card-bar" aria-hidden="true">
                  <span style={{ width: `${linked}%` }} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default StoryIndex;
