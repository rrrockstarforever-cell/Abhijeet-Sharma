const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 3217;
process.env.NODE_ENV = 'production';
process.env.PORT = String(PORT);

// Load optional user secrets (GEMINI_API_KEY) from userData/.env — never bundled.
try {
  const dotenv = require('dotenv');
  const envPath = path.join(app.getPath('userData'), '.env');
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
} catch {}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
else {
  const { spawn } = require('child_process');
  const serverPath = path.join(__dirname, '..', 'server.mjs');
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(PORT),
      // Server stores the user's Gemini key (if pasted in Settings) under the
      // user's data dir, never inside the app bundle or repo.
      PULSE_DATA_DIR: app.getPath('userData'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => console.log(`[server] ${d}`));
  child.stderr.on('data', (d) => console.error(`[server] ${d}`));

  function waitServer(tries) {
    return new Promise((resolve, reject) => {
      const ping = (left) => {
        const req = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1500 }, (res) => { res.resume(); resolve(); });
        req.on('error', () => left > 0 ? setTimeout(() => ping(left - 1), 400) : reject(new Error('server did not start')));
        req.on('timeout', () => { req.destroy(); });
      };
      ping(tries);
    });
  }

  async function createWindow() {
    const win = new BrowserWindow({
      width: 1500, height: 900, minWidth: 1100, minHeight: 700,
      title: 'Pulse Med',
      backgroundColor: '#0b1220',
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: true },
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    Menu.setApplicationMenu(null);
    await waitServer(50);
    await win.loadURL(`http://127.0.0.1:${PORT}/`);
  }

  app.on('second-instance', () => { const [w] = BrowserWindow.getAllWindows(); if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(createWindow).catch((e) => { console.error(e); try { require('electron').dialog.showErrorBox('Pulse Med', String(e && e.message || e)); } catch {} app.quit(); });
  app.on('window-all-closed', () => app.quit());
}
