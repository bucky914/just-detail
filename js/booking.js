// =========================================================
// Booking form: 4-step flow, inline in #book section -> WhatsApp
// =========================================================

/**
 * Local YYYY-MM-DD string for a Date object — NOT toISOString(), which
 * converts to UTC and can shift the date backward for timezones ahead
 * of UTC (e.g. India, UTC+5:30), causing off-by-one date bugs near midnight.
 */
function toLocalDateStr(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

let currentStep = 1;
const TOTAL_STEPS = 4;
let selectedDate = null;
let selectedTime = null;
let calendarViewDate = new Date();

const TIME_SLOTS = ['8:00 AM','9:00 AM','10:00 AM','11:00 AM','12:00 PM','1:00 PM','2:00 PM','3:00 PM','4:00 PM','5:00 PM','6:00 PM'];

function goToStep(step) {
  currentStep = step;

  document.querySelectorAll('.modal-step').forEach(el => {
    el.classList.toggle('active', Number(el.dataset.step) === step);
  });
  document.querySelectorAll('.book-progress .progress-step').forEach(el => {
    const s = Number(el.dataset.step);
    el.classList.toggle('active', s === step);
    el.classList.toggle('completed', s < step);
  });

  document.getElementById('modalBack').style.display = step === 1 ? 'none' : 'inline-flex';
  document.getElementById('modalNext').style.display = step === TOTAL_STEPS ? 'none' : 'inline-flex';
  document.getElementById('modalConfirm').style.display = step === TOTAL_STEPS ? 'inline-flex' : 'none';

  if (step === 3) renderCalendar();
  if (step === 4) renderReview();

  document.getElementById('bookTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function validateStep(step) {
  const stepEl = document.querySelector(`.modal-step[data-step="${step}"]`);
  const requiredFields = stepEl.querySelectorAll('[required]');
  let valid = true;
  let firstInvalid = null;
  requiredFields.forEach(field => {
    const isCustomSelect = field.classList.contains('visually-hidden-select');
    const errorTarget = isCustomSelect ? document.getElementById(field.id + 'Custom') : field;
    if (!field.value || !field.value.trim()) {
      errorTarget.classList.add('field-error');
      valid = false;
      if (!firstInvalid) firstInvalid = isCustomSelect ? errorTarget.querySelector('.custom-select-trigger') : field;
    } else {
      errorTarget.classList.remove('field-error');
    }
  });

  if (step === 3) {
    if (!selectedDate) { document.getElementById('datePicker').classList.add('field-error'); valid = false; }
    else document.getElementById('datePicker').classList.remove('field-error');
    if (!selectedTime) { document.getElementById('timeSlotGrid').classList.add('field-error'); valid = false; }
    else document.getElementById('timeSlotGrid').classList.remove('field-error');
  }

  if (firstInvalid) firstInvalid.focus({ preventScroll: true });

  return valid;
}

// ---------------- Calendar ----------------
function renderCalendar() {
  const grid = document.getElementById('dateGrid');
  const label = document.getElementById('dateMonthLabel');
  const year = calendarViewDate.getFullYear();
  const month = calendarViewDate.getMonth();

  label.textContent = calendarViewDate.toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Earliest bookable day is TOMORROW — same-day bookings can land on a
  // slot that's already passed (e.g. booking "today 8 AM" at 6 PM), so
  // today itself is disabled alongside all past dates.
  const earliestSelectable = new Date(); earliestSelectable.setHours(0,0,0,0);
  earliestSelectable.setDate(earliestSelectable.getDate() + 1);

  grid.innerHTML = '';
  for (let i = 0; i < firstDay; i++) {
    grid.appendChild(document.createElement('span'));
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const cellDate = new Date(year, month, d);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = d;
    btn.className = 'date-cell';
    if (cellDate < earliestSelectable) {
      btn.disabled = true;
      btn.classList.add('date-cell-disabled');
    } else {
      btn.addEventListener('click', () => selectDate(cellDate, btn));
    }
    if (selectedDate && cellDate.toDateString() === selectedDate.toDateString()) {
      btn.classList.add('date-cell-selected');
    }
    grid.appendChild(btn);
  }
}

function selectDate(date, btnEl) {
  selectedDate = date;
  document.getElementById('mDate').value = toLocalDateStr(date);
  document.querySelectorAll('.date-cell').forEach(c => c.classList.remove('date-cell-selected'));
  btnEl.classList.add('date-cell-selected');
  document.getElementById('datePicker').classList.remove('field-error');
}

// ---------------- Custom dropdowns ----------------

/**
 * Programmatically set a custom-select's value from outside the component
 * (e.g. "Book Now" buttons pre-filling the service dropdown). Keeps the
 * visible trigger label, the hidden native select, and the option list's
 * aria-selected state all in sync — same as picking it manually.
 */
function setCustomSelectValue(hiddenSelectId, value) {
  const wrap = document.querySelector(`.custom-select[data-target="${hiddenSelectId}"]`);
  const targetSelect = document.getElementById(hiddenSelectId);
  if (!wrap || !targetSelect) return;

  const list = wrap.querySelector('.custom-select-list');
  const valueEl = wrap.querySelector('.custom-select-value');
  const li = Array.from(list.querySelectorAll('li')).find(o => o.dataset.value === value);
  if (!li) return;

  list.querySelectorAll('li').forEach(o => o.setAttribute('aria-selected', 'false'));
  li.setAttribute('aria-selected', 'true');
  valueEl.textContent = li.textContent;
  valueEl.classList.remove('is-placeholder');
  targetSelect.value = value;
  targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
  wrap.classList.remove('field-error');
}

function initCustomSelects() {
  const selects = document.querySelectorAll('.custom-select');

  function closeAll(except) {
    selects.forEach(s => {
      if (s !== except) {
        s.classList.remove('open');
        s.querySelector('.custom-select-trigger').setAttribute('aria-expanded', 'false');
      }
    });
  }

  function positionDropdown(trigger, list) {
    list.classList.remove('drop-up');
    const triggerRect = trigger.getBoundingClientRect();
    const listHeight = Math.min(list.scrollHeight, 240) + 10;
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;
    if (spaceBelow < listHeight && spaceAbove > spaceBelow) {
      list.classList.add('drop-up');
    }
  }

  selects.forEach(wrap => {
    const trigger = wrap.querySelector('.custom-select-trigger');
    const list = wrap.querySelector('.custom-select-list');
    const valueEl = wrap.querySelector('.custom-select-value');
    const targetSelect = document.getElementById(wrap.dataset.target);
    const options = Array.from(list.querySelectorAll('li'));

    trigger.addEventListener('click', () => {
      const isOpen = wrap.classList.contains('open');
      closeAll(wrap);
      wrap.classList.toggle('open', !isOpen);
      trigger.setAttribute('aria-expanded', String(!isOpen));
      if (!isOpen) {
        positionDropdown(trigger, list);
        const selected = list.querySelector('li[aria-selected="true"]') || options[0];
        if (selected) selected.focus();
      }
    });

    function selectOption(li) {
      options.forEach(o => o.setAttribute('aria-selected', 'false'));
      li.setAttribute('aria-selected', 'true');
      valueEl.textContent = li.textContent;
      valueEl.classList.remove('is-placeholder');
      targetSelect.value = li.dataset.value;
      targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
      wrap.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      wrap.classList.remove('field-error');
      trigger.focus();
    }

    options.forEach((li, idx) => {
      li.setAttribute('tabindex', '-1');
      li.addEventListener('click', () => selectOption(li));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectOption(li); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); (options[idx + 1] || options[0]).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (options[idx - 1] || options[options.length - 1]).focus(); }
        else if (e.key === 'Escape') { wrap.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); }
      });
    });

    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!wrap.classList.contains('open')) trigger.click();
      }
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-select')) closeAll(null);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initCustomSelects();

  const prevBtn = document.getElementById('datePrev');
  const nextBtn = document.getElementById('dateNext');
  if (prevBtn) prevBtn.addEventListener('click', () => {
    calendarViewDate.setMonth(calendarViewDate.getMonth() - 1);
    renderCalendar();
  });
  if (nextBtn) nextBtn.addEventListener('click', () => {
    calendarViewDate.setMonth(calendarViewDate.getMonth() + 1);
    renderCalendar();
  });

  // Time slots
  const timeGrid = document.getElementById('timeSlotGrid');
  if (timeGrid) {
    timeGrid.innerHTML = TIME_SLOTS.map(t => `<button type="button" class="time-slot" data-time="${t}">${t}</button>`).join('');
    timeGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.time-slot');
      if (!btn) return;
      selectedTime = btn.dataset.time;
      document.getElementById('mTime').value = selectedTime;
      timeGrid.querySelectorAll('.time-slot').forEach(b => b.classList.remove('time-slot-selected'));
      btn.classList.add('time-slot-selected');
      timeGrid.classList.remove('field-error');
    });
  }

  // Add-on checkbox visual state (fallback for browsers without :has() support)
  document.querySelectorAll('.addon-check input[type="checkbox"]').forEach(cb => {
    const syncState = () => cb.closest('.addon-check').classList.toggle('addon-check-selected', cb.checked);
    cb.addEventListener('change', syncState);
    syncState();
  });

  // Update Decon add-on price based on chosen vehicle type
  const vehicleTypeSelect = document.getElementById('mVehicleType');
  const deconPriceEl = document.getElementById('deconPrice');
  function updateDeconPrice() {
    if (!vehicleTypeSelect || !deconPriceEl) return;
    const isSuv = vehicleTypeSelect.value === 'SUV / MPV / Large SUV';
    deconPriceEl.textContent = isSuv ? '+₹2,999' : '+₹1,999';
  }
  if (vehicleTypeSelect) {
    vehicleTypeSelect.addEventListener('change', updateDeconPrice);
  }

  // Service card "Book Now" -> scroll to form + prefill service, jump to step 1
  document.querySelectorAll('.service-book-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setCustomSelectValue('mService', btn.dataset.service);
      goToStep(1);
      document.getElementById('bookTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Step navigation
  document.getElementById('modalNext').addEventListener('click', () => {
    if (!validateStep(currentStep)) return;
    if (currentStep < TOTAL_STEPS) goToStep(currentStep + 1);
  });
  document.getElementById('modalBack').addEventListener('click', () => {
    if (currentStep > 1) goToStep(currentStep - 1);
  });

  // Progress step click (only allow going back to completed steps)
  document.querySelectorAll('.book-progress .progress-step').forEach(el => {
    el.addEventListener('click', () => {
      const target = Number(el.dataset.step);
      if (target < currentStep) goToStep(target);
    });
  });

  document.getElementById('modalConfirm').addEventListener('click', sendBookingToWhatsapp);

  // Initialize on load
  goToStepSilent(1);
});

// Same as goToStep but without scrolling (used on page load)
function goToStepSilent(step) {
  currentStep = step;
  document.querySelectorAll('.modal-step').forEach(el => {
    el.classList.toggle('active', Number(el.dataset.step) === step);
  });
  document.querySelectorAll('.book-progress .progress-step').forEach(el => {
    const s = Number(el.dataset.step);
    el.classList.toggle('active', s === step);
    el.classList.toggle('completed', s < step);
  });
  document.getElementById('modalBack').style.display = 'none';
  document.getElementById('modalNext').style.display = 'inline-flex';
  document.getElementById('modalConfirm').style.display = 'none';
}

// ---------------- Pricing (mirrors the Services section prices) ----------------
const SERVICE_PRICES = {
  'Deep Clean': { sedan: 2499, suv: 3499 },
  'Maintenance Wash (Exterior Only)': { sedan: 999, suv: 1299 },
  'Maintenance Wash (Exterior + Interior)': { sedan: 1199, suv: 1699 },
};

function calculateBookingTotal(service, vehicleType, addonEls) {
  const isSuv = vehicleType === 'SUV / MPV / Large SUV';
  const segmentKey = isSuv ? 'suv' : 'sedan';

  let total = 0;
  const basePrice = SERVICE_PRICES[service];
  if (basePrice) total += basePrice[segmentKey];

  addonEls.forEach(el => {
    let price = el.dataset.price;
    if (el.dataset.priceSedan) {
      price = isSuv ? el.dataset.priceSuv : el.dataset.priceSedan;
    }
    if (price) total += Number(price);
  });

  return total;
}

// ---------------- Review ----------------
function getFormData() {
  const addonEls = Array.from(document.querySelectorAll('input[name="addon"]:checked'));
  const isSuv = document.getElementById('mVehicleType').value === 'SUV / MPV / Large SUV';
  const addons = addonEls.map(el => {
    let price = el.dataset.price;
    if (el.dataset.priceSedan) {
      price = isSuv ? el.dataset.priceSuv : el.dataset.priceSedan;
    }
    return price ? `${el.value} (+₹${Number(price).toLocaleString('en-IN')})` : el.value;
  });
  const service = document.getElementById('mService').value;
  const vehicleType = document.getElementById('mVehicleType').value;
  const calculatedTotal = calculateBookingTotal(service, vehicleType, addonEls);

  return {
    name: document.getElementById('mFullName').value.trim(),
    phone: document.getElementById('mPhone').value.trim(),
    address: document.getElementById('mAddress').value.trim(),
    area: document.getElementById('mArea').value.trim(),
    landmark: document.getElementById('mLandmark').value.trim(),
    vehicleType: vehicleType,
    vehicleModel: document.getElementById('mVehicleModel').value.trim(),
    seatMaterial: document.getElementById('mSeatMaterial').value,
    service: service,
    addons: addons,
    calculatedTotal: calculatedTotal,
    date: selectedDate ? selectedDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '',
    time: selectedTime || '',
    notes: document.getElementById('mNotes').value.trim()
  };
}

function renewStepFromField(fieldId) {
  const stepMap = {
    mFullName: 1, mPhone: 1, mAddress: 1, mArea: 1, mLandmark: 1,
    mVehicleType: 2, mVehicleModel: 2, mSeatMaterial: 2, mService: 2
  };
  return stepMap[fieldId] || 3;
}

function renderReview() {
  const data = getFormData();
  const list = document.getElementById('reviewList');

  const rows = [
    ['Name', data.name, 'mFullName'],
    ['Mobile', data.phone, 'mPhone'],
    ['Address', data.address, 'mAddress'],
    ['Area', data.area, 'mArea'],
    ['Landmark', data.landmark || '—', 'mLandmark'],
    ['Vehicle', `${data.vehicleType} · ${data.vehicleModel}`, 'mVehicleType'],
    ['Seat Material', data.seatMaterial, 'mSeatMaterial'],
    ['Service', data.service, 'mService'],
    ['Add-ons', data.addons.length ? data.addons.join(', ') : 'None selected', null],
    ['Estimated Total', `₹${data.calculatedTotal.toLocaleString('en-IN')}`, null],
    ['Date & Time', `${data.date} at ${data.time}`, null],
    ['Notes', data.notes || '—', null],
  ];

  list.innerHTML = rows.map(([label, value, editField]) => `
    <div class="review-row">
      <span class="review-label">${label}</span>
      <span class="review-value">${value}</span>
      ${editField ? `<button type="button" class="review-edit" data-goto="${renewStepFromField(editField)}">Edit</button>` : ''}
    </div>
  `).join('');

  list.querySelectorAll('.review-edit').forEach(btn => {
    btn.addEventListener('click', () => goToStep(Number(btn.dataset.goto)));
  });
}

async function sendBookingToWhatsapp() {
  if (!validateStep(1)) { goToStep(1); return; }
  if (!validateStep(2)) { goToStep(2); return; }
  const data = getFormData();

  const message =
`New Booking Request — Just Detail

Name: ${data.name}
Phone: ${data.phone}
Address: ${data.address}, ${data.area}${data.landmark ? ' (near ' + data.landmark + ')' : ''}

Vehicle: ${data.vehicleType} — ${data.vehicleModel}
Seat Material: ${data.seatMaterial}
Service: ${data.service}
Add-ons: ${data.addons.length ? data.addons.join(', ') : 'None'}
Estimated Total: ₹${data.calculatedTotal.toLocaleString('en-IN')}

Preferred Date: ${data.date}
Preferred Time: ${data.time}
Notes: ${data.notes || '—'}`;

  // Save a lightweight record for admin/finance tracking. This never blocks
  // or delays the WhatsApp handoff — if it fails (e.g. offline), the booking
  // still goes through via WhatsApp exactly as before.
  try {
    if (typeof supabaseClient !== 'undefined') {
      await supabaseClient.from('one_time_bookings').insert({
        customer_name: data.name,
        customer_phone: data.phone,
        service: data.service,
        vehicle_type: data.vehicleType,
        vehicle_model: data.vehicleModel,
        seat_material: data.seatMaterial,
        addons: data.addons,
        service_address: `${data.address}, ${data.area}${data.landmark ? ' (near ' + data.landmark + ')' : ''}`,
        requested_date: selectedDate ? toLocalDateStr(selectedDate) : null,
        requested_time: data.time,
        notes: data.notes || null,
        calculated_price: data.calculatedTotal,
      });
    }
  } catch (err) {
    console.warn('Could not save booking record (WhatsApp booking still proceeds):', err);
  }

  const encoded = encodeURIComponent(message);
  const waUrl = `https://wa.me/${OWNER_WHATSAPP_NUMBER}?text=${encoded}`;
  window.open(waUrl, '_blank');

  resetBookingForm();
}

function resetBookingForm() {
  document.getElementById('modalBookingForm').reset();
  document.querySelectorAll('input[name="addon"]').forEach(cb => cb.checked = false);
  document.querySelectorAll('.addon-check').forEach(el => el.classList.remove('addon-check-selected'));

  selectedDate = null;
  selectedTime = null;
  document.getElementById('mDate').value = '';
  document.getElementById('mTime').value = '';
  document.querySelectorAll('.time-slot').forEach(b => b.classList.remove('time-slot-selected'));

  // Reset custom dropdowns back to their placeholder state
  document.querySelectorAll('.custom-select').forEach(wrap => {
    const valueEl = wrap.querySelector('.custom-select-value');
    valueEl.textContent = valueEl.dataset.placeholder;
    valueEl.classList.add('is-placeholder');
    wrap.querySelectorAll('li').forEach(li => li.setAttribute('aria-selected', 'false'));
  });

  goToStepSilent(1);
  showBookingConfirmation();
}

function showBookingConfirmation() {
  const banner = document.createElement('div');
  banner.className = 'booking-sent-banner';
  banner.textContent = '✓ Booking sent! We\'ll confirm your slot on WhatsApp shortly.';
  const bookCard = document.querySelector('.book-card');
  bookCard.parentNode.insertBefore(banner, bookCard);
  setTimeout(() => banner.remove(), 5000);
}
