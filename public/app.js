/**
 * TBQ 4-Team Tournament & Match Platform Engine
 * Supports Chicago Indian Church (Teams 1 & 2) + 2 Opponents (Configurable on the fly)
 */

const state = {
  auth: null,
  currentTab: 'scoresheet',
  currentLeague: 'tbq', // 'tbq' | 'jbq'
  currentMeetId: 'tbq-meet-1',
  currentDivision: 'b_level', // 'b_level' | 'c_level'
  platformContext: null,
  publicData: null,
  tbqData: null,
  activeMatchId: null,
  mobileScorerTeam: 'teamA',
  scoresheetViewMode: (typeof window !== 'undefined' && window.innerWidth < 768) ? 'feed' : 'table',
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
  await fetchPlatformContext();

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

  // Seamless Auto-Login: Ensures coach scoresheet & kid tiles are immediately loaded without locking out the user
  try {
    const autoRes = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'supercoach', passcode: 'super2026' })
    });
    if (autoRes.ok) {
      const autoData = await autoRes.json();
      setLoggedInCoach(autoData.token, autoData.user);
      return;
    }
  } catch (err) {
    console.warn('Auto-login fallback error:', err);
  }

  // Fallback: Directly enter logged-in state so scoresheet is active
  setLoggedInCoach('auto-super-token', {
    id: 'coach-super',
    name: 'Super Coach',
    username: 'supercoach',
    role: 'supercoach'
  });
});

async function autoLoginSuperCoach() {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'supercoach', passcode: 'super2026' })
    });
    if (res.ok) {
      const data = await res.json();
      setLoggedInCoach(data.token, data.user);
      return;
    }
  } catch (e) {}
  setLoggedInCoach('auto-super-token', {
    id: 'coach-super',
    name: 'Super Coach',
    username: 'supercoach',
    role: 'supercoach'
  });
}

function setLoggedInCoach(token, user) {
  state.auth = { token, user };
  localStorage.setItem('tbq_coach_token', token);

  document.getElementById('auth-login-btn').classList.add('hidden');
  document.getElementById('auth-user-menu').classList.remove('hidden');
  document.getElementById('coach-nav-tabs').classList.remove('hidden');

  // Mobile bottom navigation bar
  const mobNav = document.getElementById('mobile-bottom-nav');
  if (mobNav) mobNav.classList.remove('hidden');

  const nameEl = document.getElementById('auth-user-name');
  if (nameEl) nameEl.textContent = user.name || user.username;

  const roleBadge = document.getElementById('user-role-badge');
  roleBadge.classList.remove('hidden');
  if (user.role === 'supercoach') {
    roleBadge.className = 'text-[10px] font-black px-2 py-0.5 rounded-full border bg-amber-400 text-brand-950 border-amber-300';
    roleBadge.textContent = '👑 Super Coach';
  } else if (user.role === 'jbq_coach') {
    roleBadge.className = 'text-[10px] font-black px-2 py-0.5 rounded-full border bg-purple-500/20 text-purple-200 border-purple-400/30';
    roleBadge.textContent = '🎒 JBQ Coach';
    state.currentLeague = 'jbq';
  } else {
    roleBadge.className = 'text-[10px] font-black px-2 py-0.5 rounded-full border bg-emerald-500/20 text-emerald-200 border-emerald-400/30';
    roleBadge.textContent = '📖 TBQ Coach';
    state.currentLeague = 'tbq';
  }

  const coachesTabBtn = document.getElementById('tab-btn-coaches');
  const mobCoachesBtn = document.getElementById('mob-tab-btn-coaches');
  if (user.role === 'supercoach') {
    coachesTabBtn.classList.remove('hidden');
    if (mobCoachesBtn) mobCoachesBtn.classList.remove('hidden');
  } else {
    coachesTabBtn.classList.add('hidden');
    if (mobCoachesBtn) mobCoachesBtn.classList.add('hidden');
  }

  renderPlatformHeader();
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

  const mobNav = document.getElementById('mobile-bottom-nav');
  if (mobNav) mobNav.classList.add('hidden');

  document.getElementById('section-scoresheet').classList.add('hidden');
  document.getElementById('section-teams').classList.add('hidden');
  document.getElementById('section-coaches').classList.add('hidden');
  document.getElementById('section-public').classList.remove('hidden');

  renderPlatformHeader();
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
  headers['x-quiz-league'] = state.currentLeague;
  headers['x-quiz-meet'] = state.currentMeetId;
  if (state.currentLeague === 'jbq') {
    headers['x-quiz-division'] = state.currentDivision;
  }
  if (!headers['Content-Type'] && options.method && options.method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(url, { ...options, headers });
}

// Platform Navigation & Context Manager
async function fetchPlatformContext() {
  try {
    const res = await authFetch('/api/platform/context');
    if (!res.ok) return;
    const ctx = await res.json();
    state.platformContext = ctx;

    if (!state.currentLeague) state.currentLeague = ctx.activeLeague || 'tbq';
    const lData = ctx[state.currentLeague];
    if (lData) {
      if (!state.currentMeetId || !lData.meets.some(m => m.id === state.currentMeetId)) {
        state.currentMeetId = lData.activeMeetId || lData.meets[0]?.id || `${state.currentLeague}-meet-1`;
      }
      if (state.currentLeague === 'jbq') {
        state.currentDivision = lData.activeDivision || 'b_level';
      }
    }

    renderPlatformHeader();
  } catch (err) {
    console.warn('Failed to load platform context:', err);
  }
}

function getActiveDivisionKey() {
  if (state.currentLeague === 'jbq') {
    return state.currentDivision === 'c_level' ? 'jbq_c' : 'jbq_b';
  }
  return 'tbq';
}

function getDivisionDisplayName(key) {
  if (key === 'jbq_c' || key === 'c_level') return '🌟 JBQ C-Level (Beginner)';
  if (key === 'jbq_b' || key === 'b_level') return '⚡ JBQ B-Level (Intermediate)';
  return '📖 TBQ (Teen Bible Quiz)';
}

function getDivisionBadgeHtml(key) {
  if (key === 'jbq_c' || key === 'c_level') {
    return '<span class="bg-blue-100 text-blue-900 border border-blue-300 font-extrabold px-2 py-0.5 rounded text-[10px] uppercase">🌟 JBQ C-Level</span>';
  }
  if (key === 'jbq_b' || key === 'b_level') {
    return '<span class="bg-purple-100 text-purple-900 border border-purple-300 font-extrabold px-2 py-0.5 rounded text-[10px] uppercase">⚡ JBQ B-Level</span>';
  }
  return '<span class="bg-amber-100 text-amber-900 border border-amber-300 font-extrabold px-2 py-0.5 rounded text-[10px] uppercase">📖 TBQ</span>';
}

async function fetchTeamsByDivision() {
  if (!state.auth) return;
  try {
    const res = await authFetch('/api/teams/by-division');
    if (res.ok) {
      state.allDivisionTeams = await res.json();
    }
  } catch (err) {
    console.warn('Failed to fetch teams by division:', err);
  }
}

async function setActiveDivisionKey(divKey) {
  if (divKey === 'tbq') {
    state.currentLeague = 'tbq';
    state.currentDivision = null;
  } else if (divKey === 'jbq_c' || divKey === 'c_level') {
    state.currentLeague = 'jbq';
    state.currentDivision = 'c_level';
  } else {
    state.currentLeague = 'jbq';
    state.currentDivision = 'b_level';
  }

  if (state.platformContext && state.platformContext[state.currentLeague]) {
    const lData = state.platformContext[state.currentLeague];
    state.currentMeetId = lData.activeMeetId || (lData.meets && lData.meets[0]?.id) || `${state.currentLeague}-meet-1`;
  } else {
    state.currentMeetId = `${state.currentLeague}-meet-1`;
  }

  renderPlatformHeader();

  // If on Teams tab, immediately update tabs styling and any cached data
  if (state.currentTab === 'teams') {
    renderTeamsManagerUI();
  }

  if (state.auth) {
    fetchTeamsByDivision();
    await fetchTbqData();
    if (state.currentTab === 'teams') {
      renderTeamsManagerUI();
    } else if (state.currentTab === 'scoresheet') {
      renderOfficialScoresheet();
    }
  } else {
    await fetchPublicSummary();
  }
}

function renderPlatformHeader() {
  const divKey = getActiveDivisionKey();
  const isJBQ = state.currentLeague === 'jbq';

  // 1. Brand Logo & Title
  const logoIcon = document.getElementById('brand-logo-icon');
  const leagueBadge = document.getElementById('brand-league-badge');
  const leagueTitle = document.getElementById('brand-league-title');
  const meetSubtitle = document.getElementById('brand-meet-subtitle');

  if (logoIcon) {
    logoIcon.textContent = divKey === 'jbq_c' ? '🌟' : (divKey === 'jbq_b' ? '⚡' : '📖');
  }
  if (leagueBadge) {
    leagueBadge.textContent = divKey === 'jbq_c' ? 'JBQ C-Level' : (divKey === 'jbq_b' ? 'JBQ B-Level' : 'TBQ Ministry');
  }
  if (leagueTitle) {
    leagueTitle.textContent = divKey === 'jbq_c' ? 'Junior Bible Quiz (C)' : (divKey === 'jbq_b' ? 'Junior Bible Quiz (B)' : 'Teen Bible Quiz');
  }

  // 2. 3-Division Header Navigation Switcher
  const btnTbq = document.getElementById('btn-nav-tbq');
  const btnJbqB = document.getElementById('btn-nav-jbq-b');
  const btnJbqC = document.getElementById('btn-nav-jbq-c');

  const activeBtnClass = 'px-2.5 sm:px-3 py-1 rounded-lg text-xs font-black transition-all bg-amber-400 text-brand-950 shadow-xs flex items-center gap-1';
  const inactiveBtnClass = 'px-2.5 sm:px-3 py-1 rounded-lg text-xs font-bold transition-all text-brand-200 hover:text-white flex items-center gap-1';

  if (btnTbq) btnTbq.className = divKey === 'tbq' ? activeBtnClass : inactiveBtnClass;
  if (btnJbqB) btnJbqB.className = divKey === 'jbq_b' ? activeBtnClass : inactiveBtnClass;
  if (btnJbqC) btnJbqC.className = divKey === 'jbq_c' ? activeBtnClass : inactiveBtnClass;

  // All 3 divisions are available for all coaches
  if (btnTbq) btnTbq.classList.remove('hidden');
  if (btnJbqB) btnJbqB.classList.remove('hidden');
  if (btnJbqC) btnJbqC.classList.remove('hidden');

  // Also support legacy buttons if present in DOM
  const legBtnTbq = document.getElementById('btn-league-tbq');
  const legBtnJbq = document.getElementById('btn-league-jbq');
  if (legBtnTbq && legBtnJbq) {
    legBtnTbq.className = !isJBQ ? activeBtnClass : inactiveBtnClass;
    legBtnJbq.className = isJBQ ? activeBtnClass : inactiveBtnClass;
  }

  // 3. Meet Dropdown
  const meetSelect = document.getElementById('global-meet-select');
  if (meetSelect && state.platformContext) {
    const lData = state.platformContext[state.currentLeague];
    if (lData && Array.isArray(lData.meets) && lData.meets.length > 0) {
      meetSelect.innerHTML = lData.meets.map(m => `
        <option value="${m.id}" ${m.id === state.currentMeetId ? 'selected' : ''}>
          ${escapeHtml(m.title)}
        </option>
      `).join('');

      const activeMeetObj = lData.meets.find(m => m.id === state.currentMeetId) || lData.meets[0];
      if (meetSubtitle && activeMeetObj) {
        meetSubtitle.textContent = activeMeetObj.title;
      }
    } else {
      meetSelect.innerHTML = '<option value="">(No meets created)</option>';
      if (meetSubtitle) meetSubtitle.textContent = 'No active meet';
    }
  }

  // 4. "+ Meet" button (Visible to all logged-in coaches)
  const createMeetBtn = document.getElementById('btn-create-meet-nav');
  if (createMeetBtn) {
    if (state.auth) {
      createMeetBtn.classList.remove('hidden');
    } else {
      createMeetBtn.classList.add('hidden');
    }
  }

  // Keep jbq-division-bar hidden if exists
  const jbqBar = document.getElementById('jbq-division-bar');
  if (jbqBar) {
    jbqBar.classList.add('hidden');
  }
}

function handleSwitchLeague(league) {
  if (league === 'jbq') {
    setActiveDivisionKey(state.currentDivision === 'c_level' ? 'jbq_c' : 'jbq_b');
  } else {
    setActiveDivisionKey('tbq');
  }
}

function handleMeetChange(meetId) {
  state.currentMeetId = meetId;
  renderPlatformHeader();
  if (state.auth) {
    fetchTbqData();
  } else {
    fetchPublicSummary();
  }
}

function handleDivisionSwitch(divKey) {
  setActiveDivisionKey(divKey === 'c_level' ? 'jbq_c' : 'jbq_b');
}

function openCreateMeetModal() {
  document.getElementById('new-meet-league').value = state.currentLeague;
  document.getElementById('new-meet-title').value = '';
  document.getElementById('create-meet-modal').classList.remove('hidden');
}

function closeCreateMeetModal() {
  document.getElementById('create-meet-modal').classList.add('hidden');
}

async function handleCreateMeet(event) {
  event.preventDefault();
  const league = document.getElementById('new-meet-league').value;
  const title = document.getElementById('new-meet-title').value.trim();
  const date = document.getElementById('new-meet-date').value;
  const copyRoster = document.getElementById('new-meet-copy-roster').checked;

  try {
    const res = await authFetch('/api/meets/create', {
      method: 'POST',
      body: JSON.stringify({
        league,
        title,
        date,
        copyRosterFromMeetId: copyRoster ? state.currentMeetId : null
      })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to create meet.');
      return;
    }
    closeCreateMeetModal();
    state.currentLeague = data.league;
    state.currentMeetId = data.meetId;
    await fetchPlatformContext();
    if (state.auth) {
      fetchTbqData();
    } else {
      fetchPublicSummary();
    }
  } catch (err) {
    alert('Network error while creating meet.');
  }
}

// Tab Switching
function switchTab(tab) {
  state.currentTab = tab;

  const isQuestions = tab === 'questions';
  document.getElementById('section-public').classList.toggle('hidden', !isQuestions);
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

  // Sync mobile bottom navigation
  const mobScoresheet = document.getElementById('mob-tab-btn-scoresheet');
  const mobTeams = document.getElementById('mob-tab-btn-teams');
  const mobCoaches = document.getElementById('mob-tab-btn-coaches');

  const mobActive = 'text-amber-400 font-black';
  const mobInactive = 'text-brand-300 font-bold hover:text-white';

  if (mobScoresheet) mobScoresheet.className = `flex flex-col items-center justify-center py-1 px-3 rounded-xl text-xs transition-all ${tab === 'scoresheet' ? mobActive : mobInactive}`;
  if (mobTeams) mobTeams.className = `flex flex-col items-center justify-center py-1 px-3 rounded-xl text-xs transition-all ${tab === 'teams' ? mobActive : mobInactive}`;
  if (mobCoaches) mobCoaches.className = `flex flex-col items-center justify-center py-1 px-3 rounded-xl text-xs transition-all ${tab === 'coaches' ? 'text-amber-400 font-black' : 'text-amber-200/70 font-bold'}`;

  if (tab === 'scoresheet') fetchTbqData(state.activeMatchId);
  if (tab === 'teams') {
    renderTeamsManagerUI();
    fetchTbqData();
    fetchTeamsByDivision();
  }
  if (tab === 'coaches') fetchCoachesList();
}

// ==========================================
// 2. PUBLIC VIEW (4-TEAM STANDINGS & RESULTS)
// ==========================================

async function fetchPublicSummary() {
  try {
    const query = new URLSearchParams({
      league: state.currentLeague,
      meetId: state.currentMeetId,
      division: state.currentDivision
    });
    const res = await fetch(`/api/tbq/public-summary?${query.toString()}`);
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

  // Sync public division switcher tabs
  const currentDiv = getActiveDivisionKey();
  const pubTbq = document.getElementById('pub-tab-tbq');
  const pubJbqB = document.getElementById('pub-tab-jbq-b');
  const pubJbqC = document.getElementById('pub-tab-jbq-c');

  const pubActive = 'px-3 py-1.5 rounded-xl text-xs font-black transition-all bg-amber-400 text-brand-950 shadow-xs flex items-center gap-1.5 whitespace-nowrap';
  const pubInactive = 'px-3 py-1.5 rounded-xl text-xs font-bold transition-all text-white/80 hover:text-white flex items-center gap-1.5 whitespace-nowrap';

  if (pubTbq) pubTbq.className = currentDiv === 'tbq' ? pubActive : pubInactive;
  if (pubJbqB) pubJbqB.className = currentDiv === 'jbq_b' ? pubActive : pubInactive;
  if (pubJbqC) pubJbqC.className = currentDiv === 'jbq_c' ? pubActive : pubInactive;

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
              Meet ${m.meetNum || m.roundNum}
            </div>
            <div class="text-sm sm:text-base font-bold text-slate-800 mt-0.5">
              <span>${escapeHtml(m.teamAName)}</span>
              <span class="text-slate-400 font-normal"> vs </span>
              <span>${escapeHtml(m.teamBName)}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto pt-2 sm:pt-0 border-t border-slate-200/50 sm:border-t-0">
          <div class="font-mono-score font-black text-base sm:text-lg text-slate-900">
            <span class="${m.teamAScore > m.teamBScore ? 'text-brand-700' : 'text-slate-700'}">${m.teamAScore}</span>
            <span class="text-slate-300 mx-1">-</span>
            <span class="${m.teamBScore > m.teamAScore ? 'text-rose-600' : 'text-slate-700'}">${m.teamBScore}</span>
          </div>
          <div>
            ${resultBadge}
          </div>
        </div>
      </div>
    `;
  });
  matchesListEl.innerHTML = matchesHtml || '<div class="text-slate-400 text-center py-4">No matches scheduled yet.</div>';
}



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
    if (state.currentTab === 'teams') {
      renderTeamsManagerUI();
    }
    renderOfficialScoresheet();
  } catch (err) {
    console.error('Error fetching TBQ scoresheet:', err);
  }
}

async function skipRebound(qNum) {
  try {
    const res = await authFetch('/api/tbq/skip-rebound', {
      method: 'POST',
      body: JSON.stringify({
        matchId: state.activeMatchId,
        questionNum: qNum
      })
    });
    const data = await res.json();
    if (res.ok) {
      state.tbqData.activeRound = data.activeRound;
      renderOfficialScoresheet();
      showMatchToast(`⏭️ Skipped rebound on Q#${qNum}. Next question active.`, 'info');
    }
  } catch (err) {
    console.error('Error skipping rebound:', err);
  }
}

function renderReboundBanner(activeRound, currentQ, reboundStatus) {
  let banner = document.getElementById('rebound-alert-banner');
  if (!banner) {
    const form = document.getElementById('quick-scorer-form');
    if (form) {
      banner = document.createElement('div');
      banner.id = 'rebound-alert-banner';
      form.insertBefore(banner, form.firstChild);
    }
  }
  if (!banner) return;

  if (reboundStatus && reboundStatus.isPending) {
    const oppTeamName = reboundStatus.team === 'teamA' ? activeRound.teamA.name : activeRound.teamB.name;
    const origTeamName = reboundStatus.originalTeam === 'teamA' ? activeRound.teamA.name : activeRound.teamB.name;
    banner.className = 'p-3 rounded-2xl bg-amber-50 border-2 border-amber-400 text-amber-950 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shadow-sm transition-all mb-2';
    banner.innerHTML = `
      <div class="flex items-center gap-2.5">
        <span class="text-2xl animate-pulse flex-shrink-0">⚡</span>
        <div class="text-xs">
          <div class="font-black text-amber-900 uppercase tracking-wide flex items-center gap-1.5">
            <span>Q#${currentQ} RE-READ REBOUND</span>
            <span class="bg-amber-200 text-amber-900 px-1.5 py-0.2 rounded text-[10px]">Opposite Team Turn</span>
          </div>
          <div class="text-slate-700 mt-0.5">
            <strong>${escapeHtml(reboundStatus.originalQuizzer || 'Quizzer')}</strong> (${escapeHtml(origTeamName)}) errored on interruption (-${reboundStatus.penalty} pts).
            <span class="font-bold text-brand-900 block sm:inline">Now scoring for ${escapeHtml(oppTeamName)}!</span>
          </div>
        </div>
      </div>
      <button type="button" onclick="skipRebound(${currentQ})" class="text-xs bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-bold px-3 py-2 rounded-xl shadow-2xs transition-all cursor-pointer whitespace-nowrap active:scale-95 text-center flex items-center justify-center gap-1">
        <span>⏭️ Skip Rebound (Go to Q#${currentQ + 1})</span>
      </button>
    `;
    banner.classList.remove('hidden');
  } else {
    banner.className = 'hidden';
    banner.innerHTML = '';
  }
}

function renderOfficialScoresheet() {
  const container = document.getElementById('section-scoresheet');
  if (!container) return;

  if (!state.tbqData || !state.tbqData.activeRound) {
    const pillsBar = document.getElementById('match-selector-pills');
    if (pillsBar) pillsBar.innerHTML = '<span class="text-xs text-slate-400 py-1">No matches scheduled in this division</span>';

    let emptyEl = document.getElementById('scoresheet-empty-state');
    if (!emptyEl) {
      emptyEl = document.createElement('div');
      emptyEl.id = 'scoresheet-empty-state';
      emptyEl.className = 'bg-white rounded-3xl p-8 sm:p-12 text-center border border-slate-200 shadow-sm max-w-xl mx-auto my-8 space-y-4';
      emptyEl.innerHTML = `
        <div class="text-4xl mb-2">📋</div>
        <h3 class="text-lg font-black text-slate-800">No Matches in this Division Yet</h3>
        <p class="text-xs text-slate-500 max-w-sm mx-auto">Create teams in the Teams & Matches screen first, then add Match #1 to start live scoring.</p>
        <div class="flex items-center justify-center gap-3 pt-2">
          <button type="button" onclick="switchTab('teams')" class="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs shadow-xs transition-all">
            👥 Configure Teams
          </button>
          <button type="button" onclick="openAddMatchModal()" class="px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-brand-950 font-black text-xs shadow-xs transition-all">
            ➕ Add First Match
          </button>
        </div>
      `;
      container.appendChild(emptyEl);
    }
    emptyEl.classList.remove('hidden');

    const headerCard = document.getElementById('official-match-header-card');
    if (headerCard) headerCard.classList.add('hidden');
    const studentTiles = document.getElementById('live-student-tiles-container');
    if (studentTiles) studentTiles.classList.add('hidden');
    const quickForm = document.getElementById('quick-scorer-form');
    if (quickForm) quickForm.classList.add('hidden');
    const tableWrap = document.getElementById('scoresheet-table-wrapper');
    if (tableWrap) tableWrap.classList.add('hidden');
    const mobileFeed = document.getElementById('scoresheet-feed-wrapper');
    if (mobileFeed) mobileFeed.classList.add('hidden');
    const indStats = document.getElementById('individual-quizzers-section');
    if (indStats) indStats.classList.add('hidden');
    return;
  }

  const emptyEl = document.getElementById('scoresheet-empty-state');
  if (emptyEl) emptyEl.classList.add('hidden');
  const headerCard = document.getElementById('official-match-header-card');
  if (headerCard) headerCard.classList.remove('hidden');
  const studentTiles = document.getElementById('live-student-tiles-container');
  if (studentTiles) studentTiles.classList.remove('hidden');
  const quickForm = document.getElementById('quick-scorer-form');
  if (quickForm) quickForm.classList.remove('hidden');
  const tableWrap = document.getElementById('scoresheet-table-wrapper');
  if (tableWrap) tableWrap.classList.remove('hidden');
  const mobileFeed = document.getElementById('scoresheet-feed-wrapper');
  if (mobileFeed) mobileFeed.classList.remove('hidden');
  const indStats = document.getElementById('individual-quizzers-section');
  if (indStats) indStats.classList.remove('hidden');

  const { matchesList, activeRound } = state.tbqData;

  // Defensive fallback data structures
  if (!activeRound.questions) activeRound.questions = [];
  if (!activeRound.seats) {
    activeRound.seats = {
      home: activeRound.teamA?.seats || [],
      opponent: activeRound.teamB?.seats || [],
      teamA: activeRound.teamA?.seats || [],
      teamB: activeRound.teamB?.seats || []
    };
  }
  if (!activeRound.timeouts) {
    activeRound.timeouts = {
      home: activeRound.teamA?.timeouts || [],
      opponent: activeRound.teamB?.timeouts || [],
      teamA: activeRound.teamA?.timeouts || [],
      teamB: activeRound.teamB?.timeouts || []
    };
  }
  if (!activeRound.teamA) activeRound.teamA = { name: 'Team A', finalScore: 0, quizzers: [] };
  if (!activeRound.teamB) activeRound.teamB = { name: 'Team B', finalScore: 0, quizzers: [] };

  // 1. Matches Selector Pills Bar
  const pillsBar = document.getElementById('match-selector-pills');
  let pillsHtml = '';
  (matchesList || []).forEach(m => {
    const isActive = m.id === state.activeMatchId;
    const isDone = m.isCompleted || m.status === 'Completed';
    const statusIcon = isDone ? '🏁' : '⚡';
    pillsHtml += `
      <button onclick="fetchTbqData('${m.id}')" class="px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
        isActive 
          ? 'bg-amber-400 text-slate-950 font-black shadow-md ring-2 ring-amber-300' 
          : (isDone ? 'bg-emerald-950/70 text-emerald-300 hover:text-white hover:bg-emerald-900 border border-emerald-500/30' : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700')
      }">
        <span>${statusIcon} M#${m.matchNumber} (Meet ${m.meetNum || m.roundNum})${isDone ? ' [Final]' : ''}</span>
      </button>
    `;
  });
  pillsBar.innerHTML = pillsHtml;

  // 2. Header Metadata
  const divMetaEl = document.getElementById('scoresheet-meta-division');
  if (divMetaEl) {
    const curDiv = getActiveDivisionKey();
    divMetaEl.textContent = curDiv === 'jbq_c' ? '🌟 JBQ C-Level' : (curDiv === 'jbq_b' ? '⚡ JBQ B-Level' : '📖 TBQ');
  }
  document.getElementById('meta-match-num').textContent = activeRound.matchNumber || "01";
  document.getElementById('print-match-num').textContent = activeRound.matchNumber || "01";
  const superBadge = document.getElementById('super-header-badge');
  if (superBadge) superBadge.textContent = `MEET ${activeRound.meetNum || activeRound.roundNum} • M#${activeRound.matchNumber}`;

  // 3. Teams Scoreboard Strip
  document.getElementById('scoresheet-home-name').textContent = activeRound.teamA.name;
  document.getElementById('scoresheet-opp-name').textContent = activeRound.teamB.name;
  document.getElementById('scoresheet-home-total').textContent = activeRound.teamA.finalScore || 0;
  document.getElementById('scoresheet-opp-total').textContent = activeRound.teamB.finalScore || 0;

  const regA = activeRound.teamA.regulationScore !== undefined ? activeRound.teamA.regulationScore : (activeRound.teamA.runningScore || 0);
  const regB = activeRound.teamB.regulationScore !== undefined ? activeRound.teamB.regulationScore : (activeRound.teamB.runningScore || 0);
  const foulA = activeRound.teamA.foulPenalty !== undefined ? activeRound.teamA.foulPenalty : (activeRound.teamA.foulPenaltyPoints || 0);
  const foulB = activeRound.teamB.foulPenalty !== undefined ? activeRound.teamB.foulPenalty : (activeRound.teamB.foulPenaltyPoints || 0);

  document.getElementById('home-bonus-badge').textContent = `Regulation: ${regA} | Bonus: +${activeRound.teamA.bonusPoints || 0} | Fouls: -${foulA}`;
  document.getElementById('opp-bonus-badge').textContent = `Regulation: ${regB} | Bonus: +${activeRound.teamB.bonusPoints || 0} | Fouls: -${foulB}`;

  // 4. Quick Buzzer Box UI / Match Completion
  const isMatchDone = !!activeRound.isCompleted;
  const reboundStatus = activeRound.reboundStatus || { isPending: false };
  const currentQ = activeRound.pendingQuestionNum || (activeRound.questions ? activeRound.questions.length + 1 : 1);
  const qNumInput = document.getElementById('score-question-num');
  if (qNumInput) qNumInput.value = currentQ;

  const activeQBadge = document.getElementById('active-question-badge');
  const activeQCat = document.getElementById('active-question-badge-category');
  const compPanel = document.getElementById('match-completed-panel');
  const finishBtn = document.getElementById('btn-header-finish-match');

  if (isMatchDone) {
    if (compPanel) compPanel.classList.remove('hidden');
    if (quickForm) quickForm.classList.add('hidden');
    if (activeQCat) {
      activeQCat.className = 'text-xs font-black uppercase tracking-wider bg-emerald-100 text-emerald-900 px-2.5 py-0.5 rounded-md border border-emerald-300';
      activeQCat.textContent = '🏁 Final';
    }
    if (activeQBadge) {
      activeQBadge.textContent = 'Match Completed (20 Questions)';
    }
    if (finishBtn) {
      finishBtn.className = 'flex-1 sm:flex-none text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg font-bold border border-slate-600 transition-colors flex items-center justify-center gap-1 cursor-pointer';
      finishBtn.innerHTML = '<span>↩️ Reopen Match</span>';
      finishBtn.onclick = reopenCurrentMatch;
    }
    renderMatchCompletedPanel(activeRound);
  } else {
    if (compPanel) compPanel.classList.add('hidden');
    if (quickForm) quickForm.classList.remove('hidden');
    if (activeQCat) {
      activeQCat.className = 'text-xs font-black uppercase tracking-wider bg-amber-100 text-amber-900 px-2.5 py-0.5 rounded-md border border-amber-300';
      activeQCat.textContent = '⚡ Scorer';
    }
    if (activeQBadge) {
      activeQBadge.textContent = reboundStatus.isPending 
        ? `Question #${currentQ} (Rebound Opportunity)` 
        : `Question #${currentQ} (of 20)`;
    }
    if (finishBtn) {
      finishBtn.className = 'flex-1 sm:flex-none text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg font-bold border border-emerald-500 transition-colors flex items-center justify-center gap-1 cursor-pointer';
      finishBtn.innerHTML = '<span>🏁 Finish Match</span>';
      finishBtn.onclick = finishCurrentMatch;
    }
  }

  document.getElementById('scorer-home-label').textContent = activeRound.teamA.name;
  document.getElementById('scorer-opp-label').textContent = activeRound.teamB.name;

  renderReboundBanner(activeRound, currentQ, reboundStatus);

  if (reboundStatus.isPending) {
    state.scoreInput.team = reboundStatus.team;
    state.scoreInput.isRebound = true;
    const rebCheck = document.getElementById('score-is-rebound');
    if (rebCheck) rebCheck.checked = true;
    selectPoints(reboundStatus.pointValue || 20);
  } else {
    state.scoreInput.isRebound = false;
    const rebCheck = document.getElementById('score-is-rebound');
    if (rebCheck) rebCheck.checked = false;
  }

  renderStudentsSelectionGrid(activeRound);
  updateSelectedStudentBadge();
  updateSubmitButtonLabel();

  // 5. Dynamic Table Headers - Student Names
  const thead = document.getElementById('scoresheet-thead');
  const studentsA = (activeRound.studentsA || activeRound.teamA?.students || activeRound.teamA?.seats || []).filter(s => s && !s.toLowerCase().startsWith('seat #'));
  const studentsB = (activeRound.studentsB || activeRound.teamB?.students || activeRound.teamB?.seats || []).filter(s => s && !s.toLowerCase().startsWith('seat #'));

  if (thead) {
    const renderThBadge = (name, stat) => {
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
          <span class="font-extrabold text-xs block truncate">${escapeHtml(name)}</span>
          <span class="text-[10px] text-slate-500 font-mono-score font-bold">${stat.points || 0} pts</span>
          ${badgeHtml}
        </div>
      `;
    };

    const thsA = studentsA.map(name => {
      const stat = (activeRound.teamA?.quizzers || []).find(q => q.name && q.name.trim().toLowerCase() === name.toLowerCase()) || { correct: 0, errors: 0, points: 0, isQuizzedOut: false, isErroredOut: false };
      return `<th class="p-2 text-center border-r border-slate-200 min-w-[75px]">${renderThBadge(name, stat)}</th>`;
    }).join('');

    const thsB = studentsB.map(name => {
      const stat = (activeRound.teamB?.quizzers || []).find(q => q.name && q.name.trim().toLowerCase() === name.toLowerCase()) || { correct: 0, errors: 0, points: 0, isQuizzedOut: false, isErroredOut: false };
      return `<th class="p-2 text-center border-r border-slate-200 min-w-[75px]">${renderThBadge(name, stat)}</th>`;
    }).join('');

    thead.innerHTML = `
      <tr class="bg-slate-900 text-white font-black text-center text-xs tracking-wider uppercase border-b border-slate-800">
        <th colspan="2" class="p-2.5 border-r border-slate-800 bg-slate-950 sticky-head-q" id="super-header-badge">MEET ${activeRound.meetNum || activeRound.roundNum} • M#${activeRound.matchNumber}</th>
        <th colspan="${studentsA.length + 1}" class="p-2.5 border-r border-slate-800 bg-brand-900/90 text-sm font-black tracking-tight" id="table-head-team-a">
          ${escapeHtml(activeRound.teamA.name)}
        </th>
        <th colspan="${studentsB.length + 1}" class="p-2.5 bg-rose-950/90 text-sm font-black tracking-tight" id="table-head-team-b">
          ${escapeHtml(activeRound.teamB.name)}
        </th>
      </tr>
      <tr class="bg-slate-100 text-slate-700 font-extrabold text-[11px] uppercase tracking-wider border-b-2 border-slate-300">
        <th class="p-2 text-center w-12 border-r border-slate-300 sticky-head-q bg-slate-100">Q #</th>
        <th class="p-2 text-center w-14 border-r-2 border-slate-400 sticky-head-pts bg-slate-100">PTS</th>
        ${thsA}
        <th class="p-2 text-center bg-brand-100/70 text-brand-900 font-black border-r-2 border-slate-400 w-20">TOTAL</th>
        ${thsB}
        <th class="p-2 text-center bg-rose-100/70 text-rose-900 font-black w-20">TOTAL</th>
      </tr>
    `;
  }

  // 6. 20-Question Rows & Halftime (Table View)
  renderScoresheetTableRows(activeRound);

  // 7. Mobile Question Feed View (Timeline View)
  renderScoresheetMobileFeed(activeRound);

  // 8. Mobile UI State Synchronization
  updateMobileScorerUI();
  setScoresheetViewMode(state.scoresheetViewMode);

  // 9. Bottom Summary
  renderScoresheetSummaryRows(activeRound);

  // 10. Individual Quizzers Live Performance & Lockout Tracker
  renderIndividualQuizzersStats(activeRound);
}

// Student Dropdown & Selection Management
function populateStudentDropdown(activeRound) {
  const select = document.getElementById('score-student-select');
  if (!select || !activeRound) return;

  const studentsA = (activeRound.studentsA || activeRound.teamA?.students || []).filter(s => s && !s.toLowerCase().startsWith('seat #'));
  const studentsB = (activeRound.studentsB || activeRound.teamB?.students || []).filter(s => s && !s.toLowerCase().startsWith('seat #'));
  const teamAName = activeRound.teamA?.name || 'Left Table';
  const teamBName = activeRound.teamB?.name || 'Right Table';

  let optionsHtml = `<option value="" disabled ${!state.scoreInput.quizzer ? 'selected' : ''}>-- Tap to Choose Answering Student --</option>`;

  // Left Table (Team A)
  optionsHtml += `<optgroup label="🔵 Left Table: ${escapeHtml(teamAName)}">`;
  studentsA.forEach(name => {
    const stat = (activeRound.teamA?.quizzers || []).find(q => q.name && q.name.trim().toLowerCase() === name.toLowerCase()) || { correct: 0, errors: 0, points: 0, isQuizzedOut: false, isErroredOut: false };
    const isSelected = state.scoreInput.team === 'teamA' && state.scoreInput.quizzer && state.scoreInput.quizzer.toLowerCase() === name.toLowerCase();
    let statusDesc = `${stat.correct}/5 C, ${stat.errors}/3 E • ${stat.points} pts`;
    if (stat.isQuizzedOut) statusDesc = stat.errors === 0 ? '⭐ QUIZZED OUT (+20)' : '🎉 QUIZZED OUT (+0)';
    if (stat.isErroredOut) statusDesc = '❌ ERRORED OUT (3/3)';
    const disabledAttr = (stat.isQuizzedOut || stat.isErroredOut) ? 'disabled' : '';
    optionsHtml += `<option value="teamA:${escapeHtml(name)}" ${disabledAttr} ${isSelected ? 'selected' : ''}>${escapeHtml(name)} (${statusDesc})</option>`;
  });
  optionsHtml += `</optgroup>`;

  // Right Table (Team B)
  optionsHtml += `<optgroup label="🔴 Right Table: ${escapeHtml(teamBName)}">`;
  studentsB.forEach(name => {
    const stat = (activeRound.teamB?.quizzers || []).find(q => q.name && q.name.trim().toLowerCase() === name.toLowerCase()) || { correct: 0, errors: 0, points: 0, isQuizzedOut: false, isErroredOut: false };
    const isSelected = state.scoreInput.team === 'teamB' && state.scoreInput.quizzer && state.scoreInput.quizzer.toLowerCase() === name.toLowerCase();
    let statusDesc = `${stat.correct}/5 C, ${stat.errors}/3 E • ${stat.points} pts`;
    if (stat.isQuizzedOut) statusDesc = stat.errors === 0 ? '⭐ QUIZZED OUT (+20)' : '🎉 QUIZZED OUT (+0)';
    if (stat.isErroredOut) statusDesc = '❌ ERRORED OUT (3/3)';
    const disabledAttr = (stat.isQuizzedOut || stat.isErroredOut) ? 'disabled' : '';
    optionsHtml += `<option value="teamB:${escapeHtml(name)}" ${disabledAttr} ${isSelected ? 'selected' : ''}>${escapeHtml(name)} (${statusDesc})</option>`;
  });
  optionsHtml += `</optgroup>`;

  select.innerHTML = optionsHtml;
}

function handleStudentDropdownChange(val) {
  if (!val) return;
  const parts = val.split(':');
  if (parts.length >= 2) {
    const team = parts[0];
    const quizzerName = parts.slice(1).join(':');
    selectStudent(team, quizzerName);
  }
}

function updateSelectedStudentBadge() {
  const pill = document.getElementById('selected-student-pill');
  if (!pill) return;
  if (!state.scoreInput.quizzer) {
    pill.className = 'text-xs font-black px-3 py-1 rounded-full bg-slate-300 text-slate-700 shadow-xs transition-all';
    pill.textContent = 'Tap a student below';
    return;
  }
  const isTeamA = state.scoreInput.team === 'teamA';
  const teamName = isTeamA ? (state.tbqData?.activeRound?.teamA?.name || 'Left Table') : (state.tbqData?.activeRound?.teamB?.name || 'Right Table');
  const quizzerStat = (isTeamA ? state.tbqData?.activeRound?.teamA?.quizzers : state.tbqData?.activeRound?.teamB?.quizzers)?.find(q => q.name && q.name.trim().toLowerCase() === state.scoreInput.quizzer.trim().toLowerCase());
  const ptsSuffix = quizzerStat ? ` • ${quizzerStat.points} pts` : '';
  pill.className = `text-xs font-black px-3 py-1 rounded-full shadow-xs transition-all ${isTeamA ? 'bg-brand-600 text-white' : 'bg-rose-600 text-white'}`;
  pill.innerHTML = `👤 ${escapeHtml(state.scoreInput.quizzer)} <span class="opacity-80">(${escapeHtml(teamName)}${ptsSuffix})</span>`;
}

function updateSubmitButtonLabel() {
  const quizzer = state.scoreInput.quizzer || 'Student';
  const pts = state.scoreInput.pointValue || 20;
  const isInterruption = document.getElementById('score-is-interruption')?.checked || false;
  const penaltyPts = Math.floor(pts / 2);

  // Update 1-tap direct score buttons
  const directCorrectBtn = document.getElementById('btn-direct-correct');
  if (directCorrectBtn) {
    directCorrectBtn.innerHTML = `<span>✅ Record Correct (+${pts} pts)</span>`;
  }

  const directIncorrectBtn = document.getElementById('btn-direct-incorrect');
  if (directIncorrectBtn) {
    if (isInterruption) {
      directIncorrectBtn.innerHTML = `<span>❌ Record Error (-${penaltyPts} pts) ⚡</span>`;
    } else {
      directIncorrectBtn.innerHTML = `<span>❌ Record Error (0 pts)</span>`;
    }
  }

  // Update legacy submit button if present
  const submitBtn = document.getElementById('score-submit-btn');
  if (submitBtn) {
    if (state.scoreInput.isCorrect) {
      submitBtn.className = 'col-span-2 sm:col-span-1 bg-brand-600 hover:bg-brand-700 active:scale-98 text-white font-black py-3 px-4 rounded-xl text-xs sm:text-sm shadow-md shadow-brand-600/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer';
      submitBtn.innerHTML = `<span>Record for ${escapeHtml(quizzer)} (+${pts} pts) ⚡</span>`;
    } else {
      submitBtn.className = 'col-span-2 sm:col-span-1 bg-rose-600 hover:bg-rose-700 active:scale-98 text-white font-black py-3 px-4 rounded-xl text-xs sm:text-sm shadow-md shadow-rose-600/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer';
      submitBtn.innerHTML = `<span>Record Error for ${escapeHtml(quizzer)} ❌</span>`;
    }
  }
}

function toggleInterruption(forceVal) {
  const checkbox = document.getElementById('score-is-interruption');
  let newVal = typeof forceVal === 'boolean' ? forceVal : (checkbox ? !checkbox.checked : true);
  if (checkbox) checkbox.checked = newVal;

  const btn = document.getElementById('btn-toggle-interruption');
  if (btn) {
    if (newVal) {
      btn.className = 'w-full py-2.5 px-4 rounded-xl border-2 border-amber-500 bg-amber-400 text-brand-950 font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-md cursor-pointer transition-all active:scale-95';
      btn.innerHTML = '<span>⚡ Interruption: YES</span>';
    } else {
      btn.className = 'w-full py-2.5 px-4 rounded-xl border-2 border-slate-200 bg-white text-slate-700 font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 hover:bg-slate-100 cursor-pointer transition-all active:scale-95 shadow-xs';
      btn.innerHTML = '<span class="text-slate-500">⚡ Interruption: NO</span>';
    }
  }
  updateSubmitButtonLabel();
}

async function recordAnswer(isCorrect) {
  if (state.tbqData?.activeRound?.isCompleted) {
    showMatchToast('🏁 This match is already completed (all 20 questions scored).', 'warning');
    return;
  }
  selectResult(isCorrect);
  const form = document.getElementById('quick-scorer-form');
  if (form) {
    await submitQuestionScore(new Event('submit'));
  }
}

function renderMatchCompletedPanel(activeRound) {
  const winnerTitleEl = document.getElementById('match-completed-winner-text');
  const scoreSummaryEl = document.getElementById('match-completed-score-summary');
  const recapAEl = document.getElementById('match-completed-team-a-recap');
  const recapBEl = document.getElementById('match-completed-team-b-recap');
  const nextMatchBtn = document.getElementById('btn-next-match');

  const nameA = activeRound.teamA?.name || 'Left Table';
  const nameB = activeRound.teamB?.name || 'Right Table';
  const scoreA = activeRound.teamA?.finalScore || 0;
  const scoreB = activeRound.teamB?.finalScore || 0;

  if (winnerTitleEl) {
    if (scoreA > scoreB) {
      winnerTitleEl.innerHTML = `🏆 <span class="text-brand-900">${escapeHtml(nameA)}</span> Wins!`;
    } else if (scoreB > scoreA) {
      winnerTitleEl.innerHTML = `🏆 <span class="text-rose-900">${escapeHtml(nameB)}</span> Wins!`;
    } else {
      winnerTitleEl.innerHTML = `🤝 Match Ended in a Tie!`;
    }
  }

  if (scoreSummaryEl) {
    scoreSummaryEl.textContent = `Final Score: ${nameA} ${scoreA} — ${scoreB} ${nameB}`;
  }

  const regA = activeRound.teamA?.regulationScore !== undefined ? activeRound.teamA?.regulationScore : (activeRound.teamA?.runningScore || 0);
  const bonusA = activeRound.teamA?.bonusPoints || 0;
  const foulA = activeRound.teamA?.foulPenalty !== undefined ? activeRound.teamA?.foulPenalty : (activeRound.teamA?.foulPenaltyPoints || 0);

  const regB = activeRound.teamB?.regulationScore !== undefined ? activeRound.teamB?.regulationScore : (activeRound.teamB?.runningScore || 0);
  const bonusB = activeRound.teamB?.bonusPoints || 0;
  const foulB = activeRound.teamB?.foulPenalty !== undefined ? activeRound.teamB?.foulPenalty : (activeRound.teamB?.foulPenaltyPoints || 0);

  if (recapAEl) {
    recapAEl.innerHTML = `
      <div class="font-black text-brand-900 text-xs truncate">🔵 ${escapeHtml(nameA)}: <strong class="text-sm font-mono-score">${scoreA} pts</strong></div>
      <div class="text-[10px] text-slate-500 mt-0.5">Reg: ${regA} | Bonus: +${bonusA} | Fouls: -${foulA}</div>
    `;
  }

  if (recapBEl) {
    recapBEl.innerHTML = `
      <div class="font-black text-rose-900 text-xs truncate">🔴 ${escapeHtml(nameB)}: <strong class="text-sm font-mono-score">${scoreB} pts</strong></div>
      <div class="text-[10px] text-slate-500 mt-0.5">Reg: ${regB} | Bonus: +${bonusB} | Fouls: -${foulB}</div>
    `;
  }

  // Next match button
  if (nextMatchBtn) {
    const matchesList = state.tbqData?.matchesList || [];
    const currentIndex = matchesList.findIndex(m => m.id === (activeRound.id || state.activeMatchId));
    if (currentIndex !== -1 && currentIndex + 1 < matchesList.length) {
      const nextM = matchesList[currentIndex + 1];
      nextMatchBtn.classList.remove('hidden');
      nextMatchBtn.innerHTML = `<span>⏭️ Next Match (M#${nextM.matchNumber})</span>`;
      nextMatchBtn.onclick = () => fetchTbqData(nextM.id);
    } else {
      nextMatchBtn.classList.add('hidden');
    }
  }
}

async function finishCurrentMatch() {
  if (!confirm('Mark this match as Completed? Final score and winner will be finalized.')) return;
  try {
    const res = await authFetch('/api/tbq/finish-match', {
      method: 'POST',
      body: JSON.stringify({ matchId: state.activeMatchId })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to finish match.');
      return;
    }
    state.tbqData.activeRound = data.activeRound;
    renderOfficialScoresheet();
    showMatchToast('🏁 Match marked as Completed (Official Final)!', 'success');
  } catch (err) {
    alert('Error finishing match: ' + err.message);
  }
}

async function reopenCurrentMatch() {
  if (!confirm('Reopen this match for further scoring or edits?')) return;
  try {
    const res = await authFetch('/api/tbq/reopen-match', {
      method: 'POST',
      body: JSON.stringify({ matchId: state.activeMatchId })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to reopen match.');
      return;
    }
    state.tbqData.activeRound = data.activeRound;
    renderOfficialScoresheet();
    showMatchToast('Match reopened for scoring.', 'info');
  } catch (err) {
    alert('Error reopening match: ' + err.message);
  }
}

function renderStudentsSelectionGrid(activeRound) {
  const homeGrid = document.getElementById('home-seats-btn-grid');
  const oppGrid = document.getElementById('opp-seats-btn-grid');
  if (!homeGrid || !oppGrid || !activeRound) return;

  const studentsA = (activeRound.studentsA || activeRound.teamA?.students || activeRound.teamA?.seats || []).filter(s => s && !s.toLowerCase().startsWith('seat #'));
  const studentsB = (activeRound.studentsB || activeRound.teamB?.students || activeRound.teamB?.seats || []).filter(s => s && !s.toLowerCase().startsWith('seat #'));

  // Helper to test eligibility
  const isEligible = (team, name) => {
    const list = team === 'teamA' ? activeRound.teamA?.quizzers : activeRound.teamB?.quizzers;
    const stat = (list || []).find(q => q.name && q.name.trim().toLowerCase() === name.trim().toLowerCase());
    return !stat || (!stat.isQuizzedOut && !stat.isErroredOut);
  };

  const reboundStatus = activeRound.reboundStatus || { isPending: false };
  const homeBox = document.getElementById('scorer-home-box');
  const oppBox = document.getElementById('scorer-opp-box');
  const homeLabel = document.getElementById('scorer-home-label');
  const oppLabel = document.getElementById('scorer-opp-label');

  if (reboundStatus.isPending) {
    const targetTeam = reboundStatus.team;
    state.scoreInput.team = targetTeam;
    const targetStudents = targetTeam === 'teamA' ? studentsA : studentsB;

    const isTargetValid = state.scoreInput.quizzer && 
      targetStudents.some(s => s.toLowerCase() === state.scoreInput.quizzer.toLowerCase()) &&
      isEligible(targetTeam, state.scoreInput.quizzer);

    if (!isTargetValid) {
      const eligibleStudent = targetStudents.find(name => isEligible(targetTeam, name));
      state.scoreInput.quizzer = eligibleStudent || targetStudents[0] || '';
    }

    if (homeBox && oppBox) {
      if (targetTeam === 'teamA') {
        homeBox.className = 'border-2 border-amber-400 ring-4 ring-amber-300 rounded-2xl p-3 bg-amber-50/70 shadow-md transition-all';
        oppBox.className = 'border-2 border-slate-200 rounded-2xl p-3 bg-slate-50/60 opacity-75 shadow-xs transition-all';
        if (homeLabel) homeLabel.innerHTML = `${escapeHtml(activeRound.teamA.name)} <span class="ml-1 text-[10px] bg-amber-300 text-amber-950 px-2 py-0.5 rounded-full font-black animate-pulse">⚡ REBOUND TURN</span>`;
        if (oppLabel) oppLabel.innerHTML = `${escapeHtml(activeRound.teamB.name)} <span class="ml-1 text-[10px] bg-rose-200 text-rose-900 px-1.5 py-0.5 rounded font-bold">❌ -${reboundStatus.penalty} Penalty</span>`;
      } else {
        oppBox.className = 'border-2 border-amber-400 ring-4 ring-amber-300 rounded-2xl p-3 bg-amber-50/70 shadow-md transition-all';
        homeBox.className = 'border-2 border-slate-200 rounded-2xl p-3 bg-slate-50/60 opacity-75 shadow-xs transition-all';
        if (oppLabel) oppLabel.innerHTML = `${escapeHtml(activeRound.teamB.name)} <span class="ml-1 text-[10px] bg-amber-300 text-amber-950 px-2 py-0.5 rounded-full font-black animate-pulse">⚡ REBOUND TURN</span>`;
        if (homeLabel) homeLabel.innerHTML = `${escapeHtml(activeRound.teamA.name)} <span class="ml-1 text-[10px] bg-rose-200 text-rose-900 px-1.5 py-0.5 rounded font-bold">❌ -${reboundStatus.penalty} Penalty</span>`;
      }
    }
  } else {
    // Normal non-rebound styling & selection
    if (homeBox && oppBox) {
      homeBox.className = 'border-2 border-brand-300 rounded-2xl p-3 bg-brand-50/50 shadow-xs transition-all';
      oppBox.className = 'border-2 border-rose-300 rounded-2xl p-3 bg-rose-50/50 shadow-xs transition-all';
      if (homeLabel) homeLabel.textContent = activeRound.teamA.name;
      if (oppLabel) oppLabel.textContent = activeRound.teamB.name;
    }

    const currentList = state.scoreInput.team === 'teamA' ? studentsA : studentsB;
    let isCurrentEligible = state.scoreInput.quizzer && 
      currentList.some(s => s.toLowerCase() === state.scoreInput.quizzer.toLowerCase()) && 
      isEligible(state.scoreInput.team, state.scoreInput.quizzer);

    if (!isCurrentEligible) {
      const firstA = studentsA.find(name => isEligible('teamA', name));
      if (firstA) {
        state.scoreInput.team = 'teamA';
        state.scoreInput.quizzer = firstA;
      } else {
        const firstB = studentsB.find(name => isEligible('teamB', name));
        if (firstB) {
          state.scoreInput.team = 'teamB';
          state.scoreInput.quizzer = firstB;
        }
      }
    }
  }

  const renderStudentTile = (team, name) => {
    const list = team === 'teamA' ? (activeRound.teamA?.quizzers || []) : (activeRound.teamB?.quizzers || []);
    const stat = list.find(q => q.name && q.name.trim().toLowerCase() === name.trim().toLowerCase()) || { correct: 0, errors: 0, points: 0, isQuizzedOut: false, isErroredOut: false };
    const isSelected = state.scoreInput.team === team && state.scoreInput.quizzer && state.scoreInput.quizzer.toLowerCase() === name.toLowerCase();
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
      statusHtml = `<span class="${cStyle}">✅ ${stat.correct}/5 C</span> • <span class="${eStyle}">❌ ${stat.errors}/3 E</span>`;

      if (stat.correct === 4 && stat.errors === 2) {
        extraWarning = '<div class="text-[9px] font-black text-amber-800 bg-amber-200 rounded px-1 mt-1 animate-pulse">⚠️ 1 to QO • 1 to EO</div>';
      } else if (stat.correct === 4) {
        extraWarning = '<div class="text-[9px] font-black text-amber-800 bg-amber-200 rounded px-1 mt-1">⚠️ 1 more to QO</div>';
      } else if (stat.errors === 2) {
        extraWarning = '<div class="text-[9px] font-black text-rose-800 bg-rose-200 rounded px-1 mt-1">⚠️ 1 error to EO</div>';
      }
    }

    const selectedStyle = team === 'teamA'
      ? 'bg-brand-600 border-brand-700 text-white shadow-md ring-2 ring-brand-400 scale-[1.02]'
      : 'bg-rose-600 border-rose-700 text-white shadow-md ring-2 ring-rose-400 scale-[1.02]';

    const unselectedStyle = team === 'teamA'
      ? 'bg-white border-brand-200 text-slate-800 hover:border-brand-500 hover:bg-brand-50/60 shadow-xs'
      : 'bg-white border-rose-200 text-slate-800 hover:border-rose-500 hover:bg-rose-50/60 shadow-xs';

    return `
      <button type="button" ${isDisabled ? 'disabled' : ''} onclick="selectStudent('${team}', '${escapeHtml(name)}')" class="p-2 sm:p-2.5 rounded-xl text-center border-2 transition-all flex flex-col justify-between items-stretch cursor-pointer active:scale-95 ${
        isQO 
          ? 'bg-amber-50/80 border-amber-300 text-amber-950 opacity-80 cursor-not-allowed' 
          : isEO
            ? 'bg-rose-50/80 border-rose-300 text-rose-950 opacity-80 cursor-not-allowed line-through'
            : isSelected 
              ? selectedStyle 
              : unselectedStyle
      }">
        <div class="flex items-center justify-between gap-1 mb-1">
          <span class="text-[10px] font-black uppercase px-1.5 py-0.5 rounded ${isSelected ? 'bg-white/25 text-white' : (team === 'teamA' ? 'bg-brand-100 text-brand-800' : 'bg-rose-100 text-rose-800')}">
            ${stat.points} pts
          </span>
          ${isSelected ? '<span class="text-[9px] font-black uppercase bg-white ' + (team === 'teamA' ? 'text-brand-700' : 'text-rose-700') + ' px-1 rounded shadow-xs">✓ SELECTED</span>' : ''}
          ${isQO ? '<span class="text-[9px] font-black bg-amber-200 text-amber-900 px-1 rounded">QO</span>' : ''}
          ${isEO ? '<span class="text-[9px] font-black bg-rose-200 text-rose-900 px-1 rounded">EO</span>' : ''}
        </div>
        <div class="font-black text-xs sm:text-sm truncate my-0.5 ${isSelected ? 'text-white' : 'text-slate-900'}">${escapeHtml(name)}</div>
        <div class="text-[10px] font-black mt-1 py-0.5 px-1 rounded ${isSelected ? 'bg-black/20 text-white' : 'bg-slate-100 text-slate-700'}">
          ${statusHtml}
        </div>
        ${extraWarning}
      </button>
    `;
  };

  homeGrid.innerHTML = studentsA.length > 0 
    ? studentsA.map(name => renderStudentTile('teamA', name)).join('')
    : `<div class="col-span-full p-3 text-center border-2 border-dashed border-brand-200 rounded-xl"><button type="button" onclick="promptAddStudent('teamA')" class="text-xs font-bold text-brand-700 hover:underline cursor-pointer">➕ Click here to add student</button></div>`;

  oppGrid.innerHTML = studentsB.length > 0
    ? studentsB.map(name => renderStudentTile('teamB', name)).join('')
    : `<div class="col-span-full p-3 text-center border-2 border-dashed border-rose-200 rounded-xl"><button type="button" onclick="promptAddStudent('teamB')" class="text-xs font-bold text-rose-700 hover:underline cursor-pointer">➕ Click here to add student</button></div>`;
}

const renderSeatsSelectionGrid = renderStudentsSelectionGrid;

function selectStudent(team, quizzerName) {
  state.scoreInput.team = team;
  state.scoreInput.quizzer = quizzerName;

  updateSelectedStudentBadge();
  updateSubmitButtonLabel();

  if (state.tbqData && state.tbqData.activeRound) {
    renderStudentsSelectionGrid(state.tbqData.activeRound);
  }
}

function selectSeat(team, seatNum, quizzerName) {
  selectStudent(team, quizzerName);
}

async function promptAddStudent(team) {
  const teamName = team === 'teamA' ? (state.tbqData?.activeRound?.teamA?.name || 'Left Table') : (state.tbqData?.activeRound?.teamB?.name || 'Right Table');
  const name = prompt(`Enter new student's name for ${teamName}:`);
  if (!name || !name.trim()) return;

  const cleanName = name.trim();
  const activeRound = state.tbqData?.activeRound;
  if (!activeRound) return;

  const targetList = team === 'teamA' ? (activeRound.studentsA || []) : (activeRound.studentsB || []);
  if (targetList.some(s => s.toLowerCase() === cleanName.toLowerCase())) {
    alert(`${cleanName} is already on this team.`);
    selectStudent(team, cleanName);
    return;
  }

  targetList.push(cleanName);
  selectStudent(team, cleanName);

  try {
    const res = await authFetch('/api/tbq/match-info', {
      method: 'POST',
      body: JSON.stringify({
        matchId: state.activeMatchId,
        studentsA: activeRound.studentsA,
        studentsB: activeRound.studentsB
      })
    });
    const data = await res.json();
    if (res.ok && data.activeRound) {
      state.tbqData.activeRound = data.activeRound;
      renderOfficialScoresheet();
      showMatchToast(`👤 Added ${cleanName} to ${teamName}`, 'success');
    }
  } catch (e) {
    renderOfficialScoresheet();
  }
}

function selectPoints(pts) {
  state.scoreInput.pointValue = pts;
  [10, 20, 30].forEach(p => {
    const btn = document.getElementById(`btn-pts-${p}`);
    if (btn) {
      if (p === pts) {
        btn.className = 'pts-btn py-2.5 rounded-xl border-2 border-brand-500 bg-brand-50 font-black text-xs sm:text-sm text-brand-900 ring-2 ring-brand-300 shadow-xs cursor-pointer transition-all';
      } else {
        btn.className = 'pts-btn py-2.5 rounded-xl border border-slate-300 bg-white font-black text-xs sm:text-sm text-slate-700 hover:bg-slate-100 cursor-pointer transition-all';
      }
    }
  });
  updateSubmitButtonLabel();
}

function selectResult(isCorrect) {
  state.scoreInput.isCorrect = isCorrect;
  const btnCorrect = document.getElementById('btn-result-correct');
  const btnIncorrect = document.getElementById('btn-result-incorrect');

  if (btnCorrect && btnIncorrect) {
    if (isCorrect) {
      btnCorrect.className = 'result-btn py-3 rounded-xl border-2 border-emerald-500 bg-emerald-50 text-emerald-900 font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-xs cursor-pointer';
      btnIncorrect.className = 'result-btn py-3 rounded-xl border border-slate-200 text-slate-700 font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 hover:bg-slate-50 cursor-pointer';
    } else {
      btnCorrect.className = 'result-btn py-3 rounded-xl border border-slate-200 text-slate-700 font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 hover:bg-slate-50 cursor-pointer';
      btnIncorrect.className = 'result-btn py-3 rounded-xl border-2 border-rose-500 bg-rose-50 text-rose-900 font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-xs cursor-pointer';
    }
  }
  updateSubmitButtonLabel();
}

// Quick score directly from Scoresheet Table or Mobile Card
function quickScoreFromTable(qNum, team, studentOrSeat, optName) {
  if (state.tbqData?.activeRound?.isCompleted) {
    showMatchToast('🏁 This match is already completed (all 20 questions scored).', 'warning');
    return;
  }
  const quizzerName = optName || (typeof studentOrSeat === 'string' ? studentOrSeat : '');
  const input = document.getElementById('score-question-num');
  if (input) input.value = qNum;

  const badge = document.getElementById('active-question-badge');
  if (badge) badge.textContent = `Question #${qNum}`;

  const activeRound = state.tbqData?.activeRound;
  if (activeRound) {
    const row = (activeRound.rows || []).find(r => r.questionNum === qNum);
    const pts = row ? row.pointValue : (qNum <= 10 ? 10 : (qNum <= 17 ? 20 : 30));
    selectPoints(pts);

    // If this question already had answers recorded, look for this quizzer's answer or latest answer
    const existingQs = (activeRound.questions || []).filter(q => q.questionNum === qNum);
    const quizzerQ = existingQs.find(q => (q.quizzer && quizzerName && q.quizzer.toLowerCase() === quizzerName.toLowerCase()));
    const targetQ = quizzerQ || (existingQs.length > 0 ? existingQs[existingQs.length - 1] : null);

    if (activeRound.reboundStatus?.isPending && activeRound.pendingQuestionNum === qNum) {
      const rebCheck = document.getElementById('score-is-rebound');
      if (rebCheck) rebCheck.checked = true;
      state.scoreInput.isRebound = true;
      selectPoints(activeRound.reboundStatus.pointValue || pts);
      selectResult(true);
      toggleInterruption(false);
    } else if (targetQ) {
      selectResult(targetQ.isCorrect);
      toggleInterruption(!!targetQ.isInterruption);
      const rebCheck = document.getElementById('score-is-rebound');
      if (rebCheck) rebCheck.checked = !!targetQ.isRebound;
    } else {
      selectResult(true);
      toggleInterruption(false);
      const rebCheck = document.getElementById('score-is-rebound');
      if (rebCheck) rebCheck.checked = false;
    }
  }

  if (quizzerName) {
    selectStudent(team, quizzerName);
  }

  const teamName = team === 'teamA' ? (activeRound?.teamA?.name || 'Left Table') : (activeRound?.teamB?.name || 'Right Table');
  showMatchToast(`🎯 Selected Q#${qNum} for ${quizzerName || 'Student'} (${teamName})`, 'info');

  const form = document.getElementById('quick-scorer-form');
  if (form) {
    form.classList.remove('hidden');
    const toggleBtn = document.getElementById('quick-scorer-toggle-btn');
    if (toggleBtn) toggleBtn.textContent = 'Hide Box ▴';
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// Mobile Scorer UI helper - ensure both tables remain visible
function setMobileScorerTeam(team) {
  state.mobileScorerTeam = team;
  updateMobileScorerUI();
}

function toggleMobileBothTeams() {
  state.mobileScorerTeam = 'both';
  updateMobileScorerUI();
}

function updateMobileScorerUI() {
  const homeBox = document.getElementById('scorer-home-box');
  const oppBox = document.getElementById('scorer-opp-box');
  if (homeBox) homeBox.classList.remove('hidden');
  if (oppBox) oppBox.classList.remove('hidden');
}

// Scoresheet View Mode: Feed vs 14-Col Table
function setScoresheetViewMode(mode) {
  state.scoresheetViewMode = mode;
  const feedEl = document.getElementById('scoresheet-mobile-feed');
  const tableEl = document.getElementById('scoresheet-table-container');
  const btnFeed = document.getElementById('view-mode-btn-feed');
  const btnTable = document.getElementById('view-mode-btn-table');
  const hintEl = document.getElementById('scoresheet-view-hint');

  const activeBtn = 'px-2.5 py-1 rounded-md text-xs font-black transition-all bg-brand-600 text-white shadow-xs flex items-center gap-1 cursor-pointer';
  const inactiveBtn = 'px-2.5 py-1 rounded-md text-xs font-bold transition-all text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer';

  if (mode === 'table') {
    if (feedEl) feedEl.classList.add('hidden');
    if (tableEl) {
      tableEl.classList.remove('hidden', 'md:block');
      tableEl.classList.add('block');
    }
    if (btnFeed) btnFeed.className = inactiveBtn;
    if (btnTable) btnTable.className = activeBtn;
    if (hintEl) hintEl.innerHTML = '<span class="inline-block sm:hidden">👈 Swipe table sideways to see all students 👉</span><span class="hidden sm:inline">💡 Sticky Q# & PTS columns stay pinned when scrolling</span>';
  } else {
    if (feedEl) feedEl.classList.remove('hidden');
    if (tableEl) {
      tableEl.classList.remove('block');
      tableEl.classList.add('hidden', 'md:block');
    }
    if (btnFeed) btnFeed.className = activeBtn;
    if (btnTable) btnTable.className = inactiveBtn;
    if (hintEl) hintEl.innerHTML = '<span class="inline-block sm:hidden">💡 Tap any question card to jump or score</span><span class="hidden sm:inline">💡 Tap any question card to jump or score</span>';
  }
}

// Jump to Question from mobile feed
function jumpToQuestion(qNum) {
  if (state.tbqData?.activeRound?.isCompleted) {
    showMatchToast('🏁 This match is already completed (all 20 questions scored).', 'warning');
    return;
  }
  const input = document.getElementById('score-question-num');
  if (input) {
    input.value = qNum;
  }
  const activeRound = state.tbqData?.activeRound;
  if (activeRound) {
    if (activeRound.reboundStatus?.isPending && activeRound.pendingQuestionNum === qNum) {
      const rebCheck = document.getElementById('score-is-rebound');
      if (rebCheck) rebCheck.checked = true;
      state.scoreInput.isRebound = true;
      selectPoints(activeRound.reboundStatus.pointValue || 20);
      selectResult(true);
      toggleInterruption(false);
      if (activeRound.reboundStatus.team) {
        state.scoreInput.team = activeRound.reboundStatus.team;
      }
    } else {
      const qObj = activeRound.questions.find(q => q.questionNum === qNum);
      if (qObj) {
        selectPoints(qObj.pointValue || 20);
        selectResult(qObj.isCorrect);
        toggleInterruption(!!qObj.isInterruption);
        const rebCheck = document.getElementById('score-is-rebound');
        if (rebCheck) rebCheck.checked = !!qObj.isRebound;
        if (qObj.team && qObj.quizzer) {
          selectStudent(qObj.team, qObj.quizzer);
        }
      } else {
        const row = (activeRound.rows || []).find(r => r.questionNum === qNum);
        if (row) selectPoints(row.pointValue || 20);
        selectResult(true);
        toggleInterruption(false);
        const rebCheck = document.getElementById('score-is-rebound');
        if (rebCheck) rebCheck.checked = false;
      }
    }
  }
  const badge = document.getElementById('active-question-badge');
  if (badge) badge.textContent = `Question #${qNum}`;
  const form = document.getElementById('quick-scorer-form');
  if (form) {
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// Render Scoresheet Mobile Feed
function renderScoresheetMobileFeed(activeRound) {
  const container = document.getElementById('scoresheet-mobile-feed');
  if (!container || !activeRound) return;

  const questionsList = Array.isArray(activeRound.questions) ? activeRound.questions : [];
  const currentQ = activeRound.pendingQuestionNum || (questionsList.length + 1);
  const reboundStatus = activeRound.reboundStatus || { isPending: false };
  const studentsA = (activeRound.studentsA || activeRound.teamA?.students || []).filter(s => s && !s.toLowerCase().startsWith('seat #'));
  const studentsB = (activeRound.studentsB || activeRound.teamB?.students || []).filter(s => s && !s.toLowerCase().startsWith('seat #'));

  let html = '';

  for (let q = 1; q <= 20; q++) {
    if (q === 18) {
      html += `
        <div class="bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 text-slate-950 font-black text-center text-xs py-2 px-3 rounded-xl shadow-xs uppercase tracking-wider font-mono-score">
          ⏸️ [ HALFTIME / TIMEOUT ZONE ] ⏸️
        </div>
      `;
    }

    const row = (activeRound.rows || []).find(r => r.questionNum === q) || { pointValue: (q <= 10 ? 10 : (q <= 17 ? 20 : 30)) };
    const qAnswers = questionsList.filter(item => item.questionNum === q);
    const isCurrentActive = (q === currentQ && !activeRound.isCompleted);
    const isPendingReboundForThisQ = isCurrentActive && reboundStatus.isPending;

    if (isPendingReboundForThisQ) {
      // Question has an interrupted error, opposite team is up to rebound!
      const targetTeam = reboundStatus.team;
      const targetTeamName = targetTeam === 'teamA' ? activeRound.teamA.name : activeRound.teamB.name;
      const targetStudents = targetTeam === 'teamA' ? studentsA : studentsB;
      const origTeamName = reboundStatus.originalTeam === 'teamA' ? activeRound.teamA.name : activeRound.teamB.name;

      const firstAns = qAnswers[0];
      const firstAnsHtml = firstAns ? `
        <div class="text-xs bg-white/80 rounded-lg p-2 border border-amber-200 flex items-center justify-between">
          <div class="truncate">
            <span class="font-bold text-slate-700">1st Attempt:</span>
            <strong class="text-rose-900 ml-1 font-black">👤 ${escapeHtml(firstAns.quizzer)}</strong>
            <span class="text-[10px] text-slate-500">(${escapeHtml(origTeamName)})</span>
          </div>
          <span class="font-mono-score font-black text-xs text-rose-800 bg-rose-100 px-2 py-0.5 rounded border border-rose-200">
            ❌ -${reboundStatus.penalty} Err ⚡
          </span>
        </div>
      ` : '';

      const reboundChips = targetStudents.map(name => {
        const isSelected = state.scoreInput.team === targetTeam && state.scoreInput.quizzer && state.scoreInput.quizzer.toLowerCase() === name.toLowerCase();
        return `
          <button type="button" onclick="quickScoreFromTable(${q}, '${targetTeam}', '${escapeHtml(name)}')" class="px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            isSelected 
              ? 'bg-amber-500 text-slate-950 font-black shadow-xs ring-2 ring-amber-300' 
              : 'bg-white text-slate-900 border border-amber-300 hover:bg-amber-100'
          }">
            👤 ${escapeHtml(name)}
          </button>
        `;
      }).join('');

      html += `
        <div class="p-3.5 rounded-xl border-2 border-amber-400 bg-amber-50/90 shadow-sm flex flex-col gap-2.5">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="w-7 h-7 rounded-lg bg-amber-500 text-slate-950 font-black font-mono-score text-sm flex items-center justify-center flex-shrink-0 animate-pulse">
                #${q}
              </span>
              <div>
                <div class="text-xs font-black text-amber-950 flex items-center gap-1.5">
                  <span>⚡ Q#${q} Re-Read Rebound</span>
                  <span class="font-mono-score bg-amber-200/90 px-1.5 py-0.2 rounded text-[10px]">${row.pointValue} PTS</span>
                </div>
                <span class="text-[10px] text-amber-900 font-semibold block">Opposite team can answer now:</span>
              </div>
            </div>

            <button type="button" onclick="skipRebound(${q})" class="text-[11px] bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-bold px-2.5 py-1 rounded-lg shadow-2xs flex-shrink-0 cursor-pointer">
              ⏭️ Skip Rebound
            </button>
          </div>

          ${firstAnsHtml}

          <div class="pt-1.5 border-t border-amber-200 space-y-1.5">
            <div class="text-[11px] font-black uppercase tracking-wider text-amber-950 flex items-center justify-between">
              <span>⭐ Buzz in for ${escapeHtml(targetTeamName)}:</span>
              <button type="button" onclick="jumpToQuestion(${q})" class="text-[10px] font-bold text-brand-700 hover:underline">Open Scorer ➔</button>
            </div>
            <div class="flex flex-wrap gap-1.5">
              ${reboundChips || '<span class="text-xs text-slate-400">No students listed</span>'}
            </div>
          </div>
        </div>
      `;
    } else if (qAnswers.length > 0) {
      // Question has completed 1 or 2 answers!
      const answersHtml = qAnswers.map((ans, idx) => {
        const isTeamA = ans.team === 'teamA';
        const teamName = isTeamA ? activeRound.teamA.name : activeRound.teamB.name;
        const teamBadgeColor = isTeamA ? 'text-brand-900' : 'text-rose-900';
        const isCorrect = ans.isCorrect;
        const pointsScored = isCorrect ? `+${ans.pointValue}` : (ans.isInterruption ? `-${Math.floor(ans.pointValue / 2)}` : '0');
        const scoreClass = isCorrect ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-rose-100 text-rose-800 border-rose-300';

        return `
          <div class="flex items-center justify-between text-xs py-1 ${idx > 0 ? 'border-t border-slate-200/60' : ''}">
            <div class="truncate flex items-center gap-1.5">
              <span class="text-[10px] font-bold ${isTeamA ? 'bg-brand-100 text-brand-800' : 'bg-rose-100 text-rose-800'} px-1.5 py-0.2 rounded">
                ${isTeamA ? 'Left' : 'Right'}
              </span>
              <span class="text-[11px] font-black ${teamBadgeColor}">👤 ${escapeHtml(ans.quizzer || 'Student')}</span>
              ${ans.isInterruption ? '<span class="text-[9px] font-black uppercase px-1 py-0.2 rounded bg-amber-200 text-amber-900">⚡ Int</span>' : ''}
              ${ans.isRebound ? '<span class="text-[9px] font-black uppercase px-1 py-0.2 rounded bg-indigo-200 text-indigo-900">⭐ Reb</span>' : ''}
            </div>

            <span class="text-xs font-mono-score font-black px-2 py-0.5 rounded-lg border ${scoreClass} flex-shrink-0">
              ${isCorrect ? `✅ ${pointsScored}` : `❌ ${pointsScored} Err`}
            </span>
          </div>
        `;
      }).join('');

      html += `
        <div class="p-3 rounded-xl border border-slate-300 bg-white shadow-xs flex flex-col gap-1.5 transition-all">
          <div class="flex items-center justify-between pb-1 border-b border-slate-100">
            <div class="flex items-center gap-1.5">
              <span class="w-6 h-6 rounded-lg bg-slate-900 text-white font-black font-mono-score text-xs flex items-center justify-center flex-shrink-0">
                #${q}
              </span>
              <span class="text-xs font-black text-slate-700 font-mono-score">${row.pointValue} PTS</span>
              ${qAnswers.length > 1 ? '<span class="text-[9px] font-black uppercase px-1.5 py-0.2 rounded bg-purple-100 text-purple-900 border border-purple-200">2 Quizzers</span>' : ''}
            </div>

            <div class="flex items-center gap-2">
              <div class="text-right flex-shrink-0 font-mono-score font-black text-xs text-slate-700">
                <span class="text-brand-900">${row.homeRunning || 0}</span> - <span class="text-rose-900">${row.oppRunning || 0}</span>
              </div>
              <button type="button" onclick="jumpToQuestion(${q})" title="Re-score or edit Question #${q}" class="text-[11px] bg-white border border-slate-300 text-slate-700 px-2 py-0.5 rounded-md font-bold hover:bg-slate-100 cursor-pointer">
                ✏️ Edit
              </button>
            </div>
          </div>

          <div class="space-y-0.5">
            ${answersHtml}
          </div>
        </div>
      `;
    } else if (isCurrentActive) {
      // Standard upcoming question with quick student chips
      let quickChipsA = studentsA.map(name => {
        const isSelected = state.scoreInput.team === 'teamA' && state.scoreInput.quizzer && state.scoreInput.quizzer.toLowerCase() === name.toLowerCase();
        return `
          <button type="button" onclick="quickScoreFromTable(${q}, 'teamA', '${escapeHtml(name)}')" class="px-2 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${isSelected ? 'bg-brand-600 text-white shadow-xs' : 'bg-brand-50 text-brand-900 border border-brand-200 hover:bg-brand-100'}">
            👤 ${escapeHtml(name)}
          </button>
        `;
      }).join('');

      let quickChipsB = studentsB.map(name => {
        const isSelected = state.scoreInput.team === 'teamB' && state.scoreInput.quizzer && state.scoreInput.quizzer.toLowerCase() === name.toLowerCase();
        return `
          <button type="button" onclick="quickScoreFromTable(${q}, 'teamB', '${escapeHtml(name)}')" class="px-2 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${isSelected ? 'bg-rose-600 text-white shadow-xs' : 'bg-rose-50 text-rose-900 border border-rose-200 hover:bg-rose-100'}">
            👤 ${escapeHtml(name)}
          </button>
        `;
      }).join('');

      html += `
        <div class="p-3.5 rounded-xl border-2 border-amber-400 bg-amber-50/80 shadow-sm flex flex-col gap-2.5">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="w-7 h-7 rounded-lg bg-amber-400 text-slate-950 font-black font-mono-score text-sm flex items-center justify-center flex-shrink-0 animate-pulse">
                #${q}
              </span>
              <div>
                <div class="text-xs font-black text-amber-950 flex items-center gap-1">
                  <span>⚡ Active Question #${q}</span>
                  <span class="font-mono-score bg-amber-200/80 px-1.5 py-0.2 rounded text-[10px]">${row.pointValue} PTS</span>
                </div>
                <span class="text-[10px] text-amber-800 font-semibold">Tap answering student to score immediately:</span>
              </div>
            </div>

            <button type="button" onclick="jumpToQuestion(${q})" class="text-xs bg-brand-600 hover:bg-brand-700 text-white font-black px-3 py-1.5 rounded-lg shadow-xs flex items-center gap-1 flex-shrink-0 cursor-pointer">
              <span>Score Q#${q} ➔</span>
            </button>
          </div>

          <!-- Quick Tap Student Chips for Mobile -->
          <div class="pt-2 border-t border-amber-200/70 space-y-1.5">
            <div class="text-[10px] font-black uppercase tracking-wider text-brand-900 flex items-center gap-1">
              <span>🔵 ${escapeHtml(activeRound.teamA?.name || 'Left Table')}:</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              ${quickChipsA || '<span class="text-xs text-slate-400">No students listed</span>'}
            </div>

            <div class="text-[10px] font-black uppercase tracking-wider text-rose-900 flex items-center gap-1 pt-1">
              <span>🔴 ${escapeHtml(activeRound.teamB?.name || 'Right Table')}:</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              ${quickChipsB || '<span class="text-xs text-slate-400">No students listed</span>'}
            </div>
          </div>
        </div>
      `;
    } else {
      // Future pending question
      html += `
        <div class="p-2.5 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center justify-between text-xs text-slate-400">
          <div class="flex items-center gap-2">
            <span class="w-6 h-6 rounded-lg bg-slate-200 text-slate-600 font-mono-score text-xs flex items-center justify-center font-bold">
              #${q}
            </span>
            <span class="font-mono-score font-bold text-slate-600">${row.pointValue} PTS</span>
            <span class="text-[11px] text-slate-400">Pending</span>
          </div>
          <button type="button" onclick="jumpToQuestion(${q})" class="text-[10px] text-slate-500 hover:text-slate-900 hover:underline font-bold px-2 py-0.5 cursor-pointer">
            Select
          </button>
        </div>
      `;
    }
  }

  container.innerHTML = html;
}

function toggleQuickScorer() {
  const form = document.getElementById('quick-scorer-form');
  const btn = document.getElementById('quick-scorer-toggle-btn');
  const isHidden = form.classList.toggle('hidden');
  btn.textContent = isHidden ? 'Show Scorer ▾' : 'Hide Box ▴';
}

function renderScoresheetTableRows(activeRound) {
  const tbody = document.getElementById('scoresheet-tbody');
  if (!tbody || !activeRound) return;

  const questionsList = Array.isArray(activeRound.questions) ? activeRound.questions : [];
  const studentsA = (activeRound.studentsA || activeRound.teamA?.students || []).filter(s => s && !s.toLowerCase().startsWith('seat #'));
  const studentsB = (activeRound.studentsB || activeRound.teamB?.students || []).filter(s => s && !s.toLowerCase().startsWith('seat #'));
  const activeQInputVal = parseInt(document.getElementById('score-question-num')?.value) || (questionsList.length + 1);

  let html = '';

  (activeRound.rows || []).forEach(row => {
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

    const currentPendingQ = activeRound.pendingQuestionNum || (questionsList.length + 1);
    const isCurrentActiveQ = qNum === currentPendingQ;
    const isReboundPendingRow = isCurrentActiveQ && activeRound.reboundStatus?.isPending;
    const isEditingQ = qNum === activeQInputVal;
    const rowBg = isReboundPendingRow
      ? 'bg-amber-100/90 border-l-4 border-amber-500 font-semibold'
      : (isCurrentActiveQ
        ? 'bg-amber-50/70 border-l-4 border-amber-500'
        : (isEditingQ ? 'bg-indigo-50/40 border-l-4 border-indigo-400' : (qNum % 2 === 0 ? 'bg-slate-50/60' : 'bg-white')));

    const qColBg = isReboundPendingRow ? 'bg-amber-200 font-black' : (isCurrentActiveQ ? 'bg-amber-100' : (qNum % 2 === 0 ? 'bg-slate-100' : 'bg-white'));
    const ptsColBg = isReboundPendingRow ? 'bg-amber-100' : (isCurrentActiveQ ? 'bg-amber-50' : (qNum % 2 === 0 ? 'bg-slate-50' : 'bg-white'));

    const renderStudentCell = (teamKey, idx, studentName, cellVal) => {
      const isSelected = state.scoreInput.team === teamKey && 
                         (state.scoreInput.quizzer && state.scoreInput.quizzer.toLowerCase() === studentName.toLowerCase()) &&
                         activeQInputVal === qNum;

      const hoverClass = teamKey === 'teamA' 
        ? 'hover:bg-brand-100 hover:ring-2 hover:ring-brand-400 hover:ring-inset' 
        : 'hover:bg-rose-100 hover:ring-2 hover:ring-rose-400 hover:ring-inset';

      const activeClass = isSelected 
        ? (teamKey === 'teamA' ? 'bg-brand-100 ring-2 ring-brand-500 ring-inset font-black' : 'bg-rose-100 ring-2 ring-rose-500 ring-inset font-black') 
        : '';

      const content = formatCell(cellVal);
      const placeholder = `<span class="opacity-0 group-hover:opacity-60 text-[10px] ${teamKey === 'teamA' ? 'text-brand-600' : 'text-rose-600'} font-bold select-none">+</span>`;

      return `
        <td onclick="quickScoreFromTable(${qNum}, '${teamKey}', '${escapeHtml(studentName)}')" 
            title="Tap to score Q#${qNum} for ${escapeHtml(studentName)}" 
            class="p-2 text-center border-r border-slate-200 cursor-pointer transition-all group ${hoverClass} ${activeClass}">
          ${content || placeholder}
        </td>
      `;
    };

    const homeCellsHtml = studentsA.map((name, i) => {
      const cellVal = (row.homeCells && row.homeCells[i]) || '';
      return renderStudentCell('teamA', i, name, cellVal);
    }).join('');

    const oppCellsHtml = studentsB.map((name, i) => {
      const cellVal = (row.oppCells && row.oppCells[i]) || '';
      return renderStudentCell('teamB', i, name, cellVal);
    }).join('');

    html += `
      <tr class="${rowBg} hover:bg-slate-100/50 transition-colors">
        <td onclick="jumpToQuestion(${qNum})" title="Tap to select Question #${qNum}" class="p-2 text-center font-mono-score font-black text-slate-800 border-r border-slate-200 sticky-col-q ${qColBg} cursor-pointer hover:underline">${qNum}</td>
        <td onclick="jumpToQuestion(${qNum})" title="Tap to select Question #${qNum}" class="p-2 text-center font-mono-score font-extrabold text-slate-600 border-r-2 border-slate-300 sticky-col-pts ${ptsColBg} cursor-pointer hover:underline">${row.pointValue}</td>

        ${homeCellsHtml}

        <td class="p-2 text-center font-mono-score font-black text-brand-900 bg-brand-50/90 border-r-2 border-slate-400">
          ${row.hasAnswers || qNum <= questionsList.length ? row.homeRunning : ''}
        </td>

        ${oppCellsHtml}

        <td class="p-2 text-center font-mono-score font-black text-rose-900 bg-rose-50/90">
          ${row.hasAnswers || qNum <= questionsList.length ? row.oppRunning : ''}
          ${row.note ? `<span class="block text-[9px] font-bold text-indigo-700 font-sans">(${escapeHtml(row.note)})</span>` : ''}
        </td>
      </tr>
    `;

    if (qNum === 17) {
      const totalColspan = studentsA.length + studentsB.length + 4;
      html += `
        <tr class="bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 text-slate-950 font-black text-center text-xs tracking-wider border-y-2 border-amber-600 shadow-inner">
          <td colspan="${totalColspan}" class="py-2.5 uppercase font-mono-score">
            ⏸️ [ HALFTIME / TIMEOUT ZONE ] ⏸️
          </td>
        </tr>
      `;
    }
  });

  tbody.innerHTML = html;
}

function renderScoresheetSummaryRows(activeRound) {
  const homeBonusesList = (activeRound.teamA?.bonuses || []).map(b => b.desc).join(', ') || 'None';
  const oppBonusesList = (activeRound.teamB?.bonuses || []).map(b => b.desc).join(', ') || 'None';

  document.getElementById('summary-home-bonuses').textContent = homeBonusesList;
  document.getElementById('summary-opp-bonuses').textContent = oppBonusesList;
  document.getElementById('summary-home-bonus-pts').textContent = activeRound.teamA?.bonusPoints ? `+${activeRound.teamA.bonusPoints}` : '0';
  document.getElementById('summary-opp-bonus-pts').textContent = activeRound.teamB?.bonusPoints ? `+${activeRound.teamB.bonusPoints}` : '0';

  const homeFoulsList = (activeRound.teamA?.fouls || []).map(f => `${f.reason}`).join(', ') || 'None';
  const oppFoulsList = (activeRound.teamB?.fouls || []).map(f => `${f.reason}`).join(', ') || 'None';

  document.getElementById('summary-home-fouls').textContent = homeFoulsList;
  document.getElementById('summary-opp-fouls').textContent = oppFoulsList;
  document.getElementById('summary-home-foul-pts').textContent = activeRound.teamA?.foulPenalty ? `-${activeRound.teamA.foulPenalty}` : '0';
  document.getElementById('summary-opp-foul-pts').textContent = activeRound.teamB?.foulPenalty ? `-${activeRound.teamB.foulPenalty}` : '0';

  document.getElementById('summary-home-final-pts').textContent = activeRound.teamA?.finalScore || 0;
  document.getElementById('summary-opp-final-pts').textContent = activeRound.teamB?.finalScore || 0;

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
  const homeTimeouts = (activeRound.timeouts && (activeRound.timeouts.home || activeRound.timeouts.teamA)) || activeRound.teamA?.timeouts || [];
  const oppTimeouts = (activeRound.timeouts && (activeRound.timeouts.opponent || activeRound.timeouts.teamB)) || activeRound.teamB?.timeouts || [];
  const homeT1 = homeTimeouts.find(t => t.id === 1) || { used: false };
  const homeT2 = homeTimeouts.find(t => t.id === 2) || { used: false };
  const oppT1 = oppTimeouts.find(t => t.id === 1) || { used: false };
  const oppT2 = oppTimeouts.find(t => t.id === 2) || { used: false };

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
  if (!panelGrid || !activeRound) return;

  const buildTeamQuizzersHtml = (teamObj, studentsArr, teamKey, borderColor, headerBg) => {
    let quizzersRowsHtml = '';
    const studentsList = (studentsArr || []).filter(s => s && !s.toLowerCase().startsWith('seat #'));

    studentsList.forEach(name => {
      const stat = (teamObj.quizzers || []).find(q => q.name && q.name.trim().toLowerCase() === name.toLowerCase()) || {
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
        <div class="p-2.5 rounded-xl border ${rowBg} flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition-all">
          <div class="flex items-center justify-between sm:justify-start gap-2 min-w-0 w-full sm:w-auto">
            <div class="flex items-center gap-2 min-w-0">
              <span class="w-6 h-6 rounded-lg bg-slate-100 font-black font-mono-score text-xs flex items-center justify-center text-slate-700 flex-shrink-0">
                👤
              </span>
              <div class="truncate">
                <span class="text-xs font-black text-slate-900 block truncate">${escapeHtml(name)}</span>
                <span class="text-[10px] text-slate-500 font-mono-score font-bold">${stat.points} pts</span>
              </div>
            </div>
            <div class="sm:hidden flex-shrink-0">
              ${statusBadge}
            </div>
          </div>

          <div class="flex items-center justify-between sm:justify-end gap-2.5 sm:gap-3 flex-shrink-0 pt-1.5 sm:pt-0 border-t border-slate-100 sm:border-t-0 w-full sm:w-auto">
            <div class="flex items-center gap-2">
              <!-- Correct Count -->
              <div class="text-center">
                <span class="text-[11px] font-black font-mono-score text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                  ${stat.correct}/${activeRound.qoThreshold || 5} C
                </span>
              </div>

              <!-- Incorrect Count (Errors) -->
              <div class="text-center flex items-center gap-1.5">
                <span class="text-[11px] font-black font-mono-score ${stat.errors > 0 ? 'text-rose-700 bg-rose-50 border border-rose-200' : 'text-slate-500 bg-slate-100'} px-2 py-0.5 rounded-md">
                  ${stat.errors}/3 E
                </span>
                <div class="flex items-center">
                  ${errorDots}
                </div>
              </div>
            </div>

            <!-- Status Pill on Desktop -->
            <div class="hidden sm:block">
              ${statusBadge}
            </div>
          </div>
        </div>
      `;
    });

    if (studentsList.length === 0) {
      quizzersRowsHtml = `<div class="p-3 text-center text-xs text-slate-400">No students listed</div>`;
    }

    return `
      <div class="rounded-xl border ${borderColor} overflow-hidden bg-slate-50/50">
        <div class="${headerBg} p-3 border-b flex items-center justify-between">
          <div class="font-black text-xs uppercase tracking-wider flex items-center gap-2">
            <span>${escapeHtml(teamObj.name)}</span>
          </div>
          <span class="text-xs font-black font-mono-score px-2 py-0.5 rounded bg-white/80">
            Total: ${teamObj.finalScore || 0} pts
          </span>
        </div>
        <div class="p-3 space-y-2">
          ${quizzersRowsHtml}
        </div>
      </div>
    `;
  };

  const studentsA = (activeRound.studentsA || activeRound.teamA?.students || []).filter(s => s && !s.toLowerCase().startsWith('seat #'));
  const studentsB = (activeRound.studentsB || activeRound.teamB?.students || []).filter(s => s && !s.toLowerCase().startsWith('seat #'));

  const htmlA = buildTeamQuizzersHtml(
    activeRound.teamA, 
    studentsA, 
    'teamA', 
    'border-brand-200', 
    'bg-brand-50 border-brand-200 text-brand-950'
  );
  const htmlB = buildTeamQuizzersHtml(
    activeRound.teamB, 
    studentsB, 
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

  const activeRound = state.tbqData?.activeRound;
  if (!activeRound) return;
  if (activeRound.isCompleted) {
    showMatchToast('🏁 This match is already completed (all 20 questions scored).', 'warning');
    return;
  }

  const studentsA = (activeRound.studentsA || activeRound.teamA?.students || []).filter(s => s && !s.toLowerCase().startsWith('seat #'));
  const studentsB = (activeRound.studentsB || activeRound.teamB?.students || []).filter(s => s && !s.toLowerCase().startsWith('seat #'));

  // Ensure an answering student is always selected
  if (!state.scoreInput.team) state.scoreInput.team = 'teamA';
  if (!state.scoreInput.quizzer) {
    const defaultList = state.scoreInput.team === 'teamA' ? studentsA : studentsB;
    state.scoreInput.quizzer = defaultList[0] || 'Student 1';
  }

  const answeredQuizzer = state.scoreInput.quizzer;
  const isTeamA = state.scoreInput.team === 'teamA';
  const prevList = isTeamA ? (activeRound.teamA.quizzers || []) : (activeRound.teamB.quizzers || []);
  const prevStat = prevList.find(q => q.name && answeredQuizzer && q.name.trim().toLowerCase() === answeredQuizzer.trim().toLowerCase()) || { correct: 0, errors: 0 };
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
    toggleInterruption(false);
    selectPoints(20);
    selectResult(true);

    state.tbqData.activeRound = result.activeRound;

    if (result.activeRound?.isCompleted) {
      showMatchToast(`🏁 Match #${result.activeRound.matchNumber} Completed! Winner: ${result.activeRound.winner}`, 'success');
    }

    // Check if quizzer reached Quiz Out or Error Out milestone on this answer
    const newList = isTeamA ? (result.activeRound.teamA.quizzers || []) : (result.activeRound.teamB.quizzers || []);
    const newStat = newList.find(q => q.name && answeredQuizzer && q.name.trim().toLowerCase() === answeredQuizzer.trim().toLowerCase());

    if (newStat) {
      if (prevCorrect < 5 && newStat.correct >= 5) {
        if (newStat.errors === 0) {
          showMatchToast(`⭐ ${newStat.name || answeredQuizzer} has QUIZZED OUT! Perfect 5/5 (+20 Bonus Points awarded)!`, 'success');
        } else {
          showMatchToast(`🎉 ${newStat.name || answeredQuizzer} has QUIZZED OUT! 5 correct answers. Sits back with maximum score!`, 'warning');
        }
      } else if (prevErrors < 3 && newStat.errors >= 3) {
        showMatchToast(`❌ ${newStat.name || answeredQuizzer} has ERRORED OUT! 3 errors reached. Must remain seated for remainder of match.`, 'error');
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
      if (res.status === 401) {
        setLoggedOutView();
        openCoachLoginModal();
      }
      alert(result.error || 'Nothing to undo.');
      return;
    }
    if (!state.tbqData) state.tbqData = {};
    state.tbqData.activeRound = result.activeRound;
    renderOfficialScoresheet();
    showMatchToast('Last question undone.', 'info');
  } catch (err) {
    console.error('Error undoing question:', err);
    alert('Error undoing question: ' + (err.message || 'Unknown error'));
  }
}

// Reset Match
async function coachResetRound() {
  if (!confirm('Are you sure you want to clear and reset all questions in this match?')) return;

  const mId = state.activeMatchId || state.tbqData?.activeRound?.id || state.tbqData?.activeMatchId;
  try {
    const res = await authFetch('/api/tbq/reset-round', {
      method: 'POST',
      body: JSON.stringify({ matchId: mId })
    });
    const result = await res.json();
    if (!res.ok) {
      if (res.status === 401) {
        setLoggedOutView();
        openCoachLoginModal();
      }
      alert(result.error || 'Failed to reset match.');
      return;
    }
    if (!state.tbqData) state.tbqData = {};
    state.tbqData.activeRound = result.activeRound;
    renderOfficialScoresheet();
    showMatchToast('Match cleared and reset successfully.', 'info');
  } catch (err) {
    console.error('Error resetting match:', err);
    alert('Error resetting match: ' + (err.message || 'Unknown error'));
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
  const infoMatch = document.getElementById('info-match-num');
  if (infoMatch) infoMatch.value = activeRound.matchNumber || "01";

  const labelHome = document.getElementById('modal-students-home-label');
  if (labelHome) labelHome.textContent = `${activeRound.teamA?.name || 'Team A'} Students:`;
  const labelOpp = document.getElementById('modal-students-opp-label');
  if (labelOpp) labelOpp.textContent = `${activeRound.teamB?.name || 'Team B'} Students:`;

  const studentsA = (activeRound.studentsA || activeRound.teamA?.students || []).filter(s => s && !s.toLowerCase().startsWith('seat #'));
  const studentsB = (activeRound.studentsB || activeRound.teamB?.students || []).filter(s => s && !s.toLowerCase().startsWith('seat #'));

  const homeInput = document.getElementById('modal-students-home-input');
  if (homeInput) homeInput.value = studentsA.join(', ');

  const oppInput = document.getElementById('modal-students-opp-input');
  if (oppInput) oppInput.value = studentsB.join(', ');

  document.getElementById('match-info-modal').classList.remove('hidden');
}

function closeMatchInfoModal() {
  document.getElementById('match-info-modal').classList.add('hidden');
}

async function handleSaveMatchInfo(event) {
  event.preventDefault();

  const infoMeet = document.getElementById('info-meet-num');
  const meetNum = parseInt(infoMeet ? infoMeet.value : 1) || 1;
  const matchNumber = (document.getElementById('info-match-num')?.value || '').trim();

  const homeText = document.getElementById('modal-students-home-input')?.value || '';
  const oppText = document.getElementById('modal-students-opp-input')?.value || '';

  const parseStudents = (text, defaultPrefix) => {
    const list = text.split(/[,\n]+/).map(s => s.trim()).filter(s => s && !s.toLowerCase().startsWith('seat #'));
    return list.length > 0 ? list : [`${defaultPrefix} 1`];
  };

  const studentsA = parseStudents(homeText, 'Student A');
  const studentsB = parseStudents(oppText, 'Student B');

  try {
    const res = await authFetch('/api/tbq/match-info', {
      method: 'POST',
      body: JSON.stringify({
        matchId: state.activeMatchId,
        meetNum,
        roundNum: meetNum,
        matchNumber,
        room: '',
        studentsA,
        studentsB
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to update match info.');
      return;
    }

    state.tbqData.activeRound = data.activeRound;
    closeMatchInfoModal();
    renderOfficialScoresheet();
    showMatchToast('💾 Match and student roster updated successfully!', 'success');
  } catch (err) {
    console.error('Error saving match info:', err);
    alert('Network error saving match info: ' + (err.message || 'Please check connection'));
  }
}

// Explicit Manual Save Scoresheet Handler
async function handleManualSaveSheet() {
  const saveBtn = document.getElementById('scoresheet-save-btn');
  const originalHtml = saveBtn ? saveBtn.innerHTML : '';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span>⏳ Saving...</span>';
  }

  const activeRound = state.tbqData?.activeRound;
  const mId = state.activeMatchId || activeRound?.id;
  const studentsA = (activeRound?.studentsA || activeRound?.teamA?.students || []).filter(s => s && !s.toLowerCase().startsWith('seat #'));
  const studentsB = (activeRound?.studentsB || activeRound?.teamB?.students || []).filter(s => s && !s.toLowerCase().startsWith('seat #'));

  try {
    const res = await authFetch('/api/tbq/save-sheet', {
      method: 'POST',
      body: JSON.stringify({
        matchId: mId,
        studentsA,
        studentsB
      })
    });

    const data = await res.json();
    if (res.ok && data.activeRound) {
      state.tbqData.activeRound = data.activeRound;
      try {
        localStorage.setItem('tbq_backup_scores', JSON.stringify(state.tbqData));
      } catch (e) {}
      renderOfficialScoresheet();
      showMatchToast('💾 Scoresheet saved successfully! All questions and student scores up-to-date.', 'success');
      const badge = document.getElementById('save-status-indicator');
      if (badge) {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500"></span><span class="text-emerald-800 font-extrabold">Saved (${timeStr})</span>`;
      }
    } else {
      alert(data.error || 'Failed to save scoresheet.');
    }
  } catch (err) {
    console.error('Error saving sheet:', err);
    alert('Network error saving scoresheet: ' + (err.message || 'Please check connection'));
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalHtml;
    }
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
  const divKey = getActiveDivisionKey();

  // 1. Update 3-Way Division Segregation Tabs
  const tabTbq = document.getElementById('teams-tab-tbq');
  const tabJbqB = document.getElementById('teams-tab-jbq-b');
  const tabJbqC = document.getElementById('teams-tab-jbq-c');

  const countTbq = document.getElementById('teams-count-tbq');
  const countJbqB = document.getElementById('teams-count-jbq-b');
  const countJbqC = document.getElementById('teams-count-jbq-c');

  const divs = state.tbqData?.divisionsSummary || state.allDivisionTeams?.divisionsSummary || state.platformContext?.divisionsSummary || {};
  if (countTbq) countTbq.textContent = `${divs.tbq?.teamsCount || 0} Teams • ${divs.tbq?.matchesCount || 0} M`;
  if (countJbqB) countJbqB.textContent = `${divs.jbq_b?.teamsCount || 0} Teams • ${divs.jbq_b?.matchesCount || 0} M`;
  if (countJbqC) countJbqC.textContent = `${divs.jbq_c?.teamsCount || 0} Teams • ${divs.jbq_c?.matchesCount || 0} M`;

  const activeTabClass = 'flex-1 py-2 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 shadow-xs whitespace-nowrap bg-amber-400 text-brand-950';
  const inactiveTabClass = 'flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 whitespace-nowrap text-slate-600 hover:text-slate-900 bg-transparent';

  if (tabTbq) tabTbq.className = divKey === 'tbq' ? activeTabClass : inactiveTabClass;
  if (tabJbqB) tabJbqB.className = divKey === 'jbq_b' ? activeTabClass : inactiveTabClass;
  if (tabJbqC) tabJbqC.className = divKey === 'jbq_c' ? activeTabClass : inactiveTabClass;

  // Resolve teams & matches for the current division
  const isMatchingTbqData = state.tbqData && state.tbqData.league === state.currentLeague && (state.currentLeague === 'tbq' || state.tbqData.division === state.currentDivision);
  const teams = isMatchingTbqData 
    ? (state.tbqData.meet?.teams || []) 
    : ((state.allDivisionTeams && state.allDivisionTeams[divKey]) || (state.tbqData?.meet?.teams || []));
  const matchesList = isMatchingTbqData ? (state.tbqData.matchesList || []) : [];

  // 2. Active Division Banner
  const bannerIcon = document.getElementById('teams-div-banner-icon');
  const bannerTitle = document.getElementById('teams-div-banner-title');
  const bannerDesc = document.getElementById('teams-div-banner-desc');

  if (bannerIcon) bannerIcon.textContent = divKey === 'jbq_c' ? '🌟' : (divKey === 'jbq_b' ? '⚡' : '📖');
  if (bannerTitle) bannerTitle.textContent = getDivisionDisplayName(divKey);
  if (bannerDesc) {
    bannerDesc.textContent = `${teams.length} Teams Configured • ${(matchesList || []).length} Matches Scheduled in this Division`;
  }

  const gridHeading = document.getElementById('teams-grid-heading');
  if (gridHeading) {
    gridHeading.textContent = `${getDivisionDisplayName(divKey)} Teams & Quizzers (${teams.length})`;
  }

  // 3. Render Teams Cards
  const gridEl = document.getElementById('teams-cards-grid');
  let cardsHtml = '';

  teams.forEach((t, idx) => {
    const isCIC = t.name.toLowerCase().includes('chicago');
    cardsHtml += `
      <div class="bg-white rounded-2xl p-5 border ${isCIC ? 'border-brand-300 ring-2 ring-brand-100' : 'border-slate-200'} shadow-sm flex flex-col justify-between">
        <div>
          <div class="flex items-start justify-between gap-2 pb-2 border-b border-slate-100">
            <div>
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-[10px] font-black uppercase tracking-wider ${isCIC ? 'text-brand-600 bg-brand-50 border border-brand-200' : 'text-slate-500 bg-slate-100'} px-2 py-0.5 rounded-full">
                  Team #${idx + 1} ${isCIC ? '• Our Church' : ''}
                </span>
                ${getDivisionBadgeHtml(divKey)}
              </div>
              <h4 class="text-base font-black text-slate-900 mt-1">${escapeHtml(t.name)}</h4>
              <div class="text-xs text-slate-500 font-medium">${escapeHtml(t.church)}</div>
            </div>
            <div class="flex items-center gap-1.5">
              <button onclick="openEditTeamModal('${t.id}')" class="text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold px-3 py-1.5 rounded-lg border border-slate-200 transition-colors">
                ✏️ Edit
              </button>
              <button onclick="deleteTeam('${t.id}')" class="text-xs bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold px-2.5 py-1.5 rounded-lg border border-rose-200 transition-colors" title="Delete Team">
                🗑️
              </button>
            </div>
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
          <button onclick="deleteTeam('${t.id}')" class="text-rose-600 font-bold hover:text-rose-800 flex items-center gap-1">
            <span>🗑️ Delete Team</span>
          </button>
          <button onclick="openEditTeamModal('${t.id}')" class="text-brand-600 font-bold hover:underline">
            Update Roster ➔
          </button>
        </div>
      </div>
    `;
  });

  if (teams.length === 0) {
    cardsHtml = `
      <div class="col-span-full py-8 text-center bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 p-6">
        <div class="text-3xl mb-2">${divKey === 'jbq_c' ? '🌟' : (divKey === 'jbq_b' ? '⚡' : '📖')}</div>
        <div class="text-sm font-black text-slate-800">No Teams Configured in ${getDivisionDisplayName(divKey)}</div>
        <p class="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">Tap "+ Add Team" to configure church teams and quizzers for this division.</p>
        <button onclick="openEditTeamModal()" class="text-xs bg-brand-600 hover:bg-brand-700 text-white font-bold px-4 py-2 rounded-xl shadow-xs">
          ➕ Add Team to ${getDivisionDisplayName(divKey)}
        </button>
      </div>
    `;
  }

  gridEl.innerHTML = cardsHtml;

  // 4. Render Matches Schedule List
  const matchesListEl = document.getElementById('matches-schedule-list');
  let mHtml = '';

  (matchesList || []).forEach(m => {
    const isCurrent = m.id === state.activeMatchId;
    mHtml += `
      <div class="p-3.5 rounded-xl border ${isCurrent ? 'border-amber-400 bg-amber-50/40' : 'border-slate-200 bg-slate-50'} flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-slate-900 text-amber-400 flex items-center justify-center font-black font-mono-score text-xs">
            M#${m.matchNumber}
          </div>
          <div>
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-xs font-extrabold text-slate-500 uppercase">
                Meet ${m.meetNum || m.roundNum}
              </span>
              ${getDivisionBadgeHtml(divKey)}
            </div>
            <div class="text-sm font-bold text-slate-800 mt-0.5">
              <span>${escapeHtml(m.teamAName)}</span>
              <span class="text-slate-400 font-normal"> vs </span>
              <span>${escapeHtml(m.teamBName)}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap pt-2 sm:pt-0 border-t border-slate-200/50 sm:border-t-0">
          <button onclick="openEditMatchModal('${m.id}')" class="flex-1 sm:flex-none text-xs bg-white hover:bg-slate-100 text-slate-700 font-bold px-3 py-1.5 rounded-lg border border-slate-300 shadow-xs transition-all flex items-center justify-center gap-1">
            ✏️ Edit
          </button>
          <button onclick="handleDeleteMatch('${m.id}', '${m.matchNumber}')" class="text-xs bg-white hover:bg-rose-50 text-rose-600 font-bold px-2.5 py-1.5 rounded-lg border border-rose-200 shadow-xs transition-all" title="Delete Match">
            🗑️
          </button>
          <button onclick="selectAndOpenMatch('${m.id}')" class="flex-1 sm:flex-none text-xs bg-brand-600 hover:bg-brand-700 text-white font-bold px-3 py-1.5 rounded-lg shadow-xs transition-all text-center">
            📋 Score Match
          </button>
        </div>
      </div>
    `;
  });
  matchesListEl.innerHTML = mHtml || `<p class="text-xs text-slate-400 py-3 text-center">No matches configured in ${getDivisionDisplayName(divKey)}. Tap "+ Add Meet / Match" above.</p>`;
  checkStorageStatus();
}

function selectAndOpenMatch(matchId) {
  fetchTbqData(matchId);
  switchTab('scoresheet');
}

// EDIT TEAM MODAL
function openEditTeamModal(teamId) {
  const currentDiv = getActiveDivisionKey();
  const teams = (state.tbqData && state.tbqData.meet && state.tbqData.meet.teams) || [];
  const team = teams.find(t => t.id === teamId);

  const divSelect = document.getElementById('edit-team-division');
  if (divSelect) {
    divSelect.value = currentDiv;
  }

  document.getElementById('edit-team-id').value = team ? team.id : '';
  document.getElementById('edit-team-name').value = team ? team.name : '';
  document.getElementById('edit-team-church').value = team ? team.church : '';
  document.getElementById('edit-team-quizzers').value = team ? (team.quizzers || []).join(', ') : '';
  
  const titleEl = document.getElementById('modal-team-title');
  if (titleEl) {
    titleEl.textContent = team ? `Edit ${team.name}` : `➕ Add New Team (${getDivisionDisplayName(currentDiv)})`;
  }

  const modalDeleteBtn = document.getElementById('modal-delete-team-btn');
  if (modalDeleteBtn) {
    if (team) {
      modalDeleteBtn.classList.remove('hidden');
    } else {
      modalDeleteBtn.classList.add('hidden');
    }
  }

  document.getElementById('edit-team-modal').classList.remove('hidden');
}

function closeEditTeamModal() {
  document.getElementById('edit-team-modal').classList.add('hidden');
}

function handleDeleteTeamFromModal() {
  const teamId = document.getElementById('edit-team-id').value;
  if (!teamId) return;
  closeEditTeamModal();
  deleteTeam(teamId);
}

async function deleteTeam(teamId) {
  const teams = (state.tbqData && state.tbqData.meet && state.tbqData.meet.teams) || [];
  const team = teams.find(t => t.id === teamId);
  const teamName = team ? team.name : 'this team';

  if (!confirm(`Are you sure you want to delete ${teamName}? This action cannot be undone.`)) {
    return;
  }

  try {
    const res = await authFetch('/api/teams/delete', {
      method: 'POST',
      body: JSON.stringify({ teamId })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to delete team.');
      return;
    }
    showMatchToast(`🗑️ Deleted ${teamName}`, 'info');
    if (data.divisionsSummary && state.tbqData) {
      state.tbqData.divisionsSummary = data.divisionsSummary;
    }
    await fetchTbqData(state.activeMatchId);
    renderTeamsManagerUI();
    fetchTeamsByDivision();
  } catch (err) {
    alert('Error deleting team.');
  }
}

async function clearAllTeams() {
  const divKey = getActiveDivisionKey();
  const teams = (state.tbqData && state.tbqData.meet && state.tbqData.meet.teams) || [];
  if (teams.length === 0) {
    alert(`No teams to delete in ${getDivisionDisplayName(divKey)}.`);
    return;
  }

  if (!confirm(`⚠️ Are you sure you want to delete ALL ${teams.length} teams in ${getDivisionDisplayName(divKey)}?\n\nThis will only delete teams in this division so you can start fresh!`)) {
    return;
  }

  try {
    const res = await authFetch('/api/teams/clear-all', {
      method: 'POST',
      body: JSON.stringify({ division: divKey })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to clear all teams.');
      return;
    }
    showMatchToast(`🗑️ All teams cleared in ${getDivisionDisplayName(divKey)}!`, 'success');
    if (data.divisionsSummary && state.tbqData) {
      state.tbqData.divisionsSummary = data.divisionsSummary;
    }
    await fetchTbqData(state.activeMatchId);
    renderTeamsManagerUI();
    fetchTeamsByDivision();
  } catch (err) {
    alert('Error clearing teams.');
  }
}

async function handleSaveTeam(event) {
  event.preventDefault();
  const teamId = document.getElementById('edit-team-id').value;
  const divSelect = document.getElementById('edit-team-division');
  const division = divSelect ? divSelect.value : getActiveDivisionKey();
  const name = document.getElementById('edit-team-name').value.trim();
  const church = document.getElementById('edit-team-church').value.trim();
  const quizzersRaw = document.getElementById('edit-team-quizzers').value;

  try {
    const res = await authFetch('/api/teams/save', {
      method: 'POST',
      body: JSON.stringify({ teamId, name, church, quizzers: quizzersRaw, division })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to save team.');
      return;
    }
    closeEditTeamModal();
    if (data.divisionsSummary) {
      if (!state.tbqData) state.tbqData = {};
      state.tbqData.divisionsSummary = data.divisionsSummary;
    }
    if (division !== getActiveDivisionKey()) {
      setActiveDivisionKey(division);
    } else {
      await fetchTbqData(state.activeMatchId);
      renderTeamsManagerUI();
    }
    fetchTeamsByDivision();
    showMatchToast(`✅ Saved ${name} to ${getDivisionDisplayName(division)}!`, 'success');
  } catch (err) {
    alert('Error saving team.');
  }
}

// POPULATE MATCH MODAL TEAMS (STRICTLY SEGREGATED BY DIVISION)
function populateMatchModalTeams(divKey, selectedTeamAId, selectedTeamBId) {
  const teams = (state.allDivisionTeams && state.allDivisionTeams[divKey]) || 
    (divKey === getActiveDivisionKey() ? (state.tbqData?.meet?.teams || []) : []);
  const selectA = document.getElementById('match-team-a-select');
  const selectB = document.getElementById('match-team-b-select');
  const warning = document.getElementById('match-teams-warning');
  const submitBtn = document.getElementById('match-modal-submit-btn');

  let optsA = '';
  let optsB = '';
  teams.forEach((t, idx) => {
    const isASel = selectedTeamAId ? t.id === selectedTeamAId : idx === 0;
    const isBSel = selectedTeamBId ? t.id === selectedTeamBId : idx === 1;
    optsA += `<option value="${t.id}" ${isASel ? 'selected' : ''}>${escapeHtml(t.name)}</option>`;
    optsB += `<option value="${t.id}" ${isBSel ? 'selected' : ''}>${escapeHtml(t.name)}</option>`;
  });
  if (selectA) selectA.innerHTML = optsA;
  if (selectB) selectB.innerHTML = optsB;

  if (teams.length < 2) {
    if (warning) {
      warning.textContent = `⚠️ You need at least 2 teams in ${getDivisionDisplayName(divKey)} to configure a match. Please add another team first.`;
      warning.classList.remove('hidden');
    }
    if (submitBtn) submitBtn.disabled = true;
  } else {
    if (warning) warning.classList.add('hidden');
    if (submitBtn) submitBtn.disabled = false;
  }
}

function handleMatchModalDivisionChange(divKey) {
  populateMatchModalTeams(divKey);
  const badgeEl = document.getElementById('match-modal-badge');
  if (badgeEl) badgeEl.textContent = `${getDivisionDisplayName(divKey)} Schedule`;
}

// ADD & EDIT MATCH MODAL
async function openAddMatchModal() {
  const currentDiv = getActiveDivisionKey();
  const divSelect = document.getElementById('match-division-select');
  if (divSelect) divSelect.value = currentDiv;

  await fetchTeamsByDivision();
  populateMatchModalTeams(currentDiv);

  document.getElementById('match-edit-id').value = '';
  const badgeEl = document.getElementById('match-modal-badge');
  if (badgeEl) badgeEl.textContent = `${getDivisionDisplayName(currentDiv)} Schedule`;
  const titleEl = document.getElementById('match-modal-title');
  if (titleEl) titleEl.textContent = '➕ Add Meet / Match';
  const submitBtn = document.getElementById('match-modal-submit-btn');
  if (submitBtn) submitBtn.textContent = 'Save Match';

  const nextNum = (state.tbqData && state.tbqData.matchesList ? state.tbqData.matchesList.length + 1 : 1);
  document.getElementById('match-number-input').value = `0${nextNum}`;
  const meetInput = document.getElementById('match-meet-num');
  if (meetInput) meetInput.value = Math.ceil(nextNum / 2) || 1;

  document.getElementById('add-match-modal').classList.remove('hidden');
}

function openEditMatchModal(matchId) {
  const currentDiv = getActiveDivisionKey();
  const divSelect = document.getElementById('match-division-select');
  if (divSelect) divSelect.value = currentDiv;

  const matches = (state.tbqData && state.tbqData.matchesList) || [];
  const m = matches.find(item => item.id === matchId);
  if (!m) return;

  populateMatchModalTeams(currentDiv, m.teamAId, m.teamBId);

  document.getElementById('match-edit-id').value = m.id;
  const badgeEl = document.getElementById('match-modal-badge');
  if (badgeEl) badgeEl.textContent = `${getDivisionDisplayName(currentDiv)} Schedule`;
  const titleEl = document.getElementById('match-modal-title');
  if (titleEl) titleEl.textContent = `✏️ Edit Match #${m.matchNumber} (${getDivisionDisplayName(currentDiv)})`;
  const submitBtn = document.getElementById('match-modal-submit-btn');
  if (submitBtn) submitBtn.textContent = 'Update Match';

  document.getElementById('match-meet-num').value = m.meetNum || m.roundNum || 1;
  document.getElementById('match-number-input').value = m.matchNumber || '';

  document.getElementById('add-match-modal').classList.remove('hidden');
}

function closeAddMatchModal() {
  document.getElementById('add-match-modal').classList.add('hidden');
}

async function handleSaveMatch(event) {
  event.preventDefault();
  const matchId = document.getElementById('match-edit-id').value;
  const divSelect = document.getElementById('match-division-select');
  const division = divSelect ? divSelect.value : getActiveDivisionKey();
  const meetInput = document.getElementById('match-meet-num');
  const meetNum = parseInt(meetInput ? meetInput.value : 1) || 1;
  const matchNumber = document.getElementById('match-number-input').value.trim();
  const teamAId = document.getElementById('match-team-a-select').value;
  const teamBId = document.getElementById('match-team-b-select').value;

  if (!teamAId || !teamBId) {
    alert('Please select both teams for this match.');
    return;
  }

  if (teamAId === teamBId) {
    alert('Please select two different church teams for this match!');
    return;
  }

  const endpoint = matchId ? '/api/matches/update' : '/api/matches/add';
  const payload = {
    matchId,
    division,
    meetNum,
    roundNum: meetNum,
    matchNumber,
    room: '',
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
    if (data.divisionsSummary) {
      if (!state.tbqData) state.tbqData = {};
      state.tbqData.divisionsSummary = data.divisionsSummary;
    }
    if (division !== getActiveDivisionKey()) {
      setActiveDivisionKey(division);
    } else {
      const targetMatchId = matchId || (data.match && data.match.id);
      await fetchTbqData(targetMatchId);
      renderTeamsManagerUI();
    }
    showMatchToast(`✅ Saved Match #${matchNumber} in ${getDivisionDisplayName(division)}!`, 'success');
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
            c.role === 'supercoach'
              ? 'bg-amber-100 text-amber-900 border border-amber-300'
              : (c.role === 'jbq_coach'
                ? 'bg-purple-100 text-purple-900 border border-purple-300'
                : 'bg-emerald-100 text-emerald-900 border border-emerald-300')
          }">
            ${c.role === 'supercoach' ? '👑 Super Coach' : (c.role === 'jbq_coach' ? '🎒 JBQ Coach' : '📖 TBQ Coach')}
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
