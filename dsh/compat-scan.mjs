/**
 * compat-scan.mjs — proverava da li ciljna verzija dsh-a zadovoljava opsege koje
 * traze instalirani pluginovi u ~/.dsh/profiles.
 *
 * Zasto postoji: `@deepseek-ai/dsh` je 0.x, a caret na 0.x je uzak
 * (`^0.1.0-rc.1` dozvoljava samo 0.1.*). Skok na 0.2.x je zato za plugin koji
 * trazi `^0.1.0-rc.x` TIHI prekid rada, ne sintaksna greska. Ovaj skener to
 * prijavi PRE nego sto se bilo sta skine.
 *
 * Upotreba:
 *   node compat-scan.mjs <ciljna-verzija> <root> [<root> ...]
 *   node compat-scan.mjs 0.2.0-rc.2 ~/.dsh/profiles
 *
 * Izlaz (jedna linija po nalazu):
 *   VERDIKT|plugin|zavisnost|opseg        VERDIKT = OK | KRSI | NEPOZNATO
 * ili tacno `NEMA` kada nema nijednog opsega prema @deepseek-ai/dsh*.
 *
 * Exit: 0 = svi OK (ili NEMA), 1 = ima KRSI/NEPOZNATO.
 */
import { readFileSync, readdirSync, statSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const [target, ...roots] = process.argv.slice(2);
if (!target || !roots.length) {
  console.error("upotreba: node compat-scan.mjs <ciljna-verzija> <root> [<root>...]");
  process.exit(2);
}

// semver dolazi iz npm-ovog sopstvenog drveta (npm ga uvek ima), sa fallback-om
// na globalno resolvovanje. Ako ga nema, opsezi se prijavljuju kao NEPOZNATO
// umesto da se lazno prijave kao ispunjeni.
const require = createRequire(import.meta.url);
let semver = null;
try {
  semver = require(join(process.env.PREFIX ?? "/data/data/com.termux/files/usr",
    "lib/node_modules/npm/node_modules/semver"));
} catch {
  try { semver = require("semver"); } catch { semver = null; }
}

const found = [];
const visited = new Set();
// Sam dsh paket i pnpm store se preskacu: njihovi interni `@deepseek-ai/dsh-*`
// paketi se verzionisu zajedno sa dsh-om i ne predstavljaju pluginski opseg.
const skip = (p) => p.includes("/node_modules/@deepseek-ai/dsh/") || p.includes("/store/");

function walk(dir, depth) {
  if (depth > 6) return;
  let real;
  try { real = realpathSync(dir); } catch { return; }
  if (visited.has(real)) return;
  visited.add(real);

  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (skip(p)) continue;
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) {
      try { isDir = statSync(p).isDirectory(); } catch { continue; }
    }
    if (isDir) { walk(p, depth + 1); continue; }
    if (e.name !== "package.json" || !p.includes("node_modules")) continue;

    let d;
    try { d = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
    if (!d.name || d.name.startsWith("@deepseek-ai/dsh")) continue;

    const deps = { ...(d.dependencies ?? {}), ...(d.peerDependencies ?? {}) };
    for (const [dep, range] of Object.entries(deps)) {
      if (!dep.startsWith("@deepseek-ai/dsh")) continue;
      let ok = null;
      // includePrerelease: dsh se izdaje kao `0.x.y-rc.N`, a standardni semver
      // odbija prerelease unutar prerelease opsega (trazi isti
      // major.minor.patch tuple). Bez ovoga bi i sam `0.1.7-rc.2` bio lazno
      // prijavljen kao KRSI za `^0.1.0-rc.1`, pa bi provera bila beskorisna.
      if (semver) {
        try { ok = semver.satisfies(target, range, { includePrerelease: true }); }
        catch { ok = null; }
      }
      found.push({ plugin: d.name, dep, range, ok });
    }
  }
}

for (const root of roots) walk(root, 0);

if (!found.length) { console.log("NEMA"); process.exit(0); }

let bad = 0;
for (const f of found) {
  const verdict = f.ok === true ? "OK" : f.ok === false ? "KRSI" : "NEPOZNATO";
  if (f.ok !== true) bad++;
  console.log(`${verdict}|${f.plugin}|${f.dep}|${f.range}`);
}
process.exit(bad ? 1 : 0);
