# Georgian dictionary

A Georgian A1–A2 dictionary, verb paradigm reference, story reader and spaced-repetition
deck. React and Vite in the browser, Fastify and Postgres behind it, oRPC between them.

```
apps/web        the React app
apps/server     Fastify, Better Auth, the oRPC router, migrations and the seed
packages/shared types, the oRPC contract, the Drizzle schema, the grammar constants
data/           the generated dictionary — the seed's input
scripts/        the authoring pipeline that writes data/ (local, not in git)
```

## Getting it running

```sh
npm install
cp .env.example .env          # then fill in the four blanks below
npm run db:up                 # Postgres in Docker, on port 5433
npm run db:migrate
npm run db:seed               # loads data/*.json into Postgres
npm run dev                   # server on :4000, web on :5173
```

Four things in `.env` need filling in:

| Variable | Where from |
| --- | --- |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | [Discord developer portal](https://discord.com/developers/applications) → your app → OAuth2. Add `http://localhost:4000/api/auth/callback/discord` as a redirect URL, exactly. |
| `MAILGUN_API_KEY` / `MAILGUN_DOMAIN` | [Mailgun](https://app.mailgun.com) → Sending → Domain settings → API keys, and the sending domain itself. **Optional in development** — leave both blank and mail is printed to the server's terminal, sign-in links included, so email sign-in works locally with no account anywhere. Required when `NODE_ENV=production`. A domain in Mailgun's EU region also needs `MAILGUN_API_BASE=https://api.eu.mailgun.net`. |

Postgres is on **5433**, not 5432, because 5432 is usually already taken. Change both
`docker-compose.yml` and `DATABASE_URL` if you want it back.

## Where the data lives, and how it gets there

**The database is the source of truth for content.** An admin can add and correct words,
paradigms and stories from the browser (see [Editing it](#editing-it) below), so the tables
are no longer just a copy of `data/*.json` — they can hold work that exists nowhere else.
Two commands keep that honest:

```sh
npm run db:export     # database -> data/*.json, so the files catch up
npm run db:seed       # data/*.json -> database, and it now refuses to clobber edits
```

`content_version.source` is `seed` after a seed and `admin` after any edit in the browser.
Finding `admin`, the seed stops and says so rather than replacing the edits with the older
files; `--force` overrides it. `db:export` is the way out that keeps both — it writes through
the same assembly the server serves from, skips any file whose content has not actually
changed, and never overwrites a story's `.txt`, so `git diff data/` shows the content that
moved rather than a reformat of everything.

The offline pipeline is still there and still works. The scripts under `scripts/` turn the
conjugation spreadsheet, the scrape and the hand-written lexicon into `data/*.json`, and
those files remain the right place to correct a *bulk* import:

| File | Holds |
| --- | --- |
| `scripts/wordsBase.json` | the scraped A1–A2 dictionary; replace wholesale from a re-scrape |
| `scripts/posOverrides.json` | part of speech for the entries the scrape left untagged |
| `scripts/lexicon.json` | lemmas, senses and paradigm links written by hand |
| `scripts/lexiconForms.json` | inflected forms the story builder has resolved, grown by `--learn` |
| `scripts/storyOverrides.json` | what is true of one story: its names, and the spellings or positions to pin |

`npm run build:data` runs the whole thing: build the lexicon, resolve the stories, learn the
forms they turned up, and fold those back in so the next story links itself. The one new
step is `npm run db:seed`, which loads the result into Postgres. A running server picks up
the new data on the next request — the seed writes a content version last, and the server's
cache is keyed on it.

Adding a story means dropping `<id>.txt` (and optionally `<id>.en.txt`, one paragraph per
Georgian paragraph) in `data/stories/`, then `build:data` and `db:seed`. Nothing in the app
needs editing any more — no module declaration, no list of stories. Or paste it into
**Admin → Stories → New story**, which does the same work against the live database.

## Editing it

An **admin** may add and change words, paradigms and stories from the app itself. It is one
column, `user.is_admin`, and nothing else grants it: no list of addresses in the environment,
and no route through Better Auth — the field is declared `input: false`, so no sign-up body,
profile update or OAuth profile can set it. A fresh database therefore has no admins at all.
Make the first one from a shell on the host:

```sh
npm run admin -- list
npm run admin -- grant nino@example.com     # they must have signed in once already
npm run admin -- revoke nino@example.com
```

After that, an admin can promote anyone else from **Admin → Admins**. Nobody can remove their
own access, and the last admin cannot be removed — an installation with none can only be
repaired from the host. In Portainer there is no `compose run`, so do it the way seeding is
done: **Containers → `lemmata-server-1` → Console → `/bin/sh`**, then
`node --import tsx apps/server/src/db/admin.ts grant nino@example.com`.

Hiding the `/admin` routes is a courtesy, not the enforcement. Every procedure under `admin`
checks the session itself and re-reads `is_admin` from the table rather than trusting the
session cookie, which is cached for thirty seconds — so revoking somebody takes effect on
their next request, not half a minute later.

Every edit bumps `content_version` in the same transaction that made it. That is the cache key
the server's in-memory snapshot and every browser already use, so nothing new had to be
invented: the snapshot rebuilds on the next request, the editing browser re-fetches at once,
and everyone else picks it up on their next visit.

### Stories link themselves

Paste the Georgian in and the server tokenises it and resolves every word against the lexicon,
using the same matcher `scripts/buildStoryData.cjs` has always used — the confirmed-forms
index, then an exact paradigm hit, then the nominal peeler. It reproduces that script's output
token for token; on *The Three Little Pigs* a cold paste links **95.2%** of 975 words with no
help at all, and what it cannot do is exactly the interesting part:

| Left over | What it is | Where it is fixed |
| --- | --- | --- |
| 47 unresolved | the proper nouns — ნიფ-ნიფი and its case forms | named in the story |
| 54 flagged | `და`, which is both "and" and "sister" | pinned in the story |

Both are fixed **in the reader**, on the word, with the sentence in front of you: open a story
as an admin and turn on **Edit links**. Every word becomes a button, including the ones nothing
matched — those are the ones that need you. Clicking one offers three answers, which are three
different claims rather than three ways of saying one thing:

- **A dictionary word** — this occurrence means that entry, in that sense. The resolver's own
  shortlist of rival entries is offered as one-tap chips.
- **A name** — a proper noun, glossed here and deliberately kept *out* of the dictionary,
  because ნიფ-ნიფი is a pig in this story and nothing at all in the next one.
- **Not a word** — left as plain text on purpose, which is a different thing from the resolver
  having failed to find something.

Each can apply to the one occurrence or to every occurrence of that spelling in the story —
the `at` and `forms` blocks of the old overrides file. And any of them can be ticked **"still
a guess"**, the same flag the matcher sets on its own uncertain links, so a doubt you have
lands in the same list instead of needing a wrong link left in place to record it.

There is no overrides table. A decision *is* a token: `story_tokens.via` already distinguished
the hand-made rows (`name`, `override`) from the resolver's own reasoning (`form index`,
`headword`, `paradigm`, `-dat -pl`), and **Relink from the lexicon** re-derives everything
except those. So adding a missing word today and relinking picks it up everywhere without
disturbing a single decision anybody made. A pin is matched back by position *and* spelling;
edit the prose and the words shift, so a pin whose spelling no longer agrees is dropped rather
than silently re-applied to whatever now stands in that place.

### Proving the move was lossless

```sh
npm run db:verify
```

Rebuilds the snapshot from Postgres using the same assembly the server serves from, and
compares it field by field against `data/*.json`. This is worth running after any change to
the schema or the assembly, because the failure mode otherwise is silent: an empty string
that becomes a missing key, an array that comes back in a different order. It has already
caught two — `preverbs: []` being dropped as empty when the segmenter writes it deliberately,
and the category order, which is largest-first rather than alphabetical.

## The snapshot

The whole dictionary goes to the browser in one response, and everything reads it
synchronously afterwards — `wordData().words`, not a loading state in every component. That
is what the app has always done; the only change is that it comes from a database now
instead of from the bundle.

It is affordable because of three things:

- **The server assembles it once** and holds it in memory. It is the same for every visitor
  and only changes when the seed runs.
- **The client sends the version it already has.** Unchanged, the answer is 55 bytes. That is
  every visit after the first.
- **It is compressed and cached.** 3.3 MB of JSON, 374 KB over the wire, kept in IndexedDB
  between visits.

The JS bundle went from 3.66 MB to 396 KB in the process.

Nothing may read the dictionary at module scope. `content/Boot.tsx` gates the app on the load
and `derived()` in `content/store.ts` defers any index built from it to first use — the two
together are why `items.ts`, `story.ts` and `grammar.ts` can still keep the indexes they
always did.

`persons`, `screeves` and `series` are **not** in the database. They are fixed facts about
Georgian, `PersonKey`/`ScreeveKey`/`SeriesId` in `types.ts` already pin them as compile-time
unions, and a table whose rows had to match a literal union would be a second copy of a
closed set that could silently disagree with the first. They live in
`packages/shared/src/grammar.ts`, and `db:verify` checks them against the spreadsheet so
"never changes" is an assertion rather than an assumption.

## The lexicon and the stories

`words` is the one word list, and a story holds no meanings of its own. Every word
occurrence in a story records a word id and a *sense number*, so the same spelling can mean
different things in different lines — აბა is "let's" where the pigs egg each other on and
"just try" where the wolf threatens them. Correcting a definition is done once, in the
lexicon, and every story that cites it follows.

An inflected form may also carry a meaning of its own, which the card shows above the
headword: `იყო` reads as "was", filed under `არის` "is". Nothing can derive that — the
paradigm knows the frame ("I -ed") but not that the past of "build" is "built" — so it is
written down. Case forms of a nominal get none: `მგელმა` means what `მგელი` means, and the
`erg` tag says the rest.

Stories are fetched one at a time rather than riding along in the snapshot: the one story
here is 120 KB of tokens, which is not worth carrying for the visits that never open it. The
index lists summaries, which do ride along.

## What you know

`apps/web/src/study/` is the one part of the app that is *yours* rather than generated.

| File | Holds |
| --- | --- |
| `mastery.ts` | the 1–6 scale and the scheduler — no storage, no React, no network |
| `db.ts` | the IndexedDB store, which resolves rather than throws when there is none |
| `items.ts` | the lexicon and the paradigms as one list of things to learn |
| `store.ts` | those records in memory, written through, read with `useProgress()` |
| `sync.ts` | the account replica, when there is an account |

Two things about the scale are worth knowing before changing anything:

**A word never met has no record at all**, rather than a level of 0. That absence is a state
in its own right — it is what a story paints as new and what the checkbox at the end of one
acts on — and keeping it out of the scale means it can never be confused with level 1, "I
have seen this and it keeps slipping away".

**Level 6 is only ever set by hand**: the Known button on a card, the level picker over a
word in a story, the checkbox at the end of one. Answering well takes a card to 5 and no
further, because "I got this right three times" and "stop showing me this" are different
claims and only the second should retire a word for good.

Each word carries a level *per direction*, since recognising მგელი and producing it from
"wolf" are different skills. Those are two cards off one word, as in Anki. The new-card
allowance is per calendar day and caps only never-seen cards; it is counted off the records
themselves rather than a tally, which is what `introduced` is for.

### Accounts, and the sync

**An account is optional.** Signed out, IndexedDB is the only copy there is and everything
works exactly as it did before there were accounts — you can study the whole dictionary and
never sign up. Signing in does not switch to a different store; it adds a second replica that
outlives the laptop, and the records already in the browser are merged into the new account.

The merge rule is the same at both ends and it is the whole design: **for one card, the copy
with the later `updatedAt` wins.** Everything awkward falls out of it.

- Signing in for the first time pushes every local record. Nothing can be clobbered, because
  a stale row loses — so "add what they already have" needs no special case.
- Answering on a phone and again on a laptop converges on the later answer.
- Forgetting a card sends a tombstone rather than nothing, because an absent row and a
  deliberately-removed one are otherwise indistinguishable to whoever syncs next.

`updatedAt` is deliberately *not* `last`, which is when the card was last answered. Undoing a
misclick restores an older answer, so `last` goes backwards — and a merge keyed on it would
call the undo stale and quietly bring the misclick back.

```sh
npm run db:verify-sync
```

drives the study procedures against a real database and checks all of the above, including
the stale-push and undo cases.

## Auth and mail

Two ways in: Discord, or a link mailed to an address. There is no password on either, and
that is the point of the second rather than an accident of it — the only thing an account
does is hold your review records, and a password would mean a reset flow, a hashing policy
and a credential to leak, all in aid of storing which Georgian words you know. Adding another
social provider is a block in `socialProviders` and a button in `Account.tsx`.

Signing up and signing in by email are the same request. An address with no account behind
it gets one when the link is followed, which is why there is one form and not two, and why
nothing in the response says which of the two just happened — an answer that differed would
turn the form into a way of asking the server whether a given person has an account. Links
are single-use, expire in fifteen minutes, and are stored hashed, so `verification` holds
nothing anyone can redeem.

There is no first name or last name anywhere. Discord's username (or the display name the
user chose) becomes `name`; an account that arrived by email takes the local part of the
address, minus any `+tag` and not split on dots. That is the only name stored.

Mailgun sends the sign-in link, the welcome mail, the change-email confirmation and the
delete-account confirmation, over its HTTP API — no SDK, since one authenticated POST is the
whole of what this app needs. Without credentials the transport prints the message to the
terminal instead, so `npm run dev` and email sign-in both work before anyone has a Mailgun
account. Everything but the sign-in link is sent best-effort and logs its failures; the
sign-in link throws, because there the mail *is* the sign-in and "check your inbox" would
otherwise be a lie.

## Deploying

In development Vite proxies `/rpc` and `/api` through to the server, so the browser only ever
sees one origin and the session cookie is an ordinary first-party `SameSite=Lax` one. **Serve
the built web app and the API from the same origin in production if you can** — put a reverse
proxy in front of both — and none of that has to change.

If they must be on different origins, set `WEB_ORIGIN` and `BETTER_AUTH_URL` accordingly.
`auth.ts` notices they differ and switches the cookie to `SameSite=None; Secure`, which
browsers only honour over HTTPS.

`docker-compose.prod.yml` is that reverse proxy already wired up, for a host that is already
running one of its own. An nginx container serves the built app and forwards `/rpc` and `/api`
to the server over the compose network, listening on `127.0.0.1:5050`; the server and Postgres
publish no ports at all. TLS and `lemmata.fyi` stay with the proxy you already have, and it
needs one upstream and no path rules:

```nginx
location / {
    proxy_pass http://127.0.0.1:5050;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Those headers are not optional. Fastify runs with `trustProxy` in production and takes the
client's address and protocol from them; `apps/web/nginx.conf` appends its own hop rather than
overwriting, so the address that arrives is the browser's. There is no `api.` subdomain on
purpose — one hostname is what keeps the session cookie first-party. Then, on the server:

```sh
cp .env.production.example .env    # fill it in; the comments say what each one wants
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml run --rm seed   # first deploy, and after build:data
```

`up` applies pending migrations in a container of its own and will not start the server if
one fails. Seeding is deliberately not part of it — it replaces every content table, which is
the right thing after `npm run build:data` and wasted work otherwise, and outright wrong once
anything has been edited through the admin screens. `run --rm verify` proves the database
still matches `data/`.

Both images are built for `linux/amd64` and `linux/arm64`, because the host is an Ampere
instance and an amd64-only image there fails as `exec format error`. Rebuild them with:

```sh
docker buildx create --name lemmata-multi --driver docker-container --bootstrap   # once
docker run --privileged --rm tonistiigi/binfmt --install arm64                    # once per boot
TAG=$(git rev-parse --short HEAD)
docker buildx build --builder lemmata-multi --platform linux/amd64,linux/arm64 \
  -f apps/server/Dockerfile -t youruser/yourrepo:server-$TAG --push .
docker buildx build --builder lemmata-multi --platform linux/amd64,linux/arm64 \
  -f apps/web/Dockerfile    -t youruser/yourrepo:web-$TAG    --push .
```

The web build is quick because its build stage is pinned to `$BUILDPLATFORM` — `dist` is the
same bytes on any CPU. The server's cannot be: `tsx` pulls in esbuild, which ships a binary
per architecture, so its `npm ci` really does run emulated.

In Portainer, `profiles` keeps `seed` and `verify` out of the stack, and there is no
equivalent of `compose run`. Seed from the server container instead — **Containers →
`lemmata-server-1` → Console → `/bin/sh`** — with `node --import tsx apps/server/src/db/seed.ts`.

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | both apps |
| `npm run build` | typecheck and build both |
| `npm run typecheck` / `npm run lint` | across all workspaces |
| `npm run db:up` / `db:down` | Postgres in Docker |
| `npm run db:generate` | a migration from a schema change |
| `npm run db:migrate` | apply pending migrations |
| `npm run db:seed` | load `data/` into Postgres; refuses to clobber admin edits without `--force` |
| `npm run db:export` | write Postgres back out to `data/` |
| `npm run admin -- grant <email>` | make somebody an admin (also `revoke`, `list`) |
| `npm run db:verify` | prove the database still matches `data/` |
| `npm run db:verify-sync` | prove the study merge rule holds |
| `npm run db:studio` | Drizzle Studio |
| `npm run build:data` | rebuild `data/` from `scripts/` sources |
