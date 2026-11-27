document.addEventListener('DOMContentLoaded', () => {
  // --- Tab Switching Logic ---
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  const activateTab = (targetId) => {
    tabBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-target') === targetId));
    tabContents.forEach(c => c.classList.toggle('active', c.id === targetId));
    adjustScale();
  };

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.getAttribute('data-target')));
  });

  // --- Shared helpers ---
  const pad2 = (n) => String(n).padStart(2, '0');

  // Local YYYY-MM-DD (valueAsDate uses UTC, which can give yesterday's date in IST before 5:30am)
  const toISODate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  const parseISODate = (s) => {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  const formatDate = (dateString) => {
    const d = parseISODate(dateString);
    if (!d) return '-';
    return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatCurrency = (amount) => new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR'
  }).format(amount);

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  // Indian numbering system: crore / lakh / thousand / hundred
  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const twoDigits = (n) => n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
  const threeDigits = (n) => {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    return [h ? `${ONES[h]} Hundred` : '', rest ? twoDigits(rest) : ''].filter(Boolean).join(' ');
  };

  const numberToWords = (num) => {
    if (num === 0) return 'Zero';
    const parts = [];
    const crore = Math.floor(num / 10000000);
    num %= 10000000;
    const lakh = Math.floor(num / 100000);
    num %= 100000;
    const thousand = Math.floor(num / 1000);
    num %= 1000;
    if (crore) parts.push(`${numberToWords(crore)} Crore`);
    if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
    if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
    if (num) parts.push(threeDigits(num));
    return parts.join(' ');
  };

  const amountInWords = (amount) => {
    const rupees = Math.floor(amount);
    const paise = Math.round((amount - rupees) * 100);
    let words = `Rupees ${numberToWords(rupees)}`;
    if (paise) words += ` and ${twoDigits(paise)} Paise`;
    return `${words} Only`;
  };

  // All money maths in one place, so the document, history and exports always agree
  const computeTotals = (fields, items) => {
    const subtotal = round2((items || []).reduce((sum, i) => sum + round2((parseFloat(i.qty) || 0) * (parseFloat(i.rate) || 0)), 0));
    const discount = Math.min(subtotal, Math.max(0, parseFloat(fields.discount) || 0));
    const taxable = round2(subtotal - discount);
    const taxRate = parseFloat(fields.taxRate) || 0;
    const tax = round2((taxable * taxRate) / 100);
    const total = round2(taxable + tax);
    const paid = round2(Math.max(0, parseFloat(fields.amountPaid) || 0));
    const balance = round2(Math.max(0, total - paid));
    return { subtotal, discount, taxable, taxRate, tax, total, paid, balance };
  };

  const todayISO = () => toISODate(new Date());

  // Payment status of a saved invoice: paid / part / unpaid, plus overdue when past the due date
  const paymentInfo = (entry) => {
    const t = computeTotals(entry.state.fields, entry.state.items);
    let status = 'unpaid';
    if (t.total > 0 && t.balance <= 0) status = 'paid';
    else if (t.paid > 0) status = 'part';
    const due = entry.state.fields.docValid;
    const overdue = status !== 'paid' && !!due && due < todayISO();
    return { ...t, status, overdue };
  };

  // In the Android app, Biller's own bridge saves files to Downloads (Android can't save blob links)
  const android = window.BillerAndroid;
  const downloadFile = (filename, text, type) => {
    if (android) { android.saveFile(filename, text, type); return; }
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // --- Storage (wrapped so the app still works if localStorage is blocked) ---
  const store = {
    get(key) {
      try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
  };

  // --- In-page dialogs ---
  // The browser's built-in yes/no pop-ups are silently blocked in some embedded browsers, so use our own.
  const modal = document.createElement('div');
  modal.className = 'lm-modal noprint';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="lm-modal-box" role="dialog" aria-modal="true">
      <p class="lm-modal-msg"></p>
      <div class="lm-modal-fields"></div>
      <div class="lm-modal-btns"></div>
    </div>
  `;
  document.body.appendChild(modal);
  const modalMsg = modal.querySelector('.lm-modal-msg');
  const modalFields = modal.querySelector('.lm-modal-fields');
  const modalBtns = modal.querySelector('.lm-modal-btns');

  // Resolves to { key, values }: key is the clicked button's key (null if dismissed)
  const showModal = ({ message = '', fields = [], buttons = [] }) =>
    new Promise(resolve => {
      modalMsg.textContent = message;
      modalFields.innerHTML = '';
      modalBtns.innerHTML = '';
      const inputs = {};

      fields.forEach(f => {
        const wrap = document.createElement('label');
        wrap.className = 'lm-modal-field';
        const span = document.createElement('span');
        span.textContent = f.label;
        const input = document.createElement('input');
        input.type = f.type || 'text';
        if (f.value !== undefined) input.value = f.value;
        if (f.min !== undefined) input.min = f.min;
        if (f.step !== undefined) input.step = f.step;
        wrap.append(span, input);
        modalFields.appendChild(wrap);
        inputs[f.name] = input;
      });

      let primary = null;
      const close = (key) => {
        modal.hidden = true;
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
        const values = {};
        Object.entries(inputs).forEach(([k, el]) => { values[k] = el.value; });
        resolve({ key, values });
      };

      buttons.forEach(b => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn ${b.primary ? 'btn-primary' : 'btn-secondary'}`;
        btn.textContent = b.label;
        btn.addEventListener('click', () => close(b.key));
        modalBtns.appendChild(btn);
        if (b.primary) primary = b;
      });

      const onBackdrop = (e) => { if (e.target === modal) close(null); };
      const onKey = (e) => {
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter' && primary) { e.preventDefault(); close(primary.key); }
      };
      modal.addEventListener('click', onBackdrop);
      modal.hidden = false;

      const firstInput = Object.values(inputs)[0];
      if (firstInput) { firstInput.focus(); firstInput.select?.(); }
      else (modalBtns.querySelector('.btn-primary') || modalBtns.lastElementChild)?.focus();

      // Start listening for keys after this event finishes, so the Enter that opened the box can't also answer it
      setTimeout(() => { if (!modal.hidden) document.addEventListener('keydown', onKey); }, 0);
    });

  const askConfirm = async (message, okLabel = 'OK') =>
    (await showModal({ message, buttons: [{ key: 'cancel', label: 'Cancel' }, { key: 'ok', label: okLabel, primary: true }] })).key === 'ok';
  const notify = (message) => showModal({ message, buttons: [{ key: 'ok', label: 'OK', primary: true }] });
  const askForm = async (message, fields, okLabel = 'OK') => {
    const r = await showModal({ message, fields, buttons: [{ key: 'cancel', label: 'Cancel' }, { key: 'ok', label: okLabel, primary: true }] });
    return r.key === 'ok' ? r.values : null;
  };
  const askChoice = async (message, buttons) => (await showModal({ message, buttons })).key;

  // --- History of past documents (shared by both tabs) ---
  const HISTORY_KEY = 'lm-history';
  const HISTORY_LIMIT = 500;
  const history = {
    all: () => store.get(HISTORY_KEY) || [],
    save(list) {
      store.set(HISTORY_KEY, list.slice(0, HISTORY_LIMIT));
      this.listeners.forEach(fn => fn());
    },
    upsert(entry) {
      this.save([entry, ...this.all().filter(e => e.id !== entry.id)]);
    },
    // Change an entry without moving it to the top of the list
    update(entry) {
      this.save(this.all().map(e => (e.id === entry.id ? entry : e)));
    },
    remove(id) {
      this.save(this.all().filter(e => e.id !== id));
    },
    listeners: []
  };

  // Datalists used for autocomplete, built from history
  const makeDatalist = (id) => {
    const dl = document.createElement('datalist');
    dl.id = id;
    document.body.appendChild(dl);
    return dl;
  };
  const clientsList = makeDatalist('lm-clients');
  const companiesList = makeDatalist('lm-companies');
  const servicesList = makeDatalist('lm-services');

  const fillDatalist = (dl, values) => {
    dl.innerHTML = '';
    values.forEach(v => {
      const o = document.createElement('option');
      o.value = v;
      dl.appendChild(o);
    });
  };

  // Most recent entry wins for client details and service rates
  const findClient = (field, value) => {
    const v = (value || '').trim().toLowerCase();
    if (!v) return null;
    const hit = history.all().find(e => (e.state.fields[field] || '').trim().toLowerCase() === v);
    return hit ? hit.state.fields : null;
  };

  const findServiceRate = (desc) => {
    const d = (desc || '').trim().toLowerCase();
    if (!d) return null;
    for (const e of history.all()) {
      const it = e.state.items.find(i => (i.desc || '').trim().toLowerCase() === d);
      if (it) return it.rate;
    }
    return null;
  };

  const refreshDatalists = () => {
    const uniq = (arr) => [...new Map(arr.filter(Boolean).map(s => [s.trim().toLowerCase(), s.trim()])).values()];
    const all = history.all();
    fillDatalist(clientsList, uniq(all.map(e => e.state.fields.clientName)));
    fillDatalist(companiesList, uniq(all.map(e => e.state.fields.clientCompany)));
    fillDatalist(servicesList, uniq(all.flatMap(e => e.state.items.map(i => i.desc))));
  };
  history.listeners.push(refreshDatalists);

  // --- Backups ---
  // History lives in this browser only. In Chrome/Edge it can be saved automatically to a folder you pick;
  // everywhere else you get a reminder to download a backup file every couple of weeks.
  const BACKUP_LAST_KEY = 'lm-last-backup';
  const BACKUP_SNOOZE_KEY = 'lm-backup-snooze';
  const REMIND_DAYS = 14;
  // The Android app saves backups to Downloads instead (Android can't keep a folder link between launches)
  const canPickFolder = !android && 'showDirectoryPicker' in window;

  const idb = (() => {
    let dbPromise = null;
    const open = () => {
      if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
          const req = indexedDB.open('lm-generator', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('kv');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }
      return dbPromise;
    };
    const run = (mode, fn) => open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
    }));
    return {
      get: (k) => run('readonly', s => s.get(k)).catch(() => null),
      set: (k, v) => run('readwrite', s => s.put(v, k)).catch(() => null),
      del: (k) => run('readwrite', s => s.delete(k)).catch(() => null)
    };
  })();

  let backupDir = null;

  const backupText = () => JSON.stringify(history.all(), null, 2);
  const markBackedUp = () => {
    store.set(BACKUP_LAST_KEY, Date.now());
    updateBackupUI();
  };
  const downloadBackup = () => {
    downloadFile(`langoor-history-${todayISO()}.json`, backupText(), 'application/json');
    markBackedUp();
  };

  const folderPermission = async (request = false) => {
    if (!backupDir) return 'none';
    try {
      const opts = { mode: 'readwrite' };
      let p = await backupDir.queryPermission(opts);
      if (p !== 'granted' && request) p = await backupDir.requestPermission(opts);
      return p;
    } catch {
      return 'denied';
    }
  };

  const writeFolderBackup = async () => {
    if ((await folderPermission()) !== 'granted') { updateBackupUI(); return false; }
    try {
      const text = backupText();
      const write = async (name) => {
        const fh = await backupDir.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(text);
        await w.close();
      };
      await write('langoor-history-latest.json');
      await write(`langoor-history-${todayISO()}.json`);
      markBackedUp();
      return true;
    } catch (err) {
      console.warn('Backup failed', err);
      updateBackupUI();
      return false;
    }
  };

  let backupTimer = null;
  history.listeners.push(() => {
    clearTimeout(backupTimer);
    backupTimer = setTimeout(() => { if (backupDir) writeFolderBackup(); else updateBackupUI(); }, 800);
  });

  const chooseBackupFolder = async () => {
    try {
      const handle = await window.showDirectoryPicker({ id: 'lm-backup', mode: 'readwrite' });
      backupDir = handle;
      await idb.set('backupDir', handle);
      const ok = await writeFolderBackup();
      notify(ok
        ? `Automatic backup is on. Every time your history changes, it's saved to the "${handle.name}" folder (a "latest" file plus one copy per day).`
        : 'That folder could not be written to. Please try another folder.');
    } catch (err) {
      if (err && err.name !== 'AbortError') notify(`Could not use that folder: ${err.message}`);
    }
  };

  const stopFolderBackup = async () => {
    backupDir = null;
    await idb.del('backupDir');
    updateBackupUI();
  };

  // Backup button in the top bar, with a coloured status dot
  const backupBtn = document.createElement('button');
  backupBtn.type = 'button';
  backupBtn.id = 'backup-btn';
  backupBtn.className = 'backup-btn noprint';
  backupBtn.innerHTML = '<span class="backup-dot"></span><span>Backup</span>';
  document.querySelector('.app-tabs').appendChild(backupBtn);

  // Reminder toast in the corner
  const toast = document.createElement('div');
  toast.className = 'lm-toast noprint';
  toast.hidden = true;
  document.body.appendChild(toast);

  const showToast = (message, actions) => {
    toast.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = message;
    const row = document.createElement('div');
    row.className = 'lm-toast-btns';
    actions.forEach(a => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = a.primary ? 'history-btn primary' : 'history-btn';
      b.textContent = a.label;
      b.addEventListener('click', a.fn);
      row.appendChild(b);
    });
    toast.append(p, row);
    toast.hidden = false;
  };

  const snoozeReminder = () => {
    store.set(BACKUP_SNOOZE_KEY, Date.now() + 3 * 86400000);
    toast.hidden = true;
  };

  const daysSinceBackup = () => {
    const last = store.get(BACKUP_LAST_KEY);
    return last ? Math.floor((Date.now() - last) / 86400000) : null;
  };

  let backupState = 'ok';
  const updateBackupUI = async () => {
    const perm = await folderPermission();
    const days = daysSinceBackup();
    const hasHistory = history.all().length > 0;

    if (backupDir && perm === 'granted') backupState = 'auto';
    else if (backupDir) backupState = 'reconnect';
    else if (!hasHistory || (days !== null && days < REMIND_DAYS)) backupState = 'ok';
    else backupState = 'due';

    backupBtn.dataset.state = backupState;
    backupBtn.title = {
      auto: `Automatic backup is on (folder "${backupDir?.name}")`,
      reconnect: 'Automatic backup is paused: click to allow access to the backup folder again',
      ok: days === null ? 'No backup needed yet' : `Last backup ${days === 0 ? 'today' : days + ' day(s) ago'}`,
      due: days === null ? 'Your history has never been backed up' : `Last backup ${days} days ago`
    }[backupState];

    const snoozed = (store.get(BACKUP_SNOOZE_KEY) || 0) > Date.now();
    if (backupState === 'reconnect' && !snoozed) {
      showToast(`Automatic backup is paused. Your browser needs your OK again to save into the "${backupDir.name}" folder.`, [
        { label: 'Allow', primary: true, fn: async () => { toast.hidden = true; if ((await folderPermission(true)) === 'granted') writeFolderBackup(); else updateBackupUI(); } },
        { label: 'Later', fn: snoozeReminder }
      ]);
    } else if (backupState === 'due' && !snoozed) {
      const actions = [{ label: 'Download backup', primary: true, fn: () => { toast.hidden = true; downloadBackup(); } }];
      if (canPickFolder) actions.push({ label: 'Set up automatic backup', fn: () => { toast.hidden = true; chooseBackupFolder(); } });
      actions.push({ label: 'Later', fn: snoozeReminder });
      showToast(days === null
        ? 'Your quotations & invoices history has never been backed up. It only lives in this browser.'
        : `Your history hasn't been backed up in ${days} days.`, actions);
    } else {
      toast.hidden = true;
    }
  };

  backupBtn.addEventListener('click', async () => {
    if (backupState === 'reconnect') {
      if ((await folderPermission(true)) === 'granted') { await writeFolderBackup(); notify('Automatic backup is back on.'); }
      return;
    }
    const days = daysSinceBackup();
    const lastText = days === null ? 'never' : days === 0 ? 'today' : `${days} day(s) ago`;
    if (!canPickFolder) {
      const k = await askChoice(
        `Last backup: ${lastText}.\n\n${android ? `Backups are saved to Downloads/Biller on this phone. You'll get a reminder every ${REMIND_DAYS} days to save one.` : `This browser can't save backups to a folder automatically (Chrome or Edge can). You'll get a reminder every ${REMIND_DAYS} days to download a backup file instead.`}`,
        [{ key: 'close', label: 'Close' }, { key: 'download', label: 'Download backup now', primary: true }]);
      if (k === 'download') downloadBackup();
      return;
    }
    if (backupDir) {
      const k = await askChoice(
        `Automatic backup is ON.\nFolder: "${backupDir.name}"\nLast backup: ${lastText}.\n\nTo restore, use "Import backup" in the history panel and pick langoor-history-latest.json from that folder.`,
        [{ key: 'off', label: 'Turn off' }, { key: 'change', label: 'Change folder' }, { key: 'now', label: 'Back up now', primary: true }]);
      if (k === 'now') { if (await writeFolderBackup()) notify('Backed up.'); }
      if (k === 'change') chooseBackupFolder();
      if (k === 'off') stopFolderBackup();
      return;
    }
    const k = await askChoice(
      `Last backup: ${lastText}.\n\nPick a folder (e.g. one inside Google Drive, iCloud or Dropbox) and your history will be saved there automatically every time it changes.`,
      [{ key: 'download', label: 'Just download a copy' }, { key: 'folder', label: 'Choose backup folder', primary: true }]);
    if (k === 'folder') chooseBackupFolder();
    if (k === 'download') downloadBackup();
  });

  idb.get('backupDir').then(h => { backupDir = h || null; updateBackupUI(); });

  // Hooks for the Biller Mac app's File > Backup menu
  // Android back gesture: close an open dialog, then an open history list; false lets the app go back
  window.billerBack = () => {
    if (!modal.hidden) { modal.click(); return true; }
    const open = [...document.querySelectorAll('.history-panel[open]')].find(p => p.offsetParent);
    if (open) { open.open = false; return true; }
    return false;
  };

  window.billerDesktop = {
    backupNow: async () => {
      if (!backupDir) { downloadBackup(); return; }
      if (await writeFolderBackup()) notify('Backed up.');
      else backupBtn.click();
    },
    chooseBackupFolder: () => (canPickFolder ? chooseBackupFolder() : backupBtn.click())
  };

  // --- Signature ---
  // The signature image is never published with the code. Each browser keeps its own copy
  // (uploaded here); a local sign.png next to index.html is used if no copy has been uploaded.
  const SIGNATURE_KEY = 'lm-signature';
  const signatureImgs = () => document.querySelectorAll('.doc-sign-img');
  const applySignature = () => {
    const custom = store.get(SIGNATURE_KEY);
    signatureImgs().forEach(img => {
      const want = custom || 'sign.png';
      if (img.getAttribute('src') !== want) img.setAttribute('src', want);
    });
  };

  const signBtn = document.createElement('button');
  signBtn.type = 'button';
  signBtn.id = 'signature-btn';
  signBtn.className = 'backup-btn noprint';
  signBtn.textContent = 'Signature';
  backupBtn.insertAdjacentElement('beforebegin', signBtn);

  const signInput = document.createElement('input');
  signInput.type = 'file';
  signInput.accept = 'image/png,image/jpeg,image/webp';
  signInput.hidden = true;
  document.body.appendChild(signInput);

  // Shrink big images so they fit comfortably in browser storage (transparency is kept)
  const imageToDataUrl = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 600 / img.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
    img.src = url;
  });

  signInput.addEventListener('change', async () => {
    const file = signInput.files[0];
    signInput.value = '';
    if (!file) return;
    try {
      store.set(SIGNATURE_KEY, await imageToDataUrl(file));
      if (!store.get(SIGNATURE_KEY)) throw new Error('storage full');
      applySignature();
      notify('Signature saved in this browser. It will appear on your quotations and invoices.');
    } catch {
      notify('That image could not be used. Please try a PNG or JPG file.');
    }
  });

  signBtn.addEventListener('click', async () => {
    const custom = !!store.get(SIGNATURE_KEY);
    const buttons = [{ key: 'close', label: 'Close' }];
    if (custom) buttons.push({ key: 'remove', label: 'Remove' });
    buttons.push({ key: 'upload', label: custom ? 'Replace signature' : 'Upload signature', primary: true });
    const k = await askChoice(
      (custom ? 'Your signature is saved in this browser.' : 'No signature uploaded in this browser yet.') +
      '\n\nUpload a picture of your signature (a PNG with a transparent background looks best). It stays in this browser only; it is never uploaded anywhere.',
      buttons);
    if (k === 'upload') signInput.click();
    if (k === 'remove' && await askConfirm('Remove the saved signature from this browser?', 'Remove')) {
      store.remove(SIGNATURE_KEY);
      applySignature();
    }
  });

  applySignature();

  // --- Generator Logic Setup ---
  const setupGenerator = (prefix) => {
    const draftKey = `lm-draft-${prefix}`;
    const seqKey = `lm-seq-monthly-${prefix}`;
    const termsKey = `lm-terms-${prefix}`;
    const isInvoice = prefix === 'invoice';
    const docLabel = isInvoice ? 'invoice' : 'quotation';

    const formElements = {
      clientName: document.getElementById(`${prefix}-client-name`),
      clientCompany: document.getElementById(`${prefix}-client-company`),
      clientEmail: document.getElementById(`${prefix}-client-email`),
      clientAddress: document.getElementById(`${prefix}-client-address`),
      clientGstin: document.getElementById(`${prefix}-client-gstin`),
      clientPhone: document.getElementById(`${prefix}-client-phone`),
      projectName: document.getElementById(`${prefix}-project-name`),
      docNo: document.getElementById(`${prefix}-no`),
      docDate: document.getElementById(`${prefix}-date`),
      docValid: document.getElementById(`${prefix}-valid`),
      projectType: document.getElementById(`${prefix}-project-type`),
      taxName: document.getElementById(`${prefix}-tax-name`),
      taxRate: document.getElementById(`${prefix}-tax-rate`),
      discount: document.getElementById(`${prefix}-discount`),
      amountPaid: document.getElementById(`${prefix}-amount-paid`),
      terms: document.getElementById(`${prefix}-terms`)
    };

    const docElements = {
      clientName: document.getElementById(`doc-${prefix}-client-name`),
      clientCompany: document.getElementById(`doc-${prefix}-client-company`),
      clientEmail: document.getElementById(`doc-${prefix}-client-email`),
      clientAddress: document.getElementById(`doc-${prefix}-client-address`),
      clientGstin: document.getElementById(`doc-${prefix}-client-gstin`),
      projectName: document.getElementById(`doc-${prefix}-project-name`),
      projectType: document.getElementById(`doc-${prefix}-project-type`),
      docNo: document.getElementById(`doc-${prefix}-no`),
      docDate: document.getElementById(`doc-${prefix}-date`),
      docValid: document.getElementById(`doc-${prefix}-valid`),
      taxLabel: document.getElementById(`doc-${prefix}-tax-label`),
      terms: document.getElementById(`doc-${prefix}-terms`)
    };

    const tbody = document.getElementById(`doc-${prefix}-items-tbody`);
    const addBtn = document.getElementById(`${prefix}-add-item-btn`);
    const printBtn = document.getElementById(`${prefix}-print-btn`);
    const resetBtn = document.getElementById(`${prefix}-reset-btn`);
    const whatsappBtn = document.getElementById(`${prefix}-whatsapp-btn`);
    const itemsContainer = document.getElementById(`${prefix}-items-container`);

    let items = [];
    let nextId = 1;

    // --- Terms & Conditions: the built-in list comes from the page; a saved default overrides it ---
    const builtInTerms = [...docElements.terms.querySelectorAll('li')]
      .map(li => li.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
    formElements.terms.defaultValue = store.get(termsKey) || builtInTerms;

    // --- Document numbering: <Q|INV>-YYYYMMDD-###
    // YYYYMMDD is the document date; ### counts up within the month and restarts at 001 each new month.
    const docPrefixStr = isInvoice ? 'INV' : 'Q';
    const numberPattern = new RegExp(`^${docPrefixStr}-(\\d{6})\\d{2}-(\\d+)$`, 'i');

    // Highest ### used per month: remembered counter + anything found in history
    const lastUsedInMonth = (yyyymm) => {
      const seq = store.get(seqKey) || {};
      let max = typeof seq === 'object' && seq[yyyymm] ? seq[yyyymm] : 0;
      history.all().forEach(e => {
        if (e.type !== prefix) return;
        const m = (e.docNo || '').match(numberPattern);
        if (m && m[1] === yyyymm) max = Math.max(max, parseInt(m[2], 10));
      });
      return max;
    };

    const nextDocNo = (dateISO) => {
      const datePart = (dateISO || todayISO()).replace(/-/g, '');
      const n = lastUsedInMonth(datePart.slice(0, 6)) + 1;
      return `${docPrefixStr}-${datePart}-${String(n).padStart(3, '0')}`;
    };

    const markDocNoUsed = (docNo) => {
      const m = (docNo || '').trim().match(numberPattern);
      if (!m) return;
      const seq = store.get(seqKey) || {};
      const n = parseInt(m[2], 10);
      if (!(seq[m[1]] >= n)) store.set(seqKey, { ...seq, [m[1]]: n });
    };

    // Is this number already saved for a different document?
    const findDuplicate = (docNo) => {
      const no = (docNo || '').trim().toLowerCase();
      if (!no) return null;
      return history.all().find(e => e.type === prefix && e.docNo.toLowerCase() === no) || null;
    };

    // --- Preview rendering ---
    const setText = (el, value, { hideEmpty = false } = {}) => {
      if (!el) return;
      const v = (value || '').trim();
      el.textContent = v || '-';
      el.style.display = hideEmpty && !v ? 'none' : '';
    };

    const renderTerms = () => {
      docElements.terms.innerHTML = '';
      formElements.terms.value.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
        const li = document.createElement('li');
        li.textContent = line;
        docElements.terms.appendChild(li);
      });
    };

    const renderFields = () => {
      setText(docElements.clientName, formElements.clientName.value);
      setText(docElements.clientCompany, formElements.clientCompany.value, { hideEmpty: true });
      setText(docElements.clientEmail, formElements.clientEmail.value, { hideEmpty: true });
      setText(docElements.clientAddress, formElements.clientAddress.value, { hideEmpty: true });
      const g = formElements.clientGstin.value.trim().toUpperCase();
      setText(docElements.clientGstin, g ? `GSTIN: ${g}` : '', { hideEmpty: true });
      setText(docElements.projectName, formElements.projectName.value);
      setText(docElements.projectType, formElements.projectType.value, { hideEmpty: true });
      setText(docElements.docNo, formElements.docNo.value);
      docElements.docDate.textContent = formatDate(formElements.docDate.value);
      docElements.docValid.textContent = formatDate(formElements.docValid.value);
      renderTerms();
    };

    const getFields = () => {
      const fields = {};
      fieldKeys.forEach(k => { fields[k] = formElements[k].value; });
      return fields;
    };

    const renderDocItems = () => {
      tbody.innerHTML = '';

      items.forEach((item, idx) => {
        const amount = round2(item.qty * item.rate);
        const tr = document.createElement('tr');
        const descTd = document.createElement('td');
        const title = document.createElement('div');
        title.className = 'item-title';
        // textContent (not innerHTML) so characters like < & in descriptions print correctly
        title.textContent = item.desc.trim() || 'Service Description';
        descTd.appendChild(title);

        const cell = (cls, text) => {
          const td = document.createElement('td');
          td.className = cls;
          td.textContent = text;
          return td;
        };

        tr.appendChild(cell('col-sno', String(idx + 1)));
        tr.appendChild(descTd);
        tr.appendChild(cell('col-qty', String(item.qty)));
        tr.appendChild(cell('col-rate', formatCurrency(item.rate)));
        tr.appendChild(cell('col-amount', formatCurrency(amount)));
        tbody.appendChild(tr);
      });

      const t = computeTotals(getFields(), items);

      document.getElementById(`doc-${prefix}-subtotal`).textContent = formatCurrency(t.subtotal);

      const discountRow = document.getElementById(`${prefix}-discount-row`);
      discountRow.style.display = t.discount > 0 ? 'flex' : 'none';
      document.getElementById(`doc-${prefix}-discount-amount`).textContent = `- ${formatCurrency(t.discount)}`;

      // Tax label always reflects the current rate, e.g. "GST (18%)"
      const taxName = formElements.taxName.value.trim() || 'Tax';
      docElements.taxLabel.textContent = `${taxName} (${t.taxRate}%)`;

      const taxRow = document.getElementById(`${prefix}-tax-row`);
      taxRow.style.display = t.taxRate > 0 ? 'flex' : 'none';
      document.getElementById(`doc-${prefix}-tax-amount`).textContent = formatCurrency(t.tax);

      document.getElementById(`doc-${prefix}-total`).textContent = formatCurrency(t.total);
      document.getElementById(`doc-${prefix}-words`).textContent = amountInWords(t.total);

      // Invoices: show what's been received and what's still due
      if (isInvoice) {
        const hasPaid = t.paid > 0;
        document.getElementById('doc-invoice-total-label').textContent = hasPaid ? 'Invoice Total' : 'Total Due';
        document.getElementById('invoice-paid-row').style.display = hasPaid ? 'flex' : 'none';
        document.getElementById('invoice-balance-row').style.display = hasPaid ? 'flex' : 'none';
        document.getElementById('doc-invoice-paid').textContent = `- ${formatCurrency(t.paid)}`;
        document.getElementById('doc-invoice-balance').textContent = formatCurrency(t.balance);
        const balanceRow = document.getElementById('invoice-balance-row');
        const fullyPaid = hasPaid && t.balance <= 0;
        balanceRow.classList.toggle('is-paid', fullyPaid);
        document.getElementById('doc-invoice-balance-label').textContent = fullyPaid ? 'Paid in Full' : 'Balance Due';
      }
      lastTotal = t.total;
    };
    let lastTotal = 0;

    // --- Draft persistence ---
    const fieldKeys = Object.keys(formElements).filter(k => formElements[k]);

    const getState = () => ({
      fields: getFields(),
      items: items.map(({ desc, qty, rate }) => ({ desc, qty, rate }))
    });

    let saveTimer = null;
    const saveDraft = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => store.set(draftKey, getState()), 300);
    };

    // Warning under the number field when it's already been used
    const noWarning = document.createElement('div');
    noWarning.className = 'field-warning';
    formElements.docNo.insertAdjacentElement('afterend', noWarning);
    const updateNumberWarning = () => {
      const dup = findDuplicate(formElements.docNo.value);
      noWarning.textContent = dup
        ? `${dup.docNo} is already used${dup.client ? ' for ' + dup.client : ''}. Saving or printing will overwrite that entry in history.`
        : '';
      noWarning.style.display = dup ? 'block' : 'none';
    };
    history.listeners.push(updateNumberWarning);

    const renderAll = () => {
      updateNumberWarning();
      renderFields();
      renderDocItems();
      adjustScale();
      saveDraft();
    };

    // Typing your own number stops auto-numbering; changing the date while auto-numbered renumbers it
    formElements.docNo.addEventListener('input', () => {
      if (formElements.docNo.value !== autoNo) autoNo = null;
    });
    formElements.docDate.addEventListener('input', () => {
      if (autoNo !== null && formElements.docNo.value === autoNo) setAutoNumber();
    });

    fieldKeys.forEach(k => formElements[k].addEventListener('input', renderAll));

    // Terms buttons
    document.getElementById(`${prefix}-terms-default-btn`).addEventListener('click', async () => {
      if (!(await askConfirm(`Use these terms for every new ${docLabel} from now on? (Documents already saved keep their own terms.)`, 'Use as default'))) return;
      store.set(termsKey, formElements.terms.value);
      formElements.terms.defaultValue = formElements.terms.value;
      notify(`Saved. New ${docLabel}s will start with these terms.`);
    });
    document.getElementById(`${prefix}-terms-reset-btn`).addEventListener('click', async () => {
      const saved = store.get(termsKey);
      let text = formElements.terms.defaultValue;
      if (saved && saved !== builtInTerms) {
        const k = await askChoice('Which terms should this document go back to?', [
          { key: 'original', label: 'Original terms' },
          { key: 'saved', label: 'My saved default', primary: true }
        ]);
        if (!k) return;
        if (k === 'original') {
          text = builtInTerms;
          if (await askConfirm(`Also make the original terms the default for new ${docLabel}s again?`, 'Yes')) {
            store.remove(termsKey);
            formElements.terms.defaultValue = builtInTerms;
          }
        }
      } else if (!(await askConfirm('Replace these terms with the default ones?', 'Reset'))) {
        return;
      }
      formElements.terms.value = text;
      renderAll();
    });

    // --- Line item editor ---
    const syncItemsFromDom = () => {
      const byId = new Map(items.map(i => [String(i.id), i]));
      items = [...itemsContainer.children].map(el => byId.get(el.dataset.id)).filter(Boolean);
      renderAll();
    };

    const createItemEditor = (item) => {
      const div = document.createElement('div');
      div.className = 'item-entry';
      div.dataset.id = item.id;

      div.innerHTML = `
        <button class="drag-handle" type="button" aria-label="Drag to reorder (or use arrow keys)" title="Drag to reorder">⠿</button>
        <button class="btn-remove-item" type="button" aria-label="Remove">&times;</button>
        <div class="input-field">
          <label>Description</label>
          <input type="text" class="item-desc" placeholder="e.g. Video Editing">
        </div>
        <div class="input-group-2">
          <div class="input-field">
            <label>Quantity / Hrs</label>
            <input type="number" class="item-qty" min="0" step="0.5">
          </div>
          <div class="input-field">
            <label>Rate (₹)</label>
            <input type="number" class="item-rate" min="0">
          </div>
        </div>
        <div class="item-line-total"></div>
      `;

      const descInput = div.querySelector('.item-desc');
      const qtyInput = div.querySelector('.item-qty');
      const rateInput = div.querySelector('.item-rate');
      const lineTotal = div.querySelector('.item-line-total');
      const handle = div.querySelector('.drag-handle');
      descInput.value = item.desc;
      qtyInput.value = item.qty;
      rateInput.value = item.rate;

      const showLineTotal = () => {
        lineTotal.textContent = `Line total: ${formatCurrency(round2(item.qty * item.rate))}`;
      };
      showLineTotal();

      const updateData = () => {
        item.desc = descInput.value;
        item.qty = parseFloat(qtyInput.value) || 0;
        item.rate = parseFloat(rateInput.value) || 0;
        showLineTotal();
        renderAll();
      };

      [descInput, qtyInput, rateInput].forEach(input => input.addEventListener('input', updateData));

      // Picking a service used before fills in the rate charged last time
      descInput.setAttribute('list', 'lm-services');
      descInput.setAttribute('autocomplete', 'off');
      descInput.addEventListener('change', () => {
        const rate = findServiceRate(descInput.value);
        if (rate !== null && rate !== item.rate) {
          rateInput.value = rate;
          updateData();
        }
      });

      // Enter in the rate field adds the next line item
      rateInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addItem();
        }
      });

      div.querySelector('.btn-remove-item').addEventListener('click', () => {
        div.remove();
        items = items.filter(i => i.id !== item.id);
        renderAll();
      });

      // Drag to reorder: only the handle starts a drag, so text in the inputs can still be selected
      handle.addEventListener('mousedown', () => { div.draggable = true; });
      handle.addEventListener('touchstart', () => { div.draggable = true; }, { passive: true });
      div.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(item.id));
        requestAnimationFrame(() => div.classList.add('dragging'));
      });
      div.addEventListener('dragend', () => {
        div.draggable = false;
        div.classList.remove('dragging');
        syncItemsFromDom();
      });
      // Keyboard alternative: focus the handle and press ↑ / ↓
      handle.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' && div.previousElementSibling) {
          e.preventDefault();
          itemsContainer.insertBefore(div, div.previousElementSibling);
        } else if (e.key === 'ArrowDown' && div.nextElementSibling) {
          e.preventDefault();
          itemsContainer.insertBefore(div.nextElementSibling, div);
        } else {
          return;
        }
        handle.focus();
        syncItemsFromDom();
      });

      return div;
    };

    // While dragging, move the card live to where the pointer is
    itemsContainer.addEventListener('dragover', (e) => {
      const dragging = itemsContainer.querySelector('.item-entry.dragging');
      if (!dragging) return;
      e.preventDefault();
      const after = [...itemsContainer.querySelectorAll('.item-entry:not(.dragging)')].find(el => {
        const box = el.getBoundingClientRect();
        return e.clientY < box.top + box.height / 2;
      });
      if (after) itemsContainer.insertBefore(dragging, after);
      else itemsContainer.appendChild(dragging);
    });
    itemsContainer.addEventListener('drop', (e) => e.preventDefault());

    const addItem = (data = {}, { focus = true } = {}) => {
      const defaultRate = items.length === 0 ? 5000 : 0;
      const newItem = {
        id: nextId++,
        desc: data.desc ?? '',
        qty: data.qty ?? 1,
        rate: data.rate ?? defaultRate
      };
      items.push(newItem);

      const editor = createItemEditor(newItem);
      itemsContainer.appendChild(editor);
      if (focus) editor.querySelector('.item-desc').focus();
      renderAll();
    };

    const setItems = (list) => {
      items = [];
      itemsContainer.innerHTML = '';
      list.forEach(it => addItem(it, { focus: false }));
    };

    // The number currently filled in automatically (cleared once the user types their own)
    let autoNo = null;
    const setAutoNumber = () => {
      autoNo = nextDocNo(formElements.docDate.value);
      formElements.docNo.value = autoNo;
    };

    const freshNumberAndDates = () => {
      const today = new Date();
      const validUntil = new Date();
      validUntil.setDate(today.getDate() + 30);
      formElements.docDate.value = toISODate(today);
      formElements.docValid.value = toISODate(validUntil);
      setAutoNumber();
    };

    const setDefaults = () => {
      fieldKeys.forEach(k => {
        const el = formElements[k];
        el.value = el.defaultValue;
      });
      freshNumberAndDates();
    };

    // Apply a saved state. `fromOtherTab` is used for quote → invoice: keep this tab's own number,
    // dates, terms and payment details.
    const setState = (state, { fromOtherTab = false } = {}) => {
      if (state.fields) {
        const skip = fromOtherTab ? ['docNo', 'docDate', 'docValid', 'terms', 'amountPaid'] : [];
        Object.entries(state.fields).forEach(([k, v]) => {
          if (!formElements[k] || skip.includes(k)) return;
          formElements[k].value = v;
        });
        // Older saved documents don't have these fields yet
        if (!fromOtherTab) {
          if (!('terms' in state.fields)) formElements.terms.value = formElements.terms.defaultValue;
          if (formElements.amountPaid && !('amountPaid' in state.fields)) formElements.amountPaid.value = '0';
          if (!('clientPhone' in state.fields)) formElements.clientPhone.value = '';
        }
      }
      if (state.items) setItems(state.items.length ? state.items : [{}]);
      renderAll();
    };

    addBtn.addEventListener('click', () => addItem());

    resetBtn.addEventListener('click', async () => {
      if (!(await askConfirm('Clear this form and start a new document?', 'Clear form'))) return;
      store.remove(draftKey);
      setDefaults();
      setItems([{}]);
    });

    printBtn.addEventListener('click', async () => {
      const problems = [];
      if (!formElements.clientName.value.trim() && !formElements.clientCompany.value.trim()) problems.push('client name');
      if (!formElements.projectName.value.trim()) problems.push('project name');
      if (!items.some(i => i.desc.trim())) problems.push('a service description');
      if (problems.length && !(await askConfirm(`Missing ${problems.join(', ')}. Print anyway?`, 'Print anyway'))) return;

      const originalTitle = document.title;
      // Characters that aren't allowed in file names become "-"
      const safeStr = (str) => (str || '').trim().replace(/[\/\\?%*:|"<>]/g, '-');

      // <Q|INV>-YYYYMMDD-###_<Company, or Client Name if no company>_<Project Name>_<Project Type>
      // Blank parts are left out rather than written as a placeholder.
      const parts = [
        safeStr(formElements.docNo.value),
        safeStr(formElements.clientCompany.value) || safeStr(formElements.clientName.value),
        safeStr(formElements.projectName.value),
        safeStr(formElements.projectType.value)
      ].filter(Boolean);

      // Browsers use document.title as the default PDF filename
      document.title = parts.join('_') || originalTitle;
      window.addEventListener('afterprint', () => { document.title = originalTitle; }, { once: true });

      saveToHistory();
      if (android) {
        // Android's print sheet (Save as PDF or a printer), named after the document
        android.print(document.title);
        setTimeout(() => { document.title = originalTitle; }, 1500);
        return;
      }
      window.print();
    });

    // --- WhatsApp: open a chat with the client, message pre-written ---
    const whatsappMessage = () => {
      const f = getFields();
      const t = computeTotals(f, items);
      const first = (f.clientName.trim().split(/\s+/)[0]) || 'there';
      const project = f.projectName.trim();
      const forProject = project ? ` for "${project}"` : '';
      const taxNote = t.taxRate > 0 ? ` (incl. ${f.taxName.trim() || 'Tax'} ${t.taxRate}%)` : '';
      const lines = [`Hi ${first},`, ''];

      if (!isInvoice) {
        lines.push(
          `Please find attached our quotation ${f.docNo.trim()}${forProject}.`,
          '',
          `Total: ${formatCurrency(t.total)}${taxNote}`,
          `Valid until: ${formatDate(f.docValid)}`,
          '',
          'Kindly confirm so we can get started.'
        );
      } else if (t.total > 0 && t.balance <= 0) {
        lines.push(
          `Thank you! We've received your payment of ${formatCurrency(t.paid)} against invoice ${f.docNo.trim()}${forProject}. It is now paid in full.`
        );
      } else {
        lines.push(`Please find attached invoice ${f.docNo.trim()}${forProject}.`, '');
        if (t.paid > 0) {
          lines.push(`Invoice total: ${formatCurrency(t.total)}${taxNote}`, `Received: ${formatCurrency(t.paid)}`, `Balance due: ${formatCurrency(t.balance)}`);
        } else {
          lines.push(`Amount due: ${formatCurrency(t.total)}${taxNote}`);
        }
        lines.push(
          `Due date: ${formatDate(f.docValid)}`,
          '',
          'Bank: HDFC Bank, A/c 50200096850029, IFSC HDFC0002454 (Langoor Media LLP)',
          '',
          'Kindly confirm once the payment is done.'
        );
      }
      lines.push('', 'Thanks,', 'Langoor Media');
      return lines.join('\n');
    };

    // 10-digit Indian numbers get +91; anything else is used as typed (digits only)
    const whatsappNumber = () => {
      let d = formElements.clientPhone.value.replace(/\D/g, '');
      if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
      if (d.length === 10) d = `91${d}`;
      return d;
    };

    whatsappBtn.addEventListener('click', () => {
      const number = whatsappNumber();
      const url = `https://wa.me/${number}?text=${encodeURIComponent(whatsappMessage())}`;
      saveToHistory();
      if (android) android.openExternal(url);
      else window.open(url, '_blank', 'noopener');
    });

    // --- History: save, list, reuse ---
    const saveToHistory = () => {
      const state = getState();
      const docNo = state.fields.docNo.trim() || '(no number)';
      markDocNoUsed(docNo);
      const existing = history.all().find(e => e.id === `${prefix}:${docNo}`);
      history.upsert({
        id: `${prefix}:${docNo}`,
        type: prefix,
        docNo,
        client: state.fields.clientCompany.trim() || state.fields.clientName.trim(),
        project: state.fields.projectName.trim(),
        total: lastTotal,
        savedAt: Date.now(),
        payments: existing?.payments || [],
        state
      });
    };

    const formHasContent = () =>
      ['clientName', 'clientCompany', 'projectName'].some(k => formElements[k].value.trim()) ||
      items.some(i => i.desc.trim());

    const loadEntry = async (entry, { asNew }) => {
      if (formHasContent() && !(await askConfirm(`Replace what's currently in the ${docLabel} form?`, 'Replace'))) return;
      setState(entry.state);
      if (asNew) {
        if (formElements.amountPaid) formElements.amountPaid.value = '0';
        freshNumberAndDates();
        renderAll();
      } else {
        autoNo = null;
      }
      panel.open = false;
    };

    // Record a payment against a saved invoice
    const recordPayment = async (entry) => {
      const info = paymentInfo(entry);
      const values = await askForm(
        `Record a payment for ${entry.docNo}\nInvoice total ${formatCurrency(info.total)} · received so far ${formatCurrency(info.paid)} · balance ${formatCurrency(info.balance)}`,
        [
          { name: 'amount', label: 'Amount received (₹)', type: 'number', value: info.balance, min: 0, step: '0.01' },
          { name: 'date', label: 'Received on', type: 'date', value: todayISO() }
        ],
        'Record payment'
      );
      if (!values) return;
      const amount = round2(parseFloat(values.amount) || 0);
      if (amount <= 0) { notify('Please enter an amount above zero.'); return; }

      const updated = JSON.parse(JSON.stringify(entry));
      updated.state.fields.amountPaid = String(round2(info.paid + amount));
      updated.payments = [...(updated.payments || []), { date: values.date || todayISO(), amount }];
      history.update(updated);

      // If this invoice is open in the form, update it there too
      if (formElements.docNo.value.trim() === entry.docNo) {
        formElements.amountPaid.value = updated.state.fields.amountPaid;
        renderAll();
      }
    };

    // Build the history panel at the top of the form
    const panel = document.createElement('details');
    panel.className = 'history-panel';
    panel.innerHTML = `
      <summary>Past ${docLabel}s <span class="history-count"></span></summary>
      <div class="history-body">
        ${isInvoice ? `
        <div class="history-summary"></div>
        <select class="history-filter" aria-label="Show">
          <option value="all">All invoices</option>
          <option value="outstanding">Outstanding (unpaid & part-paid)</option>
          <option value="overdue">Overdue</option>
          <option value="paid">Paid</option>
        </select>` : ''}
        <input type="search" class="history-search" placeholder="Search client, project or number…">
        <ul class="history-list"></ul>
        <div class="history-actions">
          <button type="button" class="btn-link" data-act="export">Export backup</button>
          <button type="button" class="btn-link" data-act="import">Import backup</button>
          <input type="file" accept="application/json,.json" hidden>
        </div>
        ${isInvoice ? '<button type="button" class="btn btn-secondary w-full history-accountant" data-act="accountant">Export for accountant (CSV)</button>' : ''}
      </div>
    `;
    const form = document.getElementById(`${prefix}-form`);
    form.insertBefore(panel, form.firstChild);

    const searchInput = panel.querySelector('.history-search');
    const filterSelect = panel.querySelector('.history-filter');
    const summaryEl = panel.querySelector('.history-summary');
    const listEl = panel.querySelector('.history-list');
    const countEl = panel.querySelector('.history-count');

    const STATUS_LABEL = { paid: 'Paid', part: 'Part-paid', unpaid: 'Unpaid' };

    const renderHistory = () => {
      const q = searchInput.value.trim().toLowerCase();
      const entries = history.all().filter(e => e.type === prefix);
      const infos = new Map(isInvoice ? entries.map(e => [e.id, paymentInfo(e)]) : []);

      if (isInvoice) {
        const open = entries.filter(e => infos.get(e.id).status !== 'paid');
        const outstanding = round2(open.reduce((s, e) => s + infos.get(e.id).balance, 0));
        const overdue = open.filter(e => infos.get(e.id).overdue);
        const overdueAmt = round2(overdue.reduce((s, e) => s + infos.get(e.id).balance, 0));
        countEl.textContent = entries.length ? `(${entries.length})` : '';
        if (open.length) countEl.textContent += ` · ${formatCurrency(outstanding)} due`;
        summaryEl.innerHTML = '';
        if (entries.length) {
          const a = document.createElement('div');
          a.className = 'summary-line';
          a.textContent = `Outstanding: ${formatCurrency(outstanding)} across ${open.length} invoice${open.length === 1 ? '' : 's'}`;
          summaryEl.appendChild(a);
          if (overdue.length) {
            const b = document.createElement('div');
            b.className = 'summary-line overdue';
            b.textContent = `Overdue: ${formatCurrency(overdueAmt)} across ${overdue.length} invoice${overdue.length === 1 ? '' : 's'}`;
            summaryEl.appendChild(b);
          }
        }
      } else {
        countEl.textContent = entries.length ? `(${entries.length})` : '';
      }

      const filter = filterSelect ? filterSelect.value : 'all';
      const shown = entries.filter(e => {
        if (q && ![e.docNo, e.client, e.project].some(s => (s || '').toLowerCase().includes(q))) return false;
        if (!isInvoice || filter === 'all') return true;
        const info = infos.get(e.id);
        if (filter === 'paid') return info.status === 'paid';
        if (filter === 'overdue') return info.overdue;
        return info.status !== 'paid';
      });

      listEl.innerHTML = '';
      if (!shown.length) {
        const li = document.createElement('li');
        li.className = 'history-empty';
        li.textContent = entries.length
          ? 'No matches.'
          : `Nothing yet. A ${docLabel} is saved here when you print it, send it on WhatsApp or click "Save to history".`;
        listEl.appendChild(li);
        return;
      }

      shown.forEach(entry => {
        const li = document.createElement('li');
        li.className = 'history-item';

        const info = document.createElement('div');
        info.className = 'history-info';
        const title = document.createElement('div');
        title.className = 'history-title';
        title.textContent = `${entry.client || 'Unnamed client'}${entry.project ? ' — ' + entry.project : ''}`;
        const meta = document.createElement('div');
        meta.className = 'history-meta';

        if (isInvoice) {
          const p = infos.get(entry.id);
          meta.textContent = `${entry.docNo} · ${formatDate(entry.state.fields.docDate)} · ${formatCurrency(p.total)}`;
          const pill = document.createElement('span');
          pill.className = `status-pill ${p.overdue ? 'overdue' : p.status}`;
          pill.textContent = p.overdue ? `Overdue · ${formatCurrency(p.balance)}` : p.status === 'part' ? `Part-paid · ${formatCurrency(p.balance)} due` : STATUS_LABEL[p.status];
          const pillRow = document.createElement('div');
          pillRow.className = 'history-status';
          pillRow.appendChild(pill);
          info.append(title, meta, pillRow);
        } else {
          meta.textContent = `${entry.docNo} · ${formatDate(entry.state.fields.docDate)} · ${formatCurrency(computeTotals(entry.state.fields, entry.state.items).total)}`;
          info.append(title, meta);
        }

        const btns = document.createElement('div');
        btns.className = 'history-btns';
        const mk = (label, cls, tip, fn) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = cls;
          b.textContent = label;
          b.title = tip;
          b.addEventListener('click', fn);
          btns.appendChild(b);
        };
        mk('Reuse', 'history-btn primary', 'Copy into a new document with a fresh number and today\'s date', () => loadEntry(entry, { asNew: true }));
        mk('Open', 'history-btn', 'Open exactly as saved (same number and dates), e.g. to reprint', () => loadEntry(entry, { asNew: false }));
        if (isInvoice && infos.get(entry.id).status !== 'paid') {
          mk('+ ₹', 'history-btn pay', 'Record a payment received for this invoice', () => recordPayment(entry));
        }
        mk('×', 'history-btn danger', 'Delete from history', async () => {
          if (await askConfirm(`Delete ${entry.docNo} from history?`, 'Delete')) history.remove(entry.id);
        });

        li.append(info, btns);
        listEl.appendChild(li);
      });
    };
    searchInput.addEventListener('input', renderHistory);
    filterSelect?.addEventListener('change', renderHistory);
    history.listeners.push(renderHistory);

    // Backup file export / import
    const fileInput = panel.querySelector('input[type="file"]');
    panel.querySelector('[data-act="export"]').addEventListener('click', downloadBackup);
    panel.querySelector('[data-act="import"]').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const incoming = JSON.parse(await file.text());
        if (!Array.isArray(incoming)) throw new Error('not a list');
        const valid = incoming.filter(e => e && e.id && e.type && e.state && e.state.fields && Array.isArray(e.state.items));
        const byId = new Map(history.all().map(e => [e.id, e]));
        valid.forEach(e => {
          const cur = byId.get(e.id);
          if (!cur || (e.savedAt || 0) > (cur.savedAt || 0)) byId.set(e.id, e);
        });
        history.save([...byId.values()].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)));
        notify(`Imported ${valid.length} entr${valid.length === 1 ? 'y' : 'ies'}.`);
      } catch {
        notify('That file is not a valid history backup.');
      }
    });

    // --- Export for accountant: invoices in a date range as a spreadsheet (CSV) ---
    panel.querySelector('[data-act="accountant"]')?.addEventListener('click', async () => {
      const now = new Date();
      const firstPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastPrev = new Date(now.getFullYear(), now.getMonth(), 0);
      const range = await askForm(
        'Export invoices for your accountant\nAll invoices dated within this range (inclusive) go into a spreadsheet file that opens in Excel or Google Sheets.',
        [
          { name: 'from', label: 'From', type: 'date', value: toISODate(firstPrev) },
          { name: 'to', label: 'To', type: 'date', value: toISODate(lastPrev) }
        ],
        'Download CSV'
      );
      if (!range) return;
      const { from, to } = range;
      if (!from || !to || from > to) { notify('Please pick a valid date range.'); return; }

      const rows = history.all()
        .filter(e => e.type === 'invoice' && e.state.fields.docDate >= from && e.state.fields.docDate <= to)
        .sort((a, b) => (a.state.fields.docDate + a.docNo).localeCompare(b.state.fields.docDate + b.docNo));
      if (!rows.length) { notify(`No saved invoices dated between ${formatDate(from)} and ${formatDate(to)}.`); return; }

      const csvCell = (v) => {
        const s = String(v ?? '');
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const money = (n) => n.toFixed(2);
      const header = ['Invoice No', 'Invoice Date', 'Due Date', 'Client Name', 'Company', 'Client GSTIN', 'Client Email',
        'Project', 'Project Type', 'Subtotal', 'Discount', 'Taxable Value', 'Tax', 'Tax Rate %', 'Tax Amount',
        'Invoice Total', 'Amount Received', 'Balance Due', 'Status', 'Last Payment Date'];
      const sums = { subtotal: 0, discount: 0, taxable: 0, tax: 0, total: 0, paid: 0, balance: 0 };
      const lines = rows.map(e => {
        const f = e.state.fields;
        const p = paymentInfo(e);
        Object.keys(sums).forEach(k => { sums[k] = round2(sums[k] + p[k]); });
        const lastPay = (e.payments || []).map(x => x.date).sort().pop() || '';
        return [e.docNo, f.docDate, f.docValid, f.clientName, f.clientCompany, (f.clientGstin || '').toUpperCase(), f.clientEmail,
          f.projectName, f.projectType, money(p.subtotal), money(p.discount), money(p.taxable), f.taxName, p.taxRate, money(p.tax),
          money(p.total), money(p.paid), money(p.balance), p.overdue ? 'Overdue' : STATUS_LABEL[p.status], lastPay];
      });
      lines.push(['TOTAL', '', '', '', '', '', '', '', '', money(sums.subtotal), money(sums.discount), money(sums.taxable), '', '',
        money(sums.tax), money(sums.total), money(sums.paid), money(sums.balance), '', '']);

      // The leading BOM makes Excel read UTF-8 text (e.g. non-English client names) correctly
      const csv = '﻿' + [header, ...lines].map(r => r.map(csvCell).join(',')).join('\r\n');
      downloadFile(`langoor-invoices_${from}_to_${to}.csv`, csv, 'text/csv;charset=utf-8');
    });

    // "Save to history" button next to Print
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn-secondary w-full';
    saveBtn.textContent = 'Save to history';
    saveBtn.addEventListener('click', () => {
      saveToHistory();
      saveBtn.textContent = 'Saved ✓';
      setTimeout(() => { saveBtn.textContent = 'Save to history'; }, 1500);
    });
    whatsappBtn.parentNode.insertBefore(saveBtn, whatsappBtn);

    // Client autocomplete: picking a known client fills in their other details
    formElements.clientName.setAttribute('list', 'lm-clients');
    formElements.clientCompany.setAttribute('list', 'lm-companies');
    [['clientName', formElements.clientName], ['clientCompany', formElements.clientCompany]].forEach(([field, el]) => {
      el.setAttribute('autocomplete', 'off');
      el.addEventListener('change', () => {
        const known = findClient(field, el.value);
        if (!known) return;
        ['clientName', 'clientCompany', 'clientEmail', 'clientAddress', 'clientGstin', 'clientPhone'].forEach(k => {
          if (formElements[k] && k !== field && known[k]) formElements[k].value = known[k];
        });
        renderAll();
      });
    });

    renderHistory();

    // --- Initial state: restore draft if there is one ---
    setDefaults();
    const draft = store.get(draftKey);
    if (draft && draft.fields) {
      setState(draft);
      // Keep auto-numbering on if the draft's number is still the next free one for its date
      if (draft.fields.docNo === nextDocNo(draft.fields.docDate)) autoNo = draft.fields.docNo;
      updateNumberWarning();
    } else {
      setItems([{}]);
    }

    return { getState, setState };
  };

  // --- Dynamic Scaling for Mobile ---
  const adjustScale = () => {
    const screenWidth = window.innerWidth;
    document.querySelectorAll('.tab-content.active .preview-pane').forEach(pane => {
      const doc = pane.querySelector('.quote-document');
      if (!doc) return;

      doc.style.transform = 'none';
      pane.style.height = 'auto';

      if (screenWidth <= 850) {
        // 800px doc width, minus 32px padding for the screen
        const scale = Math.min(1, (screenWidth - 32) / 800);
        doc.style.transformOrigin = 'top center';
        doc.style.transform = `scale(${scale})`;
        // Shrink the wrapper to the scaled height to remove blank space
        pane.style.height = `${doc.offsetHeight * scale + 32}px`;
      }
    });
  };

  const quote = setupGenerator('quote');
  const invoice = setupGenerator('invoice');
  refreshDatalists();

  // --- Quote → Invoice ---
  const convertBtn = document.getElementById('quote-to-invoice-btn');
  if (convertBtn) {
    convertBtn.addEventListener('click', async () => {
      if (!(await askConfirm('Copy this quotation\'s client, project, services and tax into the Invoice tab? Current invoice details will be replaced.', 'Convert'))) return;
      invoice.setState(quote.getState(), { fromOtherTab: true });
      activateTab('tab-invoice');
    });
  }

  window.addEventListener('resize', adjustScale);
  window.addEventListener('load', adjustScale);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(adjustScale);
  setTimeout(adjustScale, 100);
});
