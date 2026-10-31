# Panduan Pembaruan — Arsip Digital JTE (Jelajah Folder)

## Tujuan
Saat kategori **Sertifikat Dosen** diklik, halaman *Jelajah Arsip* akan membaca folder `Sertifikat Dosen` dari Google Drive. Subfolder nama dosen akan ditampilkan sebagai kartu. Klik folder dosen untuk melihat dan membuka dokumennya.

Fungsi yang sama berlaku untuk kategori berikut sesuai **config.js** yang sudah tersedia: Pendidikan dan Pengajaran, Penelitian, Pengabdian kepada Masyarakat, Kerja Sama, Dokumen Akreditasi. Subfolder di setiap kategori dapat dibuka bertingkat (bukan hanya satu level).

## Isi paket
- `index.html` — halaman Beranda dan Jelajah Arsip dalam aplikasi yang sama.
- `style.css` — desain halaman dan penjelajah folder.
- `app.js` — login Google, daftar kategori, pencarian folder, membuat folder baru, dan upload.
- `PANDUAN-INSTALASI.md` — panduan ini.

**JANGAN ganti `config.js` yang ada di GitHub.** Paket sengaja tidak menyertakan `config.js`, karena OAuth Client ID dan ROOT_FOLDER_ID sudah diatur pada website aktif.

## Cara mengunggah ke GitHub
1. Buka https://github.com/JTE-PNJ/arsip-digital
2. Klik **Add file → Upload files**.
3. Pilih `index.html`, `style.css`, dan `app.js` dari ZIP pembaruan ini (jangan upload ZIP-nya).
4. Jika GitHub menampilkan peringatan bahwa file sudah ada, lanjutkan proses penggantian file; klik **Commit changes**.
5. Pastikan ketiga file berada langsung di root repository, satu level dengan `config.js`.
6. Buka https://jte-pnj.github.io/arsip-digital/ kemudian lakukan **Ctrl+Shift+R** sekali.
7. Klik **Hubungkan Google**, lalu klik kartu **Sertifikat Dosen**, **Penelitian**, atau kategori lainnya.

`index.html` sudah menggunakan nomor versi untuk pemuatan `app.js` dan `style.css` supaya cache versi sebelumnya tidak dipakai.

## Cara menggunakan
1. Login melalui **Hubungkan Google**.
2. Klik kartu **Sertifikat Dosen**.
3. Halaman **Jelajah Arsip** membuka isi folder `Sertifikat Dosen` pada Google Drive.
4. Klik folder **nama dosen** untuk melihat dokumen sertifikat dosen tersebut.
5. Gunakan **+ Folder Dosen** untuk membuat folder nama dosen langsung dari aplikasi.
6. Saat sudah berada di folder nama dosen, klik **↑ Unggah di sini** untuk menyimpan dokumen langsung ke folder tersebut.
7. Klik breadcrumb (Beranda / Sertifikat Dosen / Nama Dosen) untuk kembali ke folder sebelumnya.
8. Pada kategori lain, gunakan **+ Folder Baru** untuk membuat struktur folder sesuai kebutuhan.
9. **Cari Dokumen** di Beranda dapat menelusuri file di subfolder bertingkat, dengan batas jumlah folder/hasil untuk menjaga kinerja.

## Contoh struktur Google Drive
Arsip JTE (ROOT_FOLDER_ID)
- Sertifikat Dosen
  - Dosen A
    - Sertifikat_PLC.pdf
    - Sertifikat_K3.pdf
  - Dosen B
    - Sertifikat_Seminar.pdf
- Penelitian
  - 2025
  - 2026
- Pengabdian kepada Masyarakat
  - 2026
- Pendidikan dan Pengajaran
- Kerja Sama
- Dokumen Akreditasi

Folder kategori yang sudah ada akan dibaca; aplikasi **tidak** memindahkan ataupun menghapus dokumen lama. Jika kategori belum ada, aplikasi menampilkan pemberitahuan dan akan membuat folder kategori induk saat pengguna memilih membuat subfolder atau upload dari formulir Beranda.

## Penting: keamanan akses
- Website GitHub Pages bersifat publik. **Jangan upload dokumen rahasia ke repository GitHub.** Dokumen disimpan melalui Google Drive API.
- Tombol login Google tidak sama dengan pembatasan akses per dosen: siapa saja yang berhasil login dengan izin Google Drive yang sesuai dapat melihat/mengubah folder yang ia miliki akses. Untuk pembatasan *dosen A hanya folder A*, atur izin folder di Google Drive atau buat backend yang menerapkan aturan akses.
- Token Google hanya di memori halaman, bukan di localStorage, sessionStorage, atau repository. Reload halaman memerlukan sambung ulang Google.
- API OAuth saat ini menggunakan scope `drive` yang luas mengikuti aplikasi lama. Untuk penggunaan produksi, kaji ulang scope dan proses verifikasi consent screen Google.
- Pencarian seluruh kategori akan melakukan beberapa permintaan API untuk menelusuri subfolder dan dibatasi maksimal 250 folder dan 2.000 hasil per kategori (dengan indikator bila ada hasil terpotong). Untuk jumlah data yang lebih besar, gunakan pencarian kategori/nama dosen tertentu.

## Jika ada kendala
- **Folder tidak muncul**: cek apakah folder kategori memang ada di dalam folder root dengan ID di `config.js`; klik **↻ Perbarui**; pastikan akun Google memiliki akses ke folder tersebut.
- **Tidak dapat login**: pastikan Authorized JavaScript origin Google OAuth berisi `https://jte-pnj.github.io` dan akun diizinkan di OAuth consent screen.
- **Upload ditolak (403)**: cek hak Editor pengguna pada folder tujuan serta Google Drive API pada Google Cloud.
- **Tampilan lama**: tekan Ctrl+Shift+R, atau coba incognito. Pastikan `index.html`, `app.js`, dan `style.css` terunggah bersama.
- **Cache**: nama stylesheet di aplikasi sekarang `style.css` (bukan `styles.css`). Jangan menghapus konfigurasi lama.

Paket ini dibuat untuk deployment statis GitHub Pages. Pengujian otomatis menggunakan respons Google Drive tiruan (mock); koneksi ke Google Drive asli tetap harus diuji menggunakan akun yang memiliki izin.
