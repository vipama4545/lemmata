import { useState, useMemo } from 'react';
import { ChevronDown, Download, List } from 'lucide-react';
import type { Category, Level, LevelFilter, Word } from '@georgian/shared/types';
import { PERSONS, SCREEVES } from '@georgian/shared/grammar/ka';
import { Checkbox } from '@/components/ui/checkbox';
import { LevelTabs } from '@/components/ui/level-tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from '@/components/ui/page';
import { LevelBadge } from '@/components/ui/word-card';
import { cn } from '@/lib/utils';
import { derived, kaVerbData, kaVerbsOf, lang } from '../content/store';
import { getWordImage } from '../utils/images';
import CategoryThumb from './CategoryThumb';

/**
 * A row in the flashcard export. Verbs are folded in alongside the dictionary words, and
 * carry no CEFR level of their own — which is what the empty string in `level` means.
 * Only the fields a card actually prints are required, so a verb does not have to be
 * dressed up as a full lexicon entry to be exported.
 */
type ExportWord = Pick<Word, 'id' | 'headword' | 'english' | 'definition' | 'partOfSpeech' | 'category' | 'categoryId'>
  & { level: Level | '' };

// Verbs join the ordinary export as one more category, carrying only their headword: the
// verbal noun, the English, and the third person singular of the present. The full
// paradigm is far too wide for a flashcard and has its own download below.
const verbCategory = derived<Category>(content => ({
  id: 'verbs',
  lang: content.lang,
  name: 'Verbs',
  nameNative: 'ზმნები',
  wordCount: kaVerbsOf(content).length,
}));

const verbsAsWords = derived<ExportWord[]>(content =>
  kaVerbsOf(content).map(verb => ({
    id: `verb-${verb.id}`,
    headword: verb.verbalNoun,
    english: verb.english,
    level: '',
    partOfSpeech: 'verb',
    category: verbCategory().name,
    categoryId: verbCategory().id,
    definition: verb.present3sg,
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
    <Page className="max-w-[800px]">
      <Breadcrumb>
        <BreadcrumbLink to={`/${lang()}`}>← Home</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>Export for Anki</span>
      </Breadcrumb>

      <h1 className="mb-2 text-[28px] font-bold">Export for Anki</h1>
      <p className={LEAD}>
        Select which words to export, then download them as a CSV or tab-separated file
        ready to import into Anki.
      </p>

      <div className={CARD}>
        <div className="flex flex-col gap-4">
          <FilterRow label="CEFR Level">
            <LevelTabs value={levelFilter} onChange={setLevelFilter} />
          </FilterRow>

          <FilterRow label="Category">
            {/* A Popover rather than a hand-rolled dropdown: dismissal, focus return and the
                Escape key come with it, and the mousedown listener this used to keep on the
                document goes away with them. */}
            <Popover open={categoryDropdownOpen} onOpenChange={setCategoryDropdownOpen}>
              <PopoverTrigger asChild>
                <button className="flex w-full cursor-pointer items-center justify-between rounded-sm border-2 border-border bg-card px-3 py-2 text-sm transition-colors hover:border-primary">
                  <span className="truncate">
                    {allSelected
                      ? 'All Categories'
                      : `${selectedCategories.length} categor${selectedCategories.length === 1 ? 'y' : 'ies'} selected`}
                  </span>
                  <ChevronDown
                    className={cn(
                      'ml-2 size-[18px] shrink-0 text-faint transition-transform',
                      categoryDropdownOpen && 'rotate-180',
                    )}
                    aria-hidden="true"
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="flex max-h-90 w-[var(--radix-popover-trigger-width)] flex-col rounded-sm border-2 p-0 shadow-pop"
              >
                <div className="flex shrink-0 gap-2 border-b border-border p-2">
                  <button className={PICKER_ACTION} onClick={selectAll}>Select All</button>
                  <button className={PICKER_ACTION} onClick={deselectAll}>Deselect All</button>
                </div>
                <div className="overflow-y-auto p-1">
                  {exportCategories().map(cat => {
                    const checked = allSelected || selectedCategories.includes(cat.id);
                    return (
                      <label
                        key={cat.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-[6px] p-2 text-sm transition-colors hover:bg-muted',
                          checked && 'bg-primary-glow',
                        )}
                      >
                        <Checkbox checked={checked} onCheckedChange={() => toggleCategory(cat.id)} />
                        <CategoryThumb category={cat} size="xs" />
                        <span className="flex-1 truncate">{cat.name}</span>
                        <span className="shrink-0 text-xs text-faint">{cat.wordCount}</span>
                      </label>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </FilterRow>

          <FilterRow label="Export Format">
            <div className="flex flex-wrap gap-4">
              <FormatOption
                on={format === 'csv'}
                onSelect={() => setFormat('csv')}
                title="CSV"
                hint="Comma-separated, best for Anki's File → Import"
              />
              <FormatOption
                on={format === 'txt'}
                onSelect={() => setFormat('txt')}
                title="Tab-separated (.txt)"
                hint="With HTML formatting for rich Anki cards"
              />
            </div>
          </FilterRow>
        </div>

        <div className={PANEL}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className={PANEL_TITLE}><List className="size-[18px]" aria-hidden="true" /> Preview</h3>
            <span className="font-medium text-primary">{filteredWords.length} words selected</span>
          </div>
          <div className="max-h-80 overflow-y-auto rounded-sm border border-border">
            {filteredWords.slice(0, 10).map(w => (
              <div
                key={w.id}
                className="flex items-center gap-3 border-b border-border px-4 py-2.5 transition-colors last:border-b-0 hover:bg-muted"
              >
                <span className="min-w-[140px] text-lg font-semibold">{w.headword}</span>
                <span className="text-faint">→</span>
                <span className="flex-1 text-sm text-muted-foreground">{w.english}</span>
                {w.level && <LevelBadge level={w.level} />}
              </div>
            ))}
            {filteredWords.length > 10 && (
              <p className="p-3 text-center text-[13px] text-faint">…and {filteredWords.length - 10} more</p>
            )}
          </div>
        </div>

        <div className="flex justify-center">
          <button
            className={cn(EXPORT_BUTTON, 'px-8 py-3.5 text-base')}
            onClick={handleExport}
            disabled={exporting || filteredWords.length === 0}
          >
            {exporting
              ? 'Exporting…'
              : <><Download className="size-[18px]" aria-hidden="true" /> Export {filteredWords.length} words</>}
          </button>
        </div>

        <div className={PANEL}>
          <h3 className="mb-3 text-base font-semibold">How to import into Anki</h3>
          <p className={LEAD}>
            Verbs export as their verbal noun and English, with the third person singular
            of the present in the definition column. Their conjugations are not included —
            use the full verb database below for those.
          </p>
          <ol className="list-decimal pl-6 text-sm leading-[1.8] text-muted-foreground [&>li]:mb-1">
            <li>Download the file using the button above.</li>
            <li>Open Anki and choose your deck (or create a new one).</li>
            <li>Go to <strong>File → Import…</strong></li>
            <li>Select the downloaded file.</li>
            <li>
              In the import dialog:
              <ul className="mt-1 list-disc pl-5">
                <li>Set <strong>Type</strong> to the number of fields (2 for CSV: Georgian, English)</li>
                <li>Enable <strong>Front: Column 1</strong> (Georgian), <strong>Back: Column 2</strong> (English)</li>
              </ul>
            </li>
            <li>Click <strong>Import</strong>.</li>
          </ol>
        </div>
      </div>

      <h2 className="mt-10 mb-2 text-[22px] font-bold">Verb database</h2>
      <p className={LEAD}>
        The whole conjugation sheet as one CSV: a row per verb, a column for every person
        of every screeve, plus the imperative, the synonyms and the source link. This is a
        reference dump rather than a flashcard deck.
      </p>

      <div className={CARD}>
        <div className={PANEL}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className={PANEL_TITLE}><List className="size-[18px]" aria-hidden="true" /> Contents</h3>
            <span className="font-medium text-primary">{kaVerbData().verbs.length} verbs</span>
          </div>
          <ul className="flex list-none flex-col gap-1.5 text-sm text-muted-foreground [&>li]:before:mr-2 [&>li]:before:text-faint [&>li]:before:content-['·']">
            <li>{SCREEVES.length} screeves × {PERSONS.length} persons</li>
            <li>Imperative and prohibitive</li>
            <li>Verbal noun and conjugation group</li>
            <li>English and Georgian synonyms</li>
          </ul>
        </div>

        <div className="flex justify-center">
          <button className={EXPORT_BUTTON} onClick={exportVerbConjugations}>
            <Download className="size-[18px]" aria-hidden="true" /> Export all {kaVerbData().verbs.length} verb conjugations
          </button>
        </div>
      </div>
    </Page>
  );
}

const LEAD = 'mb-6 text-muted-foreground';
const CARD = 'flex flex-col gap-6 rounded-lg border-2 border-border bg-card p-6';
/* A band inside the card, ruled off from the one above rather than boxed again. */
const PANEL = 'border-t border-border pt-5';
const PANEL_TITLE = 'flex items-center gap-2 text-base font-semibold';
const PICKER_ACTION =
  'cursor-pointer rounded-[6px] bg-muted px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary-glow';
/* The one gradient button in the app: downloading is the point of this page, and it is the
   only control on it that produces a file. */
const EXPORT_BUTTON =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-sm bg-[linear-gradient(135deg,#3b82f6,#6366f1)] px-5 py-2.5 text-sm font-medium text-white transition-all ' +
  'hover:not-disabled:-translate-y-px hover:not-disabled:shadow-card disabled:cursor-not-allowed disabled:opacity-50';

/** One labelled control in the filter stack. */
function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 max-md:flex-col max-md:items-start max-md:*:w-full">
      <span className="min-w-25 text-sm font-semibold">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** A radio in the shape of a card, so the format and what it is for are read together. */
function FormatOption({
  on,
  onSelect,
  title,
  hint,
}: {
  on: boolean;
  onSelect: () => void;
  title: string;
  hint: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-sm border-2 px-3 py-2 transition-all',
        on ? 'border-primary bg-primary-glow' : 'border-border',
      )}
    >
      <input
        type="radio"
        name="format"
        checked={on}
        onChange={onSelect}
        className="accent-primary"
      />
      <span className="flex flex-col gap-0.5">
        <strong className="text-sm">{title}</strong>
        <span className="text-xs text-faint">{hint}</span>
      </span>
    </label>
  );
}

// One row per verb, one column per person-and-screeve — the shape the spreadsheet has,
// flattened so a column header names exactly what is under it ("Aorist 3sg").
function buildVerbConjugationCsv() {
  const { verbs } = kaVerbData();
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
    w.headword,
    w.english,
    w.level,
    w.partOfSpeech,
    w.category,
    w.definition,
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
      `<div style="font-size:2em;text-align:center;padding:20px;">${w.headword}</div>` +
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
      `<div style="text-align:center;color:#666;">${w.definition}</div>` +
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
