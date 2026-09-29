// TBQ Platform: Practice Signups, Coach Scorekeeper, Team Management & Multi-Coach Admin

let state = {
  auth: JSON.parse(localStorage.getItem('tbq_auth') || 'null'),
  activeTab: 'signups', // 'signups' | 'scorekeeper' | 'teams' | 'coaches'
  scheduleData: null,
  activeFilter: 'all',
  selectedSlot: null,
  selectedDay: null,
  pollTimer: null,

  // Scorekeeper state
  tbqData: null,
  activeRoundNum: 1,
  scoreInput: {
    pointValue: 20,
    isInterruption: false,
    team: 'home',
    quizzer: null,
    isCorrect: true
  },

  // Coaches list for Super Coach
  coachesList: []
};

// Helper for authenticated requests
async function authFetch(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.auth?.token) {
    headers['Authorization'] = `Bearer ${state.auth.token}`;
  }

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401 && state.auth) {
    console.warn('Session expired or unauthorized');
    logoutCoach(false);
  }
  return res;
}

// ==========================================
// INITIALIZATION
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  initAuthUI();
  fetchSlots();
  startPolling();
});

function initAuthUI() {
  const user = state.auth?.user;
  const navTabs = document.getElementById('coach-nav-tabs');
  const loginBtn = document.getElementById('auth-login-btn');
  const userMenu = document.getElementById('auth-user-menu');
  const userNameEl = document.getElementById('auth-user-name');
  const roleBadge = document.getElementById('user-role-badge');
  const coachToolbar = document.getElementById('coach-toolbar');
  const coachesTabBtn = document.getElementById('tab-btn-coaches');
  const addStudentHint = document.getElementById('add-student-hint');

  if (user) {
    // Logged in
    navTabs.classList.remove('hidden');
    loginBtn.classList.add('hidden');
    userMenu.classList.remove('hidden');
    coachToolbar.classList.remove('hidden');
    if (addStudentHint) addStudentHint.classList.remove('hidden');

    userNameEl.textContent = user.name;

    if (user.role === 'supercoach') {
      roleBadge.textContent = '👑 Super Coach';
      roleBadge.className = 'text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border bg-amber-400 text-brand-950 border-amber-300 flex items-center gap-1 shadow-sm';
      roleBadge.classList.remove('hidden');
      if (coachesTabBtn) coachesTabBtn.classList.remove('hidden');
    } else {
      roleBadge.textContent = '👤 Coach';
      roleBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-500/20 text-emerald-300 border-emerald-500/30 flex items-center gap-1';
      roleBadge.classList.remove('hidden');
      if (coachesTabBtn) coachesTabBtn.classList.add('hidden');
    }

    // Verify session in background
    authFetch('/api/auth/me').then(res => {
      if (!res.ok) logoutCoach(false);
    }).catch(() => {});

  } else {
    // Public / Logged out
    navTabs.classList.add('hidden');
    loginBtn.classList.remove('hidden');
    userMenu.classList.add('hidden');
    roleBadge.classList.add('hidden');
    coachToolbar.classList.add('hidden');
    if (coachesTabBtn) coachesTabBtn.classList.add('hidden');
    if (addStudentHint) addStudentHint.classList.add('hidden');

    // Force signups tab if logged out
    if (state.activeTab !== 'signups') {
      switchTab('signups');
    }
  }
}

function switchTab(tab) {
  // Protect coach-only tabs
  if (['scorekeeper', 'teams', 'coaches'].includes(tab) && !state.auth) {
    openCoachLoginModal();
    return;
  }

  // Protect supercoach tab
  if (tab === 'coaches' && state.auth?.user?.role !== 'supercoach') {
    alert('Access restricted to Super Coach.');
    return;
  }

  state.activeTab = tab;

  // Toggle sections
  ['signups', 'scorekeeper', 'teams', 'coaches'].forEach(t => {
    const sec = document.getElementById(`section-${t}`);
    const btn = document.getElementById(`tab-btn-${t}`);
    if (sec) {
      if (t === tab) sec.classList.remove('hidden');
      else sec.classList.add('hidden');
    }
    if (btn) {
      if (t === tab) {
        btn.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-brand-600 text-white shadow-sm';
      } else {
        btn.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-brand-200 hover:text-white hover:bg-brand-800/60';
      }
    }
  });

  // Load section data
  if (tab === 'signups') {
    fetchSlots();
  } else if (tab === 'scorekeeper') {
    fetchTbqData(state.activeRoundNum);
  } else if (tab === 'teams') {
    loadTeamsData();
  } else if (tab === 'coaches') {
    loadCoachesData();
  }
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    const modal = document.getElementById('booking-modal');
    if (modal && modal.classList.contains('hidden')) {
      if (state.activeTab === 'signups') fetchSlots(true);
      else if (state.activeTab === 'scorekeeper' && state.auth) fetchTbqData(state.activeRoundNum, true);
    }
  }, 4000);
}

// ==========================================
// 1. PRACTICE SIGNUPS LOGIC
// ==========================================

async function fetchSlots(silent = false) {
  try {
    const res = await fetch('/api/slots');
    if (!res.ok) throw new Error();
    state.scheduleData = await res.json();
    renderSchedule();
    updateStats();
    renderStudentChips();
    updatePrintView();
  } catch (err) {
    if (!silent) console.error('Error fetching slots:', err);
  }
}

function updateStats() {
  if (!state.scheduleData) return;
  let totalSlots = 0;
  let bookedSlots = 0;

  state.scheduleData.days.forEach(day => {
    day.slots.forEach(slot => {
      totalSlots++;
      if (slot.status === 'booked') bookedSlots++;
    });
  });

  const studentsList = state.scheduleData.students || [];
  const target = studentsList.length || 7;
  const fractionEl = document.getElementById('booking-fraction');
  const barEl = document.getElementById('booking-progress-bar');
  const openCountEl = document.getElementById('open-slots-count');

  if (fractionEl) fractionEl.textContent = `${bookedSlots} / ${target}`;
  if (barEl) {
    const pct = Math.min(100, Math.round((bookedSlots / target) * 100));
    barEl.style.width = `${pct}%`;
    barEl.className = bookedSlots >= target
      ? 'bg-emerald-500 h-3 rounded-full transition-all duration-500'
      : 'bg-brand-600 h-3 rounded-full transition-all duration-500';
  }
  if (openCountEl) {
    const openSlots = totalSlots - bookedSlots;
    openCountEl.textContent = `${openSlots} open slot${openSlots === 1 ? '' : 's'}`;
  }
}

function renderStudentChips() {
  const container = document.getElementById('students-roster-chips');
  if (!container) return;

  const studentsList = state.scheduleData?.students || [];

  let html = '';
  studentsList.forEach((s, idx) => {
    if (s.isBooked) {
      html += `
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs">
          <span>✓</span>
          <span>${idx + 1}. ${escapeHtml(s.name)}</span>
          <span class="text-[10px] font-normal text-emerald-700 ml-0.5">(${s.time ? s.time.split('–')[0].trim() : 'Booked'})</span>
        </span>
      `;
    } else {
      html += `
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
          <span class="text-amber-500 font-bold">⏳</span>
          <span>${idx + 1}. ${escapeHtml(s.name)}</span>
        </span>
      `;
    }
  });

  container.innerHTML = html;
}

function renderSchedule() {
  const container = document.getElementById('schedule-container');
  if (!container || !state.scheduleData) return;

  const daysToRender = state.scheduleData.days.filter(day => {
    if (state.activeFilter === 'tue') return day.id.includes('tue');
    if (state.activeFilter === 'fri') return day.id.includes('fri');
    return true;
  });

  let html = '';
  daysToRender.forEach(day => {
    const totalDaySlots = day.slots.length;
    const bookedDaySlots = day.slots.filter(s => s.status === 'booked').length;
    const openDaySlots = totalDaySlots - bookedDaySlots;

    html += `
      <section class="bg-white rounded-2xl p-5 sm:p-7 shadow-sm border border-slate-200">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-5 border-b border-slate-100 gap-2">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-extrabold uppercase tracking-wider text-brand-600 bg-brand-50 px-2.5 py-0.5 rounded-full border border-brand-100">
                ${day.dayOfWeek}
              </span>
              <span class="text-xs text-slate-400 font-medium">${day.timeWindow}</span>
            </div>
            <h3 class="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">${day.formattedDate}</h3>
          </div>
          <div class="text-xs font-semibold text-slate-500 flex items-center gap-2">
            <span class="px-2.5 py-1 rounded-full ${openDaySlots > 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500'}">
              ${openDaySlots} Open Slot${openDaySlots === 1 ? '' : 's'}
            </span>
            <span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">${bookedDaySlots} Booked</span>
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
          ${day.slots.map(slot => renderSlotCard(slot, day)).join('')}
        </div>
      </section>
    `;
  });

  container.innerHTML = html;
}

function renderSlotCard(slot, day) {
  const isBooked = slot.status === 'booked';
  const isCoach = !!state.auth;

  if (isBooked) {
    return `
      <div class="rounded-xl border border-slate-200 bg-slate-50/80 p-4 transition-all flex flex-col justify-between relative overflow-hidden">
        <div class="absolute top-0 right-0 w-2 h-full bg-slate-300"></div>
        <div>
          <div class="flex items-center justify-between gap-1 mb-2">
            <span class="text-xs font-bold text-slate-500 bg-slate-200/80 px-2 py-0.5 rounded-md flex items-center gap-1">
              <span>⏰</span> ${slot.startTime} – ${slot.endTime}
            </span>
            <span class="text-[11px] font-bold text-slate-500 flex items-center gap-1 bg-white px-2 py-0.5 rounded-full border border-slate-200">
              <span>🔒</span> Booked
            </span>
          </div>
          <div class="mt-2.5">
            <div class="text-xs text-slate-400 font-medium uppercase tracking-wider">Reserved for:</div>
            <div class="text-base font-extrabold text-slate-900 flex items-center gap-1.5 mt-0.5">
              <span>👤</span>
              <span class="truncate">${escapeHtml(slot.bookedBy)}</span>
            </div>
          </div>
        </div>
        <div class="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between">
          <span class="text-[11px] text-slate-400">15 min session</span>
          ${isCoach ? `
            <button onclick="coachCancelSlot('${slot.id}', '${escapeHtml(slot.bookedBy)}')" class="text-xs bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold px-2.5 py-1 rounded-md border border-rose-200 transition-colors">
              Cancel / Free Slot
            </button>
          ` : `
            <span class="text-xs text-slate-400 font-medium">Slot Unavailable</span>
          `}
        </div>
      </div>
    `;
  }

  return `
    <div class="group rounded-xl border border-emerald-200 bg-white hover:border-emerald-400 p-4 transition-all duration-200 hover:shadow-md flex flex-col justify-between relative overflow-hidden">
      <div class="absolute top-0 right-0 w-2 h-full bg-emerald-500"></div>
      <div>
        <div class="flex items-center justify-between gap-1 mb-2">
          <span class="text-xs font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md flex items-center gap-1 border border-emerald-100">
            <span>⏰</span> ${slot.startTime} – ${slot.endTime}
          </span>
          <span class="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Open
          </span>
        </div>
        <div class="mt-2 text-slate-600">
          <div class="text-xs text-slate-400 font-medium">Session Length</div>
          <div class="text-sm font-semibold text-slate-800">15-minute 1-on-1 practice</div>
        </div>
      </div>
      <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
        <button onclick="openBookingModal('${slot.id}', '${day.id}')" class="w-full bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white font-bold text-xs sm:text-sm py-2.5 px-3 rounded-lg shadow-sm shadow-emerald-600/20 transition-all flex items-center justify-center gap-1.5">
          <span>Choose Slot</span>
          <span>→</span>
        </button>
        ${isCoach ? `
          <button onclick="coachDeleteSlot('${slot.id}')" title="Delete Slot" class="text-slate-400 hover:text-rose-600 p-1.5 rounded hover:bg-slate-100 text-xs">
            🗑️
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

function filterDay(dayKey) {
  state.activeFilter = dayKey;
  document.querySelectorAll('.day-tab').forEach(tab => {
    tab.className = 'day-tab px-4 py-2 rounded-xl text-sm font-semibold transition-all bg-white hover:bg-slate-100 text-slate-700 border border-slate-200';
  });
  const activeBtn = document.getElementById(`tab-${dayKey}`);
  if (activeBtn) activeBtn.className = 'day-tab px-4 py-2 rounded-xl text-sm font-semibold transition-all bg-brand-600 text-white shadow-sm';
  renderSchedule();
}

function openBookingModal(slotId, dayId) {
  const day = state.scheduleData.days.find(d => d.id === dayId);
  const slot = day?.slots.find(s => s.id === slotId);
  if (!slot) return;

  state.selectedSlot = slot;
  state.selectedDay = day;

  document.getElementById('modal-slot-id').value = slot.id;
  document.getElementById('modal-slot-title').textContent = day.formattedDate;
  document.getElementById('modal-slot-time').innerHTML = `⏰ ${slot.startTime} – ${slot.endTime} (15 mins)`;

  const selectEl = document.getElementById('quizzer-name');
  selectEl.innerHTML = `<option value="">-- Choose Student Name --</option>`;

  const students = state.scheduleData.students || [];
  students.forEach((s, idx) => {
    const opt = document.createElement('option');
    opt.value = s.name;
    if (s.isBooked) {
      opt.disabled = true;
      opt.textContent = `${idx + 1}. ${s.name} (Already Booked - ${s.day || ''})`;
    } else {
      opt.textContent = `${idx + 1}. ${s.name}`;
    }
    selectEl.appendChild(opt);
  });

  document.getElementById('booking-error-alert').classList.add('hidden');
  document.getElementById('booking-modal').classList.remove('hidden');
  setTimeout(() => selectEl.focus(), 50);
}

function closeBookingModal() {
  document.getElementById('booking-modal').classList.add('hidden');
}

async function submitBooking(event) {
  event.preventDefault();
  const slotId = document.getElementById('modal-slot-id').value;
  const quizzerName = document.getElementById('quizzer-name').value;

  if (!quizzerName) {
    showBookingError('Please choose a student name from the list.');
    return;
  }

  const submitBtn = document.getElementById('submit-booking-btn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span>Saving...</span>`;

  try {
    const res = await fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotId, quizzerName })
    });

    const result = await res.json();
    if (!res.ok) {
      showBookingError(result.error || 'Failed to book slot.');
      await fetchSlots(true);
      return;
    }

    closeBookingModal();
    openSuccessModal(result.slot, result.day);
    await fetchSlots(true);
  } catch (err) {
    showBookingError('Network error. Please try again.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Confirm Booking</span> <span>✓</span>`;
  }
}

function showBookingError(msg) {
  const alertEl = document.getElementById('booking-error-alert');
  document.getElementById('booking-error-text').textContent = msg;
  alertEl.classList.remove('hidden');
}

function openSuccessModal(slot, day) {
  document.getElementById('success-quizzer-msg').textContent = `Slot reserved for ${slot.bookedBy}!`;
  document.getElementById('success-student-name').textContent = slot.bookedBy;
  document.getElementById('success-date').textContent = day.formattedDate;
  document.getElementById('success-time').textContent = `${slot.startTime} – ${slot.endTime}`;
  document.getElementById('download-ics-link').href = `/api/calendar/${slot.id}`;
  document.getElementById('success-modal').classList.remove('hidden');
}

function closeSuccessModal() {
  document.getElementById('success-modal').classList.add('hidden');
}

// ==========================================
// 2. TBQ MATCH SCOREKEEPER (COACHES ONLY)
// ==========================================

async function fetchTbqData(roundNum = 1, silent = false) {
  if (!state.auth) return;

  try {
    const res = await authFetch(`/api/tbq?round=${roundNum}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    state.tbqData = data;
    state.activeRoundNum = roundNum;
    renderScorekeeperUI();
  } catch (err) {
    if (!silent) console.error('Error fetching TBQ data:', err);
  }
}

function renderScorekeeperUI() {
  if (!state.tbqData) return;
  const { meet, activeRound } = state.tbqData;

  document.getElementById('sb-meet-title').textContent = meet.title || 'TBQ Quiz Meet';
  document.getElementById('sb-home-church').textContent = meet.homeChurch || 'Our Church';
  document.getElementById('sb-opp-church').textContent = meet.opponentChurch || 'Opponent Church';
  document.getElementById('opp-team-label-select').textContent = `⚔️ ${meet.opponentChurch || 'Opponent'}`;

  document.getElementById('sb-home-score').textContent = activeRound.homeTeam.totalScore;
  document.getElementById('sb-opp-score').textContent = activeRound.opponentTeam.totalScore;

  const roundsBar = document.getElementById('rounds-pill-bar');
  const totalRounds = meet.totalRounds || 3;
  let roundsHtml = '';
  for (let r = 1; r <= totalRounds; r++) {
    const isActive = r === state.activeRoundNum;
    roundsHtml += `
      <button onclick="fetchTbqData(${r})" class="px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${isActive ? 'bg-amber-400 text-slate-900 shadow-sm' : 'bg-white/10 hover:bg-white/20 text-white'}">
        Round ${r}
      </button>
    `;
  }
  roundsBar.innerHTML = roundsHtml;

  const nextQ = activeRound.questions.length + 1;
  document.getElementById('active-question-label').textContent = `Question #${nextQ}`;
  document.querySelectorAll('.current-round-text').forEach(el => el.textContent = state.activeRoundNum);

  renderQuizzersSelectGrid(activeRound);
  renderIndividualScorecard(activeRound);
  renderQuestionsLog(activeRound.questions);
}

function renderQuizzersSelectGrid(activeRound) {
  const homeGrid = document.getElementById('home-quizzers-select-grid');
  const oppGrid = document.getElementById('opp-quizzers-select-grid');

  let homeHtml = '';
  activeRound.homeTeam.quizzers.forEach(q => {
    const isSelected = state.scoreInput.team === 'home' && state.scoreInput.quizzer === q.name;
    const isQuizzedOut = q.isQuizzedOut;

    homeHtml += `
      <button type="button" ${isQuizzedOut ? 'disabled' : ''} onclick="selectQuizzer('home', '${escapeHtml(q.name)}')" class="quizzer-pick-btn p-2 rounded-xl text-left border text-xs font-bold transition-all relative ${
        isQuizzedOut 
          ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed opacity-75' 
          : isSelected 
            ? 'border-brand-600 bg-brand-600 text-white shadow-sm ring-2 ring-brand-400' 
            : 'bg-white border-slate-200 text-slate-800 hover:border-brand-300'
      }">
        <div class="truncate">${escapeHtml(q.name)}</div>
        <div class="text-[10px] font-medium mt-0.5 ${isSelected ? 'text-brand-100' : 'text-slate-400'}">
          ${isQuizzedOut ? '🎉 QUIZZED OUT (5/5)' : `${q.correct}/5 • ${q.points}pts`}
        </div>
      </button>
    `;
  });
  homeGrid.innerHTML = homeHtml || '<p class="text-xs text-slate-400 col-span-2">No home quizzers added yet.</p>';

  let oppHtml = '';
  activeRound.opponentTeam.quizzers.forEach(q => {
    const isSelected = state.scoreInput.team === 'opponent' && state.scoreInput.quizzer === q.name;
    const isQuizzedOut = q.isQuizzedOut;

    oppHtml += `
      <button type="button" ${isQuizzedOut ? 'disabled' : ''} onclick="selectQuizzer('opponent', '${escapeHtml(q.name)}')" class="quizzer-pick-btn p-2 rounded-xl text-left border text-xs font-bold transition-all relative ${
        isQuizzedOut 
          ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed opacity-75' 
          : isSelected 
            ? 'border-rose-600 bg-rose-600 text-white shadow-sm ring-2 ring-rose-400' 
            : 'bg-white border-slate-200 text-slate-800 hover:border-rose-300'
      }">
        <div class="truncate">${escapeHtml(q.name)}</div>
        <div class="text-[10px] font-medium mt-0.5 ${isSelected ? 'text-rose-100' : 'text-slate-400'}">
          ${isQuizzedOut ? '🎉 QUIZZED OUT (5/5)' : `${q.correct}/5 • ${q.points}pts`}
        </div>
      </button>
    `;
  });
  oppGrid.innerHTML = oppHtml || '<p class="text-xs text-slate-400 col-span-2">No opponent quizzers added yet.</p>';
}

function selectPoints(pts) {
  state.scoreInput.pointValue = pts;
  [10, 20, 30].forEach(p => {
    const btn = document.getElementById(`btn-pts-${p}`);
    if (p === pts) {
      btn.className = 'pts-btn py-3 rounded-xl border-2 border-brand-500 bg-brand-50 font-extrabold text-sm sm:text-base text-brand-900 transition-all flex flex-col items-center shadow-xs';
    } else {
      btn.className = 'pts-btn py-3 rounded-xl border border-slate-200 font-extrabold text-sm sm:text-base text-slate-700 hover:bg-slate-50 transition-all flex flex-col items-center';
    }
  });
}

function selectQuizzer(team, name) {
  state.scoreInput.team = team;
  state.scoreInput.quizzer = name;
  if (state.tbqData) renderQuizzersSelectGrid(state.tbqData.activeRound);
}

function selectResult(isCorrect) {
  state.scoreInput.isCorrect = isCorrect;
  const btnCorrect = document.getElementById('btn-result-correct');
  const btnIncorrect = document.getElementById('btn-result-incorrect');

  if (isCorrect) {
    btnCorrect.className = 'result-btn py-3.5 rounded-xl border-2 border-emerald-500 bg-emerald-50 text-emerald-900 font-extrabold text-sm sm:text-base flex items-center justify-center gap-2 shadow-xs transition-all';
    btnIncorrect.className = 'result-btn py-3.5 rounded-xl border border-slate-200 text-slate-700 font-extrabold text-sm sm:text-base flex items-center justify-center gap-2 hover:bg-slate-50 transition-all';
  } else {
    btnCorrect.className = 'result-btn py-3.5 rounded-xl border border-slate-200 text-slate-700 font-extrabold text-sm sm:text-base flex items-center justify-center gap-2 hover:bg-slate-50 transition-all';
    btnIncorrect.className = 'result-btn py-3.5 rounded-xl border-2 border-rose-500 bg-rose-50 text-rose-900 font-extrabold text-sm sm:text-base flex items-center justify-center gap-2 shadow-xs transition-all';
  }
}

async function submitQuestionScore(event) {
  event.preventDefault();

  if (!state.scoreInput.quizzer) {
    alert('Please tap which quizzer answered the question.');
    return;
  }

  const isInterruption = document.getElementById('score-is-interruption').checked;

  try {
    const res = await authFetch('/api/tbq/score', {
      method: 'POST',
      body: JSON.stringify({
        roundNum: state.activeRoundNum,
        pointValue: state.scoreInput.pointValue,
        isInterruption: isInterruption,
        team: state.scoreInput.team,
        quizzer: state.scoreInput.quizzer,
        isCorrect: state.scoreInput.isCorrect
      })
    });

    const result = await res.json();
    if (!res.ok) {
      alert(result.error || 'Failed to record question.');
      return;
    }

    state.scoreInput.quizzer = null;
    document.getElementById('score-is-interruption').checked = false;
    selectPoints(20);
    selectResult(true);

    state.tbqData.activeRound = result.activeRound;
    renderScorekeeperUI();

  } catch (err) {
    alert('Network error while recording score.');
  }
}

async function undoLastQuestion() {
  if (!confirm('Undo the last recorded question in this round?')) return;

  try {
    const res = await authFetch('/api/tbq/undo', {
      method: 'POST',
      body: JSON.stringify({ roundNum: state.activeRoundNum })
    });
    const result = await res.json();
    if (!res.ok) {
      alert(result.error || 'Nothing to undo.');
      return;
    }
    state.tbqData.activeRound = result.activeRound;
    renderScorekeeperUI();
  } catch (err) {
    alert('Error undoing question.');
  }
}

async function coachResetRound() {
  if (!confirm(`Are you sure you want to reset and clear all questions for Round ${state.activeRoundNum}?`)) return;

  try {
    const res = await authFetch('/api/tbq/reset-round', {
      method: 'POST',
      body: JSON.stringify({ roundNum: state.activeRoundNum })
    });
    const result = await res.json();
    if (!res.ok) {
      alert(result.error || 'Failed to reset round.');
      return;
    }
    state.tbqData.activeRound = result.activeRound;
    renderScorekeeperUI();
  } catch (err) {
    alert('Error resetting round.');
  }
}

function renderIndividualScorecard(activeRound) {
  const tbody = document.getElementById('individual-scorecard-tbody');
  if (!tbody) return;

  let allQuizzers = [];
  activeRound.homeTeam.quizzers.forEach(q => allQuizzers.push({ ...q, teamLabel: 'Home', teamClass: 'bg-brand-50 text-brand-700' }));
  activeRound.opponentTeam.quizzers.forEach(q => allQuizzers.push({ ...q, teamLabel: 'Opponent', teamClass: 'bg-rose-50 text-rose-700' }));

  let html = '';
  allQuizzers.forEach(q => {
    html += `
      <tr class="hover:bg-slate-50/70 transition-colors">
        <td class="py-2.5 font-bold text-slate-800">${escapeHtml(q.name)}</td>
        <td class="py-2.5 text-center">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${q.teamClass}">${q.teamLabel}</span>
        </td>
        <td class="py-2.5 text-center font-bold text-emerald-700">${q.correct} / 5</td>
        <td class="py-2.5 text-center text-rose-600 font-medium">${q.errors}</td>
        <td class="py-2.5 text-center font-black text-slate-900">${q.points}</td>
        <td class="py-2.5 text-right">
          ${q.isQuizzedOut 
            ? `<span class="bg-amber-100 text-amber-900 border border-amber-300 font-extrabold px-2 py-0.5 rounded-full text-[10px]">🎉 Quizzed Out!</span>` 
            : `<span class="text-slate-400 text-[11px]">Active</span>`}
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

function renderQuestionsLog(questions) {
  const listEl = document.getElementById('questions-log-list');
  const countEl = document.getElementById('log-count');
  if (!listEl) return;

  countEl.textContent = `${questions.length} recorded`;

  if (questions.length === 0) {
    listEl.innerHTML = `<p class="text-slate-400 text-center py-8 italic">No questions recorded in this round yet.</p>`;
    return;
  }

  let html = '';
  [...questions].reverse().forEach(q => {
    const isHome = q.team === 'home';
    html += `
      <div class="p-2.5 rounded-xl border ${q.isCorrect ? 'bg-emerald-50/60 border-emerald-200' : 'bg-rose-50/60 border-rose-200'}">
        <div class="flex items-center justify-between font-bold text-xs">
          <span>Q${q.questionNum} • ${q.pointValue} Pts</span>
          <span class="${q.isCorrect ? 'text-emerald-700' : 'text-rose-700'}">${q.isCorrect ? '✓ CORRECT' : '✗ INCORRECT'}</span>
        </div>
        <div class="text-[11px] text-slate-600 mt-1 flex items-center justify-between">
          <span>👤 <strong>${escapeHtml(q.quizzer)}</strong> (${isHome ? 'Home' : 'Opponent'})</span>
          <span>${q.isInterruption ? '⚡ Interrupted' : ''}</span>
        </div>
      </div>
    `;
  });

  listEl.innerHTML = html;
}

// ==========================================
// 3. TEAMS & QUIZZERS MANAGER (COACHES)
// ==========================================

async function loadTeamsData() {
  if (!state.auth) return;
  await fetchSlots(true);
  await fetchTbqData(state.activeRoundNum, true);

  const studentsList = state.scheduleData?.students || [];
  const listEl = document.getElementById('home-students-manager-list');
  const badgeEl = document.getElementById('home-kids-count-badge');

  if (badgeEl) badgeEl.textContent = `${studentsList.length} Students`;

  if (listEl) {
    let html = '';
    studentsList.forEach((s, idx) => {
      html += `
        <div class="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
          <div class="flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-brand-100 text-brand-700 font-bold text-xs flex items-center justify-center">${idx + 1}</span>
            <span class="text-sm font-bold text-slate-800">${escapeHtml(s.name)}</span>
            ${s.isBooked ? `<span class="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-semibold">Booked ${s.time || ''}</span>` : ''}
          </div>
          <button onclick="handleRemoveStudent('${escapeHtml(s.name)}')" class="text-xs text-rose-600 hover:text-rose-800 hover:bg-rose-50 px-2 py-1 rounded transition-colors font-semibold">
            Remove
          </button>
        </div>
      `;
    });
    listEl.innerHTML = html || '<p class="text-xs text-slate-400">No students on roster.</p>';
  }

  // Populate Opponent form
  if (state.tbqData?.meet) {
    const { meet } = state.tbqData;
    document.getElementById('teams-meet-title').value = meet.title || '';
    document.getElementById('teams-home-church').value = meet.homeChurch || '';
    document.getElementById('teams-total-rounds').value = meet.totalRounds || 3;
    document.getElementById('teams-opp-church').value = meet.opponentChurch || '';
    document.getElementById('teams-opp-quizzers').value = (meet.opponentQuizzers || []).join(', ');
  }
}

async function handleAddNewStudent(event) {
  event.preventDefault();
  const input = document.getElementById('new-student-name-input');
  const name = input.value.trim();
  if (!name) return;

  try {
    const res = await authFetch('/api/roster/add-student', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    const result = await res.json();
    if (!res.ok) {
      alert(result.error || 'Failed to add student.');
      return;
    }
    input.value = '';
    await loadTeamsData();
    alert(`✅ Student "${name}" added to roster!`);
  } catch (err) {
    alert('Error adding student.');
  }
}

async function handleRemoveStudent(name) {
  if (!confirm(`Are you sure you want to remove "${name}" from the team roster?`)) return;

  try {
    const res = await authFetch('/api/roster/remove-student', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    const result = await res.json();
    if (!res.ok) {
      alert(result.error || 'Failed to remove student.');
      return;
    }
    await loadTeamsData();
  } catch (err) {
    alert('Error removing student.');
  }
}

async function handleSaveOpponentSettings(event) {
  event.preventDefault();

  const title = document.getElementById('teams-meet-title').value.trim();
  const homeChurch = document.getElementById('teams-home-church').value.trim();
  const opponentChurch = document.getElementById('teams-opp-church').value.trim();
  const totalRounds = parseInt(document.getElementById('teams-total-rounds').value);
  const opponentQuizzers = document.getElementById('teams-opp-quizzers').value;

  try {
    const res = await authFetch('/api/tbq/settings', {
      method: 'POST',
      body: JSON.stringify({
        title,
        homeChurch,
        opponentChurch,
        totalRounds,
        opponentQuizzers
      })
    });

    const result = await res.json();
    if (!res.ok) {
      alert(result.error || 'Failed to update settings.');
      return;
    }

    await fetchTbqData(state.activeRoundNum);
    alert('✅ Opponent & Match settings saved successfully!');
  } catch (err) {
    alert('Error saving settings.');
  }
}

// ==========================================
// 4. SUPER COACH - MANAGE COACHES
// ==========================================

async function loadCoachesData() {
  if (state.auth?.user?.role !== 'supercoach') return;

  try {
    const res = await authFetch('/api/coaches');
    if (!res.ok) throw new Error();
    const data = await res.json();
    state.coachesList = data.coaches || [];
    renderCoachesTable();
  } catch (err) {
    console.error('Error loading coaches:', err);
  }
}

function renderCoachesTable() {
  const tbody = document.getElementById('coaches-table-tbody');
  if (!tbody) return;

  let html = '';
  state.coachesList.forEach(c => {
    const isSuper = c.role === 'supercoach';
    const isCurrent = c.id === state.auth.user.id;

    html += `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="py-3 font-bold text-slate-800">
          ${escapeHtml(c.name)}
          ${isCurrent ? '<span class="text-[10px] text-brand-600 font-bold ml-1">(You)</span>' : ''}
        </td>
        <td class="py-3 text-slate-600 font-mono text-xs">@${escapeHtml(c.username)}</td>
        <td class="py-3">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isSuper ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-brand-50 text-brand-700 border border-brand-200'}">
            ${isSuper ? '👑 Super Coach' : '👤 Coach'}
          </span>
        </td>
        <td class="py-3 font-mono text-xs text-slate-500">${escapeHtml(c.passcode)}</td>
        <td class="py-3 text-right space-x-1">
          <button onclick="handleResetCoachPasscode('${c.id}', '${escapeHtml(c.name)}')" class="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-md transition-colors font-medium">
            Reset Key
          </button>
          ${!isCurrent ? `
            <button onclick="handleDeleteCoach('${c.id}', '${escapeHtml(c.name)}')" class="text-xs bg-rose-50 hover:bg-rose-100 text-rose-700 px-2.5 py-1 rounded-md border border-rose-200 transition-colors font-semibold">
              Delete
            </button>
          ` : ''}
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

function openAddCoachModal() {
  document.getElementById('add-coach-name').value = '';
  document.getElementById('add-coach-username').value = '';
  document.getElementById('add-coach-passcode').value = '';
  document.getElementById('add-coach-modal').classList.remove('hidden');
}

function closeAddCoachModal() {
  document.getElementById('add-coach-modal').classList.add('hidden');
}

async function handleCreateCoach(event) {
  event.preventDefault();
  const name = document.getElementById('add-coach-name').value.trim();
  const username = document.getElementById('add-coach-username').value.trim();
  const passcode = document.getElementById('add-coach-passcode').value.trim();
  const role = document.getElementById('add-coach-role').value;

  try {
    const res = await authFetch('/api/coaches/add', {
      method: 'POST',
      body: JSON.stringify({ name, username, passcode, role })
    });
    const result = await res.json();
    if (!res.ok) {
      alert(result.error || 'Failed to create coach.');
      return;
    }
    closeAddCoachModal();
    await loadCoachesData();
    alert(`✅ Coach "${name}" created successfully!`);
  } catch (err) {
    alert('Error creating coach.');
  }
}

async function handleDeleteCoach(coachId, coachName) {
  if (!confirm(`Are you sure you want to remove coach "${coachName}"?`)) return;

  try {
    const res = await authFetch('/api/coaches/delete', {
      method: 'POST',
      body: JSON.stringify({ coachId })
    });
    const result = await res.json();
    if (!res.ok) {
      alert(result.error || 'Failed to delete coach.');
      return;
    }
    await loadCoachesData();
  } catch (err) {
    alert('Error deleting coach.');
  }
}

async function handleResetCoachPasscode(coachId, coachName) {
  const newPasscode = prompt(`Enter new login passcode for ${coachName}:`);
  if (!newPasscode || !newPasscode.trim()) return;

  try {
    const res = await authFetch('/api/coaches/reset-passcode', {
      method: 'POST',
      body: JSON.stringify({ coachId, newPasscode: newPasscode.trim() })
    });
    const result = await res.json();
    if (!res.ok) {
      alert(result.error || 'Failed to reset passcode.');
      return;
    }
    await loadCoachesData();
    alert(`✅ Passcode updated for ${coachName}!`);
  } catch (err) {
    alert('Error resetting passcode.');
  }
}

// ==========================================
// 5. AUTHENTICATION & LOGIN/LOGOUT
// ==========================================

function openCoachLoginModal() {
  document.getElementById('login-error-alert').classList.add('hidden');
  document.getElementById('login-username-input').value = '';
  document.getElementById('login-passcode-input').value = '';
  document.getElementById('coach-login-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('login-username-input').focus(), 50);
}

function closeCoachLoginModal() {
  document.getElementById('coach-login-modal').classList.add('hidden');
}

async function handleCoachLogin(event) {
  event.preventDefault();
  const username = document.getElementById('login-username-input').value.trim();
  const passcode = document.getElementById('login-passcode-input').value.trim();

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, passcode })
    });

    const result = await res.json();
    if (!res.ok) {
      document.getElementById('login-error-alert').classList.remove('hidden');
      return;
    }

    state.auth = {
      token: result.token,
      user: result.user
    };
    localStorage.setItem('tbq_auth', JSON.stringify(state.auth));

    closeCoachLoginModal();
    initAuthUI();
    switchTab('scorekeeper'); // Navigate straight to Match Scorekeeper upon login!
  } catch (err) {
    alert('Network error while logging in.');
  }
}

function logoutCoach(notify = true) {
  if (state.auth?.token) {
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.auth.token}` }
    }).catch(() => {});
  }

  localStorage.removeItem('tbq_auth');
  state.auth = null;
  initAuthUI();
  switchTab('signups');
  if (notify) alert('You have been logged out.');
}

// Coach slot management
async function coachCancelSlot(slotId, quizzerName) {
  if (!confirm(`Cancel booking for "${quizzerName}" and reopen this slot?`)) return;

  try {
    const res = await authFetch('/api/admin/cancel', {
      method: 'POST',
      body: JSON.stringify({ slotId })
    });
    const result = await res.json();
    if (!res.ok) {
      alert(result.error || 'Failed to cancel slot.');
      return;
    }
    await fetchSlots(true);
  } catch (err) {
    alert('Error cancelling slot.');
  }
}

async function coachDeleteSlot(slotId) {
  if (!confirm('Are you sure you want to delete this open slot?')) return;
  try {
    const res = await authFetch('/api/admin/delete-slot', {
      method: 'POST',
      body: JSON.stringify({ slotId })
    });
    if (!res.ok) throw new Error();
    await fetchSlots(true);
  } catch (err) {
    alert('Error deleting slot.');
  }
}

function openAddSlotModal() {
  document.getElementById('add-slot-modal').classList.remove('hidden');
}

function closeAddSlotModal() {
  document.getElementById('add-slot-modal').classList.add('hidden');
}

async function handleAddSlot(event) {
  event.preventDefault();
  const dayId = document.getElementById('add-slot-day').value;
  const startTime = document.getElementById('add-slot-start').value.trim();
  const endTime = document.getElementById('add-slot-end').value.trim();

  try {
    const res = await authFetch('/api/admin/add-slot', {
      method: 'POST',
      body: JSON.stringify({ dayId, startTime, endTime })
    });
    if (!res.ok) throw new Error();
    closeAddSlotModal();
    await fetchSlots(true);
  } catch (err) {
    alert('Error adding slot.');
  }
}

function copyScheduleToClipboard() {
  if (!state.scheduleData) return;

  let text = `📖 *TBQ 1-on-1 Practice Schedule (Coach Sessions)*\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  state.scheduleData.days.forEach(day => {
    text += `🗓️ *${day.formattedDate}* (${day.timeWindow})\n`;
    day.slots.forEach(slot => {
      if (slot.status === 'booked') {
        text += `• ${slot.startTime} - ${slot.endTime}: *${slot.bookedBy}*\n`;
      } else {
        text += `• ${slot.startTime} - ${slot.endTime}: _[OPEN]_\n`;
      }
    });
    text += `\n`;
  });

  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `👉 Book slots: ${window.location.origin}`;

  navigator.clipboard.writeText(text).then(() => {
    alert('✅ Schedule formatted and copied to clipboard! You can now paste it into WhatsApp.');
  }).catch(() => {
    alert('Unable to copy automatically. Please copy from the screen.');
  });
}

function updatePrintView() {
  const container = document.getElementById('print-roster-content');
  if (!container || !state.scheduleData) return;

  let html = '';
  state.scheduleData.days.forEach(day => {
    html += `
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 16px; font-weight: bold; border-bottom: 2px solid #333; padding-bottom: 4px; margin-bottom: 8px;">
          ${day.formattedDate} (${day.timeWindow})
        </h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <thead>
            <tr style="background: #f0f0f0; text-align: left;">
              <th style="border: 1px solid #ddd; padding: 6px 10px; width: 140px;">Time</th>
              <th style="border: 1px solid #ddd; padding: 6px 10px; width: 220px;">Student</th>
              <th style="border: 1px solid #ddd; padding: 6px 10px;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${day.slots.map(slot => `
              <tr>
                <td style="border: 1px solid #ddd; padding: 6px 10px; font-weight: bold;">${slot.startTime} – ${slot.endTime}</td>
                <td style="border: 1px solid #ddd; padding: 6px 10px; ${slot.status === 'booked' ? 'font-weight: bold;' : 'color: #888;'}">${slot.status === 'booked' ? escapeHtml(slot.bookedBy) : '— OPEN —'}</td>
                <td style="border: 1px solid #ddd; padding: 6px 10px;">${slot.status === 'booked' ? 'Confirmed' : 'Available'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  });

  container.innerHTML = html;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
