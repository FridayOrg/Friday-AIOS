"""Text-to-speech for Friday, via ElevenLabs. Isolated here so the API key never
leaves the backend and so a different TTS provider (edge-tts, Piper, Gemini TTS)
could be swapped in without touching main.py or the frontend."""

import re
from collections.abc import AsyncIterator

import httpx

from .config import ELEVENLABS_API_KEY, ELEVENLABS_MODEL, ELEVENLABS_VOICE_ID

_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
# Streaming variant — audio bytes start coming back before the whole clip is
# synthesized, which matters when the frontend speaks a reply sentence-by-sentence.
_TTS_STREAM_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"

# Friday's answers are markdown (bold, bullets, headings, links). Spoken aloud the
# punctuation turns into noise ("asterisk asterisk"), so flatten it to plain prose
# first. This only affects the audio — the on-screen text keeps its formatting.
_MD_PATTERNS: list[tuple[str, str]] = [
    (r"```.*?```", " "),          # fenced code blocks
    (r"`([^`]*)`", r"\1"),         # inline code
    (r"!?\[([^\]]*)\]\([^)]*\)", r"\1"),  # links / images -> their text
    (r"^\s{0,3}#{1,6}\s*", ""),    # heading markers
    (r"(\*\*|__|\*|_)", ""),        # bold / italic markers
    (r"^\s*[-*+]\s+", ""),          # bullet markers
    (r"^\s*\d+\.\s+", ""),          # numbered-list markers
    (r"\|", " "),                   # table pipes
    (r"\n{2,}", ". "),              # paragraph breaks -> sentence pause
    (r"\s+", " "),                  # collapse whitespace
]


def strip_markdown(text: str) -> str:
    out = text
    for pattern, repl in _MD_PATTERNS:
        out = re.sub(pattern, repl, out, flags=re.MULTILINE | re.DOTALL)
    return out.strip()


def _payload(text: str) -> dict:
    return {
        "text": strip_markdown(text),
        "model_id": ELEVENLABS_MODEL,
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
    }


def _require_key() -> None:
    if not ELEVENLABS_API_KEY:
        raise RuntimeError(
            "ELEVENLABS_API_KEY is not set — add it to .env to enable spoken replies."
        )


async def synthesize(text: str) -> bytes:
    """Whole-clip MP3 bytes for `text`. Raises RuntimeError if no key is configured,
    httpx.HTTPStatusError on an API error (quota, bad voice id, etc.)."""
    _require_key()
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            _TTS_URL.format(voice_id=ELEVENLABS_VOICE_ID),
            headers={"xi-api-key": ELEVENLABS_API_KEY, "accept": "audio/mpeg"},
            json=_payload(text),
        )
        resp.raise_for_status()
        return resp.content


async def synthesize_stream(text: str) -> AsyncIterator[bytes]:
    """Yield MP3 chunks as ElevenLabs produces them. The first chunk arrives well
    before the full clip is done, so playback can start sooner. Auth/quota errors
    surface on the first iteration (before any audio), so the caller can still turn
    them into a proper HTTP status."""
    _require_key()
    async with httpx.AsyncClient(timeout=30.0) as client:
        async with client.stream(
            "POST",
            _TTS_STREAM_URL.format(voice_id=ELEVENLABS_VOICE_ID),
            headers={"xi-api-key": ELEVENLABS_API_KEY, "accept": "audio/mpeg"},
            params={"optimize_streaming_latency": "2", "output_format": "mp3_44100_128"},
            json=_payload(text),
        ) as resp:
            if resp.status_code >= 400:
                body = (await resp.aread()).decode("utf-8", "replace")
                raise httpx.HTTPStatusError(body, request=resp.request, response=resp)
            async for chunk in resp.aiter_bytes():
                if chunk:
                    yield chunk
