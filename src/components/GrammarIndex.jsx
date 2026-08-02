import { Link } from 'react-router-dom';
import Icon from './Icon';
import { groupedGrammarTopics, grammarTopics } from '../data/grammar';

// The landing page for the reference section: every topic as a card, grouped the same way
// the sidebar groups them.
function GrammarIndex() {
  const groups = groupedGrammarTopics();

  return (
    <div className="main-content">
      <div className="grammar-intro">
        <h1>Grammar</h1>
        <p className="grammar-intro-geo">გრამატიკა</p>
        <p className="grammar-intro-text">
          The machinery behind the word lists: how nouns take their endings, how a verb
          packs a whole sentence into one word, and how the pieces go together.
          {' '}{grammarTopics.length} topics.
        </p>
      </div>

      {groups.map(group => (
        <section key={group.id} className="grammar-group">
          <h2 className="grammar-group-title">{group.label}</h2>
          <div className="grammar-card-grid">
            {group.topics.map(topic => (
              <Link key={topic.id} to={`/grammar/${topic.id}`} className="grammar-card">
                <span className="grammar-card-icon">
                  <Icon name={topic.icon} size={20} />
                </span>
                <span className="grammar-card-text">
                  <span className="grammar-card-title">{topic.title}</span>
                  <span className="grammar-card-geo">{topic.titleGeorgian}</span>
                  <span className="grammar-card-summary">{topic.summary}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default GrammarIndex;
