/**
 * Test: auto-compact prag za web profil (2026-10-07).
 *
 * Proverava ono što je lako tiho pokvariti:
 *   1. `compaction-basic` koji web bundle montira na HOST nivou je `disabled`
 *      — patch `- id: compaction-basic` u profilu zato NE radi ništa. Ovaj
 *      test to čuva kao eksplicitno upozorenje, jer je to greška koja se već
 *      jednom napravila.
 *   2. Aktivne kopije žive u deklaracijama preseta (`preset-standard`,
 *      `preset-ptc`, `preset-cordis`) i tamo mora stajati `thresholdRatio: 0.6`
 *      (default dsh je 0.8).
 *   3. Efektivni prag NIJE `window x ratio`: compaction-basic ga seče i
 *      "pressure budget"-om (`window - maxTokens - headroomTokens`). Test
 *      računa oba modela i proverava da prag ispadne tačno 60%.
 *
 * Pokretanje:  node test-preset-compaction.mjs
 */
import { execFileSync } from "node:child_process";

const DSH_BIN = "/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/lib/bin.js";
const RATIO = 0.6;
const HEADROOM_TOKENS = 65536; // compaction-basic: config.headroomTokens default

/** Modeli koje ove sesije stvarno rutiraju (vrednosti iz request/context i request/header). */
const MODELS = [
	{ label: "deepseek-official/deepseek-flash", contextWindow: 1000000, maxTokens: 256000 },
	{ label: "google/gemini-flash-lite-latest", contextWindow: 1048576, maxTokens: 32768 }
];

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
	if (ok) {
		passed += 1;
		console.log(`  ok   ${name}`);
	} else {
		failed += 1;
		console.log(`  FAIL ${name}${detail === undefined ? "" : `  → ${detail}`}`);
	}
}

// ── komponovana konfiguracija (isto što loader stvarno montira) ───────────
let dump;
try {
	dump = execFileSync("node", [DSH_BIN, "--profile", "web", "--dump-config"], {
		encoding: "utf8",
		timeout: 180000,
		maxBuffer: 32 * 1024 * 1024
	});
} catch (error) {
	console.log(`  FAIL dump-config nije prošao → ${error.message}`);
	process.exit(1);
}
const lines = dump.split("\n");

/** Vrati blok (linije) reda `- id: <id>` čiji je uvodni red na `indent`. */
function rowBlock(id, indent) {
	const head = `${" ".repeat(indent)}- id: ${id}`;
	const start = lines.findIndex((line) => line === head);
	if (start < 0) return null;
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) => /^ */u.test(line) && line.trim() !== "" &&
		(line.length - line.trimStart().length) <= indent && line.trimStart().startsWith("- "));
	return lines.slice(start, end < 0 ? lines.length : start + 1 + end);
}

/** Vrednost `thresholdRatio` u datom bloku, ili undefined. */
function thresholdOf(block) {
	if (block === null) return undefined;
	const at = block.findIndex((line) => line.trim() === "thresholdRatio:" || line.trim().startsWith("thresholdRatio:"));
	if (at < 0) return undefined;
	const value = block[at].split(":")[1];
	return value === undefined ? undefined : Number(value.trim());
}

/** Efektivni prag iz iste formule koju koristi compaction-basic. */
function effectiveThreshold({ contextWindow, maxTokens }) {
	const messageBudget = contextWindow - maxTokens;
	const pressureBudget = messageBudget - HEADROOM_TOKENS;
	return {
		threshold: Math.floor(Math.min(contextWindow * RATIO, pressureBudget)),
		ratioBound: contextWindow * RATIO < pressureBudget
	};
}

console.log("\n1) host red je isključen (zamka koju ne treba ponoviti)");
{
	const host = rowBlock("compaction-basic", 0);
	check("host `compaction-basic` postoji u kompoziciji", host !== null);
	check("host red je `disabled: true`", host !== null && host.some((line) => line.trim() === "disabled: true"),
		host === null ? "nema reda" : host.join(" | "));
}

console.log("\n2) prag 60% stoji u deklaracijama preseta");
for (const preset of ["preset-standard", "preset-ptc", "preset-cordis"]) {
	const presetBlock = rowBlock(preset, 0);
	check(`${preset}: deklaracija postoji`, presetBlock !== null);
	// `compaction-basic` je unutar preseta uvučen dublje; traži red po sadržaju.
	const inner = presetBlock === null ? -1 : presetBlock.findIndex((line) => line.trim() === "- id: compaction-basic");
	const innerIndent = inner < 0 ? -1 : presetBlock[inner].length - presetBlock[inner].trimStart().length;
	const innerBlock = inner < 0 ? null : (() => {
		const rest = presetBlock.slice(inner + 1);
		const end = rest.findIndex((line) => line.trim() !== "" &&
			(line.length - line.trimStart().length) <= innerIndent && line.trimStart().startsWith("- id: "));
		return presetBlock.slice(inner, end < 0 ? presetBlock.length : inner + 1 + end);
	})();
	check(`${preset}: compaction-basic ima thresholdRatio ${RATIO}`, thresholdOf(innerBlock) === RATIO,
		`dobio ${String(thresholdOf(innerBlock))}`);
	check(`${preset}: auto-compact je ISKLJUČEN (auto: false)`,
		innerBlock !== null && innerBlock.some((line) => line.trim() === "auto: false"),
		innerBlock === null ? "nema bloka" : innerBlock.join(" | "));
}
{
	const minimal = rowBlock("preset-minimal", 0);
	check("preset-minimal ne montira compaction (nema šta da se menja)",
		minimal !== null && !minimal.some((line) => line.trim() === "- id: compaction-basic"));
}

console.log("\n3) efektivni prag ispada tačno 60% (ne samo u configu)");
for (const model of MODELS) {
	const { threshold, ratioBound } = effectiveThreshold(model);
	const percent = (threshold / model.contextWindow) * 100;
	check(`${model.label}: ratio nije odsečen pressure budget-om`, ratioBound,
		`budget = ${model.contextWindow - model.maxTokens - HEADROOM_TOKENS}`);
	check(`${model.label}: prag = ${threshold} = ${percent.toFixed(1)}% prozora`, Math.abs(percent - 60) < 0.05,
		`${percent.toFixed(3)}%`);
}

console.log(`\n${failed === 0 ? "SVE OK" : "IMENA GRESAKA"}: ${passed} proslo, ${failed} palo\n`);
process.exit(failed === 0 ? 0 : 1);
