/** Verify upstream license, attribution, and provenance records remain intact. */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const requiredFiles = [
  'LICENSE',
  'NOTICE',
  'docs/upstream/README.md',
  'docs/upstream/dsh/LICENSE-APACHE',
  'docs/upstream/dsh/LICENSE-MIT',
  'docs/upstream/dsh/README.md',
];

const failures = [];
for (const rel of requiredFiles) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full) || fs.statSync(full).size === 0) {
    failures.push(`Missing or empty upstream attribution file: ${rel}`);
  }
}

if (!failures.length) {
  const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
  if (!license.includes('GNU AFFERO GENERAL PUBLIC LICENSE')) {
    failures.push('LICENSE must retain AGPL-3.0-only text');
  }
  const notice = fs.readFileSync(path.join(root, 'NOTICE'), 'utf8');
  if (!/bulwark/i.test(notice)) {
    failures.push('NOTICE must retain upstream Bulwark attribution');
  }
}

if (failures.length) {
  throw new Error(failures.join('\n'));
}

console.log(
  `Verified upstream license and attribution records (${requiredFiles.length} files).`,
);
