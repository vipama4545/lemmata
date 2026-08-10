# The tagger the story resolver asks about ambiguous spellings.
#
# The resolver matches spellings against the lexicon and has no way to tell two entries
# that spell the same apart: და is "and" 1,537 times out of 1,537 in the UD treebank and
# "sister" the rest of the time, стали is the past of "become" far more often than it is
# the genitive of "steel", and nothing in the spelling says which. This answers that one
# question — what is this word, here — and the resolver decides what to do with it.
#
# It is deliberately the whole of the Python in this project. No database, no lexicon, no
# knowledge of stories; prose in, a tag per token out. Everything that knows what a token
# *means* stays in TypeScript.
#
# Prose in, not tokens. Georgian writes its postpositions onto the noun — სახლში is "house"
# plus "in", ობიექტია is "object" plus the copula — and only Stanza's own tokenizer can cut
# those apart, because the MWT layer that does it runs inside the tokenizer and cannot run
# on pretokenised input at all. Sending prose also gives the tagger the sentence boundaries
# and punctuation it was trained on, which the old token stream had thrown away.
#
# What it costs is the guarantee that came free with pretokenised input: that the reply has
# exactly as many entries as the caller has tokens. A token's position is its identity in
# three other places — data/<lang>/stories/*.json, story_tokens, storyOverrides.json — so the
# count may not move. So this module re-cuts the prose with the *same* regex tokenise.ts uses,
# aligns Stanza's words onto those tokens by character offset, and returns one tag per
# token. Stanza's splits survive as `parts`; the token count does not change. See the README.

import os
import re

import stanza
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from stanza.models.common.doc import Document

MODEL_DIR = os.environ.get("STANZA_RESOURCES_DIR", "/models")

# One entry per language the image was built with models for. The server asks /languages
# before it asks anything else, because sending Russian prose to a Georgian pipeline does
# not fail — it returns confident nonsense, which is worse than returning nothing.
#
# `processors` differs by language and that is not an oversight. mwt is the point of this
# service for Georgian; Russian has no multi-word tokens in UD_Russian-SynTagRus and naming
# a processor the models do not include is a hard error at pipeline construction. depparse
# stays out of both: it is the largest model in the set — 94 MB against pos's 20 MB — and
# answers a question about sentence structure that nothing here asks.
#
# Byte-for-byte the patterns in apps/server/src/story/tokenise.ts. The two must agree or the
# reply is the wrong length and the server discards it.
LANGUAGES = {
    # UD_Georgian-GLC, the only treebank Stanza has for Georgian, added in 1.10 when the
    # models were rebuilt on UD 2.15.
    "ka": {
        "package": "glc",
        "processors": "tokenize,mwt,pos,lemma",
        "word": re.compile(r"[ა-ჿ]+(?:-[ა-ჿ]+)*"),
    },
    # UD_Russian-SynTagRus: a million tokens, the largest Russian treebank there is. The
    # combining acute is admitted after a letter, because prose written for learners marks
    # its stresses and де́лать must stay one token; Stanza is indifferent to it either way.
    "ru": {
        "package": "syntagrus",
        "processors": "tokenize,pos,lemma",
        "word": re.compile(r"(?:[а-яёА-ЯЁ]\u0301?)+(?:-(?:[а-яёА-ЯЁ]\u0301?)+)*"),
    },
}

# Sub-words that are a grammatical attachment rather than the word itself. When Stanza
# splits a token, the resolver wants the noun in სახლ+ში, not the postposition.
ATTACHMENT = {"ADP", "AUX", "PART", "SCONJ", "CCONJ"}

app = FastAPI(title="Story analyser", docs_url=None, redoc_url=None)

_pipelines: dict[str, stanza.Pipeline] = {}


def pipeline(lang: str) -> stanza.Pipeline:
    """One language's pipeline, built once.

    Loading reads a couple of hundred megabytes off disk and takes several seconds. A
    relink is a button press and should not pay that every time, so these are module-level
    singletons rather than anything per request — and built on first use rather than at
    import, so a container that only ever serves Georgian never loads the Russian models.
    """
    if lang not in _pipelines:
        spec = LANGUAGES[lang]
        _pipelines[lang] = stanza.Pipeline(
            lang=lang,
            package=spec["package"],
            processors=spec["processors"],
            dir=MODEL_DIR,
            # The image already has the models. Never reach for the network at runtime:
            # a redeploy on a bad link should fail at build, not half-serve at 3am.
            download_method=None,
            logging_level="WARN",
        )
    return _pipelines[lang]


class AnalyseRequest(BaseModel):
    """One string of prose per paragraph, exactly as the reader shows it.

    Empty paragraphs are allowed and come back empty, so paragraph indexes survive the
    round trip untouched.

    `lang` defaults to Georgian for the one caller that predates there being a choice.
    """

    lang: str = "ka"
    paragraphs: list[str] = Field(default_factory=list)


class Part(BaseModel):
    """One piece of a token Stanza split — the noun and the postposition of სახლში."""

    upos: str
    lemma: str


class Tag(BaseModel):
    """What one token was tagged as.

    `upos` and `lemma` describe the token's *head*: for a split token that is the noun,
    not the postposition hanging off it. `parts` is present only where there was a split,
    and holds every piece in order, the head included.
    """

    upos: str
    lemma: str
    feats: str | None = None
    parts: list[Part] | None = None


class AnalyseResponse(BaseModel):
    paragraphs: list[list[Tag]]


@app.get("/languages")
def languages() -> dict[str, list[str]]:
    """Which languages this image has models for.

    Asked by the server before every relink, and the reason it can be: it touches no model
    and answers in microseconds. Without it a server newer than its analyser would send
    Russian to the Georgian pipeline and get a tag for every token, all of them wrong.
    """
    return {"languages": sorted(LANGUAGES)}


@app.get("/health")
def health() -> dict[str, object]:
    """Whether the models are loaded, not merely whether the process is up.

    Every pipeline builds here, so a container that answers this is one that can answer
    /analyse in any language without a cold start. Compose waits on it before starting the
    server, which is also what keeps the wait honest as languages are added.
    """
    for lang in LANGUAGES:
        pipeline(lang)
    return {"status": "ok", "languages": sorted(LANGUAGES)}


def _spans(document) -> list[tuple[int, int, list]]:
    """Every Stanza token as (start_char, end_char, words), in reading order.

    A token carries the offsets; its words carry the analyses, and after an MWT split there
    is more than one word behind the one span. Sentences are flattened away — the resolver
    works in paragraphs and does not care where Stanza put the full stops.
    """
    out: list[tuple[int, int, list]] = []
    for sentence in document.sentences:
        for token in sentence.tokens:
            out.append((token.start_char, token.end_char, list(token.words)))
    return out


def _tag_for(words: list) -> Tag:
    """Fold the words behind one of our tokens into a single tag.

    The head is the first word that is not a grammatical attachment, so სახლ+ში tags as the
    noun and keeps `ში` in `parts` for the resolver to use if it wants it. A token that
    Stanza did not split has one word and no parts.
    """
    head = next((w for w in words if (w.upos or "X") not in ATTACHMENT), words[0])
    parts = None
    if len(words) > 1:
        parts = [Part(upos=w.upos or "X", lemma=w.lemma or w.text) for w in words]
    return Tag(
        upos=head.upos or "X",
        lemma=head.lemma or head.text,
        feats=head.feats,
        parts=parts,
    )


@app.post("/analyse", response_model=AnalyseResponse)
def analyse(request: AnalyseRequest) -> AnalyseResponse:
    """A tag per token, one list per paragraph, aligned to tokenise.ts's tokens.

    Stanza tokenises and sentence-splits for itself here, so its tokens do not have to line
    up with ours — a hyphenated ნელ-ნელა may come back as three tokens, из-за as three, and
    სახლში as one token holding two words. Alignment is by character offset: every Stanza
    word whose token overlaps one of our tokens belongs to it, and each of our tokens yields
    exactly one tag.
    """
    if request.lang not in LANGUAGES:
        # A 400 rather than a silent fallback to Georgian. The server checks /languages
        # first and should never reach this; if it does, the honest answer is "no".
        raise HTTPException(
            status_code=400,
            detail=f"no models for {request.lang!r}; this image has {sorted(LANGUAGES)}",
        )

    word_scan = LANGUAGES[request.lang]["word"]
    prose = request.paragraphs
    out: list[list[Tag]] = [[] for _ in prose]

    # Held out rather than sent: a paragraph with none of the language in it produces no
    # sentence, which would shift every paragraph after it one place. The gaps are refilled
    # below.
    filled = [(index, text) for index, text in enumerate(prose) if word_scan.search(text or "")]
    if not filled:
        return AnalyseResponse(paragraphs=out)

    # bulk_process rather than calling the pipeline on a list: with its own tokenizer running
    # the pipeline takes one string or one Document, and a list is only accepted when
    # pretokenized is set. One Document per paragraph also keeps character offsets local to
    # the paragraph, which is what the alignment below indexes by.
    documents = pipeline(request.lang).bulk_process([Document([], text=text) for _, text in filled])
    if len(documents) != len(filled):
        raise ValueError(f"sent {len(filled)} paragraphs, got {len(documents)} back")

    for (index, text), document in zip(filled, documents):
        spans = _spans(document)
        tags: list[Tag] = []
        cursor = 0

        for match in word_scan.finditer(text):
            start, end = match.span()
            # Stanza's tokens are in reading order, so the search only ever moves forward.
            while cursor < len(spans) and spans[cursor][1] <= start:
                cursor += 1
            words = [w for s, e, ws in spans[cursor:] if s < end and e > start for w in ws]
            if words:
                tags.append(_tag_for(words))
            else:
                # Stanza dropped the span — vanishingly rare, but the count is the contract,
                # so stand in a tag that says nothing rather than lose a position.
                tags.append(Tag(upos="X", lemma=match.group()))

        out[index] = tags

    return AnalyseResponse(paragraphs=out)
