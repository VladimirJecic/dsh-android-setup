---
name: wa-message
description: Send a WhatsApp text message to a contact by name, looked up from device contacts. For voice messages, use the wa-message-audio skill instead.
---

# WhatsApp messenger

Looks up a contact's phone number from device contacts and opens WhatsApp with a pre-filled text message.

## Usage

- `/wa-message <contact_name> <message_text>` — send a text message

## Steps

1. Look up the contact:
   ```bash
   termux-contact-list
   ```
   Search the JSON output for `name` matching `<contact_name>` (case-insensitive, partial match ok). If multiple matches, ask the user which one. If none, tell the user and stop.
2. Extract the phone number, strip spaces/dashes, keep leading `+` if present.
3. URL-encode `<message_text>` and open WhatsApp:
   ```bash
   am start -a android.intent.action.VIEW -d "https://wa.me/<phone>?text=<url_encoded_message>"
   ```
4. Tell the user WhatsApp is open with the message pre-filled — they must tap Send manually (WhatsApp doesn't allow apps to auto-send).

## Notes

- Never auto-send messages — WhatsApp's `wa.me` deep link only pre-fills the compose box; the user must tap Send themselves. Don't try to script around this.
- If `termux-contact-list` isn't available or permission is denied, tell the user to grant Termux:API contacts permission.
- For voice messages, use `/wa-message-audio <contact_name>` (separate skill) instead.
