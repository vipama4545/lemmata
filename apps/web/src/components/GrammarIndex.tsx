import { Link } from 'react-router-dom';
import { Page } from '@/components/ui/page';
import { groupedGrammarTopics, grammarTopics } from '../data/grammar';
import { lang } from '../content/store';

// The landing page for the reference section: every topic as a card, grouped the same way
// the sidebar groups them.
function GrammarIndex() {
  const groups = groupedGrammarTopics();

  return (
    <Page>
      <div className="mb-7">
        <h1 className="text-3xl font-bold">Grammar</h1>
        <p className="mb-2.5 text-sm text-faint">გრამატიკა</p>
        <p className="max-w-[62ch] text-muted-foreground">
          The machinery behind the word lists: how nouns take their endings, how a verb
          packs a whole sentence into one word, and how the pieces go together.
          {' '}{grammarTopics().length} topics.
        </p>
      </div>

      {groups.map(group => (
        <section key={group.id} className="mb-7">
          <h2 className="mb-3 text-[13px] font-bold tracking-[0.06em] text-faint uppercase">{group.label}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3.5 max-md:grid-cols-1">
            {group.topics.map(topic => (
              <Link
                key={topic.id}
                to={`/${lang()}/grammar/${topic.id}`}
                className="flex gap-3.5 rounded-lg border-2 border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-pop"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-primary-light text-primary">
                  <topic.icon className="size-5" aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-base font-semibold">{topic.title}</span>
                  <span className="text-[13px] text-faint">{topic.titleGeorgian}</span>
                  <span className="mt-1 text-[13.5px] text-muted-foreground">{topic.summary}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </Page>
  );
}

export default GrammarIndex;
