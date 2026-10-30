# Arsip Digital JTE PNJ — GitHub Pages + Google Drive

**Paket contoh, bukan aplikasi produksi multiuser dengan manajemen peran.**

Aplikasi ini adalah antarmuka HTML/CSS/JavaScript tanpa backend. Dokumen diunggah langsung dari browser ke Google Drive menggunakan Google Identity Services dan Google Drive API. Aplikasi **tidak menyimpan data di GitHub**.

## Berkas
- `index.html`: halaman utama aplikasi
- `style.css`: tampilan responsif
- `config.js`: dua konfigurasi yang perlu diisi
- `app.js`: login OAuth Google, folder otomatis, upload, pencarian
- `PANDUAN.md`: petunjuk langkah demi langkah

## Cara cepat
1. Buat satu folder `ARSIP_JTE` di Google Drive dan bagikan akses **Editor** kepada akun penguji.
2. Buat proyek Google Cloud; aktifkan **Google Drive API**; siapkan OAuth consent; tambahkan akun penguji jika aplikasi External/Testing.
3. Buat OAuth client bertipe **Web application** dan daftarkan `https://USERNAME.github.io` di *Authorized JavaScript origins*. Jangan tambahkan `/nama-repo` di akhir origin.
4. Di `config.js`, ganti `CLIENT_ID` dan `ROOT_FOLDER_ID`.
5. Unggah berkas ke repo GitHub, pilih **Settings → Pages → Deploy from a branch → main → /(root)**.
6. Kunjungi `https://USERNAME.github.io/NAMA-REPO/`, klik **Hubungkan Google**, setujui akses, lalu uji unggah dan pencarian.

> **Penting:** izin `https://www.googleapis.com/auth/drive` memberikan aplikasi lingkup akses luas terhadap Drive akun yang menyetujui. Google mengklasifikasikannya sebagai *restricted scope* dan penggunaan publik mungkin memerlukan verifikasi. Uji dengan akun percobaan, bukan Drive berisi dokumen sensitif. Untuk aplikasi produksi, pertimbangkan desain izin yang lebih sempit seperti `drive.file` dengan Google Picker dan backend yang menerapkan peran.

## Batasan
- **Tanpa backend**, tidak ada role-based access control (RBAC) aman yang bisa diterapkan hanya melalui JavaScript. Izin nyata bergantung pada mekanisme berbagi Google Drive.
- Berbagi folder induk dengan semua pengguna sebagai **Editor** berarti mereka bisa mengakses isi sesuai izin yang diwarisi; ini **bukan** isolasi dokumen pribadi masing-masing dosen.
- Pencarian pada versi contoh berdasarkan **nama file**, bukan teks dalam dokumen atau seluruh metadata.
- Unggahan file besar menggunakan sesi resumable dengan sekali PUT, **belum mendukung melanjutkan chunk otomatis** jika koneksi putus.
- Pencarian membatasi hasil sampai **300 file per kategori**, dan dapat dipersempit lewat kata kunci.
- Tidak tersedia log audit khusus, persetujuan dokumen, versioning aplikasi, atau backup terjadwal.
- Jangan pernah memasukkan Client Secret, JSON Service Account, API key rahasia, refresh token, atau access token tetap ke repository/GitHub Pages.

## Keamanan dan pengembangan
- `CLIENT_ID` adalah identifier publik (bukan secret), tetapi validasi origin OAuth tetap diperlukan.
- Alamat / ID folder bukan mekanisme otorisasi; selalu atur izin di Google Drive.
- Untuk penggunaan institusi, pertimbangkan Google Workspace **Shared drives** agar kepemilikan file menjadi milik organisasi, bukan akun perorangan.
- Untuk role Kaprodi/Admin/Dosen/Tim Akreditasi dengan folder privat, gunakan backend tepercaya (misalnya Cloud Run / Cloud Functions atau backend lain) yang memvalidasi identitas, hak akses, dan merekam audit.

## Referensi
- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developers.google.com/workspace/drive/api/guides/manage-uploads
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
