// Biller — macOS desktop app for the Langoor Media quotation & invoice generator.
// It shows the same web page (copied into ./web at build time) in its own window,
// and adds a Mac menu bar and Dock menu that press the page's existing buttons.

const { app, BrowserWindow, Menu, shell, protocol, net, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const APP_NAME = 'Biller';
const WEB_ROOT = path.join(__dirname, 'web');
const START_URL = 'app://biller/index.html';
const WEB_VERSION_URL = 'https://electriclangoor.github.io/LMLLP_Biller/';
const COMPANY_URL = 'https://langoormedia.com';

app.setName(APP_NAME);

// While developing, BILLER_USER_DATA points testing at a throwaway data folder
// (never used by the installed app).
if (!app.isPackaged && process.env.BILLER_USER_DATA) {
  app.setPath('userData', process.env.BILLER_USER_DATA);
}

// Serve the page from a fixed private address (app://biller/), so saved history,
// drafts and the backup folder stay put between launches.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

// Only one copy of Biller at a time (two copies could clash over invoice numbers)
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;

// --- Remember the window's size and position ---
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
const loadBounds = () => {
  try {
    const b = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    // Only reuse it if it is still on a connected screen
    const visible = screen.getAllDisplays().some(d => {
      const a = d.workArea;
      return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
    });
    return visible ? b : null;
  } catch {
    return null;
  }
};
const saveBounds = () => {
  if (!win || win.isDestroyed()) return;
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch { /* not important */ }
};

// --- Run an action in the page, as if the user clicked (needed for file and folder pickers) ---
const run = (code) => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.executeJavaScript(`(async () => { ${code} })()`, true).catch(err => console.warn(err));
};

// Small helpers available to the snippets below
const PAGE_HELPERS = `
  const $ = (s) => document.querySelector(s);
  const activeTab = () => ($('.tab-btn.active')?.dataset.target === 'tab-invoice' ? 'invoice' : 'quote');
  const showTab = (t) => { $('.tab-btn[data-target="tab-' + t + '"]')?.click(); };
  const openHistory = (t) => {
    const p = document.querySelector('#tab-' + t + ' .history-panel');
    if (p) { p.open = true; p.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    return p;
  };
`;
const page = (code) => run(PAGE_HELPERS + code);

const actions = {
  newDoc: (t) => page(`showTab('${t}'); $('#${t}-reset-btn')?.click();`),
  showTab: (t) => page(`showTab('${t}');`),
  print: () => page(`$('#' + activeTab() + '-print-btn')?.click();`),
  whatsapp: () => page(`$('#' + activeTab() + '-whatsapp-btn')?.click();`),
  paisa: () => page(`showTab('quote'); $('#quote-to-invoice-btn')?.click();`),
  backupNow: () => page(`await window.billerDesktop?.backupNow();`),
  chooseFolder: () => page(`await window.billerDesktop?.chooseBackupFolder();`),
  importBackup: () => page(`const p = openHistory(activeTab()); p?.querySelector('[data-act="import"]')?.click();`),
  accountant: () => page(`showTab('invoice'); const p = openHistory('invoice'); p?.querySelector('[data-act="accountant"]')?.click();`),
  signature: () => page(`$('#signature-btn')?.click();`),
  toggleHistory: () => page(`
    const p = document.querySelector('#tab-' + activeTab() + ' .history-panel');
    if (!p) return;
    p.open = !p.open;
    if (p.open) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
  `)
};

// --- Menu bar ---
const buildMenu = () => Menu.buildFromTemplate([
  {
    label: APP_NAME,
    submenu: [
      { role: 'about', label: `About ${APP_NAME}` },
      { type: 'separator' },
      { role: 'hide', label: `Hide ${APP_NAME}` },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit', label: `Quit ${APP_NAME}` }
    ]
  },
  {
    label: 'File',
    submenu: [
      { label: 'New Quotation', accelerator: 'CmdOrCtrl+N', click: () => actions.newDoc('quote') },
      { label: 'New Invoice', accelerator: 'Shift+CmdOrCtrl+N', click: () => actions.newDoc('invoice') },
      { type: 'separator' },
      { label: 'Print / Download PDF…', accelerator: 'CmdOrCtrl+P', click: actions.print },
      { label: 'Send on WhatsApp', click: actions.whatsapp },
      { label: 'PAISA! (Quotation → Invoice)', accelerator: 'Shift+CmdOrCtrl+I', click: actions.paisa },
      { type: 'separator' },
      {
        label: 'Backup',
        submenu: [
          { label: 'Back Up Now', click: actions.backupNow },
          { label: 'Choose Backup Folder…', click: actions.chooseFolder },
          { label: 'Import Backup…', click: actions.importBackup }
        ]
      },
      { label: 'Export for Accountant (CSV)…', click: actions.accountant },
      { type: 'separator' },
      { label: 'Signature…', click: actions.signature }
    ]
  },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    ]
  },
  {
    label: 'View',
    submenu: [
      { label: 'Quotation', accelerator: 'CmdOrCtrl+1', click: () => actions.showTab('quote') },
      { label: 'Invoice', accelerator: 'CmdOrCtrl+2', click: () => actions.showTab('invoice') },
      { label: 'Show / Hide History', accelerator: 'CmdOrCtrl+Y', click: actions.toggleHistory },
      { type: 'separator' },
      { role: 'resetZoom', label: 'Actual Size' },
      { role: 'zoomIn', accelerator: 'CmdOrCtrl+=' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { role: 'reload' }
    ]
  },
  {
    role: 'window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'separator' },
      { role: 'front' }
    ]
  },
  {
    role: 'help',
    submenu: [
      { label: 'Open Web Version', click: () => shell.openExternal(WEB_VERSION_URL) },
      { label: 'Langoor Media Website', click: () => shell.openExternal(COMPANY_URL) }
    ]
  }
]);

// --- Main window ---
const createWindow = () => {
  const saved = loadBounds();
  win = new BrowserWindow({
    title: APP_NAME,
    width: saved?.width || 1400,
    height: saved?.height || 900,
    x: saved?.x,
    y: saved?.y,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0a0a0a',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });
  if (saved?.maximized) win.maximize();

  win.once('ready-to-show', () => win.show());
  win.on('close', saveBounds);

  // WhatsApp and other web links open in the normal browser / WhatsApp app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto|tel|whatsapp):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://biller/')) {
      event.preventDefault();
      if (/^(https?|mailto|tel|whatsapp):/i.test(url)) shell.openExternal(url);
    }
  });

  win.loadURL(START_URL);
};

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  // app://biller/<file> → the bundled page files (nothing outside the web folder)
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(WEB_ROOT, rel));
    // (sign.png is never bundled, so a 404 for it is normal: the uploaded signature is used instead)
    if (!file.startsWith(WEB_ROOT + path.sep) || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    version: '',
    copyright: `© ${new Date().getFullYear()} Langoor Media LLP`,
    credits: 'Quotation & invoice generator'
  });

  Menu.setApplicationMenu(buildMenu());
  app.dock?.setMenu(Menu.buildFromTemplate([
    { label: 'New Quotation', click: () => actions.newDoc('quote') },
    { label: 'New Invoice', click: () => actions.newDoc('invoice') }
  ]));

  createWindow();
});

// Single-window tool: closing the window quits Biller
app.on('window-all-closed', () => app.quit());
