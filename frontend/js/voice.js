// Suara: mendengar (STT) dan berbicara (TTS).
// Prioritas: Whisper/VITS di server bila tersedia, jika tidak memakai Web Speech API milik browser.
import { api } from './api.js';

export class VoiceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const NO_SPEECH = 'Suara Anda tidak terdengar. Coba lagi, bicara lebih dekat ke mikrofon.';

let capsPromise = null;

export function capabilities() {
  if (!capsPromise) {
    capsPromise = (async () => {
      let server = { stt: false, tts: false };
      try { server = await api.voiceStatus(); } catch { /* server tidak menjawab */ }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const secure = window.isSecureContext !== false;
      return {
        secure,
        serverStt: !!server.stt && secure && !!window.MediaRecorder && !!navigator.mediaDevices?.getUserMedia,
        serverTts: !!server.tts,
        browserStt: !!SR && secure,
        browserTts: 'speechSynthesis' in window,
      };
    })();
  }
  return capsPromise;
}

function pickMime() {
  const list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return list.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
}

function micError(e) {
  const name = e?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new VoiceError('denied', 'Izin mikrofon ditolak. Aktifkan izin mikrofon di pengaturan peramban, lalu coba lagi.');
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new VoiceError('no-mic', 'Mikrofon tidak ditemukan di perangkat ini.');
  }
  return new VoiceError('mic', 'Mikrofon tidak bisa digunakan. Coba lagi.');
}

function listenServer(onLevel) {
  let stream = null;
  let recorder = null;
  let ctx = null;
  let timer = null;
  let cancelled = false;
  let heard = false;
  let rejectFn = null;

  const cleanup = () => {
    clearInterval(timer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx && ctx.close) ctx.close().catch(() => {});
    stream = null;
    ctx = null;
  };
  const stopRecorder = () => {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  };

  const promise = new Promise((resolve, reject) => {
    rejectFn = reject;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (e) {
        reject(micError(e));
        return;
      }
      if (cancelled) {
        cleanup();
        reject(new VoiceError('cancelled', ''));
        return;
      }
      const mime = pickMime();
      try {
        recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      } catch {
        cleanup();
        reject(new VoiceError('record', 'Perekaman suara tidak didukung di peramban ini.'));
        return;
      }
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onerror = () => {
        cleanup();
        reject(new VoiceError('record', 'Perekaman gagal. Coba lagi.'));
      };
      recorder.onstop = async () => {
        cleanup();
        if (cancelled) return reject(new VoiceError('cancelled', ''));
        if (!heard) return reject(new VoiceError('no-speech', NO_SPEECH));
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' });
          const text = await api.stt(blob);
          if (cancelled) return reject(new VoiceError('cancelled', ''));
          if (!text) return reject(new VoiceError('no-speech', NO_SPEECH));
          resolve(text);
        } catch (e) {
          reject(e);
        }
      };

      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const started = Date.now();
      let lastVoice = started;
      timer = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i += 1) {
          const x = (buf[i] - 128) / 128;
          sum += x * x;
        }
        const rms = Math.sqrt(sum / buf.length);
        if (onLevel) onLevel(Math.min(1, rms * 6));
        const now = Date.now();
        if (rms > 0.035) {
          heard = true;
          lastVoice = now;
        }
        if ((heard && now - lastVoice > 1500) || now - started > 12000 || (!heard && now - started > 7000)) stopRecorder();
      }, 100);
      recorder.start();
    })();
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        cleanup();
        if (rejectFn) rejectFn(new VoiceError('cancelled', ''));
      }
    },
  };
}

function listenBrowser() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = 'id-ID';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.continuous = false;
  let settled = false;
  let cancelled = false;
  const promise = new Promise((resolve, reject) => {
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(cancelled ? new VoiceError('cancelled', '') : err);
    };
    rec.onresult = (e) => {
      if (settled) return;
      const text = e.results?.[0]?.[0]?.transcript?.trim();
      if (text) {
        settled = true;
        resolve(text);
      } else {
        fail(new VoiceError('no-speech', NO_SPEECH));
      }
    };
    rec.onerror = (e) => {
      const code = e.error;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        fail(new VoiceError('denied', 'Izin mikrofon ditolak. Aktifkan izin mikrofon di pengaturan peramban, lalu coba lagi.'));
      } else if (code === 'no-speech' || code === 'aborted') {
        fail(new VoiceError('no-speech', NO_SPEECH));
      } else if (code === 'network') {
        fail(new VoiceError('network', 'Pengenalan suara butuh koneksi internet. Periksa koneksi Anda.'));
      } else {
        fail(new VoiceError(code || 'error', 'Pengenalan suara gagal. Coba lagi.'));
      }
    };
    rec.onend = () => fail(new VoiceError('no-speech', NO_SPEECH));
    try {
      rec.start();
    } catch {
      fail(new VoiceError('start', 'Mikrofon tidak bisa dimulai. Coba lagi.'));
    }
  });
  return {
    promise,
    cancel: () => {
      cancelled = true;
      try { rec.abort(); } catch { /* abaikan */ }
    },
  };
}

/** Mulai mendengarkan. Mengembalikan { promise: Promise<string>, cancel() }. */
export function listen({ onLevel } = {}) {
  let handle = null;
  let cancelled = false;
  const promise = (async () => {
    const c = await capabilities();
    if (cancelled) throw new VoiceError('cancelled', '');
    if (c.serverStt) handle = listenServer(onLevel);
    else if (c.browserStt) handle = listenBrowser();
    else {
      throw new VoiceError(
        'unsupported',
        c.secure
          ? 'Peramban ini belum mendukung mikrofon. Silakan ketuk salah satu contoh perintah di bawah.'
          : 'Mikrofon hanya bisa dipakai lewat alamat https atau localhost. Silakan ketuk salah satu contoh perintah di bawah.',
      );
    }
    return handle.promise;
  })();
  return {
    promise,
    cancel: () => {
      cancelled = true;
      if (handle) handle.cancel();
    },
  };
}

let currentAudio = null;
let currentDone = null;
let speakToken = 0;

export function stopSpeaking() {
  speakToken += 1;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (currentDone) {
    const done = currentDone;
    currentDone = null;
    done();
  }
}

function speakBrowser(text, rate) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'id-ID';
    u.rate = rate;
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith('id'));
    if (voice) u.voice = voice;
    const finish = () => { currentDone = null; resolve(); };
    u.onend = finish;
    u.onerror = finish;
    currentDone = finish;
    window.speechSynthesis.speak(u);
  });
}

/** Ucapkan teks. Tidak pernah melempar galat; selesai saat ucapan berakhir atau dihentikan. */
export async function speak(text, rate = 0.9) {
  if (!text) return;
  stopSpeaking();
  const mine = speakToken;
  const c = await capabilities();
  if (mine !== speakToken) return;
  if (c.serverTts) {
    try {
      const blob = await api.tts(text);
      if (mine !== speakToken) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = rate;
      currentAudio = audio;
      await new Promise((resolve, reject) => {
        currentDone = resolve;
        audio.onended = resolve;
        audio.onerror = reject;
        audio.play().catch(reject);
      });
      URL.revokeObjectURL(url);
      currentDone = null;
      return;
    } catch { /* jatuh ke suara bawaan peramban */ }
  }
  if (mine !== speakToken) return;
  if (c.browserTts) await speakBrowser(text, rate);
}
