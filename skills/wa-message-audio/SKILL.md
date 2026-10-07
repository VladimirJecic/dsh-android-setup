---
name: wa-message-audio
description: Record the user's real voice and open Android's native share sheet to forward it to a contact via WhatsApp, then delete the local copy. Toggle command — first call starts recording, second call stops it and shares it. Use when the user wants to send a voice message to someone.
---

# WhatsApp voice message

Records the user's actual voice (not TTS) via `termux-microphone-record`, then hands it off to Android's native share sheet so the user can forward it to a contact through WhatsApp. Deletes the local copy once sharing is triggered, since these files serve no purpose after forwarding and would otherwise accumulate in Downloads.

`termux-microphone-record` has no "record until silence" mode, so this same command is invoked twice: once to start, once to stop.

## Usage

- `/wa-message-audio <contact_name>` — first call starts recording; run the exact same command again to stop, save, and share
- While a recording is active, a short plain-text message — `s`, `stop`, or `exit` (case-insensitive, no slash needed) — also triggers the stop step. These won't hit this skill file directly (they don't start with `/`, so the CLI won't route them here), so this is a standing instruction: if `termux-microphone-record -i` shows a recording in progress and the user's next message is one of these short stop words, treat it as the stop trigger and run step 3 below rather than answering it as a normal chat message.

## Steps

1. Check recording status:
   ```bash
   termux-microphone-record -i
   ```
2. **If not currently recording** (start):
   - Look up the contact via `termux-contact-list` (case-insensitive, partial match ok) to confirm who this is for. If multiple matches, ask which one; if none, tell the user and stop.
   - Start recording to a standard location:
     ```bash
     termux-microphone-record -f /storage/emulated/0/Download/<contact_name>_voice_<unix_timestamp>.m4a -l 0
     ```
   - Tell the user recording has started and to run `/wa-message-audio <contact_name>` again when done speaking.
3. **If currently recording** (stop):
   - Stop it: `termux-microphone-record -q`
   - The saved path is the one from the start step (track it via the most recent `<contact_name>_voice_*.m4a` in `/storage/emulated/0/Download/` if not already in context).
   - Trigger the native share sheet:
     ```bash
     termux-share -a send "<saved_path>"
     ```
     Picking WhatsApp there hands off to WhatsApp's own contact picker, where the user selects `<contact_name>` and taps send inside WhatsApp.
   - Tell the user the share sheet is open — pick WhatsApp, then `<contact_name>`, then send.
   - **Delete the local copy** after a short delay (gives the receiving app time to read the file through the share intent before it's removed):
     ```bash
     ( sleep 5 && rm -f "<saved_path>" ) &
     ```
     Don't block on this — fire it in the background and move on.

## Notes

- Never auto-send inside WhatsApp — the share sheet only gets the file to WhatsApp's forward screen; the user still picks the contact and taps send themselves.
- Files are deleted automatically after sharing, so nothing accumulates in Downloads. If the user cancels the share sheet before picking an app, the file still gets deleted on the 5s timer — that's expected, not a bug.
- If `termux-contact-list` isn't available or permission is denied, tell the user to grant Termux:API contacts permission.
