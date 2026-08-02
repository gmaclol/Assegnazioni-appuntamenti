const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

async function dumpCentrali() {
  const files = [
    ['ELECNOR.PDF', 'C:/Users/Rosti/Desktop/Assegnazioni appuntamenti/context_study/ELECNOR.PDF'],
    ['SERTORI.pdf', 'C:/Users/Rosti/Downloads/SERTORI.pdf']
  ];

  for (const [name, path] of files) {
    if (!fs.existsSync(path)) continue;
    const data = new Uint8Array(fs.readFileSync(path));
    const pdf = await pdfjsLib.getDocument({ data }).promise;

    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      pages.push(tc.items.map(item => item.str).join(' '));
    }

    const groups = new Map();
    const keys = [];
    for (const pt of pages) {
      const wr = (pt.match(/^WR:\s+(\S+)/) || [])[1];
      if (!wr) continue;
      if (groups.has(wr)) { groups.set(wr, groups.get(wr) + '\n' + pt); }
      else { groups.set(wr, pt); keys.push(wr); }
    }

    console.log(`\n${name}:`);
    for (const wr of keys) {
      const text = groups.get(wr);
      const header = text.substring(0, 500);
      
      const centrale = (header.match(/Centrale:\s*(\S+)/) || [])[1] || 'N/D';
      const comune = (header.match(/Comune:\s*([A-Za-zÀ-ÿ\s]+?)(?:\s{2,}|Indiriz)/) || [])[1]?.trim() || 'N/D';
      const indirizzo = (header.match(/Indiriz\.\:\s*(.+?)(?:\s{2,}Telefono|\s{2,}Comune|\s{3,})/i) || [])[1]?.trim() || 'N/D';
      
      console.log(`  WR ${wr}: Comune=${comune} | Centrale=${centrale} | Via=${indirizzo}`);
    }
  }
}

dumpCentrali().then(() => process.exit(0));
