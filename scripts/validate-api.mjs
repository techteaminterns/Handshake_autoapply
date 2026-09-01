import { execSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function collectJsFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectJsFiles(fullPath));
    } else if (entry.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

const targets = ['api', 'lib', 'worker'].flatMap((dir) => collectJsFiles(join(ROOT, dir)));

for (const file of targets) {
  execSync(`node --check "${file}"`, { stdio: 'inherit' });
}

console.log(`Validated ${targets.length} API/lib files.`);
