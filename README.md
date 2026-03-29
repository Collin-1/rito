# Rito

Rito is a Manifest V3 Chrome extension for voice-first browsing, dictation, page interaction, and page summarization.

## What it does

- Controls browser and page actions with voice commands.
- Supports a commands mode and a dictation mode.
- Shows clickable number hints for interactive elements.
- Supports optional AI intent parsing and AI page summarization.
- Supports custom command shortcuts in settings.

## Prerequisites

- Google Chrome (or another Chromium browser with extension developer mode).
- Microphone access allowed in the browser.
- Optional: a Groq API key for AI intent parsing and AI summarization.

## How to run (load the extension)

1. Download or clone this repository.
2. Open Chrome and go to chrome://extensions.
3. Turn on Developer mode (top-right).
4. Click Load unpacked.
5. Select the project root folder (the folder that contains manifest.json).
6. Open any regular website tab (http/https). NOTE: The extension is blocked for Google websites such as YouTube, Gmail, etc. you might experience technical issues so for this prototype we advise you avoid them.
7. Click the Rito extension icon, then click Start listening.
8. If prompted, allow microphone permissions.

## Basic usage

From the popup:

- Start or stop listening.
- Switch between Commands and Dictation modes.
- Show or hide number hints.
- Open Settings.

In commands mode, examples include:

- scroll down
- scroll up
- click submit
- show numbers
- hide numbers
- summarize this page

## AI setup (optional)

1. Open the extension popup and click Settings.
2. In AI intent and summarization:
3. Keep Enable AI intent recognition enabled (or disable it if you only want manual command parsing).
4. Set your Groq model (default is llama-3.3-70b-versatile).
5. Paste your Groq API key.
6. Click Save settings.

## Development workflow

After any code change:

1. Go to chrome://extensions.
2. Find Rito and click Reload.
3. Refresh the tab where you want to use the extension.

Useful debugging locations:

- Extension service worker logs from the Extensions page.
- Page DevTools console for content script behavior.

## Project structure

- manifest.json: extension manifest.
- src/background: service worker and AI integration.
- src/content: page-level orchestration.
- src/core: speech, parsing, command execution, UI overlay, DOM navigation.
- src/shared: constants, storage, logging, fuzzy matching helpers.
- popup: popup UI and controls.
- options: settings page.

## License

This project is licensed under the MIT License.

Copyright (c) 2026 Rito contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

