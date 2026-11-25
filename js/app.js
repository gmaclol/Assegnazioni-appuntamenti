import { parsePdfFiles } from './pdfParser.js';
import { exportToExcel } from './excelGenerator.js';
import { pianificaDistribuzione } from './distribuzione.js';
import { fasciaDi, confrontaAppuntamenti } from './fasce.js';
import { integraAppuntamenti, unisciCopieAppuntamenti } from './appuntamenti.js';
import { descrizioneIntervento, sembraDescrizioneAutomatica } from './formattatore.js';

// Identificativo mostrato nell'header: cambialo a ogni intervento importante così
// si capisce subito (dall'utente) se il browser sta servendo il codice nuovo.
const BUILD_ID = 'formato-25-11';

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

function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // In locale (avvia_progetto.bat) il service worker serve la cache e nasconde le
  // modifiche appena fatte: lo disattiviamo e togliamo quello eventualmente registrato.
  const locale = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  if (locale) {
    navigator.serviceWorker.getRegistrations()
      .then(regs => regs.forEach(r => r.unregister()))
      .catch(() => {});
    return;
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('Service Worker registration fallita:', err);
    });
  });
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

  badge.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      badge.click();
    }
  });
}


// Stato locale degli appuntamenti
let appuntamenti = [];
let tecniciDisponibili = [];
let tecniciConCasa = [];

// ── MEMORIA DEGLI APPUNTAMENTI (localStorage + Firestore) ───────────────────
// La lista sopravvive al refresh e si ritrova sugli altri dispositivi; i PDF
// reimportati non creano doppioni e non cancellano le modifiche fatte a mano.
const APPUNTAMENTI_KEY = 'tw_appuntamenti_v1';
const APPUNTAMENTI_DOC = 'settings/assegnazioni_appuntamenti';
let appuntamentiLoaded = false;   // false finché la lista non è stata letta
let _firmaAppuntamenti = '';      // ultimo JSON salvato (evita scritture inutili)
let _appuntamentiTimer = null;

// Identità stabile e unione degli interventi: vedi js/appuntamenti.js

function leggiAppuntamentiLocali() {
  try {
    const raw = localStorage.getItem(APPUNTAMENTI_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

// La copia online è quella condivisa: se c'è vince. Restano solo gli interventi
// importati su questo dispositivo e non ancora arrivati al cloud.
async function caricaAppuntamenti() {
  const locali = leggiAppuntamentiLocali();
  let remoti = [];
  try {
    const projectId = 'technicalwork-cloud';
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${APPUNTAMENTI_DOC}`);
    if (res.ok) {
      const doc = await res.json();
      const raw = doc.fields && doc.fields.data && doc.fields.data.stringValue;
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) remoti = arr;
      }
    }
  } catch (e) {
    console.warn('Appuntamenti online non disponibili, uso la copia locale:', e);
  }

  const base = unisciCopieAppuntamenti(locali, remoti);
  appuntamenti = base;
  migraDescrizioniSalvate();
  appuntamentiLoaded = true;
  sortAppuntamenti();
  _firmaAppuntamenti = JSON.stringify(appuntamenti);
  try { localStorage.setItem(APPUNTAMENTI_KEY, _firmaAppuntamenti); } catch (e) {}
}

// Gli interventi salvati prima del nuovo formattatore hanno in memoria il testo
// vecchio ("... wn, Cpe_int ok"): li si marca come automatici, così sito ed Excel
// li riscrivono nel formato attuale. I testi scritti a mano non si toccano.
function migraDescrizioniSalvate() {
  let aggiornati = 0;
  for (const item of appuntamenti) {
    if (item.descrizioneAuto) continue;
    if (!sembraDescrizioneAutomatica(item)) continue;
    item.descrizioneAuto = item.descrizioneSito;
    item.descrizioneExcel = item.descrizioneSito;
    aggiornati++;
  }
  if (aggiornati) console.log(`[Descrizioni] riformattati ${aggiornati} interventi già salvati`);
}

// Salva subito in locale e, con un debounce, sul cloud (una sola scrittura anche
// se si modificano più righe di fila).
function salvaAppuntamenti() {
  if (!appuntamentiLoaded) return;
  const json = JSON.stringify(appuntamenti);
  if (json === _firmaAppuntamenti) return;
  _firmaAppuntamenti = json;
  try { localStorage.setItem(APPUNTAMENTI_KEY, json); } catch (e) {}
  if (_appuntamentiTimer) clearTimeout(_appuntamentiTimer);
  _appuntamentiTimer = setTimeout(() => {
    _appuntamentiTimer = null;
    pushAppuntamentiToFirestore(_firmaAppuntamenti);
  }, 800);
}

async function pushAppuntamentiToFirestore(json) {
  try {
    const projectId = 'technicalwork-cloud';
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${APPUNTAMENTI_DOC}?updateMask.fieldPaths=data`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { data: { stringValue: json } } })
    });
    if (!res.ok) console.warn('Salvataggio appuntamenti online non riuscito:', res.status);
  } catch (e) {
    console.warn('Impossibile salvare gli appuntamenti online:', e);
  }
}

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

// ── Conversioni colore per il selettore custom ──────────────────────────────
function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '').trim();
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function rgbToHex({ r, g, b }) {
  const to = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return ('#' + to(r) + to(g) + to(b)).toUpperCase();
}

function rgbToHsv({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgb({ h, s, v }) {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = v - c;
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

const clamp01 = v => Math.max(0, Math.min(1, v));

// Colore di partenza del selettore: lo legge dal pulsante (dataset o stile inline)
function coloreBottone(btn) {
  const daDataset = hexToRgb(btn.dataset.color || '');
  if (daDataset) return daDataset;
  const m = String(btn.style.backgroundColor || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  return { r: 56, g: 189, b: 248 };
}

// Selettore colore: anello delle tinte + quadrato saturazione/luminosità + campo HEX,
// con sotto la paletta Excel per le scelte rapide.
function openExcelColorPicker(btn, onPick) {
  const existing = document.getElementById('excelColorPopup');
  if (existing) existing.remove();

  const stato = rgbToHsv(coloreBottone(btn));

  const popup = document.createElement('div');
  popup.id = 'excelColorPopup';
  popup.className = 'excel-color-popup';
  popup.innerHTML = `
    <div class="excel-color-popup-title">Scegli colore</div>
    <div class="cp-wheel" role="slider" tabindex="0" aria-label="Tinta" aria-valuemin="0" aria-valuemax="359" aria-valuenow="0">
      <div class="cp-wheel-knob" aria-hidden="true"></div>
      <div class="cp-wheel-hole">
        <div class="cp-sv" role="slider" tabindex="0" aria-label="Saturazione e luminosità" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
          <div class="cp-sv-thumb" aria-hidden="true"></div>
        </div>
      </div>
    </div>
    <div class="cp-row">
      <span class="cp-preview" aria-hidden="true"></span>
      <input type="text" class="cp-hex" value="#000000" maxlength="7" spellcheck="false"
             aria-label="Codice colore esadecimale" placeholder="#RRGGBB">
      <button type="button" class="cp-apply">Applica</button>
    </div>
    <div class="excel-color-popup-title" style="margin-top:12px;">Paletta Excel</div>
    <div class="excel-color-popup-grid" role="listbox" aria-label="Colori rapidi">
      ${EXCEL_PALETTE.map(hex => `
        <button type="button" class="excel-color-swatch" role="option" data-hex="${hex}" style="background-color:${hex};" title="${hex.toUpperCase()}" aria-label="Colore ${hex.toUpperCase()}"></button>
      `).join('')}
    </div>
  `;

  document.body.appendChild(popup);

  const wheel = popup.querySelector('.cp-wheel');
  const knob = popup.querySelector('.cp-wheel-knob');
  const sv = popup.querySelector('.cp-sv');
  const svThumb = popup.querySelector('.cp-sv-thumb');
  const input = popup.querySelector('.cp-hex');
  const preview = popup.querySelector('.cp-preview');

  function coloreAttuale() {
    return rgbToHex(hsvToRgb(stato));
  }

  function disegna() {
    const hex = coloreAttuale();
    // Anello: la pallina segue l'angolo della tinta (0° = in alto, senso orario)
    const rad = (stato.h - 90) * Math.PI / 180;
    const raggio = wheel.clientWidth / 2 - 8;
    knob.style.left = `${wheel.clientWidth / 2 + Math.cos(rad) * raggio}px`;
    knob.style.top = `${wheel.clientWidth / 2 + Math.sin(rad) * raggio}px`;
    knob.style.backgroundColor = `hsl(${stato.h}, 100%, 50%)`;
    // Quadrato saturazione/luminosità con la tinta corrente
    sv.style.background =
      `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${stato.h}, 100%, 50%))`;
    svThumb.style.left = `${stato.s * 100}%`;
    svThumb.style.top = `${(1 - stato.v) * 100}%`;
    svThumb.style.backgroundColor = hex;
    preview.style.backgroundColor = hex;
    if (document.activeElement !== input) input.value = hex;
    wheel.setAttribute('aria-valuenow', Math.round(stato.h));
    sv.setAttribute('aria-valuetext', `Saturazione ${Math.round(stato.s * 100)}%, luminosità ${Math.round(stato.v * 100)}%`);
  }

  function aggiornaDaRuota(e) {
    const r = wheel.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let ang = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI + 90;
    if (ang < 0) ang += 360;
    stato.h = ang;
    disegna();
  }

  function aggiornaDaQuadrato(e) {
    const r = sv.getBoundingClientRect();
    stato.s = clamp01((e.clientX - r.left) / r.width);
    stato.v = 1 - clamp01((e.clientY - r.top) / r.height);
    disegna();
  }

  // Drag con pointer capture: funziona anche uscendo dal bordo durante il movimento
  function abilitaDrag(el, aggiorna) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.dataset.dragging = '1';
      aggiorna(e);
    });
    el.addEventListener('pointermove', (e) => {
      if (el.dataset.dragging === '1') aggiorna(e);
    });
    const fine = () => { delete el.dataset.dragging; };
    el.addEventListener('pointerup', fine);
    el.addEventListener('pointercancel', fine);
  }

  disegna();

  abilitaDrag(wheel, aggiornaDaRuota);
  abilitaDrag(sv, aggiornaDaQuadrato);

  // Tastiera: frecce per tinta e per saturazione/luminosità
  wheel.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 15 : 3;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { stato.h = (stato.h - step + 360) % 360; disegna(); e.preventDefault(); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { stato.h = (stato.h + step) % 360; disegna(); e.preventDefault(); }
  });
  sv.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.2 : 0.04;
    if (e.key === 'ArrowLeft') { stato.s = clamp01(stato.s - step); disegna(); e.preventDefault(); }
    if (e.key === 'ArrowRight') { stato.s = clamp01(stato.s + step); disegna(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { stato.v = clamp01(stato.v + step); disegna(); e.preventDefault(); }
    if (e.key === 'ArrowDown') { stato.v = clamp01(stato.v - step); disegna(); e.preventDefault(); }
  });

  // Campo HEX: accetta #RGB e #RRGGBB, aggiorna il selettore mentre si scrive
  input.addEventListener('input', () => {
    let v = input.value.trim();
    if (/^[0-9a-f]{3}$/i.test(v)) v = v.replace('#', '');
    if (/^[0-9a-f]{3}$/i.test(v)) v = '#' + v.split('').map(c => c + c).join('');
    const rgb = hexToRgb(v);
    if (rgb) {
      const hsv = rgbToHsv(rgb);
      stato.h = hsv.h; stato.s = hsv.s; stato.v = hsv.v;
      disegna();
      input.value = rgbToHex(rgb);
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applica(); }
  });

  function applica() {
    const hex = input.value.trim() || coloreAttuale();
    const rgb = hexToRgb(hex);
    if (!rgb) { input.focus(); return; }
    onPick(rgbToHex(rgb));
    popup.remove();
  }
  popup.querySelector('.cp-apply').addEventListener('click', applica);

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

// Un ID dispositivo (16 caratteri esadecimali) non è il nome di un tecnico: è il
// residuo di una risoluzione nome fallita su Firestore e va ignorato, altrimenti
// compare nei selettori e nelle distribuzioni.
const ID_DISPOSITIVO = /^[0-9a-f]{16}$/i;

function isNomeTecnicoValido(nome) {
  const n = String(nome || '').trim();
  return Boolean(n) && !ID_DISPOSITIVO.test(n);
}

function getAllTechNames() {
  return new Set([
    ...Object.keys(techSettings),
    ...tecniciDisponibili,
    ...tecniciConCasa.map(t => t.name)
  ].filter(isNomeTecnicoValido));
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
      // Pulisce i residui con nome = ID dispositivo. Non si forza un push qui:
      // il salvataggio successivo delle impostazioni ripulisce anche il cloud.
      let puliti = 0;
      for (const nome of Object.keys(techSettings)) {
        if (!isNomeTecnicoValido(nome)) {
          delete techSettings[nome];
          puliti++;
        }
      }
      try { localStorage.setItem('tw_tech_settings_v1', JSON.stringify(techSettings)); } catch (e) {}
      if (puliti > 0) console.log(`[Tecnici] rimossi ${puliti} nomi non validi (ID dispositivo)`);
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
    const syncAria = () => btnToggle.setAttribute('aria-expanded', panel.classList.contains('active') ? 'true' : 'false');
    btnToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('active');
      renderCompanyList();
      syncAria();
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.company-wrap')) {
        panel.classList.remove('active');
        syncAria();
      }
    });
    syncAria();
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
  // Versione in header: se non cambia dopo un aggiornamento, il browser sta usando
  // una copia vecchia (cache/service worker), non il codice nuovo.
  const badge = document.getElementById('buildBadge');
  if (badge) badge.textContent = BUILD_ID;

  initAdminMode();
  initDatePicker();
  initDragAndDrop();
  initButtons();
  initTechManagerModal();
  initGuastiConfigModal();
  initCompanyManager();
  initServiceWorker();
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
  // Prima la lista degli appuntamenti (locale + cloud), così le modifiche salvate
  // ci sono già quando si assegnano i guasti ai tecnici.
  await caricaAppuntamenti();
  renderTables();
  await loadComuniFromFirestore();
  const [result] = await Promise.all([fetchTecniciFromFirestore(), loadWebSettingsFromFirestore(), loadCompaniesFromConfig()]);
  // Nessun "tecnico" con nome uguale a un ID dispositivo (residui di risoluzione nome)
  tecniciDisponibili = result.names.filter(isNomeTecnicoValido);
  tecniciConCasa = result.details.filter(t => isNomeTecnicoValido(t.name));
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

  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

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

  // Le schede intervento non stampano AREA_CD: per i guasti il cluster AB/CD si
  // recupera dalla mappa comuni→cluster già nota (scansioni e impostazioni online),
  // così restano assegnati ai tecnici guasti del cluster giusto.
  for (const p of parsed) {
    if (p.tipoIntervento === 'Guasto' && !p.areaCd && p.comune) {
      const cluster = getClusterForComune(p.comune);
      if (cluster === 'AB' || cluster === 'CD') p.areaCd = cluster;
    }
  }

  if (parsed.length > 0) {
    // Solo gli interventi nuovi: chi c'è già resta com'è anche se il PDF viene
    // rimandato (magari con qualche pagina in più uscita nel frattempo).
    const uniti = integraAppuntamenti(appuntamenti, parsed);
    appuntamenti = uniti.appuntamenti;
    const { aggiunti, doppioni } = uniti;
    collectComuni(parsed);
    if (aggiunti.length) await autoAssignGuasti(aggiunti);
    sortAppuntamenti();
    renderTables();
    if (doppioni > 0) {
      showOptToast(`${aggiunti.length} nuovi interventi aggiunti · ${doppioni} già presenti (mantengo le tue modifiche).`, 'success');
    } else {
      showOptToast(`${aggiunti.length} interventi aggiunti.`, 'success');
    }
  }
}

async function autoAssignGuasti(nuovi = null) {
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

  for (const app of (nuovi || appuntamenti)) {
    const isGuasto = app.tipoIntervento === 'Guasto';
    if (!isGuasto) continue;
    // Un tecnico già assegnato (dal cluster o scelto a mano) non si tocca: è la
    // modifica dell'ufficio, e la lista viene ripresa al prossimo accesso.
    if (app.tecnico) continue;

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
  // Ordinamento condiviso con l'Excel: fascia oraria, poi ordine manuale
  // (trascinamento dentro la stessa fascia), poi orario, guasti in fondo.
  appuntamenti.sort(confrontaAppuntamenti);
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

  document.getElementById('btnDistribuisci').addEventListener('click', () => {
    distribuisciEquo();
  });

  document.getElementById('btnAddRow').addEventListener('click', () => {
    appuntamenti.push({
      id: 'app_' + Math.random().toString(36).substr(2, 9),
      orario: '08:30',
      descrizioneSito: '',
      descrizioneExcel: '',
      tecnicoCentraleExcel: '',
      sezione: 'realizzare',
      appalto: 'Elecnor'
    });
    sortAppuntamenti();
    renderTables();
  });

  document.getElementById('btnClearAll').addEventListener('click', () => {
    if (confirm('Vuoi svuotare tutti gli appuntamenti caricati? La lista viene svuotata anche sugli altri dispositivi.')) {
      appuntamenti = [];
      renderTables();
      salvaAppuntamenti();
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

  const realizzareMerged = appuntamenti.filter(a => a.sezione === 'realizzare' || a.sezione === 'borchia' || a.sezione === 'migrazione');
  const sospesi = appuntamenti.filter(a => a.sezione === 'sospendere');
  const chiusi = appuntamenti.filter(a => a.sezione === 'chiudere');

  // Aggiorna Stats
  document.getElementById('statTotale').textContent = appuntamenti.length;
  document.getElementById('statRealizzare').textContent = realizzareMerged.length;
  document.getElementById('statSospendere').textContent = sospesi.length;
  document.getElementById('statChiudere').textContent = chiusi.length;

  renderSection(tbodyRealizzare, realizzareMerged, true);
  renderSection(tbodySospendere, sospesi);
  renderSection(tbodyChiudere, chiusi);

  // Ogni modifica passa da qui: è il punto unico in cui la lista si salva
  // (localStorage subito, cloud dopo 800 ms se qualcosa è davvero cambiato).
  salvaAppuntamenti();
}

// Fasce orarie e ordinamento: vedi js/fasce.js (condiviso con l'Excel)
let _dragPointer = null;
let _dragRaf = 0;

// ── Trascinamento con pointer events, ottimizzato ──────────────────────────
// Le posizioni delle righe si leggono UNA volta all'inizio del drag: durante il
// movimento si fa solo aritmetica (niente elementFromPoint, che forzerebbe il
// layout a ogni pixel). Il fantasma si muove con transform (GPU) e vicino ai bordi
// la pagina scorre da sola, così si può arrivare fino alle 16:30.

function pulisciEvidenza() {
  document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
}

// Contenitore che scorre davvero (la pagina o un div con overflow)
function contenitoreScrollabile(el) {
  let n = el.parentElement;
  while (n && n !== document.body) {
    const st = getComputedStyle(n);
    if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 4) return n;
    n = n.parentElement;
  }
  return null;
}

function scrollAttuale(cont) {
  return cont ? cont.scrollTop : (window.scrollY || document.documentElement.scrollTop || 0);
}

function scorriDi(cont, dy) {
  if (cont) cont.scrollTop += dy;
  else if (typeof window.scrollBy === 'function') window.scrollBy(0, dy);
  else document.documentElement.scrollTop += dy;
}

// Fascia che sta sotto la coordinata y, usando le posizioni salvate all'inizio
function fasciaAllY(y) {
  const d = _dragPointer;
  if (!d) return null;
  const delta = scrollAttuale(d.scroller) - d.scrollStart;
  for (const r of d.righe) {
    if (y >= r.top - delta && y <= r.bottom - delta) return r;
  }
  return null;
}

function evidenzia(fasciaEl) {
  const d = _dragPointer;
  if (!d) return;
  const evidenziata = (fasciaEl && fasciaEl !== d.tr) ? fasciaEl : null;
  if (d.targetEl === evidenziata) return;
  if (d.targetEl) d.targetEl.classList.remove('drop-target');
  if (evidenziata) evidenziata.classList.add('drop-target');
  d.targetEl = evidenziata;
}

function loopDrag() {
  const d = _dragPointer;
  if (!d) return;

  // Auto-scroll ai bordi: più vicino al bordo, più veloce
  const margine = 140;
  const h = window.innerHeight;
  let dy = 0;
  if (d.y > h - margine) dy = Math.ceil((d.y - (h - margine)) / 5);
  else if (d.y < margine) dy = -Math.ceil((margine - d.y) / 5);
  if (dy) scorriDi(d.scroller, Math.max(-40, Math.min(40, dy)));

  const riga = fasciaAllY(d.y);
  evidenzia(riga ? riga.el : null);

  _dragRaf = requestAnimationFrame(loopDrag);
}

function muoviDragPointer(e) {
  if (!_dragPointer) return;
  _dragPointer.y = e.clientY;
  // Solo transform: nessun layout, si aggiorna una volta per frame
  _dragPointer.ghost.style.transform = `translate3d(0, ${e.clientY - _dragPointer.startY}px, 0)`;
}

// Posizione di inserimento nella fascia: quante righe (esclusa quella trascinata)
// hanno il centro sopra il punto in cui si rilascia
function indiceInserimento(d, fascia, y) {
  const delta = scrollAttuale(d.scroller) - d.scrollStart;
  let indice = 0;
  for (const r of d.righe) {
    if (r.fascia !== fascia || r.id === d.id) continue;
    const centro = (r.top + r.bottom) / 2 - delta;
    if (y > centro) indice++;
    else break;
  }
  return indice;
}

// Rinumerazione dell'ordine manuale della fascia (0..n): è ciò che permette di
// riordinare le righe dentro la stessa fascia con il trascinamento.
function riordinaFascia(item, fascia, indice) {
  const dellaFascia = appuntamenti
    .filter(a => a.id !== item.id && fasciaDi(a.orario) === fascia)
    .sort(confrontaAppuntamenti);
  const pos = Math.max(0, Math.min(indice, dellaFascia.length));
  dellaFascia.splice(pos, 0, item);
  dellaFascia.forEach((a, i) => { a.ordineManuale = i; });
}

function chiudiDragPointer(e) {
  if (!_dragPointer) return;
  const d = _dragPointer;
  const { id, tr, ghost } = d;
  if (e && typeof e.clientY === 'number') d.y = e.clientY;

  const rigaFinale = fasciaAllY(d.y);
  const fascia = (rigaFinale && rigaFinale.el !== tr) ? rigaFinale.fascia : '';
  const indice = fascia ? indiceInserimento(d, fascia, d.y) : 0;

  if (_dragRaf) cancelAnimationFrame(_dragRaf);
  _dragRaf = 0;
  ghost.remove();
  tr.classList.remove('dragging');
  pulisciEvidenza();
  document.removeEventListener('pointermove', muoviDragPointer);
  document.removeEventListener('pointerup', chiudiDragPointer);
  document.removeEventListener('pointercancel', chiudiDragPointer);
  document.body.classList.remove('dragging-row');
  _dragPointer = null;

  const item = appuntamenti.find(a => a.id === id);
  if (!item || !fascia) return;

  // Fascia diversa: cambia l'orario (con la presa in carico). Stessa fascia:
  // solo riordino, l'orario resto quello concordato col cliente.
  const stessaFascia = sameOrario(fasciaDi(item.orario), fascia);
  if (!stessaFascia && !applicaOrario(item, fascia)) return;

  riordinaFascia(item, fascia, indice);
  sortAppuntamenti();
  renderTables();

  showOptToast(stessaFascia
    ? `Riga riordinata nella fascia ${fascia}`
    : (item.orarioOrigine
        ? `Spostato alle ${fascia} · presa in carico ${item.orarioOrigine}`
        : `Spostato alle ${fascia}`), 'success');
}

function avviaDragPointer(e, tr, item) {
  if (_dragPointer) return;
  if (e.button !== undefined && e.button !== 0) return;
  // Mai iniziare il trascinamento da un controllo: si scrive e si clicca senza problemi
  if (e.target.closest('input, select, textarea, button, a, .input-pc')) return;
  e.preventDefault();

  const r = tr.getBoundingClientRect();
  const tbody = tr.parentElement;
  const scroller = contenitoreScrollabile(tbody);

  // Una sola lettura del layout: posizione di ogni riga/fascia
  const righe = [...tbody.querySelectorAll('tr[data-fascia]')].map(el => {
    const rr = el.getBoundingClientRect();
    return {
      el,
      id: el.dataset.id || '',
      fascia: el.dataset.fascia,
      top: rr.top,
      bottom: rr.bottom,
    };
  });

  const ghost = tr.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  Object.assign(ghost.style, {
    position: 'fixed',
    left: r.left + 'px',
    top: r.top + 'px',
    width: r.width + 'px',
    boxSizing: 'border-box',
    pointerEvents: 'none',
    opacity: '0.9',
    zIndex: '100050',
    willChange: 'transform',
  });
  document.body.appendChild(ghost);
  tr.classList.add('dragging');
  document.body.classList.add('dragging-row');

  _dragPointer = {
    id: item.id,
    tr,
    ghost,
    startY: e.clientY,
    y: e.clientY,
    righe,
    scroller,
    scrollStart: scrollAttuale(scroller),
    targetEl: null,
  };
  document.addEventListener('pointermove', muoviDragPointer);
  document.addEventListener('pointerup', chiudiDragPointer);
  document.addEventListener('pointercancel', chiudiDragPointer);
  _dragRaf = requestAnimationFrame(loopDrag);
}

// Rende trascinabile una riga della sezione principale: dalla maniglia ⠿ o dalla
// cella dell'orario (mai dai campi, così si scrive senza problemi).
function abilitaDragRiga(tr, item) {
  const maniglia = tr.querySelector('.btn-drag-row');
  if (maniglia) maniglia.addEventListener('pointerdown', (e) => avviaDragPointer(e, tr, item));
  const cellaOrario = tr.children[0];
  if (cellaOrario) cellaOrario.addEventListener('pointerdown', (e) => avviaDragPointer(e, tr, item));
}

function renderSection(tbody, items, conDivider = false) {
  if (items.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">Nessun impianto in questa sezione.</td></tr>`;
    return;
  }

  let fasciaCorrente = null;
  // Costruisco le righe fuori dal DOM e le inserisco in un colpo solo:
  // un append per riga forzava il layout N volte (interfaccia "laggosa").
  const frammento = document.createDocumentFragment();

  items.forEach(item => {
    if (conDivider) {
      const fascia = fasciaDi(item.orario);
      if (fascia !== fasciaCorrente) {
        fasciaCorrente = fascia;
        const divider = document.createElement('tr');
        divider.className = 'band-divider';
        divider.dataset.fascia = fascia;
        divider.innerHTML = `<td colspan="6"><span class="band-label">${escapeAttr(fascia)}</span></td>`;
        frammento.appendChild(divider);
      }
    }

    const tr = document.createElement('tr');
    tr.dataset.id = item.id;
    const isGuasto = item.tipoIntervento === 'Guasto' || Boolean(item.areaCd) || item.sezione === 'chiudere';
    if (isGuasto) tr.classList.add('row-guasto');
    if (item.sezione === 'borchia') tr.classList.add('row-borchia');
    if (item.sezione === 'migrazione') tr.classList.add('row-migrazione');
    if (conDivider) tr.dataset.fascia = fasciaDi(item.orario);
    // Descrizione essenziale (indirizzo, operatore, apparati, tag del tipo di lavoro):
    // testo uniforme condiviso con l'Excel, vedi js/formattatore.js
    const descSito = descrizioneIntervento(item);
    
    const localita = getLocalita(item);
    const appaltoClean = item.appalto ? item.appalto.toLowerCase() : '';
    
    // Le opzioni del selettore tecnico si costruiscono solo all'apertura: prima
    // venivano create (con i loro listener) per ogni riga ad ogni ridisegno.
    const techList = tecniciDisponibili.length > 0 ? tecniciDisponibili : [
      "Marco + Andrea + Matias + Francesco", "Marco + Francesco", "Cristian", "Riccardo", "Matias", "Carmelo", "Lombardo", "Mauro", "Stefano", "Piero", "Ramiro", "Enzo"
    ];
    const opzioniHtml = () => techList.map(t => {
      const fullValue = [t, localita, appaltoClean].filter(Boolean).join(' ');
      return `<div class="tech-option-item" role="option" data-value="${escapeAttr(fullValue)}" tabindex="-1"><span>${escapeAttr(t)}</span><span class="tech-option-badge">${escapeAttr(localita)}</span></div>`;
    }).join('');

    tr.innerHTML = `
      <td>
        <input type="text" class="input-table" value="${escapeAttr(item.orario)}" data-field="orario" style="width:75px; font-weight:bold;" title="Orario di lavoro (Invio o click fuori per applicare)">
        <div class="pc-row">
          ${item.orarioOrigine
            ? `<input type="text" class="input-pc" value="${escapeAttr(item.orarioOrigine)}" data-field="orarioOrigine"
                      aria-label="Orario di presa in carico"
                      title="Presa in carico sull'app Open Fiber (il lavoro è alle ${escapeAttr(item.orario)}). Vuoto per toglierla.">
               <button type="button" class="btn-pc-del" title="Rimuovi presa in carico" aria-label="Rimuovi presa in carico">✕</button>`
            : `<button type="button" class="btn-pc-add" title="Aggiungi una presa in carico diversa dall'orario di lavoro">+ presa in carico</button>`}
        </div>
      </td>
      <td>
        <input type="text" class="input-table" value="${escapeAttr(descSito)}" data-field="descrizioneSito" placeholder="Via Civico - Apparati da installare">
      </td>
      <td>
        <div class="tech-select-container">
          <input type="text" class="tech-select-input" value="${escapeAttr(item.tecnicoCentraleExcel || item.tecnico || '')}" data-field="tecnicoCentraleExcel" placeholder="Seleziona o digita Tecnico..." aria-label="Tecnico o squadra" aria-haspopup="listbox" aria-expanded="false" role="combobox">
          <span class="tech-select-icon" aria-hidden="true">▼</span>
          <div class="tech-dropdown-panel" role="listbox" aria-label="Tecnici disponibili">
            <div class="tech-search-box">
              <input type="text" class="tech-filter-input" placeholder="Cerca tecnico..." aria-label="Filtra tecnici">
            </div>
            <div class="tech-options-list"></div>
          </div>
        </div>
      </td>
      <td>
        <select class="input-table" data-field="sezione">
          <option value="realizzare" ${item.sezione === 'realizzare' ? 'selected' : ''}>🟢 Realizzare</option>
          <option value="sospendere" ${item.sezione === 'sospendere' ? 'selected' : ''}>🟡 Sospendere</option>
          <option value="chiudere" ${item.sezione === 'chiudere' ? 'selected' : ''}>🔴 Chiudere</option>
          <option value="borchia" ${item.sezione === 'borchia' ? 'selected' : ''}>🔵 Borchia</option>
          <option value="migrazione" ${item.sezione === 'migrazione' ? 'selected' : ''}>🟣 Migrazione</option>
        </select>
      </td>
      <td>
        <select class="badge-azienda-select" data-field="appalto">
          ${getCompaniesOptionsHtml(item.appalto || 'Elecnor')}
        </select>
      </td>
      <td style="text-align:center; white-space:nowrap;">
        ${conDivider ? '<span class="btn-drag-row" title="Trascina la riga per riordinarla nella stessa fascia o per cambiare fascia" aria-hidden="true">⠿</span>' : ''}
        <button class="btn-delete-row" title="Elimina riga" aria-label="Elimina riga">🗑️</button>
      </td>
    `;

    // Handlers
    const container = tr.querySelector('.tech-select-container');
    const inputField = container.querySelector('.tech-select-input');
    const dropdownPanel = container.querySelector('.tech-dropdown-panel');
    const filterInput = container.querySelector('.tech-filter-input');
    const listaOpzioni = container.querySelector('.tech-options-list');
    let opzioniPronte = false;

    function costruisciOpzioni() {
      if (opzioniPronte) return;
      opzioniPronte = true;
      listaOpzioni.innerHTML = opzioniHtml();
    }

    function apriPannello() {
      document.querySelectorAll('.tech-dropdown-panel.active').forEach(panel => {
        if (panel !== dropdownPanel) panel.classList.remove('active');
      });
      dropdownPanel.classList.add('active');
      inputField.setAttribute('aria-expanded', 'true');
      costruisciOpzioni();
      filterInput.value = '';
      filterOptions('');
      filterInput.focus();
    }

    function chiudiPannello() {
      dropdownPanel.classList.remove('active');
      inputField.setAttribute('aria-expanded', 'false');
    }

    function selezionaTecnico(value) {
      inputField.value = value;
      item.tecnicoCentraleExcel = value;
      chiudiPannello();
      salvaAppuntamenti();
    }

    inputField.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdownPanel.classList.contains('active')) chiudiPannello();
      else apriPannello();
    });

    // Tastiera: ArrowDown apre il pannello e sposta il focus, Escape lo chiude
    inputField.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!dropdownPanel.classList.contains('active')) apriPannello();
        else filterInput.focus();
      } else if (e.key === 'Escape') {
        chiudiPannello();
        inputField.focus();
      }
    });

    filterInput.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    filterInput.addEventListener('input', (e) => {
      filterOptions(e.target.value.toLowerCase());
    });

    function filterOptions(searchTerm) {
      listaOpzioni.querySelectorAll('.tech-option-item').forEach(opt => {
        const text = opt.textContent.toLowerCase();
        opt.style.display = text.includes(searchTerm) ? 'flex' : 'none';
      });
    }

    // Un solo listener sul contenitore invece di due per ogni opzione
    listaOpzioni.addEventListener('click', (e) => {
      const opt = e.target.closest('.tech-option-item');
      if (!opt) return;
      e.stopPropagation();
      selezionaTecnico(opt.getAttribute('data-value'));
    });

    listaOpzioni.addEventListener('keydown', (e) => {
      const opt = e.target.closest('.tech-option-item');
      if (!opt) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        selezionaTecnico(opt.getAttribute('data-value'));
        inputField.focus();
      }
    });

    inputField.addEventListener('change', (e) => {
      item.tecnicoCentraleExcel = e.target.value;
      salvaAppuntamenti();
    });

    // Handlers per gli altri campi.
    // Il testo si salva ad ogni tasto, ma la tabella si ridisegna (e quindi la riga
    // si ricolloca nella fascia) solo su Invio o click fuori: prima si spostava al
    // primo carattere digitato e non si riusciva a completare la modifica.
    tr.querySelectorAll('input:not(.tech-select-input):not(.tech-filter-input), select').forEach(input => {
      const field = input.getAttribute('data-field');
      if (!field) return;

      const salva = (e) => {
        // Orari validati al commit: mentre si scrive il valore non va salvato
        if (field === 'orario' || field === 'orarioOrigine') return;
        item[field] = e.target.value;
        if (field === 'descrizioneSito') item.descrizioneExcel = e.target.value;
      };

      const committa = (e) => {
        const valore = e.target.value.trim();

        if (field === 'orario') {
          if (applicaOrario(item, valore)) {
            e.target.value = item.orario;
          } else {
            // Orario non valido: torna al valore precedente
            e.target.value = item.orario || '';
          }
          renderTables();
          return;
        }

        if (field === 'orarioOrigine') {
          if (!valore) {
            delete item.orarioOrigine;
          } else {
            const normalizzato = normalizzaOrario(valore);
            if (normalizzato && !sameOrario(normalizzato, item.orario)) {
              item.orarioOrigine = normalizzato;
              e.target.value = normalizzato;
            } else if (normalizzato) {
              // Uguale all'orario di lavoro: non è uno spostamento
              delete item.orarioOrigine;
            } else {
              e.target.value = item.orarioOrigine || '';
            }
          }
          renderTables();
          return;
        }

        salva(e);
        salvaAppuntamenti();
        if (field === 'sezione') renderTables();
      };

      input.addEventListener('input', salva);
      input.addEventListener('change', committa);
      if (input.tagName === 'INPUT') {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        });
      }
    });

    const btnPcAdd = tr.querySelector('.btn-pc-add');
    if (btnPcAdd) {
      btnPcAdd.addEventListener('click', () => {
        // Crea la presa in carico partendo dall'orario attuale, poi la si modifica
        item.orarioOrigine = item.orario || '';
        renderTables();
        const campo = document.querySelector(`.data-table tr[data-id="${item.id}"] .input-pc`);
        if (campo) { campo.focus(); campo.select(); }
      });
    }
    const btnPcDel = tr.querySelector('.btn-pc-del');
    if (btnPcDel) {
      btnPcDel.addEventListener('click', () => {
        delete item.orarioOrigine;
        renderTables();
      });
    }

    // Trascinamento verso un'altra fascia oraria (solo nella sezione principale)
    if (conDivider) abilitaDragRiga(tr, item);

    tr.querySelector('.btn-delete-row').addEventListener('click', () => {
      appuntamenti = appuntamenti.filter(a => a.id !== item.id);
      renderTables();
    });

    frammento.appendChild(tr);
  });

  tbody.appendChild(frammento);
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

// --- HELPER MODAL (a11y: focus trap + Escape + aria-hidden) ---
let _lastFocusedElement = null;

function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(el => el.offsetParent !== null || el === document.activeElement);
}

function openModal(modal) {
  if (!modal || modal.classList.contains('active')) return;
  _lastFocusedElement = document.activeElement;
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
  // Focus sul primo elemento focusable
  const focusable = getFocusableElements(modal);
  if (focusable.length) focusable[0].focus();
}

function closeModal(modal) {
  if (!modal || !modal.classList.contains('active')) return;
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
  if (_lastFocusedElement && _lastFocusedElement.focus) {
    _lastFocusedElement.focus();
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const openModals = document.querySelectorAll('.tech-modal-overlay.active');
  if (openModals.length) {
    const top = openModals[openModals.length - 1];
    closeModal(top);
    e.preventDefault();
  }
  // Chiudi anche la popup colori Excel
  const popup = document.getElementById('excelColorPopup');
  if (popup) popup.remove();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const openModals = document.querySelectorAll('.tech-modal-overlay.active');
  if (!openModals.length) return;
  const modal = openModals[openModals.length - 1];
  const focusable = getFocusableElements(modal);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
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
      openModal(modal);
    });
  }

  if (btnClose && modal) {
    btnClose.addEventListener('click', () => {
      closeModal(modal);
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal);
    });
  }

  if (btnSave && modal) {
    btnSave.addEventListener('click', async () => {
      saveTechSettings();
      await autoAssignGuasti();
      renderTables();
      updateTechActiveCounter();
      closeModal(modal);
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
      openModal(modal);
    });
  }

  if (btnClose && modal) {
    btnClose.addEventListener('click', () => {
      closeModal(modal);
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal);
    });
  }

  if (btnSave && modal) {
    btnSave.addEventListener('click', async () => {
      saveTechSettings();
      await autoAssignGuasti();
      renderTables();
      closeModal(modal);
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
          <input type="checkbox" class="tech-modal-checkbox" id="tech-cb-${escapeAttr(t.name)}" ${cfg.active !== false ? 'checked' : ''} aria-label="Attiva o metti in ferie ${escapeAttr(t.name)}">
          <label for="tech-cb-${escapeAttr(t.name)}" class="tech-modal-name">${escapeAttr(t.name)}</label>
        </div>
        <div style="display:flex; align-items:center; gap:14px;">
          <button type="button" class="tech-color-btn" data-color="${cfg.color}" style="background-color:${cfg.color};" title="Scegli colore (paletta Excel)" aria-label="Scegli colore per ${escapeAttr(t.name)}"></button>
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

// "8:30" / "8.30" / "08:30" -> "08:30"; vuoto o non valido -> ''
function normalizzaOrario(valore) {
  const m = String(valore || '').trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return '';
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function sameOrario(a, b) {
  return toMinutes(a) === toMinutes(b);
}

// Applica un nuovo orario all'appuntamento ricordando la presa in carico:
// se la riga viene spostata, l'orario di partenza diventa la "presa in carico";
// se torna al suo posto la scritta sparisce. Ritorna false se l'orario non è valido.
function applicaOrario(item, valore) {
  const normalizzato = normalizzaOrario(valore);
  if (!normalizzato) return false;
  const precedente = item.orario || '';
  if (!item.orarioOrigine && precedente && !sameOrario(precedente, normalizzato)) {
    // Prima volta che la riga si sposta: l'orario attuale è quello della presa in carico
    item.orarioOrigine = normalizzaOrario(precedente) || precedente;
  }
  item.orario = normalizzato;
  if (item.orarioOrigine && sameOrario(item.orarioOrigine, normalizzato)) {
    // Tornata all'orario originale: la presa in carico non è più diversa dal lavoro
    delete item.orarioOrigine;
  }
  return true;
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

          const techName = (fields.tecnico && fields.tecnico.stringValue) || deviceNames[docId.toLowerCase()] || '';
          // Niente fallback sul docId: un documento senza nome diventerebbe un
          // "tecnico" chiamato con l'ID del dispositivo (es. d77808aa66d7bca2).
          if (!techName) return;
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
    const toAssign = appuntamenti.filter(a => (a.sezione === 'realizzare' || a.sezione === 'migrazione') && a.tipoIntervento !== 'Guasto' && !a.areaCd);
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
    <div role="dialog" aria-modal="true" aria-labelledby="optSummaryTitle" style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:28px;max-width:500px;width:90%;box-shadow:0 20px 50px rgba(0,0,0,0.5);">
      <h3 id="optSummaryTitle" style="margin:0 0 6px 0;color:#f1f5f9;font-size:18px;font-family:Inter,sans-serif;">⚡ Riepilogo Ottimizzazione</h3>
      <p style="margin:0 0 16px 0;color:#94a3b8;font-size:13px;font-family:Inter,sans-serif;">${totalInterv} interventi — ~${totalKm.toFixed(1)} km totali stimati</p>
      <table style="width:100%;border-collapse:collapse;font-family:Inter,sans-serif;font-size:14px;">
        <thead>
          <tr style="border-bottom:1px solid #334155;">
            <th scope="col" style="padding:10px 14px;text-align:left;color:#94a3b8;font-weight:500;">Tecnico</th>
            <th scope="col" style="padding:10px 14px;text-align:center;color:#94a3b8;font-weight:500;">Interventi</th>
            <th scope="col" style="padding:10px 14px;text-align:center;color:#94a3b8;font-weight:500;">Distanza</th>
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

// ═══════════════════════════════════════════════════════════════
// DISTRIBUZIONE EQUA — 2 orari di lavoro per fascia e per tecnico
// ═══════════════════════════════════════════════════════════════

// Ricava il nome del tecnico dalla stringa "Nome Localita appalto"
function nomeTecnicoDaStringa(valore, nomi) {
  const s = String(valore || '').toLowerCase().trim();
  if (!s) return '';
  // Nomi più lunghi prima: "Marco Rossi" deve vincere su "Marco"
  const ordinati = [...nomi].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const nome of ordinati) {
    if (s.includes(nome.toLowerCase())) return nome;
  }
  return '';
}

function tecniciPerImpianti() {
  return [...getAllTechNames()]
    .filter(nome => {
      const cfg = getTechConfig(nome);
      return cfg.active !== false && cfg.role === 'normale';
    })
    .sort((a, b) => a.localeCompare(b, 'it'));
}

function distribuisciEquo() {
  const tecnici = tecniciPerImpianti();
  if (!tecnici.length) {
    showOptToast('Nessun tecnico impianti attivo (ruolo "Normale") nella Gestione Tecnici.', 'error');
    return;
  }

  const maxInput = document.getElementById('maxInterventiInput');
  const maxPerTecnico = parseInt(maxInput ? maxInput.value : 4, 10) || 4;

  // Impianti normali e lavorazioni brevi (borchie e migrazioni): le brevi son
  // interventi corti, quindi si sistemano per primi e non rubano il posto
  // all'impianto normale della stessa fascia.
  const impianti = appuntamenti.filter(a => a.sezione === 'realizzare' && a.tipoIntervento !== 'Guasto' && !a.areaCd);
  const brevi = appuntamenti.filter(a => a.sezione === 'borchia' || a.sezione === 'migrazione');
  if (!impianti.length && !brevi.length) {
    showOptToast('Nessun impianto da distribuire: carica prima i PDF delle schede.', 'warning');
    return;
  }

  // I guasti entrano nel piano con il tecnico che li ha già in carico: la presa in
  // carico resta all'orario originale, si sposta solo il lavoro (nessuna telefonata).
  // Quelli di un tecnico guasti dedicato (fuori da questi tecnici) non si toccano.
  const guasti = appuntamenti
    .filter(a => a.tipoIntervento === 'Guasto' && a.sezione === 'realizzare')
    .map(a => ({
      id: a.id,
      orario: a.orario,
      orarioOrigine: a.orarioOrigine,
      tecnico: nomeTecnicoDaStringa(a.tecnicoCentraleExcel || a.tecnico, tecnici)
    }));
  const guastiCluster = guasti.filter(g => !g.tecnico).length;

  const esito = pianificaDistribuzione({
    tecnici,
    maxPerTecnico,
    interventi: impianti.map(a => ({ id: a.id, orario: a.orario, orarioOrigine: a.orarioOrigine })),
    brevi: brevi.map(a => ({ id: a.id, orario: a.orario, orarioOrigine: a.orarioOrigine })),
    guasti
  });

  showDistribuzioneModal(esito, maxPerTecnico, guastiCluster);
}

function showDistribuzioneModal(esito, maxPerTecnico, guastiCluster) {
  const esistente = document.getElementById('distModalOverlay');
  if (esistente) esistente.remove();

  const perId = new Map(appuntamenti.map(a => [a.id, a]));
  const etichetta = id => {
    const a = perId.get(id);
    if (!a) return id;
    return `${escapeAttr(a.indirizzo || '')}${a.comune ? ' (' + escapeAttr(a.comune) + ')' : ''}`;
  };

  const nImpianti = esito.piano.filter(v => !v.breve).length;
  const nBrevi = esito.piano.filter(v => v.breve && !v.guasto).length;
  const nGuasti = esito.piano.filter(v => v.guasto).length;
  const guastiSpostati = esito.guastiSpostati || [];

  // Riepilogo per tecnico
  const perTecnico = {};
  for (const voce of esito.piano) {
    if (!perTecnico[voce.tecnico]) perTecnico[voce.tecnico] = [];
    perTecnico[voce.tecnico].push(voce);
  }
  const righeTecnici = Object.keys(perTecnico).sort((a, b) => a.localeCompare(b, 'it')).map(nome => {
    const voci = perTecnico[nome].sort((x, y) => toMinutes(x.orario) - toMinutes(y.orario));
    const elenco = voci.map(v => {
      const marca = v.guasto
        ? ' <span style="color:#f87171;font-weight:600;">(GUASTO)</span>'
        : (v.breve ? ' <span style="color:#fbbf24;font-weight:600;">(BREVE)</span>' : '');
      return `<div style="font-size:13px;color:#cbd5e1;padding:2px 0;"><span style="color:#38bdf8;font-family:monospace;">${escapeAttr(v.orario)}</span> ${etichetta(v.id)}${marca}</div>`;
    }).join('');
    return `<tr>
      <td style="padding:10px 14px;font-weight:600;color:#f1f5f9;vertical-align:top;white-space:nowrap;">${escapeAttr(nome)}</td>
      <td style="padding:10px 14px;text-align:center;color:#38bdf8;font-weight:700;font-size:16px;vertical-align:top;">${voci.length}</td>
      <td style="padding:10px 14px;">${elenco}</td>
    </tr>`;
  }).join('');

  // Spostamenti suggeriti (da concordare col cliente)
  const spostHtml = esito.spostamenti.length
    ? `<div style="margin-top:16px;">
         <div style="color:#f59e0b;font-weight:600;font-size:13px;margin-bottom:6px;">📞 Da spostare — chiamare il cliente (la presa in carico resta all'orario originale)</div>
         ${esito.spostamenti.map(s => `
           <div style="padding:6px 10px;background:rgba(245,158,11,0.08);border-left:3px solid #f59e0b;border-radius:4px;margin-bottom:4px;font-size:13px;color:#e2e8f0;">
             ${etichetta(s.id)} — <span style="font-family:monospace;color:#94a3b8;">${escapeAttr(s.da)} → ${escapeAttr(s.a)}</span> · ${escapeAttr(s.tecnico)}
           </div>`).join('')}
       </div>`
    : `<div style="margin-top:16px;padding:10px 14px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:6px;color:#34d399;font-size:13px;">✅ Nessuno spostamento: ogni impianto resta al suo orario.</div>`;

  // Guasti spostati di un'ora: la presa in carico resta, non serve telefonare
  const guastiHtml = guastiSpostati.length
    ? `<div style="margin-top:12px;">
         <div style="color:#f87171;font-weight:600;font-size:13px;margin-bottom:6px;">🚨 Guasti spostati di un'ora (nessuna telefonata: la presa in carico resta)</div>
         ${guastiSpostati.map(s => `
           <div style="padding:6px 10px;background:rgba(239,68,68,0.08);border-left:3px solid #f87171;border-radius:4px;margin-bottom:4px;font-size:13px;color:#e2e8f0;">
             ${etichetta(s.id)} — <span style="font-family:monospace;color:#94a3b8;">${escapeAttr(s.da)} → ${escapeAttr(s.a)}</span> · ${escapeAttr(s.tecnico)}
           </div>`).join('')}
       </div>`
    : '';

  const senzaPostoHtml = esito.nonAssegnati.length
    ? `<div style="margin-top:12px;padding:10px 14px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);border-radius:6px;color:#f87171;font-size:13px;">🚫 ${esito.nonAssegnati.length} impianti restano senza tecnico (limite di ${maxPerTecnico} interventi/giorno raggiunto)</div>`
    : '';

  // Impianti che tornano alla fascia di presa in carico (fascia liberatasi nel frattempo)
  const rientratiHtml = (esito.rientrati && esito.rientrati.length)
    ? `<div style="margin-top:12px;">
         <div style="color:#34d399;font-weight:600;font-size:13px;margin-bottom:6px;">↩️ Rientrano alla presa in carico (fascia liberatasi)</div>
         ${esito.rientrati.map(r => `
           <div style="padding:6px 10px;background:rgba(16,185,129,0.08);border-left:3px solid #10b981;border-radius:4px;margin-bottom:4px;font-size:13px;color:#e2e8f0;">
             ${etichetta(r.id)} — <span style="font-family:monospace;color:#94a3b8;">${escapeAttr(r.da)} → ${escapeAttr(r.a)}</span> · ${escapeAttr(r.tecnico)}
           </div>`).join('')}
       </div>`
    : '';

  const overlay = document.createElement('div');
  overlay.id = 'distModalOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:100001;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
  overlay.innerHTML = `
    <div role="dialog" aria-modal="true" aria-labelledby="distModalTitle" style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:26px;max-width:720px;width:92%;max-height:86vh;overflow:auto;box-shadow:0 20px 50px rgba(0,0,0,0.5);">
      <h3 id="distModalTitle" style="margin:0 0 6px 0;color:#f1f5f9;font-size:18px;font-family:Inter,sans-serif;">⚖️ Distribuzione equa — anteprima</h3>
      <p style="margin:0 0 14px 0;color:#94a3b8;font-size:13px;font-family:Inter,sans-serif;">
        ${nImpianti} impianti, ${nBrevi} brevi (borchie/migrazioni) e ${nGuasti} guasti su ${Object.keys(perTecnico).length} tecnici · per fascia un impianto + una lavorazione breve, con due orari disponibili (fascia e ora successiva)${guastiCluster ? ` · ${guastiCluster} guasti restano ai tecnici guasti` : ''}
      </p>
      <table style="width:100%;border-collapse:collapse;font-family:Inter,sans-serif;font-size:14px;">
        <thead>
          <tr style="border-bottom:1px solid #334155;">
            <th scope="col" style="padding:8px 14px;text-align:left;color:#94a3b8;font-weight:500;">Tecnico</th>
            <th scope="col" style="padding:8px 14px;text-align:center;color:#94a3b8;font-weight:500;">Interventi</th>
            <th scope="col" style="padding:8px 14px;text-align:left;color:#94a3b8;font-weight:500;">Fasce</th>
          </tr>
        </thead>
        <tbody>${righeTecnici}</tbody>
      </table>
      ${spostHtml}
      ${guastiHtml}
      ${rientratiHtml}
      ${senzaPostoHtml}
      <div style="display:flex;gap:10px;margin-top:20px;">
        <button id="btnDistAnnulla" style="flex:1;padding:12px;background:#334155;color:#e2e8f0;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;">Annulla</button>
        <button id="btnDistApplica" style="flex:2;padding:12px;background:#0ea5e9;color:white;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;">Applica distribuzione</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const chiudi = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) chiudi(); });
  document.getElementById('btnDistAnnulla').addEventListener('click', chiudi);
  document.getElementById('btnDistApplica').addEventListener('click', () => {
    applicaDistribuzione(esito);
    chiudi();
  });
}

function applicaDistribuzione(esito) {
  const perId = new Map(appuntamenti.map(a => [a.id, a]));
  for (const voce of esito.piano) {
    const app = perId.get(voce.id);
    if (!app) continue;
    // I guasti restano del tecnico che li ha in carico (li decide il cluster):
    // si sposta solo l'orario di lavoro, la presa in carico resta.
    if (!voce.guasto) {
      app.tecnico = voce.tecnico;
      const localita = getLocalita(app);
      const appaltoClean = app.appalto ? app.appalto.toLowerCase() : '';
      app.tecnicoCentraleExcel = [voce.tecnico, localita, appaltoClean].filter(Boolean).join(' ');
    }
    // Spostamento: il lavoro passa all'orario nuovo, la presa in carico resta all'originale
    if (voce.orarioOrigine && toMinutes(voce.orarioOrigine) !== toMinutes(voce.orario)) {
      app.orarioOrigine = voce.orarioOrigine;
    } else {
      delete app.orarioOrigine;
    }
    app.orario = voce.orario;
  }
  sortAppuntamenti();
  renderTables();
  const spostati = esito.spostamenti.length;
  const guastiSpostati = (esito.guastiSpostati || []).length;
  const rientrati = (esito.rientrati || []).length;
  const dettagli = [
    spostati ? `${spostati} da spostare con telefonata` : '',
    guastiSpostati ? `${guastiSpostati} guasti spostati di un'ora` : '',
    rientrati ? `${rientrati} rientrati alla presa in carico` : ''
  ].filter(Boolean).join(', ');
  showOptToast(
    `Distribuzione applicata: ${esito.piano.length} interventi assegnati${dettagli ? ' — ' + dettagli : ''}.`,
    'success'
  );
}
