// Bringing a video in: the bookmarklet, and the box its output goes into.
//
// Three steps on one screen rather than a wizard, because the first is done once ever and the
// other two are done together. Somebody importing their second video sees a screen whose top
// third they can ignore, which is the right shape for a thing that stops being interesting.
//
// The URL box is not how the subtitles are fetched — nothing here talks to YouTube — and the
// screen has to say so, or the button next to it reads as "go and get it" and every failure
// afterwards is a surprise. It is here because the reader has the URL in hand at exactly this
// moment, and it is what makes the link to the video one click instead of a search.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ClipboardPaste, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "../api/client";
import { lang, langName } from "../content/store";
import { useLibraryEdit } from "../library/store";
import { ErrorLine, Field, Hint, Input, Label, Note, Section, SectionTitle, Textarea } from "../library/ui";
import { bookmarkletSource, readPasted, videoId, wrongScript } from "./bookmarklet";
import { videoHref } from "./href";

/**
 * A box of a fixed size that scrolls, rather than one that grows to fit what is in it.
 *
 * `field-sizing-fixed` is the load-bearing half, and it is undoing something rather than adding
 * it: the base `Textarea` sets `field-sizing-content`, which is a fine default for a note or a
 * paragraph and quite wrong here. What gets pasted into this box is a whole film's subtitles —
 * thousands of lines of JSON, or a transcript with a timestamp every two seconds — so a box that
 * grew to fit its content would push the Import button several screens down the page the moment
 * the paste landed, and the reader would be left looking at a wall of text with no way to
 * proceed that did not involve scrolling to find it.
 *
 * `resize-y` stays: fixed is the size it starts at, not a size it is held to.
 */
const TALL = "h-48 field-sizing-fixed resize-y overflow-auto text-[13px] md:text-[13px] font-mono";

export default function VideoImport() {
  const navigate = useNavigate();
  const { busy, error, run } = useLibraryEdit();

  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [pasted, setPasted] = useState("");
  const [complaint, setComplaint] = useState<string | null>(null);

  // Built once. It is a couple of kilobytes of encoded source and nothing about it changes
  // while the screen is open.
  const bookmarklet = useMemo(() => bookmarkletSource(window.location.origin), []);

  /**
   * The address is put on the node, not passed as a prop, and it has to be.
   *
   * React refuses to render a `javascript:` href — as of 19 it throws rather than warning — so
   * written the obvious way this anchor came out with no address at all, and what got dragged to
   * the bookmarks bar was an empty bookmark that did nothing when clicked. The DOM itself has no
   * objection; the guard is React's own, and it exists because a `javascript:` URL assembled
   * from user input is an XSS. This one is a constant in the bundle with nothing of anybody's in
   * it, which is the case the guard is not for.
   */
  const anchor = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    anchor.current?.setAttribute("href", bookmarklet);
  }, [bookmarklet]);

  const typed = videoId(url);
  const watch = typed ? `https://www.youtube.com/watch?v=${typed}` : "";

  const submit = async () => {
    setComplaint(null);

    const grabbed = readPasted(pasted);
    if (typeof grabbed === "string") {
      setComplaint(grabbed);
      return;
    }

    // Only worth saying when both are present and they disagree — which almost always means the
    // bookmarklet was clicked on a different video from the one whose URL is in the box, and
    // importing the wrong one silently is worse than one more click.
    if (grabbed.v && typed && grabbed.v !== typed) {
      setComplaint(
        `The URL above is ${typed} but the subtitles are from ${grabbed.v}. Import the ones you pasted, or clear the URL.`,
      );
      return;
    }

    // The language check, before anything is sent. See `wrongScript`: the transcript panel and
    // the caption track have separate language settings, and the panel very often defaults to an
    // automatic translation into the reader's own language instead of what is being spoken.
    const mismatch = wrongScript(lang(), grabbed.cues);
    if (mismatch) {
      setComplaint(mismatch);
      return;
    }

    // A copied transcript says nothing about which video it came off, so the URL stops being
    // optional the moment that is what was pasted.
    const which = grabbed.v ?? typed;
    if (!which) {
      setComplaint("A copied transcript does not say which video it is. Put the URL in the box above.");
      return;
    }

    // Said here rather than left to the server's own words. Every other refusal below comes from
    // a procedure that knows what it is refusing and says so; this one comes from the transport,
    // which knows only that a body was too big, and answers "Payload Too Large" — which reads as
    // a fault rather than as "that video is longer than this handles".
    if (grabbed.cues.length > 5_000) {
      setComplaint(
        `That is ${grabbed.cues.length} subtitle lines, and 5,000 is the most that can be imported at ` +
          "once. Import a video that long in parts, or trim the transcript before pasting it.",
      );
      return;
    }

    const done = await run(() =>
      api.library.importVideo({
        lang: lang(),
        youtubeId: which,
        title: grabbed.title ?? (title.trim() || which),
        cues: grabbed.cues,
      }),
    );

    if (done) navigate(videoHref(done.id));
  };

  return (
    <>
      <Section>
        <SectionTitle>1. The video</SectionTitle>
        <Field>
          <Label>Its address</Label>
          <Input
            id="video-url"
            aria-label="The video address"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            autoComplete="off"
            spellCheck={false}
          />
          <Hint>
            {url && !typed
              ? "That does not have a video id in it."
              : "Nothing is fetched from here — this only says which video the lines below belong to."}
          </Hint>
        </Field>
        <Field>
          <Label>What to call it</Label>
          <Input
            id="video-title"
            aria-label="What to call it"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Optional — the bookmarklet fills this in"
            autoComplete="off"
          />
        </Field>
        {watch && (
          <a
            href={watch}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            <Link2 className="size-4" />
            Open it on YouTube
          </a>
        )}
      </Section>

      <Section>
        <SectionTitle>2. Get its subtitles — either way</SectionTitle>
        <Note>
          Subtitles cannot be fetched from this page. Your browser will not let one site read another's data, and a
          server that went looking would be treated as a bot. So the lines are collected on YouTube's own page and
          pasted back here.
        </Note>

        <div className="mt-4 rounded-md border border-border p-3">
          <p className="mb-1 text-sm font-semibold">By hand — works everywhere</p>
          <p className="text-sm text-muted-foreground">
            Under the video, open <strong>…more</strong> → <strong>Show transcript</strong>. Select the whole panel,
            copy it, and paste it below. Times come out to the nearest second, which is close enough to follow a line as
            it is spoken.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            <strong className="text-foreground">Check what language it is in.</strong> YouTube chooses the panel's
            language itself and no longer offers a way to change it, so on some videos it shows an automatic translation
            instead of the {langName()} being spoken. There is nothing to set — if the panel is not in {langName()}, use
            the bookmarklet below, which asks you which track to take.
          </p>
        </div>

        <div className="mt-3 rounded-md border border-border p-3">
          <p className="mb-1 text-sm font-semibold">With the bookmarklet — exact times</p>
          <p className="mb-3 text-sm text-muted-foreground">
            Drag this to your bookmarks bar, then click it on any video's page. It reads the real caption track and asks
            which one, so the timings are exact rather than rounded and the language is the one you chose rather than
            the one YouTube picked.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {/* A real anchor with a javascript: href, because dragging is how a bookmarklet is
                installed and only a link can be dragged, and its href is set in the effect above
                rather than here. The click handler explains rather than runs it: on this page it
                would execute against this page, which is not YouTube. */}
            <a
              ref={anchor}
              draggable
              onClick={(event) => {
                event.preventDefault();
                setComplaint("Drag that button to your bookmarks bar — clicking it here does nothing.");
              }}
              className="inline-flex cursor-grab items-center gap-2 rounded-md border border-border-strong bg-card px-3 py-2 text-sm font-semibold shadow-card active:cursor-grabbing"
            >
              <ClipboardPaste className="size-4" />
              Get subtitles
            </a>
            <Hint>Drag, do not click. You only install it once.</Hint>
          </div>
        </div>
      </Section>

      <Section>
        <SectionTitle>3. Paste it here</SectionTitle>
        <Field>
          <Label>The subtitles</Label>
          <Textarea
            id="video-cues"
            aria-label="The subtitles"
            className={cn(TALL)}
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            placeholder={"0:00\nდილა მშვიდობისა…\n0:04\n…\n\nor the JSON the bookmarklet copies"}
            spellCheck={false}
          />
          <Hint>Either form. Each subtitle line becomes a paragraph, timed to the video.</Hint>
        </Field>

        {complaint && <ErrorLine>{complaint}</ErrorLine>}
        {error && <ErrorLine>{error}</ErrorLine>}

        <div className="mt-4 flex items-center gap-3">
          <Button type="button" onClick={() => void submit()} disabled={busy || !pasted.trim()}>
            {busy ? "Reading it…" : "Import"}
            <ArrowRight />
          </Button>
          {busy && <Hint>Linking every word against the dictionary. A long video takes a moment.</Hint>}
        </div>
      </Section>
    </>
  );
}
