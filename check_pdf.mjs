import * as pdfjsLib from 'pdfjs-dist/build/pdf.js';
import fs from 'fs';

async function checkPdf(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const pdf = await pdfjsLib.getDocument({data}).promise;
  for (let i=1; i<=pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(x=>x.str).join(' ');
    if (text.toLowerCase().includes('rivoli')) {
      const areaMatch = text.match(/AREA[_\s]*CD\s*[-:\s]*\s*(AB|CD)/i);
      console.log('FILE:', file);
      console.log('PAGE:', i);
      console.log('AREA_CD:', areaMatch ? areaMatch[1] : 'NON TROVATO');
      console.log('---');
      console.log(text.substring(0, 500));
      console.log('===END===');
      return true;
    }
  }
  return false;
}

async function main() {
  const files = fs.readdirSync('context_study').filter(f=>f.endsWith('.pdf')).map(f=>'context_study/'+f);
  for (const f of files) {
    await checkPdf(f);
  }
}

main();