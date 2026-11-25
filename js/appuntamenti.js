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

/**
 * Unisce i nuovi interventi a quelli già in lista.
 *
 * @param {Array} lista  appuntamenti già presenti (vincono sui nuovi)
 * @param {Array} nuovi  interventi appena estratti dai PDF
 * @returns {{appuntamenti: Array, aggiunti: Array, doppioni: number}}
 */
export function integraAppuntamenti(lista, nuovi) {
  const presenti = new Set((lista || []).map(chiaveAppuntamento));
  const aggiunti = [];
  for (const n of (nuovi || [])) {
    const k = chiaveAppuntamento(n);
    if (!k || presenti.has(k)) continue;
    presenti.add(k);
    aggiunti.push(n);
  }
  return {
    appuntamenti: [...(lista || []), ...aggiunti],
    aggiunti,
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
