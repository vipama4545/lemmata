import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from '@/components/ui/page';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { getGrammarTopic, grammarTopics } from '../data/grammar';
// Aliased because this module's own components are called GrammarTopic and GrammarTable.
import type {
  GrammarTable as GrammarTableData,
  GrammarTopic as GrammarTopicData,
} from '../data/grammar';
import { lang } from '../content/store';

/** Prose in a topic is held to a measure — a reference is read, not scanned. */
const PROSE = 'max-w-[72ch]';
/** The two ends of the footer, and the previous/next links on the verb pages. */
export const NAV_LINK = 'flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary';

// One reference topic. A section may carry prose, a table, a bullet list, examples, a
// closing note, or — for the conjugation groups — a list of named blocks; each part is
// optional and they render in a fixed order so every topic reads the same way.
function GrammarTopic() {
  const { topicId } = useParams();
  const topic = getGrammarTopic(topicId);

  if (!topic) {
    return (
      <Page>
        <div className="py-10 text-center">
          <h2 className="mb-2 text-2xl font-bold">Topic not found</h2>
          <Link to={`/${lang()}/grammar`} className="text-primary hover:underline">← Back to grammar</Link>
        </div>
      </Page>
    );
  }

  const topics = grammarTopics();
  const index = topics.indexOf(topic);
  // Undefined at either end of the list — the first topic has no previous, the last no next.
  const previous: GrammarTopicData | undefined = topics[index - 1];
  const next: GrammarTopicData | undefined = topics[index + 1];

  return (
    <Page>
      <Breadcrumb>
        <BreadcrumbLink to={`/${lang()}`}>← Home</BreadcrumbLink>
        <BreadcrumbSeparator />
        <BreadcrumbLink to={`/${lang()}/grammar`}>Grammar</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>{topic.title}</span>
      </Breadcrumb>

      <header className="mb-2.5 flex items-center gap-4">
        <span className="flex size-[46px] shrink-0 items-center justify-center rounded-sm bg-primary-light text-primary">
          <topic.icon className="size-[22px]" aria-hidden="true" />
        </span>
        <div>
          <h1 className="mb-0.5 text-[28px] font-bold">{topic.title}</h1>
          <p className="text-sm text-faint">{topic.titleGeorgian}</p>
        </div>
      </header>

      <p className="mb-7 max-w-[68ch] border-b border-border pb-5 text-[15px] text-muted-foreground">
        {topic.summary}
      </p>

      {topic.sections.map((section, i) => (
        <section key={i} className="mb-8">
          {section.heading && <h2 className="mb-2.5 text-lg font-semibold">{section.heading}</h2>}

          {section.body?.map((paragraph, j) => (
            <p key={j} className={cn(PROSE, 'mb-3')}>{paragraph}</p>
          ))}

          {section.table && <GrammarTable table={section.table} />}

          {section.list && (
            <ul className={cn(PROSE, 'mb-3 ml-5 list-disc [&>li]:mb-1.5')}>
              {section.list.map((item, j) => <li key={j}>{item}</li>)}
            </ul>
          )}

          {section.examples && (
            <ul className="my-3.5 flex flex-col gap-2">
              {section.examples.map((example, j) => (
                <li
                  key={j}
                  className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 rounded-sm border border-border bg-card px-3.5 py-2.5"
                >
                  <span className="text-[17px] font-semibold">{example.ka}</span>
                  <span className="text-muted-foreground">{example.en}</span>
                  {example.note && (
                    <span className="ml-auto text-[13px] italic text-faint max-md:ml-0 max-md:w-full">
                      {example.note}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {section.groups && (
            <div className="flex flex-col gap-2.5">
              {section.groups.map(block => (
                <div key={block.label} className="rounded-sm border border-border bg-card px-4 py-3.5">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Badge variant="tagOutline">{block.label}</Badge>
                    <span className="font-semibold">{block.name}</span>
                    <span className="ml-auto text-[13px] text-faint">{block.count} verbs</span>
                  </div>
                  {block.notes.length > 0 && (
                    <ul className="mt-2 ml-5 list-disc text-sm text-muted-foreground [&>li]:mb-1 [&>li]:whitespace-pre-line">
                      {block.notes.map((note, j) => <li key={j}>{note}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          {section.note && (
            <p className={cn(PROSE, 'mt-3 rounded-r-sm border-l-[3px] border-primary bg-control-hover px-3.5 py-2.5 text-sm text-muted-foreground')}>
              {section.note}
            </p>
          )}
        </section>
      ))}

      <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-5">
        {previous ? (
          <Link to={`/${lang()}/grammar/${previous.id}`} className={NAV_LINK}>
            <ArrowLeft className="size-[18px]" aria-hidden="true" /> {previous.title}
          </Link>
        ) : <span />}
        {next && (
          <Link to={`/${lang()}/grammar/${next.id}`} className={NAV_LINK}>
            {next.title} <ArrowRight className="size-[18px]" aria-hidden="true" />
          </Link>
        )}
      </div>
    </Page>
  );
}

// Tables are scrolled inside their own box rather than pushing the page sideways, the same
// way the conjugation tables are. Georgian columns are marked in the data so they can be
// set in the heavier face used for Georgian throughout the app.
function GrammarTable({ table }: { table: GrammarTableData }) {
  const georgian = new Set(table.georgianColumns || []);

  return (
    <Table
      containerClassName="my-3.5 rounded-sm border border-border bg-card"
      className="min-w-[420px]"
    >
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {table.columns.map((column, i) => (
            <TableHead
              key={i}
              scope="col"
              className={cn(
                'h-auto bg-muted px-3.5 py-2.5 text-xs font-bold tracking-[0.04em] text-muted-foreground uppercase',
                georgian.has(i) && 'normal-case',
              )}
            >
              {column}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {table.rows.map((row, i) => (
          <TableRow key={i} className="hover:bg-transparent">
            {row.map((cell, j) => (
              <TableCell
                key={j}
                // Georgian script is set larger and heavier than the English beside it — at
                // matching sizes the letterforms read as too light.
                className={cn('px-3.5 py-2.5 text-[14.5px]', georgian.has(j) && 'text-[17px] font-semibold')}
              >
                {cell}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default GrammarTopic;
