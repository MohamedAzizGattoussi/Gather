# Gather on Supabase

The configured project is `https://jqicbztaipuaytcndfdl.supabase.co` and the only allowed Gather email is `medazizgatt@gmail.com`. The supplied publishable key has been verified against the project's Auth API. It is an application identifier, not an administrator credential.

**Current state:** The owner reports completing dashboard setup. A subsequent live check confirms that Gather tables now exist and deny anonymous access. Owner login and the owner association still require authenticated verification; public signup still reported enabled during that check. No local collection has been uploaded, and the app is not publicly deployed. Local mode remains active.

## 1. Set up your private account and database

Open your [Supabase project](https://supabase.com/dashboard/project/jqicbztaipuaytcndfdl).

1. Under **Authentication → Users**, use **Add user / Create user** to create a Gather application user with **medazizgatt@gmail.com**. Choose a strong password privately in the dashboard, and confirm the email there if the dashboard provides that option. Your Supabase dashboard account and this app user are separate. Do not reuse Gather's temporary local password or paste the new password into chat.
2. Under Authentication's signup settings, disable **Allow new users to sign up**. Keep email/password sign-in enabled. The exact settings label may vary. Gather itself has no signup endpoint or signup form.
3. Open **SQL Editor → New query**. Paste and run the complete contents of [supabase/setup.sql](../supabase/setup.sql). It creates Gather's tables, private media bucket, transaction functions, access policies, and the owner association. It does not create a password or edit unrelated application tables.
4. If owner setup reports that the user does not exist, finish step 1 and run [supabase/set-owner.sql](../supabase/set-owner.sql). The schema denies all app access until this association exists.

The SQL is also available as a versioned migration at [supabase/migrations/202610160001_gather.sql](../supabase/migrations/202610160001_gather.sql), followed by `supabase/set-owner.sql`. The combined setup file is for convenience; keep both source files when updating the schema.

### What the policies enforce

- All collection tables have row-level security enabled; anonymous clients have no table privileges.
- An authenticated user must match the configured owner UUID, not just have any Supabase account.
- Child records and links must have the same owner as their parent items, boards, and projects.
- Only that owner can access objects under their own UUID folder in the private `gather-media` bucket.
- Board revision checking and layout replacement share one transaction. Project link and carousel-order changes are also atomic.
- The server uses the publishable key and the signed-in user's session. No service-role key or database password is needed by the application.

## 2. Migrate the current local collection

Keep Gather in local mode until this completes. Stop editing and wait for imports to finish, then make a full backup in Settings. Local data is never removed by the migration script.

The ignored `.env` has the project URL, publishable key, owner email, and `GATHER_MODE=local`. If rebuilding from a fresh checkout, copy `.env.example` to `.env` first.

From a terminal in `D:\Code\Gather`:

```powershell
npm.cmd run migrate:supabase
```

Enter your new **Gather application password** at the hidden terminal prompt. The script reads SQLite without changing it, verifies media signatures and cloud file limits even while local mode is active, saves a complete local backup, and copies media into your private bucket. It preserves IDs, carousel order, notes, tags, categories, boards, canvas positions, and project links, verifies each uploaded file against the original with SHA-256, then verifies record counts. It does not migrate the temporary local password or local browser sessions.

Cloud uploads default to **50 MB per file**, matching the bucket created by this setup. If your existing library includes larger files, the script stops before migrating. Check your Supabase project's allowed Storage file-size limit, update the private bucket limit there, and set `GATHER_MAX_FILE_MB` accordingly (up to the app's 150 MB limit). Storage plan limits still apply. Videos also consume storage and delivery bandwidth.

If migration stops partway, the local collection remains intact. Resolve the error, then use `npm.cmd run migrate:supabase -- --resume` only for that same unchanged source collection. Resuming upserts the same IDs and may overwrite cloud edits to those IDs; do not edit the cloud collection during migration. The default command refuses to overwrite a nonempty cloud collection.

After migration succeeds, change `.env` to `GATHER_MODE=supabase`, restart the app, and sign in with your email and new password. This can be tried locally before public hosting. Switching mode does not delete the other collection; edits in local and cloud modes do not automatically synchronize.

## 3. Host the application and importer

Supabase hosts the PostgreSQL database, Auth service, and private media storage. The React site, Node API, and Python extractors run in a separate application container. The repository includes a `Dockerfile`; it runs one Node process with Python dependencies installed.

Set these environment variables on the hosting provider:

```dotenv
GATHER_MODE=supabase
SUPABASE_URL=https://jqicbztaipuaytcndfdl.supabase.co
SUPABASE_PUBLISHABLE_KEY=<the project's publishable key>
GATHER_OWNER_EMAIL=medazizgatt@gmail.com
SUPABASE_STORAGE_BUCKET=gather-media
APP_ORIGIN=https://<your-app-domain>
HOST=0.0.0.0
PORT=4317
GATHER_MAX_FILE_MB=50
```

Set `APP_ORIGIN` to the exact HTTPS origin users open. The server rejects other request hosts/origins, uses secure HttpOnly session cookies on HTTPS, and refuses a public cloud bind without an HTTPS origin. Configure the provider's trusted reverse proxy normally; the app trusts one proxy hop. Use `/healthz` as the health-check endpoint. The container's temporary directory needs enough space for uploads, but persistent collection data lives in Supabase.

Deploy a **single running app/worker instance** for now. Import jobs use an in-process queue with statuses persisted in Supabase. If the process restarts, jobs without an active worker become retryable failed imports the next time the owner opens the collection. A long-queued job whose user session expires must be retried after signing in. This is not yet a multi-worker durable job system.

No hosting provider, paid plan, domain, or public deployment has been selected or purchased. Phone browsing becomes possible after hosting; canvas editing still targets computers.

## 4. Backups and recovery

In cloud mode, Settings downloads a ZIP containing a consistent database record snapshot (`gather.json`), referenced media, and restore instructions. Let imports finish before exporting. This independent backup complements provider backups; do not assume database backups also back up Storage objects.

Restore into a configured, empty single-owner Gather cloud collection:

```powershell
npm.cmd run restore:supabase -- "C:\path\to\Gather-cloud-backup.zip"
```

The script prompts privately for the application password, validates ZIP paths and media signatures, remaps ownership to the configured owner, and preserves IDs and relationships. Existing cloud records cause restoration to stop. A failed restoration can leave a partial target; retain the archive and resolve that target before attempting a fresh restore. It never deletes the original local library.

Forgotten cloud passwords are recovered through your Supabase administrator dashboard. The local `reset-password.mjs` command changes only the local SQLite credential and has no effect on Supabase.

## Verification status

- Project URL/publishable key reach the live Auth API. After the owner's dashboard setup, Gather tables exist and anonymous reads return permission denied. Public signup still reported enabled; owner authentication has not been tested.
- Existing local build and 37 integration checks pass after separating the local and cloud modes.
- 31 checks run the migration and policies against embedded PostgreSQL, exercise owner/non-owner/anonymous RLS, private media rules, transactional updates, schema re-application, and the actual cloud server's unauthenticated startup.
- No authenticated live Supabase CRUD/upload/migration test is possible until the dashboard setup and owner account are completed. Container deployment and cloud backup/restore round trips still require verification against that configured project. The source does not claim a deployed or migrated collection.

References: [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), and [upload guidance](https://supabase.com/docs/guides/storage/uploads/standard-uploads).
