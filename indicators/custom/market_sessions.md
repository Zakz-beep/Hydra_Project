# Market Sessions — Asia, London, New York

Import `market_sessions.py` melalui **Python Studio → Import Python script → Run**.
Gunakan timeframe 1m, 5m, 15m, atau 1h. Buka **Configure → Inputs** untuk parameter;
**Style** untuk warna, ketebalan border/garis, opacity dan fill kotak.

| Sesi | Default waktu lokal | Zona waktu | Warna |
| --- | --- | --- | --- |
| Asia (Tokyo) | 09:00–18:00 | Asia/Tokyo | Ungu |
| London | 08:00–17:00 | Europe/London | Biru |
| New York | 08:00–17:00 | America/New_York | Kuning |

Ini preset jendela analisis yang dapat diedit, bukan kalender resmi bursa.
London/New York mengikuti DST melalui konversi zona waktu pandas. Default Asia
sama dengan 07:00–16:00 WIB. Waktu London/New York dalam WIB bergeser sesuai DST.

Parameter:

- `sessions_per_market`: 1–6 sesi terakhir **yang mempunyai data**, default 5.
- `include_weekends`: 0 Senin–Jumat; 1 menyertakan akhir pekan untuk crypto.
- `show_boxes`, `show_labels`: default 1. Kotak memakai high–low yang terobservasi.
- `show_running_high_low`, `show_session_open`: default 0; ubah ke 1 untuk garis.
- `asia_enabled`, `london_enabled`, `new_york_enabled`: 1 aktif / 0 nonaktif.
- `<sesi>_start_hhmm`, `<sesi>_end_hhmm`: jam lokal dalam angka HHMM,
  misalnya 800, 1330 atau 1700. Untuk sesi reguler saham AS, atur New York 930–1600.
  Start lebih besar dari end berarti melewati tengah malam; hari kerja mengacu
  pada tanggal mulai sesi. Start sama dengan end ditolak.

Klik Run setelah mengubah Inputs. Untuk mengikuti sesi baru, aktifkan auto-run
bar-close di Studies. Output console merangkum high, low, range, jam UTC, dan
kelengkapan data sesi terbaru tiap pasar.

Hanya candle yang seluruh durasinya masuk jendela sesi yang dihitung. Gunakan
timeframe kecil untuk batas sesi yang tidak sejajar dengan candle. Yahoo reguler
mungkin tidak punya data Asia/London; indikator tidak menciptakan candle kosong.
Open dan marker awal hanya muncul bila candle pembukaan sesi tersedia.
Libur bursa tidak difilter. Label complete coverage menghitung cakupan timestamp,
bukan jaminan candle live terakhir sudah final.

Kotak merupakan ringkasan high–low **seluruh bagian sesi yang sudah terobservasi**:
tinggi kotak masa lalu dapat berubah selama sesi berkembang. Gunakan garis
running high/low untuk nilai causal pada setiap candle. Di replay, tidak ada
harga setelah cursor yang dibaca; kotak berakhir pada ujung candle terakhir
yang disediakan. Maksimum 30 output tetap dalam batas SDK 32.

Untuk jam kustom yang bertepatan dengan transisi DST: jam yang tidak ada digeser
ke waktu valid berikutnya; jam berulang memakai kejadian waktu standar.
Lihat [pandas tz_localize](https://pandas.pydata.org/pandas-docs/stable/reference/api/pandas.Series.dt.tz_localize.html).

Warna/zona waktu default dapat diedit di konstanta `SESSIONS` di skrip. ID kotak
`<sesi>_zone_0` selalu berarti sesi terbaru, `_1` sesi sebelumnya, dan seterusnya;
override Style mengikuti urutan tersebut saat hari berganti.
