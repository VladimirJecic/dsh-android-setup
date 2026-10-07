---
name: voice-input
description: Capture spoken input via Android's native speech recognizer and treat the transcript as the user's actual message for this turn. Use when the user taps the 🎤 extra-keys button or types /voice-input, since Claude Code's built-in Sox-based voice mode and Gboard's mic icon don't work inside Termux.
---

# Voice input

Captures speech via Android's native `SpeechRecognizer` (through `termux-speech-to-text`) and treats the transcribed text as the user's real prompt for this turn.

Exists because:
- Claude Code's built-in `/voice` needs Sox + ALSA/OSS, which Termux doesn't provide (no `/dev/audio*`)
- Gboard's mic icon is disabled inside Termux's terminal input field (raw/char-based input type)
- `termux-microphone-record` and `termux-speech-to-text` use Android's native APIs directly, bypassing both problems

## Usage

- Tap the 🎤 extra-keys button (types `/voice-input` + Enter in one tap)
- `/voice-input` typed manually also works

## Steps

1. Run:
   ```bash
   termux-speech-to-text
   ```
   This opens Android's native voice recognition dialog. It auto-stops on silence, or the user can tap done.
2. Read the transcribed text from stdout.
3. If the output is empty or no speech was detected, tell the user and stop — don't guess at intent.
4. Otherwise, treat the transcript as this turn's actual user input and respond to it directly (don't just echo it back).

## Storage note

`termux-speech-to-text` never writes an audio file — it's a system dialog that returns only the transcribed text, nothing is recorded to disk. No cleanup needed here. (Contrast with `wa-message-audio`, which does save a real `.m4a` and deletes it after sharing.)
