/**
 * Test del generatore Excel (js/excelGenerator.js) — nessun DOM.
 *
 * Uso: node test_excel.mjs
 *
 * Verifica quello che serve all'ufficio:
 *  - le quattro fasce orarie ci sono sempre, anche vuote, con "Altro appuntamento";
 *  - l'orario è un'ora vera di Excel (formato h:mm), non testo;
 *  - stile del modello "vergine" (Calibri 11, intestazioni gialle con testo rosso);
 *  - guasti su sfondo grigio, descrizione normale su arancione, tecnico con il suo colore;
 *  - sezioni sospendere (3 posti per fascia) e chiudere (4 per fascia).
 */
import { buildWorkbook } from './js/excelGenerator.js';
import { fasciaDi } from './js/fasce.js';

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

const TECH = { Riccardo: '#FFC000', Stefano: '#7030A0' };
const app = (id, orario, descrizione, tecnico, extra = {}) => ({
  id,
  orario,
  descrizioneSito: descrizione,
  sezione: 'realizzare',
  tecnicoCentraleExcel: tecnico,
  ...extra,
});

const items = [
  app('a', '08:30', 'VIA ROMA 1 (3331112222) iliad, cpe3 ok', 'Riccardo Asti elecnor'),
  app('b', '08:30', 'VIA ROMA 2 fw (GUASTO) ok', 'Stefano Asti elecnor', { tipoIntervento: 'Guasto' }),
  app('c', '09:30', 'VIA ROMA 5 iliad, cpe3 ok', 'Stefano Asti elecnor', { orarioOrigine: '08:30' }),
  app('d', '14:30', 'VIA ROMA 3 eni, ont 2.5 G ok', 'Stefano Asti elecnor'),
  app('e', '15:30', 'VIA ROMA 4 vodafone, sim ok', 'Riccardo Asti elecnor', { sezione: 'migrazione' }),
];
const wb = buildWorkbook(items, '24 11 2026', TECH);
const ws = wb.getWorksheet('Foglio1');

const celle = riga => [1, 2, 3].map(c => ws.getRow(riga).getCell(c));

// ── 1. Struttura ────────────────────────────────────────────────────────────
console.log('\n1) Struttura come il modello ufficiale');
verifica('titolo in B1', ws.getCell('B1').value === "ATTIVITA' TECHNICALWORK SRL del 24 11 2026");
verifica('intestazione colonne in riga 3', ws.getCell('B3').value === 'IMPIANTI  DA REALIZZARE ' && ws.getCell('C3').value === 'TECNICO/CENTRALE');
verifica('larghezze colonne identiche al modello',
  [5.91796875, 52.59765625, 24.6171875].every((w, i) => Math.abs(ws.getColumn(i + 1).width - w) < 0.001),
  [1, 2, 3].map(i => ws.getColumn(i).width).join(','));
verifica('titolo: giallo, testo rosso, centrato, Calibri 11 non grassetto',
  ws.getCell('B1').fill.fgColor.argb === 'FFFFFF00'
  && ws.getCell('B1').font.color.argb === 'FFFF0000'
  && ws.getCell('B1').font.name === 'Calibri' && ws.getCell('B1').font.size === 11 && !ws.getCell('B1').font.bold
  && ws.getCell('B1').alignment.horizontal === 'center');
verifica('i dati iniziano dalla riga 6', typeof ws.getCell('A6').value === 'number');

// ── 2. Orari veri e colori ─────────────────────────────────────────────────
console.log('\n2) Orari e colori');
const prima = ws.getRow(6);
verifica('orario come ora di Excel con formato h:mm',
  Math.abs(prima.getCell(1).value - (8 * 60 + 30) / 1440) < 1e-9 && prima.getCell(1).numFmt === 'h:mm');
verifica('fascia 08:30 rossa', prima.getCell(1).fill.fgColor.argb === 'FFFF0000');
verifica('descrizione normale su fondo bianco con testo nero',
  !prima.getCell(2).fill && prima.getCell(2).font.color.argb === 'FF000000');
verifica('tecnico col suo colore', prima.getCell(3).fill.fgColor.argb === 'FFFFC000'
  && prima.getCell(3).value === 'Riccardo Asti elecnor');

// righe in ordine: a (08:30), b (08:30 guasto), c (09:30 spostato), poi i posti liberi,
// d (14:30), e (15:30 migrazione) — le cerco per indirizzo per non dipendere dall'ordine
const rigaDi = frammento => {
  for (let r = 6; r <= ws.rowCount; r++) {
    const v = ws.getRow(r).getCell(2).value;
    if (typeof v === 'string' && v.includes(frammento)) return ws.getRow(r);
  }
  return null;
};
verifica('guasto su sfondo grigio', rigaDi('VIA ROMA 2').getCell(2).fill.fgColor.argb === 'FFA5A5A5');
verifica('appuntamento spostato di fascia su sfondo giallo',
  rigaDi('VIA ROMA 5').getCell(2).fill.fgColor.argb === 'FFFFFF00');
verifica('migrazione su fondo bianco con testo rosso', !rigaDi('VIA ROMA 4').getCell(2).fill);
verifica('migrazione: descrizione rossa', rigaDi('VIA ROMA 4').getCell(2).font.color.argb === 'FFFF0000');

// ── 3. Fasce libere: una riga "Altro appuntamento" per ogni tecnico ─────────
console.log('\n3) Fasce libere');
const righePerFascia = () => {
  const righe = {};
  for (let r = 6; r <= ws.rowCount; r++) {
    const v = ws.getRow(r).getCell(1).value;
    if (typeof v !== 'number') break;
    const minuti = Math.round(v * 1440);
    const orario = `${String(Math.floor(minuti / 60)).padStart(2, '0')}:${String(minuti % 60).padStart(2, '0')}`;
    const fascia = fasciaDi(orario);
    righe[fascia] = righe[fascia] || [];
    righe[fascia].push({ descrizione: ws.getRow(r).getCell(2).value, tecnico: ws.getRow(r).getCell(3).value, riga: r });
  }
  return righe;
};

const testoB = [];
for (let r = 6; r <= ws.rowCount; r++) {
  const v = ws.getRow(r).getCell(2).value;
  if (typeof v === 'string') testoB.push(v);
}
const altro = testoB.filter(t => t === 'Altro appuntamento').length;
verifica('le quattro fasce sono tutte presenti', ['08:30', '11:30', '14:30', '16:30'].every(orario => {
  const minuti = orario.split(':').reduce((acc, v, i) => acc + Number(v) * (i === 0 ? 60 : 1), 0) / 1440;
  for (let r = 6; r <= ws.rowCount; r++) if (Math.abs(ws.getRow(r).getCell(1).value - minuti) < 1e-9) return true;
  return false;
}));
verifica('una riga per tecnico nelle due fasce libere (4 in tutto)', altro === 4, `trovate ${altro}`);
verifica('le fasce occupate non vengono riempite', (() => {
  const righe = righePerFascia();
  return righe['08:30'].length === 3 && !righe['08:30'].some(r => r.descrizione === 'Altro appuntamento')
    && righe['14:30'].length === 2 && !righe['14:30'].some(r => r.descrizione === 'Altro appuntamento');
})());
verifica('i posti liberi hanno il nome del tecnico a destra', (() => {
  const righe = righePerFascia();
  const liberi = (righe['11:30'] || []).filter(r => r.descrizione === 'Altro appuntamento').map(r => r.tecnico).sort();
  return liberi.length === 2 && liberi.every(t => /Riccardo|Stefano/.test(t));
})(), JSON.stringify((righePerFascia()['11:30'] || []).map(r => r.tecnico)));
verifica('la cella del tecnico libero ha il suo colore', (() => {
  const righe = righePerFascia()['11:30'] || [];
  return righe.every(r => ws.getRow(r.riga).getCell(3).fill && ws.getRow(r.riga).getCell(3).fill.fgColor.argb);
})());
verifica('"Altro appuntamento" in nero su sfondo bianco', (() => {
  for (let r = 6; r <= ws.rowCount; r++) {
    const cella = ws.getRow(r).getCell(2);
    if (cella.value === 'Altro appuntamento') {
      return cella.font.color.argb === 'FF000000' && !cella.fill;
    }
  }
  return false;
})());

// Fascia con un solo tecnico impegnato: il posto libero è solo dell'altro
const conUnoSolo = buildWorkbook([
  app('x', '08:30', 'VIA ROMA 10 iliad ok', 'Riccardo Asti elecnor'),
  app('y', '14:30', 'VIA ROMA 11 eni ok', 'Stefano Asti elecnor'),
], '24 11 2026', TECH).getWorksheet('Foglio1');
const tecnici0830 = [];
for (let r = 6; r <= conUnoSolo.rowCount; r++) {
  const v = conUnoSolo.getRow(r).getCell(1).value;
  if (typeof v !== 'number') break;
  if (Math.abs(v - (8 * 60 + 30) / 1440) < 1e-9) tecnici0830.push(conUnoSolo.getRow(r).getCell(3).value);
}
verifica('nella fascia occupata il posto libero è solo dell\'altro tecnico',
  tecnici0830.filter(t => t && t.includes('Stefano')).length === 1
  && !tecnici0830.filter(t => t && t.includes('Riccardo')).some(t => t === 'Riccardo Asti elecnor' && tecnici0830.filter(x => x === t).length > 1),
  JSON.stringify(tecnici0830));

// ── 4. Presa in carico e sezioni ───────────────────────────────────────────
console.log('\n4) Presa in carico e sezioni');
const conPresa = buildWorkbook([app('x', '09:30', 'VIA ROMA 9 iliad ok', 'Riccardo', { orarioOrigine: '08:30' })], '24 11 2026', TECH).getWorksheet('Foglio1');
const rigaX = conPresa.getRow(6);
verifica('la presa in carico è scritta nella descrizione', String(rigaX.getCell(2).value).startsWith('(presa in carico 08:30)'));
verifica('l\'ora resta quella di lavoro', Math.abs(rigaX.getCell(1).value - (9 * 60 + 30) / 1440) < 1e-9);

const testoSospendere = [];
for (let r = 1; r <= ws.rowCount; r++) {
  const v = ws.getRow(r).getCell(2).value;
  if (typeof v === 'string' && v.includes('IMPIANTI DA SOSPENDERE')) {
    for (let k = r; k <= ws.rowCount; k++) {
      const t = ws.getRow(k).getCell(1).value;
      if (typeof t === 'number') testoSospendere.push(t);
      else if (k > r + 1) break;
    }
  }
}
verifica('sezione sospendere con 3 posti per fascia', testoSospendere.length === 12, `trovati ${testoSospendere.length}`);

// ── 5. Tecnici attivi senza interventi ───────────────────────────────────────
console.log('\n5) Tecnici attivi senza interventi');
const conAttivo = buildWorkbook([], '24 11 2026', { Matias: '#A5A5A5' }, 'Foglio1', ['Matias']).getWorksheet('Foglio1');
const righeMatias = [];
for (let r = 6; r <= conAttivo.rowCount; r++) {
  const v = conAttivo.getRow(r).getCell(1).value;
  if (typeof v !== 'number') break;
  if (conAttivo.getRow(r).getCell(2).value === 'Altro appuntamento' && conAttivo.getRow(r).getCell(3).value === 'Matias') {
    righeMatias.push(r);
  }
}
verifica('un tecnico attivo senza interventi ha una riga per fascia', righeMatias.length === 4, `trovate ${righeMatias.length}`);

// Con un intervento in una fascia, il tecnico attivo resta libero solo nelle altre tre
const conAttivoImpegnato = buildWorkbook([
  app('z', '08:30', 'VIA ROMA 20 iliad ok', 'Matias Asti elecnor'),
], '24 11 2026', { Matias: '#A5A5A5' }, 'Foglio1', ['Matias']).getWorksheet('Foglio1');
const liberiMatias = [];
for (let r = 6; r <= conAttivoImpegnato.rowCount; r++) {
  const v = conAttivoImpegnato.getRow(r).getCell(1).value;
  if (typeof v !== 'number') break;
  if (conAttivoImpegnato.getRow(r).getCell(2).value === 'Altro appuntamento' && /Matias/.test(conAttivoImpegnato.getRow(r).getCell(3).value)) {
    liberiMatias.push(r);
  }
}
verifica('occupata una fascia, il tecnico attivo compare solo nelle altre tre', liberiMatias.length === 3, `trovate ${liberiMatias.length}`);

// ── 6. Tecnici guasti attivi: riga "Guasti" su sfondo grigio ──────────────────
console.log('\n6) Tecnici guasti attivi');
const conGuasto = buildWorkbook([], '24 11 2026', { Cristian: '#70AD47' }, 'Foglio1', [], ['Cristian']).getWorksheet('Foglio1');
const righeGuasto = [];
for (let r = 6; r <= conGuasto.rowCount; r++) {
  const v = conGuasto.getRow(r).getCell(1).value;
  if (typeof v !== 'number') break;
  if (conGuasto.getRow(r).getCell(2).value === 'Guasti') righeGuasto.push(r);
}
verifica('un tecnico guasti attivo ha una riga "Guasti" per fascia', righeGuasto.length === 4, `trovate ${righeGuasto.length}`);
verifica('la riga "Guasti" ha il nome a destra e sfondo grigio', (() => {
  if (!righeGuasto.length) return false;
  const r = conGuasto.getRow(righeGuasto[0]);
  return r.getCell(3).value === 'Cristian'
    && r.getCell(2).fill && r.getCell(2).fill.fgColor.argb === 'FFA5A5A5'
    && r.getCell(3).fill && r.getCell(3).fill.fgColor.argb === 'FF70AD47';
})());

console.log(`\n${passati} controlli superati, ${falliti} falliti`);
process.exit(falliti ? 1 : 0);
