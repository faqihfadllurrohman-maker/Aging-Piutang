/**
 * Sistem Manajemen Invoice & Piutang
 * Main Application Logic
 */

(function () {
  'use strict';

  // Constants & Storage Keys
  const STORAGE_KEY = 'INVOICE_BILLING_APP_DATA_V2';
  const ADMIN_STORAGE_KEY = 'INVOICE_APP_ADMIN_MODE';
  const FIREBASE_CONFIG_KEY = 'INVOICE_APP_FIREBASE_CONFIG';

  // Application State
  const state = {
    invoices: [],
    filteredInvoices: [],
    selectedIds: new Set(),
    adminMode: true,
    currentPage: 1,
    pageSize: 25,
    sortColumn: 'id',
    sortDirection: 'asc',
    chartsVisible: true,
    firebaseApp: null,
    firestoreDb: null,
    firebaseUnsubscribe: null,
    isCloudConnected: false,
    cloudInvoicesCount: 0,
    filters: {
      quick: 'all',
      search: '',
      portofolio: '',
      jatuhTempo: '',
      statusBayar: '',
      metodeBayar: ''
    },
    charts: {
      jatuhTempo: null,
      pembayaran: null,
      metodeBayar: null,
      portofolio: null
    },
    importPendingData: null,
    deleteTargetId: null
  };

  // Utilities: Currency Formatter
  function formatRupiah(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) return 'Rp 0';
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  }

  // Utilities: Toast Notification
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    const bgColors = {
      success: 'bg-emerald-600 text-white',
      error: 'bg-rose-600 text-white',
      warning: 'bg-amber-600 text-white',
      info: 'bg-slate-900 text-white'
    };

    const icons = {
      success: 'check-circle-2',
      error: 'alert-circle',
      warning: 'alert-triangle',
      info: 'info'
    };

    toast.className = `toast-item flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl text-xs font-semibold ${bgColors[type] || bgColors.info} pointer-events-auto transition-all`;
    toast.innerHTML = `
      <i data-lucide="${icons[type] || 'info'}" class="w-4 h-4"></i>
      <span>${message}</span>
    `;

    container.appendChild(toast);
    if (window.lucide) lucide.createIcons({ root: toast });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // Sanitize Unicode direction markers
  function sanitizeText(str) {
    if (!str) return '';
    return String(str).replace(/[\u200E\u200F\u202A-\u202E]/g, '').trim();
  }

  // Calculate Due Date Status (> 30 days -> "Jatuh Tempo", <= 30 -> "Belum Jatuh Tempo")
  function computeStatusJatuhTempo(dayVal) {
    const d = parseInt(dayVal, 10);
    if (isNaN(d)) return 'Belum Jatuh Tempo';
    return d > 30 ? 'Jatuh Tempo' : 'Belum Jatuh Tempo';
  }

  // Initialize Data
  function initData() {
    const savedAdmin = localStorage.getItem(ADMIN_STORAGE_KEY);
    if (savedAdmin !== null) {
      state.adminMode = savedAdmin === 'true';
    }

    const savedData = localStorage.getItem(STORAGE_KEY);
    if (savedData) {
      try {
        state.invoices = JSON.parse(savedData);
      } catch (e) {
        console.error('Failed to parse saved data, loading defaults', e);
        loadDefaultDataset();
      }
    } else {
      loadDefaultDataset();
    }

    // Ensure all required fields exist for each invoice
    normalizeAllInvoices();
  }

  function loadDefaultDataset() {
    if (window.INITIAL_INVOICE_DATA && Array.isArray(window.INITIAL_INVOICE_DATA)) {
      state.invoices = JSON.parse(JSON.stringify(window.INITIAL_INVOICE_DATA));
    } else {
      state.invoices = [];
    }
    saveDataToStorage();
  }

  function normalizeAllInvoices() {
    state.invoices = state.invoices.map((inv, idx) => {
      const day = parseInt(inv.dayInvoice, 10) || 0;
      const statusJT = computeStatusJatuhTempo(day);
      const saldo = parseFloat(inv.saldoKonversi) || 0;
      const statusBayar = inv.statusPembayaran || 'Belum Bayar';
      
      let ket = inv.keterangan;
      if (!ket || ket === 'Belum Bayar' || ket === 'Sudah Bayar') {
        ket = statusBayar === 'Sudah Bayar' ? 'Sudah Bayar' : 'Belum Bayar';
      }

      return {
        id: inv.id || (idx + 1),
        noInvoice: sanitizeText(inv.noInvoice),
        tanggal: sanitizeText(inv.tanggal),
        customer: sanitizeText(inv.customer),
        pelanggan: sanitizeText(inv.pelanggan),
        portofolio: sanitizeText(inv.portofolio) || 'Lainnya',
        kegiatan: sanitizeText(inv.kegiatan),
        orderNumber: sanitizeText(inv.orderNumber),
        saldoKonversi: saldo,
        dayInvoice: day,
        statusJatuhTempo: statusJT,
        pembayaranVia: inv.pembayaranVia || '',
        statusPembayaran: statusBayar,
        nominalPelunasan: parseFloat(inv.nominalPelunasan) || (statusBayar === 'Sudah Bayar' ? saldo : 0),
        tanggalPelunasan: inv.tanggalPelunasan || '',
        keterangan: ket
      };
    });
  }

  function saveDataToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.invoices));
    } catch (e) {
      console.warn('Storage quota exceeded or error saving:', e);
      showToast('Peringatan: Gagal menyimpan ke localStorage browser', 'warning');
    }
  }

  // ==========================================
  // CLOUD DATABASE REAL-TIME ENGINE (FIREBASE)
  // ==========================================

  function initCloudDatabase() {
    const savedConfig = localStorage.getItem(FIREBASE_CONFIG_KEY);
    updateCloudUI();

    if (savedConfig) {
      try {
        const configObj = JSON.parse(savedConfig);
        connectFirebase(configObj, true);
      } catch (e) {
        console.warn('Saved Firebase config invalid:', e);
      }
    }
  }

  function updateCloudUI() {
    const statusDot = document.getElementById('cloudStatusDot');
    const statusText = document.getElementById('cloudStatusText');
    const liveBadge = document.getElementById('cloudLiveBadge');
    const statusIcon = document.getElementById('cloudStatusIcon');

    const modalDot = document.getElementById('cloudModalStatusDot');
    const modalTitle = document.getElementById('cloudModalStatusTitle');
    const modalDesc = document.getElementById('cloudModalStatusDesc');
    const modalTag = document.getElementById('cloudLiveTag');
    const btnDisconnect = document.getElementById('btnDisconnectCloud');
    const inputConfig = document.getElementById('inputFirebaseConfig');

    const savedConfig = localStorage.getItem(FIREBASE_CONFIG_KEY);
    if (inputConfig && savedConfig && !inputConfig.value) {
      try {
        inputConfig.value = JSON.stringify(JSON.parse(savedConfig), null, 2);
      } catch (e) {
        inputConfig.value = savedConfig;
      }
    }

    if (state.isCloudConnected) {
      if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse';
      if (statusText) statusText.textContent = 'Cloud Terhubung';
      if (liveBadge) liveBadge.classList.remove('hidden');
      if (statusIcon) statusIcon.setAttribute('data-lucide', 'cloud-lightning');

      if (modalDot) modalDot.className = 'w-3.5 h-3.5 rounded-full bg-emerald-500';
      if (modalTitle) modalTitle.textContent = 'Status: Terhubung ke Cloud Firestore (Real-Time)';
      if (modalDesc) modalDesc.textContent = state.cloudInvoicesCount > 0
        ? `Sinkronisasi real-time aktif (${state.cloudInvoicesCount} invoice tersimpan di cloud)`
        : 'Terhubung. Database cloud masih kosong (klik Upload di bawah).';

      if (modalTag) modalTag.classList.remove('hidden');
      if (btnDisconnect) btnDisconnect.classList.remove('hidden');
    } else {
      if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-slate-400';
      if (statusText) statusText.textContent = 'Cloud Database';
      if (liveBadge) liveBadge.classList.add('hidden');
      if (statusIcon) statusIcon.setAttribute('data-lucide', 'cloud');

      if (modalDot) modalDot.className = 'w-3.5 h-3.5 rounded-full bg-slate-400';
      if (modalTitle) modalTitle.textContent = 'Status: Belum Terhubung ke Cloud';
      if (modalDesc) modalDesc.textContent = 'Saat ini berjalan di database lokal browser';

      if (modalTag) modalTag.classList.add('hidden');
      if (btnDisconnect) btnDisconnect.classList.add('hidden');
      document.getElementById('cloudSeedContainer')?.classList.add('hidden');
    }

    if (window.lucide) {
      const btn = document.getElementById('btnOpenCloudModal');
      if (btn) lucide.createIcons({ root: btn });
    }
  }

  function parseFirebaseConfigInput(rawText) {
    if (!rawText) return null;
    let text = rawText.trim();

    // If pasted whole JavaScript block like "const firebaseConfig = { ... };"
    if (text.includes('{') && text.includes('}')) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        text = match[0];
      }
      // Convert JS object keys to valid JSON if unquoted
      try {
        return JSON.parse(text);
      } catch (e) {
        // Fallback: evaluate object keys
        try {
          const sanitized = text
            .replace(/([a-zA-Z0-9_]+)\s*:/g, '"$1":')
            .replace(/'/g, '"')
            .replace(/,\s*}/g, '}');
          return JSON.parse(sanitized);
        } catch (e2) {
          // Fallback Function constructor
          return (new Function('return ' + text))();
        }
      }
    }
    return null;
  }

  function connectFirebase(configObj, isInitial = false) {
    if (!window.firebase) {
      console.warn('Firebase SDK belum termuat.');
      return;
    }

    try {
      if (firebase.apps.length > 0) {
        firebase.app().delete();
      }

      state.firebaseApp = firebase.initializeApp(configObj);
      state.firestoreDb = firebase.firestore();

      // Enable offline persistence if available
      try {
        state.firestoreDb.enablePersistence({ synchronizeTabs: true }).catch(() => {});
      } catch (pe) {}

      // Setup Real-time listener on collection 'invoices'
      if (state.firebaseUnsubscribe) state.firebaseUnsubscribe();

      state.firebaseUnsubscribe = state.firestoreDb.collection('invoices')
        .onSnapshot((snapshot) => {
          state.isCloudConnected = true;
          state.cloudInvoicesCount = snapshot.size;
          updateCloudUI();

          if (snapshot.empty) {
            // Collection is empty, show seed prompt
            const seedContainer = document.getElementById('cloudSeedContainer');
            if (seedContainer) seedContainer.classList.remove('hidden');
            return;
          }

          const seedContainer = document.getElementById('cloudSeedContainer');
          if (seedContainer) seedContainer.classList.add('hidden');

          const cloudData = [];
          snapshot.forEach(doc => {
            const d = doc.data();
            d._docId = doc.id;
            cloudData.push(d);
          });

          // Sort by original id
          cloudData.sort((a, b) => (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0));

          state.invoices = cloudData;
          normalizeAllInvoices();
          saveDataToStorage();
          populatePortofolioDropdown();
          applyFilters();

          if (!isInitial) {
            showToast(`Data tersinkronisasi langsung dari Cloud (${cloudData.length} invoice)!`, 'info');
          }
        }, (err) => {
          console.error('Firestore listener error:', err);
          state.isCloudConnected = false;
          updateCloudUI();
          showToast('Koneksi Cloud Firestore terputus: ' + err.message, 'error');
        });

      state.isCloudConnected = true;
      updateCloudUI();
      if (!isInitial) {
        showToast('Berhasil terhubung ke Cloud Firebase Database!', 'success');
      }

    } catch (err) {
      console.error('Firebase connect error:', err);
      state.isCloudConnected = false;
      updateCloudUI();
      showToast('Gagal menghubungkan ke Firebase: ' + err.message, 'error');
    }
  }

  function disconnectCloud() {
    if (state.firebaseUnsubscribe) {
      state.firebaseUnsubscribe();
      state.firebaseUnsubscribe = null;
    }
    if (state.firebaseApp) {
      try { state.firebaseApp.delete(); } catch (e) {}
      state.firebaseApp = null;
    }
    state.firestoreDb = null;
    state.isCloudConnected = false;
    state.cloudInvoicesCount = 0;
    localStorage.removeItem(FIREBASE_CONFIG_KEY);

    updateCloudUI();
    showToast('Koneksi Cloud Database diputuskan. Beralih ke data lokal.', 'info');
  }

  function seedCloudDatabase() {
    if (!state.firestoreDb) {
      showToast('Belum terhubung ke Cloud Firestore', 'error');
      return;
    }

    const invoicesToUpload = state.invoices.length ? state.invoices : (window.INITIAL_INVOICE_DATA || []);
    const total = invoicesToUpload.length;

    const progressContainer = document.getElementById('seedProgressBarContainer');
    const progressBar = document.getElementById('seedProgressBar');
    const progressText = document.getElementById('seedProgressText');
    const btnSeed = document.getElementById('btnSeedCloudDatabase');

    if (progressContainer) progressContainer.classList.remove('hidden');
    if (btnSeed) btnSeed.setAttribute('disabled', 'true');

    let currentIdx = 0;
    const batchSize = 100;

    function uploadBatch() {
      if (currentIdx >= total) {
        if (progressText) progressText.textContent = `Selesai! Seluruh ${total} invoice telah diunggah ke Cloud.`;
        showToast(`Sukses! ${total} invoice berhasil diunggah ke Cloud Firestore.`, 'success');
        if (btnSeed) btnSeed.removeAttribute('disabled');
        setTimeout(() => {
          document.getElementById('cloudSeedContainer')?.classList.add('hidden');
          closeAllModals();
        }, 1500);
        return;
      }

      const batch = state.firestoreDb.batch();
      const chunk = invoicesToUpload.slice(currentIdx, currentIdx + batchSize);

      chunk.forEach(item => {
        const docId = String(item.noInvoice || item.id);
        const docRef = state.firestoreDb.collection('invoices').doc(docId);
        const cleanObj = Object.assign({}, item);
        delete cleanObj._docId;
        batch.set(docRef, cleanObj);
      });

      batch.commit().then(() => {
        currentIdx += chunk.length;
        const pct = Math.round((currentIdx / total) * 100);
        if (progressBar) progressBar.style.width = pct + '%';
        if (progressText) progressText.textContent = `Mengunggah: ${currentIdx} / ${total} invoice (${pct}%)...`;
        uploadBatch();
      }).catch(err => {
        console.error('Batch upload error:', err);
        showToast('Gagal upload batch: ' + err.message, 'error');
        if (btnSeed) btnSeed.removeAttribute('disabled');
      });
    }

    uploadBatch();
  }

  // Push individual / batch changes to Cloud Firestore
  function syncToCloud(action, data) {
    if (!state.firestoreDb) return;

    try {
      if (action === 'save' || action === 'update') {
        const docId = String(data.noInvoice || data.id);
        const cleanObj = Object.assign({}, data);
        delete cleanObj._docId;
        state.firestoreDb.collection('invoices').doc(docId).set(cleanObj, { merge: true })
          .catch(err => console.error('Cloud save error:', err));
      } else if (action === 'delete') {
        const docId = String(data.noInvoice || data.id);
        state.firestoreDb.collection('invoices').doc(docId).delete()
          .catch(err => console.error('Cloud delete error:', err));
      } else if (action === 'batch') {
        const batch = state.firestoreDb.batch();
        data.forEach(item => {
          const docId = String(item.noInvoice || item.id);
          const cleanObj = Object.assign({}, item);
          delete cleanObj._docId;
          batch.set(state.firestoreDb.collection('invoices').doc(docId), cleanObj, { merge: true });
        });
        batch.commit().catch(err => console.error('Cloud batch error:', err));
      }
    } catch (e) {
      console.error('syncToCloud exception:', e);
    }
  }

  // Populate dynamic dropdowns (like Portfolio)
  function populatePortofolioDropdown() {
    const select = document.getElementById('filterPortofolio');
    const datalist = document.getElementById('portofolioDatalist');
    if (!select) return;

    const currentVal = select.value;
    const portfolios = Array.from(new Set(state.invoices.map(i => i.portofolio).filter(Boolean))).sort();

    select.innerHTML = '<option value="">Semua Portofolio</option>';
    if (datalist) datalist.innerHTML = '';

    portfolios.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      select.appendChild(opt);

      if (datalist) {
        const dOpt = document.createElement('option');
        dOpt.value = p;
        datalist.appendChild(dOpt);
      }
    });

    select.value = currentVal;
  }

  // Filter & Search Engine
  function applyFilters() {
    let result = [...state.invoices];

    // 1. Quick Preset Filter
    if (state.filters.quick === 'jatuh-tempo') {
      result = result.filter(i => i.statusJatuhTempo === 'Jatuh Tempo');
    } else if (state.filters.quick === 'belum-jatuh-tempo') {
      result = result.filter(i => i.statusJatuhTempo === 'Belum Jatuh Tempo');
    } else if (state.filters.quick === 'belum-bayar') {
      result = result.filter(i => i.statusPembayaran === 'Belum Bayar');
    } else if (state.filters.quick === 'sudah-bayar') {
      result = result.filter(i => i.statusPembayaran === 'Sudah Bayar');
    }

    // 2. Global Search Query
    if (state.filters.search) {
      const q = state.filters.search.toLowerCase();
      result = result.filter(i => 
        (i.noInvoice && i.noInvoice.toLowerCase().includes(q)) ||
        (i.customer && i.customer.toLowerCase().includes(q)) ||
        (i.pelanggan && i.pelanggan.toLowerCase().includes(q)) ||
        (i.orderNumber && i.orderNumber.toLowerCase().includes(q)) ||
        (i.kegiatan && i.kegiatan.toLowerCase().includes(q)) ||
        (i.portofolio && i.portofolio.toLowerCase().includes(q)) ||
        (i.keterangan && i.keterangan.toLowerCase().includes(q))
      );
    }

    // 3. Portofolio Filter
    if (state.filters.portofolio) {
      result = result.filter(i => i.portofolio === state.filters.portofolio);
    }

    // 4. Status Jatuh Tempo
    if (state.filters.jatuhTempo) {
      result = result.filter(i => i.statusJatuhTempo === state.filters.jatuhTempo);
    }

    // 5. Status Pembayaran
    if (state.filters.statusBayar) {
      result = result.filter(i => i.statusPembayaran === state.filters.statusBayar);
    }

    // 6. Metode Pembayaran (BNI, UMP, MVA, NONE)
    if (state.filters.metodeBayar) {
      if (state.filters.metodeBayar === 'NONE') {
        result = result.filter(i => !i.pembayaranVia);
      } else {
        result = result.filter(i => i.pembayaranVia === state.filters.metodeBayar);
      }
    }

    // Sorting
    result.sort((a, b) => {
      let valA = a[state.sortColumn];
      let valB = b[state.sortColumn];

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return state.sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return state.sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    state.filteredInvoices = result;

    // Reset pagination to page 1 if current page out of bounds
    const maxPage = state.pageSize === 'all' ? 1 : Math.ceil(result.length / state.pageSize) || 1;
    if (state.currentPage > maxPage) {
      state.currentPage = 1;
    }

    // Update UI elements
    updateKPICards();
    renderTable();
    renderPagination();
    updateCharts();
    updateBatchBar();
  }

  // Update KPI Cards and Metrics
  function updateKPICards() {
    const totalCount = state.invoices.length;
    const totalAmount = state.invoices.reduce((sum, i) => sum + (i.saldoKonversi || 0), 0);

    const jtInvoices = state.invoices.filter(i => i.statusJatuhTempo === 'Jatuh Tempo');
    const jtCount = jtInvoices.length;
    const jtAmount = jtInvoices.reduce((sum, i) => sum + (i.saldoKonversi || 0), 0);

    const bjtInvoices = state.invoices.filter(i => i.statusJatuhTempo === 'Belum Jatuh Tempo');
    const bjtCount = bjtInvoices.length;
    const bjtAmount = bjtInvoices.reduce((sum, i) => sum + (i.saldoKonversi || 0), 0);

    const sbInvoices = state.invoices.filter(i => i.statusPembayaran === 'Sudah Bayar');
    const sbCount = sbInvoices.length;
    const sbAmount = sbInvoices.reduce((sum, i) => sum + (i.nominalPelunasan || i.saldoKonversi || 0), 0);

    const bbInvoices = state.invoices.filter(i => i.statusPembayaran === 'Belum Bayar');
    const bbCount = bbInvoices.length;
    const bbAmount = bbInvoices.reduce((sum, i) => sum + (i.saldoKonversi || 0), 0);

    const bniCount = state.invoices.filter(i => i.pembayaranVia === 'BNI').length;
    const umpCount = state.invoices.filter(i => i.pembayaranVia === 'UMP').length;
    const mvaCount = state.invoices.filter(i => i.pembayaranVia === 'MVA').length;

    // Set values in DOM
    document.getElementById('kpiTotalAmount').textContent = formatRupiah(totalAmount);
    document.getElementById('kpiTotalCount').textContent = totalCount.toLocaleString();

    document.getElementById('kpiJatuhTempoAmount').textContent = formatRupiah(jtAmount);
    document.getElementById('kpiJatuhTempoCount').textContent = jtCount.toLocaleString();

    document.getElementById('kpiBelumJatuhTempoAmount').textContent = formatRupiah(bjtAmount);
    document.getElementById('kpiBelumJatuhTempoCount').textContent = bjtCount.toLocaleString();

    document.getElementById('kpiSudahBayarAmount').textContent = formatRupiah(sbAmount);
    document.getElementById('kpiSudahBayarCount').textContent = sbCount.toLocaleString();

    document.getElementById('kpiBelumBayarAmount').textContent = formatRupiah(bbAmount);
    document.getElementById('kpiBelumBayarCount').textContent = bbCount.toLocaleString();

    document.getElementById('kpiBniCount').textContent = bniCount;
    document.getElementById('kpiUmpCount').textContent = umpCount;
    document.getElementById('kpiMvaCount').textContent = mvaCount;

    // Update filter counts
    document.querySelectorAll('.badge-total-count').forEach(el => el.textContent = totalCount);
    document.getElementById('filteredRowsCount').textContent = state.filteredInvoices.length.toLocaleString();
    document.getElementById('totalRowsCount').textContent = totalCount.toLocaleString();

    // Print header info
    const printTotalRows = document.getElementById('printTotalRows');
    const printTotalAmount = document.getElementById('printTotalAmount');
    const printDate = document.getElementById('printDate');
    if (printTotalRows) printTotalRows.textContent = state.filteredInvoices.length.toLocaleString();
    if (printTotalAmount) printTotalAmount.textContent = formatRupiah(state.filteredInvoices.reduce((s, i) => s + (i.saldoKonversi || 0), 0));
    if (printDate) printDate.textContent = new Date().toLocaleDateString('id-ID', { dateStyle: 'full' });
  }

  // Render Table Rows
  function renderTable() {
    const tbody = document.getElementById('invoiceTableBody');
    if (!tbody) return;

    if (state.filteredInvoices.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="18" class="text-center py-12 text-slate-400">
            <div class="flex flex-col items-center justify-center gap-2">
              <i data-lucide="inbox" class="w-8 h-8 text-slate-300"></i>
              <p class="font-medium text-sm text-slate-600">Tidak ada data invoice yang sesuai</p>
              <p class="text-xs text-slate-400">Coba ubah kata kunci pencarian atau reset filter</p>
            </div>
          </td>
        </tr>
      `;
      if (window.lucide) lucide.createIcons({ root: tbody });
      return;
    }

    // Determine slice for pagination
    let startIndex = 0;
    let endIndex = state.filteredInvoices.length;

    if (state.pageSize !== 'all') {
      const size = parseInt(state.pageSize, 10);
      startIndex = (state.currentPage - 1) * size;
      endIndex = Math.min(startIndex + size, state.filteredInvoices.length);
    }

    const currentRows = state.filteredInvoices.slice(startIndex, endIndex);

    const rowsHtml = currentRows.map((inv, idx) => {
      const isSelected = state.selectedIds.has(inv.id);
      const isJatuhTempo = inv.statusJatuhTempo === 'Jatuh Tempo';
      const isSudahBayar = inv.statusPembayaran === 'Sudah Bayar';

      // Badge classes
      const badgeJTClass = isJatuhTempo ? 'badge-jatuh-tempo' : 'badge-belum-jatuh-tempo';
      const badgeBayarClass = isSudahBayar ? 'badge-sudah-bayar' : 'badge-belum-bayar';
      
      let badgeMethodClass = 'badge-default';
      if (inv.pembayaranVia === 'BNI') badgeMethodClass = 'badge-bni';
      else if (inv.pembayaranVia === 'UMP') badgeMethodClass = 'badge-ump';
      else if (inv.pembayaranVia === 'MVA') badgeMethodClass = 'badge-mva';

      const rowNo = startIndex + idx + 1;

      return `
        <tr class="${isSelected ? 'selected' : ''}" data-id="${inv.id}">
          
          <!-- Checkbox -->
          <td class="sticky-col-left text-center px-2">
            <input type="checkbox" class="row-checkbox rounded border-slate-300 text-blue-600 focus:ring-blue-500" data-id="${inv.id}" ${isSelected ? 'checked' : ''}>
          </td>

          <!-- No -->
          <td class="text-center font-mono text-[11px] text-slate-400">${rowNo}</td>

          <!-- No Invoice -->
          <td class="font-semibold text-slate-900 whitespace-nowrap">
            <span class="hover:text-blue-600 cursor-pointer btn-quick-view font-mono text-xs" data-id="${inv.id}">
              ${escapeHtml(inv.noInvoice || '-')}
            </span>
          </td>

          <!-- Tanggal -->
          <td class="whitespace-nowrap text-slate-600 text-xs">${escapeHtml(inv.tanggal || '-')}</td>

          <!-- Customer -->
          <td class="font-medium text-slate-800 max-w-xs truncate" title="${escapeHtml(inv.customer)}">
            ${escapeHtml(inv.customer || '-')}
          </td>

          <!-- Pelanggan ID -->
          <td class="font-mono text-slate-500 text-xs">${escapeHtml(inv.pelanggan || '-')}</td>

          <!-- Portofolio -->
          <td class="whitespace-nowrap">
            <span class="inline-block px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-700 font-medium">
              ${escapeHtml(inv.portofolio || '-')}
            </span>
          </td>

          <!-- Kegiatan -->
          <td class="max-w-xs truncate text-slate-600 text-xs" title="${escapeHtml(inv.kegiatan)}">
            ${escapeHtml(inv.kegiatan || '-')}
          </td>

          <!-- Order Number -->
          <td class="font-mono text-slate-500 text-xs whitespace-nowrap">${escapeHtml(inv.orderNumber || '-')}</td>

          <!-- Saldo Konversi -->
          <td class="text-right font-bold text-slate-900 whitespace-nowrap">
            ${formatRupiah(inv.saldoKonversi)}
          </td>

          <!-- Day (Invoice) -->
          <td class="text-center font-semibold ${isJatuhTempo ? 'text-rose-600' : 'text-emerald-600'}">
            ${inv.dayInvoice}
          </td>

          <!-- Status Jatuh Tempo (>30 Hari / <=30 Hari) -->
          <td class="text-center whitespace-nowrap">
            <span class="badge ${badgeJTClass}">
              <i data-lucide="${isJatuhTempo ? 'alert-triangle' : 'check-circle'}" class="w-3 h-3"></i>
              ${inv.statusJatuhTempo}
            </span>
          </td>

          <!-- Pembayaran Via (BNI / UMP / MVA) -->
          <td class="text-center whitespace-nowrap">
            ${inv.pembayaranVia ? `
              <span class="badge ${badgeMethodClass}">
                ${escapeHtml(inv.pembayaranVia)}
              </span>
            ` : `<span class="text-slate-300 text-[11px]">-</span>`}
          </td>

          <!-- Status Pembayaran (Sudah Bayar / Belum Bayar) -->
          <td class="text-center whitespace-nowrap">
            <span class="badge ${badgeBayarClass}">
              <i data-lucide="${isSudahBayar ? 'check' : 'clock'}" class="w-3 h-3"></i>
              ${inv.statusPembayaran}
            </span>
          </td>

          <!-- Nominal Pelunasan -->
          <td class="text-right font-semibold whitespace-nowrap ${isSudahBayar ? 'text-emerald-700' : 'text-slate-400'}">
            ${inv.nominalPelunasan > 0 ? formatRupiah(inv.nominalPelunasan) : '-'}
          </td>

          <!-- Tanggal Pelunasan -->
          <td class="text-center whitespace-nowrap text-slate-600 text-xs">
            ${escapeHtml(inv.tanggalPelunasan || '-')}
          </td>

          <!-- Keterangan -->
          <td class="text-slate-600 text-xs max-w-xs truncate" title="${escapeHtml(inv.keterangan || '')}">
            ${escapeHtml(inv.keterangan || '-')}
          </td>

          <!-- Actions -->
          <td class="sticky-col-right text-center whitespace-nowrap no-print">
            <div class="flex items-center justify-center gap-1">
              
              <!-- Quick Pay Button (Visible if Belum Bayar) -->
              ${!isSudahBayar ? `
                <button class="btn-quick-pay p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 transition-colors" data-id="${inv.id}" title="Catat Pelunasan">
                  <i data-lucide="check-circle-2" class="w-4 h-4"></i>
                </button>
              ` : `
                <button class="btn-quick-pay p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors" data-id="${inv.id}" title="Ubah Info Pembayaran">
                  <i data-lucide="file-check" class="w-4 h-4"></i>
                </button>
              `}

              <!-- Edit Button (Admin Only) -->
              <button class="admin-only btn-edit-row p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition-colors" data-id="${inv.id}" title="Edit Invoice">
                <i data-lucide="edit" class="w-4 h-4"></i>
              </button>

              <!-- Delete Button (Admin Only) -->
              <button class="admin-only btn-delete-row p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors" data-id="${inv.id}" title="Hapus Data">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>

            </div>
          </td>

        </tr>
      `;
    }).join('');

    tbody.innerHTML = rowsHtml;

    // Apply Admin Mode visibility
    updateAdminView();

    // Re-initialize Lucide Icons
    if (window.lucide) lucide.createIcons({ root: tbody });

    // Update Select All Checkbox State
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) {
      const allChecked = currentRows.length > 0 && currentRows.every(r => state.selectedIds.has(r.id));
      selectAllCheckbox.checked = allChecked;
    }
  }

  // Escape HTML helper
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Render Pagination Controls
  function renderPagination() {
    const container = document.getElementById('paginationButtons');
    const startSpan = document.getElementById('pageStart');
    const endSpan = document.getElementById('pageEnd');
    const totalSpan = document.getElementById('totalFilteredCount');
    if (!container) return;

    const total = state.filteredInvoices.length;
    totalSpan.textContent = total.toLocaleString();

    if (total === 0) {
      startSpan.textContent = '0';
      endSpan.textContent = '0';
      container.innerHTML = '';
      return;
    }

    if (state.pageSize === 'all') {
      startSpan.textContent = '1';
      endSpan.textContent = total.toLocaleString();
      container.innerHTML = '<span class="text-xs text-slate-400 px-2">Semua baris ditampilkan</span>';
      return;
    }

    const size = parseInt(state.pageSize, 10);
    const totalPages = Math.ceil(total / size) || 1;
    const startIndex = (state.currentPage - 1) * size + 1;
    const endIndex = Math.min(state.currentPage * size, total);

    startSpan.textContent = startIndex.toLocaleString();
    endSpan.textContent = endIndex.toLocaleString();

    let buttonsHtml = '';

    // Prev Button
    buttonsHtml += `
      <button class="btn-page p-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed" data-page="${state.currentPage - 1}" ${state.currentPage <= 1 ? 'disabled' : ''}>
        <i data-lucide="chevron-left" class="w-4 h-4"></i>
      </button>
    `;

    // Dynamic page numbers
    let pagesToShow = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pagesToShow.push(i);
    } else {
      if (state.currentPage <= 4) {
        pagesToShow = [1, 2, 3, 4, 5, '...', totalPages];
      } else if (state.currentPage >= totalPages - 3) {
        pagesToShow = [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
      } else {
        pagesToShow = [1, '...', state.currentPage - 1, state.currentPage, state.currentPage + 1, '...', totalPages];
      }
    }

    pagesToShow.forEach(p => {
      if (p === '...') {
        buttonsHtml += `<span class="px-2 py-1 text-slate-400">...</span>`;
      } else {
        const isActive = p === state.currentPage;
        buttonsHtml += `
          <button class="btn-page px-3 py-1 rounded-lg text-xs font-semibold ${isActive ? 'bg-blue-600 text-white shadow-sm' : 'border border-slate-300 text-slate-700 hover:bg-slate-100'}" data-page="${p}">
            ${p}
          </button>
        `;
      }
    });

    // Next Button
    buttonsHtml += `
      <button class="btn-page p-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed" data-page="${state.currentPage + 1}" ${state.currentPage >= totalPages ? 'disabled' : ''}>
        <i data-lucide="chevron-right" class="w-4 h-4"></i>
      </button>
    `;

    container.innerHTML = buttonsHtml;
    if (window.lucide) lucide.createIcons({ root: container });
  }

  // Update Batch Action Bar
  function updateBatchBar() {
    const bar = document.getElementById('batchActionBar');
    const countEl = document.getElementById('selectedBatchCount');
    if (!bar) return;

    const count = state.selectedIds.size;
    if (count > 0) {
      bar.classList.remove('hidden');
      if (countEl) countEl.textContent = count;
    } else {
      bar.classList.add('hidden');
    }
  }

  // Admin Mode Visibility Toggle
  function updateAdminView() {
    const adminElements = document.querySelectorAll('.admin-only');
    adminElements.forEach(el => {
      if (state.adminMode) {
        el.style.display = '';
        el.removeAttribute('disabled');
      } else {
        el.style.display = 'none';
        el.setAttribute('disabled', 'true');
      }
    });

    const statusText = document.getElementById('adminStatusText');
    const toggle = document.getElementById('adminModeToggle');
    if (toggle) toggle.checked = state.adminMode;

    if (statusText) {
      if (state.adminMode) {
        statusText.className = 'text-emerald-700 font-bold flex items-center gap-1';
        statusText.innerHTML = '<i data-lucide="shield-check" class="w-3.5 h-3.5"></i> Admin Aktif';
      } else {
        statusText.className = 'text-slate-500 font-semibold flex items-center gap-1';
        statusText.innerHTML = '<i data-lucide="eye" class="w-3.5 h-3.5"></i> Mode Viewer';
      }
      if (window.lucide) lucide.createIcons({ root: statusText });
    }
  }

  // Charts Engine using Chart.js
  function updateCharts() {
    if (!window.Chart || !state.chartsVisible) return;

    const dataset = state.filteredInvoices;

    // 1. Chart Jatuh Tempo (>30 Hari vs <=30 Hari)
    const jtCount = dataset.filter(i => i.statusJatuhTempo === 'Jatuh Tempo').length;
    const bjtCount = dataset.filter(i => i.statusJatuhTempo === 'Belum Jatuh Tempo').length;

    const ctxJT = document.getElementById('chartJatuhTempo');
    if (ctxJT) {
      if (state.charts.jatuhTempo) state.charts.jatuhTempo.destroy();
      state.charts.jatuhTempo = new Chart(ctxJT, {
        type: 'doughnut',
        data: {
          labels: ['Jatuh Tempo (>30 Hari)', 'Belum Jatuh Tempo'],
          datasets: [{
            data: [jtCount, bjtCount],
            backgroundColor: ['#ef4444', '#10b981'],
            borderWidth: 2,
            borderColor: '#ffffff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } }
          },
          cutout: '65%'
        }
      });
    }

    // 2. Chart Pembayaran (Sudah Bayar vs Belum Bayar)
    const sbCount = dataset.filter(i => i.statusPembayaran === 'Sudah Bayar').length;
    const bbCount = dataset.filter(i => i.statusPembayaran === 'Belum Bayar').length;

    const ctxBayar = document.getElementById('chartPembayaran');
    if (ctxBayar) {
      if (state.charts.pembayaran) state.charts.pembayaran.destroy();
      state.charts.pembayaran = new Chart(ctxBayar, {
        type: 'doughnut',
        data: {
          labels: ['Sudah Bayar', 'Belum Bayar'],
          datasets: [{
            data: [sbCount, bbCount],
            backgroundColor: ['#10b981', '#f59e0b'],
            borderWidth: 2,
            borderColor: '#ffffff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } }
          },
          cutout: '65%'
        }
      });
    }

    // 3. Chart Metode Pembayaran (BNI, UMP, MVA, Lainnya)
    const bniCount = dataset.filter(i => i.pembayaranVia === 'BNI').length;
    const umpCount = dataset.filter(i => i.pembayaranVia === 'UMP').length;
    const mvaCount = dataset.filter(i => i.pembayaranVia === 'MVA').length;
    const otherCount = dataset.filter(i => i.pembayaranVia && !['BNI', 'UMP', 'MVA'].includes(i.pembayaranVia)).length;

    const ctxMetode = document.getElementById('chartMetodeBayar');
    if (ctxMetode) {
      if (state.charts.metodeBayar) state.charts.metodeBayar.destroy();
      state.charts.metodeBayar = new Chart(ctxMetode, {
        type: 'bar',
        data: {
          labels: ['BNI', 'UMP', 'MVA', 'Lainnya'],
          datasets: [{
            label: 'Jumlah Invoice',
            data: [bniCount, umpCount, mvaCount, otherCount],
            backgroundColor: ['#0284c7', '#8b5cf6', '#14b8a6', '#94a3b8'],
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, ticks: { precision: 0, font: { size: 9 } } },
            x: { ticks: { font: { size: 10 } } }
          }
        }
      });
    }

    // 4. Chart Portofolio Breakdown
    const portTotals = {};
    dataset.forEach(i => {
      const p = i.portofolio || 'Lainnya';
      portTotals[p] = (portTotals[p] || 0) + (i.saldoKonversi || 0);
    });

    const sortedPorts = Object.entries(portTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    const ctxPort = document.getElementById('chartPortofolio');
    if (ctxPort) {
      if (state.charts.portofolio) state.charts.portofolio.destroy();
      state.charts.portofolio = new Chart(ctxPort, {
        type: 'bar',
        data: {
          labels: sortedPorts.map(p => p[0].length > 15 ? p[0].substring(0, 15) + '...' : p[0]),
          datasets: [{
            label: 'Nilai Saldo (Juta Rp)',
            data: sortedPorts.map(p => Math.round(p[1] / 1000000)),
            backgroundColor: '#3b82f6',
            borderRadius: 6
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  return ' Total: Rp ' + (ctx.raw).toLocaleString('id-ID') + ' Juta';
                }
              }
            }
          },
          scales: {
            x: { beginAtZero: true, ticks: { font: { size: 9 } } },
            y: { ticks: { font: { size: 9 } } }
          }
        }
      });
    }
  }

  // Open Modal: Add or Edit Invoice
  function openInvoiceModal(invoice = null) {
    const modal = document.getElementById('modalInvoiceForm');
    const form = document.getElementById('invoiceForm');
    const titleEl = document.getElementById('modalFormTitle');
    if (!modal || !form) return;

    form.reset();

    if (invoice) {
      titleEl.textContent = 'Edit Data Invoice #' + invoice.noInvoice;
      document.getElementById('formInvoiceId').value = invoice.id;
      document.getElementById('formNoInvoice').value = invoice.noInvoice || '';
      document.getElementById('formTanggal').value = invoice.tanggal || '';
      document.getElementById('formCustomer').value = invoice.customer || '';
      document.getElementById('formPelanggan').value = invoice.pelanggan || '';
      document.getElementById('formPortofolio').value = invoice.portofolio || '';
      document.getElementById('formKegiatan').value = invoice.kegiatan || '';
      document.getElementById('formOrderNumber').value = invoice.orderNumber || '';
      document.getElementById('formSaldoKonversi').value = invoice.saldoKonversi || 0;
      document.getElementById('formDayInvoice').value = invoice.dayInvoice || 0;
      
      document.getElementById('formPembayaranVia').value = invoice.pembayaranVia || '';
      document.getElementById('formStatusPembayaran').value = invoice.statusPembayaran || 'Belum Bayar';
      document.getElementById('formNominalPelunasan').value = invoice.nominalPelunasan || 0;
      document.getElementById('formTanggalPelunasan').value = invoice.tanggalPelunasan || '';
      document.getElementById('formKeterangan').value = invoice.keterangan || '';
    } else {
      titleEl.textContent = 'Tambah Invoice Baru';
      document.getElementById('formInvoiceId').value = '';
      document.getElementById('formTanggal').value = new Date().toISOString().split('T')[0];
      document.getElementById('formDayInvoice').value = 0;
      document.getElementById('formStatusPembayaran').value = 'Belum Bayar';
      document.getElementById('formKeterangan').value = 'Belum Bayar';
    }

    updateFormJatuhTempoBadge();
    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons({ root: modal });
  }

  function updateFormJatuhTempoBadge() {
    const dayInput = document.getElementById('formDayInvoice');
    const badgeContainer = document.getElementById('formStatusJatuhTempoBadge');
    if (!dayInput || !badgeContainer) return;

    const days = parseInt(dayInput.value, 10) || 0;
    const isJT = days > 30;

    badgeContainer.innerHTML = isJT
      ? `<span class="badge badge-jatuh-tempo"><i data-lucide="alert-triangle" class="w-3 h-3"></i> Jatuh Tempo (> 30 Hari: ${days} hari)</span>`
      : `<span class="badge badge-belum-jatuh-tempo"><i data-lucide="check" class="w-3 h-3"></i> Belum Jatuh Tempo (≤ 30 Hari: ${days} hari)</span>`;

    if (window.lucide) lucide.createIcons({ root: badgeContainer });
  }

  // Open Modal: Quick Pay
  function openQuickPayModal(id) {
    const invoice = state.invoices.find(i => i.id === id);
    if (!invoice) return;

    const modal = document.getElementById('modalQuickPay');
    if (!modal) return;

    document.getElementById('quickPayInvoiceId').value = invoice.id;
    document.getElementById('quickPayNoInvoice').textContent = invoice.noInvoice || '-';
    document.getElementById('quickPayCustomer').textContent = invoice.customer || '-';
    document.getElementById('quickPayTotalTagihan').textContent = formatRupiah(invoice.saldoKonversi);

    document.getElementById('quickPayVia').value = invoice.pembayaranVia || 'BNI';
    document.getElementById('quickPayNominal').value = invoice.saldoKonversi || 0;
    
    // Default today date in YYYY-MM-DD
    const todayStr = new Date().toISOString().split('T')[0];
    document.getElementById('quickPayTanggal').value = invoice.tanggalPelunasan || todayStr;
    document.getElementById('quickPayKeterangan').value = 'Sudah Bayar';

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons({ root: modal });
  }

  // Close All Modals
  function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
  }

  // Export Engine: Excel (.xlsx) using SheetJS
  function exportToExcel(invoicesToExport, filename = 'Data_Invoice_Piutang.xlsx') {
    if (!window.XLSX) {
      showToast('Library SheetJS belum siap, silakan coba sesaat lagi', 'error');
      return;
    }

    const exportRows = invoicesToExport.map((inv, idx) => ({
      'No.': idx + 1,
      'No. Invoice': inv.noInvoice,
      'Tanggal': inv.tanggal,
      'Customer': inv.customer,
      'Pelanggan': inv.pelanggan,
      'Portofolio': inv.portofolio,
      'Kegiatan': inv.kegiatan,
      'Order Number': inv.orderNumber,
      'Saldo Konversi': inv.saldoKonversi,
      'Day (Invoice)': inv.dayInvoice,
      'Status Jatuh Tempo': inv.statusJatuhTempo,
      'Pembayaran Via': inv.pembayaranVia,
      'Status Pembayaran': inv.statusPembayaran,
      'Nominal Pelunasan': inv.nominalPelunasan,
      'Tanggal Pelunasan': inv.tanggalPelunasan,
      'Keterangan': inv.keterangan
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data Invoice');

    // Auto column widths
    const colWidths = Object.keys(exportRows[0] || {}).map(key => ({
      wch: Math.max(key.length + 3, 14)
    }));
    worksheet['!cols'] = colWidths;

    XLSX.writeFile(workbook, filename);
    showToast(`Berhasil mengekspor ${exportRows.length} data ke Excel`, 'success');
  }

  // Export Engine: CSV
  function exportToCSV(invoicesToExport, filename = 'Data_Invoice_Piutang.csv') {
    if (invoicesToExport.length === 0) {
      showToast('Tidak ada data untuk diekspor', 'warning');
      return;
    }

    const headers = [
      'No. Invoice',
      'Tanggal',
      'Customer',
      'Pelanggan',
      'Portofolio',
      'Kegiatan',
      'Order Number',
      'Saldo Konversi',
      'Day (Invoice)',
      'Status Jatuh Tempo',
      'Pembayaran Via',
      'Status Pembayaran',
      'Nominal Pelunasan',
      'Tanggal Pelunasan',
      'Keterangan'
    ];

    const rows = invoicesToExport.map(i => [
      `"${(i.noInvoice || '').replace(/"/g, '""')}"`,
      `"${(i.tanggal || '').replace(/"/g, '""')}"`,
      `"${(i.customer || '').replace(/"/g, '""')}"`,
      `"${(i.pelanggan || '').replace(/"/g, '""')}"`,
      `"${(i.portofolio || '').replace(/"/g, '""')}"`,
      `"${(i.kegiatan || '').replace(/"/g, '""')}"`,
      `"${(i.orderNumber || '').replace(/"/g, '""')}"`,
      i.saldoKonversi || 0,
      i.dayInvoice || 0,
      `"${(i.statusJatuhTempo || '').replace(/"/g, '""')}"`,
      `"${(i.pembayaranVia || '').replace(/"/g, '""')}"`,
      `"${(i.statusPembayaran || '').replace(/"/g, '""')}"`,
      i.nominalPelunasan || 0,
      `"${(i.tanggalPelunasan || '').replace(/"/g, '""')}"`,
      `"${(i.keterangan || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Berhasil mengekspor ${invoicesToExport.length} data ke CSV`, 'success');
  }

  // Download Spreadsheet Template (.xlsx / .csv) matching original Google Sheet
  function downloadTemplate(format = 'xlsx') {
    const templateData = [
      {
        'No. Invoice': '37012000156',
        'Tanggal': '4-Feb-20',
        'Customer': 'BERCA GEMILANG',
        'Pelanggan': '47692',
        'Portofolio': 'Industri',
        'Kegiatan': 'SERTIFIKASI OVER HEAD CRANE',
        'Order Number': '3701021900258',
        'Saldo Konversi': 33500000,
        'Day (Invoice)': 45
      },
      {
        'No. Invoice': '37012601796',
        'Tanggal': '24-Jun-26',
        'Customer': 'ADNOC GLOBAL TRADING ASIA PTE LTD',
        'Pelanggan': '260140',
        'Portofolio': 'Hulu Migas & Produk Migas',
        'Kegiatan': 'SUPERVISION OF LOADING',
        'Order Number': '37010226000299',
        'Saldo Konversi': 2691660,
        'Day (Invoice)': 15
      }
    ];

    if (format === 'xlsx') {
      if (!window.XLSX) {
        showToast('Library SheetJS belum siap', 'error');
        return;
      }
      const ws = XLSX.utils.json_to_sheet(templateData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Template Invoice');
      XLSX.writeFile(wb, 'Template_Import_Invoice.xlsx');
    } else {
      const headers = ['No. Invoice', 'Tanggal', 'Customer', 'Pelanggan', 'Portofolio', 'Kegiatan', 'Order Number', 'Saldo Konversi', 'Day (Invoice)'];
      const sample1 = ['37012000156', '4-Feb-20', 'BERCA GEMILANG', '47692', 'Industri', 'SERTIFIKASI OVER HEAD CRANE', '3701021900258', '33500000', '45'];
      const sample2 = ['37012601796', '24-Jun-26', 'ADNOC GLOBAL TRADING ASIA PTE LTD', '260140', 'Hulu Migas & Produk Migas', 'SUPERVISION OF LOADING', '37010226000299', '2691660', '15'];
      const csvStr = '\uFEFF' + [headers.join(','), sample1.join(','), sample2.join(',')].join('\r\n');
      const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Template_Import_Invoice.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    showToast(`Template import (${format.toUpperCase()}) berhasil diunduh`, 'success');
  }

  // Import Parsing Engine (reads Excel or CSV)
  function handleFileImport(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rawJson = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        if (!rawJson || rawJson.length === 0) {
          showToast('File tidak memiliki data atau baris kosong', 'warning');
          return;
        }

        // Parse and map columns flexibly
        const mappedRecords = [];
        let nextId = state.invoices.length ? Math.max(...state.invoices.map(i => i.id || 0)) + 1 : 1;

        rawJson.forEach((row) => {
          // Find keys by loose match
          const getVal = (possibleKeys) => {
            for (const key of Object.keys(row)) {
              const cleaned = key.toLowerCase().replace(/[^a-z0-9]/g, '');
              for (const target of possibleKeys) {
                if (cleaned === target.toLowerCase().replace(/[^a-z0-9]/g, '')) {
                  return row[key];
                }
              }
            }
            return '';
          };

          const noInvoice = sanitizeText(getVal(['No. Invoice', 'No Invoice', 'Invoice', 'No_Invoice']));
          const tanggal = sanitizeText(getVal(['Tanggal', 'Date', 'Tgl']));
          const customer = sanitizeText(getVal(['Customer', 'Nama Customer', 'Nama Pelanggan']));
          const pelanggan = sanitizeText(getVal(['Pelanggan', 'ID Pelanggan', 'Kode Pelanggan']));
          const portofolio = sanitizeText(getVal(['Portofolio', 'Portfolio'])) || 'Lainnya';
          const kegiatan = sanitizeText(getVal(['Kegiatan', 'Uraian', 'Deskripsi']));
          const orderNumber = sanitizeText(getVal(['Order Number', 'Order No', 'No Order']));
          
          let saldoRaw = getVal(['Saldo Konversi', 'Saldo', 'Nilai', 'Amount']);
          if (typeof saldoRaw === 'string') saldoRaw = saldoRaw.replace(/[^\d.]/g, '');
          const saldo = parseFloat(saldoRaw) || 0;

          const dayRaw = getVal(['Day (Invoice)', 'Day', 'Hari', 'Hari Invoice']);
          const day = parseInt(dayRaw, 10) || 0;

          // Additional fields (if present in import or defaulted)
          const statusJT = computeStatusJatuhTempo(day);
          const pembayaranVia = sanitizeText(getVal(['Pembayaran Via', 'Metode Bayar', 'Metode Pembayaran']));
          const statusBayarRaw = sanitizeText(getVal(['Status Pembayaran', 'Status Bayar']));
          const statusPembayaran = statusBayarRaw.toLowerCase().includes('sudah') ? 'Sudah Bayar' : 'Belum Bayar';
          
          let nominalPelunasan = parseFloat(getVal(['Nominal Pelunasan', 'Pelunasan'])) || 0;
          if (statusPembayaran === 'Sudah Bayar' && nominalPelunasan === 0) {
            nominalPelunasan = saldo;
          }

          const tanggalPelunasan = sanitizeText(getVal(['Tanggal Pelunasan', 'Tgl Pelunasan']));
          let keterangan = sanitizeText(getVal(['Keterangan', 'Notes']));
          if (!keterangan) {
            keterangan = statusPembayaran === 'Sudah Bayar' ? 'Sudah Bayar' : 'Belum Bayar';
          }

          if (noInvoice || customer) {
            mappedRecords.push({
              id: nextId++,
              noInvoice,
              tanggal,
              customer,
              pelanggan,
              portofolio,
              kegiatan,
              orderNumber,
              saldoKonversi: saldo,
              dayInvoice: day,
              statusJatuhTempo: statusJT,
              pembayaranVia,
              statusPembayaran,
              nominalPelunasan,
              tanggalPelunasan,
              keterangan
            });
          }
        });

        if (mappedRecords.length === 0) {
          showToast('Tidak ada data valid yang dapat dipetakan dari file', 'error');
          return;
        }

        // Store in pending state and show preview
        state.importPendingData = mappedRecords;
        showImportPreview(mappedRecords);

      } catch (err) {
        console.error('Error parsing file:', err);
        showToast('Gagal membaca file: ' + err.message, 'error');
      }
    };

    reader.readAsArrayBuffer(file);
  }

  function showImportPreview(records) {
    const container = document.getElementById('importPreviewContainer');
    const head = document.getElementById('previewTableHead');
    const body = document.getElementById('previewTableBody');
    const countEl = document.getElementById('previewCount');
    const executeBtn = document.getElementById('btnExecuteImport');

    if (!container || !head || !body) return;

    countEl.textContent = records.length;
    head.innerHTML = `
      <tr>
        <th class="p-2 text-left">No. Invoice</th>
        <th class="p-2 text-left">Customer</th>
        <th class="p-2 text-right">Saldo Konversi</th>
        <th class="p-2 text-center">Day</th>
        <th class="p-2 text-center">Status JT</th>
      </tr>
    `;

    const sample = records.slice(0, 5);
    body.innerHTML = sample.map(r => `
      <tr>
        <td class="p-2 font-mono text-slate-800">${escapeHtml(r.noInvoice)}</td>
        <td class="p-2 text-slate-700 max-w-xs truncate">${escapeHtml(r.customer)}</td>
        <td class="p-2 text-right font-semibold text-slate-900">${formatRupiah(r.saldoKonversi)}</td>
        <td class="p-2 text-center font-bold ${r.dayInvoice > 30 ? 'text-rose-600' : 'text-emerald-600'}">${r.dayInvoice}</td>
        <td class="p-2 text-center">
          <span class="badge ${r.statusJatuhTempo === 'Jatuh Tempo' ? 'badge-jatuh-tempo' : 'badge-belum-jatuh-tempo'}">
            ${r.statusJatuhTempo}
          </span>
        </td>
      </tr>
    `).join('');

    container.classList.remove('hidden');
    if (executeBtn) executeBtn.removeAttribute('disabled');
  }

  function executeImport() {
    if (!state.importPendingData || state.importPendingData.length === 0) return;

    const mode = document.querySelector('input[name="importMode"]:checked')?.value || 'append';

    if (mode === 'replace') {
      state.invoices = [...state.importPendingData];
    } else {
      // Append mode: avoid duplicate invoice numbers if matching
      const existingInvoicesMap = new Map();
      state.invoices.forEach(i => {
        if (i.noInvoice) existingInvoicesMap.set(i.noInvoice.trim().toLowerCase(), i);
      });

      let addedCount = 0;
      let updatedCount = 0;

      state.importPendingData.forEach(newItem => {
        const key = newItem.noInvoice ? newItem.noInvoice.trim().toLowerCase() : null;
        if (key && existingInvoicesMap.has(key)) {
          // Update existing item with imported details
          const old = existingInvoicesMap.get(key);
          Object.assign(old, newItem, { id: old.id });
          updatedCount++;
        } else {
          state.invoices.push(newItem);
          addedCount++;
        }
      });
    }

    normalizeAllInvoices();
    saveDataToStorage();
    populatePortofolioDropdown();
    applyFilters();
    closeAllModals();

    showToast(`Import berhasil! ${state.importPendingData.length} data diproses.`, 'success');
    state.importPendingData = null;
  }

  // Event Listeners Setup
  function setupEventListeners() {
    // Admin Toggle
    const adminToggle = document.getElementById('adminModeToggle');
    if (adminToggle) {
      adminToggle.addEventListener('change', function () {
        state.adminMode = this.checked;
        localStorage.setItem(ADMIN_STORAGE_KEY, state.adminMode);
        updateAdminView();
        showToast(state.adminMode ? 'Mode Admin diaktifkan' : 'Beralih ke Mode Viewer (Read-only)', 'info');
      });
    }

    // Add Invoice Button
    const btnTambah = document.getElementById('btnTambahInvoice');
    if (btnTambah) {
      btnTambah.addEventListener('click', () => openInvoiceModal(null));
    }

    // Auto Fill Full Amount in modal
    const btnAutoFill = document.getElementById('btnAutoFillFullAmount');
    if (btnAutoFill) {
      btnAutoFill.addEventListener('click', () => {
        const saldo = document.getElementById('formSaldoKonversi').value;
        document.getElementById('formNominalPelunasan').value = saldo;
      });
    }

    // Day Invoice change event for badge preview
    const formDay = document.getElementById('formDayInvoice');
    if (formDay) {
      formDay.addEventListener('input', updateFormJatuhTempoBadge);
    }

    // Form Status Pembayaran change event for Keterangan auto-fill
    const formStatusBayar = document.getElementById('formStatusPembayaran');
    if (formStatusBayar) {
      formStatusBayar.addEventListener('change', function () {
        const ketInput = document.getElementById('formKeterangan');
        const nominalInput = document.getElementById('formNominalPelunasan');
        const saldoInput = document.getElementById('formSaldoKonversi');
        const tglInput = document.getElementById('formTanggalPelunasan');

        if (this.value === 'Sudah Bayar') {
          if (!ketInput.value || ketInput.value === 'Belum Bayar') ketInput.value = 'Sudah Bayar';
          if (!nominalInput.value || parseFloat(nominalInput.value) === 0) nominalInput.value = saldoInput.value;
          if (!tglInput.value) tglInput.value = new Date().toISOString().split('T')[0];
        } else {
          if (ketInput.value === 'Sudah Bayar') ketInput.value = 'Belum Bayar';
        }
      });
    }

    // Submit Invoice Form (Create / Edit)
    const form = document.getElementById('invoiceForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        const idVal = document.getElementById('formInvoiceId').value;
        const noInvoice = sanitizeText(document.getElementById('formNoInvoice').value);
        const tanggal = sanitizeText(document.getElementById('formTanggal').value);
        const customer = sanitizeText(document.getElementById('formCustomer').value);
        const pelanggan = sanitizeText(document.getElementById('formPelanggan').value);
        const portofolio = sanitizeText(document.getElementById('formPortofolio').value) || 'Lainnya';
        const kegiatan = sanitizeText(document.getElementById('formKegiatan').value);
        const orderNumber = sanitizeText(document.getElementById('formOrderNumber').value);
        const saldoKonversi = parseFloat(document.getElementById('formSaldoKonversi').value) || 0;
        const dayInvoice = parseInt(document.getElementById('formDayInvoice').value, 10) || 0;

        const pembayaranVia = document.getElementById('formPembayaranVia').value;
        const statusPembayaran = document.getElementById('formStatusPembayaran').value;
        const nominalPelunasan = parseFloat(document.getElementById('formNominalPelunasan').value) || 0;
        const tanggalPelunasan = document.getElementById('formTanggalPelunasan').value;
        
        let keterangan = sanitizeText(document.getElementById('formKeterangan').value);
        if (!keterangan) {
          keterangan = statusPembayaran === 'Sudah Bayar' ? 'Sudah Bayar' : 'Belum Bayar';
        }

        const statusJatuhTempo = computeStatusJatuhTempo(dayInvoice);

        if (idVal) {
          // Update existing
          const invoice = state.invoices.find(i => i.id === parseInt(idVal, 10));
          if (invoice) {
            Object.assign(invoice, {
              noInvoice,
              tanggal,
              customer,
              pelanggan,
              portofolio,
              kegiatan,
              orderNumber,
              saldoKonversi,
              dayInvoice,
              statusJatuhTempo,
              pembayaranVia,
              statusPembayaran,
              nominalPelunasan,
              tanggalPelunasan,
              keterangan
            });
            showToast('Invoice #' + noInvoice + ' berhasil diperbarui', 'success');
            pushToGoogleSheets('update_invoice', invoice);
          }
        } else {
          // Create new
          const newId = state.invoices.length ? Math.max(...state.invoices.map(i => i.id || 0)) + 1 : 1;
          const newInv = {
            id: newId,
            noInvoice,
            tanggal,
            customer,
            pelanggan,
            portofolio,
            kegiatan,
            orderNumber,
            saldoKonversi,
            dayInvoice,
            statusJatuhTempo,
            pembayaranVia,
            statusPembayaran,
            nominalPelunasan,
            tanggalPelunasan,
            keterangan
          };
          state.invoices.unshift(newInv);
          showToast('Invoice baru #' + noInvoice + ' berhasil ditambahkan', 'success');
          pushToGoogleSheets('add_invoice', newInv);
        }

        saveDataToStorage();
        populatePortofolioDropdown();
        applyFilters();
        closeAllModals();
      });
    }

    // Submit Quick Pay Form
    const quickPayForm = document.getElementById('quickPayForm');
    if (quickPayForm) {
      quickPayForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const id = parseInt(document.getElementById('quickPayInvoiceId').value, 10);
        const invoice = state.invoices.find(i => i.id === id);
        if (!invoice) return;

        const via = document.getElementById('quickPayVia').value;
        const nominal = parseFloat(document.getElementById('quickPayNominal').value) || invoice.saldoKonversi;
        const tanggal = document.getElementById('quickPayTanggal').value;
        let ket = document.getElementById('quickPayKeterangan').value;
        if (!ket) ket = 'Sudah Bayar - ' + via;

        invoice.pembayaranVia = via;
        invoice.statusPembayaran = 'Sudah Bayar';
        invoice.nominalPelunasan = nominal;
        invoice.tanggalPelunasan = tanggal;
        invoice.keterangan = ket;

        saveDataToStorage();
        applyFilters();
        closeAllModals();
        showToast('Pelunasan invoice #' + invoice.noInvoice + ' berhasil dicatat!', 'success');
      });
    }

    // Table Row Actions (Click delegation)
    const tableBody = document.getElementById('invoiceTableBody');
    if (tableBody) {
      tableBody.addEventListener('click', function (e) {
        const target = e.target;
        
        // Checkbox click
        const checkbox = target.closest('.row-checkbox');
        if (checkbox) {
          const id = parseInt(checkbox.dataset.id, 10);
          if (checkbox.checked) state.selectedIds.add(id);
          else state.selectedIds.delete(id);
          
          const tr = checkbox.closest('tr');
          if (tr) tr.classList.toggle('selected', checkbox.checked);
          updateBatchBar();
          return;
        }

        // Quick Pay
        const btnQuickPay = target.closest('.btn-quick-pay');
        if (btnQuickPay) {
          const id = parseInt(btnQuickPay.dataset.id, 10);
          openQuickPayModal(id);
          return;
        }

        // Edit Row
        const btnEdit = target.closest('.btn-edit-row');
        if (btnEdit) {
          const id = parseInt(btnEdit.dataset.id, 10);
          const invoice = state.invoices.find(i => i.id === id);
          if (invoice) openInvoiceModal(invoice);
          return;
        }

        // Delete Row
        const btnDelete = target.closest('.btn-delete-row');
        if (btnDelete) {
          const id = parseInt(btnDelete.dataset.id, 10);
          const invoice = state.invoices.find(i => i.id === id);
          if (invoice) {
            state.deleteTargetId = id;
            document.getElementById('deleteConfirmMessage').innerHTML = `
              Apakah Anda yakin ingin menghapus invoice <b>#${invoice.noInvoice}</b> milik <b>${invoice.customer}</b>?<br>
              <span class="text-rose-600 font-semibold">Tindakan ini tidak dapat dibatalkan.</span>
            `;
            document.getElementById('modalDeleteConfirm').classList.remove('hidden');
          }
          return;
        }

        // Quick View row details
        const btnQuickView = target.closest('.btn-quick-view');
        if (btnQuickView) {
          const id = parseInt(btnQuickView.dataset.id, 10);
          const invoice = state.invoices.find(i => i.id === id);
          if (invoice) openInvoiceModal(invoice);
          return;
        }
      });
    }

    // Confirm Delete Action
    const btnConfirmDelete = document.getElementById('btnConfirmDelete');
    if (btnConfirmDelete) {
      btnConfirmDelete.addEventListener('click', function () {
        if (!state.deleteTargetId) return;
        state.invoices = state.invoices.filter(i => i.id !== state.deleteTargetId);
        state.selectedIds.delete(state.deleteTargetId);
        state.deleteTargetId = null;

        saveDataToStorage();
        applyFilters();
        closeAllModals();
        showToast('Data invoice berhasil dihapus', 'success');
      });
    }

    // Select All Checkbox
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) {
      selectAllCheckbox.addEventListener('change', function () {
        const isChecked = this.checked;
        const currentSlice = getCurrentPageInvoices();
        currentSlice.forEach(i => {
          if (isChecked) state.selectedIds.add(i.id);
          else state.selectedIds.delete(i.id);
        });

        document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = isChecked);
        document.querySelectorAll('#invoiceTableBody tr').forEach(tr => tr.classList.toggle('selected', isChecked));
        updateBatchBar();
      });
    }

    function getCurrentPageInvoices() {
      if (state.pageSize === 'all') return state.filteredInvoices;
      const size = parseInt(state.pageSize, 10);
      const start = (state.currentPage - 1) * size;
      return state.filteredInvoices.slice(start, start + size);
    }

    // Batch Actions
    const btnBatchDeselect = document.getElementById('btnBatchDeselect');
    if (btnBatchDeselect) {
      btnBatchDeselect.addEventListener('click', function () {
        state.selectedIds.clear();
        applyFilters();
      });
    }

    const btnBatchMarkPaid = document.getElementById('btnBatchMarkPaid');
    if (btnBatchMarkPaid) {
      btnBatchMarkPaid.addEventListener('click', function () {
        if (state.selectedIds.size === 0) return;
        const today = new Date().toISOString().split('T')[0];
        let count = 0;
        state.invoices.forEach(i => {
          if (state.selectedIds.has(i.id)) {
            i.statusPembayaran = 'Sudah Bayar';
            if (!i.pembayaranVia) i.pembayaranVia = 'BNI';
            if (!i.nominalPelunasan) i.nominalPelunasan = i.saldoKonversi;
            if (!i.tanggalPelunasan) i.tanggalPelunasan = today;
            i.keterangan = 'Sudah Bayar';
            count++;
          }
        });
        saveDataToStorage();
        applyFilters();
        showToast(`${count} invoice berhasil ditandai Lunas!`, 'success');
      });
    }

    const btnApplyBatchMethod = document.getElementById('btnApplyBatchMethod');
    if (btnApplyBatchMethod) {
      btnApplyBatchMethod.addEventListener('click', function () {
        const method = document.getElementById('batchMethodSelect').value;
        if (!method) {
          showToast('Pilih metode pembayaran terlebih dahulu', 'warning');
          return;
        }
        let count = 0;
        state.invoices.forEach(i => {
          if (state.selectedIds.has(i.id)) {
            i.pembayaranVia = method;
            count++;
          }
        });
        saveDataToStorage();
        applyFilters();
        showToast(`Metode pembayaran untuk ${count} invoice diubah ke ${method}`, 'success');
      });
    }

    const btnBatchDelete = document.getElementById('btnBatchDelete');
    if (btnBatchDelete) {
      btnBatchDelete.addEventListener('click', function () {
        const count = state.selectedIds.size;
        if (count === 0) return;
        if (confirm(`Yakin ingin menghapus ${count} invoice terpilih sekaligus?`)) {
          state.invoices = state.invoices.filter(i => !state.selectedIds.has(i.id));
          state.selectedIds.clear();
          saveDataToStorage();
          applyFilters();
          showToast(`${count} data invoice berhasil dihapus`, 'success');
        }
      });
    }

    const btnBatchExport = document.getElementById('btnBatchExport');
    if (btnBatchExport) {
      btnBatchExport.addEventListener('click', function () {
        const selectedInvoices = state.invoices.filter(i => state.selectedIds.has(i.id));
        if (selectedInvoices.length === 0) return;
        exportToExcel(selectedInvoices, `Invoice_Terpilih_${selectedInvoices.length}.xlsx`);
      });
    }

    // Sorting Headers
    document.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', function () {
        const col = this.dataset.sort;
        if (state.sortColumn === col) {
          state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortColumn = col;
          state.sortDirection = 'asc';
        }

        // Update visual icons
        document.querySelectorAll('th.sortable .sort-icon').forEach(icon => icon.textContent = '↕');
        const activeIcon = this.querySelector('.sort-icon');
        if (activeIcon) activeIcon.textContent = state.sortDirection === 'asc' ? '▲' : '▼';

        applyFilters();
      });
    });

    // Pagination Buttons delegation
    const paginationContainer = document.getElementById('paginationButtons');
    if (paginationContainer) {
      paginationContainer.addEventListener('click', function (e) {
        const btn = e.target.closest('.btn-page');
        if (!btn || btn.disabled) return;
        const page = parseInt(btn.dataset.page, 10);
        if (!isNaN(page) && page >= 1) {
          state.currentPage = page;
          renderTable();
          renderPagination();
        }
      });
    }

    // Page Size Select
    const pageSizeSelect = document.getElementById('pageSizeSelect');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function () {
        state.pageSize = this.value;
        state.currentPage = 1;
        applyFilters();
      });
    }

    // Live Search
    const searchInput = document.getElementById('searchInput');
    const btnClearSearch = document.getElementById('btnClearSearch');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        state.filters.search = this.value.trim();
        state.currentPage = 1;
        if (btnClearSearch) btnClearSearch.classList.toggle('hidden', !this.value);
        applyFilters();
      });
    }

    if (btnClearSearch) {
      btnClearSearch.addEventListener('click', function () {
        searchInput.value = '';
        state.filters.search = '';
        this.classList.add('hidden');
        state.currentPage = 1;
        applyFilters();
      });
    }

    // Filter Dropdowns
    const filterPort = document.getElementById('filterPortofolio');
    if (filterPort) {
      filterPort.addEventListener('change', function () {
        state.filters.portofolio = this.value;
        state.currentPage = 1;
        applyFilters();
      });
    }

    const filterJT = document.getElementById('filterJatuhTempo');
    if (filterJT) {
      filterJT.addEventListener('change', function () {
        state.filters.jatuhTempo = this.value;
        state.currentPage = 1;
        applyFilters();
      });
    }

    const filterBayar = document.getElementById('filterStatusBayar');
    if (filterBayar) {
      filterBayar.addEventListener('change', function () {
        state.filters.statusBayar = this.value;
        state.currentPage = 1;
        applyFilters();
      });
    }

    const filterMetode = document.getElementById('filterMetodeBayar');
    if (filterMetode) {
      filterMetode.addEventListener('change', function () {
        state.filters.metodeBayar = this.value;
        state.currentPage = 1;
        applyFilters();
      });
    }

    // Quick Pills
    document.querySelectorAll('.quick-pill').forEach(btn => {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.quick-pill').forEach(b => {
          b.className = 'quick-pill px-3 py-1.5 rounded-full font-medium transition-all bg-slate-100 text-slate-700 hover:bg-slate-200';
        });

        this.className = 'quick-pill active px-3 py-1.5 rounded-full font-medium transition-all bg-blue-600 text-white shadow-sm';
        state.filters.quick = this.dataset.quickFilter;
        state.currentPage = 1;
        applyFilters();
      });
    });

    // Reset Filters Button
    const btnResetFilters = document.getElementById('btnResetFilters');
    if (btnResetFilters) {
      btnResetFilters.addEventListener('click', function () {
        state.filters = {
          quick: 'all',
          search: '',
          portofolio: '',
          jatuhTempo: '',
          statusBayar: '',
          metodeBayar: ''
        };
        if (searchInput) searchInput.value = '';
        if (btnClearSearch) btnClearSearch.classList.add('hidden');
        if (filterPort) filterPort.value = '';
        if (filterJT) filterJT.value = '';
        if (filterBayar) filterBayar.value = '';
        if (filterMetode) filterMetode.value = '';

        document.querySelectorAll('.quick-pill').forEach(b => {
          b.className = b.dataset.quickFilter === 'all'
            ? 'quick-pill active px-3 py-1.5 rounded-full font-medium transition-all bg-blue-600 text-white shadow-sm'
            : 'quick-pill px-3 py-1.5 rounded-full font-medium transition-all bg-slate-100 text-slate-700 hover:bg-slate-200';
        });

        state.currentPage = 1;
        applyFilters();
        showToast('Filter direset ke tampilan default', 'info');
      });
    }

    // Toggle Charts
    const btnToggleCharts = document.getElementById('btnToggleCharts');
    const chartsContainer = document.getElementById('chartsContainer');
    const toggleChartsText = document.getElementById('toggleChartsText');
    const toggleChartsIcon = document.getElementById('toggleChartsIcon');
    if (btnToggleCharts && chartsContainer) {
      btnToggleCharts.addEventListener('click', function () {
        state.chartsVisible = !state.chartsVisible;
        if (state.chartsVisible) {
          chartsContainer.classList.remove('hidden');
          toggleChartsText.textContent = 'Sembunyikan Grafik';
          toggleChartsIcon.setAttribute('data-lucide', 'chevron-up');
          updateCharts();
        } else {
          chartsContainer.classList.add('hidden');
          toggleChartsText.textContent = 'Tampilkan Grafik';
          toggleChartsIcon.setAttribute('data-lucide', 'chevron-down');
        }
        if (window.lucide) lucide.createIcons({ root: btnToggleCharts });
      });
    }

    // Dropdowns Menu Toggles (Export & Options)
    const btnExportMenu = document.getElementById('btnExportMenu');
    const exportDropdown = document.getElementById('exportDropdownMenu');
    if (btnExportMenu && exportDropdown) {
      btnExportMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        exportDropdown.classList.toggle('hidden');
        optionsDropdown.classList.add('hidden');
      });
    }

    const btnOptionsMenu = document.getElementById('btnOptionsMenu');
    const optionsDropdown = document.getElementById('optionsDropdownMenu');
    if (btnOptionsMenu && optionsDropdown) {
      btnOptionsMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        optionsDropdown.classList.toggle('hidden');
        exportDropdown.classList.add('hidden');
      });
    }

    document.addEventListener('click', () => {
      if (exportDropdown) exportDropdown.classList.add('hidden');
      if (optionsDropdown) optionsDropdown.classList.add('hidden');
    });

    // Export Actions
    const btnExportExcel = document.getElementById('btnExportExcel');
    if (btnExportExcel) {
      btnExportExcel.addEventListener('click', () => exportToExcel(state.filteredInvoices));
    }

    const btnExportCSV = document.getElementById('btnExportCSV');
    if (btnExportCSV) {
      btnExportCSV.addEventListener('click', () => exportToCSV(state.filteredInvoices));
    }

    const btnPrintReport = document.getElementById('btnPrintReport');
    if (btnPrintReport) {
      btnPrintReport.addEventListener('click', () => window.print());
    }

    // Backup & Restore Database
    const btnBackup = document.getElementById('btnBackupJSON');
    if (btnBackup) {
      btnBackup.addEventListener('click', function () {
        const jsonStr = JSON.stringify(state.invoices, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Backup_Invoices_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast('Backup JSON berhasil dibuat', 'success');
      });
    }

    const restoreInput = document.getElementById('restoreJSONInput');
    if (restoreInput) {
      restoreInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (evt) {
          try {
            const parsed = JSON.parse(evt.target.result);
            if (Array.isArray(parsed)) {
              state.invoices = parsed;
              normalizeAllInvoices();
              saveDataToStorage();
              populatePortofolioDropdown();
              applyFilters();
              showToast(`Restore berhasil! ${parsed.length} invoice dimuat.`, 'success');
            } else {
              showToast('Format backup JSON tidak valid', 'error');
            }
          } catch (err) {
            showToast('Gagal membaca file JSON: ' + err.message, 'error');
          }
        };
        reader.readAsText(file);
      });
    }

    // Reset Data Action
    const btnResetData = document.getElementById('btnResetData');
    if (btnResetData) {
      btnResetData.addEventListener('click', function () {
        if (confirm('Kembalikan semua data ke 337 baris awal sesuai Google Spreadsheet asli? Perubahan Anda akan direset.')) {
          loadDefaultDataset();
          populatePortofolioDropdown();
          applyFilters();
          showToast('Data berhasil direset ke data asli Google Spreadsheet!', 'success');
        }
      });
    }

    const btnClearAll = document.getElementById('btnClearAllData');
    if (btnClearAll) {
      btnClearAll.addEventListener('click', function () {
        if (confirm('PERINGATAN: Kosongkan semua data invoice?')) {
          state.invoices = [];
          state.selectedIds.clear();
          saveDataToStorage();
          populatePortofolioDropdown();
          applyFilters();
          showToast('Semua data invoice telah dikosongkan', 'warning');
        }
      });
    }

    // Template Downloads
    const btnTplExcel = document.getElementById('btnDownloadTemplateExcel');
    if (btnTplExcel) btnTplExcel.addEventListener('click', () => downloadTemplate('xlsx'));

    const btnTplCSV = document.getElementById('btnDownloadTemplateCSV');
    if (btnTplCSV) btnTplCSV.addEventListener('click', () => downloadTemplate('csv'));

    const btnTplInModal = document.getElementById('btnDownloadTemplateInModal');
    if (btnTplInModal) btnTplInModal.addEventListener('click', () => downloadTemplate('xlsx'));

    // Modal Import Actions
    const btnOpenImport = document.getElementById('btnOpenImportModal');
    const modalImport = document.getElementById('modalImport');
    const dropZone = document.getElementById('dropZone');
    const importFileInput = document.getElementById('importFileInput');
    const btnExecuteImport = document.getElementById('btnExecuteImport');

    if (btnOpenImport && modalImport) {
      btnOpenImport.addEventListener('click', () => {
        state.importPendingData = null;
        document.getElementById('importPreviewContainer').classList.add('hidden');
        if (btnExecuteImport) btnExecuteImport.setAttribute('disabled', 'true');
        modalImport.classList.remove('hidden');
        if (window.lucide) lucide.createIcons({ root: modalImport });
      });
    }

    if (dropZone && importFileInput) {
      dropZone.addEventListener('click', () => importFileInput.click());
      importFileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFileImport(e.target.files[0]);
      });

      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('border-emerald-500', 'bg-emerald-50/50');
      });

      dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('border-emerald-500', 'bg-emerald-50/50');
      });

      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-emerald-500', 'bg-emerald-50/50');
        if (e.dataTransfer.files.length) handleFileImport(e.dataTransfer.files[0]);
      });
    }

    if (btnExecuteImport) {
      btnExecuteImport.addEventListener('click', executeImport);
    }

    // Modal Close Buttons
    document.querySelectorAll('.close-modal-btn').forEach(btn => {
      btn.addEventListener('click', closeAllModals);
    });

    // Close modal on Escape key or backdrop click
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAllModals();
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeAllModals();
      });
    });
  }

  // Application Startup
  function startApp() {
    initData();
    populatePortofolioDropdown();
    setupEventListeners();
    applyFilters();
    updateAdminView();
    if (window.lucide) lucide.createIcons();
    showToast('Sistem Manajemen Invoice & Piutang siap digunakan!', 'success');
  }

  // Run on DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
  } else {
    startApp();
  }

})();
