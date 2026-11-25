/**
 * Test della distribuzione equa (js/distribuzione.js) — nessun DOM.
 *
 * Uso: node test_distribuzione.mjs
 *
 * Copre le regole concordate con l'ufficio (24/11/2026):
 *  - due orari per fascia (fascia e ora successiva, 12:30 compreso);
 *  - le lavorazioni brevi (guasti, borchie, migrazioni) vanno per prime e non
 *    rubano il posto all'impianto normale: per fascia e per tecnico al massimo
 *    un impianto e due interventi in tutto;
 *  - i guasti restano al loro orario, gli impianti che non ci stanno slittano;
 *  - limite giornaliero sugli impianti, idempotenza, rientri alla presa in carico.
 */
import {
  pianificaDistribuzione,
  postiDellaFascia,
  toMinuti,
} from './js/distribuzione.js';

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

const T = ['Anna', 'Bruno'];
const orari = esito => esito.piano.map(v => v.orario).sort();
const orarioDi = (esito, id) => (esito.piano.find(v => v.id === id) || {}).orario;
const vociDi = (esito, tecnico) => esito.piano.filter(v => v.tecnico === tecnico);
const fasciaDi = orario => {
  const min = toMinuti(orario);
  for (const f of ['16:30', '14:30', '11:30', '08:30']) if (min >= toMinuti(f)) return f;
  return '08:30';
};
const vociPerFascia = esito => {
  const per = {};
  for (const v of esito.piano) {
    const k = `${v.tecnico}|${fasciaDi(v.orario)}`;
    per[k] = per[k] || [];
    per[k].push(v);
  }
  return per;
};

// ── 1. Orari di lavoro di una fascia ────────────────────────────────────────
console.log('\n1) postiDellaFascia');
verifica('08:30 -> 08:30 e 09:30', postiDellaFascia('08:30').join(',') === '08:30,09:30');
verifica('11:30 -> 11:30 e 12:30 (il 12:30 si usa)', postiDellaFascia('11:30').join(',') === '11:30,12:30');
verifica('14:30 -> 14:30 e 15:30', postiDellaFascia('14:30').join(',') === '14:30,15:30');
verifica('col limite di fine giornata', postiDellaFascia('16:30', { fineGiornata: '16:30' }).join(',') === '16:30');

// ── 2. Brevi prima: impianto + guasto nella stessa fascia ───────────────────
console.log('\n2) Caso ufficio (2 impianti + 1 guasto + 1 borchia alle 08:30, 2 tecnici)');
const casoUfficio = pianificaDistribuzione({
  tecnici: T,
  interventi: [
    { id: 'i1', orario: '08:30' },
    { id: 'i2', orario: '08:30' },
  ],
  brevi: [{ id: 'b1', orario: '08:30' }],
  guasti: [{ id: 'g1', orario: '08:30', tecnico: 'Anna' }],
});
verifica('nessuno spostamento e nessun guasto spostato',
  casoUfficio.spostamenti.length === 0 && casoUfficio.guastiSpostati.length === 0);
verifica('il guasto resta del suo tecnico alle 08:30', orarioDi(casoUfficio, 'g1') === '08:30');
verifica('Anna fa guasto + impianto nella stessa fascia (2 voci)',
  vociDi(casoUfficio, 'Anna').length === 2);
verifica('la borchia va all\'altro tecnico (equità)', vociDi(casoUfficio, 'Bruno').some(v => v.id === 'b1'));

// ── 3. Giornata reale del 24/11 (Asti, Elecnor) ─────────────────────────────
console.log('\n3) Giornata reale 24/11 (6 impianti + 2 migrazioni + 3 guasti, 2 tecnici)');
const reale = pianificaDistribuzione({
  tecnici: ['Riccardo', 'Stefano'],
  interventi: [
    { id: 'alessandria', orario: '08:30' },
    { id: 'corridoni', orario: '08:30' },
    { id: 'matteotti', orario: '08:30' },
    { id: 'dante', orario: '08:30' },
    { id: 'allavittoria', orario: '14:30' },
    { id: 'sanmarco', orario: '16:30' },
  ],
  brevi: [
    { id: 'cavallotti', orario: '14:30' },
    { id: 'volta', orario: '16:30' },
  ],
  guasti: [
    { id: 'ginella', orario: '08:30', tecnico: 'Riccardo' },
    { id: 'sellai', orario: '08:30', tecnico: 'Stefano' },
    { id: 'petrarca', orario: '14:30', tecnico: 'Riccardo' },
  ],
});
verifica('tutti gli 11 interventi assegnati', reale.piano.length === 11 && reale.nonAssegnati.length === 0);
verifica('solo 2 telefonate (impianti fuori dal loro orario)', reale.spostamenti.length === 2,
  reale.spostamenti.map(s => `${s.id}:${s.da}->${s.a}`).join(' '));
verifica('nessun guasto spostato', reale.guastiSpostati.length === 0);
verifica('max un impianto per tecnico per fascia',
  Object.values(vociPerFascia(reale)).every(voci => voci.filter(v => !v.breve).length <= 1));
verifica('max due interventi per tecnico per fascia',
  Object.values(vociPerFascia(reale)).every(voci => voci.length <= 2));
verifica('mai 12:30 usato per sbaglio fuori fascia', reale.piano.every(v => fasciaDi(v.orario) === fasciaDi(v.orarioOrigine) || v.orario <= '17:30'));
verifica('la presa in carico resta sugli spostati',
  reale.spostamenti.every(s => reale.piano.find(v => v.id === s.id).orarioOrigine === s.da));

// ── 4. Idempotenza: rieseguire il piano dà lo stesso piano ──────────────────
console.log('\n4) Idempotenza');
const secondaVolta = pianificaDistribuzione({
  tecnici: ['Riccardo', 'Stefano'],
  interventi: reale.piano.filter(v => !v.breve).map(v => ({ id: v.id, orario: v.orario, orarioOrigine: v.orarioOrigine })),
  brevi: reale.piano.filter(v => v.breve && !v.guasto).map(v => ({ id: v.id, orario: v.orario, orarioOrigine: v.orarioOrigine })),
  guasti: reale.piano.filter(v => v.guasto).map(v => ({ id: v.id, orario: v.orario, orarioOrigine: v.orarioOrigine, tecnico: v.tecnico })),
});
const firma = esito => esito.piano.map(v => `${v.id}:${v.tecnico}:${v.orario}`).sort().join('|');
verifica('il secondo giro produce lo stesso piano', firma(secondaVolta) === firma(reale));
verifica('nessun rientro inventato', (secondaVolta.rientrati || []).length === 0);
verifica('gli spostamenti segnalati sono gli stessi (telefonate già fatte)',
  secondaVolta.spostamenti.length === reale.spostamenti.length);

// ── 5. Rientro alla presa in carico quando la fascia si libera ──────────────
console.log('\n5) Rientro alla presa in carico');
const rientro = pianificaDistribuzione({
  tecnici: ['Anna'],
  interventi: [{ id: 'spostato', orario: '11:30', orarioOrigine: '08:30' }],
});
verifica('l\'impianto rientra alle 08:30', orarioDi(rientro, 'spostato') === '08:30');
verifica('segnalato come rientro, non come telefonata', rientro.spostamenti.length === 0 && rientro.rientrati.length === 1);

// ── 6. Limite giornaliero per tecnico ──────────────────────────────────────
console.log('\n6) Limite giornaliero');
const limite = pianificaDistribuzione({
  tecnici: ['Anna'],
  maxPerTecnico: 2,
  interventi: [
    { id: 'a', orario: '08:30' },
    { id: 'b', orario: '08:30' },
    { id: 'c', orario: '08:30' },
  ],
});
verifica('2 assegnati e 1 senza posto', limite.piano.length === 2 && limite.nonAssegnati.length === 1);
verifica('il limite non conta guasti e brevi', pianificaDistribuzione({
  tecnici: ['Anna'],
  maxPerTecnico: 1,
  interventi: [{ id: 'a', orario: '08:30' }],
  brevi: [{ id: 'b', orario: '08:30' }],
  guasti: [{ id: 'g', orario: '08:30', tecnico: 'Anna' }],
}).nonAssegnati.length === 0);

// ── 7. Nessun tecnico disponibile ──────────────────────────────────────────
console.log('\n7) Nessun tecnico');
const vuoto = pianificaDistribuzione({ tecnici: [], interventi: [{ id: 'a', orario: '08:30' }] });
verifica('piano vuoto e intervento senza posto', vuoto.vuoto === true && vuoto.nonAssegnati.join(',') === 'a');

// ── 8. Guasto di un tecnico guasti dedicato ────────────────────────────────
console.log('\n8) Guasto di un tecnico fuori dal piano');
const conCluster = pianificaDistribuzione({
  tecnici: ['Anna'],
  interventi: [{ id: 'a', orario: '08:30' }, { id: 'b', orario: '08:30' }],
  guasti: [{ id: 'g', orario: '08:30', tecnico: 'Cristian' }],
});
verifica('il guasto del cluster non entra nel piano', !conCluster.piano.some(v => v.id === 'g'));
verifica('e non ruba il posto all\'impianto', conCluster.piano.length === 2);

// ── 9. Orario fuori standard: non si sposta per finta ──────────────────────
console.log('\n9) Orario fuori standard (13:45)');
const fuoriStandard = pianificaDistribuzione({
  tecnici: ['Anna'],
  brevi: [{ id: 'a', orario: '13:45' }],
});
verifica('resta alle 13:45, nessuna telefonata', orarioDi(fuoriStandard, 'a') === '13:45' && fuoriStandard.spostamenti.length === 0);

// ── 10. Un solo impianto per fascia e per tecnico ──────────────────────────
console.log('\n10) Tre impianti alle 08:30 con un tecnico');
const piena = pianificaDistribuzione({
  tecnici: ['Anna'],
  interventi: [1, 2, 3].map(n => ({ id: `i${n}`, orario: '08:30' })),
});
verifica('uno per fascia: 08:30, 11:30, 14:30', orari(piena).join(',') === '08:30,11:30,14:30');
verifica('tutti segnalati come telefonate', piena.spostamenti.length === 2);

// ── 11. Le brevi stanno insieme, l'impianto all'altro tecnico ─────────────
console.log('\n11) Due lavorazioni veloci + un impianto nella stessa fascia');
const misto = pianificaDistribuzione({
  tecnici: ['R', 'S'],
  interventi: [{ id: 'impianto', orario: '14:30' }],
  brevi: [{ id: 'migrazione', orario: '14:30' }],
  guasti: [{ id: 'guasto', orario: '14:30', tecnico: 'R' }],
});
verifica('le due brevi vanno insieme sullo stesso tecnico',
  orarioDi(misto, 'guasto') === '14:30' && orarioDi(misto, 'migrazione') === '14:30'
  && misto.piano.find(v => v.id === 'guasto').tecnico === misto.piano.find(v => v.id === 'migrazione').tecnico);
verifica('l\'impianto va all\'altro tecnico',
  misto.piano.find(v => v.id === 'impianto').tecnico !== misto.piano.find(v => v.id === 'guasto').tecnico);
verifica('nessuna telefonata', misto.spostamenti.length === 0);

// ── 12. Un intervento lungo e uno breve: uno a testa ──────────────────────
console.log('\n12) Un impianto e una breve nella stessa fascia, 2 tecnici');
const smistato = pianificaDistribuzione({
  tecnici: ['R', 'S'],
  interventi: [{ id: 'impianto', orario: '16:30' }],
  brevi: [{ id: 'breve', orario: '16:30' }],
});
verifica('uno a testa', smistato.piano.find(v => v.id === 'impianto').tecnico
  !== smistato.piano.find(v => v.id === 'breve').tecnico);

// ── 13. Tre brevi alle 11:30 con un tecnico ──────────────────────────────
console.log('\n13) Tre brevi alle 11:30 con un tecnico solo');
const breviTante = pianificaDistribuzione({
  tecnici: ['Anna'],
  brevi: [1, 2, 3].map(n => ({ id: `b${n}`, orario: '11:30' })),
});
verifica('le prime due stanno insieme, la terza slitta alla fascia dopo',
  orarioDi(breviTante, 'b1') === '11:30' && orarioDi(breviTante, 'b2') === '11:30' && orarioDi(breviTante, 'b3') === '14:30');
verifica('la sola che si muove è segnalata', breviTante.spostamenti.length === 1);

console.log(`\n${passati} controlli superati, ${falliti} falliti`);
process.exit(falliti ? 1 : 0);
