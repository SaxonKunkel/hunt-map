import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

// After the build, write the list of every file in dist/ into dist/sw.js so the
// service worker can download the whole app (including public land data) for offline use.
function precacheManifest() {
  let outDir;
  return {
    name: 'precache-manifest',
    apply: 'build',
    configResolved(cfg) {
      outDir = cfg.build.outDir;
    },
    async closeBundle() {
      const files = [];
      const walk = async (dir) => {
        for (const e of await readdir(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) await walk(p);
          else files.push(p);
        }
      };
      await walk(outDir);
      const hash = createHash('sha1');
      const urls = [];
      for (const f of files) {
        const rel = relative(outDir, f).split(sep).join('/');
        if (rel === 'sw.js') continue;
        hash.update(rel).update(await readFile(f));
        urls.push(rel === 'index.html' ? './' : rel);
      }
      const swPath = join(outDir, 'sw.js');
      const sw = (await readFile(swPath, 'utf8'))
        .replace('self.__PRECACHE__', JSON.stringify(urls))
        .replace('__VERSION__', hash.digest('hex').slice(0, 10));
      await writeFile(swPath, sw);
      console.log(`precache manifest: ${urls.length} files`);
    },
  };
}

// `--mode phone` turns on HTTPS (self-signed) so an iPhone on your Wi-Fi is allowed to use GPS.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [mode === 'phone' ? basicSsl() : null, precacheManifest()],
  build: { chunkSizeWarningLimit: 1500 },
}));
