/**
 * Fasce orarie della giornata e ordinamento delle righe.
 *
 * Regole:
 *  - ogni orario appartiene alla fascia più vicina (09:30 resta negli 08:30,
 *    10:30 finisce in cima agli 11:30; a parità vince la fascia più bassa);
 *  - dentro la stessa fascia vale l'ordine manuale (trascinamento), poi l'orario;
 *  - a parità di orario i guasti vanno in fondo.
 *
 * Modulo condiviso da app.js (tabella) ed excelGenerator.js (file Excel), così
 * il foglio stampato esce nello stesso ordine che si vede a schermo.
 */

export const FASCE_BASE = ['08:30', '11:30', '14:30', '16:30'];

export function toMinuti(orario) {
  if (!orario) return 0;
  const parti = String(orario).replace('.', ':').split(':');
  return (parseInt(parti[0], 10) || 0) * 60 + (parseInt(parti[1], 10) || 0);
}

export function fasciaDi(orario) {
  const min = toMinuti(orario);
  if (!min) return FASCE_BASE[0];
  let migliore = FASCE_BASE[0];
  let distanza = Infinity;
  for (const fascia of FASCE_BASE) {
    const d = Math.abs(min - toMinuti(fascia));
    if (d < distanza) { distanza = d; migliore = fascia; }
  }
  return migliore;
}

export function isGuasto(item) {
  return item.tipoIntervento === 'Guasto' || Boolean(item.areaCd);
}

function ordineManuale(item) {
  return Number.isFinite(item && item.ordineManuale) ? item.ordineManuale : null;
}

// Comparatore unico: fascia -> ordine manuale -> orario -> guasti in fondo
export function confrontaAppuntamenti(a, b) {
  const fa = toMinuti(fasciaDi(a.orario));
  const fb = toMinuti(fasciaDi(b.orario));
  if (fa !== fb) return fa - fb;

  const oa = ordineManuale(a);
  const ob = ordineManuale(b);
  if (oa !== null && ob !== null && oa !== ob) return oa - ob;
  if (oa !== null && ob === null) return -1;
  if (oa === null && ob !== null) return 1;

  const ma = toMinuti(a.orario);
  const mb = toMinuti(b.orario);
  if (ma !== mb) return ma - mb;

  const ga = isGuasto(a);
  const gb = isGuasto(b);
  if (ga !== gb) return ga ? 1 : -1;
  return 0;
}
