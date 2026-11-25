import * as pdfjsLib from 'pdfjs-dist/build/pdf.js';
import fs from 'fs';

async function checkPdf(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const pdf = await pdfjsLib.getDocument({data}).promise;
  for (let i=1; i<=pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(x=>x.str).join(' ');
    const tipoMatch = text.match(/Tipo:\s*(\d+\s*-\s*[^\n]+)/i);
    if (tipoMatch) {
      console.log('FILE:', file, '| PAGE:', i, '| TIPO:', tipoMatch[1].trim());
    }
  }
}

async function main() {
  const files = fs.readdirSync('context_study').filter(f=>f.endsWith('.pdf')).map(f=>'context_study/'+f);
  for (const f of files) {
    await checkPdf(f);
  }
}

main();