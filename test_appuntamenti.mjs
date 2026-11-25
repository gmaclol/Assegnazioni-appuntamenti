/**
 * Test della memoria degli appuntamenti (js/appuntamenti.js) — nessun DOM.
 *
 * Uso: node test_appuntamenti.mjs
 *
 * Copre quello che serve all'ufficio: rimandare lo stesso PDF non crea doppioni,
 * un PDF con pagine in più aggiunge solo le pratiche nuove, le modifiche fatte a
 * mano (tecnico, orario, presa in carico, pallino) restano, e la copia online
 * vince sulla locale senza perdere gli import fatti offline.
 */
import {
  chiaveAppuntamento,
  integraAppuntamenti,
  unisciCopieAppuntamenti,
} from './js/appuntamenti.js';

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

const scheda = (wr, orario, indirizzo) => ({
  id: 'app_' + Math.random().toString(36).slice(2),
  wrCode: wr,
  orario,
  indirizzo,
  cliente: 'CLIENTE ' + wr,
  appalto: 'Elecnor',
  sezione: 'realizzare',
});

// ── 1. Identità di un intervento ────────────────────────────────────────────
console.log('\n1) chiaveAppuntamento');
verifica('usa il codice WR', chiaveAppuntamento({ wrCode: '17886445', indirizzo: 'X' }) === 'wr:17886445');
verifica('WR con maiuscole/minuscole diverse = stesso intervento',
  chiaveAppuntamento({ wrCode: 'A17TK00004LWSHCIAT' }) === chiaveAppuntamento({ wrCode: 'a17Tk00004LWshCIAT' }));
verifica('senza WR usa appalto + indirizzo + cliente + orario',
  chiaveAppuntamento({ appalto: 'Elecnor', indirizzo: 'VIA ROMA 1', cliente: 'Rossi', orario: '08:30' })
  === chiaveAppuntamento({ appalto: 'elecnor ', indirizzo: 'via   roma 1', cliente: 'rossi', orario: '08:30' }));
verifica('due orari diversi senza WR sono interventi diversi',
  chiaveAppuntamento({ indirizzo: 'VIA ROMA 1', orario: '08:30' })
  !== chiaveAppuntamento({ indirizzo: 'VIA ROMA 1', orario: '11:30' }));
verifica('una riga aggiunta a mano usa il suo id', chiaveAppuntamento({ id: 'app_abc', orario: '08:30' }) === 'id:app_abc');

// ── 2. Lo stesso PDF rimandato non crea doppioni ───────────────────────────
console.log('\n2) Stesso PDF rimandato');
const primoPdf = [scheda('100', '08:30', 'VIA UNO 1'), scheda('200', '11:30', 'VIA DUE 2')];
const primoImport = integraAppuntamenti([], primoPdf);
verifica('prima importazione: 2 interventi', primoImport.aggiunti.length === 2 && primoImport.doppioni === 0);

const secondoImport = integraAppuntamenti(primoImport.appuntamenti, [scheda('100', '08:30', 'VIA UNO 1'), scheda('200', '11:30', 'VIA DUE 2')]);
verifica('seconda importazione: 0 aggiunti e 2 doppioni',
  secondoImport.aggiunti.length === 0 && secondoImport.doppioni === 2);
verifica('la lista resta di 2', secondoImport.appuntamenti.length === 2);

// ── 3. PDF con pagine in più: entrano solo le nuove ────────────────────────
console.log('\n3) PDF ricaricato con due pratiche in più');
const terzoImport = integraAppuntamenti(primoImport.appuntamenti, [
  scheda('100', '08:30', 'VIA UNO 1'),
  scheda('200', '11:30', 'VIA DUE 2'),
  scheda('300', '14:30', 'VIA TRE 3'),
  scheda('400', '16:30', 'VIA QUATTRO 4'),
]);
verifica('aggiunte le 2 nuove', terzoImport.aggiunti.map(a => a.wrCode).join(',') === '300,400');
verifica('la lista passa a 4', terzoImport.appuntamenti.length === 4 && terzoImport.doppioni === 2);

// ── 4. Le modifiche a mano restano ─────────────────────────────────────────
console.log('\n4) Le modifiche fatte a mano non si perdono');
const conModifiche = terzoImport.appuntamenti.map(a => (
  a.wrCode === '100'
    ? { ...a, tecnico: 'Riccardo', tecnicoCentraleExcel: 'Riccardo Asti elecnor', orario: '09:30', orarioOrigine: '08:30', sezione: 'borchia' }
    : a
));
const quartoImport = integraAppuntamenti(conModifiche, [scheda('100', '08:30', 'VIA UNO 1')]);
const recuperato = quartoImport.appuntamenti.find(a => a.wrCode === '100');
verifica('tecnico mantenuto', recuperato.tecnico === 'Riccardo');
verifica('orario e presa in carico mantenuti', recuperato.orario === '09:30' && recuperato.orarioOrigine === '08:30');
verifica('pallino mantenuto (borchia)', recuperato.sezione === 'borchia');
verifica('nessun doppione', quartoImport.appuntamenti.length === 4);

// ── 5. Copia online e copia locale ─────────────────────────────────────────
console.log('\n5) Sincronizzazione tra dispositivi');
const cloud = [scheda('100', '08:30', 'VIA UNO 1'), scheda('200', '11:30', 'VIA DUE 2')];
const dispositivo = [scheda('100', '08:30', 'VIA UNO 1'), scheda('999', '16:30', 'SOLO QUI 9')];
const uniti = unisciCopieAppuntamenti(dispositivo, cloud);
verifica('vince la copia online', uniti[0].wrCode === '100' && uniti.length === 3);
verifica('l\'import fatto solo in locale non si perde', uniti.some(a => a.wrCode === '999'));
verifica('cloud vuoto -> si usa la copia locale', unisciCopieAppuntamenti(dispositivo, []).length === 2);
verifica('cloud presente -> niente doppioni', unisciCopieAppuntamenti(cloud, cloud).length === 2);

console.log(`\n${passati} controlli superati, ${falliti} falliti`);
process.exit(falliti ? 1 : 0);
