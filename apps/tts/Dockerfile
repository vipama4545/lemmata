# The voice the story reader plays.
#
# Built for linux/amd64 and linux/arm64 like the other images — the host is an Ampere
# instance. piper-tts publishes a manylinux_2_17_aarch64 wheel, so nothing here is emulated
# or compiled on either architecture; see the README's deploy section for the buildx line.
#
# Small, unlike the analyser: two voices at 63 MB each and onnxruntime on top, against that
# image's ~1.8 GB of Stanza models and torch. Nothing here is a reason to think twice about
# what the box can hold.
#
# The voices are baked in rather than fetched at boot, for the reason the analyser gives
# about its models: downloading on every container start trades a one-off build cost for a
# startup that can fail on someone else's outage. One RUN per voice, so adding a third
# re-downloads only itself.

FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIPER_VOICE_DIR=/voices

# opus-tools is the only codec in the image, and it is here rather than ffmpeg on purpose:
# opusenc plus libopus is a couple of megabytes where ffmpeg is a couple of hundred, and
# encoding one mono speech WAV is the whole of what this needs a codec for. curl is for the
# voice downloads below and is small enough to leave in.
RUN apt-get update \
 && apt-get install -y --no-install-recommends opus-tools curl \
 && rm -rf /var/lib/apt/lists/*

COPY apps/tts/requirements.txt ./
RUN pip install -r requirements.txt

# espeak-ng's data ships inside the piper-tts wheel, so there is no system espeak to install
# and no phoneme data to keep in step with it.
#
# Georgian: the only voice rhasspy/piper-voices has for the language.
RUN mkdir -p /voices \
 && curl -sSfL -o /voices/ka_GE-natia-medium.onnx \
      https://huggingface.co/rhasspy/piper-voices/resolve/main/ka/ka_GE/natia/medium/ka_GE-natia-medium.onnx \
 && curl -sSfL -o /voices/ka_GE-natia-medium.onnx.json \
      https://huggingface.co/rhasspy/piper-voices/resolve/main/ka/ka_GE/natia/medium/ka_GE-natia-medium.onnx.json

# Russian: irina, the clearest of the four medium voices. denis, dmitri and ruslan are the
# others, and each is another RUN like this one plus a line in VOICES.
RUN curl -sSfL -o /voices/ru_RU-irina-medium.onnx \
      https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx \
 && curl -sSfL -o /voices/ru_RU-irina-medium.onnx.json \
      https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx.json

COPY apps/tts/main.py ./

# Nothing here writes anything — the cache lives on the server, not in this container — so it
# runs as a user that cannot.
RUN useradd --system --no-create-home --uid 10002 speech \
 && chown -R speech:speech /voices
USER speech

EXPOSE 8001

# Two workers, where the analyser has one. The trade is different here: a voice is 63 MB
# rather than a gigabyte, so a second worker's private copy of both languages costs ~130 MB,
# and the load is burstier — opening an uncached chapter asks for every sentence in it at
# once, where a relink is one request. Past the first read of a page the cache answers and
# this container sees nothing at all.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]
