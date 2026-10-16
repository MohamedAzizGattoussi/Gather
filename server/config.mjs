import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import path from 'node:path';

const envPath = path.resolve(import.meta.dirname, '..', '.env');
// Hosted functions use deployment variables, never a packaged developer .env.
if (process.env.VERCEL !== '1' && existsSync(envPath)) loadEnvFile(envPath);
function configurationError(message) {
  throw Object.assign(new Error(message), { code: 'GATHER_CONFIGURATION_ERROR' });
}
export const serverlessMode = process.env.VERCEL === '1';
if(serverlessMode&&process.env.GATHER_MODE&&process.env.GATHER_MODE!=='supabase')configurationError('Set GATHER_MODE=supabase in Vercel Environment Variables, then redeploy. Local SQLite mode cannot run on Vercel.');
export const cloudMode = serverlessMode || process.env.GATHER_MODE === 'supabase';
export const supabaseUrl = process.env.SUPABASE_URL || '';
export const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || '';
export const ownerEmail = (process.env.GATHER_OWNER_EMAIL || '').trim().toLowerCase();
export const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'gather-media';
const productionHost=serverlessMode&&process.env.VERCEL_ENV==='production'?process.env.VERCEL_PROJECT_PRODUCTION_URL:'';
const originValue=process.env.APP_ORIGIN||(productionHost?`https://${productionHost}`:serverlessMode&&process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:'');
function parseOrigin(value) {
  if (!value) return '';
  try {
    const origin = new URL(value);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw new Error();
    return origin.origin;
  } catch { configurationError('APP_ORIGIN must be a complete website origin, such as https://gather-seven-delta.vercel.app. Correct it in Vercel Environment Variables and redeploy.'); }
}
export const appOrigin = parseOrigin(originValue);
const uniqueDeploymentOrigin=serverlessMode&&process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:'';
export const deploymentOrigin = serverlessMode&&process.env.VERCEL_ENV!=='production'?uniqueDeploymentOrigin||appOrigin:appOrigin;
export const allowedOrigins = new Set([appOrigin,uniqueDeploymentOrigin].filter(Boolean));
export const listenHost = cloudMode ? (process.env.HOST || '127.0.0.1') : '127.0.0.1';
export const cloudMaxFileMB = Math.max(1, Math.min(150, Number(process.env.GATHER_MAX_FILE_MB || 50)));
export const maxFileMB = cloudMode ? cloudMaxFileMB : 150;
if (!Number.isFinite(cloudMaxFileMB)) configurationError('GATHER_MAX_FILE_MB must be a number.');
if (cloudMode) {
  const invalid = [
    !supabaseUrl.startsWith('https://') && 'SUPABASE_URL',
    !supabaseKey.startsWith('sb_publishable_') && 'SUPABASE_PUBLISHABLE_KEY',
    !ownerEmail && 'GATHER_OWNER_EMAIL',
  ].filter(Boolean);
  if (invalid.length) configurationError(`Missing or invalid deployment variables: ${invalid.join(', ')}. Set them in Vercel Settings > Environment Variables for Production, then redeploy.`);
}
if (cloudMode && listenHost !== '127.0.0.1' && (!appOrigin || !appOrigin.startsWith('https://'))) configurationError('A public cloud deployment requires an https APP_ORIGIN.');
