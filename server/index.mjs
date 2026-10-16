import { app } from './app.mjs';
import express from 'express';
import { cloudMode, listenHost } from './config.mjs';
import path from 'node:path';
import { existsSync } from 'node:fs';
const root=path.resolve(import.meta.dirname,'..');
const port=Number(process.env.PORT||4317);
const production = existsSync(path.join(root, 'dist', 'index.html')) && !process.argv.includes('--dev');
if (production) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (req,res) => res.sendFile(path.join(root, 'dist', 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.listen(port, listenHost, () => console.log(`\n  Gather is ready at http://${listenHost}:${port}\n  Storage mode: ${cloudMode ? 'Supabase (private owner account)' : 'local'}\n`));
