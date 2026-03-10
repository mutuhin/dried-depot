// ============================================================
//  DRIED DEPOT — Business Manager
//  All data stored in localStorage (works offline / GitHub Pages)
// ============================================================

const KEYS = {
    purchases:  'dd_purchases',
    production: 'dd_production',
    costs:      'dd_costs'
};

let db = { purchases: [], production: [], costs: [] };
let pendingDelete = { type: null, id: null };

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
});

function updateCurrentDate() {
    document.getElementById('currentDate').textContent =
        new Date().toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
}

function setDefaultDates() {
    const today = new Date().toISOString().split('T')[0];
    ['purchase-date','production-date','cost-date'].forEach(id => {
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
}

function saveAll() {
    localStorage.setItem(KEYS.purchases,  JSON.stringify(db.purchases));
    localStorage.setItem(KEYS.production, JSON.stringify(db.production));
    localStorage.setItem(KEYS.costs,      JSON.stringify(db.costs));
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
        cost:       { modal: 'costModal',       form: 'costForm',       titleEl: 'costModalTitle' }
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
//  DELETE
// ============================================================
function deleteRecord(type, id) {
    pendingDelete = { type, id };
    new bootstrap.Modal(document.getElementById('deleteModal')).show();

    document.getElementById('confirmDeleteBtn').onclick = () => {
        const map = { purchase: 'purchases', production: 'production', cost: 'costs' };
        const key = map[pendingDelete.type];
        db[key] = db[key].filter(r => r.id !== pendingDelete.id);
        saveAll();
        hideModal('deleteModal');
        renderDashboard();
        renderPurchases();
        renderProduction();
        renderCosts();
        toast('Record deleted', 'danger');
    };
}

// ============================================================
//  RENDER — DASHBOARD
// ============================================================
function renderDashboard() {
    const totalRaw   = db.purchases.reduce((s, r) => s + (r.totalCost || 0), 0);
    const totalOther = db.costs.reduce((s, r) => s + (r.amount || 0), 0);
    const totalPowder = db.production.reduce((s, r) => s + (r.powderYieldGrams || 0), 0);

    set('stat-totalInvestment', '₹' + fNum(totalRaw + totalOther));
    set('stat-rawCost',         '₹' + fNum(totalRaw));
    set('stat-powderProduced',  fWeight(totalPowder));
    set('stat-otherCosts',      '₹' + fNum(totalOther));

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
        costs:      (type === 'all' || type === 'costs')      ? byDate(db.costs)      : []
    };
}

function updateReportSummary() {
    const d   = getFiltered();
    const el  = document.getElementById('report-summary');
    if (!el) return;

    const tPurch = d.purchases.reduce((s, r) => s + r.totalCost, 0);
    const tCost  = d.costs.reduce((s, r) => s + r.amount, 0);
    const tPowder = d.production.reduce((s, r) => s + r.powderYieldGrams, 0);

    el.innerHTML = `
        <div class="row g-2">
            <div class="col-6">
                <div class="bg-light rounded p-2 text-center">
                    <div class="text-muted small">Purchases</div>
                    <div class="fw-bold text-success">₹${fNum(tPurch)}</div>
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
                    <div class="text-muted small">Powder Made</div>
                    <div class="fw-bold text-primary">${fWeight(tPowder)}</div>
                    <div class="text-muted" style="font-size:0.72rem">${d.production.length} runs</div>
                </div>
            </div>
            <div class="col-6">
                <div class="bg-light rounded p-2 text-center">
                    <div class="text-muted small">Total Spent</div>
                    <div class="fw-bold">₹${fNum(tPurch + tCost)}</div>
                    <div class="text-muted" style="font-size:0.72rem">all categories</div>
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
    if (!d.purchases.length && !d.production.length && !d.costs.length) {
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
