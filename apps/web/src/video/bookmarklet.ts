// The half of the import that has to run somewhere else.
//
// A caption track cannot be fetched from this app, and no amount of server is going to change
// that. The browser will not let a page on our origin read a response from youtube.com — that
// is the same-origin rule, and `fetch` with `no-cors` returns a response with the body sealed,
// so there is nothing to be clever with. Going around it from the server means a request from a
// datacentre address, which is the exact traffic YouTube answers with a bot check.
//
// What is left is to run the fetch on YouTube's own origin, where it is not cross-origin at
// all, and where it carries the reader's own session. A bookmarklet is the smallest thing that
// can do that: no extension, no store, no install beyond dragging a link to the bookmarks bar.
// The reader opens a video as they normally would, clicks it, and gets JSON to paste back here.
//
// Three things about the code below are deliberate and worth not undoing.
//
//   **It reads `ytInitialPlayerResponse` first and re-fetches the page second.** The global is
//   there on a fresh load and is the cheapest possible answer, but YouTube is a single-page app
//   and clicking from one video to the next leaves the *first* video's object in place. So the
//   id on it is checked against the id in the URL, and a disagreement means fetching the watch
//   page and reading the object out of the HTML instead.
//
//   **It ends at the clipboard rather than posting to us.** Posting would be one click fewer
//   and it is the first thing anybody reaches for, but a bookmarklet runs in YouTube's page and
//   is therefore bound by YouTube's Content-Security-Policy, whose `connect-src` decides where
//   that page may send a request — and our origin is not on it. The clipboard is not a network
//   call and no policy governs it.
//
//   **It shows the JSON in a panel even after copying it.** `navigator.clipboard.writeText`
//   throws when the document is not focused, and clicking a bookmark is precisely a moment when
//   focus has just left the document. It usually comes back in time. When it does not, a panel
//   with the text already selected is the difference between a feature that works and one that
//   fails with nothing on screen.

import type { Lang } from '@georgian/shared/grammar';

/** Where a caption track's cues come from, once a track has been chosen. */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

/**
 * The bookmarklet's source, as it is dragged to the bookmarks bar.
 *
 * Written as one string rather than a function put through `toString()`, because a build step
 * that minifies or transpiles this file would rewrite a function body and there is no reason
 * for the result to keep working. This has to survive intact: it is the one piece of the app
 * that runs somewhere the app cannot see.
 *
 * `origin` is baked in only so the panel can say where to paste it. Nothing is sent there.
 */
export function bookmarkletSource(origin: string): string {
  const code = `(function(){
  var W = window, D = document;
  if (!/(^|\\.)youtube\\.com$/.test(location.hostname)) {
    alert('Open the video on YouTube first, then click this.');
    return;
  }
  var id = new URLSearchParams(location.search).get('v');
  if (!id && /^\\/(shorts|embed|live)\\//.test(location.pathname)) id = location.pathname.split('/')[2];
  if (!id) { alert('This does not look like a video page.'); return; }

  function panel(text, note) {
    var back = D.createElement('div');
    back.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:24px';
    var box = D.createElement('div');
    box.style.cssText = 'background:#fff;color:#111;border-radius:10px;padding:16px;max-width:640px;width:100%;font:14px/1.5 system-ui,sans-serif';
    var head = D.createElement('p');
    head.style.cssText = 'margin:0 0 8px;font-weight:600';
    head.textContent = note;
    var sub = D.createElement('p');
    sub.style.cssText = 'margin:0 0 10px;color:#555';
    sub.textContent = 'Paste it into the import box at ${origin}';
    var area = D.createElement('textarea');
    area.style.cssText = 'width:100%;height:180px;font:12px/1.4 ui-monospace,monospace;padding:8px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box';
    area.value = text;
    var row = D.createElement('div');
    row.style.cssText = 'margin-top:10px;display:flex;gap:8px;justify-content:flex-end';
    var copy = D.createElement('button');
    copy.textContent = 'Copy';
    copy.style.cssText = 'padding:7px 14px;border-radius:6px;border:1px solid #888;background:#f4f4f4;cursor:pointer';
    copy.onclick = function () {
      area.select();
      try { D.execCommand('copy'); copy.textContent = 'Copied'; } catch (e) { copy.textContent = 'Press Ctrl+C'; }
    };
    var shut = D.createElement('button');
    shut.textContent = 'Close';
    shut.style.cssText = 'padding:7px 14px;border-radius:6px;border:1px solid #888;background:#fff;cursor:pointer';
    shut.onclick = function () { back.remove(); };
    row.appendChild(copy); row.appendChild(shut);
    box.appendChild(head); box.appendChild(sub); box.appendChild(area); box.appendChild(row);
    back.appendChild(box);
    D.body.appendChild(back);
    area.focus(); area.select();
  }

  // The player object holds the caption track list. On a fresh load it is a global; after a
  // click from one video to another it is the previous video's, so the id decides which.
  function playerResponse() {
    var have = W.ytInitialPlayerResponse;
    if (have && have.videoDetails && have.videoDetails.videoId === id) return Promise.resolve(have);
    return fetch('/watch?v=' + id, { credentials: 'include' })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var at = html.indexOf('ytInitialPlayerResponse');
        if (at < 0) throw new Error('no player response');
        var open = html.indexOf('{', at);
        // Brace matching rather than a regular expression, and quote-aware so that a brace
        // inside a video title does not end the object early. Titles contain everything.
        var depth = 0, quote = false, esc = false, i = open;
        for (; i < html.length; i++) {
          var c = html[i];
          if (esc) { esc = false; continue; }
          if (c === '\\\\') { esc = true; continue; }
          if (c === '"') { quote = !quote; continue; }
          if (quote) continue;
          if (c === '{') depth++;
          else if (c === '}') { depth--; if (!depth) break; }
        }
        return JSON.parse(html.slice(open, i + 1));
      });
  }

  // YouTube's own entity encoding, which is applied twice in the XML track: an apostrophe
  // arrives as &amp;#39;. One pass through an element's innerHTML undoes the layer the XML
  // parser did not.
  function decode(text) {
    var box = D.createElement('textarea');
    box.innerHTML = text;
    return box.value;
  }

  function tidy(text) {
    return String(text || '').replace(/\\s+/g, ' ').trim();
  }

  // What each route did, kept so that a failure can say why instead of only that. Three rounds
  // of "it did not work" with nothing on screen to say which part did not work is what this is
  // for: YouTube changes both the endpoint and the markup, and the next time one of them moves
  // this is the difference between a report and a guess.
  var notes = [];
  function note(line) { notes.push(line); }

  // The caption track as JSON. The richest of the three: real millisecond timings, and
  // per-segment offsets inside a line that word-level highlighting could later be built on.
  function fromJson3(body) {
    var track = JSON.parse(body);
    var cues = [];
    (track.events || []).forEach(function (ev) {
      if (!ev.segs) return;
      var said = tidy(ev.segs.map(function (seg) { return seg.utf8 || ''; }).join(''));
      if (!said) return;
      var start = (ev.tStartMs || 0) / 1000;
      cues.push({ start: start, end: start + (ev.dDurationMs || 0) / 1000, text: said });
    });
    return cues;
  }

  // The same track in its older XML form. Asked for when json3 comes back empty, because the
  // two are not always refused together.
  function fromXml(body) {
    var doc = new DOMParser().parseFromString(body, 'text/xml');
    var nodes = doc.getElementsByTagName('text');
    var cues = [];
    for (var i = 0; i < nodes.length; i++) {
      var said = tidy(decode(nodes[i].textContent || ''));
      if (!said) continue;
      var start = parseFloat(nodes[i].getAttribute('start') || '0');
      var dur = parseFloat(nodes[i].getAttribute('dur') || '0');
      if (!isFinite(start)) continue;
      cues.push({ start: start, end: start + (isFinite(dur) ? dur : 0), text: said });
    }
    return cues;
  }

  // The transcript panel, read off the page. Last because it is the coarsest — the panel prints
  // times to the second — and because it needs the reader to have opened it. It is also the one
  // that cannot be turned off: it is the same text a person can see and select by hand.
  // Everything matching a selector, shadow roots included.
  //
  // YouTube is thousands of custom elements and some of them keep their contents in a shadow
  // root, where an ordinary querySelectorAll cannot see them. This is not cheap — it is a walk
  // of the whole page — but it happens once, on a click, and the alternative is a reader being
  // told that their open transcript is not open.
  function deep(root, sel, out) {
    out = out || [];
    try { Array.prototype.push.apply(out, root.querySelectorAll(sel)); } catch (e) {}
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) if (all[i].shadowRoot) deep(all[i].shadowRoot, sel, out);
    return out;
  }

  var STAMP = /^(?:\\d+:)?\\d{1,2}:\\d{2}$/;

  function toSeconds(text) {
    var parts = text.split(':').map(Number);
    if (parts.some(function (n) { return !isFinite(n); })) return null;
    return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  }

  // The transcript panel, read off the page — by shape rather than by name.
  //
  // Naming the elements is what broke: ytd-transcript-segment-renderer and its two classes
  // are YouTube's internal markup, they get renamed without warning, and a bookmarklet pinned
  // to them stops working on a Tuesday with the panel plainly open on screen. What does not
  // change is the shape of the thing — a short run of text that is only a timestamp, with the
  // line that was said beside it — so that is what this looks for.
  //
  // Scoped to a container whose name mentions the transcript wherever one can be found, because
  // the player's own clock is also an element whose text is a timestamp, and unscoped this
  // would come back with a subtitle line reading "/ 12:34".
  function fromPanel(root) {
    // Scoped to one panel when the caller found one, and that is not a refinement — it is a
    // correctness fix. YouTube now ships two transcript panels and leaves both in the document:
    // the old searchable one and the newer PAmodern view. Searching for anything whose name says
    // "transcript" therefore finds both, and if they are showing different languages — which is
    // exactly what happens, since the new one follows the interface language and the old one
    // follows its own selector — their lines are harvested together and sorted into one
    // interleaved bilingual mess. One panel or none.
    var holders = root ? [root] : deep(D, '[target-id*="transcript" i], [class*="transcript" i], [id*="transcript" i]');
    var scopes = holders.length ? holders : [D.body];
    note('panel: reading ' + (root ? 'the searchable panel' : holders.length + ' container(s)'));

    var seen = {}, found = [];
    for (var s = 0; s < scopes.length; s++) {
      var leaves = deep(scopes[s], 'div, span, p, yt-formatted-string, button');
      for (var i = 0; i < leaves.length; i++) {
        var el = leaves[i];
        if (el.children && el.children.length) continue;
        var stamp = tidy(el.textContent);
        if (!STAMP.test(stamp)) continue;
        var at = toSeconds(stamp);
        if (at === null) continue;

        // The line is in the nearest ancestor holding more than the stamp itself. Four levels is
        // generous for one row and short enough not to swallow the whole panel.
        var row = el.parentElement, said = '';
        for (var up = 0; up < 4 && row; up++) {
          var whole = tidy(row.textContent);
          if (whole.length > stamp.length) {
            said = tidy(whole.split(stamp).join(' '));
            break;
          }
          row = row.parentElement;
        }
        if (!said) continue;

        // One row can be reached twice — a stamp inside a button inside a div — and the panel is
        // re-rendered as it scrolls, so the same line turns up more than once.
        var key = at + ' ' + said;
        if (seen[key]) continue;
        seen[key] = 1;
        found.push({ start: at, text: said });
      }
    }

    found.sort(function (a, b) { return a.start - b.start; });

    // A handful of scattered timestamps is furniture — a chapter list, the player clock, a
    // comment quoting a time. A transcript is a long monotonic run of them, so anything shorter
    // than this is treated as not having found one.
    note('panel: ' + found.length + ' timed line(s)');
    if (found.length < 3) return [];

    // Each line runs until the next begins: the panel is a transcript rather than a subtitle
    // track and has no gaps in it to preserve.
    return found.map(function (cue, i) {
      return { start: cue.start, end: found[i + 1] ? found[i + 1].start : cue.start + 4, text: cue.text };
    });
  }

  // Polls until something is there, or gives up. The panel is rendered by their app after the
  // click, and there is no event of ours to wait on.
  function waitFor(look, within) {
    return new Promise(function (resolve) {
      var until = Date.now() + within;
      (function again() {
        var found = look();
        if (found) return resolve(found);
        if (Date.now() > until) return resolve(null);
        setTimeout(again, 150);
      })();
    });
  }

  // Brings back the *old* transcript panel.
  //
  // This is the one piece of this file that is a workaround for a decision rather than for a
  // limitation. YouTube replaced the searchable transcript panel with a newer one that has no
  // language selector and follows the interface language instead — so on a Russian video watched
  // by somebody whose YouTube is in English, the panel shows English, and the gear icon's
  // subtitle setting does not change it. There is nothing in that panel to steer.
  //
  // The old panel was not removed, only stopped being shown. It is still built, still carries
  // its language menu, and still responds to being told to expand. So it is told to.
  //
  // Two steps, because it may not have been constructed yet: the button under the description
  // makes it exist, and the attribute makes it visible.
  function oldPanel() {
    var found = D.querySelector('[target-id="engagement-panel-searchable-transcript"]');
    if (!found) {
      var opener = D.querySelector(
        'ytd-button-renderer.style-scope.ytd-video-description-transcript-section-renderer button, ' +
          'ytd-video-description-transcript-section-renderer button',
      );
      if (opener) opener.click();
      else note('panel: no transcript button under the description');
    }

    return waitFor(function () {
      var panel = D.querySelector('[target-id="engagement-panel-searchable-transcript"]');
      if (!panel) return null;
      panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
      // Only once it has rows in it. The attribute is set the instant the element exists, and
      // reading it then gives an empty panel and a confident zero.
      return panel.querySelector('ytd-transcript-segment-renderer') ? panel : null;
    }, 6000).then(function (panel) {
      note('panel: searchable panel ' + (panel ? 'opened' : 'not available'));
      return panel;
    });
  }

  // Empty string for anything that did not come back as a body worth reading, so that the
  // caller has one thing to test rather than four.
  function body(url) {
    var which = url.indexOf('fmt=json3') > -1 ? 'json3' : 'xml';
    return fetch(url, { credentials: 'include' })
      .then(function (r) {
        if (!r.ok) { note(which + ': HTTP ' + r.status); return ''; }
        return r.text().then(function (text) {
          note(which + ': HTTP ' + r.status + ', ' + text.length + ' chars');
          return text;
        });
      })
      .catch(function (e) { note(which + ': ' + (e && e.message ? e.message : 'failed')); return ''; });
  }

  // A caption track's address, with any translation stripped off it.
  //
  // The tlang parameter is what turns a request for a track into a request for a machine translation of
  // that track. Nothing here should ever ask for one — the whole point of picking a track is to
  // get the language that is actually spoken — and removing it is cheap insurance against an
  // address that arrived with one already on it.
  function original(url) {
    return url.replace(/[?&]tlang=[^&]*/g, function (hit) { return hit.charAt(0) === '?' ? '?' : ''; });
  }

  // The caption tracks as the *player* would ask for them, rather than as the page was built
  // with.
  //
  // This is the route worth having, and the reason is that the addresses on a page can be stale
  // or incomplete while the ones the player fetches for itself are neither. YouTube's own client
  // asks youtubei for them on every play; asking the same endpoint, from their own origin, with
  // the reader's own cookies and the page's own client context, is as close to being the player
  // as this can get. When the addresses off the page come back empty — which is now most of the
  // time — these are what tend to work.
  //
  // Null rather than a throw when the page does not expose its config, because that is a shape
  // change on their side and the routes below still have a chance.
  function freshTracks() {
    var cfg = (W.ytcfg && (W.ytcfg.data_ || (W.ytcfg.get && W.ytcfg.get()))) || null;
    var key = cfg && cfg.INNERTUBE_API_KEY;
    var context = cfg && cfg.INNERTUBE_CONTEXT;
    if (!key || !context) { note('youtubei: no client config on the page'); return Promise.resolve(null); }

    return fetch('/youtubei/v1/player?key=' + encodeURIComponent(key), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: context, videoId: id }),
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var caps = data && data.captions && data.captions.playerCaptionsTracklistRenderer;
        var tracks = (caps && caps.captionTracks) || null;
        note('youtubei: ' + (tracks ? tracks.length + ' track(s)' : 'no tracks'));
        return tracks;
      })
      .catch(function (e) { note('youtubei: ' + (e && e.message ? e.message : 'failed')); return null; });
  }

  // Every way of asking for one track, in descending order of how good the answer is. json3
  // carries per-segment offsets; the rest are the same lines with coarser structure. They are
  // not refused together — a format that is turned off for one request is often served for
  // another — so all of them are worth a try before falling back to reading the page.
  function fromTrack(track) {
    var url = original(track.baseUrl);
    var ways = [
      { at: url + '&fmt=json3', read: fromJson3, starts: '{' },
      { at: url, read: fromXml, starts: '<' },
      { at: url + '&fmt=srv3', read: fromXml, starts: '<' },
      { at: url + '&fmt=srv1', read: fromXml, starts: '<' },
    ];

    return ways.reduce(function (chain, way) {
      return chain.then(function (cues) {
        if (cues && cues.length) return cues;
        return body(way.at).then(function (text) {
          if (text.trim().charAt(0) !== way.starts) return null;
          try { return way.read(text); } catch (e) { return null; }
        });
      });
    }, Promise.resolve(null));
  }

  // Three routes to the same lines, in descending order of how good the timings are.
  //
  // The first two are the caption track itself, and both now answer a great many requests with
  // 200 and an empty body — YouTube tightened this endpoint and it is what stopped most
  // transcript tools working. So neither is trusted to succeed, and the panel on the page is
  // there to catch it when they do not.
  // The track off the page, then the same track asked for again through youtubei, then the
  // panel. Language is the reason for that order and not just quality: a caption track *is* the
  // language it says it is, whereas the panel shows whatever YouTube decided to show — and since
  // they took the panel's language selector away there is no longer any way to steer it. So the
  // panel is genuinely last, and what comes from it is labelled.
  function collect(pick, index) {
    return fromTrack(pick)
      .then(function (cues) {
        if (cues && cues.length) return { cues: cues, from: 'track' };
        return freshTracks().then(function (fresh) {
          // The same position in the list, because it is the same list from the same video —
          // matched by language code first in case the order ever differs.
          var again = null;
          if (fresh && fresh.length) {
            for (var i = 0; i < fresh.length; i++) {
              if (fresh[i].languageCode === pick.languageCode && !!fresh[i].kind === !!pick.kind) { again = fresh[i]; break; }
            }
            if (!again) again = fresh[index] || fresh[0];
          }
          if (!again) return null;
          return fromTrack(again).then(function (more) {
            return more && more.length ? { cues: more, from: 'track' } : null;
          });
        });
      })
      .then(function (got) {
        if (got) return got;
        // The old panel first, because it is the only one whose language can be chosen at all.
        return oldPanel().then(function (panel) {
          var cues = fromPanel(panel);
          return { cues: cues, from: panel ? 'searchable' : 'panel' };
        });
      });
  }

  playerResponse().then(function (data) {
    var caps = data.captions && data.captions.playerCaptionsTracklistRenderer;
    var tracks = (caps && caps.captionTracks) || [];

    var title = (data.videoDetails && data.videoDetails.title) || id;

    // No track list at all still leaves the panel, which is a different source and may well be
    // there. Only give up once both have come to nothing.
    if (!tracks.length) {
      note('no caption tracks on the player response');
      return oldPanel().then(function (panel) {
        var seen = fromPanel(panel);
        if (!seen.length) return stuck();
        return finish(seen, title, panel ? 'searchable' : 'panel');
      });
    }

    var pick = tracks[0];
    var chosen = 0;
    if (tracks.length > 1) {
      var menu = tracks.map(function (t, n) {
        var name = (t.name && (t.name.simpleText || (t.name.runs && t.name.runs[0].text))) || t.languageCode;
        return (n + 1) + ') ' + name + ' [' + t.languageCode + ']' + (t.kind === 'asr' ? ' auto' : '');
      }).join('\\n');
      var said = prompt('Which subtitle track?\\n\\n' + menu, '1');
      if (said === null) return;
      chosen = (parseInt(said, 10) || 1) - 1;
      pick = tracks[chosen] || tracks[0];
      if (!tracks[chosen]) chosen = 0;
    }

    return collect(pick, chosen).then(function (got) {
      if (!got.cues.length) return stuck();
      finish(got.cues, title, got.from);
    });
  }).catch(function (e) {
    alert('Could not read the subtitles: ' + (e && e.message ? e.message : e));
  });

  // Nothing worked. The panel rather than an alert, because the notes are the useful part and
  // an alert cannot be copied out of.
  function stuck() {
    panel(
      'What each route did:\\n\\n' + notes.join('\\n'),
      'No lines found. Open "Show transcript" under the video and click again — or select that panel, copy it, and paste that instead.'
    );
  }

  function finish(cues, title, from) {
    var out = JSON.stringify({ v: id, title: title, cues: cues, from: from });
    var note =
      cues.length +
      ' lines. Copied — paste it into the app.' +
      (from === 'searchable'
        ? ' These came off the searchable transcript panel, which has just been re-opened for you \u2014 it has a language menu at its foot. If the words below are the wrong language, set it there and click this again.'
        : from === 'panel'
          ? ' \u26a0 These came off the newer transcript panel, which follows your YouTube interface language and cannot be changed. If the words below are not the language being spoken, they are a machine translation \u2014 do not import them.'
          : '');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(out).then(
        function () { panel(out, note); },
        function () { panel(out, cues.length + ' lines. Copy it below.'); }
      );
    } else {
      panel(out, cues.length + ' lines. Copy it below.');
    }
  }

})();`;

  // Encoded whole, newlines and all. `encodeURIComponent` turns each one into %0A, so there is
  // no raw newline left in the URL to upset anything — and the code must *not* be collapsed to
  // one line first, however tempting that looks. It has `//` comments in it, and a line comment
  // with the newline taken off the end of it swallows everything after it. That produced a
  // bookmark that parsed as far as the first comment and then did nothing at all.
  return `javascript:${encodeURIComponent(code)}`;
}

/**
 * What a paste turned out to be. `v` is null when the paste did not carry a video id — which a
 * transcript copied off the page never does, so the URL box supplies it.
 */
export interface Pasted {
  v: string | null;
  title: string | null;
  cues: Cue[];
}

/**
 * Reads whatever was pasted, in either of the two forms it can arrive in.
 *
 * There are two because the bookmarklet does not work everywhere. It runs as an inline script on
 * YouTube's page, and YouTube sends a Content-Security-Policy with a nonce in it — which, per
 * CSP3, cancels the `'unsafe-inline'` sitting beside it. Chrome exempts bookmarklets from page
 * policy and it runs fine; Firefox does not reliably, and it is refused with nothing to show for
 * it. A feature that works depending on which browser somebody opened is not a feature.
 *
 * So the second form is YouTube's own transcript panel, selected and copied by hand. No script
 * runs on their page at all, which makes it both immune to any policy they set and the most
 * ordinary thing a person can do with text they are looking at. What it costs is resolution: the
 * panel prints times to the second, where the caption track underneath is milliseconds. For
 * lighting a line as it is spoken, a second is close enough to read as being in time.
 *
 * Forgiving about the wrapper and strict about the contents, either way round. Somebody will
 * paste with a stray newline or a quote around it and refusing that helps nobody; a cue with a
 * string where a number should be is different, because it would be stored and then quietly fail
 * to line up with the video months later.
 */
export function readPasted(pasted: string): Pasted | string {
  const text = pasted.trim();
  if (!text) return 'Paste the subtitles first.';
  return text.startsWith('{') ? readJson(text) : readTranscript(text);
}

/** The bookmarklet's output: everything already in the right shape, so this only checks it. */
function readJson(text: string): Pasted | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'That starts like the bookmarklet\'s output but is not complete JSON. Paste the whole thing.';
  }

  if (!parsed || typeof parsed !== 'object') return 'That JSON is not a video.';
  const held = parsed as Record<string, unknown>;

  const v = typeof held.v === 'string' && /^[A-Za-z0-9_-]{11}$/u.test(held.v) ? held.v : null;
  if (!v) return 'There is no YouTube video id in that.';
  if (!Array.isArray(held.cues) || held.cues.length === 0) return 'There are no subtitle lines in that.';

  const cues: Cue[] = [];
  for (const raw of held.cues) {
    if (!raw || typeof raw !== 'object') return 'One of those lines is not a line.';
    const cue = raw as Record<string, unknown>;
    const start = typeof cue.start === 'number' ? cue.start : NaN;
    const end = typeof cue.end === 'number' ? cue.end : NaN;
    const said = typeof cue.text === 'string' ? cue.text.trim() : '';
    if (!Number.isFinite(start) || !Number.isFinite(end) || !said) {
      return 'One of those lines has no time or no text.';
    }
    cues.push({ start, end: Math.max(start, end), text: said });
  }

  const title = typeof held.title === 'string' ? held.title.trim() : '';
  return { v, title: title ? title.slice(0, 300) : null, cues };
}

/** `h:mm:ss`, `mm:ss` or `m:ss` — every shape the transcript panel prints a time in. */
const STAMP = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/u;

/** The same, with the line's text after it, which is how some browsers copy the panel. */
const STAMP_AND_TEXT = /^(?:(\d+):)?(\d{1,2}):(\d{2})[\s\t]+(.*\S)$/u;

function seconds(hours: string | undefined, minutes: string, secs: string): number {
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(secs);
}

/**
 * YouTube's transcript panel, as it lands on the clipboard.
 *
 * Two layouts, because it depends on the browser and on whether the reader dragged across the
 * whole panel or used its own copy button: a time on its own line with the text under it, or a
 * time and its text on one line. Both are handled in one pass rather than sniffed for first —
 * a transcript with a couple of lines in each form is exactly what a partial selection gives.
 *
 * Text is joined with a space when several lines follow one time, which is what a long caption
 * wrapped by the panel looks like. Nothing is dropped: a line with no time before it belongs to
 * the time above it, and a time with no text after it is discarded because there is nothing to
 * read at it.
 */
function readTranscript(text: string): Pasted | string {
  const cues: { start: number; text: string }[] = [];

  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line) continue;

    const together = STAMP_AND_TEXT.exec(line);
    if (together) {
      cues.push({ start: seconds(together[1], together[2]!, together[3]!), text: together[4]! });
      continue;
    }

    const alone = STAMP.exec(line);
    if (alone) {
      cues.push({ start: seconds(alone[1], alone[2]!, alone[3]!), text: '' });
      continue;
    }

    // Text with no time of its own: the continuation of the line above.
    const last = cues[cues.length - 1];
    if (!last) return 'That transcript starts with text rather than a time. Copy from the top.';
    last.text = last.text ? `${last.text} ${line}` : line;
  }

  const said = cues.filter(cue => cue.text);
  if (said.length === 0) {
    return 'No timed lines in that. Open the transcript on YouTube, select it all, and copy.';
  }

  // Times must not go backwards, or the player would light lines out of order. Out-of-order
  // input means a selection copied in pieces and reassembled wrongly, which is worth refusing
  // rather than storing: it cannot be told from a video that genuinely jumps about.
  for (let at = 1; at < said.length; at += 1) {
    if (said[at]!.start < said[at - 1]!.start) {
      return 'Those times run backwards partway through. Copy the transcript in one go.';
    }
  }

  return {
    v: null,
    title: null,
    // Each line runs until the next begins. The panel's entries are contiguous — it is a
    // transcript rather than a subtitle track, and it has no gaps in it to preserve. The last
    // gets a few seconds, there being nothing after it to run to.
    cues: said.map((cue, at) => ({
      start: cue.start,
      end: said[at + 1]?.start ?? cue.start + 4,
      text: cue.text,
    })),
  };
}

/**
 * What each language's text is written in, and what to call it when it is not.
 *
 * Script rather than language, because that is what can actually be checked from the text
 * alone. Telling Russian from Ukrainian needs a model; telling either from English needs one
 * regular expression, and English is what actually turns up here.
 */
const SCRIPTS: Record<Lang, { of: RegExp; name: string }> = {
  ka: { of: /\p{Script=Georgian}/u, name: 'Georgian' },
  ru: { of: /\p{Script=Cyrillic}/u, name: 'Russian' },
};

/** Any letter at all, so punctuation and digits do not count against the ratio. */
const LETTER = /\p{L}/u;

/**
 * Refuses subtitles that are not in the language they are being filed under.
 *
 * This exists because of one specific and very confusing YouTube behaviour. A video's caption
 * *track* and its transcript *panel* are two different things with two different language
 * settings, and the panel offers machine translations of the track into about a hundred
 * languages — defaulting, more often than not, to the viewer's own interface language rather
 * than the language being spoken. So a reader who opens the transcript on a Russian video and
 * copies it can quite easily be copying an English translation of it, with nothing on screen
 * saying so.
 *
 * Caught here rather than after import because the damage is expensive to undo: the text would
 * be tokenised, linked against a lexicon it has nothing to do with, and land in the library as a
 * video whose subtitles are the wrong language, which reads as the feature being broken.
 *
 * Half is a deliberately loose bar. Subtitles are full of names, numbers, "[Music]", channel
 * handles and the occasional English loanword written in Latin, and a strict threshold would
 * start refusing real tracks. Half separates "this is the language with some foreign words in
 * it" from "this is a different language", which is the only distinction being made.
 */
export function wrongScript(lang: Lang, cues: Cue[]): string | null {
  const want = SCRIPTS[lang];
  if (!want) return null;

  let mine = 0;
  let letters = 0;
  for (const cue of cues) {
    for (const character of cue.text) {
      if (!LETTER.test(character)) continue;
      letters += 1;
      if (want.of.test(character)) mine += 1;
    }
  }

  if (letters === 0) return 'There are no words in those subtitles at all.';
  if (mine / letters >= 0.5) return null;

  return (
    `Those subtitles are not in ${want.name} — only ${Math.round((mine / letters) * 100)}% of the ` +
    'letters are. YouTube\'s transcript panel often shows an automatic translation into your own ' +
    'language rather than what is being spoken. Open its language dropdown, pick the original, ' +
    'and copy it again.'
  );
}

/** The video id in anything somebody is likely to paste into a box asking for a YouTube URL. */
export function videoId(input: string): string {
  const text = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/u.test(text)) return text;
  try {
    const url = new URL(text);
    const query = url.searchParams.get('v');
    if (query && /^[A-Za-z0-9_-]{11}$/u.test(query)) return query;
    // youtu.be/<id>, /shorts/<id>, /embed/<id>, /live/<id> — the id is the last real segment.
    const parts = url.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] ?? '';
    if (/^[A-Za-z0-9_-]{11}$/u.test(last)) return last;
  } catch {
    // Not a URL. Falls through to "no id", which is what the caller shows a message about.
  }
  return '';
}
