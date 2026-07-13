// Rasterizes build-tools/icon.svg into the PNG sizes referenced by manifest.webmanifest.
// Run manually (or wire into a prebuild step) whenever the icon artwork changes — this is
// NOT part of the Vite build itself, since icon source art changes far less often than code.
//   node --experimental-strip-types build-tools/gen-icons.ts
import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, 'icon.svg');
const outDir = join(__dirname, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const sizes = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  // "maskable" variants use the SAME art (already designed with safe-area padding baked
  // in — see icon.svg's comment) rather than a separate source, since the whole point of
  // the safe-zone design is that one image works for both purposes.
  { file: 'icon-maskable-192.png', size: 192 },
  { file: 'icon-maskable-512.png', size: 512 },
];

async function run() {
  for (const { file, size } of sizes) {
    await sharp(src).resize(size, size).png().toFile(join(outDir, file));
    console.log(`  wrote ${file} (${size}x${size})`);
  }
  console.log(`Icons written to ${outDir}`);
}
run().catch(err => { console.error(err); process.exit(1); });
