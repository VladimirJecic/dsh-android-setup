---
name: solid
description: Open a file or folder in Solid Explorer for browsing and forwarding. Use when the user wants to view, browse, or share a file via Solid Explorer.
---

# Solid Explorer opener

Opens a folder in Solid Explorer (package `pl.solidexplorer2`) so the user can
browse it and share/forward files via long-press.

## Usage

- `/solid <path>` — open that folder (or, for a file, the folder containing it)
- `/solid` (no args) — open the Downloads folder by default

## Steps

1. If no path is given, default to `/storage/emulated/0/Download`.
2. If the path is a **file**, use its parent directory instead. Solid Explorer's
   only `VIEW` filters for individual files are archive types
   (zip/gzip/tar/7z/rar); a plain file URI matches nothing. Opening the parent
   folder is what lets the user long-press and share.
3. Run exactly this:
   ```bash
   am start -f 0x10008000 -a android.intent.action.VIEW -d "file://<dir>" -t "resource/folder"
   ```
4. Ask the user whether the folder appeared. `am start` exits 0 either way, so
   the exit code proves nothing — but do read its stderr, which is informative
   (see Diagnosis).

## Why each part is required

Both were verified on this device; neither is optional.

- **`-t "resource/folder"`** — the `pl.solidexplorer.SolidExplorer` activity's
  folder filter matches on mimeType alone (`resource/folder`,
  `inode/directory`, `vnd.android.document/directory`) and declares no `file`
  scheme. Without a type Android finds no match at all and shows a generic
  "Open with" chooser that does not even list Solid Explorer.
- **`-f 0x10008000`** (`FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TASK`) —
  the activity is `launchMode="singleTask"`. If Solid Explorer is already
  running, a plain intent just raises its existing task showing the *previous*
  folder, and `am` says so:
  `Warning: Activity not started, its current task has been brought to the front`.
  These flags clear the stale task so the new path actually opens.
- **Never add `-n pl.solidexplorer2/pl.solidexplorer.SolidExplorer`** — pinning
  the component bypasses filter matching, so the activity starts without the
  type it expects and closes immediately. Blank screen, exit 0.

## Diagnosis when nothing appears

Read `am`'s stderr first, then escalate:

1. `Warning: Activity not started, its current task has been brought to the
   front` → the `-f` flags are missing.
2. No warning, still nothing on screen → run the neutral control
   `am start -a android.settings.SETTINGS`. If that also fails to appear, the
   problem is activity launching in general, not this skill. Stop tuning the
   intent and check:
   ```bash
   am start --check-draw-over-apps-permission -a android.settings.SETTINGS
   ```
   Exit 1 means Termux lacks "Display over other apps", and Android drops
   launches whenever Termux is not the visible app — including the launch right
   after Solid Explorer took the foreground. The permission was granted on this
   device on 2026-08-28, so launches chain; if it is ever revoked, expect at
   most one successful launch per return to Termux.
3. Only if the intent itself is suspect, fall back to
   `am start -a org.openintents.action.VIEW_DIRECTORY -d "file://<dir>"` or
   `-t "inode/directory"`.

Real intent filters can always be re-read with
`aapt2 dump xmltree --file AndroidManifest.xml "$(pm path pl.solidexplorer2 | sed s/^package://)"`.
