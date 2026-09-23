# Sunstrike — handoff

Terakhir diperbarui: **2026-09-24 WIB**. Baca `AGENTS.md`, dokumen ini, `RESTART_AUDIT_2026-09-23.md`, dan `STRATEGY_REVIEW_2026-09-24.md` sebelum melanjutkan.

## Keputusan terakhir pemilik

- Pemilik meminta Sunstrike berjalan live sesegera mungkin. Batas risiko yang dipilih tetap **modal $100, rugi bersih maksimum $20**; request ini tidak menghapus hard gate.
- Tiga dry run 23 September mendahului patch parity terbaru. Hasilnya bukan bukti siap live atau profit.
- Sasaran tetap PnL bersih setelah nilai inventory, swap, gas, rent, dan biaya API/LLM. Strategi belum terbukti profit konsisten.
- Target: side income yang dibuktikan dengan PnL bersih setelah perubahan nilai inventory, swap, gas, rent, dan API/LLM. Belum ada bukti strategi optimal atau profit konsisten.

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
- Lokal sesi ini: `DRY_RUN=true`, live belum diaktifkan, `SUNSTRIKE_LIVE_WALLET`, `JUPITER_API_KEY`, dan `SUNSTRIKE_OTHER_API_COSTS_USD_PER_MONTH` belum disetel, serta state breaker belum ada. Kunci lama tidak dipakai untuk pengujian.
- `user-config.json` lokal yang diabaikan Git masih memilih `bid_ask` dan `autoCompoundEnabled=true`; source default kini `spot` dan compounding mati. Jangan salin config/key historis ke VPS.
- OpenRouter dimeter per respons; biaya provider non-LLM diakru bulanan dari `SUNSTRIKE_OTHER_API_COSTS_USD_PER_MONTH`. Nilai ini wajib diisi berdasarkan tagihan/estimasi konservatif dan terikat ke state; perubahan tarif tanpa review memblokir live. Biaya variabel tetap perlu rekonsiliasi invoice.

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

- Spot kini baseline source; bukan strategi optimal yang sudah terbukti. Executor menolak strategi selain spot saat live.
- Gate screening/executor sekarang menggunakan satu kebijakan risiko fail-closed: mint harus cocok; audit mint/freeze, top-10, bot, creator/dev, bundler, rat-trader, honeypot, rugpull, wash, dan level risiko harus diketahui serta lolos ambang.
- Sizing live dibatasi satu posisi maksimal **$20**, eksposur serentak **$20**, reserve likuid **$15**, dan hanya pool quote SOL. Snapshot wallet+LP harus bertimestamp dekat dan merujuk wallet yang sama.
- `portfolio-risk.json` dibuat satu kali dari snapshot baca-saja saat wallet dedicated tidak memiliki LP terbuka. State terikat wallet/kebijakan dan tarif API, ditulis atomik mode 600; state hilang/rusak atau biaya model tak diketahui melatch breaker. Kehilangan state tidak membuat ledger baru otomatis.
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

Pada checkout lokal setelah patch ini: **8/8 suite tes lulus**, syntax check semua file JS yang disentuh dan `git diff --check` lulus. Tes VPS lama tetap 16/16 setelah `fbbb711`, sebelum patch ini.

```bash
node --test test/screening-readiness.test.js test/interval-task.test.js test/restart-safety.test.js test/jev-shadow.test.js test/strategy-policy.test.js test/screening-funnel.test.js
```

Suite lokal mencakup startup gate, wallet/risk state, restart latch, biaya model, dan fail-closed risk fields. Ini tidak membuktikan profit, transaksi, provider live, atau cakupan risiko penuh.

Rekonsiliasi lokal April: **871 action rows**, 29 deploy sukses, 29 close sukses, satu close gagal, satu claim sukses. `lessons.json` berisi 28 hasil PnL bersih **−$5,33**; 4 nilai awal kosong/nol. **23** close dapat dicocokkan ke action log dengan selisih gabungan pembulatan sekitar **−$0,02**; 5 baris belum punya action result terbaca. Ada 104 signature transaksi untuk lookup. RPC read-only gagal sebelum mendapat respons karena DNS `ENOTFOUND` di sandbox; status on-chain belum terverifikasi.

## Pekerjaan berikutnya — prioritas

1. Selesaikan rekonsiliasi 104 signature transaksi via koneksi RPC baca-saja yang bisa diakses; bandingkan dengan 28 record lesson/action tanpa mengubah histori.
2. Siapkan wallet dedicated baru dan credential operator lengkap termasuk Jupiter. Jangan gunakan wallet/key historis. Atur `spot`, `maxPositions=1`, `autoCompoundEnabled=false`, serta nilai bulanan biaya provider non-LLM yang konservatif dari tagihan.
3. Dengan wallet baru dan tanpa LP terbuka, jalankan `DRY_RUN=true node scripts/init-portfolio-risk.js` untuk menulis ledger awal tanpa signing. Jika snapshot tidak terbaca, jangan membuat file manual.
4. Jalankan 2–3 dry run terbaru dengan wallet dedicated: kandidat pass, hard reject, dan provider gagal. Arsipkan artefak, Luna, Jev-shadow, biaya model dan alasan filter.
5. Rekonsiliasi invoice variabel tiap bulan dan cocokkan seluruh PnL April. Baru setelah itu evaluasi canary; patch lokal belum disinkronkan ke VPS dan layanan tetap tidak diaktifkan.

## Aturan kerja dan rahasia

- SOP: analisis → patch kecil → verifikasi → commit → push `origin/main`; sinkronkan VPS setelah memeriksa status git. Perbarui handoff bila status material berubah.
- `.env`/key hanya di konfigurasi operator, bukan source, log atau chat. `.env` dan `user-config.json` VPS sebelumnya mode 600. Jangan menyalin credential/wallet lokal historis ke VPS.
- Key Jupiter historis yang tertanam di source dianggap terekspos dan harus diganti sebelum penggunaan live.
- Model, narrative, pool memory dan metadata tidak boleh melonggarkan hard gate. Jev tetap shadow sampai ada bukti hasil.
- Tidak perlu menjalankan ulang bot untuk perubahan dokumentasi ini. Saat melanjutkan, periksa status aktual; semua status di atas adalah hasil verifikasi sesi terakhir.
