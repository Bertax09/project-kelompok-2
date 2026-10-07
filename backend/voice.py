"""Pengenalan ucapan (Whisper) dan sintesis suara (VITS) Bahasa Indonesia.

Keduanya OPSIONAL. Jika pustakanya belum dipasang, endpoint suara mengembalikan 501 dan
frontend otomatis memakai Web Speech API milik browser sebagai cadangan.

Pasang (opsional):
    pip install faster-whisper                      # STT (Whisper)
    pip install transformers torch numpy            # TTS (VITS: facebook/mms-tts-ind)
"""
from __future__ import annotations

import importlib.util
import io
import os
import tempfile
import threading
import wave
from functools import lru_cache

_lock = threading.Lock()
_stt_model = None
_tts_bundle = None


class VoiceUnavailable(RuntimeError):
    pass


def stt_available() -> bool:
    return importlib.util.find_spec("faster_whisper") is not None


def tts_available() -> bool:
    return all(importlib.util.find_spec(m) is not None for m in ("transformers", "torch", "numpy"))


def _get_stt():
    global _stt_model
    if _stt_model is None:
        from faster_whisper import WhisperModel  # impor lambat: hanya saat dipakai

        device = os.environ.get("INGATKU_DEVICE", "cpu")
        compute = "float16" if device == "cuda" else "int8"
        _stt_model = WhisperModel(os.environ.get("INGATKU_WHISPER_MODEL", "small"),
                                  device=device, compute_type=compute)
    return _stt_model


def transcribe(audio: bytes, suffix: str = ".webm") -> str:
    if not stt_available():
        raise VoiceUnavailable("Pengenalan suara di server belum dipasang (faster-whisper).")
    with _lock:
        model = _get_stt()
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(audio)
            path = f.name
        try:
            segments, _info = model.transcribe(
                path,
                language="id",
                beam_size=5,
                vad_filter=True,
                initial_prompt="Ingatkan saya minum obat jam 8 pagi. Cek jadwal besok. Putar berita hari ini.",
            )
            return " ".join(seg.text.strip() for seg in segments).strip()
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass


def _get_tts():
    global _tts_bundle
    if _tts_bundle is None:
        from transformers import AutoTokenizer, VitsModel

        name = os.environ.get("INGATKU_TTS_MODEL", "facebook/mms-tts-ind")
        _tts_bundle = (AutoTokenizer.from_pretrained(name), VitsModel.from_pretrained(name))
    return _tts_bundle


@lru_cache(maxsize=64)
def _synthesize_cached(text: str) -> bytes:
    import numpy as np
    import torch

    tokenizer, model = _get_tts()
    inputs = tokenizer(text, return_tensors="pt")
    torch.manual_seed(555)  # hasil suara konsisten untuk teks yang sama
    with torch.no_grad():
        waveform = model(**inputs).waveform
    audio = waveform.squeeze().cpu().numpy()
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(model.config.sampling_rate))
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def synthesize(text: str) -> bytes:
    """Kembalikan audio WAV (mono, 16-bit)."""
    if not tts_available():
        raise VoiceUnavailable("Sintesis suara di server belum dipasang (transformers + torch).")
    text = " ".join(text.split())
    with _lock:
        return _synthesize_cached(text)
