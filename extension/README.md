# CodeBank Sensor (Chrome extension)

A **sensor only**. It periodically screenshots the active code.org / Scratch tab
and reports it to the CodeBank backend, which judges whether real programming
progress happened. It has **no power to unlock** the AI — the gate is server-side,
so disabling this extension just stops the kid from earning time.

## Install (developer mode, for testing)

1. Go to `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → select this `extension/` folder.
3. Click the extension icon → enter the **Backend URL** (`https://codebank.mirellolabs.com`)
   and the **Kid ID** (shown in the parent dashboard) → **Save & start session**.
4. Open code.org or Scratch and start building. Use **Snapshot now (test)** to verify.

## Install on a kid's Family Link Chromebook

Consumer Family Link can't force-install a custom extension, but that's fine here
because the extension can't unlock anything. Recommended setup:

1. Publish this folder as an **unlisted** item on the Chrome Web Store (or load
   unpacked on the kid's device while you set it up).
2. In **Family Link**, block other AI sites (claude.ai, chatgpt.com, gemini.google.com)
   and allow `codebank.mirellolabs.com`, `studio.code.org`, `scratch.mit.edu`.
3. Set a daily screen-time cap as a backstop.

## How it works

- A background alarm fires every *snapshot interval* minutes (configured per kid
  in the dashboard, default 4).
- It captures the visible tab only if it's code.org/Scratch and there was recent
  input (idle tabs are skipped, so "leave it open" farming earns nothing).
- It POSTs the screenshot + best-effort code text to `/api/snapshot`; the backend
  runs the Claude vision judge and accrues verified minutes.
