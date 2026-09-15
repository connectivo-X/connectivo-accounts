/* ============================================================
   Connectivo — Accounts and Cash Book
   Plain JavaScript. No build step, no framework.
   ============================================================ */

const MONTHS      = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const MONTH_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
let categories = [];
let transactions = [];
let currentUser = null;   // { id, email, name, role }
let reportYear  = new Date().getFullYear();
let reportPeriod = 'summary';
let cbYear  = new Date().getFullYear();
let cbMonth = new Date().getMonth();

/* ---------- Supabase client ----------
   SUPABASE_URL and SUPABASE_ANON_KEY come from config.js.
   The anon key is safe in client code; Row Level Security on the
   database is what actually restricts access to logged-in users. */
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- field-name mapping ----------
   The database uses snake_case columns; the rest of this file
   uses camelCase objects, same as before Supabase was added. */
function catFromDb(r){ return { id:r.id, name:r.name, type:r.type, group:r.group_name || '' }; }
function catToDb(c){ return { name:c.name, type:c.type, group_name:c.group || '' }; }
function txnFromDb(r){
  return { id:r.id, categoryId:r.category_id, date:r.date, amount:Number(r.amount),
    paymentType:r.payment_type, description:r.description || '', ref:r.ref || '', vcNo:r.vc_no || '' };
}
function txnToDb(t){
  return { category_id:t.categoryId, date:t.date, amount:t.amount, payment_type:t.paymentType,
    description:t.description || '', ref:t.ref || '', vc_no:t.vcNo || '' };
}

/* ---------- helpers ---------- */
function uid(p){ return p + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtMoney(n){ return (n<0?'-':'') + Math.abs(n).toLocaleString('en-US',{maximumFractionDigits:2}); }
function fmtCell(n){ return n ? n.toLocaleString('en-US',{maximumFractionDigits:2}) : ''; }
function cell(v){ return v ? v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''; }
function fmtDate(iso){
  if(!iso) return '';
  const [y,m,d] = iso.split('-').map(Number);
  return String(d).padStart(2,'0') + '-' + MONTH_FULL[m-1] + '-' + y;
}
function catById(id){ return categories.find(c => c.id === id); }
function daysInMonth(y,m){ return new Date(y, m+1, 0).getDate(); }

/* ============================================================
   LOGIN
   ============================================================ */
function showLogin(){
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appScreen').style.display   = 'none';
}
function showApp(){
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display   = 'flex';
  document.getElementById('userChip').textContent = currentUser.name + ' · ' + currentUser.role;
}
/* Load the name + role saved in the `profiles` table for this logged-in user */
async function loadProfile(authUser){
  let name = authUser.email, role = 'Account Manager';
  try{
    const { data, error } = await sb.from('profiles').select('full_name, role').eq('id', authUser.id).single();
    if(!error && data){ name = data.full_name || authUser.email; role = data.role || role; }
  }catch(e){ /* profile not ready yet — fall back to the email */ }
  currentUser = { id: authUser.id, email: authUser.email, name, role };
}

async function doLogin(){
  const email = document.getElementById('loginUser').value.trim();
  const pass  = document.getElementById('loginPass').value;
  const err   = document.getElementById('loginErr');
  const btn   = document.getElementById('loginBtn');
  if(!email || !pass){ err.textContent = 'Enter both email and password.'; return; }
  err.textContent = ''; btn.disabled = true; btn.textContent = 'Signing in…';
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  btn.disabled = false; btn.textContent = 'Login';
  if(error){
    if(error.message.toLowerCase().includes('email not confirmed'))
      err.textContent = 'This account is not confirmed yet. In Supabase, go to Authentication → Users, open this user, and confirm the email.';
    else if(error.message.toLowerCase().includes('invalid login credentials'))
      err.textContent = 'Email or password is not correct — or this user does not exist yet in Supabase.';
    else
      err.textContent = 'Could not sign in: ' + error.message;
    return;
  }
  await loadProfile(data.user);
  document.getElementById('loginPass').value = '';
  showApp();
  await loadData();
}
async function doLogout(){
  await sb.auth.signOut();
  currentUser = null;
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  showLogin();
}

/* ============================================================
   DATA
   ============================================================ */
async function loadData(){
  const [catRes, txnRes] = await Promise.all([
    sb.from('categories').select('*').order('created_at'),
    sb.from('transactions').select('*').order('date')
  ]);
  if(catRes.error) showToast('Could not load categories: ' + catRes.error.message);
  if(txnRes.error) showToast('Could not load entries: ' + txnRes.error.message);
  categories   = (catRes.data || []).map(catFromDb);
  transactions = (txnRes.data || []).map(txnFromDb);
  renderAll();
}

function switchTab(t){
  document.querySelectorAll('.side-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + t).classList.add('active');
}
function renderAll(){ renderLedger(); renderReport(); refreshGroupList(); }

/* ============================================================
   CASH BOOK — Dr. / Cr. ledger
   ============================================================ */
function buildCbMonthButtons(){
  document.getElementById('cbMonthBtns').innerHTML = MONTHS.map((m,i) =>
    `<button class="period-btn" data-cbmonth="${i}" onclick="setCbMonth(${i})">${m}</button>`).join(' ');
}
function setCbMonth(m){ cbMonth = m; renderLedger(); const s=document.getElementById('cbFilterStatus'); if(s) s.textContent=''; }
function changeCbMonth(d){
  cbMonth += d;
  if(cbMonth < 0){ cbMonth = 11; cbYear--; }
  if(cbMonth > 11){ cbMonth = 0; cbYear++; }
  renderLedger();
  const s=document.getElementById('cbFilterStatus'); if(s) s.textContent='';
}

/* ===== Cash Book filter bar ===== */
function buildCbFilterInputs(){
  const type = document.getElementById('cbFilterType').value;
  const el = document.getElementById('cbFilterInputs');
  const todayIso = new Date().toISOString().slice(0,10);
  if(type === 'day'){
    el.innerHTML = `<input type="date" id="cbFilterDate" value="${todayIso}">`;
  } else if(type === 'month'){
    el.innerHTML = `<select id="cbFilterMonth">${MONTHS.map((m,i) => `<option value="${i}">${m}</option>`).join('')}</select>
      <input type="number" id="cbFilterYear" value="${cbYear}" placeholder="Year">`;
  } else {
    el.innerHTML = `<input type="number" id="cbFilterYearOnly" value="${cbYear}" placeholder="Year">`;
  }
}
function applyCbFilter(){
  const type = document.getElementById('cbFilterType').value;
  const status = document.getElementById('cbFilterStatus');
  document.querySelectorAll('#ledgerHost tr.highlight-row').forEach(r => r.classList.remove('highlight-row'));

  if(type === 'year'){
    const y = parseInt(document.getElementById('cbFilterYearOnly').value, 10);
    if(!y){ showToast('Enter a year.'); return; }
    cbYear = y; renderLedger();
    status.textContent = `Showing ${cbYear}, ${MONTH_FULL[cbMonth]}`;
  } else if(type === 'month'){
    const m = parseInt(document.getElementById('cbFilterMonth').value, 10);
    const y = parseInt(document.getElementById('cbFilterYear').value, 10);
    if(!y){ showToast('Enter a year.'); return; }
    cbYear = y; cbMonth = m; renderLedger();
    status.textContent = `Showing ${MONTH_FULL[cbMonth]} ${cbYear}`;
  } else {
    const iso = document.getElementById('cbFilterDate').value;
    if(!iso){ showToast('Pick a date.'); return; }
    const [y,m] = iso.split('-').map(Number);
    cbYear = y; cbMonth = m - 1;
    renderLedger();
    const matches = document.querySelectorAll(`#ledgerHost td.date-c[data-date="${iso}"]`);
    if(matches.length){
      matches.forEach(td => td.closest('tr').classList.add('highlight-row'));
      matches[0].closest('tr').scrollIntoView({ behavior:'smooth', block:'center' });
      status.textContent = `Found ${matches.length} entr${matches.length===1?'y':'ies'} on ${fmtDate(iso)}`;
    } else {
      status.textContent = `No entries on ${fmtDate(iso)}`;
    }
  }
}
function clearCbFilter(){
  document.querySelectorAll('#ledgerHost tr.highlight-row').forEach(r => r.classList.remove('highlight-row'));
  document.getElementById('cbFilterStatus').textContent = '';
}

/* Opening balance = every transaction dated before this month */
function openingBalance(year, month){
  const start = new Date(year, month, 1);
  let cash = 0, bank = 0;
  transactions.forEach(t => {
    const c = catById(t.categoryId); if(!c) return;
    const [y,m,d] = t.date.split('-').map(Number);
    if(new Date(y, m-1, d) >= start) return;
    const s = c.type === 'income' ? t.amount : -t.amount;
    if(t.paymentType === 'cash') cash += s; else bank += s;
  });
  return { cash, bank };
}
function monthTxns(year, month, type){
  return transactions.filter(t => {
    const c = catById(t.categoryId); if(!c || c.type !== type) return false;
    const [y,m] = t.date.split('-').map(Number);
    return y === year && m-1 === month;
  }).sort((a,b) => a.date.localeCompare(b.date));
}

function ledgerSide(t, isCr){
  const c = catById(t.categoryId);
  const name = c ? c.name : '(deleted category)';
  const note = t.description ? `<div class="acct-note">${esc(t.description)}</div>` : '';
  return `
    <td class="date-c${isCr ? ' mid' : ''}" data-date="${t.date}">${fmtDate(t.date)}</td>
    <td class="head-acct"><div class="acct-line"><div><div>${esc(name)}</div>${note}</div>
      <span class="acts">
        <button class="icon-btn" title="Edit" onclick="openTxnModal('${t.id}')">&#9998;</button>
        <button class="icon-btn danger" title="Delete" onclick="deleteTxn('${t.id}')">&#128465;</button>
      </span></div></td>
    <td class="small">${esc(t.ref || '')}</td>
    <td class="small">${esc(t.vcNo || '')}</td>
    <td class="num">${t.paymentType === 'cash' ? cell(t.amount) : ''}</td>
    <td class="num">${t.paymentType === 'bank' ? cell(t.amount) : ''}</td>`;
}
const BLANK_DR = '<td></td><td></td><td></td><td></td><td class="num"></td><td class="num"></td>';
const BLANK_CR = '<td class="mid"></td><td></td><td></td><td></td><td class="num"></td><td class="num"></td>';

function getLedgerData(year, month){
  const bd       = openingBalance(year, month);
  const receipts = monthTxns(year, month, 'income');
  const payments = monthTxns(year, month, 'expense');
  const drCash = bd.cash + receipts.filter(t => t.paymentType === 'cash').reduce((s,t) => s + t.amount, 0);
  const drBank = bd.bank + receipts.filter(t => t.paymentType === 'bank').reduce((s,t) => s + t.amount, 0);
  const crCash = payments.filter(t => t.paymentType === 'cash').reduce((s,t) => s + t.amount, 0);
  const crBank = payments.filter(t => t.paymentType === 'bank').reduce((s,t) => s + t.amount, 0);
  return { bd, receipts, payments, drCash, drBank, crCash, crBank, cdCash: drCash - crCash, cdBank: drBank - crBank };
}

function renderLedger(){
  document.getElementById('cbYearLabel').textContent = cbYear;
  document.querySelectorAll('.period-btn[data-cbmonth]').forEach(b =>
    b.classList.toggle('active', Number(b.dataset.cbmonth) === cbMonth));
  document.getElementById('cbMonthTitle').textContent = `Month Of ${MONTH_FULL[cbMonth]} _${cbYear}`;

  const { bd, receipts, payments, drCash, drBank, crCash, crBank, cdCash, cdBank } = getLedgerData(cbYear, cbMonth);

  const MIN_ROWS = 10;
  const rows = Math.max(receipts.length, payments.length, MIN_ROWS);

  let html = `<table class="ledger">
    <tr class="drcr"><th colspan="6">Dr.</th><th colspan="6" class="cr-side">Cr.</th></tr>
    <thead>
      <tr>
        <th rowspan="2">Date</th><th rowspan="2">Received / Head Of Account</th>
        <th rowspan="2">Ref</th><th rowspan="2">Vc No.</th><th colspan="2">Amount</th>
        <th rowspan="2" class="mid">Date</th><th rowspan="2">Payment / Head Of Account</th>
        <th rowspan="2">Ref</th><th rowspan="2">Vc No.</th><th colspan="2">Amount</th>
      </tr>
      <tr><th>Cash</th><th>Bank</th><th>Cash</th><th>Bank</th></tr>
    </thead><tbody>`;

  /* Balance B/D sits on the Dr. side of the first row */
  html += `<tr class="bd-row">
    <td class="date-c">${fmtDate(`${cbYear}-${String(cbMonth+1).padStart(2,'0')}-01`)}</td>
    <td class="head-acct">Balance B/D</td><td></td><td></td>
    <td class="num">${cell(bd.cash)}</td><td class="num">${cell(bd.bank)}</td>
    ${payments[0] ? ledgerSide(payments[0], true) : BLANK_CR}</tr>`;

  for(let i = 0; i < rows; i++){
    const r = receipts[i];
    const p = payments[i+1];
    if(!r && !p) html += `<tr class="blank-row">${BLANK_DR}${BLANK_CR}</tr>`;
    else html += `<tr>${r ? ledgerSide(r, false) : BLANK_DR}${p ? ledgerSide(p, true) : BLANK_CR}</tr>`;
  }

  html += `<tr class="sub-row">${BLANK_DR}
    <td class="mid"></td><td class="head-acct">Sub total</td><td></td><td></td>
    <td class="num">${cell(crCash)}</td><td class="num">${cell(crBank)}</td></tr>`;

  html += `<tr class="cd-row">${BLANK_DR}
    <td class="mid"></td><td class="head-acct">Balance C/D</td><td></td><td></td>
    <td class="num">${cell(cdCash)}</td><td class="num">${cell(cdBank)}</td></tr>`;

  html += `<tr class="total-row2">
    <td></td><td class="head-acct">Total</td><td></td><td></td>
    <td class="num">${cell(drCash)}</td><td class="num">${cell(drBank)}</td>
    <td class="mid"></td><td class="head-acct">Total</td><td></td><td></td>
    <td class="num">${cell(crCash + cdCash)}</td><td class="num">${cell(crBank + cdBank)}</td></tr>`;

  html += '</tbody></table>';
  document.getElementById('ledgerHost').innerHTML = html;

  document.getElementById('sumCash').textContent    = fmtMoney(cdCash);
  document.getElementById('sumBank').textContent    = fmtMoney(cdBank);
  document.getElementById('sumIncome').textContent  = fmtMoney(receipts.reduce((s,t) => s + t.amount, 0));
  document.getElementById('sumExpense').textContent = fmtMoney(payments.reduce((s,t) => s + t.amount, 0));
}

/* ============================================================
   EXPENSE REPORT
   ============================================================ */
function buildMonthButtons(){
  document.getElementById('monthBtns').innerHTML = MONTHS.map((m,i) =>
    `<button class="period-btn" data-period="${i}" onclick="setPeriod(${i})">${m}</button>`).join(' ');
}
function setPeriod(p){
  reportPeriod = p;
  document.querySelectorAll('.period-btn[data-period]').forEach(b =>
    b.classList.toggle('active', String(b.dataset.period) === String(p)));
  renderReport();
  const s=document.getElementById('repFilterStatus'); if(s) s.textContent='';
}
function changeYear(d){ reportYear += d; renderReport(); const s=document.getElementById('repFilterStatus'); if(s) s.textContent=''; }

/* ===== Expense Report filter bar ===== */
function buildRepFilterInputs(){
  const type = document.getElementById('repFilterType').value;
  const el = document.getElementById('repFilterInputs');
  const todayIso = new Date().toISOString().slice(0,10);
  if(type === 'day'){
    el.innerHTML = `<input type="date" id="repFilterDate" value="${todayIso}">`;
  } else if(type === 'month'){
    el.innerHTML = `<select id="repFilterMonth">${MONTHS.map((m,i) => `<option value="${i}">${m}</option>`).join('')}</select>
      <input type="number" id="repFilterYear" value="${reportYear}" placeholder="Year">`;
  } else {
    el.innerHTML = `<input type="number" id="repFilterYearOnly" value="${reportYear}" placeholder="Year">`;
  }
}
function applyRepFilter(){
  const type = document.getElementById('repFilterType').value;
  const status = document.getElementById('repFilterStatus');
  document.querySelectorAll('#gridHost .highlight-cell').forEach(c => c.classList.remove('highlight-cell'));

  if(type === 'year'){
    const y = parseInt(document.getElementById('repFilterYearOnly').value, 10);
    if(!y){ showToast('Enter a year.'); return; }
    reportYear = y; setPeriod('summary');
    status.textContent = `Showing year ${reportYear}`;
  } else if(type === 'month'){
    const m = parseInt(document.getElementById('repFilterMonth').value, 10);
    const y = parseInt(document.getElementById('repFilterYear').value, 10);
    if(!y){ showToast('Enter a year.'); return; }
    reportYear = y; setPeriod(m);
    status.textContent = `Showing ${MONTH_FULL[m]} ${reportYear}`;
  } else {
    const iso = document.getElementById('repFilterDate').value;
    if(!iso){ showToast('Pick a date.'); return; }
    const [y,m,d] = iso.split('-').map(Number);
    reportYear = y; setPeriod(m - 1);
    const cells = document.querySelectorAll(`#gridHost td[data-day="${d}"], #gridHost th[data-day="${d}"]`);
    let dayInc = 0, dayExp = 0;
    categories.forEach(c => {
      const v = sumFor(c.id, reportYear, m - 1, d);
      if(c.type === 'income') dayInc += v; else dayExp += v;
    });
    cells.forEach(c => c.classList.add('highlight-cell'));
    status.textContent = (dayInc || dayExp)
      ? `${fmtDate(iso)} — Income ${fmtMoney(dayInc)} · Expense ${fmtMoney(dayExp)}`
      : `No entries on ${fmtDate(iso)}`;
  }
}
function clearRepFilter(){
  document.querySelectorAll('#gridHost .highlight-cell').forEach(c => c.classList.remove('highlight-cell'));
  document.getElementById('repFilterStatus').textContent = '';
}

function sumFor(catId, year, month, day){
  return transactions.reduce((acc,t) => {
    if(t.categoryId !== catId) return acc;
    const [y,m,d] = t.date.split('-').map(Number);
    if(y !== year) return acc;
    if(month !== undefined && m-1 !== month) return acc;
    if(day   !== undefined && d   !== day)   return acc;
    return acc + t.amount;
  }, 0);
}
function groupedCats(type){
  const out = {};
  categories.filter(c => c.type === type).forEach(c => {
    const g = c.group && c.group.trim() ? c.group.trim() : 'Ungrouped';
    (out[g] = out[g] || []).push(c);
  });
  return out;
}

function renderReport(){
  document.getElementById('yearLabel').textContent = reportYear;
  const isSummary = reportPeriod === 'summary';
  const cols = isSummary
    ? MONTHS.map((m,i) => ({ label:m, idx:i }))
    : Array.from({ length: daysInMonth(reportYear, reportPeriod) }, (_,i) => ({ label:String(i+1), idx:i+1 }));

  document.getElementById('reportTitle').textContent = isSummary
    ? `Monthly Expense Report — ${reportYear}`
    : `${MONTH_FULL[reportPeriod].toUpperCase()} ${reportYear}`;

  const host = document.getElementById('gridHost');
  if(!categories.length){
    host.innerHTML = `<div class="empty-state"><div class="big">No categories yet</div>
      <div>Add your income and expense categories with the "Add category" button — the report fills in from there.</div></div>`;
    updateReportTotals(isSummary);
    return;
  }

  const val = (catId,c) => isSummary
    ? sumFor(catId, reportYear, c.idx)
    : sumFor(catId, reportYear, reportPeriod, c.idx);

  let html = '<table class="grid"><thead><tr><th class="cat-col">CATEGORY</th>' +
    cols.map(c => `<th${isSummary ? '' : ` data-day="${c.idx}"`}>${c.label}</th>`).join('') +
    `<th>${isSummary ? 'YTD TOTAL' : 'TOTAL'}</th></tr></thead><tbody>`;

  ['income','expense'].forEach(type => {
    const groups = groupedCats(type);
    const keys = Object.keys(groups).sort();
    if(!keys.length) return;

    html += `<tr class="section-row"><th class="cat-col" colspan="${cols.length+2}">${
      type === 'income' ? 'INCOME CATEGORY' : 'EXPENSE CATEGORY'}</th></tr>`;

    const typeTotals = cols.map(c => categories.filter(x => x.type === type).reduce((s,x) => s + val(x.id,c), 0));
    html += `<tr class="total-row"><td class="cat-col">Total ${type === 'income' ? 'income' : 'expenses'}</td>` +
      typeTotals.map(v => `<td>${fmtCell(v)}</td>`).join('') +
      `<td class="total-col">${fmtCell(typeTotals.reduce((a,b) => a+b, 0))}</td></tr>`;

    keys.forEach(g => {
      const items = groups[g];
      if(!(keys.length === 1 && g === 'Ungrouped')){
        const gt = cols.map(c => items.reduce((s,x) => s + val(x.id,c), 0));
        html += `<tr class="group-row"><td class="cat-col">${esc(g)}</td>` +
          gt.map(v => `<td>${fmtCell(v)}</td>`).join('') +
          `<td class="total-col">${fmtCell(gt.reduce((a,b) => a+b, 0))}</td></tr>`;
      }
      items.forEach(cat => {
        const vals = cols.map(c => val(cat.id, c));
        html += `<tr class="cat-row"><td class="cat-col"><div class="cat-name-cell"><span>${esc(cat.name)}</span>
          <span class="acts">
            <button class="icon-btn" title="Edit" onclick="openCatModal('${cat.id}')">&#9998;</button>
            <button class="icon-btn danger" title="Delete" onclick="deleteCat('${cat.id}')">&#128465;</button>
          </span></div></td>` +
          vals.map((v,i) => `<td class="${v ? '' : 'zero'}"${isSummary ? '' : ` data-day="${cols[i].idx}"`}>${fmtCell(v)}</td>`).join('') +
          `<td class="total-col">${fmtCell(vals.reduce((a,b) => a+b, 0))}</td></tr>`;
      });
    });
  });

  html += '</tbody></table>';
  host.innerHTML = html;
  updateReportTotals(isSummary);
}

function updateReportTotals(isSummary){
  let inc = 0, exp = 0;
  transactions.forEach(t => {
    const c = catById(t.categoryId); if(!c) return;
    const [y,m] = t.date.split('-').map(Number);
    if(y !== reportYear) return;
    if(!isSummary && m-1 !== reportPeriod) return;
    if(c.type === 'income') inc += t.amount; else exp += t.amount;
  });
  const scope = isSummary ? `${reportYear}` : `${MONTHS[reportPeriod]} ${reportYear}`;
  document.getElementById('ytdIncomeLabel').textContent  = 'Income — ' + scope;
  document.getElementById('ytdExpenseLabel').textContent = 'Expenses — ' + scope;
  document.getElementById('repIncome').textContent  = fmtMoney(inc);
  document.getElementById('repExpense').textContent = fmtMoney(exp);
  const net = document.getElementById('repNet');
  net.textContent = fmtMoney(inc - exp);
  net.style.color = (inc - exp) < 0 ? 'var(--expense)' : 'var(--income)';
}

/* ============================================================
   EXPORT — Excel (.xlsx) and PDF, for both Cash Book and Expense Report
   ============================================================ */
function openExportModal(source){
  document.getElementById('exportSource').value = source;
  document.getElementById('exportOverlay').classList.add('active');
}
function closeExportModal(){ document.getElementById('exportOverlay').classList.remove('active'); }

function runExport(){
  const source = document.getElementById('exportSource').value;
  const scope  = document.getElementById('exportScope').value;
  const format = document.getElementById('exportFormat').value;
  closeExportModal();
  try{
    if(source === 'cashbook'){
      const months = scope === 'current' ? [{ year: cbYear, month: cbMonth }] : allMonthsWithData();
      if(!months.length){ showToast('No entries to export yet.'); return; }
      format === 'excel' ? exportCashBookExcel(months) : exportCashBookPdf(months);
    } else {
      const period = scope === 'current' ? reportPeriod : 'summary';
      format === 'excel' ? exportReportExcel(reportYear, period) : exportReportPdf(reportYear, period);
    }
    showToast('Download started');
  }catch(e){
    showToast('Export failed: ' + e.message);
  }
}

/* every {year, month} that has at least one transaction, oldest first */
function allMonthsWithData(){
  const set = new Set();
  transactions.forEach(t => {
    const [y,m] = t.date.split('-').map(Number);
    set.add(y + '-' + (m - 1));
  });
  return [...set].map(s => { const [y,m] = s.split('-').map(Number); return { year: y, month: m }; })
    .sort((a,b) => a.year - b.year || a.month - b.month);
}
function safeSheetName(name){
  return name.replace(/[\\/*?:\[\]]/g, '-').slice(0, 31);
}

/* ---------- Cash Book: Excel ---------- */
function ledgerRowsForSheet(year, month){
  const { bd, receipts, payments, drCash, drBank, crCash, crBank, cdCash, cdBank } = getLedgerData(year, month);
  const rows = [];
  rows.push(['CONNECTIVO — Cash & Bank Book', '', '', '', '', '', '', '', '', '', '', '']);
  rows.push(['Month Of ' + MONTH_FULL[month] + ' ' + year, '', '', '', '', '', '', '', '', '', '', '']);
  rows.push([]);
  rows.push(['Dr.', '', '', '', '', '', 'Cr.', '', '', '', '', '']);
  rows.push(['Date','Received / Head Of Account','Ref','Vc No.','Cash','Bank','Date','Payment / Head Of Account','Ref','Vc No.','Cash','Bank']);

  const firstDate = fmtDate(year + '-' + String(month + 1).padStart(2,'0') + '-01');
  const sideRow = t => t
    ? [fmtDate(t.date), catNameOf(t), t.ref||'', t.vcNo||'', t.paymentType==='cash'?t.amount:'', t.paymentType==='bank'?t.amount:'']
    : ['','','','','',''];

  /* Row 0: Balance B/D on the Dr side, first payment (if any) on the Cr side — same layout as the on-screen ledger */
  rows.push([firstDate, 'Balance B/D', '', '', bd.cash || '', bd.bank || '', ...sideRow(payments[0])]);

  const bodyRows = Math.max(receipts.length, payments.length - 1, 1);
  for(let i = 0; i < bodyRows; i++){
    rows.push([...sideRow(receipts[i]), ...sideRow(payments[i + 1])]);
  }

  rows.push(['','','','','','', '','Sub total','','', crCash, crBank]);
  rows.push(['','','','','','', '','Balance C/D','','', cdCash, cdBank]);
  rows.push(['','Total','','', drCash, drBank, '','Total','','', crCash + cdCash, crBank + cdBank]);
  return rows;
}
function catNameOf(t){ const c = catById(t.categoryId); return c ? c.name : '(deleted category)'; }

function exportCashBookExcel(months){
  const wb = XLSX.utils.book_new();
  months.forEach(({year, month}) => {
    const ws = XLSX.utils.aoa_to_sheet(ledgerRowsForSheet(year, month));
    ws['!cols'] = [{wch:12},{wch:26},{wch:8},{wch:8},{wch:11},{wch:11},{wch:12},{wch:26},{wch:8},{wch:8},{wch:11},{wch:11}];
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(MONTHS[month] + ' ' + year));
  });
  const label = months.length === 1 ? MONTHS[months[0].month] + '-' + months[0].year : 'all-months';
  XLSX.writeFile(wb, 'Connectivo-CashBook-' + label + '.xlsx');
}

/* ---------- Cash Book: PDF ---------- */
function exportCashBookPdf(months){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });
  months.forEach(({year, month}, idx) => {
    if(idx > 0) doc.addPage();
    const { bd, receipts, payments, drCash, drBank, crCash, crBank, cdCash, cdBank } = getLedgerData(year, month);
    doc.setFontSize(14);
    doc.text('CONNECTIVO — Cash & Bank Book', 14, 15);
    doc.setFontSize(11);
    doc.text('Month Of ' + MONTH_FULL[month] + ' ' + year, 14, 22);

    const firstDate = fmtDate(year + '-' + String(month + 1).padStart(2,'0') + '-01');
    const recBody = [[firstDate, 'Balance B/D', '', '', bd.cash ? cell(bd.cash) : '', bd.bank ? cell(bd.bank) : '']]
      .concat(receipts.map(t => [fmtDate(t.date), catNameOf(t), t.ref||'', t.vcNo||'',
        t.paymentType==='cash'?cell(t.amount):'', t.paymentType==='bank'?cell(t.amount):'']))
      .concat([['', 'Total (Dr.)', '', '', cell(drCash), cell(drBank)]]);

    const payBody = payments.map(t => [fmtDate(t.date), catNameOf(t), t.ref||'', t.vcNo||'',
        t.paymentType==='cash'?cell(t.amount):'', t.paymentType==='bank'?cell(t.amount):''])
      .concat([
        ['', 'Sub total', '', '', cell(crCash), cell(crBank)],
        ['', 'Balance C/D', '', '', cell(cdCash), cell(cdBank)],
        ['', 'Total (Cr.)', '', '', cell(crCash + cdCash), cell(crBank + cdBank)],
      ]);

    doc.autoTable({
      startY: 27, head: [['Date','Received / Head of Account','Ref','Vc No.','Cash','Bank']],
      body: recBody, theme: 'grid', headStyles: { fillColor: [44,129,196] }, styles: { fontSize: 8 }
    });
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 6, head: [['Date','Payment / Head of Account','Ref','Vc No.','Cash','Bank']],
      body: payBody, theme: 'grid', headStyles: { fillColor: [44,129,196] }, styles: { fontSize: 8 }
    });
  });
  const label = months.length === 1 ? MONTHS[months[0].month] + '-' + months[0].year : 'all-months';
  doc.save('Connectivo-CashBook-' + label + '.pdf');
}

/* ---------- Expense Report: shared row builder ---------- */
function reportRowsForExport(year, period){
  const isSummary = period === 'summary';
  const cols = isSummary
    ? MONTHS.map((m,i) => ({ label:m, idx:i }))
    : Array.from({ length: daysInMonth(year, period) }, (_,i) => ({ label:String(i+1), idx:i+1 }));
  const val = (catId,c) => isSummary ? sumFor(catId, year, c.idx) : sumFor(catId, year, period, c.idx);

  const header = ['Category', ...cols.map(c => c.label), isSummary ? 'YTD Total' : 'Total'];
  const rows = [];
  ['income','expense'].forEach(type => {
    const groups = groupedCats(type);
    const keys = Object.keys(groups).sort();
    if(!keys.length) return;
    rows.push([type === 'income' ? 'INCOME CATEGORY' : 'EXPENSE CATEGORY', ...cols.map(()=>'')," "]);
    const typeTotals = cols.map(c => categories.filter(x => x.type === type).reduce((s,x) => s + val(x.id,c), 0));
    rows.push(['Total ' + (type==='income'?'income':'expenses'), ...typeTotals.map(v=>v||''), typeTotals.reduce((a,b)=>a+b,0)]);
    keys.forEach(g => {
      const items = groups[g];
      if(!(keys.length === 1 && g === 'Ungrouped')){
        const gt = cols.map(c => items.reduce((s,x) => s + val(x.id,c), 0));
        rows.push([g, ...gt.map(v=>v||''), gt.reduce((a,b)=>a+b,0)]);
      }
      items.forEach(cat => {
        const vals = cols.map(c => val(cat.id, c));
        rows.push([cat.name, ...vals.map(v=>v||''), vals.reduce((a,b)=>a+b,0)]);
      });
    });
  });
  return { header, rows, title: isSummary ? `Monthly Expense Report — ${year}` : `${MONTH_FULL[period]} ${year}` };
}

/* ---------- Expense Report: Excel ---------- */
function exportReportExcel(year, period){
  const { header, rows, title } = reportRowsForExport(year, period);
  const aoa = [[title], [], header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{wch:26}, ...header.slice(1).map(()=>({wch:10}))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, safeSheetName(period === 'summary' ? String(year) : MONTHS[period] + ' ' + year));
  XLSX.writeFile(wb, 'Connectivo-ExpenseReport-' + (period==='summary' ? year : MONTHS[period]+'-'+year) + '.xlsx');
}

/* ---------- Expense Report: PDF ---------- */
function exportReportPdf(year, period){
  const { jsPDF } = window.jspdf;
  const { header, rows, title } = reportRowsForExport(year, period);
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.text('CONNECTIVO', 14, 15);
  doc.setFontSize(11);
  doc.text(title, 14, 22);
  doc.autoTable({
    startY: 27, head: [header], body: rows.map(r => r.map(v => typeof v === 'number' ? cell(v) : v)),
    theme: 'grid', headStyles: { fillColor: [44,129,196] }, styles: { fontSize: 7 },
    columnStyles: { 0: { cellWidth: 42 } }
  });
  doc.save('Connectivo-ExpenseReport-' + (period==='summary' ? year : MONTHS[period]+'-'+year) + '.pdf');
}

/* ============================================================
   MODALS
   ============================================================ */
document.addEventListener('click', e => {
  const opt = e.target.closest('.radio-opt'); if(!opt) return;
  opt.closest('.radio-row').querySelectorAll('.radio-opt').forEach(o => o.classList.remove('checked'));
  opt.classList.add('checked');
  opt.querySelector('input').checked = true;
});
function setRadio(id, v){
  document.querySelectorAll('#' + id + ' .radio-opt').forEach(o => {
    const on = o.dataset.val === v;
    o.querySelector('input').checked = on;
    o.classList.toggle('checked', on);
  });
}

function fillCatOptions(sel){
  const el  = document.getElementById('txnCategory');
  const inc = categories.filter(c => c.type === 'income');
  const exp = categories.filter(c => c.type === 'expense');
  let h = '';
  if(inc.length) h += '<optgroup label="Income (Dr.)">'  + inc.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('') + '</optgroup>';
  if(exp.length) h += '<optgroup label="Expense (Cr.)">' + exp.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('') + '</optgroup>';
  h += '<option value="__new__">+ Add new category…</option>';
  el.innerHTML = h;
  el.value = sel || (categories.length ? categories[0].id : '__new__');
  handleTxnCategoryChange();
}
function handleTxnCategoryChange(){
  const isNew = document.getElementById('txnCategory').value === '__new__';
  document.getElementById('inlineNewCat').style.display = isNew ? 'block' : 'none';
}
function defaultEntryDate(){
  const today = new Date();
  if(today.getFullYear() === cbYear && today.getMonth() === cbMonth) return today.toISOString().slice(0,10);
  return `${cbYear}-${String(cbMonth+1).padStart(2,'0')}-01`;
}
function openTxnModal(id){
  refreshGroupList();
  fillCatOptions();
  document.getElementById('newCatName').value  = '';
  document.getElementById('newCatType').value  = '';
  document.getElementById('newCatGroup').value = '';
  if(id){
    const t = transactions.find(x => x.id === id);
    document.getElementById('txnModalTitle').textContent = 'Edit Entry';
    document.getElementById('txnId').value = t.id;
    fillCatOptions(t.categoryId);
    document.getElementById('txnDate').value   = t.date;
    document.getElementById('txnAmount').value = t.amount;
    document.getElementById('txnDesc').value   = t.description || '';
    document.getElementById('txnRef').value    = t.ref   || '';
    document.getElementById('txnVc').value     = t.vcNo  || '';
    document.getElementById('txnPayType').value = t.paymentType;
  } else {
    document.getElementById('txnModalTitle').textContent = 'Add Entry';
    document.getElementById('txnId').value     = '';
    document.getElementById('txnDate').value   = defaultEntryDate();
    document.getElementById('txnAmount').value = '';
    document.getElementById('txnDesc').value   = '';
    document.getElementById('txnRef').value    = '';
    document.getElementById('txnVc').value     = '';
    document.getElementById('txnPayType').value = '';
  }
  document.getElementById('txnOverlay').classList.add('active');
}
function closeTxnModal(){ document.getElementById('txnOverlay').classList.remove('active'); }

async function saveTxn(){
  const id          = document.getElementById('txnId').value;
  let   categoryId  = document.getElementById('txnCategory').value;
  const date        = document.getElementById('txnDate').value;
  const amount      = parseFloat(document.getElementById('txnAmount').value);
  const pay         = document.getElementById('txnPayType').value;
  const description = document.getElementById('txnDesc').value.trim();
  const ref         = document.getElementById('txnRef').value.trim();
  const vcNo        = document.getElementById('txnVc').value.trim();

  if(!categoryId){ showToast('Choose a category.'); return; }
  if(!date){ showToast('Pick a date.'); return; }
  if(isNaN(amount) || amount <= 0){ showToast('Enter an amount greater than zero.'); return; }
  if(!pay){ showToast('Choose cash or bank.'); return; }

  /* Combined flow: create the category first if "+ Add new category…" was chosen */
  if(categoryId === '__new__'){
    const newName  = document.getElementById('newCatName').value.trim();
    const newType  = document.getElementById('newCatType').value;
    const newGroup = document.getElementById('newCatGroup').value.trim();
    if(!newName){ showToast('Enter a name for the new category.'); return; }
    if(!newType){ showToast('Select a type (Income or Expense) for the new category.'); return; }
    const { data: catData, error: catError } = await sb.from('categories')
      .insert(catToDb({ name: newName, group: newGroup, type: newType })).select().single();
    if(catError){ showToast('Could not create the category: ' + catError.message); return; }
    const newCat = catFromDb(catData);
    categories.push(newCat);
    categoryId = newCat.id;
  }

  const row = txnToDb({ categoryId, date, amount, paymentType: pay, description, ref, vcNo });

  if(id){
    const { data, error } = await sb.from('transactions').update(row).eq('id', id).select().single();
    if(error){ showToast('Could not save the entry: ' + error.message); return; }
    Object.assign(transactions.find(x => x.id === id), txnFromDb(data));
  } else {
    row.created_by = currentUser.id;
    const { data, error } = await sb.from('transactions').insert(row).select().single();
    if(error){ showToast('Could not save the entry: ' + error.message); return; }
    transactions.push(txnFromDb(data));
  }

  const [sy,sm] = date.split('-').map(Number);
  cbYear = sy; cbMonth = sm - 1;
  renderAll(); closeTxnModal(); showToast('Entry saved');
}

function deleteTxn(id){
  const t = transactions.find(x => x.id === id); if(!t) return;
  const c = catById(t.categoryId);
  askConfirm('Delete entry',
    `Remove the ${fmtMoney(t.amount)} entry for <strong>${esc(c ? c.name : 'this category')}</strong> dated ${fmtDate(t.date)}? This cannot be undone.`,
    async () => {
      const { error } = await sb.from('transactions').delete().eq('id', id);
      if(error){ showToast('Could not delete the entry: ' + error.message); return; }
      transactions = transactions.filter(x => x.id !== id);
      renderAll(); showToast('Entry deleted');
    });
}

function refreshGroupList(){
  const gs = [...new Set(categories.map(c => (c.group || '').trim()).filter(Boolean))].sort();
  document.getElementById('groupList').innerHTML = gs.map(g => `<option value="${esc(g)}">`).join('');
}
function openCatModal(id){
  refreshGroupList();
  if(id){
    const c = categories.find(x => x.id === id);
    document.getElementById('catModalTitle').textContent = 'Edit category';
    document.getElementById('catId').value    = c.id;
    document.getElementById('catName').value  = c.name;
    document.getElementById('catGroup').value = c.group || '';
    document.getElementById('catType').value  = c.type;
  } else {
    document.getElementById('catModalTitle').textContent = 'Add category';
    document.getElementById('catId').value    = '';
    document.getElementById('catName').value  = '';
    document.getElementById('catGroup').value = '';
    document.getElementById('catType').value  = '';
  }
  document.getElementById('catOverlay').classList.add('active');
}
function closeCatModal(){ document.getElementById('catOverlay').classList.remove('active'); }

async function saveCat(){
  const id    = document.getElementById('catId').value;
  const name  = document.getElementById('catName').value.trim();
  const group = document.getElementById('catGroup').value.trim();
  const ty    = document.getElementById('catType').value;
  if(!name){ showToast('Enter a category name.'); return; }
  if(!ty){ showToast('Select a type — Income or Expense.'); return; }
  const row = catToDb({ name, group, type: ty });
  if(id){
    const { data, error } = await sb.from('categories').update(row).eq('id', id).select().single();
    if(error){ showToast('Could not save the category: ' + error.message); return; }
    Object.assign(categories.find(x => x.id === id), catFromDb(data));
  } else {
    const { data, error } = await sb.from('categories').insert(row).select().single();
    if(error){ showToast('Could not save the category: ' + error.message); return; }
    categories.push(catFromDb(data));
  }
  renderAll(); closeCatModal(); showToast('Category saved');
}

function deleteCat(id){
  const cat = categories.find(c => c.id === id); if(!cat) return;
  const linked = transactions.filter(t => t.categoryId === id);
  const msg = linked.length
    ? `<strong>${esc(cat.name)}</strong> has ${linked.length} entr${linked.length===1?'y':'ies'} recorded against it. Deleting the category also deletes those entries and removes their amounts from the cash book and the report.`
    : `Delete the category <strong>${esc(cat.name)}</strong>?`;
  askConfirm('Delete category', msg, async () => {
    /* the database's "on delete cascade" removes the linked transactions automatically */
    const { error } = await sb.from('categories').delete().eq('id', id);
    if(error){ showToast('Could not delete the category: ' + error.message); return; }
    categories   = categories.filter(c => c.id !== id);
    transactions = transactions.filter(t => t.categoryId !== id);
    renderAll();
    showToast(linked.length ? `Category and ${linked.length} entr${linked.length===1?'y':'ies'} deleted` : 'Category deleted');
  });
}

/* ---------- custom confirm ---------- */
let confirmAction = null;
function askConfirm(title, htmlMsg, onOk){
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').innerHTML     = htmlMsg;
  confirmAction = onOk;
  document.getElementById('confirmOverlay').classList.add('active');
}
function closeConfirm(){
  document.getElementById('confirmOverlay').classList.remove('active');
  confirmAction = null;
}

/* ---------- toast ---------- */
let toastTimer;
function showToast(m){
  const el = document.getElementById('toast');
  el.textContent = m;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('loginNote').innerHTML =
    'Sign in with the email and password created for you in Supabase (Authentication &rarr; Users). ' +
    'If you do not have one yet, ask the developer to add you.';

  document.getElementById('todayLabel').textContent =
    new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });

  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('logoutBtn').addEventListener('click', doLogout);
  document.getElementById('loginPass').addEventListener('keydown', e => { if(e.key === 'Enter') doLogin(); });
  document.getElementById('loginUser').addEventListener('keydown', e => { if(e.key === 'Enter') doLogin(); });
  document.getElementById('forgotBtn').addEventListener('click', async () => {
    const email = document.getElementById('loginUser').value.trim();
    if(!email){ showToast('Type your email above first, then press Forgot password.'); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email);
    showToast(error ? 'Could not send reset email: ' + error.message : 'Password reset email sent — check your inbox.');
  });

  document.getElementById('confirmOkBtn').addEventListener('click', async () => {
    const fn = confirmAction; closeConfirm(); if(fn) await fn();
  });
  document.querySelectorAll('.overlay').forEach(ov =>
    ov.addEventListener('click', e => { if(e.target === ov) ov.classList.remove('active'); }));
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape') document.querySelectorAll('.overlay.active').forEach(o => o.classList.remove('active'));
  });

  buildMonthButtons();
  buildCbMonthButtons();
  buildCbFilterInputs();
  buildRepFilterInputs();

  /* restore session if the tab was only refreshed — Supabase keeps this in its own storage */
  const { data } = await sb.auth.getSession();
  if(data.session && data.session.user){
    await loadProfile(data.session.user);
    showApp();
    await loadData();
  } else {
    showLogin();
  }
});
