import { cloudMode, serverlessMode, appOrigin, allowedOrigins, maxFileMB } from './config.mjs';
import express from 'express';
export const app = express();
if (cloudMode && appOrigin) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.get('/healthz', (req,res) => res.json({ok:true}));
app.use((req, res, next) => {
  const expectedHosts = cloudMode && allowedOrigins.size ? [...allowedOrigins].map(value=>new URL(value).host) : null;
  if (expectedHosts ? !expectedHosts.includes(req.headers.host) : !['127.0.0.1','localhost','[::1]'].includes(req.hostname)) return res.status(403).json({error:'Request host rejected.'});
  if (req.headers.origin) {
    try { if (!(allowedOrigins.size ? allowedOrigins.has(new URL(req.headers.origin).origin) : new URL(req.headers.origin).origin === `http://${req.headers.host}`)) return res.status(403).json({error:'Request origin rejected.'}); } catch { return res.sendStatus(403); }
  }
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  if (cloudMode && appOrigin.startsWith('https://')) res.setHeader('Strict-Transport-Security','max-age=31536000');
  if (req.path.startsWith('/api') || req.path.startsWith('/media')) res.setHeader('Cache-Control','no-store');
  next();
});
app.use(express.json({limit:'2mb'}));
app.get('/api/config',(req,res)=>res.json({mode:cloudMode?'supabase':'local',maxFileMB,directUploads:serverlessMode,browserBackup:serverlessMode}));
if (cloudMode) {
  const { cloudRouter } = await import('./cloud.mjs'); app.use(cloudRouter);
} else {
  const { localRouter } = await import('./local.mjs'); app.use(localRouter);
}
