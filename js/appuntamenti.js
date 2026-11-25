/**
 * Memoria degli appuntamenti importati dai PDF.
 *
 * Regole:
 *  - un intervento è identificato dal codice WR (schede e Work Order lo hanno
 *    sempre); se manca, da appalto + indirizzo + cliente + orario. Mai dal campo
 *    `id`, che viene rigenerato a ogni parsing.
 *  - rimandare lo stesso PDF (anche con qualche pagina in più uscita nel tempo)
 *    aggiunge solo gli interventi che non ci sono: chi c'è già resta com'è, così
 *    tecnico, orario, presa in carico e "pallino" scelti a mano non si perdono.
 *
 * Modulo puro (niente DOM, niente rete): testato in `test_appuntamenti.mjs`.
 */

export function chiaveAppuntamento(a) {
  if (!a) return '';
  const wr = String(a.wrCode || '').trim().toLowerCase();
  if (wr) return 'wr:' + wr;
  const norm = v => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const indirizzo = norm(a.indirizzo);
  if (!indirizzo) return 'id:' + (a.id || '');   // riga aggiunta a mano
  return ['nd', norm(a.appalto), indirizzo, norm(a.cliente), norm(a.orario)].join('|');
}

// Campi che si possono completare su un intervento già presente quando si rimanda
// il PDF (es. una scheda riedita con il tipo impianto). Mai sovrascritti se c'è già
// un valore: le modifiche dell'ufficio restano.
const CAMPI_COMPLETABILI = [
  'tipoImpianto', 'pteIndirizzo', 'apparati', 'telefono', 'cliente', 'oloOperatore',
  'comune', 'centrale', 'indirizzo',
];

/**
 * Unisce i nuovi interventi a quelli già in lista.
 *
 * @param {Array} lista  appuntamenti già presenti (vincono sui nuovi)
 * @param {Array} nuovi  interventi appena estratti dai PDF
 * @returns {{appuntamenti: Array, aggiunti: Array, completati: number, doppioni: number}}
 */
export function integraAppuntamenti(lista, nuovi) {
  const presenti = new Map();
  for (const a of (lista || [])) presenti.set(chiaveAppuntamento(a), a);

  const aggiunti = [];
  let completati = 0;

  for (const n of (nuovi || [])) {
    const k = chiaveAppuntamento(n);
    if (!k) continue;
    const esistente = presenti.get(k);

    if (!esistente) {
      presenti.set(k, n);
      aggiunti.push(n);
      continue;
    }

    // Intervento già in lista: si completano solo i dati che mancano
    for (const campo of CAMPI_COMPLETABILI) {
      if (!esistente[campo] && n[campo]) {
        esistente[campo] = n[campo];
        completati++;
      }
    }
  }

  return {
    appuntamenti: [...(lista || []), ...aggiunti],
    aggiunti,
    completati,
    doppioni: (nuovi || []).length - aggiunti.length,
  };
}

/**
 * Sceglie che cosa mostrare all'avvio: la copia online (condivisa, vince) più i
 * soli interventi che esistono solo in locale perché non sono ancora arrivati al
 * cloud (es. import fatto offline).
 *
 * @param {Array} locali  copia salvata su questo dispositivo
 * @param {Array} remoti  copia salvata sul cloud
 * @returns {Array} lista da usare
 */
export function unisciCopieAppuntamenti(locali, remoti) {
  const ciSonoRemoti = Array.isArray(remoti) && remoti.length > 0;
  const base = ciSonoRemoti ? remoti : (locali || []);
  if (!ciSonoRemoti) return [...base];
  const presenti = new Set(base.map(chiaveAppuntamento));
  const soloLocali = (locali || []).filter(a => {
    const k = chiaveAppuntamento(a);
    if (presenti.has(k)) return false;
    presenti.add(k);
    return true;
  });
  return [...base, ...soloLocali];
}
