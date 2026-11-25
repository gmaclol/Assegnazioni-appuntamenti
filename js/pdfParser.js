import * as pdfjsLib from 'pdfjs-dist';
import { formattaDescrizione } from './formattatore.js';

// Configura il worker di PDF.js per Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url
).toString();

/**
 * Parsifica uno o più file PDF Work Order Open Fiber (Elecnor / Sertori / Sirti).
 * 
 * LOGICA CHIAVE: ogni pagina del PDF inizia con "WR: <codice>".
 * Le pagine con lo stesso WR code appartengono allo stesso appuntamento.
 * Raggruppiamo le pagine per WR, uniamo il testo, ed estraiamo i dati una sola volta.
 *
 * @param {File[]} pdfFiles Array di file PDF
 * @returns {Promise<Array>} Lista di oggetti appuntamento strutturati
 */
export async function parsePdfFiles(pdfFiles) {
  const results = [];
  
  for (const file of pdfFiles) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      // STEP 1: Estrai il testo di ogni pagina
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const rawText = textContent.items.map(item => item.str).join(' ');
        pages.push(rawText);
      }
      
      // STEP 2: le schede intervento tecnico (formato del nostro estrattore XME)
      // hanno una pratica per pagina e un'intestazione diversa dai Work Order legacy:
      // vanno lette con il parser dedicato, non raggruppate per WR.
      if (isSchedaDocument(pages)) {
        for (const schedaText of splitSchede(pages)) {
          try {
            const item = parseScheda(schedaText, file.name);
            if (item && item.indirizzo) {
              results.push(item);
            }
          } catch (e) {
            console.warn(`Errore parsing scheda intervento nel file ${file.name}:`, e);
          }
        }
        continue;
      }

      // STEP 3: Raggruppa le pagine per WR code
      const wrGroups = groupPagesByWR(pages);
      
      // STEP 4: Parsa ogni gruppo
      for (const [wrCode, groupText] of wrGroups) {
        try {
          const item = parseWorkOrder(wrCode, groupText, file.name);
          if (item && item.indirizzo) {
            results.push(item);
          }
        } catch (e) {
          console.warn(`Errore parsing WR ${wrCode} nel file ${file.name}:`, e);
        }
      }
    } catch (err) {
      console.error(`Errore durante il parsing del file PDF ${file.name}:`, err);
    }
  }
  
  // Ordina per orario crescente
  results.sort((a, b) => toMinutes(a.orario) - toMinutes(b.orario));
  
  return results;
}

/**
 * Raggruppa le pagine per WR code.
 * Il WR è sempre il primissimo campo nel testo della pagina: "WR:   <codice>"
 * @returns {Map<string, string>} Mappa WR -> testo unito di tutte le pagine con quel WR
 */
function groupPagesByWR(pages) {
  const groups = new Map();
  const orderedKeys = [];
  
  for (const pageText of pages) {
    const wrMatch = pageText.match(/^WR:\s+(\S+)/);
    if (!wrMatch) continue;
    
    const wr = wrMatch[1];
    if (groups.has(wr)) {
      groups.set(wr, groups.get(wr) + '\n' + pageText);
    } else {
      groups.set(wr, pageText);
      orderedKeys.push(wr);
    }
  }
  
  // Restituisce in ordine di prima apparizione
  const ordered = new Map();
  for (const key of orderedKeys) {
    ordered.set(key, groups.get(key));
  }
  return ordered;
}

/**
 * Parsa il testo unito di tutte le pagine di un singolo Work Order
 */
function parseWorkOrder(wrCode, fullText, filename) {
  // L'intestazione è nei primi ~400 caratteri della prima pagina del gruppo
  const header = fullText.substring(0, 500);
  
  // --- APPALTO ---
  const appalto = /SERTORI/i.test(header) ? 'Sertori' 
                : /SIRTI/i.test(header) ? 'Sirti' 
                : 'Elecnor';
  
  // --- TIPO INTERVENTO ---
  // Tipo: 71, 79 = Assurance (Guasto) — Tipo: 70, 78 = Delivery (Attivazione/Migrazione)
  const tipoMatch = header.match(/Tipo:\s*(\d+)/);
  const tipoNum = tipoMatch ? parseInt(tipoMatch[1]) : 0;
  const isGuasto = tipoNum === 71 || tipoNum === 79 || /ASSURANCE/i.test(header);
  
  // Determina sottotipo: Migrazione (codice attività 19) vs Attivazione normale
  let tipoIntervento = isGuasto ? 'Guasto' : 'Attivazione';
  if (!isGuasto) {
    const codAttMatch = fullText.match(/CODICE_ATTIVITA\s*-\s*(\d+)/i);
    const descAttMatch = fullText.match(/DESCRIZIONE_ATTIVITA\s*-\s*([^\n]+)/i);
    if (codAttMatch && parseInt(codAttMatch[1]) === 19) {
      tipoIntervento = 'Migrazione';
    } else if (descAttMatch && /migraz/i.test(descAttMatch[1])) {
      tipoIntervento = 'Migrazione';
    }
  }
  
  // --- ORARIO / FASCIA ---
  const orario = extractOrario(header);
  
  // --- INDIRIZZO ---
  // Il campo "Indiriz.:" è SOLO nella prima pagina dell'intestazione
  const indirizzo = extractIndirizzo(header, fullText);
  
  // --- CLIENTE ---
  const cliente = extractCliente(header, fullText);
  
  // --- TELEFONO ---
  const telefono = extractTelefonoLegacy(header, fullText);
  
  // --- COMUNE ---
  const comune = extractField(header, /Comune:\s*([A-Z\u00C0-\u024F]+)/i) ||
                 extractField(fullText, /COMUNE\s*-\s*([A-Z\u00C0-\u024F]+)/i) || '';
  
  // --- CENTRALE ---
  const centrale = extractField(header, /Centrale:\s*(\S+)/) ||
                   extractField(fullText, /IDENTIFICATIVO_DEL_POP\s*-\s*(\S+)/);
  
  // --- OPERATORE OLO ---
  const oloOperatore = extractOperatore(fullText, header);
  
  // --- APPARATI ---
  // Gli apparati reali sono SOLO nelle pagine successive (percorsi di rete)
  const apparati = isGuasto ? '' : extractApparati(fullText);
  
  // --- TIPO IMPIANTO ---
  const tipoImpianto = extractTipoImpianto(fullText);
  // Indirizzo della PTE: nei Work Order sta in "INDIRIZZO_PTE - VIA PIETRO MICCA, 3"
  const pteIndirizzo = extractPteLegacy(fullText);
  
  // --- AREA CD (Cluster AB vs CD) ---
  // Il cluster viene estratto da TUTTI i work order (AREA_CD - AB/CD nei guasti,
  // C_D - AB/CD nei percorsi di rete delle attivazioni) e serve a mappare i comuni
  // al cluster corretto per i tecnici guasti.
  // NEL SINGOLO APPUNTAMENTO il cluster viene però usato SOLO per i guasti (scelta
  // del pool di tecnici). Per attivazioni/migrazioni areaCd resta vuoto, altrimenti
  // ogni appuntamento verrebbe trattato come guasto.
  let clusterCd = '';
  let areaCd = '';
  const mArea = fullText.match(/AREA[_\s]*CD\s*[-:\s]*\s*(AB|CD)/i) ||
                header.match(/AREA[_\s]*CD\s*[-:\s]*\s*(AB|CD)/i) ||
                fullText.match(/AREA_CD\s*-\s*(AB|CD)/i) ||
                fullText.match(/C_D\s*-\s*(AB|CD)/i);
  if (mArea) {
    clusterCd = mArea[1].toUpperCase();
  }
  if (isGuasto) {
    areaCd = clusterCd;
  }

  const item = {
    id: 'app_' + Math.random().toString(36).substr(2, 9),
    filename,
    wrCode,
    tipoIntervento,
    orario,
    cliente,
    telefono,
    comune,
    indirizzo,
    oloOperatore,
    centrale: centrale ? centrale.toLowerCase().replace(/_/g, '') : '',
    appalto,
    apparati,
    tipoImpianto,
    pteIndirizzo,
    areaCd,
    clusterCd,
    // Le migrazioni nascono già con il pallino dedicato (stesse caratteristiche della borchia)
    sezione: tipoIntervento === 'Migrazione' ? 'migrazione' : 'realizzare',
    tecnico: ''
  };
  
  item.descrizioneSito = formatDescrizioneSito(item);
  item.descrizioneExcel = formatDescrizioneExcel(item);
  // Testo generato: serve a capire se l'utente l'ha modificato a mano (in quel caso
  // sito ed Excel usano il suo testo invece di riformattarlo).
  item.descrizioneAuto = item.descrizioneSito;
  item.tecnicoCentraleExcel = formatTecnicoCentrale(item);
  
  return item;
}

// ── Parser schede intervento (formato "SCHEDA INTERVENTO TECNICO" XME) ───────
//
// Le schede generate dal nostro estrattore (ex export_service / Swiss Grid) hanno
// una pratica per pagina con campi etichettati ("CLIENTE:", "TEL:", "CODICE WR (OF):").
// Nel testo estratto da PDF.js ogni campo è separato da una o più spaziature ampie,
// quindi la pagina si legge come una sequenza di token: etichetta -> valore.

const SCHEDA_TITOLO = /SCHEDA\s+INTERVENTO/i;
const SCHEDA_FINE_APPARATI = /^(NOTE|SUPPORTO TECNICO|DISCRIMINANTE)/i;

function isSchedaDocument(pages) {
  return pages.some(text => SCHEDA_TITOLO.test(text));
}

// Una scheda per pagina; le pagine senza intestazione sono continuazioni della precedente
function splitSchede(pages) {
  const schede = [];
  for (const pageText of pages) {
    if (SCHEDA_TITOLO.test(pageText)) {
      schede.push(pageText);
    } else if (schede.length) {
      schede[schede.length - 1] += '\n' + pageText;
    }
  }
  return schede;
}

function schedaTokens(text) {
  return text.split(/\s{2,}/).map(t => t.trim()).filter(Boolean);
}

// Valore del campo "ETICHETTA:" — accetta sia etichetta e valore separati sia
// "ETICHETTA: valore" nello stesso token.
function schedaValue(tokens, label) {
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].toUpperCase().startsWith(label)) continue;
    const inline = tokens[i].slice(label.length).trim();
    if (inline) return inline;
    const next = tokens[i + 1];
    if (!next || next.endsWith(':')) return '';
    return next.trim();
  }
  return '';
}

function parseScheda(fullText, filename) {
  const tokens = schedaTokens(fullText);

  // --- ORARIO / FASCIA ---
  const orario = extractOrarioScheda(fullText);

  // --- INDIRIZZO E COMUNE ---
  // La testata riporta "DATA INTERVENTO | orario | data | INDIRIZZO – COMUNE".
  const comune = schedaValue(tokens, 'COMUNE:');
  const indirizzo = extractIndirizzoScheda(tokens);

  // --- TIPO INTERVENTO ---
  const tipoPratica = schedaValue(tokens, 'TIPO PRATICA:');
  const jobType = schedaValue(tokens, 'JOB TYPE:');
  const isGuasto = /ASSURANCE/i.test(tipoPratica) ||
                   /(GUASTO|DISSERVIZIO|ASSURANCE)/i.test(jobType);
  let tipoIntervento = isGuasto ? 'Guasto' : 'Attivazione';
  if (!isGuasto && /(MIGRAZION|SUBENTRO)/i.test(jobType)) {
    tipoIntervento = 'Migrazione';
  }

  // --- CLIENTE E TELEFONO ---
  const cliente = schedaValue(tokens, 'CLIENTE:');
  const telefono = extractTelefonoScheda(tokens);

  // --- OPERATORE OLO ---
  const operatoreRaw = schedaValue(tokens, 'OPERATORE:');
  const oloOperatore = /^N\/?D$/i.test(operatoreRaw) ? '' : normalizeOperatore(operatoreRaw);

  // --- CENTRALE ---
  const centraleRaw = schedaValue(tokens, 'CENTRALE / POP:');
  const centrale = /^N\/?D$/i.test(centraleRaw)
    ? ''
    : centraleRaw.toLowerCase().replace(/_/g, '');

  // --- APPARATI ---
  // Sulla scheda la sezione "APPARATI & CREDENZIALI IN CONSEGNA" è già il risultato
  // dell'estrazione del portale, quindi vale anche per i guasti (a differenza del
  // legacy dove veniva scartata).
  const apparati = extractApparatiScheda(tokens);

  // --- TIPO IMPIANTO ---
  const tipoImpianto = extractTipoImpiantoScheda(tokens);
  // Indirizzo della PTE (punto di terminazione): sulla scheda sta in
  // "PTE / ROE TERMINAZIONE  A479_VIA GUIDO GINELLA_3_A_1 (Porta: 1)"
  const pteIndirizzo = extractPteScheda(tokens);

  const item = {
    id: 'app_' + Math.random().toString(36).substr(2, 9),
    filename,
    wrCode: schedaValue(tokens, 'CODICE WR (OF):'),
    tipoIntervento,
    orario,
    cliente,
    telefono,
    comune,
    indirizzo,
    oloOperatore,
    centrale,
    appalto: appaltoDaNomeFile(filename),
    apparati,
    tipoImpianto,
    pteIndirizzo,
    // Il cluster AB/CD non è stampato sulla scheda: lo ricava app.js dalla mappa comuni
    areaCd: '',
    clusterCd: '',
    // Le migrazioni nascono già con il pallino dedicato (stesse caratteristiche della borchia)
    sezione: tipoIntervento === 'Migrazione' ? 'migrazione' : 'realizzare',
    tecnico: ''
  };

  item.descrizioneSito = formatDescrizioneSito(item);
  item.descrizioneExcel = formatDescrizioneExcel(item);
  // Testo generato: serve a capire se l'utente l'ha modificato a mano (in quel caso
  // sito ed Excel usano il suo testo invece di riformattarlo).
  item.descrizioneAuto = item.descrizioneSito;
  item.tecnicoCentraleExcel = formatTecnicoCentrale(item);

  return item;
}

// "08:30 – 10:30" -> "08:30"
function extractOrarioScheda(text) {
  const m = text.match(/(\d{1,2}:\d{2})\s*[–-]\s*\d{1,2}:\d{2}/);
  if (!m) return '08:30';
  const parts = m[1].split(':');
  return parts[0].padStart(2, '0') + ':' + parts[1];
}

// La testata riporta l'indirizzo nella forma "VIA ROMA 10 – COMUNE":
// si prende il token successivo alla data e si scarta la coda del comune.
function extractIndirizzoScheda(tokens) {
  const dataIdx = tokens.findIndex(t => /^\d{2}\/\d{2}\/\d{4}$/.test(t));
  if (dataIdx < 0) return '';
  const riga = (tokens[dataIdx + 1] || '').trim();
  if (!riga) return '';
  const sep = riga.lastIndexOf(' – ');
  return (sep > 0 ? riga.slice(0, sep) : riga).trim();
}

// "3356977351 / 0159131441" -> tutti i numeri, nello stesso ordine della scheda.
// Se il campo va a capo dopo la "/" il numero successivo è nel token seguente.
function extractTelefonoScheda(tokens) {
  const idx = tokens.findIndex(t => t.toUpperCase().startsWith('TEL:'));
  if (idx < 0) return '';
  const inline = tokens[idx].slice(4).trim();
  let raw = inline || (tokens[idx + 1] || '');
  if (/nessun recapito/i.test(raw)) return '';
  const dopo = tokens[idx + (inline ? 1 : 2)];
  if (/\/\s*$/.test(raw) && dopo && /^[\d\s\/]+$/.test(dopo)) {
    raw = raw + ' ' + dopo;
  }
  const numeri = raw.split('/')
    .map(n => n.replace(/\s+/g, ''))
    .filter(n => /^\d{6,}$/.test(n));
  return [...new Set(numeri)].join(' / ');
}

// Legacy: il Work Order riporta lo stesso recapito in RECAPITO_TELEFONICO_CLIENTE_1..N
// (spesso duplicato) e, in testata, "Telefono Reclamante".
function extractTelefonoLegacy(header, fullText) {
  const numeri = [...fullText.matchAll(/RECAPITO_TELEFONICO_CLIENTE_\d\s*-\s*(\d{6,})/g)]
    .map(m => m[1]);
  if (!numeri.length) {
    const tel = extractField(header, /Telefono Reclamante:\s*(\d{6,})/);
    if (tel) numeri.push(tel);
  }
  return [...new Set(numeri)].join(' / ');
}

// Le righe di "APPARATI & CREDENZIALI IN CONSEGNA" sono del tipo
//   NOME   [PASSWORD / SERVIZIO: <valore>]   [Consegna e installazione on-field]
// L'etichetta d'azione finale può mancare quando è presente la password; a volte il
// valore della password e il nome dell'apparato successivo finiscono nello stesso
// token (es. "25286055 ONT_OF_2.5G"), quindi si cerca il nome anche in coda al token.
const SCHEDA_FAMIGLIE_APPARATO = /^(ONT|MODEM|CPE|HUB\d*|VIK|SIM|SFP|EXTENDER|EOLOROUTER|ROUTER)/i;
const SCHEDA_APPARATO_IN_CODA = /(?:^|\s)((?:ONT|MODEM|CPE|HUB\d*|VIK|SIM|SFP|EXTENDER|EOLOROUTER|ROUTER)[A-Z0-9_.\/ -]*|\d{5,7})$/i;
const SCHEDA_APPARATO_IN_CODA_NOME = /(?:^|\s)((?:ONT|MODEM|CPE|HUB\d*|VIK|SIM|SFP|EXTENDER|EOLOROUTER|ROUTER)[A-Z0-9_.\/ -]*)$/i;
// Suffisso con cui la scheda marca gli apparati che non si prelevano dal magazzino
const SCHEDA_SUFFISSO_CLIENTE = /^(.*?)\s*·\s*(solo installazione|solo consegna)\s*$/i;

function nomeApparatoScheda(token) {
  const t = String(token || '').trim();
  if (!t) return '';
  if (SCHEDA_FAMIGLIE_APPARATO.test(t)) return t;
  if (/^\d{5,7}$/.test(t)) return t; // codice materiale (785632, 781093, ...)
  const m = t.match(SCHEDA_APPARATO_IN_CODA);
  return m ? m[1].trim() : '';
}

function extractApparatiScheda(tokens) {
  const start = tokens.findIndex(t => /^APPARATI/i.test(t));
  if (start < 0) return '';
  const apparati = [];
  let dopoPassword = false;
  for (let i = start + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (SCHEDA_FINE_APPARATI.test(t)) break;
    if (/^PASSWORD \//i.test(t)) { dopoPassword = true; continue; }
    if (/^(CONSEGNA|SOLO)/i.test(t)) continue;
    // "MODEM_MIG · solo installazione" = apparato del cliente: si monta, non si preleva
    const cliente = t.match(SCHEDA_SUFFISSO_CLIENTE);
    const base = cliente ? cliente[1] : t;
    // Dopo una password il token è il valore della password: può contenere in coda
    // il nome dell'apparato successivo ("25286055 ONT_OF_2.5G"), ma i numeri puri
    // sono password (8794170) e non codici materiale.
    const raw = dopoPassword
      ? ((base.match(SCHEDA_APPARATO_IN_CODA_NOME) || [])[1] || '')
      : nomeApparatoScheda(base);
    dopoPassword = false;
    const nome = normalizeApparatoScheda(raw);
    if (!nome) continue;
    const etichetta = !cliente
      ? nome
      : (cliente[2].toLowerCase() === 'solo consegna' ? `${nome} (solo consegna)` : `${nome} (cliente)`);
    if (!apparati.includes(etichetta)) apparati.push(etichetta);
  }
  return apparati.join(' + ');
}

// I nomi sulle schede sono la TIPOLOGIA_APPARATO del portale: si riusano le
// normalizzazioni del legacy e, per le tipologie nuove, si tiene il nome originale
// invece di perdere l'informazione.
function normalizeApparatoScheda(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length < 2) return '';
  if (/^(N\/D|N\/A|-)$/i.test(s)) return '';
  // Segnaposto del portale: nessun apparato da prelevare
  if (/^router\s*\/\s*cpe cliente$/i.test(s)) return '';
  if (/^\d{1,4}$/.test(s)) return ''; // numeretti di servizio
  return normalizeApparato(s) || s;
}

// "PTE · Monofibra" -> "pte", "PTA POZZETTO · Monofibra" -> "pta pozzetto"
function extractTipoImpiantoScheda(tokens) {
  const raw = schedaValue(tokens, 'TIPO INSTALLAZIONE:');
  if (!raw) return '';
  if (/^PTA\s*POZZETTO/i.test(raw)) return 'pta pozzetto';
  if (/^PTA\s*FACCIATA/i.test(raw)) return 'pta facciata';
  if (/^PTA\s*PALO/i.test(raw)) return 'pta palo';
  if (/^PTE/i.test(raw)) return 'pte';
  return '';
}

// Indirizzo del punto di terminazione sulla scheda:
// "PTE / ROE TERMINAZIONE  A479_VIA GUIDO GINELLA_3_A_1 (Porta: 1)"
function extractPteScheda(tokens) {
  const raw = schedaValue(tokens, 'PTE / ROE TERMINAZIONE');
  if (!raw) return '';
  // Alcune schede riportano "N/D" o "-": non è un indirizzo
  if (!/[A-Z]/i.test(raw) || /^n\/?d$/i.test(raw.trim())) return '';
  return raw.trim();
}

// Indirizzo del punto di terminazione nei Work Order legacy: "INDIRIZZO_PTE - VIA PIETRO MICCA, 3"
function extractPteLegacy(fullText) {
  const m = fullText.match(/(?:^|\s)INDIRIZZO_PTE\s*-\s*(.+?)(?:\s{2,}|$)/i);
  return m && m[1] ? m[1].trim() : '';
}

// L'appalto non è stampato sulla scheda (entrambi i portali sono "Elecnor WFM API"):
// si ricava dal nome del file usato in ufficio (sertori_17_11.pdf, sirti_*.pdf).
function appaltoDaNomeFile(filename) {
  const n = String(filename || '').toLowerCase();
  if (n.includes('sertori')) return 'Sertori';
  if (n.includes('sirti')) return 'Sirti';
  return 'Elecnor';
}

// ── Funzioni di estrazione ──────────────────────────────────────────────────

function extractField(text, regex) {
  const m = text.match(regex);
  return (m && m[1]) ? m[1].trim() : '';
}

function extractOrario(header) {
  const fasciaMatch = header.match(/(\d{1,2}:\d{2})\s*\/\s*\d{1,2}:\d{2}/);
  if (fasciaMatch) {
    const parts = fasciaMatch[1].split(':');
    return parts[0].padStart(2, '0') + ':' + parts[1];
  }
  return '08:30';
}

function extractIndirizzo(header, fullText) {
  // 1. Campo "Indiriz.:" nell'intestazione — il più affidabile
  const m1 = header.match(/Indiriz\.\:\s*(.+?)(?:\s{2,}Telefono|\s{2,}Comune|\s{3,})/i);
  if (m1) {
    const v = m1[1].trim();
    if (v && v.length > 2) return v;
  }
  
  // 2. Campi strutturati INDIRIZZO + NUMERO_CIVICO
  const via = extractField(fullText, /PARTICELLA_TOPONOMASTICA\s*-\s*(\S+)/i);
  const nome = extractField(fullText, /INDIRIZZO\s*-\s*([A-Z\u00C0-\u024F\s']+?)(?:\s{2,}|NUMERO)/i);
  const civico = extractField(fullText, /NUMERO_CIVICO\s*-\s*(\S+)/i);
  
  if (nome) {
    let full = via ? `${via} ${nome}` : nome;
    if (civico) full += ` ${civico}`;
    return full.trim();
  }
  
  // 3. Fallback: INDIRIZZO_PTE
  const pte = extractField(fullText, /INDIRIZZO_PTE\s*-\s*([^,\n]+)/i);
  if (pte) return pte.replace(/,\s*$/, '').trim();
  
  return '';
}

function extractCliente(header, fullText) {
  // 1. Campo "Cliente:" nell'intestazione
  const m = header.match(/Cliente:\s+([A-Z\u00C0-\u024F][A-Z\u00C0-\u024F\s]+?)(?:\s{2,}|N°|$)/i);
  if (m && m[1].trim().length > 1) return m[1].trim();
  
  // 2. Campo strutturato COGN. CLIENTE
  const cogn = extractField(fullText, /COGN\.\s*CLIENTE\s*-\s+([A-Z\u00C0-\u024F]+)/i);
  if (cogn && cogn !== '-') return cogn;
  
  return '';
}

function extractOperatore(fullText, header) {
  // 1. Campo strutturato CODICE_OPERATORE (più affidabile)
  const codOp = extractField(fullText, /CODICE_OPERATORE\s*-\s+(\S+)/i);
  if (codOp) {
    return normalizeOperatore(codOp);
  }
  
  // 2. Descrizione OLO nell'intestazione
  const descOlo = extractField(header, /Descrizione OLO:\s+(\S+)/i);
  if (descOlo) {
    return normalizeOperatoreFromOlo(descOlo);
  }
  
  // 3. CODICE ISP
  const isp = extractField(fullText, /CODICE ISP:\s*-\s+(.+?)(?:\s{2,}|$)/);
  if (isp) {
    return normalizeOperatore(isp);
  }
  
  return '';
}

function normalizeOperatore(raw) {
  const s = raw.toLowerCase();
  if (s.includes('vodafone') || s === 'vf' || s.startsWith('f04')) return 'vodafone';
  if (s.includes('wind') || s === 'wn' || s.startsWith('f07')) return 'wn';
  if (s.includes('tim') || s.includes('telecom italia')) return 'tim';
  if (s.includes('sky')) return 'sky';
  if (s.includes('iliad')) return 'iliad';
  if (s.includes('fastweb')) return 'fw';
  if (s.includes('enel') || s.includes('eni')) return 'eni';
  if (s.includes('eolo')) return 'eolo';
  if (s.includes('optima')) return 'opi';
  if (s.includes('connecting')) return 'connecting';
  if (s.includes('poste')) return 'poste';
  if (s.includes('aruba')) return 'aruba';
  if (s.includes('tiscali')) return 'tiscali';
  if (s.includes('iren')) return 'iren';
  return s;
}

function normalizeOperatoreFromOlo(raw) {
  const s = raw.toLowerCase();
  if (s.startsWith('vf_')) return 'vodafone';
  if (s.startsWith('wn_')) return 'wn';
  if (s.startsWith('opi_')) return 'opi';
  if (s.startsWith('opt-') || s.startsWith('opt_')) return 'opi';
  if (s.startsWith('sky_')) return 'sky';
  if (s.startsWith('fw_')) return 'fw';
  if (s.startsWith('ila_')) return 'iliad';
  if (s.startsWith('tim_')) return 'tim';
  if (s.startsWith('ene_')) return 'eni';
  if (s.startsWith('eol_')) return 'eolo';
  if (s.startsWith('coc_')) return 'connecting';
  return '';
}

/**
 * Estrae gli apparati reali da installare.
 * 
 * FONTE PRIMARIA: "Apparati in consegna: (<nome>)" nelle NOTE IMPRESA
 * FONTE SECONDARIA: "TIPOLOGIA_APPARATO - <nome>" seguito da "Consegna e installazione"
 * 
 * IGNORA: "Seriale borchia", "Splitter", codici numerici, codici porta
 */
function extractApparati(fullText) {
  const apparati = [];
  const seen = new Set();
  
  function add(normalized) {
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      apparati.push(normalized);
    }
  }
  
  // 1. "Apparati in consegna: (...)" — la fonte più chiara
  const consegnaMatch = fullText.match(/Apparati in consegna:\s*\(([^)]+)\)/i);
  if (consegnaMatch) {
    add(normalizeApparato(consegnaMatch[1].trim()));
  }
  
  // 2. TIPOLOGIA_APPARATO: cattura il valore fino al prossimo campo strutturato
  const allApparati = [...fullText.matchAll(/TIPOLOGIA_APPARATO\s*-\s*([A-Za-z0-9_.\- ]+?)(?:\s{2,}|\s*(?:AZIONE_APPARATO|PASSWORD_APPARATO|DESC_AZIONE|NOME_SERVIZIO|PORTA|CONSEGNA))/gi)];
  for (const m of allApparati) {
    const raw = m[1].trim();
    if (!raw || raw.length < 2) continue;
    // Ignora roba di sistema
    if (/^Seriale|^Splitter|^borchia/i.test(raw)) continue;
    // I codici materiale numerici (785632, 784010, 781093...) SONO apparati:
    // si scartano solo i numeretti di servizio
    if (/^\d{1,4}$/.test(raw)) continue;
    add(normalizeApparato(raw));
  }
  
  // 3. Extender se menzionato nelle note
  if (/extender/i.test(fullText) && !seen.has('extender')) {
    apparati.push('extender');
  }
  
  return apparati.join(' + ');
}

// Codici materiale numerici: il portale (e quindi la scheda del nostro exporter)
// stampa solo il numero al posto del modello.
//   785632 = TIM HUB PRO (la diagnostica WFM lo nomina "TIM_HUB_PRO - nmu: 785632")
//   784010 = TIM Vision (TIM, non un modem)
// Gli altri codici restano così come sono: i tecnici li riconoscono a memoria.
const CODICI_MATERIALE = {
  '785632': 'tim hub pro',
  '784010': 'tim vision',
};

// Tipologie apparato introdotte dai portali dopo la prima versione del parser.
// Il legacy non le conosceva e le scartava: qui si aggiungono senza toccare le
// regole storiche (che restano valide per i PDF già in uso).
const APPARATI_PORTALE = [
  [/^MODEM_MIG/i, 'modem mig'],
  [/^EXTENDER_SEVEN/i, 'extender seven'],
  [/^EOLOROUTER/i, 'eolo router wifi 7'],
  [/^CPE_INT_MB_2\.5/i, 'Cpe_int_mb_2.5'],
  [/^CPE_INT$/i, 'Cpe_int'],
  // CPE_2.5, CPE_PLE_2.5G e CPE_CP_2.5 sono lo stesso modem ZTE 6745P
  [/^CPE_(PLE_2\.5G|CP_2\.5|2\.5)$/i, 'Cpe_2.5'],
  [/^CPE_POSTE_2\.5/i, 'Cpe_post_2.5'],
  [/^CPE_TIS_2\.5/i, 'Cpe_tis_2.5'],
  [/^CPE$/i, 'cpe'],
  [/^ONT(_\d+)?$/i, 'ont'],
];

function apparatoDaPortale(s) {
  for (const [re, nome] of APPARATI_PORTALE) {
    if (re.test(s)) return nome;
  }
  return '';
}

// Codice materiale numerico -> modello noto, oppure il codice stesso
function nomeCodiceMateriale(s) {
  if (!/^\d{5,7}$/.test(s)) return '';
  return CODICI_MATERIALE[s] || s;
}

function normalizeApparato(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s.length < 2) return null;
  // Ignora roba di sistema e i numeretti di servizio (porte, progressivi)
  if (/^Seriale|^Splitter|^borchia|^\d{1,4}$/i.test(s)) return null;
  
  // Codici materiale e tipologie nuove (prima delle regole storiche)
  const codice = nomeCodiceMateriale(s);
  if (codice) return codice;
  const portale = apparatoDaPortale(s);
  if (portale) return portale;
  
  const lower = s.toLowerCase();
  if (lower.includes('modem_nexxt_one')) return 'modem nexxt one';
  if (lower.includes('modem_nexxt')) return 'modem nexxt';
  if (lower.includes('modem_seven')) return 'modem seven';
  if (lower === 'hub6' || lower.includes('hub6')) return 'hub6';
  if (lower.includes('ont_of_2.5g')) return 'ont 2.5 G';
  if (lower.includes('ont_sky_of')) return 'ont sky of';
  if (lower.startsWith('ont_of')) return 'ont 2.5 G';
  if (lower.includes('ont') && lower.includes('2.5')) return 'ont 2.5 G';
  if (lower.includes('cpe_int_2.5')) return 'Cpe_int_2.5';
  if (lower === 'cpe3' || lower.startsWith('cpe3')) return 'cpe3';
  if (lower === 'vik' || lower.includes('vik')) return 'wi-fi 7';
  if (lower.includes('cpe wi-fi 7') || lower.includes('cpe wifi 7')) return 'wi-fi 7';
  if (lower.includes('cpe wi-fi 6') || lower.includes('cpe wifi 6')) return 'wi-fi 6';
  if (lower.startsWith('cpe wi')) return 'wi-fi 6'; // "CPE WI" troncato = wi-fi 6
  if (lower === 'sim' || lower.includes('sim2')) return 'sim';
  if (lower.includes('cpe') && lower.includes('sky')) return 'cpe sky';
  
  return null; // Ignora qualsiasi cosa non riconosciuta
}

function extractTipoImpianto(fullText) {
  // Cerchiamo nel campo strutturato
  const tipoPt = extractField(fullText, /TIPO_PUNTO_TERMINAZIONE\s*-\s*(\S+)/i);
  if (tipoPt) {
    const t = tipoPt.toLowerCase();
    if (t === 'pte') return 'pte';
    if (t.includes('pozzetto')) return 'pta pozzetto';
    if (t.includes('facciata')) return 'pta facciata';
    if (t.includes('palo')) return 'pta palo';
  }
  return '';
}

function extractNote(fullText) {
  const noteMatch = fullText.match(/NOTE_INTERNE\s*-\s*([^;]+)/i) ||
                    fullText.match(/DESCR\.\s*LAVORO:\s*-\s*-\s*NOTE\s*:\s*([^;]+)/i);
  if (!noteMatch || !noteMatch[1]) return '';
  
  const n = noteMatch[1].trim();
  // Ignora note di sistema
  if (/Connectivity not available|Assenza Portante/i.test(n)) return '';
  if (n.length < 3 || n === '-') return '';
  return n;
}

// ── Funzioni di formattazione ───────────────────────────────────────────────

function formatDescrizioneSito(item) {
  // Testo uniforme (indirizzo, operatore, apparati, tag del tipo di lavoro):
  // vedi js/formattatore.js, condiviso con la tabella del sito e con l'Excel.
  return formattaDescrizione(item);
}

function formatDescrizioneExcel(item) {
  return formatDescrizioneSito(item);
}
function formatTecnicoCentrale(item) {
  let localita = '';
  const cent = item.centrale ? item.centrale.toLowerCase() : '';
  
  if (cent.includes('fco')) {
    const match = cent.match(/fco\/?(\d+)/);
    if (match) {
      localita = `Pop${match[1]}`;
    } else {
      localita = 'Pop3'; // fallback
    }
  } else if (cent.includes('toh')) {
    const match = cent.match(/toh\D*(\d+)/);
    if (match) {
      localita = `toh${match[1]}`;
    } else {
      localita = 'toh1'; // fallback
    }
  } else {
    // Altrimenti usiamo il Comune normalizzato (es. Asti, Biella...)
    localita = item.comune ? item.comune.charAt(0).toUpperCase() + item.comune.slice(1).toLowerCase() : '';
  }

  const appaltoClean = item.appalto ? item.appalto.toLowerCase() : '';
  return [item.tecnico, localita, appaltoClean].filter(Boolean).join(' ');
}

function toMinutes(s) {
  if (!s) return 0;
  const parts = s.replace('.', ':').split(':');
  return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
}
