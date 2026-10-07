#!/usr/bin/env python3
"""Android/Termux zakrpe za DeepSeek Harness (dsh) — sve na jednom mestu.

Idempotentna: bezbedno je pokrenuti je više puta. `~/.local/bin/dsh-termux` je
poziva pri SVAKOM startu, pa `npm install -g @deepseek-ai/dsh` ne može trajno da
obrise zakrpe.

Pokriva:
  1. hardlink      — SELinux zabranjuje link(2) u privatnom app-data dir-u (EACCES)
  2. dir-fsync     — attachment store fsync-uje pretke do "/", a app uid ne sme
                     ni da otvori /, /data, /data/data
  3. ripgrep       — @vscode/ripgrep 1.18+ trazi platformski paket
                     `@vscode/ripgrep-android-<arch>/bin/rg`, a android build
                     ne postoji na npm-u; pravimo taj paket kao shim koji
                     pokazuje na Termux-ov sistemski `rg` (inace glob/grep
                     alati padaju sa "ripgrep launch failed")
  3b. cache-slot   — DeepSeek prefix-kes preko smene modela
  3c. flock        — @deepseek-ai/node-addon-system nema android-arm64 paket;
                     `flock.js` se zamenjuje mock-om (POSIX session.lock tada
                     NIJE stvarno zakljucan — ne pokreci dva dsh-a nad istom
                     sesijom)
  4. migracija tajni — API kljucevi iz ~/.dsh/.credentials.yaml u
                     ~/.config/dsh-secrets.env (mode 600). CUVA record
                     `client-connection/browser-session` — ako se on pregazi,
                     rotira se signing secret i PWA ("DSH 手机版") prestane da radi.
  5. --pwa-samesite — OPT-IN: session cookie sa SameSite=Strict se ne salje pri
                     pokretanju PWA iz lansera (cross-site initiator), pa WebAPK
                     dobija 401. Menja Strict -> Lax.
  4b. profil bundles — dsh ume pri bootu da resetuje
                     `~/.dsh/profiles/web/package.json` na default sablon i
                     tiho izgubi nase pluginove. 4b ih vraca u `bundles`.
  4c. plugin link    — nasi pluginovi (`dsh-composer-extras`,
                     `dsh-chat-jump-arrows`) su lokalni paketi (nisu na npm-u),
                     pa ih dsh nalazi samo preko linkova u node_modules na putu
                     rezolucije profila. Reset iz 4b pojede i te linkove, a dsh
                     tada prijavi samo "entry did not activate" na stdout-u
                     (koji niko ne cita) — pa ikonice i strelice nestanu bez
                     traga. 4c linkove proverava i pravi ih bez pnpm-a.

Upotreba:
  python3 ~/dsh/patch-android-dsh.py            # 1-4 (ziva instalacija)
  python3 ~/dsh/patch-android-dsh.py --check    # samo prijava, nista ne menja
  python3 ~/dsh/patch-android-dsh.py --pwa-samesite
  python3 ~/dsh/patch-android-dsh.py --root <dsh-paket>   # SANDBOX rezim:
      primenjuje 1-3c na proizvoljno dsh drvo (npr. sandbox instalaciju pre
      atomske zamene), a preskace sekcije 4-5 koje se ticu zivog ~/.dsh.
"""
import argparse
import glob
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path

PREFIX = Path(os.environ.get("PREFIX", "/data/data/com.termux/files/usr"))
HOME = Path(os.path.expanduser("~"))
DSH_PKG = PREFIX / "lib" / "node_modules" / "@deepseek-ai" / "dsh"
SCOPED = DSH_PKG / "node_modules" / "@deepseek-ai"
PROFILE_SCOPED = HOME / ".dsh" / "profiles" / "node_modules" / "@deepseek-ai"
LOCAL_PLUGIN = HOME / "dsh" / "dsh-composer-extras"
# Svi lokalni (ne-npm) pluginovi: profil ih mora imenovati u `bundles` I
# razresiti preko linka u node_modules. Redosled je redosled upisa u `bundles`.
LOCAL_PLUGINS = [
    LOCAL_PLUGIN,
    HOME / "dsh" / "dsh-chat-jump-arrows",
]
# Kandidati za link, redom kojim ih Node rezolucija iz profila stvarno gleda.
# Drugi je `profiles` root store — njega pnpm (workspace je profiles/web) ne
# prun-uje, pa je otporniji od profilinog node_modules.
PLUGIN_LINK_CANDIDATES = [
    HOME / ".dsh" / "profiles" / "web" / "node_modules" / "dsh-composer-extras",
    HOME / ".dsh" / "profiles" / "node_modules" / "dsh-composer-extras",
]
CRED = HOME / ".dsh" / ".credentials.yaml"
SECRETS = HOME / ".config" / "dsh-secrets.env"
AUTH_RECORD = "client-connection/browser-session"

HARDLINK_TARGETS = ["dsh-attachment-local", "dsh-session-persistence-jsonl", "dsh-fs-local"]
HL_MARK = "android-hardlink-fix"
FS_MARK = "android-dir-fsync-fix"
SS_MARK = "android-samesite-fix"
CS_MARK = "android-cache-slot-fix"
FLOCK_MARK = "Android/Termux flock mock"
RB_MARK = "android-require-builtin-js-fallback"
TU_ORDER_MARK = "android-tool-use-order-fix"
TU_EMPTY_MARK = "android-empty-text-after-tool-call-fix"

# `node-addon-require-builtin` nema android-arm64 prebuild na npm-u
# (optionalDependencies pokrivaju darwin/linux/win32). Na Bionicu se ni glibc
# prebuilt ne moze uciniti: dlopen pada sa
#   cannot find "libgcc_s.so.1" from verneed[0] in DT_NEEDED list
# a dsh-app-boot tada BACA fatalno:
#   dsh: host preparation failed: No usable native binding found for
#   node-addon-require-builtin-android-arm64 (auto)
# Ovaj paket je tanak omotac oko tri funkcije, pa se original zamenjuje
# direktnim JS fallback-om (identicno onome sto je na uredjaju vec radilo).
RB_FALLBACK = '''"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireBuiltin = requireBuiltin;
exports.isAllowedInternalId = isAllowedInternalId;
exports.getBindingInfo = getBindingInfo;

/* android-require-builtin-js-fallback: nema android-arm64 prebuild, a glibc
   prebuilt se ne moze dlopen-ovati na Bionicu ("cannot find libgcc_s.so.1"),
   pa boot puca fatalno pre nego sto se ijedan profil ucita. Original je
   sacuvan kao index.js.orig-npm. */
function requireBuiltin(moduleId) {
    // Direktni fallback na standardni Node.js modul
    return require(moduleId);
}

function isAllowedInternalId(moduleId) {
    return true;
}

function getBindingInfo() {
    return { backend: 'js-fallback', abi: 'napi-v9' };
}

exports.default = {
    requireBuiltin,
    isAllowedInternalId,
    getBindingInfo,
};
'''

# Sa --root se sve zakrpe primenjuju na ARBITRARNO dsh drvo (npr. sandbox
# instalaciju pre atomske zamene), a sekcije koje se ticu zivog ~/.dsh profila
# i tajni se preskacu. Bez --root je ponasanje identicno starom (ziva instalacija).
TARGET = {"dsh": DSH_PKG}
SANDBOX_MODE = False


def dsh_root():
    """@deepseek-ai/dsh paket na koji trenutno ciljamo zakrpe."""
    return TARGET["dsh"]


def scoped_roots():
    """Svi @deepseek-ai direktorijumi u kojima mogu da zive ciljni paketi."""
    roots = [dsh_root() / "node_modules" / "@deepseek-ai"]
    if not SANDBOX_MODE and PROFILE_SCOPED.is_dir() \
            and PROFILE_SCOPED.resolve() != roots[0].resolve():
        roots.append(PROFILE_SCOPED)
    return roots

# android-cache-slot-fix: `dsh-agent-loop` pri povratku na `in-history` rutu
# (DeepSeek) dodaje system prompt na KRAJ istorije, a ruta koja nije
# `in-history` (Gemini) je pre toga ISPRAZNILA slot u SREDINI. Praznina u
# sredini obara DeepSeek-ov prefix-kes: poklapanje padne sa ~103k na ~43k, pa
# se placa ponovno citanje svega iza nje. Ispravka popunjava ispraznjen slot
# umesto da dodaje novi node. Detalji: sekcija 3b u DSH-Restore uputstvu
CS_ORIGINAL = '''\t\tif (latest.text === rendered) return [];
\t\treturn [{
\t\t\tmessage: createSystemMessage(rendered, SOURCE),
\t\t\tintent: { surfaceOp: "append" }
\t\t}];'''

CS_PATCHED = '''\t\tif (latest.text === rendered) return [];
\t\t/* android-cache-slot-fix: ruta koja nije `in-history` (Gemini i ostale
\t\t   pi-ai rute) isprazni nase in-history slotove kad preuzme. Kad se
\t\t   `in-history` ruta (DeepSeek) vrati, POPUNI ispraznjen slot umesto da
\t\t   dodas novi node na kraj: request tada reprodukuje tacno onaj raspored
\t\t   poruka koji je ta ruta zadnji put videla, pa se njen prefix-kes i dalje
\t\t   poklapa i naplacuje se samo stvarno novo. Dodavanje na kraj ostavlja
\t\t   prazninu u sredini istorije i kosta ponovno citanje svega iza nje.
\t\t   `findLast` a ne `find`: sesija moze imati VISE slotova, a `in-history`
\t\t   ruta uvek dodaje novi na kraj kad se prompt promeni — pa je poslednji
\t\t   prazan slot onaj koji je ta ruta zadnji put koristila. */
\t\tconst blank = nodes.slice(1).findLast((node) => node.text === "");
\t\tif (blank !== undefined) return [this.replace(blank.seq, rendered)];
\t\treturn [{
\t\t\tmessage: createSystemMessage(rendered, SOURCE),
\t\t\tintent: { surfaceOp: "append" }
\t\t}];'''

# 0.1.5-rc.1 je pozivao `createSystemMessage(rendered, SOURCE)`; u 0.1.7-rc.2 je
# taj drugi argument uklonjen. Prihvataju se OBE varijante — inace bi zakrpa (a
# sa njom i svaki update, jer validacija zahteva da zakrpe prodju) pukla na
# novijem buildu iako se optimizacija moze primeniti.
CS_VARIANTS = [
    (CS_ORIGINAL, CS_PATCHED),
    (CS_ORIGINAL.replace("createSystemMessage(rendered, SOURCE)",
                         "createSystemMessage(rendered)"),
     CS_PATCHED.replace("createSystemMessage(rendered, SOURCE)",
                        "createSystemMessage(rendered)")),
]

SHIM = ('const link = (source, destination) => copyFile(source, destination, 1);'
        f' /* {HL_MARK}: SELinux blokira link(); 1 = COPYFILE_EXCL */\n')

FSYNC_NEW = '''async function syncDirectory(path) {
\t/* v8 ignore next -- Windows cannot open directory handles; NTFS metadata journaling owns entry durability there. */
\tif (process.platform === "win32") return;
\t/* android-dir-fsync-fix: na Androidu app uid ne sme ni da OTVORI /, /data ni
\t   /data/data, pa je fsync pretka best-effort umesto da obori ceo upis. Fajl je
\t   u tom trenutku vec uspesno sacuvan; gubi se samo garancija "durable posle
\t   iznenadnog gasenja" za same direktorijume. */
\tlet handle;
\ttry {
\t\thandle = await open(path, constants.O_RDONLY);
\t} catch (error) {
\t\tif (["EACCES", "EPERM", "ENOENT", "EINVAL", "ENOTSUP", "EOPNOTSUPP"].includes(error?.code)) return;
\t\tthrow error;
\t}
\ttry {
\t\tawait handle.sync();
\t} catch (error) {
\t\tif (!["EACCES", "EPERM", "EINVAL", "ENOTSUP", "EOPNOTSUPP"].includes(error?.code)) throw error;
\t} finally {
\t\tawait handle.close();
\t}
}'''

FLOCK_MOCK = '''/**
 * Android/Termux flock mock — `@deepseek-ai/node-addon-system-android-arm64`
 * ne postoji na npm-u, a originalna implementacija pukne u require.resolve
 * (i u glibc/musl grani iz process.report) pre ijednog zakljucavanja.
 *
 * Namerno vraca uspeh: dsh nastavlja da radi, ali POSIX `flock(2)` nad
 * `session.lock` NIJE stvarno zakljucan. Ne pokreci dva dsh procesa nad istom
 * sesijom. Original je sacuvan kao `flock.js.orig-npm`.
 */
export async function tryLockExclusive(fd) {
    // Mocked: do nothing and succeed immediately
    return;
}
'''

OK, WARN, ERR = "  [ok]", "  [!]", "  [x]"
CHANGES = []


def say(m):
    print(m, flush=True)


def note(m):
    CHANGES.append(m)


def find_pkg_files(pkg):
    out = []
    for root in scoped_roots():
        f = root / pkg / "lib" / "index.js"
        if f.is_file():
            out.append(f)
    out += [Path(p) for p in glob.glob(str(dsh_root() / "node_modules" / "**" /
                                         pkg / "lib" / "index.js"), recursive=True)]
    # Ziva instalacija: pored drveta dsh paketa, pogledaj i globalni store
    # (pokriva slucaj kada je paket podignut van dsh-ovog node_modules).
    if not SANDBOX_MODE:
        out += [Path(p) for p in glob.glob(str(PREFIX / "lib" / "node_modules" / "**" /
                                             pkg / "lib" / "index.js"), recursive=True)]
    # dedupe po realpath-u
    seen, uniq = set(), []
    for f in out:
        rp = f.resolve()
        if rp not in seen:
            seen.add(rp)
            uniq.append(f)
    return uniq


def patch_hardlink(path, check):
    src = path.read_text()
    if HL_MARK in src:
        return "vec zakrpan"
    lines = src.splitlines(keepends=True)
    for i, line in enumerate(lines):
        if not line.startswith("import {") or '"node:fs/promises"' not in line:
            continue
        if not re.search(r"[{,]\s*link\s*[,}]", line):
            continue
        if check:
            return "TREBA zakrpati"
        lines[i] = re.sub(r"([{,]\s*)link(\s*[,}])", r"\1copyFile\2", line, count=1)
        lines.insert(i + 1, SHIM)
        path.write_text("".join(lines))
        note(f"hardlink: {path}")
        return "zakrpan"
    return "NIJE NADJEN import { link } from node:fs/promises"


def _replace_function(src, header, replacement):
    """Zameni telo funkcije (brace-matching) — otporno na whitespace."""
    i = src.find(header)
    if i < 0:
        return None
    j = src.find("{", i)
    if j < 0:
        return None
    depth = 0
    for k in range(j, len(src)):
        if src[k] == "{":
            depth += 1
        elif src[k] == "}":
            depth -= 1
            if depth == 0:
                return src[:i] + replacement + src[k + 1:]
    return None


def patch_dir_fsync(path, check):
    src = path.read_text()
    if FS_MARK in src:
        return "vec zakrpan"
    if "async function syncDirectory(path) {" not in src:
        return "NIJE NADJENA syncDirectory"
    if check:
        return "TREBA zakrpati"
    out = _replace_function(src, "async function syncDirectory(path) {", FSYNC_NEW)
    if out is None:
        return "GRESKA u brace-match-u"
    path.write_text(out)
    note(f"dir-fsync: {path}")
    return "zakrpan"


def patch_samesite(check):
    hits = []
    for root in scoped_roots():
        for f in glob.glob(str(root / "dsh-client-connection" / "lib" / "*.js")):
            p = Path(f)
            if "SameSite=Strict" in p.read_text():
                hits.append(p)
    if not hits:
        already = any(
            SS_MARK in Path(f).read_text()
            for root in scoped_roots()
            for f in glob.glob(str(root / "dsh-client-connection" / "lib" / "*.js")))
        return "nema SameSite=Strict" + (" (vec zakrpan?)" if already else "")
    if check:
        return f"TREBA zakrpati ({len(hits)} fajl/a)"
    for p in hits:
        s = p.read_text()
        s = s.replace("SameSite=Strict", f"SameSite=Lax; /* {SS_MARK} */")
        p.write_text(s)
        note(f"samesite: {p}")
    return f"zakrpan ({len(hits)})"


def patch_flock(check):
    """android flock mock — `@deepseek-ai/node-addon-system` nema android-arm64
    paket, a originalni `flock.js` pre ijednog zakljucavanja radi
    `require.resolve('@deepseek-ai/node-addon-system-android-arm64/package.json')`
    (uz glibc/musl granu iz `process.report`, koja na Bionicu ne postoji), pa
    `tryLockExclusive` puca na svakom `session.lock`-u.

    Zakrpa zamenjuje taj modul mock-om koji se odmah resolvuje uspesno.
    Cena je stvarna i mora da se zna: POSIX `flock(2)` nad `session.lock` NIJE
    zakljucan, pa dva dsh procesa nad istom sesijom nisu medjusobno zastićena.
    """
    files = []
    for root in scoped_roots():
        f = root / "node-addon-system" / "lib" / "flock.js"
        if f.is_file():
            files.append(f)
    files += [Path(p) for p in glob.glob(str(dsh_root() / "node_modules" / "**" /
                                             "node-addon-system" / "lib" / "flock.js"),
                                         recursive=True)]
    if not SANDBOX_MODE:
        files += [Path(p) for p in glob.glob(
            str(PREFIX / "lib" / "node_modules" / "**" /
                "node-addon-system" / "lib" / "flock.js"), recursive=True)]

    seen, uniq = set(), []
    for f in files:
        rp = f.resolve()
        if rp not in seen:
            seen.add(rp)
            uniq.append(f)
    if not uniq:
        return "NIJE NADJEN node-addon-system/lib/flock.js"

    done, todo = 0, 0
    for f in uniq:
        src = f.read_text()
        if FLOCK_MARK in src:
            done += 1
            continue
        if check:
            todo += 1
            continue
        # Backup samo ako je u fajlu STVARNA npm implementacija (loadBinding +
        # system.node). Stari rucni mock bez markera nema sta da cuva — samo se
        # normalizuje, da se ne bi cuvao lazni ".orig-npm".
        real_npm = "loadBinding" in src and "system.node" in src
        if real_npm:
            orig = f.with_name("flock.js.orig-npm")
            if not orig.exists():
                shutil.copy2(f, orig)
                note(f"flock: original npm implementacija sacuvana u {orig.name}")
        else:
            note("flock: stari mock bez markera -> normalizovan")
        f.write_text(FLOCK_MOCK)
        note(f"flock mock: {f}")
        done += 1
    if todo:
        return f"TREBA zakrpati ({todo} modul/a)"
    return f"mock aktivan ({done} modul/a)" if done else "nema ciljeva"


def rg_platform_pkg():
    """Ime platformskog paketa koje @vscode/ripgrep trazi na ovom uredjaju."""
    machine = os.uname().machine
    arch = {"aarch64": "arm64", "armv8l": "arm", "armv7l": "arm",
            "x86_64": "x64", "i686": "ia32"}.get(machine, machine)
    return f"@vscode/ripgrep-android-{arch}"


def rg_install_dirs():
    """Svi @vscode/ripgrep paketi — dsh ih moze imati u globalnom i profilnom store-u."""
    bases = [dsh_root() / "node_modules"]
    if not SANDBOX_MODE:
        bases += [
            PREFIX / "lib" / "node_modules",
            HOME / ".dsh" / "profiles" / "node_modules",
            HOME / ".dsh" / "profiles" / "web" / "node_modules",
        ]
    out, seen = [], set()
    for base in bases:
        d = base / "@vscode" / "ripgrep"
        if not (d / "package.json").is_file():
            continue
        rp = d.resolve()
        if rp in seen:
            continue
        seen.add(rp)
        out.append(rp)
    # @vscode/ripgrep moze biti i ugnezden (npr. u node_modules nekog paketa).
    for p in glob.glob(str(dsh_root() / "node_modules" / "**" /
                           "@vscode" / "ripgrep" / "package.json"), recursive=True):
        d = Path(p).parent.resolve()
        if d not in seen:
            seen.add(d)
            out.append(d)
    return out


def patch_ripgrep(check):
    """@vscode/ripgrep 1.18+ ne bundluje `rg` u paket, nego ga trazi preko
    platformskog optional-dependency-ja (`require.resolve('@vscode/ripgrep-<platform>-<arch>/bin/rg')`).
    Na npm-u NE POSTOJI android build, pa `dsh-tool-fs-search` (glob/grep alati)
    pukne sa "ripgrep launch failed" iako `rg` postoji u $PREFIX.

    Resenje: napravimo taj platformski paket sami kao shim ciji `bin/rg` pokazuje
    na Termux-ov sistemski ripgrep. Time se ne dira nijedan JS fajl — resolucija
    ostaje identicna onoj koju sam @vscode/ripgrep ocekuje.
    """
    rg = shutil.which("rg")
    if not rg:
        return "NEMA rg — pokreni: pkg install ripgrep"

    dirs = rg_install_dirs()
    if not dirs:
        return f"nema @vscode/ripgrep paketa (rg ipak na PATH: {rg})"

    pkg_name = rg_platform_pkg()
    shim_name = pkg_name.split("/", 1)[1]
    todo, done = [], []
    for d in dirs:
        version = "?"
        try:
            version = json.loads((d / "package.json").read_text()).get("version", "?")
        except Exception:
            pass
        shim = d.parent / shim_name
        link = shim / "bin" / "rg"
        if link.exists() and (link.resolve() == Path(rg).resolve()):
            done.append(f"{d} (v{version})")
            continue
        todo.append((d, version, shim, link))

    if not todo:
        return f"vec zakrpan: {pkg_name}/bin/rg -> {rg}  [{len(done)} paket(a)]"
    if check:
        return f"TREBA zakrpati ({len(todo)}): {pkg_name}/bin/rg -> {rg}"

    for d, version, shim, link in todo:
        (shim / "bin").mkdir(parents=True, exist_ok=True)
        (shim / "package.json").write_text(json.dumps({
            "name": pkg_name,
            "version": version,
            "description": "Termux shim: android platform package for @vscode/ripgrep "
                           "(no android build is published on npm); bin/rg points at "
                           "the Termux system ripgrep.",
            "license": "MIT",
            "private": True,
        }, indent=2) + "\n")
        if link.is_symlink() or link.exists():
            link.unlink()
        link.symlink_to(rg)
        note(f"ripgrep: {link} -> {rg}")

    return f"shim napravljen: {pkg_name}/bin/rg -> {rg}  ({len(todo)} paket(a))"


def patch_require_builtin(check):
    """android-require-builtin-js-fallback — vidi RB_* konstante.

    Fajl je tanak omotac (requireBuiltin / isAllowedInternalId /
    getBindingInfo), pa se original menja direktnim JS fallback-om. Backup
    originala ostaje kao `index.js.orig-npm` u istom direktorijumu.
    """
    files = []
    for root in scoped_roots():
        f = root / "node-addon-require-builtin" / "lib" / "index.js"
        if f.is_file():
            files.append(f)
    files += [Path(p) for p in glob.glob(
        str(dsh_root() / "node_modules" / "**" /
            "node-addon-require-builtin" / "lib" / "index.js"), recursive=True)]
    if not SANDBOX_MODE:
        files += [Path(p) for p in glob.glob(
            str(PREFIX / "lib" / "node_modules" / "**" /
                "node-addon-require-builtin" / "lib" / "index.js"), recursive=True)]

    seen, uniq = set(), []
    for f in files:
        rp = f.resolve()
        if rp not in seen:
            seen.add(rp)
            uniq.append(f)
    if not uniq:
        return "NIJE NADJEN node-addon-require-builtin/lib/index.js"

    done, todo = 0, 0
    for f in uniq:
        src = f.read_text()
        if RB_MARK in src:
            done += 1
            continue
        if check:
            todo += 1
            continue
        orig = f.with_name("index.js.orig-npm")
        # Ako je fajl VEC JS fallback (npr. rucno zakrpljen pre ove zakrpe), nema
        # sta da se cuva pod imenom ".orig-npm" — samo se normalizuje i dobije
        # marker. Backup se pravi samo za pravu npm implementaciju.
        looks_npm = "createEntryApi" in src or "loadEntry" in src
        if looks_npm and not orig.exists():
            shutil.copy2(f, orig)
            note(f"require-builtin: original sacuvan u {orig.name}")
        elif not looks_npm:
            note("require-builtin: fajl je vec bio fallback -> normalizovan (bez .orig-npm)")
        f.write_text(RB_FALLBACK)
        note(f"require-builtin js-fallback: {f}")
        done += 1
    if todo:
        return f"TREBA zakrpati ({todo} modul/a)"
    return f"js-fallback aktivan ({done} modul/a)" if done else "nema ciljeva"


def patch_cache_slot(check):
    """android-cache-slot-fix — vidi CS_* konstante (i sekciju 3b u restore uputstvu).

    Telo metode se razlikuje izmedju izdanja (SOURCE argument), pa se prihvata
    vise varijanti originala; za svaki fajl se trazi prva koja se poklapa.
    """
    files = find_pkg_files("dsh-agent-loop")
    if not files:
        return "NIJE NADJEN dsh-agent-loop/lib/index.js"
    done, todo, mismatch = 0, 0, []
    for f in files:
        src = f.read_text()
        if CS_MARK in src:
            done += 1
            continue
        hit = next(((o, p) for o, p in CS_VARIANTS if o in src), None)
        if hit is None:
            mismatch.append(f)
            continue
        if check:
            todo += 1
            continue
        f.write_text(src.replace(hit[0], hit[1], 1))
        note(f"cache-slot: {f}")
        done += 1
    if mismatch:
        return (f"TELO METODE se ne poklapa u {len(mismatch)} fajl(u) "
                f"(dsh se promenio?) {mismatch[0]}")
    if todo:
        return f"TREBA zakrpati ({todo})"
    return f"zakrpan ({done})" if done else "nema ciljeva"


# android-tool-use-order-fix: DeepSeek-ov `.../anthropic/v1/messages` endpoint
# odbija (HTTP 400 "tool_use ids were found without tool_result blocks
# immediately after") svaku assistant poruku u kojoj iza `tool_use` bloka sledi
# BILO koji blok — i prazan tekst. Gemini (pi-ai `google-generative-ai` ruta) u
# durabilnu istoriju upisuje [tool-call, text("")], pa posle smene modela
# Gemini -> DeepSeek svaki turn pukne i sesija je trajno neupotrebljiva na
# DeepSeek-u (na Geminiju i dalje radi). Dokaz (A/B protiv zivog API-ja):
#   [tool_use, text("")]   -> 400      [tool_use]            -> 200
#   [tool_use, text("hi")] -> 400      [text(""), tool_use]  -> 200
# Zakrpa normalizuje IZLAZ adaptera (durabilna istorija i prefiks-kes se ne
# diraju): prazan tekst se izbacuje, ostali blokovi idu ispred `tool_use`.
# Za DeepSeek-ove sopstvene poruke ([reasoning, text, tool_use]) ovo je no-op.
TU_ORDER_FUNC = "function assistant(message, model, onReplayDegrade) {"
TU_ORDER_NEXT = "/** Serialize one complete request"
TU_ORDER_SNIPPET = (
    '\t/* android-tool-use-order-fix: DeepSeek Messages servira tool_use blokove samo dok su POSLEDNJI\n'
    '\t   u assistant poruci; Gemini (pi-ai) ruta upisuje [tool-call, text("")], pa\n'
    '\t   API odbija celu istoriju sa "tool_use ids ... without tool_result".\n'
    '\t   Prazan text se izbacuje, ostalo ide ispred tool_use blokova. Za DeepSeek-ove\n'
    '\t   sopstvene poruke ([reasoning, text, tool_use]) ovo je no-op (kes netaknut). */\n'
    '\tconst calls = blocks.filter((block) => block.type === "tool_use");\n'
    '\tif (calls.length === 0) return blocks;\n'
    '\tconst rest = blocks.filter((block) => block.type !== "tool_use" && !(block.type === "text" && block.text.length === 0));\n'
    '\tconst ordered = [...rest, ...calls];\n'
    '\treturn ordered.length === blocks.length && ordered.every((block, index) => block === blocks[index]) ? blocks : ordered;\n'
)

# android-empty-text-after-tool-call-fix: isti kvar se ne sme ni upisati u
# durabilnu istoriju. pi-ai rutе zatvaraju stream praznim text blokom
# (Gemini: block-start text -> block-end text ""), a `BlockAssembler` ga je
# verodostojno pamtio. Prazan text ne nosi informaciju, pa se izbacuje — ali
# SAMO kada iza sebe vec ima `tool-call` (to je oblik koji API odbija; sam
# prazan text bez tool poziva ostaje netaknut). Replay envelope se filtrira
# istim indeksima, pa pi-ai replay ostaje poravnat.
TU_EMPTY_ORIG = (
    '\t\tconst kept = this.finish.kind === "max-tokens" ? all.map((block) => block.type !== "tool-call") : void 0;\n'
    '\t\tconst blocks = kept === void 0 ? all : all.filter((_, position) => kept[position]);'
)
TU_EMPTY_NEW = (
    '\t\t/* android-empty-text-after-tool-call-fix: pi-ai rute (Gemini) umeju da\n'
    '\t\t   zatvore assistant poruku praznim text blokom POSLE tool-call-a, npr.\n'
    '\t\t   [tool-call, text("")]. Anthropic-kompatibilni endpointi (DeepSeek\n'
    '\t\t   Messages) odbijaju svaki blok iza `tool_use` u istoj poruci, pa takva\n'
    '\t\t   istorija trajno obara sesiju posle smene modela. Prazan text ne nosi\n'
    '\t\t   nista — OSIM ako u replay envelope-u ima potpis (Gemini thought\n'
    '\t\t   signature dolazi i na praznom text delu): potpisan se cuva, nepotpisan\n'
    '\t\t   se ne upisuje. Envelope se filtrira istim indeksima, pa pi-ai replay\n'
    '\t\t   ostaje poravnat. */\n'
    '\t\tconst replayEnvelope = this._replayState;\n'
    '\t\tconst alignedReplay = replayEnvelope?.blocks !== void 0 && replayEnvelope.blocks.length === all.length;\n'
    '\t\tlet sawToolCall = false;\n'
    '\t\tconst kept = all.map((block, position) => {\n'
    '\t\t\tconst entry = alignedReplay ? replayEnvelope.blocks[position] : void 0;\n'
    '\t\t\tconst signed = entry !== void 0 && entry.type === "text" && entry.textSignature !== void 0;\n'
    '\t\t\tconst dropTruncatedCall = this.finish.kind === "max-tokens" && block.type === "tool-call";\n'
    '\t\t\tconst dropEmptyText = block.type === "text" && block.text.length === 0 && sawToolCall && !signed;\n'
    '\t\t\tif (block.type === "tool-call") sawToolCall = true;\n'
    '\t\t\treturn !dropTruncatedCall && !dropEmptyText;\n'
    '\t\t});\n'
    '\t\tconst blocks = all.filter((_, position) => kept[position]);'
)


def _patch_tooluse_adapter(path, check):
    """`tool_use` blokovi na kraj assistant poruke (dsh-llm-deepseek)."""
    src = path.read_text()
    if TU_ORDER_MARK in src:
        return "vec zakrpan"
    start = src.find(TU_ORDER_FUNC)
    end = src.find(TU_ORDER_NEXT, start) if start >= 0 else -1
    if start < 0 or end < 0:
        return "NIJE NADJEN assistant() u dsh-llm-deepseek"
    seg = src[start:end]
    if "return message.content.map(" not in seg:
        return "TELO assistant() se ne poklapa (dsh se promenio?)"
    if check:
        return "TREBA zakrpati"
    idx = seg.rfind("\n}")
    if idx < 0:
        return "GRESKA: kraj assistant() nije nadjen"
    new_seg = seg[: idx + 1] + "\n" + TU_ORDER_SNIPPET + seg[idx + 1 :]
    new_seg = new_seg.replace("return message.content.map(", "const blocks = message.content.map(", 1)
    path.write_text(src[:start] + new_seg + src[end:])
    note(f"tool-use-order: {path}")
    return "zakrpan"


def _patch_empty_text(path, check):
    """Prazan text POSLE tool-call-a se ne upisuje u istoriju (dsh-llm)."""
    src = path.read_text()
    if TU_EMPTY_MARK in src:
        return "vec zakrpan"
    if TU_EMPTY_ORIG not in src:
        return "TELO assembled() se ne poklapa (dsh se promenio?)"
    if check:
        return "TREBA zakrpati"
    path.write_text(src.replace(TU_EMPTY_ORIG, TU_EMPTY_NEW, 1))
    note(f"empty-text-after-tool-call: {path}")
    return "zakrpan"


def patch_tooluse_order(check):
    """3f. tool_use na kraj poruke + bez praznog teksta posle tool-call-a.

    Dva sloja iste zastite: (1) `dsh-llm` od sada ne upisuje prazan text blok
    iza `tool-call`-a (nove sesije se ne truju), (2) `dsh-llm-deepseek`
    normalizuje izlaz, pa se i VEC otrovane sesije (Gemini -> DeepSeek) mogu
    nastaviti bez prepravke logova.
    """
    parts = []
    for pkg, fn in (("dsh-llm", _patch_empty_text),
                    ("dsh-llm-deepseek", _patch_tooluse_adapter)):
        files = find_pkg_files(pkg)
        if not files:
            parts.append(f"{pkg}: NIJE NADJEN lib/index.js")
            continue
        for f in files:
            parts.append(f"{pkg}: {fn(f, check)}")
    return "; ".join(parts)


def migrate_secrets(check):
    if not CRED.is_file():
        return "nema .credentials.yaml"
    try:
        import yaml
    except ImportError:
        return "PyYAML nije instaliran — preskacem"
    d = yaml.safe_load(CRED.read_text()) or {}
    refs = d.get("refs") or {}
    if not refs:
        return "nema kljuceva u fajlu (vec migrirano)"
    if AUTH_RECORD not in (d.get("records") or {}):
        return f"!!! NEMA {AUTH_RECORD} — NE DIRAM fajl"

    env = {}
    if SECRETS.is_file():
        for line in SECRETS.read_text().splitlines():
            m = re.match(r"\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$", line.strip())
            if m:
                env[m.group(1)] = True

    to_add = {k: v for k, v in refs.items() if k not in env}
    if check:
        return f"TREBA migrirati: pomeri {sorted(to_add)} u env, skini {sorted(refs)} iz fajla"

    if to_add:
        SECRETS.parent.mkdir(parents=True, exist_ok=True)
        with SECRETS.open("a") as fh:
            if SECRETS.stat().st_size and not SECRETS.read_text().endswith("\n"):
                fh.write("\n")
            for k, v in to_add.items():
                fh.write(f"export {k}='{v}'\n")
        os.chmod(SECRETS, 0o600)
        note(f"secrets: dodato u {SECRETS}: {sorted(to_add)}")

    bak = CRED.with_suffix(f".yaml.bak-{time.strftime('%Y%m%d-%H%M%S')}")
    shutil.copy2(CRED, bak)
    os.chmod(bak, 0o600)
    d.pop("refs", None)
    tmp = CRED.with_suffix(".yaml.tmp")
    tmp.write_text(yaml.safe_dump(d, default_flow_style=False, sort_keys=False, allow_unicode=True))
    os.chmod(tmp, 0o600)
    os.replace(tmp, CRED)
    note(f"secrets: {CRED} ociscen (backup {bak.name})")
    return f"migrirano ({sorted(refs)}), auth record sacuvan"


def ensure_profile_bundles(check):
    """Profil `dsh.profile.bundles` mora da sadrzi nase pluginove.

    dsh ume da pri bootu resetuje `~/.dsh/profiles/web/package.json` na default
    sablon (videno 2026-09-15 01:41:04: nestala su OBA plugina i `dependencies`
    su ispraznjene). Posledica je tiha: dugmad composer-extras-a se ne pojave,
    a nista ne prijavi gresku. Zato je ovde tvrda provera pri svakom startu.
    """
    manifest = HOME / ".dsh" / "profiles" / "web" / "package.json"
    if not manifest.is_file():
        # Profil je obrisan ili ga dsh jos nije napravio. Ako ga pustimo, dsh ce
        # ga pri bootu napraviti iz DEFAULT sablona (bez nasih pluginova), pa
        # dugmad tiho ne rade. Zato ga MI napravimo pre nego sto se dsh digne.
        if check:
            return "TREBA napraviti profil package.json (nema ga)"
        manifest.parent.mkdir(parents=True, exist_ok=True)
        d = {
            "name": "dsh-profile-web",
            "private": True,
            "dependencies": {},
            "dsh": {"profile": {
                "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],
                "patchReload": "live",
            }},
        }
        note("profil package.json: napravljen iz naseg sablona")
    else:
        try:
            d = json.loads(manifest.read_text())
        except Exception as error:
            return f"ne mogu da parsira: {error}"

    profile = d.setdefault("dsh", {}).setdefault("profile", {})
    bundles = profile.setdefault("bundles", ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"])
    want = [plugin.name for plugin in LOCAL_PLUGINS]
    # dsh-context samo ako je stvarno instaliran (pnpm ga ne vraca sam)
    for cand in (HOME / ".dsh" / "profiles" / "web" / "node_modules" / "dsh-context",
                 HOME / ".dsh" / "profiles" / "node_modules" / "dsh-context"):
        if cand.exists():
            want.append("dsh-context")
            break

    missing = [b for b in want if b not in bundles]
    if not missing:
        return f"ok ({len(bundles)} bundle-a)"
    if check:
        return f"TREBA dodati u bundles: {missing}"

    bundles.extend(missing)
    profile["bundles"] = bundles
    if "dsh-context" in bundles and "dsh-context" not in (d.get("dependencies") or {}):
        d.setdefault("dependencies", {})["dsh-context"] = "^0.52.0"
    manifest.write_text(json.dumps(d, indent=2) + "\n")
    note(f"profile bundles: dodato {missing}")
    return f"popravljeno (+{missing})"


def plugin_link_candidates(plugin):
    """Putanje na kojima Node rezolucija profila trazi lokalni plugin.

    Prva je profilov `node_modules` (tu link drzi `dsh-composer-extras`), druga
    je `profiles` root store — njega pnpm (workspace je `profiles/web`) ne
    prun-uje, pa je otporniji.
    """
    return [
        HOME / ".dsh" / "profiles" / "web" / "node_modules" / plugin.name,
        HOME / ".dsh" / "profiles" / "node_modules" / plugin.name,
    ]


def ensure_local_plugin_link(check):
    """Linkovi do lokalnih (ne-npm) pluginova moraju da postoje i nisu mrtvi.

    Ni `dsh-composer-extras` ni `dsh-chat-jump-arrows` nisu na npm-u, pa
    `dsh.profile.bundles` samo IMENUJE paket — dsh ga resolvuje preko
    `node_modules` na putu rezolucije profila. dsh-ov reset manifesta (viden
    2026-09-15 01:41) pojeo je i link; plugin je ostao u `bundles`, ali se nije
    mogao ucitati, i jedini trag je bio "entry did not activate" na stdout-u.
    Ovde ih proveravamo tvrdo, bez pnpm-a (pnpm pod zivim dsh-om je dva puta
    oborio proces — vidi README-RESTORE.md).

    Vraca `; `-spojen izvestaj po plugin-u; poziv `main()` gleda da u njemu
    nema `GRESKA`/`TREBA`.
    """
    results = []
    for plugin in LOCAL_PLUGINS:
        if not plugin.is_dir():
            results.append(f"GRESKA: nema {plugin} (fali ceo plugin, ne samo link)")
            continue
        missing = [f for f in ("package.json", "client.js") if not (plugin / f).is_file()]
        if missing:
            results.append(f"GRESKA: u {plugin.name} fale {missing}")
            continue
        candidates = plugin_link_candidates(plugin)
        live = next((cand for cand in candidates if cand.exists()), None)
        if live is not None:
            results.append(f"ok {plugin.name} ({live})")
            continue
        dest = candidates[1]
        if check:
            results.append(f"TREBA napraviti link {dest} -> {plugin}")
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.is_symlink() or dest.exists():
            dest.unlink()
        dest.symlink_to(plugin)
        note(f"plugin link: {dest} -> {plugin}")
        results.append(f"link napravljen za {plugin.name}: {dest}")
    return "; ".join(results)


def main():
    global SANDBOX_MODE
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="samo prijava, nista ne menja")
    ap.add_argument("--pwa-samesite", action="store_true",
                    help="opt-in: SameSite=Strict -> Lax (za WebAPK/PWA)")
    ap.add_argument("--root", metavar="DIR",
                    help="primeni zakrpe na ARBITRARNO dsh drvo (npr. sandbox "
                         "instalaciju pre atomske zamene) umesto na zivu "
                         "instalaciju; preskace sekcije koje se ticu ~/.dsh")
    a = ap.parse_args()

    if not PREFIX.exists():
        say(f"{ERR} ovo nije Termux — prekidam")
        return 1

    if a.root:
        root = Path(a.root).resolve()
        if not (root / "package.json").is_file() or not (root / "lib" / "bin.js").is_file():
            say(f"{ERR} --root {root} ne lici na @deepseek-ai/dsh paket "
                f"(nema package.json + lib/bin.js)")
            return 1
        TARGET["dsh"] = root
        SANDBOX_MODE = True

    say(f"=== patch-android-dsh {'(CHECK) ' if a.check else ''}"
        f"{'[SANDBOX] ' if SANDBOX_MODE else ''}===")
    if SANDBOX_MODE:
        say(f"    cilj: {dsh_root()}")
    rc = 0

    say("\n1. hardlink (SELinux link(2) -> copyFile COPYFILE_EXCL)")
    for name in HARDLINK_TARGETS:
        files = find_pkg_files(name)
        if not files:
            say(f"{WARN} {name}: nijedan lib/index.js nije nadjen")
            rc = 1
            continue
        for f in files:
            st = patch_hardlink(f, a.check)
            bad = "NIJE" in st or "GRESKA" in st
            mark = ERR if bad else (WARN if "TREBA" in st else OK)
            say(f"{mark} {name}: {st}  ({f})")
            if bad or ("TREBA" in st and a.check):
                rc = 1

    say("\n2. dir-fsync (EACCES na /, /data, /data/data -> best-effort)")
    for f in find_pkg_files("dsh-attachment-local"):
        st = patch_dir_fsync(f, a.check)
        bad = "NIJE" in st or "GRESKA" in st
        mark = ERR if bad else (WARN if "TREBA" in st else OK)
        say(f"{mark} attachment-local: {st}  ({f})")
        if bad or ("TREBA" in st and a.check):
            rc = 1

    say("\n3. ripgrep (@vscode/ripgrep nema android build -> shim na sistemski rg)")
    st = patch_ripgrep(a.check)
    bad = "NEMA" in st or "TREBA" in st
    say(f"{ERR if bad else (WARN if 'nema @vscode' in st else OK)} ripgrep: {st}")
    if bad:
        rc = 1

    say("\n3b. cache-slot (DeepSeek prefix-kes preko smene modela)")
    st = patch_cache_slot(a.check)
    bad = "NIJE" in st or "ne poklapa" in st
    say(f"{ERR if bad else (WARN if 'TREBA' in st else OK)} cache-slot: {st}")
    if bad or "TREBA" in st:
        rc = 1

    say("\n3f. tool_use redosled (Gemini -> DeepSeek 'tool_use ids without tool_result')")
    st = patch_tooluse_order(a.check)
    bad = "NIJE" in st or "ne poklapa" in st or "GRESKA" in st
    say(f"{ERR if bad else (WARN if 'TREBA' in st else OK)} tool_use: {st}")
    if bad or "TREBA" in st:
        rc = 1

    say("\n3c. flock mock (nema node-addon-system-android-arm64)")
    st = patch_flock(a.check)
    bad = "NIJE" in st
    say(f"{ERR if bad else (WARN if 'TREBA' in st else OK)} flock: {st}")
    if bad or "TREBA" in st:
        rc = 1

    say("\n3e. require-builtin js-fallback (nema android-arm64 prebuild)")
    st = patch_require_builtin(a.check)
    bad = "NIJE" in st
    say(f"{ERR if bad else (WARN if 'TREBA' in st else OK)} require-builtin: {st}")
    if bad or "TREBA" in st:
        rc = 1

    say("\n3d. PWA SameSite (opt-in, unutar paketa — radi i u sandboxu)")
    if a.pwa_samesite:
        st = patch_samesite(a.check)
        bad = "TREBA" in st
        say(f"{ERR if bad else OK} samesite: {st}")
        if bad:
            rc = 1
    else:
        say(f"{WARN} samesite: preskoceno (bez --pwa-samesite)")

    if SANDBOX_MODE:
        say("\n4-4c. preskoceno (sandbox rezim: tajne, profil i plugin link se "
            "tickaju samo na zivoj instalaciji)")
        return rc

    say("\n4. migracija tajni (cuva browser-session record)")
    say(f"{OK} {migrate_secrets(a.check)}")

    say("\n4b. profil bundles (da dsh reset ne ubije pluginove tiho)")
    st = ensure_profile_bundles(a.check)
    say(f"{OK if 'TREBA' not in st else WARN} profil bundles: {st}")
    if "TREBA" in st:
        rc = 1

    say("\n4c. lokalni plugin linkovi (nasi pluginovi nisu na npm-u)")
    st = ensure_local_plugin_link(a.check)
    say(f"{OK if 'GRESKA' not in st and 'TREBA' not in st else WARN} plugin linkovi: {st}")
    if "GRESKA" in st or "TREBA" in st:
        rc = 1

    if CHANGES and not a.check:
        say(f"\n--- izmene ({len(CHANGES)}) ---")
        for c in CHANGES:
            say(f"  {c}")
        say("Vazi od sledeceg pokretanja dsh-a.")
    elif a.check:
        say("\n(check rezim — nista nije menjano)")
    else:
        say("\nsve je vec bilo zakrpano.")
    return rc


if __name__ == "__main__":
    sys.exit(main())
