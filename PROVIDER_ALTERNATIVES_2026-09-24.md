# Alternatif provider risiko token — 2026-09-24

## Temuan

| Provider | Data yang relevan | Akses dan batas | Keputusan |
|---|---|---|---|
| Solana Tracker Data API | `/tokens/{mint}` memuat `risk.insiders.totalPercentage`, `risk.top10`, `risk.dev.percentage`, `risk.rugged`, dan kadang `risk.bundlers.totalPercentage`; endpoint bundler terpisah bila field itu absen | API key pribadi; Free 2.500 request/bulan, 3 req/detik menurut halaman harga saat ditinjau | Kandidat utama untuk mengganti enrichment GMGN setelah key tersedia dan schema live diverifikasi. Insider holding **bukan** metrik GMGN rat-trader; jangan diam-diam samakan. |
| Birdeye Holder Profile | Persentase suplai yang dimiliki tag bundler, sniper, insider, dev; top-wallet concentration | API key; kelayakan endpoint per tier perlu diverifikasi. Birdeye menyebut data bundler akurat untuk token dibuat sejak 1 Maret 2026 | Kandidat kedua untuk perbandingan lintas provider. Tidak menyediakan status wash/rugpull yang terbukti setara dari endpoint ini. |
| OKX Advanced Info | `bundleHoldingPercent`, `suspiciousHoldingPercent`, `devHoldingPercent`, `top10HoldPercent`, `riskControlLevel` | Endpoint yang sudah dipakai Sunstrike mengembalikan HTTP 402 pada probe VPS tanpa auth pada 24 September; credential OKX tidak ada | Tidak dapat diandalkan sebagai satu-satunya fallback saat ini. |
| RugCheck | Authority, holder, dan risk report | Endpoint gratis sudah terintegrasi | Pelengkap, bukan pengganti insider/bundler. |

## Implikasi untuk Sunstrike

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
