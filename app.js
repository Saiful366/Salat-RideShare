// ======== CONFIG ========
const DEFAULT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const DEMO_WINDOW_MS = 5 * 1000;        // 5 seconds (kept internally)
let DEMO_MODE = false;                  // backend-only quick timer

// ======== DATA (no ratings; includes unique passcodes) ========
const drivers = [
  { id: 'd1', name: 'Alice Kim',   car: 'Toyota Prius',  plate: 'PR1-234', passcode: 'alice123' },
  { id: 'd2', name: 'Ben Carter',  car: 'Honda Civic',   plate: 'CVC-889', passcode: 'ben123' },
  { id: 'd3', name: 'Chloe Nguyen',car: 'Hyundai Ioniq', plate: 'ION-552', passcode: 'chloe123' },
  { id: 'd4', name: 'Emi Barter',  car: 'Honda Civic',   plate: 'CVC 889', passcode: 'emi123' }
];

let requests = [];
let activeDriverId = null;

let history = []; // {type, at, userName, driverId?, requestId, help?}

/** Role + auth state */
let currentRole = 'user';  // 'user' | 'driver'
let authedDriverId = null; // driver id after successful password

// ======== HELPERS ========
const $ = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => [...el.querySelectorAll(sel)];
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
const now = () => Date.now();
const ONE_HOUR = 60 * 60 * 1000;

function uid() { return Math.random().toString(36).slice(2, 10); }
function getWindowMs() { return DEMO_MODE ? DEMO_WINDOW_MS : DEFAULT_WINDOW_MS; }
function getDriver(id) { return drivers.find(x => x.id === id); }
function getActiveDriver() { return getDriver(activeDriverId); }
function activeDriverName() { return getActiveDriver()?.name || '…'; }
function isAuthed() { return authedDriverId && authedDriverId === activeDriverId; }

// Loose phone checker
function isPhoneLike(s) {
  const digits = String(s || '').replace(/\D/g, '');
  return digits.length >= 7;
}

// statusBadge supports custom label override (for username-based headers)
function statusBadge(status, labelOverride) {
  const map = {
    OPEN: ['dot open', 'Open'],
    PENDING: ['dot pending', 'Pending'],
    ACCEPTED: ['dot accepted', 'Accepted'],
    CANCELLED_BY_USER: ['dot cancelled', 'Cancelled'],
    CANCELLED_BY_RIDESHARER: ['dot cancelled', 'Cancelled by ride sharer']
  };
  const [cls, label] = map[status] || ['dot', status];
  return `<span class="status"><span class="${cls}"></span>${labelOverride || label}</span>`;
}

function showToast(html, timeout = 3500) {
  const t = $('#toast');
  t.innerHTML = html;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), timeout);
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hasActiveRequestFor(name) {
  const n = name.trim().toLowerCase();
  return requests.some(r =>
    r.userName.trim().toLowerCase() === n &&
    !['CANCELLED_BY_USER','CANCELLED_BY_RIDESHARER'].includes(r.status)
  );
}

function pushHistory(entry) {
  history.push({ at: now(), ...entry });
  renderHistory();
  renderUserHistory();
  updateCancellationNotice();
}

// Internal clear (UI button removed)
function clearAll() {
  requests = [];
  history  = [];
  renderUserList();
  renderDriverList();
  renderHistory();
  renderUserHistory();
  updateCancellationNotice();
  showToast('Cleared.');
}
window.clearAll = clearAll;

// ======== ROLE + AUTH VISIBILITY ========
function setRole(role) {
  currentRole = role;
  if (role === 'driver') {
    authedDriverId = null;
    const pass = $('#driverPass'); if (pass) pass.value = '';
    $('#driverAuthMsg').classList.add('hidden'); $('#driverAuthMsg').textContent = '';
  }
  applyRoleVisibility();
  updateRoleWho();
}

function applyRoleVisibility() {
  const isUser = currentRole === 'user';
  $('[data-panel="user"]').classList.toggle('hidden', !isUser);
  $('[data-panel="driver"]').classList.toggle('hidden', isUser);
  $('#gridRoot').classList.add('single');
  updateDriverVisibility();
}

function updateRoleWho() {
  const label = $('#roleWho');
  if (currentRole === 'user') {
    const n = $('#userName')?.value?.trim();
    label.textContent = n ? `Signed in as ${n}` : '';
  } else {
    const d = getActiveDriver();
    if (!d) { label.textContent = ''; return; }
    label.textContent = isAuthed()
      ? `Signed in as ${d.name} — ${d.car} • ${d.plate}`
      : `Selected: ${d.name} (locked)`;
  }
}

function updateDriverVisibility() {
  const authed = currentRole === 'driver' && isAuthed();
  $('#driverListCard').classList.toggle('hidden', !authed);
  $('#driverAcceptedCard').classList.toggle('hidden', !authed);
  $('#activeDriverCard').classList.toggle('hidden', !authed);

  const msg = $('#driverAuthMsg');
  if (!authed && currentRole === 'driver') {
    // keep any existing error/info message visible
  } else {
    msg.classList.add('hidden');
    msg.textContent = '';
  }
}

// ======== UI RENDERERS ========
function renderDrivers() {
  const sel = $('#driverSelect');
  sel.innerHTML = drivers.map(d => `<option value="${d.id}">${escapeHTML(d.name)}</option>`).join('');
  if (!activeDriverId && drivers.length) {
    activeDriverId = drivers[0].id;
    sel.value = activeDriverId;
    updateActiveDriverCard();
  }
  updateRoleWho();
}

function updateActiveDriverCard() {
  const box = $('#activeDriver');
  const d = getActiveDriver();
  box.innerHTML = d
    ? `<strong>${d.name}</strong><br><span class="muted">${d.car} • ${d.plate}</span>`
    : 'No ridesharer logged in.';
}

function renderUserList() {
  const list = $('#userList');
  if (!requests.length) { list.innerHTML = '<div class="muted">No ride requests yet.</div>'; return; }

  const items = [...requests].reverse().map(r => {
    const lastMsg = (r.messages && r.messages.length) ? r.messages[r.messages.length - 1] : null;

    // username-based header labels for ALL key statuses
    let headerLabel = undefined;
    if (r.status === 'OPEN') headerLabel = r.userName;                            // <username>
    if (r.status === 'PENDING') headerLabel = `${r.userName} Pending`;            // <username> Pending
    if (r.status === 'ACCEPTED') headerLabel = `${r.userName} Accepted`;          // <username> Accepted
    if (r.status === 'CANCELLED_BY_USER' || r.status === 'CANCELLED_BY_RIDESHARER')
      headerLabel = `${r.userName} Cancelled`;                                    // <username> Cancelled

    const cancelNotice = (r.status === 'PENDING' && r.lastCancelledBy)
      ? `<div class="notice" style="margin-top:8px;">
           Your request has been cancelled. Wait until a new RideSharer accepts your request.
         </div>`
      : '';

    return `
    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:center;">
        <div>${statusBadge(r.status, headerLabel)}</div>
        <div class="small muted">Created ${fmtTime(r.createdAt)}</div>
      </div>
      <div class="spacer"></div>
      <div class="small"><strong>Pickup:</strong> ${escapeHTML(r.pickup || '—')}</div>
      ${r.notes ? `<div class="small"><strong>Notes:</strong> ${escapeHTML(r.notes)}</div>` : ''}
      ${r.status === 'ACCEPTED' ? renderRideSharerAssignment(r) : ''}
      ${lastMsg ? `<div class="small"><strong>Ride sharer message:</strong> ${escapeHTML(lastMsg.text)} <span class="muted">(${fmtTime(lastMsg.at)})</span></div>` : ''}
      ${cancelNotice}
      <div class="spacer"></div>
      ${!r.status.startsWith('CANCELLED') ? `<button class="btn ghost" data-cancel-user="${r.id}">Cancel Request</button>` : ''}
    </div>`;
  }).join('');

  list.innerHTML = items;

  // KPIs
  $('#kpiTotal').textContent = String(requests.length);
  $('#kpiAccepted').textContent = String(requests.filter(r => r.status === 'ACCEPTED').length);
  $('#kpiPending').textContent  = String(requests.filter(r => r.status === 'PENDING').length);
  $('#kpiCancelled').textContent = String(
    requests.filter(r => r.status === 'CANCELLED_BY_USER' || r.status === 'CANCELLED_BY_RIDESHARER').length
  );

  // wire cancel buttons
  $$('#userList [data-cancel-user]').forEach(btn => {
    btn.addEventListener('click', (e) => cancelByUser(e.currentTarget.getAttribute('data-cancel-user')));
  });
}

function renderRideSharerAssignment(r) {
  const d = getDriver(r.acceptedBy);
  if (!d) return '';
  return `
    <div class="card" style="background:#0d1b3a;border-color:#23306b;">
      <div class="small">Ride sharer</div>
      <div><strong>${d.name}</strong> — ${d.car} • ${d.plate}</div>
      <div class="small muted">Accepted at ${fmtTime(r.acceptedAt)}</div>
    </div>`;
}

function renderDriverList() {
  const list = $('#driverList');
  if (!isAuthed()) { list.innerHTML = '<div class="muted">Sign in to view requests.</div>'; return; }

  const visible = requests.filter(r => !['ACCEPTED','CANCELLED_BY_USER','CANCELLED_BY_RIDESHARER'].includes(r.status));
  list.innerHTML = visible.length
    ? [...visible].reverse().map(r => `
        <div class="card">
          <div class="row" style="justify-content:space-between; align-items:center;">
            <div>${statusBadge(r.status)}</div>
            <div class="small muted">Created ${fmtTime(r.createdAt)}</div>
          </div>
          <div class="spacer"></div>
          <div class="small"><strong>Rider:</strong> ${escapeHTML(r.userName)}</div>
          <div class="small"><strong>Pickup:</strong> ${escapeHTML(r.pickup || '—')}</div>
          ${r.notes ? `<div class="small"><strong>Notes:</strong> ${escapeHTML(r.notes)}</div>` : ''}
          ${isPhoneLike(r.contact) ? `<div class="small"><strong>Phone:</strong> ${escapeHTML(r.contact)}</div>` : ''}
          <div class="spacer"></div>
          <button class="btn" data-accept="${r.id}">Accept as ${activeDriverName()}</button>
        </div>
      `).join('')
    : '<div class="muted">No open or pending requests.</div>';

  $$('#driverList [data-accept]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-accept');
      acceptRequest(id, activeDriverId);
    });
  });

  renderDriverAcceptedList();
}

function renderDriverAcceptedList() {
  const list = $('#driverAcceptedList');
  if (!isAuthed()) { list.innerHTML = '<div class="muted">Sign in to view your accepted requests.</div>'; return; }

  const mine = requests.filter(r => r.status === 'ACCEPTED' && r.acceptedBy === activeDriverId);
  list.innerHTML = mine.length
    ? mine.reverse().map(r => `
      <div class="card">
        <div class="row" style="justify-content:space-between; align-items:center;">
          <div>${statusBadge(r.status)}</div>
          <div class="small muted">Accepted ${fmtTime(r.acceptedAt)}</div>
        </div>
        <div class="spacer"></div>
        <div class="small"><strong>You:</strong> ${escapeHTML(activeDriverName())} — ${escapeHTML(getActiveDriver().car)} • ${escapeHTML(getActiveDriver().plate)}</div>
        <div class="small"><strong>Rider:</strong> ${escapeHTML(r.userName)}</div>
        <div class="small"><strong>Pickup:</strong> ${escapeHTML(r.pickup || '—')}</div>
        ${r.notes ? `<div class="small"><strong>Notes:</strong> ${escapeHTML(r.notes)}</div>` : ''}
        ${isPhoneLike(r.contact) ? `<div class="small"><strong>Phone:</strong> ${escapeHTML(r.contact)}</div>` : ''}
        <div class="spacer"></div>
        <div class="row" style="align-items:center; gap:10px;">
          <input type="text" placeholder="Message to rider (e.g., I'm coming at 9:30)" data-msg-input="${r.id}" />
          <button class="btn" data-send-msg="${r.id}">Send</button>
          <label class="small"><input type="checkbox" data-help="${r.id}" /> Ask others to help</label>
          <button class="btn ghost right" data-cancel-driver="${r.id}">Cancel</button>
        </div>
      </div>
    `).join('')
    : '<div class="muted">No accepted requests yet.</div>';

  $$('#driverAcceptedList [data-send-msg]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-send-msg');
      const input = document.querySelector(`[data-msg-input="${id}"]`);
      const text = (input?.value || '').trim();
      if (!text) { showToast('Enter a message first.'); return; }
      sendRideSharerMessage(id, text);
      input.value = '';
    });
  });

  $$('#driverAcceptedList [data-cancel-driver]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-cancel-driver');
      const help = document.querySelector(`[data-help="${id}"]`)?.checked || false;
      cancelByRideSharer(id, activeDriverId, help);
    });
  });
}

function renderHistory() {
  const list = $('#historyList');
  if (!list) return;

  const items = [...history]
    .filter(h => h.type === 'CANCELLED_BY_USER' || h.type === 'CANCELLED_BY_RIDESHARER')
    .reverse()
    .slice(0, 20)
    .map(h => {
      if (h.type === 'CANCELLED_BY_USER') {
        return `<div class="history-item"><span class="small muted">${fmtTime(h.at)}</span> — ⚠️ ${escapeHTML(h.userName)} canceled their request.</div>`;
      } else {
        const who = getDriver(h.driverId)?.name || 'Ride sharer';
        const base = `⚠️ ${who} canceled an accepted ride for ${escapeHTML(h.userName)}.`;
        const help = h.help ? ` — can someone please help ${escapeHTML(h.userName)} whose request has been cancelled?` : '';
        return `<div class="history-item"><span class="small muted">${fmtTime(h.at)}</span> — ${base}${help}</div>`;
      }
    }).join('');

  list.innerHTML = items || '<div class="muted">No cancellations yet.</div>';
}

function renderUserHistory() {
  const list = $('#userHistoryList');
  if (!list) return;

  const myNames = new Set(requests.map(r => r.userName.trim().toLowerCase()));

  const items = [...history]
    .filter(h => h.type === 'CANCELLED_BY_RIDESHARER' && myNames.has(String(h.userName).trim().toLowerCase()))
    .reverse()
    .slice(0, 20)
    .map(h => {
      const line = `Your request has been cancelled. Wait until a new RideSharer accepts your request.`;
      return `<div class="history-item"><span class="small muted">${fmtTime(h.at)}</span> — ${line}</div>`;
    }).join('');

  list.innerHTML = items || '<div class="muted">No ride-sharer cancellations for your requests yet.</div>';
}

function updateCancellationNotice() {
  const bar = $('#noticeBar');
  const cutoff = now() - ONE_HOUR;
  const cancelledLastHour = history.filter(h => h.type === 'CANCELLED_BY_USER' && h.at >= cutoff).length;
  if (cancelledLastHour > 0) {
    bar.textContent = `Notice: ${cancelledLastHour} user cancellation${cancelledLastHour > 1 ? 's' : ''} in the last hour.`;
    bar.classList.remove('hidden');
  } else {
    bar.classList.add('hidden');
  }
}

function updateWindowChip() {
  $('#windowChip').textContent = `Window: ${DEMO_MODE ? '5 sec' : '5 min'}`;
}

// ======== AUTH ========
function handleDriverSignIn() {
  const passInput = $('#driverPass');
  const entered = (passInput.value || '').trim();
  const d = getActiveDriver();
  const msg = $('#driverAuthMsg');

  if (!d) return;
  if (!entered) {
    msg.textContent = 'Please enter password.';
    msg.classList.remove('hidden');
    updateDriverVisibility();
    return;
  }

  if (entered === d.passcode) {
    authedDriverId = d.id;
    msg.classList.add('hidden');
    msg.textContent = '';
    updateActiveDriverCard();
    updateDriverVisibility();
    renderDriverList();
    renderDriverAcceptedList();
    updateRoleWho();
    showToast(`<strong>${d.name}</strong> signed in successfully.`);
  } else {
    authedDriverId = null;
    updateDriverVisibility();
    renderDriverList();
    renderDriverAcceptedList();
    updateRoleWho();
    msg.textContent = 'Wrong password';
    msg.classList.remove('hidden');
  }
}

function logoutRideSharer() {
  authedDriverId = null;
  const pass = $('#driverPass'); if (pass) pass.value = '';
  $('#driverAuthMsg').classList.add('hidden');
  $('#driverAuthMsg').textContent = '';
  updateDriverVisibility();
  renderDriverList();
  renderDriverAcceptedList();
  updateRoleWho();
  showToast('Logged out.');
}

// ======== CORE LOGIC ========
function createRequest({ userName, contact, pickup, notes }) {
  const r = {
    id: uid(), userName, contact, pickup, notes,
    status: 'OPEN', createdAt: now(), windowMs: getWindowMs(),
    acceptedBy: undefined, acceptedAt: undefined, timer: undefined, messages: [],
    lastCancelledBy: undefined
  };

  r.timer = setTimeout(() => {
    const req = requests.find(x => x.id === r.id);
    if (req && req.status === 'OPEN') {
      req.status = 'PENDING';
      renderUserList();
      renderDriverList();
    }
  }, r.windowMs);

  requests.push(r);
  renderUserList();
  renderDriverList();
  renderUserHistory();
  showToast(`Ride request created.`);
}

function acceptRequest(requestId, driverId) {
  const req = requests.find(r => r.id === requestId);
  const drv = getDriver(driverId);
  if (!req || !drv) return;

  if (!isAuthed() || authedDriverId !== driverId) {
    showToast('Sign in with your password to accept requests.');
    return;
  }

  if (req.status === 'ACCEPTED') { showToast('This request is already accepted.'); return; }
  if (['CANCELLED_BY_USER','CANCELLED_BY_RIDESHARER'].includes(req.status)) { showToast('This request was canceled.'); return; }

  req.status = 'ACCEPTED';
  req.acceptedBy = driverId;
  req.acceptedAt = now();
  req.lastCancelledBy = undefined;
  if (req.timer) { clearTimeout(req.timer); req.timer = undefined; }

  showToast(`✅ Ride sharer <strong>${drv.name}</strong> accepted the request.`, 4500);

  renderUserList();
  renderDriverList();
}

function cancelByUser(requestId) {
  const req = requests.find(r => r.id === requestId);
  if (!req) return;
  if (req.timer) { clearTimeout(req.timer); req.timer = undefined; }
  req.status = 'CANCELLED_BY_USER';
  req.acceptedBy = undefined;
  req.acceptedAt = undefined;
  req.lastCancelledBy = undefined;

  pushHistory({ type: 'CANCELLED_BY_USER', userName: req.userName, requestId });

  showToast('You canceled your request.');
  renderUserList();
  renderDriverList();
  renderUserHistory();
}

function cancelByRideSharer(requestId, driverId, help=false) {
  const req = requests.find(r => r.id === requestId);
  const drv = getDriver(driverId);
  if (!req || !drv) return;

  if (!isAuthed() || authedDriverId !== driverId) {
    showToast('Sign in with your password to cancel.');
    return;
  }

  if (req.acceptedBy !== driverId || req.status !== 'ACCEPTED') {
    showToast('Only the accepting ride sharer can cancel this request.');
    return;
  }

  if (req.timer) { clearTimeout(req.timer); req.timer = undefined; }
  req.acceptedBy = undefined;
  req.acceptedAt = undefined;
  req.status = 'PENDING';
  req.lastCancelledBy = drv.name;

  pushHistory({ type: 'CANCELLED_BY_RIDESHARER', userName: req.userName, driverId, requestId, help });

  showToast(`⚠️ Ride sharer <strong>${drv.name}</strong> canceled. Your request is available again.`, 5000);
  renderUserList();
  renderDriverList();
  renderUserHistory();
}

function sendRideSharerMessage(requestId, text) {
  const req = requests.find(r => r.id === requestId);
  if (!req || req.status !== 'ACCEPTED') { showToast('Message can be sent only for accepted requests.'); return; }
  if (!isAuthed() || authedDriverId !== req.acceptedBy) { showToast('Sign in first.'); return; }
  req.messages = req.messages || [];
  req.messages.push({ from: 'ridesharer', text, at: now() });
  showToast(`✉️ Ride sharer message: ${escapeHTML(text)}`, 4500);
  renderUserList();
  renderDriverList();
}

// ======== EVENTS ========
$('#requestForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const userName = $('#userName').value.trim();
  const contact = $('#contact').value.trim();
  const pickup = $('#pickup').value.trim();
  const notes = $('#notes').value.trim();

  if (!userName || !pickup) { showToast('Please enter your name and pickup description.'); return; }
  if (hasActiveRequestFor(userName)) { showToast('You already have an active request. Cancel it before requesting again.'); return; }

  createRequest({ userName, contact, pickup, notes });
  e.target.reset();
  updateRoleWho();
});

$('#driverSelect').addEventListener('change', (e) => {
  activeDriverId = e.target.value;
  authedDriverId = null;  // switching ride sharer logs out
  $('#driverPass').value = '';
  $('#driverAuthMsg').textContent = '';
  $('#driverAuthMsg').classList.add('hidden');
  updateActiveDriverCard();
  renderDriverList();
  renderDriverAcceptedList();
  updateDriverVisibility();
  updateRoleWho();
});

$('#userName').addEventListener('input', updateRoleWho);
$('#goOnline').addEventListener('click', handleDriverSignIn);
$('#logoutBtn').addEventListener('click', logoutRideSharer);
$('#roleSelect').addEventListener('change', (e) => setRole(e.target.value));

// ======== INIT ========
renderDrivers();
updateActiveDriverCard();
updateWindowChip();
renderUserList();
renderDriverList();
renderHistory();
renderUserHistory();
updateCancellationNotice();
applyRoleVisibility();
updateRoleWho();
setInterval(updateCancellationNotice, 60 * 1000);
