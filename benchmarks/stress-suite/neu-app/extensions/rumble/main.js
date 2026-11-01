'use strict';

/*
 * Neutralinojs extension backend.
 *
 * Neutralinojs has no built-in Node.js IPC bridge: the documented way to run
 * backend logic is an *extension* — a separate process Neutralino spawns and
 * connects to over a local WebSocket. This extension is that backend. It runs
 * the exact same stress core as every other runtime and bridges it to the UI
 * with Neutralino's event protocol:
 *
 *   backend -> UI : app.broadcast {event, data}   -> Neutralino.events.on(...)
 *   UI -> backend : extensions.dispatch(...)      -> {event, data} on this socket
 *
 * Neutralino hands the connection parameters to the extension on stdin as
 * `{ nlPort, nlToken, nlConnectToken, nlExtensionId }`.
 */

const fs = require('fs');
const path = require('path');
const { createHarness } = require('../../../app/harness');
const { createStressCore } = require('../../../app/stress-core');

const RUNTIME = 'neutralino';

function main() {
  let conn;
  try {
    conn = JSON.parse(fs.readFileSync(process.stdin.fd, 'utf-8'));
  } catch (e) {
    process.stderr.write('[neu-ext] failed to read connection info: ' + e.message + '\n');
    process.exit(1);
    return;
  }

  const H = createHarness({
    runtime: RUNTIME,
    resultFile: process.env.STRESS_RESULT_FILE || path.join(__dirname, '..', '..', 'results-neutralino.json'),
    phaseFile: process.env.STRESS_PHASE_FILE || path.join(__dirname, '..', '..', 'phase-neutralino.json'),
  });
  H.setPhase('boot');

  const ws = new WebSocket('ws://localhost:' + conn.nlPort + '?extensionId=' + conn.nlExtensionId + '&connectToken=' + conn.nlConnectToken);

  const transport = {
    _handlers: new Map(),
    on(channel, handler) { this._handlers.set(channel, handler); },
    _deliver(channel, data) {
      const h = this._handlers.get(channel);
      if (h) h(data);
    },
    send(channel, data) {
      if (ws.readyState !== 1) return;
      ws.send(JSON.stringify({
        id: crypto.randomUUID(),
        method: 'app.broadcast',
        accessToken: conn.nlToken,
        data: { event: channel, data },
      }));
    },
    // Extensions can call native methods directly; this is how the backend
    // tells the framework to shut the whole application down.
    exitApp(code) {
      if (ws.readyState !== 1) return;
      ws.send(JSON.stringify({ id: crypto.randomUUID(), method: 'app.exit', accessToken: conn.nlToken, data: { code } }));
    },
  };

  const stress = createStressCore({ runtime: RUNTIME, transport, log: H.log, onPhase: H.onPhase });
  H.attach(stress);

  ws.onopen = () => {
    H.log('extension connected to Neutralino server on port ' + conn.nlPort);
  };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (msg && msg.event) transport._deliver(msg.event, msg.data);
  };
  ws.onerror = () => { H.log('websocket error'); };
  ws.onclose = () => {
    // Neutralino does not kill extensions on exit, so the socket closing is the
    // signal to stop; write whatever we have and go away cleanly.
    H.log('websocket closed; exiting');
    H.finish(() => process.exit(0));
  };

  const poll = setInterval(() => {
    if (H.stressStartEpoch) {
      clearInterval(poll);
      setTimeout(() => H.finish(() => {
        // Neutralino tears down cleanly when the *page* asks it to exit, so the
        // finish signal goes to the UI, which then calls Neutralino.app.exit().
        transport.send('stress:done', { code: 0 });
        setTimeout(() => process.exit(0), 1500);
      }), H.durationMs);
    }
  }, 100);

  process.on('SIGTERM', () => H.finish(() => process.exit(0)));
  process.on('SIGINT', () => H.finish(() => process.exit(0)));
  process.on('uncaughtException', (err) => {
    H.log('uncaughtException: ' + (err && err.stack ? err.stack : err));
    H.finish(() => process.exit(1));
  });
}

main();
