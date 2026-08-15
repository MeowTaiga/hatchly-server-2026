import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const outDir = path.resolve(process.cwd(), '../hatchly-app-2026/assets/weather');
fs.mkdirSync(outDir, { recursive: true });

async function rainPng() {
  const W = 400;
  const H = 800;
  const lines: string[] = [];
  for (let i = 0; i < 56; i++) {
    const x = (i * 47 + 19) % W;
    const y = (i * 73 + 11) % (H - 40);
    const len = 20 + (i % 5) * 7;
    const op = (0.2 + (i % 4) * 0.09).toFixed(2);
    lines.push(
      `<line x1="${x}" y1="${y}" x2="${x + 7}" y2="${y + len}" stroke="rgba(210,230,255,${op})" stroke-width="1.5" stroke-linecap="round"/>`,
    );
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${lines.join('')}</svg>`;
  const out = path.join(outDir, 'rain-sheet.png');
  await sharp(Buffer.from(svg)).png().toFile(out);
  console.log('wrote', out);
}

rainPng()
  .then(() => {
    console.log('done', fs.readdirSync(outDir));
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
