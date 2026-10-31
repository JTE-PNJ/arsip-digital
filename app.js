'use strict';
/* Arsip Digital JTE — GitHub Pages (SPA) + Google Drive API.
 * Google Drive tetap menentukan izin akses. Jangan menyimpan token di GitHub/storage.
 * Tidak ada server, dan aplikasi ini tidak menerapkan hak akses per dosen.
 */
const CONFIG = window.JTE_CONFIG;
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DOSEN_CATEGORY = 'Sertifikat Dosen';
const ALL_DOSEN = '__ALL_DOSEN__';
const MAX_MULTIPART_SIZE = 5 * 1024 * 1024;
const MAX_SEARCH_FOLDERS = 250;
const MAX_SEARCH_RESULTS = 2000;
const byId = id => document.getElementById(id);
let token = null;
let tokenExpiry = 0;
let tokenClient = null;
let currentView = 'home';
let explorerCategory = null;
let explorerTrail = [];
let explorerEntries = [];
let explorerNextPage = '';
let explorerLoadVersion = 0;
let explorerLoading = false;
let dosenFolders = [];
let dosenLoaded = false;
let loadingDosen = null;
const categoryCache = new Map();
const icons = ['📜', '📚', '🔬', '🤝', '🌐', '🗂️'];
const descriptions = [
  'Sertifikat dan dokumen kompetensi berdasarkan nama dosen',
  'Dokumen kegiatan dan bukti pembelajaran',
  'Proposal, laporan, dan luaran penelitian',
  'Kegiatan PkM dan dokumen pendukung',
  'Perjanjian dan bukti kegiatan kemitraan',
  'Bukti dukung, laporan, dan arsip akreditasi'
];

function showMessage(message, type = 'info') {
  const el = byId('message');
  el.textContent = message;
  el.className = `message ${type}`;
}
function setConnection(text) { byId('connectionStatus').textContent = text; }
function create(tag, className = '', text = undefined) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function option(value, text) {
  const el = document.createElement('option');
  el.value = value;
  el.textContent = text;
  return el;
}
function authOK() { return !!token && Date.now() < tokenExpiry; }
function checkToken() {
  if (!authOK()) {
    token = null;
    toggleButtons();
    throw new Error('Sesi Google belum aktif atau habis. Klik “Hubungkan Google”.');
  }
}
function requireConfig() {
  if (!CONFIG || !CONFIG.CLIENT_ID || CONFIG.CLIENT_ID.startsWith('ISI_') ||
    !CONFIG.ROOT_FOLDER_ID || CONFIG.ROOT_FOLDER_ID.startsWith('ISI_') ||
    !Array.isArray(CONFIG.CATEGORIES) || CONFIG.CATEGORIES.length === 0) {
    throw new Error('Pengaturan CLIENT_ID, ROOT_FOLDER_ID, atau CATEGORIES pada config.js tidak valid.');
  }
}
function toggleButtons() {
  const connected = authOK();
  byId('connectBtn').textContent = connected ? 'Hubungkan ulang Google' : 'Hubungkan Google';
  for (const id of ['disconnectBtn','uploadBtn','searchBtn','showNewDosenBtn','refreshDosenBtn']) {
    byId(id).disabled = !connected;
  }
  updateExplorerActions();
}
function quoteQuery(value) {
  return String(value).replaceAll('\\','\\\\').replaceAll("'", "\\'");
}
async function parseResponse(response) {
  const content = await response.text();
  let data = {};
  try { data = content ? JSON.parse(content) : {}; } catch { /* API may return plain text */ }
  if (!response.ok) {
    let detail = data?.error?.message || `HTTP ${response.status}`;
    if (response.status === 403) detail += '. Periksa izin folder di Google Drive atau konfigurasi OAuth.';
    if (response.status === 401) detail += '. Hubungkan ulang akun Google.';
    throw new Error(`Google Drive: ${detail}`);
  }
  return data;
}
async function driveRequest(path, options = {}) {
  checkToken();
  const { headers = {}, ...rest } = options;
  const response = await fetch(`${API}/${path}`, {
    ...rest,
    headers: { Authorization: `Bearer ${token}`, ...headers }
  });
  return parseResponse(response);
}
async function createFolder(name, parentId) {
  const result = await driveRequest('files?fields=id,name&supportsAllDrives=true', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parents: [parentId], mimeType: FOLDER_MIME })
  });
  if (!result.id) throw new Error('Google Drive tidak mengembalikan ID folder baru.');
  return result;
}
async function findCategoryFolder(name) {
  const q = `'${quoteQuery(CONFIG.ROOT_FOLDER_ID)}' in parents and name = '${quoteQuery(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const params = new URLSearchParams({ q, fields: 'nextPageToken,files(id,name)', pageSize: '100', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
  const result = await driveRequest(`files?${params}`);
  return result.files?.[0]?.id || null;
}
async function categoryFolder(name, createIfMissing = false) {
  if (categoryCache.has(name)) return categoryCache.get(name);
  let id = await findCategoryFolder(name);
  if (!id && createIfMissing) id = (await createFolder(name, CONFIG.ROOT_FOLDER_ID)).id;
  if (id) categoryCache.set(name, id);
  return id;
}
async function listChildrenPage(parentId, pageToken = '', pageSize = 200) {
  const params = new URLSearchParams({
    q: `'${quoteQuery(parentId)}' in parents and trashed = false`,
    pageSize: String(pageSize), fields: 'nextPageToken,files(id,name,mimeType,size,description,modifiedTime,webViewLink)',
    orderBy: 'name', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true'
  });
  if (pageToken) params.set('pageToken', pageToken);
  return driveRequest(`files?${params}`);
}
async function listAllChildren(parentId, pageLimit = 10) {
  let next = '';
  const files = [];
  let pages = 0;
  do {
    const result = await listChildrenPage(parentId, next, 1000);
    files.push(...(result.files || []));
    next = result.nextPageToken || '';
    pages++;
  } while (next && pages < pageLimit);
  return { files, truncated: !!next };
}
function validFolderName(raw) {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (!value) throw new Error('Masukkan nama folder terlebih dahulu.');
  if (value.length > 100 || value === '.' || value === '..' || value.includes('/')) {
    throw new Error('Nama folder maksimal 100 karakter dan tidak boleh mengandung /.');
  }
  return value;
}
function iconForCategory(index) { return icons[index % icons.length]; }

function renderCategoryCards() {
  const grid = byId('categoryGrid');
  const sidebar = byId('sidebarCategories');
  grid.replaceChildren();
  sidebar.replaceChildren();
  CONFIG.CATEGORIES.forEach((name, index) => {
    const card = create('button','category-card');
    card.type = 'button';
    const glyph = create('span','category-icon', iconForCategory(index));
    glyph.setAttribute('aria-hidden','true');
    const text = create('span','category-text');
    text.append(create('span','category-title',name),create('span','category-desc',descriptions[index] || 'Buka folder dan dokumen Google Drive'));
    card.append(glyph,text,create('span','category-chevron','›'));
    card.addEventListener('click', () => openCategory(name));
    grid.append(card);
    const side = create('button','sidebar-link', `${iconForCategory(index)}  ${name}`);
    side.type = 'button';
    side.dataset.category = name;
    side.addEventListener('click', () => openCategory(name));
    sidebar.append(side);
  });
  byId('categoryStat').textContent = `${CONFIG.CATEGORIES.length} kategori`;
}
function setView(view) {
  currentView = view;
  byId('homeView').hidden = view !== 'home';
  byId('browseView').hidden = view !== 'browse';
  byId('homeNav').classList.toggle('active', view === 'home');
  byId('browseNav').classList.toggle('active', view === 'browse');
  if (view === 'browse') updateSidebar();
}
function showHome() {
  explorerLoadVersion++;
  setView('home');
}
function showCategoryChooser() {
  explorerCategory = null;
  explorerTrail = [];
  explorerEntries = [];
  explorerNextPage = '';
  explorerLoadVersion++;
  setView('browse');
  renderBreadcrumbs();
  byId('currentFolderName').textContent = 'Pilih kategori arsip';
  byId('currentFolderDescription').textContent = 'Klik salah satu kategori pada menu untuk membuka folder Google Drive.';
  byId('explorerCount').textContent = `${CONFIG.CATEGORIES.length} kategori`;
  const el = byId('explorerContent');
  el.replaceChildren();
  const grid = create('div','folder-grid');
  for (const category of CONFIG.CATEGORIES) {
    const btn = create('button','folder-tile');
    btn.type = 'button';
    btn.append(create('span','folder-symbol','📁'),create('span','',category),create('span','folder-arrow','›'));
    btn.addEventListener('click', () => openCategory(category));
    grid.append(btn);
  }
  el.append(grid);
  byId('loadMoreBtn').hidden = true;
  byId('explorerQuery').value = '';
  updateExplorerActions();
}
function updateSidebar() {
  byId('sidebarCategories').querySelectorAll('[data-category]').forEach(button => {
    button.classList.toggle('active', button.dataset.category === explorerCategory);
  });
}
function renderBreadcrumbs() {
  const nav = byId('breadcrumbs');
  nav.replaceChildren();
  const home = create('button','crumb','Beranda');
  home.type = 'button';
  home.addEventListener('click', showHome);
  nav.append(home);
  explorerTrail.forEach((folder, i) => {
    nav.append(create('span','crumb-sep','/'));
    const crumb = create('button',i === explorerTrail.length - 1 ? 'crumb current' : 'crumb',folder.name);
    crumb.type = 'button';
    crumb.disabled = i === explorerTrail.length - 1;
    if (!crumb.disabled) crumb.addEventListener('click', () => {
      explorerTrail = explorerTrail.slice(0,i+1);
      loadCurrentFolder();
    });
    nav.append(crumb);
  });
}
function currentFolder() { return explorerTrail.at(-1) || null; }
function updateExplorerActions() {
  const folder = currentFolder();
  const canEdit = authOK() && !!explorerCategory;
  byId('createFolderBtn').disabled = !canEdit;
  // Sertifikat Dosen harus masuk ke subfolder dosen, bukan langsung ke folder kategori.
  const isSertifikatRoot = explorerCategory === DOSEN_CATEGORY && explorerTrail.length === 1;
  byId('uploadHereBtn').disabled = !(canEdit && folder?.id) || isSertifikatRoot;
  byId('reloadFolderBtn').disabled = !(canEdit && folder?.id);
  const driveLink = byId('openDriveFolderBtn');
  driveLink.hidden = !(canEdit && folder?.id);
  if (!driveLink.hidden) driveLink.href = `https://drive.google.com/drive/u/0/folders/${encodeURIComponent(folder.id)}`;
  byId('createFolderBtn').textContent = isSertifikatRoot ? '+ Folder Dosen' : '+ Folder Baru';
}
async function openCategory(name) {
  explorerCategory = name;
  explorerTrail = [{ name, id:null }];
  setView('browse');
  byId('explorerQuery').value = '';
  showMessage('');
  await loadCurrentFolder();
}
async function openChildFolder(folder) {
  explorerTrail.push({ id: folder.id, name: folder.name });
  byId('explorerQuery').value = '';
  await loadCurrentFolder();
}
function renderMissingCategory() {
  const el = byId('explorerContent');
  el.replaceChildren();
  el.append(create('div','notice',`Folder “${explorerCategory}” belum ditemukan di Google Drive. Klik “+ Folder Baru” untuk membuat kategori dan subfolder sekaligus. Folder kategori tidak dibuat hanya karena Anda membukanya.`));
  byId('explorerCount').textContent = 'Belum ada folder';
  byId('loadMoreBtn').hidden = true;
}
async function loadCurrentFolder(loadMore = false) {
  if (!explorerCategory) { showCategoryChooser(); return; }
  if (explorerLoading && loadMore) return;
  const version = loadMore ? explorerLoadVersion : ++explorerLoadVersion;
  if (!loadMore) {
    explorerEntries = [];
    explorerNextPage = '';
    byId('newFolderExplorerPanel').hidden = true;
    byId('explorerContent').replaceChildren(create('p','empty','Memuat isi folder dari Google Drive ...'));
    byId('explorerCount').textContent = 'Memuat ...';
  }
  renderBreadcrumbs();
  updateSidebar();
  const folder = currentFolder();
  byId('currentFolderName').textContent = folder?.name || explorerCategory;
  byId('currentFolderDescription').textContent = explorerTrail.length === 1
    ? 'Berisi subfolder dan dokumen dalam kategori ini.'
    : `Lokasi: ${explorerTrail.map(f => f.name).join(' / ')}`;
  updateExplorerActions();
  if (!authOK()) {
    if (version === explorerLoadVersion) {
      byId('explorerContent').replaceChildren(create('div','notice','Hubungkan akun Google terlebih dahulu, kemudian folder dan file akan ditampilkan otomatis.'));
      byId('explorerCount').textContent = 'Belum terhubung';
    }
    return;
  }
  try {
    explorerLoading = true;
    if (!folder.id && explorerTrail.length === 1) {
      const id = await categoryFolder(explorerCategory, false);
      if (version !== explorerLoadVersion) return;
      folder.id = id;
    }
    if (!folder.id) {
      if (version === explorerLoadVersion) renderMissingCategory();
      return;
    }
    const result = await listChildrenPage(folder.id,loadMore ? explorerNextPage : '',200);
    if (version !== explorerLoadVersion) return;
    explorerEntries.push(...(result.files || []));
    explorerNextPage = result.nextPageToken || '';
    renderExplorerEntries();
  } catch (err) {
    if (version === explorerLoadVersion) {
      byId('explorerContent').replaceChildren(create('div','notice',err.message));
      showMessage(err.message,'err');
    }
  } finally { explorerLoading = false; updateExplorerActions(); }
}
function renderExplorerEntries() {
  const content = byId('explorerContent');
  content.replaceChildren();
  const search = byId('explorerQuery').value.trim().toLocaleLowerCase('id');
  const filtered = explorerEntries.filter(f => f.name.toLocaleLowerCase('id').includes(search));
  const folders = filtered.filter(f => f.mimeType === FOLDER_MIME).sort((a,b) => a.name.localeCompare(b.name,'id'));
  const files = filtered.filter(f => f.mimeType !== FOLDER_MIME).sort((a,b) => a.name.localeCompare(b.name,'id'));
  byId('explorerCount').textContent = `${folders.length} folder · ${files.length} file${explorerNextPage ? '+' : ''}`;
  if (!filtered.length) {
    content.append(create('p','empty',search ? 'Nama tidak ditemukan di daftar yang sedang dimuat.' : 'Folder ini masih kosong. Tambahkan subfolder atau unggah dokumen.'));
  }
  if (folders.length) {
    content.append(create('p','file-list-heading',`Folder (${folders.length})`));
    const grid = create('div','folder-grid');
    folders.forEach(folder => {
      const button = create('button','folder-tile');
      button.type = 'button';
      button.append(create('span','folder-symbol','📁'),create('span','',folder.name),create('span','folder-arrow','›'));
      button.addEventListener('click', () => openChildFolder(folder));
      grid.append(button);
    });
    content.append(grid);
  }
  if (files.length) {
    content.append(create('p','file-list-heading',`Dokumen (${files.length})`));
    files.forEach(file => {
      const row = create('div','file-row');
      row.append(create('span','doc-icon',fileExtension(file.name)));
      const info = create('div','doc-info');
      info.append(create('div','doc-name',file.name));
      info.append(create('p','doc-meta',`${formatDate(file.modifiedTime)} · ${formatBytes(Number(file.size || 0))}`));
      if (file.description) info.append(create('p','doc-note',file.description));
      const open = create('a','btn-open','Buka ↗');
      open.href = `https://drive.google.com/open?id=${encodeURIComponent(file.id)}`;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      row.append(info,open);
      content.append(row);
    });
  }
  byId('loadMoreBtn').hidden = !explorerNextPage;
}
function openExplorerNewFolder() {
  if (!authOK()) { showMessage('Hubungkan Google terlebih dahulu.','err'); return; }
  if (!explorerCategory) return;
  byId('newFolderExplorerPanel').hidden = false;
  byId('explorerFolderName').value = '';
  byId('explorerFolderName').placeholder = explorerCategory === DOSEN_CATEGORY && explorerTrail.length === 1
    ? 'Ketik nama dosen' : 'Ketik nama folder baru';
  byId('explorerFolderName').focus();
}
async function createExplorerFolder() {
  const btn = byId('confirmCreateFolderBtn');
  try {
    checkToken();
    const name = validFolderName(byId('explorerFolderName').value);
    const folderAtStart = currentFolder();
    const categoryAtStart = explorerCategory;
    btn.disabled = true;
    const parent = currentFolder();
    if (!parent.id) {
      parent.id = await categoryFolder(explorerCategory,true);
    }
    const existing = await listAllChildren(parent.id,4);
    if (existing.files.some(f => f.mimeType === FOLDER_MIME && f.name.toLocaleLowerCase('id') === name.toLocaleLowerCase('id'))) {
      throw new Error(`Subfolder “${name}” sudah ada. Gunakan folder tersebut.`);
    }
    await createFolder(name,parent.id);
    if (explorerCategory === DOSEN_CATEGORY && explorerTrail.length === 1) dosenLoaded = false;
    byId('newFolderExplorerPanel').hidden = true;
    if (currentFolder() === folderAtStart && explorerCategory === categoryAtStart) {
      await loadCurrentFolder();
    }
    showMessage(`Folder “${name}” berhasil dibuat di Google Drive.`, 'ok');
    if (explorerCategory === DOSEN_CATEGORY) refreshDosenFolders(true).catch(()=>{});
  } catch (err) { showMessage(err.message,'err'); }
  finally { btn.disabled = false; }
}
function formatBytes(value) {
  if (!value) return '0 B';
  const idx = Math.min(Math.floor(Math.log(value)/Math.log(1024)),4);
  return `${(value/1024**idx).toFixed(idx ? 1 : 0)} ${['B','KB','MB','GB','TB'][idx]}`;
}
function formatDate(value) { return value ? new Date(value).toLocaleDateString('id-ID') : 'Tanpa tanggal'; }
function fileExtension(name) {
  const parts = name.split('.');
  const extension = parts.length > 1 ? parts.pop().toUpperCase() : 'FILE';
  return extension.length <= 5 ? extension : 'FILE';
}
function getMetadata(file,parentId,owner = '',description = '') {
  return { name: file.name, mimeType:file.type || 'application/octet-stream', parents:[parentId],
    description:[owner && `Pemilik: ${owner}`,description && `Keterangan: ${description}`].filter(Boolean).join(' | ') };
}
async function uploadMultipart(file,metadata) {
  const boundary = `jte_${crypto.randomUUID().replaceAll('-','')}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
    file,`\r\n--${boundary}--\r\n`
  ]);
  const response = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true`, {
    method:'POST',headers: {Authorization:`Bearer ${token}`,'Content-Type':`multipart/related; boundary=${boundary}`},body
  });
  return parseResponse(response);
}
async function uploadResumable(file,metadata) {
  const init = await fetch(`${UPLOAD_API}/files?uploadType=resumable&fields=id,name,webViewLink&supportsAllDrives=true`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json; charset=UTF-8',
      'X-Upload-Content-Type':file.type || 'application/octet-stream','X-Upload-Content-Length':String(file.size)},
    body:JSON.stringify(metadata)
  });
  if (!init.ok) return parseResponse(init);
  const url = init.headers.get('Location');
  if (!url) throw new Error('Google Drive tidak mengembalikan alamat sesi upload.');
  const response = await fetch(url,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':file.type || 'application/octet-stream'},body:file});
  return parseResponse(response);
}
async function uploadToFolder(file,parentId,owner='',description='') {
  checkToken();
  showMessage(`Mengunggah ${file.name} (${formatBytes(file.size)}) ...`);
  const meta = getMetadata(file,parentId,owner,description);
  const result = file.size <= MAX_MULTIPART_SIZE ? await uploadMultipart(file,meta) : await uploadResumable(file,meta);
  return result;
}
async function uploadFromExplorer() {
  const file = byId('explorerFileInput').files[0];
  if (!file) return;
  const folder = currentFolder();
  const folderId = folder?.id;
  const pathLabel = explorerTrail.map(f=>f.name).join(' / ');
  const button = byId('uploadHereBtn');
  try {
    checkToken();
    if (!folderId) throw new Error('Pilih folder tujuan terlebih dahulu.');
    if (explorerCategory === DOSEN_CATEGORY && explorerTrail.length === 1) throw new Error('Pilih folder nama dosen terlebih dahulu.');
    button.disabled = true;
    const owner = explorerCategory === DOSEN_CATEGORY && explorerTrail.length > 1 ? explorerTrail[1].name : '';
    await uploadToFolder(file,folderId,owner);
    showMessage(`Dokumen “${file.name}” berhasil disimpan ke ${pathLabel}.`,'ok');
    await loadCurrentFolder();
  } catch (err) { showMessage(err.message,'err'); }
  finally { byId('explorerFileInput').value = ''; updateExplorerActions(); }
}

function renderDosenOptions(selectedId = '') {
  const upload = byId('dosenUpload');
  const search = byId('dosenSearch');
  const oldSelected = selectedId || upload.value;
  const oldSearch = search.value || ALL_DOSEN;
  upload.replaceChildren(option('',dosenFolders.length ? '-- Pilih nama dosen --' : 'Belum ada folder dosen. Klik Tambah Folder Dosen.'));
  search.replaceChildren(option(ALL_DOSEN,'Semua dosen'));
  dosenFolders.forEach(folder => {
    upload.append(option(folder.id,folder.name));
    search.append(option(folder.id,folder.name));
  });
  upload.value = dosenFolders.some(f=>f.id === oldSelected) ? oldSelected : '';
  search.value = dosenFolders.some(f=>f.id === oldSearch) ? oldSearch : ALL_DOSEN;
}
async function refreshDosenFolders(force = false) {
  if (!authOK()) return;
  if (loadingDosen) return loadingDosen;
  if (dosenLoaded && !force) return;
  loadingDosen = (async () => {
    const parentId = await categoryFolder(DOSEN_CATEGORY,false);
    const result = parentId ? await listAllChildren(parentId,10) : {files:[]};
    dosenFolders = result.files.filter(file => file.mimeType === FOLDER_MIME)
      .sort((a,b) => a.name.localeCompare(b.name,'id'));
    dosenLoaded = true;
    renderDosenOptions();
  })();
  try { await loadingDosen; } finally {loadingDosen = null;}
}
function onUploadCategoryChange() {
  const dosen = byId('categoryUpload').value === DOSEN_CATEGORY;
  byId('dosenUploadGroup').hidden = !dosen;
  byId('pemilikGroup').hidden = dosen;
  byId('pemilik').disabled = dosen;
  byId('dosenUpload').required = dosen;
  if (dosen && authOK()) refreshDosenFolders().catch(err=>showMessage(err.message,'err'));
}
function onSearchCategoryChange() {
  const dosen = byId('categorySearch').value === DOSEN_CATEGORY;
  byId('dosenSearchGroup').hidden = !dosen;
  if (dosen && authOK()) refreshDosenFolders().catch(err=>showMessage(err.message,'err'));
}
async function addDosenFolder() {
  const button = byId('saveDosenBtn');
  try {
    checkToken();
    const name = validFolderName(byId('newDosenName').value);
    button.disabled = true;
    await refreshDosenFolders(true);
    let found = dosenFolders.find(f=>f.name.toLocaleLowerCase('id') === name.toLocaleLowerCase('id'));
    if (!found) {
      const parent = await categoryFolder(DOSEN_CATEGORY,true);
      found = await createFolder(name,parent);
      dosenLoaded = false;
      await refreshDosenFolders(true);
    }
    renderDosenOptions(found.id);
    byId('newDosenPanel').hidden = true;
    byId('newDosenName').value = '';
    showMessage(`Folder dosen “${name}” tersedia dan telah dipilih.`,'ok');
    if (currentView === 'browse' && explorerCategory === DOSEN_CATEGORY) await loadCurrentFolder();
  } catch(err) {showMessage(err.message,'err');}
  finally {button.disabled = false;}
}
async function submitUpload(event) {
  event.preventDefault();
  const button = byId('uploadBtn');
  try {
    checkToken();
    const file = byId('documentFile').files[0];
    if (!file) throw new Error('Pilih dokumen terlebih dahulu.');
    button.disabled = true;
    const category = byId('categoryUpload').value;
    let targetId, owner='';
    if (category === DOSEN_CATEGORY) {
      const selectedId = byId('dosenUpload').value;
      const found = dosenFolders.find(f=>f.id===selectedId);
      if (!found) throw new Error('Pilih nama dosen atau buat folder dosen terlebih dahulu.');
      targetId = found.id;
      owner = found.name;
    } else {
      targetId = await categoryFolder(category,true);
      owner = byId('pemilik').value.trim();
    }
    await uploadToFolder(file,targetId,owner,byId('description').value.trim());
    byId('documentFile').value = '';
    byId('description').value = '';
    byId('categorySearch').value = category;
    onSearchCategoryChange();
    if (category === DOSEN_CATEGORY) byId('dosenSearch').value = targetId;
    showMessage(`Berhasil mengunggah “${file.name}” ke ${category}${category === DOSEN_CATEGORY ? ` / ${owner}`:''}.`,'ok');
  } catch(err) {showMessage(err.message,'err');}
  finally {button.disabled = !authOK();}
}

async function recursiveSearch(category,search,selectedDosen=ALL_DOSEN) {
  const id = await categoryFolder(category,false);
  if (!id) return {files:[],truncated:false};
  let queue = [{id,path:category}];
  if (category === DOSEN_CATEGORY && selectedDosen !== ALL_DOSEN) {
    const folder = dosenFolders.find(f=>f.id === selectedDosen);
    queue = folder ? [{id:folder.id,path:`${category} / ${folder.name}`}] : [];
  }
  let scanned = 0, truncated = false;
  const found = [];
  const visited = new Set();
  while (queue.length && scanned < MAX_SEARCH_FOLDERS && found.length < MAX_SEARCH_RESULTS) {
    const batch = queue.splice(0,Math.min(4,MAX_SEARCH_FOLDERS-scanned));
    const current = batch.filter(item => !visited.has(item.id));
    current.forEach(item=>visited.add(item.id));
    const results = await Promise.all(current.map(item=>listAllChildren(item.id,3)));
    scanned += current.length;
    results.forEach((data,i) => {
      const parent = current[i];
      truncated ||= data.truncated;
      data.files.forEach(file => {
        if (file.mimeType === FOLDER_MIME) {
          queue.push({id:file.id,path:`${parent.path} / ${file.name}`});
        } else if (!search || file.name.toLocaleLowerCase('id').includes(search)) {
          if (found.length < MAX_SEARCH_RESULTS) found.push({...file,lokasi:parent.path});
          else truncated = true;
        }
      });
    });
  }
  if (queue.length) truncated = true;
  return {files:found,truncated};
}
function renderSearchResults(files,truncated) {
  const el = byId('results');
  el.replaceChildren();
  byId('resultCount').textContent = `${files.length} file${truncated?'+':''}`;
  if (!files.length) {
    el.append(create('p','empty','Tidak ada file yang cocok dalam folder yang dapat diakses.'));
    return;
  }
  for (const file of files) {
    const row = create('article','result-item');
    row.append(create('span','doc-icon',fileExtension(file.name)));
    const info = create('div','doc-info');
    const link = create('a','doc-name',file.name);
    link.href = `https://drive.google.com/open?id=${encodeURIComponent(file.id)}`;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    info.append(link,create('p','doc-meta',`${file.lokasi} · ${formatDate(file.modifiedTime)} · ${formatBytes(Number(file.size || 0))}`));
    if (file.description) info.append(create('p','doc-note',file.description));
    row.append(info);
    el.append(row);
  }
}
async function submitSearch(event) {
  if (event) event.preventDefault();
  const button = byId('searchBtn');
  try {
    checkToken();
    button.disabled = true;
    showMessage('Mencari dokumen di kategori dan subfolder Google Drive ...');
    const category = byId('categorySearch').value;
    const allCats = category === '__ALL__' ? CONFIG.CATEGORIES : [category];
    const selected = category === DOSEN_CATEGORY ? byId('dosenSearch').value : ALL_DOSEN;
    if (category === DOSEN_CATEGORY) await refreshDosenFolders();
    const query = byId('query').value.trim().toLocaleLowerCase('id');
    let files=[],truncated=false;
    for (const name of allCats) {
      const result = await recursiveSearch(name,query,name===DOSEN_CATEGORY ? selected : ALL_DOSEN);
      files.push(...result.files);
      truncated ||= result.truncated;
    }
    files.sort((a,b)=>(b.modifiedTime||'').localeCompare(a.modifiedTime||''));
    renderSearchResults(files,truncated);
    showMessage(truncated
      ? 'Sebagian hasil dibatasi agar pencarian tetap ringan. Pilih satu kategori atau folder dosen untuk mempersempit hasil.'
      : `${files.length} dokumen ditemukan.`,'ok');
  } catch(err) { showMessage(err.message,'err'); }
  finally {button.disabled = !authOK();}
}
function connectGoogle() {
  try {
    requireConfig();
    if (!window.google?.accounts?.oauth2) throw new Error('Layanan login Google belum dimuat. Coba muat ulang halaman.');
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id:CONFIG.CLIENT_ID,scope:DRIVE_SCOPE,
        callback:res => {
          if (res.error || !res.access_token) {showMessage(res.error_description||res.error||'Login Google dibatalkan.','err');return;}
          if (!google.accounts.oauth2.hasGrantedAllScopes(res,DRIVE_SCOPE)) {showMessage('Izin Google Drive tidak disetujui.','err');return;}
          token = res.access_token;
          tokenExpiry = Date.now() + Math.max(0,Number(res.expires_in||3600)-60)*1000;
          categoryCache.clear();
          dosenFolders=[]; dosenLoaded=false;
          renderDosenOptions();
          setConnection('Akun Google terhubung. Folder dan file mengikuti izin Google Drive akun yang dipilih.');
          toggleButtons();
          showMessage('Berhasil terhubung. Memuat daftar folder dari Google Drive ...','ok');
          refreshDosenFolders(true).catch(err=>showMessage(`Login berhasil, tetapi daftar dosen belum dapat dimuat: ${err.message}`,'err'));
          if (currentView === 'browse' && explorerCategory) loadCurrentFolder();
        },
        error_callback:err=>showMessage(err?.message||'Jendela login Google tidak dapat dibuka.','err')
      });
    }
    // Permintaan OAuth harus tetap terjadi dari klik pengguna (bukan otomatis).
    tokenClient.requestAccessToken({prompt:authOK() ? '' : 'consent'});
  } catch(err) {showMessage(err.message,'err');}
}
function disconnectGoogle() {
  token=null; tokenExpiry=0; categoryCache.clear(); dosenFolders=[]; dosenLoaded=false;
  explorerEntries=[]; explorerNextPage=''; explorerLoadVersion++;
  renderDosenOptions();
  byId('newDosenPanel').hidden = true;
  byId('resultCount').textContent = '0 file';
  byId('results').replaceChildren(create('p','empty','Hubungkan akun Google untuk mencari dokumen.'));
  setConnection('Sesi aplikasi diputus. Anda tidak otomatis keluar dari akun Google di browser.');
  toggleButtons();
  if (currentView === 'browse' && explorerCategory) loadCurrentFolder();
  showMessage('Sesi aplikasi diputus.','ok');
}
function setup() {
  if (!CONFIG?.CATEGORIES || !Array.isArray(CONFIG.CATEGORIES)) {
    setConnection('File config.js tidak ditemukan atau formatnya tidak benar.');
    showMessage('Periksa config.js yang sudah tersedia di repository.','err');
    return;
  }
  document.title = 'Arsip Digital JTE PNJ';
  renderCategoryCards();
  for (const cat of CONFIG.CATEGORIES) {
    byId('categoryUpload').append(option(cat,cat));
    byId('categorySearch').append(option(cat,cat));
  }
  byId('categorySearch').prepend(option('__ALL__','Semua kategori'));
  byId('homeNav').addEventListener('click',showHome);
  byId('browseNav').addEventListener('click',showCategoryChooser);
  byId('backHomeBtn').addEventListener('click',showHome);
  byId('connectBtn').addEventListener('click',connectGoogle);
  byId('disconnectBtn').addEventListener('click',disconnectGoogle);
  byId('categoryUpload').addEventListener('change',onUploadCategoryChange);
  byId('categorySearch').addEventListener('change',onSearchCategoryChange);
  byId('uploadForm').addEventListener('submit',submitUpload);
  byId('searchForm').addEventListener('submit',submitSearch);
  byId('showNewDosenBtn').addEventListener('click',()=>{byId('newDosenPanel').hidden=false;byId('newDosenName').focus();});
  byId('cancelNewDosenBtn').addEventListener('click',()=>{byId('newDosenPanel').hidden=true;byId('newDosenName').value='';});
  byId('saveDosenBtn').addEventListener('click',addDosenFolder);
  byId('newDosenName').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addDosenFolder();}});
  byId('refreshDosenBtn').addEventListener('click',()=>refreshDosenFolders(true).then(()=>showMessage(`${dosenFolders.length} folder dosen tersedia.`,'ok')).catch(err=>showMessage(err.message,'err')));
  byId('createFolderBtn').addEventListener('click',openExplorerNewFolder);
  byId('confirmCreateFolderBtn').addEventListener('click',createExplorerFolder);
  byId('cancelCreateFolderBtn').addEventListener('click',()=>{byId('newFolderExplorerPanel').hidden=true;});
  byId('explorerFolderName').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();createExplorerFolder();}});
  byId('uploadHereBtn').addEventListener('click',()=>byId('explorerFileInput').click());
  byId('explorerFileInput').addEventListener('change',uploadFromExplorer);
  byId('reloadFolderBtn').addEventListener('click',()=>loadCurrentFolder());
  byId('explorerQuery').addEventListener('input',()=>{
    if (explorerCategory && currentFolder()?.id && authOK()) renderExplorerEntries();
  });
  byId('loadMoreBtn').addEventListener('click',()=>loadCurrentFolder(true));
  renderDosenOptions();
  onUploadCategoryChange();
  onSearchCategoryChange();
  toggleButtons();
  try {requireConfig();setConnection('Siap dihubungkan dengan Google Drive.');}
  catch(err){setConnection(err.message);}
}
document.addEventListener('DOMContentLoaded',setup);
