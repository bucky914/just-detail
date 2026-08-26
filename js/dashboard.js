// =========================================================
// Dashboard: guards access, loads subscriptions, handles
// enrollment and visit-request flows.
// =========================================================

let currentUser = null;
let currentClientRow = null;
let currentSubscriptions = [];
let visitSelectedDate = null;
let visitCalendarViewDate = new Date();

// Dates (YYYY-MM-DD, local) that already have an active maintenance
// booking (pending/confirmed/rescheduled_by_admin) and so cannot be
// requested again. Loaded from the get_booked_maintenance_dates RPC —
// see loadBookedMaintenanceDates(). The database's partial unique
// indexes are the real source of truth; this Set only drives the
// calendar UI so customers don't pick a date that's certain to fail.
let bookedMaintenanceDates = new Set();
// True once bookedMaintenanceDates has been successfully loaded at least
// once in this modal session — used to avoid ever implying a date is
// free when we actually don't know.
let bookedMaintenanceDatesLoaded = false;

// ---------------- Custom dropdown helpers (mirrors booking.js) ----------------

/**
 * Flip the dropdown list to open upward instead of downward if there isn't
 * enough room below it — prevents the list from being cut off or forcing
 * the whole modal to grow awkwardly near the bottom of the viewport.
 */
function positionDropdown(wrap, trigger, list) {
  list.classList.remove('drop-up');
  const triggerRect = trigger.getBoundingClientRect();
  // Measure the actual rendered height where possible (more accurate for
  // taller popovers like the calendar), falling back to the dropdown-list
  // max-height assumption for simple option lists.
  const listHeight = (list.offsetHeight || Math.min(list.scrollHeight, 240)) + 10;
  const spaceBelow = window.innerHeight - triggerRect.bottom;
  const spaceAbove = triggerRect.top;

  if (spaceBelow < listHeight && spaceAbove > spaceBelow) {
    list.classList.add('drop-up');
  }
}

function initCustomSelect(wrap) {
  const trigger = wrap.querySelector('.custom-select-trigger');
  const list = wrap.querySelector('.custom-select-list');
  const valueEl = wrap.querySelector('.custom-select-value');
  const targetSelect = document.getElementById(wrap.dataset.target);

  function closeThis() {
    wrap.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  }

  trigger.addEventListener('click', () => {
    document.querySelectorAll('.custom-select.open').forEach(w => { if (w !== wrap) w.classList.remove('open'); });
    const isOpen = wrap.classList.toggle('open');
    trigger.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      positionDropdown(wrap, trigger, list);
      const selected = list.querySelector('li[aria-selected="true"]') || list.querySelector('li');
      if (selected) selected.focus();
    }
  });

  function selectOption(li) {
    list.querySelectorAll('li').forEach(o => o.setAttribute('aria-selected', 'false'));
    li.setAttribute('aria-selected', 'true');
    valueEl.textContent = li.textContent;
    valueEl.classList.remove('is-placeholder');
    targetSelect.value = li.dataset.value;
    targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
    closeThis();
    trigger.focus();
  }

  function wireOptions() {
    const options = Array.from(list.querySelectorAll('li'));
    options.forEach((li, idx) => {
      li.setAttribute('tabindex', '-1');
      li.onclick = () => selectOption(li);
      li.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectOption(li); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); (options[idx + 1] || options[0]).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (options[idx - 1] || options[options.length - 1]).focus(); }
        else if (e.key === 'Escape') { closeThis(); trigger.focus(); }
      };
    });
  }
  wireOptions();
  wrap._rewireOptions = wireOptions; // exposed so dynamically-populated lists can re-wire

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-select')) closeThis();
  });
}

function populateCustomSelectList(wrap, items) {
  // items: [{ value, label }]
  const list = wrap.querySelector('.custom-select-list');
  list.innerHTML = items.map(i => `<li role="option" data-value="${i.value}">${i.label}</li>`).join('');

  // The hidden native <select> must also get matching <option> elements —
  // otherwise setting its .value to a selected item silently fails (no
  // matching option = value stays empty), which broke this exact form's
  // native "required" validation even though the visible UI looked selected.
  const targetSelect = document.getElementById(wrap.dataset.target);
  if (targetSelect) {
    targetSelect.innerHTML = items.map(i => `<option value="${i.value}">${i.label}</option>`).join('');
    targetSelect.value = '';
  }

  const valueEl = wrap.querySelector('.custom-select-value');
  valueEl.textContent = valueEl.dataset.placeholder;
  valueEl.classList.add('is-placeholder');
  if (wrap._rewireOptions) wrap._rewireOptions();
}

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return; // requireAuth already redirects to login

  document.querySelectorAll('.custom-select').forEach(initCustomSelect);

  const logoutBtn = document.getElementById('logoutBtn');
  if (!logoutBtn._boundLogout) {
    logoutBtn.addEventListener('click', signOutClient);
    logoutBtn._boundLogout = true;
  }

  // Load (or create-on-first-login) the client's profile row
  const { data: clientRow, error: clientErr } = await supabaseClient
    .from('clients')
    .select('*')
    .eq('id', currentUser.id)
    .maybeSingle();

  if (clientErr) {
    console.error('Failed to load client profile:', clientErr);
  }
  currentClientRow = clientRow;

  if (currentClientRow) {
    document.getElementById('dashUserName').textContent = currentClientRow.full_name;
    document.getElementById('dashWelcomeName').textContent = ', ' + currentClientRow.full_name.split(' ')[0];
  }

  document.getElementById('dashLoading').style.display = 'none';

  const params = new URLSearchParams(window.location.search);
  const enrollPlanId = params.get('enroll');

  if (enrollPlanId) {
    await showEnrollPanel(enrollPlanId);
  } else {
    await loadSubscriptions();
    document.getElementById('dashContent').style.display = 'block';
  }
}

// ---------------- Enrollment flow ----------------
async function showEnrollPanel(planId) {
  const { data: plan, error } = await supabaseClient
    .from('plans')
    .select('*')
    .eq('id', planId)
    .maybeSingle();

  if (error || !plan) {
    console.error('Plan not found:', error);
    await loadSubscriptions();
    document.getElementById('dashContent').style.display = 'block';
    return;
  }

  document.getElementById('enrollPanel').style.display = 'block';
  document.getElementById('enrollPlanTitle').textContent = `Enroll — ${plan.tier_name}`;
  document.getElementById('enrollPlanSub').textContent =
    `${plan.vehicle_segment === 'suv' ? 'SUV / MPV / Large SUV' : 'Sedan / Hatch / Compact SUV'} · ₹${Number(plan.price).toLocaleString('en-IN')} · ${plan.total_regular_washes} washes`;

  const freqSelect = document.getElementById('enFrequency');
  const freqWrap = document.getElementById('enFrequencyCustom');
  populateCustomSelectList(freqWrap, plan.frequency_options.map(f => ({
    value: f, label: f === 'biweekly' ? 'Bi-weekly' : 'Monthly'
  })));

  if (plan.frequency_options.length > 1) {
    // Client picks — show the row, leave it unselected until they choose.
    document.getElementById('enFrequencyRow').style.display = 'flex';
  } else {
    // Only one option (e.g. VIP is bi-weekly only) — hide the picker since
    // there's nothing to choose, but the hidden <select> is still a
    // required form field, so it must be auto-selected or the browser
    // blocks submission on a field the user can never see or fill in.
    document.getElementById('enFrequencyRow').style.display = 'none';
    const only = plan.frequency_options[0];
    const onlyLi = freqWrap.querySelector(`li[data-value="${only}"]`);
    if (onlyLi) onlyLi.click();
  }

  document.getElementById('enrollCancel').addEventListener('click', () => {
    window.location.href = 'dashboard.html';
  });

  document.getElementById('enrollForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('enrollSubmit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    const vehicleModel = document.getElementById('enVehicleModel').value.trim();
    const frequency = freqSelect.value || plan.frequency_options[0];
    const address = document.getElementById('enAddress').value.trim();

    const { error: insertError } = await supabaseClient.from('subscriptions').insert({
      client_id: currentUser.id,
      plan_id: plan.id,
      vehicle_model: vehicleModel,
      vehicle_segment: plan.vehicle_segment,
      frequency: frequency,
      washes_remaining: plan.total_regular_washes,
      service_address: address,
      status: 'pending_confirmation',
    });

    if (insertError) {
      alert('Something went wrong submitting your enrollment: ' + insertError.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit enrollment';
      return;
    }

    // Clean the ?enroll= param and show the dashboard with the new pending subscription
    window.history.replaceState({}, '', 'dashboard.html');
    document.getElementById('enrollPanel').style.display = 'none';
    await loadSubscriptions();
    document.getElementById('dashContent').style.display = 'block';
  });
}

// ---------------- Load subscriptions ----------------
async function loadSubscriptions() {
  const { data, error } = await supabaseClient
    .from('subscriptions')
    .select('*, plans(*), bookings(*)')
    .eq('client_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to load subscriptions:', error);
    currentSubscriptions = [];
  } else {
    currentSubscriptions = data || [];
  }

  renderSubscriptions();
}

function statusLabel(status) {
  const map = {
    pending_confirmation: { text: 'Awaiting confirmation', cls: 'status-pending' },
    active: { text: 'Active', cls: 'status-active' },
    completed: { text: 'Completed', cls: 'status-completed' },
    cancelled: { text: 'Cancelled', cls: 'status-cancelled' },
  };
  return map[status] || { text: status, cls: '' };
}

function renderSubscriptions() {
  const container = document.getElementById('subscriptionsList');

  if (currentSubscriptions.length === 0) {
    container.innerHTML = `
      <div class="sub-empty">
        <p>You haven't enrolled in a care plan yet.</p>
        <a href="index.html#plans" class="btn btn-primary">View care plans</a>
      </div>`;
    return;
  }

  container.innerHTML = currentSubscriptions.map(sub => {
    const status = statusLabel(sub.status);
    const segmentLabel = sub.vehicle_segment === 'suv' ? 'SUV / MPV / Large SUV' : 'Sedan / Hatch / Compact SUV';
    const bookings = (sub.bookings || []).slice().sort((a, b) => new Date(b.requested_date) - new Date(a.requested_date));
    const hasOpenBooking = bookings.some(b => b.status === 'pending' || b.status === 'confirmed' || b.status === 'rescheduled_by_admin');
    const canBookVisit = sub.status === 'active' && sub.washes_remaining > 0 && !hasOpenBooking;

    return `
      <div class="sub-card">
        <div class="sub-card-top">
          <div>
            <span class="sub-status ${status.cls}">${status.text}</span>
            <h3>${sub.plans ? sub.plans.tier_name : 'Care Plan'}</h3>
            <p class="sub-meta">${sub.vehicle_model || segmentLabel} · ${segmentLabel}</p>
          </div>
        </div>

        ${sub.status === 'pending_confirmation' ? `
          <p class="sub-pending-note">We've received your enrollment and will confirm shortly. You'll be able to book visits once it's active.</p>
        ` : `
          <div class="sub-stats">
            <div class="sub-stat">
              <span class="sub-stat-num">${sub.washes_remaining}</span>
              <span class="sub-stat-label">Washes left</span>
            </div>
            <div class="sub-stat">
              <span class="sub-stat-num">${sub.washes_used}</span>
              <span class="sub-stat-label">Completed</span>
            </div>
            <div class="sub-stat">
              <span class="sub-stat-num">${sub.frequency === 'biweekly' ? 'Bi-wk' : 'Monthly'}</span>
              <span class="sub-stat-label">Frequency</span>
            </div>
          </div>
        `}

        ${canBookVisit ? `<button class="btn btn-primary btn-block" onclick="openVisitModal('${sub.id}')">Request next visit</button>` : ''}
        ${sub.status === 'active' && hasOpenBooking ? `<p class="sub-open-booking-note">You already have a visit request in progress — you can request the next one once it's completed.</p>` : ''}

        ${bookings.length > 0 ? `
          <div class="sub-bookings">
            <p class="sub-bookings-label">Your visit requests</p>
            ${bookings.map(b => `
              <div class="sub-booking-row">
                <div class="sub-booking-info">
                  <span class="sub-booking-date">${formatVisitDate(b.confirmed_date || b.requested_date)}</span>
                  <span class="sub-booking-time">${b.confirmed_time || b.requested_time || ''}</span>
                </div>
                <span class="booking-status booking-status-${b.status}">${bookingStatusLabel(b.status)}</span>
              </div>
              ${(b.status === 'rescheduled_by_admin' || b.status === 'cancelled') && b.admin_note ? `<p class="sub-booking-note">${b.admin_note}</p>` : ''}
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function bookingStatusLabel(status) {
  const map = {
    pending: 'Pending confirmation',
    confirmed: 'Confirmed',
    rescheduled_by_admin: 'Reschedule proposed',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };
  return map[status] || status;
}

function formatVisitDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------------- Visit request modal ----------------
function toLocalDateStr(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function openVisitModal(subscriptionId) {
  document.getElementById('visitSubscriptionId').value = subscriptionId;
  document.getElementById('visitForm').reset();
  document.getElementById('visitSubscriptionId').value = subscriptionId; // reset() clears hidden inputs too
  document.getElementById('visitModalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';

  // Reset the date field back to its closed, unselected state
  visitSelectedDate = null;
  visitCalendarViewDate = new Date();
  document.getElementById('visitDate').value = '';
  document.getElementById('visitDateField').classList.remove('open');
  const dateValueEl = document.getElementById('visitDateValueText');
  dateValueEl.textContent = 'Select a date';
  dateValueEl.classList.add('is-placeholder');
  renderVisitCalendar();

  // Reset the time dropdown's visible state
  const timeWrap = document.getElementById('visitTimeCustom');
  const timeValueEl = timeWrap.querySelector('.custom-select-value');
  timeValueEl.textContent = timeValueEl.dataset.placeholder;
  timeValueEl.classList.add('is-placeholder');
  timeWrap.querySelectorAll('li').forEach(li => li.setAttribute('aria-selected', 'false'));

  // Load fresh availability every time the modal opens — never rely on
  // whatever was loaded (or not) when the dashboard first rendered.
  await loadBookedMaintenanceDates();
  renderVisitCalendar();
}

// Loads active maintenance-booking dates from the database via the
// get_booked_maintenance_dates RPC (see supabase/migrations/
// maintenance_booking_date_availability.sql). This is a UI convenience
// only — the partial unique indexes on public.bookings are the actual
// concurrency protection; see the 23505 handling in the submit handler.
async function loadBookedMaintenanceDates() {
  const { data, error } = await supabaseClient.rpc('get_booked_maintenance_dates');

  if (error) {
    console.error('Failed to load maintenance booking availability:', error);
    bookedMaintenanceDatesLoaded = false;
    showVisitAvailabilityError(true);
    return false;
  }

  bookedMaintenanceDates = new Set((data || []).map(row => row.booked_date));
  bookedMaintenanceDatesLoaded = true;
  showVisitAvailabilityError(false);
  return true;
}

// Shows/hides a small inline notice in the visit modal when availability
// couldn't be loaded, so the calendar's disabled/enabled state is never
// misread as confirmed availability when we don't actually have it.
function showVisitAvailabilityError(show) {
  let notice = document.getElementById('visitAvailabilityError');
  if (!notice) {
    notice = document.createElement('p');
    notice.id = 'visitAvailabilityError';
    notice.className = 'sub-open-booking-note';
    notice.textContent = "Couldn't check date availability — please try reopening this before choosing a date.";
    const grid = document.getElementById('visitDateGrid');
    grid.parentElement.insertBefore(notice, grid);
  }
  notice.style.display = show ? 'block' : 'none';
}

function toggleVisitDatePicker() {
  const field = document.getElementById('visitDateField');
  const trigger = document.getElementById('visitDateTrigger');
  const picker = document.getElementById('visitDatePicker');
  const isOpen = field.classList.contains('open');

  if (!isOpen) {
    positionDropdown(field, trigger, picker);
    field.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
  } else {
    field.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  }
}

function closeVisitDatePicker() {
  document.getElementById('visitDateField').classList.remove('open');
  document.getElementById('visitDateTrigger').setAttribute('aria-expanded', 'false');
}

function renderVisitCalendar() {
  const grid = document.getElementById('visitDateGrid');
  const label = document.getElementById('visitDateMonthLabel');
  const year = visitCalendarViewDate.getFullYear();
  const month = visitCalendarViewDate.getMonth();

  label.textContent = visitCalendarViewDate.toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Earliest bookable day is TOMORROW — same-day requests risk landing on
  // a slot that's already passed, so today is disabled along with the past.
  const earliestSelectable = new Date(); earliestSelectable.setHours(0, 0, 0, 0);
  earliestSelectable.setDate(earliestSelectable.getDate() + 1);

  grid.innerHTML = '';
  for (let i = 0; i < firstDay; i++) grid.appendChild(document.createElement('span'));

  for (let d = 1; d <= daysInMonth; d++) {
    const cellDate = new Date(year, month, d);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = d;
    btn.className = 'custom-date-cell';
    const isBooked = bookedMaintenanceDates.has(toLocalDateStr(cellDate));
    if (cellDate < earliestSelectable) {
      btn.disabled = true;
      btn.classList.add('custom-date-cell-disabled');
    } else if (isBooked) {
      btn.disabled = true;
      btn.classList.add('custom-date-cell-disabled');
      btn.classList.add('custom-date-cell-booked');
      btn.title = 'Booked';
    } else {
      btn.addEventListener('click', () => selectVisitDate(cellDate, btn));
    }
    if (visitSelectedDate && cellDate.toDateString() === visitSelectedDate.toDateString()) {
      btn.classList.add('custom-date-cell-selected');
    }
    grid.appendChild(btn);
  }
}

function selectVisitDate(date, btnEl) {
  visitSelectedDate = date;
  document.getElementById('visitDate').value = toLocalDateStr(date);
  document.querySelectorAll('#visitDateGrid .custom-date-cell').forEach(c => c.classList.remove('custom-date-cell-selected'));
  btnEl.classList.add('custom-date-cell-selected');

  const dateValueEl = document.getElementById('visitDateValueText');
  dateValueEl.textContent = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  dateValueEl.classList.remove('is-placeholder');

  closeVisitDatePicker();
}

function closeVisitModal() {
  document.getElementById('visitModalOverlay').classList.remove('open');
  document.body.style.overflow = '';
  closeVisitDatePicker();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('visitDateTrigger').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleVisitDatePicker();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#visitDateField')) closeVisitDatePicker();
  });

  document.getElementById('visitDatePrev').addEventListener('click', (e) => {
    e.stopPropagation();
    visitCalendarViewDate.setMonth(visitCalendarViewDate.getMonth() - 1);
    renderVisitCalendar();
  });
  document.getElementById('visitDateNext').addEventListener('click', (e) => {
    e.stopPropagation();
    visitCalendarViewDate.setMonth(visitCalendarViewDate.getMonth() + 1);
    renderVisitCalendar();
  });

  init();

  // If the browser restores this page from its back/forward cache (bfcache)
  // — e.g. the user navigates away and hits Back — the page reappears
  // exactly as it was in memory without re-running our scripts, showing
  // stale data (like "no plan enrolled" after they actually enrolled).
  // event.persisted === true tells us this happened, so we re-fetch.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      init();
    }
  });

  document.getElementById('visitModalClose').addEventListener('click', closeVisitModal);
  document.getElementById('visitModalOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('visitModalOverlay')) closeVisitModal();
  });

  document.getElementById('visitForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('visitSubmit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending request…';

    const subscriptionId = document.getElementById('visitSubscriptionId').value;
    const date = document.getElementById('visitDate').value;
    const time = document.getElementById('visitTime').value;

    // Refresh availability one more time right before submitting — this
    // protects against stale calendar data (someone else may have booked
    // this date since the modal opened). This check is a UX convenience,
    // NOT the final protection: the database's partial unique index is,
    // and a 23505 from the insert below is handled regardless of what
    // this refresh finds.
    await loadBookedMaintenanceDates();
    if (bookedMaintenanceDatesLoaded && bookedMaintenanceDates.has(date)) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Request visit';
      renderVisitCalendar();
      alert('This date has just been booked by another customer.\nPlease select another available date.');
      visitSelectedDate = null;
      document.getElementById('visitDate').value = '';
      const dateValueEl = document.getElementById('visitDateValueText');
      dateValueEl.textContent = 'Select a date';
      dateValueEl.classList.add('is-placeholder');
      return;
    }

    const { error } = await supabaseClient.from('bookings').insert({
      subscription_id: subscriptionId,
      visit_type: 'maintenance_wash',
      requested_date: date,
      requested_time: time,
      status: 'pending',
    });

    submitBtn.disabled = false;
    submitBtn.textContent = 'Request visit';

    if (error) {
      // 23505 = PostgreSQL unique_violation. bookings_one_active_date_idx
      // is the final concurrency protection (see the migration) — this
      // branch is what actually fires when two customers race for the
      // same date, regardless of what the pre-submit check above found.
      if (error.code === '23505') {
        await loadBookedMaintenanceDates();
        renderVisitCalendar();
        visitSelectedDate = null;
        document.getElementById('visitDate').value = '';
        const dateValueEl = document.getElementById('visitDateValueText');
        dateValueEl.textContent = 'Select a date';
        dateValueEl.classList.add('is-placeholder');
        alert('This date has just been booked by another customer.\nPlease select another available date.');
        return;
      }
      alert('Could not submit your request: ' + error.message);
      return;
    }

    closeVisitModal();
    await loadSubscriptions();
    alert('Visit requested! We\'ll confirm your slot shortly.');
  });
});
