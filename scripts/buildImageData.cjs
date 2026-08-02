// Resolves an appropriate Wikipedia/Wikimedia Commons lead image for each word.
//
//   node scripts/buildImageData.cjs            # full run
//   node scripts/buildImageData.cjs --report   # full run + per-category audit to stdout
//
// Writes src/data/images.json: { "<wordId>": { url, width, height, title, page, author, license, licenseUrl } }
//
// The bar for including an image is deliberately high: a word only gets one when a
// candidate article survives every check below. Anything doubtful resolves to no
// entry at all, and the UI then renders nothing for that word.

const fs = require('fs');
const path = require('path');

const UA = 'GeorgianDictImageBuilder/1.0 (https://github.com/ - personal language-learning app)';
const WIKI = 'https://en.wikipedia.org/w/api.php';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const THUMB_WIDTH = 480;
const BATCH = 50;

// ---------------------------------------------------------------------------
// 1. Depictability — which words are even eligible for a picture
// ---------------------------------------------------------------------------

// Categories whose members are essentially never depictable: grammar words,
// abstract relations, adjectives of origin, numerals, interjections.
const SKIP_CATEGORIES = new Set([
  'question-words',
  'general-concepts',
  'quantity-order-parts',
  'qualities-characteristics',
  'actions-states',
  'miscellaneous',
  'ethics',
  'names-origins',
  'personal-names-surnames',
  'uncategorized',
  'speaking-instruments',
  'personal-social-relations',
  'business-relations',
  'feelings-emotions',
  'human-appearance-character',
  'identification',
  'daily-life',
  'time-place-measurements',
]);

// A term has to look like a thing, not a phrase or a grammatical fragment.
const ABSTRACT_TERMS = new Set([
  'thing', 'way', 'kind', 'sort', 'type', 'part', 'side', 'end', 'beginning', 'middle',
  'reason', 'cause', 'result', 'meaning', 'sense', 'idea', 'thought', 'opinion', 'view',
  'fact', 'case', 'matter', 'issue', 'problem', 'question', 'answer', 'example',
  'condition', 'situation', 'state', 'position', 'level', 'degree', 'amount', 'number',
  'quantity', 'quality', 'value', 'price', 'cost', 'sum', 'total', 'rest', 'half',
  'time', 'moment', 'period', 'age', 'turn', 'chance', 'luck', 'fate', 'life', 'death',
  'name', 'word', 'term', 'title', 'order', 'rule', 'law', 'right', 'duty', 'need',
  'help', 'use', 'work', 'job', 'business', 'affair', 'deal', 'plan', 'aim', 'goal',
  'power', 'force', 'strength', 'effort', 'action', 'deed', 'event', 'change',
  'start', 'finish', 'place', 'space', 'area', 'point', 'line', 'form', 'shape',
  'size', 'weight', 'measure', 'speed', 'temperature', 'heat', 'cold', 'light', 'dark',
  'sound', 'noise', 'smell', 'taste', 'touch', 'feeling', 'love', 'hate', 'fear',
  'hope', 'joy', 'sorrow', 'pain', 'pleasure', 'peace', 'war', 'freedom', 'truth',
  'lie', 'trust', 'faith', 'honour', 'honor', 'shame', 'pride', 'respect', 'care',
  'attention', 'interest', 'habit', 'custom', 'tradition', 'culture', 'society',
  'people', 'person', 'man', 'woman', 'child', 'friend', 'enemy', 'guest', 'host',
  'member', 'group', 'team', 'crowd', 'public', 'world', 'country', 'nation', 'state',
  'history', 'future', 'past', 'present', 'today', 'tomorrow', 'yesterday',
  'morning', 'evening', 'night', 'day', 'week', 'month', 'year', 'season',
  'text', 'list', 'show', 'play', 'game', 'story', 'news', 'information', 'data',
  'service', 'system', 'method', 'process', 'step', 'stage', 'course', 'programme',
  'program', 'project', 'company', 'society', 'union', 'party', 'class', 'race',
]);

function cleanTerm(raw) {
  return String(raw || '')
    .replace(/\bsmth\b|\bsmb\b|\bsb\b|\betc\b/gi, ' ')
    .replace(/[^A-Za-zÀ-ɏ' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parentheticals often contain their own commas ("(social, political) class"), so they
// have to come off before the entry is split into senses.
function stripParens(entry) {
  return String(entry || '')
    .replace(/\([^)]*\)/g, ' ')   // balanced
    .replace(/\([^)]*$/, ' ')     // truncated tail, e.g. "helps oneself to smth (food"
    .replace(/\s+/g, ' ')
    .trim();
}

// Split "sister-in-law; daughter-in-law" / "politics, policy" into separate senses.
function senses(word) {
  const out = [];
  const raw = [word.english, ...(word.englishFull || [])];
  for (const entry of raw) {
    for (const piece of stripParens(entry).split(/[;,]/)) {
      const t = cleanTerm(piece);
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

const FUNCTION_WORD = /^(a|an|the|to|of|in|on|at|by|for|with|and|or|but|not|no|yes|is|are|be|been|it|its|this|that|these|those|he|she|they|we|you|i|my|his|her|their|our|your|so|such|very|too|also|just|only|even|still|yet|then|than|as|if|when|where|how|why|what|who|whom|which|whose)$/i;

// Words that do resolve to an article with a picture, but where no picture can
// honestly illustrate the sense this dictionary means. Verified by hand against the
// audit output. Keyed "categoryId::term".
const DENY = new Set([
  'professions-work::director',      // "head of an organisation" -> Wikipedia's Head (anatomy)
  'professions-work::interpreter',   // -> Dragoman
  'professions-work::equipment',     // -> Technology, too vague to illustrate
  'professions-work::credit',
  'professions-work::import',
  'professions-work::expert',
  'professions-work::speciality',
  'education-science::field',        // დარგი = branch/domain, not a meadow
  'education-science::economy',
  'travel::turn-off',                // -> Turning (metalworking)
  'shopping::pound',                 // the weight unit, not Pound sterling
  'health-hygiene::analysis',
  'services::debt',
  'services::loan',
  'nature-environment::territory',
]);

function isEligible(word) {
  if (SKIP_CATEGORIES.has(word.categoryId)) return false;
  if (word.partOfSpeech !== 'Noun') return false;   // adjectives, numerals, verbs: no image

  const first = senses(word)[0];
  if (!first) return false;
  if (DENY.has(`${word.categoryId}::${first.toLowerCase()}`)) return false;
  if (first.length < 2) return false;
  if (first.split(' ').length > 3) return false;    // descriptive glosses, not nameable things
  if (FUNCTION_WORD.test(first)) return false;
  if (ABSTRACT_TERMS.has(first.toLowerCase())) return false;
  // Glosses that describe rather than name ("eatery serving beans", "one who works")
  if (/\b(serving|one who|person who|act of|state of|being|used for|relating to|smth|smb)\b/i.test(first)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 2. Candidate article titles
// ---------------------------------------------------------------------------

// Wikipedia disambiguates with "Term (qualifier)". Guessing the qualifier from the
// word's category lets us find the right sense without the rate-limited search API.
const QUALIFIERS = {
  fauna: ['bird', 'animal', 'mammal', 'fish', 'insect', 'zoology'],
  flora: ['plant', 'tree', 'fruit', 'vegetable', 'botany', 'genus'],
  'food-drink': ['food', 'dish', 'drink', 'beverage', 'cuisine', 'bread'],
  'clothing-accessories': ['clothing', 'garment', 'fashion', 'accessory'],
  'clothing-household-items': ['furniture', 'tableware', 'household', 'appliance', 'tool', 'utensil'],
  'home-living-environment': ['building', 'architecture', 'room', 'house'],
  'body-parts-organs': ['anatomy', 'organ', 'body part'],
  transport: ['vehicle', 'transport', 'rail transport', 'aircraft', 'ship'],
  sport: ['sport', 'game', 'athletics'],
  'culture-art': ['art', 'music', 'instrument', 'literature', 'theatre', 'dance'],
  'information-technology': ['computing', 'technology', 'media', 'broadcasting'],
  'professions-work': ['occupation', 'profession'],
  'health-hygiene': ['medicine', 'medical', 'health', 'anatomy'],
  'nature-environment': ['geography', 'nature', 'weather', 'geology', 'landform'],
  'education-science': ['education', 'science', 'school', 'academia'],
  'free-time-entertainment': ['game', 'toy', 'entertainment', 'leisure'],
  shopping: ['retail', 'commerce'],   // not 'currency': "pound" the weight unit would match "Pound (currency)"
  travel: ['travel', 'tourism', 'accommodation'],
  services: ['service', 'device', 'tool'],
  'geographical-names': ['country', 'city', 'region'],
  'family-relatives': ['kinship', 'family'],
  religion: ['religion', 'Christianity', 'church'],
  'politics-government': ['politics', 'government'],
  'emergency-situations': ['emergency', 'safety'],
  'abilities-hobbies': ['hobby', 'craft'],
  fauna_default: [],
};

// Senses this dictionary means that differ from Wikipedia's primary topic, or that
// Wikipedia's redirect graph does not cover. Keyed by "categoryId::term".
const OVERRIDES = {
  'clothing-household-items::iron': 'Clothes iron',
  'clothing-household-items::deep dish': 'Bowl',
  'clothing-household-items::plate': 'Plate (dishware)',
  'clothing-household-items::glass': 'Drinking glass',
  'clothing-household-items::mirror': 'Mirror',
  'clothing-household-items::sheet': 'Bed sheet',
  'clothing-household-items::pot': 'Cookware and bakeware',
  'clothing-household-items::pan': 'Frying pan',
  'clothing-household-items::towel': 'Towel',
  'fauna::turkey': 'Turkey (bird)',
  'fauna::crane': 'Crane (bird)',
  'fauna::swallow': 'Swallow',
  'fauna::seal': 'Pinniped',
  'fauna::bug': 'Insect',
  'fauna::dolphin': 'Dolphin',            // bare "Dolphin" redirects to Mahi-mahi, the fish
  'food-drink::coke': 'Coca-Cola',
  'food-drink::roll': 'Bread roll',
  'food-drink::spirit': 'Liquor',
  'food-drink::spirits': 'Liquor',
  'food-drink::water': 'Water',
  'food-drink::cocktail': 'Cocktail',     // -> Prawn cocktail
  'food-drink::cocoa': 'Cocoa bean',      // -> Hot chocolate
  'education-science::rubber': 'Eraser',  // school sense, not Natural rubber
  'nature-environment::environment': 'Natural environment',
  'transport::port': 'Port',              // -> Port and starboard
  'transport::transport': 'Transport',    // -> Troopship
  'home-living-environment::large wine-jar': 'Kvevri',
  'body-parts-organs::chest': 'Thorax',
  'body-parts-organs::palm': 'Hand',
  'body-parts-organs::crown': 'Crown (anatomy)',
  'body-parts-organs::iris': 'Iris (anatomy)',
  'body-parts-organs::pupil': 'Pupil',
  'transport::metro': 'Rapid transit',
  'transport::coach': 'Coach (bus)',
  'transport::plane': 'Airplane',
  'travel::map': 'Map',
  'travel::resort': 'Resort',
  'shopping::lari': 'Georgian lari',
  'shopping::change': 'Coin',
  'sport::goal': 'Goal (sport)',
  'sport::match': 'Sports match',
  'sport::race': 'Racing',
  'culture-art::organ': 'Pipe organ',
  'culture-art::drum': 'Drum',
  'culture-art::pipe': 'Flute',
  'culture-art::bow': 'Bow (music)',
  'health-hygiene::pill': 'Tablet (pharmacy)',
  'health-hygiene::cast': 'Orthopedic cast',
  'free-time-entertainment::swing': 'Swing (seat)',
  'free-time-entertainment::draughts': 'Draughts',
  'free-time-entertainment::cards': 'Playing card',
  'home-living-environment::block': 'Apartment',
  'flora::palm': 'Arecaceae',
  'flora::pepper': 'Bell pepper',
  'nature-environment::spring': 'Spring (hydrology)',
  'nature-environment::bank': 'Bank (geography)',
  'nature-environment::current': 'Ocean current',
};

function titleCase(t) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function candidatesFor(word) {
  const list = [];
  const push = (title, kind, term) => {
    if (title && !list.some(c => c.title.toLowerCase() === title.toLowerCase())) {
      list.push({ title, kind, term });
    }
  };

  const all = senses(word);
  const primary = all[0];
  const override = OVERRIDES[`${word.categoryId}::${primary.toLowerCase()}`];
  if (override) push(override, 'override', primary);

  const quals = QUALIFIERS[word.categoryId] || [];

  // Primary sense: bare title first (Wikipedia's curated redirects handle
  // aeroplane->Airplane, pill->Tablet), then category-qualified fallbacks.
  push(titleCase(primary), 'primary', primary);
  for (const q of quals) push(`${titleCase(primary)} (${q})`, 'qualified', primary);

  // Secondary senses of the same Georgian word, bare only.
  for (const alt of all.slice(1, 3)) {
    if (alt.split(' ').length <= 3 && !ABSTRACT_TERMS.has(alt.toLowerCase())) {
      push(titleCase(alt), 'alternate', alt);
    }
  }
  return list;
}

// --- relatedness -----------------------------------------------------------

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-zà-ɏ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Crude singularisation so "shoes"/"shoe" and "berries"/"berry" compare equal.
function singular(s) {
  return norm(s).split(' ').map(w => {
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 3 && w.endsWith('es') && /(sh|ch|ss|x|z)es$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
  }).join(' ');
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// An article is a fair match for a term when its title says so, or when the term
// appears in the lead section — where Wikipedia lists the names that redirect in
// ("An automated teller machine (ATM), also known as a cashpoint...").
function isRelated(term, page, extract) {
  const t = singular(term);
  if (!t) return false;

  const bareTitle = page.title.replace(/\s*\([^)]*\)\s*$/, '');
  const bt = singular(bareTitle);
  if (bt === t) return true;
  if (bt.replace(/ /g, '') === t.replace(/ /g, '')) return true;   // bath house / bathhouse

  // Multi-word term whose head noun is the article subject ("basketball player" -> Basketball)
  if (t.split(' ').length > 1 && (t.startsWith(bt + ' ') || t.endsWith(' ' + bt))) return true;

  const lead = singular(String(extract || '').slice(0, 800) + ' ' + (page.description || ''));
  return new RegExp('(^| )' + escapeRe(t) + '( |$)').test(lead);
}

// ---------------------------------------------------------------------------
// 3. Validation — reject wrong senses and non-photographic lead images
// ---------------------------------------------------------------------------

const BAD_DESCRIPTION = [
  /\b(film|movie|album|song|single|band|musical|opera|novel|book|comic|manga|anime|video game|television series|tv series|episode|magazine|newspaper|website|software|mobile app)\b/i,
  /\b(given name|surname|family name|nickname)\b/i,
  // Individual people. Deliberately excludes words like "monarch" or "emperor",
  // which legitimately describe the *concept* articles King, Emperor, etc.
  /\b(footballer|politician|actor|actress|rapper|novelist|poet|painter|composer|philosopher)\b/i,
  /\((born|b\.|\d{3,4}[-–])/i,
  /\b(company|corporation|manufacturer|brand|record label|football club|sports team|political party)\b/i,
  /\b(topics referred to|disambiguation|wikimedia|list of|index of)\b/i,
];

const PLACEY = /\b(human settlement|village|commune|municipality|civil parish|town in|city in|county|province|prefecture|district in|region of|island|country in|state of the|census-designated)\b/i;
const GEO_CATEGORIES = new Set(['geographical-names', 'travel']);

// Lead images that are symbols or diagrams rather than a picture of the thing.
const BAD_FILE = /(flag[_ ]of|coat[_ ]of[_ ]arms|^emblem|_logo|logo_|^logo|^icon|icon-|_map|map[_ ]of|locator|location_map|signature|wikisource|commons-logo|question_book|disambig|^symbol|_seal|seal_of|^blank|placeholder|no[_ ]image|nuvola|crystal_clear|^text_document)/i;
const FLAG_OK_CATEGORIES = new Set(['geographical-names', 'names-origins']);

// For strongly-typed categories the article's Wikidata description has to match the
// domain, which is what stops "turkey" resolving to the country.
const CATEGORY_EXPECTS = {
  fauna: /\b(bird|animal|mammal|fish|insect|species|genus|family of|reptile|amphibian|arachnid|mollusc|crustacean|breed|canine|feline|rodent|carnivor|primate|livestock|domestic)\b/i,
  flora: /\b(plant|species|genus|flower|tree|shrub|fruit|vegetable|herb|grass|fungus|mushroom|crop|botan|cultivar|berry|nut|family of)\b/i,
  'food-drink': /\b(food|dish|drink|beverage|cuisine|fruit|vegetable|meat|cheese|bread|cake|soup|sauce|spice|confection|dessert|alcohol|liquor|wine|beer|tea|coffee|dairy|grain|cereal|snack|pastry|seasoning|edible|nut|berry|species|plant)\b/i,
  'body-parts-organs': /\b(anatom|organ|body part|bone|muscle|limb|joint|tissue|gland|vessel|skeleton|nerve|skin|hair|tooth|blood)\b/i,
  transport: /\b(vehicle|transport|car|bus|train|rail|aircraft|airplane|ship|boat|bicycle|motorcycle|automobile|aviation|road|traffic)\b/i,
  'clothing-accessories': /\b(garment|clothing|footwear|worn|wear|fashion|textile|headgear|accessory|jewellery|jewelry|dress|shoe|hat|band|braid)\b/i,
};

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validate(page, word, candidate) {
  if (!page || page.missing) return null;
  if (page.pageprops && page.pageprops.disambiguation !== undefined) return null;
  if (!page.thumbnail || !page.thumbnail.source) return null;

  const desc = page.description || '';
  const file = page.pageimage || page.thumbnail.source.split('/').pop();

  for (const re of BAD_DESCRIPTION) if (re.test(desc)) return null;
  if (PLACEY.test(desc) && !GEO_CATEGORIES.has(word.categoryId)) return null;

  if (BAD_FILE.test(file)) {
    const isFlag = /flag[_ ]of/i.test(file);
    if (!(isFlag && FLAG_OK_CATEGORIES.has(word.categoryId))) return null;
  }

  const expects = CATEGORY_EXPECTS[word.categoryId];
  if (expects) {
    // An explicitly qualified or overridden title already encodes the right sense.
    const trusted = candidate.kind === 'override' || candidate.kind === 'qualified';
    if (!trusted && !expects.test(desc)) return null;
  } else if (!desc && candidate.kind === 'primary') {
    // No description to sanity-check against: only accept a straight title match.
    const bare = page.title.replace(/\s*\([^)]*\)\s*$/, '').toLowerCase();
    if (bare !== candidate.title.toLowerCase()) return null;
  }

  return {
    url: page.thumbnail.source,
    width: page.thumbnail.width,
    height: page.thumbnail.height,
    title: page.title,
    page: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(page.title.replace(/ /g, '_')),
    file,
  };
}

// ---------------------------------------------------------------------------
// 4. API plumbing
// ---------------------------------------------------------------------------

async function apiGet(endpoint, params, attempt = 0) {
  const url = endpoint + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    if (attempt >= 4) { console.warn('  ! giving up:', err.message); return null; }
    const wait = 1000 * Math.pow(2, attempt);
    await sleep(wait);
    return apiGet(endpoint, params, attempt + 1);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// Resolve a set of article titles to page records, following normalisation+redirects.
async function fetchPages(titles) {
  const byTitle = new Map();
  const batches = chunk([...titles], BATCH);

  for (let i = 0; i < batches.length; i++) {
    const json = await apiGet(WIKI, {
      action: 'query',
      titles: batches[i].join('|'),
      redirects: '1',
      prop: 'pageimages|description|pageprops',
      piprop: 'thumbnail|name',
      pithumbsize: String(THUMB_WIDTH),
      pilicense: 'any',
      ppprop: 'disambiguation',
    });
    process.stdout.write(`\r  articles ${Math.min((i + 1) * BATCH, titles.size)}/${titles.size}   `);
    if (!json || !json.query) continue;

    const pages = new Map((json.query.pages || []).map(p => [p.title, p]));
    // Follow requested-title -> normalised -> redirect target chains.
    const hop = new Map();
    for (const n of json.query.normalized || []) hop.set(n.from, n.to);
    for (const r of json.query.redirects || []) hop.set(r.from, r.to);

    for (const requested of batches[i]) {
      let cur = requested;
      for (let h = 0; h < 4 && hop.has(cur); h++) cur = hop.get(cur);
      const page = pages.get(cur);
      if (page) byTitle.set(requested, page);
    }
    await sleep(120);
  }
  process.stdout.write('\n');
  return byTitle;
}

// Lead sections for the relatedness gate. TextExtracts caps intro extracts at 20/request.
async function fetchExtracts(titles) {
  const out = new Map();
  const batches = chunk([...titles], 20);
  for (let i = 0; i < batches.length; i++) {
    const json = await apiGet(WIKI, {
      action: 'query',
      titles: batches[i].join('|'),
      prop: 'extracts',
      exintro: '1',
      explaintext: '1',
      exlimit: '20',
    });
    process.stdout.write(`\r  lead sections ${Math.min((i + 1) * 20, titles.size)}/${titles.size}   `);
    if (json && json.query) {
      for (const p of json.query.pages || []) if (p.extract) out.set(p.title, p.extract);
    }
    await sleep(120);
  }
  process.stdout.write('\n');
  return out;
}

// Author + licence for each chosen file, from Commons (falling back to en.wikipedia).
// The API normalises "File:Cocoa_Pods.JPG" to "File:Cocoa Pods.JPG", so both the
// lookup key and the response title have to be compared with spaces.
const fileKey = f => String(f || '').replace(/^File:/, '').replace(/_/g, ' ').trim();

async function fetchAttribution(files) {
  const meta = new Map();
  const remaining = new Set([...files].map(fileKey));
  const total = remaining.size;
  let done = 0;

  for (const endpoint of [COMMONS, WIKI]) {
    if (!remaining.size) break;
    const batches = chunk([...remaining], BATCH);
    for (const batch of batches) {
      const json = await apiGet(endpoint, {
        action: 'query',
        titles: batch.map(f => 'File:' + f).join('|'),
        prop: 'imageinfo',
        iiprop: 'extmetadata',
        iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|Credit',
      });
      done += batch.length;
      process.stdout.write(`\r  attribution ${Math.min(done, total)}/${total}   `);
      if (!json || !json.query) continue;

      for (const p of json.query.pages || []) {
        const info = p.imageinfo && p.imageinfo[0];
        if (!info || !info.extmetadata) continue;
        const em = info.extmetadata;
        const key = fileKey(p.title);
        const author = stripTags(em.Artist && em.Artist.value).slice(0, 120);
        const license = stripTags(em.LicenseShortName && em.LicenseShortName.value);
        if (!author && !license) continue;
        meta.set(key, {
          author: author || '',
          license: license || '',
          licenseUrl: (em.LicenseUrl && em.LicenseUrl.value) || '',
        });
        remaining.delete(key);
      }
      await sleep(120);
    }
    process.stdout.write('\n');
  }
  return meta;
}

// ---------------------------------------------------------------------------
// 5. Main
// ---------------------------------------------------------------------------

(async () => {
  const dataPath = path.join(__dirname, '..', 'src', 'data', 'words.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  const eligible = data.words.filter(isEligible);
  console.log(`Words: ${data.words.length}  |  eligible for an image: ${eligible.length}`);

  const plans = eligible.map(w => ({ word: w, candidates: candidatesFor(w) }));
  const titles = new Set();
  for (const p of plans) for (const c of p.candidates) titles.add(c.title);
  console.log(`Candidate articles to look up: ${titles.size}`);

  const pages = await fetchPages(titles);

  // Pass 1: structural checks (has image, right domain, not a logo/flag/disambig).
  const shortlist = [];
  const needExtract = new Set();
  for (const { word, candidates } of plans) {
    const viable = [];
    for (const cand of candidates) {
      const page = pages.get(cand.title);
      const ok = validate(page, word, cand);
      if (ok) { viable.push({ cand, page, ok }); needExtract.add(page.title); }
    }
    if (viable.length) shortlist.push({ word, viable });
  }
  console.log(`Survived structural checks: ${shortlist.length} words, ${needExtract.size} articles`);

  const extracts = await fetchExtracts(needExtract);

  // Pass 2: the article must actually be about the word.
  const images = {};
  const dropped = [];
  for (const { word, viable } of shortlist) {
    const hit = viable.find(v => isRelated(v.cand.term, v.page, extracts.get(v.page.title)));
    if (hit) images[word.id] = { ...hit.ok, kind: hit.cand.kind };
    else dropped.push(`${word.english} -/-> ${viable.map(v => v.page.title).join(', ')}`);
  }
  console.log(`Matched: ${Object.keys(images).length}  |  no suitable image: ${eligible.length - Object.keys(images).length}`);
  if (process.argv.includes('--report')) {
    console.log(`\n=== dropped as unrelated (${dropped.length}) ===`);
    for (const d of dropped.slice(0, 60)) console.log('   ', d);
  }

  const files = new Set(Object.values(images).map(i => i.file));
  const attribution = await fetchAttribution(files);

  const out = {};
  for (const [id, img] of Object.entries(images)) {
    const credit = attribution.get(fileKey(img.file)) || {};
    out[id] = {
      url: img.url,
      width: img.width,
      height: img.height,
      title: img.title,
      page: img.page,
      author: credit.author || '',
      license: credit.license || '',
      licenseUrl: credit.licenseUrl || '',
    };
  }

  const outPath = path.join(__dirname, '..', 'src', 'data', 'images.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1), 'utf-8');
  console.log(`\nWrote ${outPath} (${Object.keys(out).length} images)`);

  if (process.argv.includes('--report')) {
    const byCat = {};
    for (const w of data.words) {
      byCat[w.categoryId] = byCat[w.categoryId] || { total: 0, withImg: 0, samples: [] };
      byCat[w.categoryId].total++;
      if (out[w.id]) {
        byCat[w.categoryId].withImg++;
        if (byCat[w.categoryId].samples.length < 8) {
          byCat[w.categoryId].samples.push(`${w.english} -> ${out[w.id].title}`);
        }
      }
    }
    console.log('\n=== coverage by category ===');
    for (const [cat, s] of Object.entries(byCat).sort((a, b) => b[1].withImg - a[1].withImg)) {
      console.log(`\n${cat}: ${s.withImg}/${s.total}`);
      for (const ex of s.samples) console.log('   ', ex);
    }
  }
})();
