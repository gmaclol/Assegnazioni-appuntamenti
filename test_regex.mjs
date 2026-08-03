import * as pdfjsLib from 'pdfjs-dist/build/pdf.js';
import fs from 'fs';

async function checkPdf(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const pdf = await pdfjsLib.getDocument({data}).promise;
  for (let i=1; i<=pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(x=>x.str).join(' ');
    // Test the new regex
    const mArea = text.match(/AREA[_\s]*CD\s*[-:\s]*\s*(AB|CD)/i) || 
                  text.match(/AREA_CD\s*-\s*(AB|CD)/i) ||
                  text.match(/C_D\s*-\s*(AB|CD)/i);
    if (mArea) {
      const comuneMatch = text.match(/Comune:\s*([^\n]+)/i);
      console.log('FILE:', file, '| PAGE:', i, '| AREA_CD:', mArea[1], '| COMUNE:', comuneMatch ? comuneMatch[1].trim() : '?');
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