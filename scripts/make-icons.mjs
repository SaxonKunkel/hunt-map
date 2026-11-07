// Generates the PNG app icons from an inline SVG. Run with: npm run icons
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
await mkdir(out, { recursive: true });

// pad = how much empty margin around the artwork (maskable icons need ~20% safe zone)
const svg = (pad) => {
  const s = 512, c = s / 2, r = (s / 2 - pad) * 0.62;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" fill="#2f4a2a"/>
  <g fill="none" stroke="#c8d6a8" stroke-width="10" opacity="0.45">
    <path d="M0 ${s * 0.72} C ${s * 0.25} ${s * 0.62}, ${s * 0.5} ${s * 0.82}, ${s} ${s * 0.68}"/>
    <path d="M0 ${s * 0.84} C ${s * 0.3} ${s * 0.74}, ${s * 0.55} ${s * 0.95}, ${s} ${s * 0.8}"/>
    <path d="M0 ${s * 0.3} C ${s * 0.3} ${s * 0.2}, ${s * 0.6} ${s * 0.38}, ${s} ${s * 0.26}"/>
  </g>
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#ff7a1a" stroke-width="${r * 0.16}"/>
  <circle cx="${c}" cy="${c}" r="${r * 0.18}" fill="#ff7a1a"/>
  <g stroke="#ff7a1a" stroke-width="${r * 0.12}" stroke-linecap="round">
    <line x1="${c}" y1="${c - r * 1.35}" x2="${c}" y2="${c - r * 0.55}"/>
    <line x1="${c}" y1="${c + r * 0.55}" x2="${c}" y2="${c + r * 1.35}"/>
    <line x1="${c - r * 1.35}" y1="${c}" x2="${c - r * 0.55}" y2="${c}"/>
    <line x1="${c + r * 0.55}" y1="${c}" x2="${c + r * 1.35}" y2="${c}"/>
  </g>
</svg>`;
};

const jobs = [
  ['icon-192.png', 192, 40],
  ['icon-512.png', 512, 40],
  ['maskable-512.png', 512, 110],
  ['apple-touch-icon.png', 180, 40],
  ['favicon-32.png', 32, 20],
];
for (const [name, size, pad] of jobs) {
  await sharp(Buffer.from(svg(pad))).resize(size, size).png().toFile(join(out, name));
  console.log('wrote', name);
}
