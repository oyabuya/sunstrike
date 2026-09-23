# Sunstrike — handoff

Terakhir diperbarui: **2026-09-24 WIB**. Baca `AGENTS.md`, dokumen ini, `RESTART_AUDIT_2026-09-23.md`, dan `STRATEGY_REVIEW_2026-09-24.md` sebelum melanjutkan.

## Keputusan terakhir pemilik

- Pemilik meminta Sunstrike berjalan live sesegera mungkin. Batas risiko yang dipilih tetap **modal LP $100, rugi LP maksimum $20**; request ini tidak menghapus hard gate.
- Tiga dry run 23 September mendahului patch parity terbaru. Hasilnya bukan bukti siap live atau profit.
- Biaya API/LLM adalah biaya operasional di luar modal LP $100 dan **tidak mengurangi breaker rugi LP $20**. PnL akhir tetap dapat melaporkan biaya operasional secara terpisah.
- Histori April tetap utuh sebagai arsip. Rekonsiliasi April bukan syarat campaign wallet baru; statistik dan auto-learning posisi kini disaring per wallet.
- Sasaran tetap PnL bersih setelah perubahan inventory, swap, gas, rent, dan biaya operasional. Strategi belum terbukti profit konsisten.

## Status operasional terakhir yang diverifikasi

- Lokal: `/home/oyabuya/Documents/GITHUB/sunstrike`, branch `main`, remote `origin` → `oyabuya/sunstrike`.
- VPS: `ssh hetzner-prod`, checkout `/home/ubuntu/projects/sunstrike`. Commit terakhir yang terverifikasi pada sesi sebelumnya **`fbbb711`**. VPS tidak diperiksa atau diubah pada sesi ini.
- Node VPS: `/home/ubuntu/.nvm/versions/node/v24.15.0/bin/node`. Shell SSH noninteraktif perlu menambahkan direktori tersebut ke `PATH`.
- VPS sebelumnya terverifikasi `DRY_RUN=true`, `SUNSTRIKE_LIVE_ENABLED=false`, `ALLOW_SELF_UPDATE=false`; status terkini perlu dicek sebelum sinkronisasi.
- Tidak ada service Sunstrike yang diaktifkan dalam sesi ini. Jangan mengganggu layanan VPS lain.
- Runner lama `scripts/ten-dry-run-cycles.js`, PID 715946, **sudah dihentikan secara terarah setelah 3/10 siklus** untuk mengganti proses yang masih memuat kode/jadwal lama.
- Runner pengganti `scripts/three-dry-run-checks.js` **sudah selesai 3/3 dan keluar**. Tidak ada transaksi dikirim; runner ini memakai `silent: true` dan tidak mengirim laporan Telegram.
- Telegram `@Sunstrike_Bot` sudah dikonfigurasi dan pengujian getMe/getUpdates/sendMessage sebelumnya berhasil. Tidak ada polling perintah Telegram/service baru yang dijalankan.
- Luna `openai/gpt-6-luna` dipakai untuk screening/management/general; fallback provider tertentu `openai/gpt-4.1-mini`. Jev hanya shadow scoring dry-run, bukan pengendali hard gate atau transaksi.
- Canary config lokal disetel `spot`, `maxPositions=1`, `autoCompoundEnabled=false`; sizing yang diuji membatasi posisi dan eksposur serentak pada $20 serta menyisakan reserve cair $15.
- Pemilik melaporkan wallet dedicated berisi $100 dan API Jupiter sedang disiapkan. `.env` tidak dibuka. Pemeriksaan runtime tanpa menampilkan nilainya menemukan `WALLET_PRIVATE_KEY` ada dan valid, tetapi `SUNSTRIKE_LIVE_WALLET` tidak diset. Setup wizard dan contoh manual README sebelumnya memang tidak meminta variabel itu.
- Kode kini memuat `.env` relatif ke root repo dan menurunkan alamat publik dari private key bila variabel alamat kosong; alamat eksplisit yang tidak cocok diblokir. Wallet identity sudah terikat tanpa mencatat alamat/key ke artefak tes.
- Snapshot Helius terbaru untuk wallet hasil derivasi sukses, dengan **0 SOL, $0 SOL value, $0 USDC, $0 total USD**; posisi terbuka 0. Ini berbeda dari $100 yang dilaporkan pemilik dan menunjukkan key yang dimuat menunjuk wallet tanpa saldo terindeks. Pembacaan RPC klasik sebelumnya juga menemukan 0 SOL/token account. Jangan mulai live sampai key lokal dipastikan pasangan wallet yang didanai.
- `scripts/init-portfolio-risk.js` dijalankan dalam DRY_RUN; initializer menolak membuat ledger karena equity pada/bawah $80 (modal $100 dikurangi loss cap $20). Tidak ada file ledger dibuat dan tidak ada transaksi.
- Error saldo/provider kini ditampilkan sebagai nilai tidak diketahui, bukan saldo nol yang valid. API Jupiter tidak diperiksa langsung dan tidak ada service/VPS yang diaktifkan.
- Tidak ada service yang diaktifkan dan tidak ada perubahan yang dikirim ke VPS.

## Bukti tiga dry run tambahan

Run: **2026-09-23 17:37:30–17:40:50 UTC**, yaitu **24 September 00:37:30–00:40:50 WIB**. Jeda 60 detik setelah siklus sebelumnya selesai; ini smoke test integrasi, bukan backtest profit.

| Siklus | Hasil | Makna |
|---|---|---|
| 1 | No entry | Jalur screening tanpa entry berfungsi |
| 2 | Simulated entry Stamp-SOL, 0,5 SOL | Tool dry-run tercatat sukses; tidak mengirim transaksi |
| 3 | No entry, Stamp-SOL ditolak | Model menyebut data honeypot/dev/insider/bundle tidak lengkap |

- Pool kandidat: `F6H5zJeZEUDnYPtcXM3LwQkkcsg1XHLvEJGpB9Mizu1E`.
- Advanced-info, price-info dan cluster-list OKX tidak tersedia. Sebagian pemeriksaan lain berhasil, termasuk RugCheck. Jangan menyamakan keberhasilan satu sumber dengan kelengkapan semua risiko.
- Keputusan berubah antara simulasi entry dan penolakan terhadap kandidat sama dengan data risiko kurang. Ini temuan reliabilitas/compliance; **bukan bukti akurasi profit**.
- Sesudah run, commit `fbbb711` menghapus pengecualian dry-run pada verifikasi posisi, mint pool dan ketersediaan data risiko preflight executor. **Patch ini belum diuji ulang dengan kandidat pasar.** Pemeriksaan kecukupan saldo transaksi tetap khusus live.
- Artefak di VPS: `logs/three-dry-run-checks.json`, `logs/three-dry-run-checks.out`, `logs/ten-dry-run-cycles.json`, serta action logs/jev shadow berdasarkan `cycle_id`. Status terakhir runner baru: `complete`, `live_ready=false`. Simpan artefak sebelum mengulang karena nama file status/output tetap.

## Perubahan yang sudah selesai

| Commit | Perubahan |
|---|---|
| `48f0bf9` | Hapus fallback screening longgar, tegakkan batas konsentrasi, koreksi jarak harga bin geometris, hapus bias wajib hold kerugian |
| `6c056fe` | Error discovery tidak lagi dianggap kandidat kosong; enrichment sebelum top-N; hapus fallback bypass di orchestration; tambah diagnosis funnel |
| `82b12c4` | Ganti cron interval screening/management/health dengan elapsed timer, cegah overlap, hormati interval health |
| `71fe203` | Validasi respons posisi/saldo sebelum screening; tambah runner tiga dry run |
| `fbbb711` | Samakan gate ketersediaan data deploy dry-run/live dan catat hasil uji |
| `8469f0e` | Fail-closed lintas provider, sizing USD $20, ledger loss $20 tahan restart, gate startup state/wallet, biaya model/API, dan poller reduksi risiko |
| working tree | Campaign learning disaring per wallet; biaya provider dipisah dari breaker LP; canary satu posisi Spot tanpa compounding |

- Spot kini baseline source; bukan strategi optimal yang sudah terbukti. Executor menolak strategi selain spot saat live.
- Gate screening/executor sekarang menggunakan satu kebijakan risiko fail-closed: mint harus cocok; audit mint/freeze, top-10, bot, creator/dev, bundler, rat-trader, honeypot, rugpull, wash, dan level risiko harus diketahui serta lolos ambang.
- Sizing live dibatasi satu posisi maksimal **$20**, eksposur serentak **$20**, reserve likuid **$15**, dan hanya pool quote SOL. Snapshot wallet+LP harus bertimestamp dekat dan merujuk wallet yang sama.
- `portfolio-risk.json` dibuat satu kali dari snapshot baca-saja saat wallet dedicated tidak memiliki LP terbuka. State terikat wallet/kebijakan, ditulis atomik mode 600; state hilang/rusak memblokir entry. Biaya model/provider tidak masuk modal atau breaker LP.
- Saat loss cap terukur tercapai, breaker latch dan poller mencoba close posisi serta swap pasca-close. Polling bukan jaminan fill atau batas rugi absolut saat harga bergerak, provider mati, atau loop sibuk.
- Jarak harga yang disebut `downside_buffer_pct` **bukan batas kerugian**. Lebar bin lama, minimum umur exit empat jam dan stop loss lama belum dioptimasi berdasarkan hasil.
- Exit low-yield tidak lagi mensyaratkan PnL positif. Manager diperintahkan mengikuti CLOSE mekanis; eksekusi exit masih bergantung pada jalur model/tool.

## Diagnosis screening dan jadwal

- Profil saat ini: token umur **12–72 jam**, market cap **$250k–$10m**, TVL **$10k–$150k**, bin step **80–125**, quote SOL, volume minimum **$1.000 pada timeframe 5m**, organic score minimum 60. Ini pencarian token muda, bukan seluruh LP berisiko rendah.
- Probe funnel 17:30:52 UTC: 11.134 pool setelah holder/market cap, 4 setelah volume, dan 0 setelah kombinasi lengkap. Query berurutan bukan snapshot atomik; beberapa hitungan naik akibat perubahan window/index. Jangan menganggap hitungan sebagai atribusi kausal pasti.
- `scripts/screening-funnel.js` memakai builder filter yang sama, hanya untuk diagnosis read-only. Query parsial tidak boleh menjadi kandidat deploy.
- Enrichment kini mencakup seluruh halaman sampai 50 pool sebelum top-N. Belum ada pagination lengkap; jangan mengklaim seluruh universe telah diperiksa.
- Default tetap screening **45m**, management **15m**, health **60m**; angka belum terbukti ideal. Timer baru membetulkan `*/45` yang sebelumnya menghasilkan jeda 45/15 menit. Briefing tetap cron 08:00 WIB.
- Poller PnL 30 detik terhambat saat screening/management sibuk dan memiliki cooldown pemicu management. **Bukan jaminan exit dalam 30 detik.**
- Uji profil pasangan mapan, window lebih panjang, dan scan 5–10 menit adalah hipotesis berikutnya; belum diaktifkan sebagai kebijakan live. Jangan longgarkan anti-rug hanya untuk menghasilkan entry.

## Verifikasi terakhir

Pada checkout lokal: **10/10 suite tes lulus**, syntax check semua file JS yang disentuh dan `git diff --check` lulus. Tes VPS lama tetap 16/16 setelah `fbbb711`, sebelum patch ini. Runtime probe dari `/tmp` membuktikan loader mengambil `.env` repo dan mengikat alamat hasil derivasi tanpa mencetak nilainya.

```bash
node --test test/*.test.js
```

Suite lokal mencakup startup gate, wallet/risk state, restart latch, pemisahan biaya API, campaign scope, fail-closed risk fields, dan derivasi/pencocokan wallet. Snapshot Helius terbaru valid tetapi saldo wallet hasil derivasi $0; initializer read-only menolak ledger pada gate equity $80. Tidak ada transaksi atau ledger baru. Ini tidak membuktikan profit atau kesiapan live.

Arsip April tetap berisi **871 action rows**, 29 deploy sukses, 29 close sukses, satu close gagal, satu claim sukses, dan 28 hasil PnL bersih tercatat **−$5,33**. Angka ini arsip pembanding; tidak mengunci campaign baru. Rekonsiliasi 104 signature opsional untuk audit sejarah dan tidak perlu selesai sebelum LP baru.

## Pekerjaan berikutnya — prioritas

1. Cocokkan alamat wallet yang diturunkan dari key `.env` dengan wallet yang berisi $100. Jangan kirim key ke chat; bila alamat berbeda, perbaiki `WALLET_PRIVATE_KEY` lokal agar menunjuk wallet funded.
2. Setelah wallet yang benar terpilih dan memiliki equity/SOL operasional, jalankan `DRY_RUN=true node scripts/init-portfolio-risk.js`. Script hanya membaca wallet/LP dan menolak ledger bila equity tidak memadai atau ada LP terbuka.
3. Pastikan API Jupiter siap sesuai pemilik, lalu ulangi 2–3 dry run setelah saldo wallet benar terbaca; arsipkan hasil sebelum menilai canary.
4. Rekonsiliasi April dan invoice API adalah audit terpisah, bukan prasyarat LP baru. Source belum disinkronkan ke VPS dan service tetap nonaktif.

## Aturan kerja dan rahasia

- SOP: analisis → patch kecil → verifikasi → commit → push `origin/main`; sinkronkan VPS setelah memeriksa status git. Perbarui handoff bila status material berubah.
- `.env`/key hanya di konfigurasi operator, bukan source, log atau chat. `.env` dan `user-config.json` VPS sebelumnya mode 600. Jangan menyalin credential/wallet lokal historis ke VPS.
- Key Jupiter historis yang tertanam di source dianggap terekspos dan harus diganti sebelum penggunaan live.
- Model, narrative, pool memory dan metadata tidak boleh melonggarkan hard gate. Jev tetap shadow sampai ada bukti hasil.
- Tidak perlu menjalankan ulang bot untuk perubahan dokumentasi ini. Saat melanjutkan, periksa status aktual; semua status di atas adalah hasil verifikasi sesi terakhir.

## Update sesi kontrol Telegram

- Probe VPS terbaru: Helius RPC HTTP 200, 0,880118 SOL; Helius Wallet API HTTP 200, $100,607. Wallet VPS cocok dengan key operator. Diagnosis saldo nol sebelumnya berlaku untuk konfigurasi lokal, bukan wallet VPS. Credential lokal tidak disalin.
- Jupiter key VPS belum tersedia pada probe; pemilik diminta memasangnya langsung di `.env`. LIVE belum dapat diklaim siap.
- `/mode`, `/dry_run`, `/live` menjadi perintah deterministik di handler Telegram terautentikasi. Transisi ditolak selama operasi berjalan atau perintah kedaluwarsa. LIVE memeriksa konfigurasi dan snapshot risiko segar; mode berlaku sampai restart, lalu mengikuti `.env`.
- Saldo di atas $100 tidak lagi dianggap tambahan deployment budget atau alasan memblokir keuntungan. Batas posisi/eksposur tetap $20; loss dihitung dari nilai tertinggi antara modal kebijakan $100 dan equity awal ledger. Kerugian maksimum $20 tetap latch.
- Loader `.env` root repo dan derivasi identitas wallet dari perubahan sesi sebelumnya disertakan. Respons saldo Helius malformed ditolak sebagai unknown.
- Verifikasi lokal: 11/11 suite berhasil; syntax index/config dan diff check berhasil. Deployment dan status service dicatat setelah langkah operasional selesai.

- Dry run ulang setelah fix native SOL Helius: 3/3 siklus `no_entry`, tanpa transaksi atau error saldo. Saldo VPS terakhir 0,880118 SOL (~$101,10), 0 LP; ledger risiko awal $100,61.
- Jupiter quote baca-saja HTTP 200. GMGN CLI v1.6.6 terpasang dan Ed25519 keypair dibuat di VPS (`~/.config/gmgn/keypair.pem` mode 600); API key pribadi belum tersedia. Public key link sudah diberikan ke pemilik. Pemilik melaporkan “insufficient assets” pada key service; lokasi error diminta untuk diagnosis. Jangan gunakan demo key untuk LIVE.
- Service `sunstrike.service` sempat aktif dry-run, lalu dihentikan setelah Telegram me-replay `/start` lama. Tidak ada posisi dibuka. Polling kini menolak semua pesan sebelum waktu startup dan pesan lebih dari 120 detik. Restart service setelah deploy patch ini; hanya service Sunstrike yang boleh disentuh.

- Setelah filter replay dipasang, service `sunstrike.service` diaktifkan kembali dan terverifikasi `active` dengan polling Telegram. Mode tetap `DRY_RUN=true`, `SUNSTRIKE_LIVE_ENABLED=false`. 39/39 tes VPS lulus. Perintah `/mode`, `/dry_run`, `/live` sudah tersedia untuk pesan baru yang terotorisasi.
- Terakhir diperiksa: `GMGN_API_KEY` masih tidak ada di `.env` VPS; Jupiter ada. Karena GMGN adalah sumber wajib untuk hard filter, `/live` akan ditolak sampai API key valid tersedia dan gate live lokal diaktifkan. Error “insufficient assets” yang dilaporkan pemilik belum dapat diatribusi tanpa lokasi/teks error spesifik.

- Pemilik mengonfirmasi `key-service error: INSUFFICIENT_ASSETS` muncul di halaman pembuatan GMGN API key sesudah public key diisi dan tombol Next ditekan. Public key PEM di VPS lolos validasi OpenSSL; `gmgn-cli config --check` masih exit 1. Ini penolakan upstream saat penerbitan, bukan error Helius, Jupiter, atau parser wallet Sunstrike. Dokumentasi GMGN yang tersedia tidak menjelaskan ambang aset untuk error ini; jangan mengasumsikan nominal atau mendanai akun/wallet tanpa keputusan pemilik. Service Sunstrike tetap active dalam DRY_RUN; LIVE gate tetap terkunci.

- Pemeriksaan folder sibling lokal `../meridian` menemukan API key GMGN lama tersimpan di file operator `../meridian/gmgn-config.json` (`apiKey` nonempty), bukan literal hardcoded di source Sunstrike. Meridian lama memakai `X-APIKEY` ke `openapi.gmgn.ai`; Sunstrike sekarang memakai `gmgn-cli`, tetapi kompatibilitas dan status aktif key lama belum diuji. Sesuai larangan memakai key historis untuk uji baru, key tidak disalin ke `.env` VPS, tidak dipanggil, dan nilainya tidak ditampilkan. Penerbitan key baru masih tertahan `INSUFFICIENT_ASSETS` upstream.

- Atas permintaan pemilik, `npx skills add GMGNAI/gmgn-skills --global --agent codex --yes` dijalankan di VPS. 14 GMGN skills terpasang untuk Codex di `~/.agents/skills`; satu `gmgn-wallet-score` dilewati installer karena YAML upstream tidak valid. Pemasangan tidak menghasilkan API key (`gmgn-cli config --check` exit 1). Service Sunstrike tetap active DRY_RUN; error issuance `INSUFFICIENT_ASSETS` masih perlu GMGN.

- Atas instruksi pemilik, keypair Ed25519 untuk pendaftaran GMGN diregenerasi di VPS melalui Node crypto. Keypair sebelumnya diarsipkan privat di `~/.config/gmgn/` dan keypair baru ada di `keypair.pem` mode 600; public key baru diberikan kepada pemilik. `gmgn-cli config` kini menghasilkan link baru. API key belum terbit, jadi `gmgn-cli config --check`/LIVE masih terkunci. Tidak ada key historis disalin ke Sunstrike.
