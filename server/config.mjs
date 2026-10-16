import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import path from 'node:path';

const envPath = path.resolve(import.meta.dirname, '..', '.env');
if (existsSync(envPath)) loadEnvFile(envPath);
export const cloudMode = process.env.GATHER_MODE === 'supabase';
export const supabaseUrl = process.env.SUPABASE_URL || '';
export const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || '';
export const ownerEmail = (process.env.GATHER_OWNER_EMAIL || '').trim().toLowerCase();
export const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'gather-media';
export const appOrigin = process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : '';
export const listenHost = cloudMode ? (process.env.HOST || '127.0.0.1') : '127.0.0.1';
export const cloudMaxFileMB = Math.max(1, Math.min(150, Number(process.env.GATHER_MAX_FILE_MB || 50)));
export const maxFileMB = cloudMode ? cloudMaxFileMB : 150;
if (!Number.isFinite(cloudMaxFileMB)) throw new Error('GATHER_MAX_FILE_MB must be a number.');
if (cloudMode && (!supabaseUrl.startsWith('https://') || !supabaseKey.startsWith('sb_publishable_') || !ownerEmail)) throw new Error('Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and GATHER_OWNER_EMAIL before enabling Supabase mode.');
if (cloudMode && listenHost !== '127.0.0.1' && (!appOrigin || !appOrigin.startsWith('https://'))) throw new Error('A public cloud deployment requires an https APP_ORIGIN.');
