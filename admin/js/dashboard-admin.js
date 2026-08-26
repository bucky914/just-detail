// =========================================================
// Admin Dashboard
// =========================================================

async function init() {
  const adminUser = await requireAdmin();
  if (!adminUser) return;

  initAdminShell('index.html', adminUser);

  await Promise.all([
    loadSummaryCards(),
    loadNewOneTimeBookings(),
    loadPendingVisits(),
    loadTodayBookings(),
    loadPendingRequests(),
  ]);

  document.getElementById('pageLoading').style.display = 'none';
  document.getElementById('pageContent').style.display = 'block';
}

async function loadSummaryCards() {
  const todayStr = toLocalDateStr(new Date());

  const [activeSubs, pendingSubs, todayBookings, upcomingBookings] = await Promise.all([
    supabaseClient.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabaseClient.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'pending_confirmation'),
    supabaseClient.from('bookings').select('id', { count: 'exact', head: true })
      .eq('requested_date', todayStr).in('status', ['pending', 'confirmed']),
    supabaseClient.from('bookings').select('id', { count: 'exact', head: true })
      .gt('requested_date', todayStr).in('status', ['pending', 'confirmed']),
  ]);

  document.getElementById('cardActiveClients').textContent = activeSubs.count ?? 0;
  document.getElementById('cardPendingRequests').textContent = pendingSubs.count ?? 0;
  document.getElementById('cardTodayBookings').textContent = todayBookings.count ?? 0;
  document.getElementById('cardUpcomingBookings').textContent = upcomingBookings.count ?? 0;
}

async function loadTodayBookings() {
  const todayStr = toLocalDateStr(new Date());

  const { data, error } = await supabaseClient
    .from('bookings')
    .select('*, subscriptions(vehicle_model, clients(full_name))')
    .eq('requested_date', todayStr)
    .order('requested_time', { ascending: true });

  const tbody = document.getElementById('todayBookingsBody');
  const emptyEl = document.getElementById('todayBookingsEmpty');
  const tableEl = document.getElementById('todayBookingsTable');

  if (error || !data || data.length === 0) {
    tableEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }

  tableEl.style.display = 'table';
  emptyEl.style.display = 'none';

  tbody.innerHTML = data.map(b => {
    const customerName = b.subscriptions?.clients?.full_name || '—';
    const vehicle = b.subscriptions?.vehicle_model || '—';
    return `
      <tr>
        <td>${b.confirmed_time || b.requested_time || '—'}</td>
        <td>${customerName}</td>
        <td>${vehicle}</td>
        <td>${visitTypeLabel(b.visit_type)}</td>
        <td>${badgeHtml(b.status)}</td>
      </tr>
    `;
  }).join('');
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

async function loadPendingVisits() {
  const { data, error } = await supabaseClient
    .from('bookings')
    .select('*, subscriptions(vehicle_model, clients(full_name))')
    .eq('status', 'pending')
    .order('requested_date', { ascending: true });

  const tbody = document.getElementById('pendingVisitsBody');
  const emptyEl = document.getElementById('pendingVisitsEmpty');
  const tableEl = document.getElementById('pendingVisitsTable');

  if (error || !data || data.length === 0) {
    tableEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }

  tableEl.style.display = 'table';
  emptyEl.style.display = 'none';

  tbody.innerHTML = data.map(b => {
    const customerName = b.subscriptions?.clients?.full_name || '—';
    const vehicle = b.subscriptions?.vehicle_model || '—';
    return `
      <tr>
        <td>${customerName}</td>
        <td>${vehicle}</td>
        <td>${formatDate(b.requested_date)}</td>
        <td>${b.requested_time || '—'}</td>
        <td>
          <div class="btn-row">
            <button class="btn btn-success btn-sm" data-confirm-visit="${b.id}">Confirm</button>
            <button class="btn btn-danger btn-sm" data-cancel-visit="${b.id}">Cancel</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-confirm-visit]').forEach(btn => {
    btn.addEventListener('click', () => updateVisitStatus(btn.dataset.confirmVisit, 'confirmed', btn));
  });
  tbody.querySelectorAll('[data-cancel-visit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const note = prompt('Optional: add a reason the customer will see (e.g. "That slot is booked — please pick another date").', '');
      if (note === null) return; // user hit Cancel on the prompt itself
      updateVisitStatus(btn.dataset.cancelVisit, 'cancelled', btn, note);
    });
  });
}

async function loadNewOneTimeBookings() {
  const { data, error } = await supabaseClient
    .from('one_time_bookings')
    .select('*, payments(id)')
    .order('created_at', { ascending: false });

  const tbody = document.getElementById('newOnetimeBody');
  const emptyEl = document.getElementById('newOnetimeEmpty');
  const tableEl = document.getElementById('newOnetimeTable');

  // "New" = no payment recorded yet — matches the same needs-attention
  // logic as pending visits/maintenance requests, just keyed on payment
  // status instead of approval status.
  const unpaid = (data || []).filter(b => !b.payments || b.payments.length === 0);

  if (error || unpaid.length === 0) {
    tableEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }

  tableEl.style.display = 'table';
  emptyEl.style.display = 'none';

  tbody.innerHTML = unpaid.map(b => {
    const amount = b.calculated_price ? Number(b.calculated_price) : null;
    const actionHtml = amount
      ? `<button class="btn btn-success btn-sm" data-confirm-onetime-payment="${b.id}" data-amount="${amount}">Confirm Payment</button>`
      : `<a href="finances.html?pay_onetime=${b.id}" class="btn btn-outline btn-sm">Record Payment →</a>`;

    return `
      <tr>
        <td>${b.customer_name}</td>
        <td>${b.customer_phone}</td>
        <td>${b.service}</td>
        <td>${b.vehicle_model || '—'}${b.vehicle_type ? ' · ' + b.vehicle_type : ''}</td>
        <td>${amount ? '₹' + amount.toLocaleString('en-IN') : '—'}</td>
        <td>${formatDate(b.created_at)}</td>
        <td>${actionHtml}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-confirm-onetime-payment]').forEach(btn => {
    btn.addEventListener('click', () => confirmOneTimePaymentFromDashboard(btn.dataset.confirmOnetimePayment, btn.dataset.amount, btn));
  });
}

async function confirmOneTimePaymentFromDashboard(bookingId, amount, btnEl) {
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
  await Promise.all([loadSummaryCards(), loadNewOneTimeBookings()]);
}

async function updateVisitStatus(bookingId, newStatus, btnEl, note) {
  btnEl.disabled = true;
  const updatePayload = { status: newStatus };
  if (note) updatePayload.admin_note = note;

  const { error } = await supabaseClient.from('bookings').update(updatePayload).eq('id', bookingId);

  if (error) {
    showToast('Failed to update: ' + error.message, 'error');
    btnEl.disabled = false;
    return;
  }

  showToast(newStatus === 'confirmed' ? 'Visit confirmed.' : 'Visit cancelled.');
  await Promise.all([loadSummaryCards(), loadPendingVisits(), loadTodayBookings()]);
}

async function loadPendingRequests() {
  const { data, error } = await supabaseClient
    .from('subscriptions')
    .select('*, clients(full_name), plans(tier_name)')
    .eq('status', 'pending_confirmation')
    .order('created_at', { ascending: true });

  const tbody = document.getElementById('pendingBody');
  const emptyEl = document.getElementById('pendingEmpty');
  const tableEl = document.getElementById('pendingTable');

  if (error || !data || data.length === 0) {
    tableEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }

  tableEl.style.display = 'table';
  emptyEl.style.display = 'none';

  tbody.innerHTML = data.map(sub => `
    <tr>
      <td>${sub.clients?.full_name || '—'}</td>
      <td>${sub.vehicle_model || '—'}</td>
      <td>${sub.plans?.tier_name || '—'}</td>
      <td>${formatDate(sub.created_at)}</td>
      <td>
        <div class="btn-row">
          <button class="btn btn-success btn-sm" data-approve="${sub.id}">Approve</button>
          <button class="btn btn-danger btn-sm" data-reject="${sub.id}">Reject</button>
        </div>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-approve]').forEach(btn => {
    btn.addEventListener('click', () => approveSubscription(btn.dataset.approve, btn));
  });
  tbody.querySelectorAll('[data-reject]').forEach(btn => {
    btn.addEventListener('click', () => rejectSubscription(btn.dataset.reject, btn));
  });
}

async function approveSubscription(id, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = 'Approving…';

  // Get the plan price so we can record the upfront payment the client
  // already made (their payment happens before approval in this business's
  // workflow, so Approve also logs the payment in one step).
  const { data: sub, error: subError } = await supabaseClient
    .from('subscriptions')
    .select('plan_id, plans(price)')
    .eq('id', id)
    .maybeSingle();

  if (subError || !sub) {
    showToast('Failed to load plan details: ' + (subError?.message || 'not found'), 'error');
    btnEl.disabled = false;
    btnEl.textContent = 'Approve';
    return;
  }

  const { error } = await supabaseClient
    .from('subscriptions')
    .update({ status: 'active', start_date: toLocalDateStr(new Date()) })
    .eq('id', id);

  if (error) {
    showToast('Failed to approve: ' + error.message, 'error');
    btnEl.disabled = false;
    btnEl.textContent = 'Approve';
    return;
  }

  const planPrice = sub.plans?.price ? Number(sub.plans.price) : 0;
  if (planPrice > 0) {
    const { error: paymentError } = await supabaseClient.from('payments').insert({
      subscription_id: id,
      amount: planPrice,
      payment_method: 'cash',
      payment_status: 'paid',
      payment_date: toLocalDateStr(new Date()),
      notes: 'Recorded automatically on plan approval (paid upfront).',
    });
    if (paymentError) {
      showToast('Approved, but failed to record payment: ' + paymentError.message, 'error');
      await Promise.all([loadSummaryCards(), loadPendingRequests()]);
      return;
    }
  }

  showToast('Approved and payment recorded — now active.');
  await Promise.all([loadSummaryCards(), loadPendingRequests()]);
}

async function rejectSubscription(id, btnEl) {
  if (!confirm('Reject this maintenance request? This cannot be undone.')) return;
  btnEl.disabled = true;

  const { error } = await supabaseClient
    .from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('id', id);

  if (error) {
    showToast('Failed to reject: ' + error.message, 'error');
    btnEl.disabled = false;
    return;
  }

  showToast('Request rejected.');
  await Promise.all([loadSummaryCards(), loadPendingRequests()]);
}

document.addEventListener('DOMContentLoaded', init);
