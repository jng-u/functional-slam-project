import { cpSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function packagePages() {
  const value = process.env.LUNA_API_URL ?? '';
  const endpoint = value ? URL.parse(value) : null;
  if (value && (
    !endpoint || !/^https:\/\/[^/?#@\\\s\p{Cc}]+\/api\/query$/iu.test(value)
    || endpoint.pathname !== '/api/query'
  )) {
    throw new Error('Set LUNA_API_URL to the full HTTPS URL ending in /api/query, or leave it empty until the API is ready.');
  }

  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const entry = '<script type="module" src="js/main.js"></script>';
  if (!html.includes(entry) || html.indexOf(entry) !== html.lastIndexOf(entry)) {
    throw new Error('Expected exactly one js/main.js module tag in dist/index.html.');
  }

  const output = mkdtempSync(join(tmpdir(), 'functional-slam-pages-'));
  try {
    cpSync(dist, output, {
      recursive: true,
      filter(source) {
        const info = lstatSync(source);
        if (!info.isFile() && !info.isDirectory()) {
          throw new Error('dist must contain only regular files and directories.');
        }
        return true;
      },
    });
    writeFileSync(join(output, 'pages-config.js'),
      `window.FUNCTIONAL_SLAM_API_URL = ${JSON.stringify(endpoint?.href ?? './api/query')};\n`, { flag: 'wx' });
    writeFileSync(join(output, 'index.html'),
      html.replace(entry, `<script src="pages-config.js"></script>\n${entry}`));
  } catch (error) {
    rmSync(output, { recursive: true, force: true });
    throw error;
  }
  return output;
}

try {
  console.log(packagePages());
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
