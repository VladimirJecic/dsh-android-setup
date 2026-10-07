/**
 * Test: dsh-chat-jump-arrows (2026-10-07).
 *
 * Proverava TAČNO ono što je korisnik tražio, bez browsera:
 *   • strelice se VIDE čim postoji bar jedna moja poslata poruka (`user`/`steering`);
 *   • ▲ šeta moje poruke nagore i zaustavlja se na prvoj (nema beskonačnog kruga);
 *   • ▼ šeta nadole i sa poslednje moje poruke pada na DNO razgovora;
 *   • poruka koja je „pobegla" zbog DSH-ove kompenzacije se ponovo poravna;
 *   • skrivene i ugnježdene poruke se ne broje; tuđi (procesni) redovi se ignorišu.
 *
 * Ne pokreće pravi browser ni pravi React: minimalni React sa `useEffect` koji
 * STVARNO izvršava efekat i poštuje dependency listu, lažni
 * `window.__ModuleLoader__`, lažni DOM sa pravom geometrijom skrolovanja
 * (`getBoundingClientRect` se računa iz `scrollTop`-a) i lažni `ctx.slots` koji
 * beleži registraciju.
 *
 * Pokretanje:  node ~/dsh/tests/test-chat-jump-arrows.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(here, "..", "dsh-chat-jump-arrows", "client.js");

// ─────────────────────────────────────────────────────────── minimalni React

const hookStore = [];
let hookCursor = 0;
let pendingEffects = [];

const React = {
	Fragment: Symbol("Fragment"),
	createElement(type, props, ...children) {
		const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
		if (typeof type === "function") return type({ ...(props || {}), children: kids });
		return { $$host: true, type, props: props || {}, children: kids };
	},
	useState(initial) {
		const i = hookCursor++;
		if (!(i in hookStore)) hookStore[i] = { value: typeof initial === "function" ? initial() : initial };
		const slot = hookStore[i];
		return [slot.value, (next) => { slot.value = typeof next === "function" ? next(slot.value) : next; }];
	},
	useRef(initial) {
		const i = hookCursor++;
		if (!(i in hookStore)) hookStore[i] = { value: { current: initial } };
		return hookStore[i].value;
	},
	useEffect(fn, deps) {
		const i = hookCursor++;
		const prev = hookStore[i];
		const changed =
			prev === undefined ||
			deps === undefined ||
			prev.deps === null ||
			deps.length !== prev.deps.length ||
			deps.some((dep, k) => dep !== prev.deps[k]);
		hookStore[i] = { deps: deps === undefined ? null : deps.slice(), cleanup: prev === undefined ? undefined : prev.cleanup };
		if (changed) pendingEffects.push(fn);
	},
	useLayoutEffect(fn, deps) { React.useEffect(fn, deps); },
	useCallback(fn) { return fn; },
	useMemo(fn) { return fn(); },
};

// ─────────────────────────────────────────────────────────────── lažni DOM

const allElements = [];

/** Minimalni CSS selektor: `[attr]` i `[attr="v"]`, zarezno razdvojen. */
function matchesSimple(el, part) {
	const m = /^\[([A-Za-z0-9_-]+)(?:="([^"]*)")?\]$/.exec(part.trim());
	if (m === null) return false;
	const value = el.attributes[m[1]];
	if (value === undefined) return false;
	return m[2] === undefined ? true : value === m[2];
}

function matches(el, selector) {
	return selector.split(",").some((part) => matchesSimple(el, part));
}

function descendants(el) {
	const out = [];
	for (const child of el.children) {
		out.push(child, ...descendants(child));
	}
	return out;
}

function makeElement(tag, attributes) {
	const el = {
		tagName: tag.toUpperCase(),
		attributes: attributes || {},
		children: [],
		parentElement: null,
		isConnected: true,
		listeners: new Map(),
		scrollTop: 0,
		scrollHeight: 0,
		clientHeight: 0,
		rect: null,
		append(child) {
			child.parentElement = el;
			el.children.push(child);
			return child;
		},
		getBoundingClientRect() {
			return el.rect === null ? { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } : el.rect();
		},
		closest(selector) {
			let node = el;
			while (node !== null) {
				if (matches(node, selector)) return node;
				node = node.parentElement;
			}
			return null;
		},
		contains(other) {
			let node = other;
			while (node !== null && node !== undefined) {
				if (node === el) return true;
				node = node.parentElement;
			}
			return false;
		},
		querySelectorAll(selector) {
			return descendants(el).filter((node) => matches(node, selector));
		},
		querySelector(selector) {
			const found = el.querySelectorAll(selector);
			return found.length === 0 ? null : found[0];
		},
		addEventListener(type, fn) {
			if (!el.listeners.has(type)) el.listeners.set(type, new Set());
			el.listeners.get(type).add(fn);
		},
		removeEventListener(type, fn) {
			if (el.listeners.has(type)) el.listeners.get(type).delete(fn);
		},
		dispatch(type) {
			if (!el.listeners.has(type)) return;
			for (const fn of Array.from(el.listeners.get(type))) fn({ type, target: el });
		},
		scrollTo(options) {
			const requested = typeof options === "number" ? options : options.top;
			const max = Math.max(0, el.scrollHeight - el.clientHeight);
			el.scrollTop = Math.max(0, Math.min(max, requested));
			el.dispatch("scroll");
		},
		setScrollTop(value) {
			el.scrollTop = value;
			el.dispatch("scroll");
		},
	};
	allElements.push(el);
	return el;
}

const frames = [];
const intervals = [];
const timeouts = [];
let nextId = 0;

const window = {
	innerWidth: 400,
	innerHeight: 700,
	requestAnimationFrame(fn) { frames.push(fn); return ++nextId; },
	cancelAnimationFrame(id) { void id; },
	setInterval(fn) { intervals.push(fn); return ++nextId; },
	clearInterval(id) { void id; },
	setTimeout(fn, ms) { timeouts.push({ id: ++nextId, fn, ms }); return nextId; },
	clearTimeout(id) {
		const at = timeouts.findIndex((entry) => entry.id === id);
		if (at >= 0) timeouts.splice(at, 1);
	},
	addEventListener() {},
	removeEventListener() {},
	matchMedia() { return { matches: false }; },
};

const document = {
	querySelectorAll(selector) { return allElements.filter((el) => matches(el, selector)); },
	addEventListener() {},
	removeEventListener() {},
	documentElement: { clientWidth: 400 },
};

/** Sve žive MutationObserver instance iz plugina. */
const observers = [];
class MutationObserver {
	constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
	observe(target) { this.targets.push(target); }
	disconnect() { this.targets.length = 0; }
}

function flushFrames() {
	const queued = frames.splice(0, frames.length);
	for (const fn of queued) fn();
}

function flushObservers() {
	for (const observer of observers) {
		if (observer.targets.length > 0) observer.callback([]);
	}
	flushFrames();
}

function flushTimeouts() {
	const queued = timeouts.splice(0, timeouts.length);
	for (const entry of queued) entry.fn();
}

// ──────────────────────────────────────────────── učitavanje plugina

let captured = null;
const source = readFileSync(CLIENT_PATH, "utf8");
// eslint-disable-next-line no-new-func
new Function("window", "require", "document", "MutationObserver", "setTimeout", "setInterval", "console", source)(
	{ ...window, __ModuleLoader__: { load(spec) { captured = spec; } } },
	(id) => {
		if (id === "react") return React;
		throw new Error("unknown require: " + id);
	},
	document,
	MutationObserver,
	window.setTimeout,
	window.setInterval,
	console,
);

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
	if (cond) { passed += 1; console.log(`  ✅ ${name}`); }
	else { failed += 1; console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); }
}

if (captured === null) throw new Error("plugin se nije registrovao preko __ModuleLoader__");
check("modul se registrovao pod id 'dsh-chat-jump-arrows'", captured.id === "dsh-chat-jump-arrows", captured.id);

const mod = captured.factory((id) => {
	if (id === "react") return React;
	throw new Error("unknown require: " + id);
});

// ─────────────────────────────────────────────────────────── lažni ctx.slots

const slots = [];
const ctx = {
	slots: {
		inject(name, cb) { cb(); },
		register(spec, component) {
			slots.push({ spec, component });
			return () => {};
		},
	},
};
mod.apply(ctx);

check("injektuje se u 'shell.overlay'", slots.length === 1 && slots[0].spec.name === "shell.overlay");
check("slot id je 'chat-jump-arrows'", slots[0].spec.id === "chat-jump-arrows", slots[0].spec.id);
check("plugin traži 'slots' servis", Array.isArray(mod.inject) && mod.inject.includes("slots"));
check("testni šavovi su izloženi", typeof mod.__test__?.computeState === "function");

const Component = slots[0].component;

// ──────────────────────────────────────────────────────────── render pomoć

function render() {
	hookCursor = 0;
	const tree = Component({});
	const effects = pendingEffects;
	pendingEffects = [];
	for (const fn of effects) fn();
	return tree;
}

/** mount = render + render, jer prvi `scan()` u efektu tek upiše stanje. */
function mount() {
	hookStore.length = 0;
	pendingEffects = [];
	observers.length = 0;
	frames.length = 0;
	render();
	return render();
}

/** Posle promene DOM-a/skrola: pusti observer → rAF → re-render. */
function refresh() {
	flushObservers();
	return render();
}

function findByProp(node, key, value) {
	if (node === null || node === undefined || typeof node !== "object") return null;
	if (node.props !== undefined && node.props[key] === value) return node;
	const kids = node.children === undefined ? [] : node.children;
	for (const child of kids) {
		const hit = findByProp(child, key, value);
		if (hit !== null) return hit;
	}
	return null;
}

function badgeText(tree) {
	// Badge je jedini span sa aria-hidden i bez onClick-a.
	const root = findByProp(tree, "data-chat-jump-arrows", "root");
	if (root === null) return null;
	for (const child of root.children) {
		if (child.type === "span") return child.children[0];
	}
	return null;
}

function press(tree, direction) {
	const button = findByProp(tree, "data-chat-jump-arrow", direction);
	if (button === null) throw new Error("nema dugmeta: " + direction);
	if (button.props.disabled) return false;
	button.props.onClick({ preventDefault() {}, stopPropagation() {} });
	return true;
}

/**
 * Transcript sa pravom geometrijom: `scrollHeight`/`clientHeight` i redovi čije
 * se `top` pozicije računaju iz `scrollTop`-a, kao u pravom scrollportu.
 */
function buildTranscript(spec) {
	const scroll = makeElement("div", { "data-conversation-scroll": "" });
	scroll.clientHeight = spec.viewportHeight;
	scroll.scrollHeight = spec.contentHeight;
	scroll.rect = () => ({
		top: 0, left: 0, right: spec.viewportWidth ?? 400,
		bottom: spec.viewportHeight, width: spec.viewportWidth ?? 400, height: spec.viewportHeight,
	});
	const column = makeElement("div", {});
	scroll.append(column);
	const rows = [];
	for (const rowSpec of spec.rows) {
		const row = makeElement("div", { "data-chat-flow-kind": rowSpec.kind });
		row.offset = rowSpec.top;
		row.height = rowSpec.height;
		row.rect = () => {
			const top = row.offset - scroll.scrollTop;
			return { top, left: 0, right: 400, bottom: top + row.height, width: 400, height: row.height };
		};
		const parent = rowSpec.nested === true ? makeElement("div", { "data-chat-flow-kind": "turn-process" }) : column;
		if (parent !== column) column.append(parent);
		parent.append(row);
		if (rowSpec.hidden === true) row.attributes.hidden = "";
		rows.push(row);
		scroll.scrollTop = spec.scrollTop ?? 0;
	}
	scroll.scrollTop = spec.scrollTop ?? 0;
	return { scroll, column, rows };
}

function reset() {
	allElements.length = 0;
	observers.length = 0;
	frames.length = 0;
	timeouts.length = 0;
}

// ──────────────────────────────────────────────────────────────── 1. prazno

console.log("\n1. prazna sesija — strelica NEMA");
reset();
{
	const tree = mount();
	check("bez ijedne moje poruke se ne renderuje ništa", tree === null, String(tree));
}

// ────────────────────────────────────── 2. duga sesija, čitalac na dnu

console.log("\n2. duga sesija, na dnu — ▲ vodi na MOJU POSLEDNJU poruku");
reset();
const long = buildTranscript({
	contentHeight: 6000,
	viewportHeight: 600,
	scrollTop: 5400,
	rows: [
		{ kind: "user", top: 0, height: 60 },
		{ kind: "user", top: 2000, height: 80 },
		{ kind: "user", top: 5000, height: 60 },
	],
});
{
	const tree = mount();
	check("strelice se vide", tree !== null);
	check("badge je 3/3", badgeText(tree) === "3/3", String(badgeText(tree)));
	check("▲ je uključena (moje poruke su iznad)", findByProp(tree, "data-chat-jump-arrow", "up").props.disabled === false);
	check("▼ je isključena (već smo na dnu)", findByProp(tree, "data-chat-jump-arrow", "down").props.disabled === true);
	check("▼ nosi label 'Idi na dno razgovora'", findByProp(tree, "data-chat-jump-arrow", "down").props.title === "Idi na dno razgovora");

	press(tree, "up");
	check("▲ je poravnala moju poslednju poruku na 12px od vrha",
		Math.round(long.rows[2].getBoundingClientRect().top) === 12,
		String(long.rows[2].getBoundingClientRect().top));
	check("skrol je tačno na 4988", long.scroll.scrollTop === 4988, String(long.scroll.scrollTop));
}

// ──────────────────────────────────────── 3. šetanje nagore, do prve poruke

console.log("\n3. ▲ šeta nagore i staje na prvoj poruci");
{
	let tree = refresh();
	check("posle sletanja badge je i dalje 3/3", badgeText(tree) === "3/3", String(badgeText(tree)));
	check("▼ je sada uključena (može na dno)", findByProp(tree, "data-chat-jump-arrow", "down").props.disabled === false);

	press(tree, "up");
	check("drugi ▲ sleće na 2. poruku (y=12)", long.rows[1].getBoundingClientRect().top === 12, String(long.rows[1].getBoundingClientRect().top));
	tree = refresh();
	check("badge je 2/3", badgeText(tree) === "2/3", String(badgeText(tree)));

	press(tree, "up");
	check("treći ▲ sleće na 1. poruku (clamp na vrh, y=0)", long.rows[0].getBoundingClientRect().top === 0 && long.scroll.scrollTop === 0, `${long.rows[0].getBoundingClientRect().top} / ${long.scroll.scrollTop}`);

	tree = refresh();
	check("badge je 1/3", badgeText(tree) === "1/3", String(badgeText(tree)));
	check("▲ je isključena na prvoj poruci", findByProp(tree, "data-chat-jump-arrow", "up").props.disabled === true);

	press(tree, "up");
	check("klik na isključenu ▲ ne pomera skrol", long.scroll.scrollTop === 0, String(long.scroll.scrollTop));
}

// ─────────────────────────────────────────── 4. šetanje nadole, pa na dno

console.log("\n4. ▼ šeta nadole, sa poslednje poruke pada na dno");
{
	press(refresh(), "down");
	check("▼ sleće na 2. poruku (y=12)", long.rows[1].getBoundingClientRect().top === 12, String(long.rows[1].getBoundingClientRect().top));

	press(refresh(), "down");
	check("▼ sleće na 3. poruku (y=12)", long.rows[2].getBoundingClientRect().top === 12, String(long.rows[2].getBoundingClientRect().top));

	const tree = refresh();
	check("▼ sada nudi dno razgovora", findByProp(tree, "data-chat-jump-arrow", "down").props.title === "Idi na dno razgovora");

	press(tree, "down");
	check("▼ je otišla na dno (5400)", long.scroll.scrollTop === 5400, String(long.scroll.scrollTop));
	check("na dnu je ▼ isključena", findByProp(refresh(), "data-chat-jump-arrow", "down").props.disabled === true);
}

// ──────────────────────────── 5. DSH kompenzacija pozicije se ispravlja

console.log("\n5. ako DSH pomeri sadržaj (stara istorija), sletanje se brani");
reset();
const paged = buildTranscript({
	contentHeight: 8000,
	viewportHeight: 600,
	scrollTop: 6000,
	rows: [
		{ kind: "user", top: 5000, height: 60 },
	],
});
{
	const tree = mount();
	press(tree, "up");
	check("▲ je sletela na 12px", paged.rows[0].getBoundingClientRect().top === 12, String(paged.rows[0].getBoundingClientRect().top));

	// Starija istorija se ubacuje IZNAD: sadržaj se pomera nadole, scrollTop ne.
	paged.rows[0].offset += 500;
	check("posle umetanja poruka je odlutala (512px)", paged.rows[0].getBoundingClientRect().top === 512);

	flushTimeouts();
	check("korekcija je vratila poruku na 12px", paged.rows[0].getBoundingClientRect().top === 12, String(paged.rows[0].getBoundingClientRect().top));
}

// ───────────────────────────────────── 6. tuđi, skriveni i ugnježdeni redovi

console.log("\n6. broje se samo moje, vidljive, najspoljašnije poruke");
reset();
const mixed = buildTranscript({
	contentHeight: 4000,
	viewportHeight: 600,
	scrollTop: 0,
	rows: [
		{ kind: "assistant", top: 0, height: 100 },
		{ kind: "user", top: 100, height: 60 },
		{ kind: "user", top: 200, height: 60, hidden: true },
		{ kind: "turn-process", top: 300, height: 100 },
		{ kind: "user", top: 400, height: 60, nested: true },
		{ kind: "steering", top: 500, height: 60 },
	],
});
{
	const rows = mod.__test__.collectMyRows(mixed.scroll);
	check("`steering` poruka se broji kao moja", rows.includes(mixed.rows[5]));
	check("skrivena poruka se ne broji", !rows.includes(mixed.rows[2]));
	check("ugnježdena poruka se ne broji", !rows.includes(mixed.rows[4]));
	check("ukupno 2 moje vidljive poruke", rows.length === 2, String(rows.length));

	const tree = mount();
	check("badge je 0/2 (iznad svih mojih poruka)", badgeText(tree) === "0/2", String(badgeText(tree)));

	// Na vrhu, prva moja poruka je već tu (y=100, ispod band-a) → ▼ na nju.
	check("▼ je uključena, ▲ nije", findByProp(tree, "data-chat-jump-arrow", "down").props.disabled === false && findByProp(tree, "data-chat-jump-arrow", "up").props.disabled === true);
	press(tree, "down");
	check("▼ je sletela na prvu moju poruku (y=12)", mixed.rows[1].getBoundingClientRect().top === 12, String(mixed.rows[1].getBoundingClientRect().top));
}

// ─────────────────────────────────── 7. kratak, beskrolovan razgovor

console.log("\n7. kratak razgovor (nema šta da se skroluje)");
reset();
const short = buildTranscript({
	contentHeight: 600,
	viewportHeight: 600,
	scrollTop: 0,
	rows: [
		{ kind: "user", top: 200, height: 50 },
		{ kind: "user", top: 300, height: 50 },
	],
});
{
	const tree = mount();
	check("strelice se vide i kad je sve na ekranu", tree !== null);
	check("badge je 0/2", badgeText(tree) === "0/2", String(badgeText(tree)));
	check("obe strelice su isključene",
		findByProp(tree, "data-chat-jump-arrow", "up").props.disabled === true &&
		findByProp(tree, "data-chat-jump-arrow", "down").props.disabled === true);
	check("skrol se ne pomera", short.scroll.scrollTop === 0, String(short.scroll.scrollTop));
}

// ──────────────────────────────── 8. pozicioniranje uz desnu ivicu chata

console.log("\n8. pozicioniranje: uz desnu ivicu razgovora, a ne ekrana");
reset();
const narrow = buildTranscript({
	contentHeight: 6000,
	viewportHeight: 600,
	scrollTop: 5400,
	viewportWidth: 300, // npr. otvoren sidebar na telefonu: chat je uži od ekrana
	rows: [{ kind: "user", top: 0, height: 60 }],
});
{
	// Chat počinje na x=100 → desna ivica je na 300, ekran je 400.
	narrow.scroll.rect = () => ({ top: 0, left: 100, right: 300, bottom: 600, width: 200, height: 600 });
	const root = findByProp(mount(), "data-chat-jump-arrows", "root");
	check("desna ivica je 8px od chata (ne od ekrana)", root.props.style.right === 108, String(root.props.style.right));
	check("vertikalno je centrirano u chatu", root.props.style.top === 276, String(root.props.style.top));
}

// ───────────────────────────────────────── 9. bez scrollporta — nema ničega

console.log("\n9. bez razgovora na ekranu nema strelica");
reset();
{
	const tree = mount();
	check("nema strelica", tree === null);
}

// ─────────────────────────────────────────────────────────────── rezime

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} provera prošlo, ${failed} palo\n`);
process.exit(failed === 0 ? 0 : 1);
