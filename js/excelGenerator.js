import ExcelJS from 'exceljs';
import { FASCE_BASE, fasciaDi, confrontaAppuntamenti, toMinuti } from './fasce.js';
import { descrizioneIntervento } from './formattatore.js';

/**
 * Genera il file Excel identico al modello ufficiale
 * "Attività Technical Work Srl del.xlsx" (il "vergine" dell'ufficio):
 *   riga 1  ATTIVITA' TECHNICALWORK SRL del GG MM AAAA  (giallo, testo rosso, centrato)
 *   riga 3  IMPIANTI DA REALIZZARE | TECNICO/CENTRALE     (giallo, testo rosso, centrato)
 *   righe 6+ una riga per appuntamento: orario (ora vera, formato h:mm) su sfondo
 *            della fascia, descrizione su sfondo arancione (grigio per i guasti),
 *            tecnico con il suo colore
 *   sezione IMPIANTI DA SOSPENDERE (3 posti per fascia) e IMPIANTI DA CHIUDERE (4 per fascia)
 *
 * Ogni fascia oraria viene sempre stampata: i posti liberi della sezione principale
 * escono con "Altro appuntamento" al posto dell'indirizzo, così la fascia si vede
 * anche quando è vuota e c'è spazio per scriverci a mano.
 *
 * Colori, font (Calibri 11, mai grassetto), bordi, larghezze colonne e fusioni sono
 * quelli del modello: vedi `work/confronta_stili.py` per la verifica 1:1.
 */

const FONT = 'Calibri';
const BORDO = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

// Testi: il modello ha bianco su fondo colorato, ma sulle colonne orario e tecnico
// (e sulla descrizione) l'ufficio vuole leggere comodamente: nero su colori.
const TESTO_DATI = 'FF000000';
const TESTO_DESCRIZIONE = 'FF000000';
const TESTO_INTESTAZIONE = 'FFFF0000'; // rosso delle righe gialle
const TESTO_SCURO = 'FF000000';        // nero per "Altro appuntamento" su bianco
const SFONDO_INTESTAZIONE = 'FFFFFF00';
const SFONDO_DESCRIZIONE_GUASTO = 'FFA5A5A5';   // solo i guasti
const SFONDO_DESCRIZIONE_SPOSTATO = 'FFFFFF00'; // solo le prese in carico spostate di fascia
// Tutte le altre descrizioni restano sul bianco del foglio.

// Circa quanti caratteri stanno nella colonna descrizione (52,60 di larghezza):
// serve per calcolare l'altezza della riga quando il testo va a capo.
const CARATTERI_PER_RIGA = 48;
const ALTEZZA_RIGA = 15;

// Colori delle fasce nel modello ufficiale (l'ora "successiva" della stessa fascia
// prende lo stesso colore: nel modello 11:00 e 11:30 sono entrambe verdi).
const COLORI_FASCIA = {
  '08:30': 'FFFF0000',
  '11:30': 'FF00B050',
  '14:30': 'FFC55A11',
  '16:30': 'FF4472C4',
};

const COLORI_SEZIONE = {
  sospendere: 3,
  chiudere: 4,
};

function solido(argb) {
  // bgColor serve perché alcune versioni di Excel mostrano la cella bianca senza
  return { type: 'pattern', pattern: 'solid', fgColor: { argb }, bgColor: { indexed: 64 } };
}

// Nome del tecnico riconosciuto all'inizio della stringa "Tecnico Localita appalto"
// (supporta squadre "Marco + Andrea" e nomi composti es. "Marco Gentile").
function nomeTecnico(tecnicoStr, techColors) {
  if (!tecnicoStr) return '';
  const primoMembro = String(tecnicoStr).split('+')[0].trim();
  if (!primoMembro) return '';
  const nomi = Object.keys(techColors).filter(Boolean).sort((a, b) => b.length - a.length);
  // 1) nome completo all'inizio (il più lungo vince)
  for (const nome of nomi) {
    if (primoMembro.toLowerCase().startsWith(nome.toLowerCase()) &&
        (primoMembro.length === nome.length || /\s/.test(primoMembro.charAt(nome.length)))) {
      return nome;
    }
  }
  // 2) il primo token è il solo nome di battesimo ("Marco + Mohamed"): vale un
  //    tecnico il cui nome inizia con quel token, ma solo se è l'unico (niente ambiguità)
  const prima = primoMembro.split(/\s+/)[0].toLowerCase();
  const candidati = nomi.filter(k => k.toLowerCase().split(/\s+/)[0] === prima);
  if (candidati.length === 1) return candidati[0];
  // 3) fallback: chiave identica al primo token
  return nomi.find(k => k.toLowerCase() === prima) || '';
}

// Colore di sfondo del tecnico (colonna 3)
function fillTecnico(tecnicoStr, techColors) {
  const nome = nomeTecnico(tecnicoStr, techColors);
  const hex = nome ? techColors[nome] : null;
  if (!hex) return null;
  return solido('FF' + String(hex).replace('#', ''));
}

// La presa in carico sull'app Open Fiber resta all'orario originale (è prioritaria),
// il lavoro si esegue all'orario nuovo: va scritto sulla scheda.
function testoDescrizione(item) {
  const base = descrizioneIntervento(item);
  if (!item.orarioOrigine) return base;
  return `(presa in carico ${item.orarioOrigine}) ${base}`;
}

function coloreFascia(orario) {
  return COLORI_FASCIA[fasciaDi(orario)] || COLORI_FASCIA['08:30'];
}

function isGuasto(item) {
  return item.tipoIntervento === 'Guasto' || Boolean(item.areaCd);
}

function isRossa(item) {
  return item.sezione === 'borchia' || item.sezione === 'migrazione';
}

/**
 * Costruisce il workbook (senza salvare: funziona anche fuori dal browser).
 *
 * @param {Array}  items      appuntamenti
 * @param {String} dataStr    data per il titolo (es. "24 11 2026")
 * @param {Object} techColors mappa nome tecnico -> colore hex
 * @returns {ExcelJS.Workbook}
 */
export function buildWorkbook(items = [], dataStr = '', techColors = {}, nomeFoglio = 'Foglio1') {
  const workbook = new ExcelJS.Workbook();
  aggiungiFoglio(workbook, items, dataStr, techColors, nomeFoglio);
  return workbook;
}

/**
 * Aggiunge un foglio (stesso stile del modello) a un workbook già esistente:
 * serve per i file di confronto con più fogli, scritti tutti dal generatore.
 *
 * @param {ExcelJS.Workbook} workbook
 * @param {Array}  items      appuntamenti
 * @param {String} dataStr    data per il titolo
 * @param {Object} techColors mappa nome tecnico -> colore hex
 * @param {String} nomeFoglio nome del foglio
 * @returns {ExcelJS.Worksheet}
 */
export function aggiungiFoglio(workbook, items = [], dataStr = '', techColors = {}, nomeFoglio = 'Foglio1') {
  const ws = workbook.addWorksheet(nomeFoglio);

  // Larghezze identiche al modello ufficiale
  ws.getColumn(1).width = 5.91796875;
  ws.getColumn(2).width = 52.59765625;
  ws.getColumn(3).width = 24.6171875;

  const stile = (cell, { fill, testo, centrato, aCapo, verticale } = {}) => {
    cell.font = { name: FONT, size: 11, color: { argb: testo || TESTO_DATI } };
    cell.border = BORDO;
    if (fill) cell.fill = fill;
    if (centrato) cell.alignment = { horizontal: 'center' };
    else if (aCapo || verticale) cell.alignment = { vertical: 'middle', ...(aCapo ? { wrapText: true } : {}) };
  };

  const intestazione = (cell, valore, centrata) => {
    cell.value = valore;
    stile(cell, { fill: solido(SFONDO_INTESTAZIONE), testo: TESTO_INTESTAZIONE, centrato: centrata });
  };

  // Orario come ora vera di Excel (numero di giorno + formato h:mm, come il modello)
  const mettiOrario = (cell, orario) => {
    cell.value = toMinuti(orario) / 1440;
    cell.numFmt = 'h:mm';
  };

  const rigaVuota = () => {
    const row = ws.addRow([]);
    for (let c = 1; c <= 3; c++) stile(row.getCell(c));
    return row;
  };

  const rigaAppuntamento = (item) => {
    const row = ws.addRow([]);
    const orario = item.orario || '08:30';
    const guasto = isGuasto(item);
    const descrizione = testoDescrizione(item);
    // Spostato = presa in carico in una fascia diversa dall'orario di lavoro
    const spostato = Boolean(item.orarioOrigine) && toMinuti(item.orarioOrigine) !== toMinuti(orario);
    const a = row.getCell(1);
    mettiOrario(a, orario);
    stile(a, { fill: solido(coloreFascia(orario)), verticale: true });
    const b = row.getCell(2);
    b.value = descrizione;
    // Sfondo: grigio per i guasti, giallo per gli spostamenti di fascia, bianco per il resto
    stile(b, {
      fill: guasto ? solido(SFONDO_DESCRIZIONE_GUASTO)
        : (spostato ? solido(SFONDO_DESCRIZIONE_SPOSTATO) : null),
      testo: isRossa(item) ? TESTO_INTESTAZIONE : TESTO_DESCRIZIONE,
      aCapo: true,
    });
    const c = row.getCell(3);
    c.value = item.tecnicoCentraleExcel || '';
    const fill = fillTecnico(item.tecnicoCentraleExcel, techColors);
    stile(c, { fill, verticale: true });
    // Excel non adatta l'altezza delle righe importate: la calcolo dal testo, altrimenti
    // la seconda riga dell'indirizzo viene tagliata in stampa.
    const righe = Math.max(1, Math.ceil((descrizione || '').length / CARATTERI_PER_RIGA));
    const righeTecnico = Math.max(1, Math.ceil(String(item.tecnicoCentraleExcel || '').length / 30));
    row.height = ALTEZZA_RIGA * Math.max(righe, righeTecnico);
    return row;
  };

  // Posto libero di un tecnico in una fascia: la fascia resta visibile e la colonna
  // di destra dice di chi è quel posto (serve a scriverci sopra in ufficio).
  const rigaAltroAppuntamento = (fascia, tecnicoExcel) => {
    const row = ws.addRow([]);
    const a = row.getCell(1);
    mettiOrario(a, fascia);
    stile(a, { fill: solido(coloreFascia(fascia)), verticale: true });
    const b = row.getCell(2);
    b.value = 'Altro appuntamento';
    stile(b, { testo: TESTO_SCURO, verticale: true });
    const c = row.getCell(3);
    c.value = tecnicoExcel || '';
    const fill = fillTecnico(tecnicoExcel, techColors);
    stile(c, { fill, verticale: true });
    return row;
  };

  // Posto vuoto da compilare a mano (sezioni sospendere/chiudere)
  const rigaPostoVuoto = (orario) => {
    const row = ws.addRow([]);
    const a = row.getCell(1);
    mettiOrario(a, orario);
    stile(a, { fill: solido(coloreFascia(orario)) });
    stile(row.getCell(2));
    stile(row.getCell(3));
    return row;
  };

  // ── RIGA 1: TITOLO ──
  const titolo = dataStr ? `ATTIVITA' TECHNICALWORK SRL del ${dataStr}` : "ATTIVITA' TECHNICALWORK SRL ";
  const r1 = ws.addRow([]);
  stile(r1.getCell(1));
  intestazione(r1.getCell(2), titolo, true);
  intestazione(r1.getCell(3), '', true);

  rigaVuota(); // riga 2

  // ── RIGA 3: INTESTAZIONE SEZIONE 1 ──
  const r3 = ws.addRow([]);
  stile(r3.getCell(1));
  intestazione(r3.getCell(2), 'IMPIANTI  DA REALIZZARE ', true);
  intestazione(r3.getCell(3), 'TECNICO/CENTRALE', true);

  rigaVuota(); // riga 4
  rigaVuota(); // riga 5 (nel modello i dati iniziano dalla riga 6)

  // ── SEZIONE 1: impianti, borchie e migrazioni ──
  const realizzare = (items || []).filter(i => i && (i.sezione === 'realizzare' || i.sezione === 'borchia' || i.sezione === 'migrazione'));
  // Stesso ordine della tabella a schermo: fascia, ordine manuale, orario, guasti in fondo
  realizzare.sort(confrontaAppuntamenti);

  const perFascia = new Map(FASCE_BASE.map(f => [f, []]));
  for (const item of realizzare) {
    const fascia = fasciaDi(item.orario);
    if (!perFascia.has(fascia)) perFascia.set(fascia, []);
    perFascia.get(fascia).push(item);
  }
  // Tecnici della giornata (quelli che compaiono sugli interventi da realizzare),
  // con la loro etichetta completa "Nome Localita appalto" usata nelle righe.
  const tecniciDelGiorno = new Map();
  for (const item of realizzare) {
    const nome = nomeTecnico(item.tecnicoCentraleExcel, techColors);
    const etichetta = item.tecnicoCentraleExcel || '';
    if (nome && !tecniciDelGiorno.has(nome)) tecniciDelGiorno.set(nome, etichetta);
    else if (!nome && etichetta && !tecniciDelGiorno.has(etichetta)) tecniciDelGiorno.set(etichetta, etichetta);
  }

  // Un tecnico fa un intervento per fascia: si stampano le righe che ci sono e, per
  // ogni tecnico che in quella fascia non ha niente, una riga "Altro appuntamento"
  // con il suo nome a destra (così si vede subito chi è libero e ci si scrive sopra).
  for (const fascia of FASCE_BASE) {
    const lista = perFascia.get(fascia) || [];
    for (const item of lista) rigaAppuntamento(item);

    const impegnati = new Set(lista.map(i => nomeTecnico(i.tecnicoCentraleExcel, techColors)).filter(Boolean));
    const liberi = [...tecniciDelGiorno.entries()]
      .filter(([nome]) => !impegnati.has(nome))
      .sort((a, b) => a[1].localeCompare(b[1], 'it'));
    if (!tecniciDelGiorno.size) {
      rigaAltroAppuntamento(fascia);   // giornata senza tecnici assegnati
    } else {
      for (const [, etichetta] of liberi) rigaAltroAppuntamento(fascia, etichetta);
    }
  }

  // ── SEZIONI 2 e 3: sospendere e chiudere ──
  const sezioni = [
    { chiave: 'sospendere', titolo: '                                 IMPIANTI DA SOSPENDERE ' },
    { chiave: 'chiudere', titolo: '                                 IMPIANTI DA CHIUDERE ' },
  ];
  sezioni.forEach((sezione, indice) => {
    rigaVuota();
    const header = ws.addRow([]);
    stile(header.getCell(1));
    intestazione(header.getCell(2), sezione.titolo, false);
    stile(header.getCell(3));
    rigaVuota();

    for (const item of (items || []).filter(i => i && i.sezione === sezione.chiave)) {
      rigaAppuntamento(item);
    }
    for (const fascia of FASCE_BASE) {
      for (let i = 0; i < COLORI_SEZIONE[sezione.chiave]; i++) rigaPostoVuoto(fascia);
    }
    // Nel modello fra i posti della sezione e il titolo della successiva ci sono
    // due righe vuote (la prima sezione ne ha una sola)
    rigaVuota();
    if (indice === 0) rigaVuota();
  });

  return ws;
}

/**
 * Export dal browser: costruisce il file e lo scarica.
 *
 * @param {Array} items Lista di appuntamenti
 * @param {String} dataStr Data (es. "24 11 2026")
 * @param {Object} techColors Mappa nome tecnico -> colore hex
 */
export async function exportToExcel(items, dataStr = '', techColors = {}) {
  if (!dataStr) {
    const oggi = new Date();
    const dd = String(oggi.getDate()).padStart(2, '0');
    const mm = String(oggi.getMonth() + 1).padStart(2, '0');
    dataStr = `${dd} ${mm} ${oggi.getFullYear()}`;
  }

  const workbook = buildWorkbook(items, dataStr, techColors);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `Attività Technical Work Srl del ${dataStr}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
