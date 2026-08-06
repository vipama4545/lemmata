# The Georgian tagger the story resolver asks about ambiguous spellings.
#
# Built for linux/amd64 and linux/arm64 like the other two images — the host is an Ampere
# instance. PyTorch publishes CPU aarch64 wheels, so nothing here is emulated or compiled;
# see the README's deploy section for the buildx line.
#
# The models are baked in rather than fetched at boot. They are ~205 MB and they change
# only when the pinned Stanza version does, so downloading them on every container start
# would trade a one-off build cost for a startup that can fail on someone else's outage.

FROM python:3.12-slim

# Ordered so the expensive layers are the stable ones: torch changes when we bump it, the
# models when Stanza moves, and main.py whenever we like.
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    STANZA_RESOURCES_DIR=/models

# torch from PyTorch's CPU index, on its own line and before everything else. The +cpu
# build has no CUDA runtime in it, which on arm64 is the difference between a 144 MB wheel
# and a 427 MB one. Resolving it from the default index would quietly undo that.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.12.1+cpu

COPY apps/analyser/requirements.txt ./
RUN pip install -r requirements.txt

# Georgian is "glc" — the UD_Georgian-GLC treebank, the only one Stanza has for it, added
# in Stanza 1.10 when the models were rebuilt on UD 2.15. depparse is deliberately not
# fetched: it is the biggest model of the set and answers nothing this service is asked.
RUN python -c "import stanza; stanza.download(lang='ka', package='glc', processors='tokenize,pos,lemma', model_dir='/models')"

COPY apps/analyser/main.py ./

# Nothing here writes anything, so it runs as a user that cannot.
RUN useradd --system --no-create-home --uid 10001 analyser \
 && chown -R analyser:analyser /models
USER analyser

EXPOSE 8000

# One worker on purpose. The pipeline holds ~1 GB resident and every worker gets its own
# copy, while the actual load is one request when an admin presses "relink". Concurrency
# here would cost a gigabyte a time to serve a queue that is never longer than one.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
