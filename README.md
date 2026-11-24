# Sistem Manajemen Invoice & Piutang (Web App)

Aplikasi Web lengkap untuk pemantauan, rekonsiliasi, dan pengelolaan invoice serta piutang berdasarkan data Google Spreadsheet:
`https://docs.google.com/spreadsheets/d/1NDsUjM1mr9zFlbexXJZCBzfsnV98aGUJcA-TiMpHJSE/edit?gid=68689000#gid=68689000`

---

## 🚀 Fitur Utama & Tools Lengkap

### 1. Struktur Kolom Lengkap
Aplikasi memuat seluruh kolom asli dari Google Spreadsheet ditambah kolom-kolom baru sesuai kebutuhan bisnis:
- **No. Invoice**: Nomor faktur/invoice (disanitasi dari karakter tersembunyi).
- **Tanggal**: Tanggal invoice diterbitkan.
- **Customer**: Nama perusahaan/klien penerima tagihan.
- **Pelanggan**: Kode/ID pelanggan.
- **Portofolio**: Kategori industri/unit kerja (Industri, Hulu Migas, Batubara, Komoditi, dll.).
- **Kegiatan**: Uraian jasa/pekerjaan yang ditagihkan.
- **Order Number**: Nomor Purchase Order / Order pekerjaan.
- **Saldo Konversi**: Nilai nominal tagihan dalam Rupiah (`Rp`).
- **Day (Invoice)**: Jumlah hari berjalan sejak invoice diterbitkan.
- **Status Jatuh Tempo** *(Tambahan)*:
  - **Jatuh Tempo** (Badge Merah): Apabila `Day (Invoice) > 30` hari.
  - **Belum Jatuh Tempo** (Badge Hijau): Apabila `Day (Invoice) <= 30` hari.
- **Pembayaran Via** *(Tambahan)*:
  - Pilihan metode bayar: **BNI**, **UMP**, **MVA**, atau transfer lainnya.
- **Status Pembayaran** *(Tambahan)*:
  - **Sudah Bayar** (Lunas) atau **Belum Bayar**.
- **Nominal Pelunasan** *(Tambahan)*:
  - Nominal Rupiah yang telah dibayarkan / dilunasi.
- **Tanggal Pelunasan** *(Tambahan)*:
  - Tanggal saat pembayaran diterima/dilunasi.
- **Keterangan** *(Tambahan)*:
  - Otomatis terisi **"Sudah Bayar"** saat lunas dan **"Belum Bayar"** saat belum lunas, serta dapat diedit dengan catatan kustom.

---

### 2. Panel Analitik & Ringkasan Eksekutif (Dashboard KPI)
- **Total Tagihan**: Total nilai piutang (Rp) dan jumlah invoice terdaftar (337 invoice).
- **Jatuh Tempo (> 30 Hari)**: Total nominal dan jumlah invoice yang telah lewat jatuh tempo.
- **Belum Jatuh Tempo (≤ 30 Hari)**: Total nominal dan jumlah invoice lancar.
- **Sudah Bayar / Lunas**: Total nilai yang telah dilunasi dan jumlah transaksinya.
- **Belum Bayar (Outstanding)**: Sisa piutang berjalan yang belum dibayarkan.
- **Saluran Bayar Rekap**: Penghitung instan pembayaran via BNI, UMP, dan MVA.

---

### 3. Grafik Interaktif (Chart.js)
- **Donut Chart**: Rasio Status Jatuh Tempo (>30 Hari vs ≤30 Hari).
- **Donut Chart**: Rasio Status Pembayaran (Sudah Bayar vs Belum Bayar).
- **Bar Chart**: Distribusi Metode Pembayaran (BNI, UMP, MVA).
- **Horizontal Bar Chart**: Distribusi nilai saldo berdasarkan Portofolio teratas.
- Fitur *Sembunyikan / Tampilkan Grafik* untuk memperluas area tabel.

---

### 4. Fitur Pengelolaan Admin (CRUD & Batch Tools)
- **Mode Admin Toggle**: Tombol pengalih mode Admin / Viewer langsung di pojok kanan atas.
- **Tambah Invoice Baru**: Form modal lengkap dengan validasi untuk menambahkan faktur baru.
- **Edit Data Invoice**: Modal pengeditan semua field data invoice dan pembayaran.
- **Catat Pelunasan Cepat (Quick Pay)**: Tombol 1-klik pada setiap baris untuk melunasi tagihan (otomatis mengisi nominal sesuai saldo konversi, tanggal hari ini, dan memilih BNI/UMP/MVA).
- **Hapus Data**: Konfirmasi penghapusan data invoice dengan proteksi modal.
- **Aksi Massal (Batch Actions)**:
  - Memilih beberapa atau seluruh baris sekaligus.
  - Batch **Tandai Lunas**.
  - Batch **Set Metode Pembayaran** (BNI, UMP, MVA).
  - Batch **Ekspor Terpilih ke Excel**.
  - Batch **Hapus Terpilih**.

---

### 5. Fitur Import Data & Template Excel/CSV
- **Import File Spreadsheet**: Mendukung file format `.xlsx`, `.xls`, dan `.csv`.
- **Pemetaan Otomatis**: Mendeteksi header kolom seperti pada template Google Sheets asli.
- **Perhitungan Otomatis**: Menghitung `Status Jatuh Tempo` secara instan berdasarkan nilai `Day (Invoice)` dari file yang di-import.
- **Pilihan Mode**:
  - *Append*: Menambahkan data baru tanpa menghapus data yang sudah ada.
  - *Replace*: Menimpa seluruh data lama dengan file yang baru di-upload.
- **Unduh Template Import**:
  - Tombol **Unduh Template Excel (.xlsx)** dan **Unduh Template CSV (.csv)** siap pakai yang telah terisi contoh format.

---

### 6. Fitur Pencarian & Filter Canggih
- **Pencarian Live**: Mencari secara simultan pada No. Invoice, Customer, Pelanggan, Order Number, Portofolio, dan Kegiatan.
- **Filter Cepat (Preset Pills)**:
  - Semua Data
  - Jatuh Tempo (>30 Hari)
  - Belum Jatuh Tempo
  - Belum Bayar
  - Sudah Bayar (Lunas)
- **Filter Dropdown**:
  - Filter Portofolio (otomatis terisi dari kategori yang ada)
  - Filter Status Jatuh Tempo
  - Filter Status Pembayaran
  - Filter Metode Pembayaran (BNI, UMP, MVA, Belum Diisi)
- **Pengurutan Kolom (Sorting)**: Klik pada judul kolom mana saja untuk mengurutkan Ascending / Descending.
- **Pagination Fleksibel**: Pilihan 10, 25, 50, 100, atau Semua baris per halaman.

---

### 7. Fitur Ekspor & Backup
- **Ekspor ke Excel (.xlsx)**: Mengunduh data lengkap beserta kolom tambahan ke file spreadsheet Excel.
- **Ekspor ke CSV (.csv)**: Kompatibel dengan semua aplikasi spreadsheet.
- **Cetak / Simpan PDF**: Tampilan cetak profesional lengkap dengan header ringkasan total tagihan.
- **Backup & Restore JSON**: Menyimpan salinan database lokal dan memulihkannya kapan saja.
- **Reset ke Data Asli**: Tombol 1-klik untuk mengembalikan ke 337 data awal Google Spreadsheet.

---

## 💻 Cara Menjalankan Aplikasi

Aplikasi dapat dijalankan dengan 2 cara mudah di Windows:

### Cara 1: Menggunakan Local Web Server (Direkomendasikan)
1. Buka folder `C:\Users\DELL\.gemini\antigravity\scratch\invoice-billing-app`
2. Klik ganda (double-click) file **`start.bat`**
3. Aplikasi akan otomatis membuka browser di alamat:
   ```
   http://localhost:8080/
   ```

### Cara 2: Langsung Buka File HTML (Tanpa Server)
1. Buka folder `C:\Users\DELL\.gemini\antigravity\scratch\invoice-billing-app`
2. Klik ganda file **`open_browser.bat`** atau klik kanan **`index.html`** -> Buka dengan Google Chrome / Microsoft Edge.
