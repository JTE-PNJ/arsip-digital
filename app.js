'use strict';
// Arsip Digital JTE PNJ: browser -> Google Drive API (tanpa server).
// Hak akses tetap mengikuti Google Drive, BUKAN izin per dosen di aplikasi.
// File config.js pada repository yang sudah ada TIDAK perlu diubah.
const CONFIG = window.JTE_CONFIG;
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DOSEN_CATEGORY = 'Sertifikat Dosen';
const ALL_DOSEN = '__ALL_DOSEN__';
const MAX_MULTIPART_SIZE = 5 * 1024 * 1024;
const MAX_PAGES_PER_FOLDER = 3; // maksimum 300 dokumen per folder per pencarian
let accessToken = null;
let expiresAt = 0;
let tokenClient = null;
const folderIds = new Map();
let dosenFolders = [];
let dosenFoldersLoaded = false;
let loadingDosen = null;
const byId = id => document.getElementById(id);

function showMessage(message, type = 'info') {
  const el = byId('message');
  el.textContent = message;
  el.className = `message ${type}`;
}
function setConnection(message) { byId('connectionStatus').textContent = message; }
function requireConfig() {
  if (!CONFIG || !CONFIG.CLIENT_ID || CONFIG.CLIENT_ID.startsWith('ISI_') ||
      !CONFIG.ROOT_FOLDER_ID || CONFIG.ROOT_FOLDER_ID.startsWith('ISI_') ||
      !Array.isArray(CONFIG.CATEGORIES) || !CONFIG.CATEGORIES.includes(DOSEN_CATEGORY)) {
    throw new Error('Periksa CLIENT_ID, ROOT_FOLDER_ID, dan kategori Sertifikat Dosen di config.js.');
  }
}
function isAuthorized() { return !!accessToken && Date.now() < expiresAt; }
function toggleButtons() {
  const connected = isAuthorized();
  byId('connectBtn').textContent = connected ? 'Hubungkan ulang Google' : 'Hubungkan Google';
  byId('disconnectBtn').disabled = !connected;
  byId('uploadBtn').disabled = !connected;
  byId('searchBtn').disabled = !connected;
  byId('showNewDosenBtn').disabled = !connected;
  byId('refreshDosenBtn').disabled = !connected;
}
function checkToken() {
  if (!isAuthorized()) {
    accessToken = null;
    toggleButtons();
    throw new Error('Sesi Google habis. Klik Hubungkan Google untuk masuk kembali.');
  }
}
function escapeDriveQuery(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}
function paramsAsString(obj) { return new URLSearchParams(obj).toString(); }
async function parseDriveResponse(response) {
  const body = await response.text();
  let data = {};
  try { data = body ? JSON.parse(body) : {}; } catch { data = {}; }
  if (!response.ok) {
    throw new Error(`Google Drive API: ${data?.error?.message || `HTTP ${response.status}`}`);
  }
  return data;
}
async function driveRequest(path, options = {}) {
  checkToken();
  const { headers = {}, ...rest } = options;
  const response = await fetch(`${DRIVE_API}/${path}`, {
    ...rest,
    headers: { Authorization: `Bearer ${accessToken}`, ...headers }
  });
  return parseDriveResponse(response);
}
async function createDriveFolder(name, parentId) {
  const data = await driveRequest('files?' + paramsAsString({
    fields: 'id,name', supportsAllDrives: 'true'
  }), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] })
  });
  if (!data.id) throw new Error(`Gagal membuat folder: ${name}.`);
  return data;
}
async function findCategoryFolder(name) {
  const q = `'${escapeDriveQuery(CONFIG.ROOT_FOLDER_ID)}' in parents and name = '${escapeDriveQuery(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const params = paramsAsString({ q, pageSize: '100', fields: 'files(id,name),nextPageToken', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
  const data = await driveRequest(`files?${params}`);
  return data.files?.[0]?.id || null;
}
async function categoryFolder(name, createIfMissing = false) {
  if (folderIds.has(name)) return folderIds.get(name);
  let id = await findCategoryFolder(name);
  if (!id && createIfMissing) {
    id = (await createDriveFolder(name, CONFIG.ROOT_FOLDER_ID)).id;
  }
  if (id) folderIds.set(name, id);
  return id;
}
async function listSubfolders(parentId) {
  const all = [];
  let pageToken = '';
  do {
    const q = `'${escapeDriveQuery(parentId)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const params = {
      q, pageSize: '1000', fields: 'nextPageToken,files(id,name)',
      supportsAllDrives: 'true', includeItemsFromAllDrives: 'true'
    };
    if (pageToken) params.pageToken = pageToken;
    const page = await driveRequest(`files?${paramsAsString(params)}`);
    all.push(...(page.files || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return all.sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
}
function createOption(value, text) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = text;
  return opt;
}
function renderDosenOptions(preferredId = '') {
  const upload = byId('dosenUpload');
  const search = byId('dosenSearch');
  const prevUpload = preferredId || upload.value;
  const prevSearch = search.value || ALL_DOSEN;
  upload.replaceChildren();
  search.replaceChildren(createOption(ALL_DOSEN, 'Semua dosen'));
  upload.append(createOption('', dosenFolders.length
    ? '-- Pilih nama dosen --'
    : 'Belum ada folder dosen. Klik Tambah Folder Dosen.'));
  for (const folder of dosenFolders) {
    upload.append(createOption(folder.id, folder.name));
    search.append(createOption(folder.id, folder.name));
  }
  upload.value = dosenFolders.some(f => f.id === prevUpload) ? prevUpload : '';
  search.value = dosenFolders.some(f => f.id === prevSearch) ? prevSearch : ALL_DOSEN;
}
async function refreshDosenFolders(force = false) {
  if (!isAuthorized()) return;
  if (loadingDosen) return loadingDosen;
  if (dosenFoldersLoaded && !force) return;
  loadingDosen = (async () => {
    const parent = await categoryFolder(DOSEN_CATEGORY, false);
    dosenFolders = parent ? await listSubfolders(parent) : [];
    dosenFoldersLoaded = true;
    renderDosenOptions();
  })();
  try { await loadingDosen; }
  finally { loadingDosen = null; }
}
function onUploadCategoryChange() {
  const isDosen = byId('categoryUpload').value === DOSEN_CATEGORY;
  byId('dosenUploadGroup').hidden = !isDosen;
  byId('pemilikGroup').hidden = isDosen;
  byId('pemilik').disabled = isDosen;
  byId('dosenUpload').required = isDosen;
  if (!isDosen) byId('newDosenPanel').hidden = true;
  if (isDosen && isAuthorized()) {
    refreshDosenFolders().catch(err => showMessage(err.message, 'err'));
  }
}
function onSearchCategoryChange() {
  const isDosen = byId('categorySearch').value === DOSEN_CATEGORY;
  byId('dosenSearchGroup').hidden = !isDosen;
  if (isDosen && isAuthorized()) {
    refreshDosenFolders().catch(err => showMessage(err.message, 'err'));
  }
}
function openNewDosenForm() {
  checkToken();
  byId('newDosenPanel').hidden = false;
  byId('newDosenName').focus();
}
function cancelNewDosenForm() {
  byId('newDosenPanel').hidden = true;
  byId('newDosenName').value = '';
}
async function addDosenFolder() {
  const button = byId('saveDosenBtn');
  try {
    checkToken();
    const name = byId('newDosenName').value.trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('Masukkan nama dosen terlebih dahulu.');
    if (name.length > 100 || name === '.' || name === '..' || name.includes('/')) {
      throw new Error('Nama dosen maksimal 100 karakter dan tidak boleh berisi tanda /.');
    }
    button.disabled = true;
    showMessage(`Memeriksa folder dosen: ${name} ...`);
    // Refresh dulu untuk mencegah nama ganda jika dosen ditambahkan dari browser lain.
    await refreshDosenFolders(true);
    const existing = dosenFolders.find(f => f.name.toLocaleLowerCase('id') === name.toLocaleLowerCase('id'));
    if (existing) {
      renderDosenOptions(existing.id);
      showMessage(`Folder ${name} sudah ada. Folder tersebut telah dipilih.`, 'ok');
    } else {
      const parent = await categoryFolder(DOSEN_CATEGORY, true);
      const created = await createDriveFolder(name, parent);
      dosenFolders.push({ id: created.id, name: created.name || name });
      dosenFolders.sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
      renderDosenOptions(created.id);
      showMessage(`Folder "Sertifikat Dosen / ${name}" berhasil dibuat di Google Drive.`, 'ok');
    }
    cancelNewDosenForm();
  } catch (err) { showMessage(err.message || 'Gagal membuat folder dosen.', 'err'); }
  finally { button.disabled = false; }
}
function fileMetadata(file, parentFolderId, pemilik) {
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
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
  return parseDriveResponse(response);
}
async function uploadResumable(file, metadata) {
  const init = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,webViewLink&supportsAllDrives=true`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': file.type || 'application/octet-stream',
      'X-Upload-Content-Length': String(file.size)
    },
    body: JSON.stringify(metadata)
  });
  if (!init.ok) return parseDriveResponse(init);
  const sessionUrl = init.headers.get('Location');
  if (!sessionUrl) throw new Error('Google Drive tidak mengembalikan URL sesi unggah.');
  const result = await fetch(sessionUrl, {
    method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file
  });
  return parseDriveResponse(result);
}
async function uploadFile(event) {
  event.preventDefault();
  const btn = byId('uploadBtn');
  try {
    checkToken();
    const file = byId('documentFile').files[0];
    if (!file) throw new Error('Pilih file yang ingin diunggah.');
    const category = byId('categoryUpload').value;
    let targetFolderId;
    let dosenName = '';
    btn.disabled = true;
    if (category === DOSEN_CATEGORY) {
      const dosenId = byId('dosenUpload').value;
      const folder = dosenFolders.find(f => f.id === dosenId);
      if (!folder) throw new Error('Pilih folder nama dosen atau buat folder dosen terlebih dahulu.');
      targetFolderId = folder.id;
      dosenName = folder.name;
    } else {
      showMessage('Mempersiapkan folder kategori ...');
      targetFolderId = await categoryFolder(category, true);
    }
    const pemilik = dosenName || byId('pemilik').value.trim();
    const metadata = fileMetadata(file, targetFolderId, pemilik);
    showMessage(`Mengunggah ${file.name} (${formatBytes(file.size)}) ...`);
    const created = file.size <= MAX_MULTIPART_SIZE
      ? await uploadMultipart(file, metadata)
      : await uploadResumable(file, metadata);
    const location = dosenName ? `${category} / ${dosenName}` : category;
    showMessage(`Berhasil! ${created.name || file.name} telah disimpan ke ${location}.`, 'ok');
    byId('documentFile').value = '';
    byId('description').value = '';
    byId('pemilik').value = '';
    byId('categorySearch').value = category;
    onSearchCategoryChange();
    byId('dosenSearch').value = dosenName ? targetFolderId : ALL_DOSEN;
    byId('query').value = '';
    await searchFiles();
    showMessage(`Berhasil! ${created.name || file.name} telah disimpan ke ${location}.`, 'ok');
  } catch (err) { showMessage(err.message || 'Upload gagal.', 'err'); }
  finally { btn.disabled = !isAuthorized(); }
}
async function listFilesInFolder(folderId, categoryName, dosenName, query) {
  let pageToken = '';
  let pages = 0;
  const all = [];
  do {
    const safeQuery = escapeDriveQuery(query);
    const q = `'${escapeDriveQuery(folderId)}' in parents and trashed = false and mimeType != '${FOLDER_MIME}'` +
      (query ? ` and name contains '${safeQuery}'` : '');
    const params = {
      q,
      fields: 'nextPageToken,files(id,name,mimeType,size,description,modifiedTime,webViewLink)',
      orderBy: 'modifiedTime desc', pageSize: '100',
      supportsAllDrives: 'true', includeItemsFromAllDrives: 'true'
    };
    if (pageToken) params.pageToken = pageToken;
    const page = await driveRequest(`files?${paramsAsString(params)}`);
    all.push(...(page.files || []).map(file => ({ ...file, kategori: categoryName, dosen: dosenName })));
    pageToken = page.nextPageToken || '';
    pages++;
  } while (pageToken && pages < MAX_PAGES_PER_FOLDER);
  return { files: all, truncated: !!pageToken };
}
async function listFilesInCategory(name, query, selectedDosen = ALL_DOSEN) {
  const folderId = await categoryFolder(name, false);
  if (!folderId) return { files: [], truncated: false };
  if (name !== DOSEN_CATEGORY) return listFilesInFolder(folderId, name, '', query);
  // Sertifikat lama yang sudah ada langsung di kategori tetap terjangkau.
  if (!dosenFoldersLoaded) await refreshDosenFolders(true);
  const folders = selectedDosen === ALL_DOSEN
    ? dosenFolders
    : dosenFolders.filter(folder => folder.id === selectedDosen);
  const jobs = folders.map(folder => ({ id: folder.id, name: folder.name }));
  if (selectedDosen === ALL_DOSEN) jobs.unshift({ id: folderId, name: 'Arsip lama (tanpa folder dosen)' });
  const results = [];
  // Batasi permintaan serentak agar pencarian tidak membanjiri Google Drive API.
  for (let i = 0; i < jobs.length; i += 5) {
    const batch = jobs.slice(i, i + 5);
    results.push(...await Promise.all(batch.map(folder =>
      listFilesInFolder(folder.id, name, folder.name, query)
    )));
  }
  return {
    files: results.flatMap(result => result.files),
    truncated: results.some(result => result.truncated)
  };
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
    link.href = `https://drive.google.com/open?id=${encodeURIComponent(file.id)}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    info.append(link);
    const date = file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString('id-ID') : '-';
    const location = file.kategori + (file.dosen ? ` / ${file.dosen}` : '');
    info.append(createNode('p', 'doc-meta', `${location} · ${date} · ${formatBytes(Number(file.size))}`));
    if (file.description) info.append(createNode('p', 'doc-note', file.description));
    item.append(info);
    container.append(item);
  }
}
async function searchFiles(event) {
  if (event) event.preventDefault();
  const button = byId('searchBtn');
  try {
    checkToken();
    button.disabled = true;
    showMessage('Mencari arsip di Google Drive ...');
    const selectedCategory = byId('categorySearch').value;
    const query = byId('query').value.trim();
    const categories = selectedCategory === '__ALL__' ? CONFIG.CATEGORIES : [selectedCategory];
    const selectedDosen = selectedCategory === DOSEN_CATEGORY ? byId('dosenSearch').value : ALL_DOSEN;
    const grouped = [];
    for (const category of categories) {
      grouped.push(await listFilesInCategory(category, query, selectedDosen));
    }
    const files = grouped.flatMap(group => group.files)
      .sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''));
    const truncated = grouped.some(group => group.truncated);
    renderResults(files, truncated);
    showMessage(truncated
      ? 'Sebagian hasil dibatasi 300 file per folder. Gunakan nama file untuk mempersempit pencarian.'
      : `${files.length} dokumen ditemukan.`, 'ok');
  } catch (err) { showMessage(err.message || 'Gagal mengambil dokumen.', 'err'); }
  finally { button.disabled = !isAuthorized(); }
}
function connectGoogle() {
  try {
    requireConfig();
    if (!window.google?.accounts?.oauth2) throw new Error('Google Identity Services belum dimuat. Coba muat ulang halaman.');
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.CLIENT_ID, scope: DRIVE_SCOPE,
        callback: res => {
          if (res.error || !res.access_token) {
            showMessage(res.error_description || res.error || 'Izin Google tidak diberikan.', 'err');
            return;
          }
          if (!google.accounts.oauth2.hasGrantedAllScopes(res, DRIVE_SCOPE)) {
            showMessage('Izin Google Drive tidak disetujui.', 'err');
            return;
          }
          accessToken = res.access_token;
          expiresAt = Date.now() + Math.max(0, Number(res.expires_in || 3600) - 60) * 1000;
          folderIds.clear();
          dosenFolders = [];
          dosenFoldersLoaded = false;
          renderDosenOptions();
          setConnection('Akun Google terhubung. Akses file mengikuti izin Google Drive akun yang dipilih.');
          toggleButtons();
          showMessage('Koneksi berhasil. Memuat daftar folder dosen ...', 'ok');
          refreshDosenFolders(true).then(() => {
            showMessage(`Koneksi berhasil. ${dosenFolders.length} folder dosen tersedia.`, 'ok');
          }).catch(err => showMessage('Koneksi berhasil, tetapi daftar folder dosen belum dapat dimuat: ' + err.message, 'err'));
        },
        error_callback: err => showMessage(err?.message || 'Jendela login tidak dapat dibuka.', 'err')
      });
    }
    tokenClient.requestAccessToken({ prompt: isAuthorized() ? '' : 'consent' });
  } catch (err) { showMessage(err.message, 'err'); }
}
function disconnectGoogle() {
  accessToken = null;
  expiresAt = 0;
  folderIds.clear();
  dosenFolders = [];
  dosenFoldersLoaded = false;
  renderDosenOptions();
  cancelNewDosenForm();
  setConnection('Sesi aplikasi diputus. Akun Google pada browser tidak otomatis keluar.');
  byId('resultCount').textContent = '0 file';
  byId('results').replaceChildren(createNode('p', 'empty', 'Hubungkan akun Google untuk melihat dokumen.'));
  toggleButtons();
  showMessage('Sesi aplikasi telah diputus.', 'ok');
}
function setup() {
  if (!CONFIG || !Array.isArray(CONFIG.CATEGORIES)) {
    setConnection('config.js tidak valid. Periksa pengaturan aplikasi.');
    return;
  }
  document.title = CONFIG.APP_NAME || 'Arsip Digital JTE';
  for (const name of CONFIG.CATEGORIES) {
    const a = createOption(name, name);
    byId('categoryUpload').append(a);
    byId('categorySearch').append(a.cloneNode(true));
  }
  byId('categorySearch').prepend(createOption('__ALL__', 'Semua kategori'));
  byId('connectBtn').addEventListener('click', connectGoogle);
  byId('disconnectBtn').addEventListener('click', disconnectGoogle);
  byId('uploadForm').addEventListener('submit', uploadFile);
  byId('searchForm').addEventListener('submit', searchFiles);
  byId('categoryUpload').addEventListener('change', onUploadCategoryChange);
  byId('categorySearch').addEventListener('change', onSearchCategoryChange);
  byId('showNewDosenBtn').addEventListener('click', openNewDosenForm);
  byId('cancelNewDosenBtn').addEventListener('click', cancelNewDosenForm);
  byId('saveDosenBtn').addEventListener('click', addDosenFolder);
  byId('newDosenName').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); addDosenFolder(); }
  });
  byId('refreshDosenBtn').addEventListener('click', () => {
    refreshDosenFolders(true)
      .then(() => showMessage(`${dosenFolders.length} folder dosen berhasil diperbarui.`, 'ok'))
      .catch(err => showMessage(err.message, 'err'));
  });
  renderDosenOptions();
  onUploadCategoryChange();
  onSearchCategoryChange();
  toggleButtons();
  try { requireConfig(); setConnection('Siap dihubungkan dengan Google Drive.'); }
  catch (err) { setConnection(err.message); }
}
document.addEventListener('DOMContentLoaded', setup);
