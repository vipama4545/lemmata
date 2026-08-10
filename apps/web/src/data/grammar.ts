// Reference grammar. Unlike the lexicon and the paradigms this is hand-written rather than
// scraped, so it lives as a module: the two verb topics build their tables from the screeve
// and series constants and from the loaded dictionary, instead of restating either here.
//
// A topic is a list of sections, and a section may carry any combination of prose
// (`body`), a `table`, a bullet `list`, `examples`, and a closing `note`. GrammarTopic
// renders whichever of those are present, in that order.
//
// `georgianColumns` marks which table columns hold Georgian script so the renderer can
// set them in the larger, heavier face the rest of the app uses for Georgian.

import type { LucideIcon } from 'lucide-react';
import { BookOpen, Clock, Hash, Layers, Link2, MessageCircle, Table, Type, Users } from 'lucide-react';
import type { Screeve, ScreeveKey, KaVerb } from '@georgian/shared/types';
import { SCREEVES, SERIES } from '@georgian/shared/grammar/ka';
import { derived, kaGroupsOf, kaVerbsOf } from '../content/store';

/** A table in a section. `georgianColumns` holds the indices of the Georgian columns. */
export interface GrammarTable {
  columns: string[];
  rows: string[][];
  georgianColumns?: number[];
}

export interface GrammarExample {
  ka: string;
  en: string;
  note?: string;
}

/** One conjugation group, as the verb-groups topic lists them. */
export interface GrammarBlock {
  label: string;
  name: string;
  count: number;
  notes: string[];
}

/** Every part is optional; GrammarTopic renders whichever are present, in this order. */
export interface GrammarSection {
  heading?: string;
  body?: string[];
  table?: GrammarTable;
  list?: string[];
  examples?: GrammarExample[];
  groups?: GrammarBlock[];
  note?: string;
}

export interface GrammarTopic {
  id: string;
  title: string;
  titleGeorgian: string;
  /** The id of the group in `grammarGroups` this topic belongs under. */
  group: string;
  icon: LucideIcon;
  summary: string;
  sections: GrammarSection[];
}

export interface GrammarGroup {
  id: string;
  label: string;
}

export interface GrammarGroupWithTopics extends GrammarGroup {
  topics: GrammarTopic[];
}

export const grammarGroups: GrammarGroup[] = [
  { id: 'writing', label: 'Writing & sounds' },
  { id: 'nouns', label: 'Nouns & phrases' },
  { id: 'verbs', label: 'Verbs' },
  { id: 'sentences', label: 'Sentences' },
];

const alphabet: GrammarTopic = {
  id: 'alphabet',
  title: 'The alphabet',
  titleGeorgian: 'ანბანი',
  group: 'writing',
  icon: Type,
  summary: 'All 33 letters of Mkhedruli, their names, and the sounds they stand for.',
  sections: [
    {
      body: [
        'Georgian is written in Mkhedruli, an alphabet of 33 letters with no capital letters and no silent letters: every letter is one sound and every sound is one letter, so once you know the alphabet you can read any word aloud.',
        'The one thing English does not prepare you for is the ejectives — consonants made with a closed throat and a small pop of air. Each of them has an ordinary aspirated partner, and swapping the two changes the word: კარი (kʼari) is a door, ქარი (kʰari) is wind.',
      ],
      table: {
        columns: ['Letter', 'Name', 'Sound', 'Notes'],
        georgianColumns: [0],
        rows: [
          ['ა', 'an', 'a', 'as in "father"'],
          ['ბ', 'ban', 'b', ''],
          ['გ', 'gan', 'g', 'always hard, as in "go"'],
          ['დ', 'don', 'd', ''],
          ['ე', 'en', 'e', 'as in "bed"'],
          ['ვ', 'vin', 'v', ''],
          ['ზ', 'zen', 'z', ''],
          ['თ', 'tan', 'tʰ', 'aspirated t, as in "top"'],
          ['ი', 'in', 'i', 'as in "machine"'],
          ['კ', 'kʼan', 'kʼ', 'ejective k'],
          ['ლ', 'las', 'l', ''],
          ['მ', 'man', 'm', ''],
          ['ნ', 'nar', 'n', ''],
          ['ო', 'on', 'o', 'as in "sort"'],
          ['პ', 'pʼar', 'pʼ', 'ejective p'],
          ['ჟ', 'zhan', 'ʒ', 'like the s in "measure"'],
          ['რ', 'rae', 'r', 'tapped or trilled'],
          ['ს', 'san', 's', ''],
          ['ტ', 'tʼar', 'tʼ', 'ejective t'],
          ['უ', 'un', 'u', 'as in "flute"'],
          ['ფ', 'par', 'pʰ', 'aspirated p, as in "pot"'],
          ['ქ', 'kan', 'kʰ', 'aspirated k, as in "cat"'],
          ['ღ', 'ghan', 'ɣ', 'voiced, like the Parisian French r'],
          ['ყ', 'qʼar', 'qʼ', 'ejective, made far back in the throat'],
          ['შ', 'shin', 'ʃ', 'as in "shoe"'],
          ['ჩ', 'chin', 'tʃʰ', 'aspirated ch, as in "chair"'],
          ['ც', 'tsan', 'tsʰ', 'aspirated ts, as in "cats"'],
          ['ძ', 'dzil', 'dz', 'as in "adze"'],
          ['წ', 'tsʼil', 'tsʼ', 'ejective ts'],
          ['ჭ', 'chʼar', 'tʃʼ', 'ejective ch'],
          ['ხ', 'khan', 'x', 'as in Scottish "loch"'],
          ['ჯ', 'jan', 'dʒ', 'as in "jam"'],
          ['ჰ', 'hae', 'h', ''],
        ],
      },
    },
    {
      heading: 'Consonant clusters',
      body: [
        'Georgian allows runs of consonants that look impossible on the page — გვ-, მკ-, ფრცქვ- — but each letter keeps its own sound and none of them is dropped. Say them slowly and in order rather than looking for a vowel to lean on.',
      ],
      examples: [
        { ka: 'გვარი', en: 'surname' },
        { ka: 'მთვარე', en: 'moon' },
        { ka: 'ბრძანება', en: 'order, command' },
      ],
    },
  ],
};

const nounCases: GrammarTopic = {
  id: 'noun-cases',
  title: 'Noun cases',
  titleGeorgian: 'ბრუნვები',
  group: 'nouns',
  icon: Table,
  summary: 'The seven cases, their endings, and the case each verb series asks for.',
  sections: [
    {
      body: [
        'Georgian has seven cases. The ending on a noun tells you what it does in the sentence, which is why word order can move around so freely — the roles travel with the nouns, not with their position.',
        'Endings attach to the stem. Stems ending in a consonant (კაც- "man") take the full ending; stems ending in a vowel (დედა "mother") often lose that vowel before the ending, or take a shortened form of it.',
      ],
      table: {
        columns: ['Case', 'Georgian', 'Ending', 'კაც- (man)', 'დედა (mother)'],
        georgianColumns: [3, 4],
        rows: [
          ['Nominative', 'სახელობითი', '-ი', 'კაცი', 'დედა'],
          ['Ergative', 'მოთხრობითი', '-მა / -მ', 'კაცმა', 'დედამ'],
          ['Dative', 'მიცემითი', '-ს', 'კაცს', 'დედას'],
          ['Genitive', 'ნათესაობითი', '-ის / -ს', 'კაცის', 'დედის'],
          ['Instrumental', 'მოქმედებითი', '-ით / -თ', 'კაცით', 'დედით'],
          ['Adverbial', 'ვითარებითი', '-ად / -დ', 'კაცად', 'დედად'],
          ['Vocative', 'წოდებითი', '-ო / -ვ', 'კაცო', 'დედავ'],
        ],
      },
      note: 'დედა loses its final -ა before the genitive, instrumental and adverbial endings. Stems in -ე behave the same way.',
    },
    {
      heading: 'What each case does',
      list: [
        'Nominative — the citation form, and the subject of most sentences in the present.',
        'Ergative — the subject of a transitive verb in the aorist series. It exists for no other purpose, which makes it the clearest signal that you are in the past.',
        'Dative — the indirect object ("to whom"), the direct object in the present, and the subject of verbs of feeling and having.',
        'Genitive — possession and belonging: კაცის სახლი, "the man\'s house".',
        'Instrumental — the means: კალმით ვწერ, "I write with a pen".',
        'Adverbial — turning into, acting as, or the manner of something: ექიმად მუშაობს, "he works as a doctor"; ქართულად, "in Georgian".',
        'Vocative — calling someone: კაცო! ბიჭებო!',
      ],
    },
    {
      heading: 'Case follows the verb series',
      body: [
        'This is the part that surprises learners: for a transitive verb, the case of the subject and the object changes depending on which tense series the verb is in. The same three people can wear three different sets of endings.',
      ],
      table: {
        columns: ['Series', 'Subject', 'Direct object', 'Indirect object'],
        rows: [
          ['I — present, future', 'Nominative', 'Dative', 'Dative'],
          ['II — aorist', 'Ergative', 'Nominative', 'Dative'],
          ['III — perfect', 'Dative', 'Nominative', 'genitive + -თვის'],
        ],
      },
      examples: [
        { ka: 'ბიჭი წერს წერილს', en: 'the boy writes a letter', note: 'Series I — nominative subject, dative object' },
        { ka: 'ბიჭმა დაწერა წერილი', en: 'the boy wrote a letter', note: 'Series II — ergative subject, nominative object' },
        { ka: 'ბიჭს დაუწერია წერილი', en: 'the boy has written a letter', note: 'Series III — dative subject, nominative object' },
      ],
      note: 'Intransitive verbs keep a nominative subject in Series I and II. Verbs of the 4th conjugation — მიყვარს "I love", მაქვს "I have" — take a dative subject throughout.',
    },
  ],
};

const pluralsAdjectives: GrammarTopic = {
  id: 'plurals-and-adjectives',
  title: 'Plurals & adjectives',
  titleGeorgian: 'მრავლობითი და ზედსართავი',
  group: 'nouns',
  icon: Layers,
  summary: 'Forming the plural, and how an adjective agrees with the noun in front of it.',
  sections: [
    {
      heading: 'Plurals',
      body: [
        'The modern plural is -ებ-, inserted between the stem and the case ending. Every case ending then works exactly as it does in the singular.',
      ],
      table: {
        columns: ['Case', 'Singular', 'Plural'],
        georgianColumns: [1, 2],
        rows: [
          ['Nominative', 'კაცი', 'კაცები'],
          ['Ergative', 'კაცმა', 'კაცებმა'],
          ['Dative', 'კაცს', 'კაცებს'],
          ['Genitive', 'კაცის', 'კაცების'],
        ],
      },
      list: [
        'Stems that drop a vowel do so before -ები as well: ქვეყანა → ქვეყნები, "countries".',
        'After a numeral the noun stays singular: სამი წიგნი, "three books".',
        'An older plural in -ნი (nominative) and -თა (oblique) survives in literary and set phrases: კაცნი, კაცთა.',
      ],
    },
    {
      heading: 'Adjectives',
      body: [
        'Adjectives come before the noun. Those ending in a consonant take a reduced set of case endings; those ending in a vowel — პატარა "small", ლურჯი is consonant-stem but პატარა is not — never change at all.',
      ],
      table: {
        columns: ['Case', 'დიდი კაცი (big man)', 'პატარა კაცი (small man)'],
        georgianColumns: [1, 2],
        rows: [
          ['Nominative', 'დიდი კაცი', 'პატარა კაცი'],
          ['Ergative', 'დიდმა კაცმა', 'პატარა კაცმა'],
          ['Dative', 'დიდ კაცს', 'პატარა კაცს'],
          ['Genitive', 'დიდი კაცის', 'პატარა კაცის'],
          ['Instrumental', 'დიდი კაცით', 'პატარა კაცით'],
          ['Adverbial', 'დიდ კაცად', 'პატარა კაცად'],
        ],
      },
      note: 'A consonant-stem adjective takes -მა only in the ergative and bare stem in the dative and adverbial — it never copies the noun\'s ending outright.',
    },
    {
      heading: 'Comparison',
      body: [
        'The comparative wraps the adjective in უ- … -ეს-, and the thing compared against goes in the genitive with -ზე. The superlative adds ყველაზე, "than everyone".',
      ],
      examples: [
        { ka: 'დიდი', en: 'big' },
        { ka: 'უფრო დიდი', en: 'bigger' },
        { ka: 'ყველაზე დიდი', en: 'biggest' },
        { ka: 'ეს სახლი იმ სახლზე დიდია', en: 'this house is bigger than that house' },
      ],
    },
  ],
};

const postpositions: GrammarTopic = {
  id: 'postpositions',
  title: 'Postpositions',
  titleGeorgian: 'თანდებულები',
  group: 'nouns',
  icon: Link2,
  summary: 'Georgian puts its prepositions after the noun — and each one governs a case.',
  sections: [
    {
      body: [
        'Where English puts a word in front of the noun, Georgian glues one onto the end of it. Each postposition demands a particular case, so you have to know both halves: the case, then the ending.',
        'With -ში and -ზე the dative -ს drops out before the postposition: სახლს + ში → სახლში.',
      ],
      table: {
        columns: ['Postposition', 'Case', 'Meaning', 'Example'],
        georgianColumns: [0, 3],
        rows: [
          ['-ში', 'dative', 'in, into', 'სახლში — in the house'],
          ['-ზე', 'dative', 'on, about', 'მაგიდაზე — on the table'],
          ['-თან', 'dative', 'at, next to, with (a person)', 'ექიმთან — at the doctor\'s'],
          ['-თვის', 'genitive', 'for', 'შენთვის — for you'],
          ['-კენ', 'genitive', 'towards', 'ზღვისკენ — towards the sea'],
          ['-გან', 'genitive', 'from, made of', 'ბავშვისგან — from the child'],
          ['-დან', 'instrumental', 'from (a place or time)', 'თბილისიდან — from Tbilisi'],
          ['-მდე', 'adverbial', 'up to, until', 'საღამომდე — until evening'],
        ],
      },
    },
    {
      heading: 'In and on',
      body: [
        'The split between -ში and -ზე does not line up with English. Open spaces, events and surfaces take -ზე; enclosed spaces take -ში.',
      ],
      examples: [
        { ka: 'ოთახში', en: 'in the room' },
        { ka: 'ქუჩაზე', en: 'on / in the street' },
        { ka: 'წვეულებაზე', en: 'at the party' },
        { ka: 'საქართველოში', en: 'in Georgia' },
      ],
    },
  ],
};

const pronouns: GrammarTopic = {
  id: 'pronouns',
  title: 'Pronouns',
  titleGeorgian: 'ნაცვალსახელები',
  group: 'nouns',
  icon: Users,
  summary: 'Personal, possessive and demonstrative pronouns, plus the question words.',
  sections: [
    {
      heading: 'Personal pronouns',
      body: [
        'First and second person pronouns do not change for case — მე is მე whether it is the subject or the object. Only the third person declines, which is why მან and მას are worth learning as separate words.',
      ],
      table: {
        columns: ['', 'Nominative', 'Ergative', 'Dative', 'Possessive'],
        georgianColumns: [1, 2, 3, 4],
        rows: [
          ['I', 'მე', 'მე', 'მე', 'ჩემი'],
          ['you (sg)', 'შენ', 'შენ', 'შენ', 'შენი'],
          ['he / she / it', 'ის, იგი', 'მან', 'მას', 'მისი'],
          ['we', 'ჩვენ', 'ჩვენ', 'ჩვენ', 'ჩვენი'],
          ['you (pl)', 'თქვენ', 'თქვენ', 'თქვენ', 'თქვენი'],
          ['they', 'ისინი', 'მათ', 'მათ', 'მათი'],
        ],
      },
      note: 'თქვენ is also the polite singular "you", used with strangers and anyone older than you.',
    },
    {
      heading: 'Demonstratives',
      body: [
        'Georgian points in three directions rather than two: near me, near you, and away from us both.',
      ],
      table: {
        columns: ['', 'Nominative', 'Ergative', 'Dative', 'Sense'],
        georgianColumns: [1, 2, 3],
        rows: [
          ['this', 'ეს', 'ამან', 'ამას', 'near the speaker'],
          ['that', 'ეგ', 'მაგან', 'მაგას', 'near the listener'],
          ['that (yonder)', 'ის', 'იმან', 'იმას', 'away from both'],
        ],
      },
      note: 'Before a noun the short forms are used: ამ კაცმა, ამ კაცს, იმ სახლში.',
    },
    {
      heading: 'Question words',
      table: {
        columns: ['Georgian', 'English'],
        georgianColumns: [0],
        rows: [
          ['ვინ', 'who'],
          ['რა', 'what'],
          ['სად', 'where'],
          ['საიდან', 'where from'],
          ['როდის', 'when'],
          ['როგორ', 'how'],
          ['რატომ', 'why'],
          ['რამდენი', 'how many, how much'],
          ['რომელი', 'which'],
          ['ვისი', 'whose'],
        ],
      },
    },
  ],
};

const numbers: GrammarTopic = {
  id: 'numbers',
  title: 'Numbers',
  titleGeorgian: 'რიცხვები',
  group: 'nouns',
  icon: Hash,
  summary: 'Counting in twenties: the vigesimal system, ordinals, and counted nouns.',
  sections: [
    {
      body: [
        'Georgian counts in twenties. Above 20 a number is read as "so many twenties and a remainder": 40 is ორმოცი, "two twenties", and 57 is ორმოცდაჩვიდმეტი, "two twenties and seventeen".',
      ],
      table: {
        columns: ['', '1–10', '', '11–20'],
        georgianColumns: [1, 3],
        rows: [
          ['1', 'ერთი', '11', 'თერთმეტი'],
          ['2', 'ორი', '12', 'თორმეტი'],
          ['3', 'სამი', '13', 'ცამეტი'],
          ['4', 'ოთხი', '14', 'თოთხმეტი'],
          ['5', 'ხუთი', '15', 'თხუთმეტი'],
          ['6', 'ექვსი', '16', 'თექვსმეტი'],
          ['7', 'შვიდი', '17', 'ჩვიდმეტი'],
          ['8', 'რვა', '18', 'თვრამეტი'],
          ['9', 'ცხრა', '19', 'ცხრამეტი'],
          ['10', 'ათი', '20', 'ოცი'],
        ],
      },
      note: 'The teens are built on a frame თ-…-მეტი, "ten more" — worth hearing as one shape rather than memorising nine separate words.',
    },
    {
      heading: 'Tens and hundreds',
      table: {
        columns: ['Number', 'Georgian', 'Literally'],
        georgianColumns: [1],
        rows: [
          ['20', 'ოცი', 'twenty'],
          ['30', 'ოცდაათი', 'twenty and ten'],
          ['40', 'ორმოცი', 'two twenties'],
          ['50', 'ორმოცდაათი', 'two twenties and ten'],
          ['60', 'სამოცი', 'three twenties'],
          ['70', 'სამოცდაათი', 'three twenties and ten'],
          ['80', 'ოთხმოცი', 'four twenties'],
          ['90', 'ოთხმოცდაათი', 'four twenties and ten'],
          ['100', 'ასი', 'hundred'],
          ['1000', 'ათასი', 'thousand'],
        ],
      },
      examples: [
        { ka: 'ოცდახუთი', en: '25', note: '20 + 5' },
        { ka: 'ორმოცდარვა', en: '48', note: '40 + 8' },
        { ka: 'ოთხმოცდაცხრამეტი', en: '99', note: '80 + 19' },
        { ka: 'ორასი', en: '200' },
      ],
    },
    {
      heading: 'Ordinals and counted nouns',
      list: [
        'Ordinals take the frame მე-…-ე: მეორე "second", მესამე "third", მეოთხე "fourth". "First" is irregular: პირველი.',
        'A noun after a numeral stays singular: ხუთი წიგნი, "five books".',
        'Ages and dates use the same numbers: ოცდაათი წლის ვარ, "I am thirty years old".',
      ],
    },
  ],
};

const verbBasics: GrammarTopic = {
  id: 'verb-basics',
  title: 'How verbs work',
  titleGeorgian: 'ზმნა',
  group: 'verbs',
  icon: BookOpen,
  summary: 'Conjugation classes, person markers, preverbs and version vowels.',
  sections: [
    {
      body: [
        'A Georgian verb is a small sentence in itself. One form can carry the person and number of the subject, the person of the object, tense, mood, direction, and who the action is being done for — მიყვარხარ is a complete sentence meaning "I love you".',
        'That density is why verbs are indexed by their verbal noun rather than an infinitive: there is no infinitive. The dictionary headword სწავლა is "studying", and the forms you actually say are built from a stem that changes across the tenses.',
      ],
    },
    {
      heading: 'The four conjugations',
      table: {
        columns: ['Class', 'Type', 'Example', 'Meaning'],
        georgianColumns: [2],
        rows: [
          ['1st', 'Transitive — an agent acting on an object', 'ვწერ', 'I write (something)'],
          ['2nd', 'Passive / intransitive — a change of state', 'იწერება', 'it is being written'],
          ['3rd', 'Medial — activity with no object', 'ვმუშაობ', 'I work'],
          ['4th', 'Indirect — dative subject, states of feeling and having', 'მიყვარს', 'I love (him/her)'],
        ],
      },
      note: 'The class decides the case pattern the verb imposes on its nouns — see Noun cases.',
    },
    {
      heading: 'Person markers',
      body: [
        'Subject and object are marked in different slots: the subject mostly by a prefix plus a suffix, the object by a prefix alone. A verb form can therefore hold both at once.',
      ],
      table: {
        columns: ['Person', 'Subject marker', 'Object marker'],
        rows: [
          ['1sg', 'ვ-', 'მ-'],
          ['2sg', '— (no prefix)', 'გ-'],
          ['3sg', '-ს / -ა / -ო', 'ჰ- / ს- / —'],
          ['1pl', 'ვ- … -თ', 'გვ-'],
          ['2pl', '-თ', 'გ- … -თ'],
          ['3pl', '-ენ / -ან / -ნენ', 'ჰ- / ს- … '],
        ],
      },
      examples: [
        { ka: 'ვწერ', en: 'I write', note: 'ვ- subject prefix' },
        { ka: 'წერ', en: 'you write', note: 'no prefix at all' },
        { ka: 'წერს', en: 'he/she writes', note: '-ს subject suffix' },
        { ka: 'გწერ', en: 'I write to you', note: 'გ- object prefix pushes out ვ-' },
      ],
    },
    {
      heading: 'Preverbs',
      body: [
        'A preverb is a prefix that adds direction — and, in doing so, turns a present into a future. This is the ordinary way Georgian expresses the future: no separate tense marker, just the preverb.',
      ],
      table: {
        columns: ['Preverb', 'Direction', 'Example'],
        georgianColumns: [0, 2],
        rows: [
          ['და-', 'general completion', 'დავწერ — I will write'],
          ['გა-', 'out, away', 'გავა — he will go out'],
          ['მი-', 'away from the speaker', 'მივდივარ — I am going (there)'],
          ['მო-', 'towards the speaker', 'მოდის — he is coming'],
          ['შე-', 'in, into', 'შევა — he will go in'],
          ['ჩა-', 'down, in', 'ჩავა — he will go down'],
          ['ა-', 'up', 'ავა — he will go up'],
          ['გადა-', 'across, over', 'გადავა — he will cross'],
        ],
      },
    },
    {
      heading: 'Version vowels',
      body: [
        'The vowel between the prefix and the root says who benefits from the action. It is one letter, and it changes the meaning of the sentence.',
      ],
      examples: [
        { ka: 'ვხატავ', en: 'I draw', note: 'neutral version' },
        { ka: 'ვიხატავ', en: 'I draw for myself', note: 'subjective version — ი-' },
        { ka: 'ვუხატავ', en: 'I draw for him/her', note: 'objective version — უ-' },
      ],
    },
  ],
};

// The screeve and series tables restate the grammar constants, so they are read straight
// out of them. The example column is the one part that needs the dictionary, so the two
// topics below are built on first use rather than at import — see content/store.ts.
const screeveByKey = Object.fromEntries(
  SCREEVES.map(s => [s.key, s]),
) as Record<ScreeveKey, Screeve>;

/**
 * A verb with nothing in it, for when there are no Georgian verbs to pick from.
 *
 * Every one of these topics is *Georgian* grammar, so on the Russian dictionary there is no
 * example to carry and `grammarTopics` below hands back nothing at all. This exists so that
 * the builders above it can still run to completion in the moment before that check, rather
 * than reading `.verbalNoun` off undefined — which is precisely how this took the site down:
 * the sidebar builds the topic list on *every* page, so one missing example blanked the whole
 * app rather than just the grammar section.
 */
const NO_VERB: KaVerb = {
  id: '', english: '', senses: [], transitivity: '', verbalNoun: '', group: '', groupId: '',
  present3sg: '', forms: {}, imperative: null, prohibitive: null, url: '',
  synonymsEnglish: [], synonymsGeorgian: [],
};

// One real verb carried across all three tables, so the example column reads as a single
// paradigm rather than eleven unrelated forms. The verb with the fewest gaps wins.
const exampleVerb = derived<KaVerb>(content => {
  let best = kaVerbsOf(content)[0] ?? NO_VERB;
  let bestFilled = -1;
  for (const verb of kaVerbsOf(content)) {
    const filled = SCREEVES.filter(s => verb.forms[s.key]?.['1sg']).length;
    if (filled > bestFilled) {
      best = verb;
      bestFilled = filled;
    }
  }
  return best;
});

const screeves = derived<GrammarTopic>(() => {
  const example = exampleVerb();
  return {
    id: 'screeves',
    title: 'Tenses & screeves',
    titleGeorgian: 'მწკრივები',
    group: 'verbs',
    icon: Clock,
    summary: 'The eleven screeves, grouped into the three series every verb is built on.',
    sections: [
      {
        body: [
          'Georgian does not have tenses in the European sense. It has screeves — a screeve being one complete set of six person forms sharing a tense, aspect and mood. There are eleven of them, in three series, and the series a verb is in also decides the cases of its nouns.',
        ],
      },
      ...SERIES.map(block => ({
        heading: block.label,
        table: {
          columns: ['Screeve', 'Sense', `1sg of ${example.verbalNoun}`],
          rows: block.screeves.map(key => {
            const screeve = screeveByKey[key];
            return [screeve.label, screeve.gloss, example.forms[key]?.['1sg'] || '—'];
          }),
          georgianColumns: [2],
        },
      })),
      {
        heading: 'Imperative',
        body: [
          'The imperative is not a screeve of its own: the affirmative borrows the aorist forms and the prohibitive borrows the present, with ნუ in front. Only five persons exist — you cannot command yourself.',
        ],
        examples: [
          { ka: 'დაწერე!', en: 'write!' },
          { ka: 'ნუ წერ!', en: "don't write!" },
        ],
      },
    ],
  };
});

const verbGroups = derived<GrammarTopic>(content => ({
  id: 'verb-groups',
  title: 'Conjugation groups',
  titleGeorgian: 'ჯგუფები',
  group: 'verbs',
  icon: Layers,
  summary: 'The groups the verb tables are sorted into, and what makes each one different.',
  sections: [
    {
      body: [
        'Every verb in the tables carries a group tag such as (1, A). The number is the conjugation class; the letter marks a pattern that differs from the main one in a few forms. Verbs inside a group conjugate alike, so learning one pattern gets you the rest.',
      ],
    },
    {
      groups: kaGroupsOf(content).map(group => ({
        label: group.label,
        name: group.name,
        count: group.verbCount,
        notes: group.notes,
      })),
    },
  ],
}));

const sentenceBasics: GrammarTopic = {
  id: 'sentence-basics',
  title: 'Sentence basics',
  titleGeorgian: 'წინადადება',
  group: 'sentences',
  icon: MessageCircle,
  summary: 'Word order, the verb "to be", negation, and asking questions.',
  sections: [
    {
      heading: 'Word order',
      body: [
        'The neutral order is subject – object – verb, but because the cases carry the roles, almost any order is grammatical. Moving a word to the front emphasises it, and the slot right before the verb is the one that carries focus.',
      ],
      examples: [
        { ka: 'ბიჭი წიგნს კითხულობს', en: 'the boy is reading a book', note: 'neutral order' },
        { ka: 'წიგნს კითხულობს ბიჭი', en: "it's the boy who is reading a book" },
      ],
    },
    {
      heading: 'To be',
      table: {
        columns: ['Person', 'Georgian', 'English'],
        georgianColumns: [1],
        rows: [
          ['1sg', 'ვარ', 'I am'],
          ['2sg', 'ხარ', 'you are'],
          ['3sg', 'არის', 'he / she / it is'],
          ['1pl', 'ვართ', 'we are'],
          ['2pl', 'ხართ', 'you are'],
          ['3pl', 'არიან', 'they are'],
        ],
      },
      note: 'In the third person არის usually contracts onto the preceding word: ის ექიმია, "he is a doctor".',
    },
    {
      heading: 'Negation',
      body: [
        'Georgian has three negatives, and choosing between them says something the English "not" does not.',
      ],
      table: {
        columns: ['Word', 'Use', 'Example'],
        georgianColumns: [0, 2],
        rows: [
          ['არ', 'plain negation', 'არ ვიცი — I don\'t know'],
          ['ვერ', 'inability — cannot, could not manage to', 'ვერ ვხედავ — I can\'t see'],
          ['ნუ', 'negative command', 'ნუ ხარ — don\'t be'],
        ],
      },
    },
    {
      heading: 'Questions',
      body: [
        'Yes/no questions need no change in word order and no particle — intonation alone carries them. Question words normally sit immediately before the verb.',
      ],
      examples: [
        { ka: 'ქართველი ხარ?', en: 'are you Georgian?' },
        { ka: 'სად მიდიხარ?', en: 'where are you going?' },
        { ka: 'დიახ / კი / არა', en: 'yes (formal) / yes / no' },
      ],
    },
  ],
};

// A function rather than an array, because two of the ten are built from the dictionary and
// cannot exist before it has loaded. The rest are plain prose and are the same either way.
//
// All ten are Georgian: the alphabet, the seven cases, the eleven screeves. None of it
// describes Russian even loosely, so the Russian dictionary gets an empty list rather than a
// section of confidently wrong grammar — and the sidebar, which asks for this on every page,
// simply renders no grammar group. Russian grammar is a thing to write, not to derive.
export const grammarTopics = derived<GrammarTopic[]>(content =>
  content.verbs.kind !== 'ka' ? [] : [
  alphabet,
  nounCases,
  pluralsAdjectives,
  postpositions,
  pronouns,
  numbers,
  verbBasics,
  screeves(),
  verbGroups(),
  sentenceBasics,
]);

export function getGrammarTopic(id: string | undefined): GrammarTopic | undefined {
  return grammarTopics().find(topic => topic.id === id);
}

// Topics in the order the groups are declared, so the sidebar and the index page agree.
export function groupedGrammarTopics(): GrammarGroupWithTopics[] {
  const topics = grammarTopics();
  return grammarGroups
    .map(group => ({
      ...group,
      topics: topics.filter(topic => topic.group === group.id),
    }))
    .filter(group => group.topics.length > 0);
}
