/**
 * Distribuzione equa degli interventi sulle fasce orarie.
 *
 * Regole di lavoro (ufficio, giornata di Asti del 24/11/2026):
 *  - la giornata ha 4 fasce (08:30, 11:30, 14:30, 16:30) e ogni fascia offre DUE
 *    orari: quello della fascia e quello un'ora dopo (08:30/09:30, 11:30/12:30,
 *    14:30/15:30, 16:30/17:30).
 *  - le LAVORAZIONI BREVI (guasti, borchie, migrazioni) sono interventi corti: si
 *    mettono per primi e stanno volentieri INSIEME sullo stesso tecnico (due
 *    interventi veloci nella stessa fascia), lasciando all'altro tecnico
 *    l'impianto normale da solo. Non rubano il posto all'impianto: per ogni
 *    fascia e per ogni tecnico il piano accetta un impianto e due interventi in
 *    tutto (es. impianto + guasto, oppure due brevi).
 *  - un intervento resta al suo orario quando può (nessuna telefonata): la breve
 *    sta nella stessa ora di un'altra breve, l'impianto nella sua. Solo se la
 *    fascia è piena (o l'ora è già presa da un impianto) si usa l'altro orario
 *    della fascia e poi la fascia successiva.
 *  - se raggruppare le brevi facesse perdere un posto, il piano si rifà bilanciato
 *    e vince quello che lascia meno interventi fuori e meno telefonate.
 *  - i guasti restano del tecnico che li ha in carico (li assegna il cluster): la
 *    presa in carico resta all'orario originale, il lavoro si sposta senza
 *    telefonare. I guasti dei tecnici guasti dedicati non entrano nel piano.
 *  - il piano parte sempre dalla PRESA IN CARICO (`orarioOrigine`), non dalla
 *    posizione attuale: se una fascia si libera l'intervento ci rientra.
 *
 * Il modulo è puro: nessun accesso al DOM, così è testabile su dati reali.
 */
import { FASCE_BASE, fasciaDi } from './fasce.js';

export function toMinuti(orario) {
  if (!orario) return 0;
  const parti = String(orario).replace('.', ':').split(':');
  return (parseInt(parti[0], 10) || 0) * 60 + (parseInt(parti[1], 10) || 0);
}

export function daMinuti(minuti) {
  const h = Math.floor(minuti / 60);
  const m = minuti % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Orari di lavoro disponibili in una fascia: quello della fascia e i successivi,
 * uno per ora, fino alla fine giornata. Es. 08:30 -> ['08:30', '09:30'],
 * 11:30 -> ['11:30', '12:30'].
 *
 * @param {string} fascia       orario della fascia (es. '08:30')
 * @param {Object} opzioni
 * @param {number} opzioni.posti        quanti orari per fascia (default 2)
 * @param {string} opzioni.fineGiornata ultimo orario ammesso (default '18:30')
 * @returns {string[]} orari ordinati
 */
export function postiDellaFascia(fascia, { posti = 2, fineGiornata = '18:30' } = {}) {
  const risultato = [];
  const limite = toMinuti(fineGiornata);
  let minuto = toMinuti(fascia);
  for (let i = 0; i < posti; i++) {
    if (minuto > limite) break;
    risultato.push(daMinuti(minuto));
    minuto += 60;
  }
  return risultato;
}

/**
 * @param {Object} opzioni
 * @param {string[]} opzioni.tecnici       nomi dei tecnici impianti attivi
 * @param {Array}    opzioni.interventi    impianti normali [{ id, orario, orarioOrigine? }]
 * @param {Array}    opzioni.brevi         borchie e migrazioni, senza tecnico [{ id, orario, orarioOrigine? }]
 * @param {Array}    opzioni.guasti        guasti già presi in carico [{ id, orario, orarioOrigine?, tecnico }]
 * @param {number}   opzioni.maxPerTecnico limite impianti al giorno per tecnico (le brevi non contano)
 * @param {number}   opzioni.postiPerFascia orari di lavoro per fascia (default 2)
 * @param {number}   opzioni.maxImpiantiPerFascia impianti normali per tecnico in una fascia (default 1)
 * @param {number}   opzioni.maxVociPerFascia interventi totali per tecnico in una fascia (default 2)
 * @param {string}   opzioni.fineGiornata  ultimo orario ammesso
 * @returns {{piano: Array, spostamenti: Array, rientrati: Array, guastiSpostati: Array, nonAssegnati: Array, carichi: Object, vuoto: boolean}}
 */
export function pianificaDistribuzione(opzioni) {
  // Due giri: il primo raggruppa le lavorazioni brevi sullo stesso tecnico, il
  // secondo le distribuisce. Vince quello che lascia meno interventi fuori e
  // meno telefonate ai clienti (a parità vince il raggruppamento).
  const raggruppato = pianificaInterno(opzioni, true);
  const bilanciato = pianificaInterno(opzioni, false);
  const costo = esito => [
    esito.nonAssegnati.length,
    esito.spostamenti.length + (esito.guastiSpostati || []).length,
  ];
  const [fuoriRaggruppato, chiamateRaggruppato] = costo(raggruppato);
  const [fuoriBilanciato, chiamateBilanciato] = costo(bilanciato);
  if (fuoriRaggruppato !== fuoriBilanciato) return fuoriRaggruppato < fuoriBilanciato ? raggruppato : bilanciato;
  return chiamateRaggruppato <= chiamateBilanciato ? raggruppato : bilanciato;
}

function pianificaInterno({
  tecnici,
  interventi = [],
  brevi = [],
  guasti = [],
  maxPerTecnico = 4,
  postiPerFascia = 2,
  maxImpiantiPerFascia = 1,
  maxVociPerFascia = 2,
  fineGiornata = '18:30',
}, raggruppaBrevi) {
  const nomi = (tecnici || []).filter(Boolean);
  const tutti = [
    ...(interventi || []).filter(Boolean),
    ...(brevi || []).filter(Boolean),
    ...(guasti || []).filter(Boolean),
  ];

  if (!nomi.length) {
    return {
      piano: [], spostamenti: [], rientrati: [], guastiSpostati: [],
      nonAssegnati: tutti.map(i => i.id), carichi: {}, vuoto: true,
    };
  }

  const nomiTecnici = new Set(nomi);
  const caricoImpianti = new Map(nomi.map(n => [n, 0]));
  const caricoBrevi = new Map(nomi.map(n => [n, 0]));
  const impiantiInFascia = new Map();
  const vociInFascia = new Map();
  const oreConImpianto = new Set();
  const oreConBreve = new Set();

  // `_origine` = presa in carico (non si tocca), `_attuale` = orario attuale (serve
  // a raccontare i rientri), `_fascia` = fascia in cui va sistemato l'intervento.
  const prepara = (item, tipo) => {
    const attuale = String(item.orario || '08:30').trim();
    const origine = String(item.orarioOrigine || attuale).trim();
    return {
      ...item,
      _guasto: tipo === 'guasto',
      _breve: tipo !== 'impianto',
      _attuale: attuale,
      _origine: origine,
      _fascia: fasciaDi(origine),
    };
  };

  const impianti = (interventi || []).filter(Boolean).map(i => prepara(i, 'impianto'));
  const breviLiberi = (brevi || []).filter(Boolean).map(b => prepara(b, 'breve'));
  const guastiInPiano = (guasti || [])
    .filter(g => g && g.tecnico && nomiTecnici.has(g.tecnico))
    .map(g => prepara(g, 'guasto'));

  const piano = [];
  const spostamenti = [];
  const rientrati = [];
  const guastiSpostati = [];
  const coda = [];

  const chiaveFascia = (tecnico, fascia) => `${tecnico}|${fascia}`;
  const chiaveOra = (tecnico, orario) => `${tecnico}|${orario}`;

  // La fascia accetta un solo impianto normale e al massimo due voci per tecnico
  // (impianto + lavorazione breve, oppure due brevi).
  const puoPrendere = (tecnico, fascia, breve) => {
    const k = chiaveFascia(tecnico, fascia);
    if ((vociInFascia.get(k) || 0) >= maxVociPerFascia) return false;
    if (breve) return true;
    if (caricoImpianti.get(tecnico) >= maxPerTecnico) return false;
    return (impiantiInFascia.get(k) || 0) < maxImpiantiPerFascia;
  };

  const assegna = (item, tecnico, orario, fascia) => {
    const k = chiaveFascia(tecnico, fascia);
    vociInFascia.set(k, (vociInFascia.get(k) || 0) + 1);
    if (item._breve) {
      caricoBrevi.set(tecnico, caricoBrevi.get(tecnico) + 1);
      oreConBreve.add(chiaveOra(tecnico, orario));
    } else {
      caricoImpianti.set(tecnico, caricoImpianti.get(tecnico) + 1);
      impiantiInFascia.set(k, (impiantiInFascia.get(k) || 0) + 1);
      oreConImpianto.add(chiaveOra(tecnico, orario));
    }
    piano.push({
      id: item.id,
      tecnico,
      orario,
      orarioOrigine: item._origine,
      guasto: item._guasto,
      breve: item._breve,
    });
    const finale = toMinuti(orario);
    if (finale !== toMinuti(item._origine)) {
      const voce = { id: item.id, da: item._origine, a: orario, tecnico, guasto: item._guasto, breve: item._breve };
      (item._guasto ? guastiSpostati : spostamenti).push(voce);
    } else if (finale !== toMinuti(item._attuale)) {
      // Era stato spostato e ora rientra alla presa in carico: nessuna telefonata
      rientrati.push({ id: item.id, da: item._attuale, a: orario, tecnico, guasto: item._guasto, breve: item._breve });
    }
  };

  // Come si sceglie il tecnico, in ordine di importanza:
  //  1. tipo di lavoro che ha già in quella fascia: le brevi vanno insieme alle
  //     brevi, l'impianto preferisce chi non ha ancora niente (o solo impianti);
  //  2. chi ha meno interventi nella giornata (brevi comprese);
  //  3. chi ha meno impianti;
  //  4. il nome, per avere un piano ripetibile.
  const punteggio = (tecnico, fascia, breve) => {
    const k = chiaveFascia(tecnico, fascia);
    const voci = vociInFascia.get(k) || 0;
    const impiantiQui = impiantiInFascia.get(k) || 0;
    let preferenza = 0;
    if (raggruppaBrevi) {
      if (breve) preferenza = voci > 0 && impiantiQui === 0 ? -1 : (impiantiQui > 0 ? 1 : 0);
      else preferenza = voci > 0 && impiantiQui === 0 ? 1 : 0;
    }
    return {
      preferenza,
      totale: caricoImpianti.get(tecnico) + caricoBrevi.get(tecnico),
      impianti: caricoImpianti.get(tecnico),
    };
  };

  const tecniciInOrdine = (fascia, breve) => nomi
    .map(nome => ({ nome, p: punteggio(nome, fascia, breve) }))
    .sort((a, b) => (a.p.preferenza - b.p.preferenza)
      || (a.p.totale - b.p.totale)
      || (a.p.impianti - b.p.impianti)
      || a.nome.localeCompare(b.nome, 'it'))
    .map(v => v.nome);

  // Orari da provare per un intervento: prima il suo (nessuno spostamento). Una
  // lavorazione breve lascia il suo orario solo se lì il tecnico ha già un
  // impianto: nella stessa ora stanno due brevi, non una breve e un impianto.
  const orariDaProvare = (item, tecnico, fascia, posti) => {
    if (item._fascia !== fascia) return [...posti];
    const propri = item._origine;
    const altri = posti.filter(o => o !== propri);
    if (!item._breve) return [propri, ...altri];
    const oraPresaDaImpianto = oreConImpianto.has(chiaveOra(tecnico, propri))
      && !oreConBreve.has(chiaveOra(tecnico, propri));
    return oraPresaDaImpianto ? [...altri, propri] : [propri, ...altri];
  };

  const colloca = (item, fascia, posti) => {
    const candidati = item._guasto ? [item.tecnico] : tecniciInOrdine(fascia, item._breve);
    for (const tecnico of candidati) {
      for (const orario of orariDaProvare(item, tecnico, fascia, posti)) {
        if (puoPrendere(tecnico, fascia, item._breve)) {
          assegna(item, tecnico, orario, fascia);
          return true;
        }
      }
    }
    return false;
  };

  for (const fascia of FASCE_BASE) {
    const posti = postiDellaFascia(fascia, { posti: postiPerFascia, fineGiornata });

    // Prima le lavorazioni brevi (guasti, borchie, migrazioni): sono corte e non
    // tolgono il posto all'impianto normale della stessa fascia.
    const breviGruppo = [
      ...guastiInPiano.filter(g => g._fascia === fascia),
      ...breviLiberi.filter(b => b._fascia === fascia),
      ...coda.filter(i => i._breve),
    ];
    const impiantiGruppo = [
      ...impianti.filter(i => i._fascia === fascia),
      ...coda.filter(i => !i._breve),
    ];
    const avanzi = [];

    for (const item of [...breviGruppo, ...impiantiGruppo]) {
      if (!colloca(item, fascia, posti)) avanzi.push(item);
    }
    coda.length = 0;
    coda.push(...avanzi);
  }

  return {
    piano,
    spostamenti,
    rientrati,
    guastiSpostati,
    nonAssegnati: coda.map(i => i.id),
    carichi: Object.fromEntries([...caricoImpianti.entries()].filter(([, n]) => n > 0)),
    vuoto: false,
  };
}
