// The markup a lesson is written in, and the one parser both ends read it with.
//
// A module of its own, imported by the browser and by the server, for exactly the reason
// `quiz.ts` is: the two have to agree about what a lesson says. The browser parses the body to
// draw the page. The server parses the same body to answer "what should block four sound like"
// and "which quizzes does this lesson embed" — and it must answer from the stored text rather
// than from anything a request tells it, or the speech route becomes a way to make this server
// say arbitrary things in a Georgian voice.
//
// Two parsers would be two readings of one document, and the way that disagreement shows up is
// the cruel kind: a play button that reads out the paragraph above the one it sits beside.
//
// Nothing in here touches a database, a component, or the network.
//
/* ------------------------------------------------------------------ the language
 *
 * Blocks are separated by blank lines, and a block's opening decides what it is:
 *
 *   # Title                     a title
 *   ## Heading                  a heading
 *   ### Subheading              a subheading
 *   > Worth setting apart       a note, ruled off from the prose around it
 *   - one                       a bullet list, one line per bullet
 *   1. one                      a numbered list, likewise
 *   | Person | Georgian |       a table, one line per row; the first row is the header
 *   ---                         a rule
 *   ::image <id> Caption        an uploaded picture, with an optional caption
 *   ::video <link> Caption      a YouTube video, likewise
 *   ::quiz <id>                 a quiz from the quiz screens, answerable in place
 *   ::story <id> [chapter] [no-english]
 *                               a passage from the library, read where it stands
 *   ::say [text]                read the block below this line aloud
 *   ::clip <id>                 play an uploaded recording beside the block below
 *   anything else               a paragraph
 *
 * A paragraph keeps its line breaks. That is a departure from Markdown, which folds them into
 * spaces, and it is deliberate: these are written by somebody laying out example sentences one
 * to a line, and a rule that quietly ran them together would be a rule they have to learn by
 * being surprised.
 *
 * Inside any of them:
 *
 *   **bold**   *italic*   `code`   {red:coloured}   [text](/ka/verbs/see)
 *   {say:ასო, ა}   {clip:<id>}   {img:<id> alt text}
 *
 * The last two are a play button standing in the text, and they are what `::say` and `::clip`
 * cannot be: a block directive attaches sound to a whole block, and a table is one block. An
 * alphabet table wants a button per row, so the button has to be something that goes in a cell —
 * which means an inline form, terminated by its own brace, parsed by the same function that
 * parses a cell.
 *
 * `{red:…}` is the one thing here not borrowed from Markdown, and it exists because colouring
 * *part of a word* is the point of it — {red:მ}ოვდივარ marks the prefix without breaking the
 * word in two, which is what a grammar lesson spends its whole time doing. It nests, so
 * {red:**this**} is both, and it works in a table cell because a table cell is parsed with the
 * same function as everything else.
 *
 * A backslash escapes the character after it, everywhere.
 * ------------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------- colours */

/**
 * The colours a lesson may use, by name.
 *
 * A closed set rather than free hex, and that is worth defending because "let them type
 * #ff0000" is the obvious alternative. A lesson is read on a white page and on a dark one, and
 * a colour chosen against one of them is unreadable on the other; every name here resolves to
 * a CSS variable with a value per theme. It also means a lesson written today still matches the
 * app after the palette is retuned, which a hex code frozen into the prose cannot do.
 */
export const LESSON_COLOURS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'grey'] as const;

export type LessonColour = (typeof LESSON_COLOURS)[number];

export function isLessonColour(value: string): value is LessonColour {
  return (LESSON_COLOURS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------------ nodes */

/** A run of text, or something wrapped around one. */
export type LessonInline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: LessonInline[] }
  | { kind: 'italic'; children: LessonInline[] }
  | { kind: 'code'; text: string }
  | { kind: 'colour'; colour: LessonColour; children: LessonInline[] }
  | { kind: 'link'; href: string; children: LessonInline[] }
  /**
   * A play button standing in the text — `{say:…}` or `{clip:…}`.
   *
   * `slot` is its number among the inline audio of its own block, counted in reading order and
   * filled in after the block is built. The speech route needs it for the reason it needs the
   * block index: a synthesised line is addressed by *where it is*, never by text sent up, and
   * "block 5" is not an address when block 5 is a table with a button on every row. Numbered
   * per block rather than per document so that editing one paragraph does not renumber the
   * buttons in every table below it.
   */
  | { kind: 'audio'; audio: LessonAudio; slot: number }
  /**
   * A small uploaded picture standing in the text — `{img:<id> alt text}`.
   *
   * The inline twin of the `::image` block, and it exists for the reason the inline audio forms
   * do: a block directive attaches one picture to a whole block, and a table is one block. The
   * Russian alphabet table wants a picture *per row* — the cursive form of that letter beside
   * the printed one — which means something that goes in a cell, parsed by the same function
   * that parses a cell.
   *
   * Deliberately carries no size. It is drawn at a couple of lines' height wherever it stands
   * and the renderer makes it openable at a size worth looking at; a lesson that could set its
   * own dimensions would be a lesson that can break a table's layout.
   */
  | { kind: 'image'; mediaId: string; alt: string };

/**
 * Where a block's sound comes from, if it has any. The same pair a quiz question carries, and
 * read the same way: the clip wins when there is one, because somebody recorded it *because*
 * the synthesis was not good enough.
 */
export interface LessonAudio {
  /**
   * What a voice should read out. Resolved at parse time — a bare `::say` is filled in with the
   * plain text of the block it is attached to — so that this field is the whole answer and
   * nothing downstream has to re-derive it. That matters most on the server, which turns it
   * into speech and must reach the same text the reader is looking at.
   */
  say: string;
  /** An uploaded recording, played instead of synthesising `say`. Null for most. */
  clipId: string | null;
}

interface Positioned {
  /**
   * Where this block stands in the document, 0-based.
   *
   * The audio route addresses a block by this number — `/api/lesson/<id>/audio/<index>` — for
   * the reason the quiz route addresses a question by its position: the server holds the text
   * and looks it up, so nothing has to send text up to be spoken. It shifts when the lesson is
   * edited, which is harmless because the server re-parses the current body on every request:
   * the number always means "block four of the lesson as it stands now".
   */
  index: number;
}

export type LessonBlock = Positioned &
  (
    | { kind: 'heading'; level: 1 | 2 | 3; content: LessonInline[]; audio: LessonAudio | null }
    | { kind: 'paragraph'; content: LessonInline[]; audio: LessonAudio | null }
    | { kind: 'note'; content: LessonInline[]; audio: LessonAudio | null }
    | { kind: 'list'; ordered: boolean; items: LessonInline[][]; audio: LessonAudio | null }
    | {
        kind: 'table';
        /** The first row. Empty when the table was written with no header row. */
        header: LessonInline[][];
        rows: LessonInline[][][];
        audio: LessonAudio | null;
      }
    | { kind: 'image'; mediaId: string; caption: LessonInline[] }
    /**
     * A YouTube video.
     *
     * The id and the start time rather than the URL that was typed, because whatever was pasted
     * — a watch link, a share link, a link with a timestamp on it, a bare id — means one video
     * at one moment, and working out which is a job for one function rather than for the
     * renderer. See `youtubeRef`.
     */
    | { kind: 'video'; videoId: string; start: number; caption: LessonInline[] }
    | { kind: 'quiz'; quizId: string }
    /**
     * A passage out of the library, read where it stands.
     *
     * The story is named rather than copied, which is the whole point of it: the text a lesson
     * shows and the text in the library are one text, so correcting a line corrects it in both
     * places, and the words of a dialogue taught in a lesson are the same words the reader can
     * then look up, hear and rate.
     *
     * `chapter` is 0-based here and 1-based in the markup, matching the library's own
     * addresses: `::story ice-queen 2` is the chapter a reader would call the second one.
     *
     * `english` is whether the translation is showing when the passage is first drawn, and it
     * is the lesson's decision because only the lesson knows what the passage is *for*. A
     * dialogue being taught line by line wants its English there; the same dialogue at the end
     * of the chapter, as something to test yourself against, wants it hidden. Either way the
     * reader can turn it over — this sets which side it lands on.
     */
    | { kind: 'story'; storyId: string; chapter: number; english: boolean }
    /** A play button standing on its own — a `::say` or `::clip` with no block under it. */
    | { kind: 'audio'; audio: LessonAudio }
    | { kind: 'rule' }
  );

/**
 * Something the author probably did not mean, and where.
 *
 * Collected rather than thrown, because a lesson is written over several sittings and a
 * half-typed directive is an ordinary state to leave one in. The editor shows these against the
 * line they came from; the reader never sees them and renders whatever *did* parse. Refusing to
 * save would mean the only way to keep a draft is to keep it somewhere else.
 */
export interface LessonWarning {
  /** 1-based, so it matches what a text editor's gutter says. */
  line: number;
  message: string;
}

export interface LessonDoc {
  blocks: LessonBlock[];
  warnings: LessonWarning[];
}

/* ----------------------------------------------------------------- inline parsing */

/**
 * Scans forward for a closing delimiter, stepping over escaped characters.
 *
 * `skipDouble` is what keeps `*italic*` and `**bold**` from fighting. Searching for a single `*`
 * inside `*a **b** c*` would otherwise stop at the first character of `**b**` and italicise
 * "a ", leaving the rest as litter. Stepping over any doubled marker finds the one that closes.
 */
function findClose(source: string, from: number, marker: string, skipDouble = false): number {
  let at = from;
  while (at < source.length) {
    if (source[at] === '\\') {
      at += 2;
      continue;
    }
    if (skipDouble && source.startsWith(marker + marker, at)) {
      at += marker.length * 2;
      continue;
    }
    if (source.startsWith(marker, at)) return at;
    at += 1;
  }
  return -1;
}

/** The `}` that closes the `{` this colour opened with, counting the ones nested inside it. */
function findBrace(source: string, from: number): number {
  let depth = 0;
  let at = from;
  while (at < source.length) {
    const char = source[at];
    if (char === '\\') {
      at += 2;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      if (depth === 0) return at;
      depth -= 1;
    }
    at += 1;
  }
  return -1;
}

/**
 * Where a link may point.
 *
 * An allow-list of shapes rather than a check for the schemes we do not want, because the list
 * of schemes a browser will act on is longer than anybody remembers — `javascript:` is the one
 * everybody thinks of and not the only one. Lessons are written by admins, so this is a guard
 * against a mistake rather than against an attacker, but the cost of it is four lines.
 *
 * Null for anything else, and the parser then renders the text without a link around it: the
 * words are still there, they simply do not go anywhere.
 */
function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  if (href.startsWith('/') || href.startsWith('#')) return href;
  if (/^https?:\/\//i.test(href)) return href;
  return null;
}

/** One line's worth of markup, as nodes. Recursive: everything nests inside everything. */
function parseInline(source: string, warn: (message: string) => void): LessonInline[] {
  const nodes: LessonInline[] = [];
  let pending = '';
  let at = 0;

  const flush = () => {
    if (pending) {
      nodes.push({ kind: 'text', text: pending });
      pending = '';
    }
  };

  while (at < source.length) {
    const char = source[at];

    // A backslash means "the next character is not markup". It is dropped and what follows is
    // kept, which is how a lesson about the alphabet writes a literal { or *.
    if (char === '\\' && at + 1 < source.length) {
      pending += source[at + 1];
      at += 2;
      continue;
    }

    if (source.startsWith('**', at)) {
      const close = findClose(source, at + 2, '**');
      if (close !== -1) {
        flush();
        nodes.push({ kind: 'bold', children: parseInline(source.slice(at + 2, close), warn) });
        at = close + 2;
        continue;
      }
    }

    if (char === '*') {
      const close = findClose(source, at + 1, '*', true);
      if (close !== -1) {
        flush();
        nodes.push({ kind: 'italic', children: parseInline(source.slice(at + 1, close), warn) });
        at = close + 1;
        continue;
      }
    }

    if (char === '`') {
      const close = source.indexOf('`', at + 1);
      if (close !== -1) {
        flush();
        // Not parsed further, which is the whole job of it: `**` inside backticks is two
        // asterisks somebody wants to show a reader.
        nodes.push({ kind: 'code', text: source.slice(at + 1, close) });
        at = close + 1;
        continue;
      }
    }

    if (char === '{') {
      const colon = source.indexOf(':', at + 1);
      const name = colon === -1 ? '' : source.slice(at + 1, colon);
      // A short run of letters, or this is not a colour at all — `{` is an ordinary character
      // in prose and in a set of endings written as {-ს, -მა}, and neither should be swallowed.
      if (/^[a-z]{2,10}$/.test(name)) {
        const close = findBrace(source, colon + 1);
        if (close !== -1) {
          const inner = source.slice(colon + 1, close);

          // `say`, `clip` and `img` are the three names in this namespace that are not colours.
          // Their contents are not markup and are deliberately not parsed: one is a line for a
          // voice to read and two are ids, and bolding half of any of them means nothing.
          if (name === 'say' || name === 'clip' || name === 'img') {
            flush();
            if (name === 'say') {
              const text = inner.trim();
              if (text) nodes.push({ kind: 'audio', audio: { say: text, clipId: null }, slot: 0 });
              else warn('“{say:…}” needs something to read out between the braces.');
            } else if (name === 'clip') {
              const id = inner.trim();
              if (MEDIA_ID.test(id)) nodes.push({ kind: 'audio', audio: { say: '', clipId: id }, slot: 0 });
              else warn('“{clip:…}” wants the id of an uploaded recording — pick one from the media list.');
            } else {
              // `{img:<id> alt text}` — the id, then whatever describes it. The description is
              // optional here and not in `::image`, because the caption of a block image is what
              // a reader sees under it while this one has nowhere to put a caption at all; the
              // words are the alt text and the label on the button that enlarges it.
              const [id, ...rest] = inner.trim().split(/\s+/);
              const alt = rest.join(' ');
              if (MEDIA_ID.test(id)) nodes.push({ kind: 'image', mediaId: id, alt });
              else warn('“{img:…}” wants the id of an uploaded picture — pick one from the media list.');
            }
            at = close + 1;
            continue;
          }

          flush();
          const children = parseInline(inner, warn);
          if (isLessonColour(name)) {
            nodes.push({ kind: 'colour', colour: name, children });
          } else {
            // The text survives, uncoloured. Losing a word because its colour was misspelled
            // would be a far worse answer than showing it in the ordinary ink and saying so.
            warn(`There is no colour called “${name}”. Try one of: ${LESSON_COLOURS.join(', ')}.`);
            nodes.push(...children);
          }
          at = close + 1;
          continue;
        }
      }
    }

    if (char === '[') {
      const close = findClose(source, at + 1, ']');
      if (close !== -1 && source[close + 1] === '(') {
        const end = source.indexOf(')', close + 2);
        if (end !== -1) {
          const href = safeHref(source.slice(close + 2, end));
          const children = parseInline(source.slice(at + 1, close), warn);
          flush();
          if (href) {
            nodes.push({ kind: 'link', href, children });
          } else {
            warn('A link has to point at a path on this site or at an http address.');
            nodes.push(...children);
          }
          at = end + 1;
          continue;
        }
      }
    }

    pending += char;
    at += 1;
  }

  flush();
  return nodes;
}

/* ------------------------------------------------------------------ block parsing */

/** What `::name rest` says. Null for a line that is not a directive. */
function readDirective(line: string): { name: string; rest: string } | null {
  if (!line.startsWith('::')) return null;
  const body = line.slice(2).trim();
  const space = body.search(/\s/);
  return space === -1
    ? { name: body.toLowerCase(), rest: '' }
    : { name: body.slice(0, space).toLowerCase(), rest: body.slice(space + 1).trim() };
}

/** Whether a line opens a block of its own, which is what ends the paragraph above it. */
function opensBlock(line: string): boolean {
  return (
    line.startsWith('::') ||
    line.startsWith('#') ||
    line.startsWith('>') ||
    line.startsWith('|') ||
    /^-\s/.test(line) ||
    /^\d+[.)]\s/.test(line) ||
    /^-{3,}\s*$/.test(line)
  );
}

/** A media id as it is written in a directive: the ids `lesson_media` mints, and nothing else. */
const MEDIA_ID = /^[a-f0-9]{16}$/;

/* ------------------------------------------------------------------- YouTube */

/** YouTube's own id: eleven characters of base64url, and it has been eleven since 2005. */
const YOUTUBE_ID = /^[\w-]{11}$/;

/**
 * A YouTube timestamp as seconds. `90`, `90s`, `1m30s`, `1h2m3s` — all of which YouTube writes.
 *
 * Zero for anything it does not recognise rather than null, because a start time is a
 * refinement of "play this video" and losing it is not worth refusing the video over.
 */
function seconds(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);

  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!parts || !parts.slice(1).some(Boolean)) return 0;
  return Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0);
}

/**
 * Which video a `::video` names, and where to start it. Null when it names none.
 *
 * Every shape YouTube hands out is accepted, because every one of them is something somebody
 * will paste: the address bar's `watch?v=`, the share button's `youtu.be/`, an `embed/` URL
 * copied out of somebody else's page, a `shorts/` link, a `live/` link, and the bare id for
 * anyone who knows it. Asking an author to extract eleven characters from a URL by hand would
 * be asking them to do something a function can do without ever getting it wrong.
 *
 * Exported because the editor validates what has been pasted with it *before* writing the
 * directive — same function, same answer, so the box cannot say a link is fine and the parser
 * then disagree.
 */
export function youtubeRef(raw: string): { id: string; start: number } | null {
  const text = raw.trim();
  if (!text) return null;
  if (YOUTUBE_ID.test(text)) return { id: text, start: 0 };

  let url: URL;
  try {
    // A pasted `youtu.be/xyz` with no scheme is still a link somebody meant.
    url = new URL(text.includes('//') ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');
  const path = url.pathname.replace(/^\/+/, '');

  let id = '';
  if (host === 'youtu.be') {
    id = path.split('/')[0];
  } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    // `watch?v=` first, then the four path shapes. The trailing split guards against the extra
    // segments a `live/` or `embed/` URL sometimes carries.
    id = url.searchParams.get('v') ?? /^(?:embed|shorts|v|live)\/(.+)$/.exec(path)?.[1].split('/')[0] ?? '';
  }

  if (!YOUTUBE_ID.test(id)) return null;

  // `t` on a watch link, `start` on an embed one, `#t=` on the old share links.
  const stamp =
    url.searchParams.get('t') ??
    url.searchParams.get('start') ??
    (url.hash.startsWith('#t=') ? url.hash.slice(3) : null);

  return { id, start: seconds(stamp) };
}

/**
 * The document, from its source.
 *
 * Total: there is no input this refuses. Anything it cannot make sense of becomes a paragraph
 * or a warning, so a body saved half-written renders as far as it goes. See `LessonWarning`.
 */
export function parseLesson(source: string): LessonDoc {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  const blocks: LessonBlock[] = [];
  const warnings: LessonWarning[] = [];

  /** A `::say` or `::clip` waiting for a block to attach itself to, and the line it came from. */
  let pending: { audio: LessonAudio; bare: boolean; line: number } | null = null;

  let at = 0;

  const warn = (line: number, message: string) => warnings.push({ line: line + 1, message });
  const inline = (text: string, line: number) => parseInline(text, message => warn(line, message));

  /**
   * Files a block, giving it whatever audio was waiting.
   *
   * A bare `::say` is filled in here rather than at the play button, because this is the only
   * place that has both the directive and the text it was written above. The alternative —
   * leaving `say` empty and working it out when somebody presses play — would put the same
   * derivation in the reader *and* in the speech route, which is the split this module exists
   * to avoid.
   */
  const push = (block: LessonBlock) => {
    if (pending && 'audio' in block) {
      const audio = pending.audio;
      block.audio = pending.bare ? { ...audio, say: plainInline(contentOf(block)) } : audio;
      pending = null;
    }
    blocks.push(block);
  };

  /** Anything still waiting when a block cannot take it becomes a play button of its own. */
  const settle = () => {
    if (!pending) return;
    if (pending.audio.clipId || pending.audio.say) {
      blocks.push({ index: blocks.length, kind: 'audio', audio: pending.audio });
    } else {
      warn(pending.line, '“::say” on its own reads out the block below it — but there is none here.');
    }
    pending = null;
  };

  while (at < lines.length) {
    const raw = lines[at];
    const line = raw.trim();

    if (!line) {
      // A blank line ends a block, and it also ends the reach of a `::say`: audio attaches to
      // the block written *under* it, and a gap means there is nothing under it.
      settle();
      at += 1;
      continue;
    }

    const index = blocks.length;

    /* -- directives -- */

    const directive = readDirective(line);
    if (directive) {
      const { name, rest } = directive;

      if (name === 'say') {
        settle();
        pending = { audio: { say: rest, clipId: null }, bare: rest === '', line: at };
        at += 1;
        continue;
      }

      if (name === 'clip') {
        settle();
        const id = rest.split(/\s/)[0] ?? '';
        if (!MEDIA_ID.test(id)) {
          warn(at, '“::clip” wants the id of an uploaded recording — pick one from the media list.');
        } else {
          pending = { audio: { say: '', clipId: id }, bare: false, line: at };
        }
        at += 1;
        continue;
      }

      if (name === 'image') {
        settle();
        const space = rest.search(/\s/);
        const id = space === -1 ? rest : rest.slice(0, space);
        const caption = space === -1 ? '' : rest.slice(space + 1).trim();
        if (!MEDIA_ID.test(id)) {
          warn(at, '“::image” wants the id of an uploaded picture — pick one from the media list.');
        } else {
          blocks.push({ index, kind: 'image', mediaId: id, caption: inline(caption, at) });
        }
        at += 1;
        continue;
      }

      if (name === 'video') {
        settle();
        const space = rest.search(/\s/);
        const ref = space === -1 ? rest : rest.slice(0, space);
        const caption = space === -1 ? '' : rest.slice(space + 1).trim();
        const video = youtubeRef(ref);
        if (!video) {
          warn(at, '“::video” wants a YouTube link — paste the one from the address bar or from Share.');
        } else {
          blocks.push({
            index,
            kind: 'video',
            videoId: video.id,
            start: video.start,
            caption: inline(caption, at),
          });
        }
        at += 1;
        continue;
      }

      if (name === 'quiz') {
        settle();
        const id = rest.split(/\s/)[0] ?? '';
        if (!id) {
          warn(at, '“::quiz” wants the id of a quiz — the one in its address bar on the quiz screens.');
        } else {
          blocks.push({ index, kind: 'quiz', quizId: id });
        }
        at += 1;
        continue;
      }

      if (name === 'story') {
        settle();
        const [id, ...options] = rest.split(/\s+/).filter(Boolean);

        if (!id) {
          warn(at, '“::story” wants the id of something in the library — the one in its address bar.');
          at += 1;
          continue;
        }

        // The options are read by what they are rather than by where they stand: a chapter is
        // a number and the rest are words. Two things to say and no reason to make an author
        // remember which order they go in.
        let chapter = 0;
        let english = true;
        let bad = false;

        for (const option of options) {
          if (/^[1-9][0-9]*$/.test(option)) {
            chapter = Number(option) - 1;
          } else if (option === 'english') {
            english = true;
          } else if (option === 'no-english') {
            english = false;
          } else {
            // Refused rather than ignored. A lesson that meant to hide the translation and
            // typed it slightly wrong would otherwise show it, with nothing anywhere to say
            // why — and the same for a chapter number that came out as a word.
            warn(
              at,
              `“::story ${id} ${option}” — after the id comes a chapter number, “english”, or “no-english”.`,
            );
            bad = true;
          }
        }

        if (!bad) blocks.push({ index, kind: 'story', storyId: id, chapter, english });
        at += 1;
        continue;
      }

      settle();
      warn(at, `“::${name}” is not something a lesson can do. Try image, video, quiz, story, say or clip.`);
      at += 1;
      continue;
    }

    /* -- headings -- */

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      push({
        index,
        kind: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        content: inline(heading[2].trim(), at),
        audio: null,
      });
      at += 1;
      continue;
    }

    /* -- a rule -- */

    if (/^-{3,}$/.test(line)) {
      settle();
      blocks.push({ index, kind: 'rule' });
      at += 1;
      continue;
    }

    /* -- a table -- */

    if (line.startsWith('|')) {
      const start = at;
      const rows: LessonInline[][][] = [];
      let header: LessonInline[][] = [];

      while (at < lines.length && lines[at].trim().startsWith('|')) {
        const cells = splitRow(lines[at].trim());
        // The `|---|---|` under a header row is punctuation rather than data: it is what says
        // the row above it is a header, and it is optional — a table written without one is a
        // grid of cells, which is sometimes exactly what is wanted.
        if (cells.every(cell => /^:?-{2,}:?$/.test(cell.trim()))) {
          if (rows.length === 1) {
            header = rows[0];
            rows.length = 0;
          }
          at += 1;
          continue;
        }
        rows.push(cells.map(cell => inline(cell.trim(), at)));
        at += 1;
      }

      push({ index, kind: 'table', header, rows, audio: null });
      if (!rows.length && !header.length) warn(start, 'That table has no rows in it.');

      // A `::say` *between* two rows is the one mistake this block shape invites, and it is
      // invisible in the result: the table ends there, the directive attaches to whatever comes
      // next, and what comes next is the rest of the same table — which now renders as a second
      // table with the first row of it as a header. A `::say` immediately *after* the last row
      // is not this, and is a perfectly ordinary way to voice the paragraph below, so the test
      // is specifically "and there are more rows under it".
      if (/^::(say|clip)\b/.test(lines[at]?.trim() ?? '') && (lines[at + 1]?.trim() ?? '').startsWith('|')) {
        warn(
          at,
          'Audio inside a table goes in a cell — “{say:…}” or “{clip:<id>}”. “::say” attaches to the ' +
            'whole block below it, which here splits the table in two.',
        );
      }
      continue;
    }

    /* -- lists -- */

    const bullet = /^-\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const items: LessonInline[][] = [];

      while (at < lines.length) {
        const entry = lines[at].trim();
        const match = ordered ? /^\d+[.)]\s+(.*)$/.exec(entry) : /^-\s+(.*)$/.exec(entry);
        if (!match) break;
        items.push(inline(match[1].trim(), at));
        at += 1;
      }

      push({ index, kind: 'list', ordered, items, audio: null });
      continue;
    }

    /* -- a note -- */

    if (line.startsWith('>')) {
      const parts: string[] = [];
      while (at < lines.length && lines[at].trim().startsWith('>')) {
        parts.push(lines[at].trim().replace(/^>\s?/, ''));
        at += 1;
      }
      push({ index, kind: 'note', content: inline(parts.join('\n'), at - 1), audio: null });
      continue;
    }

    /* -- a paragraph, which is everything else -- */

    // The first line is taken unconditionally, and that is not a shortcut: everything above
    // has already declined it, and a `#` or a `-` with no space after it looks like a block
    // opening to `opensBlock` while matching none of the patterns that consume one. Testing it
    // again here would take nothing and leave `at` where it was, which is a loop that hangs the
    // tab rather than a paragraph that renders oddly.
    const from = at;
    const parts: string[] = [line];
    at += 1;

    while (at < lines.length) {
      const entry = lines[at].trim();
      if (!entry || opensBlock(entry)) break;
      parts.push(entry);
      at += 1;
    }
    push({ index, kind: 'paragraph', content: inline(parts.join('\n'), from), audio: null });
  }

  settle();
  for (const block of blocks) numberAudio(block);
  return { blocks, warnings };
}

/** One `| a | b |` row, as its cells. The bars at either end are punctuation, not empty cells. */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  // From 1: the leading bar opened the row. A trailing bar closes the last cell below.
  for (let at = 1; at < line.length; at += 1) {
    const char = line[at];
    if (char === '\\' && at + 1 < line.length) {
      cell += char + line[at + 1];
      at += 1;
      continue;
    }
    if (char === '|') {
      cells.push(cell);
      cell = '';
      continue;
    }
    cell += char;
  }
  if (cell.trim()) cells.push(cell);
  return cells;
}

/* --------------------------------------------------------------------- reading it */

/**
 * Every inline array a block holds, in reading order.
 *
 * The arrays themselves rather than a flattened copy, because `numberAudio` writes into the
 * nodes it finds — `contentOf` below builds new arrays with separators between them, which is
 * exactly what is wanted for reading a block aloud and exactly wrong for numbering it.
 */
function inlineArrays(block: LessonBlock): LessonInline[][] {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
    case 'note':
      return [block.content];
    case 'list':
      return block.items;
    case 'table':
      return [block.header, ...block.rows].flat();
    case 'image':
    case 'video':
      return [block.caption];
    default:
      return [];
  }
}

/**
 * Numbers a block's inline play buttons, in reading order.
 *
 * A pass of its own, after the block is built, because `parseInline` is recursive and has no
 * idea which block it is filling — a cell does not know it is the third cell of a table. Doing
 * it here means the numbers are assigned in exactly the order the arrays are laid out, which is
 * the order the reader sees and the order the server will count when it looks one up.
 */
function numberAudio(block: LessonBlock): void {
  let slot = 0;

  const walk = (nodes: LessonInline[]): void => {
    for (const node of nodes) {
      if (node.kind === 'audio') {
        node.slot = slot;
        slot += 1;
      } else if ('children' in node) {
        walk(node.children);
      }
    }
  };

  for (const nodes of inlineArrays(block)) walk(nodes);
}

/** A separator dropped between the parts of a block that has several. See `contentOf`. */
function gap(text: string): LessonInline {
  return { kind: 'text', text };
}

/** `[a, b, c]` → `a, sep, b, sep, c`. */
function join(parts: LessonInline[][], separator: LessonInline): LessonInline[] {
  return parts.flatMap((part, at) => (at === 0 ? part : [separator, ...part]));
}

/**
 * The inline content of whichever blocks have any, flattened.
 *
 * The separators matter more than they look. This is what a bare `::say` reads out and what an
 * excerpt is cut from, and a table flattened without them gives "1sgვხატავI draw" — three cells
 * run together into one unpronounceable word. A comma between cells and a stop between rows is
 * what the voice needs to read a table as a table.
 */
function contentOf(block: LessonBlock): LessonInline[] {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
    case 'note':
      return block.content;
    case 'list':
      return join(block.items, gap('. '));
    case 'table':
      return join(
        [block.header, ...block.rows].filter(row => row.length).map(row => join(row, gap(', '))),
        gap('. '),
      );
    case 'image':
    case 'video':
      return block.caption;
    default:
      return [];
  }
}

/**
 * Markup taken off: what a voice reads, and what a search box matches.
 *
 * A `{say:…}` contributes nothing, and that is right rather than lazy: it is a button, not words
 * on the page. Counting its text would put the line twice into an excerpt of a paragraph that
 * reads itself aloud, and would make a bare `::say` above such a paragraph read the line, then
 * the paragraph, then the line again.
 */
export function plainInline(nodes: LessonInline[]): string {
  return nodes
    .map(node => {
      if (node.kind === 'text' || node.kind === 'code') return node.text;
      // A play button and a picture both say nothing in plain text. The picture's alt text is
      // deliberately not returned: this feeds excerpts, search and the speech route, and "the
      // cursive form of Б" is a description of a picture rather than part of the lesson's prose.
      if (node.kind === 'audio' || node.kind === 'image') return '';
      return plainInline(node.children);
    })
    .join('');
}

/** The whole lesson as plain text, one block per line. For excerpts and for searching. */
export function plainLesson(doc: LessonDoc): string {
  return doc.blocks
    .map(block => plainInline(contentOf(block)).replaceAll('\n', ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * What block `index` should say, or null when it has nothing to say.
 *
 * The speech route's whole reading of a lesson. Null for a block whose audio is an uploaded
 * clip as well as for one with no audio at all, and the two are the same answer on purpose:
 * that route synthesises, a clip has a URL of its own, and a request landing here for a
 * clip-backed block is a client that built the wrong URL rather than something to paper over.
 * The same division the quiz audio routes make.
 */
export function spokenText(doc: LessonDoc, index: number, slot?: number): string | null {
  const block = doc.blocks[index];
  if (!block) return null;

  // With a slot, one of the block's inline buttons; without one, the block's own audio. Two
  // addresses rather than one because a table has both: sound attached to the whole of it by a
  // `::say` above, and a button per row inside it.
  const audio = slot === undefined ? ('audio' in block ? block.audio : null) : inlineAudio(block, slot);

  if (!audio || audio.clipId) return null;
  return audio.say.trim() || null;
}

/** The inline play button numbered `slot` in this block, or null. See `numberAudio`. */
function inlineAudio(block: LessonBlock, slot: number): LessonAudio | null {
  const find = (nodes: LessonInline[]): LessonAudio | null => {
    for (const node of nodes) {
      if (node.kind === 'audio') {
        if (node.slot === slot) return node.audio;
      } else if ('children' in node) {
        const found = find(node.children);
        if (found) return found;
      }
    }
    return null;
  };

  for (const nodes of inlineArrays(block)) {
    const found = find(nodes);
    if (found) return found;
  }
  return null;
}

/**
 * Every play button in the lesson, block-level and inline. What the index badges.
 *
 * A `::story` counts as one. Its lines are read aloud by the same voice a `::say` is, and on the
 * same terms — both draw a button wherever the deployment has speech and neither does where it
 * has none. Leaving it out would take the badge off a lesson whose whole body is a dialogue you
 * can listen to line by line, which is exactly the lesson the badge is for.
 */
export function lessonHasAudio(doc: LessonDoc): boolean {
  const anyInline = (nodes: LessonInline[]): boolean =>
    nodes.some(node => (node.kind === 'audio' ? true : 'children' in node && anyInline(node.children)));

  return doc.blocks.some(
    block =>
      block.kind === 'story' ||
      ('audio' in block && block.audio !== null) ||
      inlineArrays(block).some(nodes => anyInline(nodes)),
  );
}

/** Every quiz this lesson embeds, in the order it embeds them, without repeats. */
export function lessonQuizIds(doc: LessonDoc): string[] {
  return [...new Set(doc.blocks.flatMap(block => (block.kind === 'quiz' ? [block.quizId] : [])))];
}

/**
 * Every uploaded picture and recording this lesson names, without repeats.
 *
 * The inline `{clip:…}` buttons count as much as the block-level ones, and forgetting them here
 * would be the one bug in this file that destroys something: the delete guard asks this question
 * to decide whether an upload is still wanted, and a recording used only inside a table would
 * have looked unused.
 */
export function lessonMediaIds(doc: LessonDoc): string[] {
  const inlineClips = (nodes: LessonInline[]): string[] =>
    nodes.flatMap(node => {
      if (node.kind === 'audio') return node.audio.clipId ? [node.audio.clipId] : [];
      return 'children' in node ? inlineClips(node.children) : [];
    });

  return [
    ...new Set(
      doc.blocks.flatMap(block => [
        ...(block.kind === 'image' ? [block.mediaId] : []),
        ...('audio' in block && block.audio?.clipId ? [block.audio.clipId] : []),
        ...inlineArrays(block).flatMap(inlineClips),
      ]),
    ),
  ];
}

/**
 * The first paragraph, trimmed to something a card can show.
 *
 * Derived rather than stored, so it cannot fall out of step with the lesson — the same bargain
 * a story's excerpt strikes, which is read out of its first paragraph at assembly time.
 */
export function lessonExcerpt(doc: LessonDoc, limit = 220): string {
  const first = doc.blocks.find(block => block.kind === 'paragraph');
  if (!first) return '';
  const text = plainInline(contentOf(first)).replaceAll('\n', ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}
