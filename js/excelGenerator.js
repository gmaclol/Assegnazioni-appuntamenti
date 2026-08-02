import ExcelJS from 'exceljs';

/**
 * Genera il file Excel formattato come il modello aziendale.
 * Struttura:
 *   Riga 1: ATTIVITA' TECHNICALWORK SRL del DD MM YYYY
 *   Riga 3: IMPIANTI DA REALIZZARE | TECNICO/CENTRALE
 *   Righe 5+: Appuntamenti ordinati per orario, bordi thin, colore di sfondo per fascia
 *   Sezione SOSPENDERE (vuota, da riempire a mano)
 *   Sezione CHIUDERE (vuota, da riempire a mano)
 * 
 * @param {Array} items Lista di appuntamenti
 * @param {String} dataStr Data (es. "01 08 2026")
 */
export async function exportToExcel(items, dataStr = '') {
  if (!dataStr) {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    dataStr = `${dd} ${mm} ${yyyy}`;
  }

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Foglio1');

  // Colonne
  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 85;
  ws.getColumn(3).width = 40;

  const border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

  // Colori per fascia oraria (come nel file originale)
  const COLORS = {
    '08': { argb: 'FFFF0000' },  // Rosso
    '09': { argb: 'FFFFFF00' },  // Giallo
    '10': { argb: 'FFFFFF00' },  // Giallo
    '11': { argb: 'FF00B050' },  // Verde
    '12': { argb: 'FF00B050' },  // Verde
    '13': { argb: 'FF00B050' },  // Verde
    '14': { argb: 'FFFFC000' },  // Arancione
    '15': { argb: 'FFFFC000' },  // Arancione
    '16': { argb: 'FF4472C4' },  // Blu
    '17': { argb: 'FF4472C4' },  // Blu
  };

  function getColorForOrario(orario) {
    if (!orario) return null;
    const hh = orario.split(':')[0];
    return COLORS[hh] || null;
  }

  function addDataRow(orarioStr, descrizione, tecnico, { isGuasto = false, isBorchia = false } = {}) {
    const row = ws.addRow([orarioStr, descrizione, tecnico]);
    row.alignment = { vertical: 'middle', wrapText: true };

    // Bordi su tutte le celle
    for (let c = 1; c <= 3; c++) {
      row.getCell(c).border = border;
    }

    if (isBorchia) {
      // Borchia: solo la descrizione (col 2) rossa, orario e tecnico normali
      row.getCell(2).font = { name: 'Calibri', size: 11, color: { argb: 'FFFF0000' } };
      row.getCell(1).font = { name: 'Calibri', size: 11 };
      row.getCell(3).font = { name: 'Calibri', size: 11 };
      // Colore fascia oraria su cella A
      const color = getColorForOrario(orarioStr);
      if (color) {
        row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: color };
        row.getCell(1).font = { name: 'Calibri', size: 11, bold: true };
      }
    } else if (isGuasto) {
      // Guasto/Chiudere: sfondo grigio su tutte le celle
      const greyFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0C0C0' } };
      for (let c = 1; c <= 3; c++) {
        row.getCell(c).fill = greyFill;
      }
      row.font = { name: 'Calibri', size: 11, bold: false };

      // Colore fascia oraria sulla cella A (sovrascrive il grigio solo per l'ora)
      const color = getColorForOrario(orarioStr);
      if (color) {
        row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: color };
        row.getCell(1).font = { name: 'Calibri', size: 11, bold: true };
      }
    } else {
      // Normale: font standard + colore fascia oraria
      row.font = { name: 'Calibri', size: 11 };
      const color = getColorForOrario(orarioStr);
      if (color) {
        row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: color };
        row.getCell(1).font = { name: 'Calibri', size: 11, bold: true };
      }
    }

    return row;
  }

  function addEmptySlots(orarioStr, count) {
    for (let i = 0; i < count; i++) {
      addDataRow(orarioStr, '', '');
    }
  }

  // Ordina per orario
  const sorted = [...items].sort((a, b) => toMin(a.orario) - toMin(b.orario));

  // ── RIGA 1: TITOLO ──
  const titleRow = ws.addRow(['', `ATTIVITA' TECHNICALWORK SRL del ${dataStr}`, '']);
  titleRow.font = { name: 'Arial', size: 12, bold: true };
  titleRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };

  // Riga 2: vuota
  ws.addRow(['', '', '']);

  // ── RIGA 3: INTESTAZIONE SEZIONE 1 ──
  const h1 = ws.addRow(['', 'IMPIANTI  DA REALIZZARE ', 'TECNICO/CENTRALE']);
  h1.font = { name: 'Calibri', size: 11, bold: true };
  h1.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } };
  h1.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } };
  for (let c = 1; c <= 3; c++) h1.getCell(c).border = border;

  // Riga 4: vuota
  ws.addRow(['', '', '']);

  // ── RIGHE DATI: tutti gli appuntamenti (realizzare e borchia) ──
  const realizzareMerged = sorted.filter(i => i.sezione === 'realizzare' || i.sezione === 'borchia');

  // Ordina per fascia oraria, e a parità di orario mette i guasti in fondo al blocco
  realizzareMerged.sort((a, b) => {
    const minA = toMin(a.orario);
    const minB = toMin(b.orario);
    if (minA !== minB) return minA - minB;
    const isGuastoA = a.tipoIntervento === 'Guasto' || Boolean(a.areaCd);
    const isGuastoB = b.tipoIntervento === 'Guasto' || Boolean(b.areaCd);
    if (isGuastoA !== isGuastoB) return isGuastoA ? 1 : -1;
    return 0;
  });

  if (realizzareMerged.length > 0) {
    for (const item of realizzareMerged) {
      const isGuasto = item.tipoIntervento === 'Guasto' || Boolean(item.areaCd);
      const isBorchia = item.sezione === 'borchia';
      addDataRow(
        item.orario || '08:30',
        item.descrizioneSito || item.descrizioneExcel || '',
        item.tecnicoCentraleExcel || '',
        { isGuasto, isBorchia }
      );
    }
  }

  // ── Riga vuota ──
  ws.addRow(['', '', '']);

  // ── SEZIONE 2: IMPIANTI DA SOSPENDERE ──
  const h2 = ws.addRow(['', '                                 IMPIANTI DA SOSPENDERE ', '']);
  h2.font = { name: 'Calibri', size: 11, bold: true };
  h2.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } };
  for (let c = 1; c <= 3; c++) h2.getCell(c).border = border;

  ws.addRow(['', '', '']);

  const sospesi = sorted.filter(i => i.sezione === 'sospendere');
  for (const item of sospesi) {
    addDataRow(item.orario || '08:30', item.descrizioneSito || item.descrizioneExcel || '', item.tecnicoCentraleExcel || '');
  }
  addEmptySlots('08:30', 3);
  addEmptySlots('11:30', 3);
  addEmptySlots('14:30', 3);
  addEmptySlots('16:30', 3);

  // ── Riga vuota ──
  ws.addRow(['', '', '']);

  // ── SEZIONE 3: IMPIANTI DA CHIUDERE ──
  const h3 = ws.addRow(['', '                                 IMPIANTI DA CHIUDERE ', '']);
  h3.font = { name: 'Calibri', size: 11, bold: true };
  h3.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } };
  for (let c = 1; c <= 3; c++) h3.getCell(c).border = border;

  ws.addRow(['', '', '']);

  const chiusi = sorted.filter(i => i.sezione === 'chiudere');
  for (const item of chiusi) {
    addDataRow(item.orario || '08:30', item.descrizioneSito || item.descrizioneExcel || '', item.tecnicoCentraleExcel || '', { isGuasto: true });
  }
  addEmptySlots('08:30', 4);
  addEmptySlots('11:30', 4);
  addEmptySlots('14:30', 4);
  addEmptySlots('16:30', 4);

  // ── DOWNLOAD ──
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

function toMin(s) {
  if (!s) return 0;
  const parts = s.replace('.', ':').split(':');
  return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
}
