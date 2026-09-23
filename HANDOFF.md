# Sunstrike — handoff

Terakhir diperbarui: 2026-09-23. Baca `AGENTS.md` dan `RESTART_AUDIT_2026-09-23.md` sebelum mengubah bot.

## Tujuan dan konteks

- Sunstrike adalah fork Meridian yang dimodifikasi pemilik untuk strategi LP DLMM Meteora di Solana. Tugas asisten: mengembangkan, debugging, optimasi, analisis log dan hasil, pengujian, operasi VPS, serta pelaporan yang dapat diaudit.
- Tujuan akhir pemilik adalah side income dari LP Meteora. Perlakukan itu sebagai target yang perlu dibuktikan dengan hasil bersih setelah impermanent loss/perubahan harga token, biaya transaksi, rent, swap, dan biaya API/LLM. Keberhasilan pengguna Meridian lain adalah petunjuk untuk diteliti, bukan bukti bahwa konfigurasi Sunstrike ini menguntungkan.
- Modal uji yang disetujui sebagai batas perencanaan: **$100**. Batas kerugian total yang dipilih pemilik: **$20 (20%)**. Batas tersebut **belum ditegakkan otomatis dalam kode**; jangan menafsirkan `stopLossPct=-80` sebagai pengganti.

## Lokasi dan keadaan saat handoff

- Repo lokal: `/home/oyabuya/Documents/GITHUB/sunstrike`, branch `main`, remote `origin` di GitHub `oyabuya/sunstrike`.
- VPS: `ssh hetzner-prod`, checkout pribadi `/home/ubuntu/projects/sunstrike`. Dependensi sudah dipasang. `.env` dan `user-config.json` di VPS berizin `600`; direktori proyek privat. Jangan mencetak atau menyalin rahasia ke repo/chat.
- VPS disetel `DRY_RUN=true`, `SUNSTRIKE_LIVE_ENABLED=false`, `ALLOW_SELF_UPDATE=false`; `user-config.json` memakai `dryRun=true`, `maxPositions=1`, dan `autoCompoundEnabled=false`. Tidak ada service Sunstrike yang dijalankan. Layanan lain di VPS dibiarkan seperti semula dan tidak boleh dihapus sebagai bagian dari pekerjaan Sunstrike.
- Key OpenRouter sudah disiapkan langsung oleh pemilik di `.env` VPS. Konfigurasi VPS memilih `openai/gpt-6-luna` untuk peran screening, management, dan general. Fallback kode untuk gangguan provider tertentu ialah `openai/gpt-4.1-mini`.
- `JEV_SHADOW_ENABLED=true` disiapkan di VPS, tetapi modul hanya memanggil Jev jika `OPENROUTER_API_KEY` tersedia dan `DRY_RUN=true`. Modul itu mencatat tiga skor (fee, momentum, risiko holder) untuk maksimal lima kandidat dan tidak mengubah input/keputusan Luna atau mengeksekusi transaksi.
- Patch Jev sudah disinkronkan ke VPS dan enam tes Jev/restart lulus di sana. Catatan Jev kini terhubung ke pilihan tool Luna melalui `cycle_id`, disertai model/biaya provider dan kegagalan yang disanitasi. Belum ada hasil LP aktual; nilai tambah Jev tetap harus diuji terhadap baseline.
- Setelah key dipasang pemilik, smoke test OpenRouter Luna tool call dan Jev Decisions API berhasil (HTTP 200); RPC, saldo Helius, dan pembacaan posisi juga berhasil (nol posisi). Modul `recordJevShadow` berhasil dengan metrik sintetis. Satu `cli.js screen --dry-run --silent` selesai tanpa kandidat lolos filter, sehingga belum ada skor Jev atau pilihan Luna dari kandidat pasar nyata. CLI kini tidak menyalakan loop otomatis saat mengimpor `index.js`. Telegram, Jupiter, LPAgent, dan GMGN belum dikonfigurasi.
- Persiapan Telegram: `.env` chat ID kini diutamakan atas nilai lama `user-config.json`; `scripts/telegram-check.js` memvalidasi token dan menampilkan chat/user ID tanpa mencetak token, dengan `--send-test` untuk pesan uji eksplisit.
- Pemilik membuat `@Sunstrike_Bot` dan mengirim `/start` dari satu chat privat. Chat ID dan allowed user ID dari pesan itu sudah ditulis ke `.env` VPS (mode `600`); `getMe`, `getUpdates`, dan `sendMessage` uji berhasil. Bot Sunstrike belum dijalankan sebagai service.
- Runner terbatas `scripts/ten-dry-run-cycles.js` aktif di VPS sejak 2026-09-23 16:32 UTC, PID awal 715946. Target 10 screening: satu langsung lalu cron `*/45 * * * *`, dengan laporan Telegram dan status di `logs/ten-dry-run-cycles.json`. Siklus pertama selesai tanpa kandidat lolos; `DRY_RUN=true`, live tetap terkunci. Runner berhenti otomatis setelah siklus ke-10 dan tidak menjalankan management cron atau polling perintah Telegram.
- File `.env` lokal lama pernah berisi key dan mode live; mode lokal telah diubah ke dry run. **Jangan menyalin file/key/wallet lama ke VPS.** Key Jupiter yang sebelumnya tertanam di source harus dianggap terekspos dan diganti sebelum penggunaan live.

## Temuan yang sudah dibuktikan

- Riwayat lokal April 2026 berisi 28 catatan posisi tertutup. Empat bernilai awal nol; 24 sisanya mencatat 15 menang, 6 kalah, 3 datar, dan total PnL posisi **−$5,33**. Itu belum direkonsiliasi terhadap transaksi on-chain dan nilai wallet. Rata-rata menang +$0,28, rata-rata kalah −$1,60; kesenjangan besaran rugi adalah masalah utama.
- Jalur screening sudah memiliki hard filter dan skor deterministik `candidate_score` (`tools/screening.js`, `evilpanda-policy.js`). Pada pemeriksaan di Hetzner, endpoint Meteora merespons, tetapi kriteria ketat saat itu menghasilkan nol kandidat. Jangan melonggarkan filter hanya agar ada transaksi.
- Jev adalah model keputusan terstruktur untuk skor/kategori; skornya bukan probabilitas profit. Akurasi pada tugas klasifikasi umum belum membuktikan akurasi hasil LP. Shadow score perlu dipasangkan dengan hasil posisi untuk evaluasi.
- Pemeriksaan terakhir: enam tes Jev/restart lulus di VPS. Autentikasi Luna/Jev, tool calling Luna, wallet/RPC, dan modul Jev teruji. Telegram, transaksi, serta manfaat skor Jev pada kandidat pasar nyata belum diuji.

## Batas aman yang berlaku

1. Pertahankan dry run sampai ada rekonsiliasi historis, circuit breaker kerugian portofolio $20 yang tahan restart, pemeriksaan data gagal secara aman, dan uji kering dengan key/market data nyata.
2. Sebelum live, gunakan wallet baru khusus bot; hitung nilai total wallet **dan** posisi LP pada timestamp yang sama. Catat biaya, rent, swap, sisa token, serta perubahan harga SOL. Tentukan eksposur maksimum per posisi dan cadangan SOL dari modal $100.
3. Model boleh mengusulkan tindakan; kode harus memverifikasi hard filter, ukuran posisi, status data, dan batas kerugian. Key pribadi dan live flags tetap di konfigurasi operator, bukan kendali model.
4. Jangan menjanjikan return atau menyebut win rate sebagai bukti profit. Bandingkan hasil bersih terhadap modal dan risiko, bukan sekadar fee LP.

## Pekerjaan berikutnya, berurutan

1. Rekonsiliasi semua signature deploy/claim/close/swap April dengan transaksi Solana final. Selidiki empat catatan bernilai awal nol dan perbedaan log; simpan artefak lama utuh.
2. Rancang serta uji batas modal $100 dan rugi total $20 pada nilai portofolio yang dapat diverifikasi, termasuk perilaku ketika RPC/price feed gagal dan saat posisi masih terbuka. Putuskan ukuran posisi/cadangan gas berdasarkan biaya aktual.
3. Saat credential opsional tersedia, verifikasi format laporan Telegram, Jupiter, data risiko tambahan, dan izin chat. Jangan tampilkan nilai key dalam log atau laporan.
4. Jalankan evaluasi dry run dengan kandidat bertimestamp: hard-filter result, skor deterministik, Jev score/confidence, pilihan Luna, alasan tidak entry, biaya prediksi, dan hasil pasar setelah horizon yang ditentukan. Ukur apakah Jev menambah kualitas keputusan dibanding baseline tanpa Jev.
5. Bahas live canary kecil hanya setelah langkah di atas memberi dasar yang dapat diperiksa. Aktifkan live dengan keputusan eksplisit pemilik, lalu cocokkan tiap transaksi dan wallet sebelum entry berikutnya.

## Petunjuk kerja

- Ubah kode kecil dan terarah; jalankan `node --check` pada file berubah, `node --test test/jev-shadow.test.js test/restart-safety.test.js`, lalu pemeriksaan spesifik sesuai risiko perubahan.
- Ikuti `AGENTS.md`: analisis → patch → verifikasi → commit → push; sinkronkan checkout VPS jika perubahan relevan. Periksa status git lokal/VPS sebelum mengubahnya.
- Gunakan `RESTART_AUDIT_2026-09-23.md` untuk rincian bukti dan alasan tiap pengaman; perbarui handoff ini bila keputusan, konfigurasi, atau status live berubah.

## Evaluasi strategi 2026-09-24

- Lihat `STRATEGY_REVIEW_2026-09-24.md`: riset resmi Meteora, perbandingan Spot/Curve/Bid-Ask, dan batas bukti meta terbaru. Tidak ada klaim strategi optimal atau return terjamin.
- Patch menghapus fallback screening longgar, menghormati batas konsentrasi pemilik, mengoreksi jarak harga bin geometris, dan menghapus kewajiban hold posisi rugi dari prompt serta gate low-yield. Spot tetap baseline dry run.
- Syntax dan tes strategy-policy/restart-safety/jev-shadow lulus lokal. Batas loss portofolio $20 belum diimplementasikan; live tetap terkunci. Lebar rentang, sizing, stop loss lama dan minimum umur exit belum dioptimasi berdasarkan hasil.

## Diagnosis screening kosong 2026-09-24 WIB

- Probe read-only VPS bertimestamp 2026-09-23T17:30:52Z: filter kumulatif holder/market cap masih 11.134 pool; penambahan volume >= $1.000 pada timeframe 5m menghasilkan 4; kombinasi lengkap menghasilkan 0. Sebelum batas umur maksimum 72 jam masih 1. Query berurutan bukan snapshot atomik: beberapa hitungan naik karena perubahan window/index API, sehingga bukan atribusi kausal pasti.
- Profil sekarang sangat sempit: token umur 12–72 jam, market cap $250k–$10m, TVL $10k–$150k, bin step 80–125, quote SOL. Ini profil token spekulatif muda, bukan pencarian semua LP risiko rendah. Tidak mengubah hard gate untuk memaksa entry.
- Ditemukan API failure ditelan menjadi kandidat kosong, truncation sebelum enrichment, dan fallback smart-wallet tambahan di orchestration yang tertinggal dari patch sebelumnya. Diperbaiki: error diteruskan, pemilihan top-N setelah enrichment seluruh halaman (maksimal 50), fallback bypass dihapus, laporan kosong memuat hitungan tahap.
- `scripts/screening-funnel.js` mengukur filter kumulatif read-only; output diagnostik tidak boleh menjadi kandidat transaksi. Runner yang sudah aktif tetap memakai modul lama sampai proses berikutnya; tidak direstart agar batas 10 siklus tidak terulang.

## Audit jadwal 2026-09-24

- Bug terkonfirmasi: cron `*/45` berjalan menit 00/45 (jeda 45/15 menit), bukan setiap 45 menit. Screening/management/health kini memakai timer elapsed-time dengan pencegahan overlap; health mengikuti `healthCheckIntervalMin`. Briefing harian tetap cron UTC.
- Runner 10 siklus memakai timer sama untuk proses baru. Runner yang sedang aktif tidak direstart atau diulang; sinkronisasi file tidak mengubah timer dalam proses lama.
- Angka default 45m screening, 15m management, 60m health belum terbukti optimal. Window discovery 5m dengan scan 45m melewatkan banyak aktivitas. Profil umur 12–72h, bin step 80–125 dan batas kapitalisasi/TVL membatasi pencarian token muda. Prioritas evaluasi berikutnya: scan dry-run lebih sering (misalnya 5–10m) dengan anggaran API/LLM tercatat, bandingkan metrik window lebih panjang dan profil pasangan mapan; angka ini hipotesis uji, bukan konfigurasi live yang disetujui.
- Poller PnL 30 detik bukan jaminan exit 30 detik: berhenti sementara saat screening/management sibuk dan memiliki cooldown pemicu management. Batas kerugian $20 belum otomatis. Jadwal yang benar tidak menyelesaikan risiko ini.
