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
- Key OpenRouter belum ada di `.env` VPS pada pemeriksaan terakhir. Konfigurasi VPS memilih `openai/gpt-6-luna` untuk peran screening, management, dan general. Fallback kode untuk gangguan provider tertentu ialah `openai/gpt-4.1-mini`.
- `JEV_SHADOW_ENABLED=true` disiapkan di VPS, tetapi modul hanya memanggil Jev jika `OPENROUTER_API_KEY` tersedia dan `DRY_RUN=true`. Modul itu mencatat tiga skor (fee, momentum, risiko holder) untuk maksimal lima kandidat dan tidak mengubah input/keputusan Luna atau mengeksekusi transaksi.
- Patch Jev sudah disinkronkan ke VPS dan enam tes Jev/restart lulus di sana. Catatan Jev kini terhubung ke pilihan tool Luna melalui `cycle_id`, disertai model/biaya provider dan kegagalan yang disanitasi. Belum ada hasil LP aktual; nilai tambah Jev tetap harus diuji terhadap baseline.
- Setelah key dipasang pemilik, smoke test OpenRouter Luna tool call dan Jev Decisions API berhasil (HTTP 200); RPC, saldo Helius, dan pembacaan posisi juga berhasil (nol posisi). Telegram, Jupiter, LPAgent, dan GMGN belum dikonfigurasi. Perintah `cli.js screen` perlu hanya mengimpor fungsi screening tanpa menyalakan loop otomatis; patch entrypoint disiapkan untuk uji satu siklus.
- File `.env` lokal lama pernah berisi key dan mode live; mode lokal telah diubah ke dry run. **Jangan menyalin file/key/wallet lama ke VPS.** Key Jupiter yang sebelumnya tertanam di source harus dianggap terekspos dan diganti sebelum penggunaan live.

## Temuan yang sudah dibuktikan

- Riwayat lokal April 2026 berisi 28 catatan posisi tertutup. Empat bernilai awal nol; 24 sisanya mencatat 15 menang, 6 kalah, 3 datar, dan total PnL posisi **−$5,33**. Itu belum direkonsiliasi terhadap transaksi on-chain dan nilai wallet. Rata-rata menang +$0,28, rata-rata kalah −$1,60; kesenjangan besaran rugi adalah masalah utama.
- Jalur screening sudah memiliki hard filter dan skor deterministik `candidate_score` (`tools/screening.js`, `evilpanda-policy.js`). Pada pemeriksaan di Hetzner, endpoint Meteora merespons, tetapi kriteria ketat saat itu menghasilkan nol kandidat. Jangan melonggarkan filter hanya agar ada transaksi.
- Jev adalah model keputusan terstruktur untuk skor/kategori; skornya bukan probabilitas profit. Akurasi pada tugas klasifikasi umum belum membuktikan akurasi hasil LP. Shadow score perlu dipasangkan dengan hasil posisi untuk evaluasi.
- Pemeriksaan terakhir: lima tes Jev/restart lulus di VPS. Belum ada pengujian autentikasi API Luna/Jev, tool calling, wallet/RPC, Telegram, atau transaksi pada checkout baru.

## Batas aman yang berlaku

1. Pertahankan dry run sampai ada rekonsiliasi historis, circuit breaker kerugian portofolio $20 yang tahan restart, pemeriksaan data gagal secara aman, dan uji kering dengan key/market data nyata.
2. Sebelum live, gunakan wallet baru khusus bot; hitung nilai total wallet **dan** posisi LP pada timestamp yang sama. Catat biaya, rent, swap, sisa token, serta perubahan harga SOL. Tentukan eksposur maksimum per posisi dan cadangan SOL dari modal $100.
3. Model boleh mengusulkan tindakan; kode harus memverifikasi hard filter, ukuran posisi, status data, dan batas kerugian. Key pribadi dan live flags tetap di konfigurasi operator, bukan kendali model.
4. Jangan menjanjikan return atau menyebut win rate sebagai bukti profit. Bandingkan hasil bersih terhadap modal dan risiko, bukan sekadar fee LP.

## Pekerjaan berikutnya, berurutan

1. Rekonsiliasi semua signature deploy/claim/close/swap April dengan transaksi Solana final. Selidiki empat catatan bernilai awal nol dan perbedaan log; simpan artefak lama utuh.
2. Rancang serta uji batas modal $100 dan rugi total $20 pada nilai portofolio yang dapat diverifikasi, termasuk perilaku ketika RPC/price feed gagal dan saat posisi masih terbuka. Putuskan ukuran posisi/cadangan gas berdasarkan biaya aktual.
3. Setelah pemilik menaruh key **langsung di VPS** (`.env.example` sebagai panduan), verifikasi koneksi OpenRouter Luna/Jev, format laporan Telegram, RPC/Helius/Jupiter, data risiko, dan izin chat. Jangan tampilkan nilai key dalam log atau laporan.
4. Jalankan evaluasi dry run dengan kandidat bertimestamp: hard-filter result, skor deterministik, Jev score/confidence, pilihan Luna, alasan tidak entry, biaya prediksi, dan hasil pasar setelah horizon yang ditentukan. Ukur apakah Jev menambah kualitas keputusan dibanding baseline tanpa Jev.
5. Bahas live canary kecil hanya setelah langkah di atas memberi dasar yang dapat diperiksa. Aktifkan live dengan keputusan eksplisit pemilik, lalu cocokkan tiap transaksi dan wallet sebelum entry berikutnya.

## Petunjuk kerja

- Ubah kode kecil dan terarah; jalankan `node --check` pada file berubah, `node --test test/jev-shadow.test.js test/restart-safety.test.js`, lalu pemeriksaan spesifik sesuai risiko perubahan.
- Ikuti `AGENTS.md`: analisis → patch → verifikasi → commit → push; sinkronkan checkout VPS jika perubahan relevan. Periksa status git lokal/VPS sebelum mengubahnya.
- Gunakan `RESTART_AUDIT_2026-09-23.md` untuk rincian bukti dan alasan tiap pengaman; perbarui handoff ini bila keputusan, konfigurasi, atau status live berubah.
