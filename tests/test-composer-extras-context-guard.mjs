/**
 * Test harness za dsh-composer-extras: ContextGuard (okidač na 500k),
 * BranchIntoNewSessionButton (dve unakrsne strelice) i NewlineButton.
 *
 * Ne pokreće pravi browser: pravi minimalni React (createElement + useState),
 * lažni `window.__ModuleLoader__`, lažni `ctx` i lažni `fetch`, pa tera
 * komponente kroz stvarne slotove koje plugin registruje.
 *
 * Pokretanje:  node test-composer-extras-context-guard.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(here, "..", "dsh-composer-extras", "client.js");

// ─────────────────────────────────────────────────────────── minimalni React

let hooks = [];
let hookCursor = 0;

function resetHooks() {
	hooks = [];
	hookCursor = 0;
}

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
		const set = (next) => {
			hooks[i] = typeof next === "function" ? next(hooks[i]) : next;
		};
		return [hooks[i], set];
	},
	useEffect() {},
	useLayoutEffect() {},
	useMemo(fn) { return fn(); },
	useCallback(fn) { return fn; },
	useRef(v) { return { current: v }; },
	useSyncExternalStore(_sub, get) { return get(); },
};

// ──────────────────────────────────────────────────────────────── DOM/node

function textOf(node) {
	if (node === null || node === undefined) return "";
	if (typeof node === "string") return node;
	if (typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(textOf).join("");
	if (node.$$node) {
		if (node.type === Fragment) return node.children.map(textOf).join("");
		return node.children.map(textOf).join("");
	}
	return "";
}

function walk(node, out = []) {
	if (node === null || node === undefined) return out;
	if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return out; }
	if (node.$$node) {
		out.push(node);
		node.children.forEach((c) => walk(c, out));
	}
	return out;
}

function buttons(node) {
	return walk(node).filter((n) => n.type === "button");
}

function findByProp(node, key) {
	return walk(node).find((n) => n.props && n.props[key] !== undefined);
}

function nodeWithText(node, text) {
	return walk(node).find((n) => textOf(n).includes(text));
}

// ─────────────────────────────────────────────────────────── lažno okruženje

const storage = new Map();
const localStorage = {
	getItem: (k) => (storage.has(k) ? storage.get(k) : null),
	setItem: (k, v) => { storage.set(k, String(v)); },
	removeItem: (k) => { storage.delete(k); },
};

let moduleRegistration = null;
const window = {
	__ModuleLoader__: { load: (reg) => { moduleRegistration = reg; } },
	localStorage,
	prompt: () => null,
	confirm: () => false,
	addEventListener() {},
	removeEventListener() {},
	innerWidth: 400,
	setTimeout,
	clearTimeout,
	setInterval,
	clearInterval,
};

globalThis.window = window;
globalThis.document = {
	addEventListener() {},
	removeEventListener() {},
	querySelector: () => null,
	createElement: () => ({ dataset: {}, style: {}, appendChild() {} }),
	head: { appendChild() {} },
	body: { appendChild() {} },
};

const fetchCalls = [];
let fetchImpl = async (url, opts) => ({
	ok: true,
	status: 200,
	json: async () => ({ ok: true, value: { sessionId: "session-new-1" } }),
});
globalThis.fetch = async (url, opts) => {
	fetchCalls.push({ url, opts });
	return fetchImpl(url, opts);
};

// ─────────────────────────────────────────────────────────────── lažni ctx

const registered = new Map(); // slotName → Map(id → component)

function makeInput(initialDraft = "") {
	const state = { draft: initialDraft };
	return {
		api: {
			state: { getSnapshot: () => ({ draft: state.draft }) },
			setDraft: (v) => { state.draft = v; },
			// Realni composer submit KONZUMIRA draft (submit-plane ga uzme).
			submit() { this.__submits = (this.__submits || 0) + 1; state.draft = ""; },
		},
		get draft() { return state.draft; },
	};
}

let activeInput = null;

const ctx = {
	slots: {
		inject(name, cb) {
			cb();
		},
		register(opts, component) {
			if (!registered.has(opts.name)) registered.set(opts.name, new Map());
			registered.get(opts.name).set(opts.id, { opts, component });
			return () => {};
		},
	},
	sessions: {
		scope: (id) => ({ sessionId: id }),
	},
	get(name) {
		if (name === "conversation") {
			return { input: { for: () => activeInput.api } };
		}
		if (name === "uiWorkspace") return ctx.uiWorkspace;
		return undefined;
	},
	uiWorkspace: {
		opened: [],
		openSession(id) { this.opened.push(id); },
	},
	modelDirectories: {},
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
	globalThis.document,
	setTimeout,
	setInterval,
	console,
);

// ─────────────────────────────────────────────────────────────────── asertacije

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
	if (cond) {
		passed += 1;
		console.log(`  ✅ ${name}`);
	} else {
		failed += 1;
		console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`);
	}
}

function section(title) {
	console.log(`\n${title}`);
}

function render(slotName, id, props) {
	const entry = registered.get(slotName) && registered.get(slotName).get(id);
	if (!entry) throw new Error(`slot ${slotName}/${id} not registered`);
	resetHooks();
	return entry.component(props);
}

/**
 * Ponovni render ISTE instance: hook stanje se NE resetuje, pa `setState` iz
 * onClick-a bude vidljiv — kao što bi React uradio.
 */
function rerender(slotName, id, props) {
	const entry = registered.get(slotName) && registered.get(slotName).get(id);
	if (!entry) throw new Error(`slot ${slotName}/${id} not registered`);
	hookCursor = 0;
	return entry.component(props);
}

function renderGuard(pressure, sessionId = "session-test-1") {
	const calls = [];
	const useProjection = (key) => { calls.push(key); return pressure; };
	const tree = render("conversation.input.left", "composer-extras-context-guard", {
		sessionId,
		useProjection,
	});
	return { tree, calls };
}

// ── 1. registracija ────────────────────────────────────────────────────────

section("1. Registracija modula i slotova");
check("modul se registrovao pod id 'dsh-composer-extras'", moduleRegistration && moduleRegistration.id === "dsh-composer-extras");

const exportsObj = moduleRegistration.factory((id) => {
	if (id === "react") return React;
	throw new Error("unknown require: " + id);
});

check("inject NE zahteva 'uiWorkspace' (tvrd zahtev bi oborio ceo plugin)",
	Array.isArray(exportsObj.inject) && !exportsObj.inject.includes("uiWorkspace"),
	JSON.stringify(exportsObj.inject));

resetHooks();
exportsObj.apply(ctx);

const left = registered.get("conversation.input.left") || new Map();
check("registrovan 'composer-extras-branch-new-session'", left.has("composer-extras-branch-new-session"));
check("registrovan 'composer-extras-newline'", left.has("composer-extras-newline"));
check("registrovan 'composer-extras-context-guard'", left.has("composer-extras-context-guard"));
check("stari slotovi netaknuti (paperclip/try-again/proceed)",
	left.has("composer-extras-paperclip") && left.has("composer-extras-try-again") && left.has("composer-extras-proceed"));

// ── 2. ContextGuard: prag i izvor broja ────────────────────────────────────

section("2. ContextGuard — prag od 500.000 (50% od 1M)");

{
	const { tree, calls } = renderGuard({ pressureTokens: 499999, contextWindow: 1000000 });
	check("ispod praga (499.999) → nema popup-a", tree === null);
	check("čita TAČNO 'contextPressure' (ne 'tokenUsage')",
		calls.length === 1 && calls[0] === "contextPressure", JSON.stringify(calls));
}

{
	const { tree } = renderGuard({ pressureTokens: 500000, contextWindow: 1000000 });
	check("tačno na pragu (500.000 = 50%) → popup se pojavljuje", tree !== null);
	check("popup prikazuje 50%", textOf(tree).includes("50%"), textOf(tree).slice(0, 120));
	const btns = buttons(tree);
	check("popup ima tri dugmeta (branch / compact / nastavi)", btns.length === 3, `nađeno ${btns.length}`);
	const labels = textOf(tree);
	check("nudi 'Branch into new session'", labels.includes("Branch into new session"));
	check("nudi 'Compact session'", labels.includes("Compact session"));
	check("nudi 'Nastavi dalje'", labels.includes("Nastavi dalje"));
}

{
	// projectedTokens ima prednost (isto kao ContextMeter u core-u)
	const { tree } = renderGuard({ projectedTokens: 260000, pressureTokens: 900000, contextWindow: 1000000 });
	check("koristi projectedTokens pre pressureTokens (260k < prag) → nema popup-a", tree === null);
}

{
	const { tree } = renderGuard({ pressureTokens: 750000, contextWindow: 1000000 });
	check("750.000 (75%) → popup", tree !== null);
}

{
	const { tree } = renderGuard({ pressureTokens: 1000000, contextWindow: 1000000 });
	check("1.000.000 (100%) → popup", tree !== null);
	check("procenat ograničen na 100%", textOf(tree).includes("100%"));
}

// ── 3. REGRESIJA: kumulativna potrošnja ne sme da okine popup ─────────────

section("3. Regresija — Token usage (kumulativno) NE pokreće popup");
{
	// Ovo je scenario sa screenshota: 25,5M ukupno, 925k uncached, a kontekst
	// (pressure) je zapravo bio ~250k = 25%.
	const { tree } = renderGuard({ projectedTokens: 250000, pressureTokens: 240000, contextWindow: 1000000 });
	check("25,5M kumulativno + 25% zauzetosti → NEMA popup-a (isključivo pressure se meri)", tree === null);
}

// ── 4. odbacivanje opsega ─────────────────────────────────────────────────

section("4. ContextGuard — odbacivanje (Nastavi dalje)");
{
	const sessionId = "session-dismiss-test";
	storage.clear();
	const first = renderGuard({ pressureTokens: 520000, contextWindow: 1000000 }, sessionId);
	check("prvi render iznad praga → popup", first.tree !== null);

	// klik na „Nastavi dalje" (treće dugme)
	const later = buttons(first.tree)[2];
	later.props.onClick();

	const second = renderGuard({ pressureTokens: 520000, contextWindow: 1000000 }, sessionId);
	check("posle odbacivanja, isti opseg se ne prikazuje", second.tree === null);

	const third = renderGuard({ pressureTokens: 800000, contextWindow: 1000000 }, sessionId);
	check("posle rasta u sledeći opseg (800k) → popup se vraća", third.tree !== null);
}

// ── 5. Branch dugme ───────────────────────────────────────────────────────

section("5. BranchIntoNewSessionButton (dve unakrsne strelice)");

{
	fetchCalls.length = 0;
	activeInput = makeInput("");
	resetHooks();
	const tree = render("conversation.input.left", "composer-extras-branch-new-session", { sessionId: "session-src" });
	const btn = buttons(tree)[0];
	check("dugme postoji", btn !== undefined);
	btn.props.onClick();

	const post = fetchCalls.find((c) => c.url.includes("/api/branch-session"));
	check("prazan draft → NE šalje zahtev", post === undefined);

	// setState iz onClick-a se vidi tek na sledećem renderu iste instance.
	const after = rerender("conversation.input.left", "composer-extras-branch-new-session", { sessionId: "session-src" });
	check("prazan draft → prikazuje uputstvo", /napiši prompt/i.test(textOf(after)), textOf(after));
}

{
	fetchCalls.length = 0;
	activeInput = makeInput("Napravi rezime sezone 3");
	resetHooks();
	const tree = render("conversation.input.left", "composer-extras-branch-new-session", { sessionId: "session-src" });
	buttons(tree)[0].props.onClick();
	await Promise.resolve();

	const post = fetchCalls.find((c) => c.url.includes("/api/branch-session"));
	check("neprazan draft → POST /composer-extras/api/branch-session", post !== undefined);
	if (post) {
		const body = JSON.parse(post.opts.body);
		check("šalje trenutni draft kao prompt", body.prompt === "Napravi rezime sezone 3", JSON.stringify(body));
		check("šalje parentSession", body.parentSession === "session-src");
		check("NE zahteva kopiranje istorije (historyShared se ne šalje)", body.historyShared === undefined);
	}
	await new Promise((r) => setTimeout(r, 10));
	check("prebacuje GUI na novu sesiju", ctx.uiWorkspace.opened.includes("session-new-1"),
		JSON.stringify(ctx.uiWorkspace.opened));
}

// ── 6. Newline dugme ──────────────────────────────────────────────────────

section("6. NewlineButton (višeredni prompt)");
{
	activeInput = makeInput("prvi red");
	resetHooks();
	const tree = render("conversation.input.left", "composer-extras-newline", { sessionId: "session-nl" });
	buttons(tree)[0].props.onClick();
	check("dodaje novi red na draft", activeInput.draft === "prvi red\n", JSON.stringify(activeInput.draft));
	check("NE šalje poruku", (activeInput.api.__submits || 0) === 0);

	// prazan draft
	activeInput = makeInput("");
	resetHooks();
	const tree2 = render("conversation.input.left", "composer-extras-newline", { sessionId: "session-nl" });
	buttons(tree2)[0].props.onClick();
	check("radi i na praznom draftu", activeInput.draft === "\n", JSON.stringify(activeInput.draft));
}

// ── 7. Compact iz popup-a ─────────────────────────────────────────────────

section("7. Compact iz popup-a — /compact bez brisanja drafta");
{
	storage.clear();
	activeInput = makeInput("moj nedovršen tekst");
	resetHooks();
	const tree = render("conversation.input.left", "composer-extras-context-guard", {
		sessionId: "session-compact",
		useProjection: () => ({ pressureTokens: 600000, contextWindow: 1000000 }),
	});
	const compactBtn = buttons(tree)[1];
	check("drugo dugme je Compact", textOf(compactBtn).includes("Compact"), textOf(compactBtn));
	compactBtn.props.onClick();

	check("poslat je /compact (submit pozvan, draft konzumiran)", (activeInput.api.__submits || 0) === 1);

	// Prvi interval (50ms) vidi prazan draft i vraća korisnikov tekst.
	await new Promise((r) => setTimeout(r, 200));
	check("korisnikov draft vraćen posle komande", activeInput.draft === "moj nedovršen tekst",
		JSON.stringify(activeInput.draft));
}

{
	// Komanda NIJE konzumirana (npr. /compact odbijen jer agent nije idle):
	// draft ostaje „/compact", pa ga fallback na roku MORА vratiti korisniku.
	storage.clear();
	activeInput = makeInput("tekst koji ne sme da se izgubi");
	activeInput.api.submit = function () { this.__submits = (this.__submits || 0) + 1; };
	resetHooks();
	const tree = render("conversation.input.left", "composer-extras-context-guard", {
		sessionId: "session-compact-reject",
		useProjection: () => ({ pressureTokens: 610000, contextWindow: 1000000 }),
	});
	buttons(tree)[1].props.onClick();
	check("nekonzumirana komanda ostaje u draftu odmah posle klika", activeInput.draft === "/compact");

	await new Promise((r) => setTimeout(r, 1900));
	check("posle roka, korisnikov tekst je vraćen (nije izgubljen)",
		activeInput.draft === "tekst koji ne sme da se izgubi", JSON.stringify(activeInput.draft));
}

// ───────────────────────────────────────────────────────────────── rezultat

console.log(`\n${"─".repeat(60)}`);
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
