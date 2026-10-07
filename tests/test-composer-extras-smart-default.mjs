/**
 * Test: pravilo automatskog paljenja `gemini-seek-smart` (2026-10-07).
 *
 * Proverava TAČNO ono što je korisnik tražio:
 *   • prazna nova sesija (dugme „+", `SessionSummary.blank === true`)  → smart ON
 *   • postojeći razgovor sa istorijom                                  → smart OFF
 *   • branchovana smart sesija (`…-on-<id>`)                           → smart ON
 *   • eksplicitan 😎 „off" klik na praznoj sesiji                      → smart OFF
 *   • server kaže `branch-info.smart === true` za neblank sesiju       → smart ON
 *
 * Ne pokreće pravi browser ni pravi React: minimalni React sa `useEffect`
 * koji se STVARNO izvršava (postojeći context-guard harness ga ignoriše, pa
 * ovaj test postoji odvojeno), lažni `window.__ModuleLoader__`, lažni
 * `localStorage`, lažni `ctx.sessions.list` i lažni model-directory koji beleži
 * `select()` pozive.
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
let currentModel = { provider: "deepseek-official", model: "deepseek-flash" };
let sessionRows = {};

function directoryFor() {
	const dir = {
		store: {
			getSnapshot: () => ({ current: currentModel }),
			subscribe: () => () => {},
		},
		select: async (target) => { selects.push(target); currentModel = target; return target; },
	};
	return dir;
}

const input = {
	setDraft() {},
	getSnapshot: () => ({ draft: "" }),
	submit() {},
};

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
		binding: () => undefined,
		list: { getSnapshot: () => ({ byId: sessionRows, ids: Object.keys(sessionRows), phase: "ready" }) },
	},
	modelDirectories: { directoryFor },
	get(name) {
		if (name === "conversation") return { input: { for: () => input } };
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
	setTimeout,
	setInterval,
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

/** Jedan „mount" GeminiSeekButton-a: render + izvrši useEffect, pa pusti promises. */
async function mount(sessionId) {
	selects.length = 0;
	fetchCalls.length = 0;
	hooks = [];
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

console.log("\nSMART DEFAULT — prazna nova sesija vs. postojeci razgovor");

// ── 1. prazna nova sesija → smart ON ──────────────────────────────────────
{
	const id = "session-blank-1";
	sessionRows = { [id]: { id, blank: true } };
	currentModel = { provider: "deepseek-official", model: "deepseek-flash" };
	const tree = await mount(id);
	check("prazna sesija: model prebacen na Gemini", selects.some((s) => s.provider === GEMINI.provider && s.model === GEMINI.model),
		JSON.stringify(selects));
	check("prazna sesija: nema branch-info poziva (odluceno lokalno)", fetchCalls.length === 0, JSON.stringify(fetchCalls));
	check("prazna sesija: tooltip nije (off)", typeof titleOf(tree) === "string" && !titleOf(tree).includes("(off)"), String(titleOf(tree)));
}

// ── 2. postojeci razgovor → smart OFF ─────────────────────────────────────
{
	const id = "session-history-1";
	sessionRows = { [id]: { id, blank: false } };
	branchInfoValue = { smart: false, model: null };
	currentModel = { provider: "deepseek-official", model: "deepseek-flash" };
	const tree = await mount(id);
	check("postojeci razgovor: model NIJE diran", selects.length === 0, JSON.stringify(selects));
	check("postojeci razgovor: pitao je branch-info", fetchCalls.some((u) => u.includes("/composer-extras/api/branch-info")), JSON.stringify(fetchCalls));
	check("postojeci razgovor: tooltip je (off)", typeof titleOf(tree) === "string" && titleOf(tree).includes("(off)"), String(titleOf(tree)));
}

// ── 3. branchovana smart sesija → smart ON ────────────────────────────────
{
	const id = "session-branch-1";
	sessionRows = { [id]: { id, blank: false } };
	window.localStorage.setItem("composer-extras-gemini-seek-on-" + id, "1");
	currentModel = { provider: "deepseek-official", model: "deepseek-flash" };
	await mount(id);
	check("branchovana (on-oznaka): model prebacen na Gemini", selects.some((s) => s.provider === GEMINI.provider && s.model === GEMINI.model),
		JSON.stringify(selects));
}

// ── 4. prazna ali eksplicitno ugasena → smart OFF ─────────────────────────
{
	const id = "session-blank-off-1";
	sessionRows = { [id]: { id, blank: true } };
	window.localStorage.setItem("composer-extras-gemini-seek-off-" + id, "1");
	currentModel = { provider: "deepseek-official", model: "deepseek-flash" };
	const tree = await mount(id);
	check("prazna + 😎 off: model NIJE diran", selects.length === 0, JSON.stringify(selects));
	check("prazna + 😎 off: nema ni branch-info poziva", fetchCalls.length === 0, JSON.stringify(fetchCalls));
	check("prazna + 😎 off: tooltip je (off)", typeof titleOf(tree) === "string" && titleOf(tree).includes("(off)"), String(titleOf(tree)));
}

// ── 5. server kaze smart:true za neblank sesiju → smart ON ────────────────
{
	const id = "session-server-1";
	sessionRows = { [id]: { id, blank: false } };
	branchInfoValue = { smart: true, model: GEMINI };
	currentModel = { provider: "deepseek-official", model: "deepseek-flash" };
	await mount(id);
	check("server branch-info smart:true: model prebacen na Gemini", selects.some((s) => s.provider === GEMINI.provider && s.model === GEMINI.model),
		JSON.stringify(selects));
}

console.log(`\n${failed === 0 ? "SVE OK" : "IMENA GRESAKA"}: ${passed} proslo, ${failed} palo\n`);
process.exit(failed === 0 ? 0 : 1);
