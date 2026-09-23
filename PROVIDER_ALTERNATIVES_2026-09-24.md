# Alternatif provider risiko token — 2026-09-24

## Temuan

| Provider | Data yang relevan | Akses dan batas | Keputusan |
|---|---|---|---|
| Solana Tracker Data API | `/tokens/{mint}` memuat `risk.insiders.totalPercentage`, `risk.top10`, `risk.dev.percentage`, `risk.rugged`, dan kadang `risk.bundlers.totalPercentage`; endpoint bundler terpisah bila field itu absen | API key pribadi; Free 2.500 request/bulan, 3 req/detik menurut halaman harga saat ditinjau | Kandidat utama untuk mengganti enrichment GMGN setelah key tersedia dan schema live diverifikasi. Insider holding **bukan** metrik GMGN rat-trader; jangan diam-diam samakan. |
| Birdeye Holder Profile | Persentase suplai yang dimiliki tag bundler, sniper, insider, dev; top-wallet concentration | API key; kelayakan endpoint per tier perlu diverifikasi. Birdeye menyebut data bundler akurat untuk token dibuat sejak 1 Maret 2026 | Kandidat kedua untuk perbandingan lintas provider. Tidak menyediakan status wash/rugpull yang terbukti setara dari endpoint ini. |
| OKX Advanced Info | `bundleHoldingPercent`, `suspiciousHoldingPercent`, `devHoldingPercent`, `top10HoldPercent`, `riskControlLevel` | Endpoint yang sudah dipakai Sunstrike mengembalikan HTTP 402 pada probe VPS tanpa auth pada 24 September; credential OKX tidak ada | Tidak dapat diandalkan sebagai satu-satunya fallback saat ini. |
| RugCheck | Authority, holder, dan risk report | Endpoint gratis sudah terintegrasi | Pelengkap, bukan pengganti insider/bundler. |

## API dan tool komunitas

| Provider | Kecocokan untuk Sunstrike | Batas yang perlu diuji |
|---|---|---|
| LP Agent | Sudah dipakai untuk posisi LP, riwayat LP, dan penemuan wallet; API mendokumentasikan pool/posisi Meteora dan RPC. | Tidak ada endpoint risiko token setara GMGN rat-trader atau OKX wash/rugpull. `top-lpers` butuh Premium/Enterprise; `LPAGENT_API_KEY` belum ada di VPS pada pemeriksaan terakhir. |
| Cabal-Hunter | REST `/api/scan-cabal`, `/api/cohorts`, `/api/trade-analysis` (wash-trading score), batch, MCP, dan bot Telegram. Paling menarik untuk mengisi celah wash/koordinasi. | 5 scan/bulan anonim atau 250/bulan dengan free key; trace bisa kedaluwarsa hingga 8 jam. `LOW_SIGNAL` dan skor wash bukan boolean OKX yang setara; schema/coverage respons live harus divalidasi. |
| DeFade | REST analisis token, insider network, bundle, holder, dev, dan skor rug. | Key diperlukan; paket mulai $29/bulan, trial 7 hari melalui permintaan. Skor agregat bukan pengganti field hard gate. |
| MadeOnSol | SDK/API token risk, bundle cohort dan jejak sniper; klasifikasi wallet termasuk bundler/dumper pada tier PRO+. | Fokus data Pump.fun; token risk PRO/ULTRA dan cakupan Meteora baru perlu diuji. Tidak ada padanan rat-trader/wash yang terdokumentasi. |
| Meteora DLMM Data API | Sumber primer untuk pool, portofolio, posisi, PnL, dan riwayat; bisa mengurangi ketergantungan data LP pada LP Agent. | Tidak menyediakan analisis insider, wash trading, atau rat-trader token. |

Urutan uji baca-saja: Cabal-Hunter (cek contoh respons, umur data, dan wash score), lalu DeFade/MadeOnSol jika gap masih ada. Jangan memetakan `LOW_SIGNAL` ke “aman” atau skor wash ke `okxRisk.is_wash=false` tanpa validasi. Gate LIVE dan DRY_RUN tetap seperti sekarang.

Pada 24 September, `CABAL_HUNTER_API_KEY` operator terdeteksi di `.env` VPS. `GET /api/key-balance` mengembalikan HTTP 200, paket free aktif, `scans_per_month=250` dan `scans_remaining_this_period=250`. Angka 5 scan/bulan pada halaman produk adalah batas akses anonim tanpa key. Pemeriksaan saldo tidak memakai scan; belum ada token yang dipindai.

Probe berikutnya memakai mint contoh dari dokumentasi Cabal-Hunter: `/api/scan-cabal` dan `/api/trade-analysis` sama-sama HTTP 200. Respons scan `risk_level=HIGH`, `scan_complete=false`; wash `wash_score=0` tetapi `swaps_analyzed=0`. Kedua panggilan memakai dua jatah (248/250 tersisa). Skor nol dengan sampel nol tidak membuktikan bebas wash; sumber ini belum layak dipetakan ke boolean hard gate. Hentikan probe sampai ada desain cache/anggaran query dan token representatif untuk pembandingan.

## Implikasi untuk Sunstrike

**Pembaruan kebijakan:** setelah audit alur April, GMGN/OKX kembali menjadi enrichment opsional. Pernyataan di bawah ini menjelaskan gate ketat sebelum revisi; gate aktif kini mewajibkan audit Jupiter yang cocok dengan mint dan menolak sinyal buruk dari provider tambahan bila tersedia. Batas rugi portofolio tetap wajib.

`token-risk-policy.js` menolak metrik rat-trader, OKX rugpull/wash, dan level risiko bila tidak diketahui. Solana Tracker memberi insider concentration, bukan bukti perilaku rat-trader/insider extraction yang sama; tidak ada field wash trading langsung yang terverifikasi dalam dokumentasi token response. Maka adapter alternatif harus menyimpan sumber dan semantik setiap metrik secara eksplisit, tidak mengisi nilai hilang dengan nol, dan tetap memblokir entry sampai seluruh gate lama memiliki padanan terverifikasi atau pemilik menyetujui revisi kebijakan risiko berdasarkan bukti. Belum ada API key Solana Tracker/Birdeye/OKX di VPS; belum ada transaksi atau perubahan mode.

## Langkah berikutnya

1. Dapatkan API key Solana Tracker Free dan simpan hanya di `.env` VPS sebagai `SOLANA_TRACKER_API_KEY`.
2. Probe read-only beberapa token pasar untuk cakupan `insiders`, `bundlers`, `top10`, `dev`, umur data, status null dan rate limit. Periksa field bundler lewat endpoint khusus saat hilang dari token response.
3. Peta data ke preflight screening/executor dengan fail-closed dan bandingkan terhadap data OKX/RugCheck. Selesaikan gap wash dan rat-trader sebelum membuka LIVE.

## Sumber primer

- Solana Tracker token response: https://docs.solanatracker.io/data-api/tokens/get-token-information
- Solana Tracker bundler example: https://github.com/solanatracker/data-api-sdk/blob/main/examples/bundlers.ts
- Solana Tracker plans: https://www.solanatracker.io/data-api
- Birdeye holder profile announcement: https://birdeye.so/data-api/blog/detail/token-holder-profile-token-holder-positions-complete-holder-intelligence-on-solana
- OKX advanced info fields: https://web3.okx.com/es-es/onchainos/dev-docs/market/market-token-advanced-info
- LP Agent API: https://docs.lpagent.io/api-reference/introduction
- LP Agent paket: https://portal.lpagent.io/dashboard/
- Cabal-Hunter API dan batas: https://cabal-hunter.com/docs
- Cabal-Hunter OpenAPI: https://cabal-hunter.com/openapi.json
- DeFade API: https://api.defade.org/docs
- MadeOnSol SDK dan cakupan: https://github.com/MadeOnSol/madeonsol-sdk
- Meteora DLMM Data API: https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/api-reference/overview.mdx
