import { cloudMode, appOrigin, listenHost, maxFileMB } from './config.mjs';
import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
const app = express();
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.PORT || 4317);
if (cloudMode && appOrigin) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.get('/healthz', (req,res) => res.json({ok:true}));
app.use((req, res, next) => {
  const expectedHost = cloudMode && appOrigin ? new URL(appOrigin).host : null;
  if (expectedHost ? req.headers.host !== expectedHost : !['127.0.0.1','localhost','[::1]'].includes(req.hostname)) return res.status(403).json({error:'Request host rejected.'});
  if (req.headers.origin) {
    try { if (new URL(req.headers.origin).origin !== (appOrigin || `http://${req.headers.host}`)) return res.status(403).json({error:'Request origin rejected.'}); } catch { return res.sendStatus(403); }
  }
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  if (cloudMode && appOrigin.startsWith('https://')) res.setHeader('Strict-Transport-Security','max-age=31536000');
  if (req.path.startsWith('/api') || req.path.startsWith('/media')) res.setHeader('Cache-Control','no-store');
  next();
});
app.use(express.json({limit:'2mb'}));
app.get('/api/config',(req,res)=>res.json({mode:cloudMode?'supabase':'local',maxFileMB}));
if (cloudMode) {
  const { cloudRouter } = await import('./cloud.mjs'); app.use(cloudRouter);
} else {
  const { localRouter } = await import('./local.mjs'); app.use(localRouter);
}
const production = existsSync(path.join(root, 'dist', 'index.html')) && !process.argv.includes('--dev');
if (production) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (req,res) => res.sendFile(path.join(root, 'dist', 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.listen(port, listenHost, () => console.log(`\n  Gather is ready ? http://${listenHost}:${port}\n  Storage mode: ${cloudMode ? 'Supabase (private owner account)' : 'local'}\n`));
