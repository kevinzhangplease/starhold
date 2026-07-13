// Starhold test suite runner. Executes every *.ts file in this directory (except itself) as
// a standalone Node script and aggregates results. Each test file is fully self-contained
// (own imports, own checks, own process.exit code) — this runner just orchestrates and
// reports, so a single broken test file can never take down the others.
//
// Run: node --experimental-strip-types tests/run-all.ts
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(__dirname)
  .filter(f => f.endsWith('.ts') && f !== 'run-all.ts')
  .sort();

console.log(`Starhold test suite — ${files.length} files\n`);

let failedFiles = 0;
const results: { file: string; ok: boolean; output: string; ms: number }[] = [];

for (const file of files) {
  const start = Date.now();
  let ok = true, output = '';
  try {
    output = execFileSync('node', ['--experimental-strip-types', join(__dirname, file)], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e: any) {
    ok = false;
    output = (e.stdout || '') + (e.stderr || '');
    failedFiles++;
  }
  const ms = Date.now() - start;
  results.push({ file, ok, output: output.trim(), ms });
  console.log(`${ok ? '✓' : '✗'} ${file}  (${ms}ms)`);
  if (!ok) console.log(output.split('\n').map(l => `    ${l}`).join('\n'));
}

console.log('');
console.log(failedFiles === 0
  ? `All ${files.length} test files passed.`
  : `${failedFiles}/${files.length} test file(s) failed — see output above.`);
process.exit(failedFiles === 0 ? 0 : 1);
