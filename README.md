# IngatKu — Asisten Memori Suara untuk Lansia

Prototipe aplikasi web (frontend + backend) dengan 8 layar sesuai desain:
Splash, Masuk/Daftar, Beranda, Perintah Suara, Pengingat, Jadwal, Informasi Kesehatan, Pengaturan
(ditambah layar Riwayat untuk tab "Riwayat").

## Cara menjalankan

Butuh Python 3.9+ saja. Tidak ada pustaka yang perlu dipasang.

```bash
cd backend
python3 seed.py        # (opsional) isi akun demo + jadwal seperti desain
python3 server.py      # buka http://localhost:8000
```

Akun demo: nomor HP `081234567890`, password `ingatku123` (Pak Budi Santoso).
Atau daftar akun baru lewat tombol "Mulai".

## Struktur

```
backend/
  server.py          API JSON + penyaji berkas frontend (http.server)
  db.py              SQLite: pengguna, jadwal, riwayat, pengaturan
  security.py        hash password (PBKDF2) + token bertanda tangan
  nlu.py             pemahaman perintah suara Bahasa Indonesia
  assistant.py       menjalankan perintah (tambah/cek jadwal, berita, dll.)
  health_content.py  artikel Informasi Kesehatan
  voice.py           Whisper (STT) dan VITS (TTS), opsional
  seed.py            data contoh
  tests/             tes otomatis
frontend/
  index.html, css/style.css, js/*.js   (tanpa build, tanpa framework)
```

## Tes

```bash
cd backend
python3 -m unittest discover -s tests -v
```

## Suara

- Bawaan: Web Speech API peramban (bahasa `id-ID`). Gunakan Chrome atau Edge. Mikrofon hanya
  berfungsi di `http://localhost` atau HTTPS. Bila tidak didukung, pilih "Contoh perintah".
- Opsional (sesuai rancangan proposal): `pip install faster-whisper` (Whisper untuk STT) dan
  `pip install transformers torch numpy` (VITS `facebook/mms-tts-ind` untuk TTS). Bila belum
  dipasang, endpoint suara menjawab 501 dan frontend memakai suara peramban.

## Pengaturan lingkungan (opsional)

`PORT` (8000), `HOST` (127.0.0.1), `INGATKU_DB`, `INGATKU_DATA_DIR`, `INGATKU_SECRET`,
`INGATKU_TZ_OFFSET` (7 = WIB), `INGATKU_WHISPER_MODEL`, `INGATKU_TTS_MODEL`.

## Batasan prototipe

- Pengingat muncul saat IngatKu terbuka di peramban; belum ada notifikasi push saat ditutup.
- Jadwal berlaku per tanggal (belum ada jadwal berulang otomatis).
- Pemulihan password lewat SMS belum tersedia.
- Font Plus Jakarta Sans dimuat dari Google Fonts; tanpa internet dipakai font bawaan sistem.
