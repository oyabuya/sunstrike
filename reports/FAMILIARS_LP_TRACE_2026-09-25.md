# Audit LP familiars — 25 September 2026

## Identitas dan sumber

- Mint: `2PENPmfgJfq6CG3k4byj4oWwHf8SerqakmYHMkUupump`.
- Pool LP aktual: `ET9QEc18XnEXNyz8ZuGkJfgSuDDqLDiA1U8bEpyuyLKC` (familiars/SOL, Meteora DLMM); wallet publik: `BtEgCnE2Vmj9YCXa4Nkhr6uaGW3HQ9jNLDM2FW2nRhu9`.
- Posisi dan PnL: Meteora Data API `GET https://dlmm.datapi.meteora.ag/positions/ET9QEc18XnEXNyz8ZuGkJfgSuDDqLDiA1U8bEpyuyLKC/pnl?user=BtEgCnE2Vmj9YCXa4Nkhr6uaGW3HQ9jNLDM2FW2nRhu9&status=closed&pageSize=100&page=1` (dibaca 25 September 2026). Waktu dan transaksi dicocokkan melalui Solana RPC wallet. Harga historis: GeckoTerminal OHLCV 5 menit pool yang sama, `currency=token` (harga SOL per familiars). Semua waktu di bawah UTC.

## Timeline posisi

| Posisi | Buka → tutup (UTC) | Deposit menurut Meteora | Fee | PnL Meteora |
| --- | --- | ---: | ---: | ---: |
| `H1U1nN…` | 24 Sep 20:20:49 → 20:23:53 | 0,24999996 SOL | 0,00007178 SOL | −0,00000990 SOL |
| `3aUrsh…` | 24 Sep 20:24:33 → 25 Sep 01:21:21 | 0,26271525 SOL ekuivalen | 0,01789887 SOL ekuivalen | −0,05935269 SOL |
| `9U8CFC…` | 25 Sep 01:21:50 → 04:03:24 | 0,18416030 SOL ekuivalen dalam token | 0,00003229 SOL ekuivalen | −0,07218783 SOL |

**Total PnL posisi Meteora: −0,13155043 SOL** (sekitar −$15,37 menurut valuasi API per posisi). Posisi ketiga mendaur ulang token hasil penutupan posisi kedua; jumlah deposit tabel bukan modal baru kumulatif. Nilai ini belum direkonsiliasi penuh dengan gas, rent, dan hasil swap akhir sebagai PnL bersih wallet.

Transaksi kunci: [buka posisi utama](https://explorer.solana.com/tx/462YMSVATsktRnyTc58XC8v6xPrnk2PGmonSGqg82Ep1hzBZtAtXChNxcubTr1zgEvwsPHtSEDLHzFK4bUMJawEB), [tutup posisi utama](https://explorer.solana.com/tx/QEXHBsxLzNFXc9ntx6pZsfjiEv93Ept7aSjGwCMBCLPmDLCofkuQ6ptKyqY2TfGSFxte4CjvD1q8cBHjxc9obkw), [buka ulang dengan token](https://explorer.solana.com/tx/5z3mm8qV8FHjr3yBidWNE88uuYJj7EogB3zEv7AkhqrLEJbLRFXBjeUKNJ5aAa6eLK81a7pvmo267sVPTBgLMVDh), [tutup terakhir](https://explorer.solana.com/tx/55Tyo2xbXa9CenNx5aA69NtaHeFME4c2ZLCLbFzFf2jyRmoss59nRxNFdMoN1eeTrdZCX2AGBe1LN35x54xvHPTa), [swap sekitar 13.824,71 token ke SOL](https://explorer.solana.com/tx/3f3Quo46kStiRGfGz7r6GJZPbNoXRihhBpeNLE51kvBYvKTZNHhCAf9wWJLdRyusiPNCHVeEjvKUFKPVrRTmFNBX).

## Pergerakan harga dan sinyal

- Candle 5 menit 24 Sep 20:20 ditutup sekitar 0,000028626 SOL/token. Pada 20:25 turun ke 0,000025295 (−11,6% dari candle tadi); 21:00 ke 0,000015194 (−46,9%); 25 Sep 04:00 ke 0,000006466 (−77,4%). Candle bukan harga eksekusi wallet dan pembukaan 20:24 terjadi sebelum candle 20:20 selesai.
- Catatan screening VPS terakhir sebelum posisi utama, 24 Sep 20:09 UTC: Jupiter Organic Score 87,66, perubahan harga 1j −6,54%, mint/freeze disabled, top holders 15,06%, bot holders 12,95%. Skor persis saat transaksi 20:24 dan pembukaan ulang 01:21 tidak tersimpan. Pembacaan 25 Sep sekitar 04:15 menunjukkan skor 75 dan harga 1j −25,05%.
- Bukti terkuat yang tersedia adalah penurunan harga tajam dan pembukaan ulang saat harga sudah jatuh. Ini konsisten dengan tekanan jual/distribusi. Belum ada atribusi wallet developer/insider atau bukti penarikan likuiditas yang cukup untuk menyebut *soft rug* sebagai fakta.
- GeckoTerminal menandai `7FuxBTHEAwNa6nQs3qpwyGxv7k3RS2ynZY2WnaDvmBrk` sebagai alamat developer. Pada 24 Sep 20:55:54 UTC alamat ini [menerima 245,7463 SOL](https://explorer.solana.com/tx/3QUbJe18UDrQscDYYP7jiQPFEfwoDEfu3hKuGAdYbzUwBt8U8WJJFLu4SYa4yMDVxmrXfg8XPx1U561EVSkj18ry) melalui instruksi `CollectCoinCreatorFee` Pump AMM; [200 SOL](https://explorer.solana.com/tx/3tNFumJhoxFNM88F9md5BxXdUTY9Zv4oKV2s9TuYiz2GykmqgwimkAoh9dNjAjvP44ZSYPxz2FmriN8gjR8feKun) dan [35 SOL](https://explorer.solana.com/tx/5J2Pau2R3GwNWpv38mDk8JmumKymLC4Tg4hFyetaPttow2bFkj1Ld4nqigx5x8vHmHycxLRYLk6f5rtuBCMjPDgs) lalu dipindah ke alamat lain. [Dokumentasi Pump](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COLLECT_CREATOR_FEE.md) menjelaskan instruksi itu mencairkan fee creator yang sudah terkumpul; transaksi ini **bukan bukti developer menjual token atau menarik likuiditas**. Sebelas transaksi langsung alamat developer selama periode yang diperiksa tidak menunjukkan penurunan saldo familiars, tetapi itu tidak menyingkirkan aktivitas wallet terkait yang belum teridentifikasi.
- Pool dibuat 23 Sep 23:41 UTC menurut GeckoTerminal, sehingga pool berumur sekitar 20 jam 39 menit pada pembukaan pertama. Umur token tersendiri tidak disimpulkan dari umur pool.

## Implikasi kebijakan Sunstrike

- Gate Jupiter ≥80 yang ada tidak akan menolak snapshot 20:09 (87,66). Skor adalah ukuran aktivitas organik relatif, bukan jaminan keamanan; perubahan cepat memerlukan pemantauan tersendiri.
- Simulasi kasar memakai **harga penutupan candle 20:20**, bukan harga eksekusi LP: aturan dua candle 5 menit berturut-turut ≥20% di bawah acuan akan memberi sinyal pada 20:35 UTC (candle 20:30 −20,4%; 20:35 −21,8%), sekitar 11 menit setelah posisi kedua dibuka. Ini belum memperhitungkan latensi API, waktu transaksi, slippage, fee, atau nilai LP saat itu; tidak boleh ditafsirkan sebagai PnL hipotetis.
- Kandidat mitigasi untuk diuji: pemutus darurat berbasis drawdown harga dari entry yang terkonfirmasi dua kali, berlaku juga saat LP masih in-range; hentikan entry ulang mint yang sama setelah pemutus darurat. Skor Jupiter turun di bawah 80 menjadi sinyal tambahan, bukan syarat wajib, karena pembacaan 75 yang tersimpan baru muncul sesudah penurunan besar.
- Implementasi observasi: `emergency-exit-shadow.js` membaca bin aktif awal dan terkini dari posisi yang dibuka Sunstrike. Penurunan harga terhitung ≥20% selama lima menit menghasilkan satu event `emergency_exit_shadow` dengan `executed=false` dan peringatan Telegram ke chat operator yang terkonfigurasi. Pengiriman gagal dicoba lagi paling cepat lima menit kemudian. Belum ada auto-close maupun cooldown. Posisi manual tanpa data entry bot tidak bisa dinilai oleh monitor ini.
- Percobaan exit cepat perlu diuji sebagai *shadow rule* terhadap sampel posisi lain sebelum mengubah aturan pemilik untuk hold in-range dan tinjauan OOR bawah setelah empat jam. Stop loss PnL LP persentase tunggal belum terkalibrasi dan bisa berbeda dari drawdown harga token; tidak ada perubahan auto-close atau hard gate dari audit ini.
- Untuk membuktikan penyebab dan PnL bersih, langkah lanjutan adalah atribusi swap besar/wallet terkait serta rekonsiliasi SOL, token, fee, rent, dan swap semua transaksi terkait. Tidak perlu private key.
