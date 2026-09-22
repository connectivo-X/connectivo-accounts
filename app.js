/* ============================================================
   Connectivo — Accounts and Cash Book
   Plain JavaScript. No build step, no framework.
   ============================================================ */

const MONTHS      = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const MONTH_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = MONTHS.map(m => m.charAt(0) + m.slice(1).toLowerCase());
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
function fmtMoney(n){ return (n<0?'-':'') + Math.round(Math.abs(n)).toLocaleString('en-US',{maximumFractionDigits:0}); }
function fmtCell(n){ return n ? Math.round(n).toLocaleString('en-US',{maximumFractionDigits:0}) : ''; }
function cell(v){ return v ? Math.round(v).toLocaleString('en-US',{maximumFractionDigits:0}) : ''; }
function fmtDate(iso){
  if(!iso) return '';
  const [y,m,d] = iso.split('-').map(Number);
  return String(d).padStart(2,'0') + '-' + MONTHS_SHORT[m-1] + '-' + y;
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
function renderAll(){ renderLedger(); renderReport(); refreshGroupList(); refreshFilterCategoryOptions(); }

/* ============================================================
   CASH BOOK — Dr. / Cr. ledger
   ============================================================ */
function buildCbMonthButtons(){
  document.getElementById('cbMonthBtns').innerHTML = MONTHS.map((m,i) =>
    `<button class="period-btn" data-cbmonth="${i}" onclick="setCbMonth(${i})">${m}</button>`).join(' ');
}
function setCbMonth(m){ cbMonth = m; renderLedger(); }
function changeCbMonth(d){
  cbMonth += d;
  if(cbMonth < 0){ cbMonth = 11; cbYear--; }
  if(cbMonth > 11){ cbMonth = 0; cbYear++; }
  renderLedger();
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
    <td class="head-acct"><div class="acct-line"><div><div style="color:${c && c.type==='income'?'var(--income)':'var(--expense)'}">${esc(name)}</div>${note}</div>
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
  document.getElementById('cbMonthTitle').textContent = `Month Of ${MONTH_FULL[cbMonth]} - ${cbYear}`;

  const { bd, receipts, payments, drCash, drBank, crCash, crBank, cdCash, cdBank } = getLedgerData(cbYear, cbMonth);

  const MIN_ROWS = 10;
  const rows = Math.max(receipts.length, payments.length, MIN_ROWS);

  let html = `<table class="ledger">
    <thead>
      <tr class="drcr"><th colspan="6">Dr.</th><th colspan="6" class="cr-side">Cr.</th></tr>
      <tr class="col-head">
        <th rowspan="2">Date</th><th rowspan="2">Received / Head Of Account</th>
        <th rowspan="2">Ref</th><th rowspan="2">Vc No.</th><th colspan="2">Amount</th>
        <th rowspan="2" class="mid">Date</th><th rowspan="2">Payment / Head Of Account</th>
        <th rowspan="2">Ref</th><th rowspan="2">Vc No.</th><th colspan="2">Amount</th>
      </tr>
      <tr class="sub-head"><th>Cash</th><th>Bank</th><th>Cash</th><th>Bank</th></tr>
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

  document.getElementById('sumCash').textContent = fmtMoney(cdCash);
  document.getElementById('sumBank').textContent = fmtMoney(cdBank);
  const totalIn  = receipts.reduce((s,t) => s + t.amount, 0);
  const totalOut = payments.reduce((s,t) => s + t.amount, 0);
  document.getElementById('statCashIn').textContent      = fmtMoney(totalIn);
  document.getElementById('statCashOut').textContent     = fmtMoney(totalOut);
  document.getElementById('statNetBalance').textContent  = fmtMoney(totalIn - totalOut);
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
}
function changeYear(d){ reportYear += d; renderReport(); }

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
        html += `<tr class="cat-row"><td class="cat-col"><div class="cat-name-cell"><span style="color:${cat.type==='income'?'var(--income)':'var(--expense)'}">${esc(cat.name)}</span>
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
   SHARED FILTER SYSTEM — Duration / Type / Payment Mode / Categories
   Used by both the Cash Book and Expense Report tabs. `prefix` is
   'cb' or 'rep', matching each tab's own set of filter elements.
   ============================================================ */
function refreshFilterCategoryOptions(){
  ['cbfCategory','repfCategory'].forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    const current = el.value;
    el.innerHTML = '<option value="all">All</option>' +
      categories.map(c => `<option value="${c.id}">${esc(c.name)} (${c.type === 'income' ? 'Cash In' : 'Cash Out'})</option>`).join('');
    if([...el.options].some(o => o.value === current)) el.value = current;
  });
}

function handleDurationChange(prefix){
  const isCustom = document.getElementById(prefix + 'fDuration').value === 'custom';
  document.getElementById(prefix + 'fCustomRange').style.display = isCustom ? 'flex' : 'none';
  if(!isCustom) handleFilterChange(prefix);
}
function handleFilterChange(prefix){
  if(isFilterActive(prefix)) openFilterResultsPanel(prefix);
  else closeFilterResultsPanel();
}
function resetFilters2(prefix){
  document.getElementById(prefix + 'fDuration').value = 'all';
  document.getElementById(prefix + 'fType').value = 'all';
  document.getElementById(prefix + 'fPayMode').value = 'all';
  document.getElementById(prefix + 'fCategory').value = 'all';
  document.getElementById(prefix + 'fCustomRange').style.display = 'none';
  closeFilterResultsPanel();
}

function isFilterActive(prefix){
  return document.getElementById(prefix + 'fDuration').value !== 'all'
      || document.getElementById(prefix + 'fType').value !== 'all'
      || document.getElementById(prefix + 'fPayMode').value !== 'all'
      || document.getElementById(prefix + 'fCategory').value !== 'all';
}

function getDurationRange(prefix){
  const type = document.getElementById(prefix + 'fDuration').value;
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = new Date();
  if(type === 'today') return { start: iso(today), end: iso(today) };
  if(type === 'yesterday'){ const y = new Date(today); y.setDate(y.getDate()-1); return { start: iso(y), end: iso(y) }; }
  if(type === 'thismonth') return { start: iso(new Date(today.getFullYear(), today.getMonth(), 1)), end: iso(new Date(today.getFullYear(), today.getMonth()+1, 0)) };
  if(type === 'lastmonth') return { start: iso(new Date(today.getFullYear(), today.getMonth()-1, 1)), end: iso(new Date(today.getFullYear(), today.getMonth(), 0)) };
  if(type === 'custom'){
    const s = document.getElementById(prefix + 'fStartDate').value;
    const e = document.getElementById(prefix + 'fEndDate').value;
    return (s && e) ? { start: s, end: e } : null;
  }
  return null; // 'all'
}

function getFilteredTransactions(prefix){
  const range = getDurationRange(prefix);
  const ty  = document.getElementById(prefix + 'fType').value;
  const pm  = document.getElementById(prefix + 'fPayMode').value;
  const cat = document.getElementById(prefix + 'fCategory').value;
  return transactions.filter(t => {
    const c = catById(t.categoryId); if(!c) return false;
    if(range && (t.date < range.start || t.date > range.end)) return false;
    if(ty !== 'all' && c.type !== ty) return false;
    if(pm !== 'all' && t.paymentType !== pm) return false;
    if(cat !== 'all' && t.categoryId !== cat) return false;
    return true;
  }).sort((a,b) => b.date.localeCompare(a.date));
}

/* ---------- Filtered Results side panel ---------- */
let activeFilterPrefix = null;
let returnToFilterAfterSave = null;

function openFilterResultsPanel(prefix){
  activeFilterPrefix = prefix;
  renderFilterResultsPanel();
  document.getElementById('filterOverlay').classList.add('active');
}
function closeFilterResultsPanel(){
  document.getElementById('filterOverlay').classList.remove('active');
  activeFilterPrefix = null;
}
function refreshFilterResultsPanel(){
  if(activeFilterPrefix) renderFilterResultsPanel();
}
function renderFilterResultsPanel(){
  const list = getFilteredTransactions(activeFilterPrefix);
  let inc = 0, exp = 0;
  list.forEach(t => { const c = catById(t.categoryId); if(c && c.type === 'income') inc += t.amount; else exp += t.amount; });
  document.getElementById('frTotalIn').textContent  = fmtMoney(inc);
  document.getElementById('frTotalOut').textContent = fmtMoney(exp);
  const net = document.getElementById('frNet');
  net.textContent = fmtMoney(inc - exp);
  net.style.color = (inc - exp) < 0 ? 'var(--expense)' : 'var(--income)';

  document.getElementById('frList').innerHTML = list.length
    ? list.map(renderFilterRow).join('')
    : '<div class="empty-state"><div class="big">No entries match</div><div>Try widening the filters.</div></div>';
}
function renderFilterRow(t){
  const c = catById(t.categoryId);
  const ty = c ? c.type : 'expense';
  const name = c ? c.name : '(deleted category)';
  return `<div class="fr-row">
    <div class="fr-top">
      <span class="tag ${ty}">${ty === 'income' ? 'Cash In' : 'Cash Out'}</span>
      <span class="fr-date">${fmtDate(t.date)}</span>
    </div>
    <div class="fr-mid">
      <span style="color:${ty==='income'?'var(--income)':'var(--expense)'};font-weight:600">${esc(name)}</span>
      ${t.description ? `<span class="fr-desc"> — ${esc(t.description)}</span>` : ''}
    </div>
    <div class="fr-bottom">
      <span class="pay-badge">${t.paymentType === 'cash' ? 'Cash' : 'Bank'}</span>
      <span class="amt ${ty}">${ty === 'income' ? '+' : '-'}${fmtMoney(t.amount)}</span>
      <span class="row-actions">
        <button class="icon-btn" title="Edit" onclick="editFromFilterPanel('${t.id}')">&#9998;</button>
        <button class="icon-btn danger" title="Delete" onclick="deleteFromFilterPanel('${t.id}')">&#128465;</button>
      </span>
    </div>
  </div>`;
}
function editFromFilterPanel(id){
  returnToFilterAfterSave = activeFilterPrefix;
  closeFilterResultsPanel();
  openTxnModal(id);
}
function deleteFromFilterPanel(id){
  const t = transactions.find(x => x.id === id); if(!t) return;
  const c = catById(t.categoryId);
  askConfirm('Delete entry',
    `Remove the ${fmtMoney(t.amount)} entry for <strong>${esc(c ? c.name : 'this category')}</strong> dated ${fmtDate(t.date)}? This cannot be undone.`,
    async () => {
      const { error } = await sb.from('transactions').delete().eq('id', id);
      if(error){ showToast('Could not delete the entry: ' + error.message); return; }
      transactions = transactions.filter(x => x.id !== id);
      renderAll();
      refreshFilterResultsPanel();
      showToast('Entry deleted');
    });
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
  rows.push(['Month Of ' + MONTH_FULL[month] + ' - ' + year, '', '', '', '', '', '', '', '', '', '', '']);
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
    doc.text('Month Of ' + MONTH_FULL[month] + ' - ' + year, 14, 22);

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

/* ---------- Add Cash In / Cash Out side panel ---------- */
let catSearchPool = [];
let dpViewYear, dpViewMonth;

function defaultEntryDate(){
  const today = new Date();
  if(today.getFullYear() === cbYear && today.getMonth() === cbMonth) return today.toISOString().slice(0,10);
  return `${cbYear}-${String(cbMonth+1).padStart(2,'0')}-01`;
}
function fmtDateShort(iso){
  const [y,m,d] = iso.split('-').map(Number);
  return d + ' ' + MONTHS_SHORT[m-1] + ', ' + y;
}

/* -- Cash In / Cash Out toggle -- */
function setEntryTypeUI(type){
  document.getElementById('toggleCashIn').classList.toggle('active', type === 'income');
  document.getElementById('toggleCashOut').classList.toggle('active', type === 'expense');
  const title = document.getElementById('txnModalTitle');
  title.textContent = type === 'income' ? 'Add Cash In Entry' : 'Add Cash Out Entry';
  title.style.color = type === 'income' ? 'var(--income)' : 'var(--expense)';
  document.getElementById('txnEntryType').value = type;
  catSearchPool = categories.filter(c => c.type === type);
  document.getElementById('newCatType').value = type;
  document.getElementById('newCatType').disabled = true;
}
function switchEntryType(type){
  setEntryTypeUI(type);
  document.getElementById('txnCategory').value = '';
  document.getElementById('catSearchInput').value = '';
  document.getElementById('inlineNewCat').style.display = 'none';
  renderCatSearchOptions('');
}

/* -- Category search-select -- */
function renderCatSearchOptions(filterText){
  const host = document.getElementById('catSearchOptions');
  const q = (filterText || '').trim().toLowerCase();
  const list = catSearchPool.filter(c => c.name.toLowerCase().includes(q));
  let html = list.map(c => `<div class="ss-option" onclick="selectCategory('${c.id}')">
      <span class="radio-dot"></span><span style="color:${c.type==='income'?'var(--income)':'var(--expense)'}">${esc(c.name)}</span></div>`).join('');
  if(!list.length) html += `<div class="ss-empty">No matching category</div>`;
  html += `<div class="ss-option ss-add-new" onclick="selectCategory('__new__')">+ Add new category…</div>`;
  host.innerHTML = html;
}
function openCatSearchList(){
  document.getElementById('catSearchList').style.display = 'block';
  renderCatSearchOptions(document.getElementById('catSearchInput').value);
}
function toggleCatSearchList(){
  const el = document.getElementById('catSearchList');
  if(el.style.display === 'none') openCatSearchList(); else el.style.display = 'none';
}
function filterCatSearch(){ openCatSearchList(); }
function selectCategory(id){
  document.getElementById('catSearchList').style.display = 'none';
  document.getElementById('txnCategory').value = id;
  if(id === '__new__'){
    document.getElementById('catSearchInput').value = '';
    document.getElementById('inlineNewCat').style.display = 'block';
  } else {
    const c = catById(id);
    document.getElementById('catSearchInput').value = c ? c.name : '';
    document.getElementById('inlineNewCat').style.display = 'none';
  }
}

/* -- Payment Mode search-select -- */
function togglePaySearchList(){
  const el = document.getElementById('paySearchList');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
function selectPayMode(v){
  document.getElementById('txnPayType').value = v;
  document.getElementById('paySearchInput').value = v === 'cash' ? 'Cash' : 'Bank';
  document.getElementById('paySearchList').style.display = 'none';
}

/* -- Date calendar dropdown -- */
function toggleDatePicker(){
  const pop = document.getElementById('datePickerPop');
  const opening = pop.style.display === 'none';
  if(opening){
    const iso = document.getElementById('txnDate').value || defaultEntryDate();
    const [y,m] = iso.split('-').map(Number);
    dpViewYear = y; dpViewMonth = m - 1;
    renderDatePicker();
  }
  pop.style.display = opening ? 'block' : 'none';
}
function dpChangeMonth(d){
  dpViewMonth += d;
  if(dpViewMonth < 0){ dpViewMonth = 11; dpViewYear--; }
  if(dpViewMonth > 11){ dpViewMonth = 0; dpViewYear++; }
  renderDatePicker();
}
function renderDatePicker(){
  document.getElementById('dpMonthLabel').textContent = MONTH_FULL[dpViewMonth] + ' ' + dpViewYear;
  const firstDow = new Date(dpViewYear, dpViewMonth, 1).getDay();
  const dim = daysInMonth(dpViewYear, dpViewMonth);
  const selectedIso = document.getElementById('txnDate').value;
  let html = '';
  for(let i = 0; i < firstDow; i++) html += '<span></span>';
  for(let d = 1; d <= dim; d++){
    const iso = `${dpViewYear}-${String(dpViewMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    html += `<button type="button" class="dp-day${iso===selectedIso?' sel':''}" onclick="pickDate('${iso}')">${d}</button>`;
  }
  document.getElementById('datePickerGrid').innerHTML = html;
}
function pickDate(iso){
  document.getElementById('txnDate').value = iso;
  document.getElementById('dateDisplayText').textContent = fmtDateShort(iso);
  document.getElementById('datePickerPop').style.display = 'none';
}

/* close any open dropdown when clicking outside it */
document.addEventListener('click', e => {
  if(!e.target.closest('#catSearchSelect')){ const el = document.getElementById('catSearchList'); if(el) el.style.display = 'none'; }
  if(!e.target.closest('#paySearchSelect')){ const el = document.getElementById('paySearchList'); if(el) el.style.display = 'none'; }
  if(!e.target.closest('#dateFieldWrap')){ const el = document.getElementById('datePickerPop'); if(el) el.style.display = 'none'; }
});

function openTxnModal(id, typeHint){
  refreshGroupList();
  document.getElementById('newCatName').value  = '';
  document.getElementById('newCatGroup').value = '';
  document.getElementById('inlineNewCat').style.display = 'none';
  document.getElementById('catSearchList').style.display = 'none';
  document.getElementById('paySearchList').style.display = 'none';
  document.getElementById('datePickerPop').style.display = 'none';

  if(id){
    const t = transactions.find(x => x.id === id);
    const c = catById(t.categoryId);
    setEntryTypeUI(c ? c.type : (typeHint || 'expense'));
    document.getElementById('newCatType').disabled = false;
    document.getElementById('txnId').value = t.id;
    document.getElementById('txnCategory').value = t.categoryId;
    document.getElementById('catSearchInput').value = c ? c.name : '';
    document.getElementById('txnDate').value = t.date;
    document.getElementById('dateDisplayText').textContent = fmtDateShort(t.date);
    document.getElementById('txnAmount').value = t.amount;
    document.getElementById('txnDesc').value   = t.description || '';
    document.getElementById('txnRef').value    = t.ref   || '';
    document.getElementById('txnVc').value     = t.vcNo  || '';
    document.getElementById('txnPayType').value = t.paymentType;
    document.getElementById('paySearchInput').value = t.paymentType === 'cash' ? 'Cash' : t.paymentType === 'bank' ? 'Bank' : '';
  } else {
    setEntryTypeUI(typeHint || 'income');
    document.getElementById('txnId').value = '';
    document.getElementById('txnCategory').value = '';
    document.getElementById('catSearchInput').value = '';
    const d = defaultEntryDate();
    document.getElementById('txnDate').value = d;
    document.getElementById('dateDisplayText').textContent = fmtDateShort(d);
    document.getElementById('txnAmount').value = '';
    document.getElementById('txnDesc').value   = '';
    document.getElementById('txnRef').value    = '';
    document.getElementById('txnVc').value     = '';
    document.getElementById('txnPayType').value = '';
    document.getElementById('paySearchInput').value = '';
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
  if(!pay){ showToast('Choose a payment mode.'); return; }

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
  if(returnToFilterAfterSave){
    openFilterResultsPanel(returnToFilterAfterSave);
    returnToFilterAfterSave = null;
  }
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
    if(e.key === 'Escape'){
      document.querySelectorAll('.overlay.active').forEach(o => o.classList.remove('active'));
      document.querySelectorAll('.side-overlay.active').forEach(o => o.classList.remove('active'));
    }
  });

  buildMonthButtons();
  buildCbMonthButtons();

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
