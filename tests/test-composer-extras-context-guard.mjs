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

/**
 * `react-dom` u testu: `createPortal` ne dira pravi DOM, samo umota čvor u
 * prozirni `$$node` sa `portalTarget` — pa `walk`/`textOf` rade isto kao da je
 * portal običan element, a test može da proveri GDE je portal otišao.
 */
const ReactDOM = {
	createPortal(node, container) {
		return { $$node: true, type: "portal", props: {}, children: [node], portalTarget: container };
	},
};

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

/** Slušalaci registrovani preko `ctx.on` (btw komanda sluša `command/executed`). */
const eventListeners = new Map();

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
	on(name, listener) {
		if (!eventListeners.has(name)) eventListeners.set(name, []);
		eventListeners.get(name).push(listener);
		return () => {
			const list = eventListeners.get(name) || [];
			const index = list.indexOf(listener);
			if (index >= 0) list.splice(index, 1);
		};
	},
	/** Emituj kao što to radi `CommandUiRuntime.notifyExecuted`. */
	emit(name, ...args) {
		for (const listener of eventListeners.get(name) || []) listener(...args);
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
		if (id === "react-dom") return ReactDOM;
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

/** Sve što nosi `data-composer-extras-context-guard` sa datom vrednošću. */
function guardTag(tree, value) {
	return walk(tree).find((n) => n.props && n.props["data-composer-extras-context-guard"] === value);
}

/** Pun panel (kartica) nosi `data-composer-extras-context-guard: true`, pill "pill", maska "mask". */
function isFullPanel(tree) {
	return guardTag(tree, true) !== undefined;
}

function isPill(tree) {
	return guardTag(tree, "pill") !== undefined;
}

function overlayOf(tree) {
	return walk(tree).find((n) => n.props && n.props["data-composer-extras-context-guard-overlay"] === true);
}

/** Čvor koji je `createPortal` vratio (nosi `portalTarget`). */
function portalOf(tree) {
	return walk(tree).find((n) => n.portalTarget !== undefined);
}

// ── 1. registracija ────────────────────────────────────────────────────────

section("1. Registracija modula i slotova");
check("modul se registrovao pod id 'dsh-composer-extras'", moduleRegistration && moduleRegistration.id === "dsh-composer-extras");

const exportsObj = moduleRegistration.factory((id) => {
	if (id === "react") return React;
	if (id === "react-dom") return ReactDOM;
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

/**
 * Prag guard-a se ČITA iz samog koda (a ne hardkoduje u testu): prag je
 * `min(CONTEXT_GUARD_TOKENS, prozor × CONTEXT_GUARD_WINDOW_FRACTION)`, pa test
 * ostaje validan i kad se fraction privremeno spusti (npr. 0.25 za testiranje)
 * i kad se vrati na 0.5.
 */
const WINDOW = 1000000;
const guardTokensConst = Number(/CONTEXT_GUARD_TOKENS = (\d+)/.exec(source)[1]);
const guardFraction = Number(/CONTEXT_GUARD_WINDOW_FRACTION = ([\d.]+)/.exec(source)[1]);
const guardRenudge = Number(/CONTEXT_GUARD_RENUDGE = (\d+)/.exec(source)[1]);
const GUARD_AT = Math.min(guardTokensConst, Math.round(WINDOW * guardFraction));
const GUARD_BELOW = GUARD_AT - 1;
const GUARD_PERCENT = Math.round((GUARD_AT / WINDOW) * 100);
const GUARD_NEXT_BAND = GUARD_AT + guardRenudge;

section(`2. ContextGuard — prag od ${GUARD_AT.toLocaleString("sr-RS")} (${GUARD_PERCENT}% od 1M)`);

{
	// 2026-10-08: korisnik traži „da ga ne vidim ispod 50%" — frakcija je
	// vraćena sa privremenih 0.05/0.25 na 0.5 i tu ostaje.
	check("prag je TAČNO 50% prozora (0.5, ne privremenih 0.05/0.25)",
		guardFraction === 0.5 && GUARD_AT === 500000,
		`frakcija=${guardFraction} prag=${GUARD_AT}`);
}

{
	const { tree, calls } = renderGuard({ pressureTokens: GUARD_BELOW, contextWindow: WINDOW });
	check(`ispod praga (${GUARD_BELOW.toLocaleString("sr-RS")}) → nema popup-a`, tree === null);
	check("čita TAČNO 'contextPressure' (ne 'tokenUsage')",
		calls.length === 1 && calls[0] === "contextPressure", JSON.stringify(calls));
}

{
	const { tree } = renderGuard({ pressureTokens: GUARD_AT, contextWindow: WINDOW });
	check(`tačno na pragu (${GUARD_AT.toLocaleString("sr-RS")} = ${GUARD_PERCENT}%) → popup se pojavljuje`, tree !== null);
	check(`popup prikazuje ${GUARD_PERCENT}%`, textOf(tree).includes(`${GUARD_PERCENT}%`), textOf(tree).slice(0, 120));
	const btns = buttons(tree);
	check("popup ima tri dugmeta (branch / compact / nastavi)", btns.length === 3, `nađeno ${btns.length}`);
	const labels = textOf(tree);
	check("nudi 'Branch into new session'", labels.includes("Branch into new session"));
	check("nudi 'Compact session'", labels.includes("Compact session"));
	check("nudi 'Nastavi dalje'", labels.includes("Nastavi dalje"));
}

{
	// projectedTokens ima prednost (isto kao ContextMeter u core-u)
	const { tree } = renderGuard({ projectedTokens: GUARD_BELOW, pressureTokens: 900000, contextWindow: WINDOW });
	check("koristi projectedTokens pre pressureTokens (ispod praga) → nema popup-a", tree === null);
}

{
	const { tree } = renderGuard({ pressureTokens: 750000, contextWindow: WINDOW });
	check("750.000 (75%) → popup", tree !== null);
}

{
	const { tree } = renderGuard({ pressureTokens: WINDOW, contextWindow: WINDOW });
	check("1.000.000 (100%) → popup", tree !== null);
	check("procenat ograničen na 100%", textOf(tree).includes("100%"));
}

// ── 3. REGRESIJA: kumulativna potrošnja ne sme da okine popup ─────────────

section("3. Regresija — Token usage (kumulativno) NE pokreće popup");
{
	// Scenario sa screenshota: 25,5M ukupno u metru, a kontekst (pressure) je
	// zapravo bio ispod praga. Guard sme da gleda ISKLJUČIVO pressure.
	const { tree } = renderGuard({ projectedTokens: GUARD_BELOW, pressureTokens: GUARD_BELOW - 10000, contextWindow: WINDOW });
	check("kumulativni metar ne pokreće popup (isključivo pressure se meri)", tree === null);
}

// ── 4. odbacivanje opsega ─────────────────────────────────────────────────

section("4. ContextGuard — odbacivanje (Nastavi dalje) + pill za ponovno otvaranje");
{
	const sessionId = "session-dismiss-test";
	storage.clear();
	const first = renderGuard({ pressureTokens: GUARD_AT + 1000, contextWindow: WINDOW }, sessionId);
	check("prvi render iznad praga → popup", isFullPanel(first.tree));

	// klik na „Nastavi dalje" (treće dugme)
	const later = buttons(first.tree)[2];
	later.props.onClick();

	const second = renderGuard({ pressureTokens: GUARD_AT + 1000, contextWindow: WINDOW }, sessionId);
	check("posle odbacivanja nema punog panela", !isFullPanel(second.tree));
	check("posle odbacivanja ostaje mali pill (da panel nije ćorsokak)",
		isPill(second.tree) && textOf(second.tree).includes("Kontekst"), textOf(second.tree));

	// klik na pill → pun panel se vraća (odbacivanje se pamti jedan opseg niže)
	guardTag(second.tree, "pill").props.onClick();
	const reopened = renderGuard({ pressureTokens: GUARD_AT + 1000, contextWindow: WINDOW }, sessionId);
	check("klik na pill ponovo otvara pun panel", isFullPanel(reopened.tree));

	const third = renderGuard({ pressureTokens: GUARD_NEXT_BAND + 1000, contextWindow: WINDOW }, sessionId);
	check(`posle rasta u sledeći opseg (${GUARD_NEXT_BAND.toLocaleString("sr-RS")}) → popup se vraća`, isFullPanel(third.tree));
}

// ── 4b. modal: centriran, portalan, sklanja se klikom ─────────────────────
//
// 2026-10-08: panel je bio `position: fixed` UNUTAR slota u composeru, pa je
// ispadao uz desnu ivicu („izašao je sa strane") i nije se sklanjao na klik.
// Sada je kartica u portalu (document.body), centrirana preko overlaya, a
// klik na masku je isto što i „Nastavi dalje".

section("4b. ContextGuard — centriran modal u portalu, klik na masku zatvara");
{
	const sessionId = "session-modal-test";
	storage.clear();
	const props = (pressure) => ({
		sessionId,
		useProjection: () => pressure,
	});
	const { tree } = renderGuard({ pressureTokens: GUARD_AT + 1000, contextWindow: WINDOW }, sessionId);

	const portal = portalOf(tree);
	check("kartica je u portalu (createPortal), ne inline u composeru", portal !== undefined);
	check("portal cilja `document.body`", portal !== undefined && portal.portalTarget === globalThis.document.body,
		String(portal && portal.portalTarget));

	const overlay = overlayOf(tree);
	const overlayStyle = overlay ? overlay.props.style : {};
	check("overlay je fiksiran preko celog ekrana",
		overlayStyle.position === "fixed" &&
		overlayStyle.top === 0 && overlayStyle.right === 0 && overlayStyle.bottom === 0 && overlayStyle.left === 0,
		JSON.stringify(overlayStyle));
	check("overlay CENTRIRA karticu (flex + center/center)",
		overlayStyle.display === "flex" &&
		overlayStyle.alignItems === "center" && overlayStyle.justifyContent === "center",
		`${overlayStyle.display}/${overlayStyle.alignItems}/${overlayStyle.justifyContent}`);

	const mask = guardTag(tree, "mask");
	check("postoji maska preko celog ekrana", mask !== undefined);
	const card = guardTag(tree, true);
	check("kartica je IZNAD maske (inače maska pojede klikove)",
		(card.props.style || {}).position === "relative" && (card.props.style || {}).zIndex === 1,
		JSON.stringify(card.props.style));
	check("maska ima svoj onClick (klik bilo gde van kartice zatvara)", typeof mask.props.onClick === "function");

	// Klik na masku = odbaci opseg.
	mask.props.onClick();
	const afterMask = renderGuard({ pressureTokens: GUARD_AT + 1000, contextWindow: WINDOW }, sessionId);
	check("klik na masku sklanja panel sa ekrana", !isFullPanel(afterMask.tree));
	check("posle klika na masku ostaje pill (nije ćorsokak)", isPill(afterMask.tree));
	void props;

	// Esc (kô u core SettingsPanel-u) — `useEffect` se u ovom harness-u ne
	// izvršava, pa se veza proverava na izvoru.
	check("Esc je vezan na document (keydown → dismiss)",
		/document\.addEventListener\("keydown", onKey\)/.test(source) && /event\.key === "Escape"/.test(source));

	// ── mesto pill-a: dole levo ispod „+", NIKAD desna ivica ────────────────
	//
	// 2026-10-08 (drugi krug): pill je bio `right: 12; bottom: 96` i na telefonu
	// je prekrio red sa dugmadima. Sada se mesto MERI iz DOM-a (kartica
	// `[data-composer-card]` + „+" dugme sa `aria-haspopup="listbox"`), a ovaj
	// harness nema DOM/effect, pa vidi statični fallback.
	const pillStyle = (guardTag(afterMask.tree, "pill").props.style) || {};
	check("pill se NE lepi za desnu ivicu (ne može da prekrije dugmad desno)",
		pillStyle.right === undefined && pillStyle.left !== undefined,
		JSON.stringify(pillStyle));
	check("pill je fiksiran i stoji levo/dole (fallback bez DOM-a)",
		pillStyle.position === "fixed" && typeof pillStyle.left === "number" &&
		typeof (pillStyle.bottom !== undefined ? pillStyle.bottom : pillStyle.top) === "number",
		`${pillStyle.position} left=${pillStyle.left} top=${pillStyle.top} bottom=${pillStyle.bottom}`);
	check("pill u odbačenom stanju ne koristi `right` ni `top` (fallback levo/dole)",
		pillStyle.right === undefined && pillStyle.top === undefined && pillStyle.left === 16,
		String(pillStyle.left));
	check("mesto pill-a se MERI iz composera (kartica + „+\" sa aria-haspopup)",
		/document\.querySelector\("\[data-composer-card\]"\)/.test(source) &&
		/'button\[aria-haspopup="listbox"\]'/.test(source) &&
		/window\.addEventListener\("resize", measure\)/.test(source),
		"nema merenja u izvoru");
	check("postoji i rezervno mesto u dock traci kad ispod „+\" nema prostora",
		/viewport - CONTEXT_GUARD_PILL_HEIGHT/.test(source) &&
		/cardBox\.bottom - CONTEXT_GUARD_PILL_HEIGHT/.test(source));
}

// ── 5. Branch dugme ───────────────────────────────────────────────────────

section("5. BranchIntoNewSessionButton (strelica + dropdown moda)");

{
	// Prazan draft: meni se otvori, ali izbor ne šalje zahtev.
	fetchCalls.length = 0;
	activeInput = makeInput("");
	resetHooks();
	const tree = render("conversation.input.left", "composer-extras-branch-new-session", { sessionId: "session-src" });
	const btn = buttons(tree)[0];
	check("dugme postoji", btn !== undefined);
	btn.props.onClick({ currentTarget: "anchor" });

	const post = fetchCalls.find((c) => c.url.includes("/api/branch-session"));
	check("prazan draft → NE šalje zahtev", post === undefined);

	// setState iz onClick-a se vidi tek na sledećem renderu iste instance.
	const after = rerender("conversation.input.left", "composer-extras-branch-new-session", { sessionId: "session-src" });
	const forkBtn = walk(after).find((n) => n.props && n.props["data-composer-extras-branch-mode"] === "fork");
	forkBtn.props.onClick();
	check("prazan draft → NE šalje zahtev ni posle izbora moda",
		fetchCalls.find((c) => c.url.includes("/api/branch-session")) === undefined);
	const afterPick = rerender("conversation.input.left", "composer-extras-branch-new-session", { sessionId: "session-src" });
	check("prazan draft → prikazuje uputstvo", /napiši prompt/i.test(textOf(afterPick)), textOf(afterPick));
}

{
	// Neprazan draft: izbor moda šalje POST i prebacuje prikaz.
	fetchCalls.length = 0;
	ctx.uiWorkspace.opened.length = 0;
	activeInput = makeInput("Napravi rezime sezone 3");
	resetHooks();
	const tree = render("conversation.input.left", "composer-extras-branch-new-session", { sessionId: "session-src" });
	buttons(tree)[0].props.onClick({ currentTarget: "anchor" });
	const opened = rerender("conversation.input.left", "composer-extras-branch-new-session", { sessionId: "session-src" });
	const forkBtn = walk(opened).find((n) => n.props && n.props["data-composer-extras-branch-mode"] === "fork");
	forkBtn.props.onClick();
	await Promise.resolve();
	await new Promise((r) => setTimeout(r, 10));

	const post = fetchCalls.find((c) => c.url.includes("/api/branch-session"));
	check("neprazan draft → POST /composer-extras/api/branch-session", post !== undefined);
	if (post) {
		const body = JSON.parse(post.opts.body);
		check("šalje trenutni draft kao prompt", body.prompt === "Napravi rezime sezone 3", JSON.stringify(body));
		check("šalje parentSession", body.parentSession === "session-src");
		check("šalje mode (fork/new), ne historyShared", body.mode === "fork" && body.historyShared === undefined,
			JSON.stringify(body));
	}
	check("prebacuje GUI na novu sesiju", ctx.uiWorkspace.opened.includes("session-new-1"),
		JSON.stringify(ctx.uiWorkspace.opened));
}

// ── 5b. Grananje: dropdown mod + /branch komande ──────────────────────────

section("5b. Dugme grananja sa dropdown-om (fork vs nova) i /branch komande");

{
	// Klik na strelice OTVARA meni — ne pravi sesiju odmah.
	fetchCalls.length = 0;
	activeInput = makeInput("nastavi ovo u novoj sesiji");
	resetHooks();
	const tree = render("conversation.input.left", "composer-extras-branch-new-session", { sessionId: "session-src" });
	const btn = buttons(tree)[0];
	check("dugme grananja postoji", btn !== undefined);
	check("dugme nosi data-composer-extras=branch", btn.props["data-composer-extras"] === "branch",
		String(btn.props["data-composer-extras"]));
	btn.props.onClick({ currentTarget: "anchor" });
	const after = rerender("conversation.input.left", "composer-extras-branch-new-session", { sessionId: "session-src" });
	check("klik samo otvara meni — još NEMA zahteva",
		fetchCalls.find((c) => c.url.includes("/api/branch-session")) === undefined);
	const modeButtons = walk(after).filter((n) => n.props && n.props["data-composer-extras-branch-mode"] !== undefined);
	check("meni nudi TAČNO dve opcije (fork i nova)", modeButtons.length === 2, String(modeButtons.length));
	check("opcije su fork i new",
		modeButtons.map((n) => n.props["data-composer-extras-branch-mode"]).sort().join(",") === "fork,new",
		modeButtons.map((n) => n.props["data-composer-extras-branch-mode"]).join(","));
}

{
	// Izbor „fork" šalje mode=fork.
	fetchCalls.length = 0;
	ctx.uiWorkspace.opened.length = 0;
	activeInput = makeInput("prebaci ovo");
	resetHooks();
	const tree = render("conversation.input.left", "composer-extras-branch-new-session", { sessionId: "session-src" });
	buttons(tree)[0].props.onClick({ currentTarget: "anchor" });
	const opened = rerender("conversation.input.left", "composer-extras-branch-new-session", { sessionId: "session-src" });
	const forkBtn = walk(opened).find((n) => n.props && n.props["data-composer-extras-branch-mode"] === "fork");
	check("fork opcija postoji", forkBtn !== undefined);
	forkBtn.props.onClick();
	await Promise.resolve();
	await new Promise((r) => setTimeout(r, 10));
	const post = fetchCalls.find((c) => c.url.includes("/api/branch-session"));
	check("fork → POST /api/branch-session", post !== undefined);
	if (post) {
		const body = JSON.parse(post.opts.body);
		check("fork šalje mode='fork'", body.mode === "fork", JSON.stringify(body));
		check("fork šalje draft kao prompt", body.prompt === "prebaci ovo", JSON.stringify(body));
		check("fork šalje parentSession", body.parentSession === "session-src");
	}
	check("posle uspeha draft je obrisan", activeInput.draft === "", JSON.stringify(activeInput.draft));
}

{
	// Izbor „new" šalje mode=new.
	fetchCalls.length = 0;
	activeInput = makeInput("kreni ispočetka");
	resetHooks();
	const tree = render("conversation.input.left", "composer-extras-branch-new-session", { sessionId: "session-src" });
	buttons(tree)[0].props.onClick({ currentTarget: "anchor" });
	const opened = rerender("conversation.input.left", "composer-extras-branch-new-session", { sessionId: "session-src" });
	const newBtn = walk(opened).find((n) => n.props && n.props["data-composer-extras-branch-mode"] === "new");
	check("new opcija postoji", newBtn !== undefined);
	newBtn.props.onClick();
	await Promise.resolve();
	await new Promise((r) => setTimeout(r, 10));
	const post = fetchCalls.find((c) => c.url.includes("/api/branch-session"));
	check("new → POST /api/branch-session", post !== undefined);
	if (post) {
		const body = JSON.parse(post.opts.body);
		check("new šalje mode='new'", body.mode === "new", JSON.stringify(body));
	}
}

{
	// Prazan draft: ni meni ne vodi u zahtev.
	fetchCalls.length = 0;
	activeInput = makeInput("");
	resetHooks();
	const tree = render("conversation.input.left", "composer-extras-branch-new-session", { sessionId: "session-src" });
	buttons(tree)[0].props.onClick({ currentTarget: "anchor" });
	const opened = rerender("conversation.input.left", "composer-extras-branch-new-session", { sessionId: "session-src" });
	const forkBtn = walk(opened).find((n) => n.props && n.props["data-composer-extras-branch-mode"] === "fork");
	forkBtn.props.onClick();
	await Promise.resolve();
	await new Promise((r) => setTimeout(r, 10));
	check("prazan draft → NE šalje zahtev (ni posle izbora moda)",
		fetchCalls.find((c) => c.url.includes("/api/branch-session")) === undefined);
}

{
	// Mod se NE čita iz teksta — prompt koji počinje sa --new ide kao običan tekst.
	fetchCalls.length = 0;
	activeInput = makeInput("--new ovo je samo tekst");
	resetHooks();
	const tree = render("conversation.input.left", "composer-extras-branch-new-session", { sessionId: "session-src" });
	buttons(tree)[0].props.onClick({ currentTarget: "anchor" });
	const opened = rerender("conversation.input.left", "composer-extras-branch-new-session", { sessionId: "session-src" });
	const forkBtn = walk(opened).find((n) => n.props && n.props["data-composer-extras-branch-mode"] === "fork");
	forkBtn.props.onClick();
	await Promise.resolve();
	await new Promise((r) => setTimeout(r, 10));
	const post = fetchCalls.find((c) => c.url.includes("/api/branch-session"));
	if (post) {
		const body = JSON.parse(post.opts.body);
		check("--new u tekstu se NE tumači (mode ostaje fork)", body.mode === "fork", JSON.stringify(body));
		check("--new ostaje deo prompta", body.prompt === "--new ovo je samo tekst", JSON.stringify(body));
	}
}

{
	// Komande: /branch i /branch-new prebacuju prikaz na novu sesiju.
	ctx.uiWorkspace.opened.length = 0;
	ctx.emit("command/executed", "session-src", "branch", {
		kind: "success", text: "grananje: session-aaaa1111-2222-3333-4444-555566667777\nIstorija kopirana.",
	});
	ctx.emit("command/executed", "session-src", "branch-new", {
		kind: "success", text: "grananje: session-bbbb1111-2222-3333-4444-555566667777\nNova prazna sesija.",
	});
	await new Promise((r) => setTimeout(r, 10));
	check("/branch otvara novu sesiju",
		ctx.uiWorkspace.opened.includes("session-aaaa1111-2222-3333-4444-555566667777"),
		JSON.stringify(ctx.uiWorkspace.opened));
	check("/branch-new otvara novu sesiju",
		ctx.uiWorkspace.opened.includes("session-bbbb1111-2222-3333-4444-555566667777"),
		JSON.stringify(ctx.uiWorkspace.opened));
}

{
	// Ostale komande ne diraju prikaz.
	ctx.uiWorkspace.opened.length = 0;
	ctx.emit("command/executed", "session-src", "compact", {
		kind: "success", text: "grananje: session-deadbeef-0000-0000-0000-000000000000",
	});
	await new Promise((r) => setTimeout(r, 10));
	check("druga komanda ne prebacuje prikaz", ctx.uiWorkspace.opened.length === 0,
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

section("7. Compact iz popup-a — /composer-extras/api/compact, draft se NE dira");
{
	storage.clear();
	activeInput = makeInput("moj nedovršen tekst");
	fetchCalls.length = 0;
	let payload = null;
	fetchImpl = async (url, opts) => {
		if (String(url).includes("/api/compact")) {
			payload = JSON.parse(opts.body);
			return {
				ok: true,
				status: 200,
				json: async () => ({
					ok: true,
					value: { kind: "success", text: "Compacted 339 history items (~160236 tokens)." },
				}),
			};
		}
		return { ok: true, status: 200, json: async () => ({ ok: true, value: {} }) };
	};
	resetHooks();
	const props = {
		sessionId: "session-compact",
		useProjection: () => ({ pressureTokens: 600000, contextWindow: 1000000 }),
	};
	const tree = render("conversation.input.left", "composer-extras-context-guard", props);
	const compactBtn = buttons(tree)[1];
	check("drugo dugme je Compact", textOf(compactBtn).includes("Compact"), textOf(compactBtn));
	compactBtn.props.onClick();

	// Kompakciju izvršava NAŠ server (čeka da agent pređe u idle i vraća pravi
	// ishod) — dugme NE piše u draft i NE submit-uje ništa iz composera.
	check("poslat je POST na /composer-extras/api/compact",
		fetchCalls.some((c) => String(c.url).includes("/api/compact")),
		JSON.stringify(fetchCalls.map((c) => String(c.url))));
	check("payload nosi sessionId i waitMs: 90000",
		payload !== null && payload.sessionId === "session-compact" && payload.waitMs === 90000,
		JSON.stringify(payload));
	check("draft korisnika NIJE diran (nema composer submit-a)", (activeInput.api.__submits || 0) === 0,
		String(activeInput.api.__submits));
	check("draft je i dalje tu", activeInput.draft === "moj nedovršen tekst", JSON.stringify(activeInput.draft));

	await new Promise((r) => setTimeout(r, 60));
	check("posle uspeha opseg je odbačen (nema više punog panela)",
		!isFullPanel(rerender("conversation.input.left", "composer-extras-context-guard", props)));
}

{
	// 2026-10-08: „kada kliknem očekujem da mi se skloni sa ekrana" — kartica se
	// sklanja ODMAH na klik (dok traje), a ostaje samo pill „📦 Kompaktujem…".
	storage.clear();
	activeInput = makeInput("drugi nedovršen tekst");
	fetchCalls.length = 0;
	let release = null;
	fetchImpl = async () => new Promise((resolve) => {
		release = () => resolve({
			ok: true,
			status: 200,
			json: async () => ({ ok: true, value: { kind: "success", text: "ok" } }),
		});
	});
	resetHooks();
	const props = {
		sessionId: "session-compact-instant",
		useProjection: () => ({ pressureTokens: 620000, contextWindow: 1000000 }),
	};
	const tree = render("conversation.input.left", "composer-extras-context-guard", props);
	check("pre klika: pun panel", isFullPanel(tree));
	buttons(tree)[1].props.onClick();

	const rightAfter = rerender("conversation.input.left", "composer-extras-context-guard", props);
	check("ODMAH posle klika nema kartice (sklonila se sa ekrana)", !isFullPanel(rightAfter));
	check("ODMAH posle klika vidi se pill „Kompaktujem…\"",
		isPill(rightAfter) && textOf(rightAfter).includes("Kompaktujem"), textOf(rightAfter));
	check("pill u toku kompakcije ne prima klik (disabled)",
		guardTag(rightAfter, "pill").props.disabled === true);
	check("pill u toku kompakcije nema onClick",
		guardTag(rightAfter, "pill").props.onClick === undefined);
	check("pill u toku kompakcije stoji levo/dole (ne skače na desnu ivicu)",
		(guardTag(rightAfter, "pill").props.style || {}).right === undefined &&
		typeof (guardTag(rightAfter, "pill").props.style || {}).left === "number",
		JSON.stringify(guardTag(rightAfter, "pill").props.style));

	if (release) release();
	await new Promise((r) => setTimeout(r, 60));
	const settled = rerender("conversation.input.left", "composer-extras-context-guard", props);
	check("posle uspeha ostaje samo pill (nema kartice)", !isFullPanel(settled) && isPill(settled));
}

{
	// Neuspeh (npr. „agent nije idle"): poruka servera se vidi, a opseg NIJE
	// odbačen — inače popup nestane i izgleda kao da je kompakcija uspela.
	storage.clear();
	activeInput = makeInput("tekst koji ne sme da se izgubi");
	fetchCalls.length = 0;
	fetchImpl = async () => ({
		ok: true,
		status: 200,
		json: async () => ({
			ok: true,
			value: {
				kind: "error",
				text: "Compaction is unavailable because this process has an active compaction, or the agent is not idle.",
			},
		}),
	});
	resetHooks();
	const props = {
		sessionId: "session-compact-reject",
		useProjection: () => ({ pressureTokens: 610000, contextWindow: 1000000 }),
	};
	const tree = render("conversation.input.left", "composer-extras-context-guard", props);
	buttons(tree)[1].props.onClick();
	await new Promise((r) => setTimeout(r, 60));
	const after = rerender("conversation.input.left", "composer-extras-context-guard", props);
	check("neuspeh: popup OSTAJE (opseg nije odbačen)", after !== null);
	check("neuspeh: prikazana je poruka servera",
		after !== null && textOf(after).includes("not idle"),
		textOf(after).slice(0, 160));
	check("neuspeh: draft je netaknut", activeInput.draft === "tekst koji ne sme da se izgubi",
		JSON.stringify(activeInput.draft));
}

// ── 8. Čitljivost panela ──────────────────────────────────────────────────

section("8. Panel je čitljiv — neprovidna podloga (2026-10-07 screenshot)");
{
	storage.clear();
	resetHooks();
	const tree = render("conversation.input.left", "composer-extras-context-guard", {
		sessionId: "session-style",
		useProjection: () => ({ pressureTokens: GUARD_AT + 1000, contextWindow: WINDOW }),
	});
	const style = (guardTag(tree, true).props.style) || {};
	const background = String(style.background || "");
	// `--dsw-specific-menu` je u svetloj temi `#f8f9fa94` (58% alfa) i u core-u
	// ide uz backdrop-filter — bez toga se tekst iza panela providi.
	check("podloga NE koristi poluprovidni `--dsw-specific-menu`",
		!background.includes("specific-menu"), background);
	check("podloga je neprovidni `--dsw-alias-bg-base` (sa belim fallback-om)",
		background.includes("--dsw-alias-bg-base") && background.includes("#fff"), background);
	check("ima backdrop-filter kao pojas i šraf",
		String(style.backdropFilter || "").includes("blur") && String(style.WebkitBackdropFilter || "").includes("blur"),
		String(style.backdropFilter));
	check("ima izražen obod za vidljivost (amber u senci)",
		String(style.boxShadow || "").includes("245, 158, 11"), String(style.boxShadow));

	const compact = buttons(tree)[1];
	const compactStyle = compact.props.style || {};
	check("Compact session je vizuelno primaran (amber obod + tint)",
		String(compactStyle.border || "").includes("#f59e0b") &&
		String(compactStyle.background || "").includes("245, 158, 11"),
		`${compactStyle.border} / ${compactStyle.background}`);
	const later = buttons(tree)[2];
	check("Nastavi dalje je utišan (nema pozadine)",
		String((later.props.style || {}).background) === "transparent",
		String((later.props.style || {}).background));
}

// ───────────────────────────────────────────────────────────────── rezultat

console.log(`\n${"─".repeat(60)}`);
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
