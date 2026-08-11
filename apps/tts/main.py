# The voice the story reader plays, and the word timings that let it follow along.
#
# Prose in, one Opus file and a list of word spans out. Like the analyser it knows nothing
# about the database, the lexicon or what a story is; it is handed a sentence and answers
# with a sound and the times inside it. Everything that decides *which* sentence, or what to
# do with the answer, stays in TypeScript.
#
# The timings are the part worth explaining. Piper is a VITS model, so it predicts a duration
# for every phoneme before it generates any audio, and since 1.6.0 it will hand those back
# (`include_alignments`). That matters more than it sounds: the alternative is forced
# alignment — running a second, much larger acoustic model over the audio afterwards to guess
# where the words fell — which would mean another container, another ~1 GB of weights, and a
# CC-BY-NC licence on the only multilingual aligner that covers Georgian. Here the numbers
# come from the model that generated the audio, so they are not an estimate at all: they sum
# to the sample count of the file, exactly, and cost nothing to obtain.
#
# espeak emits a bare space phoneme at each word boundary, which is what `_spans` groups on.
#
# One request is one sentence, deliberately. The caller caches per sentence — see the TTS
# cache on the server — so a paragraph edited in the admin re-synthesises only the sentence
# that changed, and "play this line again" is a file that already exists rather than a seek
# into a longer one.

import base64
import io
import math
import os
import re
import subprocess
import wave

from fastapi import FastAPI, HTTPException
from piper import PiperVoice, SynthesisConfig
from piper.phonemize_espeak import EspeakPhonemizer
from pydantic import BaseModel, Field

VOICE_DIR = os.environ.get("PIPER_VOICE_DIR", "/voices")

# Bitrate for the Opus the caller stores. Speech at 24 kbps mono is transparent enough that
# the difference from the 22.05 kHz WAV Piper produces is inaudible on a phone speaker, and
# it is the difference between the server's capped cache holding about twelve hours of audio
# and holding about a hundred and eighty. See TTS_CACHE_MAX_BYTES.
OPUS_BITRATE = os.environ.get("TTS_OPUS_BITRATE", "24")

# One voice per language, chosen rather than configurable, because a voice is not an
# implementation detail a reader should hear change between two sentences of the same story.
#
# Georgian has exactly one voice in rhasspy/piper-voices — natia, medium, community
# contributed — so there is no choice to make there yet. If it proves too weak on the
# ejectives (კ პ ტ წ ჭ ყ, which is where a thin training set shows), the replacement is a
# different backend behind this same endpoint, not a different voice here.
#
# Russian has four; irina is the clearest of them at medium. The others are denis, dmitri and
# ruslan, and adding one is a line here plus a line in the Dockerfile.
VOICES = {
    "ka": "ka_GE-natia-medium",
    "ru": "ru_RU-irina-medium",
}

# Byte-for-byte the word patterns in apps/server/src/story/tokenise.ts and
# apps/web/src/utils/story.ts. Duplicated rather than shared for the reason given there, and
# with the same consequence if they ever drift: this service would group the phonemes into a
# different number of words than the caller has tokens, every span after the first difference
# would name the wrong word, and the reader would highlight confidently along the wrong line.
# `speak` compares the two counts and returns no timings at all rather than wrong ones.
#
# Hyphens stay inside a word in both languages — ნიფ-ნიფი is one word, and so are кто-то and
# из-за — and Russian admits the combining acute after a letter, because the lexicon stores
# its stresses that way and де́лать must not come apart.
WORD_RE = {
    "ka": re.compile(r"[ა-ჿ]+(?:-[ა-ჿ]+)*"),
    "ru": re.compile(r"(?:[а-яёА-ЯЁ]́?)+(?:-(?:[а-яёА-ЯЁ]́?)+)*"),
}

# What espeak emits that is not part of a word: the utterance markers it opens and closes
# with, and the boundary between two words. Punctuation is not listed because it does not
# need to be — a full stop is not alphabetic, so `_in_word` rejects it on its own — but it is
# worth saying that it carries real duration, being the pause at the end of the line, and
# belongs to neither of the words either side of it.
BOUNDARY = {"^", "$", " "}

# The stress marks espeak writes before a syllable, all of which belong to the word they mark.
# That is a decision and so it is written down rather than left to `isalpha`: ˈ sits inside
# za- in за́мок, and closing a span there would end the word before its first vowel.
#
# ˈ and ˌ are Unicode modifier letters that `isalpha` would have admitted anyway. The plain
# ASCII quote is the one that matters: espeak writes it for primary stress too, and being
# punctuation to Python it was closing spans in the middle of words — ɭʲu"dʲˈej, "людей", came
# back as two spoken words and knocked every later word of the sentence out of step. It reads
# as a quotation mark about once in thirteen; when it is one, it falls between two words and
# `_align` absorbs the pair.
STRESS = {"ˈ", "ˌ", '"'}

app = FastAPI(title="Speech", docs_url=None, redoc_url=None)

_voices: dict[str, PiperVoice] = {}

# espeak's own text-to-phoneme step, reachable without synthesising anything. Used to ask how
# long a written word ought to be in phonemes, which is what lets `_align` work out where one
# spoken span covers more than one of them. Built once: it holds a handle on espeak-ng.
_phonemizer = EspeakPhonemizer()


def voice(lang: str) -> PiperVoice:
    """One language's voice, loaded once.

    A medium voice is 63 MB of weights and a second or so to read off disk. Loading them
    lazily rather than at import means a container only ever asked for Georgian never pays
    for the Russian one, and holding them module-level means the reader pays that cost once
    per container rather than once per sentence.

    `include_alignments` has to be set here as well as per call — it decides which ONNX graph
    is built at load, and a voice loaded without it cannot produce timings later.
    """
    if lang not in _voices:
        if lang not in VOICES:
            raise HTTPException(status_code=400, detail=f"No voice for language {lang!r}.")
        _voices[lang] = PiperVoice.load(
            os.path.join(VOICE_DIR, f"{VOICES[lang]}.onnx"),
            include_alignments=True,
        )
    return _voices[lang]


class SpeakRequest(BaseModel):
    """One sentence, in the language it is written in.

    `text` is sent exactly as it should be read, which for Russian means *with* the stresses
    written in: espeak honours the combining acute, so за́мок and замо́к are synthesised
    differently, and the lexicon already stores the accented form for 29,406 of its 29,679
    entries. The caller strips them again before matching the timings back onto its own
    tokens — see `words` in the reply.

    `speed` is a multiplier on ordinary pace, so 0.8 is slower and is what a learner reading
    a story is likely to want. It becomes Piper's length_scale, which runs the other way.
    """

    lang: str
    text: str = Field(min_length=1)
    speed: float = Field(default=1.0, gt=0.25, le=2.0)


class WordSpan(BaseModel):
    """When one word is said, and which word it is.

    The spelling rides along so the caller can check it rather than trust the position, the
    way `at` does in apps/web/src/utils/story.ts. Two tokenisers agreeing on a count is not
    the same as them agreeing on where the words are, and a highlight on the wrong word with
    nothing to say it is wrong is worse than no highlight.
    """

    word: str
    start: float
    end: float


class SpeakResponse(BaseModel):
    """The audio, and where the words are inside it.

    `audio` is base64 because this is one internal hop on the compose network and the caller
    writes the bytes straight to its cache; a third more traffic between two containers is
    not worth a multipart body to avoid. What lands on disk, and what a browser eventually
    fetches, is the raw Opus.

    `words` is empty when the phonemes could not be grouped into the same number of words the
    caller's tokeniser finds. The audio is still good; only the highlighting has to fall back
    to the sentence.
    """

    audio: str
    format: str = "opus"
    duration: float
    words: list[WordSpan] = Field(default_factory=list)


def _in_word(phoneme: str) -> bool:
    """Whether a phoneme is part of the word being said, rather than the gap around it.

    Anything alphabetic counts, which covers both scripts' phonemes without listing them, and
    covers a multi-character phoneme too. Everything else — the boundary markers, punctuation,
    whitespace — is the space between words.
    """
    if not phoneme or phoneme in BOUNDARY or not phoneme.strip():
        return False
    return phoneme in STRESS or any(character.isalpha() for character in phoneme)


def _spans(alignments, sample_rate: int) -> list[tuple[float, float, int]]:
    """Group the phoneme durations into one span per *spoken* word, with its phoneme count.

    Walks the phonemes in order accumulating a clock, opening a span at the first phoneme of
    a word and closing it at the boundary after the last. The stress marks espeak emits (ˈ ˌ)
    are phonemes with real durations and belong to the word they mark, so they extend the
    span like any other; only the boundary markers and punctuation close one.

    The clock is a running sum of `num_samples`, not a re-derivation from anything, which is
    why it agrees with the file to the sample.

    A *spoken* word is not always a written one, which is what the count is carried for. See
    `_align`.
    """
    out: list[tuple[float, float, int]] = []
    clock = 0.0
    start = 0.0
    end = 0.0
    count = 0

    for alignment in alignments:
        seconds = alignment.num_samples / sample_rate
        if not _in_word(alignment.phoneme):
            if count:
                out.append((start, end, count))
                count = 0
        else:
            if not count:
                start = clock
            end = clock + seconds
            count += 1
        clock += seconds

    if count:
        out.append((start, end, count))
    return out


def _expected(espeak_voice: str, words: list[str]) -> list[int]:
    """Roughly how many phonemes each written word is worth.

    Only ever compared against other counts, never used as phonemes, so the well-known
    inaccuracy of phonemising a word out of its sentence does not matter here. "с" alone
    comes back as the letter's name, `ɛs`, where in a sentence it is the single consonant
    `s` — a difference of one, against neighbours that differ by five or ten.
    """
    out: list[int] = []
    for word in words:
        try:
            phonemes = [p for sentence in _phonemizer.phonemize(espeak_voice, word) for p in sentence]
            count = sum(1 for p in phonemes if _in_word(p) and p not in STRESS)
        except Exception:
            # Any failure here costs accuracy, not correctness: a wrong count can only make
            # the alignment below give up, and giving up is already a state it handles.
            count = len(word)
        out.append(max(1, count))
    return out


# How many written words one stretch of sound may cover, or how many stretches one word may
# be spoken across. Four is far past anything either language does; it exists to keep the
# search below small and to stop it inventing absurd groupings.
MAX_RUN = 4

# What it costs to put more than one word or more than one span into a single block, in the
# same units as the phoneme counts being compared. Without it the cheapest alignment of any
# sentence is the one that lumps every word into one block, whose totals match perfectly and
# which says nothing about where anything is. At three, a merge has to buy more than three
# phonemes of agreement to be worth making.
RUN_PENALTY = 3


def _align(groups: list[tuple[float, float, int]], expected: list[int]) -> list[tuple[float, float]] | None:
    """One span per *written* word, reconciled against however many the voice actually spoke.

    espeak does not speak a word per word, and it errs in both directions. It runs words
    together: Russian binds its clitics to their host, so "Что же" is one phonetic word,
    `штожы`, with no boundary in it — and a great many Russian sentences contain `же`, `ли`,
    `бы` or `то`. And it breaks words apart: "МакГаффину" is spoken as two at the interior
    capital. The first version of this compared the two counts for equality and returned
    nothing when they differed, which is how the reader came to stop following a line in the
    middle of a paragraph.

    Reconciling them is a whole-sentence question and not a local one. Walking the two lists
    and deciding greedily at each step is what a first fix did, and it drifts: one wrong
    take early puts every later word against the wrong sound, and sentences whose counts
    already agreed came out misaligned. So the best split of the whole sentence is searched
    for instead — the cheapest way to cut both lists into matching blocks, where a block's
    cost is how far its phoneme totals disagree, plus `RUN_PENALTY` for each word or span in
    it beyond the first.

    The search is a small dynamic program over (words consumed, spans consumed), bounded by
    MAX_RUN on both sides, so it is some thousands of integer comparisons on a sentence — far
    cheaper than the synthesis it follows, and it happens once per line ever.

    None where no alignment exists at all, and then the caller falls back to marking the
    whole line.
    """
    words = len(expected)
    spans = len(groups)
    if not words or not spans:
        return None

    # Prefix sums, so a block's phoneme total is one subtraction.
    written_to = [0] * (words + 1)
    for index, count in enumerate(expected):
        written_to[index + 1] = written_to[index] + count

    spoken_to = [0] * (spans + 1)
    for index, group in enumerate(groups):
        spoken_to[index + 1] = spoken_to[index] + group[2]

    best: list[list[float]] = [[math.inf] * (spans + 1) for _ in range(words + 1)]
    came_from: list[list[tuple[int, int] | None]] = [[None] * (spans + 1) for _ in range(words + 1)]
    best[0][0] = 0.0

    for word in range(words + 1):
        for span in range(spans + 1):
            here = best[word][span]
            if here == math.inf:
                continue
            for take_words in range(1, min(MAX_RUN, words - word) + 1):
                block_written = written_to[word + take_words] - written_to[word]
                for take_spans in range(1, min(MAX_RUN, spans - span) + 1):
                    block_spoken = spoken_to[span + take_spans] - spoken_to[span]
                    cost = (
                        here
                        + abs(block_written - block_spoken)
                        + RUN_PENALTY * (take_words - 1 + take_spans - 1)
                    )
                    if cost < best[word + take_words][span + take_spans]:
                        best[word + take_words][span + take_spans] = cost
                        came_from[word + take_words][span + take_spans] = (word, span)

    if best[words][spans] == math.inf:
        return None

    blocks: list[tuple[int, int, int, int]] = []
    word, span = words, spans
    while (word, span) != (0, 0):
        previous = came_from[word][span]
        if previous is None:
            return None
        blocks.append((previous[0], word, previous[1], span))
        word, span = previous
    blocks.reverse()

    out: list[tuple[float, float]] = []
    for first_word, last_word, first_span, last_span in blocks:
        start = groups[first_span][0]
        end = groups[last_span - 1][1]
        block_written = written_to[last_word] - written_to[first_word]

        # Shares are cumulative fractions of the *whole* stretch of sound, not of what is left
        # of it: dividing the remainder each time would give every word after the first a
        # slice of an ever-shorter span, and three words sharing one would come out 4/2.4/3.6
        # where their lengths asked for 4/4/2.
        width = end - start
        consumed = 0
        at = start
        for position in range(first_word, last_word):
            consumed += expected[position]
            # The last word of a block ends exactly where its sound does, so that rounding
            # cannot leave a silent sliver between one word and the next.
            finish = end if position == last_word - 1 else start + width * (consumed / block_written)
            out.append((at, finish))
            at = finish

    return out


def _to_opus(wav: bytes) -> bytes:
    """WAV in, Opus out, through opusenc.

    opus-tools rather than ffmpeg: this is the one thing the image needs a codec for, and
    opusenc plus libopus is a couple of megabytes against ffmpeg's couple of hundred.
    """
    result = subprocess.run(
        ["opusenc", "--quiet", "--bitrate", OPUS_BITRATE, "--downmix-mono", "-", "-"],
        input=wav,
        capture_output=True,
    )
    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"opusenc failed: {result.stderr.decode('utf-8', 'replace')[:400]}",
        )
    return result.stdout


@app.get("/voices")
def voices() -> dict[str, object]:
    """Which languages this image has a voice for, and which voice.

    Asked by the server before it offers audio at all, for the same reason the analyser is
    asked /languages: it touches no model and answers in microseconds, and a server newer
    than its speech container should find that out by being told rather than by synthesising
    a sentence of silence.
    """
    return {"voices": {lang: name for lang, name in sorted(VOICES.items())}}


@app.get("/health")
def health() -> dict[str, object]:
    """Whether the voices are loaded, not merely whether the process is up.

    Every voice loads here, so a container that answers this can answer /speak in any
    language without a cold start. Compose waits on it before starting the server.
    """
    for lang in VOICES:
        voice(lang)
    return {"status": "ok", "languages": sorted(VOICES)}


@app.post("/speak", response_model=SpeakResponse)
def speak(request: SpeakRequest) -> SpeakResponse:
    """One sentence synthesised, with a span per word.

    Piper's phoneme stream and our regex are two independent opinions about where the words
    in this sentence are, and they do not always agree — espeak binds Russian clitics to
    their host, so "Что же" is one spoken word and two written ones. `_align` reconciles
    them; see the note there.

    Where even that cannot, the reply keeps the audio and returns no timings, because a
    reader hearing one word while another lights up would be told something false about the
    language they are learning. An empty `words` is the reader's cue to mark the whole line
    instead, which is honest about knowing where the sentence is but not where in it.
    """
    if request.lang not in VOICES:
        raise HTTPException(status_code=400, detail=f"No voice for language {request.lang!r}.")

    speaker = voice(request.lang)
    # length_scale stretches every phoneme, so it is the reciprocal of a speed: 0.8x speed is
    # 1.25 length. Piper takes None to mean "whatever the voice was trained at".
    config = SynthesisConfig(length_scale=1.0 / request.speed if request.speed != 1.0 else None)

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        alignments = speaker.synthesize_wav(
            request.text, handle, syn_config=config, include_alignments=True
        )

    wav = buffer.getvalue()
    with wave.open(io.BytesIO(wav)) as handle:
        duration = handle.getnframes() / handle.getframerate()

    words = WORD_RE[request.lang].findall(request.text)
    groups = _spans(alignments or [], speaker.config.sample_rate)
    aligned = _align(groups, _expected(speaker.config.espeak_voice, words)) if words else []
    timings = (
        [WordSpan(word=word, start=start, end=end) for word, (start, end) in zip(words, aligned)]
        if aligned is not None
        else []
    )

    return SpeakResponse(
        audio=base64.b64encode(_to_opus(wav)).decode("ascii"),
        duration=duration,
        words=timings,
    )
