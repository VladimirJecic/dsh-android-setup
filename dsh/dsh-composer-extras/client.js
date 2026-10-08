/**
 * Client half of dsh-composer-extras: mounts a paperclip button into the
 * sanctioned `conversation.input.left` list slot (kind: 'list', scope:
 * 'session', owner: InputZone — see dsh-client-ui-conversation's
 * contract/slots.d.ts). Renders inside the composer's left tool cluster,
 * immediately after the existing "+" command-menu button and the
 * permission-mode select — the closest available seat to "+", since "+"
 * itself is hardcoded JSX in dsh-client-ui-conversation, not a slot, and
 * patching that file directly would not survive `npm install -g
 * @deepseek-ai/dsh@latest`.
 *
 * Click opens straight into a file-tree picker (folder navigation, mark a
 * file, click Select) instead of a raw window.prompt() or an intermediate
 * choice menu — the picker IS the workspace directory, always. Only cwd
 * resolution still goes through `/sidebar/api/session.cwd` — dsh-better-
 * sidebar's own JSON API (see its src/client/api.ts) — a soft dependency on
 * that plugin being enabled in this profile (it is); if it's ever removed,
 * that one call 404s and falls back to an inline error with a manual @path
 * text field, never a crash. Directory LISTING itself is our own
 * `/composer-extras/api/fs-tree-workspace` (workspace-scoped) and
 * `fs-tree-unrestricted` (not) in index.js, not sidebar's `fs.tree` —
 * sidebar's `SidebarFsEntry` (its fs-tree.ts) carries no mtime at all, and
 * the picker sorts oldest-to-newest by mtime, so reusing that route stopped
 * being an option the moment sorting needed a date sidebar doesn't expose.
 *
 * appendToDraft() below is a line-for-line port of
 * dsh-better-sidebar/src/client/conversation-draft.ts — same `conversation`
 * service, same @-mention convention DSH's own parser already understands.
 *
 * Everything that ends up in the draft has to exist as a real file inside
 * the directory first, then be explicitly picked from the list and
 * confirmed with the Select button — deliberately, not an oversight. An
 * earlier version fast-pathed images straight into the composer's core
 * `conversation.createDraftImages`/`input.addImages` attachment seam when
 * the active model declared image support, bypassing the directory
 * entirely — but that meant two different mental models for "how a file
 * gets into the conversation" depending on which model happened to be
 * selected, and silently failed (`MODEL_DOES_NOT_SUPPORT_IMAGES`, "The
 * current model does not support images; switch to a model that does")
 * whenever it wasn't. Now the Galerija and Sa telefona buttons below both
 * just upload into the workspace and land the picker on the result — one
 * path, always, regardless of model. The model still reaches an image via
 * `read_image` on its own (through the `vision` subagent for a non-vision
 * model like DeepSeek Pro — tool-subagent-vision in this profile's
 * cordis.patch.yml — or directly if it's vision-capable itself).
 * uploadFileToWorkspace() posts the file (base64) to
 * `/composer-extras/api/upload-to-workspace` (binary-safe, unlike
 * dsh-better-sidebar's own `fs.write` which is utf8-text-only and would
 * corrupt image bytes). "Sa telefona" uses a second hidden
 * `<input type="file">` with no `accept` filter — the native Android
 * chooser (Camera / Camera Video / Files) the user actually expected, and
 * the only one that can reach shared storage / other apps' documents, none
 * of which the workspace-scoped Folder tree can see. Conversely that native
 * chooser can't see INTO the dsh workspace itself (Termux's private app
 * storage isn't exposed to other apps' file pickers, the same sandboxing
 * that keeps Solid Explorer from opening it directly) — so browsing the
 * actual tree still matters, it's not replaced by either upload button.
 *
 * Loader contract: DSH's browser module loader is NOT plain ESM — every
 * client bundle must register itself via `window.__ModuleLoader__.load({id,
 * factory})`, exactly like dsh-better-sidebar's rolldown output does. A raw
 * `import`/`export` file loads as a script but never registers, and the
 * loader then refuses to boot ANY plugin (see the "Failed to load plugins"
 * screen this caused once already). No bundler here since the file has one
 * dependency (react, supplied by the loader's `require`) — hand-wrapped.
 */
window.__ModuleLoader__.load({
	id: "dsh-composer-extras",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		var react = require("react");
		var createElement = react.createElement;
		var useState = react.useState;
		var useEffect = react.useEffect;
		var useRef = react.useRef;
		var useSyncExternalStore = react.useSyncExternalStore;

		/**
		 * Modal (ContextGuard) ide kroz `createPortal` u `document.body`, isto
		 * kao core `SettingsPanel` (dsh-client-ui-settings-general). Razlog je
		 * konkretan bug od 2026-10-08: kartica je bila `position: fixed` UNUTAR
		 * slota u composeru, pa je ispadala uz desnu ivicu i sekla se umesto da
		 * bude na sredini ekrana. U portalu je `fixed` vezan za viewport, ne za
		 * pretke composera (transform/filter/overflow na pretku bi inače
		 * napravio novi containing block).
		 *
		 * Ako `react-dom` iz nekog razloga nije u module table-u, vraća se
		 * identitet — panel se i dalje renderuje (samo inline), nikad ne puca.
		 */
		var modalPortal = (function () {
			try {
				var reactDom = require("react-dom");
				if (reactDom !== undefined && reactDom !== null && typeof reactDom.createPortal === "function") {
					return function (node) {
						var target = typeof document !== "undefined" && document && document.body
							? document.body
							: null;
						if (target === null) return node;
						return reactDom.createPortal(node, target);
					};
				}
			} catch (error) {
				/* bez portala — panel i dalje radi, samo inline */
			}
			return function (node) { return node; };
		})();

		/**
		 * GDE stoji mali pill („📦 Kontekst N%") koji ostaje posle odbacivanja
		 * predloga za kompakciju.
		 *
		 * 2026-10-08: pill je bio `position: fixed; right: 12; bottom: 96` i na
		 * telefonu je seo preko reda sa dugmadima composera. Korisnik je tražio:
		 * „pomeri floating window dole levo ispod plus dugmeta … opcija za
		 * compact bi bila u praznom prostoru ispod umesto sa strane".
		 *
		 * Taj prazan prostor je UNUTAR composer kartice (`[data-composer-card]`)
		 * i postoji zato što se red sa dugmadima na telefonu LOMI u dva reda:
		 * prvi red = `tools` (tu je levo „+"), drugi red = samo `trailing`
		 * (model + posalji) uz desnu ivicu — pa leva polovina drugog reda, tačno
		 * ispod „+", ostaje prazna. Zato se pozicija MERI iz DOM-a, umesto da se
		 * pogodi brojem:
		 *   1. ima li mesta ispod „+" unutar kartice → pill ide tačno tamo
		 *      (levo poravnat sa „+", `left` = leva ivica tog dugmeta);
		 *   2. ako nema (širok ekran — red se ne lomi) → pill ide u prazan levi
		 *      deo dock trake na dnu ekrana (ispod kartice, uz levu ivicu) i tu
		 *      ne dira ni jednu ikonicu.
		 *
		 * Selektori: kartica je `[data-composer-card]` (core InputBar), a „+" je
		 * jedino dugme u njoj sa `aria-haspopup="listbox"` (meni komandi) — isti
		 * atributi koje core sam postavlja, pa nema zavisnosti od heširanih CSS
		 * klasa (`.uV2eYG_add` se menja pri svakom build-u).
		 *
		 * Bez DOM-a (test harness, prvi render pre `useEffect`-a) vraća `null`, a
		 * pill tada koristi statični fallback (levo/dole) — nikad desnu ivicu.
		 */
		function useComposerPillAnchor(enabled) {
			var state = useState(null);
			var anchor = state[0], setAnchor = state[1];
			useEffect(function () {
				if (!enabled) return undefined;
				if (typeof document === "undefined" || document === null) return undefined;
				if (typeof document.querySelector !== "function") return undefined;
				var measure = function () {
					var card = document.querySelector("[data-composer-card]");
					if (card === null || typeof card.getBoundingClientRect !== "function") {
						setAnchor(null);
						return;
					}
					var cardBox = card.getBoundingClientRect();
					var plus = typeof card.querySelector === "function"
						? card.querySelector('button[aria-haspopup="listbox"]')
						: null;
					var plusBox = plus !== null && typeof plus.getBoundingClientRect === "function"
						? plus.getBoundingClientRect()
						: cardBox;
					var top = Math.round(plusBox.bottom + 4);
					var room = Math.round(cardBox.bottom - CONTEXT_GUARD_PILL_HEIGHT - 4);
					if (top > room) {
						var viewport = typeof window !== "undefined" && window !== null && window.innerHeight
							? window.innerHeight
							: cardBox.bottom;
						setAnchor({ left: 16, top: Math.round(viewport - CONTEXT_GUARD_PILL_HEIGHT - 4) });
						return;
					}
					setAnchor({ left: Math.max(8, Math.round(plusBox.left)), top: top });
				};
				measure();
				if (typeof window !== "undefined" && window !== null && typeof window.addEventListener === "function") {
					// Composer se pomera pri promeni visine prozora i pri skrolu
					// (sticky traka na dnu), pa se mesto ponovo meri.
					window.addEventListener("resize", measure);
					window.addEventListener("scroll", measure, true);
					return function () {
						window.removeEventListener("resize", measure);
						window.removeEventListener("scroll", measure, true);
					};
				}
				return undefined;
			}, [enabled]);
			return anchor;
		}

		// `uiWorkspace` se NAMERNO ne dodaje u `inject`: to je tvrd zahtev, pa bi
		// nedostupan servis oborio ceo plugin (i postojeća dugmad). Čita se
		// lenjo kroz `ctx.get("uiWorkspace")` — isti obrazac koji ovaj plugin već
		// koristi za `conversation`. Grananje je jedina stvar koja ga treba.
		var inject = ["slots", "sessions", "modelDirectories"];

		/**
		 * Prag sa kojim se poredi TRENUTNA zauzetost konteksta (isti broj koji
		 * crta ContextMeter — `projectedTokens` / `contextWindow`; na telefonu
		 * sedi u stats traci na dnu, ispod composera), a NE kumulativna
		 * potrošnja sesije iz Token usage panela. To su dva različita broja:
		 *   - Token usage panel = sabrana naplaćena potrošnja kroz CEO log
		 *     sesije (uncached + cache read + output, preko svih zahteva);
		 *   - kružić u stats traci = veličina prompta SLEDEĆEG zahteva / prozor.
		 * Kompakcija i grananje imaju smisla samo na ovom drugom broju.
		 *
		 * Podrazumevano 500.000 (50% prozora od 1M za deepseek-flash). DSH-ova
		 * automatska kompakcija (`dsh-compaction-basic`) inače čeka ~68%
		 * (floor(min(W*0.8, W-O-B)) = 678.464 za ovaj model), pa je ovo ranije
		 * upozorenje, ne zamena za nju.
		 */
		var CONTEXT_GUARD_TOKENS = 500000;

		/**
		 * Guard se pali na MANJE od dva praga: apsolutnog
		 * (`CONTEXT_GUARD_TOKENS`) ili ovog dela prozora modela.
		 *
		 * 0.5 (50%) je JEDINA vrednost u upotrebi — korisnik je 2026-10-08
		 * izričito tražio: „updejtuj da ga ne vidim ispod 50%". Niže vrednosti
		 * (0.25 i 0.05) su istog dana koristile SAMO kao privremeni test da se
		 * novi modal vidi odmah; vraćene su na 0.5 i ne spuštaju se više.
		 * Ako se modal ikad bude testirao, koristi `panel-preview.html`, a NE
		 * spuštanje praga (vidi rules/03-kontekst-i-kompakcija.md).
		 *
		 * Sa 1M prozorom: prag = min(500.000, 1.000.000 × 0.5) = 500.000 (50%).
		 *
		 * Guard je SAMO predlog: auto-compact je isključen (`auto: false` u
		 * `~/.dsh/profiles/web/cordis.patch.yml`), pa kompakciju uvek odobrava
		 * korisnik klikom na „Compact session".
		 */
		var CONTEXT_GUARD_WINDOW_FRACTION = 0.5;

		/**
		 * Posle odbacivanja („Nastavi dalje") podsetnik se vraća na sledećih
		 * ovoliko tokena iznad praga. 100k je 10% prozora od 1M — podsetnik se
		 * ponavlja na 60%, 70%, 80%…
		 */
		var CONTEXT_GUARD_RENUDGE = 100000;

		/**
		 * Približna visina pill-a u pikselima. Koristi je samo merenje u
		 * `useComposerPillAnchor` (da pill ne pređe preko donje ivice composer
		 * kartice). Ne mora da bude tačna do piksela.
		 */
		var CONTEXT_GUARD_PILL_HEIGHT = 26;

		/**
		 * localStorage ključ: najviši odbačeni „opseg" za tu sesiju.
		 * Odsustvo ključa znači -1 (nijedan opseg još nije odbačen), pa se
		 * opseg 0 (prvih 500k) prikazuje odmah.
		 */
		function contextDismissKey(sessionId) {
			return "composer-extras-ctx-dismissed-" + String(sessionId);
		}

		function contextDismissedBand(sessionId) {
			try {
				var raw = window.localStorage.getItem(contextDismissKey(sessionId));
				if (raw === null) return -1;
				var n = parseInt(raw, 10);
				return Number.isFinite(n) ? n : -1;
			} catch (error) {
				return -1;
			}
		}

		function dismissContextBand(sessionId, band) {
			try {
				window.localStorage.setItem(contextDismissKey(sessionId), String(band));
			} catch (error) {
				/* privatni režim — samo nastavi */
			}
		}

		/**
		 * Isti izračun koji koristi dsh-client-ui-conversation/ContextMeter
		 * (`contextOccupancy`): `projectedTokens ?? pressureTokens` podeljeno
		 * `contextWindow`. Jedina razlika je što ovde čuvamo i sirove brojeve
		 * da bi popup mogao da ih prikaže.
		 */
		function contextOccupancyFrom(pressure) {
			if (pressure === undefined || pressure === null) return null;
			var used = pressure.projectedTokens !== undefined ? pressure.projectedTokens : pressure.pressureTokens;
			if (used === undefined || pressure.contextWindow === undefined) return null;
			return {
				used: used,
				window: pressure.contextWindow,
				percent: Math.min(100, Math.round(used / pressure.contextWindow * 100)),
			};
		}

		function appendToDraft(ctx, sessionId, text) {
			try {
				var actx = ctx.sessions.scope(sessionId);
				if (actx === undefined) return false;
				var conversation = ctx.get("conversation");
				if (conversation === undefined) return false;
				var input = conversation.input.for(actx);
				var draft = input.state.getSnapshot().draft;
				input.setDraft(draft.trim() === "" ? text : draft + " " + text);
				return true;
			} catch (error) {
				console.warn("[dsh-composer-extras] draft insert failed:", error);
				return false;
			}
		}

		/**
		 * One-click quick replies: overwrite the draft and send immediately, no
		 * extra tap. `input.submit(mode)` (default `mode = "queue"`) is the same
		 * call the composer's own actions.submit / Enter-key path makes
		 * (SessionInputShell in dsh-client-ui-conversation's client.js) — this
		 * isn't a workaround, it's the real send trigger, just invoked directly
		 * instead of through a key event. "queue" mode matches normal Enter
		 * behavior: sends now if idle, queues behind a running turn if not.
		 * Backs both 🔁 Try again and 👍 Proceed below — same mechanism, only
		 * the literal text differs.
		 */
		function sendQuickText(ctx, sessionId, text) {
			try {
				var actx = ctx.sessions.scope(sessionId);
				if (actx === undefined) return false;
				var conversation = ctx.get("conversation");
				if (conversation === undefined) return false;
				var input = conversation.input.for(actx);
				input.setDraft(text);
				input.submit();
				return true;
			} catch (error) {
				console.warn("[dsh-composer-extras] quick-send failed:", error);
				return false;
			}
		}

		/**
		 * "gemini-seek-smart": send 2 prompts on Gemini Flash-Lite, then let it
		 * rest for a fixed wall-clock cooldown (DeepSeek Flash fills in during
		 * that window so sending isn't blocked), then go back to Gemini —
		 * repeating while toggled on. (A second Google API key was tried for a
		 * wider round-robin — 429'd immediately anyway, the token quota is
		 * billed per Google Cloud project, not per key, so a second key on the
		 * same project buys nothing. Single key it is.) Segment kinds:
		 *   "count"    — advance after `count` prompts on this model (Gemini side).
		 *                An optional `windowMs` adds a second, opposite-direction
		 *                rule: if `windowMs` elapses since the segment started
		 *                WITHOUT reaching `count` (the user paused mid-run — sent
		 *                1 of 2, thought for a while, sent the 2nd a minute
		 *                later), the real upstream rate-limit window has most
		 *                likely already rolled over too, so the partial count is
		 *                stale — reset `remaining` back to `count` and restart
		 *                the window, staying on Gemini for a fresh budget rather
		 *                than treating the old partial usage as still valid.
		 *   "cooldown" — advance once `cooldownMs` real time has passed since we
		 *                switched onto this model, regardless of how many prompts
		 *                landed on it meanwhile (DeepSeek side) — a rate-limit
		 *                rest period, not a prompt budget.
		 * State lives in this module-level object (keyed by sessionId), NOT React
		 * state — the toggle button component can remount (session re-open,
		 * composer re-render) without losing progress, because the thing that
		 * actually drives it is the input.submit() wrap below, installed once per
		 * session and independent of any particular component instance's lifetime.
		 */
		var GEMINI_SEEK_SCHEDULE = [
			{ provider: "google", model: "gemini-flash-lite-latest", kind: "count", count: 2, windowMs: 60000 },
			{ provider: "deepseek-official", model: "deepseek-flash", kind: "cooldown", cooldownMs: 60000 },
		];
		var geminiSeekState = {};
		var AGENT_ERROR_429_PATTERN = /RESOURCE_EXHAUSTED|"code"\s*:\s*429/;
		var GEMINI_SEEK_BLOCK_STORAGE_KEY = "composer-extras-gemini-seek-blocked-until";

		/**
		 * Sesija koja je prerasla Gemini free tier.
		 *
		 * Kvota koja je ovde pucala je `generate_content_free_tier_input_token_count`
		 * = 250.000 INPUT tokena u minuti (dijagnoza je bila u
		 * `DIJAGNOZA-gemini-deepseek-tool-use.md`, uklonjenom iz arhive 2026-10-08).
		 * Zahtev čiji je kontekst veći od toga ne može da prođe NIJEDNOM, bez obzira
		 * na to koliko je vremena prošlo od poslednjeg poziva — zato se smart mode
		 * iznad ove granice sam isključuje, i to TAČNO u trenutku kada bi inače
		 * prebacio model NA Gemini. Do 300k (a ne 250k) je namerno: ostavlja se
		 * rezerva za system prompt i tool definicije koji se dodaju uz kontekst.
		 */
		var GEMINI_SEEK_MAX_CONTEXT_TOKENS = 300000;
		var GEMINI_SEEK_TOO_BIG = "context-too-big";

		/**
		 * Trenutna veličina konteksta sesije u tokenima — token-meter projekcija
		 * `contextPressure` (`projectedTokens`, inače `pressureTokens`), ista
		 * vrednost koju prikazuje prsten u footeru. `undefined` kada projekcija
		 * još nije spremna ili sesija nije uvezena na klijentu.
		 */
		function sessionContextTokens(ctx, sessionId) {
			try {
				var binding = ctx.sessions.binding(sessionId);
				var session = binding && binding.session;
				var face = session && session.projections ? session.projections.faceOf("contextPressure") : undefined;
				var value = face && typeof face.getSnapshot === "function" ? face.getSnapshot() : undefined;
				if (!value) return undefined;
				var used = value.projectedTokens !== undefined ? value.projectedTokens : value.pressureTokens;
				return typeof used === "number" && isFinite(used) ? used : undefined;
			} catch (error) {
				return undefined;
			}
		}

		/**
		 * Tri-state procena: sme li ova sesija na Gemini?
		 *
		 *   "ok"      — veličina konteksta je poznata i ispod granice;
		 *   "too-big" — poznata i IZNAD granice (250k input tokena/min);
		 *   "unknown" — projekcija još nije stigla.
		 *
		 * Zašto tri stanja, a ne `boolean`: posle restarta ili hard refresh-a je
		 * `contextPressure` prazan dok se sesija ne uveze i ne replay-uje, pa je
		 * `unknown` NAJČEŠĆE stanje prvih sekundi. Ranije je `unknown` značilo
		 * „nije prevelika" (fail-open) — pa je restart VELIKE sesije automatski
		 * prebacio model na Gemini i poslao zahtev koji sigurno puca na 429
		 * (prijavljeno 2026-10-07: „restart dsh je uzrokovao da se smart dugme
		 * uključi za ovu sesiju, a kontekst je već velik").
		 */
		function geminiContextVerdict(ctx, sessionId) {
			var tokens = sessionContextTokens(ctx, sessionId);
			if (tokens === undefined) return "unknown";
			return tokens > GEMINI_SEEK_MAX_CONTEXT_TOKENS ? "too-big" : "ok";
		}

		/** True samo kad je POZNATO da je sesija prevelika (nikad na nepoznato). */
		function geminiTooBigForSession(ctx, sessionId) {
			return geminiContextVerdict(ctx, sessionId) === "too-big";
		}

		/**
		 * Skini sesiju sa Gemini-ja ako je TAMO ostavio smart.
		 *
		 * Gleda se trenutni model u direktorijumu: ako je baš Gemini segment iz
		 * `GEMINI_SEEK_SCHEDULE`, prebaci na DeepSeek segment. Isti potez radi i
		 * ručni 😎 „off" (`toggle()`), a bez njega bi sesija ostala na modelu koji
		 * ne može da primi toliki kontekst — pa bi prvi sledeći prompt pukao 429.
		 */
		function restoreModelOffGemini(ctx, sessionId) {
			try {
				var directory = ctx.modelDirectories.directoryFor(sessionId);
				var current = directory.store.getSnapshot().current;
				if (!current || current.provider !== "google") return;
				var googleSeg = GEMINI_SEEK_SCHEDULE.filter(function (seg) { return seg.provider === "google"; })[0];
				if (googleSeg === undefined || current.model !== googleSeg.model) return;
				var deepseekSeg = GEMINI_SEEK_SCHEDULE.filter(function (seg) { return seg.provider !== "google"; })[0];
				if (deepseekSeg === undefined) return;
				ensureModelSelected(ctx, sessionId, deepseekSeg).catch(function (error) {
					console.warn("[dsh-composer-extras] gemini-seek-smart: povratak na DeepSeek nije uspeo:", error);
				});
			} catch (error) {
				// Model-directory može biti nedostupan (sesija se još uvozi) — tada
				// nema ni šta da se vraća.
			}
		}

		/**
		 * Ugasi smart za JEDNU sesiju (ne dira globalni default) i zapamti to —
		 * per-session „off" oznaka preživljava remount. Koristi ga samo automatska
		 * granica od 300k; ručni 😎 klik ima svoj put u `toggle()`.
		 */
		function disableGeminiSeekTooBig(ctx, sessionId, state) {
			var tokens = sessionContextTokens(ctx, sessionId);
			// Prvo skini model sa Gemini-ja (ako ga je smart tamo stavio), pa tek
			// onda obriši `lastAppliedModel`.
			restoreModelOffGemini(ctx, sessionId);
			if (state) {
				state.enabled = false;
				state.disabledReason = GEMINI_SEEK_TOO_BIG;
				state.lastAppliedModel = undefined;
				if (state.notify) state.notify();
			}
			markSessionSmartOff(sessionId, true);
			console.warn("[dsh-composer-extras] gemini-seek-smart isključen: kontekst sesije je " +
				(tokens === undefined ? ">" : Math.round(tokens) + " >") + " " + GEMINI_SEEK_MAX_CONTEXT_TOKENS +
				" tokena, Gemini free tier je 250k input tokena/min");
		}

		/** Google-ov 429 nosi sopstveni retry-after u tekstu:
		 *  "Please retry in 57.669234222s". To je JEDINI pouzdan signal.
		 *  Proba sa praznom istorijom ne vredi nista: kvota je
		 *  `generate_content_free_tier_input_token_count` (INPUT TOKENA, limit
		 *  250000), a ne broj zahteva — proba od ~5 tokena prodje uvek, pa pravi
		 *  zahtev sa 280k padne. Ako retry-after nema, uzmi konzervativan minut. */
		function parseGeminiRetryAfterMs(errText) {
			if (typeof errText !== "string" || errText.length === 0) return 0;
			var m = errText.match(/retry in\s+([0-9]+(?:\.[0-9]+)?)\s*s/i);
			if (m) {
				var secs = parseFloat(m[1]);
				// +2s margine: sat izmedju uredjaja i Google-a nije garantovan.
				if (isFinite(secs) && secs > 0) return Math.ceil(secs * 1000) + 2000;
			}
			return 60000;
		}

		/** Koja je kvota pukla? Google u `details` polju 429 odgovora salje
		 *  `quotaId` (google.rpc.QuotaFailure) — pa razlikujemo TRAJNU dnevnu
		 *  kvotu od one koja se osvezava za minut. Bez toga `retry-after` od 36s
		 *  zavara: sacekas minut, vratis se, i opet puknes — jer je dnevna kvota
		 *  potrosena do ponoci (Pacific). Tekst je DVOSTRUKO escape-ovan
		 *  (`\"quotaId\": \"...\"`), pa regex trpi i `\` i navodnike.
		 *  Poznati oblici:
		 *    GenerateContentInputTokensPerModelPerMinute-FreeTier   -> tpm
		 *    GenerateRequestsPerMinutePerProjectPerModel-FreeTier   -> rpm
		 *    GenerateRequestsPerDayPerProjectPerModel-FreeTier      -> rpd
		 *  @returns {{kind: "tpm"|"rpm"|"rpd"|"unknown", id: string}} */
		function parseGeminiQuota(errText) {
			var result = { kind: "unknown", id: "" };
			if (typeof errText !== "string" || errText.length === 0) return result;
			var m = errText.match(/quotaId\\?["']?\s*:\s*\\?["']?([A-Za-z0-9_-]+)/);
			if (m) result.id = m[1];
			var metricMatch = errText.match(/quotaMetric\\?["']?\s*:\s*\\?["']?([A-Za-z0-9_.-]+)/);
			var metric = metricMatch ? metricMatch[1] : "";
			if (/PerDay/i.test(result.id) || /PerDay/i.test(metric)) result.kind = "rpd";
			else if (/RequestsPerMinute/i.test(result.id) || /request/i.test(metric)) {
				result.kind = /PerDay/i.test(result.id) ? "rpd" : "rpm";
			} else if (/PerMinute/i.test(result.id) || /token/i.test(metric)) result.kind = "tpm";
			return result;
		}

		/** Koliko ms do sledece ponoci po PACIFICU — tada se resetuje RPD.
		 *  Koristi Intl (platformska tz baza) umesto fiksnog offseta, jer se
		 *  PST/PDT smenjuju. Ako Intl zakaze, uzmi konzervativnih 6h. */
		function msUntilPacificMidnight() {
			try {
				var parts = new Intl.DateTimeFormat("en-US", {
					timeZone: "America/Los_Angeles",
					hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
				}).formatToParts(new Date());
				var h = 0, mi = 0, s = 0;
				for (var i = 0; i < parts.length; i++) {
					if (parts[i].type === "hour") h = Number(parts[i].value) % 24;
					else if (parts[i].type === "minute") mi = Number(parts[i].value);
					else if (parts[i].type === "second") s = Number(parts[i].value);
				}
				var elapsedSec = ((h * 60) + mi) * 60 + s;
				if (!isFinite(elapsedSec)) return 6 * 60 * 60 * 1000;
				return ((24 * 60 * 60) - elapsedSec) * 1000;
			} catch (error) {
				return 6 * 60 * 60 * 1000;
			}
		}

		/** Trajanje blokade za konkretnu kvotu. Dnevna (RPD) se ne resava
		 *  cekanjem od minut — blokiraj do ponoci po Pacifiku. */
		function geminiBlockMsFor(quota, errText) {
			if (quota && quota.kind === "rpd") return msUntilPacificMidnight() + 60000;
			return parseGeminiRetryAfterMs(errText);
		}

		/** Vazeca blokada = kasnija od (stanje u memoriji, localStorage). Drugi
		 *  tab ili sesija moze da upise blokadu koju ovaj state nije video — a
		 *  RPD vazi za ceo PROJEKAT, ne samo za ovaj tab, pa je deljenje preko
		 *  localStorage-a jedini nacin da se to vidi. */
		function geminiBlockInfo(state) {
			var stored = storedGeminiBlock();
			var memUntil = state && state.geminiBlockedUntil ? state.geminiBlockedUntil : 0;
			if (stored.until > memUntil) return { until: stored.until, kind: stored.kind };
			return {
				until: memUntil,
				kind: state && state.geminiBlockKind ? state.geminiBlockKind : "unknown",
			};
		}

		/** Preostalo vreme blokade Geminija; 0 znaci "nije blokiran". */
		function geminiBlockedRemainingMs(state) {
			var remaining = geminiBlockInfo(state).until - Date.now();
			return remaining > 0 ? remaining : 0;
		}

		/** Ljudski opis blokade za label. */
		function geminiBlockReason(state) {
			var kind = geminiBlockInfo(state).kind;
			if (kind === "rpd") return "dnevna kvota (RPD)";
			if (kind === "rpm") return "429 (RPM)";
			if (kind === "tpm") return "429 (TPM)";
			return "429";
		}

		/** Sacuvaj blokadu preko reload-a — inace bi refresh zaboravio da je
		 *  Google upravo vratio 429 i odmah opet skocio na Gemini. Cuva se i
		 *  VRSTA kvote: RPD blokada traje do ponoci, pa bi pogresno procitan
		 *  `kind` posle reload-a dao pogresan label i pogresnu logiku. */
		function persistGeminiBlock(until, kind) {
			try {
				window.localStorage.setItem(GEMINI_SEEK_BLOCK_STORAGE_KEY,
					JSON.stringify({ until: until, kind: kind || "unknown" }));
			} catch (error) { /* privatni tab / blokiran storage — samo ne prezivi reload */ }
		}
		function storedGeminiBlock() {
			try {
				var raw = window.localStorage.getItem(GEMINI_SEEK_BLOCK_STORAGE_KEY);
				if (raw === null) return { until: 0, kind: "unknown" };
				var parsed = JSON.parse(raw);
				if (parsed && isFinite(parsed.until) && parsed.until > 0) {
					return { until: parsed.until, kind: parsed.kind || "unknown" };
				}
				return { until: 0, kind: "unknown" };
			} catch (error) {
				return { until: 0, kind: "unknown" };
			}
		}

		/**
		 * „Da li se smart pali SAM, bez korisnikovog klika?"
		 *
		 * PRAVILO (2026-10-07, revidirano istog dana):
		 *   • PRAZNA, tek napravljena sesija (dugme „+") → DA, smart je
		 *     podrazumevano stanje. To je jedina sesija u kojoj korisnik još
		 *     nije potrošio DeepSeek kontekst, pa prvi (mali) prompt treba da
		 *     ide Geminiju.
		 *   • Postojeći razgovor sa istorijom → NE. Smart se tamo upali samo ako
		 *     ga je `branch-into-new-session` ruta označila kao smart start
		 *     (per-session oznaka `…-on-<id>`, vidi `sessionSmartMarked`) ili
		 *     ako korisnik klikne 😎.
		 *
		 * Zašto drugo pravilo: ranije je ovde bila GLOBALNA preferencija sa
		 * defaultom `true` (`composer-extras-gemini-seek-default-enabled`), pa
		 * se pri svakom OTVARANJU BILO KOJE sesije — i postojeće, nebranchovane
		 * — uključivao smart i `activateGeminiSeek` je odmah prebacivao model te
		 * sesije na Gemini. Korisnik je to 2026-10-07 prijavio kao „sam se
		 * uključio Smart mode kada sam se prebacio na razgovor".
		 *
		 * Zašto prvo pravilo: prva verzija fix-a je ugasila default SVUDA, pa je
		 * i obična nova prazna sesija ostajala bez smart-a; korisnik je to
		 * eksplicitno odbio („obična nova prazna sesija treba da bude na smart").
		 *
		 * Stari globalni ključ se NAMERNO ne čita: da se čita, ranije upisano
		 * "true" bi i dalje palilo smart svuda. Oznaka `…-off-<id>` i dalje
		 * pobeđuje sve (korisnikov klik).
		 */
		function geminiSeekDefaultEnabled(ctx, sessionId) {
			return sessionAuthoritativelyBlank(ctx, sessionId);
		}

		/**
		 * Da li HOST tvrdi da je ta sesija još PRAZNA (novokreirana preko „+")?
		 *
		 * `blank` je DSH-ov sopstveni flag za „New Session" preuzimanje
		 * (`SessionSummary.blank` u `sessions.list`), izveden iz
		 * `sessionListMetadata.blank` — „folded prefix nema nijedan turn".
		 *
		 * ALI: DSH klijent drži listu kao `pending` dok host lista ne stigne, a
		 * Session objekat za nepoznatu sesiju počinje kao „conservatively blank"
		 * (`session.d.ts`: „unknown bare sessions begin conservatively blank").
		 * Zato se `blank: true` sme čitati kao dokaz svežine SAMO kad je lista
		 * stvarno stigla (`phase === "ready"`); u suprotnom je to privremena
		 * vrednost koja bi restart-om vratila smart u razgovor sa istorijom.
		 */
		function sessionAuthoritativelyBlank(ctx, sessionId) {
			try {
				var sessions = ctx.sessions;
				if (sessions === undefined || sessions.list === undefined) return false;
				var snapshot = sessions.list.getSnapshot();
				if (!snapshot || snapshot.phase !== "ready") return false;
				var row = snapshot.byId[sessionId];
				return row !== undefined && row.blank === true;
			} catch (error) {
				return false;
			}
		}

		/**
		 * Per-session oznaka za sesije koje je `branch-into-new-session` startovao
		 * „smart" (server im je pre prvog prompta izabrao Gemini).
		 *
		 * Zašto postoji: jedina stvar koja od 2026-10-07 automatski pali smart
		 * jeste ova oznaka — branch ruta je TOJ sesiji već izabrala Gemini za
		 * prvi prompt, pa klijent mora da nastavi smart raspored (inače indikator
		 * stoji „disabled" iako je prvi prompt otišao na Gemini).
		 * Oznaka je trajna (localStorage), pa preživi reload stranice i restart
		 * servera (server mapa `BRANCH_SMART_SESSIONS` je samo za prvi upis).
		 */
		var GEMINI_SEEK_SESSION_KEY_PREFIX = "composer-extras-gemini-seek-on-";
		/**
		 * Per-session "I turned it OFF here" mark. An explicit 😎 click has to
		 * survive a remount (page refresh, switching to another session and
		 * back) — otherwise a session the server marked as smart-branched
		 * re-enabled itself on EVERY mount and switched the model to Gemini in
		 * the middle of an answer, which is exactly what the toggle was supposed
		 * to stop. ON mark always loses to this one.
		 */
		var GEMINI_SEEK_SESSION_OFF_PREFIX = "composer-extras-gemini-seek-off-";
		function sessionSmartOff(sessionId) {
			try {
				return window.localStorage.getItem(GEMINI_SEEK_SESSION_OFF_PREFIX + sessionId) === "1";
			} catch (error) {
				return false;
			}
		}
		function markSessionSmartOff(sessionId, off) {
			try {
				if (off) window.localStorage.setItem(GEMINI_SEEK_SESSION_OFF_PREFIX + sessionId, "1");
				else window.localStorage.removeItem(GEMINI_SEEK_SESSION_OFF_PREFIX + sessionId);
			} catch (error) {
				// best-effort
			}
		}
		function sessionSmartMarked(sessionId) {
			try {
				return window.localStorage.getItem(GEMINI_SEEK_SESSION_KEY_PREFIX + sessionId) === "1";
			} catch (error) {
				return false;
			}
		}
		function markSessionSmart(sessionId) {
			try {
				window.localStorage.setItem(GEMINI_SEEK_SESSION_KEY_PREFIX + sessionId, "1");
			} catch (error) {
				// best-effort
			}
		}
		/** Sesije za koje je branch-info već proveren (da ne šaljemo GET svaki mount). */
		var branchInfoChecked = {};

		/**
		 * Koliko puta (i koliko često) čekamo token-meter projekciju pre nego što
		 * odluku donesemo bez nje: 12 × 250ms ≈ 3s. Replay velike sesije posle
		 * restarta obično stigne ranije, a duže čekanje bi značilo da korisnik
		 * gleda ugašeno dugme bez razloga.
		 */
		var GEMINI_SEEK_CONTEXT_MAX_ATTEMPTS = 12;
		var GEMINI_SEEK_CONTEXT_RETRY_MS = 250;
		/** Sesije koje već čekaju projekciju — da se čekanje ne zakaže dvaput. */
		var geminiSeekContextPending = {};

		/**
		 * Sigurnosna mreža za aktivaciju koja je prošla bez POZNATE veličine
		 * konteksta (ručni 😎 klik, ili prazna sesija koja je u međuvremenu dobila
		 * istoriju): kad projekcija stigne, ako je sesija prevelika — ugasi smart,
		 * skini model sa Gemini-ja i zapamti „off".
		 *
		 * Kod automatskog paljenja ovo NIJE potrebno (tamo se čeka pre prebacivanja),
		 * ali ručni klik mora da ostane trenutan, pa mu ovo pokriva rep.
		 */
		function scheduleGeminiSeekTooBigWatch(ctx, sessionId) {
			var attempt = 0;
			function step() {
				if (attempt >= GEMINI_SEEK_CONTEXT_MAX_ATTEMPTS) return;
				attempt += 1;
				setTimeout(function () {
					var current = geminiSeekState[sessionId];
					if (!current || !current.enabled) return;
					var verdict = geminiContextVerdict(ctx, sessionId);
					if (verdict === "unknown") { step(); return; }
					if (verdict !== "too-big") return;
					disableGeminiSeekTooBig(ctx, sessionId, current);
				}, GEMINI_SEEK_CONTEXT_RETRY_MS);
			}
			step();
		}

		/** Start (or restart) the cycle fresh on segment 0 (Gemini) and switch onto
		 * it immediately — shared by the default-on mount path and the manual 😎
		 * toggle, so both behave identically.
		 *
		 * @param options.automatic - true when the client decided to turn smart on
		 *   by itself (blank session default or the branch „-on-" mark). Automatic
		 *   activation REFUSES to switch models on an unknown context size; the
		 *   manual click is honoured immediately and guarded by a watchdog instead.
		 * @param options.attempt - internal retry counter for the context wait. */
		function activateGeminiSeek(ctx, sessionId, notify, options) {
			var settings = options || {};
			var verdict = geminiContextVerdict(ctx, sessionId);
			// Granica od 300k: sesija koja je prerasla Gemini free tier se NE
			// vraća na Gemini — smart se gasi za tu sesiju umesto da napravi
			// zahtev koji sigurno puca na 429.
			if (verdict === "too-big") {
				delete geminiSeekContextPending[sessionId];
				geminiSeekState[sessionId] = { enabled: false, notify: notify };
				disableGeminiSeekTooBig(ctx, sessionId, geminiSeekState[sessionId]);
				return;
			}
			if (verdict === "unknown") {
				// Automatsko paljenje NIKAD ne prebacuje model na slepo: ako
				// veličina nije poznata a sesija NIJE dokazano prazna, sačekaj
				// projekciju i tek onda odluči. Bez ovoga je restart velike sesije
				// (koja nosi branch „-on-" oznaku) vraćao Gemini u nju.
				var mayWait = settings.automatic === true && !sessionAuthoritativelyBlank(ctx, sessionId);
				var attempt = settings.attempt || 0;
				if (mayWait && attempt < GEMINI_SEEK_CONTEXT_MAX_ATTEMPTS) {
					geminiSeekContextPending[sessionId] = true;
					setTimeout(function () {
						delete geminiSeekContextPending[sessionId];
						// Korisnik je u međuvremenu kliknuo 😎 (ili je drugi put
						// aktivirao smart) — ne diraj tu odluku. Samo `enabled`
						// stanje prekida čekanje; `{enabled:false}` iz mount puta
						// je i dalje samo „još nije odlučeno".
						var settled = geminiSeekState[sessionId];
						if (settled !== undefined && settled.enabled) return;
						activateGeminiSeek(ctx, sessionId, notify, { automatic: true, attempt: attempt + 1 });
					}, GEMINI_SEEK_CONTEXT_RETRY_MS);
					return;
				}
				if (mayWait) {
					delete geminiSeekContextPending[sessionId];
					geminiSeekState[sessionId] = { enabled: false, notify: notify };
					console.warn("[dsh-composer-extras] gemini-seek-smart: veličina konteksta nije poznata posle " +
						Math.round((GEMINI_SEEK_CONTEXT_MAX_ATTEMPTS * GEMINI_SEEK_CONTEXT_RETRY_MS) / 1000) +
						"s — ostajem na trenutnom modelu umesto da prebacim možda veliku sesiju na Gemini");
					return;
				}
				// Ručni klik ili dokazano prazna sesija: nastavi odmah, ali pazi da
				// sesija ne ostane na Gemini-ju ako se ispostavi da je prevelika.
				scheduleGeminiSeekTooBigWatch(ctx, sessionId);
			}
			delete geminiSeekContextPending[sessionId];
			// Ako je Google jos u retry-after prozoru, ne skaci tamo da odmah
			// puknes — pocni na DeepSeek segmentu i pusti da blokada istekne.
			var previous = geminiSeekState[sessionId];
			var stored = storedGeminiBlock();
			var previousUntil = previous && previous.geminiBlockedUntil ? previous.geminiBlockedUntil : 0;
			var blockedUntil = Math.max(previousUntil, stored.until);
			// Vrsta ide sa kasnijom (vazecom) blokadom — inace bi RPD oznaka iz
			// prethodnog stanja pretekla kracu TPM blokadu i prikazala pogresan label.
			var blockedKind = (stored.until > previousUntil)
				? stored.kind
				: (previous && previous.geminiBlockKind ? previous.geminiBlockKind : "unknown");
			var startIndex = 0;
			if (blockedUntil > Date.now()) {
				var deepseekIndex = GEMINI_SEEK_SCHEDULE.findIndex(function (s) { return s.provider !== "google"; });
				if (deepseekIndex !== -1) startIndex = deepseekIndex;
			}
			var target = GEMINI_SEEK_SCHEDULE[startIndex];
			var state = {
				enabled: true,
				scheduleIndex: startIndex,
				remaining: target.count,
				segmentStartedAt: Date.now(),
				lastAppliedModel: { provider: target.provider, model: target.model },
				applyingSwitch: true, // see the same flag in ensureGeminiSeekHook's submit wrap
				notify: notify,
				geminiBlockedUntil: blockedUntil,
				geminiBlockKind: blockedKind,
			};
			geminiSeekState[sessionId] = state;
			ensureGeminiSeekHook(ctx, sessionId);
			ensureModelSelected(ctx, sessionId, target).catch(function (error) {
				console.warn("[dsh-composer-extras] gemini-seek-smart model switch failed:", error);
			}).finally(function () {
				state.applyingSwitch = false;
			});
		}

		var GEMINI_SEEK_SEGMENT_LABELS = {
			"google": "Gemini Flash-Lite",
			"deepseek-official": "DeepSeek v4.1 Flash",
		};

		function geminiSeekLabel(sessionId) {
			var state = geminiSeekState[sessionId];
			if (!state || !state.enabled) return "gemini-seek-smart (off) — 2 Gemini prompts, pa 60s cooldown na DeepSeek-u";
			var blockedMs = geminiBlockedRemainingMs(state);
			if (blockedMs > 0) {
				return "gemini-seek-smart: Gemini blokiran, " + geminiBlockReason(state) + " — jos " + Math.ceil(blockedMs / 1000) + "s na DeepSeek-u";
			}
			var seg = GEMINI_SEEK_SCHEDULE[state.scheduleIndex];
			var label = GEMINI_SEEK_SEGMENT_LABELS[seg.provider] || seg.provider;
			if (seg.kind === "count") {
				var used = seg.count - state.remaining;
				return "gemini-seek-smart: " + label + " (" + used + "/" + seg.count + ")";
			}
			var elapsedMs = state.segmentStartedAt !== undefined ? Date.now() - state.segmentStartedAt : 0;
			var remainingSec = Math.max(0, Math.ceil((seg.cooldownMs - elapsedMs) / 1000));
			return "gemini-seek-smart: " + label + " (cooldown " + remainingSec + "s)";
		}

		/** Switch the session's active model only if it isn't already `target`. */
		function ensureModelSelected(ctx, sessionId, target) {
			var directory = ctx.modelDirectories.directoryFor(sessionId);
			var current = directory.store.getSnapshot().current;
			if (current && current.provider === target.provider && current.model === target.model) {
				return Promise.resolve();
			}
			return directory.select({ provider: target.provider, model: target.model });
		}

		/**
		 * Install the input.submit() wrap for this session, once
		 * (`__composerExtrasSeekWrapped` guards against a re-mounted button
		 * re-wrapping an already-wrapped instance). SessionInputShell.submit is a
		 * regular prototype method (dsh-client-ui-conversation's client.js,
		 * `SessionInputShell.prototype.submit`), not a getter — an own-property
		 * assignment on this specific session's instance shadows it safely,
		 * standard JS, nothing exotic. Every send routes through this ONE method
		 * (native Enter/Send button, and our own sendQuickText for Try
		 * again/Proceed) — wrapping it here, instead of e.g. only wrapping our own
		 * buttons, is what makes the prompt count reflect every message the user
		 * actually sends, not just clicks on our UI.
		 */
		function ensureGeminiSeekHook(ctx, sessionId) {
			try {
				var actx = ctx.sessions.scope(sessionId);
				if (actx === undefined) return;
				var conversation = ctx.get("conversation");
				if (conversation === undefined) return;
				var input = conversation.input.for(actx);
				if (!input.__composerExtrasSeekWrapped) {
					input.__composerExtrasSeekWrapped = true;
					var originalSubmit = input.submit.bind(input);
					input.submit = function (mode) {
						var state = geminiSeekState[sessionId];
						if (!state || !state.enabled) return originalSubmit(mode);
						var seg = GEMINI_SEEK_SCHEDULE[state.scheduleIndex];
						// Partial-count staleness check FIRST, before deciding whether to
						// advance — a stale PARTIAL count must never look like "2 used, ready
						// to advance to DeepSeek," it should look like "0 used, fresh window."
						// `remaining > 0` is the load-bearing half of this condition: fully
						// spent (remaining === 0) is NOT "partial," it's "done, due to
						// advance regardless of how long that took" — without this check, a
						// full 2-of-2 use followed by any pause over windowMs looked
						// identical to a stale partial one and got reset back to a fresh
						// budget instead of advancing to DeepSeek (bug: a 3rd message sent
						// after a long pause stayed on Gemini instead of switching).
						if (seg.kind === "count" && seg.windowMs !== undefined && state.remaining > 0 && state.remaining < seg.count &&
							state.segmentStartedAt !== undefined && (Date.now() - state.segmentStartedAt) >= seg.windowMs) {
							state.remaining = seg.count;
							state.segmentStartedAt = Date.now();
						}
						var dueToAdvance = seg.kind === "count"
							? state.remaining <= 0
							: state.segmentStartedAt !== undefined && (Date.now() - state.segmentStartedAt) >= seg.cooldownMs;
						if (dueToAdvance) {
							var nextIndex = (state.scheduleIndex + 1) % GEMINI_SEEK_SCHEDULE.length;
							var nextSeg = GEMINI_SEEK_SCHEDULE[nextIndex];
							if (nextSeg.provider === "google" && geminiBlockedRemainingMs(state) > 0) {
								// Google je vratio 429 sa retry-after koji jos traje. Prelazak
								// tamo bi odmah pukao i izazvao bespotreban "try again" krug —
								// produzi boravak na trenutnom (DeepSeek) segmentu i cekaj da
								// blokada istekne. Reset `segmentStartedAt` znaci da se ceka
								// pun cooldown, pa nema ceste provere.
								state.segmentStartedAt = Date.now();
								if (state.notify) state.notify();
							} else {
								state.scheduleIndex = nextIndex;
								seg = nextSeg;
								state.remaining = seg.count;
								state.segmentStartedAt = Date.now();
							}
						}
						// Ako smo iz BILO KOG razloga ostali na Gemini segmentu a
						// blokada je aktivna (drugi tab je upisao RPD, ili se stanje
						// razišlo), predji na DeepSeek. Bez ovoga bi `windowMs` reset
						// — koji namerno ZADRZAVA na Gemini-ju radi svezeg budzeta —
						// poslao zahtev u zid i vratio 429.
						if (seg.provider === "google" && geminiBlockedRemainingMs(state) > 0) {
							var fallbackIndex = GEMINI_SEEK_SCHEDULE.findIndex(function (s) { return s.provider !== "google"; });
							if (fallbackIndex !== -1) {
								state.scheduleIndex = fallbackIndex;
								seg = GEMINI_SEEK_SCHEDULE[fallbackIndex];
								state.remaining = seg.count;
								state.segmentStartedAt = Date.now();
								var info = geminiBlockInfo(state);
								state.geminiBlockedUntil = info.until;
								state.geminiBlockKind = info.kind;
							}
						}
						// Granica od 300k: ovo je tačno onaj trenutak u kojem bi
						// smart prebacio model NA Gemini. Ako je sesija prerasla
						// free tier, umesto prebacivanja se smart gasi za ovu
						// sesiju i prompt ide na trenutnom (DeepSeek) modelu.
						if (seg.provider === "google" && geminiTooBigForSession(ctx, sessionId)) {
							disableGeminiSeekTooBig(ctx, sessionId, state);
							// NE šalji na modelu koji je možda ostao izabran: ako je
							// smart ranije prebacio sesiju na Gemini, zahtev bi otišao
							// tamo i pukao na 429. Skini je sa Gemini-ja PA pošalji.
							var deepseekFallback = GEMINI_SEEK_SCHEDULE.filter(function (s) { return s.provider !== "google"; })[0];
							if (deepseekFallback === undefined) return originalSubmit(mode);
							return ensureModelSelected(ctx, sessionId, deepseekFallback).then(function () {
								return originalSubmit(mode);
							}).catch(function (error) {
								console.warn("[dsh-composer-extras] gemini-seek-smart: povratak na DeepSeek nije uspeo, šaljem na trenutnom modelu:", error);
								return originalSubmit(mode);
							});
						}
						var target = seg;
						if (seg.kind === "count") state.remaining -= 1;
						state.lastAppliedModel = { provider: target.provider, model: target.model };
						// Suppresses the store watcher below for the FULL duration of our
						// own select() call — comparing against lastAppliedModel alone was
						// racy: the store can fire intermediate/transitional change events
						// while select() is still settling, and those don't necessarily
						// carry the final target yet, so the watcher saw what looked like
						// an unexpected change and disabled gemini-seek-smart on its OWN
						// automatic switch (the bug: cycling to DeepSeek turned the toggle
						// off, which then also silently broke the 60s auto-return-to-Gemini
						// since nothing runs once `enabled` is false). A flag that blanks
						// out ALL watcher activity while we're mid-switch, regardless of
						// what transitional values pass through, closes that race outright.
						state.applyingSwitch = true;
						if (state.notify) state.notify();
						// Switch (if needed) BEFORE sending, so this prompt itself lands on
						// the right model — not "switch after," which would only take
						// effect starting the NEXT prompt.
						return ensureModelSelected(ctx, sessionId, target).then(function () {
							state.applyingSwitch = false;
							return originalSubmit(mode);
						}).catch(function (error) {
							state.applyingSwitch = false;
							console.warn("[dsh-composer-extras] gemini-seek-smart model switch failed, sending on current model instead:", error);
							return originalSubmit(mode);
						});
					};
				}

				// Separate guard (on the directory, not the input) so this still
				// installs even when the submit wrap above was already done in an
				// earlier call — a re-mounted button component calls this again on
				// every mount, and both guards need to be independently idempotent.
				var directory = ctx.modelDirectories.directoryFor(sessionId);
				if (!directory.__composerExtrasSeekWatched) {
					directory.__composerExtrasSeekWatched = true;
					directory.store.subscribe(function () {
						var state = geminiSeekState[sessionId];
						if (!state || !state.enabled) return;
						if (state.applyingSwitch) return; // our own switch is still in flight — ignore all noise until it settles
						var current = directory.store.getSnapshot().current;
						if (!current) return;
						var expected = state.lastAppliedModel;
						// Matches what WE just set (or haven't set yet, first tick) — not
						// an external change, nothing to react to.
						if (expected && current.provider === expected.provider && current.model === expected.model) return;
						// The active model changed to something gemini-seek-smart didn't
						// request — the user picked one by hand in the normal dropdown.
						// Respect that and stop overriding their choice.
						state.enabled = false;
						// ...i ZAPAMTI to: bez per-session „off" oznake je važilo samo
						// do prvog remount-a, pa je restart/reload vraćao smart (i
						// Gemini) u sesiju u kojoj ga je korisnik upravo ugasio —
						// prijavljeno 2026-10-07 („restart je uzrokovao da se smart
						// dugme uključi za ovu sesiju").
						markSessionSmartOff(sessionId, true);
						if (state.notify) state.notify();
					});
				}

				// Immediate 429 reaction: `ctx.sessions.get(sessionId)` (dsh-client-runtime's
				// Session class) exposes `lastAgentError` — "the only outlet for live
				// failures with no turn position" per its own doc comment, set by
				// `handleAgentError(message)` and cleared to null at the START of every
				// `prompt()` call. `session.notifier` is the SAME subscribe/markDirty
				// store shape as `directory.store` above (dsh-client-runtime's Notifier
				// class), so this is a real reactive hook, not polling or DOM reading.
				// Reacting here means a 429 on the very FIRST Gemini prompt switches
				// immediately, instead of waiting for the count/window budget to exhaust.
				// NOTE: `ctx.sessions` is dsh-client-runtime's SessionRuntime, which has
				// NO `.get()` (that's SessionManager's internal method, never provided).
				// Resolve the Session object through its public `binding(id)` face —
				// `binding(sessionId)?.session` is the Session instance exposing
				// `lastAgentError` + `notifier`. The old `ctx.sessions.get(sessionId)`
				// threw a TypeError that the outer catch swallowed, so the 429 watcher
				// was NEVER installed and the auto "try again" never fired.
				var session = ctx.sessions.binding(sessionId)?.session;
				if (session && !session.__composerExtrasErrorWatched) {
					session.__composerExtrasErrorWatched = true;
					session.notifier.subscribe(function () {
						var state = geminiSeekState[sessionId];
						if (!state || !state.enabled) return;
						var err = session.lastAgentError;
						if (!err || typeof err !== "string") return;
						if (!AGENT_ERROR_429_PATTERN.test(err)) return;
						if (err === state.lastHandledAgentError) return; // already reacted to this exact error
						var seg = GEMINI_SEEK_SCHEDULE[state.scheduleIndex];
						if (seg.provider !== "google") return; // only jump early off the Gemini segment
						var deepseekIndex = GEMINI_SEEK_SCHEDULE.findIndex(function (s) { return s.provider !== "google"; });
						if (deepseekIndex === -1) return;
						state.lastHandledAgentError = err;
						// Zapamti KOJA je kvota pukla. Dnevna (RPD) se ne resava
						// cekanjem od minut — blokira se do ponoci po Pacifiku,
						// inace bi `retry-after` od 36s zavarao i vracali bismo se
						// u isti zid ceo dan.
						var quota = parseGeminiQuota(err);
						var blockMs = geminiBlockMsFor(quota, err);
						if (blockMs > 0) {
							state.geminiBlockedUntil = Date.now() + blockMs;
							state.geminiBlockKind = quota.kind;
							persistGeminiBlock(state.geminiBlockedUntil, quota.kind);
						}
						var target = GEMINI_SEEK_SCHEDULE[deepseekIndex];
						state.scheduleIndex = deepseekIndex;
						state.remaining = target.count;
						state.segmentStartedAt = Date.now();
						state.lastAppliedModel = { provider: target.provider, model: target.model };
						state.applyingSwitch = true;
						if (state.notify) state.notify();
						ensureModelSelected(ctx, sessionId, target).catch(function (error) {
							console.warn("[dsh-composer-extras] gemini-seek-smart 429-triggered model switch failed:", error);
						}).finally(function () {
							state.applyingSwitch = false;
							sendQuickText(ctx, sessionId, "try again");
						});
					});
				}
			} catch (error) {
				console.warn("[dsh-composer-extras] gemini-seek-smart hook install failed:", error);
			}
		}

		/**
		 * Pročitaj TRENUTNI draft bez diranja (za grananje u novu sesiju: ono
		 * što je korisnik otkucao je prompt koji nova sesija dobija).
		 */
		function readDraft(ctx, sessionId) {
			try {
				var actx = ctx.sessions.scope(sessionId);
				if (actx === undefined) return "";
				var conversation = ctx.get("conversation");
				if (conversation === undefined) return "";
				var snapshot = conversation.input.for(actx).state.getSnapshot();
				return typeof snapshot.draft === "string" ? snapshot.draft : "";
			} catch (error) {
				return "";
			}
		}

		/**
		 * Obriši draft u izvornoj sesiji posle USPEŠNOG grananja.
		 *
		 * Bez ovoga tekst ostaje u starom prozoru i može da se pošalje tamo —
		 * tačno simptom koji je korisnik prijavio 2026-10-07 („tekst je otišao u
		 * pogrešan prozor"). Draft je per-session, pa grananje u novu sesiju ne
		 * dira composer stare; briše se tek pošto je nova sesija potvrđena, da
		 * neuspeo branch ne pojede korisnikov tekst.
		 */
		function clearDraft(ctx, sessionId) {
			try {
				var actx = ctx.sessions.scope(sessionId);
				if (actx === undefined) return false;
				var conversation = ctx.get("conversation");
				if (conversation === undefined) return false;
				conversation.input.for(actx).setDraft("");
				return true;
			} catch (error) {
				console.warn("[dsh-composer-extras] draft clear failed:", error);
				return false;
			}
		}

		/**
		 * Ubaci novi red u draft (a NE poslati poruku). Postojeći `appendToDraft`
		 * spaja razmakom i pravi `" \n"`, što pojede praznu liniju — zato ovo
		 * ide mimo njega.
		 */
		function insertDraftNewline(ctx, sessionId) {
			try {
				var actx = ctx.sessions.scope(sessionId);
				if (actx === undefined) return false;
				var conversation = ctx.get("conversation");
				if (conversation === undefined) return false;
				var input = conversation.input.for(actx);
				var draft = input.state.getSnapshot().draft;
				input.setDraft((typeof draft === "string" ? draft : "") + "\n");
				return true;
			} catch (error) {
				console.warn("[dsh-composer-extras] newline insert failed:", error);
				return false;
			}
		}

		/**
		 * Pošalji `/komandu` a da pritom NE pregazi korisnikov draft.
		 *
		 * TRENUTNO NIJE POZVAN NIGDE: compact dugme je prešlo na
		 * `compactSession()` (server ruta), jer ovaj put vraća `true` već na
		 * `input.submit()` i ne može da razlikuje „izvršeno" od „agent nije
		 * idle". Ostaje kao gotova utilija za komande gde je dovoljno poslati.
		 *
		 * `input.submit()` je isti put koji Enter koristi, pa komanda prolazi
		 * kroz normalnu admission mašinu (nema privatnog `commandUi.execute`
		 * iz plugina). Pošto submit KONZUMIRA draft, tekst se prvo sačuva, pa
		 * vrati u prvi trenutak kada je draft ispražnjen — do tada mašina još
		 * čita poslatu liniju.
		 *
		 * Ako se komanda NE konzumira (npr. `/compact` odbije jer agent nije
		 * idle — tada composer zadrži token u draftu radi ispravke), čekanje se
		 * prekida na `deadlineMs` i korisnikov tekst se VRAĆA. Bez toga bi mu
		 * draft ostao zamenjen sa „/compact" i sledeći Enter bi ga poslao kao
		 * običan prompt.
		 */
		function sendCommandPreservingDraft(ctx, sessionId, command, deadlineMs) {
			try {
				var actx = ctx.sessions.scope(sessionId);
				if (actx === undefined) return false;
				var conversation = ctx.get("conversation");
				if (conversation === undefined) return false;
				var input = conversation.input.for(actx);
				var saved = input.state.getSnapshot().draft;
				saved = typeof saved === "string" ? saved : "";
				input.setDraft(command);
				input.submit();
				if (saved === "") return true;
				var limit = typeof deadlineMs === "number" ? deadlineMs : 1500;
				var deadline = Date.now() + limit;
				var timer = setInterval(function () {
					var now = input.state.getSnapshot().draft;
					now = typeof now === "string" ? now : "";
					if (now === "") {
						// Mašina je uzela komandu — vrati korisnikov tekst.
						clearInterval(timer);
						input.setDraft(saved);
					} else if (now !== command || Date.now() > deadline) {
						// Korisnik je počeo da kuca preko komande → ne diraj.
						// Ili komanda nije konzumirana do roka → vrati njegov tekst.
						clearInterval(timer);
						if (now === command) input.setDraft(saved);
					}
				}, 50);
				return true;
			} catch (error) {
				console.warn("[dsh-composer-extras] command send failed:", error);
				return false;
			}
		}

		/**
		 * Grananje u NOVU, praznu sesiju u istom workspace-u i prebacivanje GUI-ja
		 * na nju. Server ruta (`index.js` /api/branch-session) NE kopira istoriju
		 * — nova sesija dobija isključivo prosleđeni prompt (za razliku od
		 * ugrađene „Branch into a new conversation" ikonice koja radi
		 * `sessions.fork` i PREKOPIRAVA istoriju do tog mesta).
		 *
		 * `uiWorkspace` se traži lenjo (`ctx.get`) i sme da nedostaje: tada se
		 * sesija i dalje napravi, samo ostane bez automatskog prebacivanja
		 * prikaza — bolje nego da ceo plugin zavisi od tog servisa.
		 */
		function branchIntoNewSession(ctx, sessionId, prompt) {
			return callApi("/composer-extras/api/branch-session", {
				prompt: prompt,
				parentSession: sessionId,
			}).then(function (value) {
				var newId = value && value.sessionId ? value.sessionId : undefined;
				var uiWorkspace = ctx.get("uiWorkspace");
				if (newId !== undefined && uiWorkspace !== undefined && typeof uiWorkspace.openSession === "function") {
					openSessionWithRetry(uiWorkspace, newId);
				}
				return value;
			});
		}

		/**
		 * `uiWorkspace.openSession` je SINHRON i baca `sessions.retain: unknown
		 * session <id>` dok god klijent nije dobio novu sesiju preko RPC stream-a
		 * — a plugin ruta odgovori PRE toga (dva nezavisna kanala). Bez ponovnih
		 * pokušaja bi ceo branch tiho ostao bez prebacivanja prikaza, pa bi
		 * korisnik gledao staru sesiju dok je njegov tekst u novoj.
		 *
		 * Osam pokušaja po ~400 ms je dovoljno da stream stigne; ako ni tada ne
		 * uspe, prijava ide u `composer-diag.log` (Android Chrome nema konzolu).
		 */
		function openSessionWithRetry(uiWorkspace, sessionId, attemptsLeft) {
			var left = typeof attemptsLeft === "number" ? attemptsLeft : 8;
			var attempt = function () {
				try {
					uiWorkspace.openSession(sessionId);
					return true;
				} catch (error) {
					left -= 1;
					if (left > 0) {
						setTimeout(attempt, 400);
						return false;
					}
					console.warn("[dsh-composer-extras] openSession nije uspeo za", sessionId, error);
					reportDiag({
						where: "branch-open-session-failed",
						created: String(sessionId),
						message: String(error && error.message ? error.message : error),
					});
					return false;
				}
			};
			return attempt();
		}

		/**
		 * „Compact sada" u ZAHTEVANOJ sesiji — preko server rute
		 * `/composer-extras/api/compact`, koja komandu izvršava u realm-u tog
		 * agenta i vraća PRAVI ishod.
		 *
		 * Zašto ne `sendCommandPreservingDraft(…, "/compact")`: taj put vraća
		 * `true` već na `input.submit()`, pa je razlika između „kompaktovano" i
		 * „agent nije idle, ništa nije urađeno" nevidljiva (izmereno 2026-10-07:
		 * 3 od 5 klikova su odbijena sa `busy`, a korisnik je video tišinu).
		 *
		 * `waitMs` je koliko server čeka da tekući turn pređe u `idle` pre nego
		 * što odustane — kompakcija u toku turna nije dozvoljena, pa je čekanje
		 * jedini način da klik „na zahtev" stvarno prođe.
		 */
		function compactSession(sessionId, waitMs) {
			return callApi("/composer-extras/api/compact", {
				sessionId: sessionId,
				waitMs: waitMs,
			});
		}

		/** Shared {ok,value}/{ok,error} envelope fetch — same shape on both routes below. */
		function callApi(url, payload) {
			return fetch(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload),
			}).then(function (res) {
				return res.json().catch(function () { return null; }).then(function (parsed) {
					if (!res.ok || !parsed || parsed.ok !== true || parsed.value === undefined) {
						var msg = (parsed && parsed.error && parsed.error.message) || ("HTTP " + res.status);
						throw new Error(msg);
					}
					return parsed.value;
				});
			});
		}

		/** Fire-and-forget client diagnostics (server side: index.js /api/diag).
		 * Deliberately never throws and never awaits: a logging failure must not
		 * be able to break a button, it only costs us the log line. */
		function reportDiag(payload) {
			try {
				fetch("/composer-extras/api/diag", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload),
				}).catch(function () {});
			} catch (error) {
				/* ignore */
			}
		}

		/** dsh-better-sidebar's own JSON API — workspace-scoped, rejects paths above cwd. */
		function sidebarApi(method, payload) {
			return callApi("/sidebar/api/" + method, payload);
		}

		/**
		 * Our own route (dsh-composer-extras/index.js) — deliberately NOT
		 * workspace-scoped, user-approved. Only reachable once the picker has been
		 * explicitly stepped into "unrestricted" mode (see goUp() below).
		 */
		function unrestrictedApi(absolutePath) {
			return callApi("/composer-extras/api/fs-tree-unrestricted", { path: absolutePath });
		}

		/** Browser File -> base64 (no Buffer in the browser), stripping the data: URL prefix. */
		function fileToBase64(file) {
			return new Promise(function (resolve, reject) {
				var reader = new FileReader();
				reader.onerror = function () { reject(reader.error || new Error("file read failed")); };
				reader.onload = function () {
					var result = String(reader.result || "");
					var comma = result.indexOf(",");
					resolve(comma === -1 ? result : result.slice(comma + 1));
				};
				reader.readAsDataURL(file);
			});
		}

		/** Binary-safe upload into `targetDir` (wherever the picker is currently
		 * browsing, not a fixed subfolder); resolves to the absolute path dsh wrote
		 * to (not a mention string — callers that want `@path` build it themselves, the
		 * picker below wants the raw path to navigate the tree onto it instead). Used
		 * for both Galerija and Sa telefona — SAF/gallery-picked files come in as
		 * browser blobs either way, and dsh-better-sidebar's own /sidebar/api can't
		 * reach Termux's private app storage from that picker, so upload is the only
		 * path into the directory for anything not already on disk there. */
		function uploadFileToWorkspace(sessionId, file, targetDir) {
			return fileToBase64(file).then(function (contentBase64) {
				return callApi("/composer-extras/api/upload-to-workspace", {
					sessionId: sessionId,
					filename: file.name,
					contentBase64: contentBase64,
					targetDir: targetDir,
				});
			}).then(function (value) {
				return value.path;
			});
		}

		var paperclipPath = createElement("path", {
			d: "M21.44 11.05l-9.19 9.19a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a1.5 1.5 0 0 1-2.12-2.12l8.49-8.48",
			stroke: "currentColor",
			strokeWidth: 1.6,
			strokeLinecap: "round",
			strokeLinejoin: "round",
			fill: "none",
		});

		var paperclipIcon = createElement("svg", {
			width: 14,
			height: 14,
			viewBox: "0 0 24 24",
			"aria-hidden": true,
		}, paperclipPath);

		var trashPath = createElement("path", {
			d: "M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6",
			stroke: "currentColor",
			strokeWidth: 1.6,
			strokeLinecap: "round",
			strokeLinejoin: "round",
			fill: "none",
		});
		var trashIcon = createElement("svg", {
			width: 14,
			height: 14,
			viewBox: "0 0 24 24",
			"aria-hidden": true,
		}, trashPath);

		var folderIcon = createElement("span", { "aria-hidden": true }, "📁");
		var fileIcon = createElement("span", { "aria-hidden": true }, "📄");
		var upIcon = createElement("span", { "aria-hidden": true }, "⬆️");

		/**
		 * Dve unakrsne strelice („shuffle" geometrija) — oznaka za grananje u
		 * novu sesiju. Namerno se razlikuje od ugrađene `IconBranchOutlineRegular`
		 * (koja radi fork SA istorijom) da se dva dugmeta ne bi mešala.
		 */
		var branchArrowsIcon = createElement("svg", {
			width: 14,
			height: 14,
			viewBox: "0 0 24 24",
			"aria-hidden": true,
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.8,
			strokeLinecap: "round",
			strokeLinejoin: "round",
		}, [
			createElement("path", { key: "a", d: "M16 3h5v5" }),
			createElement("path", { key: "b", d: "M4 20L21 3" }),
			createElement("path", { key: "c", d: "M21 16v5h-5" }),
			createElement("path", { key: "d", d: "M15 15l6 6" }),
			createElement("path", { key: "e", d: "M4 4l5 5" }),
		]);

		/** Zakrivljena strelica „return" — ubacuje novi red umesto slanja. */
		var newlineIcon = createElement("svg", {
			width: 14,
			height: 14,
			viewBox: "0 0 24 24",
			"aria-hidden": true,
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.8,
			strokeLinecap: "round",
			strokeLinejoin: "round",
		}, [
			createElement("path", { key: "a", d: "M9 10L4 15l5 5" }),
			createElement("path", { key: "b", d: "M20 4v7a4 4 0 0 1-4 4H4" }),
		]);

		var IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"];
		function isImagePath(name) {
			var lower = name.toLowerCase();
			return IMAGE_EXTENSIONS.some(function (ext) { return lower.slice(-ext.length) === ext; });
		}
		/** Thumbnail via our own binary-streaming route (index.js's /image-preview) —
		 * not sidebar's fs.read, which returns JSON, not raw bytes an <img> can use. */
		function imageThumbnail(absolutePath) {
			return createElement("img", {
				src: "/composer-extras/api/image-preview?path=" + encodeURIComponent(absolutePath),
				alt: "",
				style: { width: 22, height: 22, objectFit: "cover", borderRadius: 3, flex: "none" },
				onError: function (e) { e.target.style.visibility = "hidden"; },
			});
		}

		var rowStyle = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			padding: "6px 10px",
			cursor: "pointer",
			borderRadius: 6,
			fontSize: 13,
		};

		var modalIconButtonStyle = {
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			width: 28,
			height: 28,
			padding: 0,
			border: "none",
			borderRadius: 6,
			background: "transparent",
			color: "inherit",
			cursor: "pointer",
			fontSize: 15,
			opacity: 0.85,
		};

		var rowActionButtonStyle = {
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			width: 24,
			height: 24,
			padding: 0,
			border: "none",
			borderRadius: 5,
			background: "transparent",
			color: "inherit",
			cursor: "pointer",
			fontSize: 12,
			opacity: 0.7,
		};

		var PRIMARY_COLOR = "#2f6fed";

		function selectButtonStyle(enabled) {
			return {
				padding: "6px 14px",
				borderRadius: 6,
				border: "none",
				cursor: enabled ? "pointer" : "default",
				background: PRIMARY_COLOR,
				color: "#ffffff",
				fontWeight: 600,
				opacity: enabled ? 1 : 0.45,
			};
		}

		/** Folder-navigable file picker. Talks to dsh-better-sidebar's JSON API. */
		function FilePickerModal(props) {
			var sessionId = props.sessionId;
			var onSelect = props.onSelect;
			var onClose = props.onClose;

			var pathState = useState("");
			var path = pathState[0], setPath = pathState[1];
			// "workspace" = via dsh-better-sidebar's fs.tree (sandboxed to cwd).
			// "unrestricted" = via our own fs-tree-unrestricted route, once the
			// user has explicitly stepped outside the workspace (see goUp()).
			var modeState = useState("workspace");
			var mode = modeState[0], setMode = modeState[1];
			var cwdState = useState(null);
			var cwd = cwdState[0], setCwd = cwdState[1];
			var entriesState = useState(null);
			var entries = entriesState[0], setEntries = entriesState[1];
			var loadingState = useState(true);
			var loading = loadingState[0], setLoading = loadingState[1];
			var errorState = useState(null);
			var error = errorState[0], setError = errorState[1];
			var manualState = useState("");
			var manual = manualState[0], setManual = manualState[1];
			// Marked-but-not-yet-confirmed file — Select is the explicit second step,
			// deliberately not "click a row = attach immediately" (see module header).
			var selectedState = useState(null);
			var selected = selectedState[0], setSelected = selectedState[1];
			// Bumped after every upload to force a refetch even when it lands back on
			// the same `path` the picker was already viewing (state-unchanged effects
			// don't re-run on their own).
			var refreshTickState = useState(0);
			var refreshTick = refreshTickState[0], setRefreshTick = refreshTickState[1];
			var uploadStatusState = useState(null);
			var uploadStatus = uploadStatusState[0], setUploadStatus = uploadStatusState[1];
			// Multi-select + brisanje: `marked` je lista označenih putanja, a
			// `confirmDelete` je drugi tap na 🗑️ (brisanje je TRAJNO, nema recycle
			// bin-a), pa UI nikad ne briše iz jednog slučajnog dodira.
			var selectModeState = useState(false);
			var selectMode = selectModeState[0], setSelectMode = selectModeState[1];
			var markedState = useState([]);
			var marked = markedState[0], setMarked = markedState[1];
			var confirmDeleteState = useState(false);
			var confirmDelete = confirmDeleteState[0], setConfirmDelete = confirmDeleteState[1];
			var fileInputRef = useRef(null);
			var anyFileInputRef = useRef(null);

			useEffect(function () {
				var cancelled = false;
				setLoading(true);
				setError(null);
				setSelected(null);

				var listing;
				if (mode === "unrestricted") {
					listing = unrestrictedApi(path);
				} else {
					var ensureCwd = cwd !== null
						? Promise.resolve(cwd)
						: callApi("/composer-extras/api/session-cwd", { sessionId: sessionId }).then(function (r) { return r.cwd; });
					listing = ensureCwd.then(function (resolvedCwd) {
						if (cancelled) return undefined;
						if (cwd === null) setCwd(resolvedCwd);
						// Server requireString() rejects "" as "missing or invalid path" —
						// omit the key entirely to mean "root" (server then uses its own cwd).
						var payload = path === "" ? { sessionId: sessionId } : { sessionId: sessionId, path: path };
						return callApi("/composer-extras/api/fs-tree-workspace", payload);
					});
				}

				listing.then(function (result) {
					if (cancelled || result === undefined) return;
					// Oldest first, newest at the bottom — easiest way to spot which
					// file just landed here (e.g. after an upload), even with the image
					// thumbnail already helping identify which photo is which.
					var list = result.entries.slice().sort(function (a, b) {
						return (a.mtimeMs || 0) - (b.mtimeMs || 0);
					});
					setEntries(list);
					setLoading(false);
				}).catch(function (err) {
					if (cancelled) return;
					setError(err && err.message ? err.message : String(err));
					setLoading(false);
				});
				return function () { cancelled = true; };
				// eslint-disable-next-line
			}, [path, mode, refreshTick]);

			/** Upload picked files into wherever the picker is currently browsing (not a
			 * fixed subfolder), then refresh and pre-mark the (last) uploaded one — still
			 * requires an explicit Select click. Workspace mode only: unrestricted mode
			 * has no write route (see index.js's ensureWithinCwd), the same reason the
			 * trash button is hidden there. */
			function uploadPicked(files) {
				if (files.length === 0 || sessionId === undefined || mode !== "workspace") return;
				var targetDir = path === "" ? cwd : path;
				setUploadStatus("Otpremam...");
				var uploads = files.map(function (file) { return uploadFileToWorkspace(sessionId, file, targetDir); });
				Promise.all(uploads).then(function (paths) {
					setUploadStatus(null);
					setRefreshTick(function (n) { return n + 1; });
					setSelected(paths[paths.length - 1]);
				}).catch(function (error) {
					console.warn("[dsh-composer-extras] upload failed:", error);
					setUploadStatus("Otpremanje nije uspelo: " + (error && error.message ? error.message : String(error)));
				});
			}

			/** Create a subfolder inside wherever the picker is currently browsing. */
			function createFolder() {
				if (sessionId === undefined || mode !== "workspace") return;
				var name = window.prompt("Ime novog foldera:");
				if (name === null || name.trim() === "") return;
				var targetDir = path === "" ? cwd : path;
				setUploadStatus("Pravim folder...");
				callApi("/composer-extras/api/mkdir-in-workspace", {
					sessionId: sessionId,
					name: name.trim(),
					targetDir: targetDir,
				}).then(function () {
					setUploadStatus(null);
					setRefreshTick(function (n) { return n + 1; });
				}).catch(function (error) {
					console.warn("[dsh-composer-extras] mkdir failed:", error);
					setUploadStatus("Pravljenje foldera nije uspelo: " + (error && error.message ? error.message : String(error)));
				});
			}

			function handleImagePick(e) {
				var files = e.target.files ? Array.prototype.slice.call(e.target.files) : [];
				e.target.value = "";
				uploadPicked(files);
			}

			function handleAnyFilePick(e) {
				var files = e.target.files ? Array.prototype.slice.call(e.target.files) : [];
				e.target.value = "";
				uploadPicked(files);
			}

			/** Delete a file or folder (workspace mode only — our own
			 * delete-in-workspace route, workspace-scoped like upload/mkdir;
			 * unrestricted mode has no write route, deliberately, since that side is
			 * read-only by design). Works on any entry, not just the marked one — see
			 * the per-row 🗑️ in rows() below, which is the "fewer clicks" version of
			 * this same action; the footer trash button just calls it with `selected`. */
			function deleteEntry(entryPath) {
				if (mode !== "workspace") return;
				if (!window.confirm("Trajno obrisati \"" + entryPath + "\"?")) return;
				setUploadStatus("Brisem...");
				callApi("/composer-extras/api/delete-in-workspace", { sessionId: sessionId, path: entryPath }).then(function () {
					setUploadStatus(null);
					if (entryPath === selected) setSelected(null);
					setRefreshTick(function (n) { return n + 1; });
				}).catch(function (error) {
					console.warn("[dsh-composer-extras] delete failed:", error);
					setUploadStatus("Brisanje nije uspelo: " + (error && error.message ? error.message : String(error)));
				});
			}

			/** Rename a file or folder in place — our own rename-in-workspace route
			 * (dsh-better-sidebar has no fs.rename at all, same gap as fs.delete above). */
			function renameEntry(entryPath, currentName) {				if (mode !== "workspace") return;
				var newName = window.prompt("Novo ime:", currentName);
				if (newName === null || newName.trim() === "" || newName.trim() === currentName) return;
				setUploadStatus("Preimenujem...");
				callApi("/composer-extras/api/rename-in-workspace", { sessionId: sessionId, path: entryPath, newName: newName.trim() }).then(function (value) {
					setUploadStatus(null);
					if (entryPath === selected) setSelected(value.path);
					setRefreshTick(function (n) { return n + 1; });
				}).catch(function (error) {
					console.warn("[dsh-composer-extras] rename failed:", error);
					setUploadStatus("Preimenovanje nije uspelo: " + (error && error.message ? error.message : String(error)));
				});
			}

			/** Označi/odznači jednu putanju (multi-select). */
			function toggleMark(entryPath) {
				setConfirmDelete(false);
				setMarked(function (current) {
					return current.indexOf(entryPath) === -1
						? current.concat([entryPath])
						: current.filter(function (p) { return p !== entryPath; });
				});
			}

			/** Briše SVE označeno — na drugi tap (prvi samo armira dugme). */
			function deleteMarked() {
				if (marked.length === 0) return;
				if (!confirmDelete) {
					setConfirmDelete(true);
					setUploadStatus("Potvrdi: " + marked.length + " fajl(ova) se TRAJNO brise — tapni ponovo");
					return;
				}
				setUploadStatus("Brisem " + marked.length + "...");
				callApi("/composer-extras/api/delete-paths", { paths: marked, confirm: true })
					.then(function (value) {
						var failed = value.failed || 0;
						setUploadStatus("Obrisano " + value.deleted + (failed ? (", neuspesno " + failed) : ""));
						setMarked([]);
						setConfirmDelete(false);
						setRefreshTick(function (n) { return n + 1; });
					})
					.catch(function (error) {
						setUploadStatus("Brisanje nije uspelo: " + (error && error.message ? error.message : String(error)));
						setConfirmDelete(false);
					});
			}

			/** Android share sheet za proizvoljan fajl iz browsera. */
			function shareEntry(entryPath) {
				setUploadStatus("Otvaram share...");
				callApi("/composer-extras/api/android-share", { path: entryPath })
					.then(function (value) {
						setUploadStatus("Share: " + ((value && value.mime) || "fajl") + (value && value.staged ? " (kopija u deljenom storage-u)" : ""));
					})
					.catch(function (error) {
						setUploadStatus("Share nije uspeo: " + (error && error.message ? error.message : String(error)));
					});
			}

			/** Roditeljski folder u Solid Exploreru. */
			function folderEntry(entryPath) {
				setUploadStatus("Otvaram folder...");
				callApi("/composer-extras/api/android-folder", { path: entryPath })
					.then(function (value) {
						setUploadStatus(value && value.staged ? "Folder: kopija u Download/dsh-share" : "Folder otvoren");
					})
					.catch(function (error) {
						setUploadStatus("Folder nije otvoren: " + (error && error.message ? error.message : String(error)));
					});
			}

			/** Parent of an absolute path ("/a/b" -> "/a", "/a" -> "/"). */
			function dirnameOf(p) {
				if (p === "/" || p === "") return "/";
				var idx = p.lastIndexOf("/");
				return idx <= 0 ? "/" : p.slice(0, idx);
			}

			function goUp() {
				if (mode === "unrestricted") {
					if (path === "/") return; // already at the filesystem root
					setPath(dirnameOf(path));
					return;
				}
				if (path === "") {
					// At the workspace root already — user-approved escape hatch,
					// switches to the unrestricted route starting one level above cwd.
					setMode("unrestricted");
					setPath(dirnameOf(cwd));
					return;
				}
				var idx = path.lastIndexOf("/");
				var parent = idx === -1 ? "" : path.slice(0, idx);
				// Landing back on cwd itself means "root" — use the "" sentinel so
				// the next fetch omits `path` instead of sending path === cwd.
				setPath(parent === cwd ? "" : parent);
			}

			function rows() {
				var out = [];
				var showUp = mode === "unrestricted" ? path !== "/" : true;
				if (showUp) {
					out.push(createElement("div", {
						key: "..",
						style: rowStyle,
						onClick: goUp,
						onMouseEnter: function (e) { e.currentTarget.style.background = "rgba(128,128,128,0.15)"; },
						onMouseLeave: function (e) { e.currentTarget.style.background = "transparent"; },
					}, upIcon, mode === "workspace" && path === "" ? ".. (izadji iz workspace-a)" : ".."));
				}
				if (entries) {
					entries.forEach(function (entry) {
						var isSelected = !entry.isDir && entry.path === selected;
						var isMarked = marked.indexOf(entry.path) !== -1;
						var icon = entry.isDir ? folderIcon : (isImagePath(entry.name) ? imageThumbnail(entry.path) : fileIcon);
						// Rename/delete live right on the row (not just via marking-then-a
						// separate footer action) so the whole point of the redesign —
						// fewer taps to an action on a phone — also applies to editing an
						// EXISTING entry, not just picking one to attach.
						// U select modu red nosi samo kvacicu (tap = oznaci), pa se akcije
						// po redu sklanjaju da ne bi bilo promasaja prstom.
						var actions = selectMode
							? createElement("span", { style: { flex: "none", fontSize: 15, lineHeight: 1 } },
								createElement("span", { "aria-hidden": true }, isMarked ? "✅" : "⬜"))
							: createElement("span", { style: { display: "flex", gap: 2, flex: "none" } },
								createElement("button", {
									type: "button",
									title: "Podeli (Android share)",
									"aria-label": "Podeli " + entry.name,
									onClick: function (e) { e.stopPropagation(); shareEntry(entry.path); },
									style: rowActionButtonStyle,
								}, createElement("span", { "aria-hidden": true }, "📤")),
								!entry.isDir ? createElement("button", {
									type: "button",
									title: "Folder u Solid Exploreru",
									"aria-label": "Folder za " + entry.name,
									onClick: function (e) { e.stopPropagation(); folderEntry(entry.path); },
									style: rowActionButtonStyle,
								}, createElement("span", { "aria-hidden": true }, "📂")) : null,
								mode === "workspace" && !selectMode ? createElement("button", {
									type: "button",
									title: "Preimenuj",
									"aria-label": "Preimenuj " + entry.name,
									onClick: function (e) { e.stopPropagation(); renameEntry(entry.path, entry.name); },
									style: rowActionButtonStyle,
								}, createElement("span", { "aria-hidden": true }, "✏️")) : null,
								mode === "workspace" && !selectMode ? createElement("button", {
									type: "button",
									title: "Obrisi",
									"aria-label": "Obrisi " + entry.name,
									onClick: function (e) { e.stopPropagation(); deleteEntry(entry.path); },
									style: rowActionButtonStyle,
								}, createElement("span", { "aria-hidden": true }, "🗑️")) : null
							);
						out.push(createElement("div", {
							key: entry.path,
							style: (isSelected || isMarked) ? Object.assign({}, rowStyle, { background: "rgba(47,111,237,0.18)" }) : rowStyle,
							title: entry.path,
							onClick: function () {
								if (selectMode) { toggleMark(entry.path); return; }
								if (entry.isDir) setPath(entry.path);
								else setSelected(entry.path);
							},
							onMouseEnter: function (e) { if (!isSelected && !isMarked) e.currentTarget.style.background = "rgba(128,128,128,0.15)"; },
							onMouseLeave: function (e) { e.currentTarget.style.background = (isSelected || isMarked) ? "rgba(47,111,237,0.18)" : "transparent"; },
						},
							icon,
							createElement("span", { style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, entry.name),
							actions
						));
					});
				}
				return out;
			}

			var body;
			if (error !== null) {
				body = createElement("div", { style: { padding: "8px 2px" } },
					createElement("div", { style: { fontSize: 12, opacity: 0.8, marginBottom: 8 } },
						"Tree pregled nije dostupan (" + error + "). Ukucaj putanju rucno:"),
					createElement("div", { style: { display: "flex", gap: 6 } },
						createElement("input", {
							type: "text",
							value: manual,
							placeholder: "putanja/do/fajla.txt",
							onChange: function (e) { setManual(e.target.value); },
							style: { flex: 1, padding: "6px 8px", fontSize: 13, borderRadius: 6, border: "1px solid currentColor", background: "transparent", color: "inherit" },
						}),
						createElement("button", {
							type: "button",
							onClick: function () { if (manual.trim() !== "") onSelect(manual.trim()); },
							style: { padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer" },
						}, "Dodaj")
					)
				);
			} else if (loading) {
				body = createElement("div", { style: { padding: "16px 2px", fontSize: 13, opacity: 0.7 } }, "Ucitavam...");
			} else {
				body = createElement("div", { style: { maxHeight: 320, overflowY: "auto" } }, rows());
			}

			return createElement("div", {
				// Ugovor sa `dsh-chat-jump-arrows`: svaka moja površina koja
				// preuzme ceo ekran mora da se označi, jer `shell.overlay`
				// (sloj strelica) stoji IZNAD composera, pa ga `zIndex: 10000`
				// odavde ne može da nadjača — strelice bi lebdele preko
				// pickera i kradle dodire (vidi 2026-10-08: teško se klikne
				// 🗑️ dok su strelice preko pickera).
				"data-dsh-overlay-surface": "file-picker",
				style: {
					position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
					display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000,
				},
				onClick: onClose,
			}, createElement("div", {
				style: {
					background: "Canvas", color: "CanvasText", borderRadius: 10,
					padding: 14, width: "min(420px, 90vw)", maxHeight: "70vh",
					boxShadow: "0 8px 30px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column", gap: 8,
				},
				onClick: function (e) { e.stopPropagation(); },
			},
				createElement("div", { style: { fontSize: 13, fontWeight: 600, opacity: 0.85, wordBreak: "break-all" } },
					// `path` is already an absolute path once set (entry.path from the
					// server, not workspace-relative) — the "" sentinel is the only
					// case that still needs `cwd` filled in.
					"Dodaj u kontekst" + (cwd ? " — " + (path === "" ? cwd : path) : "")),
				mode === "unrestricted" ? createElement("div", { style: { fontSize: 11, opacity: 0.65 } }, "🔓 van workspace-a") : null,
				body,
				uploadStatus !== null ? createElement("div", { style: { fontSize: 12, opacity: 0.8 } }, uploadStatus) : null,
				createElement("input", {
					ref: fileInputRef, type: "file", accept: "image/*",
					style: { display: "none" }, onChange: handleImagePick,
				}),
				createElement("input", {
					ref: anyFileInputRef, type: "file", multiple: true,
					style: { display: "none" }, onChange: handleAnyFilePick,
				}),
				createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
					createElement("div", { style: { display: "flex", gap: 4, alignItems: "center" } },
						// Multi-select + brisanje radi u OBA moda (workspace i unrestricted),
						// jer je i „Files" prikaz u sidebar-u nad istim diskom. Prvi tap na
						// 🗑️ samo armira, drugi briše — brisanje je trajno.
						selectMode ? createElement("span", { style: { display: "flex", gap: 4, alignItems: "center" } },
							createElement("button", {
								type: "button",
								title: "Oznaci sve u folderu",
								"aria-label": "Oznaci sve",
								onClick: function () {
									setConfirmDelete(false);
									setMarked((entries || []).map(function (e) { return e.path; }));
								},
								style: modalIconButtonStyle,
							}, createElement("span", { "aria-hidden": true }, "✅")),
							createElement("button", {
								type: "button",
								title: "Ocisti selekciju",
								"aria-label": "Ocisti selekciju",
								onClick: function () { setConfirmDelete(false); setMarked([]); },
								style: modalIconButtonStyle,
							}, createElement("span", { "aria-hidden": true }, "⬜")),
							createElement("button", {
								type: "button",
								title: confirmDelete ? "Potvrdi trajno brisanje" : "Obrisi oznacene fajlove",
								"aria-label": confirmDelete ? "Potvrdi brisanje" : "Obrisi oznacene",
								disabled: marked.length === 0,
								onClick: deleteMarked,
								style: Object.assign({}, modalIconButtonStyle, {
									width: "auto", padding: "0 10px", gap: 4,
									opacity: marked.length === 0 ? 0.35 : (confirmDelete ? 1 : 0.85),
									background: confirmDelete ? "rgba(220,53,69,0.25)" : undefined,
								}),
							}, createElement("span", { "aria-hidden": true }, "🗑️"),
								createElement("span", { style: { fontSize: 12 } }, confirmDelete ? ("Potvrdi (" + marked.length + ")") : String(marked.length))),
							createElement("button", {
								type: "button",
								title: "Izadji iz selekcije",
								"aria-label": "Izadji iz selekcije",
								onClick: function () { setSelectMode(false); setMarked([]); setConfirmDelete(false); },
								style: modalIconButtonStyle,
							}, createElement("span", { "aria-hidden": true }, "✖️"))
						) : createElement("button", {
							type: "button",
							title: "Selektuj vise fajlova (multi-select + brisanje)",
							"aria-label": "Selektuj vise fajlova",
							onClick: function () { setSelectMode(true); setMarked([]); setConfirmDelete(false); },
							style: modalIconButtonStyle,
						}, createElement("span", { "aria-hidden": true }, "☑️")),
						// Every button here writes into the directory (upload, mkdir,
						// delete) — all workspace-scoped server-side, so all hidden
						// together in unrestricted mode rather than rendering ones that
						// would just come back with a "target directory escaped the
						// workspace" error.
						mode === "workspace" && !selectMode ? createElement("button", {
							type: "button",
							title: "Galerija",
							"aria-label": "Galerija",
							onClick: function () { if (fileInputRef.current) fileInputRef.current.click(); },
							style: modalIconButtonStyle,
						}, createElement("span", { "aria-hidden": true }, "📷")) : null,
						mode === "workspace" && !selectMode ? createElement("button", {
							type: "button",
							title: "Sa telefona",
							"aria-label": "Sa telefona",
							onClick: function () { if (anyFileInputRef.current) anyFileInputRef.current.click(); },
							style: modalIconButtonStyle,
						}, createElement("span", { "aria-hidden": true }, "📎")) : null,
						mode === "workspace" && !selectMode ? createElement("button", {
							type: "button",
							title: "Novi folder",
							"aria-label": "Novi folder",
							onClick: createFolder,
							style: modalIconButtonStyle,
						}, createElement("span", { "aria-hidden": true }, "📂")) : null,
						mode === "workspace" && !selectMode ? createElement("button", {
							type: "button",
							title: "Obrisi markirani fajl",
							"aria-label": "Obrisi markirani fajl",
							disabled: selected === null,
							onClick: function () { if (selected !== null) deleteEntry(selected); },
							style: Object.assign({}, modalIconButtonStyle, { opacity: selected === null ? 0.35 : 0.85 }),
						}, trashIcon) : null
					),
					createElement("div", { style: { display: "flex", gap: 8 } },
						createElement("button", {
							type: "button",
							onClick: onClose,
							style: { padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer", background: "transparent", color: "inherit", opacity: 0.8 },
						}, "Cancel"),
						createElement("button", {
							type: "button",
							disabled: selected === null,
							onClick: function () { if (selected !== null) onSelect(selected); },
							style: selectButtonStyle(selected !== null),
						}, "Select")
					)
				)
			));
		}

		function apply(ctx) {
			function PaperclipButton(props) {
				var session = props.session;
				// Slot props carry `sessionId` directly (and NOT `session` as a plain
				// prop — see the standard-source binding). Reading props.session made
				// this undefined, so every guarded onClick silently did nothing.
				var sessionId = props.sessionId !== undefined && props.sessionId !== null
					? props.sessionId
					: (session ? session.sessionId : undefined);
				var pickerState = useState(false);
				var pickerOpen = pickerState[0], setPickerOpen = pickerState[1];

				function handleSelect(relPath) {
					setPickerOpen(false);
					if (sessionId === undefined) return;
					appendToDraft(ctx, sessionId, "@" + relPath);
				}

				var button = createElement(
					"button",
					{
						type: "button",
						title: "Dodaj u kontekst",
						"aria-label": "Dodaj u kontekst",
						onClick: function () {
							reportDiag({
								where: "paperclip-click",
								propKeys: Object.keys(props || {}),
								hasSession: session !== undefined && session !== null,
								sessionId: sessionId === undefined ? null : String(sessionId),
							});
							if (sessionId !== undefined) setPickerOpen(true);
						},
						style: {
							display: "inline-flex",
							alignItems: "center",
							justifyContent: "center",
							width: 24,
							height: 24,
							padding: 0,
							border: "none",
							background: "transparent",
							color: "inherit",
							cursor: "pointer",
							opacity: 0.75,
						},
					},
					paperclipIcon
				);

				if (!pickerOpen || sessionId === undefined) return button;

				return createElement(react.Fragment, null, button, createElement(FilePickerModal, {
					sessionId: sessionId,
					onSelect: handleSelect,
					onClose: function () { setPickerOpen(false); },
				}));
			}

			ctx.slots.inject("conversation.input.left", function () {
				return ctx.slots.register({
					name: "conversation.input.left",
					id: "composer-extras-paperclip",
					order: 5,
				}, PaperclipButton);
			});

			/** Factory for one-click quick-reply buttons — same shape, different
			 * emoji/title/text. Used for both Try again and Proceed below. */
			function makeQuickTextButton(emoji, title, text) {
				return function QuickTextButton(props) {
					var session = props.session;
					// Slot props carry `sessionId` directly (and NOT `session` as a plain
					// prop — see the standard-source binding). Reading props.session made
					// this undefined, so every guarded onClick silently did nothing.
					var sessionId = props.sessionId !== undefined && props.sessionId !== null
						? props.sessionId
						: (session ? session.sessionId : undefined);
					return createElement(
						"button",
						{
							type: "button",
							title: title,
							"aria-label": title,
							onClick: function () {
								reportDiag({
									where: "quicktext-click",
									text: text,
									propKeys: Object.keys(props || {}),
									hasSession: session !== undefined && session !== null,
									sessionId: sessionId === undefined ? null : String(sessionId),
								});
								if (sessionId !== undefined) sendQuickText(ctx, sessionId, text);
							},
							style: {
								display: "inline-flex",
								alignItems: "center",
								justifyContent: "center",
								width: 24,
								height: 24,
								padding: 0,
								border: "none",
								background: "transparent",
								color: "inherit",
								cursor: "pointer",
								opacity: 0.75,
							},
						},
						createElement("span", { "aria-hidden": true }, emoji)
					);
				};
			}

			var TryAgainButton = makeQuickTextButton("🔁", "Try again", "try again");
			var ProceedButton = makeQuickTextButton("👍", "Proceed", "Looks good, go ahead.");

			ctx.slots.inject("conversation.input.left", function () {
				return ctx.slots.register({
					name: "conversation.input.left",
					id: "composer-extras-try-again",
					order: 7,
				}, TryAgainButton);
			});

			ctx.slots.inject("conversation.input.left", function () {
				return ctx.slots.register({
					name: "conversation.input.left",
					id: "composer-extras-proceed",
					order: 8,
				}, ProceedButton);
			});

			/** Zajednički izgled male ikonica-dugmadi u composer traci. */
			var iconButtonStyle = {
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				width: 24,
				height: 24,
				padding: 0,
				border: "none",
				background: "transparent",
				color: "inherit",
				cursor: "pointer",
				opacity: 0.75,
			};

			/** Mala poruka uz dugme (greška/potvrda), nestaje sama. */
			function InlineNote(props) {
				return createElement("span", {
					style: {
						fontSize: 10,
						maxWidth: 200,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						color: "var(--dsw-alias-label-secondary, #888)",
					},
				}, props.text);
			}

			/**
			 * „Branch into new session" — dve unakrsne strelice.
			 *
			 * Uzme TRENUTNI draft iz composera i pošalje ga kao JEDINI prompt
			 * nove, prazne sesije u istom workspace-u; zatim prebaci GUI na nju
			 * (`uiWorkspace.openSession`). Istorija se NE kopira — to je razlika
			 * u odnosu na ugrađenu branch ikonicu (`sessions.fork`) i razlog
			 * zašto ovo zamenjuje pozivanje `branch-into-new-session` skilla.
			 *
			 * Kompakcija je NAMERNO odvojena operacija: ovo dugme ne dira
			 * sadržaj tekuće sesije.
			 */
			function BranchIntoNewSessionButton(props) {
				var session = props.session;
				var sessionId = props.sessionId !== undefined && props.sessionId !== null
					? props.sessionId
					: (session ? session.sessionId : undefined);
				var busyState = useState(false);
				var busy = busyState[0], setBusy = busyState[1];
				var noteState = useState("");
				var note = noteState[0], setNote = noteState[1];

				var enabled = sessionId !== undefined && !busy;

				return createElement(react.Fragment, null,
					createElement("button", {
						type: "button",
						title: "Branch into new session — prazna sesija sa ovim promptom (bez istorije)",
						"aria-label": "Branch into new session",
						disabled: !enabled,
						onClick: function () {
							if (sessionId === undefined || busy) return;
							var draft = readDraft(ctx, sessionId);
							if (draft.trim() === "") {
								setNote("Prvo napiši prompt za novu sesiju.");
								setTimeout(function () { setNote(""); }, 4000);
								return;
							}
							setBusy(true);
							setNote("");
							branchIntoNewSession(ctx, sessionId, draft)
								.then(function (value) {
									// Tekst je sada prompt NOVE sesije — obriši ga iz
									// ovog composera, inače ostaje tu i može da se
									// pošalje u staru sesiju (Nalaz 1).
									clearDraft(ctx, sessionId);
									reportDiag({
										where: "branch-new-session",
										sessionId: String(sessionId),
										created: value && value.sessionId ? String(value.sessionId) : null,
									});
								})
								.catch(function (error) {
									setNote("Greška: " + (error && error.message ? error.message : String(error)));
								})
								.then(function () { setBusy(false); });
						},
						style: Object.assign({}, iconButtonStyle, { opacity: enabled ? 0.75 : 0.35 }),
					}, branchArrowsIcon),
					note === "" ? null : createElement(InlineNote, { text: note })
				);
			}

			ctx.slots.inject("conversation.input.left", function () {
				return ctx.slots.register({
					name: "conversation.input.left",
					id: "composer-extras-branch-new-session",
					order: 6,
				}, BranchIntoNewSessionButton);
			});

			/**
			 * Ubaci novi red u draft — za pisanje prompta u više redova bez
			 * slanja. Radi isto što i Shift+Enter, samo jednim klikom (mobilni
			 * tasteri za Shift nisu praktični).
			 */
			function NewlineButton(props) {
				var session = props.session;
				var sessionId = props.sessionId !== undefined && props.sessionId !== null
					? props.sessionId
					: (session ? session.sessionId : undefined);
				return createElement("button", {
					type: "button",
					title: "Novi red u promptu (Shift+Enter)",
					"aria-label": "Novi red u promptu",
					disabled: sessionId === undefined,
					onClick: function () {
						if (sessionId !== undefined) insertDraftNewline(ctx, sessionId);
					},
					style: Object.assign({}, iconButtonStyle, { opacity: sessionId === undefined ? 0.35 : 0.75 }),
				}, newlineIcon);
			}

			ctx.slots.inject("conversation.input.left", function () {
				return ctx.slots.register({
					name: "conversation.input.left",
					id: "composer-extras-newline",
					order: 4,
				}, NewlineButton);
			});

			/**
			 * ContextGuard — okidač na 500k tokena ZAUZETOSTI KONTEKSTA.
			 *
			 * Čita ISTU projekciju koju crta ContextMeter u donjem desnom uglu
			 * (`contextPressure`) i koristi istu formulu (`projectedTokens` /
			 * `contextWindow`). To je veličina prompta koji ide u SLEDEĆI zahtev
			 * — jedini broj na koji kompakcija i grananje mogu da utiču.
			 *
			 * NE koristi `tokenUsage` (Token usage panel): on sabira naplaćene
			 * tokene kroz CEO log sesije (uncached + cache read + output) i zato
			 * pokazuje npr. 25,5M — što nije veličina konteksta.
			 *
			 * Popup nudi tri ishoda i ne prekida tekući turn:
			 *   1. Branch into new session  — prazna sesija sa ovim promptom,
			 *   2. Compact session          — `/compact` u TEKUĆOJ sesiji,
			 *   3. Nastavi dalje            — odbaci ovaj opseg.
			 */
			function ContextGuard(props) {
				var session = props.session;
				var sessionId = props.sessionId !== undefined && props.sessionId !== null
					? props.sessionId
					: (session ? session.sessionId : undefined);
				var useProjection = props.useProjection;

				// Standard kit za session-scope slotove (ui-session ga spaja u
				// SessionStandardProps). `typeof` je stabilan kroz render-e, pa
				// redosled hookova ostaje nepromenjen.
				var pressure = typeof useProjection === "function" ? useProjection("contextPressure") : undefined;
				var occupancy = contextOccupancyFrom(pressure);

				// SVE izvedeno se računa PRE hookova i pre svakog `return null`:
				// React zahteva isti broj hookova u svakom renderu, pa rani
				// `return` ispred `useEffect` baca „Rendered fewer hooks than
				// expected" čim sesija pređe prag (ili padne ispod njega).
				// Manji od dva praga: apsolutnog (500k) i dela prozora modela.
				var guardTokens = occupancy === null
					? Number.POSITIVE_INFINITY
					: Math.min(
						CONTEXT_GUARD_TOKENS,
						Math.round(occupancy.window * CONTEXT_GUARD_WINDOW_FRACTION));
				var above = sessionId !== undefined && occupancy !== null && occupancy.used >= guardTokens;
				var band = above
					? Math.floor((occupancy.used - guardTokens) / CONTEXT_GUARD_RENUDGE)
					: 0;
				var dismissed = above && band <= contextDismissedBand(sessionId);

				var tickState = useState(0);
				var setTick = tickState[1];
				var busyState = useState("");
				var busy = busyState[0], setBusy = busyState[1];
				var noteState = useState("");
				var note = noteState[0], setNote = noteState[1];

				var dismiss = function () {
					if (!above) return;
					dismissContextBand(sessionId, band);
					setTick(function (n) { return n + 1; });
				};

				/**
				 * Odbacivanje NE sme da bude ćorsokak: kad je opseg odbačen, u
				 * uglu ostaje mali „pill" sa procentom koji vraća pun panel na
				 * klik (inače se panel ne može dozvati do +100k tokena — vidi
				 * 2026-10-07: „ne vidim panel"). Zato se odbacivanje pamti jedan
				 * opseg NIŽE, pa je isti opseg ponovo „iznad" odbačenog.
				 */
				var reopen = function () {
					if (!above) return;
					dismissContextBand(sessionId, band - 1);
					setTick(function (n) { return n + 1; });
				};

				var open = above && !dismissed;

				// Pill se prikazuje samo kad je opseg odbačen (`!open`), pa se
				// mesto meri samo tada — ali se hook poziva UVEK (isti broj
				// hookova u svakom renderu).
				var pillAnchor = useComposerPillAnchor(!open);

				// Esc zatvara isto kao klik na masku — navika iz core modala
				// (SettingsPanel). Slušalac postoji samo dok je panel otvoren.
				useEffect(function () {
					if (!open) return undefined;
					var onKey = function (event) {
						if (event && (event.key === "Escape" || event.keyCode === 27)) dismiss();
					};
					if (typeof document !== "undefined" && document !== null) {
						document.addEventListener("keydown", onKey);
						return function () { document.removeEventListener("keydown", onKey); };
					}
					return undefined;
				}, [open, sessionId, band]);

				if (sessionId === undefined || occupancy === null) return null;
				if (!above) return null;

				if (!open) {
					// Dok kompakcija radi, pill je jedina vidljiva stvar — javlja
					// da se nešto dešava i ne prima klikove.
					var compacting = busy === "compact";
					// Mesto se meri (vidi `useComposerPillAnchor`): tačno ispod
					// „+" dugmeta u praznom drugom redu composera, a ako tog
					// prostora nema — levo u dock traci na dnu. `left`/`bottom`
					// fallback važi samo prvi render pre merenja; DESNA ivica se
					// više ne koristi, jer je upravo ona krila dugmad.
					var pillPlacement = pillAnchor === null
						? { left: 16, bottom: 52 }
						: { left: pillAnchor.left, top: pillAnchor.top };
					return modalPortal(createElement("button", {
						type: "button",
						"data-composer-extras-context-guard": "pill",
						disabled: busy !== "",
						title: compacting
							? "Kompaktujem…"
							: "Kontekst " + occupancy.percent + "% — otvori predlog za kompakciju",
						"aria-label": compacting
							? "Kompaktujem kontekst"
							: "Kontekst " + occupancy.percent + "%, otvori predlog za kompakciju",
						onClick: busy === "" ? reopen : undefined,
						style: Object.assign({
							position: "fixed",
							zIndex: 1200,
							display: "inline-flex",
							alignItems: "center",
							gap: 6,
							padding: "5px 10px",
							borderRadius: 999,
							// Isti razlog kao za pun panel: neprovidna podloga, jer je
							// `--dsw-specific-menu` poluprovidan i bez blura se providi.
							background: "var(--dsw-alias-bg-base, #ffffff)",
							backdropFilter: "var(--dsw-menu-backdrop-filter, blur(20px) saturate(150%))",
							WebkitBackdropFilter: "var(--dsw-menu-backdrop-filter, blur(20px) saturate(150%))",
							color: "var(--dsw-alias-label-primary, #111)",
							border: "1px solid rgba(245, 158, 11, 0.65)",
							boxShadow: "0 6px 18px rgba(0, 0, 0, 0.45)",
							fontFamily: "inherit",
							fontSize: 11.5,
							cursor: busy === "" ? "pointer" : "default",
						}, pillPlacement),
					}, compacting ? "📦 Kompaktujem…" : "📦 Kontekst " + occupancy.percent + "%"));
				}

				var doBranch = function () {
					if (busy !== "") return;
					var draft = readDraft(ctx, sessionId);
					var prompt = draft.trim() !== ""
						? draft
						: "Nastavljamo u novoj sesiji; prethodna je dostigla veliki kontekst. "
							+ "Kontekst nije prenet — pitaj me šta ti treba pre nego što nastaviš.";
					setNote("");
					setBusy("branch");
					branchIntoNewSession(ctx, sessionId, prompt)
						.then(function () {
							// Tekst je prešao u novu sesiju — obriši ga ovde, da ne
							// može slučajno da se pošalje u staru (Nalaz 1).
							clearDraft(ctx, sessionId);
							dismissContextBand(sessionId, band);
							setBusy("");
							setTick(function (n) { return n + 1; });
						})
						.catch(function (error) {
							setBusy("");
							setNote("Greška: " + (error && error.message ? error.message : String(error)));
						});
				};

				/**
				 * Kompakcija na klik. Kartica se sklanja ODMAH (2026-10-08:
				 * „kada kliknem očekujem da mi se skloni sa ekrana") — ostaje
				 * samo pill „📦 Kompaktujem…". Ako server odbije (npr. „agent
				 * nije idle"), panel se SAM vraća sa porukom servera, da se
				 * neuspeh ne bi završio tišinom.
				 */
				var doCompact = function () {
					if (busy !== "") return;
					setNote("Kompaktujem… ako turn traje, čekam da se završi.");
					setBusy("compact");
					dismissContextBand(sessionId, band);
					setTick(function (n) { return n + 1; });
					compactSession(sessionId, 90000)
						.then(function (value) {
							setBusy("");
							var kind = value && value.kind ? value.kind : "success";
							if (kind === "success") {
								setTick(function (n) { return n + 1; });
								return;
							}
							setNote((value && value.text) ? value.text : "Kompakcija nije uspela.");
							// Vrati panel (opseg jedan niže = „iznad" odbačenog).
							dismissContextBand(sessionId, band - 1);
							setTick(function (n) { return n + 1; });
						})
						.catch(function (error) {
							setBusy("");
							setNote("Greška: " + (error && error.message ? error.message : String(error)));
							dismissContextBand(sessionId, band - 1);
							setTick(function (n) { return n + 1; });
						});
				};

				/** `tone`: "primary" (preporučena radnja), "muted" (ostavi me na miru)
				 * ili "neutral". Boje su namerno konkretne (ne samo tokeni): panel
				 * mora da se vidi i u svetloj i u tamnoj temi. */
				var modalButton = function (key, label, hint, onClick, tone) {
					var primary = tone === "primary";
					var muted = tone === "muted";
					return createElement("button", {
						key: key,
						type: "button",
						onClick: onClick,
						style: {
							display: "block",
							width: "100%",
							textAlign: "left",
							padding: "8px 10px",
							margin: "0 0 6px 0",
							borderRadius: 8,
							border: primary
								? "1px solid #f59e0b"
								: "0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))",
							background: primary
								? "rgba(245, 158, 11, 0.16)"
								: (muted
									? "transparent"
									: "var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.18))"),
							color: "var(--dsw-alias-label-primary, inherit)",
							fontFamily: "inherit",
							fontSize: 12,
							lineHeight: 1.35,
							cursor: busy === "" ? "pointer" : "default",
							opacity: busy === "" ? 1 : 0.6,
						},
					},
						createElement("span", { style: { fontWeight: 600 } }, label),
						hint === "" ? null : createElement("span", {
							style: {
								display: "block",
								marginTop: 2,
								fontSize: 10.5,
								color: "var(--dsw-alias-label-secondary, #999)",
							},
						}, hint));
				};

				return modalPortal(createElement("div", {
					// Overlay preko celog ekrana (u portalu, u `document.body`) —
					// jedini način da kartica bude TAČNO na sredini ekrana, a ne uz
					// ivicu composera (2026-10-08: „izašao je sa strane").
					"data-composer-extras-context-guard-overlay": true,
					style: {
						position: "fixed",
						top: 0,
						right: 0,
						bottom: 0,
						left: 0,
						zIndex: 1300,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						padding: 16,
						boxSizing: "border-box",
					},
				},
					createElement("div", {
						// Maska je ZASEBAN element (kao u core SettingsPanel-u), pa
						// klik na karticu ne može da je pogodi — nema stopPropagation.
						// Klik na masku = „Nastavi dalje": panel se sklanja.
						"data-composer-extras-context-guard": "mask",
						"aria-hidden": "true",
						onClick: dismiss,
						style: {
							position: "absolute",
							top: 0,
							right: 0,
							bottom: 0,
							left: 0,
							background: "rgba(0, 0, 0, 0.45)",
						},
					}),
					createElement("div", {
						"data-composer-extras-context-guard": true,
						role: "dialog",
						"aria-modal": "true",
						"aria-label": "Kontekst " + occupancy.percent + "% — predlog za kompakciju",
						style: {
							position: "relative",
							zIndex: 1,
							boxSizing: "border-box",
							width: "min(340px, 100%)",
							maxHeight: "calc(100vh - 32px)",
							overflowY: "auto",
							padding: 14,
							borderRadius: 14,
							// NEPROVIDNA podloga. `--dsw-specific-menu` je u svetloj temi
							// `#f8f9fa94` (58% alfa) i u core-u se koristi uz
							// `backdrop-filter`; bez blura se tekst iza panela providi i
							// panel je nečitljiv (vidi 2026-10-07 screenshot). Zato
							// `bg-base` (#fff / #151517) + blur kao pojas i šraf.
							background: "var(--dsw-alias-bg-base, #ffffff)",
							WebkitBackdropFilter: "var(--dsw-menu-backdrop-filter, blur(20px) saturate(150%))",
							backdropFilter: "var(--dsw-menu-backdrop-filter, blur(20px) saturate(150%))",
							color: "var(--dsw-alias-label-primary, #111)",
							boxShadow: "0 12px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(245, 158, 11, 0.45)",
							border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.45))",
							borderLeft: "3px solid #f59e0b",
							fontFamily: "inherit",
						},
					},
					createElement("div", {
						style: {
							display: "flex",
							alignItems: "baseline",
							gap: 6,
							marginBottom: 4,
							fontSize: 12.5,
							fontWeight: 600,
						},
					},
						createElement("span", null, "Kontekst " + occupancy.percent + "%"),
						createElement("span", {
							style: {
								marginLeft: "auto",
								fontWeight: 400,
								fontVariantNumeric: "tabular-nums",
								color: "var(--dsw-alias-label-secondary, #999)",
							},
						}, formatTokenCount(occupancy.used) + " / " + formatTokenCount(occupancy.window))),
					createElement("div", {
						style: {
							marginBottom: 10,
							fontSize: 11,
							lineHeight: 1.4,
							color: "var(--dsw-alias-label-secondary, #999)",
						},
					}, "Ovo je veličina prompta koji ide u sledeći zahtev. Kompakcija i grananje su odvojene radnje."),
					modalButton(
						"branch",
						"⇄  Branch into new session",
						"Prazna sesija u istom workspace-u dobija trenutni prompt; istorija se ne prenosi.",
						doBranch,
						"neutral"),
					modalButton(
						"compact",
						"📦  Compact session",
						"Sažima istoriju u OVOJ sesiji i ostaje u njoj. Ako turn traje, sačekaće da se završi.",
						doCompact,
						"primary"),
					modalButton(
						"later",
						"Nastavi dalje",
						"Ne diraj ništa; podsetnik se vraća tek posle još "
							+ formatTokenCount(CONTEXT_GUARD_RENUDGE) + " tokena.",
						dismiss,
						"muted"),
					note === "" ? null : createElement("div", {
						style: { marginTop: 4, fontSize: 10.5, color: "var(--dsw-alias-label-secondary, #999)" },
					}, note)
					)
				));
			}

			/** 500000 → „500k", 1000000 → „1M" (kao ContextMeter). */
			function formatTokenCount(value) {
				if (value < 1000) return String(value);
				if (value < 1000000) return String(Math.round(value / 1000)) + "k";
				return String(Math.round(value / 100000) / 10) + "M";
			}

			ctx.slots.inject("conversation.input.left", function () {
				return ctx.slots.register({
					name: "conversation.input.left",
					id: "composer-extras-context-guard",
					order: 11,
				}, ContextGuard);
			});

			function GeminiSeekButton(props) {
				var session = props.session;
				// Slot props carry `sessionId` directly (and NOT `session` as a plain
				// prop — see the standard-source binding). Reading props.session made
				// this undefined, so every guarded onClick silently did nothing.
				var sessionId = props.sessionId !== undefined && props.sessionId !== null
					? props.sessionId
					: (session ? session.sessionId : undefined);
				var tickState = useState(0);
				var setTick = tickState[1];

				// Always-mounted-while-composer-visible effect: installs the
				// input.submit wrap + model-change watcher the first time this
				// session is seen, points the (possibly stale, after a remount)
				// notify callback at the currently mounted instance's setTick so the
				// tooltip stays live, and uključi gemini-seek-smart kada treba:
				//   • PRAZNA nova sesija („+") — smart je podrazumevan (2026-10-07);
				//   • sesija koju je branch ruta označila kao smart start.
				// Postojeći razgovor sa istorijom ostaje na svom modelu dok
				// korisnik ne klikne 😎 (2026-10-07: ranije se palio svuda).
				useEffect(function () {
					if (sessionId === undefined) return;
					ensureGeminiSeekHook(ctx, sessionId);
					var notify = function () { setTick(function (n) { return n + 1; }); };
					var state = geminiSeekState[sessionId];
					if (!state) {
						// Dva nezavisna razloga da se smart upali sam:
						//  1) sesija je još PRAZNA (dugme „+") — tada je smart
						//     podrazumevano stanje (vidi geminiSeekDefaultEnabled);
						//  2) `branch-into-new-session` ruta ju je označila kao
						//     smart start (per-session oznaka `…-on-<id>`).
						// Eksplicitan 😎 „off" klik pobeđuje oba.
						var off = sessionSmartOff(sessionId);
						var marked = sessionSmartMarked(sessionId);
						if (!off && (geminiSeekDefaultEnabled(ctx, sessionId) || marked)) {
							// `automatic: true` je nosivo: automatska aktivacija
							// odbija da prebaci model dok veličina konteksta nije
							// poznata (vidi `activateGeminiSeek`). Ako odluka već
							// čeka projekciju, ne zakazuj je opet.
							if (!geminiSeekContextPending[sessionId]) {
								activateGeminiSeek(ctx, sessionId, notify, { automatic: true });
							}
						} else {
							geminiSeekState[sessionId] = { enabled: false, notify: notify };
							// Prvi put bez oznake: pitaj server da li je sesija
							// branchovana sa smart startom, pa je označi i upali.
							// Eksplicitno ugašena sesija se NE pita — korisnikov
							// klik pobeđuje serversku oznaku.
							if (!sessionSmartOff(sessionId) && !branchInfoChecked[sessionId]) {
								branchInfoChecked[sessionId] = true;
								fetch("/composer-extras/api/branch-info?sessionId=" + encodeURIComponent(sessionId))
									.then(function (res) { return res.json().catch(function () { return null; }); })
									.then(function (data) {
										var value = data && data.ok ? data.value : null;
										if (!value || !value.smart) return;
										markSessionSmart(sessionId);
										var current = geminiSeekState[sessionId];
										if (!current || !current.enabled) {
											// Server tvrdi da je sesija branchovana sa smart
											// startom — to je automatska aktivacija, pa važi
											// isto pravilo: bez poznate veličine konteksta se
											// model NE prebacuje.
											activateGeminiSeek(ctx, sessionId, notify, { automatic: true });
											setTick(function (n) { return n + 1; });
										}
									})
									.catch(function () { /* stari server bez rute — ostaje isključeno */ });
							}
						}
					} else {
						state.notify = notify;
					}
					// eslint-disable-next-line
				}, [sessionId]);

				function toggle() {
					if (sessionId === undefined) return;
					var existing = geminiSeekState[sessionId];
					if (existing && existing.enabled) {
						existing.enabled = false;
						markSessionSmartOff(sessionId, true);
						// Vrati model na DeepSeek ODMAH: bez ovoga bi sesija ostala
						// na Gemini segmentu do kraja turna — trošila free tier i
						// rizikovala 429 iako je korisnik upravo rekao „ne".
						var deepseekSeg = GEMINI_SEEK_SCHEDULE.filter(function (seg) { return seg.provider !== "google"; })[0];
						if (deepseekSeg !== undefined) {
							ensureModelSelected(ctx, sessionId, deepseekSeg).catch(function (error) {
								console.warn("[dsh-composer-extras] gemini-seek-smart: povratak na DeepSeek nije uspeo:", error);
							});
						}
						setTick(function (n) { return n + 1; });
						return;
					}
					markSessionSmartOff(sessionId, false);
					// NAMERNO bez `persistGeminiSeekDefault`: klik važi za OVU
					// sesiju. Globalno „uključeno svuda" više ne postoji, pa jedan
					// 😎 u jednoj sesiji ne sme da pali smart u svim ostalim.
					activateGeminiSeek(ctx, sessionId, function () { setTick(function (n) { return n + 1; }); });
					setTick(function (n) { return n + 1; });
				}

				var state = sessionId !== undefined ? geminiSeekState[sessionId] : undefined;
				var on = !!(state && state.enabled);
				return createElement(
					"button",
					{
						type: "button",
						title: sessionId !== undefined ? geminiSeekLabel(sessionId) : "gemini-seek-smart",
						"aria-label": "gemini-seek-smart toggle",
						onClick: toggle,
						style: {
							display: "inline-flex",
							alignItems: "center",
							justifyContent: "center",
							width: 24,
							height: 24,
							padding: 0,
							border: "none",
							background: "transparent",
							color: "inherit",
							cursor: "pointer",
							opacity: on ? 1 : 0.4,
						},
					},
					createElement("span", { "aria-hidden": true }, "😎")
				);
			}

			ctx.slots.inject("conversation.input.left", function () {
				return ctx.slots.register({
					name: "conversation.input.left",
					id: "composer-extras-gemini-seek",
					order: 9,
				}, GeminiSeekButton);
			});

			/* PEAK-HELPERS-START */
			/**
			 * DeepSeek "peak hours" helpers — pure UTC math, no hardcoded local
			 * clock, so Belgrade's DST (CET/CEST) is handled for free and the
			 * local times shown to the user come from the browser's own Intl
			 * data (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
			 *
			 * Official definition (https://api-docs.deepseek.com/quick_start/pricing):
			 * peak = Mon–Fri 01:00–04:00 and 06:00–10:00 UTC; everything else
			 * (all weekend, all Chinese public holidays) is off-peak at half the
			 * peak price. Chinese holidays cannot be computed reliably in code,
			 * so the tooltip says outright that this is a best-effort estimate.
			 */
			var PEAK_UTC_WINDOWS = [[60, 240], [360, 600]]; // minutes since 00:00 UTC

			function isDeepseekPeak(date) {
				var dow = date.getUTCDay(); // 0 = Sunday, 6 = Saturday
				if (dow === 0 || dow === 6) return false;
				var minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
				for (var i = 0; i < PEAK_UTC_WINDOWS.length; i++) {
					if (minutes >= PEAK_UTC_WINDOWS[i][0] && minutes < PEAK_UTC_WINDOWS[i][1]) return true;
				}
				return false;
			}

			/** First whole minute at which the peak/off-peak state flips (UTC Date). */
			function nextDeepseekBoundary(now) {
				var current = isDeepseekPeak(now);
				var probe = new Date(now.getTime());
				probe.setUTCSeconds(0, 0);
				for (var i = 0; i < 10080; i++) { // 7 days ≫ longest window (Fri 10:00 → Mon 01:00 UTC)
					probe = new Date(probe.getTime() + 60000);
					if (isDeepseekPeak(probe) !== current) return probe;
				}
				return null;
			}

			function formatPeakDuration(ms) {
				var total = Math.max(0, Math.round(ms / 60000));
				var h = Math.floor(total / 60);
				var m = total % 60;
				if (h <= 0 && m <= 0) return "manje od minut";
				if (h <= 0) return m + "m";
				if (m === 0) return h + "h";
				return h + "h " + m + "m";
			}

			function formatPeakLocalTime(date) {
				try {
					return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
				} catch (error) {
					return date.toISOString().slice(11, 16) + " UTC";
				}
			}

			function peakLocalTimeZone() {
				try {
					return Intl.DateTimeFormat().resolvedOptions().timeZone || "lokalno vreme";
				} catch (error) {
					return "lokalno vreme";
				}
			}

			function peakPriceLine(model, peak) {
				if (String(model || "").indexOf("flash") !== -1) {
					return peak
						? "deepseek-flash, po 1M tokena sada: cache hit $0.006 · cache miss $0.30 · output $1.20 (off-peak: $0.003 · $0.15 · $0.60)."
						: "deepseek-flash, po 1M tokena sada: cache hit $0.003 · cache miss $0.15 · output $0.60 (peak: $0.006 · $0.30 · $1.20).";
				}
				return "Za svaki model važi isto pravilo: peak = 2× off-peak cena (detalji: api-docs.deepseek.com/quick_start/pricing).";
			}

			/**
			 * Peak/off-peak pricing is a DeepSeek-only thing — Gemini (provider
			 * "google") has no peak hours, so the ❗ label must not appear for
			 * it. Provider is what the model directory stores per model
			 * (`{ provider, model }`, e.g. "deepseek-official" / "google"); the
			 * model id is checked too as a fallback in case a build reports an
			 * unexpected provider string.
			 */
			function isDeepseekModel(current) {
				if (!current) return false;
				var provider = String(current.provider === undefined || current.provider === null ? "" : current.provider).toLowerCase();
				var model = String(current.model === undefined || current.model === null ? "" : current.model).toLowerCase();
				return provider.indexOf("deepseek") !== -1 || model.indexOf("deepseek") !== -1;
			}

			/** Tooltip/panel text as an array of lines; pure so it can be unit-tested. */
			function deepseekPeakMessage(now, model) {
				var peak = isDeepseekPeak(now);
				var boundary = nextDeepseekBoundary(now);
				var until = boundary ? formatPeakDuration(boundary.getTime() - now.getTime()) : "nepoznato";
				var boundaryLocal = boundary ? formatPeakLocalTime(boundary) : "nepoznato";
				var localNow = formatPeakLocalTime(now);
				var zone = peakLocalTimeZone();
				var note = "Procena je najbolja moguća — kineski državni praznici se ne mogu pouzdano izračunati u kodu (tada je stvarno off-peak iako sat kaže peak).";

				if (peak) {
					return [
						"❗ Peak sati — cene su 2× veće",
						"Sada je " + localNow + " (" + zone + "). DeepSeek trenutno naplaćuje peak tarifu (pon–pet 01–04 i 06–10 UTC).",
						"Off-peak, upola niže cene, počinje za " + until + " — u " + boundaryLocal + " po tvom lokalnom vremenu.",
						peakPriceLine(model, true),
						"Znači: ista konverzacija sada košta duplo. Ako nije hitno, nastavi posle " + boundaryLocal + " i platićeš upola.",
						note,
					];
				}
				return [
					"❗ Off-peak — cene su upola niže",
					"Sada je " + localNow + " (" + zone + "). Nije peak: vikend je, praznik, ili smo van peak sati (pon–pet 01–04 i 06–10 UTC).",
					"Sledeći peak, 2× cene, počinje za " + until + " — u " + boundaryLocal + " po tvom lokalnom vremenu.",
					peakPriceLine(model, false),
					"Znači: sada plaćaš upola manje — ovo je najjeftiniji trenutak za duge konverzacije.",
					note,
				];
			}
			/* PEAK-HELPERS-END */

			/**
			 * Floating "which model is active right now" badge — fixed to the
			 * viewport, not part of the composer's inline layout, so it stays
			 * visible regardless of scroll/keyboard. Live via
			 * `useSyncExternalStore(directory.store.subscribe, directory.store.getSnapshot)`
			 * — the same subscribe contract `dsh-client-ui-model-selection`'s own
			 * dropdown uses internally (confirmed in its compiled client.js) — so
			 * this updates immediately whether the model changed via GeminiSeek's
			 * own `directory.select()` call or the user picking one by hand in the
			 * normal model dropdown. `pointerEvents: 'none'`: a passive readout,
			 * never intercepts a tap meant for whatever is under it.
			 */
			function ModelStatusBadge(props) {
				var session = props.session;
				// Slot props carry `sessionId` directly (and NOT `session` as a plain
				// prop — see the standard-source binding). Reading props.session made
				// this undefined, so every guarded onClick silently did nothing.
				var sessionId = props.sessionId !== undefined && props.sessionId !== null
					? props.sessionId
					: (session ? session.sessionId : undefined);
				var directory = sessionId !== undefined && ctx.modelDirectories ? ctx.modelDirectories.directoryFor(sessionId) : null;

				var snapshot = useSyncExternalStore(
					function (onChange) {
						if (!directory) return function () {};
						return directory.store.subscribe(onChange);
					},
					function () { return directory ? directory.store.getSnapshot() : null; }
				);

				var current = snapshot && snapshot.current;

				// Live clock so the peak indicator's countdown and its on/off
				// highlight flip by themselves — every boundary is a whole UTC
				// hour, so a 60 s tick is plenty (see the effect below).
				var clockState = useState(Date.now());
				var setClock = clockState[1];
				useEffect(function () {
					// 60 s keeps the minute-resolution countdown exact and flips
					// the peak/off-peak highlight within a minute of a boundary
					// (03:00 / 06:00 / 08:00 / 12:00 local) — the moment that
					// actually matters. Android throttles timers while the screen
					// is off or the tab is backgrounded, so refresh the instant
					// the GUI becomes visible/focused again instead of waiting
					// for the next tick.
					function refreshClock() { setClock(Date.now()); }
					var timer = setInterval(refreshClock, 60000);
					document.addEventListener("visibilitychange", refreshClock);
					window.addEventListener("focus", refreshClock);
					return function () {
						clearInterval(timer);
						document.removeEventListener("visibilitychange", refreshClock);
						window.removeEventListener("focus", refreshClock);
					};
				}, []);

				var openState = useState(false);
				var open = openState[0];
				var setOpen = openState[1];
				var wrapperRef = useRef(null);

				// Tap/click anywhere outside the badge closes the explanation.
				useEffect(function () {
					if (!open) return undefined;
					function onDocPointerDown(event) {
						var node = wrapperRef.current;
						if (node && event.target && node.contains(event.target)) return;
						setOpen(false);
					}
					document.addEventListener("pointerdown", onDocPointerDown, true);
					return function () { document.removeEventListener("pointerdown", onDocPointerDown, true); };
				}, [open]);

				// Where the chip sits. It used to float at the very top of the
				// viewport (`top: 8, left: 50%`), which put it straight over the
				// session header + the Chat/Trajectory tab row — the same strip
				// dsh uses for its own transient notices, so it covered them.
				// The tab row belongs to dsh-client-ui-conversation and exposes
				// no slot, but it DOES carry `data-conversation-tabs`, so the
				// chip measures that row and parks itself right after the last
				// tab (next to "Trajectory"). `position: fixed` is kept because
				// the slot the chip is injected into lives down in the composer;
				// only the coordinates change. When the row is absent (a single
				// registered view, or blank Hero chrome) it falls back to the
				// header corner, and only if that is absent too does the old
				// top-center spot remain.
				var anchorState = useState(null);
				var anchor = anchorState[0];
				var setAnchor = anchorState[1];
				// `measured` separates "not measured yet" (chip hidden for one
				// frame, so it never flashes at the old top-center spot) from
				// "measured, nothing to anchor to" (fallback position is real).
				var measuredState = useState(false);
				var measured = measuredState[0];
				var setMeasured = measuredState[1];
				var anchorRef = useRef(null);
				useEffect(function () {
					function commit(next) {
						var prev = anchorRef.current;
						var changed = (prev === null) !== (next === null)
							|| (prev !== null && next !== null
								&& (prev.top !== next.top || prev.left !== next.left || prev.fallback !== next.fallback));
						anchorRef.current = next;
						if (changed) setAnchor(next);
					}
					function measure() {
						var tabs = document.querySelector("[data-conversation-tabs]");
						var corner = document.querySelector("[data-conversation-header-corner]");
						var el = tabs || corner;
						if (!el) { commit(null); setMeasured(true); return; }
						var box = el.getBoundingClientRect();
						if (box.width === 0 && box.height === 0) { commit(null); setMeasured(true); return; }
						var own = wrapperRef.current ? wrapperRef.current.offsetWidth : 0;
						var maxLeft = Math.max(8, window.innerWidth - own - 10);
						var left = tabs ? box.right + 8 : box.right - own - 4;
						commit({
							top: Math.round(box.top + box.height / 2),
							left: Math.round(Math.min(Math.max(8, left), maxLeft)),
							fallback: tabs ? false : true,
						});
						setMeasured(true);
					}
					// Once now, once after paint (the chip's own width is only
					// known then), and again on every layout change that can move
					// the tab row (a two-line session title, keyboard, rotation)
					// — a 1.5 s poll is far cheaper than a MutationObserver over
					// the whole streaming conversation, which would fire on every
					// token.
					measure();
					var raf = requestAnimationFrame(measure);
					var timer = setInterval(measure, 1500);
					window.addEventListener("resize", measure);
					window.addEventListener("orientationchange", measure);
					document.addEventListener("visibilitychange", measure);
					return function () {
						cancelAnimationFrame(raf);
						clearInterval(timer);
						window.removeEventListener("resize", measure);
						window.removeEventListener("orientationchange", measure);
						document.removeEventListener("visibilitychange", measure);
					};
				}, [sessionId]);

				if (!current) return null;

				var seek = sessionId !== undefined ? geminiSeekState[sessionId] : undefined;
				var seekSuffix = seek && seek.enabled ? " 😎" : "";

				// Test override, handy to eyeball the peak state without waiting
				// for 03:00 local: in the browser console set
				//   window.__DSH_PEAK_OVERRIDE__ = "2026-09-29T02:00:00Z"
				// (ISO string or ms number). Unset in normal use.
				var nowMs = clockState[0];
				try {
					var override = window.__DSH_PEAK_OVERRIDE__;
					if (override !== undefined && override !== null && override !== "") {
						var parsed = typeof override === "number" ? override : Date.parse(override);
						if (!isNaN(parsed)) nowMs = parsed;
					}
				} catch (error) { /* ignore */ }
				var now = new Date(nowMs);
				var peak = isDeepseekPeak(now);
				var lines = deepseekPeakMessage(now, current.model);

				// DeepSeek-only: no ❗ for Gemini/other providers (no peak hours
				// there). The model chip itself stays as before.
				var showPeak = isDeepseekModel(current);

				var peakIcon = !showPeak ? null : createElement("button", {
					type: "button",
					title: peak
						? "DeepSeek peak sati — cene 2× (klik za detalje)"
						: "DeepSeek off-peak — cene upola niže (klik za detalje)",
					"aria-label": peak
						? "DeepSeek peak sati, cene 2× — klik za detalje"
						: "DeepSeek off-peak, cene upola niže — klik za detalje",
					"aria-expanded": open,
					onClick: function (event) {
						if (event && event.stopPropagation) event.stopPropagation();
						setOpen(function (value) { return !value; });
					},
					style: {
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						padding: "0 2px",
						margin: 0,
						border: "none",
						background: "transparent",
						color: peak ? "#ff5c00" : "inherit",
						fontSize: 13,
						lineHeight: 1,
						cursor: "pointer",
						pointerEvents: "auto",
						opacity: peak ? 1 : 0.4,
						filter: peak ? "none" : "grayscale(1)",
						borderRadius: 4,
						boxShadow: peak ? "0 0 0 1px rgba(255,92,0,0.6)" : "none",
					},
				}, "❗");

				// Explanation panel. Under the old top-center position the chip
				// sat mid-screen, so a centred panel was right. Parked in the
				// tab row the chip is near the LEFT edge, so the panel hangs
				// from the chip's left edge instead and its width stops at the
				// viewport's right edge — never off-screen on either side.
				var panelStyle = {
					position: "absolute",
					top: "calc(100% + 6px)",
					left: "50%",
					transform: "translateX(-50%)",
					width: "min(300px, 86vw)",
					background: "Canvas",
					color: "CanvasText",
					border: "1px solid rgba(128,128,128,0.45)",
					borderRadius: 8,
					padding: "8px 10px",
					fontSize: 11,
					lineHeight: 1.45,
					textAlign: "left",
					whiteSpace: "normal",
					boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
					pointerEvents: "auto",
					zIndex: 10000,
				};
				if (anchor && !anchor.fallback) {
					panelStyle.left = 0;
					panelStyle.transform = "none";
					panelStyle.width = "min(300px, calc(100vw - " + (anchor.left + 12) + "px))";
				}

				var peakPanel = !showPeak || !open ? null : createElement("div", {
					style: panelStyle,
				}, lines.map(function (line, index) {
					return createElement("div", {
						key: index,
						style: {
							marginTop: index === 0 ? 0 : 6,
							fontWeight: index === 0 ? 600 : 400,
							color: index === 0 && peak ? "#ff5c00" : "inherit",
						},
					}, line);
				}));

				var wrapperStyle = {
					position: "fixed",
					zIndex: 9999,
					display: "flex",
					alignItems: "center",
					gap: 3,
					background: "Canvas",
					color: "CanvasText",
					border: "1px solid rgba(128,128,128,0.4)",
					borderRadius: 8,
					padding: "6px 10px",
					fontSize: 11,
					lineHeight: 1.3,
					boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
					maxWidth: 200,
					wordBreak: "break-word",
					pointerEvents: "none",
				};
				if (anchor) {
					wrapperStyle.top = anchor.top;
					wrapperStyle.left = anchor.left;
					wrapperStyle.transform = "translateY(-50%)";
				} else {
					wrapperStyle.top = 8;
					wrapperStyle.left = "50%";
					wrapperStyle.transform = "translateX(-50%)";
				}
				// First frame only: the chip must not flash at the old top-center
				// spot before the tab row has been measured.
				if (!measured) wrapperStyle.visibility = "hidden";

				return createElement("div", {
					ref: wrapperRef,
					style: wrapperStyle,
				}, [
					createElement("span", { key: "model" }, current.model + seekSuffix),
					peakIcon,
					peakPanel,
				]);
			}

			ctx.slots.inject("conversation.input.left", function () {
				return ctx.slots.register({
					name: "conversation.input.left",
					id: "composer-extras-model-status",
					order: 10,
				}, ModelStatusBadge);
			});

			/**
			 * File viewer (desni sidebar): dva dugmeta za otvoreni fajl.
			 *
			 *  - „Podeli" → Android share sheet preko termux-api (npr. generisan
			 *    video u VLC-u, PDF u čitaču).
			 *  - „Folder" → roditeljski folder u Solid Exploreru (za dalje
			 *    snalaženje i menadžment fajlova). Za Termux privatne putanje
			 *    server prvo napravi staging kopiju u Download/dsh-share, jer
			 *    Solid Explorer ne može da čita /data/data/com.termux/... .
			 *
			 * Slot-props nose `{ absolutePath }` (vidi
			 * dsh-client-ui-sidebar-documentpreview: `fileOwner`), pa je putanja
			 * dostupna bez ikakvog DOM-a. Injektuje se u header
			 * (`...document.actions`) i u telo kada preview nije moguć
			 * (`...document.unpreviewable` — npr. .zip ili video).
			 */
			function DocumentFileActions(props) {
				var absolutePath = props && typeof props.absolutePath === "string" ? props.absolutePath : undefined;
				var busyState = useState(null);
				var busy = busyState[0];
				var setBusy = busyState[1];
				var noteState = useState("");
				var note = noteState[0];
				var setNote = noteState[1];

				if (absolutePath === undefined) return null;

				var run = function (which) {
					if (busy !== null) return;
					setBusy(which);
					setNote("");
					var route = which === "share"
						? "/composer-extras/api/android-share"
						: "/composer-extras/api/android-folder";
					callApi(route, { path: absolutePath })
						.then(function (value) {
							if (which === "share") {
								setNote("Share sheet: " + ((value && value.mime) || "fajl"));
							} else if (value && value.staged === true) {
								setNote("Kopija u Download/dsh-share");
							} else {
								setNote("Otvoren folder");
							}
						})
						.catch(function (error) {
							setNote("Greška: " + (error && error.message ? error.message : String(error)));
						})
						.then(function () { setBusy(null); });
				};

				var makeButton = function (which, label, icon, title) {
					var active = busy === which;
					return createElement("button", {
						type: "button",
						title: title,
						"aria-label": title,
						onClick: function () { run(which); },
						disabled: busy !== null,
						style: {
							display: "inline-flex",
							alignItems: "center",
							gap: 3,
							flex: "none",
							height: 24,
							padding: "0 7px",
							fontSize: 11,
							lineHeight: 1,
							fontFamily: "inherit",
							cursor: busy !== null ? "default" : "pointer",
							color: "var(--dsw-alias-label-primary, inherit)",
							background: "var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.12))",
							border: "0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))",
							borderRadius: 6,
							opacity: busy !== null && !active ? 0.5 : 1,
						},
					},
						createElement("span", { "aria-hidden": true }, active ? "…" : icon),
						createElement("span", null, label));
				};

				return createElement("span", {
					"data-composer-extras-doc-actions": true,
					style: {
						marginLeft: "auto",
						display: "inline-flex",
						alignItems: "center",
						gap: 4,
						minWidth: 0,
						flex: "none",
					},
				},
					makeButton("share", "Podeli", "📤", "Podeli preko Android-a (termux-api) — npr. otvori video u VLC-u"),
					makeButton("folder", "Folder", "📂", "Otvori roditeljski folder u Solid Exploreru"),
					note === "" ? null : createElement("span", {
						title: note,
						style: {
							fontSize: 10,
							maxWidth: 190,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							color: "var(--dsw-alias-label-secondary, #888)",
						},
					}, note));
			}

			// Samo header (`...document.actions`). Injekcija u `...document.unpreviewable`
			// je uklonjena jer se ista dugmad tada vide DVA puta (header + sredina tela) —
			// vidi screenshot 2026-09-29. Header postoji i za nepodržane formate
			// (.zip, video), pa pokriva oba slučaja.
			ctx.slots.inject("sidebar.right.tab.document.actions", function () {
				return ctx.slots.register({
					name: "sidebar.right.tab.document.actions",
					id: "composer-extras-doc-actions",
					order: 50,
				}, DocumentFileActions);
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
