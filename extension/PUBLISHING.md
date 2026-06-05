# Publishing the CodeBank Sensor to the Chrome Web Store (unlisted)

Why unlisted + Web Store: on a **Family Link supervised** Chromebook, "Load unpacked"
(developer mode) is usually disabled, so the extension must come from the Web Store
and be **approved by the parent in Family Link**. "Unlisted" means it won't show up
in search — only people with the link (you) can install it.

## One-time: register as a Chrome Web Store developer ($5)
1. Go to the **Chrome Web Store Developer Dashboard**:
   https://chrome.google.com/webstore/devconsole
2. Sign in with **your** Google account (not a kid's).
3. Pay the one-time **$5** registration fee and accept the developer agreement.

## Build the upload package
A ready ZIP is produced for you at the repo root: **`codebank-sensor-v0.1.0.zip`**.
To rebuild it after any change:
```bash
cd extension
zip -r ../codebank-sensor-v0.1.0.zip . -x '*.md' '.*'
```
(The ZIP must contain `manifest.json` at its top level — this command does that.)

## Create the listing
1. In the dashboard click **+ New item** → upload `codebank-sensor-v0.1.0.zip`.
2. Fill the store listing:
   - **Description:** "Reports a child's coding progress on code.org/Scratch to their family's CodeBank so they earn AI time. Sensor only."
   - **Icon:** uses `icon128.png` from the package.
   - **Screenshots:** add at least one 1280×800 (a shot of the popup is fine).
   - **Category:** Education. **Language:** English.
   - **Privacy:** single purpose = "report coding activity to the family's self-hosted CodeBank." Justify permissions: `tabs`/`scripting` to capture the active code.org/Scratch tab, `alarms` for the periodic check, `storage` for the kid ID + backend URL. Data is sent only to `codebank.mirellolabs.com`.
3. **Visibility: Unlisted.** Save and **Submit for review** (review can take a few hours to a few days).

## Install on each kid's Chromebook
1. Once approved, open the item's Web Store URL on the kid's Chromebook (signed into their supervised account).
2. Click **Add to Chrome** → this generates a **parent approval** request in **Family Link**; approve it from your phone/account.
3. Open the extension → enter **Backend URL** `https://codebank.mirellolabs.com` and the **Kid ID** (copy it from the parent dashboard → each kid card has a "Copy extension settings" button) → **Save & start session**.
4. Open code.org or Scratch, build, and hit **Snapshot now (test)** to confirm.

## Family Link site rules (do this too)
- Block other AI: claude.ai, chatgpt.com, gemini.google.com.
- Allow: codebank.mirellolabs.com, codebank-play.mirellolabs.com, studio.code.org, scratch.mit.edu.
- Optionally set a daily screen-time cap as a backstop.
