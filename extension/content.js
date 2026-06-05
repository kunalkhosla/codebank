// Runs on code.org / Scratch pages. Tracks input activity and does a best-effort
// grab of the visible code/blocks text. The screenshot (captured by the
// background worker) is the universal signal; this text is a bonus.

let lastActivity = Date.now();
['keydown', 'mousedown', 'pointerdown', 'input', 'wheel'].forEach((e) =>
  addEventListener(e, () => { lastActivity = Date.now(); }, true)
);

function extract() {
  const platform = location.host.includes('scratch') ? 'scratch' : 'codeorg';
  let code = '';
  // code.org App/Game Lab text editor
  const cm = document.querySelector('.CodeMirror');
  if (cm && cm.innerText) code = cm.innerText;
  // generic block/code workspaces (Scratch Blockly, code.org Droplet)
  if (!code) {
    const el = document.querySelector('.blocklyWorkspace, .droplet-main-canvas, #codeWorkspace, .blocklyBlockCanvas');
    if (el) code = el.innerText || '';
  }
  return {
    platform,
    code: (code || '').replace(/\s+\n/g, '\n').slice(0, 6000),
    idleMs: Date.now() - lastActivity,
  };
}

chrome.runtime.onMessage.addListener((m, s, send) => {
  if (m.type === 'codebank-extract') { send(extract()); return true; }
});
