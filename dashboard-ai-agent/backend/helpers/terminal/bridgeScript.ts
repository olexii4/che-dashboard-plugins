/*
 * Copyright (c) 2018-2025 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

/**
 * Magic bytes used in the ttyd WebSocket framing protocol.
 *
 * ttyd prefixes every WebSocket message with a single-byte command code:
 *   WS_CMD_OUTPUT   (48 / '0') — server→client: terminal output data
 *   WS_CMD_SET_PREFS (50 / '2') — client→server: JSON preferences payload
 *
 * The bridge script intercepts the WebSocket constructor so it can:
 *   1. Detect when the first OUTPUT message arrives (terminal is ready).
 *   2. Inject a SET_PREFS message to apply the correct colour theme.
 *   3. Forward `terminal-input` cross-frame messages as raw input frames.
 *   4. Rewrite asset paths so resources load through the proxy prefix.
 */
const WS_CMD_OUTPUT = 48; // ASCII '0'
const WS_CMD_SET_PREFS = 50; // ASCII '2'

/**
 * Returns an inline `<script>` block that patches the page's WebSocket class
 * to inject theme preferences into the ttyd terminal and relay cross-origin
 * postMessage events (terminal input / theme changes) to the socket.
 *
 * @param darkThemeJson  - JSON-serialised dark terminal theme object.
 * @param lightThemeJson - JSON-serialised light terminal theme object.
 */
export function buildBridgeScript(darkThemeJson: string, lightThemeJson: string): string {
  return `<script>
(function() {
  var THEMES = { dark: ${darkThemeJson}, light: ${lightThemeJson} };
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  function currentTheme() { return prefersDark.matches ? THEMES.dark : THEMES.light; }
  var CMD_OUTPUT = ${WS_CMD_OUTPUT};
  var CMD_INPUT = ${WS_CMD_OUTPUT};
  var CMD_SET_PREFS = ${WS_CMD_SET_PREFS};
  var OrigWS = window.WebSocket;
  var ttydWs = null;
  var notifiedReady = false;
  function PatchedWS(url, protocols) {
    var ws = protocols !== undefined ? new OrigWS(url, protocols) : new OrigWS(url);
    if (url.indexOf('/ws') !== -1) {
      ttydWs = ws;
      ws.addEventListener('open', function() {
        setTimeout(function() { applyTheme(currentTheme()); }, 100);
      });
      ws.addEventListener('message', function(e) {
        if (notifiedReady) return;
        var arr = new Uint8Array(e.data);
        if (arr.length > 0 && arr[0] === CMD_OUTPUT) {
          notifiedReady = true;
          setTimeout(function() {
            applyTheme(currentTheme());
            try { window.parent.postMessage({ type: 'ttyd-ready' }, document.location.origin); } catch(ex) {}
          }, 50);
        }
      });
    }
    return ws;
  }
  PatchedWS.prototype = OrigWS.prototype;
  PatchedWS.CONNECTING = OrigWS.CONNECTING;
  PatchedWS.OPEN = OrigWS.OPEN;
  PatchedWS.CLOSING = OrigWS.CLOSING;
  PatchedWS.CLOSED = OrigWS.CLOSED;
  Object.defineProperty(window, 'WebSocket', { value: PatchedWS, writable: true, configurable: true });
  function sendPrefs(prefs) {
    if (!ttydWs) return;
    var enc = new TextEncoder().encode(JSON.stringify(prefs));
    var buf = new Uint8Array(enc.length + 1);
    buf[0] = CMD_SET_PREFS;
    buf.set(enc, 1);
    ttydWs.dispatchEvent(new MessageEvent('message', { data: buf.buffer }));
  }
  function applyTheme(theme) {
    sendPrefs({ fontSize: 13, fontFamily: 'monospace', theme: theme });
    document.body.style.backgroundColor = theme.background || '';
  }
  prefersDark.addEventListener('change', function() { applyTheme(currentTheme()); });
  window.addEventListener('message', function(e) {
    if (!e.data || !e.data.type) return;
    if (e.data.type === 'terminal-input' && ttydWs && ttydWs.readyState === 1) {
      var enc = new TextEncoder().encode(e.data.data);
      var buf = new Uint8Array(enc.length + 1);
      buf[0] = CMD_INPUT;
      buf.set(enc, 1);
      ttydWs.send(buf.buffer);
    }
    if (e.data.type === 'terminal-theme') {
      applyTheme(e.data.theme);
    }
  });
  document.addEventListener('DOMContentLoaded', function() {
    document.body.style.backgroundColor = currentTheme().background || '';
    var s = document.createElement('style');
    s.textContent = '.xterm .xterm-viewport { background-color: inherit !important; } .xterm { margin-left: 6px; }';
    document.head.appendChild(s);
  });
})();
</script>`;
}
