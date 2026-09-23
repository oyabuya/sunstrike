# Evaluasi strategi Sunstrike — 24 September 2026

## Keputusan

Baseline uji: Spot dengan screening ketat, exit mekanis tanpa kewajiban menunggu balik modal, dan evaluasi PnL bersih. Belum ada strategi yang terbukti optimal untuk wallet ini. Live tetap terkunci. Patch ini bukan implementasi circuit breaker portofolio $20.

## Diagnosis lokal

Audit April: 24 catatan dengan modal awal nonzero mencatat −$5,33; rata-rata menang +$0,28, kalah −$1,60. Angka belum direkonsiliasi on-chain. Fee tinggi dan win rate tidak menutup ekor kerugian. Prompt memerintahkan hold sampai −80% dan menolak exit low-yield saat rugi. Screening diam-diam memperlonggar umur/volatilitas dan batas top-10 dari 30% ke 45%. Rentang bin memakai jarak linear sehingga menampilkan downside di atas 100%.

## Riset primer dan meta

Sumber diakses 24 September 2026; tanggal akses tidak berarti seluruh data adalah data September.

- [Meteora Dynamic Terminal, dokumentasi resmi](https://raw.githubusercontent.com/MeteoraAg/docs/main/user-guides/how-to-use-dlmm/dynamic-terminal.mdx): Spot merata; Curve terkonsentrasi di tengah; Bid-Ask di tepi. Rentang sempit meningkatkan konsentrasi sekaligus risiko keluar rentang. Fee hanya saat likuiditas aktif. Rent posisi dapat kembali, bin array baru tidak. Ini mekanisme, bukan bukti profit.
- [Laporan resmi Q1 2026](https://ir.meteora.ag/assets/Meteora_Q1_2026_Token_Holder_Report.pdf): volume protokol $19,5 miliar, turun 36% QoQ; fee $105,9 juta, turun 51%. DLMM 87% volume tetapi fee DLMM turun 63,2%. DBC volume naik 194%. Data ini menunjukkan aktivitas launchpad dan fee yang berubah antarrezim, bukan jaminan launchpad menguntungkan LP kecil. Angka berasal dari teks laporan yang terindeks; PDF penuh tidak berhasil dimuat alat web.
- [Pengumuman resmi 7 Agustus 2026](https://proposals.meteora.ag/t/lp-stimulus-season-2-rewarding-our-expert-contributors/3375): stimulus LP memasuki bagian penutup; arah pertumbuhan menuju Referral Staking dan Meteora Campaigns. Jangan membangun expected return dari asumsi airdrop berikutnya.
- [DLMM Data API resmi](https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/api-reference/overview.mdx): host produksi dlmm.datapi.meteora.ag. Migrasi endpoint memerlukan validasi schema tersendiri.

Meta yang dapat dibuktikan: alat LP makin terintegrasi, strategi disesuaikan volatilitas, aktivitas launchpad dan program insentif berubah. Tidak tersedia snapshot pool live terverifikasi dalam riset ini; tidak ada klaim token/pool paling trending hari ini. Peringkat APR atau testimoni bukan pembanding PnL bersih.

## Pilihan untuk modal $100

| Kandidat strategi | Potensi | Risiko / keputusan |
|---|---|---|
| Stable/stable, Curve | Eksposur harga relatif lebih kecil | Depeg, fee kecil dan biaya tetap; perlu jalur quote stable yang diaudit, belum didukung aman oleh asumsi SOL executor |
| SOL/stable, Spot | Likuiditas mapan, strategi mudah dievaluasi | Tetap directional SOL; benchmark berikutnya, bukan langsung live |
| Token spekulatif/SOL, Spot | Fee saat aktivitas tinggi | Keruntuhan token, IL dan konsentrasi; baseline kode saat ini hanya untuk dry run ketat |
| Bid-Ask satu sisi | Akuisisi/penjualan bertahap | Tetap membeli aset yang jatuh; bukan stop loss atau lindung nilai otomatis |

Inferensi: untuk tujuan risiko lebih rendah, bandingkan pasangan mapan dahulu sebelum memperluas memecoin. Tidak mengganti Spot menjadi Bid-Ask secara membabi buta. Anggaran kecil membuat rent dan churn dominan; no-entry layak bila biaya tidak tertutup.

## Patch yang diterapkan

1. Hapus discovery fallback relaxed/top-up dan smart-wallet fallback yang tidak membawa metrik lengkap. Filter ketat tetap berlaku walau tidak ada kandidat.
2. Batas dev, top-10, insider dan bundler mengikuti batas pemilik yang lebih ketat.
3. Koreksi jarak harga geometris dan jumlah bin inklusif. Lebar rentang lama belum dioptimasi; downside_buffer_pct adalah jarak harga, bukan batas kerugian.
4. Manager mengikuti CLOSE mekanis tanpa veto umur, warna candle atau PnL negatif. Low-yield exit tetap menunggu umur minimum konfigurasi, tetapi tidak menunggu untung.

## Validasi dan pekerjaan sebelum live

Syntax check file berubah dan suite strategy-policy, restart-safety, jev-shadow. Tidak melakukan transaksi atau mengklaim peningkatan return hasil backtest.

Batas −80%, empat jam, sizing SOL lama, data PnL yang mencurigakan dan dependensi LLM untuk eksekusi exit masih perlu evaluasi. Jangan menyebut patch ini pembatas kerugian $20. Sebelum live: rekonsiliasi wallet+LP USD, circuit breaker tahan restart, quote biaya aktual dan sizing USD, lalu paper comparison dengan kandidat bertimestamp. Bandingkan baseline/cash/SOL hold pada horizon sama; ukur net PnL, drawdown, biaya, inventory, waktu dalam rentang dan kegagalan data. Pisahkan benchmark pasangan mapan dari memecoin dan lakukan evaluasi periode berikutnya tanpa tuning ulang. Hanya hasil tersebut dapat membuktikan perbaikan risk/reward.
