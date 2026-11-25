/**
 * Test del formattatore delle descrizioni (js/formattatore.js) — nessun DOM.
 *
 * Uso: node test_formattatore.mjs
 *
 * Verifica la scrittura uniforme: indirizzo con le iniziali maiuscole e le
 * particelle minuscole, operatore e apparati in maiuscolo, tag BORCHIA /
 * MIGRAZIONE / GUASTO in fondo, separatore " · ", niente "ok" finale.
 */
import {
  formattaDescrizione,
  descrizioneIntervento,
  titoloLuogo,
  operatoreMaiuscolo,
  apparatiMaiuscoli,
  tagIntervento,
  etichettaImpianto,
  indirizzoPte,
  viaECivico,
  sembraDescrizioneAutomatica,
} from './js/formattatore.js';

let passati = 0;
let falliti = 0;

function verifica(nome, condizione, dettaglio = '') {
  if (condizione) {
    passati++;
    console.log(`  ✓ ${nome}`);
  } else {
    falliti++;
    console.log(`  ✗ ${nome}${dettaglio ? ' — ' + dettaglio : ''}`);
  }
}

const scheda = (extra = {}) => ({
  indirizzo: 'CORSO ALESSANDRIA 75',
  telefono: '0141274004 / 3391218194',
  oloOperatore: 'wn',
  apparati: 'Cpe_int',
  tipoIntervento: 'Attivazione',
  sezione: 'realizzare',
  ...extra,
});

// ── 1. Indirizzi ────────────────────────────────────────────────────────────
console.log('\n1) Indirizzo');
verifica('iniziali maiuscole', titoloLuogo('CORSO ALESSANDRIA 75') === 'Corso Alessandria 75');
verifica('particelle minuscole', titoloLuogo('VIA DEI MILLE 12') === 'Via dei Mille 12');
verifica('particelle a inizio indirizzo con maiuscola', titoloLuogo('DEI MILLE 12') === 'Dei Mille 12');
verifica('apostrofi e trattini', titoloLuogo("VIA D'ANGELO 3") === "Via D'Angelo 3");
verifica('lettera del civico in maiuscolo', titoloLuogo('VIA FRANCESCO PETRARCA 21A') === 'Via Francesco Petrarca 21A');
verifica('spazi doppi tolti', titoloLuogo('  VIA   ROMA   1 ') === 'Via Roma 1');

// ── 2. Operatore e apparati ────────────────────────────────────────────────
console.log('\n2) Operatore e apparati');
verifica('operatore in maiuscolo', operatoreMaiuscolo('wn') === 'WN');
verifica('operatore noto mappato', operatoreMaiuscolo('FW') === 'FW' && operatoreMaiuscolo('iliad') === 'ILIAD');
verifica('apparati in maiuscolo', apparatiMaiuscoli('cpe3 + sfp') === 'CPE3 + SFP');
verifica('spazi apparati normalizzati', apparatiMaiuscoli('  ont 2.5 G   +   modem seven ') === 'ONT 2.5 G + MODEM SEVEN');

// ── 3. Tag del tipo di lavoro ──────────────────────────────────────────────
console.log('\n3) Tag del tipo di lavoro');
verifica('guasto', tagIntervento({ tipoIntervento: 'Guasto' }) === 'GUASTO');
verifica('guasto da cluster (areaCd)', tagIntervento({ areaCd: 'CD' }) === 'GUASTO');
verifica('borchia', tagIntervento({ sezione: 'borchia' }) === 'BORCHIA');
verifica('migrazione', tagIntervento({ sezione: 'migrazione' }) === 'MIGRAZIONE');
verifica('attivazione normale senza tag', tagIntervento({ sezione: 'realizzare', tipoIntervento: 'Attivazione' }) === '');

// ── 4. Descrizione completa ────────────────────────────────────────────────
console.log('\n4) Descrizione completa');
verifica('attivazione',
  formattaDescrizione(scheda()) === 'Corso Alessandria 75 (0141274004 / 3391218194) · WN · CPE_INT',
  formattaDescrizione(scheda()));
verifica('migrazione con tag in fondo',
  formattaDescrizione(scheda({ sezione: 'migrazione', apparati: 'wi-fi 6 + sim', indirizzo: 'CORSO FELICE CAVALLOTTI 118' }))
  === 'Corso Felice Cavallotti 118 (0141274004 / 3391218194) · WN · WI-FI 6 + SIM · MIGRAZIONE');
verifica('borchia con tag',
  formattaDescrizione(scheda({ sezione: 'borchia' })).endsWith('· BORCHIA'));
verifica('guasto senza apparati e senza "ok"',
  formattaDescrizione(scheda({ tipoIntervento: 'Guasto', telefono: '', indirizzo: 'VIA GUIDO GINELLA 3', oloOperatore: 'fw' }))
  === 'Via Guido Ginella 3 · FW · GUASTO');
verifica('niente "ok" finale', !formattaDescrizione(scheda()).endsWith('ok'));
verifica('descrive anche senza operatore',
  formattaDescrizione({ indirizzo: 'VIA ROMA 1', tipoIntervento: 'Attivazione' }) === 'Via Roma 1');

// ── 5. Impianto di terminazione (PTA / PTE) ────────────────────────────────
console.log('\n5) Impianto di terminazione');
verifica('via+civico da un indirizzo', (() => {
  const p = viaECivico('CORSO ALESSANDRO VOLTA 143');
  return p.via === 'CORSO ALESSANDRO VOLTA' && p.civico === '143';
})());
verifica('PTE dal nome scheda', (() => {
  const p = indirizzoPte('A479_VIA GUIDO GINELLA_3_A_1 (Porta: 1)');
  return p.via === 'VIA GUIDO GINELLA' && p.civico === '3';
})());
verifica('PTE con civico alfanumerico', (() => {
  const p = indirizzoPte('A479_VIA SECONDO ARÒ_70C_1');
  return p.via === 'VIA SECONDO ARÒ' && p.civico === '70C';
})());
verifica('PTE dal Work Order legacy', (() => {
  const p = indirizzoPte('VIA PIETRO MICCA, 3');
  return p.via === 'VIA PIETRO MICCA' && p.civico === '3';
})());
verifica('PTE con percorso completo davanti', (() => {
  const p = indirizzoPte('AT_01/01e24/A479_CORSO ALESSANDRIA_75 (Porta: AT_01/01e24/A479_CORSO ALESSANDRIA_75-P_003)');
  return p.via === 'CORSO ALESSANDRIA' && p.civico === '75';
})());

verifica('PTA POZZETTO sempre scritta',
  etichettaImpianto({ tipoImpianto: 'pta pozzetto', indirizzo: 'VIA ROMA 1' }) === 'PTA POZZETTO');
verifica('PTA FACCIATA sempre scritta',
  etichettaImpianto({ tipoImpianto: 'pta facciata', indirizzo: 'VIA ROMA 1' }) === 'PTA FACCIATA');
verifica('PTA PALO sempre scritta',
  etichettaImpianto({ tipoImpianto: 'pta palo', indirizzo: 'VIA ROMA 1' }) === 'PTA PALO');

verifica('PTE allo stesso civico: non si scrive niente',
  etichettaImpianto({ tipoImpianto: 'pte', indirizzo: 'VIA GUIDO GINELLA 3', pteIndirizzo: 'A479_VIA GUIDO GINELLA_3_A_1 (Porta: 1)' }) === '');
verifica('PTE allo stesso civico ma con accenti diversi: niente',
  etichettaImpianto({ tipoImpianto: 'pte', indirizzo: 'VIA SECONDO ARO 70C', pteIndirizzo: 'A479_VIA SECONDO ARÒ_70C_1' }) === '');
verifica('PTE stessa via, civico diverso: "PTE al …"',
  etichettaImpianto({ tipoImpianto: 'pte', indirizzo: 'CORSO ALESSANDRO VOLTA 143', pteIndirizzo: 'A479_CORSO ALESSANDRO VOLTA_147_1' }) === 'PTE al 147');
verifica('PTE in un\'altra via: "PTE in …"',
  etichettaImpianto({ tipoImpianto: 'pte', indirizzo: 'CORSO ALESSANDRO VOLTA 143', pteIndirizzo: 'A479_VIA DEI MILLE_12_1' }) === 'PTE in Via dei Mille 12');
verifica('PTE legacy allo stesso indirizzo: niente',
  etichettaImpianto({ tipoImpianto: 'pte', indirizzo: 'VIA PIETRO MICCA 3', pteIndirizzo: 'VIA PIETRO MICCA, 3' }) === '');
verifica('tipo N/D: niente', etichettaImpianto({ tipoImpianto: '', indirizzo: 'VIA ROMA 1' }) === '');

verifica('PTA POZZETTO nella descrizione, prima del tag',
  formattaDescrizione(scheda({ indirizzo: 'CORSO FELICE CAVALLOTTI 118', telefono: '3202597782', oloOperatore: 'vodafone', apparati: 'wi-fi 6 + sim', tipoImpianto: 'pta pozzetto', sezione: 'migrazione' }))
  === 'Corso Felice Cavallotti 118 (3202597782) · VODAFONE · WI-FI 6 + SIM · PTA POZZETTO · MIGRAZIONE');
verifica('PTE al civico diverso nella descrizione',
  formattaDescrizione({ indirizzo: 'CORSO ALESSANDRO VOLTA 143', telefono: '3887828033', oloOperatore: 'iliad', apparati: 'cpe3 + SFP', tipoImpianto: 'pte', pteIndirizzo: 'A479_CORSO ALESSANDRO VOLTA_147_1', tipoIntervento: 'Attivazione' })
  === 'Corso Alessandro Volta 143 (3887828033) · ILIAD · CPE3 + SFP · PTE al 147');
verifica('PTE allo stesso civico: nessuna aggiunta',
  formattaDescrizione(scheda({ tipoImpianto: 'pte', pteIndirizzo: 'A479_CORSO ALESSANDRIA_75_1' }))
  === 'Corso Alessandria 75 (0141274004 / 3391218194) · WN · CPE_INT');

// ── 6. Testo scritto a mano e testi vecchi già salvati ─────────────────────
console.log('\n6) Testo scritto a mano e testi vecchi già salvati');
const auto = formattaDescrizione(scheda());
const item = { ...scheda(), descrizioneSito: auto, descrizioneAuto: auto };
verifica('se non è stato toccato, si riformatta (tag aggiornato)',
  descrizioneIntervento({ ...item, sezione: 'migrazione' }).endsWith('· MIGRAZIONE'));
verifica('se è stato scritto a mano, si rispetta',
  descrizioneIntervento({ ...item, descrizioneSito: 'Chiamare prima il portiere' }) === 'Chiamare prima il portiere');
verifica('senza testo usa i campi', descrizioneIntervento(scheda()).startsWith('Corso Alessandria 75'));

// Vecchio formato generato dall'app ("... wn, Cpe_int ok"): va riconosciuto e rifatto
const vecchio = {
  ...scheda(),
  descrizioneSito: 'CORSO ALESSANDRIA 75 (0141274004 / 3391218194) wn, Cpe_int ok',
  descrizioneExcel: 'CORSO ALESSANDRIA 75 (0141274004 / 3391218194) wn, Cpe_int ok',
};
verifica('riconosce il vecchio testo automatico', sembraDescrizioneAutomatica(vecchio));
verifica('riconosce il vecchio testo anche con indirizzo diverso ripetuto dentro',
  sembraDescrizioneAutomatica({ ...vecchio, descrizioneSito: 'Altro indirizzo 9 (0141274004 / 3391218194) ok' }));
verifica('non tocca una nota scritta a mano',
  !sembraDescrizioneAutomatica({ ...vecchio, descrizioneSito: 'Cliente assente, richiamare ok' }));

console.log(`\n${passati} controlli superati, ${falliti} falliti`);
process.exit(falliti ? 1 : 0);
