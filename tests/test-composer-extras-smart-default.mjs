/**
 * Test: pravilo automatskog paljenja `gemini-seek-smart` (2026-10-07, dopunjeno).
 *
 * Proverava TAČNO ono što je korisnik tražio:
 *   • prazna nova sesija (dugme '+', `SessionSummary.blank === true`)  → smart ON
 *   • prazna sesija dok host lista još nije stigla (`phase: "pending"`)  → NE
 *   • postojeći razgovor sa istorijom                                   → smart OFF
 *   • branchovana smart sesija (`…-on-<id>`)                            → smart ON
 *   • eksplicitan 😎 'off' klik na praznoj sesiji                       → smart OFF
 *   • server kaže `branch-info.smart === true` za neblank sesiju        → smart ON
 *
 * I REGRESIJU prijavljenu 2026-10-07 („restart dsh je uzrokovao da se smart
 * dugme uključi za ovu sesiju, a kontekst je već velik"):
 *   • neblank sesija sa `…-on-` oznakom, kontekst JOŠ NEPOZNAT (projekcija se
 *     replay-uje posle restarta)                                       → NE prebacuje model
 *   • …kad projekcija stigne sa >300k                                   → OFF + 'off' oznaka
 *   • …kad projekcija stigne sa <300k                                   → ON
 *   • kontekst poznat >300k odmah                                       → OFF + model na DeepSeek
 *   • ručni izbor modela dok je smart ON                                → trajna 'off' oznaka
 *   • submit sa >300k konteksta                                         → DeepSeek PRE slanja
 *
 * Ne pokreće pravi browser ni pravi React: minimalni React sa `useEffect`
 * koji se STVARNO izvršava, lažni `window.__ModuleLoader__`, lažni
 * `localStorage`, lažni `ctx.sessions.list`/`binding` (uključujući
 * `contextPressure` projekciju), lažni model-directory koji beleži `select()`
 * pozive, i DETERMINISTIČKI `setTimeout` (tajmeri se puštaju ručno, pa test ne
 * čeka 3 sekunde stvarnog vremena).
 *
 * Pokretanje:  node test-composer-extras-smart-default.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(here, "..", "dsh-composer-extras", "client.js");

// ─────────────────────────────────────────────────────────── minimalni React

let hooks = [];
let hookCursor = 0;
let pendingEffects = [];

const Fragment = Symbol("Fragment");

const React = {
	Fragment,
	createElement(type, props, ...children) {
		const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
		if (typeof type === "function") {
			return type({ ...(props || {}), children: kids.length <= 1 ? kids[0] : kids });
		}
		return { $$node: true, type, props: props || {}, children: kids };
	},
	useState(initial) {
		const i = hookCursor++;
		if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial;
		const set = (next) => { hooks[i] = typeof next === "function" ? next(hooks[i]) : next; };
		return [hooks[i], set];
	},
	useEffect(fn) { pendingEffects.push(fn); },
	useLayoutEffect(fn) { pendingEffects.push(fn); },
	useMemo(fn) { return fn(); },
	useCallback(fn) { return fn; },
	useRef(v) { return { current: v }; },
	useSyncExternalStore(_sub, get) { return get(); },
};

// ────────────────────────────────────────────────── lažni window/localStorage

function makeLocalStorage() {
	const map = new Map();
	return {
		getItem: (k) => (map.has(k) ? map.get(k) : null),
		setItem: (k, v) => { map.set(k, String(v)); },
		removeItem: (k) => { map.delete(k); },
		clear: () => map.clear(),
	};
}

let capturedFactory = null;
const window = {
	localStorage: makeLocalStorage(),
	__ModuleLoader__: {
		load(spec) { capturedFactory = spec.factory; },
	},
	addEventListener() {},
	removeEventListener() {},
	matchMedia: () => ({ matches: false, addEventListener() {} }),
};

const document = {
	createElement: () => ({ dataset: {}, style: {}, appendChild() {}, setAttribute() {} }),
	head: { appendChild() {} },
	body: { appendChild() {} },
};

// ──────────────────────────────────────────── deterministički tajmeri

const timers = [];
let timerSeq = 0;

function fakeSetTimeout(fn, ms) { timers.push({ id: ++timerSeq, fn, ms: ms || 0 }); return timerSeq; }
function fakeClearTimeout(id) {
	const at = timers.findIndex((t) => t.id === id);
	if (at >= 0) timers.splice(at, 1);
}
function fakeSetInterval() { return ++timerSeq; }
function fakeClearInterval() {}

/**
 * Pusti sve zakazane tajmere (i one koje oni sami zakazu), u krugovima, sa
 * `await` izmedju krugova da se razreše i promises.
 */
async function runTimers(rounds = 40) {
	for (let round = 0; round < rounds && timers.length > 0; round += 1) {
		const batch = timers.splice(0, timers.length);
		for (const timer of batch) timer.fn();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

// ─────────────────────────────────────────────────────────────── lažni fetch

const fetchCalls = [];
let branchInfoValue = { smart: false, model: null };
globalThis.fetch = async (url) => {
	fetchCalls.push(String(url));
	return {
		ok: true,
		status: 200,
		json: async () => ({ ok: true, value: branchInfoValue }),
	};
};

// ─────────────────────────────────────────────────────────────── lažni ctx

const registered = new Map();
const selects = [];
const submits = [];
let currentModel = { provider: "deepseek-official", model: "deepseek-flash" };
let sessionRows = {};
let sessionPhase = "ready";
/** sessionId -> veličina konteksta u tokenima; ODSUTNO = projekcija još nije stigla. */
const contexts = {};
/** sessionId -> lažni SessionInputShell (jedan po sesiji, kao u dsh-u). */
const inputs = {};

function setContext(sessionId, tokens) {
	if (tokens === undefined) delete contexts[sessionId];
	else contexts[sessionId] = tokens;
}

/** Directory je STABILAN po sesiji (watcher se kači na `__composerExtrasSeekWatched`). */
const directories = {};
function directoryFor(sessionId) {
	if (directories[sessionId] === undefined) {
		const listeners = new Set();
		directories[sessionId] = {
			__listeners: listeners,
			store: {
				getSnapshot: () => ({ current: currentModel }),
				subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
			},
			select: async (target) => {
				selects.push(target);
				currentModel = target;
				for (const fn of Array.from(listeners)) fn();
				return target;
			},
		};
	}
	return directories[sessionId];
}

/** Spoljna promena modela (kao da je korisnik izabrao u dropdownu). */
function pickModelExternally(target) {
	currentModel = target;
	const dir = directories[currentSessionId];
	if (dir !== undefined) for (const fn of Array.from(dir.__listeners)) fn();
}

let currentSessionId = undefined;

const ctx = {
	slots: {
		inject(_name, cb) { cb(); },
		register(opts, component) {
			if (!registered.has(opts.name)) registered.set(opts.name, new Map());
			registered.get(opts.name).set(opts.id, { opts, component });
			return () => {};
		},
	},
	sessions: {
		scope: (id) => ({ sessionId: id }),
		binding: (id) => ({
			session: {
				projections: {
					faceOf: (key) => (key === "contextPressure"
						? { getSnapshot: () => (contexts[id] === undefined ? undefined : { projectedTokens: contexts[id] }) }
						: undefined),
				},
				lastAgentError: null,
				notifier: { subscribe: () => () => {} },
			},
		}),
		list: {
			getSnapshot: () => ({ byId: sessionRows, ids: Object.keys(sessionRows), phase: sessionPhase }),
		},
	},
	modelDirectories: { directoryFor },
	get(name) {
		if (name === "conversation") {
			return {
				input: {
					for: (actx) => {
						const id = actx.sessionId;
						if (inputs[id] === undefined) {
							inputs[id] = {
								setDraft() {},
								getSnapshot: () => ({ draft: "" }),
								submit(mode) { submits.push({ sessionId: id, mode }); },
							};
						}
						return inputs[id];
					},
				},
			};
		}
		if (name === "uiWorkspace") return { openSession() {} };
		return undefined;
	},
};

// ───────────────────────────────────────────────────────────── učitaj plugin

const source = readFileSync(CLIENT_PATH, "utf8");
// eslint-disable-next-line no-new-func
new Function("window", "require", "fetch", "document", "setTimeout", "setInterval", "console", source)(
	window,
	(id) => {
		if (id === "react") return React;
		throw new Error("unknown require: " + id);
	},
	globalThis.fetch,
	document,
	fakeSetTimeout,
	fakeSetInterval,
	console,
);

if (capturedFactory === null) throw new Error("plugin se nije registrovao preko __ModuleLoader__");
const mod = capturedFactory((id) => {
	if (id === "react") return React;
	throw new Error("unknown require: " + id);
});
mod.apply(ctx);

// ──────────────────────────────────────────────────────────────── asertacije

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
	if (cond) { passed += 1; console.log(`  ✅ ${name}`); }
	else { failed += 1; console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); }
}

const GEMINI = { provider: "google", model: "gemini-flash-lite-latest" };
const DEEPSEEK = { provider: "deepseek-official", model: "deepseek-flash" };

function pickedGemini() {
	return selects.some((s) => s.provider === GEMINI.provider && s.model === GEMINI.model);
}
function pickedDeepSeek() {
	return selects.some((s) => s.provider === DEEPSEEK.provider && s.model === DEEPSEEK.model);
}

/** Jedan 'mount' GeminiSeekButton-a: render + izvrši useEffect, pa pusti promises. */
async function mount(sessionId) {
	selects.length = 0;
	submits.length = 0;
	fetchCalls.length = 0;
	timers.length = 0;
	hookCursor = 0;
	pendingEffects = [];
	const entry = registered.get("conversation.input.left").get("composer-extras-gemini-seek");
	if (!entry) throw new Error("GeminiSeekButton nije registrovan");
	const tree = entry.component({ sessionId });
	for (const fn of pendingEffects) fn();
	// activateGeminiSeek -> ensureModelSelected (async) i branch-info fetch (async)
	for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
	// Re-render kao pravi `setTick` iz `notify()`-ja: hook stanje se NE resetuje,
	// a novi useEffect se odbacuje (kao što React ne bi ponovo pokrenuo efekat
	// bez promene dependency-ja).
	hookCursor = 0;
	pendingEffects = [];
	const treeAfterTick = entry.component({ sessionId });
	return treeAfterTick !== undefined ? treeAfterTick : tree;
}

function titleOf(tree) {
	return tree && tree.props ? tree.props.title : undefined;
}

function reset(sessionId) {
	currentSessionId = sessionId;
	currentModel = { ...DEEPSEEK };
	sessionRows = {};
	sessionPhase = "ready";
	window.localStorage.clear();
	for (const key of Object.keys(inputs)) delete inputs[key];
}

console.log("\nSMART DEFAULT — prazna nova sesija vs. postojeci razgovor");

// ── 1. prazna nova sesija → smart ON ──────────────────────────────────────
{
	const id = "session-blank-1";
	reset(id);
	sessionRows = { [id]: { id, blank: true } };
	setContext(id, undefined); // nova sesija: kontekst još nema nijedan usage
	const tree = await mount(id);
	check("prazna sesija: model prebacen na Gemini", pickedGemini(), JSON.stringify(selects));
	check("prazna sesija: nema branch-info poziva (odluceno lokalno)", fetchCalls.length === 0, JSON.stringify(fetchCalls));
	check("prazna sesija: tooltip nije (off)", typeof titleOf(tree) === "string" && !titleOf(tree).includes("(off)"), String(titleOf(tree)));
}

// ── 2. prazna sesija dok host lista još nije stigla → NE ──────────────────
{
	const id = "session-blank-pending";
	reset(id);
	sessionRows = { [id]: { id, blank: true } };
	sessionPhase = "pending"; // DSH: „unknown bare sessions begin conservatively blank"
	setContext(id, undefined);
	const tree = await mount(id);
	check("prazna + lista jos nije stigla: model NIJE diran", selects.length === 0, JSON.stringify(selects));
	check("prazna + lista jos nije stigla: tooltip je (off)", typeof titleOf(tree) === "string" && titleOf(tree).includes("(off)"), String(titleOf(tree)));
}

// ── 3. postojeci razgovor → smart OFF ─────────────────────────────────────
{
	const id = "session-history-1";
	reset(id);
	sessionRows = { [id]: { id, blank: false } };
	branchInfoValue = { smart: false, model: null };
	const tree = await mount(id);
	check("postojeci razgovor: model NIJE diran", selects.length === 0, JSON.stringify(selects));
	check("postojeci razgovor: pitao je branch-info", fetchCalls.some((u) => u.includes("/composer-extras/api/branch-info")), JSON.stringify(fetchCalls));
	check("postojeci razgovor: tooltip je (off)", typeof titleOf(tree) === "string" && titleOf(tree).includes("(off)"), String(titleOf(tree)));
}

// ── 4. branchovana smart sesija, mali kontekst → smart ON ─────────────────
{
	const id = "session-branch-1";
	reset(id);
	sessionRows = { [id]: { id, blank: false } };
	window.localStorage.setItem("composer-extras-gemini-seek-on-" + id, "1");
	setContext(id, 12000);
	await mount(id);
	check("branchovana (on-oznaka) + mali kontekst: model prebacen na Gemini", pickedGemini(), JSON.stringify(selects));
}

// ── 5. prazna ali eksplicitno ugasena → smart OFF ─────────────────────────
{
	const id = "session-blank-off-1";
	reset(id);
	sessionRows = { [id]: { id, blank: true } };
	window.localStorage.setItem("composer-extras-gemini-seek-off-" + id, "1");
	const tree = await mount(id);
	check("prazna + 😎 off: model NIJE diran", selects.length === 0, JSON.stringify(selects));
	check("prazna + 😎 off: nema ni branch-info poziva", fetchCalls.length === 0, JSON.stringify(fetchCalls));
	check("prazna + 😎 off: tooltip je (off)", typeof titleOf(tree) === "string" && titleOf(tree).includes("(off)"), String(titleOf(tree)));
}

// ── 6. server kaze smart:true za neblank sesiju, mali kontekst → ON ───────
{
	const id = "session-server-1";
	reset(id);
	sessionRows = { [id]: { id, blank: false } };
	branchInfoValue = { smart: true, model: GEMINI };
	setContext(id, 8000);
	await mount(id);
	check("server branch-info smart:true: model prebacen na Gemini", pickedGemini(), JSON.stringify(selects));
}

console.log("\nREGRESIJA — restart ne sme da vrati Gemini u veliku sesiju");

// ── 7. kontekst još nepoznat (replay posle restarta) → NE prebacuj ────────
{
	const id = "session-restart-unknown";
	reset(id);
	sessionRows = { [id]: { id, blank: false } };
	window.localStorage.setItem("composer-extras-gemini-seek-on-" + id, "1"); // branch 'on' oznaka
	setContext(id, undefined); // projekcija još nije stigla
	await mount(id);
	check("nepoznat kontekst: model NIJE prebacen na Gemini", !pickedGemini(), JSON.stringify(selects));
	check("nepoznat kontekst: čeka se projekcija (tajmer zakazan)", timers.length > 0, String(timers.length));
	await runTimers();
	check("nepoznat kontekst: i posle isteka čekanja ostaje bez Gemini-ja", !pickedGemini(), JSON.stringify(selects));
	check("nepoznat kontekst: nije upisana trajna 'off' oznaka (odluka nije doneta)",
		window.localStorage.getItem("composer-extras-gemini-seek-off-" + id) === null);
}

// ── 8. projekcija stigne tokom čekanja i IMA >300k → OFF + 'off' oznaka ───
{
	const id = "session-restart-big";
	reset(id);
	sessionRows = { [id]: { id, blank: false } };
	window.localStorage.setItem("composer-extras-gemini-seek-on-" + id, "1");
	setContext(id, undefined);
	await mount(id);
	check("velika sesija: pre nego sto projekcija stigne — nema Gemini-ja", !pickedGemini(), JSON.stringify(selects));
	setContext(id, 480000); // replay je stigao: kontekst je odavno prerasao free tier
	await runTimers();
	check("velika sesija: ostaje bez Gemini-ja", !pickedGemini(), JSON.stringify(selects));
	check("velika sesija: upisana trajna 'off' oznaka",
		window.localStorage.getItem("composer-extras-gemini-seek-off-" + id) === "1",
		String(window.localStorage.getItem("composer-extras-gemini-seek-off-" + id)));
}

// ── 9. projekcija stigne tokom čekanja i ima <300k → ON ──────────────────
{
	const id = "session-restart-small";
	reset(id);
	sessionRows = { [id]: { id, blank: false } };
	window.localStorage.setItem("composer-extras-gemini-seek-on-" + id, "1");
	setContext(id, undefined);
	await mount(id);
	check("sveza branchovana sesija: prvo čeka", !pickedGemini(), JSON.stringify(selects));
	setContext(id, 15000);
	await runTimers();
	check("sveza branchovana sesija: kad projekcija stigne (15k) → Gemini", pickedGemini(), JSON.stringify(selects));
}

// ── 10. kontekst poznat >300k odmah → OFF + model sklonjen sa Gemini-ja ──
{
	const id = "session-known-big";
	reset(id);
	sessionRows = { [id]: { id, blank: false } };
	window.localStorage.setItem("composer-extras-gemini-seek-on-" + id, "1");
	currentModel = { ...GEMINI }; // smart ga je ranije ostavio ovde
	setContext(id, 520000);
	await mount(id);
	check("poznat >300k: model NIJE (ponovo) prebacen na Gemini", !pickedGemini(), JSON.stringify(selects));
	check("poznat >300k: model je sklonjen na DeepSeek", pickedDeepSeek(), JSON.stringify(selects));
	check("poznat >300k: trajna 'off' oznaka",
		window.localStorage.getItem("composer-extras-gemini-seek-off-" + id) === "1");
}

// ── 11. ručni izbor modela dok je smart ON → trajna 'off' oznaka ─────────
{
	const id = "session-manual-model";
	reset(id);
	sessionRows = { [id]: { id, blank: true } };
	setContext(id, 5000);
	await mount(id);
	check("rucni izbor: smart je prvo upaljen (Gemini)", pickedGemini(), JSON.stringify(selects));
	pickModelExternally({ provider: "deepseek-official", model: "deepseek-flash" });
	check("rucni izbor: upisana trajna 'off' oznaka (preživi restart)",
		window.localStorage.getItem("composer-extras-gemini-seek-off-" + id) === "1",
		String(window.localStorage.getItem("composer-extras-gemini-seek-off-" + id)));
}

// ── 12. submit sa >300k → DeepSeek PRE slanja ────────────────────────────
{
	const id = "session-submit-big";
	reset(id);
	sessionRows = { [id]: { id, blank: true } };
	setContext(id, 5000);
	await mount(id);
	check("submit: smart je upaljen sa malim kontekstom", pickedGemini(), JSON.stringify(selects));
	selects.length = 0;
	setContext(id, 600000); // sesija je u medjuvremenu prerasla granicu
	inputs[id].submit("send");
	await new Promise((r) => setTimeout(r, 0));
	await new Promise((r) => setTimeout(r, 0));
	check("submit: model je vracen na DeepSeek", pickedDeepSeek(), JSON.stringify(selects));
	check("submit: prompt je ipak poslat", submits.length === 1, JSON.stringify(submits));
	check("submit: trajna 'off' oznaka",
		window.localStorage.getItem("composer-extras-gemini-seek-off-" + id) === "1");
}

console.log(`\n${failed === 0 ? "SVE OK" : "IMENA GRESAKA"}: ${passed} proslo, ${failed} palo\n`);
process.exit(failed === 0 ? 0 : 1);
