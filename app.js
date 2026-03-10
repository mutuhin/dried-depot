// ============================================================
//  DRIED DEPOT — Business Manager
//  All data stored in localStorage (works offline / GitHub Pages)
// ============================================================

const KEYS = {
    purchases:  'dd_purchases',
    production: 'dd_production',
    costs:      'dd_costs',
    sales:      'dd_sales'
};

let db = { purchases: [], production: [], costs: [], sales: [] };
let pendingDelete = { type: null, id: null };

// ============================================================
//  FIREBASE SYNC STATE
// ============================================================
let fbDB        = null;
let fbSyncKey   = '';
let fbConnected = false;
let deferredInstallPrompt = null;

// ============================================================
//  INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    loadAll();
    setDefaultDates();
    updateCurrentDate();
    renderDashboard();
    updateProductDatalist();

    // Re-render report summary when filters change
    ['report-type','report-startDate','report-endDate'].forEach(id => {
        document.getElementById(id).addEventListener('change', updateReportSummary);
    });

    // Service worker registration (PWA)
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    // PWA install prompt (Android/Chrome)
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        deferredInstallPrompt = e;
        const banner = document.getElementById('installBanner');
        if (banner) banner.classList.remove('d-none');
    });

    // Auto-connect Firebase if previously configured
    autoConnectFirebase();

    // Sync when user returns to the app tab
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && fbConnected) {
            pullFromFirebase().then(() => {
                renderDashboard();
                updateProductDatalist();
            });
        }
    });
});

function updateCurrentDate() {
    document.getElementById('currentDate').textContent =
        new Date().toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
}

function setDefaultDates() {
    const today = new Date().toISOString().split('T')[0];
    ['purchase-date','production-date','cost-date','sale-date'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.value) el.value = today;
    });
}

// ============================================================
//  DATA — localStorage
// ============================================================
function loadAll() {
    db.purchases  = JSON.parse(localStorage.getItem(KEYS.purchases)  || '[]');
    db.production = JSON.parse(localStorage.getItem(KEYS.production) || '[]');
    db.costs      = JSON.parse(localStorage.getItem(KEYS.costs)      || '[]');
    db.sales      = JSON.parse(localStorage.getItem(KEYS.sales)      || '[]');
}

function saveAll() {
    // Always save locally
    saveAllLocal();
    // Push to Firebase if connected
    if (fbConnected) pushToFirebase();
}

function saveAllLocal() {
    localStorage.setItem(KEYS.purchases,  JSON.stringify(db.purchases));
    localStorage.setItem(KEYS.production, JSON.stringify(db.production));
    localStorage.setItem(KEYS.costs,      JSON.stringify(db.costs));
    localStorage.setItem(KEYS.sales,      JSON.stringify(db.sales));
}

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ============================================================
//  TAB NAVIGATION
// ============================================================
function switchTab(name) {
    document.querySelectorAll('.tab-section').forEach(el => el.classList.add('d-none'));
    document.querySelectorAll('.bottom-nav-item').forEach(el => el.classList.remove('active'));

    document.getElementById('tab-' + name).classList.remove('d-none');
    document.getElementById('nav-' + name).classList.add('active');

    const renders = {
        dashboard:  renderDashboard,
        purchases:  renderPurchases,
        production: renderProduction,
        costs:      renderCosts,
        sales:      renderSales,
        reports:    updateReportSummary
    };
    if (renders[name]) renders[name]();
    window.scrollTo(0, 0);
}

// ============================================================
//  MODAL — OPEN / POPULATE
// ============================================================
function openModal(type, id = null) {
    const configs = {
        purchase:   { modal: 'purchaseModal',   form: 'purchaseForm',   titleEl: 'purchaseModalTitle' },
        production: { modal: 'productionModal', form: 'productionForm', titleEl: 'productionModalTitle' },
        cost:       { modal: 'costModal',       form: 'costForm',       titleEl: 'costModalTitle' },
        sale:       { modal: 'saleModal',       form: 'saleForm',       titleEl: 'saleModalTitle' }
    };
    const cfg = configs[type];

    document.getElementById(cfg.form).reset();
    setDefaultDates();
    document.getElementById(type + '-id').value = '';

    if (id) {
        document.getElementById(cfg.titleEl).textContent = 'Edit ' + titleCase(type);
        populateForm(type, id);
    } else {
        document.getElementById(cfg.titleEl).textContent = 'Add ' + titleCase(type);
    }

    new bootstrap.Modal(document.getElementById(cfg.modal)).show();
}

function populateForm(type, id) {
    if (type === 'purchase') {
        const r = db.purchases.find(x => x.id === id);
        if (!r) return;
        set('purchase-id', r.id);
        set('purchase-date', r.date);
        set('purchase-product', r.product);
        set('purchase-qty', r.quantityKg);
        set('purchase-price', r.pricePerKg);
        set('purchase-total', r.totalCost);
        set('purchase-supplier', r.supplier || '');
        set('purchase-notes', r.notes || '');
    }
    if (type === 'production') {
        const r = db.production.find(x => x.id === id);
        if (!r) return;
        set('production-id', r.id);
        set('production-date', r.date);
        set('production-product', r.product);
        set('production-rawKg', r.rawMaterialKg);
        set('production-yieldGrams', r.powderYieldGrams);
        set('production-yieldPct', r.yieldPercent);
        set('production-hours', r.machineHours || 0);
        set('production-minutes', r.machineMinutes || 0);
        set('production-notes', r.notes || '');
    }
    if (type === 'cost') {
        const r = db.costs.find(x => x.id === id);
        if (!r) return;
        set('cost-id', r.id);
        set('cost-date', r.date);
        set('cost-category', r.category);
        set('cost-item', r.itemName);
        set('cost-amount', r.amount);
        set('cost-notes', r.notes || '');
    }
    if (type === 'sale') {
        const r = db.sales.find(x => x.id === id);
        if (!r) return;
        set('sale-id', r.id);
        set('sale-date', r.date);
        set('sale-product', r.product);
        set('sale-qty', r.quantitySold);
        set('sale-unit', r.unit);
        set('sale-price', r.sellingPrice);
        set('sale-pricePer', r.pricePer);
        set('sale-total', r.totalRevenue);
        set('sale-customer', r.customer || '');
        set('sale-notes', r.notes || '');
        updateSaleRateDisplay(r.quantitySold, r.unit, r.totalRevenue);
    }
}

// ============================================================
//  CALCULATIONS (live in form)
// ============================================================
function calcPurchaseTotal() {
    const qty   = parseFloat(val('purchase-qty'))   || 0;
    const price = parseFloat(val('purchase-price')) || 0;
    set('purchase-total', (qty * price).toFixed(2));
}

function calcYield() {
    const rawKg  = parseFloat(val('production-rawKg'))     || 0;
    const grams  = parseFloat(val('production-yieldGrams')) || 0;
    if (rawKg > 0 && grams > 0) {
        set('production-yieldPct', ((grams / (rawKg * 1000)) * 100).toFixed(1));
    } else {
        set('production-yieldPct', '');
    }
}

function calcSaleTotal() {
    const qty      = parseFloat(val('sale-qty'))   || 0;
    const price    = parseFloat(val('sale-price')) || 0;
    const unit     = val('sale-unit');
    const pricePer = val('sale-pricePer');

    // Convert qty to grams
    const qtyGrams = unit === 'kg' ? qty * 1000 : qty;

    let total = 0;
    if (pricePer === 'total') {
        total = price;
    } else {
        const perGrams = pricePer === '100g' ? 100 : pricePer === '250g' ? 250 : pricePer === '500g' ? 500 : 1000;
        total = (qtyGrams / perGrams) * price;
    }

    set('sale-total', total > 0 ? total.toFixed(2) : '');
    updateSaleRateDisplay(qty, unit, total);
}

function updateSaleRateDisplay(qty, unit, total) {
    const el = document.getElementById('sale-rate-display');
    if (!el) return;
    const qtyGrams = unit === 'kg' ? (qty || 0) * 1000 : (qty || 0);
    if (qtyGrams > 0 && total > 0) {
        const per100g = ((total / qtyGrams) * 100).toFixed(2);
        el.textContent = '= ₹' + per100g + ' per 100g';
    } else {
        el.textContent = '';
    }
}

// ============================================================
//  SAVE — PURCHASES
// ============================================================
function savePurchase() {
    const form = document.getElementById('purchaseForm');
    if (!form.checkValidity()) { form.reportValidity(); return; }

    const id = val('purchase-id');
    const record = {
        id:          id || uid(),
        date:        val('purchase-date'),
        product:     val('purchase-product').trim(),
        quantityKg:  parseFloat(val('purchase-qty')),
        pricePerKg:  parseFloat(val('purchase-price')),
        totalCost:   parseFloat(val('purchase-total')),
        supplier:    val('purchase-supplier').trim(),
        notes:       val('purchase-notes').trim(),
        createdAt:   new Date().toISOString()
    };

    upsert(db.purchases, id, record);
    saveAll();
    hideModal('purchaseModal');
    updateProductDatalist();
    renderDashboard();
    renderPurchases();
    toast('Purchase saved!', 'success');
}

// ============================================================
//  SAVE — PRODUCTION
// ============================================================
function saveProduction() {
    const form = document.getElementById('productionForm');
    if (!form.checkValidity()) { form.reportValidity(); return; }

    const id     = val('production-id');
    const rawKg  = parseFloat(val('production-rawKg'));
    const grams  = parseFloat(val('production-yieldGrams'));
    const yieldP = rawKg > 0 ? +((grams / (rawKg * 1000)) * 100).toFixed(1) : 0;

    const record = {
        id:               id || uid(),
        date:             val('production-date'),
        product:          val('production-product').trim(),
        rawMaterialKg:    rawKg,
        powderYieldGrams: grams,
        yieldPercent:     yieldP,
        machineHours:     parseInt(val('production-hours')) || 0,
        machineMinutes:   parseInt(val('production-minutes')) || 0,
        notes:            val('production-notes').trim(),
        createdAt:        new Date().toISOString()
    };

    upsert(db.production, id, record);
    saveAll();
    hideModal('productionModal');
    renderDashboard();
    renderProduction();
    toast('Production record saved!', 'success');
}

// ============================================================
//  SAVE — COSTS
// ============================================================
function saveCost() {
    const form = document.getElementById('costForm');
    if (!form.checkValidity()) { form.reportValidity(); return; }

    const id = val('cost-id');
    const record = {
        id:       id || uid(),
        date:     val('cost-date'),
        category: val('cost-category'),
        itemName: val('cost-item').trim(),
        amount:   parseFloat(val('cost-amount')),
        notes:    val('cost-notes').trim(),
        createdAt: new Date().toISOString()
    };

    upsert(db.costs, id, record);
    saveAll();
    hideModal('costModal');
    renderDashboard();
    renderCosts();
    toast('Cost saved!', 'success');
}

// ============================================================
//  SAVE — SALES
// ============================================================
function saveSale() {
    const form = document.getElementById('saleForm');
    if (!form.checkValidity()) { form.reportValidity(); return; }

    const id       = val('sale-id');
    const qty      = parseFloat(val('sale-qty'));
    const unit     = val('sale-unit');
    const price    = parseFloat(val('sale-price'));
    const pricePer = val('sale-pricePer');
    const total    = parseFloat(val('sale-total')) || 0;
    const qtyGrams = unit === 'kg' ? qty * 1000 : qty;

    const record = {
        id:           id || uid(),
        date:         val('sale-date'),
        product:      val('sale-product').trim(),
        quantitySold: qty,
        unit:         unit,
        quantityGrams: qtyGrams,
        sellingPrice: price,
        pricePer:     pricePer,
        totalRevenue: total,
        customer:     val('sale-customer').trim(),
        notes:        val('sale-notes').trim(),
        createdAt:    new Date().toISOString()
    };

    upsert(db.sales, id, record);
    saveAll();
    hideModal('saleModal');
    renderDashboard();
    renderSales();
    toast('Sale recorded!', 'success');
}

// ============================================================
//  DELETE
// ============================================================
function deleteRecord(type, id) {
    pendingDelete = { type, id };
    new bootstrap.Modal(document.getElementById('deleteModal')).show();

    document.getElementById('confirmDeleteBtn').onclick = () => {
        const map = { purchase: 'purchases', production: 'production', cost: 'costs', sale: 'sales' };
        const key = map[pendingDelete.type];
        db[key] = db[key].filter(r => r.id !== pendingDelete.id);
        saveAll();
        hideModal('deleteModal');
        renderDashboard();
        renderPurchases();
        renderProduction();
        renderCosts();
        renderSales();
        toast('Record deleted', 'danger');
    };
}

// ============================================================
//  RENDER — DASHBOARD
// ============================================================
function renderDashboard() {
    const totalRaw    = db.purchases.reduce((s, r) => s + (r.totalCost || 0), 0);
    const totalOther  = db.costs.reduce((s, r) => s + (r.amount || 0), 0);
    const totalInvest = totalRaw + totalOther;
    const totalRevenue = db.sales.reduce((s, r) => s + (r.totalRevenue || 0), 0);
    const profitLoss  = totalRevenue - totalInvest;
    const totalPowder = db.production.reduce((s, r) => s + (r.powderYieldGrams || 0), 0);

    set('stat-totalInvestment', '₹' + fNum(totalInvest));
    set('stat-rawCost',         '₹' + fNum(totalRaw));
    set('stat-powderProduced',  fWeight(totalPowder));
    set('stat-otherCosts',      '₹' + fNum(totalOther));
    set('stat-totalRevenue',    '₹' + fNum(totalRevenue));
    set('stat-profitLoss',      (profitLoss >= 0 ? '+' : '') + '₹' + fNum(profitLoss));

    const plEl = document.getElementById('stat-profitLoss');
    if (plEl) plEl.className = 'fw-bold fs-6 ' + (profitLoss >= 0 ? 'text-success' : 'text-danger');

    // Recent purchases (last 5)
    const rp = db.purchases.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    const rpEl = document.getElementById('recent-purchases');
    rpEl.innerHTML = rp.length === 0
        ? emptyState('fa-shopping-cart', 'No purchases yet')
        : rp.map(r => `
            <div class="card record-card">
                <div class="card-body d-flex justify-content-between align-items-center py-2">
                    <div>
                        <div class="fw-semibold small">${esc(r.product)}</div>
                        <div class="text-muted" style="font-size:0.72rem">${fDate(r.date)} &bull; ${r.quantityKg}kg</div>
                    </div>
                    <div class="text-end">
                        <div class="fw-bold text-success small">₹${fNum(r.totalCost)}</div>
                        <div class="text-muted" style="font-size:0.7rem">₹${r.pricePerKg}/kg</div>
                    </div>
                </div>
            </div>`).join('');

    // Recent production (last 5)
    const rprod = db.production.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    const rpEl2 = document.getElementById('recent-production');
    rpEl2.innerHTML = rprod.length === 0
        ? emptyState('fa-cogs', 'No production records yet')
        : rprod.map(r => `
            <div class="card record-card">
                <div class="card-body d-flex justify-content-between align-items-center py-2">
                    <div>
                        <div class="fw-semibold small">${esc(r.product)}</div>
                        <div class="text-muted" style="font-size:0.72rem">${fDate(r.date)} &bull; ${r.rawMaterialKg}kg raw</div>
                    </div>
                    <div class="text-end">
                        <div class="fw-bold text-primary small">${fWeight(r.powderYieldGrams)}</div>
                        <span class="yield-badge">${r.yieldPercent}% yield</span>
                    </div>
                </div>
            </div>`).join('');

    // Recent sales (last 5)
    const rsales = db.sales.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    const rsEl = document.getElementById('recent-sales');
    if (rsEl) {
        rsEl.innerHTML = rsales.length === 0
            ? emptyState('fa-tags', 'No sales yet')
            : rsales.map(r => `
                <div class="card record-card">
                    <div class="card-body d-flex justify-content-between align-items-center py-2">
                        <div>
                            <div class="fw-semibold small">${esc(r.product)}</div>
                            <div class="text-muted" style="font-size:0.72rem">${fDate(r.date)}${r.customer ? ' &bull; ' + esc(r.customer) : ''}</div>
                        </div>
                        <div class="text-end">
                            <div class="fw-bold text-success small">₹${fNum(r.totalRevenue)}</div>
                            <div class="text-muted" style="font-size:0.7rem">${fWeight(r.quantityGrams)}</div>
                        </div>
                    </div>
                </div>`).join('');
    }
}

// ============================================================
//  RENDER — PURCHASES
// ============================================================
function renderPurchases() {
    const el = document.getElementById('purchases-list');
    if (!el) return;

    if (db.purchases.length === 0) {
        el.innerHTML = `<div class="empty-state">
            <i class="fas fa-shopping-cart d-block"></i>
            <p class="mb-2">No purchase records yet</p>
            <button class="btn btn-success btn-sm" onclick="openModal('purchase')">Add First Purchase</button>
        </div>`;
        return;
    }

    const sorted = db.purchases.slice().sort((a, b) => b.date.localeCompare(a.date));
    el.innerHTML = sorted.map(r => `
        <div class="card record-card">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start mb-1">
                    <div>
                        <div class="fw-semibold">${esc(r.product)}</div>
                        <div class="text-muted small">${fDate(r.date)}${r.supplier ? ' &bull; ' + esc(r.supplier) : ''}</div>
                    </div>
                    <div class="text-end ms-2">
                        <div class="fw-bold text-success">₹${fNum(r.totalCost)}</div>
                    </div>
                </div>
                <div class="d-flex justify-content-between align-items-center flex-wrap gap-1">
                    <div>
                        <span class="badge bg-light text-dark border me-1">${r.quantityKg} kg</span>
                        <span class="badge bg-light text-dark border">₹${r.pricePerKg}/kg</span>
                        ${r.notes ? '<div class="text-muted small mt-1">' + esc(r.notes) + '</div>' : ''}
                    </div>
                    <div class="d-flex gap-1">
                        <button class="btn btn-outline-primary btn-sm" onclick="openModal('purchase','${r.id}')">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button class="btn btn-outline-danger btn-sm" onclick="deleteRecord('purchase','${r.id}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>`).join('');
}

// ============================================================
//  RENDER — PRODUCTION
// ============================================================
function renderProduction() {
    const el = document.getElementById('production-list');
    if (!el) return;

    if (db.production.length === 0) {
        el.innerHTML = `<div class="empty-state">
            <i class="fas fa-cogs d-block"></i>
            <p class="mb-2">No production records yet</p>
            <button class="btn btn-primary btn-sm" onclick="openModal('production')">Add First Production</button>
        </div>`;
        return;
    }

    const sorted = db.production.slice().sort((a, b) => b.date.localeCompare(a.date));
    el.innerHTML = sorted.map(r => `
        <div class="card record-card">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <div>
                        <div class="fw-semibold">${esc(r.product)}</div>
                        <div class="text-muted small">${fDate(r.date)}</div>
                    </div>
                    <span class="yield-badge ms-2">${r.yieldPercent}% yield</span>
                </div>
                <div class="row g-1 mb-2">
                    <div class="col-4">
                        <div class="mini-block">
                            <div class="label">Raw Material</div>
                            <div class="value">${r.rawMaterialKg} kg</div>
                        </div>
                    </div>
                    <div class="col-4">
                        <div class="mini-block">
                            <div class="label">Powder</div>
                            <div class="value text-primary">${fWeight(r.powderYieldGrams)}</div>
                        </div>
                    </div>
                    <div class="col-4">
                        <div class="mini-block">
                            <div class="label">Machine</div>
                            <div class="value">${r.machineHours}h ${r.machineMinutes}m</div>
                        </div>
                    </div>
                </div>
                ${r.notes ? '<div class="text-muted small mb-2">' + esc(r.notes) + '</div>' : ''}
                <div class="d-flex justify-content-end gap-1">
                    <button class="btn btn-outline-primary btn-sm" onclick="openModal('production','${r.id}')">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="btn btn-outline-danger btn-sm" onclick="deleteRecord('production','${r.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        </div>`).join('');
}

// ============================================================
//  RENDER — COSTS
// ============================================================
const CAT_COLORS = {
    Machine:'primary', Grinder:'info', Dryer:'info',
    Container:'secondary', Labor:'warning', Electricity:'danger',
    Rent:'dark', Transport:'success', Marketing:'purple', Other:'secondary'
};

function renderCosts() {
    const el = document.getElementById('costs-list');
    if (!el) return;

    if (db.costs.length === 0) {
        el.innerHTML = `<div class="empty-state">
            <i class="fas fa-coins d-block"></i>
            <p class="mb-2">No cost records yet</p>
            <button class="btn btn-warning btn-sm" onclick="openModal('cost')">Add First Cost</button>
        </div>`;
        return;
    }

    const sorted = db.costs.slice().sort((a, b) => b.date.localeCompare(a.date));
    el.innerHTML = sorted.map(r => `
        <div class="card record-card">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start mb-1">
                    <div>
                        <div class="fw-semibold">${esc(r.itemName)}</div>
                        <div class="text-muted small">${fDate(r.date)}</div>
                    </div>
                    <div class="fw-bold text-danger ms-2">₹${fNum(r.amount)}</div>
                </div>
                <div class="d-flex justify-content-between align-items-center flex-wrap gap-1">
                    <div>
                        <span class="badge bg-${CAT_COLORS[r.category] || 'secondary'}">${r.category}</span>
                        ${r.notes ? '<div class="text-muted small mt-1">' + esc(r.notes) + '</div>' : ''}
                    </div>
                    <div class="d-flex gap-1">
                        <button class="btn btn-outline-primary btn-sm" onclick="openModal('cost','${r.id}')">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button class="btn btn-outline-danger btn-sm" onclick="deleteRecord('cost','${r.id}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>`).join('');
}

// ============================================================
//  RENDER — SALES
// ============================================================
function renderSales() {
    const el = document.getElementById('sales-list');
    if (!el) return;

    if (db.sales.length === 0) {
        el.innerHTML = `<div class="empty-state">
            <i class="fas fa-tags d-block"></i>
            <p class="mb-2">No sales records yet</p>
            <button class="btn btn-success btn-sm" onclick="openModal('sale')">Add First Sale</button>
        </div>`;
        return;
    }

    const sorted = db.sales.slice().sort((a, b) => b.date.localeCompare(a.date));
    el.innerHTML = sorted.map(r => `
        <div class="card record-card">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start mb-1">
                    <div>
                        <div class="fw-semibold">${esc(r.product)}</div>
                        <div class="text-muted small">${fDate(r.date)}${r.customer ? ' &bull; ' + esc(r.customer) : ''}</div>
                    </div>
                    <div class="text-end ms-2">
                        <div class="fw-bold text-success">₹${fNum(r.totalRevenue)}</div>
                    </div>
                </div>
                <div class="d-flex justify-content-between align-items-center flex-wrap gap-1">
                    <div>
                        <span class="badge bg-light text-dark border me-1">${r.quantitySold} ${r.unit}</span>
                        <span class="badge bg-light text-dark border">₹${((r.totalRevenue / (r.quantityGrams || 1)) * 100).toFixed(0)}/100g</span>
                        ${r.notes ? '<div class="text-muted small mt-1">' + esc(r.notes) + '</div>' : ''}
                    </div>
                    <div class="d-flex gap-1">
                        <button class="btn btn-outline-primary btn-sm" onclick="openModal('sale','${r.id}')">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button class="btn btn-outline-danger btn-sm" onclick="deleteRecord('sale','${r.id}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>`).join('');
}

// ============================================================
//  REPORTS — filter + summary
// ============================================================
function getFiltered() {
    const type  = val('report-type');
    const start = val('report-startDate');
    const end   = val('report-endDate');

    const byDate = arr => arr.filter(r => {
        if (start && r.date < start) return false;
        if (end   && r.date > end)   return false;
        return true;
    });

    return {
        purchases:  (type === 'all' || type === 'purchases')  ? byDate(db.purchases)  : [],
        production: (type === 'all' || type === 'production') ? byDate(db.production) : [],
        costs:      (type === 'all' || type === 'costs')      ? byDate(db.costs)      : [],
        sales:      (type === 'all' || type === 'sales')      ? byDate(db.sales)      : []
    };
}

function updateReportSummary() {
    const d   = getFiltered();
    const el  = document.getElementById('report-summary');
    if (!el) return;

    const tPurch   = d.purchases.reduce((s, r) => s + r.totalCost, 0);
    const tCost    = d.costs.reduce((s, r) => s + r.amount, 0);
    const tPowder  = d.production.reduce((s, r) => s + r.powderYieldGrams, 0);
    const tRevenue = d.sales.reduce((s, r) => s + r.totalRevenue, 0);
    const tInvest  = tPurch + tCost;
    const profit   = tRevenue - tInvest;

    el.innerHTML = `
        <div class="row g-2">
            <div class="col-6">
                <div class="bg-light rounded p-2 text-center">
                    <div class="text-muted small">Purchases</div>
                    <div class="fw-bold text-primary">₹${fNum(tPurch)}</div>
                    <div class="text-muted" style="font-size:0.72rem">${d.purchases.length} records</div>
                </div>
            </div>
            <div class="col-6">
                <div class="bg-light rounded p-2 text-center">
                    <div class="text-muted small">Other Costs</div>
                    <div class="fw-bold text-danger">₹${fNum(tCost)}</div>
                    <div class="text-muted" style="font-size:0.72rem">${d.costs.length} records</div>
                </div>
            </div>
            <div class="col-6">
                <div class="bg-light rounded p-2 text-center">
                    <div class="text-muted small">Total Investment</div>
                    <div class="fw-bold text-dark">₹${fNum(tInvest)}</div>
                    <div class="text-muted" style="font-size:0.72rem">buy + costs</div>
                </div>
            </div>
            <div class="col-6">
                <div class="bg-light rounded p-2 text-center">
                    <div class="text-muted small">Revenue (Sales)</div>
                    <div class="fw-bold text-success">₹${fNum(tRevenue)}</div>
                    <div class="text-muted" style="font-size:0.72rem">${d.sales.length} orders</div>
                </div>
            </div>
            <div class="col-6">
                <div class="bg-light rounded p-2 text-center">
                    <div class="text-muted small">Profit / Loss</div>
                    <div class="fw-bold ${profit >= 0 ? 'text-success' : 'text-danger'}">${profit >= 0 ? '+' : ''}₹${fNum(profit)}</div>
                    <div class="text-muted" style="font-size:0.72rem">revenue − invest</div>
                </div>
            </div>
            <div class="col-6">
                <div class="bg-light rounded p-2 text-center">
                    <div class="text-muted small">Powder Made</div>
                    <div class="fw-bold text-warning">${fWeight(tPowder)}</div>
                    <div class="text-muted" style="font-size:0.72rem">${d.production.length} runs</div>
                </div>
            </div>
        </div>`;
}

// ============================================================
//  EXPORT — CSV
// ============================================================
function exportCSV() {
    const d = getFiltered();
    let csv = '\uFEFF'; // BOM for Excel

    if (d.purchases.length > 0) {
        csv += 'PURCHASES\n';
        csv += 'Date,Product,Quantity (kg),Price per kg (Rs),Total Cost (Rs),Supplier,Notes\n';
        d.purchases.forEach(r => {
            csv += `${r.date},"${r.product}",${r.quantityKg},${r.pricePerKg},${r.totalCost},"${r.supplier||''}","${r.notes||''}"\n`;
        });
        csv += '\n';
    }

    if (d.production.length > 0) {
        csv += 'PRODUCTION\n';
        csv += 'Date,Product,Raw Material (kg),Powder Yield (g),Yield %,Machine Hours,Machine Minutes,Notes\n';
        d.production.forEach(r => {
            csv += `${r.date},"${r.product}",${r.rawMaterialKg},${r.powderYieldGrams},${r.yieldPercent},${r.machineHours},${r.machineMinutes},"${r.notes||''}"\n`;
        });
        csv += '\n';
    }

    if (d.costs.length > 0) {
        csv += 'COSTS\n';
        csv += 'Date,Category,Item Name,Amount (Rs),Notes\n';
        d.costs.forEach(r => {
            csv += `${r.date},"${r.category}","${r.itemName}",${r.amount},"${r.notes||''}"\n`;
        });
    }

    if (d.sales.length > 0) {
        csv += '\nSALES\n';
        csv += 'Date,Product,Quantity Sold,Unit,Total Revenue (Rs),Rate per 100g (Rs),Customer,Notes\n';
        d.sales.forEach(r => {
            const rate = r.quantityGrams > 0 ? ((r.totalRevenue / r.quantityGrams) * 100).toFixed(2) : '';
            csv += `${r.date},"${r.product}",${r.quantitySold},"${r.unit}",${r.totalRevenue},${rate},"${r.customer||''}","${r.notes||''}"\n`;
        });
    }

    if (csv.trim() === '\uFEFF') { toast('No data to export!', 'warning'); return; }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    dlBlob(blob, `DriedDepot_${today()}.csv`);
    toast('CSV exported!', 'success');
}

// ============================================================
//  EXPORT — PDF
// ============================================================
function exportPDF() {
    const d = getFiltered();
    if (!d.purchases.length && !d.production.length && !d.costs.length && !d.sales.length) {
        toast('No data to export!', 'warning');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

    // Header
    doc.setFontSize(22);
    doc.setTextColor(45, 106, 79);
    doc.text('Dried Depot', 14, 20);
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text('Report generated: ' + new Date().toLocaleDateString('en-IN', {day:'numeric',month:'long',year:'numeric'}), 14, 27);

    let y = 36;

    // Summary table
    const tPurch  = d.purchases.reduce((s, r) => s + r.totalCost, 0);
    const tCost   = d.costs.reduce((s, r) => s + r.amount, 0);
    const tPowder = d.production.reduce((s, r) => s + r.powderYieldGrams, 0);

    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text('Summary', 14, y); y += 3;

    doc.autoTable({
        startY: y,
        head: [['Metric', 'Value']],
        body: [
            ['Total Raw Material Cost', 'Rs ' + fNum(tPurch)],
            ['Total Other Costs',       'Rs ' + fNum(tCost)],
            ['Total Investment',        'Rs ' + fNum(tPurch + tCost)],
            ['Total Powder Produced',   fWeight(tPowder)],
            ['Production Runs',         String(d.production.length)],
        ],
        theme: 'striped',
        headStyles: { fillColor: [45, 106, 79] },
        margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 12;

    // Purchases
    if (d.purchases.length > 0) {
        if (y > 230) { doc.addPage(); y = 20; }
        doc.setFontSize(11);
        doc.text('Purchases', 14, y); y += 3;
        doc.autoTable({
            startY: y,
            head: [['Date', 'Product', 'Qty (kg)', 'Price/kg', 'Total (Rs)', 'Supplier']],
            body: d.purchases.map(r => [
                fDate(r.date), r.product, r.quantityKg + ' kg',
                'Rs ' + r.pricePerKg, 'Rs ' + fNum(r.totalCost), r.supplier || ''
            ]),
            theme: 'striped',
            headStyles: { fillColor: [45, 106, 79] },
            margin: { left: 14, right: 14 }
        });
        y = doc.lastAutoTable.finalY + 12;
    }

    // Production
    if (d.production.length > 0) {
        if (y > 230) { doc.addPage(); y = 20; }
        doc.setFontSize(11);
        doc.text('Production', 14, y); y += 3;
        doc.autoTable({
            startY: y,
            head: [['Date', 'Product', 'Raw (kg)', 'Powder', 'Yield %', 'Machine Time']],
            body: d.production.map(r => [
                fDate(r.date), r.product, r.rawMaterialKg + ' kg',
                fWeight(r.powderYieldGrams), r.yieldPercent + '%',
                r.machineHours + 'h ' + r.machineMinutes + 'm'
            ]),
            theme: 'striped',
            headStyles: { fillColor: [21, 101, 192] },
            margin: { left: 14, right: 14 }
        });
        y = doc.lastAutoTable.finalY + 12;
    }

    // Costs
    if (d.costs.length > 0) {
        if (y > 230) { doc.addPage(); y = 20; }
        doc.setFontSize(11);
        doc.text('Costs & Investments', 14, y); y += 3;
        doc.autoTable({
            startY: y,
            head: [['Date', 'Category', 'Item', 'Amount (Rs)', 'Notes']],
            body: d.costs.map(r => [
                fDate(r.date), r.category, r.itemName, 'Rs ' + fNum(r.amount), r.notes || ''
            ]),
            theme: 'striped',
            headStyles: { fillColor: [245, 127, 23] },
            margin: { left: 14, right: 14 }
        });
        y = doc.lastAutoTable.finalY + 12;
    }

    // Sales
    if (d.sales.length > 0) {
        if (y > 230) { doc.addPage(); y = 20; }
        doc.setFontSize(11);
        doc.text('Sales', 14, y); y += 3;
        doc.autoTable({
            startY: y,
            head: [['Date', 'Product', 'Qty Sold', 'Revenue (Rs)', 'Rate/100g', 'Customer']],
            body: d.sales.map(r => {
                const rate = r.quantityGrams > 0 ? 'Rs ' + ((r.totalRevenue / r.quantityGrams) * 100).toFixed(2) : '';
                return [fDate(r.date), r.product, r.quantitySold + ' ' + r.unit,
                    'Rs ' + fNum(r.totalRevenue), rate, r.customer || ''];
            }),
            theme: 'striped',
            headStyles: { fillColor: [0, 121, 107] },
            margin: { left: 14, right: 14 }
        });
        y = doc.lastAutoTable.finalY + 12;

        // Profit summary at bottom
        const tRevenue = d.sales.reduce((s, r) => s + r.totalRevenue, 0);
        const tInvest  = d.purchases.reduce((s, r) => s + r.totalCost, 0) + d.costs.reduce((s, r) => s + r.amount, 0);
        const profit   = tRevenue - tInvest;
        if (y > 230) { doc.addPage(); y = 20; }
        doc.setFontSize(11);
        doc.text('Profit / Loss Summary', 14, y); y += 3;
        doc.autoTable({
            startY: y,
            head: [['Item', 'Amount']],
            body: [
                ['Total Investment (Purchases + Costs)', 'Rs ' + fNum(tInvest)],
                ['Total Revenue (Sales)',                'Rs ' + fNum(tRevenue)],
                ['Net Profit / Loss',                   (profit >= 0 ? '+' : '') + 'Rs ' + fNum(profit)],
            ],
            theme: 'striped',
            headStyles: { fillColor: [45, 106, 79] },
            margin: { left: 14, right: 14 }
        });
    }

    doc.save(`DriedDepot_${today()}.pdf`);
    toast('PDF exported!', 'success');
}

// ============================================================
//  UTILITIES
// ============================================================
function val(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}
function set(id, v) {
    const el = document.getElementById(id);
    if (el) el.value = v;
}
function upsert(arr, id, record) {
    if (id) {
        const i = arr.findIndex(r => r.id === id);
        if (i >= 0) { arr[i] = record; return; }
    }
    arr.unshift(record);
}
function hideModal(id) {
    const m = bootstrap.Modal.getInstance(document.getElementById(id));
    if (m) m.hide();
}
function fNum(n) {
    return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function fDate(s) {
    if (!s) return '';
    const d = new Date(s + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fWeight(grams) {
    const g = grams || 0;
    return g >= 1000 ? (g / 1000).toFixed(2) + ' kg' : g + ' g';
}
function today() {
    return new Date().toISOString().split('T')[0];
}
function esc(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function titleCase(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
function emptyState(icon, text) {
    return `<div class="empty-state py-3">
        <i class="fas ${icon} d-block" style="font-size:1.8rem;opacity:0.2;margin-bottom:8px"></i>
        <small class="text-muted">${text}</small>
    </div>`;
}
function dlBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
}
function toast(msg, type = 'success') {
    const el  = document.getElementById('appToast');
    const txt = document.getElementById('toastMessage');
    el.className = 'toast align-items-center text-white border-0';
    const map = { success:'bg-success', danger:'bg-danger', warning:'bg-warning text-dark', info:'bg-info' };
    el.classList.add(map[type] || 'bg-success');
    txt.textContent = msg;
    new bootstrap.Toast(el, { delay: 2200 }).show();
}
function updateProductDatalist() {
    const names = [...new Set([
        ...db.purchases.map(r => r.product),
        ...db.production.map(r => r.product)
    ])];
    const dl = document.getElementById('product-datalist');
    if (dl) dl.innerHTML = names.map(n => `<option value="${esc(n)}">`).join('');
}

// ============================================================
//  FIREBASE — real-time sync
// ============================================================
function arrToObj(arr) {
    const o = {};
    (arr || []).forEach(r => { o[r.id] = r; });
    return o;
}
function objToArr(obj) {
    return obj ? Object.values(obj) : [];
}

function autoConnectFirebase() {
    const cfg  = localStorage.getItem('dd_fb_cfg');
    const key  = localStorage.getItem('dd_fb_key');
    if (cfg && key) {
        try { connectFirebase(JSON.parse(cfg), key); } catch(e) {}
    }
}

function connectFirebase(config, key) {
    try {
        if (!window.firebase) { setSyncStatus('error'); return false; }
        if (!firebase.apps.length) firebase.initializeApp(config);
        fbDB      = firebase.database();
        fbSyncKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');  // sanitize key
        setSyncStatus('syncing');
        // Pull once on connect, then push local data up if Firebase is empty
        pullFromFirebase().then(() => {
            fbConnected = true;
            setSyncStatus('synced');
            renderDashboard();
            updateProductDatalist();
        });
        return true;
    } catch(e) {
        setSyncStatus('error');
        return false;
    }
}

async function pushToFirebase() {
    if (!fbDB || !fbSyncKey) return;
    setSyncStatus('syncing');
    try {
        await fbDB.ref('dd/' + fbSyncKey).set({
            purchases:  arrToObj(db.purchases),
            production: arrToObj(db.production),
            costs:      arrToObj(db.costs),
            sales:      arrToObj(db.sales),
            _updated:   Date.now()
        });
        setSyncStatus('synced');
    } catch(e) {
        setSyncStatus('error');
        toast('Sync failed — data saved locally', 'warning');
    }
}

async function pullFromFirebase() {
    if (!fbDB || !fbSyncKey) return;
    setSyncStatus('syncing');
    try {
        const snap = await fbDB.ref('dd/' + fbSyncKey).once('value');
        const data = snap.val();
        if (data) {
            db.purchases  = objToArr(data.purchases);
            db.production = objToArr(data.production);
            db.costs      = objToArr(data.costs);
            db.sales      = objToArr(data.sales);
            saveAllLocal();
        } else {
            // Firebase is empty — push local data up
            await pushToFirebase();
        }
        setSyncStatus('synced');
    } catch(e) {
        setSyncStatus('error');
    }
}

function setSyncStatus(status) {
    const badge = document.getElementById('syncBadge');
    const label = document.getElementById('syncStatusLabel');
    if (!badge) return;

    badge.classList.remove('d-none');
    badge.className = 'sync-badge ' + status;

    if (label) {
        const map = { synced:'Connected ✓', syncing:'Syncing…', error:'Sync error' };
        label.textContent = map[status] || status;
        const colors = { synced:'bg-success', syncing:'bg-warning text-dark', error:'bg-danger' };
        label.className = 'badge ' + (colors[status] || 'bg-secondary');
    }
}

function openSyncSetup() {
    const cfg = localStorage.getItem('dd_fb_cfg');
    const key = localStorage.getItem('dd_fb_key');
    if (cfg) {
        try { document.getElementById('sync-config').value = JSON.stringify(JSON.parse(cfg), null, 2); } catch(e) {}
    }
    if (key) document.getElementById('sync-key').value = key;
    document.getElementById('syncTestResult').classList.add('d-none');
    new bootstrap.Modal(document.getElementById('syncModal')).show();
}

function saveAndConnectFirebase() {
    const rawCfg = document.getElementById('sync-config').value.trim();
    const key    = document.getElementById('sync-key').value.trim();
    const resEl  = document.getElementById('syncTestResult');

    if (!rawCfg || !key) {
        resEl.className = 'alert alert-danger small';
        resEl.textContent = 'Both fields are required.';
        resEl.classList.remove('d-none');
        return;
    }

    let config;
    try {
        // Accept both plain object and the full "const firebaseConfig = {...}" format
        const jsonStr = rawCfg.replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, '$1');
        config = JSON.parse(jsonStr);
    } catch(e) {
        resEl.className = 'alert alert-danger small';
        resEl.textContent = 'Invalid JSON. Copy the config object exactly from Firebase console.';
        resEl.classList.remove('d-none');
        return;
    }

    if (!config.databaseURL) {
        resEl.className = 'alert alert-warning small';
        resEl.textContent = 'Missing databaseURL. Make sure you enabled Realtime Database in Firebase and the config includes "databaseURL".';
        resEl.classList.remove('d-none');
        return;
    }

    localStorage.setItem('dd_fb_cfg', JSON.stringify(config));
    localStorage.setItem('dd_fb_key', key);

    resEl.className = 'alert alert-info small';
    resEl.textContent = 'Connecting…';
    resEl.classList.remove('d-none');

    const ok = connectFirebase(config, key);
    if (ok) {
        resEl.className = 'alert alert-success small';
        resEl.textContent = '✓ Connected! Your data will now sync across all devices using the same key.';
        setTimeout(() => bootstrap.Modal.getInstance(document.getElementById('syncModal'))?.hide(), 1500);
    } else {
        resEl.className = 'alert alert-danger small';
        resEl.textContent = 'Connection failed. Check the config and try again.';
    }
}

// ============================================================
//  PWA INSTALL
// ============================================================
function installPWA() {
    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then(() => {
            deferredInstallPrompt = null;
            dismissInstall();
        });
    }
}
function dismissInstall() {
    const b = document.getElementById('installBanner');
    if (b) b.classList.add('d-none');
}

// ============================================================
//  BACKUP & RESTORE — transfer data between devices
// ============================================================
function backupData() {
    const backup = {
        version:    1,
        exportedAt: new Date().toISOString(),
        purchases:  db.purchases,
        production: db.production,
        costs:      db.costs,
        sales:      db.sales
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    dlBlob(blob, `DriedDepot_backup_${today()}.json`);
    toast('Backup downloaded!', 'success');
}

function restoreData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.purchases && !data.production && !data.costs && !data.sales) {
                toast('Invalid backup file!', 'danger');
                return;
            }
            // Merge: add records that don't already exist (by id)
            const merge = (existing, incoming) => {
                const ids = new Set(existing.map(r => r.id));
                return [...existing, ...(incoming || []).filter(r => !ids.has(r.id))];
            };
            db.purchases  = merge(db.purchases,  data.purchases);
            db.production = merge(db.production, data.production);
            db.costs      = merge(db.costs,      data.costs);
            db.sales      = merge(db.sales,      data.sales);
            saveAll();
            renderDashboard();
            renderPurchases();
            renderProduction();
            renderCosts();
            renderSales();
            updateProductDatalist();
            toast('Data restored successfully!', 'success');
        } catch {
            toast('Could not read file!', 'danger');
        }
        // Reset input so same file can be picked again
        event.target.value = '';
    };
    reader.readAsText(file);
}
