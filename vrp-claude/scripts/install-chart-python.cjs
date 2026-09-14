// Install a pinned, local Pyodide runtime. Package hashes come from its lockfile.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../public/chart-studio/runtime');
const base = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
async function get(name, sha) {
  const target = path.join(root, name);
  if (path.dirname(target) !== root) throw new Error('Unexpected runtime filename');
  try { const old = await fs.readFile(target); if (sha && crypto.createHash('sha256').update(old).digest('hex') === sha) return; } catch {}
  let data;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(base + name, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      data = Buffer.from(await response.arrayBuffer()); break;
    } catch (e) { if (attempt === 2) throw e; console.log(`Retrying ${name}…`); }
  }
  if (sha && crypto.createHash('sha256').update(data).digest('hex') !== sha) throw new Error(`${name}: checksum mismatch`);
  await fs.writeFile(target, data); console.log(`${name}: ${(data.length / 1024 / 1024).toFixed(2)} MB`);
}
(async () => {
  await fs.mkdir(root, { recursive: true });
  await get('pyodide-lock.json');
  const lock = JSON.parse(await fs.readFile(path.join(root, 'pyodide-lock.json'), 'utf8'));
  const names = new Set();
  function collect(name) { if (names.has(name)) return; const pkg = lock.packages[name]; if (!pkg) throw new Error(`Unknown package ${name}`); names.add(name); for (const dep of pkg.depends || []) collect(dep); }
  ['numpy', 'pandas', 'scipy'].forEach(collect);
  for (const name of ['pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip']) await get(name);
  for (const name of names) { const p = lock.packages[name]; await get(p.file_name, p.sha256); }
  console.log('Local Python runtime ready.');
})().catch(e => { console.error(e); process.exitCode = 1; });
