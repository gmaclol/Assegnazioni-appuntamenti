/**
 * Scrittura uniforme delle descrizioni degli interventi (sito ed Excel).
 *
 * Regole:
 *  - indirizzo in minuscolo/maiuscolo normale (Via, Corso, Piazza…), con le
 *    particelle in minuscolo (Via dei Mille, Corso alla Vittoria 36);
 *  - telefono fra parentesi subito dopo l'indirizzo;
 *  - operatore (OLO) in maiuscolo: WN, FW, ILIAD, ENI, TISCALI, VODAFONE, SKY, TIM;
 *  - apparati in maiuscolo: CPE3 + SFP, ONT 2.5 G, WI-FI 6 + SIM;
 *  - tag del tipo di intervento in fondo: GUASTO, BORCHIA, MIGRAZIONE (niente per
 *    le attivazioni normali), così sul foglio si legge subito di che lavoro si tratta;
 *  - separatore " · " fra i blocchi; niente più "ok" finale.
 *
 * Modulo puro (niente DOM, niente rete): testato in `test_formattatore.mjs`.
 */

// Parole che restano minuscole dentro un indirizzo ("Via dei Mille", "Corso alla Vittoria")
const PARTICOLARI = new Set([
  'di', 'del', 'dello', 'della', 'dei', 'degli', 'delle',
  'da', 'dal', 'dallo', 'dalla', 'dai', 'dagli', 'dalle',
  'in', 'su', 'al', 'allo', 'alla', 'ai', 'agli', 'alle',
  'e', 'ed',
]);

// Operatori come li scrive l'ufficio (in maiuscolo)
const OPERATORI = {
  wn: 'WN',
  fw: 'FW',
  tim: 'TIM',
  iliad: 'ILIAD',
  eni: 'ENI',
  tiscali: 'TISCALI',
  vodafone: 'VODAFONE',
  sky: 'SKY',
  fastweb: 'FASTWEB',
  windtre: 'WIND3',
};

function primaMaiuscola(parola) {
  if (!parola) return parola;
  return parola.charAt(0).toUpperCase() + parola.slice(1);
}

/**
 * Indirizzo con le iniziali maiuscole: "CORSO ALESSANDRIA 75" -> "Corso Alessandria 75".
 * I numeri e le abbreviazioni restano come sono; le particelle restano minuscole.
 */
export function titoloLuogo(indirizzo) {
  const pulito = String(indirizzo || '').replace(/\s+/g, ' ').trim();
  if (!pulito) return '';
  return pulito
    .toLowerCase()
    .split(' ')
    .map((parola, indice) => {
      if (!parola) return parola;
      if (indice > 0 && PARTICOLARI.has(parola)) return parola;
      // "s.giorgio" o "dei-mille": maiuscola a ogni pezzo separato da apostrofo o trattino
      return parola.split(/(-|')/).map(pezzo => (pezzo === '-' || pezzo === "'" ? pezzo : primaMaiuscola(pezzo))).join('');
    })
    .join(' ')
    // "21a" -> "21A", "12b" -> "12B": la lettera dopo il civico resta maiuscola
    .replace(/(\d)([a-z])/g, (_, cifra, lettera) => cifra + lettera.toUpperCase());
}

/** Operatore (OLO) in maiuscolo, con i nomi già noti. */
export function operatoreMaiuscolo(olo) {
  const chiave = String(olo || '').trim().toLowerCase();
  if (!chiave) return '';
  return OPERATORI[chiave] || chiave.toUpperCase();
}

/** Apparati in maiuscolo e con gli spazi normalizzati ("cpe3 + sfp" -> "CPE3 + SFP"). */
export function apparatiMaiuscoli(apparati) {
  const pulito = String(apparati || '').replace(/\s+/g, ' ').trim();
  return pulito ? pulito.toUpperCase() : '';
}

/** Tipo di lavoro da scrivere in fondo alla descrizione. */
export function tagIntervento(item = {}) {
  if (item.tipoIntervento === 'Guasto' || item.areaCd) return 'GUASTO';
  if (item.sezione === 'borchia') return 'BORCHIA';
  if (item.sezione === 'migrazione') return 'MIGRAZIONE';
  return '';
}

// Via e civico da un indirizzo normale ("Via dei Mille 12" -> via "Via dei Mille", civico "12")
export function viaECivico(indirizzo) {
  const testo = String(indirizzo || '').replace(/_/g, ' ').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  if (!testo) return { via: '', civico: '' };
  const m = testo.match(/^(.*?)\s+(\d+[A-Za-z]?(?:\/[A-Za-z])?)$/);
  if (!m) return { via: testo, civico: '' };
  return { via: m[1].trim(), civico: m[2] };
}

/**
 * Via e civico del punto di terminazione. Due formati:
 *  - schede: "A479_VIA GUIDO GINELLA_3_A_1 (Porta: 1)" (codice_via_civico_porta)
 *  - Work Order: "VIA PIETRO MICCA, 3"
 */
export function indirizzoPte(pte) {
  let testo = String(pte || '').replace(/\([^)]*\)/g, ' ').trim();
  if (!testo) return { via: '', civico: '' };
  // Alcune schede scrivono il percorso completo: "AT_01/01e24/A479_CORSO ALESSANDRIA_75"
  if (testo.includes('/')) testo = testo.split('/').filter(Boolean).pop() || testo;
  if (testo.includes('_')) {
    const senzaCodice = testo.replace(/^[A-Z]{1,3}\d*_/i, '');
    const pezzi = senzaCodice.split('_').map(p => p.trim()).filter(Boolean);
    const indice = pezzi.findIndex(p => /^\d/.test(p));
    if (indice > 0) return { via: pezzi.slice(0, indice).join(' '), civico: pezzi[indice] };
    return { via: pezzi.join(' '), civico: '' };
  }
  return viaECivico(testo);
}

// Confronto fra vie/civici: minuscole, senza accenti né punteggiatura
function normalizza(valore) {
  return String(valore || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Impianto di terminazione da scrivere nella descrizione:
 *  - PTA POZZETTO / PTA FACCIATA / PTA PALO sempre;
 *  - per la PTE solo se è in un posto diverso dal civico dell'appuntamento:
 *    "PTE al 147" se cambia il civico, "PTE in Via dei Mille 12" se cambia la via;
 *    se la PTE è allo stesso indirizzo non si scrive niente.
 */
export function etichettaImpianto(item = {}) {
  const tipo = String(item.tipoImpianto || '').toLowerCase();
  if (!tipo) return '';
  if (tipo.includes('pozzetto')) return 'PTA POZZETTO';
  if (tipo.includes('facciata')) return 'PTA FACCIATA';
  if (tipo.includes('palo')) return 'PTA PALO';
  if (!tipo.includes('pte')) return '';

  const pte = indirizzoPte(item.pteIndirizzo);
  const appuntamento = viaECivico(item.indirizzo);
  if (!pte.via || !appuntamento.via) return '';

  const stessaVia = normalizza(pte.via) === normalizza(appuntamento.via);
  const stessoCivico = !pte.civico || !appuntamento.civico
    ? true
    : normalizza(pte.civico) === normalizza(appuntamento.civico);
  if (stessaVia && stessoCivico) return '';
  if (stessaVia) return `PTE al ${pte.civico}`;
  return `PTE in ${titoloLuogo(pte.via)}${pte.civico ? ' ' + pte.civico : ''}`;
}

/**
 * Descrizione completa dell'intervento, uguale sul sito e sull'Excel.
 *
 * @param {Object} item appuntamento (indirizzo, telefono, oloOperatore, apparati,
 *                      tipoIntervento, sezione, areaCd)
 * @returns {string} es. "Corso Alessandria 75 (0141274004 / 3391218194) · WN · CPE_INT"
 */
export function formattaDescrizione(item = {}) {
  const parti = [];
  const indirizzo = titoloLuogo(item.indirizzo);
  const telefono = String(item.telefono || '').replace(/\s+/g, ' ').trim();

  if (indirizzo && telefono) parti.push(`${indirizzo} (${telefono})`);
  else if (indirizzo) parti.push(indirizzo);
  else if (telefono) parti.push(`(${telefono})`);

  const tag = tagIntervento(item);
  const operatore = operatoreMaiuscolo(item.oloOperatore);
  if (operatore) parti.push(operatore);

  // I guasti non portano gli apparati (regola storica: serve solo dove intervenire)
  const apparati = tag === 'GUASTO' ? '' : apparatiMaiuscoli(item.apparati);
  if (apparati) parti.push(apparati);

  const impianto = etichettaImpianto(item);
  if (impianto) parti.push(impianto);

  if (tag) parti.push(tag);
  return parti.join(' · ');
}

/**
 * Riconosce una descrizione generata dall'app nella versione vecchia
 * (prima del formattatore): comincia con l'indirizzo e finisce con " ok".
 * Serve a riformattare gli interventi già salvati in lista, senza toccare i
 * testi che l'ufficio ha scritto a mano.
 */
export function sembraDescrizioneAutomatica(item = {}) {
  const testo = String(item.descrizioneSito || '').trim();
  if (!testo) return false;
  if (!/\sok$/i.test(testo)) return false;
  const indirizzo = String(item.indirizzo || '').trim().toLowerCase();
  const inizio = testo.toLowerCase();
  const iniziaConIndirizzo = Boolean(indirizzo) && inizio.startsWith(indirizzo);
  const contieneTelefono = Boolean(item.telefono) && testo.includes(String(item.telefono));
  return iniziaConIndirizzo || contieneTelefono;
}

/**
 * Descrizione da mostrare/stampare per un intervento: quella scritta a mano se
 * l'ufficio l'ha modificata, altrimenti quella riformattata al momento (così il
 * tag GUASTO/BORCHIA/MIGRAZIONE segue sempre il pallino scelto).
 *
 * @param {Object} item appuntamento
 * @returns {string}
 */
export function descrizioneIntervento(item = {}) {
  const attuale = item.descrizioneSito || item.descrizioneExcel || '';
  const generata = item.descrizioneAuto;
  if (!attuale) return formattaDescrizione(item);
  if (generata && attuale === generata) return formattaDescrizione(item);
  return attuale;
}
