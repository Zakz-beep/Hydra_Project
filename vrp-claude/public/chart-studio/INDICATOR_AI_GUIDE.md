# Chart Studio — Panduan AI untuk Indikator Python

SDK contract v1 · diperiksa 2026-09-06. Berlaku untuk Codex, Antigravity, Claude Code, Cursor, dan AI lain yang menerima file Markdown. Dokumen ini mandiri; lampirkan seluruh file bersama permintaan indikator. Tidak membutuhkan plugin AI tertentu.

## Cara pakai

1. Unduh file ini lewat **Python Studio → AI guide .md**, lalu lampirkan ke AI pilihanmu. Agen yang bekerja di repo harus membaca file ini terlebih dahulu.
2. Jelaskan rumus/ide, sumber data, timeframe, parameter, serta tampilan yang diinginkan.
3. Minta satu file `.py` dengan fungsi `calculate(ctx)`. Paste ke editor atau **Import Python script**, lalu **Run**.
4. Ubah parameter di panel Studies. Simpan workspace agar source dan parameter tersimpan di browser; ekspor JSON untuk backup.

Contoh prompt siap salin:

> Baca INDICATOR_AI_GUIDE.md ini. Buat indikator Python untuk Chart Studio: [ide/rumus]. Data utama: [Hyperliquid xyz:TSLA / Yahoo TSLA], timeframe [1h]. Parameter: [daftar]. Tampilan: [overlay harga / pane terpisah / marker]. Gunakan hanya SDK yang terdokumentasi; jangan invent API. Berikan file .py siap import, jelaskan warmup dan data yang diperlukan, lalu uji perhitungan pada data kecil yang diketahui. Jika data yang diperlukan belum tersedia, jelaskan batasan dan jangan membuat data palsu.

Untuk Codex/Antigravity di repo: sebut path `vrp-claude/public/chart-studio/INDICATOR_AI_GUIDE.md` dalam prompt. Untuk AI tanpa akses repo: unggah file ini. Tidak semua tool otomatis membaca nama rules yang sama, jadi pastikan dokumen masuk konteksnya.

## Instruksi bagi AI penulis indikator

- Hasil utama adalah Python valid, bukan JavaScript, Pine Script, aplikasi Streamlit, notebook, atau JSON chart. Definisikan `def calculate(ctx):`; engine memanggilnya. Jangan panggil fungsi itu sendiri atau pasang `if __name__ == '__main__'` untuk menjalankan indikator.
- Indikator menghitung ulang snapshot secara vectorized. Tidak ada callback `on_tick`, state strategi persisten, order broker, atau backtest engine di SDK.
- Gunakan `pandas` dan `numpy` untuk kalkulasi, `ctx.plot` untuk output. Minimal satu output harus dibuat, termasuk ketika data belum cukup: seri NaN untuk warmup sah.
- Pertahankan UTC DatetimeIndex; cek pembagi nol, NaN, data pendek/konstan, dan input parameter. Hindari loop per bar jika operasi pandas/NumPy cukup.
- Jangan menggunakan data masa depan: hindari `shift(-1)`, `rolling(center=True)`, `bfill`, atau normalisasi historis dengan statistik seluruh sampel. Level breakout biasanya memakai rolling high yang digeser `shift(1)`.
- Jangan menyamakan volume candle dengan CVD, order flow, atau volume buy/sell. Jangan membuat seri OI/funding historis dari satu snapshot terbaru.
- Jangan mengunduh data, membaca credential/file pengguna, menjalankan shell, atau menambahkan dependency aplikasi untuk membuat indikator. Data masuk lewat context. Runtime worker bukan sandbox keamanan untuk kode asing; jangan menyisipkan akses browser/network.
- Jika bekerja di repo, simpan indikator baru di `indicators/custom/<nama_snake_case>.py` (buat folder jika belum ada), tanpa mengubah SDK/engine kecuali diminta. UI Import menerima file dari folder mana pun.
- Laporkan pengujian yang benar-benar dilakukan. Jangan mengklaim profitabilitas atau hasil backtest tanpa pengujian strategi yang sesuai.

## Runtime dan lifecycle

Python berjalan di Web Worker browser via Pyodide 0.27.7 (Python 3.12). NumPy, pandas tersedia sebagai `np`, `pd` di namespace indikator; explicit imports keduanya juga boleh. SciPy tersedia dalam runtime lokal dan dimuat jika di-import. Library native desktop seperti TensorFlow/PyTorch dan package yang membutuhkan OS/subprocess tidak disediakan. Tidak perlu `pip install` atau `loadPyodide` di script.

Run manual dapat menyertakan candle terakhir yang masih bergerak. Auto-run bar-close mengecualikan candle terakhir pada mode live. Replay memasok history hanya sampai cursor; candle historis yang terlihat merupakan OHLC final, bukan replay setiap tick. Perubahan symbol/timeframe membatalkan hasil konteks lama. Stop menghentikan worker; Run berikutnya memuat ulang Python.

Batas: 100 KB per script; 32 output per indikator; gunakan maksimal empat pane tambahan; 20.000 titik per output; output total 16 MB. Startup dibatasi 120 detik, eksekusi setelah runtime siap 30 detik. Jangan mencetak seluruh dataset; log dipotong.

## Data dan context

| Akses | Isi |
| --- | --- |
| `ctx.data.ohlcv()` atau `ctx.data.ohlcv("chart")` | Copy DataFrame utama, kolom `time, open, high, low, close, volume` |
| Index DataFrame | pandas DatetimeIndex UTC, terurut; `time` tetap epoch **detik**, bukan milidetik |
| `ctx.data.ohlcv("compare")` | Dataset tambahan yang dipilih di panel Data; error bila belum ditambahkan |
| `ctx.symbol` | Simbol kontrak yang sebenarnya, misalnya `BTC`, `xyz:TSLA`, atau `SPY` |
| `ctx.timeframe` | `1m`, `5m`, `15m`, `1h`, `4h`, atau `1d` |
| `ctx.market` | Dictionary snapshot Hyperliquid terbaru; bisa kosong (Yahoo, replay, atau sebelum update datang) |

`ctx.market` dapat berisi `markPrice`, `oraclePrice`, `openInterest`, `funding`, `volume24h`, `asOf`. `asOf` adalah epoch **milidetik**. Funding adalah rate provider, bukan angka persen tahunan. Jangan annualize tanpa menentukan konvensi periodenya. OI mengikuti unit kontrak provider; volume24h adalah notional. Snapshot tidak menyediakan history, depth, trades, atau Greeks. Gunakan `.get()` dan tangani dictionary kosong secara eksplisit.

UI sekarang memiliki panel **Order flow** (tape, CVD, depth) dan **Volume profile**. Feed transaksi/order book panel itu belum menjadi dataset Python SDK. Jangan invent `ctx.data.trades()`, `ctx.orderbook`, atau menganggap `ctx.data.ohlcv()` mengandung agresor buy/sell. Profile dari candle adalah estimasi distribusi volume; profile transaksi hanya mencakup fill yang tertangkap. Riwayat order flow belum disimpan permanen.

Compare memakai timestamp ketersediaan: chart workspace menggeser waktu bar tambahan sebesar durasi interval dan membatasi data sampai waktu run/replay. Align as-of dengan `other.close.reindex(bars.index, method="ffill")`; jangan bfill sebelum observasi pertama. Feed dapat terlambat atau stale; forward fill melewati libur/session gap harus dipertimbangkan sesuai analisis. Sesuaikan toleransi jika dibutuhkan.

Yahoo berisi OHLC sesi reguler, dapat terlambat, dan saat ini raw OHLC (bukan seri total return/dividend-adjusted). Interval 4h dibentuk dari 1h dalam sesi lokal. Hyperliquid berisi candle perpetual dan volume base asset. Saham perpetual `xyz:TSLA` tidak identik dengan saham Yahoo `TSLA`; sesi, basis, volume, dan harga bisa berbeda.

Pencarian menerima alias seperti `TSLAUSDT.P`, tetapi memilih kontrak canonical dari katalog live. Alias tidak mengubah denominasi: perhatikan venue dan collateral yang ditampilkan. Jangan menulis `TSLAUSDT.P` sebagai coin API atau menghapus prefix `xyz:`.

## The Greeks — custom indicator dengan data opsi

Aktifkan **The Greeks**, isi **Options source** (misalnya SPY, QQQ, TSLA), pilih **Use … Yahoo chart**, lalu **Add complete indicator → Run**. Kode tersedia di Python Studio; parameter muncul di Studies setelah Run pertama. Download `.py`, edit, atau import kembali. Source ticker dan script disimpan dalam workspace. Run mengambil data melalui backend Greeks port 8001 (cache engine berlaku); indikator tidak diperbarui otomatis setiap tick.

Tiga template bawaan yang dapat diedit:

- `indicators/the_greeks_complete.py`: current gamma flip, call/put GEX walls, aggregate max pain, IV expected move; history GEX/Vanna/Charm serta Delta/Vega Z-score; ringkasan OI, volume, PCR, exposure per expiry dan unusual chain activity di console.
- `indicators/options_activity_levels.py`: strike dengan volume/OI dan mid-price premium proxy terbesar, dengan filter dan jumlah level yang dapat diubah.
- `indicators/greeks_regime_history.py`: history net/gross GEX, rasio net/gross dan marker perubahan regime.

Path di atas relatif terhadap direktori `/chart-studio/` yang juga berisi panduan ini. Jangan mengubah file SDK untuk membuat indikator pengguna. Buat salinan `.py` dari template, atau tulis `calculate(ctx)` sendiri.

| API | Hasil |
| --- | --- |
| `ctx.greeks.meta` | dict ticker, source, observed_at, snapshot_time, contract_size, risk_free_rate, cutoff, replay, scope dan warnings |
| `ctx.greeks.snapshot(allow_synthetic=False)` | dict snapshot sekarang; by_expiry berisi metadata bucket tanpa duplikasi strikes |
| `ctx.greeks.chain(allow_synthetic=False)` | DataFrame satu baris per expiry / option_type / strike |
| `ctx.greeks.history(allow_synthetic=False)` | DataFrame aggregate snapshot dengan UTC DatetimeIndex, urut dan unik |
| `ctx.greeks.oi_changes(allow_synthetic=False)` | DataFrame perubahan OI dari arsip parsial top-GEX; boleh kosong |

Jika data input belum diaktifkan, method memberi error. Snapshot/chain secara default menolak sumber mixed/synthetic. History default hanya memakai baris `data_source == "live"`. `allow_synthetic=True` hanya untuk eksperimen yang dilabeli jelas, bukan solusi untuk data pasar yang gagal. Source `live` berarti data provider, bukan jaminan real-time; periksa timestamp dan keterlambatan sumber.

Kolom chain: `bucket`, `expiry`, `dte`, `option_type` (`call`/`put`), `strike`, `oi`, `volume`, `mid_price`, `iv`, `delta`, `gamma`, `theta`, `vega`, `rho`, `vanna`, `charm`, `gex_spotgamma`, `gex_raw`, `vanna_exp`, `charm_exp`, `delta_exp`, `vega_exp`. IV adalah desimal tahunan. Expiry/kontrak sudah difilter engine; memperlebar filter script tidak mengembalikan kontrak yang tidak diambil backend.

History menyediakan `total_net_gex`, `total_gross_gex`, `total_net_vanna`, `total_net_charm`, `total_net_dai`, `total_net_vex`, `spot`, `timestamp`, `data_source` dan field aggregate engine lainnya. History memuat maksimum 500 snapshot terbaru yang tersimpan, bukan history Greeks lengkap setiap candle. Tidak tersedia historical option-chain penuh. Timestamp lama tanpa timezone ditafsirkan sebagai waktu lokal server lalu dikonversi ke UTC; `meta` timestamps memakai epoch detik.

Untuk history, align **maju secara as-of**, tidak pernah backward fill:

```python
def calculate(ctx):
    bars = ctx.data.ohlcv()
    history = ctx.greeks.history()
    gex = history.total_net_gex * 1e7
    aligned = gex.reindex(bars.index, method="ffill", tolerance=pd.Timedelta(hours=24))
    ctx.plot.line("gex", aligned, pane="GEX USD per 1%", color="#eab86b")
```

NaN sebelum snapshot pertama atau setelah batas usia harus tetap menjadi gap. Template lengkap menyembunyikan pane yang seluruh nilainya kosong dan menjelaskan alasannya di console. Rolling Z-score template menghitung jumlah snapshot, bukan jumlah candle. Filter chain tidak mengubah aggregate history. Replay menghapus snapshot sekarang, chain dan OI changes, serta memotong history sampai cursor. Jangan menempelkan snapshot hari ini ke seluruh candle sebagai sinyal historis. Current `hline` template sengaja diberi judul **NOW**: garis referensi statis, bukan backtest. Level harga membutuhkan underlying sama; tidak ada konversi SPY/SPX atau BTC/IBIT otomatis. TSLA equity dan `xyz:TSLA` perpetual tetap memiliki basis dan sesi berbeda.

Konvensi engine: `gex_spotgamma = sign * gamma * OI * contract_size * spot² / 1e9`, dengan call positif dan put negatif. Kalikan `1e7` untuk estimasi USD delta-hedge per pergerakan spot 1%. Exposure Vanna/Charm/Delta/Vega memakai sign model × Greek mentah × OI × contract_size; jangan menyamakan skalanya atau mengasumsikan nilai per 1 vol point/per hari tanpa memeriksa engine. Sign tersebut asumsi inventory, bukan posisi dealer terobservasi. Lihat [OIC Gamma](https://www.optionseducation.org/advancedconcepts/gamma) untuk definisi sensitivitas dasar.

Options activity memakai volume chain, OI, volume/OI (OI nol tidak dibagi), dan proxy `volume * mid_price * contract_size`. Proxy itu bukan premium aktual yang dibayar. Dataset ini tidak mempunyai time & sales opsi, aggressor, open/close, sweep, block atau identitas institusi. Call tidak otomatis bullish dan put tidak otomatis bearish. Jangan menciptakan probabilitas posterior terkalibrasi dari threshold heuristic. Expected move `spot * IV * sqrt(days/365)` adalah pendekatan, bukan interval probabilitas terkalibrasi. Max pain template merupakan minimum payout aggregate pada expiry terpilih, bukan klaim settlement satu expiry.

Uji dengan `tests/greeks-indicator.browser.cjs`, `tests/greeks-input.test.cjs` dan `python/test_greeks_chart_data.py` bila mengubah integrasi. Periksa synthetic gate, source mismatch, filter kosong, usia history, dan replay sebelum menyerahkan indikator.

## Parameter

```text
ctx.input.int(name, default=20, min=1, max=10000) -> int
ctx.input.float(name, default=1.0, min=-1e9, max=1e9, step=0.1) -> float
```

Gunakan nama parameter unik dan default di dalam rentang. Angka wajib finite; integer benar-benar bilangan bulat. Belum ada input bool, string, enum, color, atau symbol; pakai parameter numerik jika diperlukan. Validasi relasi antar parameter sendiri (misalnya fast < slow).

## Output yang didukung

```text
ctx.plot.line(id, values, pane="price", color="#45c9b0", title=None)
ctx.plot.area(id, values, pane="price", color="#45c9b0", title=None)
ctx.plot.histogram(id, values, pane="price", color="#45c9b0", title=None)
ctx.plot.hline(id, value, pane="price", color="#45c9b0", title=None)
ctx.plot.marker(id, condition, text="Signal", color="#45c9b0", title=None)
ctx.plot.box(id, start, end, top, bottom, color="#45c9b0", title=None)
```

`ctx.draw` adalah alias `ctx.plot`. Semua fungsi menghasilkan output lewat side effect; nilai return `calculate` tidak digunakan. Gunakan string ID unik dan stabil per indikator. Jangan memakai ID berbeda pada setiap run.

- `values`: pandas Series dengan UTC DatetimeIndex (direkomendasikan), atau array dengan panjang sama seperti chart. Subset Series boleh jika tetap memiliki DatetimeIndex. NaN menjadi celah/warmup; infinity akan ditolak. Angka warna hanya hex **enam digit**, misalnya `#eab86b`; bukan `red`, rgba, atau `#fff`.
- `pane="price"` menempel ke harga. Nama lain seperti `"Momentum"` membuat pane terpisah. Pakai nama sama untuk output yang harus berbagi skala.
- `hline`: nilai konstan finite.
- `marker`: kondisi boolean yang sejajar index utama. Renderer saat ini menampilkan panah di atas candle pada pane harga, dengan text dan color. Posisi/shape custom belum tersedia; jangan invent `belowBar`, `shape`, atau `size`.
- `box`: start/end berupa pandas Timestamp atau epoch detik; `end >= start`, finite `top >= bottom`. Renderer menampilkan kotak di pane harga. Gunakan untuk zona tetap; setiap box memakai satu jatah output.
- Tidak tersedia `ctx.ta`, `ctx.alert`, `ctx.strategy`, `ctx.plot.candles`, `plotshape`, fill antar garis, color per titik, linewidth custom, atau matplotlib chart yang tertanam. Parameter yang tidak tercantum jangan diasumsikan bekerja.

### Pengaturan tampilan lewat UI

Klik nama indikator atau ikon Settings di legend chart / Studies untuk membuka **Inputs** dan **Style**. Style mendukung warna, ketebalan garis 1–4 px, solid/dashed/dotted, straight/step, opacity, label harga, visibilitas per plot, fill area/zona, serta bentuk/ukuran/posisi marker. Kontrol tersedia sesuai jenis output; lebar kolom histogram mengikuti jarak candle.

Pengaturan UI disimpan terpisah dalam workspace, tidak mengubah `.py` atau hasil perhitungan, dan langsung diterapkan tanpa Run Python. Inputs tetap memerlukan Run. Gunakan ID plot yang stabil: override style mengikuti ID tersebut per instance indikator, termasuk saat rerun. Reset plot/style mengembalikan tampilan ke default output Python terbaru. Download `.py` hanya membawa kode; export workspace JSON membawa konfigurasi tampilan juga. Ini tidak menambahkan argumen baru ke `ctx.plot`; signature Python di atas tetap berlaku.

## Contoh 1 — EMA, momentum, dan crossover

File Python ini bisa langsung di-import:

```python
def calculate(ctx):
    bars = ctx.data.ohlcv()
    length = ctx.input.int("length", default=20, min=2, max=500)
    ema = bars.close.ewm(span=length, adjust=False, min_periods=length).mean()
    previous = bars.close.shift(1)
    momentum = bars.close.diff() / previous.where(previous != 0) * 100.0
    cross = (bars.close > ema) & (bars.close.shift(1) <= ema.shift(1))
    ctx.plot.line("ema", ema, color="#45c9b0", title="EMA")
    ctx.plot.histogram("momentum", momentum, pane="Momentum", color="#eab86b")
    ctx.plot.hline("zero", 0.0, pane="Momentum", color="#74849b")
    ctx.plot.marker("cross_up", cross, text="Cross above EMA", color="#45c9b0")
```

Warmup EMA: length - 1 bar kosong; momentum: satu bar. Crossover pada candle provisional bisa berubah sebelum close. Ini penanda kondisi, bukan eksekusi order.

## Contoh 2 — Z-score rasio dua pasar

Pilih dataset tambahan di **Data inputs** sebelum Run. Sesuaikan kedua pasar dan timeframe; contoh ini tidak memilih ticker sendiri.

```python
def calculate(ctx):
    bars = ctx.data.ohlcv()
    other = ctx.data.ohlcv("compare")
    length = ctx.input.int("length", default=30, min=3, max=500)
    aligned = other.close.reindex(bars.index, method="ffill")
    ratio = bars.close / aligned.where(aligned != 0)
    mean = ratio.rolling(length, min_periods=length).mean()
    std = ratio.rolling(length, min_periods=length).std(ddof=0)
    z = (ratio - mean) / std.where(std > 0)
    ctx.plot.line("relative_z", z, pane="Relative value", color="#879cfa")
    ctx.plot.hline("upper", 2.0, pane="Relative value", color="#eab86b")
    ctx.plot.hline("lower", -2.0, pane="Relative value", color="#eab86b")
```

Rasio konstan menghasilkan celah, bukan infinity. Z-score rasio bukan bukti cointegration atau sinyal arbitrase otomatis. Contoh memakai forward fill tanpa batas usia; tambahkan toleransi sesuai sesi jika membandingkan pasar yang berbeda.

## Verifikasi sebelum menyerahkan script

### Bahasa, editor, dan diagnosis error

Bahasa indikator adalah **Python 3.12** dengan entry point `def calculate(ctx):`.
Editor menggunakan empat spasi untuk indentasi. `pd` dan `np` tersedia; kode Pine Script,
JavaScript, dan pagar Markdown (```python) harus dikonversi/dihapus sebelum dimasukkan ke editor.
Tidak perlu mengganti bahasa indikator untuk mengubah warna, ketebalan, atau style: gunakan
pengaturan indikator di UI. Python dipakai untuk formula dan data.

- **Ctrl+Space**: autocomplete SDK berisi signature, penjelasan, dan snippet dengan argumen
  yang dapat dipindah menggunakan Tab. Contoh `calculate`, `rolling_mean`, dan
  `exponential_mean` membantu memulai skrip. Ini bantuan SDK, bukan type checker Python penuh.
- **Python 3.12 / SDK reference**: referensi yang dapat dicari, termasuk Data, Inputs,
  Plots, dan The Greeks. Referensi desktop dapat dibuka bersamaan dengan kode.
- **Check syntax / Ctrl+Shift+Enter**: hanya compile Python; tidak menjalankan kode,
  import dari skrip, atau menghitung plot. Runtime lokal dimuat pada penggunaan pertama.
  Syntax valid bukan bukti paket tersedia, data lengkap, atau formula benar.
- **Run / Ctrl+Enter**: menjalankan indikator terhadap snapshot data yang dipilih.
  Stop menghentikan worker; Run selanjutnya memuat runtime kembali.
- Error menampilkan jenis, pesan, baris sumber bila tersedia, petunjuk, dan traceback
  lengkap yang dapat dibuka. Klik **Line** untuk menuju baris di editor. Error dari
  helper SDK diarahkan ke pemanggilan di skrip pengguna, bukan baris internal SDK.
- Setelah kode diubah, error lama ditandai **Previous version** dan navigasi barisnya
  dinonaktifkan. Check/Run ulang untuk mendapatkan diagnosis versi terbaru.
- **Copy for AI** menyalin error, traceback, dan versi skrip yang menghasilkan error.
  Gunakan bersama guide ini di Codex, Antigravity, atau AI lain. **Ask AI to fix** mengisi
  permintaan di AI draft; pembuatan draft tetap menggunakan konfigurasi AI dashboard.

Tes authoring: `python python/test_indicator_diagnostics.py` dari root dengan environment
proyek; `node tests/python-authoring.browser.cjs` dari `vrp-claude` dengan Playwright,
Chrome, dan dashboard port 3000.

1. Import/Run di Python Studio; cek pesan Completed dan hasil yang terlihat. Jika tidak punya browser, laporkan batas verifikasi tersebut.
2. Gunakan data kecil dengan hasil yang diketahui untuk memeriksa formula dan panjang warmup; periksa bar pendek, nilai konstan, dan pembagi nol.
3. Ubah parameter dan timeframe. Cek tidak ada index timezone mismatch, infinity, atau ID ganda.
4. Bandingkan output full history dengan output yang dihitung hanya sampai suatu prefix history. Nilai di timestamp lama harus tetap sama untuk indikator causal; periksa ulang jika ada repaint yang disengaja dan jelaskan ke pengguna.
5. Untuk compare, uji missing dataset dan jam perdagangan berbeda. Untuk snapshot market, uji dictionary kosong. Jangan menutupi error data dengan nilai palsu.
6. Jika mengubah SDK/renderer di repo, jalankan `npm run test:chart-studio` dan `npm run build` dari `vrp-claude`. Browser SDK test: `node tests/chart-python.browser.cjs` (butuh Playwright + Chrome dan app port 3000).

## Sumber kebenaran untuk agen yang mengakses repo

- `vrp-claude/public/chart-studio/sdk.py`: signature dan validasi Python.
- `vrp-claude/public/chart-studio/python-worker.js`: runtime, import, log, serialisasi.
- `vrp-claude/app/lib/chart-studio/templates.ts`: template dan SDK_HELP ringkas.
- `vrp-claude/app/components/lwc/studio/StudioChart.tsx`: kemampuan renderer.
- `vrp-claude/app/components/lwc/studio/ChartWorkspace.tsx`: dataset, replay, lifecycle.
- `vrp-claude/app/lib/chart-studio/hyperliquidCatalog.ts`: katalog venue, canonical ticker, dan alias pencarian.

Jika kode aktual berubah, cocokkan kembali dokumen ini. Jangan menambahkan API fiktif untuk membuat contoh tampak berhasil.
