/**
 * Server half of dsh-composer-extras: registers the `/clear-context` human
 * command (visible in the composer's "+" command menu next to the built-in
 * `/compact`) and the `/composer-extras/api/compact` route.
 *
 * `/clear-context` delegates to the built-in `/compact` through
 * `ctx.commands.execute(invocation.agent, '/compact', …)` — this is NOT a true
 * wipe-to-empty: DSH has no exposed API for that in this version. compactNow
 * always targets retainTokens: 0 internally (see selectCompactableRange call in
 * dsh-compaction-basic), i.e. "shrink as much as possible via summary",
 * identical to what manual /compact does. The name and description are upfront
 * about this so it doesn't read as a literal history wipe.
 *
 * `compaction` is deliberately NOT in the static `inject` list, and it is not
 * read with `ctx.get('compaction')` either (2026-10-07): the service is
 * isolated INSIDE the `standard` agent preset (`isolate: {compaction: true}`
 * in dsh-web-app/presets/standard.patch.yml), so from this profile-level
 * plugin it simply does not exist. The earlier `ctx.get('compaction')` read
 * therefore always returned undefined and `/clear-context` always answered
 * "Compaction is disabled in this profile" — even though /compact worked fine.
 * A hard `inject: ['commands', 'compaction']` is worse still: it makes this
 * entry wait forever for a service that never activates at this level, which
 * failed the ENTIRE profile boot ("dsh: 1 entry did not activate:
 * composer-extras: pending"). `ctx.commands.execute` is the seam that works:
 * it runs the command in the receiving agent's realm, where both /compact and
 * its `compaction` service are visible.
 *
 * Also registers `/restart-dsh`: kills and relaunches the whole dsh process.
 * NEMA više sopstvene logike restarta — jedina implementacija je skript
 * `~/.dsh/skills/restart-dsh/restart-dsh.sh`, koji poziva i istoimeni skill.
 * Komanda ga pokrene detaširano sa `--delay 2 --quiet`, pa se sama ugasi;
 * skript onda ubije stari proces, sačeka da OS oslobodi port 3081 i podigne
 * `~/.local/bin/dsh-termux` (koji pri bootu ponovo primenjuje Android zakrpe).
 * Bez skripte bi ostao samo `pkill` bez relanča — dsh bi ostao dole.
 *
 * Also registers `/composer-extras/api/debug-provider-check` (`GET
 * ?provider=&model=` -> whatever `ctx.llm.resolveModelInfo()` returns, or the
 * resolution error verbatim): confirms a settings.yaml `llm-pi-ai.providers`
 * edit actually took effect without opening a browser session and reading a
 * picker dropdown. Only catalog metadata, never a credential value, so it
 * stays behind the plain loopback fence like everything else here.
 *
 * Also registers `/composer-extras/api/fs-tree-unrestricted`: a POST route
 * mirroring dsh-better-sidebar's `/sidebar/api/fs.tree` response shape
 * (`{path, entries: [{name, path, isDir}], truncated}`) but WITHOUT
 * dsh-better-sidebar's `ensureWorkspacePath` boundary check
 * (`assertWithinWorkspace` in its `path-security.ts`) — user explicitly
 * asked for the composer's file picker to be able to browse outside the
 * session workspace, understanding this widens what the browser UI can read
 * off disk. Deliberately not importing dsh-better-sidebar's internals
 * (its package.json `exports` map doesn't publish `fs-tree`/`wire` as a
 * stable API to depend on) — this reimplements the same tiny shape directly
 * against `node:fs/promises`. Kept behind the same loopback-only fence
 * dsh-better-sidebar uses for its own `/sidebar/api` routes, since removing
 * the workspace boundary is the deliberate part, not opening the port to
 * the network.
 *
 * Also registers the two routes the composer's paperclip picker uses to get
 * a phone-side file into the workspace directory, and one to preview it:
 *
 * - `/composer-extras/api/upload-to-workspace` (`{sessionId, filename,
 *   contentBase64, targetDir?} -> {path}`): binary-safe write into
 *   `targetDir` — wherever the picker is currently browsing, not a fixed
 *   subfolder (defaults to the workspace root if omitted). Every
 *   attachment — image or not, regardless of the active model — goes
 *   through this same path into the directory, then gets explicitly picked
 *   and confirmed from the tree like any other file (see client.js's module
 *   header for why this replaced an earlier two-path design). Cannot reuse
 *   dsh-better-sidebar's `fs.write` for this: it writes `content` as utf8
 *   text (`writeFile(tmp, content, 'utf8')` in its src/index.ts), which
 *   would corrupt binary image bytes. `targetDir` is still checked against
 *   the session's cwd (`ensureWithinCwd`) — a client-chosen destination
 *   folder is fine, escaping the workspace entirely is not, mirroring the
 *   intent (not the code, per the export-map note above) of
 *   dsh-better-sidebar's `assertWithinWorkspace`.
 * - `/composer-extras/api/mkdir-in-workspace` (`{sessionId, name,
 *   targetDir?} -> {path}`): same boundary check, creates a subfolder where
 *   the picker is currently browsing — the picker's "new folder" button.
 * - `/composer-extras/api/image-preview` (`GET ?path=...` -> raw image
 *   bytes with a Content-Type header): thumbnail source for an `<img>` tag
 *   in the picker, so the user can see which image they're about to select
 *   instead of picking blind by filename. GET with a query string, not the
 *   POST+JSON envelope the other routes use, because that's what `<img
 *   src>` actually sends — `ctx.webServer`'s route matching is on
 *   `pathname` alone (confirmed in dsh-host-webserver/lib/index.js), so the
 *   query string doesn't need special handling to route correctly.
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { appendFile, copyFile, lstat, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path, { basename, extname, isAbsolute, join, resolve, sep } from 'node:path'

const name = 'composer-extras'
const inject = ['commands', 'webServer']

/**
 * Register `/clear-context` and `/restart-dsh`.
 * @param ctx - server context carrying the command registry and compaction seam.
 */
function apply(ctx) {
  const active = new Set()
  const track = (fn) => (invocation) => {
    const operation = fn(ctx, invocation)
    active.add(operation)
    const retire = () => { active.delete(operation) }
    operation.then(retire, retire)
    return operation
  }
  ctx.effect(function* () {
    yield async () => { await Promise.allSettled(active) }
    yield ctx.commands.register({
      name: 'clear-context',
      description: 'Compact conversation to minimum (like /clear) — summarizes and shrinks history, does not erase it',
      handler: track(executeClear),
    })
    yield ctx.commands.register({
      name: 'restart-dsh',
      description: 'Restart the dsh server itself (kills and relaunches via the Termux wrapper) — unified restart-dsh command',
      handler: track(executeRestart),
    })
  }, 'composer-extras: command lifecycle')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/composer-extras/api/debug-provider-check',
    handler: (req, res) => handleDebugProviderCheck(ctx, req, res),
  }), 'composer-extras: /composer-extras/api/debug-provider-check route (diagnostic — GET ?provider=&model=)')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/composer-extras/api/fs-tree-unrestricted',
    handler: handleFsTreeUnrestricted,
  }), 'composer-extras: /composer-extras/api/fs-tree-unrestricted route (deliberately unrestricted, user-approved)')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/composer-extras/api/fs-tree-workspace',
    handler: (req, res) => handleFsTreeWorkspace(ctx, req, res),
  }), 'composer-extras: /composer-extras/api/fs-tree-workspace route (mtime-bearing replacement for sidebar fs.tree)')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/composer-extras/api/session-cwd',
    handler: (req, res) => handleSessionCwd(ctx, req, res),
  }), 'composer-extras: /composer-extras/api/session-cwd route (standalone replacement for sidebar session.cwd)')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/composer-extras/api/diag',
    handler: (req, res) => handleDiag(req, res),
  }), 'composer-extras: /composer-extras/api/diag route (client diagnostics -> ~/dsh/composer-diag.log)')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/composer-extras/api/upload-to-workspace',
    handler: (req, res) => handleUploadToWorkspace(ctx, req, res),
  }), 'composer-extras: /composer-extras/api/upload-to-workspace route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/composer-extras/api/mkdir-in-workspace',
    handler: (req, res) => handleMkdirInWorkspace(ctx, req, res),
  }), 'composer-extras: /composer-extras/api/mkdir-in-workspace route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/composer-extras/api/delete-in-workspace',
    handler: (req, res) => handleDeleteInWorkspace(ctx, req, res),
  }), 'composer-extras: /composer-extras/api/delete-in-workspace route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/composer-extras/api/rename-in-workspace',
    handler: (req, res) => handleRenameInWorkspace(ctx, req, res),
  }), 'composer-extras: /composer-extras/api/rename-in-workspace route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/composer-extras/api/image-preview',
    handler: handleImagePreview,
  }), 'composer-extras: /composer-extras/api/image-preview route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/composer-extras/api/android-share',
    handler: handleAndroidShare,
  }), 'composer-extras: /composer-extras/api/android-share route (Android share sheet za otvoreni fajl)')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/composer-extras/api/delete-paths',
    handler: handleDeletePaths,
  }), 'composer-extras: /composer-extras/api/delete-paths route (multi-delete, trazi confirm:true)')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/composer-extras/api/android-folder',
    handler: handleAndroidFolder,
  }), 'composer-extras: /composer-extras/api/android-folder route (roditeljski folder u Solid Exploreru)')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/composer-extras/api/branch-session',
    handler: (req, res) => handleBranchSession(ctx, req, res),
  }), 'composer-extras: /composer-extras/api/branch-session route (nova prazna sesija u istom workspace-u + prosledjen prompt)')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/composer-extras/api/branch-info',
    handler: handleBranchInfo,
  }), 'composer-extras: /composer-extras/api/branch-info route (da li je sesija smart-branched)')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/composer-extras/api/prompt-session',
    handler: (req, res) => handlePromptSession(ctx, req, res),
  }), 'composer-extras: /composer-extras/api/prompt-session route (prompt u POSTOJECU sesiju — npr. „try again")')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/composer-extras/api/compact',
    handler: (req, res) => handleCompactSession(ctx, req, res),
  }), 'composer-extras: /composer-extras/api/compact route (kompakcija na zahtev + pravi ishod)')
}

/**
 * GET ?sessionId=… → je li ta sesija branchovana sa smart startom.
 *
 * Klijentski `gemini-seek-smart` je per-session i po defaultu se pali samo ako
 * globalni localStorage default nije isključen; branch rutu to ne zanima, pa
 * bez ove provere indikator ostane „disabled" iako je model za prvi prompt
 * Gemini. Odgovor: `{smart, model}`.
 */
async function handleBranchInfo(req, res) {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
    return
  }
  if (req.method !== 'GET') {
    writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
    return
  }
  try {
    const url = new URL(req.url ?? '/', 'http://internal')
    const sessionId = url.searchParams.get('sessionId')
    if (!sessionId) {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing "sessionId" query param' } })
      return
    }
    writeJson(res, 200, {
      ok: true,
      value: {
        smart: BRANCH_SMART_SESSIONS.has(sessionId),
        model: BRANCH_SMART_SESSIONS.get(sessionId) ?? null,
      },
    })
  } catch (error) {
    writeJson(res, 400, { ok: false, error: { code: 'branch-info-error', message: error instanceof Error ? error.message : String(error) } })
  }
}

/** Diagnostic: does ctx.llm actually resolve a {provider, model} pair right now?
 * GET ?provider=&model= -> raw resolveModelInfo() result or the resolution error,
 * verbatim — this exists to confirm a settings.yaml provider edit (e.g. a second
 * Gemini key) actually registered, without having to open a real browser session
 * and read a picker dropdown. Not gated behind anything beyond the usual
 * loopback fence; it only reads catalog metadata, never a credential value. */
async function handleDebugProviderCheck(ctx, req, res) {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
    return
  }
  try {
    const url = new URL(req.url ?? '/', 'http://internal')
    const provider = url.searchParams.get('provider')
    const model = url.searchParams.get('model')
    if (!provider || !model) {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing "provider" or "model" query param' } })
      return
    }
    const llm = ctx.get('llm')
    if (llm === undefined) {
      writeJson(res, 200, { ok: true, value: { resolved: false, reason: 'llm-service-unavailable' } })
      return
    }
    const info = await llm.resolveModelInfo(provider, model)
    writeJson(res, 200, { ok: true, value: { resolved: true, info } })
  } catch (error) {
    writeJson(res, 200, { ok: true, value: { resolved: false, reason: error instanceof Error ? error.message : String(error) } })
  }
}

/** Loopback-only fence, same intent as dsh-better-sidebar's own /sidebar/api fence. */
function isLoopbackRequest(req) {
  const host = (req.headers && req.headers.host) || ''
  const hostname = host.split(':')[0]
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

/** Bounded JSON body reader (no dsh-better-sidebar import — its wire helpers aren't a published API). */
async function readJsonBody(req, maxBytes) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) throw Object.assign(new Error('request body too large'), { status: 413 })
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('malformed JSON body'), { status: 400 })
  }
}

function writeJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': String(data.length) })
  res.end(data)
}

/* ── Android most: „Podeli" i „Folder" za otvoreni fajl ──────────────────────
 * Browser ne može da pozove Android intent, a `termux-share`/`am start` žive na
 * Termux strani — zato ova dva loopback-only POST-a. Pozivaju se iz
 * dsh-client-ui-sidebar-documentpreview slotova
 * (`sidebar.right.tab.document.actions` / `.unpreviewable`), čiji slot-props
 * nose `{ absolutePath }`.
 *
 * Izmereno na uređaju (2026-09-29):
 *  - `termux-share` RADI i za Termux privatne putanje (sam kopira fajl tamo gde
 *    primalac sme da čita) → `-a view` za video/sliku, `-a send` za ostalo.
 *  - Solid Explorer NE može da browse-uje `/data/data/com.termux/...`; ako mu se
 *    takva putanja pošalje, otvori se ali sleti na Download. Zato se privatni
 *    fajl prvo stage-uje u `SHARE_STAGE_DIR` (deljeni storage) i otvara se taj
 *    folder. Isto važi i za nepostojeću putanju (dijalog „Requested directory was
 *    not found"), pa se pre poziva uradi `stat`.
 */
const ANDROID_MIME_BY_EXT = {
  '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.7z': 'application/x-7z-compressed',
  '.gz': 'application/gzip', '.tar': 'application/x-tar', '.srt': 'application/x-subrip',
  '.txt': 'text/plain', '.md': 'text/plain', '.json': 'application/json', '.csv': 'text/csv',
}

/** Deljeni staging dir: jedino mesto odakle Solid Explorer može da čita. */
const SHARE_STAGE_DIR = '/storage/emulated/0/Download/dsh-share'
/** Slike idu u Pictures/dsh — tamo ih galerija (i Photos biblioteka) vidi posle `termux-media-scan`. */
const PICTURES_STAGE_DIR = '/storage/emulated/0/Pictures/dsh'

/**
 * Branched sesije startovane „smart" (prvi prompt na Gemini), po sessionId.
 *
 * Klijent ovo čita preko `GET /composer-extras/api/branch-info` da za TU sesiju
 * uključi i svoj `gemini-seek-smart` režim i 😎 indikator. Bez toga bi model za
 * prvi prompt bio Gemini (server ga izabere), ali bi klijentski schedule/hook
 * ostali isključeni — indikator „disabled", a sesija bi posle prvog prompta
 * nastavila na DeepSeek-u umesto po smart rasporedu.
 *
 * In-memory: posle restarta servera se mapa isprazni, ali klijent tada već ima
 * trajnu localStorage oznaku po sesiji (`composer-extras-gemini-seek-on-<id>`).
 */
const BRANCH_SMART_SESSIONS = new Map()

function androidMimeOf(target) {
  const ext = extname(target).toLowerCase()
  return ANDROID_MIME_BY_EXT[ext] ?? IMAGE_MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

/** Jedna komanda sa argv vektorom — nikad shell string (putanja je korisnički podatak). */
function runArgv(command, args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: String(error && error.message) })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* already gone */ }
      finish({ code: -1, stdout, stderr: `${stderr}\n(timeout posle ${timeoutMs}ms)` })
    }, timeoutMs)
    if (child.stdout) child.stdout.on('data', (chunk) => { stdout += chunk })
    if (child.stderr) child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => finish({ code: -1, stdout, stderr: `${stderr}\n${String(error && error.message)}` }))
    child.on('close', (code) => finish({ code: code ?? -1, stdout, stderr }))
  })
}

/** Zajednički ulaz za Android/FS rute: loopback + POST + parsiran JSON body.
 * Vraća `undefined` kada je odgovor već poslat (403/405). */
async function androidBody(req, res) {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
    return undefined
  }
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
    return undefined
  }
  return await readJsonBody(req, 1 << 16)
}

/** Isto, plus validna apsolutna `path` u telu — koristi ga većina ruta. */
async function androidTarget(req, res) {
  const payload = await androidBody(req, res)
  if (payload === undefined) return undefined
  const target = payload && typeof payload.path === 'string' ? payload.path : undefined
  if (target === undefined || target === '' || !isAbsolute(target)) {
    writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing or invalid "path" (must be a non-empty absolute path)' } })
    return undefined
  }
  return { target, payload }
}

/** POST {path, action?} → termux-open (Android prikaz/share sheet; VLC za video itd.).
 *
 * `termux-open`, ne `termux-share`: izmereno 2026-09-29 da `termux-share -a send`
 * za `.zip` ode pravo u Solid Explorer (default handler za taj tip), chooser se ne
 * pojavi, pa Google Drive nije ni bio u ponudi. `termux-open --send --chooser`
 * uvek prikaže chooser, a `--view` otvara fajl direktno u podrazumevanoj aplikaciji.
 * Privatne putanje rade isto (termux-api sam napravi content URI).
 */
async function handleAndroidShare(req, res) {
  try {
    const input = await androidTarget(req, res)
    if (input === undefined) return
    const { target, payload } = input
    const info = await stat(target)
    if (!info.isFile()) {
      writeJson(res, 400, { ok: false, error: { code: 'not-a-file', message: `nije običan fajl: ${target}` } })
      return
    }
    const mime = androidMimeOf(target)
    const requested = payload && typeof payload.action === 'string' ? payload.action : undefined
    const action = requested === 'view' || requested === 'send'
      ? requested
      : (mime.startsWith('video/') || mime.startsWith('image/') ? 'view' : 'send')

    // Staging: privatni fajl se prvo kopira u deljeni storage. Tri razloga, sva
    // tri izmerena 2026-09-29:
    //  1. Google Photos / galerija ume da vrati „Media not found" za content URI
    //     koji termux-api napravi nad fajlom u /data/data/com.termux/... ;
    //  2. `termux-media-scan` može da indeksira samo fajl u deljenom storage-u;
    //  3. slike tako uđu u galerijinu biblioteku (Pictures), a ne u Download.
    const isMedia = mime.startsWith('image/') || mime.startsWith('video/')
    const stageDir = mime.startsWith('image/') ? PICTURES_STAGE_DIR : SHARE_STAGE_DIR
    let openPath = target
    let staged = false
    if (!openPath.startsWith('/storage/')) {
      await mkdir(stageDir, { recursive: true })
      const stagedPath = join(stageDir, basename(target))
      await copyFile(target, stagedPath)
      openPath = stagedPath
      staged = true
    }
    if (isMedia) {
      // MediaStore indeks (za galeriju/Photos biblioteku). Ako alat ne postoji ili
      // padne, nastavljamo — `termux-open` radi i bez toga.
      await runArgv('termux-media-scan', ['-v', openPath], 8000)
    }

    // Otvaranje: za sliku/video prvo `file://` na staged putanju u DELJENOM
    // storage-u. Izmereno 2026-09-29 na ovom uređaju: `termux-open` gradi
    // `content://com.termux.fileprovider/...`, a i Google Photos („Media not
    // found") i Nothing Gallery („Cannot show the photo") odbiju taj URI, dok
    // `file://` putanju iz Pictures/ galerija čita normalno jer ima
    // READ_MEDIA_IMAGES. Ako `am start` ne nađe primaoca (ili vrati grešku),
    // padamo na `termux-open --view --chooser`.
    // Za `send` (npr. Google Drive) uvek ide `termux-open --send --chooser`, jer
    // tu primalac mora dobiti content URI, a chooser garantuje da Photos ne
    // preskoči izbor (Solid Explorer je inače default za .zip).
    let result
    let via = 'termux-open'
    if (action === 'view' && isMedia) {
      result = await runArgv('am', ['start', '-a', 'android.intent.action.VIEW', '-d', `file://${openPath}`, '-t', mime])
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
      if (result.code !== 0 || /unable to resolve|Error:/i.test(output)) {
        result = await runArgv('termux-open', ['--view', '--chooser', '--content-type', mime, openPath])
        via = 'termux-open-fallback'
      } else {
        via = 'file-uri'
      }
    } else {
      result = await runArgv('termux-open', ['--send', '--chooser', '--content-type', mime, openPath])
    }
    if (result.code !== 0) {
      writeJson(res, 502, {
        ok: false,
        error: { code: 'open-failed', message: (result.stderr || '').trim() || `exit ${result.code}` },
      })
      return
    }
    writeJson(res, 200, { ok: true, value: { path: target, mime, action, staged, openPath, via } })
  } catch (error) {
    const status = (error && error.status) || 400
    writeJson(res, status, { ok: false, error: { code: 'android-share-error', message: error instanceof Error ? error.message : String(error) } })
  }
}

/**
 * POST {paths: [...], confirm: true} → TRAJNO briše zadate putanje.
 *
 * Za razliku od `delete-in-workspace`, ovde putanje smeju biti bilo gde (isti
 * „unrestricted" režim koji plugin već koristi za listanje i preview, uz
 * korisnikovu saglasnost). Zaštite:
 *  - `confirm: true` je obavezan (klijent ga šalje tek na drugi tap),
 *  - `lstat`, pa se symlink NE prati (briše se sam link, ne meta),
 *  - folder se briše samo ako je prazan; neprazan se prijavljuje kao greška,
 *  - odgovor nosi rezultat po putanji, pa UI može da prikaže šta je prošlo.
 */
async function handleDeletePaths(req, res) {
  try {
    const payload = await androidBody(req, res)
    if (payload === undefined) return
    const paths = Array.isArray(payload.paths)
      ? payload.paths.filter((p) => typeof p === 'string' && p !== '' && isAbsolute(p))
      : []
    if (paths.length === 0) {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing "paths" (non-empty list of absolute paths)' } })
      return
    }
    if (payload.confirm !== true) {
      writeJson(res, 400, { ok: false, error: { code: 'confirm-required', message: 'posalji {"confirm":true} — brisanje je trajno' } })
      return
    }
    const results = []
    for (const target of paths) {
      try {
        const info = await lstat(target)
        if (info.isDirectory()) {
          const entries = await readdir(target)
          if (entries.length > 0) {
            results.push({ path: target, ok: false, error: 'folder nije prazan' })
            continue
          }
        }
        await rm(target)
        results.push({ path: target, ok: true })
      } catch (error) {
        results.push({ path: target, ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }
    const deleted = results.filter((r) => r.ok).length
    writeJson(res, 200, { ok: true, value: { deleted, failed: results.length - deleted, results } })
  } catch (error) {
    const status = (error && error.status) || 400
    writeJson(res, status, { ok: false, error: { code: 'delete-paths-error', message: error instanceof Error ? error.message : String(error) } })
  }
}

/** POST {path} → otvori roditeljski folder u Solid Exploreru (`resource/folder`). */async function handleAndroidFolder(req, res) {
  try {
    const input = await androidTarget(req, res)
    if (input === undefined) return
    const { target } = input
    const info = await stat(target)
    let openDir = info.isDirectory() ? target : path.dirname(target)
    let staged = false
    if (!openDir.startsWith('/storage/')) {
      if (!info.isFile()) {
        writeJson(res, 400, {
          ok: false,
          error: {
            code: 'private-directory',
            message: 'folder u Termux privatnom dir-u se ne može otvoriti u Solid Exploreru — otvori fajl pa koristi „Podeli", ili kopiraj u Download',
          },
        })
        return
      }
      await mkdir(SHARE_STAGE_DIR, { recursive: true })
      const stagedPath = join(SHARE_STAGE_DIR, basename(target))
      await copyFile(target, stagedPath)
      openDir = SHARE_STAGE_DIR
      staged = true
    }
    // `-t resource/folder` + `-f 0x10008000` su OBAVEZNI (vidi ~/.dsh/skills/solid);
    // `-n` se nikad ne dodaje jer preskače filter i aktivnost se odmah zatvori.
    const result = await runArgv('am', [
      'start', '-f', '0x10008000', '-a', 'android.intent.action.VIEW',
      '-d', `file://${openDir}`, '-t', 'resource/folder',
    ])
    if (result.code !== 0) {
      writeJson(res, 502, {
        ok: false,
        error: { code: 'am-start-failed', message: (result.stderr || '').trim() || `am start exit ${result.code}` },
      })
      return
    }
    // `am start` vraća 0 i kad se ništa ne pojavi — zato klijent prikazuje poruku,
    // a korisnik potvrđuje očima (vidi prompt/skill).
    writeJson(res, 200, { ok: true, value: { openDir, staged, am: (result.stdout || '').trim() } })
  } catch (error) {
    const status = (error && error.status) || 400
    writeJson(res, status, { ok: false, error: { code: 'android-folder-error', message: error instanceof Error ? error.message : String(error) } })
  }
}

/** POST {prompt, parentSession?, cwd?} → napravi NOVU (praznu) sesiju u istom
 * workspace-u kao `parentSession` i prosledi joj `prompt`. Ne deli istoriju.
 *
 * Radi u samom web serveru (`ctx.get('sessionController')`), pa se nova sesija
 * odmah pojavi u GUI-ju — u ISTOJ grupi (workspace) kao pozivajuća. Eksterni
 * `dsh headless` je namerno napušten: on sesiju upiše van workspace registra,
 * pa završi u „Ungrouped", i drži session.lock dok radi.
 *
 * Ovo je jedina ruta koja menja stanje sesija; loopback + POST + JSON kao i
 * ostale Android/FS rute. */

/** Folder u koji branch ruta upisuje oznaku za svaku sesiju koju je napravila.
 *  `branch.sh` je čita pre POST-a, da se ista sesija ne bi granala DRUGI put:
 *  2026-10-07 se nova sesija sama ponovo branchovala (Gemini je u njoj pozvao
 *  skill `branch-into-new-session`), pa je korisnikov tekst ostao u međusesiji
 *  a on je gledao treću. Vidi i BRANCH_GUARD_TEXT ispod. */
const BRANCH_CHILD_DIR = join(homedir(), 'dsh', '.branch-into-new-session', 'children')

/** Upis oznake „ova sesija je dete branch-a". Best-effort: ako upis padne,
 *  grananje se NE obara — samo izgubimo zaštitu od ponovnog grananja. */
async function markBranchChild(sessionId, parentSession, smart) {
  try {
    await mkdir(BRANCH_CHILD_DIR, { recursive: true })
    await writeFile(
      join(BRANCH_CHILD_DIR, sessionId),
      JSON.stringify({ sessionId, parentSession: parentSession ?? null, smart: smart === true, at: new Date().toISOString() }) + '\n',
      'utf8',
    )
  } catch (error) {
    console.warn('composer-extras: branch-child oznaka nije upisana:', error)
  }
}

/** Uputstvo koje ide UZ prosleđeni prompt, kao prvi `text` deo.
 *
 * Zašto: model u novoj sesiji pročita prompt koji govori o grananju, nađe
 * `branch-into-new-session` u katalogu skillova (opis mu se poklapa sa
 * „prebaci ovo u novu sesiju") i sam napravi JOŠ jednu sesiju — pa korisnikov
 * tekst ostane u međusesiji. Ovo je prva linija odbrane; druga je oznaka iz
 * `markBranchChild` koju proverava `branch.sh`. */
const BRANCH_GUARD_TEXT = [
  '<system-reminder>',
  'Ova sesija je upravo napravljena rutom `branch-into-new-session` i grananje je VEĆ obavljeno.',
  'Ne pozivaj skill `branch-into-new-session` i ne pokreći `branch.sh` iz ove sesije:',
  'to bi napravilo još jednu sesiju, a korisnikov tekst bi ostao u međusesiji.',
  'Radi zadatak iz poruke ispod — ovde.',
  '</system-reminder>',
].join('\n')

async function handleBranchSession(ctx, req, res) {
  try {
    const payload = await androidBody(req, res)
    if (payload === undefined) return
    const prompt = payload && typeof payload.prompt === 'string' ? payload.prompt.trim() : ''
    if (prompt === '') {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing "prompt" (non-empty string)' } })
      return
    }
    const controller = ctx.get('sessionController')
    if (controller === undefined || typeof controller.create !== 'function' || typeof controller.prompt !== 'function') {
      writeJson(res, 503, {
        ok: false,
        error: { code: 'session-controller-missing', message: 'sessionController nije montiran u ovom profilu' },
      })
      return
    }
    const parentSession = typeof payload.parentSession === 'string' && payload.parentSession !== '' ? payload.parentSession : undefined
    const cwd = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : undefined

    // 1) workspace pozivajuće sesije — to je ista GUI grupa
    const registry = ctx.get('workspaceRegistry')
    const workspaces = registry !== undefined && typeof registry.list === 'function' ? registry.list() : []
    let workspace
    if (parentSession !== undefined) {
      workspace = workspaces.find((w) => Array.isArray(w.sessionIds) && w.sessionIds.includes(parentSession))
    }
    if (workspace === undefined && cwd !== undefined) {
      workspace = workspaces.find((w) => w.path === cwd)
    }

    // 2) prazna sesija (create ne kopira istoriju), pa prosleđen prompt
    const created = workspace !== undefined
      ? await controller.create({ workspaceId: workspace.id })
      : await controller.create({ cwd: cwd ?? process.cwd() })

    // „Smart" start: prvi (mali) prompt ide Geminiju, da se ne troši DeepSeek
    // kontekst ako Gemini može da odradi zadatak. `selectModel` instalira model
    // za SLEDEĆI request, pa mora pre `prompt`. Isti par koji koristi i
    // gemini-seek-smart (klijentski hook, GEMINI_SEEK_SCHEDULE).
    // Može se preskočiti (`smart:false`) ili zameniti (`provider`/`model`).
    const smart = payload.smart !== false
    const provider = typeof payload.provider === 'string' && payload.provider !== ''
      ? payload.provider
      : (smart ? 'google' : undefined)
    const model = typeof payload.model === 'string' && payload.model !== ''
      ? payload.model
      : (smart ? 'gemini-flash-lite-latest' : undefined)
    let modelSelection = null
    let modelError = null
    if (provider !== undefined && model !== undefined) {
      if (typeof controller.selectModel !== 'function') {
        modelError = 'sessionController.selectModel nije dostupan'
      } else {
        try {
          const selected = await controller.selectModel({ sessionId: created.sessionId, provider, model })
          modelSelection = (selected && selected.selected) || { provider, model }
          // Zapamti da je ova sesija „smart" — klijent po tome pali svoj
          // gemini-seek-smart režim i indikator (vidi branch-info rutu).
          BRANCH_SMART_SESSIONS.set(created.sessionId, modelSelection)
        } catch (error) {
          // Ne obaramo branch zbog modela — bolje da sesija krene na default
          // modelu nego da zadatak uopšte ne bude prosleđen.
          modelError = error instanceof Error ? error.message : String(error)
        }
      }
    }

    const signal = new AbortController().signal
    await controller.prompt({
      requestId: randomUUID(),
      sessionId: created.sessionId,
      mode: 'queue',
      // Prvi deo je zaštita od ponovnog grananja, drugi je korisnikov tekst.
      // Nova sesija ne vidi ovaj razgovor, pa bi bez ovoga model pročitao
      // prompt o grananju i sam pozvao skill (izmereno 2026-10-07).
      content: [
        { type: 'text', text: BRANCH_GUARD_TEXT },
        { type: 'text', text: prompt },
      ],
    }, signal)

    // Oznaka za `branch.sh`: ova sesija je već branchovana, ne granaj je opet.
    // Posle prompta, da se ne upiše ako je grananje ipak palo pre prosleđivanja.
    await markBranchChild(created.sessionId, parentSession, modelSelection !== null)

    writeJson(res, 200, {
      ok: true,
      value: {
        sessionId: created.sessionId,
        workspaceId: workspace === undefined ? null : workspace.id,
        group: workspace === undefined ? null : workspace.path,
        historyShared: false,
        smart: modelSelection !== null,
        model: modelSelection,
        modelError,
        recursionGuarded: true,
      },
    })
  } catch (error) {
    const status = (error && error.status) || 400
    writeJson(res, status, {
      ok: false,
      error: { code: 'branch-session-error', message: error instanceof Error ? error.message : String(error) },
    })
  }
}

/** Koliko najduže čekamo da agent pređe u `idle` pre kompakcije (default/max). */
const COMPACT_DEFAULT_WAIT_MS = 90000
const COMPACT_MAX_WAIT_MS = 600000

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/**
 * POST {sessionId, waitMs?} → pokreni `/compact` u TOJ sesiji i vrati PRAVI ishod.
 *
 * Zašto ruta postoji:
 *  1. `ctx.get('compaction')` iz ovog plugina NE postoji — `compaction` je
 *     izolovan unutar `standard` agent preseta (`isolate: {compaction: true}`),
 *     pa `/clear-context` u ovom pluginu nikad nije ni mogao da kompaktuje.
 *     Jedini seam koji radi je `ctx.commands.execute(agent, '/compact', …)`,
 *     a on komandu izvršava u realm-u TOG agenta.
 *  2. Kompozitor (`input.submit`) ne može da razlikuje „izvršeno" od „agent
 *     nije idle" — ruta vraća `{kind, text}`, pa dugme može da pokaže šta se
 *     stvarno desilo (2026-10-07: 3 od 5 klikova su bili `busy`, a korisnik je
 *     video tišinu).
 *
 * Kompakcija u toku turna nije dozvoljena (`ManualCompactionError('busy')`),
 * pa ruta čeka da `agent.status` postane `idle` — do `waitMs`. Ako istekne,
 * `compactNow` vrati `busy` i to je ishod koji klijent prikaže.
 */
async function handleCompactSession(ctx, req, res) {
  // `androidBody` čita telo i može da baci (npr. malformed JSON, status 400) —
  // zato je UNUTAR try-a; van njega bi ostao neuhvaćen rejected promise.
  let abort
  try {
    const payload = await androidBody(req, res)
    if (payload === undefined) return
    const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId.trim() : ''
    if (sessionId === '') {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing "sessionId" (non-empty string)' } })
      return
    }
    const requestedWait = payload && typeof payload.waitMs === 'number' && isFinite(payload.waitMs)
      ? payload.waitMs
      : COMPACT_DEFAULT_WAIT_MS
    const waitMs = Math.max(0, Math.min(COMPACT_MAX_WAIT_MS, Math.round(requestedWait)))

    const controller = ctx.get('sessionController')
    if (controller === undefined || typeof controller.resolveAgent !== 'function') {
      writeJson(res, 503, {
        ok: false,
        error: { code: 'session-controller-missing', message: 'sessionController.resolveAgent nije dostupan' },
      })
      return
    }
    if (ctx.commands === undefined) {
      writeJson(res, 503, {
        ok: false,
        error: { code: 'commands-missing', message: 'command registry nije montiran u ovom profilu' },
      })
      return
    }

    const resolved = await controller.resolveAgent(sessionId)
    if (resolved === undefined || resolved.agent === undefined) {
      const failure = resolved && resolved.error ? resolved.error : undefined
      writeJson(res, 409, {
        ok: false,
        error: {
          code: (failure && failure.code) || 'agent-unavailable',
          message: (failure && failure.message) || 'agent za tu sesiju nije dostupan',
        },
      })
      return
    }

    // Otkazivanje: ako browser odustane (navigacija/reload) prekidamo i čekanje
    // i samu kompakciju. `res.writableEnded` je bitan — 'close' se emituje i
    // kad je odgovor normalno završen.
    abort = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) abort.abort(new Error('client disconnected'))
    })

    const startedAt = Date.now()
    const deadline = startedAt + waitMs
    let waitedMs = 0
    const agent = resolved.agent
    while (agent.status !== 'idle' && Date.now() < deadline) {
      if (abort.signal.aborted) throw abort.signal.reason
      await sleep(Math.min(1000, Math.max(0, deadline - Date.now())))
      waitedMs = Date.now() - startedAt
    }
    waitedMs = Date.now() - startedAt

    const execution = await ctx.commands.execute(agent, '/compact', [], abort.signal)
    if (execution === undefined) {
      writeJson(res, 409, {
        ok: false,
        error: {
          code: 'compact-unavailable',
          message: '/compact nije registrovan za ovaj agent preset — kompakcija nije dostupna u ovoj sesiji',
        },
      })
      return
    }
    writeJson(res, 200, {
      ok: true,
      value: {
        kind: execution.result.kind,
        text: execution.result.text ?? null,
        commandId: String(execution.commandId),
        waitedMs,
      },
    })
  } catch (error) {
    // Prekinut klijent / već završen odgovor: nema kome da se piše, a i sam
    // abort je očekivan ishod (npr. korisnik je otišao sa stranice).
    if ((abort && abort.signal.aborted) || res.writableEnded || res.destroyed) return
    const status = (error && error.status) || 400
    writeJson(res, status, {
      ok: false,
      error: { code: 'compact-error', message: error instanceof Error ? error.message : String(error) },
    })
  }
}

/**
 * POST {sessionId, text, provider?, model?} → ubaci prompt u POSTOJEĆU sesiju.
 *
 * Zašto ruta postoji: `sessionController.prompt` je jedini način da se sesija
 * nastavi a da ostane TAČNO onaj model koji je u njoj već izabran. GUI dugme
 * to radi, ali skripta nema browser kolačić, a dsh-ove `/api/...` rute ga
 * traže (401). Loopback fence je isti kao za branch rutu, pa je dovoljno
 * `curl` sa lokalnog hosta.
 *
 * `provider`/`model` su opcioni: ako su dati, menjaju model za SLEDEĆI request
 * (isti `selectModel` koji koristi branch „smart" start). Bez njih se ne dira
 * ništa — model ostaje onaj koji sesija već ima.
 *
 * Namena: npr. „try again" posle prekinutog turna (kvota, 400) bez otvaranja
 * GUI-ja — i provera da li sesija nastavlja da radi posle zamene modela.
 */
async function handlePromptSession(ctx, req, res) {
  try {
    const payload = await androidBody(req, res)
    if (payload === undefined) return
    const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId.trim() : ''
    const text = payload && typeof payload.text === 'string' ? payload.text : ''
    if (sessionId === '' || text.trim() === '') {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing "sessionId" or "text" (non-empty strings)' } })
      return
    }
    const controller = ctx.get('sessionController')
    if (controller === undefined || typeof controller.prompt !== 'function') {
      writeJson(res, 503, { ok: false, error: { code: 'session-controller-missing', message: 'sessionController nije montiran u ovom profilu' } })
      return
    }

    let modelSelection = null
    let modelError = null
    const provider = typeof payload.provider === 'string' && payload.provider !== '' ? payload.provider : undefined
    const model = typeof payload.model === 'string' && payload.model !== '' ? payload.model : undefined
    if (provider !== undefined && model !== undefined) {
      if (typeof controller.selectModel !== 'function') {
        modelError = 'sessionController.selectModel nije dostupan'
      } else {
        try {
          const selected = await controller.selectModel({ sessionId, provider, model })
          modelSelection = (selected && selected.selected) || { provider, model }
        } catch (error) {
          modelError = error instanceof Error ? error.message : String(error)
        }
      }
    }

    const mode = typeof payload.mode === 'string' && payload.mode !== '' ? payload.mode : 'queue'
    await controller.prompt({
      requestId: randomUUID(),
      sessionId,
      mode,
      content: [{ type: 'text', text }],
    }, new AbortController().signal)

    writeJson(res, 200, { ok: true, value: { sessionId, accepted: true, mode, model: modelSelection, modelError } })
  } catch (error) {
    const status = (error && error.status) || 400
    writeJson(res, status, {
      ok: false,
      error: { code: 'prompt-session-error', message: error instanceof Error ? error.message : String(error) },
    })
  }
}

/**
 * readdir() any absolute path plus mtimeMs per entry, so the picker can sort
 * oldest-to-newest instead of alphabetically. Shared by both listing routes
 * below — the only difference between them is the workspace boundary check,
 * not how a level gets read. dsh-better-sidebar's own `fs.tree` (SidebarFsEntry
 * in its fs-tree.ts) has NO mtime field at all — can't get sortable dates by
 * reusing that route, hence this plugin doing its own listing for BOTH modes
 * now instead of the workspace side staying on sidebar's API.
 */
async function listDirectoryWithMtime(targetPath, maxEntries) {
  const dirents = await readdir(targetPath, { withFileTypes: true })
  const capped = dirents.slice(0, maxEntries)
  const entries = await Promise.all(capped.map(async (dirent) => {
    const entryPath = join(targetPath, dirent.name)
    let mtimeMs = 0
    try {
      mtimeMs = (await stat(entryPath)).mtimeMs
    } catch {
      // Broken symlink or a raced deletion mid-listing — keep the row
      // (readdir already committed to it), just sort it as oldest.
    }
    return { name: dirent.name, path: entryPath, isDir: dirent.isDirectory(), mtimeMs }
  }))
  return { path: targetPath, entries, truncated: dirents.length > maxEntries }
}

async function handleFsTreeUnrestricted(req, res) {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
    return
  }
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
    return
  }
  try {
    const payload = await readJsonBody(req, 1 << 16)
    const target = payload && typeof payload.path === 'string' ? payload.path : undefined
    if (target === undefined || target === '' || !isAbsolute(target)) {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing or invalid "path" (must be a non-empty absolute path)' } })
      return
    }
    const value = await listDirectoryWithMtime(target, 2000)
    writeJson(res, 200, { ok: true, value })
  } catch (error) {
    const status = (error && error.status) || 400
    writeJson(res, status, { ok: false, error: { code: 'fs-error', message: error instanceof Error ? error.message : String(error) } })
  }
}

/** Same listing as above, but workspace-scoped (ensureWithinCwd) — the
 * picker's "workspace" mode uses this instead of dsh-better-sidebar's
 * `fs.tree` now, purely to get mtimeMs for sorting. */
async function handleFsTreeWorkspace(ctx, req, res) {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
    return
  }
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
    return
  }
  try {
    const payload = await readJsonBody(req, 1 << 16)
    const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : undefined
    if (!sessionId) {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing "sessionId"' } })
      return
    }
    const cwd = sessionCwdOf(ctx, sessionId)
    const requestedDir = typeof payload.path === 'string' && payload.path !== '' ? payload.path : cwd
    const target = ensureWithinCwd(cwd, requestedDir)
    const value = await listDirectoryWithMtime(target, 2000)
    writeJson(res, 200, { ok: true, value })
  } catch (error) {
    const status = (error && error.status) || 400
    writeJson(res, status, { ok: false, error: { code: 'fs-error', message: error instanceof Error ? error.message : String(error) } })
  }
}

/** Session cwd WITHOUT dsh-better-sidebar.
 *
 * The picker used to read `/sidebar/api/session.cwd`, which 404s whenever
 * dsh-better-sidebar is not installed — and the fixed Termux installer
 * deliberately excludes it (React #130). Result: every picker button looked
 * fine but did nothing, because the listing promise rejected before the first
 * render. The server already resolves cwd itself for the listing routes
 * (sessionCwdOf), so expose that same resolution directly. */
async function handleSessionCwd(ctx, req, res) {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
    return
  }
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
    return
  }
  try {
    const payload = await readJsonBody(req, 1 << 16)
    const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : undefined
    if (!sessionId) {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing "sessionId"' } })
      return
    }
    writeJson(res, 200, { ok: true, value: { cwd: sessionCwdOf(ctx, sessionId) } })
  } catch (error) {
    const status = (error && error.status) || 400
    writeJson(res, status, { ok: false, error: { code: 'fs-error', message: error instanceof Error ? error.message : String(error) } })
  }
}

/** Client-side diagnostics sink.
 *
 * The picker/quick-text buttons guard their handlers with `sessionId !==
 * undefined`, so a missing session makes a click silently do nothing. This
 * route lets the client report what props it actually received, so that
 * "handler never ran" can be told apart from "request failed" without browser
 * devtools (which Android Chrome does not offer). */
const DIAG_LOG = join(homedir(), 'dsh', 'composer-diag.log')

async function handleDiag(req, res) {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
    return
  }
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
    return
  }
  try {
    const payload = await readJsonBody(req, 1 << 16)
    const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : { raw: payload }
    await mkdir(join(homedir(), 'dsh'), { recursive: true })
    await appendFile(DIAG_LOG, JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n')
    writeJson(res, 200, { ok: true, value: { logged: true } })
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: { code: 'diag-error', message: error instanceof Error ? error.message : String(error) },
    })
  }
}

const IMAGE_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
}

const IMAGE_PREVIEW_MAX_BYTES = 15 * 1024 * 1024

/**
 * Streams an image file straight to an <img> tag's GET request — the picker's
 * thumbnail preview while browsing (workspace or unrestricted mode alike; a
 * preview is only ever requested for a path the client already received from
 * one of the two listing routes above, so this adds no new read surface
 * beyond what listing already exposed). Deliberately NOT JSON — base64-in-JSON
 * would inflate a multi-MB photo by ~33% for no benefit when the browser can
 * just decode raw bytes with a Content-Type header.
 */
async function handleImagePreview(req, res) {
  if (!isLoopbackRequest(req)) {
    res.writeHead(403, { 'content-type': 'text/plain' })
    res.end('forbidden')
    return
  }
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'text/plain' })
    res.end('method not allowed')
    return
  }
  try {
    const url = new URL(req.url ?? '/', 'http://internal')
    const target = url.searchParams.get('path')
    if (!target || !isAbsolute(target)) {
      res.writeHead(400, { 'content-type': 'text/plain' })
      res.end('missing or invalid "path" query param')
      return
    }
    const mime = IMAGE_MIME_BY_EXT[extname(target).toLowerCase()]
    if (!mime) {
      res.writeHead(415, { 'content-type': 'text/plain' })
      res.end('not a previewable image extension')
      return
    }
    const info = await stat(target)
    if (!info.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not a file')
      return
    }
    if (info.size > IMAGE_PREVIEW_MAX_BYTES) {
      res.writeHead(413, { 'content-type': 'text/plain' })
      res.end('image too large to preview')
      return
    }
    res.writeHead(200, {
      'content-type': mime,
      'content-length': String(info.size),
      'cache-control': 'private, max-age=60',
    })
    createReadStream(target).pipe(res)
  } catch (error) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end(error instanceof Error ? error.message : String(error))
  }
}

/** Resolve a session's authoritative cwd server-side — never trust a client-supplied one. */
function sessionCwdOf(ctx, sessionId) {
  const sessions = ctx.get('sessions')
  const session = sessions ? sessions.get(sessionId) : undefined
  const headerCwd = session?.header?.cwd
  return headerCwd !== undefined && headerCwd !== '' ? headerCwd : process.cwd()
}

/**
 * `dir` must resolve to `cwd` itself or somewhere under it. Shared by upload
 * and mkdir below — both accept a client-chosen target directory (wherever
 * the user is currently browsing, not a fixed subfolder), so both need the
 * same workspace-boundary check that fs-tree-unrestricted above deliberately
 * does NOT have; write operations stay scoped even though reads (in this
 * plugin) don't.
 */
function ensureWithinCwd(cwd, dir) {
  const resolved = resolve(dir)
  if (resolved !== cwd && !resolved.startsWith(cwd + sep)) {
    throw Object.assign(new Error('target directory escaped the workspace'), { status: 400 })
  }
  return resolved
}

/** Binary-safe write into wherever the picker is currently browsing (default:
 * the workspace root) — workspace-scoped, unlike fs-tree-unrestricted above. */
async function handleUploadToWorkspace(ctx, req, res) {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
    return
  }
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
    return
  }
  try {
    // Base64 inflates ~33%; 24MB body budget covers a ~18MB source image.
    const payload = await readJsonBody(req, 24 * 1024 * 1024)
    const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : undefined
    const filename = payload && typeof payload.filename === 'string' ? payload.filename : undefined
    const contentBase64 = payload && typeof payload.contentBase64 === 'string' ? payload.contentBase64 : undefined
    if (!sessionId || !filename || !contentBase64) {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing "sessionId", "filename", or "contentBase64"' } })
      return
    }
    const cwd = sessionCwdOf(ctx, sessionId)
    const requestedDir = typeof payload.targetDir === 'string' && payload.targetDir !== '' ? payload.targetDir : cwd
    const uploadDir = ensureWithinCwd(cwd, requestedDir)
    // basename() alone strips any ../ the client sent; resolve()+prefix-check
    // below is defense in depth, not the only guard.
    const safeName = `${Date.now()}-${basename(filename).replace(/[^\w.-]/g, '_')}`
    const target = resolve(uploadDir, safeName)
    if (target !== uploadDir && !target.startsWith(uploadDir + sep)) {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'resolved upload path escaped the workspace' } })
      return
    }
    const buffer = Buffer.from(contentBase64, 'base64')
    await mkdir(uploadDir, { recursive: true })
    await writeFile(target, buffer)
    writeJson(res, 200, { ok: true, value: { path: target } })
  } catch (error) {
    const status = (error && error.status) || 400
    writeJson(res, status, { ok: false, error: { code: 'fs-error', message: error instanceof Error ? error.message : String(error) } })
  }
}

/** Create a subfolder inside wherever the picker is currently browsing — same
 * workspace boundary as upload above. */
async function handleMkdirInWorkspace(ctx, req, res) {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
    return
  }
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
    return
  }
  try {
    const payload = await readJsonBody(req, 1 << 12)
    const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : undefined
    const name = payload && typeof payload.name === 'string' ? payload.name : undefined
    if (!sessionId || !name || name.trim() === '') {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing "sessionId" or "name"' } })
      return
    }
    const cwd = sessionCwdOf(ctx, sessionId)
    const requestedDir = typeof payload.targetDir === 'string' && payload.targetDir !== '' ? payload.targetDir : cwd
    const parentDir = ensureWithinCwd(cwd, requestedDir)
    const safeName = basename(name).replace(/[^\w.-]/g, '_')
    if (safeName === '' || safeName === '.' || safeName === '..') {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'invalid folder name' } })
      return
    }
    const target = resolve(parentDir, safeName)
    if (target !== parentDir && !target.startsWith(parentDir + sep)) {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'resolved folder path escaped the workspace' } })
      return
    }
    await mkdir(target, { recursive: true })
    writeJson(res, 200, { ok: true, value: { path: target } })
  } catch (error) {
    const status = (error && error.status) || 400
    writeJson(res, status, { ok: false, error: { code: 'fs-error', message: error instanceof Error ? error.message : String(error) } })
  }
}

/** Delete a file or folder (recursive) from wherever the picker is browsing —
 * same workspace boundary as upload/mkdir above. dsh-better-sidebar has NO
 * `fs.delete`/`fs.rename` route at all (checked its whole route table in
 * src/index.ts) — an earlier version of the picker called a `fs.delete` that
 * never existed and was never actually exercised end-to-end, so it silently
 * 404'd every time. This route (and rename below) exist so delete/rename
 * are real instead of quietly broken. */
async function handleDeleteInWorkspace(ctx, req, res) {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
    return
  }
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
    return
  }
  try {
    const payload = await readJsonBody(req, 1 << 12)
    const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : undefined
    const targetPath = payload && typeof payload.path === 'string' ? payload.path : undefined
    if (!sessionId || !targetPath) {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing "sessionId" or "path"' } })
      return
    }
    const cwd = sessionCwdOf(ctx, sessionId)
    const target = ensureWithinCwd(cwd, targetPath)
    if (target === cwd) {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'refusing to delete the workspace root itself' } })
      return
    }
    await rm(target, { recursive: true, force: false })
    writeJson(res, 200, { ok: true, value: { path: target } })
  } catch (error) {
    const status = (error && error.status) || 400
    writeJson(res, status, { ok: false, error: { code: 'fs-error', message: error instanceof Error ? error.message : String(error) } })
  }
}

/** Rename a file or folder in place (same parent directory) — same
 * workspace boundary as delete above. */
async function handleRenameInWorkspace(ctx, req, res) {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
    return
  }
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
    return
  }
  try {
    const payload = await readJsonBody(req, 1 << 12)
    const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : undefined
    const sourcePath = payload && typeof payload.path === 'string' ? payload.path : undefined
    const newName = payload && typeof payload.newName === 'string' ? payload.newName : undefined
    if (!sessionId || !sourcePath || !newName || newName.trim() === '') {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing "sessionId", "path", or "newName"' } })
      return
    }
    const cwd = sessionCwdOf(ctx, sessionId)
    const source = ensureWithinCwd(cwd, sourcePath)
    if (source === cwd) {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'refusing to rename the workspace root itself' } })
      return
    }
    const safeName = basename(newName).replace(/[^\w.-]/g, '_')
    if (safeName === '' || safeName === '.' || safeName === '..') {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'invalid new name' } })
      return
    }
    const parentDir = path.dirname(source)
    const target = resolve(parentDir, safeName)
    if (target !== parentDir && !target.startsWith(parentDir + sep)) {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'resolved rename target escaped the workspace' } })
      return
    }
    await rename(source, target)
    writeJson(res, 200, { ok: true, value: { path: target } })
  } catch (error) {
    const status = (error && error.status) || 400
    writeJson(res, status, { ok: false, error: { code: 'fs-error', message: error instanceof Error ? error.message : String(error) } })
  }
}

/**
 * Restart the whole dsh process — jednom, preko skill-a `restart-dsh`.
 *
 * Jedina implementacija restarta živi u
 * `~/.dsh/skills/restart-dsh/restart-dsh.sh` (isti skript koji poziva i skill
 * `restart-dsh` iz terminala/agenta). Ova komanda je samo tanki omotač: skript
 * pokrene DETAŠIRANO sa `--delay 2 --quiet` (2 s da poruka stigne korisniku pre
 * nego što pkill obori proces), pa se sam ugasi. Tako `/restart-dsh` iz „+"
 * menija i skill `restart-dsh` nikad ne mogu da se raziđu u dve različite
 * procedure — a ranije su bili `/restart` (plugin) i `restart-dsh` (skill).
 *
 * Ako skripta iz nekog razloga nema, padamo na direktan wrapper poziv, da
 * restart ne postane nemoguć.
 */
async function executeRestart(ctx, invocation) {
  if (invocation.rawInput.trim().length > 0) {
    return { kind: 'error', text: 'Usage: /restart-dsh (no arguments)' }
  }
  const home = homedir()
  const log = path.join(home, 'dsh', 'dsh-web.log')
  const skillScript = [
    path.join(home, '.dsh', 'skills', 'restart-dsh', 'restart-dsh.sh'),
    path.join(home, '.claude', 'skills', 'restart-dsh', 'restart-dsh.sh'),
  ].find((candidate) => existsSync(candidate))
  if (skillScript !== undefined) {
    const child = spawn('bash', [skillScript, '--delay', '2', '--quiet'], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
  } else {
    const wrapper = path.join(home, '.local', 'bin', 'dsh-termux')
    const child = spawn(
      'bash',
      ['-lc', `sleep 2 && exec "${wrapper}" >> "${log}" 2>&1`],
      { detached: true, stdio: 'ignore' },
    )
    child.unref()
  }
  setTimeout(() => process.exit(0), 300)
  return {
    kind: 'success',
    text: skillScript !== undefined
      ? 'Restarting dsh via skill restart-dsh — back on the same port in ~8-10 seconds.'
      : 'Restarting dsh — back on the same port in ~8-10 seconds.',
  }
}

/** Argument-free manual compaction request, mirroring dsh-command-compact's /compact handler. */
async function executeClear(ctx, invocation) {
  if (invocation.rawInput.trim().length > 0) {
    return { kind: 'error', text: 'Usage: /clear-context (no arguments)' }
  }
  // NAMERNO preko `ctx.commands.execute`, a NE `ctx.get('compaction')`:
  // `compaction` je izolovan unutar `standard` preseta (`isolate: {compaction:
  // true}`), pa ga sa ovog (profilnog) nivoa NEMA — ranija verzija je zato
  // uvek vraćala „Compaction is disabled in this profile", iako kompakcija
  // radi. `commands.execute` se izvršava u realm-u prosleđenog agenta, gde
  // `/compact` (dsh-command-compact) i njegov `compaction` jesu vidljivi.
  try {
    const execution = await ctx.commands.execute(invocation.agent, '/compact', [], invocation.signal)
    if (execution === undefined) {
      return { kind: 'error', text: '/compact nije registrovan za ovaj agent preset — kompakcija nije dostupna.' }
    }
    return execution.result
  } catch (error) {
    if (invocation.signal.aborted) return { kind: 'error', text: 'Cancelled.' }
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
}

export { apply, inject, name }
