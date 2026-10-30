'use strict';

// Contoh sederhana: browser -> Google Drive API langsung, tanpa server.
// BUKAN aplikasi dengan otorisasi peran Kaprodi/Dosen/Tim Akreditasi.
// Otorisasi dokumen ditentukan pengaturan Share pada Google Drive.
const CONFIG = window.JTE_CONFIG;
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MAX_MULTIPART_SIZE = 5 * 1024 * 1024;
const MAX_PAGES_PER_CATEGORY = 3; // Maks. 300 hasil per kategori

let accessToken = null;
let expiresAt = 0;
let tokenClient = null;
const folderIds = new Map();
const byId = (id) => document.getElementById(id);

function showMessage(message, type = 'info') {
  const el = byId('message');
  el.textContent = message;
  el.className = `message ${type}`;
}
function setConnection(message) { byId('connectionStatus').textContent = message; }
function requireConfig() {
  if (!CONFIG || !CONFIG.CLIENT_ID || CONFIG.CLIENT_ID.startsWith('ISI_') ||
      !CONFIG.ROOT_FOLDER_ID || CONFIG.ROOT_FOLDER_ID.startsWith('ISI_')) {
    throw new Error('Isi CLIENT_ID dan ROOT_FOLDER_ID pada config.js terlebih dahulu.');
  }
}
function isAuthorized() { return !!accessToken && Date.now() < expiresAt; }
function toggleButtons() {
  const connected = isAuthorized();
  byId('connectBtn').textContent = connected ? 'Hubungkan ulang Google' : 'Hubungkan Google';
  byId('disconnectBtn').disabled = !connected;
  byId('uploadBtn').disabled = !connected;
  byId('searchBtn').disabled = !connected;
}
function checkToken() {
  if (!isAuthorized()) {
    accessToken = null;
    toggleButtons();
    throw new Error('Sesi akses Google habis. Klik Hubungkan Google lagi.');
  }
}
function escapeDriveQuery(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}
function paramsAsString(obj) { return new URLSearchParams(obj).toString(); }

async function driveRequest(path, options = {}) {
  checkToken();
  const { headers = {}, ...rest } = options;
  const response = await fetch(`${DRIVE_API}/${path}`, {
    ...rest,
    headers: { Authorization: `Bearer ${accessToken}`, ...headers }
  });
  return parseDriveResponse(response);
}
async function parseDriveResponse(response) {
  const body = await response.text();
  let data = {};
  try { data = body ? JSON.parse(body) : {}; } catch { data = {}; }
  if (!response.ok) {
    const detail = data?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Google Drive API: ${detail}`);
  }
  return data;
}
async function findCategoryFolder(name) {
  const q = `'${escapeDriveQuery(CONFIG.ROOT_FOLDER_ID)}' in parents and name = '${escapeDriveQuery(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const params = paramsAsString({ q, pageSize: '100', fields: 'files(id,name),nextPageToken', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
  const data = await driveRequest(`files?${params}`);
  return data.files?.[0]?.id ?? null;
}
async function categoryFolder(name) {
  if (folderIds.has(name)) return folderIds.get(name);
  let id = await findCategoryFolder(name);
  if (!id) {
    const data = await driveRequest('files?' + paramsAsString({ fields: 'id,name', supportsAllDrives: 'true' }), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [CONFIG.ROOT_FOLDER_ID] })
    });
    id = data.id;
  }
  folderIds.set(name, id);
  return id;
}
function fileMetadata(file, parentFolderId) {
  const pemilik = byId('pemilik').value.trim();
  const keterangan = byId('description').value.trim();
  return {
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    parents: [parentFolderId],
    description: [pemilik && `Pemilik: ${pemilik}`, keterangan && `Keterangan: ${keterangan}`].filter(Boolean).join(' | ')
  };
}
async function uploadMultipart(file, metadata) {
  const boundary = `jte_${crypto.randomUUID().replaceAll('-', '')}`;
  const contentType = file.type || 'application/octet-stream';
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    file,
    `\r\n--${boundary}--\r\n`
  ]);
  const response = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  });
  return parseDriveResponse(response);
}
async function uploadResumable(file, metadata) {
  const initResponse = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,webViewLink&supportsAllDrives=true`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': file.type || 'application/octet-stream',
      'X-Upload-Content-Length': String(file.size)
    },
    body: JSON.stringify(metadata)
  });
  if (!initResponse.ok) return parseDriveResponse(initResponse);
  const sessionUrl = initResponse.headers.get('Location');
  if (!sessionUrl) throw new Error('Google Drive tidak mengembalikan URL sesi unggah.');
  const uploadResponse = await fetch(sessionUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file
  });
  return parseDriveResponse(uploadResponse);
}
async function uploadFile(event) {
  event.preventDefault();
  const btn = byId('uploadBtn');
  try {
    checkToken();
    const file = byId('documentFile').files[0];
    if (!file) throw new Error('Pilih file yang ingin diunggah.');
    btn.disabled = true;
    const selected = byId('categoryUpload').value;
    showMessage('Mempersiapkan folder dokumen ...');
    const id = await categoryFolder(selected);
    const metadata = fileMetadata(file, id);
    showMessage(`Mengunggah ${file.name} (${formatBytes(file.size)}) ...`);
    const created = file.size <= MAX_MULTIPART_SIZE
      ? await uploadMultipart(file, metadata)
      : await uploadResumable(file, metadata);
    showMessage(`Berhasil: ${created.name || file.name} telah disimpan ke folder ${selected}.`, 'ok');
    byId('uploadForm').reset();
    await searchFiles();
  } catch (err) {
    showMessage(err.message || 'Upload gagal.', 'err');
  } finally {
    btn.disabled = !isAuthorized();
  }
}
async function listFilesInCategory(name, query) {
  const folderId = await categoryFolder(name);
  let pageToken = '';
  let pages = 0;
  const all = [];
  do {
    const safeQuery = escapeDriveQuery(query);
    const q = `'${folderId}' in parents and trashed = false` +
      (query ? ` and name contains '${safeQuery}'` : '');
    const params = {
      q,
      fields: 'nextPageToken,files(id,name,mimeType,size,description,modifiedTime,webViewLink)',
      orderBy: 'modifiedTime desc',
      pageSize: '100',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true'
    };
    if (pageToken) params.pageToken = pageToken;
    const page = await driveRequest(`files?${paramsAsString(params)}`);
    all.push(...(page.files || []).map(file => ({ ...file, kategori: name })));
    pageToken = page.nextPageToken || '';
    pages++;
  } while (pageToken && pages < MAX_PAGES_PER_CATEGORY);
  return { files: all, truncated: !!pageToken };
}
function formatBytes(size) {
  if (!size) return '0 B';
  const unit = Math.min(Math.floor(Math.log(size) / Math.log(1024)), 3);
  return `${(size / 1024 ** unit).toFixed(unit ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}
function fileExtension(name) {
  const ext = name.split('.').pop()?.toUpperCase() || 'FILE';
  return ext.length <= 5 ? ext : 'FILE';
}
function createNode(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
function renderResults(files, truncated) {
  const container = byId('results');
  container.replaceChildren();
  byId('resultCount').textContent = `${files.length} file${truncated ? '+' : ''}`;
  if (!files.length) {
    container.append(createNode('p', 'empty', 'Tidak ada dokumen yang cocok.'));
    return;
  }
  for (const file of files) {
    const item = createNode('article', 'result-item');
    item.append(createNode('span', 'doc-icon', fileExtension(file.name)));
    const info = createNode('div', 'doc-info');
    const link = createNode('a', 'doc-name', file.name);
    // URL dibangun dari ID file yang dikembalikan oleh Drive API.
    link.href = `https://drive.google.com/open?id=${encodeURIComponent(file.id)}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    info.append(link);
    const date = file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString('id-ID') : '-';
    info.append(createNode('p', 'doc-meta', `${file.kategori} · ${date} · ${formatBytes(Number(file.size))}`));
    if (file.description) info.append(createNode('p', 'doc-note', file.description));
    item.append(info);
    container.append(item);
  }
}
async function searchFiles(event) {
  if (event) event.preventDefault();
  const btn = byId('searchBtn');
  try {
    checkToken();
    btn.disabled = true;
    showMessage('Mencari arsip di Google Drive ...');
    const category = byId('categorySearch').value;
    const query = byId('query').value.trim();
    const selected = category === '__ALL__' ? CONFIG.CATEGORIES : [category];
    const grouped = await Promise.all(selected.map(name => listFilesInCategory(name, query)));
    const files = grouped.flatMap(group => group.files)
      .sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''));
    const truncated = grouped.some(group => group.truncated);
    renderResults(files, truncated);
    showMessage(truncated
      ? 'Hasil dibatasi 300 file per kategori. Masukkan nama file untuk mempersempit pencarian.'
      : `${files.length} dokumen ditemukan.`, 'ok');
  } catch (err) {
    showMessage(err.message || 'Gagal mengambil dokumen.', 'err');
  } finally {
    btn.disabled = !isAuthorized();
  }
}
function connectGoogle() {
  try {
    requireConfig();
    if (!window.google?.accounts?.oauth2) throw new Error('Google Identity Services belum dimuat. Periksa internet dan coba lagi.');
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: (res) => {
          if (res.error || !res.access_token) {
            showMessage(res.error_description || res.error || 'Izin Google tidak diberikan.', 'err');
            return;
          }
          if (!google.accounts.oauth2.hasGrantedAllScopes(res, DRIVE_SCOPE)) {
            showMessage('Izin Google Drive tidak disetujui.', 'err');
            return;
          }
          accessToken = res.access_token;
          // Sisakan margin waktu agar permintaan tidak dijalankan persis pada akhir masa token.
          expiresAt = Date.now() + Math.max(0, Number(res.expires_in || 3600) - 60) * 1000;
          folderIds.clear();
          setConnection('Akun Google terhubung. Akses file mengikuti izin Google Drive akun yang dipilih.');
          toggleButtons();
          showMessage('Koneksi berhasil. Anda dapat mengunggah atau mencari dokumen.', 'ok');
        },
        error_callback: (err) => showMessage(err?.message || 'Jendela login tidak dapat dibuka.', 'err')
      });
    }
    // Harus dipicu langsung oleh klik pengguna untuk mengizinkan popup Google.
    tokenClient.requestAccessToken({ prompt: isAuthorized() ? '' : 'consent' });
  } catch (err) { showMessage(err.message, 'err'); }
}
function disconnectGoogle() {
  // Hanya membersihkan sesi di aplikasi; TIDAK mengeluarkan pengguna dari akun Google.
  accessToken = null;
  expiresAt = 0;
  folderIds.clear();
  setConnection('Sesi aplikasi diputus. Anda masih mungkin login ke akun Google pada browser.');
  byId('resultCount').textContent = '0 file';
  byId('results').replaceChildren(createNode('p', 'empty', 'Hubungkan akun Google untuk melihat dokumen.'));
  toggleButtons();
  showMessage('Sesi aplikasi telah diputus.', 'ok');
}
function setup() {
  document.title = CONFIG?.APP_NAME || 'Arsip Digital JTE';
  for (const name of CONFIG.CATEGORIES) {
    const a = document.createElement('option'); a.value = name; a.textContent = name;
    byId('categoryUpload').append(a);
    const b = a.cloneNode(true);
    byId('categorySearch').append(b);
  }
  const all = document.createElement('option');
  all.value = '__ALL__'; all.textContent = 'Semua kategori';
  byId('categorySearch').prepend(all);
  byId('connectBtn').addEventListener('click', connectGoogle);
  byId('disconnectBtn').addEventListener('click', disconnectGoogle);
  byId('uploadForm').addEventListener('submit', uploadFile);
  byId('searchForm').addEventListener('submit', searchFiles);
  toggleButtons();
  try { requireConfig(); setConnection('Siap dihubungkan dengan Google Drive.'); }
  catch (err) { setConnection(err.message); }
}
document.addEventListener('DOMContentLoaded', setup);
