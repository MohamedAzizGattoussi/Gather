# Gather — Product Requirements Document

**Version:** 0.9 · **Date:** 2026-10-16  
**Status:** Owner requested implementation; first local core build implemented. See delivery status below for verification and import limits.  
**Purpose:** An actionable product blueprint and phased delivery plan for a private inspiration library.

## 1. Evidence and requirement labels

- **Confirmed:** Explicitly requested in the product brief. These define the intended product, though MVP boundaries still need approval.
- **Proposed:** A recommendation or working assumption made while preparing this document. These are not user decisions.
- **Open:** A decision that could change scope, behavior, cost, or architecture.

The workspace `D:\Code\Gather` was empty on inspection: no application, dependency manifest, or repository instructions were found. No existing stack needs to be preserved.

Reference assets were inspected at:
`C:\Users\Vaga\Downloads\stitch_gather_minimalist_inspiration_library\stitch_gather_minimalist_inspiration_library`.
The export contains six HTML/screenshot pairs and `pristine_atelier/DESIGN.md`. The Library, Boards, and quick-save screenshots were visually inspected; all HTML files were searched for relevant structure. The export is a visual reference, not a functional application or an approved specification. No separate attached moodboard screenshot was available in this conversation; the user's written description remains authoritative.

## 2. Product intent — confirmed

Gather is a private website for collecting inspiration from many sources and developing selected ideas when the owner is ready. Saving should feel easy and carry no obligation to organize or start a project.

The owner saves images, videos, reels, social posts, carousels, websites, creative tools, tutorials, motivational content, and personal ideas. Gather preserves sources where available, helps retrieve references, and provides visual and written spaces for developing ideas.

**Confirmed deployment scope:** The first version runs only on the owner's computer. Public hosting, local-network access, and access from phones or other devices are outside MVP. This supersedes the earlier phone-saving/browsing scope. Internet connectivity is still needed for automatic imports and opening external sources; local execution does not imply offline support for every feature.

**Confirmed login:** Use a single local password, initially `123456789` as requested by the owner for now. No external identity provider is required. Local password authentication is implemented in the first build.

**Proposed credential handling:** Initialize the owner credential once and persist only a password hash using an established password-hashing implementation. Do not put the password in client code or compare against a permanent plaintext constant. Application restarts must not reset a changed password to the initial value. Password-change and recovery behavior remain to be specified before implementation.

### Success criteria

1. Save without choosing a category, tag, note, board, or project.
2. Retrieve items even when they have no organization or project association.
3. Arrange selected references and multiple notes on independent moodboards.
4. Develop projects using Library references, moodboards, and notes.
5. Feel calm and in control rather than overwhelmed by a feed or management system.

**Proposed evaluation:** Walk through the acceptance scenarios in section 12 using the owner's real references. Do not introduce tracking dashboards or analytics services merely to measure these goals. Numerical performance targets depend on expected library size and devices.

## 3. Scope and release boundary

| Capability | Product requirement | Proposed release |
| --- | --- | --- |
| Private local password login and protected content | Confirmed | MVP |
| Library and quick save | Confirmed | MVP |
| Optional, editable notes, categories, tags | Confirmed | MVP |
| Search and simple filters | Confirmed | MVP |
| Boards overview and separate freeform board pages | Confirmed | MVP |
| Projects overview and separate project pages | Confirmed | MVP |
| Many-to-many item, board, and project relationships | Confirmed | MVP |
| AI discussion, generally or with project context | Confirmed vision; release open | After core MVP |
| Browser extension and automatic metadata extraction | Mentioned for later planning | Later |
| Advanced canvas tools | Mentioned for later planning | Later |
| Store images, videos, and carousel slides; retain original source link when available | Confirmed | MVP |
| Manual media uploads and automatic imports from publicly accessible Instagram, Facebook, Pinterest, and website content | Confirmed; per-source feasibility open | MVP |

### Explicit exclusions

Public profiles, public sharing, social feeds, likes, followers, gamification, dashboards, mandatory categorization, and mandatory project association are outside the requested product. Deadlines, statuses, tasks, collaboration, and project-management workflows are excluded unless separately agreed.

**Confirmed MVP boundary:** Automatic imports target publicly accessible content only. Importing private or login-required source content is outside the first version. Gather itself remains private and requires the owner's login.

**Proposed deferrals:** Offline operation, native mobile apps, semantic/vector search, media transcription, OCR, and real-time collaboration. Automatic media import from publicly accessible Instagram, Facebook, Pinterest, and website content is included in MVP scope; exact content types and feasibility require investigation.

## 4. Information architecture

Routes below are proposals, not commitments to a framework.

| Surface | Proposed route | Purpose |
| --- | --- | --- |
| Login | `/login` | Authenticate the owner |
| Library | `/library` | Default home for every saved item |
| Item detail | `/library/:itemId` or accessible detail panel | Inspect and edit one saved item |
| Boards | `/boards` | Find and create moodboards |
| Individual moodboard | `/boards/:boardId` | A dedicated freeform workspace |
| Projects | `/projects` | Find and create projects |
| Individual project | `/projects/:projectId` | Develop one idea |
| AI assistant | `/ask` and project entry point | Later general or contextual discussion |

**Confirmed:** Boards overview and board canvas are separate pages. Projects overview and project detail are separate pages. Library is central.

**Proposed:** Persistent navigation contains Library, Boards, Projects, and one Save action. Omit an inactive AI navigation item until AI exists. Use one clearly scoped search field per surface; advanced controls appear only when requested.

## 5. Library and capture

### Confirmed behavior

- Every saved reference enters the Library first, including references initially captured while working on a board or project.
- Save requires meaningful content such as a source URL, media, or personal text; organization is optional.
- Preserve the original source URL when available. Items with no source URL, such as personal ideas, remain valid.
- Store actual image files, video files, and carousel slides in Gather in the MVP, alongside the original source link when available. A source link or remote preview alone does not fulfill media preservation.
- Preserve access to stored media independently of whether its original link remains available.
- Support both manual uploads and automatic media imports from supported pasted links in MVP. This does not promise automatic downloading from every source.
- Target all four requested source families in MVP: Instagram, Facebook, Pinterest, and websites. None is implicitly deferred to a later release. This is a product requirement, not a claim that every URL or media type can be imported.
- Automatic importing is limited to publicly accessible source content in the first version; source-account login and private-post access are not required.
- A Library item can be used by multiple boards and projects without moving out of the Library.
- Support user-defined, editable categories and tags rather than a fixed catalog of interests.
- Provide search and simple filters, including ways to retrieve uncategorized items.
- Failed or unavailable social previews must not prevent saving the original link.

### Proposed MVP interaction

1. Open Save from any main page.
2. Upload media, paste a URL for automatic import where supported, or write a personal idea. Keep original source links when available, including for manual uploads.
3. Save immediately, or expand optional details for a title, note, tags, or category.
4. Show a brief saved confirmation and make the item visible in Library.
5. Offer board/project linking after saving; never make a destination choice mandatory.

A link-only item displays its domain or URL until the owner provides a title or preview. No automatic metadata extraction, AI tagging, offline caching, or working social embed is promised in the MVP. Any manually supplied preview must be distinguished from an archived original.

**Proposed media behavior:** Treat a carousel as one Library item with ordered slides, allowing image and video slides. Keep the source URL at item level. Show actual storage success or failure separately from saving the source link; never present an external preview as a preserved file. Retry failed media acquisition without discarding already saved source information.

**Confirmed capture modes:** Both manual uploads and automatic imports belong in MVP.

**Proposed import flow:** Save the source URL immediately, then import supported media without blocking capture. Show pending, importing, completed, partial, or failed state as appropriate. When importing is blocked or unsupported, preserve the link and offer manual attachment to that same Library item. A partial carousel import must identify missing slides rather than claim the full carousel was preserved. Repeated retries must not duplicate successfully stored slides.

**Scope distinction:** Automatic media acquisition is now required for supported sources. Automatic descriptive metadata extraction (titles, summaries, suggested tags) remains a later feature. Source-specific parsing needed to locate media is part of importing, not a promise of broader enrichment.

### Import coverage — confirmed source scope, feasibility unresolved

| Source family | Required planning coverage | Still to establish |
| --- | --- | --- |
| Instagram | Public images, videos/reels, and carousel slides, preserving source links | Supported public URL/content variants, permitted acquisition methods, and reliability |
| Facebook | Public images, videos/reels, and multi-media posts, preserving source links | Supported public URL/content variants, permitted acquisition methods, and reliability |
| Pinterest | Image/video pins and multi-image content where available, preserving source links | Supported URL/content variants, original versus linked destination media, and acquisition methods |
| Websites | Importable images, videos, and multi-image content, preserving source links | Direct media URLs versus page media selection, supported formats, and protected or streamed media limitations |

**Proposed discovery gate:** Evaluate representative owner-provided links from every source family before committing implementation estimates. Record a source/content support matrix, acquisition approach, and fallback for unsupported or restricted content. Automatic support for all four families is the target; a manual fallback preserves capture but does not by itself fulfill that automatic-import requirement. If any family cannot be delivered reliably, bring the specific limitation to the owner for a scope decision rather than silently dropping it. No platform capability has been verified by this PRD.

**Proposed access handling:** A source requiring login is outside automatic-import coverage even if the owner can view it while signed into that source. Preserve the submitted URL, explain the limitation, and offer manual attachment. Do not request source credentials or import browser-session cookies. Public visibility alone does not establish that a reliable acquisition method exists; validate that separately per source.

### Proposed retrieval rules

- Search item title, original URL, personal idea text, notes, category names, and tags.
- Start with one search field and a compact filter menu: content type, category, tag, and uncategorized.
- Define **uncategorized** as having no category; it is independent of tags, boards, and projects.
- Offer “Not on a board” and “Not in a project” as separate optional filters rather than one ambiguous “Unsorted” state.
- Default to newest saved first; pagination or incremental loading must remain an archive, without recommendations or engagement prompts.
- Combine text search and active filters; show how to clear them and distinguish an empty library from no matching results.
- Search matches stored text only. It cannot find words hidden in an unfetched video, image, carousel, or linked webpage.

**Open:** Precise public-content coverage and acquisition feasibility within the four confirmed source families, category multiplicity, duplicate handling, and whether initial search should also include board/project titles and notes.

## 6. Boards and freeform moodboards

### Confirmed behavior

- Boards lists moodboards; opening one navigates to its own canvas page.
- Arrange saved references spatially, add text, and write multiple independent notes.
- Allow visual clusters such as design inspiration, textures, colors, photography, typography, and vibe. These are examples, not mandatory sections or categories.
- A board may stand alone or link to multiple projects.
- Adding an item to a board does not require a project and does not remove it from Library.

### Proposed minimum canvas contract

- Create and rename a board; select Library items through an add-item picker.
- Drag reference cards and independent text notes; resize cards and notes.
- Pan, zoom, and fit content to the viewport.
- Persist positions, sizes, stacking order, and note contents across reloads.
- Display a restrained toolbar; show element controls on selection.
- Provide a non-drag alternative for moving or editing selected elements.
- Open the Library item or original source from a reference card.
- Keep board-local note text distinct from a Library item's global note. A board-local note does not automatically become a Library item.
- Use plain headings and spatial placement to form groups in MVP. Structured groups, connectors, drawing, rotation, templates, color tools, and multi-selection are deferred proposals.
- Save changes automatically with visible failure/retry feedback. Never label unsaved changes as saved.

**Confirmed device scope:** Canvas editing and all other MVP usage happen on the owner's computer. Phone saving, browsing, and editing are deferred following the local-computer-only deployment decision.

**Future phone behavior — outside MVP:** If cross-device access is added later, consider saving, browsing, and read-only board viewing before full phone canvas editing. This is not a current delivery requirement.

**Open:** Undo scope; whether repeated placements of the same item are needed.

## 7. Projects

### Confirmed behavior

- Projects overview lists projects and opens a separate project page.
- Each project supports a title, description, and notes.
- Associate Library items directly with a project, independently of any board.
- Associate one or more boards with a project. A board can serve multiple projects.
- No required status, deadline, or task list.

### Proposed page structure

A title and optional description lead the page, followed by a simple notes area, linked boards, and directly linked references. Less-used actions live in a menu. Start with plain text notes; rich formatting is a separate decision.

**Proposed relationship rule:** A board's contents do not automatically become direct project items. The project can show them through the linked board, clearly distinguished from direct references. Unlinking a board preserves that board and all its contents.

## 8. AI assistant — confirmed vision, proposed later release

- Allow general discussion and discussion with a project's relevant references and notes.
- Help explore ideas, identify themes, connect references, and suggest directions.
- Suggestions do not modify items, notes, boards, or projects until the owner explicitly chooses to keep them.

**Proposed later behavior:** Show which project and references are included before sending context. Cite saved items through links back to Gather. Clearly distinguish stored text from media the model has actually inspected. Offer an explicit Keep action for saving an answer as a note or idea.

**Open before AI delivery:** Provider/model, cost limit, data retention and transmission preferences, conversation persistence/deletion, supported media analysis, and exact context selection. Project context must not silently mean the entire private Library. No AI provider is chosen by this PRD.

## 9. Conceptual data model and lifecycle

This is a proposed model for planning, not a database schema commitment.

| Entity | Core information and relationships |
| --- | --- |
| Owner | Account identity; ownership enforced throughout |
| Library item | ID, owner, optional title/source URL, content kind, optional personal text/note, timestamps |
| Media asset | Parent Library item, private storage reference, MIME type, byte size, optional source attribution, acquisition state |
| Carousel slide | Parent Library item, media asset reference, explicit order; one carousel contains multiple slides |
| Category / tag | Owner-defined names; optional item associations |
| Board | ID, owner, title, timestamps |
| Board element | Board ID, item reference OR local text, position, dimensions, stacking order |
| Project | ID, owner, title, description, notes, timestamps |
| Project item | Independent project-to-item association |
| Project board | Independent project-to-board association |
| Conversation / message | Later; optional project context and explicit saved-output references |

**Confirmed invariants:** Items remain in Library when referenced elsewhere. Board and project membership are independent. Boards and projects have a many-to-many relationship.

**Proposed lifecycle rules:**

- Removing a reference from a board removes only that placement.
- Removing a direct reference from a project removes only that association.
- Deleting a board removes its elements and project links, preserving Library items and projects.
- Deleting a project removes its notes and associations, preserving boards and Library items.
- Deleting a Library item is a distinct destructive action that explains its board/project impact before confirmation; exact trash/restore behavior remains open.
- Edits to a shared item's global fields appear wherever that item is referenced. Board placement and local notes stay local.
- Ownership checks apply to relationships as well as individual records; client-provided IDs are never sufficient authorization.

## 10. Design and quality requirements

### Confirmed visual direction

Minimalist, Apple-like, mostly neutral colors, whitespace, concise labels, and few visible controls. Use progressive disclosure. Avoid dense filter bars, duplicate search fields, excessive card metadata, and management-heavy layouts.

### Applying the Stitch reference

Keep its quiet neutral surfaces, image-led references, clear primary navigation, and restrained typography as inspiration. Simplify these observed details:

- Library has a global search and a second page search: use one.
- Boards combines a gallery and a large canvas: separate them into overview and board page.
- Save exposes preview metadata, notes, AI tags, destination, and offline-cache claims: keep immediate capture primary and reveal optional organization on demand.
- Do not inherit sample names, sample content, notification controls, AI features, or design tokens as approved requirements.

### Proposed quality baseline

- Keyboard-operable navigation and forms, visible focus, accessible labels, readable contrast, and reduced-motion support.
- Support usable desktop browser layouts on the owner's computer, including keyboard and pointer canvas authoring. Phone and tablet access are outside MVP; exact desktop browser support remains open.
- Clear loading, empty, not-found, expired-session, failed-save, and failed-upload states where applicable.
- No autoplaying video or unsolicited sound. Broken links retain their stored URL and user notes.
- Protect all private pages, APIs, search results, and stored media. Avoid private content in public caches, logs, or public asset URLs.
- Use secure session handling and server-side input validation; keep credentials and provider secrets on the server.
- Define backup and restore before real use. A private personal collection must survive an application update or storage failure; backup must cover both records and media.
- Agree media file types, size limits, storage budget, per-source import coverage, and failure recovery before implementation. Stored images, videos, and carousel slides must remain private and be included in backup/restore planning.
- Automatic imports must restrict network destinations and redirects to prevent fetching private/internal services; enforce download size, MIME, and timeout limits. Save URLs without requiring a successful fetch.
- **Proposed architecture:** Run public-content imports as bounded server-side background work, with owner-authorized status and retry operations. Never expose server credentials or require the owner to provide social-platform passwords. Automatic acquisition of login-required sources is excluded from MVP.

**Open:** Expected item count, typical video size, desktop browser support, budget, backup retention, export needs, and acceptable performance targets. Comprehensive offline support and simultaneous editing are not assumed.

## 11. Technical recommendation — proposed, not selected

Use one local application with server-side authorization and persistent storage on the owner's computer. Proposed launch model: start a local service and open Gather in the desktop browser. Bind to loopback only; do not expose it on the local network or internet. Packaging and startup experience remain open. Avoid separate services until a concrete need appears.

| Layer | Initial recommendation | Tradeoff / decision |
| --- | --- | --- |
| Application | Implemented: TypeScript + React + Vite frontend and Express local Node server | Replaced the initial Next.js proposal with a smaller browser/server setup suited to local-only use. No separate cloud backend is required. |
| Database | Implemented: SQLite through Node.js 24's built-in SQLite module | Local single-owner persistence without a database service. Backup uses a consistent SQLite snapshot plus media files. |
| Canvas | DOM-based positioned elements for the limited MVP; evaluate a canvas library if richer drawing is approved | DOM keeps text editing and accessibility straightforward; interaction code still needs care. A graphics library adds rendering tools but complicates native editing and accessible equivalents. |
| Media | Local private media directory outside the source checkout; manual upload flow plus import adapters for the four source families | Database stores asset references, carousel order, and import state. Disk capacity, file permissions, backups, and import feasibility need decisions. No cloud media storage is required for MVP. |
| Authentication | Confirmed single local password, initially `123456789`; use an established server-side authentication/password-hashing implementation | No external identity provider needed. Implementation library, session handling, password change, and recovery remain open. Application login does not by itself encrypt files on disk. |
| Hosting | Run on the owner's computer only; no hosting provider for MVP | Computer must be running to use Gather. No cross-device sync or remote access; owner manages local storage and backups. |
| AI | Server-side provider integration after MVP | Adds external data processing and ongoing cost; provider choice stays open. |

Recommendation rationale is architectural judgment, not a requirement from the owner. Do not install dependencies or select providers based solely on this table.

**Implementation authorization:** The owner subsequently requested “just start building the website.” The local stack above was selected and announced as an implementation choice under that authorization. Original unconfirmed proposals elsewhere in this PRD remain proposals.

Technical references checked while drafting:

- [Next.js App Router](https://nextjs.org/docs/app) and [server/client composition](https://nextjs.org/docs/app/getting-started/server-and-client-components).
- [PostgreSQL full-text search](https://www.postgresql.org/docs/current/textsearch.html).
- [Appropriate uses for SQLite](https://www.sqlite.org/whentouse.html) and [consistent database backups](https://www.sqlite.org/backup.html), checked after the local-only deployment decision. SQLite is a recommendation, not an approved stack choice.
- [Konva React integration](https://konvajs.org/docs/react/index.html), an alternative to evaluate if a graphics canvas is justified.

## 12. MVP acceptance scenarios

These are proposed release checks derived from confirmed requirements; they are not tests that have been executed.

| ID | Scenario | Expected outcome |
| --- | --- | --- |
| A1 | Save a social URL with no optional fields and no available preview | Item exists in Library with its original URL; no organization required |
| A2 | Save a personal idea without a URL | Searchable Library item preserves its text |
| A3 | Search for an unclassified, unlinked item by stored title, note, or URL | Matching item is found regardless of relationships |
| A4 | Create, rename, and remove a category/tag association | Organization changes without deleting the underlying item |
| A5 | Add one item to a board and directly to a different project | Both associations work independently; Library item remains |
| A6 | Place references and multiple text notes on a board, then reopen it | Saved content and spatial layout are preserved |
| A7 | Open Boards and then a board | Overview lists boards; dedicated page shows that board's canvas |
| A8 | Link one board to two projects, then unlink it from one | Other link, board contents, and Library references remain |
| A9 | Create a project with description, notes, direct items, and boards | No deadline, status, or task list required |
| A10 | Remove a board placement or project association | Original item remains in Library and other associations remain |
| A11 | Access a private page/API/media URL while signed out | Access is denied; content is not disclosed |
| A12 | A save fails or a session expires while editing | Clear feedback; no false success; retry path preserves input where feasible |
| A13 | Use keyboard and reduced motion; review screens with real references | Essential controls remain usable; calm layout meets the owner's approval |
| A14 | Save an image or video with its original source URL | Actual media and source URL persist; media is accessible after reloading |
| A15 | Save and reopen a carousel with its source URL | All supplied slides persist in order under one Library item; original URL remains accessible |
| A16 | An original source becomes unavailable after its media was stored | Stored media and owner notes remain accessible in Gather |
| A17 | Media acquisition fails after the source link is saved | Failure is visible; the link remains saved; no false claim that media was preserved |
| A18 | Upload image/video files or ordered carousel slides manually | Media persists privately; owner can attach the original source URL when available |
| A19 | Paste a media URL from an agreed supported source | Gather imports actual media and preserves the original URL, with visible progress and outcome |
| A20 | Import is unsupported, blocked, or partially successful | Saved URL remains accessible; manual attachment is offered on the same item; missing carousel slides are identified |
| A21 | Exercise the agreed import support matrix for Instagram, Facebook, Pinterest, and websites | Each family has automatic-import acceptance examples; source URLs and actual media persist. Any reduced coverage is explicitly approved, not counted as delivered solely through manual upload |
| A22 | Submit a private or login-required source URL | Gather retains the link, explains that automatic importing covers public content only, and offers manual attachment without requesting source-account credentials |
| A23 | Launch Gather on the owner's computer and save/browse references | Application is available through the local browser; service listens only on loopback, with no LAN or public access required |
| A24 | Open a moodboard on a computer | Keyboard/pointer canvas editing, text notes, and layout persistence are available; phone editing is not a release requirement |
| A25 | On initial setup, enter the owner-requested temporary password | `123456789` opens the local application; an incorrect password does not grant access to private pages, APIs, or media |

Refine source-specific import acceptance cases after initial source support is agreed. Add deletion/restore, backup/restore, and AI cases once their behavior is agreed. All phone access is deferred.

## 13. Phased delivery plan

This is a product roadmap, not a file-by-file implementation plan. Dates and estimates would be speculative before the open scope and deployment decisions are resolved.

| Phase | Deliverables | Exit condition / dependency |
| --- | --- | --- |
| 0 — Agree the blueprint | Investigate public-content import feasibility across all four source families; resolve browser, local startup, credential lifecycle, and organization questions; approve MVP and stack | Accepted PRD, explicit technical choices, and agreed public-content import support matrix |
| 1 — Private foundation | Local application shell, owner login, persistence, authorization, loopback-only startup and backup approach | Owner can sign in locally; signed-out requests cannot access private records; no LAN/public exposure |
| 2 — Capture and retrieval | Quick save, Library, item detail, optional organization, search/filtering, private image/video storage, ordered carousel slides, original links, manual uploads, and public-content automatic imports across all four source families | Real references can be saved and retrieved without organizing them; A1–A4, A14–A22, and related privacy checks |
| 3 — Visual workspace | Boards overview, dedicated computer-editable canvas, references, multiple notes, persisted layout | A5–A7, A23–A24, and removal behavior work |
| 4 — Idea development | Projects overview/details, notes, direct item links, shared board links | A8–A10 work without management fields |
| 5 — First usable release | Responsive/accessibility review, failure handling, private media checks, backup restoration, owner walkthrough | Applicable acceptance scenarios pass and owner approves the calm core experience |
| 6 — Optional expansion | AI discovery and chat; later extension, metadata extraction, advanced canvas tools | Each addition gets its own agreed scope and privacy/cost decisions |

After PRD approval, prepare an implementation plan with actual file paths, migrations, task dependencies, and validation commands for the selected stack. No product code is included in this planning deliverable.

## 14. Assumptions and open decisions

### Working assumptions — proposals only

- One owner account; no public registration or collaboration.
- Local application on the owner's computer; network-dependent imports require internet. Comprehensive offline behavior is not yet specified.
- AI follows the core MVP.
- Plain text editing initially; avoid a document editor unless required.
- A social link is always saveable. Both manual uploads and supported-source automatic imports are required; automatic acquisition from every social platform is not assumed.
- Core board authoring uses a small set of spatial operations, not a full drawing suite.

### Decisions to resolve one at a time

| Priority | Question | Why it matters |
| --- | --- | --- |
| 1 | How should changing or recovering the local password work? | Local password login and the initial value are confirmed; credential lifecycle must not reset the password on every launch. |
| 2 | How should Gather be launched on the computer? | Determines whether a browser plus local launcher is sufficient or desktop packaging is needed. |
| 3 | What budget and maintenance effort are acceptable for importing and backups? | Local hosting removes a hosting-provider decision, but import integrations and backup storage may still have costs. |
| 6 | Can an item belong to multiple categories, and how should categories differ from tags? | Avoids overlapping controls and determines organization relationships |
| 7 | Should duplicate URLs create another item or offer the existing item? | Changes capture behavior and reference identity |
| 8 | Should deleting an item move it to recoverable trash, and for how long? | Determines destructive behavior, reference cleanup, and asset retention |
| 9 | Approximately how many saved items and how much video content are expected? | Establishes storage sizing and useful performance acceptance targets |
| 10 | Are data export, rich notes, or literal canvas groups essential at launch? | Identifies hidden MVP scope before implementation |
| 11 | After using the core flows, is AI necessary for the first release? | Confirms roadmap order and additional data-processing requirements |

### Decision log

- **2026-10-16 — Confirmed by owner:** MVP must store images, videos, and carousel slides and also keep the original link when available. Link-only storage is insufficient for media preservation.
- **2026-10-16 — Confirmed by owner:** MVP must offer both manual uploads and automatic imports from supported pasted links.
- **2026-10-16 — Confirmed by owner:** Automatic import scope includes Instagram, Facebook, Pinterest, and websites, all in MVP. Exact content support remains open pending feasibility investigation.
- **2026-10-16 — Confirmed by owner:** First-version automatic imports cover publicly accessible source content only. Private or login-required source importing is excluded; Gather's own content remains private.
- **2026-10-16 — Confirmed by owner:** Canvas editing happens on a computer for now. Phones focus on saving and browsing; full phone canvas editing is deferred beyond MVP.
- **2026-10-16 — Confirmed by owner:** Gather runs only on the owner's computer for the first version. This supersedes earlier phone saving/browsing scope: all phone and LAN/remote access are deferred. Local storage and SQLite are recommendations, not approved implementation choices.
- **2026-10-16 — Confirmed by owner:** Use a single local password with temporary initial value `123456789`. This is a planning decision; no login has been implemented.
- No stack, import provider, authentication implementation, media limits, or other unresolved product behaviors have been approved. Deployment scope and local password login are confirmed. Update this document as answers arrive; do not silently convert proposals into confirmed requirements.

## 15. First implementation delivery

The owner declined a desktop shortcut and requested that building begin. A local browser application is now implemented with React, TypeScript, Vite, Express, Node.js 24 SQLite, and local media storage. Run with `npm start` and open `http://127.0.0.1:4317`; no shortcut or public deployment is created. Detailed run and backup instructions are in `README.md`.

### Implemented core

- Local password login, hashed credentials, persistent sessions, lock action, and password change/reset.
- Library: URL/thought capture, manual image/video upload, ordered carousel slides, source links, item editing, freeform optional category, multiple tags, search, filters, and deletion with confirmation.
- Separate Boards overview and dedicated freeform canvas: Library references, independent notes, dragging, resizing, note colors, pan/zoom/fit, keyboard movement, autosave, and revision conflict detection.
- Separate Projects overview and detail pages: description, notes, direct Library links, and shared board associations without task-management fields.
- Full database/media ZIP backup with restore instructions; local data stored outside the source checkout.

### Import implementation and remaining coverage work

- Implemented manual uploads and queued public-link imports.
- Instagram, Facebook, and Pinterest adapters use gallery-dl/yt-dlp to resolve media, without browser cookies or social-account passwords. Generic websites support direct media, page-declared media, and article/main images.
- Imported files are signature-validated and stored locally. Saved links survive blocked, failed, or partial acquisition. Users can attach missing files and reorder carousel slides.
- Verified a live public direct-image import, including stored media and preserved source URL.
- Representative Instagram, Facebook, and Pinterest public post/reel/carousel coverage remains unverified without example links. These adapters are implemented, but this does not establish full satisfaction of A21. Public platforms may block unauthenticated fetching; do not count manual fallback as automatic-import coverage.

### Verification and limits

- Production TypeScript/Vite build passed.
- 27 isolated API integration assertions passed: login/privacy, media uploads and range delivery, slide order, signature validation, board persistence/conflicts, shared relationships, project notes, destructive cleanup, origin rejection, backups, and session invalidation.
- Browser visual inspection was unavailable because the session has no enabled browser surface. Interface appearance and interactive pointer behavior need a real-browser walkthrough.
- AI remains outside the first build. No cloud hosting, phone access, extension, or desktop shortcut was added.
- Builder choices: one freeform category per item, duplicate URLs allowed as separate references, explicit Save for project notes, permanent deletion after confirmation, 150 MB per file and 40 files per upload. These choices are reviewable defaults rather than newly confirmed owner requirements.

### Carousel import and preview correction

- Confirmed owner expectation: an imported carousel displays all slides in a slider, not only a cover image, for Instagram and other supported website galleries.
- Fixed image-only Instagram extraction: retain original image candidates for each slide before video-format processing can discard them. Preserve mixed media order and count incomplete extraction as partial.
- Website discovery now prefers explicit carousel/gallery markup and structured image collections over a single Open Graph cover, including lazy-loaded image sources and full-size srcset candidates.
- Library previews now have slide arrows, a counter, and direct slide controls. Detail previews have arrows, keyboard navigation, a counter, and a thumbnail strip. Images fit within the preview without cropping their content.
- Stable source slide identifiers prevent duplicate slides when retrying signed CDN URLs. A successful complete import replaces obsolete imported covers while preserving manual attachments; partial imports retain previously saved assets.
- Verified live import of all seven image slides from the owner's `DeUFGDJE7kb` Instagram example. Updated the existing saved item to seven ordered slides, preserving its title, source link, notes, organization, and board/project links. A private full backup was saved locally before the update.
- This verifies that example; it does not establish automatic support for every website's carousel or every social source/content variant.

## 16. Hosting direction — subsequent owner decisions

- The owner now wants a hosted version for personal use only, superseding local-only deployment as the intended next release. The current local collection remains available during preparation.
- Supabase project: `https://jqicbztaipuaytcndfdl.supabase.co`. Supabase is selected for PostgreSQL, private media Storage, and hosted authentication. The website/API/Python importer still need a separate app host; none is selected or deployed.
- Only `medazizgatt@gmail.com` may sign in to hosted Gather. The app user's UUID must also be assigned in the database's singleton owner table. Public signup must be disabled in the dashboard.
- Hosted login uses the owner's separately chosen Supabase application password. The temporary local password is not migrated or enabled as a hosted credential.
- Integration code, access policies, schema migrations, a container definition, and local-to-cloud migration tooling are prepared. The publishable key was verified using a read-only Auth settings request; it cannot apply schema changes or create an administrator-configured app user.
- No remote schema changes, user creation, media uploads, or collection migration have been performed. These depend on the dashboard setup in `docs/SUPABASE.md`.
- Cloud file size defaults to 50 MB and must fit the project's Storage limits. Raising it requires updating both the bucket settings and application configuration. Local file limits remain unchanged.

### Vercel deployment preparation

- The owner selected Vercel as the application host. Supabase remains the database, authentication, and private media provider.
- Prepared static frontend routing, Node and Python functions, direct signed/resumable uploads, private media redirects, browser-streamed backups, and database-backed import leases.
- Existing Supabase projects must apply migration 202610160002_vercel.sql. Deployment instructions are in docs/VERCEL.md.
- No public deployment or authenticated collection migration is claimed. Local data remains available separately.
