# Deploy Gather to Vercel

Gather is prepared for a static React frontend, a Node API, and a Python importer on Vercel. Supabase stores your private collection, login, and media. Preparation does not publish the app or migrate your local collection.

## 1. Update Supabase

In your existing project's SQL Editor, run [202610160002_vercel.sql](../supabase/migrations/202610160002_vercel.sql). It adds upload tracking and import leases to the original schema. For a fresh database, use [setup.sql](../supabase/setup.sql), which includes both migrations and owner assignment.

Ensure `medazizgatt@gmail.com` exists as an application user and is assigned using [set-owner.sql](../supabase/set-owner.sql). Keep email/password login enabled, disable public signups, and keep `gather-media` private. Use the password chosen privately for that user; the temporary local password does not apply to hosting.

## 2. Import GitHub into Vercel

Choose **Add New → Project**, import `MohamedAzizGattoussi/Gather`, and use production branch **main**.

| Setting | Value |
| --- | --- |
| Framework | Vite |
| Root directory | Repository root |
| Node.js | 24.x |
| Build command | `npm run build` |
| Output directory | `dist` |
| Install command | Default (`npm install`) |

`vercel.json` configures routes and function durations. `.python-version` selects Python 3.12 and root `requirements.txt` installs importer dependencies. Enable Fluid Compute for the configured 300-second function duration. See Vercel's [function limits](https://vercel.com/docs/functions/limitations) and [Python runtime](https://vercel.com/docs/functions/runtimes/python).

## 3. Set environment variables, then deploy

Add these in Vercel for Production, and Preview if using previews:

```dotenv
GATHER_MODE=supabase
SUPABASE_URL=https://jqicbztaipuaytcndfdl.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_AxdIA_aWxv3_pdSXw6lfHQ_bLbIV_PE
GATHER_OWNER_EMAIL=medazizgatt@gmail.com
SUPABASE_STORAGE_BUCKET=gather-media
GATHER_MAX_FILE_MB=50
```

No service-role key or database password is needed. Do not upload the local `.env`.

Make Vercel system environment variables available to functions. Gather derives its production origin from `VERCEL_PROJECT_PRODUCTION_URL` and preview origin from `VERCEL_URL`. For a custom domain, set **Production** `APP_ORIGIN=https://your-domain.example` to the exact domain you use, then redeploy. Do not apply that production override to previews. `HOST`, `PORT`, and local data paths are unnecessary on Vercel.

Imports call the Python function on the deployed site. If Deployment Protection is enabled, configure Vercel's **Protection Bypass for Automation** secret as `VERCEL_AUTOMATION_BYPASS_SECRET` so internal requests can reach it. Otherwise protected previews save links but imports fail. Keep this secret out of source files and frontend variables.

Deploy once the SQL update and variables are in place. The site is publicly reachable while collection access requires the owner's login.

## 4. Move your local collection if desired

Deployment uses whatever is already in Supabase. Local SQLite data does not sync automatically, and migration of your existing collection has not been confirmed.

Follow [the migration guide](SUPABASE.md#2-migrate-the-current-local-collection), make a local backup, then run locally:

```powershell
npm.cmd run migrate:supabase
```

Enter your Gather application password only at the private terminal prompt. The tool preserves carousel order, notes, boards, layouts, and projects, and refuses a nonempty target by default. Avoid hosted edits during migration.

## Runtime behavior and limits

- Files upload directly from the browser to private Storage with signed upload tickets. Files over 6 MB use resumable transfers in 6 MB chunks, avoiding Vercel's 4.5 MB function payload limit. See [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads).
- The API checks file signatures and sizes before attaching media. Playback redirects to a signed Storage URL valid for one hour; treat copied URLs as private while valid.
- Python imports run for a bounded period; database leases prevent duplicate workers. Interrupted jobs become retryable after five minutes, preserving successful slides. Node keeps the invocation alive using [Vercel waitUntil](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package).
- Social platforms may block datacenter requests. The Python worker locally resolved all seven slides of your Instagram example, but hosted access remains unverified. Original links and manual attachment remain available.
- Settings backups stream a ZIP directly from Storage through the browser. Supported browsers write directly to disk using the save-file picker; others hold the ZIP in memory. Let imports finish and avoid edits/deletions during backup. Very large libraries may outgrow the manifest response or one-hour signed URL lifetime.
- File limits must fit both `GATHER_MAX_FILE_MB` and the bucket limit. Provider storage, bandwidth, and function quotas apply.

## After deploying

Check login, saving, an image/video upload larger than 4.5 MB, carousel order, board persistence after reload, project links, backups, and a public source import. Incognito `/api/state` should return 401; private media requires a session. GET `/api/import` should return 405 from Python.

Local checks cover routing, API behavior with simulated Supabase responses, policies and transactions in embedded PostgreSQL, and Python parsing/public-address protections. Real Vercel execution, authenticated live Supabase operations, and a browser walkthrough remain to be checked after deployment.
