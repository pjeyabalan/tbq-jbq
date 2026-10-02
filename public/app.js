/**
 * TBQ 4-Team Tournament & Match Platform Engine
 * Supports Chicago Indian Church (Teams 1 & 2) + 2 Opponents (Configurable on the fly)
 */

const state = {
  auth: null,
  currentTab: 'scoresheet',
  publicData: null,
  tbqData: null,
  activeMatchId: null,
  scoreInput: {
    pointValue: 20,
    isInterruption: false,
    isRebound: false,
    team: 'teamA',
    seatNum: 1,
    quizzer: '',
    isCorrect: true
  }
};

// ==========================================
// 1. INITIALIZATION & AUTHENTICATION
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
  checkStorageStatus();
  const savedToken = localStorage.getItem('tbq_coach_token');
  if (savedToken) {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${savedToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLoggedInCoach(savedToken, data.user);
        return;
      }
    } catch (e) {
      console.warn('Saved auth token invalid');
    }
  }

  setLoggedOutView();
  fetchPublicSummary();
});

function setLoggedInCoach(token, user) {
  state.auth = { token, user };
  localStorage.setItem('tbq_coach_token', token);

  document.getElementById('auth-login-btn').classList.add('hidden');
  document.getElementById('auth-user-menu').classList.remove('hidden');
  document.getElementById('coach-nav-tabs').classList.remove('hidden');

  const nameEl = document.getElementById('auth-user-name');
  if (nameEl) nameEl.textContent = user.name || user.username;

  const roleBadge = document.getElementById('user-role-badge');
  roleBadge.classList.remove('hidden');
  roleBadge.className = user.role === 'supercoach'
    ? 'text-[10px] font-black px-2 py-0.5 rounded-full border bg-amber-400 text-brand-950 border-amber-300'
    : 'text-[10px] font-black px-2 py-0.5 rounded-full border bg-indigo-500/20 text-indigo-200 border-indigo-400/30';
  roleBadge.textContent = user.role === 'supercoach' ? '👑 Super Coach' : '👤 Coach';

  const coachesTabBtn = document.getElementById('tab-btn-coaches');
  if (user.role === 'supercoach') {
    coachesTabBtn.classList.remove('hidden');
  } else {
    coachesTabBtn.classList.add('hidden');
  }

  document.getElementById('section-public').classList.add('hidden');
  switchTab('scoresheet');
  fetchTbqData();
}

function setLoggedOutView() {
  state.auth = null;
  localStorage.removeItem('tbq_coach_token');

  document.getElementById('auth-login-btn').classList.remove('hidden');
  document.getElementById('auth-user-menu').classList.add('hidden');
  document.getElementById('coach-nav-tabs').classList.add('hidden');
  document.getElementById('user-role-badge').classList.add('hidden');

  document.getElementById('section-scoresheet').classList.add('hidden');
  document.getElementById('section-teams').classList.add('hidden');
  document.getElementById('section-coaches').classList.add('hidden');
  document.getElementById('section-public').classList.remove('hidden');
}

function logoutCoach() {
  if (state.auth && state.auth.token) {
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.auth.token}` }
    }).catch(() => {});
  }
  setLoggedOutView();
  fetchPublicSummary();
}

function handleLogoClick() {
  if (!state.auth) fetchPublicSummary();
  else switchTab('scoresheet');
}

// Inline Login Handler
async function handleInlineLogin(event) {
  event.preventDefault();
  const username = document.getElementById('inline-username').value.trim();
  const passcode = document.getElementById('inline-passcode').value.trim();
  const errorEl = document.getElementById('inline-login-error');
  errorEl.classList.add('hidden');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, passcode })
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Invalid credentials.';
      errorEl.classList.remove('hidden');
      return;
    }
    setLoggedInCoach(data.token, data.user);
  } catch (err) {
    errorEl.textContent = 'Network error while signing in.';
    errorEl.classList.remove('hidden');
  }
}

// Modal Login
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

async function handleModalCoachLogin(event) {
  event.preventDefault();
  const username = document.getElementById('login-username-input').value.trim();
  const passcode = document.getElementById('login-passcode-input').value.trim();
  const errorEl = document.getElementById('login-error-alert');
  errorEl.classList.add('hidden');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, passcode })
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Invalid username or passcode.';
      errorEl.classList.remove('hidden');
      return;
    }
    closeCoachLoginModal();
    setLoggedInCoach(data.token, data.user);
  } catch (err) {
    errorEl.textContent = 'Network error.';
    errorEl.classList.remove('hidden');
  }
}

// Helper: Authenticated fetch wrapper
async function authFetch(url, options = {}) {
  const headers = options.headers || {};
  if (state.auth && state.auth.token) {
    headers['Authorization'] = `Bearer ${state.auth.token}`;
  }
  if (!headers['Content-Type'] && options.method && options.method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(url, { ...options, headers });
}

// Tab Switching
function switchTab(tab) {
  state.currentTab = tab;

  document.getElementById('section-public').classList.add('hidden');
  document.getElementById('section-scoresheet').classList.toggle('hidden', tab !== 'scoresheet');
  document.getElementById('section-teams').classList.toggle('hidden', tab !== 'teams');
  document.getElementById('section-coaches').classList.toggle('hidden', tab !== 'coaches');

  const activeClass = 'bg-brand-600 text-white shadow-sm';
  const inactiveClass = 'text-brand-200 hover:text-white hover:bg-brand-800/60';

  const tabScoresheet = document.getElementById('tab-btn-scoresheet');
  const tabTeams = document.getElementById('tab-btn-teams');
  const tabCoaches = document.getElementById('tab-btn-coaches');

  if (tabScoresheet) tabScoresheet.className = `px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${tab === 'scoresheet' ? activeClass : inactiveClass}`;
  if (tabTeams) tabTeams.className = `px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${tab === 'teams' ? activeClass : inactiveClass}`;
  if (tabCoaches) tabCoaches.className = `px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${tab === 'coaches' ? 'bg-amber-500 text-brand-950 shadow-sm' : 'text-amber-300 hover:text-amber-100 hover:bg-brand-800/60'}`;

  if (tab === 'scoresheet') fetchTbqData(state.activeMatchId);
  if (tab === 'teams') renderTeamsManagerUI();
  if (tab === 'coaches') fetchCoachesList();
}

// ==========================================
// 2. PUBLIC VIEW (4-TEAM STANDINGS & RESULTS)
// ==========================================

async function fetchPublicSummary() {
  try {
    const res = await fetch('/api/tbq/public-summary');
    if (!res.ok) return;
    const data = await res.json();
    state.publicData = data;
    renderPublicSummaryUI();
  } catch (err) {
    console.error('Error fetching public summary:', err);
  }
}

function renderPublicSummaryUI() {
  if (!state.publicData) return;
  const { title, teams, matches } = state.publicData;

  document.getElementById('public-meet-title').textContent = title || 'TBQ Tournament 2026';

  // 1. Render 4-Team Standings Table
  const tbody = document.getElementById('public-standings-tbody');
  let standingsHtml = '';

  teams.forEach((t, idx) => {
    const rankBadge = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : `#${idx + 1}`));
    const isCIC = t.name.toLowerCase().includes('chicago');
    standingsHtml += `
      <tr class="hover:bg-white/5 transition-colors">
        <td class="py-2.5 text-center font-mono text-sm">${rankBadge}</td>
        <td class="py-2.5">
          <div class="font-extrabold text-white flex items-center gap-1.5">
            <span>${escapeHtml(t.name)}</span>
            ${isCIC ? '<span class="bg-amber-400 text-brand-950 text-[9px] font-black px-1.5 py-0.2 rounded">Host</span>' : ''}
          </div>
          <div class="text-[11px] text-slate-300 font-medium">${escapeHtml(t.church)}</div>
        </td>
        <td class="py-2.5 text-center font-mono">${t.matchesPlayed}</td>
        <td class="py-2.5 text-center font-mono text-emerald-300">${t.won}</td>
        <td class="py-2.5 text-center font-mono text-rose-300">${t.lost}</td>
        <td class="py-2.5 text-right font-mono text-base font-black text-amber-300">${t.totalPoints}</td>
      </tr>
    `;
  });
  tbody.innerHTML = standingsHtml || '<tr><td colspan="6" class="text-center py-4 text-slate-300">No teams configured yet.</td></tr>';

  // 2. Render Matches List
  const matchesListEl = document.getElementById('public-matches-list');
  let matchesHtml = '';

  matches.forEach(m => {
    let resultBadge = '';
    if (m.winner === 'teamA') {
      resultBadge = `<span class="bg-emerald-100 text-emerald-800 font-black px-2.5 py-1 rounded-full text-xs border border-emerald-300">🏆 ${escapeHtml(m.teamAName)} WON</span>`;
    } else if (m.winner === 'teamB') {
      resultBadge = `<span class="bg-rose-100 text-rose-800 font-black px-2.5 py-1 rounded-full text-xs border border-rose-300">🏆 ${escapeHtml(m.teamBName)} WON</span>`;
    } else if (m.winner === 'tie' && m.totalQuestions > 0) {
      resultBadge = `<span class="bg-amber-100 text-amber-800 font-black px-2.5 py-1 rounded-full text-xs border border-amber-300">⚖️ TIED MATCH</span>`;
    } else {
      resultBadge = `<span class="bg-slate-100 text-slate-600 font-bold px-2.5 py-1 rounded-full text-xs border border-slate-200">⏳ ${m.status}</span>`;
    }

    matchesHtml += `
      <div class="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 hover:bg-white transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-brand-900 text-white flex items-center justify-center font-black text-sm font-mono-score">
            M#${m.matchNumber}
          </div>
          <div>
            <div class="text-xs font-extrabold uppercase text-slate-500 tracking-wider">
              Meet ${m.meetNum || m.roundNum} • Room ${m.room}
            </div>
            <div class="text-sm sm:text-base font-bold text-slate-800 mt-0.5">
              <span>${escapeHtml(m.teamAName)}</span>
              <span class="text-slate-400 font-normal"> vs </span>
              <span>${escapeHtml(m.teamBName)}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-4 self-end sm:self-center">
          <div class="font-mono-score font-black text-base sm:text-lg text-slate-900">
            <span class="${m.teamAScore > m.teamBScore ? 'text-brand-700' : 'text-slate-700'}">${m.teamAScore}</span>
            <span class="text-slate-300 mx-1">-</span>
            <span class="${m.teamBScore > m.teamAScore ? 'text-rose-600' : 'text-slate-700'}">${m.teamBScore}</span>
          </div>
          ${resultBadge}
        </div>
      </div>
    `;
  });
  matchesListEl.innerHTML = matchesHtml || '<div class="text-slate-400 text-center py-4">No matches scheduled yet.</div>';
}

// ==========================================
// 3. OFFICIAL SCORESHEET (AUTHENTICATED)
// ==========================================

async function fetchTbqData(matchId) {
  if (!state.auth) return;

  const url = matchId ? `/api/tbq?matchId=${matchId}` : '/api/tbq';
  try {
    const res = await authFetch(url);
    if (!res.ok) throw new Error();
    const data = await res.json();
    state.tbqData = data;
    state.activeMatchId = data.activeMatchId;
    try {
      localStorage.setItem('tbq_backup_scores', JSON.stringify(data));
    } catch (e) {}
    renderOfficialScoresheet();
  } catch (err) {
    console.error('Error fetching TBQ scoresheet:', err);
  }
}

function renderOfficialScoresheet() {
  if (!state.tbqData || !state.tbqData.activeRound) return;
  const { matchesList, activeRound } = state.tbqData;

  // 1. Matches Selector Pills Bar
  const pillsBar = document.getElementById('match-selector-pills');
  let pillsHtml = '';
  matchesList.forEach(m => {
    const isActive = m.id === state.activeMatchId;
    pillsHtml += `
      <button onclick="fetchTbqData('${m.id}')" class="px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
        isActive 
          ? 'bg-amber-400 text-slate-950 font-black shadow-md ring-2 ring-amber-300' 
          : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700'
      }">
        <span>M#${m.matchNumber} (Meet ${m.meetNum || m.roundNum})</span>
        <span class="text-[10px] opacity-80">Room ${m.room}</span>
      </button>
    `;
  });
  pillsBar.innerHTML = pillsHtml;

  // 2. Header Metadata
  document.getElementById('meta-match-num').textContent = activeRound.matchNumber || "01";
  document.getElementById('meta-room-num').textContent = activeRound.room || '201';

  // Print sync
  document.getElementById('print-match-num').textContent = activeRound.matchNumber || "01";
  document.getElementById('print-room-num').textContent = activeRound.room || '201';
  const superBadge = document.getElementById('super-header-badge');
  if (superBadge) superBadge.textContent = `MEET ${activeRound.meetNum || activeRound.roundNum} • M#${activeRound.matchNumber}`;

  // 3. Teams Scoreboard Strip
  document.getElementById('scoresheet-home-name').textContent = activeRound.teamA.name;
  document.getElementById('scoresheet-opp-name').textContent = activeRound.teamB.name;
  document.getElementById('scoresheet-home-total').textContent = activeRound.teamA.finalScore;
  document.getElementById('scoresheet-opp-total').textContent = activeRound.teamB.finalScore;

  document.getElementById('home-bonus-badge').textContent = `Regulation: ${activeRound.teamA.regulationScore} | Bonus: +${activeRound.teamA.bonusPoints} | Fouls: -${activeRound.teamA.foulPenalty}`;
  document.getElementById('opp-bonus-badge').textContent = `Regulation: ${activeRound.teamB.regulationScore} | Bonus: +${activeRound.teamB.bonusPoints} | Fouls: -${activeRound.teamB.foulPenalty}`;

  // 4. Quick Buzzer Box UI
  const nextQ = activeRound.questions.length + 1;
  document.getElementById('active-question-badge').textContent = `Question #${nextQ}`;
  document.getElementById('score-question-num').value = nextQ;
  document.getElementById('scorer-home-label').textContent = activeRound.teamA.name;
  document.getElementById('scorer-opp-label').textContent = activeRound.teamB.name;

  renderSeatsSelectionGrid(activeRound);

  // 5. Table Headers - Seats Names
  document.getElementById('table-head-team-a').textContent = activeRound.teamA.name;
  document.getElementById('table-head-team-b').textContent = activeRound.teamB.name;

  const seatsA = activeRound.seats.home;
  const seatsB = activeRound.seats.opponent;

  const renderThBadge = (s, name, stat) => {
    let badgeHtml = '';
    if (stat.isQuizzedOut) {
      badgeHtml = stat.errors === 0 
        ? `<span class="block text-[9px] font-black text-amber-700 bg-amber-100/90 rounded px-1 mt-0.5">⭐ QO(+20)</span>` 
        : `<span class="block text-[9px] font-black text-amber-800 bg-amber-100/80 rounded px-1 mt-0.5">🎉 QO(+0)</span>`;
    } else if (stat.isErroredOut) {
      badgeHtml = `<span class="block text-[9px] font-black text-rose-800 bg-rose-100 rounded px-1 mt-0.5 animate-pulse">❌ EO (3/3)</span>`;
    } else {
      const errStyle = stat.errors > 0 ? 'text-rose-600 font-black' : 'text-slate-400';
      badgeHtml = `<span class="block text-[10px] font-bold mt-0.5 text-slate-500"><span class="text-emerald-700 font-extrabold">${stat.correct}C</span> / <span class="${errStyle}">${stat.errors}E</span></span>`;
    }
    return `
      <div>
        <span class="text-[10px] text-slate-400 font-bold">#${s}</span> 
        <span class="font-extrabold">${escapeHtml(name)}</span>
        ${badgeHtml}
      </div>
    `;
  };

  for (let s = 1; s <= 5; s++) {
    const thA = document.getElementById(`th-seat-a-${s}`);
    const thB = document.getElementById(`th-seat-b-${s}`);
    const nameA = (seatsA && seatsA[s - 1] && seatsA[s - 1].trim()) || `Seat #${s}`;
    const nameB = (seatsB && seatsB[s - 1] && seatsB[s - 1].trim()) || `Seat #${s}`;

    const statA = activeRound.teamA.quizzers.find(q => q.seat === s || (q.name && q.name.trim().toLowerCase() === nameA.toLowerCase())) || { correct: 0, errors: 0, points: 0, isQuizzedOut: false, isErroredOut: false };
    const statB = activeRound.teamB.quizzers.find(q => q.seat === s || (q.name && q.name.trim().toLowerCase() === nameB.toLowerCase())) || { correct: 0, errors: 0, points: 0, isQuizzedOut: false, isErroredOut: false };

    if (thA) thA.innerHTML = renderThBadge(s, nameA, statA);
    if (thB) thB.innerHTML = renderThBadge(s, nameB, statB);
  }

  // 6. 20-Question Rows & Halftime
  renderScoresheetTableRows(activeRound);

  // 7. Bottom Summary
  renderScoresheetSummaryRows(activeRound);

  // 8. Individual Quizzers Live Performance & Lockout Tracker
  renderIndividualQuizzersStats(activeRound);
}

function renderSeatsSelectionGrid(activeRound) {
  const homeGrid = document.getElementById('home-seats-btn-grid');
  const oppGrid = document.getElementById('opp-seats-btn-grid');

  // Verify currently selected quizzer is still active/eligible
  let isCurrentEligible = false;
  if (state.scoreInput.quizzer || state.scoreInput.seatNum) {
    const list = state.scoreInput.team === 'teamA' ? activeRound.teamA.quizzers : activeRound.teamB.quizzers;
    const currentStat = list.find(q => 
      (q.seat === state.scoreInput.seatNum) || 
      (q.name && state.scoreInput.quizzer && q.name.trim().toLowerCase() === state.scoreInput.quizzer.trim().toLowerCase())
    );
    if (currentStat && !currentStat.isQuizzedOut && !currentStat.isErroredOut) {
      isCurrentEligible = true;
    }
  }

  // If not eligible, automatically select first active eligible quizzer
  if (!isCurrentEligible) {
    let found = false;
    for (let i = 0; i < 5; i++) {
      const name = (activeRound.seats.home && activeRound.seats.home[i]) || `Seat #${i + 1}`;
      const stat = activeRound.teamA.quizzers.find(q => q.seat === i + 1 || (q.name && q.name.toLowerCase() === name.toLowerCase()));
      if (stat && !stat.isQuizzedOut && !stat.isErroredOut) {
        state.scoreInput.team = 'teamA';
        state.scoreInput.seatNum = i + 1;
        state.scoreInput.quizzer = name;
        found = true;
        break;
      }
    }
    if (!found) {
      for (let i = 0; i < 5; i++) {
        const name = (activeRound.seats.opponent && activeRound.seats.opponent[i]) || `Seat #${i + 1}`;
        const stat = activeRound.teamB.quizzers.find(q => q.seat === i + 1 || (q.name && q.name.toLowerCase() === name.toLowerCase()));
        if (stat && !stat.isQuizzedOut && !stat.isErroredOut) {
          state.scoreInput.team = 'teamB';
          state.scoreInput.seatNum = i + 1;
          state.scoreInput.quizzer = name;
          break;
        }
      }
    }
  }

  // Team A seats (1 to 5 guaranteed)
  let homeHtml = '';
  for (let idx = 0; idx < 5; idx++) {
    const seatNum = idx + 1;
    const rawName = activeRound.seats.home && activeRound.seats.home[idx];
    const displayName = (rawName && rawName.trim()) ? rawName.trim() : `Seat #${seatNum}`;
    const stat = activeRound.teamA.quizzers.find(q => q.seat === seatNum || (q.name && q.name.trim().toLowerCase() === displayName.toLowerCase())) || { correct: 0, errors: 0, points: 0, isQuizzedOut: false, isErroredOut: false };
    const isSelected = state.scoreInput.team === 'teamA' && state.scoreInput.seatNum === seatNum;
    const isQO = stat.isQuizzedOut;
    const isEO = stat.isErroredOut;
    const isDisabled = isQO || isEO;

    let statusHtml = '';
    let extraWarning = '';

    if (isQO) {
      statusHtml = `<span class="text-amber-800 font-black">${stat.errors === 0 ? '⭐ PERFECT QO (+20)' : '🎉 QUIZ OUT (+0)'}</span>`;
    } else if (isEO) {
      statusHtml = `<span class="text-rose-700 font-black">❌ ERRORED OUT (3/3)</span>`;
    } else {
      const cStyle = isSelected ? 'text-emerald-100 font-black' : 'text-emerald-700 font-extrabold';
      const eStyle = stat.errors > 0 ? (isSelected ? 'text-rose-200 font-black underline' : 'text-rose-600 font-black') : (isSelected ? 'text-slate-200' : 'text-slate-500');
      statusHtml = `<span class="${cStyle}">${stat.correct}/5 C</span> • <span class="${eStyle}">${stat.errors}/3 E</span>`;

      if (stat.correct === 4 && stat.errors === 2) {
        extraWarning = '<div class="text-[9px] font-black text-amber-700 bg-amber-100/90 rounded px-1 mt-0.5 animate-pulse">⚠️ 1 to QO • 1 to EO</div>';
      } else if (stat.correct === 4) {
        extraWarning = '<div class="text-[9px] font-black text-amber-700 bg-amber-100/80 rounded px-1 mt-0.5">⚠️ 1 more to QO</div>';
      } else if (stat.errors === 2) {
        extraWarning = '<div class="text-[9px] font-black text-rose-700 bg-rose-100/80 rounded px-1 mt-0.5">⚠️ 1 error to EO</div>';
      }
    }

    homeHtml += `
      <button type="button" ${isDisabled ? 'disabled' : ''} onclick="selectSeat('teamA', ${seatNum}, '${escapeHtml(displayName)}')" class="p-2 rounded-xl text-center border transition-all ${
        isQO 
          ? 'bg-amber-50/70 border-amber-300 text-amber-900 opacity-80 cursor-not-allowed' 
          : isEO
            ? 'bg-rose-50/70 border-rose-300 text-rose-800 opacity-80 cursor-not-allowed line-through'
            : isSelected 
              ? 'bg-brand-600 border-brand-600 text-white shadow-md ring-2 ring-brand-400' 
              : 'bg-white border-slate-200 text-slate-800 hover:border-brand-400 hover:bg-brand-50/50'
      }">
        <div class="text-[10px] font-extrabold uppercase ${isSelected ? 'text-brand-200' : 'text-slate-400'}">#${seatNum}</div>
        <div class="font-extrabold text-xs truncate mt-0.5">${escapeHtml(displayName)}</div>
        <div class="text-[9px] font-bold mt-1">
          ${statusHtml}
        </div>
        ${extraWarning}
      </button>
    `;
  }
  homeGrid.innerHTML = homeHtml;

  // Team B seats (1 to 5 guaranteed)
  let oppHtml = '';
  for (let idx = 0; idx < 5; idx++) {
    const seatNum = idx + 1;
    const rawName = activeRound.seats.opponent && activeRound.seats.opponent[idx];
    const displayName = (rawName && rawName.trim()) ? rawName.trim() : `Seat #${seatNum}`;
    const stat = activeRound.teamB.quizzers.find(q => q.seat === seatNum || (q.name && q.name.trim().toLowerCase() === displayName.toLowerCase())) || { correct: 0, errors: 0, points: 0, isQuizzedOut: false, isErroredOut: false };
    const isSelected = state.scoreInput.team === 'teamB' && state.scoreInput.seatNum === seatNum;
    const isQO = stat.isQuizzedOut;
    const isEO = stat.isErroredOut;
    const isDisabled = isQO || isEO;

    let statusHtml = '';
    let extraWarning = '';

    if (isQO) {
      statusHtml = `<span class="text-amber-800 font-black">${stat.errors === 0 ? '⭐ PERFECT QO (+20)' : '🎉 QUIZ OUT (+0)'}</span>`;
    } else if (isEO) {
      statusHtml = `<span class="text-rose-700 font-black">❌ ERRORED OUT (3/3)</span>`;
    } else {
      const cStyle = isSelected ? 'text-emerald-100 font-black' : 'text-emerald-700 font-extrabold';
      const eStyle = stat.errors > 0 ? (isSelected ? 'text-rose-200 font-black underline' : 'text-rose-600 font-black') : (isSelected ? 'text-slate-200' : 'text-slate-500');
      statusHtml = `<span class="${cStyle}">${stat.correct}/5 C</span> • <span class="${eStyle}">${stat.errors}/3 E</span>`;

      if (stat.correct === 4 && stat.errors === 2) {
        extraWarning = '<div class="text-[9px] font-black text-amber-700 bg-amber-100/90 rounded px-1 mt-0.5 animate-pulse">⚠️ 1 to QO • 1 to EO</div>';
      } else if (stat.correct === 4) {
        extraWarning = '<div class="text-[9px] font-black text-amber-700 bg-amber-100/80 rounded px-1 mt-0.5">⚠️ 1 more to QO</div>';
      } else if (stat.errors === 2) {
        extraWarning = '<div class="text-[9px] font-black text-rose-700 bg-rose-100/80 rounded px-1 mt-0.5">⚠️ 1 error to EO</div>';
      }
    }

    oppHtml += `
      <button type="button" ${isDisabled ? 'disabled' : ''} onclick="selectSeat('teamB', ${seatNum}, '${escapeHtml(displayName)}')" class="p-2 rounded-xl text-center border transition-all ${
        isQO 
          ? 'bg-amber-50/70 border-amber-300 text-amber-900 opacity-80 cursor-not-allowed' 
          : isEO
            ? 'bg-rose-50/70 border-rose-300 text-rose-800 opacity-80 cursor-not-allowed line-through'
            : isSelected 
              ? 'bg-rose-600 border-rose-600 text-white shadow-md ring-2 ring-rose-400' 
              : 'bg-white border-slate-200 text-slate-800 hover:border-rose-400 hover:bg-rose-50/50'
      }">
        <div class="text-[10px] font-extrabold uppercase ${isSelected ? 'text-rose-200' : 'text-slate-400'}">#${seatNum}</div>
        <div class="font-extrabold text-xs truncate mt-0.5">${escapeHtml(displayName)}</div>
        <div class="text-[9px] font-bold mt-1">
          ${statusHtml}
        </div>
        ${extraWarning}
      </button>
    `;
  }
  oppGrid.innerHTML = oppHtml;
}

function selectSeat(team, seatNum, quizzerName) {
  state.scoreInput.team = team;
  state.scoreInput.seatNum = seatNum;
  state.scoreInput.quizzer = quizzerName;
  if (state.tbqData) renderSeatsSelectionGrid(state.tbqData.activeRound);
}

function selectPoints(pts) {
  state.scoreInput.pointValue = pts;
  [10, 20, 30].forEach(p => {
    const btn = document.getElementById(`btn-pts-${p}`);
    if (p === pts) {
      btn.className = 'pts-btn py-2 rounded-xl border-2 border-brand-500 bg-brand-50 font-black text-sm text-brand-900 shadow-xs';
    } else {
      btn.className = 'pts-btn py-2 rounded-xl border border-slate-200 font-black text-sm text-slate-700 hover:bg-slate-50';
    }
  });
}

function selectResult(isCorrect) {
  state.scoreInput.isCorrect = isCorrect;
  const btnCorrect = document.getElementById('btn-result-correct');
  const btnIncorrect = document.getElementById('btn-result-incorrect');
  const submitBtn = document.getElementById('score-submit-btn');

  if (isCorrect) {
    btnCorrect.className = 'result-btn py-3 rounded-xl border-2 border-emerald-500 bg-emerald-50 text-emerald-900 font-black text-sm flex items-center justify-center gap-1.5 shadow-xs';
    btnIncorrect.className = 'result-btn py-3 rounded-xl border border-slate-200 text-slate-700 font-black text-sm flex items-center justify-center gap-1.5 hover:bg-slate-50';
    if (submitBtn) {
      submitBtn.className = 'bg-brand-600 hover:bg-brand-700 active:scale-98 text-white font-black py-3 px-4 rounded-xl text-sm shadow-md shadow-brand-600/20 transition-all flex items-center justify-center gap-1.5';
      submitBtn.innerHTML = '<span>Record Correct (+Pts) ⚡</span>';
    }
  } else {
    btnCorrect.className = 'result-btn py-3 rounded-xl border border-slate-200 text-slate-700 font-black text-sm flex items-center justify-center gap-1.5 hover:bg-slate-50';
    btnIncorrect.className = 'result-btn py-3 rounded-xl border-2 border-rose-500 bg-rose-50 text-rose-900 font-black text-sm flex items-center justify-center gap-1.5 shadow-xs';
    if (submitBtn) {
      submitBtn.className = 'bg-rose-600 hover:bg-rose-700 active:scale-98 text-white font-black py-3 px-4 rounded-xl text-sm shadow-md shadow-rose-600/20 transition-all flex items-center justify-center gap-1.5';
      submitBtn.innerHTML = '<span>Record Error (Incorrect) ❌</span>';
    }
  }
}

function toggleQuickScorer() {
  const form = document.getElementById('quick-scorer-form');
  const btn = document.getElementById('quick-scorer-toggle-btn');
  const isHidden = form.classList.toggle('hidden');
  btn.textContent = isHidden ? 'Show Scorer ▾' : 'Hide Box ▴';
}

function renderScoresheetTableRows(activeRound) {
  const tbody = document.getElementById('scoresheet-tbody');
  if (!tbody) return;

  let html = '';

  activeRound.rows.forEach(row => {
    const qNum = row.questionNum;

    const formatCell = (val) => {
      if (!val) return '';
      return val.split(', ').map(item => {
        item = item.trim();
        if (item.startsWith('+')) {
          const isRebound = item.includes('*');
          return `<span class="inline-block px-1.5 py-0.5 rounded font-black font-mono-score text-[11px] ${isRebound ? 'bg-indigo-100 text-indigo-900 border border-indigo-300' : 'bg-emerald-100 text-emerald-900 border border-emerald-300'}">${escapeHtml(item)}</span>`;
        }
        if (item.startsWith('-')) {
          return `<span class="inline-block px-1.5 py-0.5 rounded font-black font-mono-score text-[11px] bg-rose-100 text-rose-900 border border-rose-300" title="Interrupted Error Penalty">${escapeHtml(item)}</span>`;
        }
        if (item === '0' || item === '0 (Err)' || item === 'Err' || item.includes('Err')) {
          return `<span class="inline-block px-1.5 py-0.5 rounded font-bold font-mono-score text-[10px] bg-rose-100 text-rose-800 border border-rose-200" title="Incorrect Answer (Error)">0 (Err)</span>`;
        }
        return escapeHtml(item);
      }).join(' ');
    };

    const isCurrentActiveQ = qNum === activeRound.questions.length + 1;
    const rowBg = isCurrentActiveQ
      ? 'bg-amber-50/70 border-l-4 border-amber-500'
      : (qNum % 2 === 0 ? 'bg-slate-50/60' : 'bg-white');

    html += `
      <tr class="${rowBg} hover:bg-brand-50/30 transition-colors">
        <td class="p-2 text-center font-mono-score font-black text-slate-800 border-r border-slate-200">${qNum}</td>
        <td class="p-2 text-center font-mono-score font-extrabold text-slate-600 border-r-2 border-slate-300">${row.pointValue}</td>

        <td class="p-2 text-center border-r border-slate-200">${formatCell(row.homeCells[0])}</td>
        <td class="p-2 text-center border-r border-slate-200">${formatCell(row.homeCells[1])}</td>
        <td class="p-2 text-center border-r border-slate-200">${formatCell(row.homeCells[2])}</td>
        <td class="p-2 text-center border-r border-slate-200">${formatCell(row.homeCells[3])}</td>
        <td class="p-2 text-center border-r border-slate-200">${formatCell(row.homeCells[4])}</td>

        <td class="p-2 text-center font-mono-score font-black text-brand-900 bg-brand-50/90 border-r-2 border-slate-400">
          ${row.hasAnswers || qNum <= activeRound.questions.length ? row.homeRunning : ''}
        </td>

        <td class="p-2 text-center border-r border-slate-200">${formatCell(row.oppCells[0])}</td>
        <td class="p-2 text-center border-r border-slate-200">${formatCell(row.oppCells[1])}</td>
        <td class="p-2 text-center border-r border-slate-200">${formatCell(row.oppCells[2])}</td>
        <td class="p-2 text-center border-r border-slate-200">${formatCell(row.oppCells[3])}</td>
        <td class="p-2 text-center border-r border-slate-200">${formatCell(row.oppCells[4])}</td>

        <td class="p-2 text-center font-mono-score font-black text-rose-900 bg-rose-50/90">
          ${row.hasAnswers || qNum <= activeRound.questions.length ? row.oppRunning : ''}
          ${row.note ? `<span class="block text-[9px] font-bold text-indigo-700 font-sans">(${escapeHtml(row.note)})</span>` : ''}
        </td>
      </tr>
    `;

    if (qNum === 17) {
      html += `
        <tr class="bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 text-slate-950 font-black text-center text-xs tracking-wider border-y-2 border-amber-600 shadow-inner">
          <td colspan="14" class="py-2.5 uppercase font-mono-score">
            ⏸️ [ HALFTIME / TIMEOUT ZONE ] ⏸️
          </td>
        </tr>
      `;
    }
  });

  tbody.innerHTML = html;
}

function renderScoresheetSummaryRows(activeRound) {
  const homeBonusesList = activeRound.teamA.bonuses.map(b => b.desc).join(', ') || 'None';
  const oppBonusesList = activeRound.teamB.bonuses.map(b => b.desc).join(', ') || 'None';

  document.getElementById('summary-home-bonuses').textContent = homeBonusesList;
  document.getElementById('summary-opp-bonuses').textContent = oppBonusesList;
  document.getElementById('summary-home-bonus-pts').textContent = activeRound.teamA.bonusPoints ? `+${activeRound.teamA.bonusPoints}` : '0';
  document.getElementById('summary-opp-bonus-pts').textContent = activeRound.teamB.bonusPoints ? `+${activeRound.teamB.bonusPoints}` : '0';

  const homeFoulsList = activeRound.teamA.fouls.map(f => `${f.reason}`).join(', ') || 'None';
  const oppFoulsList = activeRound.teamB.fouls.map(f => `${f.reason}`).join(', ') || 'None';

  document.getElementById('summary-home-fouls').textContent = homeFoulsList;
  document.getElementById('summary-opp-fouls').textContent = oppFoulsList;
  document.getElementById('summary-home-foul-pts').textContent = activeRound.teamA.foulPenalty ? `-${activeRound.teamA.foulPenalty}` : '0';
  document.getElementById('summary-opp-foul-pts').textContent = activeRound.teamB.foulPenalty ? `-${activeRound.teamB.foulPenalty}` : '0';

  document.getElementById('summary-home-final-pts').textContent = activeRound.teamA.finalScore;
  document.getElementById('summary-opp-final-pts').textContent = activeRound.teamB.finalScore;

  if (activeRound.winner === 'teamA') {
    document.getElementById('summary-home-final-label').innerHTML = `<span class="bg-amber-400 text-brand-950 font-black px-2 py-0.5 rounded text-xs">🏆 WINNER</span>`;
    document.getElementById('summary-opp-final-label').textContent = 'Official Score';
  } else if (activeRound.winner === 'teamB') {
    document.getElementById('summary-opp-final-label').innerHTML = `<span class="bg-rose-400 text-brand-950 font-black px-2 py-0.5 rounded text-xs">🏆 WINNER</span>`;
    document.getElementById('summary-home-final-label').textContent = 'Official Score';
  } else {
    document.getElementById('summary-home-final-label').textContent = 'Official Score';
    document.getElementById('summary-opp-final-label').textContent = 'Official Score';
  }

  // Timeouts
  const homeT1 = activeRound.timeouts.home.find(t => t.id === 1) || { used: false };
  const homeT2 = activeRound.timeouts.home.find(t => t.id === 2) || { used: false };
  const oppT1 = activeRound.timeouts.opponent.find(t => t.id === 1) || { used: false };
  const oppT2 = activeRound.timeouts.opponent.find(t => t.id === 2) || { used: false };

  document.getElementById('summary-home-timeouts').innerHTML = `
    <div class="flex items-center gap-4">
      <label class="inline-flex items-center gap-1.5 cursor-pointer">
        <input type="checkbox" ${homeT1.used ? 'checked' : ''} onchange="toggleTimeout('teamA', 1, this.checked)" class="w-4 h-4 text-brand-600 rounded">
        <span>T1 ${homeT1.used ? `(${homeT1.questionNum || 'Q'})` : ''}</span>
      </label>
      <label class="inline-flex items-center gap-1.5 cursor-pointer">
        <input type="checkbox" ${homeT2.used ? 'checked' : ''} onchange="toggleTimeout('teamA', 2, this.checked)" class="w-4 h-4 text-brand-600 rounded">
        <span>T2 ${homeT2.used ? `(${homeT2.questionNum || 'Q'})` : ''}</span>
      </label>
    </div>
  `;

  document.getElementById('summary-opp-timeouts').innerHTML = `
    <div class="flex items-center gap-4">
      <label class="inline-flex items-center gap-1.5 cursor-pointer">
        <input type="checkbox" ${oppT1.used ? 'checked' : ''} onchange="toggleTimeout('teamB', 1, this.checked)" class="w-4 h-4 text-rose-600 rounded">
        <span>T1 ${oppT1.used ? `(${oppT1.questionNum || 'Q'})` : ''}</span>
      </label>
      <label class="inline-flex items-center gap-1.5 cursor-pointer">
        <input type="checkbox" ${oppT2.used ? 'checked' : ''} onchange="toggleTimeout('teamB', 2, this.checked)" class="w-4 h-4 text-rose-600 rounded">
        <span>T2 ${oppT2.used ? `(${oppT2.questionNum || 'Q'})` : ''}</span>
      </label>
    </div>
  `;
}

// 8. Render Individual Quizzers Live Performance & Lockout Tracker
function renderIndividualQuizzersStats(activeRound) {
  const panelGrid = document.getElementById('individual-quizzers-grid');
  if (!panelGrid) return;

  const buildTeamQuizzersHtml = (teamObj, seatsArr, teamKey, borderColor, headerBg) => {
    let quizzersRowsHtml = '';
    for (let s = 1; s <= 5; s++) {
      const rawName = seatsArr && seatsArr[s - 1];
      const name = (rawName && rawName.trim()) ? rawName.trim() : `Seat #${s}`;
      const stat = (teamObj.quizzers || []).find(q => q.seat === s || (q.name && q.name.trim().toLowerCase() === name.toLowerCase())) || {
        seat: s,
        name,
        correct: 0,
        errors: 0,
        points: 0,
        isQuizzedOut: false,
        isErroredOut: false
      };

      const isQO = stat.isQuizzedOut;
      const isEO = stat.isErroredOut;

      let statusBadge = '';
      if (isQO) {
        statusBadge = stat.errors === 0 
          ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-100 text-amber-900 border border-amber-300">⭐ Perfect QO (+20)</span>`
          : `<span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-50 text-amber-800 border border-amber-200">🎉 Quiz Out (+0)</span>`;
      } else if (isEO) {
        statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-100 text-rose-800 border border-rose-300 animate-pulse">❌ Errored Out (3/3)</span>`;
      } else if (stat.errors === 2) {
        statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-50 text-rose-700 border border-rose-200">⚠️ 1 Error to Lockout</span>`;
      } else if (stat.correct === 4) {
        statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-50 text-amber-700 border border-amber-200">⚡ 1 to Quiz Out</span>`;
      } else {
        statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-100 text-slate-600">Active</span>`;
      }

      // Errors visual dots
      let errorDots = '';
      for (let e = 1; e <= 3; e++) {
        if (e <= stat.errors) {
          errorDots += `<span class="inline-block w-2.5 h-2.5 rounded-full bg-rose-600 mr-0.5" title="Error #${e}"></span>`;
        } else {
          errorDots += `<span class="inline-block w-2.5 h-2.5 rounded-full bg-slate-200 mr-0.5"></span>`;
        }
      }

      const rowBg = isEO 
        ? 'bg-rose-50/70 border-rose-200 text-rose-900 line-through opacity-85'
        : (isQO ? 'bg-amber-50/60 border-amber-200' : 'bg-white border-slate-200');

      quizzersRowsHtml += `
        <div class="p-2.5 rounded-xl border ${rowBg} flex items-center justify-between gap-2 transition-all">
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="w-6 h-6 rounded-lg bg-slate-100 font-black font-mono-score text-xs flex items-center justify-center text-slate-700 flex-shrink-0">
              #${s}
            </span>
            <div class="truncate">
              <span class="text-xs font-black text-slate-900 block truncate">${escapeHtml(name)}</span>
              <span class="text-[10px] text-slate-500 font-mono-score font-bold">${stat.points} pts</span>
            </div>
          </div>

          <div class="flex items-center gap-3 flex-shrink-0">
            <!-- Correct Count -->
            <div class="text-center">
              <span class="text-[11px] font-black font-mono-score text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                ${stat.correct}/5 C
              </span>
            </div>

            <!-- Incorrect Count (Errors) -->
            <div class="text-center flex flex-col items-center">
              <span class="text-[11px] font-black font-mono-score ${stat.errors > 0 ? 'text-rose-700 bg-rose-50 border border-rose-200' : 'text-slate-500 bg-slate-100'} px-2 py-0.5 rounded-md">
                ${stat.errors}/3 E
              </span>
              <div class="flex items-center mt-0.5">
                ${errorDots}
              </div>
            </div>

            <!-- Status Pill -->
            <div>
              ${statusBadge}
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="rounded-xl border ${borderColor} overflow-hidden bg-slate-50/50">
        <div class="${headerBg} p-3 border-b flex items-center justify-between">
          <div class="font-black text-xs uppercase tracking-wider flex items-center gap-2">
            <span>${escapeHtml(teamObj.name)}</span>
          </div>
          <span class="text-xs font-black font-mono-score px-2 py-0.5 rounded bg-white/80">
            Total: ${teamObj.finalScore} pts
          </span>
        </div>
        <div class="p-3 space-y-2">
          ${quizzersRowsHtml}
        </div>
      </div>
    `;
  };

  const htmlA = buildTeamQuizzersHtml(
    activeRound.teamA, 
    activeRound.seats.home, 
    'teamA', 
    'border-brand-200', 
    'bg-brand-50 border-brand-200 text-brand-950'
  );
  const htmlB = buildTeamQuizzersHtml(
    activeRound.teamB, 
    activeRound.seats.opponent, 
    'teamB', 
    'border-rose-200', 
    'bg-rose-50 border-rose-200 text-rose-950'
  );

  panelGrid.innerHTML = `${htmlA}${htmlB}`;
}

// Timeout toggle
async function toggleTimeout(team, timeoutId, used) {
  const currentQ = `Q${document.getElementById('score-question-num').value || '1'}`;
  try {
    const res = await authFetch('/api/tbq/timeout', {
      method: 'POST',
      body: JSON.stringify({
        matchId: state.activeMatchId,
        team,
        timeoutId,
        used,
        questionNum: currentQ
      })
    });
    const data = await res.json();
    if (res.ok) {
      state.tbqData.activeRound = data.activeRound;
      renderOfficialScoresheet();
    }
  } catch (err) {
    console.error('Error toggling timeout:', err);
  }
}

// Submit Question Score
async function submitQuestionScore(event) {
  event.preventDefault();

  if (!state.scoreInput.quizzer) {
    alert('Please tap which quizzer/seat answered the question.');
    return;
  }

  const answeredQuizzer = state.scoreInput.quizzer;
  const answeredSeat = state.scoreInput.seatNum;
  const isTeamA = state.scoreInput.team === 'teamA';
  const prevList = isTeamA ? (state.tbqData.activeRound.teamA.quizzers || []) : (state.tbqData.activeRound.teamB.quizzers || []);
  const prevStat = prevList.find(q => q.seat === answeredSeat || (q.name && q.name.trim().toLowerCase() === (answeredQuizzer || '').trim().toLowerCase())) || { correct: 0, errors: 0 };
  const prevCorrect = prevStat.correct || 0;
  const prevErrors = prevStat.errors || 0;

  const qNum = parseInt(document.getElementById('score-question-num').value) || 1;
  const isInterruption = document.getElementById('score-is-interruption').checked;
  const isRebound = document.getElementById('score-is-rebound').checked;

  try {
    const res = await authFetch('/api/tbq/score', {
      method: 'POST',
      body: JSON.stringify({
        matchId: state.activeMatchId,
        questionNum: qNum,
        pointValue: state.scoreInput.pointValue,
        isInterruption,
        isRebound,
        team: state.scoreInput.team,
        quizzer: answeredQuizzer,
        seatNum: answeredSeat,
        isCorrect: state.scoreInput.isCorrect
      })
    });

    const result = await res.json();
    if (!res.ok) {
      alert(result.error || 'Failed to record question score.');
      return;
    }

    document.getElementById('score-is-interruption').checked = false;
    document.getElementById('score-is-rebound').checked = false;
    selectPoints(20);
    selectResult(true);

    state.tbqData.activeRound = result.activeRound;

    // Check if quizzer reached Quiz Out or Error Out milestone on this answer
    const newList = isTeamA ? (result.activeRound.teamA.quizzers || []) : (result.activeRound.teamB.quizzers || []);
    const newStat = newList.find(q => q.seat === answeredSeat || (q.name && q.name.trim().toLowerCase() === (answeredQuizzer || '').trim().toLowerCase()));

    if (newStat) {
      if (prevCorrect < 5 && newStat.correct >= 5) {
        if (newStat.errors === 0) {
          showMatchToast(`⭐ ${newStat.name || answeredQuizzer} has QUIZZED OUT! Perfect 5/5 (+20 Bonus Points awarded)!`, 'success');
        } else {
          showMatchToast(`🎉 ${newStat.name || answeredQuizzer} has QUIZZED OUT (Forward)! 5 correct answers. Sits back with maximum score (no +20 bonus due to ${newStat.errors} prior errors).`, 'warning');
        }
      } else if (prevErrors < 3 && newStat.errors >= 3) {
        showMatchToast(`❌ ${newStat.name || answeredQuizzer} has ERRORED OUT (Strikes Out)! 3 errors reached. Must remain seated for remainder of match.`, 'error');
      }
    }

    renderOfficialScoresheet();

  } catch (err) {
    alert('Network error while recording question.');
  }
}

// Undo Last Question
async function undoLastQuestion() {
  if (!confirm('Undo the last question recorded in this match?')) return;

  try {
    const res = await authFetch('/api/tbq/undo', {
      method: 'POST',
      body: JSON.stringify({ matchId: state.activeMatchId })
    });
    const result = await res.json();
    if (!res.ok) {
      alert(result.error || 'Nothing to undo.');
      return;
    }
    state.tbqData.activeRound = result.activeRound;
    renderOfficialScoresheet();
  } catch (err) {
    alert('Error undoing question.');
  }
}

// Reset Match
async function coachResetRound() {
  if (!confirm('Are you sure you want to clear and reset all questions in this match?')) return;

  try {
    const res = await authFetch('/api/tbq/reset-round', {
      method: 'POST',
      body: JSON.stringify({ matchId: state.activeMatchId })
    });
    const result = await res.json();
    if (!res.ok) {
      alert(result.error || 'Failed to reset match.');
      return;
    }
    state.tbqData.activeRound = result.activeRound;
    renderOfficialScoresheet();
  } catch (err) {
    alert('Error resetting match.');
  }
}

// ==========================================
// 4. MATCH INFO & SEATING MODAL
// ==========================================

function openMatchInfoModal() {
  if (!state.tbqData || !state.tbqData.activeRound) return;
  const { activeRound } = state.tbqData;

  const infoMeet = document.getElementById('info-meet-num');
  if (infoMeet) infoMeet.value = activeRound.meetNum || activeRound.roundNum || 1;
  document.getElementById('info-match-num').value = activeRound.matchNumber || "01";
  document.getElementById('info-room-num').value = activeRound.room || '201';

  document.getElementById('modal-seats-home-label').textContent = `${activeRound.teamA.name} Seats #1 to #5:`;
  document.getElementById('modal-seats-opp-label').textContent = `${activeRound.teamB.name} Seats #1 to #5:`;

  const homeSeatsDiv = document.getElementById('modal-seats-home-inputs');
  const oppSeatsDiv = document.getElementById('modal-seats-opp-inputs');

  let homeInputs = '';
  for (let i = 0; i < 5; i++) {
    const val = activeRound.seats.home[i] || '';
    homeInputs += `
      <div>
        <label class="block text-[10px] text-slate-500 font-bold">#${i + 1}</label>
        <input type="text" id="seat-home-input-${i}" value="${escapeHtml(val)}" class="w-full px-2 py-1.5 text-xs border rounded-lg font-bold">
      </div>
    `;
  }
  homeSeatsDiv.innerHTML = homeInputs;

  let oppInputs = '';
  for (let i = 0; i < 5; i++) {
    const val = activeRound.seats.opponent[i] || '';
    oppInputs += `
      <div>
        <label class="block text-[10px] text-slate-500 font-bold">#${i + 1}</label>
        <input type="text" id="seat-opp-input-${i}" value="${escapeHtml(val)}" class="w-full px-2 py-1.5 text-xs border rounded-lg font-bold">
      </div>
    `;
  }
  oppSeatsDiv.innerHTML = oppInputs;

  document.getElementById('match-info-modal').classList.remove('hidden');
}

function closeMatchInfoModal() {
  document.getElementById('match-info-modal').classList.add('hidden');
}

async function handleSaveMatchInfo(event) {
  event.preventDefault();

  const infoMeet = document.getElementById('info-meet-num');
  const meetNum = parseInt(infoMeet ? infoMeet.value : 1) || 1;
  const matchNumber = document.getElementById('info-match-num').value.trim();
  const room = document.getElementById('info-room-num').value.trim();

  const seatsHome = [];
  const seatsOpp = [];

  for (let i = 0; i < 5; i++) {
    seatsHome.push(document.getElementById(`seat-home-input-${i}`).value.trim() || `Quizzer ${i + 1}`);
    seatsOpp.push(document.getElementById(`seat-opp-input-${i}`).value.trim() || `Opponent ${i + 1}`);
  }

  try {
    const res = await authFetch('/api/tbq/match-info', {
      method: 'POST',
      body: JSON.stringify({
        matchId: state.activeMatchId,
        meetNum,
        roundNum: meetNum,
        matchNumber,
        room,
        seatsHome,
        seatsOpp
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to save match info.');
      return;
    }

    closeMatchInfoModal();
    state.tbqData.activeRound = data.activeRound;
    renderOfficialScoresheet();
  } catch (err) {
    alert('Error saving match info.');
  }
}

// ==========================================
// 5. TEAM FOULS MODAL
// ==========================================

function openAddFoulModal() {
  document.getElementById('foul-reason-input').value = '';
  if (state.tbqData && state.tbqData.activeRound) {
    const optHome = document.getElementById('foul-team-home-opt');
    const optOpp = document.getElementById('foul-team-opp-opt');
    if (optHome) optHome.textContent = state.tbqData.activeRound.teamA.name;
    if (optOpp) optOpp.textContent = state.tbqData.activeRound.teamB.name;
  }
  document.getElementById('add-foul-modal').classList.remove('hidden');
}

function closeAddFoulModal() {
  document.getElementById('add-foul-modal').classList.add('hidden');
}

async function handleSaveFoul(event) {
  event.preventDefault();
  const team = document.getElementById('foul-team-select').value;
  const reason = document.getElementById('foul-reason-input').value.trim();
  const penalty = parseInt(document.getElementById('foul-penalty-select').value) || 5;

  try {
    const res = await authFetch('/api/tbq/foul', {
      method: 'POST',
      body: JSON.stringify({
        matchId: state.activeMatchId,
        team,
        action: 'add',
        reason,
        penalty
      })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to apply foul.');
      return;
    }
    closeAddFoulModal();
    state.tbqData.activeRound = data.activeRound;
    renderOfficialScoresheet();
  } catch (err) {
    alert('Error applying team foul.');
  }
}

// ==========================================
// 6. TEAMS & MATCHES MANAGER (TOMORROW'S SETUP)
// ==========================================

function renderTeamsManagerUI() {
  if (!state.tbqData) return;
  const { meet, matchesList } = state.tbqData;
  const teams = meet.teams || [];

  // 1. Render 4 Teams Cards
  const gridEl = document.getElementById('teams-cards-grid');
  let cardsHtml = '';

  teams.forEach((t, idx) => {
    const isCIC = t.name.toLowerCase().includes('chicago');
    cardsHtml += `
      <div class="bg-white rounded-2xl p-5 border ${isCIC ? 'border-brand-300 ring-2 ring-brand-100' : 'border-slate-200'} shadow-sm flex flex-col justify-between">
        <div>
          <div class="flex items-start justify-between gap-2 pb-2 border-b border-slate-100">
            <div>
              <span class="text-[10px] font-black uppercase tracking-wider ${isCIC ? 'text-brand-600 bg-brand-50 border border-brand-200' : 'text-slate-500 bg-slate-100'} px-2 py-0.5 rounded-full">
                Team #${idx + 1} ${isCIC ? '• Our Church' : ''}
              </span>
              <h4 class="text-base font-black text-slate-900 mt-1">${escapeHtml(t.name)}</h4>
              <div class="text-xs text-slate-500 font-medium">${escapeHtml(t.church)}</div>
            </div>
            <button onclick="openEditTeamModal('${t.id}')" class="text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold px-3 py-1.5 rounded-lg border border-slate-200 transition-colors">
              ✏️ Edit
            </button>
          </div>

          <div class="pt-3">
            <div class="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center justify-between">
              <span>Quizzers Roster (${(t.quizzers || []).length}):</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              ${(t.quizzers && t.quizzers.length > 0)
                ? t.quizzers.map((q, qIdx) => `<span class="bg-slate-100 text-slate-800 px-2 py-0.5 rounded-md text-xs font-semibold">#${qIdx + 1} ${escapeHtml(q)}</span>`).join('')
                : '<span class="text-xs text-slate-400 italic">No quizzers added yet. Tap Edit to enter.</span>'}
            </div>
          </div>
        </div>

        <div class="pt-4 border-t border-slate-100 mt-4 flex justify-between items-center text-xs">
          <span class="text-slate-400">Ready for scoring</span>
          <button onclick="openEditTeamModal('${t.id}')" class="text-brand-600 font-bold hover:underline">
            Update Roster ➔
          </button>
        </div>
      </div>
    `;
  });
  gridEl.innerHTML = cardsHtml;

  // 2. Render Matches Schedule List
  const matchesListEl = document.getElementById('matches-schedule-list');
  let mHtml = '';

  matchesList.forEach(m => {
    const isCurrent = m.id === state.activeMatchId;
    mHtml += `
      <div class="p-3.5 rounded-xl border ${isCurrent ? 'border-amber-400 bg-amber-50/40' : 'border-slate-200 bg-slate-50'} flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-slate-900 text-amber-400 flex items-center justify-center font-black font-mono-score text-xs">
            M#${m.matchNumber}
          </div>
          <div>
            <div class="text-xs font-extrabold text-slate-500 uppercase">
              Meet ${m.meetNum || m.roundNum} • Room ${m.room}
            </div>
            <div class="text-sm font-bold text-slate-800 mt-0.5">
              <span>${escapeHtml(m.teamAName)}</span>
              <span class="text-slate-400 font-normal"> vs </span>
              <span>${escapeHtml(m.teamBName)}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 self-end sm:self-center flex-wrap">
          <button onclick="openEditMatchModal('${m.id}')" class="text-xs bg-white hover:bg-slate-100 text-slate-700 font-bold px-3 py-1.5 rounded-lg border border-slate-300 shadow-xs transition-all flex items-center gap-1">
            ✏️ Edit Match
          </button>
          <button onclick="handleDeleteMatch('${m.id}', '${m.matchNumber}')" class="text-xs bg-white hover:bg-rose-50 text-rose-600 font-bold px-2.5 py-1.5 rounded-lg border border-rose-200 shadow-xs transition-all" title="Delete Match">
            🗑️
          </button>
          <button onclick="selectAndOpenMatch('${m.id}')" class="text-xs bg-brand-600 hover:bg-brand-700 text-white font-bold px-3 py-1.5 rounded-lg shadow-xs transition-all">
            📋 Score Match
          </button>
        </div>
      </div>
    `;
  });
  matchesListEl.innerHTML = mHtml || '<p class="text-xs text-slate-400 py-3 text-center">No matches configured. Tap "+ Add Meet / Match" above.</p>';
  checkStorageStatus();
}

function selectAndOpenMatch(matchId) {
  fetchTbqData(matchId);
  switchTab('scoresheet');
}

// EDIT TEAM MODAL
function openEditTeamModal(teamId) {
  const teams = (state.tbqData && state.tbqData.meet.teams) || [];
  const team = teams.find(t => t.id === teamId);

  document.getElementById('edit-team-id').value = team ? team.id : '';
  document.getElementById('edit-team-name').value = team ? team.name : '';
  document.getElementById('edit-team-church').value = team ? team.church : '';
  document.getElementById('edit-team-quizzers').value = team ? (team.quizzers || []).join(', ') : '';
  document.getElementById('modal-team-title').textContent = team ? `Edit ${team.name}` : '➕ Add New Team';

  document.getElementById('edit-team-modal').classList.remove('hidden');
}

function closeEditTeamModal() {
  document.getElementById('edit-team-modal').classList.add('hidden');
}

async function handleSaveTeam(event) {
  event.preventDefault();
  const teamId = document.getElementById('edit-team-id').value;
  const name = document.getElementById('edit-team-name').value.trim();
  const church = document.getElementById('edit-team-church').value.trim();
  const quizzersRaw = document.getElementById('edit-team-quizzers').value;

  try {
    const res = await authFetch('/api/teams/save', {
      method: 'POST',
      body: JSON.stringify({ teamId, name, church, quizzers: quizzersRaw })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to save team.');
      return;
    }
    closeEditTeamModal();
    await fetchTbqData(state.activeMatchId);
    renderTeamsManagerUI();
  } catch (err) {
    alert('Error saving team.');
  }
}

// ADD & EDIT MATCH MODAL
function openAddMatchModal() {
  const teams = (state.tbqData && state.tbqData.meet && state.tbqData.meet.teams) || [];
  const selectA = document.getElementById('match-team-a-select');
  const selectB = document.getElementById('match-team-b-select');

  let optsA = '';
  let optsB = '';
  teams.forEach((t, idx) => {
    optsA += `<option value="${t.id}" ${idx === 0 ? 'selected' : ''}>${escapeHtml(t.name)}</option>`;
    optsB += `<option value="${t.id}" ${idx === 1 ? 'selected' : ''}>${escapeHtml(t.name)}</option>`;
  });
  selectA.innerHTML = optsA;
  selectB.innerHTML = optsB;

  document.getElementById('match-edit-id').value = '';
  const badgeEl = document.getElementById('match-modal-badge');
  if (badgeEl) badgeEl.textContent = 'Tournament Schedule';
  const titleEl = document.getElementById('match-modal-title');
  if (titleEl) titleEl.textContent = '➕ Add Meet / Match';
  const submitBtn = document.getElementById('match-modal-submit-btn');
  if (submitBtn) submitBtn.textContent = 'Save Match';

  const nextNum = (state.tbqData && state.tbqData.matchesList ? state.tbqData.matchesList.length + 1 : 1);
  document.getElementById('match-number-input').value = `0${nextNum}`;
  const meetInput = document.getElementById('match-meet-num');
  if (meetInput) meetInput.value = Math.ceil(nextNum / 2) || 1;
  document.getElementById('match-room-input').value = '201';

  document.getElementById('add-match-modal').classList.remove('hidden');
}

function openEditMatchModal(matchId) {
  const matches = (state.tbqData && state.tbqData.matchesList) || [];
  const m = matches.find(item => item.id === matchId);
  if (!m) return;

  const teams = (state.tbqData && state.tbqData.meet && state.tbqData.meet.teams) || [];
  const selectA = document.getElementById('match-team-a-select');
  const selectB = document.getElementById('match-team-b-select');

  let optsA = '';
  let optsB = '';
  teams.forEach(t => {
    optsA += `<option value="${t.id}" ${t.id === m.teamAId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`;
    optsB += `<option value="${t.id}" ${t.id === m.teamBId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`;
  });
  selectA.innerHTML = optsA;
  selectB.innerHTML = optsB;

  document.getElementById('match-edit-id').value = m.id;
  const badgeEl = document.getElementById('match-modal-badge');
  if (badgeEl) badgeEl.textContent = 'Update Match Details';
  const titleEl = document.getElementById('match-modal-title');
  if (titleEl) titleEl.textContent = `✏️ Edit Meet ${m.meetNum || m.roundNum} • Match #${m.matchNumber}`;
  const submitBtn = document.getElementById('match-modal-submit-btn');
  if (submitBtn) submitBtn.textContent = 'Update Match';

  document.getElementById('match-meet-num').value = m.meetNum || m.roundNum || 1;
  document.getElementById('match-number-input').value = m.matchNumber || '';
  document.getElementById('match-room-input').value = m.room || '201';

  document.getElementById('add-match-modal').classList.remove('hidden');
}

function closeAddMatchModal() {
  document.getElementById('add-match-modal').classList.add('hidden');
}

async function handleSaveMatch(event) {
  event.preventDefault();
  const matchId = document.getElementById('match-edit-id').value;
  const meetInput = document.getElementById('match-meet-num');
  const meetNum = parseInt(meetInput ? meetInput.value : 1) || 1;
  const matchNumber = document.getElementById('match-number-input').value.trim();
  const room = document.getElementById('match-room-input').value.trim();
  const teamAId = document.getElementById('match-team-a-select').value;
  const teamBId = document.getElementById('match-team-b-select').value;

  if (teamAId === teamBId) {
    alert('Please select two different church teams for this match!');
    return;
  }

  const endpoint = matchId ? '/api/matches/update' : '/api/matches/add';
  const payload = {
    matchId,
    meetNum,
    roundNum: meetNum,
    matchNumber,
    room,
    teamAId,
    teamBId
  };

  try {
    const res = await authFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to save match.');
      return;
    }
    closeAddMatchModal();
    const targetMatchId = matchId || (data.match && data.match.id);
    await fetchTbqData(targetMatchId);
    renderTeamsManagerUI();
  } catch (err) {
    alert('Error saving match.');
  }
}

// Keep handleCreateMatch alias for backward compatibility
const handleCreateMatch = handleSaveMatch;

async function handleDeleteMatch(matchId, matchNumber) {
  if (!confirm(`Are you sure you want to delete Match #${matchNumber}? All recorded scores for this match will be permanently deleted.`)) {
    return;
  }

  try {
    const res = await authFetch('/api/matches/delete', {
      method: 'POST',
      body: JSON.stringify({ matchId })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to delete match.');
      return;
    }
    await fetchTbqData(data.activeMatchId);
    renderTeamsManagerUI();
  } catch (err) {
    alert('Error deleting match.');
  }
}

// ==========================================
// 7. SUPER COACH PANEL
// ==========================================

async function fetchCoachesList() {
  if (!state.auth || state.auth.user.role !== 'supercoach') return;

  try {
    const res = await authFetch('/api/coaches');
    if (!res.ok) return;
    const data = await res.json();
    renderCoachesTable(data.coaches);
  } catch (err) {
    console.error('Error fetching coaches:', err);
  }
}

function renderCoachesTable(coaches) {
  const tbody = document.getElementById('coaches-table-tbody');
  if (!tbody) return;

  let html = '';
  coaches.forEach(c => {
    const isSelf = c.id === state.auth.user.id;
    html += `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="py-3 font-bold text-slate-800">${escapeHtml(c.name)}</td>
        <td class="py-3 font-mono font-medium text-slate-600">${escapeHtml(c.username)}</td>
        <td class="py-3">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
            c.role === 'supercoach' ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-slate-100 text-slate-700'
          }">
            ${c.role === 'supercoach' ? 'Super Coach' : 'Coach'}
          </span>
        </td>
        <td class="py-3 font-mono text-slate-700">${escapeHtml(c.passcode)}</td>
        <td class="py-3 text-right">
          ${isSelf 
            ? `<span class="text-xs text-slate-400 italic">Current User</span>` 
            : `<button onclick="handleDeleteCoach('${c.id}', '${escapeHtml(c.name)}')" class="text-xs text-rose-600 hover:text-rose-800 font-bold hover:underline">Delete</button>`}
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
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to add coach.');
      return;
    }
    closeAddCoachModal();
    fetchCoachesList();
  } catch (err) {
    alert('Error adding coach.');
  }
}

async function handleDeleteCoach(coachId, name) {
  if (!confirm(`Are you sure you want to delete coach "${name}"?`)) return;

  try {
    const res = await authFetch('/api/coaches/delete', {
      method: 'POST',
      body: JSON.stringify({ coachId })
    });
    if (!res.ok) {
      alert('Failed to delete coach.');
      return;
    }
    fetchCoachesList();
  } catch (err) {
    alert('Error deleting coach.');
  }
}

// Utility: HTML Escaping
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================
// 8. STORAGE STATUS & BACKUP / RESTORE
// ==========================================

async function checkStorageStatus() {
  try {
    const res = await fetch('/api/system/status');
    if (!res.ok) return;
    const data = await res.json();
    const pill = document.getElementById('storage-type-pill');
    const badge = document.getElementById('db-status-badge');

    if (data.persistent) {
      if (pill) {
        pill.className = 'text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200';
        pill.innerHTML = '🟢 PostgreSQL Database (Permanent)';
      }
      if (badge) {
        badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 items-center gap-1 hidden sm:inline-flex';
        badge.innerHTML = '🟢 Cloud Database Active';
      }
    } else {
      if (pill) {
        pill.className = 'text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200';
        pill.innerHTML = '📁 Local Storage Mode';
      }
      if (badge) {
        badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300 items-center gap-1 hidden sm:inline-flex';
        badge.innerHTML = '📁 Local Storage';
      }
    }
  } catch (err) {
    console.warn('Storage status check error:', err);
  }
}

async function downloadScoresBackup() {
  try {
    const res = await authFetch('/api/tbq/backup');
    if (!res.ok) {
      alert('Failed to download backup.');
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tbq-tournament-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    alert('Error downloading backup file.');
  }
}

async function handleRestoreBackupFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (!confirm(`Are you sure you want to restore scores from "${file.name}"? This will replace current tournament scores.`)) {
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const backupData = JSON.parse(e.target.result);
      const res = await authFetch('/api/tbq/restore', {
        method: 'POST',
        body: JSON.stringify({ backupData })
      });
      const result = await res.json();
      if (!res.ok) {
        alert(result.error || 'Failed to restore backup.');
        return;
      }
      alert('Tournament scores restored successfully!');
      await fetchTbqData(result.activeMatchId);
      renderTeamsManagerUI();
      switchTab('scoresheet');
    } catch (err) {
      alert('Invalid JSON backup file: ' + err.message);
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

// Floating match notifications (Quiz Out / Error Out toasts)
function showMatchToast(message, type = 'info') {
  const container = document.getElementById('match-toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const bgClass = type === 'success' 
    ? 'bg-emerald-50 border-emerald-300 text-emerald-950 ring-1 ring-emerald-400' 
    : type === 'error'
      ? 'bg-rose-50 border-rose-300 text-rose-950 ring-1 ring-rose-400'
      : 'bg-amber-50 border-amber-300 text-amber-950 ring-1 ring-amber-400';

  const icon = type === 'success' ? '⭐' : type === 'error' ? '❌' : '🎉';

  toast.className = `p-3.5 rounded-xl border flex items-center justify-between gap-3 shadow-md transition-all ${bgClass}`;
  toast.innerHTML = `
    <div class="flex items-center gap-2.5">
      <span class="text-xl">${icon}</span>
      <span class="text-xs sm:text-sm font-extrabold">${escapeHtml(message)}</span>
    </div>
    <button onclick="this.parentElement.remove()" class="text-slate-400 hover:text-slate-700 text-xs font-black px-1.5 py-0.5 rounded">✕</button>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentElement) toast.remove();
  }, 7000);
}
