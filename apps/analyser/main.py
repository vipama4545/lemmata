# A Georgian tagger, behind one endpoint, for the story resolver to ask.
#
# The resolver matches spellings against the lexicon and has no way to tell two entries
# that spell the same apart: და is "and" 1,537 times out of 1,537 in the UD treebank and
# "sister" the rest of the time, and nothing in the spelling says which. This answers that
# one question — what part of speech is this word, here — and the resolver decides what to
# do with the answer.
#
# It is deliberately the whole of the Python in this project. No database, no lexicon, no
# knowledge of stories; paragraphs of tokens in, a tag per token out. Everything that knows
# what a token *means* stays in TypeScript.
#
# The pipeline is pretokenised: the server sends the tokens it already cut with
# tokenise.ts's regex and gets back exactly that many tags, in that order, so a position in
# the reply is the same position as in story_tokens. Letting Stanza tokenise instead would
# be the better linguistics — its MWT layer splits სახლში into სახლ + ში and ობიექტია into
# ობიექტი + ა, the copula the peeler cannot reach — but a token's position is its identity
# in three other places, and changing the count moves every pin in the database. That is a
# migration, not a flag. See the README.

import os

import stanza
from fastapi import FastAPI
from pydantic import BaseModel, Field

# tokenize is listed because pretokenised input still passes through it; mwt and depparse
# are not. mwt cannot run on pretokenised input at all, and depparse is the largest model
# in the set — 94 MB against pos's 20 MB — answering a question about sentence structure
# that nothing here asks.
PROCESSORS = "tokenize,pos,lemma"
MODEL_DIR = os.environ.get("STANZA_RESOURCES_DIR", "/models")

app = FastAPI(title="Georgian analyser", docs_url=None, redoc_url=None)

_pipeline: stanza.Pipeline | None = None


def pipeline() -> stanza.Pipeline:
    """The pipeline, built once.

    Loading reads ~200 MB off disk and takes several seconds. A relink is a button press
    and should not pay that every time, so this is a module-level singleton rather than
    anything per request.
    """
    global _pipeline
    if _pipeline is None:
        _pipeline = stanza.Pipeline(
            lang="ka",
            package="glc",
            processors=PROCESSORS,
            dir=MODEL_DIR,
            tokenize_pretokenized=True,
            # The image already has the models. Never reach for the network at runtime:
            # a redeploy on a bad link should fail at build, not half-serve at 3am.
            download_method=None,
            logging_level="WARN",
        )
    return _pipeline


class AnalyseRequest(BaseModel):
    """One list of tokens per paragraph, already cut by the caller.

    Empty paragraphs are allowed and come back empty, so paragraph indexes survive the
    round trip untouched.
    """

    paragraphs: list[list[str]] = Field(default_factory=list)


class Tag(BaseModel):
    """What one token was tagged as. `upos` is the only field the resolver acts on."""

    upos: str
    lemma: str
    feats: str | None = None


class AnalyseResponse(BaseModel):
    paragraphs: list[list[Tag]]


@app.get("/health")
def health() -> dict[str, str]:
    """Whether the models are loaded, not merely whether the process is up.

    The pipeline builds on first use, so a container that answers this is one that can
    answer /analyse without a cold start. Compose waits on it before starting the server.
    """
    pipeline()
    return {"status": "ok", "lang": "ka", "package": "glc", "processors": PROCESSORS}


@app.post("/analyse", response_model=AnalyseResponse)
def analyse(request: AnalyseRequest) -> AnalyseResponse:
    """A tag per token, in the order the tokens arrived.

    Every paragraph goes in one call as one pretokenised sentence. Stanza's own sentence
    splitter never runs here, because tokenise.ts keeps only Mkhedruli runs and drops the
    punctuation it would need — so a paragraph arrives as an undivided stream of words.
    The tagger is therefore working with less context than it was trained on; that is the
    price of keeping positions identical, and the reason the resolver treats a tag as a
    tiebreak and a warning rather than as an answer that overrules the lexicon.
    """
    # Held out rather than sent: an empty inner list makes Stanza return no sentence for it,
    # which would shift every paragraph after it one place. The gaps are refilled below.
    filled = [(index, tokens) for index, tokens in enumerate(request.paragraphs) if tokens]
    out: list[list[Tag]] = [[] for _ in request.paragraphs]

    if not filled:
        return AnalyseResponse(paragraphs=out)

    document = pipeline()([tokens for _, tokens in filled])
    sentences = document.sentences

    if len(sentences) != len(filled):
        raise ValueError(f"sent {len(filled)} paragraphs, got {len(sentences)} back")

    for (index, tokens), sentence in zip(filled, sentences):
        tags = [
            Tag(upos=word.upos or "X", lemma=word.lemma or word.text, feats=word.feats)
            for word in sentence.words
        ]
        # The contract is one tag per token sent. Pretokenised input should guarantee it,
        # but the resolver keys tags by position, so a length mismatch has to fail loudly
        # here rather than quietly misalign every meaning in the paragraph.
        if len(tags) != len(tokens):
            raise ValueError(f"paragraph {index}: sent {len(tokens)} tokens, tagged {len(tags)}")
        out[index] = tags

    return AnalyseResponse(paragraphs=out)
