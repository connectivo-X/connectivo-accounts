/* ============================================================
   Connectivo — Accounts and Cash Book
   Plain JavaScript. No build step, no framework.
   ============================================================ */

const MONTHS      = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const MONTH_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const CAT_KEY     = 'connectivo:categories';
const TXN_KEY     = 'connectivo:transactions';
const SESSION_KEY = 'connectivo:session';

/* Demo users. Replaced by real accounts when Supabase is added. */
const DEMO_USERS = [
  { username:'admin',   password:'admin',   name:'Administrator',  role:'Developer'       },
  { username:'accounts',password:'accounts',name:'Account Manager', role:'Account Manager' },
  { username:'ceo',     password:'ceo',     name:'CEO',            role:'CEO'             }
];

let categories = [];
let transactions = [];
let currentUser = null;
let reportYear  = new Date().getFullYear();
let reportPeriod = 'summary';
let cbYear  = new Date().getFullYear();
let cbMonth = new Date().getMonth();

/* ---------- storage adapter ----------
   Works both inside the Claude preview (window.storage)
   and on a normal web server such as GitHub Pages (localStorage). */
const store = {
  async get(key){
    if (window.storage && window.storage.get) {
      const r = await window.storage.get(key, true);
      return r.value;
    }
    const v = localStorage.getItem(key);
    if (v === null) throw new Error('not found');
    return v;
  },
  async set(key, value){
    if (window.storage && window.storage.set) return window.storage.set(key, value, true);
    localStorage.setItem(key, value);
  }
};

/* ---------- helpers ---------- */
function uid(p){ return p + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtMoney(n){ return (n<0?'-':'') + Math.abs(n).toLocaleString('en-US',{maximumFractionDigits:2}); }
function fmtCell(n){ return n ? n.toLocaleString('en-US',{maximumFractionDigits:2}) : ''; }
function cell(v){ return v ? v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''; }
function fmtDate(iso){ if(!iso) return ''; const [y,m,d]=iso.split('-'); return d+'.'+m+'.'+y; }
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
function doLogin(){
  const u = document.getElementById('loginUser').value.trim().toLowerCase();
  const p = document.getElementById('loginPass').value;
  const err = document.getElementById('loginErr');
  const found = DEMO_USERS.find(x => x.username === u && x.password === p);
  if(!found){ err.textContent = 'Username or password is not correct.'; return; }
  err.textContent = '';
  currentUser = { name: found.name, role: found.role, username: found.username };
  try{ sessionStorage.setItem(SESSION_KEY, JSON.stringify(currentUser)); }catch(e){}
  document.getElementById('loginPass').value = '';
  showApp();
  loadData();
}
function doLogout(){
  currentUser = null;
  try{ sessionStorage.removeItem(SESSION_KEY); }catch(e){}
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  showLogin();
}

/* ============================================================
   DATA
   ============================================================ */
async function loadData(){
  try{ categories   = JSON.parse(await store.get(CAT_KEY)); }catch(e){ categories = []; }
  try{ transactions = JSON.parse(await store.get(TXN_KEY)); }catch(e){ transactions = []; }
  renderAll();
}
async function persistCategories(){
  try{ await store.set(CAT_KEY, JSON.stringify(categories)); }
  catch(e){ showToast('Could not save the category. Try again.'); }
}
async function persistTransactions(){
  try{ await store.set(TXN_KEY, JSON.stringify(transactions)); }
  catch(e){ showToast('Could not save the entry. Try again.'); }
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
    <td class="date-c${isCr ? ' mid' : ''}">${fmtDate(t.date)}</td>
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

function renderLedger(){
  document.getElementById('cbYearLabel').textContent = cbYear;
  document.querySelectorAll('.period-btn[data-cbmonth]').forEach(b =>
    b.classList.toggle('active', Number(b.dataset.cbmonth) === cbMonth));
  document.getElementById('cbMonthTitle').textContent = `Month Of ${MONTH_FULL[cbMonth]} _${cbYear}`;

  const bd       = openingBalance(cbYear, cbMonth);
  const receipts = monthTxns(cbYear, cbMonth, 'income');
  const payments = monthTxns(cbYear, cbMonth, 'expense');

  const drCash = bd.cash + receipts.filter(t => t.paymentType === 'cash').reduce((s,t) => s + t.amount, 0);
  const drBank = bd.bank + receipts.filter(t => t.paymentType === 'bank').reduce((s,t) => s + t.amount, 0);
  const crCash = payments.filter(t => t.paymentType === 'cash').reduce((s,t) => s + t.amount, 0);
  const crBank = payments.filter(t => t.paymentType === 'bank').reduce((s,t) => s + t.amount, 0);
  const cdCash = drCash - crCash;
  const cdBank = drBank - crBank;

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
    <td class="date-c">01.${String(cbMonth+1).padStart(2,'0')}.${cbYear}</td>
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
    cols.map(c => `<th>${c.label}</th>`).join('') +
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
          vals.map(v => `<td class="${v ? '' : 'zero'}">${fmtCell(v)}</td>`).join('') +
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
  el.innerHTML = h;
  if(sel) el.value = sel;
}
function defaultEntryDate(){
  const today = new Date();
  if(today.getFullYear() === cbYear && today.getMonth() === cbMonth) return today.toISOString().slice(0,10);
  return `${cbYear}-${String(cbMonth+1).padStart(2,'0')}-01`;
}
function openTxnModal(id){
  if(!categories.length){ showToast('Add a category first — an entry needs one.'); switchTab('report'); return; }
  fillCatOptions();
  if(id){
    const t = transactions.find(x => x.id === id);
    document.getElementById('txnModalTitle').textContent = 'Edit entry';
    document.getElementById('txnId').value = t.id;
    fillCatOptions(t.categoryId);
    document.getElementById('txnDate').value   = t.date;
    document.getElementById('txnAmount').value = t.amount;
    document.getElementById('txnDesc').value   = t.description || '';
    document.getElementById('txnRef').value    = t.ref   || '';
    document.getElementById('txnVc').value     = t.vcNo  || '';
    setRadio('txnPayType', t.paymentType);
  } else {
    document.getElementById('txnModalTitle').textContent = 'New entry';
    document.getElementById('txnId').value     = '';
    document.getElementById('txnDate').value   = defaultEntryDate();
    document.getElementById('txnAmount').value = '';
    document.getElementById('txnDesc').value   = '';
    document.getElementById('txnRef').value    = '';
    document.getElementById('txnVc').value     = '';
    setRadio('txnPayType', 'cash');
  }
  document.getElementById('txnOverlay').classList.add('active');
}
function closeTxnModal(){ document.getElementById('txnOverlay').classList.remove('active'); }

async function saveTxn(){
  const id          = document.getElementById('txnId').value;
  const categoryId  = document.getElementById('txnCategory').value;
  const date        = document.getElementById('txnDate').value;
  const amount      = parseFloat(document.getElementById('txnAmount').value);
  const pay         = document.querySelector('#txnPayType input:checked');
  const description = document.getElementById('txnDesc').value.trim();
  const ref         = document.getElementById('txnRef').value.trim();
  const vcNo        = document.getElementById('txnVc').value.trim();

  if(!categoryId){ showToast('Choose a category.'); return; }
  if(!date){ showToast('Pick a date.'); return; }
  if(isNaN(amount) || amount <= 0){ showToast('Enter an amount greater than zero.'); return; }
  if(!pay){ showToast('Choose cash or bank.'); return; }

  if(id) Object.assign(transactions.find(x => x.id === id),
    { categoryId, date, amount, paymentType: pay.value, description, ref, vcNo });
  else transactions.push({ id: uid('txn'), categoryId, date, amount, paymentType: pay.value, description, ref, vcNo });

  await persistTransactions();
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
      transactions = transactions.filter(x => x.id !== id);
      await persistTransactions(); renderAll(); showToast('Entry deleted');
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
    setRadio('catType', c.type);
  } else {
    document.getElementById('catModalTitle').textContent = 'Add category';
    document.getElementById('catId').value    = '';
    document.getElementById('catName').value  = '';
    document.getElementById('catGroup').value = '';
    setRadio('catType', 'expense');
  }
  document.getElementById('catOverlay').classList.add('active');
}
function closeCatModal(){ document.getElementById('catOverlay').classList.remove('active'); }

async function saveCat(){
  const id    = document.getElementById('catId').value;
  const name  = document.getElementById('catName').value.trim();
  const group = document.getElementById('catGroup').value.trim();
  const ty    = document.querySelector('#catType input:checked');
  if(!name){ showToast('Enter a category name.'); return; }
  if(!ty){ showToast('Choose income or expense.'); return; }
  if(id) Object.assign(categories.find(x => x.id === id), { name, group, type: ty.value });
  else categories.push({ id: uid('cat'), name, group, type: ty.value });
  await persistCategories();
  renderAll(); closeCatModal(); showToast('Category saved');
}

function deleteCat(id){
  const cat = categories.find(c => c.id === id); if(!cat) return;
  const linked = transactions.filter(t => t.categoryId === id);
  const msg = linked.length
    ? `<strong>${esc(cat.name)}</strong> has ${linked.length} entr${linked.length===1?'y':'ies'} recorded against it. Deleting the category also deletes those entries and removes their amounts from the cash book and the report.`
    : `Delete the category <strong>${esc(cat.name)}</strong>?`;
  askConfirm('Delete category', msg, async () => {
    categories   = categories.filter(c => c.id !== id);
    transactions = transactions.filter(t => t.categoryId !== id);
    await persistCategories();
    if(linked.length) await persistTransactions();
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
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('todayLabel').textContent =
    new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });

  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('logoutBtn').addEventListener('click', doLogout);
  document.getElementById('loginPass').addEventListener('keydown', e => { if(e.key === 'Enter') doLogin(); });
  document.getElementById('loginUser').addEventListener('keydown', e => { if(e.key === 'Enter') doLogin(); });
  document.getElementById('forgotBtn').addEventListener('click', () =>
    showToast('Password reset comes with real accounts (Supabase). For now ask the developer.'));

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

  /* restore session if the tab was only refreshed */
  try{
    const s = sessionStorage.getItem(SESSION_KEY);
    if(s){ currentUser = JSON.parse(s); showApp(); loadData(); return; }
  }catch(e){}
  showLogin();
});
