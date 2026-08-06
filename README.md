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

| Variable                                      | Where from                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                          | `openssl rand -base64 32`                                                                                                                                                                                                                                                                                                                                                                                              |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | [Discord developer portal](https://discord.com/developers/applications) → your app → OAuth2. Add `http://localhost:4000/api/auth/callback/discord` as a redirect URL, exactly.                                                                                                                                                                                                                                         |
| `MAILGUN_API_KEY` / `MAILGUN_DOMAIN`          | [Mailgun](https://app.mailgun.com) → Sending → Domain settings → API keys, and the sending domain itself. **Optional in development** — leave both blank and mail is printed to the server's terminal, sign-in links included, so email sign-in works locally with no account anywhere. Required when `NODE_ENV=production`. A domain in Mailgun's EU region also needs `MAILGUN_API_BASE=https://api.eu.mailgun.net`. |

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
those files remain the right place to correct a _bulk_ import:

| File                          | Holds                                                                       |
| ----------------------------- | --------------------------------------------------------------------------- |
| `scripts/wordsBase.json`      | the scraped A1–A2 dictionary; replace wholesale from a re-scrape            |
| `scripts/posOverrides.json`   | part of speech for the entries the scrape left untagged                     |
| `scripts/lexicon.json`        | lemmas, senses and paradigm links written by hand                           |
| `scripts/lexiconForms.json`   | inflected forms the story builder has resolved, grown by `--learn`          |
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

After that, an admin can promote anyone else from **Admin → Admins**.

Every edit bumps `content_version` in the same transaction that made it. That is the cache key
the server's in-memory snapshot and every browser already use, so nothing new had to be
invented: the snapshot rebuilds on the next request, the editing browser re-fetches at once,
and everyone else picks it up on their next visit.

### Stories link themselves

Both are fixed **in the reader**, on the word, with the sentence in front of you: open a story
as an admin and turn on **Edit links**. Every word becomes a button, including the ones nothing
matched — those are the ones that need you. Clicking one offers three answers, which are three
different claims rather than three ways of saying one thing:

- **A dictionary word** — this occurrence means that entry, in that sense. The resolver's own
  shortlist of rival entries is offered as one-tap chips.
- **A name** — a proper noun, glossed here and deliberately kept _out_ of the dictionary,
  because ნიფ-ნიფი is a pig in this story and nothing at all in the next one.
- **Not a word** — left as plain text on purpose, which is a different thing from the resolver
  having failed to find something.

Each can apply to the one occurrence or to every occurrence of that spelling in the story —
the `at` and `forms` blocks of the old overrides file. And any of them can be ticked **"still
a guess"**, the same flag the matcher sets on its own uncertain links, so a doubt you have
lands in the same list instead of needing a wrong link left in place to record it.

There is no overrides table. A decision _is_ a token: `story_tokens.via` already distinguished
the hand-made rows (`name`, `override`) from the resolver's own reasoning (`form index`,
`headword`, `paradigm`, `-dat -pl`), and **Relink from the lexicon** re-derives everything
except those. So adding a missing word today and relinking picks it up everywhere without
disturbing a single decision anybody made. A pin is matched back by position _and_ spelling;
edit the prose and the words shift, so a pin whose spelling no longer agrees is dropped rather
than silently re-applied to whatever now stands in that place.

### The tagger

Everything above matches a **spelling**, and a spelling cannot tell two entries apart. და is
the conjunction "and" nearly everywhere and the noun "sister" occasionally, and for a long
time the winner was whichever of the two sat earlier in the words table — which is sister, so
every "and" in every story linked to the wrong word and said "a guess" underneath it.

`apps/analyser/` is a small Python service that answers the one question a spelling cannot:
what part of speech is this word, _here_. It runs [Stanza](https://stanfordnlp.github.io/stanza/)
with the Georgian `glc` models — the UD_Georgian-GLC treebank, the only one that exists for
Georgian — and returns a UPOS tag and a lemma per token. The resolver uses it three ways, all
of them conservative:

- **To choose between entries that spell the same.** და tagged `CCONJ` picks the conjunction
  over the noun, and the link stops being a guess. This is the whole of the ambiguity in the
  lexicon as it stands — და is the only spelling two non-verb entries both claim.
- **To reach lemmas the peeler cannot**, as a last step. The peeler is kept away from verb
  headwords on purpose, so a conjugated form missing from the paradigm tables had nowhere to
  go. Georgian UD lemmatises verbs to the 3sg present, which is exactly how `words.json`
  files them, so `შეგიძლიათ` → `შეუძლია` is a plain lookup with nothing in between.
- **To doubt a paradigm hit**, but only when a non-verb entry spells the same and the tag
  prefers it. `გვიან` is the adverb "late" far more often than the 3pl present of "to sweep",
  and step 3 had no way to say so. Both halves are required: the tagger alone mistags Georgian
  verbs often enough here that acting on the tag by itself produced five false flags in one
  638-token story.

It is **optional at every call site**. With `ANALYSER_URL` unset, the container down, or the
request slow, `analyse()` returns null and linking behaves exactly as it did before any of
this existed. Nothing depends on it, and it is never called with a database transaction open.

The pipeline is **pretokenised**: the server sends the tokens it already cut and gets back
exactly that many tags. Letting Stanza tokenise would be better linguistics — its MWT layer
splits `სახლში` into `სახლ` + `ში` and `ობიექტია` into `ობიექტი` + `ა`, the copula the peeler
cannot reach — but a token's position is its identity in three other places, and changing the
count would move every pin in the database. That is a migration, not a flag.

Two things worth knowing before trusting it. The treebank is 56,000 tokens of modern
encyclopaedic prose, so on 1910 children's stories it is working well out of domain; and
because `tokenise` keeps only Mkhedruli runs, the tagger never sees the punctuation it would
need to find sentence boundaries. Both show. On _the chatterbox radish_ it lifts coverage from
55.2% to 56.9% and drops flagged links from 141 to 121, and of the ten links it adds on its
own roughly seven are right — `მაშ` ("so, then") coming out as the pronoun `იგი` is the shape
of the other three. They are all flagged as guesses, which is where they belong.

And it does not really _understand_ და. There are 1,537 occurrences of it in the treebank and
every one is tagged `CCONJ`, so the model has never seen the noun: in `ჩემი და სახლში მოვიდა`
("my sister came home") it still says "and". It has replaced a wrong answer everywhere with a
right answer nearly everywhere, which is worth having, but the sentence that needs "sister"
still needs a person.

## The snapshot

The whole dictionary goes to the browser in one response, and everything reads it
synchronously afterwards — `wordData().words`, not a loading state in every component.

## The lexicon and the stories

`words` is the one word list, and a story holds no meanings of its own. Every word
occurrence in a story records a word id and a _sense number_, so the same spelling can mean
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

**A word never met has no record at all**, rather than a level of 0. That absence is a state
in its own right — it is what a story paints as new and what the checkbox at the end of one
acts on — and keeping it out of the scale means it can never be confused with level 1, "I
have seen this and it keeps slipping away".

**Level 6 is only ever set by hand**: the Known button on a card, the level picker over a
word in a story, the checkbox at the end of one. Answering well takes a card to 5 and no
further, because "I got this right three times" and "stop showing me this" are different
claims and only the second should retire a word for good.

Each word carries a level _per direction_, since recognising მგელი and producing it from
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

`updatedAt` is deliberately _not_ `last`, which is when the card was last answered. Undoing a
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

**Your own address comes back to you in full; nobody else's is sent at all.** The account
menu shows the address you are signed in as, which is the whole job of that line, and
`session.me` is the only place this server puts an address in a response.

The one screen listing other people is the admin user list, and it shows **usernames only** —
no address, not masked, not partially, not to admins. `listUsers` does not select the column,
which is the point: a field that never enters the response cannot be leaked by a screen that
forgets to hide it, read out of the network tab, or logged downstream. Names are not unique
here (only addresses are, and those are not on offer), so each row carries a join date to
separate two people who chose the same one, and your own row is marked "you".

### Deleting an account

The account menu has it, under a rule and in red — the only irreversible thing in the app.
Asking sends a link rather than deleting anything, the same standard as signing in, because a
misclick or an unlocked laptop should not be enough on its own. The link has to be opened in
a browser still signed in to the account: the endpoint reads the session to know whose
deletion it is confirming.

What it removes is the account and its review records. **What this browser knows is kept**,
and the dialog says so — your progress lives in IndexedDB first and was there before you
signed up, so deleting the account drops the replica that outlives the laptop and leaves you
studying, signed out, with everything you knew. A checkbox erases the local copy too for
anyone who meant _that_. Coming back after the link redirects, the app says the account is
gone rather than just showing Sign in again, which is otherwise indistinguishable from having
been signed out.

The last admin cannot delete themselves, for the same reason they cannot revoke themselves:
an installation with no admins is repairable only from a shell on the host. Only the _last_
one — being an admin is a reason to hand the keys over first, not to be stuck with an account
you want gone.

Mailgun sends the sign-in link, the welcome mail, the change-email confirmation and the
delete-account confirmation, over its HTTP API — no SDK, since one authenticated POST is the
whole of what this app needs. Without credentials the transport prints the message to the
terminal instead, so `npm run dev` and email sign-in both work before anyone has a Mailgun
account. Everything but the sign-in link is sent best-effort and logs its failures; the
sign-in link throws, because there the mail _is_ the sign-in and "check your inbox" would
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

All three images are built for `linux/amd64` and `linux/arm64`, because the host is an Ampere
instance.

```sh
docker buildx create --name lemmata-multi --driver docker-container --bootstrap   # once
docker run --privileged --rm tonistiigi/binfmt --install arm64                    # once per boot
REGISTRY=youruser/yourrepo   # the same value the stack's REGISTRY variable is set to
TAG=$(git rev-parse --short HEAD)
docker buildx build --builder lemmata-multi --platform linux/amd64,linux/arm64 \
  -f apps/server/Dockerfile -t $REGISTRY:server-$TAG --push .
docker buildx build --builder lemmata-multi --platform linux/amd64,linux/arm64 \
  -f apps/web/Dockerfile    -t $REGISTRY:web-$TAG    --push .
docker buildx build --builder lemmata-multi --platform linux/amd64,linux/arm64 \
  -f apps/analyser/Dockerfile -t $REGISTRY:analyser-$TAG --push .
```

The web build is quick because its build stage is pinned to `$BUILDPLATFORM` — `dist` is the
same bytes on any CPU. The server's cannot be: `tsx` pulls in esbuild, which ships a binary
per architecture, so its `npm ci` really does run emulated.

The analyser is the slow one and the big one: 1.8 GB, most of it PyTorch and 205 MB of
models baked in so a container start never depends on someone else's CDN. Nothing in it is
compiled or emulated, though — PyTorch publishes CPU `aarch64` wheels, and the Dockerfile
pins `--index-url https://download.pytorch.org/whl/cpu` to get them. That pin is load-bearing:
since torch 2.11 the default PyPI `aarch64` wheel bundles CUDA and is 427 MB against the CPU
build's 144 MB, for a host that has no GPU. It idles at 580 MB resident and tags a 975-token
story in under half a second.

## Commands

| Command                              | Does                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `npm run dev`                        | both apps                                                                    |
| `npm run build`                      | typecheck and build both                                                     |
| `npm run typecheck` / `npm run lint` | across all workspaces                                                        |
| `npm run db:up` / `db:down`          | Postgres in Docker                                                           |
| `npm run analyser:up`                | the Georgian tagger in Docker; then set `ANALYSER_URL`                       |
| `npm run db:generate`                | a migration from a schema change                                             |
| `npm run db:migrate`                 | apply pending migrations                                                     |
| `npm run db:seed`                    | load `data/` into Postgres; refuses to clobber admin edits without `--force` |
| `npm run db:export`                  | write Postgres back out to `data/`                                           |
| `npm run admin -- grant <email>`     | make somebody an admin (also `revoke`, `list`)                               |
| `npm run db:verify`                  | prove the database still matches `data/`                                     |
| `npm run db:verify-sync`             | prove the study merge rule holds                                             |
| `npm run db:studio`                  | Drizzle Studio                                                               |
| `npm run build:data`                 | rebuild `data/` from `scripts/` sources                                      |
