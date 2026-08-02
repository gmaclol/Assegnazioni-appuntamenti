import * as pdfjsLib from 'pdfjs-dist';

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
      
      // STEP 2: Raggruppa le pagine per WR code
      const wrGroups = groupPagesByWR(pages);
      
      // STEP 3: Parsa ogni gruppo
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
  // Tipo: 79 = Assurance (Guasto), Tipo: 70/78 = Delivery (Attivazione)
  const tipoMatch = header.match(/Tipo:\s*(\d+)/);
  const tipoNum = tipoMatch ? parseInt(tipoMatch[1]) : 0;
  const isGuasto = tipoNum === 79 || /ASSURANCE/i.test(header);
  const tipoIntervento = isGuasto ? 'Guasto' : 'Attivazione';
  
  // --- ORARIO / FASCIA ---
  const orario = extractOrario(header);
  
  // --- INDIRIZZO ---
  // Il campo "Indiriz.:" è SOLO nella prima pagina dell'intestazione
  const indirizzo = extractIndirizzo(header, fullText);
  
  // --- CLIENTE ---
  const cliente = extractCliente(header, fullText);
  
  // --- TELEFONO ---
  const telefono = extractField(fullText, /RECAPITO_TELEFONICO_CLIENTE_1\s*-\s*([0-9]+)/) ||
                   extractField(header, /Telefono Reclamante:\s*([0-9]+)/);
  
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
  
  // --- AREA CD (Cluster Guasti AB vs CD) ---
  let areaCd = '';
  const mArea = fullText.match(/AREA[_\s]*CD\s*[-:\s]*\s*(AB|CD)/i) || 
                header.match(/AREA[_\s]*CD\s*[-:\s]*\s*(AB|CD)/i) ||
                fullText.match(/AREA_CD\s*-\s*(AB|CD)/i);
  if (mArea) {
    areaCd = mArea[1].toUpperCase();
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
    areaCd,
    sezione: 'realizzare',
    tecnico: ''
  };
  
  item.descrizioneSito = formatDescrizioneSito(item);
  item.descrizioneExcel = formatDescrizioneExcel(item);
  item.tecnicoCentraleExcel = formatTecnicoCentrale(item);
  
  return item;
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
  if (s.includes('tim')) return 'tim';
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
    // Ignora codici numerici puri (es. 784010, 785632)
    if (/^\d+$/.test(raw)) continue;
    add(normalizeApparato(raw));
  }
  
  // 3. Extender se menzionato nelle note
  if (/extender/i.test(fullText) && !seen.has('extender')) {
    apparati.push('extender');
  }
  
  return apparati.join(' + ');
}

function normalizeApparato(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s.length < 2) return null;
  // Ignora roba di sistema e codici numerici puri
  if (/^Seriale|^Splitter|^borchia|^\d+$/i.test(s)) return null;
  
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
  const parts = [];
  if (item.indirizzo) parts.push(item.indirizzo);
  if (item.telefono) parts.push(`(${item.telefono})`);
  if (item.oloOperatore) parts.push(item.oloOperatore);
  if (item.tipoIntervento === 'Guasto') {
    parts.push('(GUASTO)');
  } else {
    if (item.apparati) parts.push(item.apparati);
  }
  parts.push('ok');
  return parts.join(' ');
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
      localita = `pop${match[1]}`;
    } else {
      localita = 'pop3'; // fallback
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
