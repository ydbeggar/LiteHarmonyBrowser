'use strict';

/**
 * Capture one frame from a headless Lite Wearable Simulator.
 *
 * The simulator is started with `-lws <port>`; it exposes a WebSocket server
 * that streams raw frames as: [40-byte header][JPEG payload].
 *
 * Usage:
 *   node tools/capture-frame.js --port 8888 --out frames/index.jpg
 *   node tools/capture-frame.js --port 8888 --out frames/ --count 3
 */

const fs = require('fs');
const path = require('path');

const WS_CANDIDATES = [
  path.join(
    'C:\\Program Files\\Huawei\\DevEco Studio\\tools\\hvigor\\hvigor-ohos-plugin\\node_modules\\ws'
  ),
  'ws'
];

function loadWs() {
  for (let i = 0; i < WS_CANDIDATES.length; i += 1) {
    try {
      return require(WS_CANDIDATES[i]);
    } catch (err) {
      /* try next candidate */
    }
  }
  throw new Error('ws module not found; expected DevEco bundled ws at ' + WS_CANDIDATES[0]);
}

function parseArgs(argv) {
  const opts = {
    host: '127.0.0.1',
    port: 8888,
    out: 'frame.jpg',
    count: 1,
    timeout: 15000,
    headerSize: 40
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--port') {
      opts.port = parseInt(value, 10);
      i += 1;
    } else if (key === '--host') {
      opts.host = value;
      i += 1;
    } else if (key === '--out') {
      opts.out = value;
      i += 1;
    } else if (key === '--count') {
      opts.count = parseInt(value, 10);
      i += 1;
    } else if (key === '--timeout') {
      opts.timeout = parseInt(value, 10);
      i += 1;
    } else if (key === '--header-size') {
      opts.headerSize = parseInt(value, 10);
      i += 1;
    }
  }
  return opts;
}

function resolveOutPath(out, index) {
  const target = path.resolve(process.cwd(), out);
  const isDir = out.endsWith('/') || out.endsWith('\\') || (fs.existsSync(target) && fs.statSync(target).isDirectory());
  if (isDir) {
    fs.mkdirSync(target, { recursive: true });
    return path.join(target, 'frame-' + Date.now() + '-' + index + '.jpg');
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return target;
}

function isJpeg(buf) {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function main() {
  const opts = parseArgs(process.argv);
  const WebSocket = loadWs();

  const url = 'ws://' + opts.host + ':' + opts.port;
  console.log('[capture-frame] connecting ' + url);

  const socket = new WebSocket(url);
  let saved = 0;

  const timer = setTimeout(function () {
    console.error('[capture-frame] timeout after ' + opts.timeout + 'ms, saved=' + saved);
    try {
      socket.close();
    } catch (err) {
      /* ignore */
    }
    process.exit(socket.readyState === WebSocket.OPEN && saved > 0 ? 0 : 2);
  }, opts.timeout);

  socket.on('open', function () {
    console.log('[capture-frame] connected, waiting for frames');
  });

  socket.on('message', function (data) {
    if (saved >= opts.count) {
      return;
    }
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (raw.length <= opts.headerSize) {
      return;
    }
    let payload = raw.slice(opts.headerSize);
    if (!isJpeg(payload)) {
      const magic = raw.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
      if (magic < 0) {
        return;
      }
      payload = raw.slice(magic);
    }
    const outPath = resolveOutPath(opts.out, saved);
    fs.writeFileSync(outPath, payload);
    saved += 1;
    console.log('[capture-frame] saved ' + outPath + ' (' + payload.length + ' bytes)');
    if (saved >= opts.count) {
      clearTimeout(timer);
      socket.close();
      process.exit(0);
    }
  });

  socket.on('error', function (err) {
    console.error('[capture-frame] websocket error: ' + (err && err.message ? err.message : err));
    clearTimeout(timer);
    process.exit(1);
  });

  socket.on('close', function () {
    if (saved > 0) {
      clearTimeout(timer);
      process.exit(0);
    }
  });
}

main();
