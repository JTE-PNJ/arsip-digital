# Tutorial Lengkap — GitHub Pages sebagai Aplikasi Web, Google Drive sebagai Penyimpanan

**Contoh penerapan:** Arsip Digital Jurusan Teknik Elektro, Politeknik Negeri Jakarta (JTE PNJ)

**Tujuan:** Membuat situs web yang dapat diakses melalui GitHub Pages, terhubung ke akun Google melalui OAuth 2.0, lalu mengunggah dan mencari dokumen pada folder Google Drive. Contoh ini menggunakan **Google Drive API langsung dari browser**; Google Apps Script **tidak diperlukan**.

**Batas penggunaan:** prototipe/uji coba dengan dokumen nonrahasia. **Belum** memiliki pemisahan hak akses Dosen, Kaprodi, Admin, atau Tim Akreditasi. Hak akses dikendalikan melalui fitur berbagi Google Drive dan OAuth; pengguna yang mendapatkan akses Editor ke folder bersama memiliki hak yang luas di folder tersebut.

---

## A. Gambaran alur

1. Pengguna membuka `https://NAMA-AKUN.github.io/arsip-jte/`.
2. Halaman di GitHub Pages memuat `index.html`, `style.css`, `config.js`, dan `app.js`.
3. Pengguna menekan tombol **Hubungkan Google** dan menyetujui akses melalui halaman persetujuan Google.
4. Browser memperoleh *access token* sementara dari Google Identity Services.
5. Saat pengguna mengunggah/mencari dokumen, JavaScript memanggil Google Drive API memakai token sementara.
6. Google Drive menyimpan dokumen di folder kategori dan menegakkan izin berbagi Drive.

**Pemisahan:** GitHub menyimpan **kode aplikasi**; Google Drive menyimpan **dokumen**. Dokumen tidak dikirim ke repository GitHub.

---

## B. Membuat folder Google Drive

1. Masuk ke https://drive.google.com/ menggunakan akun Google yang digunakan sebagai pemilik repositori arsip.
2. Pilih **Baru > Folder** dan beri nama `ARSIP_JTE_PNJ`.
3. Buka folder tersebut. URL umumnya seperti:
   `https://drive.google.com/drive/folders/1AbCdEfGh1234567890`
4. Salin nilai setelah `/folders/`. Nilai itulah **ROOT_FOLDER_ID**.
5. Untuk pengujian bersama, klik **Bagikan**, tambahkan akun penguji sebagai **Editor**, dan pastikan **Akses umum** tetap **Dibatasi (Restricted)**.
6. **Tidak perlu membuat subfolder manual.** Aplikasi contoh akan membuat enam folder kategori otomatis ketika digunakan: `Sertifikat Dosen`, `Pendidikan dan Pengajaran`, `Penelitian`, `Pengabdian kepada Masyarakat`, `Kerja Sama`, dan `Dokumen Akreditasi`.

**Catatan keamanan:** jangan mengaktifkan `Siapa saja yang memiliki link` demi kemudahan. Folder yang diberi izin Editor kepada banyak dosen bukan folder privat per dosen. Untuk produksi, buat desain izin yang lebih ketat.

---

## C. Membuat proyek Google Cloud dan mengaktifkan Drive API

1. Buka https://console.cloud.google.com/ dan login.
2. Klik pemilih proyek (bagian atas) > **New Project/Buat Project**.
3. Isi nama `JTE-Arsip-Digital` dan pilih organisasi yang sesuai jika memakai akun Google Workspace. Klik **Create**.
4. Pastikan proyek itu aktif.
5. Buka **APIs & Services > Library** atau cari **Google Drive API**.
6. Buka **Google Drive API** dan pilih **Enable/Aktifkan**.

**Tidak perlu** membuat Service Account atau mengunduh JSON key. Untuk contoh aplikasi statis, gunakan *OAuth Client ID* tipe Web application.

---

## D. Menyiapkan Google Auth Platform (OAuth)

Nama menu dapat berubah; pada antarmuka saat ini umumnya terdapat **Google Auth Platform** (Branding, Audience, Data Access, Clients).

1. Buka **Google Auth Platform > Branding**. Isi nama aplikasi, alamat email dukungan, dan informasi wajib yang diminta.
2. Buka **Audience**:
   - **Internal**: pilih jika proyek berada di organisasi Google Workspace dan penggunaan hanya untuk anggota organisasi yang diperbolehkan. Pilihan ini tidak selalu tersedia untuk akun Google pribadi.
   - **External**: untuk penguji akun umum. Jika statusnya **Testing**, tambahkan alamat Google para penguji di bagian **Test users**.
3. Buka **Data Access** dan konfigurasi scope Google Drive yang diperlukan. Kode contoh ini menggunakan:
   `https://www.googleapis.com/auth/drive`
4. **Peringatan izin:** scope `drive` termasuk **restricted scope** karena memberikan kemampuan luas membaca dan mengelola file Drive pengguna yang memberi persetujuan. Penggunaan publik mungkin memerlukan proses verifikasi Google dan ketentuan tambahan. Gunakan akun pengujian khusus terlebih dahulu.
5. Buka **Clients > Create Client**.
6. Pilih **Application type: Web application** dan beri nama misalnya `JTE GitHub Pages`.
7. Di **Authorized JavaScript origins**, tambahkan:
   `https://NAMA-AKUN.github.io`
   Ganti `NAMA-AKUN` dengan nama akun atau organisasi GitHub. **Jangan masukkan path repository**, contohnya **bukan** `https://NAMA-AKUN.github.io/arsip-jte/`.
8. Untuk mencoba dari komputer lokal (opsional), tambahkan juga `http://localhost:8000` dan jalankan server lokal (jangan membuka lewat `file://`).
9. **Authorized redirect URIs** tidak diperlukan untuk contoh token popup ini.
10. Klik **Create**, kemudian salin **Client ID**, biasanya berakhiran `.apps.googleusercontent.com`.

**Jangan** menyalin *Client Secret* ke HTML/JavaScript/GitHub. Client ID adalah identitas aplikasi yang memang boleh tampil pada browser; Client Secret bukan.

---

## E. Mengubah konfigurasi aplikasi

1. Ekstrak ZIP yang disertakan.
2. Buka `config.js` memakai Notepad, VS Code, atau editor teks.
3. Ganti dua placeholder:

```javascript
window.JTE_CONFIG = {
  APP_NAME: 'Arsip Digital JTE PNJ',
  CLIENT_ID: '123456789-xxxxxxxx.apps.googleusercontent.com',
  ROOT_FOLDER_ID: '1AbCdEfGh1234567890',
  CATEGORIES: [
    'Sertifikat Dosen',
    'Pendidikan dan Pengajaran',
    'Penelitian',
    'Pengabdian kepada Masyarakat',
    'Kerja Sama',
    'Dokumen Akreditasi'
  ]
};
```

Nilai di atas **hanya contoh**, bukan identitas atau ID folder asli.

4. Simpan `config.js`.

**Struktur berkas yang diunggah ke GitHub:**

```text
arsip-jte/
├── index.html
├── style.css
├── config.js
├── app.js
├── README.md
└── PANDUAN.md
```

---

## F. Mempublikasikan ke GitHub Pages

1. Buka https://github.com/ lalu masuk atau buat akun.
2. Klik tombol **New repository**.
3. Isi **Repository name**: `arsip-jte`.
4. Buat repository; untuk GitHub Free, opsi yang sederhana adalah **Public**. Ingat: halaman GitHub Pages bisa diakses publik, walaupun konten di Google Drive tetap diperiksa izinnya secara terpisah.
5. Pada halaman repo, pilih **Add file > Upload files**.
6. Unggah `index.html`, `style.css`, `config.js`, `app.js`, `README.md`, dan `PANDUAN.md`.
7. Klik **Commit changes**.
8. Masuk **Settings > Pages**.
9. Pada **Build and deployment**, pilih **Source: Deploy from a branch**, **Branch: main**, dan **Folder: /(root)**. Klik **Save**.
10. GitHub akan menampilkan alamat publikasi, pada umumnya:
    `https://NAMA-AKUN.github.io/arsip-jte/`
11. Buka alamat tersebut. Jika masih 404, periksa status deployment pada GitHub Actions/Pages dan ulangi setelah publikasi selesai.

Bila menggunakan custom domain, tambahkan origin **domain yang benar-benar dipakai** ke OAuth Client.

---

## G. Uji coba penggunaan

1. Buka situs GitHub Pages.
2. Klik **Hubungkan Google**.
3. Pilih akun Google yang mempunyai akses Editor ke folder `ARSIP_JTE_PNJ`.
4. Pada dialog izin Google, periksa scope yang diminta lalu setujui jika sesuai untuk akun pengujian.
5. Di **Unggah Dokumen**, pilih kategori `Sertifikat Dosen`.
6. Isi `Nama pemilik dokumen` (contoh: `Dosen Uji`) dan keterangan.
7. Pilih satu PDF/DOCX/JPG untuk diuji, lalu klik **Upload ke Google Drive**.
8. Pastikan pesan sukses ditampilkan; buka folder `ARSIP_JTE_PNJ/Sertifikat Dosen/` di Google Drive dan periksa apakah file ada.
9. Pada **Cari Dokumen**, pilih kategori, isi sebagian nama file, kemudian klik **Tampilkan Dokumen**.
10. Klik nama file hasil pencarian untuk membuka file melalui Google Drive.

Berkas dapat diubah kategorinya dengan mengunggah ulang ke kategori lain atau memindahkannya langsung di Google Drive. Contoh ini belum menyediakan tombol pindah/hapus.

---

## H. Jika terjadi error

| Gejala | Kemungkinan penyebab | Solusi |
| --- | --- | --- |
| `origin_mismatch` / `Not a valid origin` | Domain GitHub Pages belum didaftarkan atau format salah | Tambahkan `https://NAMA-AKUN.github.io` **tanpa** path repo di Authorized JavaScript origins |
| `access_denied` | Akun tidak masuk daftar Test users atau izin ditolak | Tambahkan alamat penguji dan pilih akun yang benar |
| `403 Insufficient Permission` | Pengguna tidak memiliki izin Editor ke folder atau scope tidak diberikan | Periksa Share folder dan otorisasi Google |
| `404 File not found` | ID folder keliru, folder terhapus, atau akun tidak memiliki akses | Salin ulang ID folder dari URL dan cek Share |
| `Google Identity Services belum dimuat` | Internet terputus atau browser memblokir skrip | Coba jaringan/browser lain; izinkan popup yang sah |
| `redirect_uri_mismatch` | Konfigurasi metode OAuth tidak sesuai | Gunakan token client popup pada contoh ini; cek origin yang benar |
| Upload file besar gagal | Jaringan putus pada sesi upload | Ulangi upload. Prototipe tidak melakukan lanjut otomatis per chunk |
| Dokumen tidak muncul | Pencarian hanya berdasarkan nama file, salah kategori, atau lebih dari batas hasil | Pilih kategori tepat, cari nama file lebih spesifik |
| 404 di alamat GitHub Pages | GitHub Pages belum dipublikasikan atau nama repo salah | Periksa Settings > Pages, branch `main`, folder `/(root)` |

---

## I. Rekomendasi pengembangan ke sistem akreditasi JTE sungguhan

Untuk dosen, Kaprodi, dan tim akreditasi, kebutuhan bukan sekadar unggah dan cari file. Arsitektur produksi yang disarankan:

- **Frontend:** GitHub Pages (atau hosting frontend lain).
- **Identitas:** Google Workspace SSO (akun kampus) / Google OAuth.
- **Backend tepercaya:** layanan autentikasi/otorisasi terpisah (misalnya Cloud Run + database), **bukan** hanya logika JavaScript di GitHub Pages.
- **Penyimpanan:** Google Workspace Shared drives jika tersedia, supaya file dimiliki organisasi, bukan pemilik pribadi.
- **Database metadata:** bisa menggunakan database terkelola; untuk kebutuhan sederhana Google Sheets dapat dipakai sebagai indeks, tetapi peran dan audit harus tetap ditegakkan backend.
- **RBAC:** Admin/Kajur, Kaprodi, Dosen, Tim Akreditasi, dengan akses yang ditentukan backend dan izin Google Drive.
- **Struktur:** `Arsip JTE / Dosen / [ID Dosen] / [Jenis Dokumen]` serta `Arsip JTE / Akreditasi / [Prodi] / [Kriteria]` **jika** model izin dipikirkan dengan benar. Jangan sekadar memberi Editor pada folder root kepada semua orang sambil menganggap folder dosen privat.
- **Backup:** kebijakan retensi, ekspor/backup berkala ke lokasi berbeda, pemulihan, audit, dan penanggung jawab data.

**Poin penting:** GitHub Pages tidak dapat mengelola backend atau rahasia secara aman karena hanya mengirim HTML/CSS/JS ke browser. Menyembunyikan tombol menu dengan JavaScript **bukan** pengamanan data.

---

## Referensi resmi

1. GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
2. Google Identity Services token model: https://developers.google.com/identity/oauth2/web/guides/use-token-model
3. Setup Google OAuth client: https://developers.google.com/workspace/drive/api/quickstart/js
4. OAuth Drive scopes: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
5. Upload ke Google Drive API: https://developers.google.com/workspace/drive/api/guides/manage-uploads
6. Membuat folder Drive: https://developers.google.com/workspace/drive/api/guides/folder
7. Shared drives: https://developers.google.com/workspace/drive/api/guides/about-shareddrives
