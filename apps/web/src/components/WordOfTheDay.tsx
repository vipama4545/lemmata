import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, Calendar, Download, LayoutGrid, Search, Table, WalletCards } from "lucide-react";
import type { Screeve, ScreeveForms, KaVerb } from "@georgian/shared/types";
import { PERSONS, SCREEVES } from "@georgian/shared/grammar/ka";
import { Badge } from "@/components/ui/badge";
import { Page, SectionHeading } from "@/components/ui/page";
import { LevelBadge, PosTag } from "@/components/ui/word-card";
import { cn } from "@/lib/utils";
import { derived, kaVerbData, lang } from '../content/store';
import { wordForDate, previousDays, isoDay } from "../utils/dailyWord";
import { getWordImage, creditLine } from "../utils/images";
import { focusHref } from "../utils/scroll";

const FULL_DATE: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
const SHORT_DATE: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
const PAST_DAYS = 4;

/* The two cards share a shape: a bordered panel on the surface, laid out as a grid so the
   picture can take a column beside the text when there is one and there is room for both. */
const CARD = "grid gap-6 rounded-lg border-2 border-border bg-card p-7 shadow-card max-md:gap-[18px] max-md:p-5";
const HEAD = "mb-3.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1";
/* h1 on the word, h2 on the verb below it — one page heading, but the two sections read as
   a pair, so they are styled alike. */
const HEAD_TITLE = "flex items-center gap-2.5 text-[22px] font-bold [&>svg]:text-primary";
const GEORGIAN = "text-[44px] leading-[1.15] font-bold wrap-anywhere max-md:text-[34px]";
/* The link out of a card: a pill in the accent colour that fills in under the cursor. */
const CARD_LINK =
  "mt-2 inline-flex items-center gap-1.5 self-start justify-self-start rounded-[20px] bg-primary-glow px-4 py-2 text-sm font-medium text-primary transition-all hover:bg-primary hover:text-primary-foreground";

// Verbs get a card of their own below, drawn from the conjugation spreadsheet rather than
// from the scraped dictionary, so they are kept out of the word pick: a words.json entry
// tagged Verb is a conjugated form (აარსებს "establishes") and belongs to that card, not
// this one. Verbal nouns stay — a masdar is a headword noun, which is why the tagging
// convention gives it its own tag rather than filing it under Verb.
//
// Filtered once at module scope, because the pick is a permutation of the whole list: a
// list rebuilt per mount would still be the same words in the same order, but there is no
// reason to redo it, and the run cache is keyed by length.
const DAILY_WORDS = derived(content => content.words.words.filter(word => word.partOfSpeech !== "Verb"));

// The landing page: one word and one verb, both picked from the date. The picks are
// computed once per mount — nobody leaves the tab open across midnight, and a card that is
// a few hours stale is better than one that swaps itself out while it is being read.
function WordOfTheDay() {
  const { today, word, verb, earlierWords, earlierVerbs } = useMemo(() => {
    const now = new Date();
    return {
      today: now,
      word: wordForDate(DAILY_WORDS(), now),
      verb: wordForDate(kaVerbData().verbs, now),
      earlierWords: previousDays(DAILY_WORDS(), now, PAST_DAYS).map(({ date, word: past }) => ({
        date,
        to: focusHref(`/category/${past.categoryId}`, past.id),
        headword: past.headword,
        english: past.english,
      })),
      earlierVerbs: previousDays(kaVerbData().verbs, now, PAST_DAYS).map(({ date, word: past }) => ({
        date,
        to: `/verbs/${past.id}`,
        headword: headword(past) || past.english,
        // The card would otherwise print the English twice for the handful of verbs the
        // spreadsheet gives no Georgian headword at all.
        english: headword(past) ? past.english : "",
      })),
    };
  }, []);

  if (!word) return null;

  const image = getWordImage(word);

  return (
    <Page>
      <section className="mb-8" aria-labelledby="daily-heading">
        <div className={HEAD}>
          <h1 id="daily-heading" className={HEAD_TITLE}>
            <Calendar className="size-5" aria-hidden="true" />
            Word of the day
          </h1>
          <time className="text-sm text-muted-foreground" dateTime={isoDay(today)}>
            {today.toLocaleDateString(undefined, FULL_DATE)}
          </time>
        </div>

        {/* The picture goes back above the word once two columns would be too narrow. */}
        <div className={cn(CARD, image && "items-start md:grid-cols-[240px_minmax(0,1fr)]")}>
          {image && (
            <figure>
              <img
                src={image.url}
                alt={word.english}
                className="block aspect-[4/3] w-full rounded-sm bg-muted object-cover"
              />
              {/* Attribution required by the CC licences the Wikimedia images are published under. */}
              <figcaption className="px-0.5 pt-1.5 text-center text-[11px] leading-snug wrap-anywhere text-faint [&_a]:underline">
                <a href={image.page} target="_blank" rel="noopener noreferrer">
                  {image.title}
                </a>
                {creditLine(image) && <> · {creditLine(image)}</>}
              </figcaption>
            </figure>
          )}

          <div className="flex flex-col items-start gap-2">
            <div className="flex items-center gap-2">
              <LevelBadge level={word.level} />
              <PosTag>{word.partOfSpeech}</PosTag>
            </div>
            <p className={GEORGIAN}>{word.headword}</p>
            <p className="text-xl text-muted-foreground max-md:text-lg">{word.english}</p>
            {word.definition && <p className="text-[15px] leading-relaxed text-faint">{word.definition}</p>}
            {word.englishFull.length > 1 && (
              <p className="text-sm text-faint">
                <span className="font-semibold text-muted-foreground">Also</span>{" "}
                {word.englishFull.slice(1).join(" · ")}
              </p>
            )}
            <Link className={CARD_LINK} to={focusHref(`/category/${word.categoryId}`, word.id)}>
              {word.category}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {verb && <VerbOfTheDay verb={verb} />}

      <EarlierDays id="earlier-words-heading" title="Earlier words" entries={earlierWords} />
      <EarlierDays id="earlier-verbs-heading" title="Earlier verbs" entries={earlierVerbs} />

      <div className="flex flex-wrap justify-center gap-4">
        <QuickLink to={`/${lang()}/categories`} gradient="from-amber-500 to-red-500">
          <LayoutGrid className="size-[18px]" aria-hidden="true" /> Browse Categories
        </QuickLink>
        <QuickLink to={`/${lang()}/flashcards`} gradient="from-blue-500 to-indigo-500">
          <WalletCards className="size-[18px]" aria-hidden="true" /> Flashcard Mode
        </QuickLink>
        <QuickLink to={`/${lang()}/search`} gradient="from-sky-500 to-cyan-500">
          <Search className="size-[18px]" aria-hidden="true" /> Word Search
        </QuickLink>
        <QuickLink to={`/${lang()}/export`} gradient="from-green-500 to-teal-500">
          <Download className="size-[18px]" aria-hidden="true" /> Export Anki Deck
        </QuickLink>
        <QuickLink to={`/${lang()}/grammar`} gradient="from-violet-500 to-fuchsia-500">
          <BookOpen className="size-[18px]" aria-hidden="true" /> Grammar Reference
        </QuickLink>
      </div>
    </Page>
  );
}

/** One of the five ways on from the landing page. Each carries a gradient of its own so the
    row reads as five destinations rather than five instances of the same button. */
function QuickLink({ to, gradient, children }: { to: string; gradient: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg bg-linear-[135deg] px-6 py-3 text-[15px] font-medium text-white transition-all hover:-translate-y-0.5 hover:shadow-pop",
        gradient,
      )}
    >
      {children}
    </Link>
  );
}

/** One past day in the strip below a card: what was picked, and where it lives. */
interface EarlierEntry {
  date: Date;
  to: string;
  headword: string;
  english: string;
}

// The last few days of one of the two picks. Words and verbs go to different pages, so the
// entries arrive with their own link already worked out; everything else about the two
// strips is the same, down to the shape of the card.
function EarlierDays({ id, title, entries }: { id: string; title: string; entries: EarlierEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <section className="mb-8" aria-labelledby={id}>
      <SectionHeading id={id}>{title}</SectionHeading>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 max-md:grid-cols-[repeat(auto-fill,minmax(140px,1fr))]">
        {entries.map(entry => (
          <Link
            key={isoDay(entry.date)}
            to={entry.to}
            className="flex flex-col gap-0.5 rounded-sm border-2 border-border bg-card px-3.5 py-3 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-card"
          >
            <time className="text-[11px] tracking-[0.04em] text-faint uppercase" dateTime={isoDay(entry.date)}>
              {entry.date.toLocaleDateString(undefined, SHORT_DATE)}
            </time>
            <span className="text-[17px] font-semibold wrap-anywhere">{entry.headword}</span>
            {entry.english && <span className="text-[13px] text-muted-foreground">{entry.english}</span>}
          </Link>
        ))}
      </div>
    </section>
  );
}

// The day's verb, under the day's word. It carries no CEFR level and no picture — the
// conjugation spreadsheet has neither — so what it shows instead is the paradigm: the
// headword, and one screeve across all six persons. Everything else is a click away.
function VerbOfTheDay({ verb }: { verb: KaVerb }) {
  const paradigm = dailyScreeve(verb);
  const name = headword(verb);

  return (
    <section className="mb-8" aria-labelledby="verb-daily-heading">
      <div className={HEAD}>
        <h2 id="verb-daily-heading" className={HEAD_TITLE}>
          <Table className="size-5" aria-hidden="true" />
          Verb of the day
        </h2>
      </div>

      {/* One column of its own regardless of the width: headword, then the paradigm strip. */}
      <div className={cn(CARD, "gap-5")}>
        <div className="flex flex-col items-start gap-2">
          <div className="flex items-center gap-2">
            {verb.group && <Badge variant="tagOutline">{verb.group}</Badge>}
            {verb.transitivity && <PosTag>{verb.transitivity}</PosTag>}
          </div>
          <p className={GEORGIAN}>{name || verb.english}</p>
          {name && <p className="text-xl text-muted-foreground max-md:text-lg">{verb.english}</p>}
          {verb.senses.length > 0 && (
            <p className="text-sm text-faint">
              <span className="font-semibold text-muted-foreground">Also</span> {verb.senses.join(" · ")}
            </p>
          )}
        </div>

        {paradigm && (
          <div className="border-t-2 border-border pt-[18px]">
            <p className="mb-3 text-[11px] font-semibold tracking-[0.04em] text-faint uppercase">
              {paradigm.screeve.label}
            </p>
            {/* Three across, so the six persons fall into the two rows a paradigm is read in:
                the singular on top, the plural under it. Two still fit on a phone; three do not. */}
            <div className="grid grid-cols-3 gap-x-5 gap-y-3.5 max-md:grid-cols-2 max-md:gap-x-3.5 max-md:gap-y-3">
              {PERSONS.map(person => {
                const form = paradigm.forms[person.key];
                return form ? (
                  <div key={person.key} className="flex flex-col gap-px">
                    <span className="text-xs text-faint">{person.pronoun}</span>
                    <span className="text-[19px] font-semibold wrap-anywhere max-md:text-[17px]">{form}</span>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        )}

        <Link className={cn(CARD_LINK, "mt-0")} to={`/${lang()}/verbs/${verb.id}`}>
          Full conjugation
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

/**
 * The Georgian form to show a verb by: its verbal noun, which is the headword a dictionary
 * would list it under, or the third person present for the handful of entries the
 * spreadsheet leaves without one. Empty when it has neither.
 */
function headword(verb: KaVerb): string {
  return verb.verbalNoun || verb.present3sg;
}

/**
 * The screeve to show on the card: the present, or — for the few defective paradigms that
 * lack one — the first screeve the verb does fill in. SCREEVES is in the
 * conventional order, present first, so the search only has to run down it.
 */
function dailyScreeve(verb: KaVerb): { screeve: Screeve; forms: ScreeveForms } | null {
  for (const screeve of SCREEVES) {
    const forms = verb.forms[screeve.key];
    if (forms) return { screeve, forms };
  }
  return null;
}

export default WordOfTheDay;
