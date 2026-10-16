# Gather

A private inspiration library that runs on your computer. Collect links, images, videos, carousel slides, and thoughts; arrange moodboards and develop projects at your own pace.

**Vercel deployment:** Follow [the deployment guide](docs/VERCEL.md) for the required SQL update, environment variables, and GitHub import settings. Vercel serves the site/API/importer; Supabase provides private records, media, and owner-only login. Deployment and collection migration are separate steps. Local mode remains the default on your computer.

## Run locally

Requirements: **Node.js 24+** and **Python 3.10+**. No hosting account or cloud database is needed.

```powershell
npm.cmd install
npm.cmd run setup:imports
npm.cmd run build
npm.cmd start
```

Open **http://127.0.0.1:4317** in your browser. Initial password: **123456789**. Change it in Settings whenever you like. The initial password is hashed on first launch; restarting does not reset it. Stop the server with Ctrl+C. `npm.cmd run dev` uses the live Vite development frontend. `npm` also works where PowerShell permits its wrapper script.

The server binds to `127.0.0.1` only. The website is not published or reachable from a phone or another computer. Internet is needed to fetch public links, not to access files already stored locally.

## What is included

- Password login with server-side sessions and protected media.
- Library capture without required organization. Save links, ideas, and up to 40 image/video files per upload (150 MB per file).
- Original source links alongside locally stored media. Multiple attached/imported files form an ordered carousel. Browse slides with arrows and a counter on Library cards; use arrows, keyboard navigation, and a thumbnail strip in item details. Reorder slides in item details.
- Editable titles, notes, one optional freeform category, and multiple tags. Search stored text and filter by type, category, tag, uncategorized, or missing board/project connections.
- Separate Boards overview and freeform board pages. Add references and independent notes, drag using an element's grip, resize, change note colors, pan, zoom, and fit content. Arrow keys move a selected element; Shift increases the step. Layout changes save automatically with visible errors and revision-conflict protection.
- Separate Projects overview and project pages with description, editable notes, direct Library references, and shared moodboard links. Project text uses an explicit Save changes action. No statuses, deadlines, or task lists.
- Change password, lock the app, and download a complete database/media backup from Settings.
- Public-media import queue with source adapters for Instagram, Facebook, Pinterest, and general websites. Interrupted imports can be retried from item details.

## Import coverage and limits

| Source | Implementation | Limits |
| --- | --- | --- |
| Instagram | Image-aware public product extraction through yt-dlp, preserving every original image/video carousel entry; gallery-dl fallback | No account cookies or private posts. Public posts can still be blocked by the platform. |
| Facebook | Public single post/photo/video extraction through gallery-dl and yt-dlp | Content variants and access restrictions vary; authentication-required content is excluded. |
| Pinterest | Public individual pin and pin.it extraction through gallery-dl; video fallback | Pin boards/profile imports are excluded. Some pins may be blocked or unavailable. |
| Websites | Direct media, identified carousel/gallery markup, structured image collections, then page media | Prefers full-size slides to a single page cover; up to 40 discovered files. JavaScript-only/inaccessible galleries and DRM are unsupported. |

Extractors enumerate URLs; Gather downloads media through a bounded public-address fetcher that checks DNS and redirects. No browser cookies or social-platform credentials are read. Only actual files with recognized image/video signatures are stored; SVG files are excluded. Unsupported or blocked imports preserve the original link and offer manual attachment on the same item. Page-derived previews are marked partial because carousel completeness cannot be established. Source extractors can change upstream; update them with `npm.cmd run setup:imports`.

**Coverage status:** Verified all seven image slides of the owner's public Instagram example (`DeUFGDJE7kb`), including downloading, original order, and source-link preservation. Repaired the previously cover-only saved item without changing its notes or connections. Website carousel markup and structured galleries have regression coverage. Facebook, Pinterest, other Instagram post types, and arbitrary website gallery implementations still require representative validation; a public URL alone does not guarantee access. See the [PRD](docs/PRD.md).

## Local data and backups

On Windows, data lives in `%LOCALAPPDATA%\Gather`, outside the source checkout:

```text
Gather/
  gather.sqlite
  media/
  temporary/
```

Settings shows the resolved location. `GATHER_DATA_DIR` overrides it. `PORT` changes the default port; `GATHER_PYTHON` selects the Python executable. `GATHER_INITIAL_PASSWORD` overrides only the first-run default. No external credentials are needed for the core app.

Backups contain a consistent SQLite snapshot, all referenced media, and restore instructions. Downloads may take time for a large collection. To restore: stop Gather, preserve the current data folder, extract `gather.sqlite` and `media/` into it, and remove stale `gather.sqlite-wal`/`gather.sqlite-shm` files only while the app is stopped. Restart and use the password that was active when the backup was taken. A backup contains private data; store it privately. Files are not encrypted by the application.

If you forget your password, stop Gather and reset the local credential from a terminal using this command, then restart. It resets to `123456789` and invalidates all sessions; it does not delete your collection:

```powershell
node server/reset-password.mjs
```

Deletion is permanent and asks for confirmation. Deleting a Library item also removes its board placements and project links. Removing a placement or link preserves the item; deleting a board/project preserves Library media. Back up before removing valuable content.

AI chat, extensions, phone access, collaboration, rich drawing tools, semantic search, and automatic descriptive metadata enrichment are outside this first build.
