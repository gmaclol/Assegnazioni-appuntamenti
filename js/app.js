import { parsePdfFiles } from './pdfParser.js';
import { exportToExcel } from './excelGenerator.js';

// --- MODALITÀ ADMIN SEGRETA (10 click su ⚡ TW) ---
const ADMIN_CLICK_THRESHOLD = 10;
const ADMIN_CLICK_WINDOW_MS = 2000;
const ADMIN_SESSION_KEY = 'tw_admin_session';
let _isAdmin = false;
let _adminClickCount = 0;
let _adminClickTimer = null;

function loadAdminSession() {
  try {
    const saved = localStorage.getItem(ADMIN_SESSION_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      _isAdmin = !!(parsed && parsed.role === 'admin');
    }
  } catch (e) {
    _isAdmin = false;
  }
}

function saveAdminSession() {
  try {
    if (_isAdmin) {
      localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ role: 'admin' }));
    } else {
      localStorage.removeItem(ADMIN_SESSION_KEY);
    }
  } catch (e) {}
}

function setAdminMode(admin) {
  _isAdmin = admin;
  saveAdminSession();
  applyAdminMode();
}

function applyAdminMode() {
  const badge = document.getElementById('logoBadge');
  if (badge) badge.classList.toggle('admin', _isAdmin);
  const guastiBtn = document.getElementById('btnOpenGuastiConfig');
  if (guastiBtn) guastiBtn.style.display = _isAdmin ? '' : 'none';
  const modal = document.getElementById('techManagerModal');
  if (modal && modal.classList.contains('active')) {
    const searchInput = document.getElementById('techSearchModalInput');
    renderTechModalList(searchInput ? searchInput.value.toLowerCase() : '');
  }
}

function initAdminMode() {
  loadAdminSession();
  applyAdminMode();

  const badge = document.getElementById('logoBadge');
  if (!badge) return;

  badge.addEventListener('click', () => {
    if (_adminClickTimer) clearTimeout(_adminClickTimer);
    _adminClickCount++;
    _adminClickTimer = setTimeout(() => { _adminClickCount = 0; }, ADMIN_CLICK_WINDOW_MS);

    if (_adminClickCount >= ADMIN_CLICK_THRESHOLD) {
      _adminClickCount = 0;
      setAdminMode(!_isAdmin);
    }
  });
}


// Stato locale degli appuntamenti
let appuntamenti = [];
let tecniciDisponibili = [];
let tecniciConCasa = [];

// --- TECNICI SETTINGS (Presenze, Ruoli Guasti, Colori Custom) ---
const DEFAULT_COLORS = ['#38bdf8', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#fb7185', '#60a5fa', '#818cf8', '#2dd4bf', '#c084fc'];
let techSettings = loadTechSettings();

// Paletta EXCEL classica (56 colori, mappa ColorIndex -> RGB hex).
// Garantisce che i colori scelti siano identici a quelli che Excel mostra.
const EXCEL_PALETTE = [
  '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
  '#800000', '#008000', '#000080', '#808000', '#800080', '#008080', '#C0C0C0', '#808080',
  '#9999FF', '#993366', '#FFFFCC', '#CCFFFF', '#660066', '#FF8080', '#0066CC', '#CCCCFF',
  '#000080', '#FF00FF', '#FFFF00', '#00FFFF', '#800080', '#800000', '#008080', '#0000FF',
  '#00CCFF', '#CCFFFF', '#CCFFFF', '#99CCFF', '#CC99FF', '#FFCC99', '#3366FF', '#33CCCC',
  '#99CC00', '#FFCC00', '#FF9900', '#FF6600', '#666699', '#969696', '#003366', '#339966',
  '#003300', '#333300', '#993300', '#993366', '#333399', '#333333'
];

function openExcelColorPicker(btn, onPick) {
  const existing = document.getElementById('excelColorPopup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'excelColorPopup';
  popup.className = 'excel-color-popup';
  popup.innerHTML = `
    <div class="excel-color-popup-title">Paletta Excel</div>
    <div class="excel-color-popup-grid">
      ${EXCEL_PALETTE.map(hex => `
        <button type="button" class="excel-color-swatch" data-hex="${hex}" style="background-color:${hex};" title="${hex.toUpperCase()}"></button>
      `).join('')}
    </div>
  `;

  document.body.appendChild(popup);

  // Posizionamento window-aware: resta dentro la viewport, flip sopra se serve
  const rect = btn.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  const margin = 8;
  let left = rect.left;
  let top = rect.bottom + margin;

  // Orizzontale: se sfora a destra/sinistra, rientra
  if (left + popupRect.width > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - popupRect.width - margin);
  }

  // Verticale: se non c'è spazio sotto, mostra sopra il pulsante
  if (top + popupRect.height > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - popupRect.height - margin);
  }

  popup.style.position = 'fixed';
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;

  popup.querySelectorAll('.excel-color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      onPick(sw.dataset.hex);
      popup.remove();
    });
  });

  const closeOnOutside = (e) => {
    if (!popup.contains(e.target) && e.target !== btn) {
      popup.remove();
      document.removeEventListener('mousedown', closeOnOutside);
    }
  };
  document.addEventListener('mousedown', closeOnOutside);
}

function loadTechSettings() {
  try {
    const raw = localStorage.getItem('tw_tech_settings_v1');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveTechSettings() {
  try {
    localStorage.setItem('tw_tech_settings_v1', JSON.stringify(techSettings));
  } catch (e) {
    console.warn('Impossibile salvare impostazioni tecnici in localStorage:', e);
  }
  scheduleWebSettingsPush();
}

// --- COMUNI RILEVATI DAI PDF (Firestore = source of truth, localStorage = cache) ---
let comuniList = [];
let comuniClusters = {};
let disabledComuni = new Set(loadDisabledComuni());
let _comuniLoaded = false;
let _comuniLoadPromise = null;
let _comuniPollTimer = null;
let _lastComuniETag = null;

// Comuni disabilitati manualmente dall'utente nei tecnici guasti.
// Non devono essere riabilitati automaticamente al prossimo scan dei PDF.
function loadDisabledComuni() {
  try {
    const raw = localStorage.getItem('tw_disabled_comuni_v1');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveDisabledComuni() {
  try {
    localStorage.setItem('tw_disabled_comuni_v1', JSON.stringify([...disabledComuni]));
  } catch (e) {}
  scheduleWebSettingsPush();
}

function isComuneDisabled(comune) {
  return disabledComuni.has((comune || '').trim().toLowerCase());
}

function loadComuniList() {
  try {
    const raw = localStorage.getItem('tw_comuni_list_v1');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function loadComuniClusters() {
  try {
    const raw = localStorage.getItem('tw_comuni_clusters_v1');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveComuniList() {
  try {
    localStorage.setItem('tw_comuni_list_v1', JSON.stringify(comuniList));
  } catch (e) {}
  try {
    localStorage.setItem('tw_comuni_clusters_v1', JSON.stringify(comuniClusters));
  } catch (e) {}
  scheduleWebSettingsPush();
}

// Carica da Firestore (source of truth) e aggiorna localStorage come cache
async function loadComuniFromFirestore() {
  if (_comuniLoaded) return;
  if (_comuniLoadPromise) return _comuniLoadPromise;

  _comuniLoadPromise = (async () => {
    try {
      const projectId = 'technicalwork-cloud';
      const res = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/settings/assegnazioni_web`);
      if (!res.ok) throw new Error('Firestore not ok');
      const data = await res.json();

      const onlineComuni = data.fields && data.fields.comuni && data.fields.comuni.arrayValue && data.fields.comuni.arrayValue.values;
      if (onlineComuni) {
        comuniList = onlineComuni.map(v => v.stringValue).filter(Boolean);
        try { localStorage.setItem('tw_comuni_list_v1', JSON.stringify(comuniList)); } catch (e) {}
      }

      const onlineClusters = data.fields && data.fields.comuniClusters && data.fields.comuniClusters.mapValue && data.fields.comuniClusters.mapValue.fields;
      if (onlineClusters) {
        comuniClusters = {};
        for (const [k, v] of Object.entries(onlineClusters)) {
          if (v.stringValue) comuniClusters[k] = v.stringValue;
        }
        try { localStorage.setItem('tw_comuni_clusters_v1', JSON.stringify(comuniClusters)); } catch (e) {}
      }

      const onlineDisabled = data.fields && data.fields.disabledComuni && data.fields.disabledComuni.arrayValue && data.fields.disabledComuni.arrayValue.values;
      if (onlineDisabled) {
        disabledComuni = new Set(onlineDisabled.map(v => v.stringValue).filter(Boolean));
        try { localStorage.setItem('tw_disabled_comuni_v1', JSON.stringify([...disabledComuni])); } catch (e) {}
      }

      // Fallback a localStorage se Firestore vuoto
      if (comuniList.length === 0) {
        comuniList = loadComuniList();
      }
      if (Object.keys(comuniClusters).length === 0) {
        comuniClusters = loadComuniClusters();
      }

      _comuniLoaded = true;
    } catch (e) {
      console.warn('Caricamento comuni da Firestore fallito, uso localStorage:', e);
      comuniList = loadComuniList();
      comuniClusters = loadComuniClusters();
      _comuniLoaded = true;
    }
  })();

  return _comuniLoadPromise;
}

// Polling Firestore per sincronizzare comuni/clusters tra schede (localhost ↔ GitHub Pages)
async function pollComuniFromFirestore() {
  try {
    const projectId = 'technicalwork-cloud';
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/settings/assegnazioni_web`);
    if (!res.ok) return;
    const data = await res.json();

    // Controlla se i dati sono cambiati (semplice confronto JSON)
    const onlineComuni = data.fields && data.fields.comuni && data.fields.comuni.arrayValue && data.fields.comuni.arrayValue.values;
    const onlineClusters = data.fields && data.fields.comuniClusters && data.fields.comuniClusters.mapValue && data.fields.comuniClusters.mapValue.fields;
    const onlineDisabled = data.fields && data.fields.disabledComuni && data.fields.disabledComuni.arrayValue && data.fields.disabledComuni.arrayValue.values;

    const newComuni = onlineComuni ? onlineComuni.map(v => v.stringValue).filter(Boolean) : [];
    const newClusters = {};
    if (onlineClusters) {
      for (const [k, v] of Object.entries(onlineClusters)) {
        if (v.stringValue) newClusters[k] = v.stringValue;
      }
    }
    const newDisabled = onlineDisabled ? onlineDisabled.map(v => v.stringValue).filter(Boolean) : [];

    const comuniChanged = JSON.stringify(newComuni) !== JSON.stringify(comuniList);
    const clustersChanged = JSON.stringify(newClusters) !== JSON.stringify(comuniClusters);
    const disabledChanged = JSON.stringify(newDisabled) !== JSON.stringify([...disabledComuni]);

    if (comuniChanged || clustersChanged || disabledChanged) {
      console.log('[Polling] Dati comuni aggiornati da Firestore');
      comuniList = newComuni.length ? newComuni : comuniList;
      comuniClusters = Object.keys(newClusters).length ? newClusters : comuniClusters;
      disabledComuni = new Set(newDisabled.length ? newDisabled : disabledComuni);
      try { localStorage.setItem('tw_comuni_list_v1', JSON.stringify(comuniList)); } catch (e) {}
      try { localStorage.setItem('tw_comuni_clusters_v1', JSON.stringify(comuniClusters)); } catch (e) {}
      try { localStorage.setItem('tw_disabled_comuni_v1', JSON.stringify([...disabledComuni])); } catch (e) {}
      // Re-render se il modal Guasti è aperto
      const modal = document.getElementById('guastiConfigModal');
      if (modal && modal.classList.contains('active')) {
        const searchInput = document.getElementById('guastiSearchModalInput');
        renderGuastiModalList(searchInput ? searchInput.value.toLowerCase() : '');
      }
    }
  } catch (e) {
    console.warn('Polling comuni fallito:', e);
  }
}

function startComuniPolling() {
  if (_comuniPollTimer) return;
  _comuniPollTimer = setInterval(pollComuniFromFirestore, 15000); // ogni 15 secondi
  console.log('[Polling] Avviato sync comuni ogni 15s');
}

function stopComuniPolling() {
  if (_comuniPollTimer) {
    clearInterval(_comuniPollTimer);
    _comuniPollTimer = null;
    console.log('[Polling] Fermato');
  }
}

function getClusterForComune(comune) {
  const key = (comune || '').trim().toLowerCase();
  return comuniClusters[key] || '';
}

function recordComuneCluster(comune, cluster) {
  const key = (comune || '').trim().toLowerCase();
  if (!key || !cluster) return;
  const prev = comuniClusters[key];
  if (prev && prev !== cluster) {
    comuniClusters[key] = 'both';
  } else {
    comuniClusters[key] = cluster;
  }
}

function getAllTechNames() {
  return new Set([
    ...Object.keys(techSettings),
    ...tecniciDisponibili,
    ...tecniciConCasa.map(t => t.name)
  ]);
}

function isGuastiRole(role) {
  return role === 'guasti_ab' || role === 'guasti_cd';
}

// Abilita un comune SOLO sui tecnici guasti del cluster corrispondente
// I comuni disabilitati manualmente (disabledComuni) non vengono MAI riabilitati.
function enableComuneForGuastiTechs(comune, cluster) {
  if (isComuneDisabled(comune)) return;
  for (const name of getAllTechNames()) {
    const cfg = getTechConfig(name);
    if (!isGuastiRole(cfg.role)) continue;
    const matches = (cluster === 'CD' && cfg.role === 'guasti_cd') ||
                    (cluster === 'AB' && cfg.role === 'guasti_ab');
    if (!matches) continue;
    if (!cfg.comuni.includes(comune)) cfg.comuni.push(comune);
  }
}

// Migrazione una tantum: azzera comuni/appalti pre-cluster per la riscansione
function migrateComuniData() {
  try {
    if (localStorage.getItem('tw_comuni_migration_v2')) return;
    let changed = false;
    for (const name of getAllTechNames()) {
      const cfg = getTechConfig(name);
      if (isGuastiRole(cfg.role)) {
        if (Array.isArray(cfg.comuni) && cfg.comuni.length) {
          cfg.comuni = [];
          changed = true;
        }
        if (Array.isArray(cfg.appalti) && cfg.appalti.length) {
          cfg.appalti = [];
          changed = true;
        }
      }
    }
    if (changed) saveTechSettings();
    if (comuniList.length) {
      comuniList = [];
      saveComuniList();
    }
    comuniClusters = {};
    disabledComuni = new Set();
    try { localStorage.setItem('tw_comuni_clusters_v1', JSON.stringify(comuniClusters)); } catch (e) {}
    try { localStorage.setItem('tw_disabled_comuni_v1', JSON.stringify([])); } catch (e) {}
    scheduleWebSettingsPush();
    localStorage.setItem('tw_comuni_migration_v2', '1');
  } catch (e) {}
}

function ensureAppaltiEnabledForGuastiTechs() {
  let changed = false;
  for (const name of getAllTechNames()) {
    const cfg = getTechConfig(name);
    if (isGuastiRole(cfg.role) && cfg.appalti.length === 0) {
      cfg.appalti = [...companies];
      changed = true;
    }
  }
  if (changed) saveTechSettings();
}

function collectComuni(parsed) {
  let changed = false;
  const existing = new Set(comuniList.map(c => c.toLowerCase()));
  for (const p of parsed) {
    const c = (p.comune || '').trim();
    if (!c) continue;
    const cluster = p.clusterCd || p.areaCd || '';
    if (!cluster) continue;
    if (!existing.has(c.toLowerCase())) {
      existing.add(c.toLowerCase());
      comuniList.push(c);
      recordComuneCluster(c, cluster);
      enableComuneForGuastiTechs(c, cluster);
      changed = true;
    } else {
      recordComuneCluster(c, cluster);
      enableComuneForGuastiTechs(c, cluster);
    }
  }
  if (changed) {
    comuniList.sort((a, b) => a.localeCompare(b, 'it'));
    saveComuniList();
  }
}

// --- SALVATAGGIO ONLINE IMPOSTAZIONI TECNICI (documento dedicato, senza conflitti) ---
let _webSettingsPushTimer = null;

async function loadWebSettingsFromFirestore() {
  try {
    const projectId = 'technicalwork-cloud';
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/settings/assegnazioni_web`);
    if (!res.ok) return;
    const data = await res.json();
    const raw = data.fields && data.fields.data && data.fields.data.stringValue;
    if (!raw) return;
    const online = JSON.parse(raw);
    if (online && typeof online === 'object') {
      Object.assign(techSettings, online);
      try { localStorage.setItem('tw_tech_settings_v1', JSON.stringify(techSettings)); } catch (e) {}
    }
    // comuniList e comuniClusters ora caricati da loadComuniFromFirestore()
  } catch (e) {
    console.warn('Impossibile caricare impostazioni tecnici online:', e);
  }
}

function scheduleWebSettingsPush() {
  if (_webSettingsPushTimer) clearTimeout(_webSettingsPushTimer);
  _webSettingsPushTimer = setTimeout(() => {
    _webSettingsPushTimer = null;
    pushWebSettingsToFirestore();
  }, 800);
}

async function pushWebSettingsToFirestore() {
  try {
    const projectId = 'technicalwork-cloud';
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/settings/assegnazioni_web?updateMask.fieldPaths=data&updateMask.fieldPaths=comuni&updateMask.fieldPaths=comuniClusters&updateMask.fieldPaths=disabledComuni`;
    await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          data: { stringValue: JSON.stringify(techSettings) },
          comuni: { arrayValue: { values: comuniList.map(c => ({ stringValue: c })) } },
          comuniClusters: { mapValue: { fields: Object.fromEntries(
            Object.entries(comuniClusters).map(([k, v]) => [k, { stringValue: v }])
          ) } },
          disabledComuni: { arrayValue: { values: [...disabledComuni].map(c => ({ stringValue: c })) } }
        }
      })
    });
  } catch (e) {
    console.warn('Impossibile salvare impostazioni tecnici online:', e);
  }
}

function getTechConfig(name) {
  if (!name) return { active: true, role: 'normale', color: '#38bdf8', comuni: [], appalti: [] };
  const trimmed = name.trim();
  if (!techSettings[trimmed]) {
    let hash = 0;
    for (let i = 0; i < trimmed.length; i++) hash = trimmed.charCodeAt(i) + ((hash << 5) - hash);
    const color = DEFAULT_COLORS[Math.abs(hash) % DEFAULT_COLORS.length];
    techSettings[trimmed] = { active: true, role: 'normale', color, comuni: [], appalti: [] };
  }
  const cfg = techSettings[trimmed];
  if (!Array.isArray(cfg.comuni)) cfg.comuni = [];
  if (!Array.isArray(cfg.appalti)) cfg.appalti = [];
  return cfg;
}

// Mappa nome tecnico -> colore hex, per lo sfondo nell'export Excel
function buildTechColorsMap() {
  const map = {};
  for (const name of getAllTechNames()) {
    const cfg = getTechConfig(name);
    map[name] = cfg.color || '#38bdf8';
  }
  return map;
}

// --- AZIENDE (lista personalizzabile, persistita in localStorage) ---
const DEFAULT_COMPANIES = ['Elecnor', 'Sertori', 'Sirti'];
let companies = loadCompanies();

function loadCompanies() {
  try {
    const raw = localStorage.getItem('tw_companies_v1');
    return raw ? JSON.parse(raw) : [...DEFAULT_COMPANIES];
  } catch (e) {
    return [...DEFAULT_COMPANIES];
  }
}

function saveCompanies() {
  try {
    localStorage.setItem('tw_companies_v1', JSON.stringify(companies));
  } catch (e) {}
}

function getCompaniesOptionsHtml(selected) {
  return companies.map(c =>
    `<option value="${escapeAttr(c)}" ${c === selected ? 'selected' : ''}>${escapeAttr(c)}</option>`
  ).join('');
}

function initCompanyManager() {
  const btnToggle = document.getElementById('btnToggleCompanyPanel');
  const panel = document.getElementById('companyPanel');
  const addInput = document.getElementById('newCompanyInput');
  const btnAdd = document.getElementById('btnAddCompany');

  if (btnToggle && panel) {
    btnToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('active');
      renderCompanyList();
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.company-wrap')) panel.classList.remove('active');
    });
  }

  if (btnAdd && addInput) {
    const doAdd = () => {
      const val = addInput.value.trim();
      if (val && !companies.includes(val)) {
        companies.push(val);
        saveCompanies();
        renderCompanyList();
        renderTables();
      }
      addInput.value = '';
    };
    btnAdd.addEventListener('click', doAdd);
    addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
  }

  renderCompanyList();
}

function renderCompanyList() {
  const list = document.getElementById('companyList');
  if (!list) return;
  list.innerHTML = '';
  companies.forEach((c, idx) => {
    const row = document.createElement('div');
    row.className = 'company-item';
    row.innerHTML = `<span>${escapeAttr(c)}</span><button class="company-remove-btn" data-idx="${idx}" title="Rimuovi">✕</button>`;
    row.querySelector('.company-remove-btn').addEventListener('click', () => {
      companies.splice(idx, 1);
      saveCompanies();
      renderCompanyList();
      renderTables();
    });
    list.appendChild(row);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initAdminMode();
  initDatePicker();
  initDragAndDrop();
  initButtons();
  initTechManagerModal();
  initGuastiConfigModal();
  initCompanyManager();
  renderTables();
  loadTecnici();
});

const COMPANIES_CONFIG_URL = 'https://raw.githubusercontent.com/gmaclol/Technicalwork-Materiali/master/lists/config.json';
const COMPANIES_CACHE_KEY = 'tw_companies_config';
const COMPANIES_TIME_KEY = 'tw_companies_config_time';

async function loadCompaniesFromConfig() {
  let cachedData, cachedTime;
  try { cachedData = localStorage.getItem(COMPANIES_CACHE_KEY); } catch (e) {}
  try { cachedTime = localStorage.getItem(COMPANIES_TIME_KEY); } catch (e) {}
  const now = Date.now();
  const isExpired = !cachedTime || (now - parseInt(cachedTime) > 86400000);

  if (cachedData && !isExpired) {
    try {
      const config = JSON.parse(cachedData);
      if (Array.isArray(config.companies) && config.companies.length > 0) {
        mergeCompaniesFromConfig(config.companies);
        return;
      }
    } catch (e) {}
  }

  try {
    const res = await fetch(`${COMPANIES_CONFIG_URL}?t=${now}`);
    if (res.ok) {
      const text = await res.text();
      const config = JSON.parse(text);
      if (Array.isArray(config.companies) && config.companies.length > 0) {
        mergeCompaniesFromConfig(config.companies);
        try { localStorage.setItem(COMPANIES_CACHE_KEY, text); } catch (e) {}
        try { localStorage.setItem(COMPANIES_TIME_KEY, now.toString()); } catch (e) {}
        return;
      }
    }
  } catch (e) {
    console.warn('Config aziende non disponibile, uso cache/fallback');
  }

  if (cachedData) {
    try {
      const config = JSON.parse(cachedData);
      if (Array.isArray(config.companies) && config.companies.length > 0) {
        mergeCompaniesFromConfig(config.companies);
      }
    } catch (e) {}
  }
}

function mergeCompaniesFromConfig(list) {
  let changed = false;
  for (const c of list) {
    if (c && !companies.includes(c)) {
      companies.push(c);
      changed = true;
    }
  }
  if (changed) {
    saveCompanies();
    renderCompanyList();
    renderTables();
    let cfgChanged = false;
    for (const name of getAllTechNames()) {
      const cfg = getTechConfig(name);
      if (isGuastiRole(cfg.role)) {
        for (const c of list) {
          if (c && !cfg.appalti.includes(c)) {
            cfg.appalti.push(c);
            cfgChanged = true;
          }
        }
      }
    }
    if (cfgChanged) saveTechSettings();
  }
}

async function loadTecnici() {
  await loadComuniFromFirestore();
  const [result] = await Promise.all([fetchTecniciFromFirestore(), loadWebSettingsFromFirestore(), loadCompaniesFromConfig()]);
  tecniciDisponibili = result.names;
  tecniciConCasa = result.details;
  migrateComuniData();
  ensureAppaltiEnabledForGuastiTechs();
  updateTechActiveCounter();
  if (tecniciDisponibili.length > 0) {
    await autoAssignGuasti();
    renderTables();
  }
  startComuniPolling();
}

function initDatePicker() {
  const dateInput = document.getElementById('dateSelect');
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  dateInput.value = `${yyyy}-${mm}-${dd}`;
}

function initDragAndDrop() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('pdfFileInput');

  // Previene l'apertura del PDF nel browser in caso di drop fuori dalla zona
  window.addEventListener('dragover', (e) => e.preventDefault(), false);
  window.addEventListener('drop', (e) => e.preventDefault(), false);

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (files.length > 0) {
      await processPdfFiles(files);
    }
  });

  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (files.length > 0) {
      await processPdfFiles(files);
      fileInput.value = '';
    }
  });
}

async function processPdfFiles(files) {
  const parsed = await parsePdfFiles(files);
  if (parsed.length > 0) {
    appuntamenti.push(...parsed);
    collectComuni(parsed);
    await autoAssignGuasti();
    sortAppuntamenti();
    renderTables();
  }
}

async function autoAssignGuasti() {
  const allNames = new Set([
    ...Object.keys(techSettings),
    ...tecniciDisponibili,
    ...tecniciConCasa.map(t => t.name)
  ]);

  const abTechs = [];
  const cdTechs = [];

  for (const name of allNames) {
    const cfg = getTechConfig(name);
    if (cfg.active !== false) {
      if (cfg.role === 'guasti_ab') abTechs.push(name);
      if (cfg.role === 'guasti_cd') cdTechs.push(name);
    }
  }

  for (const app of appuntamenti) {
    const isGuasto = app.tipoIntervento === 'Guasto';
    if (!isGuasto) continue;

    const localita = getLocalita(app);
    const appaltoClean = app.appalto ? app.appalto.toLowerCase() : '';
    const comuneKey = (app.comune || '').trim().toLowerCase();

    // Tecnici del cluster: CD -> pool CD, altrimenti (A/B o generico) -> pool AB
    const pool = app.areaCd === 'CD' ? cdTechs : abTechs;
    let targetTech = findClusterTech(pool, comuneKey, appaltoClean);

    // Se nessun tecnico del cluster copre comune+appalto -> tecnico impianti più vicino
    if (!targetTech) {
      targetTech = await findNearestImpiantiTech(app);
    }

    if (targetTech) {
      app.tecnico = targetTech;
      app.tecnicoCentraleExcel = [targetTech, localita, appaltoClean].filter(Boolean).join(' ');
    }
  }
}

function findClusterTech(pool, comuneKey, appaltoKey) {
  for (const name of pool) {
    const cfg = getTechConfig(name);
    const comuni = (cfg.comuni || []).map(c => c.toLowerCase());
    const appalti = (cfg.appalti || []).map(a => a.toLowerCase());
    const comuneOk = comuni.length === 0 || comuni.includes(comuneKey);
    const appaltoOk = appalti.length === 0 || appalti.includes(appaltoKey);
    if (comuneOk && appaltoOk) return name;
  }
  return null;
}

const _comuneGeocodeCache = {};

async function geocodeComune(comune) {
  const key = (comune || '').trim().toLowerCase();
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(_comuneGeocodeCache, key)) return _comuneGeocodeCache[key];
  try {
    await _sleep(1100);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=it&q=${encodeURIComponent(comune + ', Italia')}`,
      { headers: { 'Accept-Language': 'it' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.length > 0) {
      _comuneGeocodeCache[key] = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      return _comuneGeocodeCache[key];
    }
  } catch (e) {
    console.warn('Geocodifica comune fallita:', comune, e);
  }
  _comuneGeocodeCache[key] = null;
  return null;
}

async function findNearestImpiantiTech(app) {
  const candidates = tecniciConCasa.filter(t => {
    const cfg = getTechConfig(t.name);
    const isActive = cfg.active !== false;
    const isNormal = cfg.role === 'normale';
    const hasHome = t.homeLat && t.homeLng && parseFloat(t.homeLat) !== 0;
    return isActive && isNormal && hasHome;
  });

  if (candidates.length === 0) {
    const anyNormal = tecniciConCasa.find(t => {
      const cfg = getTechConfig(t.name);
      return cfg.active !== false && cfg.role === 'normale';
    });
    return anyNormal ? anyNormal.name : null;
  }

  const coords = await geocodeComune(app.comune);
  if (!coords) return candidates[0].name;

  let best = null;
  let bestDist = Infinity;
  for (const t of candidates) {
    const d = haversineDistance(coords.lat, coords.lng, parseFloat(t.homeLat), parseFloat(t.homeLng));
    if (d < bestDist) {
      bestDist = d;
      best = t.name;
    }
  }
  return best;
}

function sortAppuntamenti() {
  appuntamenti.sort((a, b) => {
    const toMin = (s) => {
      if (!s) return 0;
      const parts = s.replace('.', ':').split(':');
      return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
    };

    const minA = toMin(a.orario);
    const minB = toMin(b.orario);

    // 1. Ordina per fascia oraria
    if (minA !== minB) {
      return minA - minB;
    }

    // 2. A parità di orario: le attivazioni/borchie prima, i guasti compatti in fondo alla fascia
    const isGuastoA = a.tipoIntervento === 'Guasto' || Boolean(a.areaCd);
    const isGuastoB = b.tipoIntervento === 'Guasto' || Boolean(b.areaCd);

    if (isGuastoA !== isGuastoB) {
      return isGuastoA ? 1 : -1;
    }

    return 0;
  });
}

function initButtons() {
  document.getElementById('btnExportExcel').addEventListener('click', () => {
    const dateInput = document.getElementById('dateSelect').value;
    let dataFormatted = '';
    if (dateInput) {
      const [yyyy, mm, dd] = dateInput.split('-');
      dataFormatted = `${dd} ${mm} ${yyyy}`;
    }
    exportToExcel(appuntamenti, dataFormatted, buildTechColorsMap());
  });

  document.getElementById('btnAutoAssign').addEventListener('click', () => {
    optimizeAssignments();
  });

  document.getElementById('btnAddRow').addEventListener('click', () => {
    appuntamenti.push({
      id: 'app_' + Math.random().toString(36).substr(2, 9),
      orario: '08:30',
      descrizioneSito: 'ok',
      descrizioneExcel: 'ok',
      tecnicoCentraleExcel: '',
      sezione: 'realizzare',
      appalto: 'Elecnor'
    });
    sortAppuntamenti();
    renderTables();
  });

  document.getElementById('btnClearAll').addEventListener('click', () => {
    if (confirm('Vuoi svuotare tutti gli appuntamenti caricati?')) {
      appuntamenti = [];
      renderTables();
    }
  });
}

function renderTables() {
  sortAppuntamenti();

  const tbodyRealizzare = document.getElementById('tbodyRealizzare');
  const tbodySospendere = document.getElementById('tbodySospendere');
  const tbodyChiudere = document.getElementById('tbodyChiudere');

  tbodyRealizzare.innerHTML = '';
  tbodySospendere.innerHTML = '';
  tbodyChiudere.innerHTML = '';

  const realizzareMerged = appuntamenti.filter(a => a.sezione === 'realizzare' || a.sezione === 'borchia');
  const sospesi = appuntamenti.filter(a => a.sezione === 'sospendere');
  const chiusi = appuntamenti.filter(a => a.sezione === 'chiudere');

  // Aggiorna Stats
  document.getElementById('statTotale').textContent = appuntamenti.length;
  document.getElementById('statRealizzare').textContent = realizzareMerged.length;
  document.getElementById('statSospendere').textContent = sospesi.length;
  document.getElementById('statChiudere').textContent = chiusi.length;

  renderSection(tbodyRealizzare, realizzareMerged);
  renderSection(tbodySospendere, sospesi);
  renderSection(tbodyChiudere, chiusi);
}


function renderSection(tbody, items) {
  if (items.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">Nessun impianto in questa sezione.</td></tr>`;
    return;
  }

  items.forEach(item => {
    const tr = document.createElement('tr');
    const isGuasto = item.tipoIntervento === 'Guasto' || Boolean(item.areaCd) || item.sezione === 'chiudere';
    if (isGuasto) tr.classList.add('row-guasto');
    if (item.sezione === 'borchia') tr.classList.add('row-borchia');
    // Descrizione ESSENZIALE per il sito: VIA + NUMERO + APPARATI DA INSTALLARE
    const descSito = item.descrizioneSito || formatDescrizioneSito(item);
    
    const localita = getLocalita(item);
    const appaltoClean = item.appalto ? item.appalto.toLowerCase() : '';
    
    const techList = tecniciDisponibili.length > 0 ? tecniciDisponibili : [
      "Marco + Andrea + Matias + Francesco", "Marco + Francesco", "Cristian", "Riccardo", "Matias", "Carmelo", "Lombardo", "Mauro", "Stefano", "Piero", "Ramiro", "Enzo"
    ];
    
    const optionsHtml = techList.map(t => {
      const fullValue = [t, localita, appaltoClean].filter(Boolean).join(' ');
      return `<div class="tech-option-item" data-value="${escapeAttr(fullValue)}"><span>${escapeAttr(t)}</span><span class="tech-option-badge">${escapeAttr(localita)}</span></div>`;
    }).join('');

    tr.innerHTML = `
      <td>
        <input type="text" class="input-table" value="${escapeAttr(item.orario)}" data-field="orario" style="width:75px; font-weight:bold;">
      </td>
      <td>
        <input type="text" class="input-table" value="${escapeAttr(descSito)}" data-field="descrizioneSito" placeholder="Via Civico - Apparati da installare">
      </td>
      <td>
        <div class="tech-select-container">
          <input type="text" class="tech-select-input" value="${escapeAttr(item.tecnicoCentraleExcel || item.tecnico || '')}" data-field="tecnicoCentraleExcel" placeholder="Seleziona o digita Tecnico...">
          <span class="tech-select-icon">▼</span>
          <div class="tech-dropdown-panel">
            <div class="tech-search-box">
              <input type="text" class="tech-filter-input" placeholder="Cerca tecnico...">
            </div>
            <div class="tech-options-list">
              ${optionsHtml}
            </div>
          </div>
        </div>
      </td>
      <td>
        <select class="input-table" data-field="sezione">
          <option value="realizzare" ${item.sezione === 'realizzare' ? 'selected' : ''}>🟢 Realizzare</option>
          <option value="sospendere" ${item.sezione === 'sospendere' ? 'selected' : ''}>🟡 Sospendere</option>
          <option value="chiudere" ${item.sezione === 'chiudere' ? 'selected' : ''}>🔴 Chiudere</option>
          <option value="borchia" ${item.sezione === 'borchia' ? 'selected' : ''}>🔵 Borchia</option>
        </select>
      </td>
      <td>
        <select class="badge-azienda-select" data-field="appalto">
          ${getCompaniesOptionsHtml(item.appalto || 'Elecnor')}
        </select>
      </td>
      <td style="text-align:center;">
        <button class="btn-delete-row" title="Elimina riga">🗑️</button>
      </td>
    `;

    // Handlers
    const container = tr.querySelector('.tech-select-container');
    const inputField = container.querySelector('.tech-select-input');
    const dropdownPanel = container.querySelector('.tech-dropdown-panel');
    const filterInput = container.querySelector('.tech-filter-input');
    const optionItems = container.querySelectorAll('.tech-option-item');

    inputField.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.tech-dropdown-panel.active').forEach(panel => {
        if (panel !== dropdownPanel) panel.classList.remove('active');
      });
      dropdownPanel.classList.toggle('active');
      if (dropdownPanel.classList.contains('active')) {
        filterInput.value = '';
        filterInput.focus();
        filterOptions('');
      }
    });

    filterInput.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    filterInput.addEventListener('input', (e) => {
      filterOptions(e.target.value.toLowerCase());
    });

    function filterOptions(searchTerm) {
      optionItems.forEach(opt => {
        const text = opt.textContent.toLowerCase();
        opt.style.display = text.includes(searchTerm) ? 'flex' : 'none';
      });
    }

    optionItems.forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const value = opt.getAttribute('data-value');
        inputField.value = value;
        item.tecnicoCentraleExcel = value;
        dropdownPanel.classList.remove('active');
      });
    });

    inputField.addEventListener('change', (e) => {
      item.tecnicoCentraleExcel = e.target.value;
    });

    // Handlers per gli altri campi
    tr.querySelectorAll('input:not(.tech-select-input):not(.tech-filter-input), select').forEach(input => {
      const handleInput = (e) => {
        const field = e.target.getAttribute('data-field');
        if (!field) return;
        item[field] = e.target.value;
        if (field === 'descrizioneSito') {
          item.descrizioneExcel = e.target.value;
        }
        if (field === 'orario' || field === 'sezione') {
          renderTables();
        }
      };
      input.addEventListener('change', handleInput);
      input.addEventListener('input', handleInput);
    });

    tr.querySelector('.btn-delete-row').addEventListener('click', () => {
      appuntamenti = appuntamenti.filter(a => a.id !== item.id);
      renderTables();
    });

    tbody.appendChild(tr);
  });
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.tech-select-container')) {
    document.querySelectorAll('.tech-dropdown-panel.active').forEach(panel => {
      panel.classList.remove('active');
    });
  }
  if (!e.target.closest('.tech-filter-dropdown-container')) {
    const techPanel = document.getElementById('techFilterPanel');
    if (techPanel) techPanel.classList.remove('active');
  }
});

function initTechManagerModal() {
  const btnOpen = document.getElementById('btnOpenTechManager');
  const btnClose = document.getElementById('btnCloseTechModal');
  const btnSave = document.getElementById('btnSaveTechModal');
  const modal = document.getElementById('techManagerModal');
  const searchInput = document.getElementById('techSearchModalInput');
  const btnAll = document.getElementById('btnSelectAllTechsModal');
  const btnNone = document.getElementById('btnDeselectAllTechsModal');

  if (btnOpen && modal) {
    btnOpen.addEventListener('click', () => {
      renderTechModalList(searchInput ? searchInput.value.toLowerCase() : '');
      modal.classList.add('active');
    });
  }

  if (btnClose && modal) {
    btnClose.addEventListener('click', () => {
      modal.classList.remove('active');
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });
  }

  if (btnSave && modal) {
    btnSave.addEventListener('click', async () => {
      saveTechSettings();
      await autoAssignGuasti();
      renderTables();
      updateTechActiveCounter();
      modal.classList.remove('active');
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderTechModalList(searchInput.value.toLowerCase());
    });
  }

  if (btnAll) {
    btnAll.addEventListener('click', () => {
      const list = meGetTechList();
      list.forEach(t => {
        const cfg = getTechConfig(t.name);
        cfg.active = true;
      });
      saveTechSettings();
      renderTechModalList(searchInput ? searchInput.value.toLowerCase() : '');
      updateTechActiveCounter();
    });
  }

  if (btnNone) {
    btnNone.addEventListener('click', () => {
      const list = meGetTechList();
      list.forEach(t => {
        const cfg = getTechConfig(t.name);
        cfg.active = false;
      });
      saveTechSettings();
      renderTechModalList(searchInput ? searchInput.value.toLowerCase() : '');
      updateTechActiveCounter();
    });
  }
}

function meGetTechList() {
  return tecniciConCasa.length > 0 ? tecniciConCasa : tecniciDisponibili.map(name => ({ name }));
}

function initGuastiConfigModal() {
  const btnOpen = document.getElementById('btnOpenGuastiConfig');
  const btnClose = document.getElementById('btnCloseGuastiModal');
  const btnSave = document.getElementById('btnSaveGuastiModal');
  const btnClearComuni = document.getElementById('btnClearComuniGuasti');
  const modal = document.getElementById('guastiConfigModal');
  const searchInput = document.getElementById('guastiSearchModalInput');

  if (btnOpen && modal) {
    btnOpen.addEventListener('click', () => {
      renderGuastiModalList(searchInput ? searchInput.value.toLowerCase() : '');
      modal.classList.add('active');
    });
  }

  if (btnClose && modal) {
    btnClose.addEventListener('click', () => {
      modal.classList.remove('active');
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });
  }

  if (btnSave && modal) {
    btnSave.addEventListener('click', async () => {
      saveTechSettings();
      await autoAssignGuasti();
      renderTables();
      modal.classList.remove('active');
    });
  }

  if (btnClearComuni) {
    btnClearComuni.addEventListener('click', async () => {
      if (!confirm('Svuotare TUTTI i comuni, i cluster e le associazioni comuni/appalti dei tecnici guasti? Dovrai riscansionare i PDF.')) return;
      try {
        // Reset locale
        comuniList = [];
        comuniClusters = {};
        disabledComuni = new Set();
        localStorage.removeItem('tw_comuni_list_v1');
        localStorage.removeItem('tw_comuni_clusters_v1');
        localStorage.removeItem('tw_disabled_comuni_v1');
        localStorage.removeItem('tw_comuni_migration_v2');
        // Reset sui tecnici guasti
        for (const name of getAllTechNames()) {
          const cfg = getTechConfig(name);
          if (isGuastiRole(cfg.role)) {
            cfg.comuni = [];
            cfg.appalti = [];
          }
        }
        saveTechSettings();
        // Push su Firestore
        await pushWebSettingsToFirestore();
        // Re-render
        renderGuastiModalList(searchInput ? searchInput.value.toLowerCase() : '');
        showOptToast('Comuni e cluster svuotati. Riscansiona i PDF.', 'success');
      } catch (e) {
        console.error('Errore svuotamento comuni:', e);
        showOptToast('Errore durante lo svuotamento', 'error');
      }
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderGuastiModalList(searchInput.value.toLowerCase());
    });
  }
}

function renderGuastiModalList(filterTerm = '') {
  const container = document.getElementById('guastiModalList');
  if (!container) return;

  container.innerHTML = '';
  const list = meGetTechList();
  const guastiTechs = list.filter(t => {
    const cfg = getTechConfig(t.name);
    return cfg.role === 'guasti_ab' || cfg.role === 'guasti_cd';
  });

  if (guastiTechs.length === 0) {
    container.innerHTML = '<div style="padding:20px;color:#94a3b8;text-align:center;">Nessun tecnico con ruolo Guasti. Impostalo in "Gestione Tecnici" (modalità admin).</div>';
    return;
  }

  const filtered = guastiTechs.filter(t => t.name.toLowerCase().includes(filterTerm));

  filtered.forEach(t => {
    const cfg = getTechConfig(t.name);
    const row = document.createElement('div');
    row.className = 'tech-modal-row';

    row.innerHTML = `
      <div class="tech-modal-row-main">
        <div class="tech-modal-row-left">
          <span class="tech-modal-name">${escapeAttr(t.name)}</span>
          <span style="font-size:11px;color:${cfg.role === 'guasti_ab' ? '#fbbf24' : '#f472b6'};font-weight:600;">${cfg.role === 'guasti_ab' ? 'Cluster A/B' : 'Cluster C/D'}</span>
        </div>
      </div>
      <div class="tech-guasti-scope">
        <div class="tech-guasti-scope-title">🏙️ Comuni abilitati</div>
        <div class="tech-guasti-chips">${comuniList.map(c => `
          <label class="tech-guasti-chip ${(cfg.comuni || []).includes(c) ? 'on' : ''}">
            <input type="checkbox" class="guasti-comune-cb" value="${escapeAttr(c)}" ${(cfg.comuni || []).includes(c) ? 'checked' : ''}> ${escapeAttr(c)}
          </label>`).join('') || '<span style="color:#64748b;font-size:11px;">Nessun comune rilevato. Scansiona i PDF.</span>'}
        </div>
        <div class="tech-guasti-scope-title">🏢 Appalti abilitati</div>
        <div class="tech-guasti-chips">${companies.map(a => `
          <label class="tech-guasti-chip ${(cfg.appalti || []).includes(a) ? 'on' : ''}">
            <input type="checkbox" class="guasti-appalto-cb" value="${escapeAttr(a)}" ${(cfg.appalti || []).includes(a) ? 'checked' : ''}> ${escapeAttr(a)}
          </label>`).join('')}
        </div>
      </div>
    `;

    row.querySelectorAll('.guasti-comune-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const comune = cb.value;
        if (cb.checked) {
          if (!cfg.comuni.includes(comune)) cfg.comuni.push(comune);
          disabledComuni.delete(comune.trim().toLowerCase());
        } else {
          cfg.comuni = cfg.comuni.filter(c => c !== comune);
          disabledComuni.add(comune.trim().toLowerCase());
        }
        saveDisabledComuni();
        saveTechSettings();
      });
    });

    row.querySelectorAll('.guasti-appalto-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (!cfg.appalti.includes(cb.value)) cfg.appalti.push(cb.value);
        } else {
          cfg.appalti = cfg.appalti.filter(a => a !== cb.value);
        }
        saveTechSettings();
      });
    });

    container.appendChild(row);
  });
}

function updateTechActiveCounter() {
  const list = meGetTechList();
  const activeCount = list.filter(t => getTechConfig(t.name).active !== false).length;
  const countSpan = document.getElementById('techActiveCount');
  if (countSpan) {
    countSpan.textContent = `${activeCount}/${list.length}`;
  }
}

function renderTechModalList(filterTerm = '') {
  const container = document.getElementById('techModalList');
  if (!container) return;

  container.innerHTML = '';
  const list = meGetTechList();
  updateTechActiveCounter();

  if (list.length === 0) {
    container.innerHTML = '<div style="padding:20px;color:#94a3b8;text-align:center;">Caricamento tecnici in corso...</div>';
    return;
  }

  const filtered = list.filter(t => t.name.toLowerCase().includes(filterTerm));

  filtered.forEach(t => {
    const cfg = getTechConfig(t.name);
    const row = document.createElement('div');
    row.className = 'tech-modal-row';

    const roleHtml = `
      <select class="tech-role-select">
        <option value="normale" ${cfg.role === 'normale' ? 'selected' : ''}>⚙️ Impianti (Normale)</option>
        <option value="guasti_ab" ${cfg.role === 'guasti_ab' ? 'selected' : ''}>🚨 Guasti Cluster A/B (AB)</option>
        <option value="guasti_cd" ${cfg.role === 'guasti_cd' ? 'selected' : ''}>🚨 Guasti Cluster C/D (CD)</option>
      </select>`;

    row.innerHTML = `
      <div class="tech-modal-row-main">
        <div class="tech-modal-row-left">
          <input type="checkbox" class="tech-modal-checkbox" ${cfg.active !== false ? 'checked' : ''} title="Attivo / Ferie">
          <span class="tech-modal-name">${escapeAttr(t.name)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:14px;">
          <button type="button" class="tech-color-btn" data-color="${cfg.color}" style="background-color:${cfg.color};" title="Scegli colore (paletta Excel)"></button>
          ${roleHtml}
        </div>
      </div>
    `;

    const checkbox = row.querySelector('.tech-modal-checkbox');
    const colorBtn = row.querySelector('.tech-color-btn');
    const roleSelect = row.querySelector('.tech-role-select');

    checkbox.addEventListener('change', (e) => {
      cfg.active = e.target.checked;
      saveTechSettings();
      updateTechActiveCounter();
    });

    colorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openExcelColorPicker(colorBtn, (hex) => {
        cfg.color = hex;
        saveTechSettings();
        colorBtn.style.backgroundColor = hex;
        colorBtn.dataset.color = hex;
      });
    });

    if (roleSelect) {
      roleSelect.addEventListener('change', (e) => {
        const newRole = e.target.value;
        if (isGuastiRole(newRole) && cfg.role !== newRole) {
          for (const c of comuniList) {
            const cluster = getClusterForComune(c);
            const matches = (newRole === 'guasti_cd' && cluster !== 'AB') ||
                            (newRole === 'guasti_ab' && cluster !== 'CD');
            if (matches && !cfg.comuni.includes(c)) cfg.comuni.push(c);
          }
          for (const a of companies) {
            if (!cfg.appalti.includes(a)) cfg.appalti.push(a);
          }
        }
        cfg.role = newRole;
        saveTechSettings();
        renderTechModalList(filterTerm);
      });
    }

    container.appendChild(row);
  });
}

function formatDescrizioneSito(item) {
  const parti = [];
  if (item.indirizzo) parti.push(item.indirizzo);
  if (item.telefono) parti.push(`(${item.telefono})`);
  if (item.oloOperatore) parti.push(item.oloOperatore);
  if (item.tipoIntervento === 'Guasto') {
    parti.push('(GUASTO)');
  } else {
    if (item.apparati) parti.push(item.apparati);
  }
  parti.push('ok');
  return parti.join(' ');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/"/g, '&quot;');
}

async function fetchTecniciFromFirestore() {
  try {
    const projectId = 'technicalwork-cloud';
    
    // 1. Leggi hidden_tecnici
    const resHidden = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/settings/hidden_tecnici`);
    const hiddenData = resHidden.ok ? await resHidden.json() : {};
    const hidden = [];
    if (hiddenData.fields && hiddenData.fields.hidden && hiddenData.fields.hidden.arrayValue) {
      const values = hiddenData.fields.hidden.arrayValue.values || [];
      values.forEach(v => {
        if (v.stringValue) hidden.push(v.stringValue.toLowerCase());
      });
    }

    // 2. Leggi devices_names (include coordinate casa)
    const resDev = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/settings/devices_names`);
    const devData = resDev.ok ? await resDev.json() : {};
    const bannedDevices = new Set();
    const deviceNames = {};
    const deviceTypes = {};
    const deviceHomeCoords = {};
    if (devData.fields) {
      for (const [deviceId, fieldVal] of Object.entries(devData.fields)) {
        if (fieldVal.mapValue && fieldVal.mapValue.fields) {
          const f = fieldVal.mapValue.fields;
          const isBanned = f.banned && f.banned.booleanValue;
          const type = f.type && f.type.stringValue;
          const name = (f.name && f.name.stringValue) || (f.webName && f.webName.stringValue) || (f.baseName && f.baseName.stringValue);
          if (isBanned) {
            bannedDevices.add(deviceId.toLowerCase());
          }
          if (name) {
            deviceNames[deviceId.toLowerCase()] = name;
          }
          if (type) {
            deviceTypes[deviceId.toLowerCase()] = type;
          }
          // Estrai coordinate casa del tecnico
          const homeLat = f.homeLat && (f.homeLat.stringValue || String(f.homeLat.doubleValue || ''));
          const homeLng = f.homeLng && (f.homeLng.stringValue || String(f.homeLng.doubleValue || ''));
          const homeAddress = f.homeAddress && f.homeAddress.stringValue;
          if (homeLat && homeLng && homeLat !== '' && homeLng !== '') {
            deviceHomeCoords[deviceId.toLowerCase()] = { homeLat, homeLng, homeAddress: homeAddress || '' };
          }
        }
      }
    }

    // 3. Leggi da Elecnor, Sertori, Sirti
    const appalti = ['Elecnor', 'Sertori', 'Sirti'];
    const techs = new Set();
    const techDetails = new Map();

    for (const appalto of appalti) {
      try {
        const res = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${appalto}`);
        if (!res.ok) continue;
        const data = await res.json();
        const docs = data.documents || [];
        docs.forEach(doc => {
          const pathParts = doc.name.split('/');
          const docId = pathParts[pathParts.length - 1];
          if (docId.includes('_2026-') || docId.includes('_2025-')) return;
          if (bannedDevices.has(docId.toLowerCase())) return;

          const fields = doc.fields || {};
          const docType = (fields.type && fields.type.stringValue) || deviceTypes[docId.toLowerCase()];
          if (docType === 'web') return;

          const techName = (fields.tecnico && fields.tecnico.stringValue) || deviceNames[docId.toLowerCase()] || docId;
          
          if (techName && !hidden.includes(techName.toLowerCase())) {
            const trimmed = techName.trim();
            techs.add(trimmed);
            // Associa coordinate casa se disponibili
            const homeData = deviceHomeCoords[docId.toLowerCase()];
            if (homeData && !techDetails.has(trimmed)) {
              techDetails.set(trimmed, {
                name: trimmed,
                homeLat: homeData.homeLat,
                homeLng: homeData.homeLng,
                homeAddress: homeData.homeAddress
              });
            }
          }
        });
      } catch (e) {
        console.warn(`Errore fetch appalto ${appalto}:`, e);
      }
    }

    const names = Array.from(techs).sort();
    const details = names.map(n => techDetails.get(n) || { name: n, homeLat: '', homeLng: '', homeAddress: '' });
    return { names, details };
  } catch (err) {
    console.error('Errore durante il caricamento dei tecnici da Firestore:', err);
    return { names: [], details: [] };
  }
}

function getLocalita(item) {
  let localita = '';
  const cent = item.centrale ? item.centrale.toLowerCase() : '';
  
  if (cent.includes('fco')) {
    const match = cent.match(/fco\/?(\d+)/);
    if (match) {
      localita = `Pop${match[1]}`;
    } else {
      localita = 'Pop3';
    }
  } else if (cent.includes('toh')) {
    const match = cent.match(/toh\D*(\d+)/);
    if (match) {
      localita = `toh${match[1]}`;
    } else {
      localita = 'toh1';
    }
  } else {
    localita = item.comune ? item.comune.charAt(0).toUpperCase() + item.comune.slice(1).toLowerCase() : '';
  }
  return localita;
}

// ═══════════════════════════════════════════════════════════════
// OTTIMIZZAZIONE ROTTE — Geocodifica + Haversine + Assegnazione
// ═══════════════════════════════════════════════════════════════

const _geocodeCache = {};

function toMinutes(s) {
  if (!s) return 0;
  const parts = s.replace('.', ':').split(':');
  return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function geocodeForOptimization(address) {
  if (_geocodeCache[address]) return _geocodeCache[address];
  try {
    await _sleep(1100); // Rate limit Nominatim: 1 req/sec
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`,
      { headers: { 'Accept-Language': 'it' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.length > 0) {
      const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      _geocodeCache[address] = result;
      return result;
    }
  } catch (e) {
    console.warn('Geocodifica fallita per:', address, e);
  }
  return null;
}

function showOptToast(message, type) {
  let container = document.getElementById('optToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'optToastContainer';
    container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:100000;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(container);
  }
  const bgMap = { success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
  const toast = document.createElement('div');
  toast.style.cssText = `background:${bgMap[type] || bgMap.info};color:white;padding:12px 20px;border-radius:8px;font-size:14px;font-family:Inter,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3);max-width:420px;animation:fadeIn 0.3s ease;`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 6000);
}

async function optimizeAssignments() {
  const btn = document.getElementById('btnAutoAssign');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> Ottimizzazione in corso...';

  try {
    // 1. Tecnici con coordinate casa configurate E attivi E con ruolo normale (esclude tecnici dedicati ai guasti)
    const activeTechsWithHome = tecniciConCasa.filter(t => {
      const cfg = getTechConfig(t.name);
      const isHomeConfigured = t.homeLat && t.homeLng && parseFloat(t.homeLat) !== 0;
      const isActive = cfg.active !== false;
      const isNormalRole = cfg.role === 'normale'; // Disabilita i tecnici guasti (guasti_ab, guasti_cd) dal calcolo impianti
      return isHomeConfigured && isActive && isNormalRole;
    });

    if (activeTechsWithHome.length === 0) {
      showOptToast('Nessun tecnico impianti attivo selezionato con posizione casa configurata!', 'error');
      return;
    }

    // Leggi il limite massimo di interventi per tecnico (default 4)
    const maxInput = document.getElementById('maxInterventiInput');
    const maxInterventiPerTecnico = parseInt(maxInput ? maxInput.value : 4, 10) || 4;

    // 2. Appuntamenti da realizzare (esclude i guasti che sono gestiti dai tecnici dedicati ed esaminati a parte)
    const toAssign = appuntamenti.filter(a => a.sezione === 'realizzare' && a.tipoIntervento !== 'Guasto' && !a.areaCd);
    if (toAssign.length === 0) {
      showOptToast('Nessun appuntamento da realizzare da assegnare!', 'warning');
      return;
    }

    showOptToast(`Geocodifica di ${toAssign.length} indirizzi in corso...`, 'info');

    // 3. Geocodifica indirizzi appuntamenti
    let geocodedCount = 0;
    for (const app of toAssign) {
      const addressParts = [];
      if (app.indirizzo) {
        addressParts.push(app.indirizzo);
      } else if (app.descrizioneSito) {
        const cleanAddr = app.descrizioneSito.split(/\s+(?:ONT|OLT|GPON|FTTH|ok$)/i)[0].trim();
        if (cleanAddr) addressParts.push(cleanAddr);
      }
      if (app.comune) {
        addressParts.push(app.comune);
      } else {
        addressParts.push('Torino');
      }
      addressParts.push('Italia');

      const address = addressParts.join(', ');
      const coords = await geocodeForOptimization(address);
      if (coords) {
        app._lat = coords.lat;
        app._lng = coords.lng;
        geocodedCount++;
      }
      btn.innerHTML = `<span class="btn-icon">⏳</span> Geocodifica ${geocodedCount}/${toAssign.length}...`;
    }

    const geocoded = toAssign.filter(a => a._lat && a._lng);
    if (geocoded.length === 0) {
      showOptToast('Impossibile geocodificare gli indirizzi degli appuntamenti.', 'error');
      return;
    }

    btn.innerHTML = '<span class="btn-icon">⚡</span> Calcolo rotte ottimali...';

    // 4. Ordina per orario
    geocoded.sort((a, b) => toMinutes(a.orario) - toMinutes(b.orario));

    // 5. Inizializza posizioni tecnici attivi (partono da casa)
    const techState = activeTechsWithHome.map(t => ({
      name: t.name,
      lat: parseFloat(t.homeLat),
      lng: parseFloat(t.homeLng),
      assignedCount: 0,
      totalKm: 0
    }));

    // 6. Algoritmo greedy nearest-neighbor con bilanciamento carico e limite massimo per tecnico
    let unassignedLimitCount = 0;

    for (const app of geocoded) {
      let bestTech = null;
      let bestDist = Infinity;

      for (const tech of techState) {
        // Se il tecnico ha raggiunto il limite max impostato (default 4), lo ignoriamo per questo giro
        if (tech.assignedCount >= maxInterventiPerTecnico) {
          continue;
        }

        const dist = haversineDistance(tech.lat, tech.lng, app._lat, app._lng);
        const loadPenalty = tech.assignedCount * 3;
        const adjustedDist = dist + loadPenalty;
        if (adjustedDist < bestDist) {
          bestDist = adjustedDist;
          bestTech = tech;
        }
      }

      if (bestTech) {
        const realDist = haversineDistance(bestTech.lat, bestTech.lng, app._lat, app._lng);
        const localita = getLocalita(app);
        const appaltoClean = app.appalto ? app.appalto.toLowerCase() : '';
        app.tecnicoCentraleExcel = [bestTech.name, localita, appaltoClean].filter(Boolean).join(' ');
        bestTech.lat = app._lat;
        bestTech.lng = app._lng;
        bestTech.assignedCount++;
        bestTech.totalKm += realDist;
      } else {
        // Tutti i tecnici attivi hanno raggiunto il limite massimo
        unassignedLimitCount++;
      }
    }

    const nonGeocoded = toAssign.filter(a => !a._lat || !a._lng);

    // 7. Re-render tabelle
    renderTables();

    // 8. Riepilogo
    const assigned = techState.filter(t => t.assignedCount > 0);
    showOptToast(`Ottimizzazione completata! ${geocoded.length - unassignedLimitCount} interventi assegnati a ${assigned.length} tecnici`, 'success');
    showOptimizationSummary(assigned, nonGeocoded.length, unassignedLimitCount, maxInterventiPerTecnico);

  } catch (err) {
    console.error('Errore ottimizzazione:', err);
    showOptToast('Errore durante l\'ottimizzazione: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

function showOptimizationSummary(techStats, failedCount, unassignedLimitCount = 0, maxLimit = 4) {
  const existing = document.getElementById('optSummaryOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'optSummaryOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:100001;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';

  const rowsHtml = techStats.map(t => `
    <tr>
      <td style="padding:10px 14px;font-weight:600;color:#f1f5f9;">${t.name}</td>
      <td style="padding:10px 14px;text-align:center;color:#38bdf8;font-weight:700;font-size:16px;">${t.assignedCount}</td>
      <td style="padding:10px 14px;text-align:center;color:#a78bfa;font-family:monospace;">~${t.totalKm.toFixed(1)} km</td>
    </tr>
  `).join('');

  const failedHtml = failedCount > 0
    ? `<div style="margin-top:12px;padding:10px 14px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:6px;color:#f59e0b;font-size:13px;">⚠️ ${failedCount} appuntamenti non geocodificati — assegnazione manuale necessaria</div>`
    : '';

  const limitHtml = unassignedLimitCount > 0
    ? `<div style="margin-top:12px;padding:10px 14px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);border-radius:6px;color:#f87171;font-size:13px;">🚫 ${unassignedLimitCount} appuntamenti non assegnati — tutti i tecnici hanno raggiunto il limite max di ${maxLimit} interventi</div>`
    : '';

  const totalInterv = techStats.reduce((s, t) => s + t.assignedCount, 0);
  const totalKm = techStats.reduce((s, t) => s + t.totalKm, 0);

  overlay.innerHTML = `
    <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:28px;max-width:500px;width:90%;box-shadow:0 20px 50px rgba(0,0,0,0.5);">
      <h3 style="margin:0 0 6px 0;color:#f1f5f9;font-size:18px;font-family:Inter,sans-serif;">⚡ Riepilogo Ottimizzazione</h3>
      <p style="margin:0 0 16px 0;color:#94a3b8;font-size:13px;font-family:Inter,sans-serif;">${totalInterv} interventi — ~${totalKm.toFixed(1)} km totali stimati</p>
      <table style="width:100%;border-collapse:collapse;font-family:Inter,sans-serif;font-size:14px;">
        <thead>
          <tr style="border-bottom:1px solid #334155;">
            <th style="padding:10px 14px;text-align:left;color:#94a3b8;font-weight:500;">Tecnico</th>
            <th style="padding:10px 14px;text-align:center;color:#94a3b8;font-weight:500;">Interventi</th>
            <th style="padding:10px 14px;text-align:center;color:#94a3b8;font-weight:500;">Distanza</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      ${failedHtml}
      ${limitHtml}
      <button onclick="this.closest('#optSummaryOverlay').remove()" style="margin-top:20px;width:100%;padding:12px;background:#7c3aed;color:white;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;transition:background 0.2s;">Chiudi</button>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}
