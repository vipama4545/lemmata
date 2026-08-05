import { Link, useParams } from 'react-router-dom';
import Icon from './Icon';
import { getGrammarTopic, grammarTopics } from '../data/grammar';
// Aliased because this module's own components are called GrammarTopic and GrammarTable.
import type {
  GrammarTable as GrammarTableData,
  GrammarTopic as GrammarTopicData,
} from '../data/grammar';

// One reference topic. A section may carry prose, a table, a bullet list, examples, a
// closing note, or — for the conjugation groups — a list of named blocks; each part is
// optional and they render in a fixed order so every topic reads the same way.
function GrammarTopic() {
  const { topicId } = useParams();
  const topic = getGrammarTopic(topicId);

  if (!topic) {
    return (
      <div className="main-content">
        <div className="not-found">
          <h2>Topic not found</h2>
          <Link to="/grammar">← Back to grammar</Link>
        </div>
      </div>
    );
  }

  const topics = grammarTopics();
  const index = topics.indexOf(topic);
  // Undefined at either end of the list — the first topic has no previous, the last no next.
  const previous: GrammarTopicData | undefined = topics[index - 1];
  const next: GrammarTopicData | undefined = topics[index + 1];

  return (
    <div className="main-content">
      <div className="breadcrumb">
        <Link to="/">← Home</Link>
        <span className="breadcrumb-sep">/</span>
        <Link to="/grammar">Grammar</Link>
        <span className="breadcrumb-sep">/</span>
        <span>{topic.title}</span>
      </div>

      <header className="grammar-header">
        <span className="grammar-header-icon">
          <Icon name={topic.icon} size={22} />
        </span>
        <div>
          <h1>{topic.title}</h1>
          <p className="grammar-header-geo">{topic.titleGeorgian}</p>
        </div>
      </header>

      <p className="grammar-summary">{topic.summary}</p>

      {topic.sections.map((section, i) => (
        <section key={i} className="grammar-section">
          {section.heading && <h2 className="grammar-section-title">{section.heading}</h2>}

          {section.body?.map((paragraph, j) => (
            <p key={j} className="grammar-paragraph">{paragraph}</p>
          ))}

          {section.table && <GrammarTable table={section.table} />}

          {section.list && (
            <ul className="grammar-list">
              {section.list.map((item, j) => <li key={j}>{item}</li>)}
            </ul>
          )}

          {section.examples && (
            <ul className="grammar-examples">
              {section.examples.map((example, j) => (
                <li key={j} className="grammar-example">
                  <span className="grammar-example-ka">{example.ka}</span>
                  <span className="grammar-example-en">{example.en}</span>
                  {example.note && <span className="grammar-example-note">{example.note}</span>}
                </li>
              ))}
            </ul>
          )}

          {section.groups && (
            <div className="grammar-blocks">
              {section.groups.map(block => (
                <div key={block.label} className="grammar-block">
                  <div className="grammar-block-head">
                    <span className="group-tag">{block.label}</span>
                    <span className="grammar-block-name">{block.name}</span>
                    <span className="grammar-block-count">{block.count} verbs</span>
                  </div>
                  {block.notes.length > 0 && (
                    <ul className="grammar-block-notes">
                      {block.notes.map((note, j) => <li key={j}>{note}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          {section.note && <p className="grammar-note">{section.note}</p>}
        </section>
      ))}

      <div className="grammar-footer">
        {previous ? (
          <Link to={`/grammar/${previous.id}`} className="verb-nav-link">
            <Icon name="arrow-left" /> {previous.title}
          </Link>
        ) : <span />}
        {next && (
          <Link to={`/grammar/${next.id}`} className="verb-nav-link verb-nav-next">
            {next.title} <Icon name="arrow-right" />
          </Link>
        )}
      </div>
    </div>
  );
}

// Tables are scrolled inside their own box rather than pushing the page sideways, the same
// way the conjugation tables are. Georgian columns are marked in the data so they can be
// set in the heavier face used for Georgian throughout the app.
function GrammarTable({ table }: { table: GrammarTableData }) {
  const georgian = new Set(table.georgianColumns || []);

  return (
    <div className="grammar-table-wrap">
      <table className="grammar-table">
        <thead>
          <tr>
            {table.columns.map((column, i) => (
              <th key={i} scope="col" className={georgian.has(i) ? 'ka' : ''}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={georgian.has(j) ? 'ka' : ''}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default GrammarTopic;
