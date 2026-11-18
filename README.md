# Sigap

Portal untuk pemilik toko online yang memakai admin AI di WhatsApp. Dalam satu layar Anda melihat tiga admin AI bekerja, metrik toko hari ini, dan berapa rupiah yang sudah mereka habiskan.

Tiga admin itu:

| Admin | Tugas | Cara kerja |
|---|---|---|
| **Echo** | CS WhatsApp | Menjawab pelanggan dari katalog dan aturan toko. Komplain diteruskan ke Anda. |
| **Tally** | Rekap order | Membaca chat yang sudah selesai, mencatat pesanan dan totalnya, menandai chat yang butuh admin. |
| **Ping** | Follow-up tagihan | Menulis draf pengingat untuk pesanan yang belum dibayar. Anda yang mengirim. |

Ketiganya adalah profil [Hermes Agent](https://hermes-agent.nousresearch.com). Model bahasanya bebas selama kompatibel dengan API OpenAI; bawaan repo ini memakai DeepSeek V4.1 Flash di [Fenrir](https://fenrir.lio.id).

## Yang ada di portal

- **Beranda**: daftar "Perlu tindakan", Kantor AI, enam metrik toko, aktivitas langsung, dan meteran gaji.
- **Kantor AI**: tiga meja. Lampu dan gerak tiap admin mengikuti status aslinya, tidak ada animasi hiasan.
- **Chat**: isi percakapan dengan warna berbeda untuk pelanggan dan AI, plus saringan "Perlu admin".
- **Pesanan** dan **Tagihan**: pesanan hasil rekap, tombol tandai lunas, dan draf pengingat yang bisa disalin.
- **Biaya AI**: sisa saldo, biaya per admin, token terpakai, dan perkiraan "saldo kuat berapa hari" beserta cara hitungnya.

## Mencoba dengan data contoh

Butuh Node.js 22.13 atau lebih baru.

```bash
git clone https://github.com/nazhifsetya27/sigap.git
cd sigap
npm install
npm run build
npm start
```

Buka http://127.0.0.1:4310. Tanpa pengaturan apa pun portal berjalan dalam mode contoh: percakapan, pesanan, dan biaya dibuat oleh portal sendiri dan diberi label "Data contoh". Angka di mode ini rekaan, bukan hasil ukur.

Untuk pengembangan: `npm run dev` (server di 4310, antarmuka di 5173).

## Menyambungkan ke WhatsApp sungguhan

1. Pasang Hermes Agent dan isi API key penyedia model di `~/.hermes/.env` (bawaan: `FENRIR_API_KEY`).
2. Jalankan `OWNER_WHATSAPP=628xxx scripts/setup-hermes.sh` dengan nomor pemilik toko. Skrip ini membuat profil `echo`, `tally`, dan `ping`, lalu memasang hook kecil di profil Echo.
3. Ganti katalog contoh di `~/.hermes/profiles/echo/SOUL.md` dengan katalog toko Anda.
4. Pasangkan WhatsApp: `hermes -p echo whatsapp`. Tunggu 30 detik, lalu jalankan gateway milik Echo: `hermes -p echo gateway install && hermes -p echo gateway start`. Echo memakai gateway sendiri, jadi gateway profil utama Anda tidak terganggu.
5. Salin `.env.example` menjadi `.env`, isi `DATA_SOURCE=hermes`, dan jalankan ulang portal.

Pakai nomor khusus toko. Sambungan lewat QR memakai tautan perangkat WhatsApp, bukan API resmi, sehingga nomor bisa diblokir.

## Memasang di server

Portal dijalankan di host yang sama dengan Hermes, sebagai layanan systemd tingkat pengguna:

```bash
git clone https://github.com/nazhifsetya27/sigap.git ~/sigap && cd ~/sigap
npm ci && npm run build
cp .env.example .env        # isi DATA_SOURCE=hermes dan ACCESS_CODE
scripts/setup-hermes.sh
mkdir -p ~/.config/systemd/user && cp deploy/sigap.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now sigap
```

Portal mendengarkan di `127.0.0.1:4310`. Untuk membukanya lewat domain, pakai `deploy/nginx.conf.example` dan pasang HTTPS. Tanpa domain, buka lewat terowongan SSH: `ssh -L 4310:127.0.0.1:4310 pengguna@server`.

## Soal angka biaya

- Biaya Echo dibaca dari catatan pemakaian Hermes per percakapan. Biaya Tally dan Ping dicatat tiap kali mereka dijalankan.
- "Kuat berapa hari" adalah proyeksi: biaya ketiga admin dibagi jumlah percakapan terukur, dikalikan asumsi chat per hari. Proyeksi baru muncul setelah ada minimal 3 percakapan terukur.
- Saldo dan kurs diisi sendiri di halaman Pengaturan. Portal tidak membaca saldo dari penyedia model.
- Biaya pesan WhatsApp dari Meta, bila kelak memakai API resmi, belum dihitung.

## Arsitektur

```
WhatsApp ──► Hermes gateway (profil Echo) ──► model bahasa
                    │ menulis sesi
                    ▼
            penyimpanan sesi Hermes ──(dibaca saja)──► Sigap server ──► SQLite
                                                          │   ▲
                                 menjalankan Tally & Ping ┘   └── antarmuka web
```

- **Server** (`server/`): Fastify, Node.js, dan SQLite bawaan Node (`node:sqlite`), tanpa dependensi native.
- **Sumber data** (`server/src/sources/`): `hermes-sessions.ts` membaca penyimpanan sesi Hermes secara read-only; `demo.ts` membuat data contoh. Keduanya memenuhi antarmuka `StatusProvider` yang sama.
- **Runtime agent** (`server/src/runtime/hermes.ts`): menjalankan Tally dan Ping sebagai perintah sekali-jalan dan mengambil biayanya.
- **Antarmuka** (`web/`): React dan Vite, memperbarui diri tiap beberapa detik.

Yang sudah disiapkan untuk tumbuh:

- Semua tabel utama membawa `store_id`, jadi melayani banyak toko tidak butuh migrasi besar.
- Sumber data dan runtime agent berdiri di balik antarmuka sendiri. Sambungan WhatsApp Cloud API atau panggilan model langsung bisa ditambahkan tanpa mengubah portal.
- Portal tidak pernah menulis ke berkas milik Hermes.

## Keamanan

- Echo menerima pesan dari siapa saja, jadi profilnya tidak diberi alat apa pun: tidak ada terminal, berkas, atau browser.
- Isi chat diperlakukan sebagai data saat diberikan ke Tally dan Ping, dan jawaban mereka divalidasi sebelum disimpan.
- Nomor pelanggan disamarkan di antarmuka.
- Sebelum portal dibuka ke internet, isi `ACCESS_CODE` di `.env` dan pasang di belakang HTTPS.
- Folder `data/` berisi percakapan pelanggan dan tidak ikut ke git.

## Batas versi ini

| Hal | Status |
|---|---|
| Sambungan WhatsApp lewat QR (Hermes) | Berjalan: pairing, gateway Echo, dan status di portal sudah teruji |
| Sambungan WhatsApp Cloud API resmi | Belum ada |
| Membalas pelanggan dari portal | Belum ada, balas lewat WhatsApp toko |
| Mengirim pengingat otomatis | Sengaja tidak ada, Ping hanya menulis draf |
| Banyak toko dalam satu portal | Skema siap, antarmuka belum |
| Membaca saldo dari penyedia model | Belum ada, diisi manual |

## Lisensi

MIT. Lihat [LICENSE](LICENSE).
