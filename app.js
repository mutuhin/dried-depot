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

const MACHINE_RATE_PER_HOUR = 9 / 24; // 9 taka per 24 hours = 0.375 ৳/hour

function machineCost(r) {
    return ((r.machineHours || 0) + (r.machineMinutes || 0) / 60) * MACHINE_RATE_PER_HOUR;
}

let db = { purchases: [], production: [], costs: [], sales: [] };
let pendingDelete = { type: null, id: null };

// ============================================================
//  FIREBASE SYNC STATE
// ============================================================
let fbDbUrl     = '';
let fbSyncKey   = '';
let fbConnected = false;
let deferredInstallPrompt = null;

// ============================================================
//  INIT
// ============================================================
const CURRENT_VERSION = '14'; // Update this when deploying new features

document.addEventListener('DOMContentLoaded', () => {
    loadAll();
    setDefaultDates();
    updateCurrentDate();
    renderDashboard();
    updateProductDatalist();

    // Check for new version every 5 seconds
    setInterval(checkForUpdates, 5000);
    checkForUpdates(); // Check immediately on load

    // Re-render report summary when filters change
    ['report-type','report-startDate','report-endDate'].forEach(id => {
        document.getElementById(id).addEventListener('change', updateReportSummary);
    });

    // Service worker registration (PWA)
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
        // SW posts SW_UPDATED message when it activates — most reliable across all scenarios
        navigator.serviceWorker.addEventListener('message', e => {
            if (e.data && e.data.type === 'SW_UPDATED') showUpdateBanner();
        });
        // Backup: fires when controller changes (skipWaiting)
        let hadController = !!navigator.serviceWorker.controller;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (hadController) showUpdateBanner();
            hadController = true;
        });
    }

    // PWA install prompt (Android/Chrome)
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        deferredInstallPrompt = e;
        const banner = document.getElementById('installBanner');
        if (banner) banner.classList.remove('d-none');
    });

    // Check for updates every 5 seconds
    setInterval(checkForUpdates, 5000);

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
        set('sale-id', r ? r.id : '');
        set('sale-date', r ? r.date : new Date().toISOString().split('T')[0]);
        set('sale-customer', r ? (r.customer || '') : '');
        set('sale-notes', r ? (r.notes || '') : '');

        // Initialize products list
        if (r && r.products && Array.isArray(r.products)) {
            saleProducts = r.products.map(p => ({ ...p }));
        } else if (r) {
            // Convert old single-product format to new format
            saleProducts = [{ product: r.product || '', quantity: r.quantitySold || 0, price: r.sellingPrice || 0 }];
        } else {
            saleProducts = [];
        }
        renderSaleProductsForm();
        calcSaleTotal();
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

let saleProducts = []; // List of products being added to current sale

function renderSaleProductsForm() {
    const container = document.getElementById('saleProductsContainer');
    if (!container) return;

    // Get list of products from production (with their names)
    const prodProducts = [...new Set(db.production.map(p => p.product))];

    container.innerHTML = saleProducts.map((p, idx) => `
        <div class="card mb-2 p-2" data-product-idx="${idx}">
            <div class="row g-2 mb-2">
                <div class="col-8">
                    <label class="form-label small mb-1">Product</label>
                    <select class="form-select form-select-sm product-name" data-idx="${idx}" onchange="updateSaleProduct(${idx})">
                        <option value="">Select product...</option>
                        ${prodProducts.map(pname => `<option value="${esc(pname)}" ${p.product === pname ? 'selected' : ''}>${esc(pname)}</option>`).join('')}
                    </select>
                </div>
                <div class="col-4">
                    <button type="button" class="btn btn-sm btn-outline-danger mt-4" onclick="removeSaleProduct(${idx})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="row g-2">
                <div class="col-6">
                    <label class="form-label small mb-1">Quantity</label>
                    <input type="number" class="form-control form-control-sm product-qty" data-idx="${idx}"
                        value="${p.quantity}" step="1" min="1" onchange="updateSaleProduct(${idx})">
                </div>
                <div class="col-6">
                    <label class="form-label small mb-1">Price (৳)</label>
                    <input type="number" class="form-control form-control-sm product-price" data-idx="${idx}"
                        value="${p.price}" step="0.01" min="0" onchange="updateSaleProduct(${idx})">
                </div>
            </div>
            <div class="mb-2">
                <label class="form-label small mb-1">Amount</label>
                <div class="d-flex gap-1 mb-1 flex-wrap">
                    <button type="button" class="btn btn-outline-secondary btn-sm" onclick="setAmount(${idx}, '10gm')">10gm</button>
                    <button type="button" class="btn btn-outline-secondary btn-sm" onclick="setAmount(${idx}, '20gm')">20gm</button>
                    <button type="button" class="btn btn-outline-secondary btn-sm" onclick="setAmount(${idx}, '50gm')">50gm</button>
                    <button type="button" class="btn btn-outline-secondary btn-sm" onclick="setAmount(${idx}, '100gm')">100gm</button>
                    <button type="button" class="btn btn-outline-secondary btn-sm" onclick="setAmount(${idx}, '200gm')">200gm</button>
                    <button type="button" class="btn btn-outline-secondary btn-sm" onclick="setAmount(${idx}, '500gm')">500gm</button>
                    <button type="button" class="btn btn-outline-secondary btn-sm" onclick="setAmount(${idx}, '1kg')">1kg</button>
                </div>
                <input type="text" class="form-control form-control-sm product-amount" data-idx="${idx}"
                    value="${p.amount || ''}" placeholder="e.g., 250gm, 1.5kg" onchange="updateSaleProduct(${idx})">
            </div>
            <div class="text-end mt-2">
                <small class="text-muted">Subtotal: <strong class="product-subtotal">৳${(p.quantity * p.price).toFixed(2)}</strong></small>
            </div>
        </div>
    `).join('');
}

function updateSaleProduct(idx) {
    const card = document.querySelector(`[data-product-idx="${idx}"]`);
    if (!card) return;

    const product = card.querySelector('.product-name').value;
    const quantity = parseFloat(card.querySelector('.product-qty').value) || 0;
    const price = parseFloat(card.querySelector('.product-price').value) || 0;
    const amount = card.querySelector('.product-amount').value;

    saleProducts[idx] = { product, quantity, price, amount };

    // Update subtotal display
    card.querySelector('.product-subtotal').textContent = '৳' + (quantity * price).toFixed(2);

    calcSaleTotal();
}

function setAmount(idx, amount) {
    const card = document.querySelector(`[data-product-idx="${idx}"]`);
    if (card) {
        card.querySelector('.product-amount').value = amount;
        updateSaleProduct(idx);
    }
}

function addSaleProduct() {
    saleProducts.push({ product: '', quantity: 1, price: 0 });
    renderSaleProductsForm();
}

function removeSaleProduct(idx) {
    saleProducts.splice(idx, 1);
    renderSaleProductsForm();
    calcSaleTotal();
}

function calcSaleTotal() {
    const total = saleProducts.reduce((sum, p) => {
        const quantity = parseFloat(p.quantity) || 0;
        const price = parseFloat(p.price) || 0;
        return sum + (quantity * price);
    }, 0);

    set('sale-total', total.toFixed(2));
    const displayEl = document.getElementById('sale-total-display');
    if (displayEl) displayEl.textContent = total.toFixed(2);
}

// Calculate total powder produced (in grams)
function getTotalPowderProduced() {
    return db.production.reduce((sum, r) => sum + (r.powderYieldGrams || 0), 0);
}

// Calculate total powder sold by product (in grams)
function getTotalPowderSoldByProduct(productName) {
    return db.sales.reduce((sum, sale) => {
        if (Array.isArray(sale.products)) {
            return sum + sale.products
                .filter(p => p.product === productName)
                .reduce((psum, p) => {
                    // Parse amount string (e.g., "100gm", "1kg", "250gm")
                    const amountStr = p.amount || '';
                    const qty = p.quantity || 1;
                    if (amountStr.includes('kg')) {
                        return psum + (parseFloat(amountStr) * 1000 * qty);
                    } else if (amountStr.includes('gm')) {
                        return psum + (parseFloat(amountStr) * qty);
                    }
                    return psum;
                }, 0);
        }
        return sum;
    }, 0);
}

// Calculate powder produced by product (in grams)
function getPowderProducedByProduct(productName) {
    return db.production
        .filter(r => r.product === productName)
        .reduce((sum, r) => sum + (r.powderYieldGrams || 0), 0);
}

// Calculate remaining powder by product
function getRemainingPowder(productName) {
    const produced = getPowderProducedByProduct(productName);
    const sold = getTotalPowderSoldByProduct(productName);
    return Math.max(0, produced - sold);
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

    // Validate that at least one product is added
    if (!saleProducts || saleProducts.length === 0) {
        toast('Please add at least one product!', 'danger');
        return;
    }

    // Validate that all products have values
    if (saleProducts.some(p => !p.product || p.quantity <= 0 || p.price < 0)) {
        toast('Please fill in all product details!', 'danger');
        return;
    }

    const id = val('sale-id');
    const total = parseFloat(val('sale-total')) || 0;

    // Calculate total amount in grams from all products
    let totalAmountGrams = 0;
    saleProducts.forEach(p => {
        const amountStr = p.amount || '';
        const qty = p.quantity || 1;
        if (amountStr.includes('kg')) {
            totalAmountGrams += parseFloat(amountStr) * 1000 * qty;
        } else if (amountStr.includes('gm')) {
            totalAmountGrams += parseFloat(amountStr) * qty;
        }
    });

    // Build product list summary for display
    const productSummary = saleProducts.map(p => `${p.quantity}${p.quantity === 1 ? 'pc' : 'pcs'} ${p.product}`).join(' + ');

    const record = {
        id:           id || uid(),
        date:         val('sale-date'),
        products:     saleProducts.map(p => ({ ...p })), // New format: products array
        // Legacy fields for compatibility
        product:      productSummary,
        quantitySold: saleProducts.reduce((sum, p) => sum + p.quantity, 0),
        unit:         'units',
        quantityGrams: totalAmountGrams,
        sellingPrice: total / Math.max(saleProducts.length, 1),
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
    const totalRaw     = db.purchases.reduce((s, r) => s + (r.totalCost || 0), 0);
    const totalOther   = db.costs.reduce((s, r) => s + (r.amount || 0), 0);
    const totalMachine = db.production.reduce((s, r) => s + machineCost(r), 0);
    const totalInvest  = totalRaw + totalOther + totalMachine;
    const totalRevenue = db.sales.reduce((s, r) => s + (r.totalRevenue || 0), 0);
    const profitLoss   = totalRevenue - totalInvest;
    const totalPowder  = getTotalPowderProduced();

    // Calculate total powder sold (in grams) - support both old and new formats
    const totalPowderSold = db.sales.reduce((sum, sale) => {
        // New format: products array
        if (Array.isArray(sale.products)) {
            return sum + sale.products.reduce((psum, p) => {
                const amountStr = p.amount || '';
                const qty = p.quantity || 1;
                if (amountStr.includes('kg')) {
                    return psum + (parseFloat(amountStr) * 1000 * qty);
                } else if (amountStr.includes('gm')) {
                    return psum + (parseFloat(amountStr) * qty);
                }
                return psum;
            }, 0);
        }
        // Old format: single product with quantityGrams
        if (sale.quantityGrams) {
            return sum + sale.quantityGrams;
        }
        return sum;
    }, 0);

    const remainingPowder = Math.max(0, totalPowder - totalPowderSold);

    set('stat-totalInvestment', '৳' + fNum(totalInvest));
    set('stat-rawCost',         '৳' + fNum(totalRaw));
    set('stat-powderProduced',  fWeight(totalPowder));
    set('stat-powderSold',      fWeight(totalPowderSold));
    set('stat-remainingPowder', fWeight(remainingPowder));
    set('stat-otherCosts',      '৳' + fNum(totalOther + totalMachine));
    set('stat-totalRevenue',    '৳' + fNum(totalRevenue));
    set('stat-profitLoss',      (profitLoss >= 0 ? '+' : '') + '৳' + fNum(profitLoss));

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
                        <div class="fw-bold text-success small">৳${fNum(r.totalCost)}</div>
                        <div class="text-muted" style="font-size:0.7rem">৳${r.pricePerKg}/kg</div>
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
                            <div class="fw-bold text-success small">৳${fNum(r.totalRevenue)}</div>
                            <div class="text-muted" style="font-size:0.7rem">${fWeight(r.quantityGrams)}</div>
                        </div>
                    </div>
                </div>`).join('');
    }

    // Product chips
    const chipsEl = document.getElementById('product-chips');
    if (chipsEl) {
        // Only use purchases and production for product names (not sales summaries)
        const names = [...new Set([
            ...db.purchases.map(r => r.product),
            ...db.production.map(r => r.product),
        ])].filter(Boolean).sort();
        chipsEl.innerHTML = names.length === 0
            ? '<small class="text-muted">No products yet</small>'
            : names.map(n => `<button class="btn btn-outline-success btn-sm rounded-pill px-3" onclick="openProductDetail('${esc(n)}')">${esc(n)}</button>`).join('');
    }
}

// ============================================================
//  PRODUCT DETAIL VIEW
// ============================================================
function openProductDetail(name) {
    const p = db.purchases.filter(r => r.product === name).sort((a,b) => b.date.localeCompare(a.date));
    const prod = db.production.filter(r => r.product === name).sort((a,b) => b.date.localeCompare(a.date));

    // Find all sales that include this product (new multi-product format + old format)
    const s = db.sales.filter(r => {
        if (Array.isArray(r.products)) {
            return r.products.some(p => p.product === name);
        }
        return r.product === name;
    }).sort((a,b) => b.date.localeCompare(a.date));

    const totalBought  = p.reduce((t, r) => t + (r.quantityKg || 0), 0);
    const totalCost    = p.reduce((t, r) => t + (r.totalCost || 0), 0);
    const totalMachine = prod.reduce((t, r) => t + machineCost(r), 0);
    const totalPowder  = prod.reduce((t, r) => t + (r.powderYieldGrams || 0), 0);

    // Calculate revenue only for this product's share
    const totalRevenue = s.reduce((t, r) => {
        if (Array.isArray(r.products)) {
            const item = r.products.find(p => p.product === name);
            return t + (item ? item.quantity * item.price : 0);
        }
        return t + (r.totalRevenue || 0);
    }, 0);

    const profit = totalRevenue - (totalCost + totalMachine);

    document.getElementById('productDetailTitle').textContent = name;

    document.getElementById('productDetailStats').innerHTML = `
        <div class="col-6"><div class="card border-0 bg-light p-2 text-center">
            <div class="text-muted" style="font-size:0.7rem">Bought</div>
            <div class="fw-bold text-success small">${totalBought} kg</div>
        </div></div>
        <div class="col-6"><div class="card border-0 bg-light p-2 text-center">
            <div class="text-muted" style="font-size:0.7rem">Purchase Cost</div>
            <div class="fw-bold text-success small">৳${fNum(totalCost)}</div>
        </div></div>
        <div class="col-6"><div class="card border-0 bg-light p-2 text-center">
            <div class="text-muted" style="font-size:0.7rem">Machine Cost</div>
            <div class="fw-bold text-danger small">৳${fNum(totalMachine)}</div>
        </div></div>
        <div class="col-6"><div class="card border-0 bg-light p-2 text-center">
            <div class="text-muted" style="font-size:0.7rem">Powder Made</div>
            <div class="fw-bold text-primary small">${fWeight(totalPowder)}</div>
        </div></div>
        <div class="col-6"><div class="card border-0 bg-light p-2 text-center">
            <div class="text-muted" style="font-size:0.7rem">Revenue</div>
            <div class="fw-bold text-success small">৳${fNum(totalRevenue)}</div>
        </div></div>
        <div class="col-12"><div class="card border-0 p-2 text-center ${profit >= 0 ? 'bg-success bg-opacity-10' : 'bg-danger bg-opacity-10'}">
            <div class="text-muted" style="font-size:0.7rem">Profit / Loss</div>
            <div class="fw-bold ${profit >= 0 ? 'text-success' : 'text-danger'}">${profit >= 0 ? '+' : ''}৳${fNum(profit)}</div>
        </div></div>`;

    const noRec = '<div class="text-muted small ps-1">No records</div>';

    document.getElementById('productDetailPurchases').innerHTML = p.length === 0 ? noRec : p.map(r => `
        <div class="card record-card mb-1">
            <div class="card-body d-flex justify-content-between align-items-center py-2">
                <div class="text-muted small">${fDate(r.date)}${r.supplier ? ' &bull; ' + esc(r.supplier) : ''}</div>
                <div class="text-end">
                    <div class="fw-bold text-success small">৳${fNum(r.totalCost)}</div>
                    <div class="text-muted" style="font-size:0.7rem">${r.quantityKg} kg &bull; ৳${r.pricePerKg}/kg</div>
                </div>
            </div>
        </div>`).join('');

    document.getElementById('productDetailProduction').innerHTML = prod.length === 0 ? noRec : prod.map(r => `
        <div class="card record-card mb-1">
            <div class="card-body py-2">
                <div class="d-flex justify-content-between align-items-center">
                    <div class="text-muted small">${fDate(r.date)}</div>
                    <span class="yield-badge">${r.yieldPercent}% yield</span>
                </div>
                <div class="d-flex gap-2 mt-1 flex-wrap" style="font-size:0.72rem">
                    <span class="text-muted">${r.rawMaterialKg} kg raw → ${fWeight(r.powderYieldGrams)}</span>
                    <span class="badge bg-light text-dark border"><i class="fas fa-clock me-1"></i>${r.machineHours || 0}h ${r.machineMinutes || 0}m</span>
                </div>
            </div>
        </div>`).join('');

    document.getElementById('productDetailSales').innerHTML = s.length === 0 ? noRec : s.map(r => {
        let itemRevenue = r.totalRevenue || 0;
        let itemAmount = '';
        if (Array.isArray(r.products)) {
            const item = r.products.find(p => p.product === name);
            if (item) {
                itemRevenue = item.quantity * item.price;
                const qty = item.quantity || 1;
                const amt = item.amount || '';
                itemAmount = qty > 1 && amt ? `${qty} x ${amt}` : amt || `${qty} pc`;
            }
        } else {
            itemAmount = fWeight(r.quantityGrams);
        }
        return `
        <div class="card record-card mb-1">
            <div class="card-body d-flex justify-content-between align-items-center py-2">
                <div>
                    <div class="text-muted small">${fDate(r.date)}${r.customer ? ' &bull; ' + esc(r.customer) : ''}</div>
                    <div class="text-muted" style="font-size:0.7rem">${itemAmount}</div>
                </div>
                <div class="fw-bold text-success small">৳${fNum(itemRevenue)}</div>
            </div>
        </div>`;
    }).join('');

    new bootstrap.Modal(document.getElementById('productDetailModal')).show();
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
                        <div class="fw-bold text-success">৳${fNum(r.totalCost)}</div>
                    </div>
                </div>
                <div class="d-flex justify-content-between align-items-center flex-wrap gap-1">
                    <div>
                        <span class="badge bg-light text-dark border me-1">${r.quantityKg} kg</span>
                        <span class="badge bg-light text-dark border">৳${r.pricePerKg}/kg</span>
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
                    <div class="col-3">
                        <div class="mini-block">
                            <div class="label">Raw</div>
                            <div class="value">${r.rawMaterialKg} kg</div>
                        </div>
                    </div>
                    <div class="col-3">
                        <div class="mini-block">
                            <div class="label">Powder</div>
                            <div class="value text-primary">${fWeight(r.powderYieldGrams)}</div>
                        </div>
                    </div>
                    <div class="col-3">
                        <div class="mini-block">
                            <div class="label">Machine</div>
                            <div class="value">${r.machineHours || 0}h ${r.machineMinutes || 0}m</div>
                        </div>
                    </div>
                    <div class="col-3">
                        <div class="mini-block">
                            <div class="label">Run Cost</div>
                            <div class="value text-danger">৳${fNum(machineCost(r))}</div>
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
                    <div class="fw-bold text-danger ms-2">৳${fNum(r.amount)}</div>
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
    el.innerHTML = sorted.map(r => {
        // Build product details string
        let productDetails = '';
        if (Array.isArray(r.products) && r.products.length > 0) {
            productDetails = r.products.map(p => `${p.amount || p.quantity + 'pc'} ${p.product}`).join(', ');
        } else {
            productDetails = r.product;
        }

        return `
        <div class="card record-card">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start mb-1">
                    <div>
                        <div class="fw-semibold">${esc(productDetails)}</div>
                        <div class="text-muted small">${fDate(r.date)}${r.customer ? ' &bull; ' + esc(r.customer) : ''}</div>
                    </div>
                    <div class="text-end ms-2">
                        <div class="fw-bold text-success">৳${fNum(r.totalRevenue)}</div>
                    </div>
                </div>
                <div class="d-flex justify-content-between align-items-center flex-wrap gap-1">
                    <div>
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
        </div>`;
    }).join('');
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
    const tMachine = d.production.reduce((s, r) => s + machineCost(r), 0);
    const tPowder  = d.production.reduce((s, r) => s + r.powderYieldGrams, 0);
    const tRevenue = d.sales.reduce((s, r) => s + r.totalRevenue, 0);
    const tInvest  = tPurch + tCost + tMachine;
    const profit   = tRevenue - tInvest;

    el.innerHTML = `
        <div class="row g-2">
            <div class="col-6">
                <div class="bg-light rounded p-2 text-center">
                    <div class="text-muted small">Purchases</div>
                    <div class="fw-bold text-primary">৳${fNum(tPurch)}</div>
                    <div class="text-muted" style="font-size:0.72rem">${d.purchases.length} records</div>
                </div>
            </div>
            <div class="col-6">
                <div class="bg-light rounded p-2 text-center">
                    <div class="text-muted small">Other Costs + Machine</div>
                    <div class="fw-bold text-danger">৳${fNum(tCost + tMachine)}</div>
                    <div class="text-muted" style="font-size:0.72rem">${d.costs.length} records</div>
                </div>
            </div>
            <div class="col-6">
                <div class="bg-light rounded p-2 text-center">
                    <div class="text-muted small">Total Investment</div>
                    <div class="fw-bold text-dark">৳${fNum(tInvest)}</div>
                    <div class="text-muted" style="font-size:0.72rem">buy + costs</div>
                </div>
            </div>
            <div class="col-6">
                <div class="bg-light rounded p-2 text-center">
                    <div class="text-muted small">Total Sell</div>
                    <div class="fw-bold text-success">৳${fNum(tRevenue)}</div>
                    <div class="text-muted" style="font-size:0.72rem">${d.sales.length} orders</div>
                </div>
            </div>
            <div class="col-6">
                <div class="bg-light rounded p-2 text-center">
                    <div class="text-muted small">Profit / Loss</div>
                    <div class="fw-bold ${profit >= 0 ? 'text-success' : 'text-danger'}">${profit >= 0 ? '+' : ''}৳${fNum(profit)}</div>
                    <div class="text-muted" style="font-size:0.72rem">revenue − invest</div>
                </div>
            </div>
            <div class="col-6">
                <div class="bg-light rounded p-2 text-center">
                    <div class="text-muted small">Powder Produced</div>
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
            csv += `${r.date},"${r.product}",${r.rawMaterialKg},${r.powderYieldGrams},${r.yieldPercent},${r.machineHours||0},${r.machineMinutes||0},"${r.notes||''}"\n`;
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
    const tPurch   = d.purchases.reduce((s, r) => s + r.totalCost, 0);
    const tCost    = d.costs.reduce((s, r) => s + r.amount, 0);
    const tMachPDF = d.production.reduce((s, r) => s + machineCost(r), 0);
    const tPowder  = d.production.reduce((s, r) => s + r.powderYieldGrams, 0);

    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text('Summary', 14, y); y += 3;

    doc.autoTable({
        startY: y,
        head: [['Metric', 'Value']],
        body: [
            ['Total Raw Material Cost',    '৳' + fNum(tPurch)],
            ['Machine Run Cost',           '৳' + fNum(tMachPDF)],
            ['Other Costs',                '৳' + fNum(tCost)],
            ['Total Investment',           '৳' + fNum(tPurch + tCost + tMachPDF)],
            ['Total Powder Produced',      fWeight(tPowder)],
            ['Production Runs',            String(d.production.length)],
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
                (r.machineHours || 0) + 'h ' + (r.machineMinutes || 0) + 'm'
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
    if (!el) return;
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
        el.value = v;
    } else {
        el.textContent = v;
    }
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
    const url = localStorage.getItem('dd_fb_url') || '';
    const key = localStorage.getItem('dd_fb_key') || '';
    // Also support old config format — extract databaseURL from it
    if (!url) {
        const oldCfg = localStorage.getItem('dd_fb_cfg');
        if (oldCfg) {
            try {
                const cfg = JSON.parse(oldCfg);
                if (cfg.databaseURL && key) {
                    localStorage.setItem('dd_fb_url', cfg.databaseURL);
                    connectFirebase(cfg.databaseURL, key);
                    return;
                }
            } catch(e) {}
        }
    }
    if (url && key) connectFirebase(url, key);
}

function connectFirebase(dbUrl, key) {
    fbDbUrl   = dbUrl.replace(/\/$/, '');
    fbSyncKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    setSyncStatus('syncing');
    pullFromFirebase().then(() => {
        fbConnected = true;
        setSyncStatus('synced');
        renderDashboard();
        updateProductDatalist();
    }).catch(() => setSyncStatus('error'));
}

async function pushToFirebase() {
    if (!fbDbUrl || !fbSyncKey) return;
    setSyncStatus('syncing');
    try {
        const res = await fetch(`${fbDbUrl}/dd/${fbSyncKey}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                purchases:  arrToObj(db.purchases),
                production: arrToObj(db.production),
                costs:      arrToObj(db.costs),
                sales:      arrToObj(db.sales),
                _updated:   Date.now()
            })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        setSyncStatus('synced');
    } catch(e) {
        setSyncStatus('error');
        toast('Sync failed — data saved locally', 'warning');
    }
}

async function pullFromFirebase() {
    if (!fbDbUrl || !fbSyncKey) return;
    setSyncStatus('syncing');
    try {
        const res  = await fetch(`${fbDbUrl}/dd/${fbSyncKey}.json`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (data && typeof data === 'object') {
            if (data.purchases  !== undefined) db.purchases  = objToArr(data.purchases);
            if (data.production !== undefined) db.production = objToArr(data.production);
            if (data.costs      !== undefined) db.costs      = objToArr(data.costs);
            if (data.sales      !== undefined) db.sales      = objToArr(data.sales);
            saveAllLocal();
        } else {
            await pushToFirebase();
        }
        setSyncStatus('synced');
    } catch(e) {
        setSyncStatus('error');
        throw e;
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
    const url = localStorage.getItem('dd_fb_url') || '';
    const key = localStorage.getItem('dd_fb_key') || '';
    document.getElementById('sync-url').value = url;
    document.getElementById('sync-key').value = key;
    document.getElementById('syncTestResult').classList.add('d-none');
    new bootstrap.Modal(document.getElementById('syncModal')).show();
}

function saveAndConnectFirebase() {
    const url   = document.getElementById('sync-url').value.trim();
    const key   = document.getElementById('sync-key').value.trim();
    const resEl = document.getElementById('syncTestResult');

    if (!url || !key) {
        resEl.className = 'alert alert-danger small';
        resEl.textContent = 'Both fields are required.';
        resEl.classList.remove('d-none');
        return;
    }

    if (!url.includes('firebaseio.com') && !url.includes('firebasedatabase.app')) {
        resEl.className = 'alert alert-warning small';
        resEl.textContent = 'Enter your Firebase Realtime Database URL (ends in .firebaseio.com or .firebasedatabase.app).';
        resEl.classList.remove('d-none');
        return;
    }

    localStorage.setItem('dd_fb_url', url);
    localStorage.setItem('dd_fb_key', key);

    resEl.className = 'alert alert-info small';
    resEl.textContent = 'Connecting…';
    resEl.classList.remove('d-none');

    connectFirebase(url, key);
    setTimeout(() => {
        if (fbConnected) {
            resEl.className = 'alert alert-success small';
            resEl.textContent = '✓ Connected! Your data syncs across all devices with the same key.';
            setTimeout(() => bootstrap.Modal.getInstance(document.getElementById('syncModal'))?.hide(), 1500);
        } else {
            resEl.className = 'alert alert-danger small';
            resEl.textContent = 'Connection failed. Check your URL and make sure the database is in test mode.';
        }
    }, 3000);
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

function showUpdateBanner() {
    const b = document.getElementById('updateBanner');
    if (b) b.classList.remove('d-none');
}

function dismissUpdate() {
    const b = document.getElementById('updateBanner');
    if (b) b.classList.add('d-none');
}

function applyUpdate() {
    window.location.reload();
}

function checkForUpdates() {
    const banner = document.getElementById('updateBanner');
    if (!banner) return;

    // Show update banner if service worker detected new version
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
            registrations.forEach(reg => {
                if (reg.waiting || (reg.installing && reg.installing.state === 'installed')) {
                    banner.classList.remove('d-none');
                }
            });
        });
    }
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
