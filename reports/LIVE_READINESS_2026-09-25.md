# Audit persiapan LIVE — 25 September 2026

## Keputusan operasional

**Status terbaru 18:56 WIB:** patch `eb32ef7` telah di-push/deploy, service
active setelah restart Sunstrike saja. Readiness 11:56:13 UTC lolos tanpa
blocker: 0,776869 SOL, nol LP, equity $94,26. Mode tetap DRY_RUN. Pemilik
dapat mengaktifkan `/live` dengan pemeriksaan ulang; tidak ada transaksi
dilakukan dalam audit. Perubahan wallet sejak snapshot awal bukan hasil
eksekusi sesi ini dan belum direkonsiliasi sebagai laba/rugi.
Validasi: 25 file suite lokal serta 13 tes terarah VPS lulus.

Snapshot VPS 07:00 UTC / 14:00 WIB: konfigurasi LIVE lolos, service aktif dalam
DRY_RUN. Saldo cair 0,535582 SOL ($62,15), satu posisi COLLECT/SOL OOR bernilai
$23,2451 + fee $0,0043; equity $85,3994. Ledger mengizinkan snapshot, tetapi
saldo belum mencapai `minSolToOpen=0.55`: kurang 0,014418 SOL pada saat probe.
Angka berubah mengikuti transaksi dan pasar. Tidak ada transaksi dalam audit ini.
Probe 07:03 UTC menemukan COLLECT kembali dalam range: bin aktif -431,
batas -499 sampai -430, waktu OOR nol. Status OOR 07:00 bukan alasan close
yang boleh dipakai tanpa pembacaan baru.

## Entry: single-side, bukan double-side

- Executor mengizinkan Spot, SOL sebagai token Y, `amount_y=0.2`, `amount_x=0`.
  Tidak ada swap awal 50:50. Token X tidak dibeli sebelum deposit.
- SDK 1.9.4 mendistribusikan Y pada sisi bid hingga bin aktif; sisi X di atasnya
  bernilai nol. Harga turun mengubah SOL menjadi token X; kenaikan harga dapat
  meninggalkan likuiditas yang terisi meskipun masih di dalam batas akun posisi.
  Karena itu status `in_range` bukan bukti fee sedang bertambah.
- Rencana kandidat memakai `computeEvilPandaDeployPlan`, bukan sekadar default
  80 bawah / 15 atas. Contoh volatilitas 2: bin step 50/100/150 menghasilkan
  288/144/96 bin bawah + 10 atas, jarak harga bawah sekitar 76%.
  Rentang ini bukan stop loss dan belum dibuktikan optimal bagi modal $100.
- Sebelum entry: snapshot posisi/wallet, batas dua posisi, tanpa duplikasi mint,
  audit Jupiter, umur ≥12 jam, Organic Score ≥80, aktivitas LIVE 5m+1h,
  batas eksposur USD dan reserve. Data wajib yang hilang memblokir entry.
- Uji aktivitas 1h yang lebih longgar hanya DRY_RUN; simulasi tersebut tidak
  membuktikan kandidat akan lolos preflight LIVE.

## Exit dan risiko strategi

- Monitor dijadwalkan 30 detik, tetapi dilewati saat screening/management sibuk;
  audit token dicache hingga lima menit. Ini bukan jaminan exit dalam 30 detik.
- Rug tegas atau harga di atas batas akun posisi memicu close deterministik.
  OOR bawah baru ditinjau setelah empat jam dengan bukti token/volume/fee.
- Hold in-range sesuai instruksi pemilik; tidak ada stop loss persentase,
  breaker rugi $20, atau jeda otomatis dua rugi. Modal dapat habis.
- Drawdown ≥20% selama ≥5 menit hanya shadow/alert untuk posisi bot dengan
  data entry. Ini tidak melindungi posisi manual dan tidak auto-close.
- Close mengklaim fee, menarik likuiditas, menutup akun, lalu mencoba swap
  token kembali ke SOL kecuali diminta hold. Pool rug dapat kehilangan rute
  swap; keberhasilan withdrawal bukan keberhasilan konversi ke SOL.
- Double-side memerlukan pembelian token di awal dan mengubah exposure serta
  biaya. Tidak diaktifkan melalui audit ini. Profit strategi belum terbukti;
  evaluasi harus memakai PnL bersih termasuk inventory, swap, gas dan rent.

## Pemeriksaan ulang operator

Jalankan `node scripts/live-readiness.js` pada VPS. Skrip membaca wallet dan LP,
memperbarui snapshot ledger risiko, mencetak blocker, lalu exit 1 bila entry
belum siap. Tidak beralih mode atau mengirim transaksi. Setelah blocker selesai,
`/live` di Telegram menjalankan gate segar; `/mode` memastikan mode aktual.
Restart tetap mengikuti `.env` operator, saat audit `DRY_RUN=true`.

## Perbaikan hasil audit

- BinArray RPC gagal atau snapshot tidak lengkap kini memblokir deposit;
  tidak melanjutkan dengan biaya rent yang belum diketahui.
- Jumlah bin dihitung inklusif. Slippage deposit standar diperbaiki dari
  `1000` ke `10` persen sesuai SDK, sama dengan jalur range lebar.
- Ukuran 0,2 SOL dikunci pada readiness/preflight; orientasi token Y SOL
  dicek kembali dari pool SDK sebelum deposit.
- Close tidak menganggap pembacaan likuiditas gagal sebagai posisi kosong.
  Keberhasilan close diverifikasi dari ketiadaan akun posisi on-chain.
- Swap baru dilaporkan sukses bila hasil terkonfirmasi dan memiliki signature.
  Valuasi USD yang hilang tidak dianggap dust; kegagalan konversi diberi alert.
- Deskripsi tool close diselaraskan dengan kebijakan empat jam dan rug tegas;
  log saldo kurang kini menyebut posisi tetap 0,2 SOL beserta reserve.
- Antrean transaksi executor sudah ada sebelum audit dan dipertahankan.

Sisa risiko: deposit range lebar terdiri dari beberapa transaksi sehingga
kegagalan parsial perlu rekonsiliasi; swap pascaclose belum mempunyai antrean
retry tahan restart. Pada hasil eksekusi yang ambigu, periksa saldo/signature
sebelum mengulang. Alert tidak menjamin konversi berhasil. Tidak ada pengujian
transaksi LIVE dalam sesi audit ini.

## Sumber mekanisme

Kode terpasang `@meteora-ag/dlmm` 1.9.4: `toAmountsBothSideByStrategy` dan
builder deposit menghitung token sisi bid/ask serta slippage dalam persen.
Referensi primer: [contoh SDK Meteora](https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/typescript-sdk/examples.mdx)
dan [referensi SDK](https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/typescript-sdk/reference.mdx).
Implementasi lokal yang dipin menjadi dasar audit, bukan asumsi versi terbaru.
Status sukses eksekusi swap mengacu pada [kontrak respons Jupiter](https://github.com/jup-ag/docs/blob/main/swap/order-and-execute.mdx).
