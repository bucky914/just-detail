// =========================================================
// Admin Bookings — filterable list with status actions
// IMPORTANT: washes_used/washes_remaining are updated automatically
// by a database trigger when a booking's status becomes 'completed'.
// This file never writes to those columns directly.
// =========================================================

let currentFilter = 'today';
let allOneTimeBookings = [];
let onetimeSearchTerm = '';
let onetimePayFilter = 'all';

// Dedicated maintenance-booking date picker for the reschedule modal.
// Kept separate from initDateField()'s other callers (e.g. expense
// dates on finances.html) so that adding conflict-aware disabling here
// can't affect unrelated admin date fields.
let rescheduleDateFieldCtl = null;
let rescheduleOccupiedDates = new Set();
let rescheduleEditingBookingId = null;
let currentBookingsById = {}; // populated by renderBookingsTable, used by the reschedule button

async function init() {
  const adminUser = await requireAdmin();
  if (!adminUser) return;

  initAdminShell('bookings.html', adminUser);

  document.querySelectorAll('#statusFilters .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#statusFilters .filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter;
      loadBookings();
    });
  });

  document.querySelectorAll('#bookingTypeTabs .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#bookingTypeTabs .filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const tab = chip.dataset.tab;
      document.getElementById('maintenanceView').style.display = tab === 'maintenance' ? 'block' : 'none';
      document.getElementById('onetimeView').style.display = tab === 'onetime' ? 'block' : 'none';
      if (tab === 'onetime' && allOneTimeBookings.length === 0) loadOneTimeBookings();
    });
  });

  document.getElementById('onetimeSearch').addEventListener('input', (e) => {
    onetimeSearchTerm = e.target.value.trim().toLowerCase();
    renderOneTimeBookings();
  });

  document.querySelectorAll('#onetimePaymentFilters .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#onetimePaymentFilters .filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      onetimePayFilter = chip.dataset.payfilter;
      renderOneTimeBookings();
    });
  });

  initRescheduleModal();

  await loadBookings();
  document.getElementById('pageLoading').style.display = 'none';
  document.getElementById('pageContent').style.display = 'block';
}

// ---------------- Reschedule modal ----------------

function initRescheduleModal() {
  const overlay = document.getElementById('rescheduleModalOverlay');
  const closeBtn = document.getElementById('rescheduleModalClose');
  const form = document.getElementById('rescheduleForm');

  rescheduleDateFieldCtl = initDateField('rescheduleDate');

  // initDateField() re-renders the grid on month navigation (its own
  // click handlers run first since they're bound first); re-apply our
  // occupied-date disabling afterward on each navigation click so it
  // survives the re-render instead of being wiped by it.
  document.getElementById('rescheduleDatePrev').addEventListener('click', applyRescheduleDateDisabling);
  document.getElementById('rescheduleDateNext').addEventListener('click', applyRescheduleDateDisabling);

  function close() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await submitReschedule();
  });

  window._closeRescheduleModal = close;
}

async function openRescheduleModal(booking) {
  rescheduleEditingBookingId = booking.id;
  document.getElementById('rescheduleBookingId').value = booking.id;
  document.getElementById('rescheduleTime').value = booking.confirmed_time || booking.requested_time || '';
  document.getElementById('rescheduleNote').value = '';
  rescheduleDateFieldCtl.reset();

  // Load currently occupied maintenance dates, excluding the booking
  // being edited, so the admin can't pick a date already held by
  // another active booking. The database's partial unique indexes
  // remain the final protection regardless of this client-side filter.
  await loadRescheduleOccupiedDates(booking.id);

  const overlay = document.getElementById('rescheduleModalOverlay');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

async function loadRescheduleOccupiedDates(excludeBookingId) {
  const { data, error } = await supabaseClient
    .from('bookings')
    .select('id, requested_date, confirmed_date, status')
    .in('status', ['pending', 'confirmed', 'rescheduled_by_admin']);

  if (error) {
    console.error('Failed to load occupied maintenance dates:', error);
    rescheduleOccupiedDates = new Set();
    return;
  }

  rescheduleOccupiedDates = new Set(
    (data || [])
      .filter(b => b.id !== excludeBookingId)
      .map(b => b.confirmed_date || b.requested_date)
  );

  applyRescheduleDateDisabling();
}

// initDateField()'s month label is rendered via toLocaleString('en-IN',
// { month: 'long', year: 'numeric' }) — e.g. "August 2026". Parsed back
// out here rather than re-parsed with new Date(string), which is
// locale-dependent and unreliable across browsers.
const RESCHEDULE_MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Marks occupied dates as disabled inside the reschedule picker's grid.
// Runs after each render (initial load + month navigation), since
// initDateField() rebuilds the grid's buttons on every render() call.
function applyRescheduleDateDisabling() {
  const grid = document.getElementById('rescheduleDateGrid');
  if (!grid) return;

  const monthLabel = document.getElementById('rescheduleDateMonthLabel').textContent.trim();
  const [monthName, yearStr] = monthLabel.split(' ');
  const monthIdx = RESCHEDULE_MONTH_NAMES.indexOf(monthName);
  const year = parseInt(yearStr, 10);
  if (monthIdx === -1 || isNaN(year)) return;

  grid.querySelectorAll('.custom-date-cell').forEach(btn => {
    if (btn.disabled) return; // leave any pre-existing disabled state alone
    const day = parseInt(btn.textContent.trim(), 10);
    if (isNaN(day)) return;
    const dateStr = toLocalDateStr(new Date(year, monthIdx, day));
    if (rescheduleOccupiedDates.has(dateStr)) {
      btn.disabled = true;
      btn.classList.add('custom-date-cell-disabled');
      btn.classList.add('custom-date-cell-booked');
      btn.title = 'Already booked';
    }
  });
}

async function submitReschedule() {
  const submitBtn = document.getElementById('rescheduleSubmit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  const bookingId = document.getElementById('rescheduleBookingId').value;
  const newDate = document.getElementById('rescheduleDate').value;
  const newTime = document.getElementById('rescheduleTime').value.trim();
  const note = document.getElementById('rescheduleNote').value.trim();

  if (!newDate) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save New Date';
    showToast('Please pick a date.', 'error');
    return;
  }

  // requested_date is intentionally left untouched — only confirmed_date/
  // confirmed_time/status change on a reschedule, per the existing schema
  // where requested_date always reflects what the customer originally asked for.
  const updatePayload = {
    confirmed_date: newDate,
    status: 'rescheduled_by_admin',
  };
  if (newTime) updatePayload.confirmed_time = newTime;
  if (note) updatePayload.admin_note = note;

  const { error } = await supabaseClient
    .from('bookings')
    .update(updatePayload)
    .eq('id', bookingId);

  submitBtn.disabled = false;
  submitBtn.textContent = 'Save New Date';

  if (error) {
    if (error.code === '23505') {
      showToast('This date is already occupied by another active maintenance booking. Please select another date.', 'error');
      await loadRescheduleOccupiedDates(bookingId);
      return;
    }
    showToast('Failed to reschedule: ' + error.message, 'error');
    return;
  }

  showToast('Booking rescheduled.');
  window._closeRescheduleModal();
  await loadBookings();
}

async function loadOneTimeBookings() {
  const { data, error } = await supabaseClient
    .from('one_time_bookings')
    .select('*, payments(id, amount)')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to load one-time bookings:', error);
    allOneTimeBookings = [];
  } else {
    allOneTimeBookings = data || [];
  }

  renderOneTimeBookings();
}

function renderOneTimeBookings() {
  const tbody = document.getElementById('onetimeBody');
  const emptyEl = document.getElementById('onetimeEmpty');
  const tableEl = document.getElementById('onetimeTable');
  const filtered = allOneTimeBookings.filter(b => {
    // Search
    if (onetimeSearchTerm) {
      const matches = (b.customer_name || '').toLowerCase().includes(onetimeSearchTerm) ||
                       (b.customer_phone || '').toLowerCase().includes(onetimeSearchTerm);
      if (!matches) return false;
    }

    // Payment filter
    const isPaid = b.payments && b.payments.length > 0;
    if (onetimePayFilter === 'paid' && !isPaid) return false;
    if (onetimePayFilter === 'unpaid' && isPaid) return false;

    return true;
  });

  if (filtered.length === 0) {
    tableEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }

  tableEl.style.display = 'table';
  emptyEl.style.display = 'none';

  tbody.innerHTML = filtered.map(b => {
    const isPaid = b.payments && b.payments.length > 0;
    const amount = b.calculated_price ? Number(b.calculated_price) : null;

    let actionHtml;
    if (isPaid) {
      actionHtml = '<span class="badge badge-active">Paid</span>';
    } else if (amount) {
      actionHtml = `
        <div class="btn-row">
          <button class="btn btn-success btn-sm" data-confirm-payment="${b.id}" data-amount="${amount}">Confirm Payment</button>
          <a href="finances.html?pay_onetime=${b.id}" class="btn btn-outline btn-sm">Other Amount</a>
        </div>`;
    } else {
      actionHtml = `<a href="finances.html?pay_onetime=${b.id}" class="btn btn-outline btn-sm">Record Payment →</a>`;
    }

    return `
      <tr>
        <td>${b.customer_name}</td>
        <td>${b.customer_phone}</td>
        <td>${b.service}</td>
        <td>${b.vehicle_model || '—'}${b.vehicle_type ? ' · ' + b.vehicle_type : ''}</td>
        <td>${amount ? '₹' + amount.toLocaleString('en-IN') : '—'}</td>
        <td>${b.requested_date ? formatDate(b.requested_date) : '—'} ${b.requested_time || ''}</td>
        <td>${actionHtml}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-confirm-payment]').forEach(btn => {
    btn.addEventListener('click', () => confirmOneTimePayment(btn.dataset.confirmPayment, btn.dataset.amount, btn));
  });
}

async function confirmOneTimePayment(bookingId, amount, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = 'Confirming…';

  const { error } = await supabaseClient.from('payments').insert({
    one_time_booking_id: bookingId,
    amount: Number(amount),
    payment_method: 'cash',
    payment_status: 'paid',
    payment_date: toLocalDateStr(new Date()),
  });

  if (error) {
    showToast('Failed to confirm payment: ' + error.message, 'error');
    btnEl.disabled = false;
    btnEl.textContent = 'Confirm Payment';
    return;
  }

  showToast('Payment confirmed — added to revenue.');
  await loadOneTimeBookings();
}

async function loadBookings() {
  const todayStr = toLocalDateStr(new Date());

  let query = supabaseClient
    .from('bookings')
    .select('*, subscriptions(vehicle_model, clients(full_name))');

  if (currentFilter === 'today') {
    query = query.eq('requested_date', todayStr).in('status', ['pending', 'confirmed', 'rescheduled_by_admin']);
  } else if (currentFilter === 'upcoming') {
    query = query.gt('requested_date', todayStr).in('status', ['pending', 'confirmed', 'rescheduled_by_admin']);
  } else if (currentFilter === 'completed') {
    query = query.eq('status', 'completed');
  } else if (currentFilter === 'cancelled') {
    query = query.eq('status', 'cancelled');
  }

  const { data, error } = await query.order('requested_date', { ascending: currentFilter !== 'completed' });

  renderBookingsTable(data || [], error);
}

function renderBookingsTable(data, error) {
  const tbody = document.getElementById('bookingsBody');
  const emptyEl = document.getElementById('bookingsEmpty');
  const tableEl = document.getElementById('bookingsTable');

  if (error || !data || data.length === 0) {
    tableEl.style.display = 'none';
    emptyEl.style.display = 'block';
    if (error) console.error('Failed to load bookings:', error);
    return;
  }

  tableEl.style.display = 'table';
  emptyEl.style.display = 'none';

  currentBookingsById = {};
  data.forEach(b => { currentBookingsById[b.id] = b; });

  tbody.innerHTML = data.map(b => {
    const customerName = b.subscriptions?.clients?.full_name || '—';
    const vehicle = b.subscriptions?.vehicle_model || '—';
    return `
      <tr>
        <td>${customerName}</td>
        <td>${vehicle}</td>
        <td>${formatDate(b.confirmed_date || b.requested_date)}</td>
        <td>${b.confirmed_time || b.requested_time || '—'}</td>
        <td>${visitTypeLabel(b.visit_type)}</td>
        <td>${badgeHtml(b.status)}</td>
        <td>${renderActions(b)}</td>
      </tr>
    `;
  }).join('');

  wireUpActions();
}

function renderActions(b) {
  if (b.status === 'pending') {
    return `
      <div class="btn-row">
        <button class="btn btn-success btn-sm" data-confirm="${b.id}">Confirm</button>
        <button class="btn btn-danger btn-sm" data-cancel="${b.id}">Cancel</button>
      </div>`;
  }
  if (b.status === 'confirmed' || b.status === 'rescheduled_by_admin') {
    return `
      <div class="btn-row">
        <button class="btn btn-primary btn-sm" data-complete="${b.id}">Mark Completed</button>
        <button class="btn btn-outline btn-sm" data-reschedule="${b.id}">Reschedule</button>
        <button class="btn btn-danger btn-sm" data-cancel="${b.id}">Cancel</button>
      </div>`;
  }
  // No per-booking payment action here — maintenance plan clients pay the
  // full plan price upfront at enrollment (see Customers page), not per visit.
  return '—';
}

function wireUpActions() {
  document.querySelectorAll('[data-confirm]').forEach(btn => {
    btn.addEventListener('click', () => updateBookingStatus(btn.dataset.confirm, 'confirmed', btn));
  });
  document.querySelectorAll('[data-cancel]').forEach(btn => {
    btn.addEventListener('click', () => {
      const note = prompt('Optional: add a reason the customer will see.', '');
      if (note === null) return;
      updateBookingStatus(btn.dataset.cancel, 'cancelled', btn, note);
    });
  });
  document.querySelectorAll('[data-complete]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm('Mark this booking as completed? This will count as one used wash for the customer.')) {
        updateBookingStatus(btn.dataset.complete, 'completed', btn);
      }
    });
  });
  document.querySelectorAll('[data-reschedule]').forEach(btn => {
    btn.addEventListener('click', () => {
      const booking = currentBookingsById[btn.dataset.reschedule];
      if (booking) openRescheduleModal(booking);
    });
  });
}

async function updateBookingStatus(bookingId, newStatus, btnEl, note) {
  btnEl.disabled = true;

  const updatePayload = { status: newStatus };
  if (note) updatePayload.admin_note = note;

  // The DB trigger (handle_booking_completion) automatically adjusts the
  // linked subscription's washes_used/washes_remaining when status becomes
  // 'completed' — no manual wash-count logic needed here.
  const { error } = await supabaseClient
    .from('bookings')
    .update(updatePayload)
    .eq('id', bookingId);

  if (error) {
    // 23505 = PostgreSQL unique_violation from bookings_one_active_date_idx
    // or bookings_one_active_confirmed_date_idx (see the migration) — this
    // fires if confirming this booking would leave two active bookings on
    // the same date. Never surface the raw constraint error to the admin.
    if (error.code === '23505') {
      showToast('This date is already occupied by another active maintenance booking. Please select another date.', 'error');
      btnEl.disabled = false;
      await loadBookings();
      return;
    }
    showToast('Failed to update booking: ' + error.message, 'error');
    btnEl.disabled = false;
    return;
  }

  const messages = {
    confirmed: 'Booking confirmed.',
    cancelled: 'Booking cancelled.',
    completed: 'Marked as completed — wash count updated.',
  };
  showToast(messages[newStatus] || 'Booking updated.');

  await loadBookings();
}

function visitTypeLabel(type) {
  const map = {
    deep_clean: 'Deep Clean',
    maintenance_wash: 'Maintenance Wash',
    mid_year_reset: 'Mid-Year Reset',
    bonus_perk: 'Bonus Perk',
  };
  return map[type] || type;
}

document.addEventListener('DOMContentLoaded', init);