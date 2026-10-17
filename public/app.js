/**
 * JBQ Tournament & Match Platform Engine
 * Official Junior Bible Quiz (JBQ) Scoring & Tournament System
 */

const state = {
  auth: null,
  currentTab: 'scoresheet',
  currentLeague: 'jbq',
  currentMeetId: 'jbq-meet-1',
  currentDivision: 'b_level', // 'b_level' | 'c_level'
  platformContext: null,
  publicData: null,
  tbqData: null,
  activeMatchId: null,
  currentSheetId: null,
  mobileScorerTeam: 'teamA',
  scoresheetViewMode: (typeof window !== 'undefined' && window.innerWidth < 768) ? 'feed' : 'table',
  scoreInput: {
    pointValue: 20,
    isInterruption: false,
    isFoul: false,
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
  let loggedInUser = null;

  if (savedToken) {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${savedToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        loggedInUser = data.user;
      } else {
        localStorage.removeItem('tbq_coach_token');
      }
    } catch (e) {
      console.warn('Saved auth token check failed:', e);
    }
  }

  const path = window.location.pathname.toLowerCase();

  // Route: /scoresheet or /scorer (Official Coach Scoring Workspace)
  if (path === '/scoresheet' || path === '/scorer') {
    if (loggedInUser) {
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get('tab');
      const targetTab = (tabParam && ['scoresheet', 'teams', 'coaches', 'standings', 'questions', 'quizzers'].includes(tabParam))
        ? (tabParam === 'standings' ? 'questions' : tabParam)
        : 'scoresheet';
      setLoggedInCoach(savedToken, loggedInUser, targetTab);
    } else {
      // Unauthenticated visitor trying to access scoresheet -> redirect to /login
      window.location.replace('/login');
    }
    return;
  }

  // Route: / or /scores or /dashboard or /standings (Public Scores & Standings Display)
  if (loggedInUser) {
    // Authenticated coach viewing public scoreboard
    setLoggedInCoach(savedToken, loggedInUser, 'questions');
  } else {
    // Public visitor
    setLoggedOutView();
    fetchPublicSummary();
  }
});

// Popstate handler for browser back/forward buttons
window.addEventListener('popstate', () => {
  const p = window.location.pathname.toLowerCase();
  if (p === '/scoresheet' || p === '/scorer') {
    if (!state.auth) {
      window.location.replace('/login');
    } else {
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get('tab');
      switchTab(tabParam || 'scoresheet');
    }
  } else if (p === '/scores' || p === '/' || p === '/dashboard' || p === '/standings') {
    switchTab('questions');
  }
});

function setLoggedInCoach(token, user, initialTab = 'scoresheet') {
  state.auth = { token, user };
  localStorage.setItem('tbq_coach_token', token);
  localStorage.removeItem('tbq_logged_out_explicit');

  const locked = getCoachLockedDivision();
  if (locked) {
    state.currentDivision = locked;
  }

  const loginBtn = document.getElementById('auth-login-btn');
  if (loginBtn) loginBtn.classList.add('hidden');
  const userMenu = document.getElementById('auth-user-menu');
  if (userMenu) userMenu.classList.remove('hidden');
  const coachTabs = document.getElementById('coach-nav-tabs');
  if (coachTabs) coachTabs.classList.remove('hidden');

  // Mobile bottom navigation bar
  const mobNav = document.getElementById('mobile-bottom-nav');
  if (mobNav) mobNav.classList.remove('hidden');

  const nameEl = document.getElementById('auth-user-name');
  if (nameEl) nameEl.textContent = user.name || user.username;

  const roleBadge = document.getElementById('user-role-badge');
  if (roleBadge) {
    roleBadge.classList.remove('hidden');
    if (user.role === 'supercoach') {
      roleBadge.className = 'text-[10px] font-black px-2 py-0.5 rounded-full border bg-amber-400 text-brand-950 border-amber-300';
      roleBadge.textContent = '👑 Super Coach';
    } else {
      roleBadge.className = 'text-[10px] font-black px-2 py-0.5 rounded-full border bg-purple-500/20 text-purple-200 border-purple-400/30';
      roleBadge.textContent = '🎒 JBQ Coach';
    }
  }
  state.currentLeague = 'jbq';

  const coachesTabBtn = document.getElementById('tab-btn-coaches');
  const mobCoachesBtn = document.getElementById('mob-tab-btn-coaches');
  if (coachesTabBtn) coachesTabBtn.classList.remove('hidden');
  if (mobCoachesBtn) mobCoachesBtn.classList.remove('hidden');

  renderPlatformHeader();
  switchTab(initialTab);
  if (initialTab === 'scoresheet') {
    fetchTbqData();
  } else if (initialTab === 'questions' || initialTab === 'standings') {
    fetchPublicSummary();
  }
}

function setLoggedOutView() {
  state.auth = null;
  localStorage.removeItem('tbq_coach_token');
  localStorage.setItem('tbq_logged_out_explicit', '1');

  const loginBtn = document.getElementById('auth-login-btn');
  if (loginBtn) loginBtn.classList.remove('hidden');
  const userMenu = document.getElementById('auth-user-menu');
  if (userMenu) userMenu.classList.add('hidden');
  const coachNavTabs = document.getElementById('coach-nav-tabs');
  if (coachNavTabs) coachNavTabs.classList.add('hidden');
  const roleBadge = document.getElementById('user-role-badge');
  if (roleBadge) roleBadge.classList.add('hidden');

  const mobNav = document.getElementById('mobile-bottom-nav');
  if (mobNav) mobNav.classList.remove('hidden');

  document.getElementById('section-scoresheet').classList.add('hidden');
  document.getElementById('section-teams').classList.add('hidden');
  document.getElementById('section-coaches').classList.add('hidden');
  const secQuizzers = document.getElementById('section-quizzers');
  if (secQuizzers) secQuizzers.classList.add('hidden');
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
  state.auth = null;
  localStorage.removeItem('tbq_coach_token');
  localStorage.setItem('tbq_logged_out_explicit', '1');
  window.location.replace('/login');
}

function handleLogoClick() {
  if (!state.auth) {
    switchTab('questions');
    fetchPublicSummary();
  } else {
    switchTab('scoresheet');
  }
}

function handleScorerTabClick() {
  if (state.auth) {
    switchTab('scoresheet');
  } else {
    window.location.href = '/login';
  }
}

function toggleScoresheetOrScores() {
  if (!state.auth) {
    window.location.href = '/login';
    return;
  }
  if (state.currentTab === 'scoresheet') {
    switchTab('questions');
  } else {
    switchTab('scoresheet');
  }
}

function openCoachLoginModal() {
  window.location.href = '/login';
}

function closeCoachLoginModal() {
  const modal = document.getElementById('coach-login-modal');
  if (modal) modal.classList.add('hidden');
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

    if (!state.currentLeague) state.currentLeague = ctx.activeLeague || 'jbq';
    const lData = ctx[state.currentLeague] || ctx.jbq;
    if (lData) {
      if (!state.currentMeetId || !lData.meets.some(m => m.id === state.currentMeetId)) {
        state.currentMeetId = lData.activeMeetId || lData.meets[0]?.id || 'jbq-meet-1';
      }
      state.currentDivision = lData.activeDivision || 'b_level';
    }

    renderPlatformHeader();
  } catch (err) {
    console.warn('Failed to load platform context:', err);
  }
}

function getCoachLockedDivision() {
  if (!state.auth || !state.auth.user) return null;
  if (state.auth.user.role === 'supercoach') return null;
  if (state.auth.user.lockedDivision) return state.auth.user.lockedDivision;
  if (Array.isArray(state.auth.user.assignedDivisions) && state.auth.user.assignedDivisions.length === 1) {
    return state.auth.user.assignedDivisions[0];
  }
  return null;
}

function getActiveDivisionKey() {
  const locked = getCoachLockedDivision();
  if (locked) return locked === 'c_level' ? 'jbq_c' : 'jbq_b';
  return state.currentDivision === 'c_level' ? 'jbq_c' : 'jbq_b';
}

function getDivisionDisplayName(key) {
  if (key === 'jbq_c' || key === 'c_level') return '🌟 JBQ C-Level (Beginner)';
  return '⚡ JBQ B-Level (Intermediate)';
}

function getDivisionBadgeHtml(key) {
  if (key === 'jbq_c' || key === 'c_level') {
    return '<span class="bg-blue-100 text-blue-900 border border-blue-300 font-extrabold px-2 py-0.5 rounded text-[10px] uppercase">🌟 JBQ C-Level</span>';
  }
  return '<span class="bg-purple-100 text-purple-900 border border-purple-300 font-extrabold px-2 py-0.5 rounded text-[10px] uppercase">⚡ JBQ B-Level</span>';
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
  state.currentLeague = 'jbq';
  const locked = getCoachLockedDivision();
  if (locked) {
    state.currentDivision = locked;
  } else if (divKey === 'jbq_c' || divKey === 'c_level') {
    state.currentDivision = 'c_level';
  } else {
    state.currentDivision = 'b_level';
  }

  if (state.platformContext && state.platformContext.jbq) {
    const lData = state.platformContext.jbq;
    state.currentMeetId = lData.activeMeetId || (lData.meets && lData.meets[0]?.id) || 'jbq-meet-1';
  } else {
    state.currentMeetId = 'jbq-meet-1';
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

  // 1. Brand Logo & Title
  const logoIcon = document.getElementById('brand-logo-icon');
  const leagueBadge = document.getElementById('brand-league-badge');
  const leagueTitle = document.getElementById('brand-league-title');
  const meetSubtitle = document.getElementById('brand-meet-subtitle');

  if (logoIcon) {
    logoIcon.textContent = divKey === 'jbq_c' ? '🌟' : '⚡';
  }
  if (leagueBadge) {
    leagueBadge.textContent = divKey === 'jbq_c' ? 'JBQ C-Level' : 'JBQ B-Level';
  }
  if (leagueTitle) {
    leagueTitle.textContent = 'Junior Bible Quiz';
  }

  // 2. JBQ Division Navigation Switcher
  const btnJbqB = document.getElementById('btn-nav-jbq-b');
  const btnJbqC = document.getElementById('btn-nav-jbq-c');

  const lockedDiv = getCoachLockedDivision();

  if (lockedDiv === 'c_level') {
    // Assigned to C-level: CANNOT switch to B at all!
    if (btnJbqB) btnJbqB.classList.add('hidden');
    if (btnJbqC) {
      btnJbqC.classList.remove('hidden');
      btnJbqC.className = 'px-3 py-1 rounded-lg text-xs font-black bg-amber-400 text-brand-950 shadow-xs flex items-center gap-1 cursor-default';
    }
  } else if (lockedDiv === 'b_level') {
    // Assigned to B-level: CANNOT switch to C at all!
    if (btnJbqC) btnJbqC.classList.add('hidden');
    if (btnJbqB) {
      btnJbqB.classList.remove('hidden');
      btnJbqB.className = 'px-3 py-1 rounded-lg text-xs font-black bg-amber-400 text-brand-950 shadow-xs flex items-center gap-1 cursor-default';
    }
  } else {
    // Super Coach or unassigned / public view: both are visible
    const activeBtnClass = 'px-2.5 sm:px-3 py-1 rounded-lg text-xs font-black transition-all bg-amber-400 text-brand-950 shadow-xs flex items-center gap-1 cursor-pointer';
    const inactiveBtnClass = 'px-2.5 sm:px-3 py-1 rounded-lg text-xs font-bold transition-all text-brand-200 hover:text-white flex items-center gap-1 cursor-pointer';

    if (btnJbqB) {
      btnJbqB.classList.remove('hidden');
      btnJbqB.className = divKey === 'jbq_b' ? activeBtnClass : inactiveBtnClass;
    }
    if (btnJbqC) {
      btnJbqC.classList.remove('hidden');
      btnJbqC.className = divKey === 'jbq_c' ? activeBtnClass : inactiveBtnClass;
    }
  }

  // 3. Meet Dropdown
  const meetSelect = document.getElementById('global-meet-select');
  if (meetSelect && state.platformContext) {
    const lData = state.platformContext.jbq;
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

  // 4. "+ Meet" and "🗑️ Delete" buttons (Visible to all logged-in coaches)
  const createMeetBtn = document.getElementById('btn-create-meet-nav');
  const deleteMeetBtn = document.getElementById('btn-delete-meet-nav');
  if (createMeetBtn) {
    if (state.auth) {
      createMeetBtn.classList.remove('hidden');
    } else {
      createMeetBtn.classList.add('hidden');
    }
  }
  if (deleteMeetBtn) {
    if (state.auth) {
      deleteMeetBtn.classList.remove('hidden');
    } else {
      deleteMeetBtn.classList.add('hidden');
    }
  }

  // Keep jbq-division-bar hidden if exists
  const jbqBar = document.getElementById('jbq-division-bar');
  if (jbqBar) {
    jbqBar.classList.add('hidden');
  }
}

function handleSwitchLeague(league) {
  setActiveDivisionKey(state.currentDivision === 'c_level' ? 'jbq_c' : 'jbq_b');
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
  const locked = getCoachLockedDivision();
  if (locked) {
    setActiveDivisionKey(locked === 'c_level' ? 'jbq_c' : 'jbq_b');
    return;
  }
  setActiveDivisionKey(divKey === 'c_level' ? 'jbq_c' : 'jbq_b');
}

function openCreateMeetModal() {
  const leagueInput = document.getElementById('new-meet-league');
  const titleInput = document.getElementById('new-meet-title');
  const dateInput = document.getElementById('new-meet-date');
  if (leagueInput) leagueInput.value = state.currentLeague || 'jbq';
  if (titleInput) titleInput.value = '';
  if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

  renderMeetsManagerList();
  document.getElementById('create-meet-modal').classList.remove('hidden');
}

function closeCreateMeetModal() {
  document.getElementById('create-meet-modal').classList.add('hidden');
}

function renderMeetsManagerList() {
  const container = document.getElementById('existing-meets-list');
  const countBadge = document.getElementById('meets-count-badge');
  if (!container) return;

  const meets = (state.platformContext && state.platformContext.jbq && state.platformContext.jbq.meets) || [];
  if (countBadge) countBadge.textContent = `${meets.length} Meet${meets.length === 1 ? '' : 's'}`;

  if (meets.length === 0) {
    container.innerHTML = '<div class="p-3 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">No meets configured yet.</div>';
    return;
  }

  let html = '';
  meets.forEach((m) => {
    const isCurrent = m.id === state.currentMeetId;
    const bDiv = (m.divisionsSummary || []).find(d => d.id === 'b_level') || { teamsCount: 0, matchesCount: 0 };
    const cDiv = (m.divisionsSummary || []).find(d => d.id === 'c_level') || { teamsCount: 0, matchesCount: 0 };
    const totalTeams = (bDiv.teamsCount || 0) + (cDiv.teamsCount || 0);
    const totalMatches = (bDiv.matchesCount || 0) + (cDiv.matchesCount || 0);

    html += `
      <div class="p-3 rounded-xl border ${isCurrent ? 'bg-amber-50/70 border-amber-300 ring-1 ring-amber-300' : 'bg-white border-slate-200'} flex items-center justify-between gap-3 transition-all hover:border-slate-300">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="font-black text-sm text-slate-900 truncate">${escapeHtml(m.title)}</span>
            ${isCurrent ? '<span class="text-[9px] font-black uppercase bg-amber-400 text-brand-950 px-1.5 py-0.5 rounded shadow-2xs">✓ Active Meet</span>' : ''}
          </div>
          <div class="text-[11px] text-slate-500 font-medium mt-0.5 flex items-center gap-2 flex-wrap">
            <span>📅 ${escapeHtml(m.date || 'No date set')}</span>
            <span>•</span>
            <span class="font-mono">${totalTeams} Teams</span>
            <span>•</span>
            <span class="font-mono">${totalMatches} Matches</span>
          </div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          ${!isCurrent ? `
            <button type="button" onclick="switchMeetAndCloseModal('${m.id}')" class="text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 transition-colors cursor-pointer">
              Select
            </button>
          ` : ''}
          <button type="button" onclick="handleDeleteMeet('${m.id}', '${escapeHtml(m.title)}')" class="text-xs bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold px-2.5 py-1.5 rounded-lg border border-rose-200 transition-colors flex items-center gap-1 cursor-pointer" title="Delete Meet">
            <span>🗑️ Delete</span>
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function switchMeetAndCloseModal(meetId) {
  closeCreateMeetModal();
  handleMeetChange(meetId);
}

function confirmDeleteCurrentMeet() {
  const meets = (state.platformContext && state.platformContext.jbq && state.platformContext.jbq.meets) || [];
  const currentMeet = meets.find(m => m.id === state.currentMeetId) || { title: 'Current Meet', id: state.currentMeetId };
  handleDeleteMeet(currentMeet.id, currentMeet.title);
}

async function handleDeleteMeet(meetId, title) {
  const meets = (state.platformContext && state.platformContext.jbq && state.platformContext.jbq.meets) || [];
  const isOnlyMeet = meets.length <= 1;
  const promptMsg = isOnlyMeet
    ? `Are you sure you want to delete "${title}"? This is the only meet configured. A fresh clean meet will be initialized.`
    : `Are you sure you want to permanently delete the meet "${title}"?\n\nThis will permanently delete all teams, matches, and scores in this meet.`;

  if (!confirm(promptMsg)) return;
  await deleteMeetById(meetId, title);
}

async function deleteMeetById(meetId, title) {
  try {
    const res = await authFetch('/api/meets/delete', {
      method: 'POST',
      body: JSON.stringify({ meetId })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to delete meet.');
      return;
    }

    state.currentMeetId = data.activeMeetId;
    await fetchPlatformContext();
    renderMeetsManagerList();

    if (state.auth) {
      fetchTeamsByDivision();
      await fetchTbqData(null);
      if (state.currentTab === 'teams') {
        renderTeamsManagerUI();
      } else if (state.currentTab === 'scoresheet') {
        renderOfficialScoresheet();
      }
    } else {
      await fetchPublicSummary();
    }

    showMatchToast(`🗑️ Meet "${title || meetId}" deleted successfully.`, 'info');
  } catch (err) {
    alert('Error deleting meet.');
  }
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
      fetchTeamsByDivision();
      await fetchTbqData(null);
      if (state.currentTab === 'teams') {
        renderTeamsManagerUI();
      } else if (state.currentTab === 'scoresheet') {
        renderOfficialScoresheet();
      }
    } else {
      await fetchPublicSummary();
    }
    showMatchToast(`➕ Created meet "${title}"!`, 'success');
  } catch (err) {
    alert('Network error while creating meet.');
  }
}

// Tab Switching
function switchTab(tab) {
  // If attempting to access coach-only areas without active session, redirect to /login
  if ((tab === 'scoresheet' || tab === 'teams' || tab === 'coaches' || tab === 'quizzers') && !state.auth) {
    window.location.href = '/login';
    return;
  }

  state.currentTab = tab;

  const isQuestions = tab === 'questions' || tab === 'standings';
  document.getElementById('section-public').classList.toggle('hidden', !isQuestions);
  document.getElementById('section-scoresheet').classList.toggle('hidden', tab !== 'scoresheet');
  document.getElementById('section-teams').classList.toggle('hidden', tab !== 'teams');
  document.getElementById('section-coaches').classList.toggle('hidden', tab !== 'coaches');
  const secQuizzers = document.getElementById('section-quizzers');
  if (secQuizzers) secQuizzers.classList.toggle('hidden', tab !== 'quizzers');

  // Update top header button if present
  const toggleIcon = document.getElementById('nav-toggle-scoresheet-icon');
  const toggleText = document.getElementById('nav-toggle-scoresheet-text');
  if (toggleIcon && toggleText) {
    if (tab === 'scoresheet') {
      toggleIcon.textContent = '🏆';
      toggleText.textContent = 'Scores';
    } else {
      toggleIcon.textContent = '⚡';
      toggleText.textContent = 'Scorer';
    }
  }

  // Sync URL history cleanly
  try {
    const currentPath = window.location.pathname.toLowerCase();
    if (tab === 'scoresheet' && currentPath !== '/scoresheet') {
      window.history.pushState({ tab: 'scoresheet' }, '', '/scoresheet');
    } else if (isQuestions && currentPath !== '/scores' && currentPath !== '/') {
      window.history.pushState({ tab: 'questions' }, '', '/scores');
    } else if (tab === 'teams') {
      window.history.pushState({ tab: 'teams' }, '', '/scoresheet?tab=teams');
    } else if (tab === 'coaches') {
      window.history.pushState({ tab: 'coaches' }, '', '/scoresheet?tab=coaches');
    } else if (tab === 'quizzers') {
      window.history.pushState({ tab: 'quizzers' }, '', '/scoresheet?tab=quizzers');
    }
  } catch (e) {}

  const activeClass = 'bg-brand-600 text-white shadow-sm';
  const inactiveClass = 'text-brand-200 hover:text-white hover:bg-brand-800/60';

  const tabScoresheet = document.getElementById('tab-btn-scoresheet');
  const tabQuizzers = document.getElementById('tab-btn-quizzers');
  const tabTeams = document.getElementById('tab-btn-teams');
  const tabCoaches = document.getElementById('tab-btn-coaches');

  if (tabScoresheet) tabScoresheet.className = `px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${tab === 'scoresheet' ? activeClass : inactiveClass}`;
  if (tabQuizzers) tabQuizzers.className = `px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${tab === 'quizzers' ? activeClass : inactiveClass}`;
  if (tabTeams) tabTeams.className = `px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${tab === 'teams' ? activeClass : inactiveClass}`;
  if (tabCoaches) tabCoaches.className = `px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${tab === 'coaches' ? 'bg-amber-500 text-brand-950 shadow-sm' : 'text-amber-300 hover:text-amber-100 hover:bg-brand-800/60'}`;

  // Sync mobile bottom navigation
  const mobScoresheet = document.getElementById('mob-tab-btn-scoresheet');
  const mobStandings = document.getElementById('mob-tab-btn-standings');
  const mobQuizzers = document.getElementById('mob-tab-btn-quizzers');
  const mobTeams = document.getElementById('mob-tab-btn-teams');
  const mobCoaches = document.getElementById('mob-tab-btn-coaches');

  const mobActive = 'text-amber-400 font-black';
  const mobInactive = 'text-slate-400 font-bold hover:text-white';

  if (mobScoresheet) mobScoresheet.className = `flex flex-col items-center justify-center py-1.5 px-2 rounded-xl text-xs transition-all cursor-pointer ${tab === 'scoresheet' ? mobActive : mobInactive}`;
  if (mobStandings) mobStandings.className = `flex flex-col items-center justify-center py-1.5 px-2 rounded-xl text-xs transition-all cursor-pointer ${isQuestions ? mobActive : mobInactive}`;
  if (mobQuizzers) mobQuizzers.className = `flex flex-col items-center justify-center py-1.5 px-2 rounded-xl text-xs transition-all cursor-pointer ${tab === 'quizzers' ? mobActive : mobInactive}`;
  if (mobTeams) mobTeams.className = `flex flex-col items-center justify-center py-1.5 px-2 rounded-xl text-xs transition-all cursor-pointer ${tab === 'teams' ? mobActive : mobInactive}`;
  if (mobCoaches) mobCoaches.className = `flex flex-col items-center justify-center py-1.5 px-2 rounded-xl text-xs transition-all cursor-pointer ${tab === 'coaches' ? mobActive : mobInactive}`;

  if (isQuestions) fetchPublicSummary();
  if (tab === 'scoresheet') fetchTbqData(state.activeMatchId);
  if (tab === 'quizzers') fetchQuizzersStats();
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

  document.getElementById('public-meet-title').textContent = title || 'Junior Bible Quiz (JBQ) Tournament 2026';

  // Sync public division switcher tabs
  const currentDiv = getActiveDivisionKey();
  const pubJbqB = document.getElementById('pub-tab-jbq-b');
  const pubJbqC = document.getElementById('pub-tab-jbq-c');
  const lockedDiv = getCoachLockedDivision();

  if (lockedDiv === 'c_level') {
    if (pubJbqB) pubJbqB.classList.add('hidden');
    if (pubJbqC) {
      pubJbqC.classList.remove('hidden');
      pubJbqC.className = 'px-3 py-1.5 rounded-xl text-xs font-black bg-amber-400 text-brand-950 shadow-xs flex items-center gap-1.5 whitespace-nowrap cursor-default';
    }
  } else if (lockedDiv === 'b_level') {
    if (pubJbqC) pubJbqC.classList.add('hidden');
    if (pubJbqB) {
      pubJbqB.classList.remove('hidden');
      pubJbqB.className = 'px-3 py-1.5 rounded-xl text-xs font-black bg-amber-400 text-brand-950 shadow-xs flex items-center gap-1.5 whitespace-nowrap cursor-default';
    }
  } else {
    if (pubJbqB) pubJbqB.classList.remove('hidden');
    if (pubJbqC) pubJbqC.classList.remove('hidden');
    const pubActive = 'px-3 py-1.5 rounded-xl text-xs font-black transition-all bg-amber-400 text-brand-950 shadow-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer';
    const pubInactive = 'px-3 py-1.5 rounded-xl text-xs font-bold transition-all text-white/80 hover:text-white flex items-center gap-1.5 whitespace-nowrap cursor-pointer';

    if (pubJbqB) pubJbqB.className = currentDiv === 'jbq_b' ? pubActive : pubInactive;
    if (pubJbqC) pubJbqC.className = currentDiv === 'jbq_c' ? pubActive : pubInactive;
  }

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
    if (m.isCompleted) {
      if (m.winner === 'teamA') {
        resultBadge = `<span class="bg-emerald-100 text-emerald-800 font-black px-2.5 py-1 rounded-full text-xs border border-emerald-300">🏆 ${escapeHtml(m.teamAName)} WON</span>`;
      } else if (m.winner === 'teamB') {
        resultBadge = `<span class="bg-rose-100 text-rose-800 font-black px-2.5 py-1 rounded-full text-xs border border-rose-300">🏆 ${escapeHtml(m.teamBName)} WON</span>`;
      } else if (m.winner === 'tie' && m.totalQuestions > 0) {
        resultBadge = `<span class="bg-amber-100 text-amber-800 font-black px-2.5 py-1 rounded-full text-xs border border-amber-300">⚖️ TIED MATCH</span>`;
      } else {
        resultBadge = `<span class="bg-slate-100 text-slate-700 font-black px-2.5 py-1 rounded-full text-xs border border-slate-300">🏁 COMPLETED</span>`;
      }
    } else if (m.totalQuestions > 0) {
      resultBadge = `<span class="bg-amber-100 text-amber-800 font-bold px-2.5 py-1 rounded-full text-xs border border-amber-200">⏳ In Progress (${m.completedQuestionsCount || m.totalQuestions}/20 Qs)</span>`;
    } else {
      resultBadge = `<span class="bg-slate-100 text-slate-600 font-bold px-2.5 py-1 rounded-full text-xs border border-slate-200">⏳ Scheduled</span>`;
    }

    const isSuperCoach = state.auth && state.auth.user && state.auth.user.role === 'supercoach';
    const audit = m.audit;

    let auditNoticeHtml = '';
    if (audit) {
      if (audit.status === 'single_coach') {
        // Blindly use the single active coach's sheet
        auditNoticeHtml = `
          <div class="mt-2 text-[11px] font-bold text-slate-500 flex items-center gap-1.5">
            <span class="inline-block w-2 h-2 rounded-full ${m.isCompleted ? 'bg-emerald-500' : 'bg-amber-400'}"></span>
            <span>Scored by Coach ${escapeHtml(audit.officialCoachName || 'Coach')}${m.isCompleted ? ' (Official Final)' : ' (In Progress)'}</span>
          </div>
        `;
      } else if (audit.status === 'aligned') {
        auditNoticeHtml = `
          <div class="mt-2 text-[11px] font-bold text-emerald-700 bg-emerald-50/80 px-2 py-1 rounded-lg border border-emerald-200/60 flex items-center gap-1.5">
            <span>✅</span>
            <span>Both Coaches Agree (${(audit.scoredSheets || []).map(s => escapeHtml(s.coachName)).join(' & ')})${m.isCompleted ? ' • Official Final' : ''}</span>
          </div>
        `;
      } else if (audit.status === 'resolved') {
        auditNoticeHtml = `
          <div class="mt-2 text-[11px] font-bold text-purple-700 bg-purple-50/80 px-2.5 py-1.5 rounded-xl border border-purple-200/60 flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-1.5">
              <span>👑</span>
              <span>Official: Coach ${escapeHtml(audit.officialCoachName || 'Official')}</span>
            </div>
            ${isSuperCoach ? `
              <div class="flex items-center gap-1 flex-wrap">
                <span class="text-[9px] font-black uppercase text-purple-600">Switch:</span>
                ${(audit.scoredSheets || []).map(s => `
                  <button onclick="setOfficialSheet('${m.id}', '${s.sheetId}')" class="text-[10px] font-extrabold ${s.sheetId === audit.officialSheetId ? 'bg-purple-700 text-white' : 'bg-white text-slate-700 hover:bg-purple-100 border border-purple-200'} px-2 py-0.5 rounded-md transition-all cursor-pointer">
                    ${escapeHtml(s.coachName)} (${s.teamAScore}-${s.teamBScore})
                  </button>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `;
      } else if (audit.status === 'mismatch') {
        auditNoticeHtml = `
          <div class="mt-2.5 text-xs font-bold bg-amber-50 border border-amber-300 rounded-xl p-2.5 text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-2xs">
            <div class="flex items-center gap-2">
              <span class="text-base flex-shrink-0">⚠️</span>
              <div>
                <div class="font-black text-amber-900">Score Mismatch Between Coaches</div>
                <div class="text-[11px] font-normal text-amber-800">
                  ${(audit.scoredSheets || []).map(s => `<strong>${escapeHtml(s.coachName)}:</strong> ${s.teamAScore}-${s.teamBScore}`).join(' • ')}
                </div>
              </div>
            </div>
            ${isSuperCoach ? `
              <div class="flex items-center gap-1.5 flex-wrap pt-1 sm:pt-0 border-t border-amber-200 sm:border-t-0">
                <span class="text-[10px] font-black uppercase text-amber-900 whitespace-nowrap">Choose Official:</span>
                ${(audit.scoredSheets || []).map(s => `
                  <button onclick="setOfficialSheet('${m.id}', '${s.sheetId}')" class="text-xs font-black bg-amber-400 hover:bg-amber-300 active:scale-95 text-brand-950 px-2.5 py-1 rounded-lg border border-amber-500 shadow-2xs flex items-center gap-1 cursor-pointer">
                    <span>👑 Use ${escapeHtml(s.coachName)} (${s.teamAScore}-${s.teamBScore})</span>
                  </button>
                `).join('')}
              </div>
            ` : `
              <span class="text-[10px] font-extrabold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-200">Awaiting Super Coach Resolution</span>
            `}
          </div>
        `;
      }
    }

    matchesHtml += `
      <div class="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 hover:bg-white transition-all flex flex-col gap-2">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-brand-900 text-white flex items-center justify-center font-black text-sm font-mono-score">
              M#${m.matchNumber}
            </div>
            <div>
              <div class="text-xs font-black uppercase text-slate-800 tracking-wider">
                Match #${m.matchNumber}
              </div>
              <div class="text-sm sm:text-base font-bold text-slate-800 mt-0.5">
                <span>${escapeHtml(m.teamAName)}</span>
                <span class="text-slate-400 font-normal"> vs </span>
                <span>${escapeHtml(m.teamBName)}</span>
              </div>
            </div>
          </div>

          <div class="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto pt-2 sm:pt-0 border-t border-slate-200/50 sm:border-t-0">
            ${m.isCompleted ? `
              <div class="font-mono-score font-black text-base sm:text-lg text-slate-900">
                <span class="${m.teamAScore > m.teamBScore ? 'text-brand-700' : 'text-slate-700'}">${m.teamAScore}</span>
                <span class="text-slate-300 mx-1">-</span>
                <span class="${m.teamBScore > m.teamAScore ? 'text-rose-600' : 'text-slate-700'}">${m.teamBScore}</span>
              </div>
            ` : `
              <div class="font-mono-score text-xs font-black ${m.totalQuestions > 0 ? 'text-amber-800 bg-amber-50 border border-amber-200' : 'text-slate-400 bg-slate-100 border border-slate-200'} px-2.5 py-1 rounded-xl whitespace-nowrap">
                ${m.totalQuestions > 0 ? '⚡ Scoring Live' : '— - —'}
              </div>
            `}
            <div>
              ${resultBadge}
            </div>
          </div>
        </div>
        ${auditNoticeHtml}
      </div>
    `;
  });
  matchesListEl.innerHTML = matchesHtml || '<div class="text-slate-400 text-center py-4">No matches scheduled yet.</div>';
}



async function fetchTbqData(matchId, sheetId) {
  if (!state.auth) return;

  const effectiveSheetId = sheetId || state.currentSheetId || '';
  const params = new URLSearchParams();
  if (matchId) params.set('matchId', matchId);
  if (effectiveSheetId) params.set('sheetId', effectiveSheetId);

  const url = params.toString() ? `/api/tbq?${params.toString()}` : '/api/tbq';
  try {
    const res = await authFetch(url);
    if (!res.ok) throw new Error();
    const data = await res.json();
    state.tbqData = data;
    state.activeMatchId = data.activeMatchId;
    if (data.activeRound && data.activeRound.sheetId) {
      state.currentSheetId = data.activeRound.sheetId;
    }
    try {
      localStorage.setItem('tbq_backup_scores', JSON.stringify(data));
    } catch (e) {}
    if (state.currentTab === 'teams') {
      renderTeamsManagerUI();
    }
    renderOfficialScoresheet();
  } catch (err) {
    console.error('Error fetching scoresheet:', err);
  }
}

function handleCoachSheetChange(sheetId) {
  state.currentSheetId = sheetId;
  fetchTbqData(state.activeMatchId, sheetId);
}

async function setOfficialSheet(matchId, sheetId) {
  if (!confirm('Designate this coach sheet as the official result for this match? This will update tournament standings and results.')) return;
  try {
    const res = await authFetch('/api/matches/set-official-sheet', {
      method: 'POST',
      body: JSON.stringify({ matchId, sheetId })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to designate official sheet.');
      return;
    }
    showMatchToast(`👑 Designated official scoresheet for Match #${data.matchId}`, 'success');
    await fetchPublicSummary();
    if (state.activeMatchId === matchId) {
      await fetchTbqData(matchId, sheetId);
    }
  } catch (err) {
    console.error('Error setting official sheet:', err);
    alert('Failed to set official sheet.');
  }
}

async function handlePromoteCurrentSheetToOfficial() {
  if (!state.activeMatchId || !state.currentSheetId) return;
  await setOfficialSheet(state.activeMatchId, state.currentSheetId);
}

async function skipRebound(qNum) {
  try {
    const res = await authFetch('/api/tbq/skip-rebound', {
      method: 'POST',
      body: JSON.stringify({
        matchId: state.activeMatchId,
        questionNum: qNum,
        sheetId: state.currentSheetId
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
      container.appendChild(emptyEl);
    }

    const isSuper = state.auth && state.auth.user && state.auth.user.role === 'supercoach';
    const coachName = state.auth?.user?.name || state.auth?.user?.username || 'Coach';

    if (!isSuper) {
      emptyEl.innerHTML = `
        <div class="text-4xl mb-2">🎒</div>
        <h3 class="text-lg font-black text-slate-800">No Matches for Your Team Yet</h3>
        <p class="text-xs text-slate-500 max-w-sm mx-auto">
          Hello <strong>${escapeHtml(coachName)}</strong>! No matches are currently scheduled for your assigned team(s) in this division.
        </p>
        <p class="text-[11px] text-slate-400 max-w-xs mx-auto">
          If no team is assigned to your account yet, please ask the Super Coach to assign your team in Teams & Matches.
        </p>
        <div class="flex items-center justify-center gap-3 pt-2">
          <button type="button" onclick="switchTab('questions')" class="px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-brand-950 font-black text-xs shadow-xs transition-all">
            🏆 View Tournament Standings
          </button>
        </div>
      `;
    } else {
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
  const countBadge = document.getElementById('matches-count-badge');
  if (countBadge) {
    const totalM = (matchesList || []).length;
    countBadge.textContent = `${totalM} Match${totalM === 1 ? '' : 'es'}`;
  }

  let pillsHtml = '';
  (matchesList || []).forEach(m => {
    const isActive = m.id === state.activeMatchId;
    const isDone = m.isCompleted || m.status === 'Completed';
    const statusIcon = isDone ? '🏁' : '⚡';
    const tA = m.teamAName || 'Left Team';
    const tB = m.teamBName || 'Right Team';
    pillsHtml += `
      <button onclick="fetchTbqData('${m.id}')" class="px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer flex-shrink-0 active:scale-95 shadow-2xs ${
        isActive 
          ? 'bg-amber-400 text-slate-950 font-black shadow-md ring-2 ring-amber-300' 
          : (isDone 
              ? 'bg-emerald-50 text-emerald-950 border border-emerald-300 hover:bg-emerald-100' 
              : 'bg-slate-100 text-slate-800 border border-slate-200 hover:bg-slate-200 hover:text-slate-950')
      }">
        <span class="font-black">${statusIcon} M#${m.matchNumber}</span>
        <span class="text-[11px] font-semibold opacity-80">(${escapeHtml(tA)} vs ${escapeHtml(tB)})</span>
        ${isDone ? '<span class="text-[9px] bg-emerald-200 text-emerald-950 px-1.5 py-0.2 rounded font-black">FINAL</span>' : ''}
      </button>
    `;
  });
  if (pillsBar) pillsBar.innerHTML = pillsHtml || '<span class="text-xs text-slate-400 py-1">No matches scheduled in this division</span>';

  // 2. Header Metadata
  const divMetaEl = document.getElementById('scoresheet-meta-division');
  if (divMetaEl) {
    const curDiv = getActiveDivisionKey();
    divMetaEl.textContent = curDiv === 'jbq_c' ? '🌟 JBQ C-Level' : '⚡ JBQ B-Level';
  }
  document.getElementById('meta-match-num').textContent = activeRound.matchNumber || "01";
  document.getElementById('print-match-num').textContent = activeRound.matchNumber || "01";
  const superBadge = document.getElementById('super-header-badge');
  if (superBadge) superBadge.textContent = `Match #${activeRound.matchNumber || "01"}`;

  // 3. Teams Scoreboard Strip
  document.getElementById('scoresheet-home-name').textContent = activeRound.teamA.name;
  document.getElementById('scoresheet-opp-name').textContent = activeRound.teamB.name;
  document.getElementById('scoresheet-home-total').textContent = activeRound.teamA.finalScore || 0;
  document.getElementById('scoresheet-opp-total').textContent = activeRound.teamB.finalScore || 0;

  const regA = activeRound.teamA.regulationScore !== undefined ? activeRound.teamA.regulationScore : (activeRound.teamA.runningScore || 0);
  const regB = activeRound.teamB.regulationScore !== undefined ? activeRound.teamB.regulationScore : (activeRound.teamB.runningScore || 0);
  const foulA = activeRound.teamA.foulPenalty !== undefined ? activeRound.teamA.foulPenalty : (activeRound.teamA.foulPenaltyPoints || 0);
  const foulB = activeRound.teamB.foulPenalty !== undefined ? activeRound.teamB.foulPenalty : (activeRound.teamB.foulPenaltyPoints || 0);

  document.getElementById('home-bonus-badge').textContent = foulA > 0 ? `Reg: ${regA} | Bon: +${activeRound.teamA.bonusPoints || 0} | Foul: -${foulA}` : `Reg: ${regA} | Bon: +${activeRound.teamA.bonusPoints || 0}`;
  document.getElementById('opp-bonus-badge').textContent = foulB > 0 ? `Reg: ${regB} | Bon: +${activeRound.teamB.bonusPoints || 0} | Foul: -${foulB}` : `Reg: ${regB} | Bon: +${activeRound.teamB.bonusPoints || 0}`;

  // 3b. Coach Sheet Selector Dropdown & Badge
  const sheetSelect = document.getElementById('coach-sheet-select');
  const sheetBadge = document.getElementById('coach-sheet-badge');
  if (sheetSelect && activeRound.availableSheets) {
    const curSheetId = activeRound.sheetId || 'default';
    state.currentSheetId = curSheetId;
    let opts = '';
    activeRound.availableSheets.forEach(s => {
      const isSel = s.id === curSheetId;
      opts += `<option value="${s.id}" ${isSel ? 'selected' : ''}>${escapeHtml(s.label)}</option>`;
    });
    sheetSelect.innerHTML = opts;

    if (sheetBadge) {
      const isMySheet = state.auth?.user && (curSheetId === state.auth.user.id || curSheetId === state.auth.user.username);
      if (isMySheet) {
        sheetBadge.className = 'text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 whitespace-nowrap';
        sheetBadge.textContent = '🟢 My Sheet';
      } else if (curSheetId === 'default') {
        sheetBadge.className = 'text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 whitespace-nowrap';
        sheetBadge.textContent = '⭐ Official Master';
      } else {
        sheetBadge.className = 'text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-100 text-blue-900 border border-blue-300 whitespace-nowrap';
        sheetBadge.textContent = `👀 ${activeRound.sheetCoachName || 'Coach'}`;
      }
    }

    const promoteBtn = document.getElementById('btn-promote-official-sheet');
    if (promoteBtn) {
      const isSuper = state.auth?.user && state.auth.user.role === 'supercoach';
      const isAlreadyOfficial = (curSheetId === 'default') || (activeRound.audit && curSheetId === activeRound.audit.officialSheetId);
      if (isSuper && curSheetId !== 'default' && !isAlreadyOfficial) {
        promoteBtn.classList.remove('hidden');
        promoteBtn.textContent = `👑 Set as Official`;
      } else {
        promoteBtn.classList.add('hidden');
      }
    }

    const discBanner = document.getElementById('match-discrepancy-banner');
    if (discBanner) {
      if (activeRound.audit && activeRound.audit.status === 'mismatch') {
        discBanner.classList.remove('hidden');
        const scoresStr = (activeRound.audit.scoredSheets || []).map(s => `<strong>${escapeHtml(s.coachName)}:</strong> ${s.teamAScore}-${s.teamBScore}`).join(' • ');
        discBanner.innerHTML = `
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-1.5">
              <span class="text-sm">⚠️</span>
              <div>
                <span class="font-black text-amber-900">Score Mismatch:</span>
                <span class="text-[11px] text-amber-800 ml-1">${scoresStr}</span>
              </div>
            </div>
            ${state.auth?.user?.role === 'supercoach' ? `
              <button type="button" onclick="handlePromoteCurrentSheetToOfficial()" class="text-[10px] font-black bg-amber-400 hover:bg-amber-300 active:scale-95 text-brand-950 px-2 py-1 rounded-lg border border-amber-500 shadow-2xs cursor-pointer">
                👑 Use Current Sheet as Official
              </button>
            ` : ''}
          </div>
        `;
      } else {
        discBanner.classList.add('hidden');
      }
    }
  }

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
        <th colspan="2" class="p-2.5 border-r border-slate-800 bg-slate-950 sticky-head-q" id="super-header-badge">Match #${activeRound.matchNumber || "01"}</th>
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
    directCorrectBtn.innerHTML = `<span>✅ CORRECT (+${pts})</span>`;
  }

  const directIncorrectBtn = document.getElementById('btn-direct-incorrect');
  if (directIncorrectBtn) {
    if (isInterruption) {
      directIncorrectBtn.innerHTML = `<span>❌ ERROR (-${penaltyPts}⚡)</span>`;
    } else {
      directIncorrectBtn.innerHTML = `<span>❌ ERROR (-${penaltyPts})</span>`;
    }
  }

  // Update Foul submit button labels
  const foulSubmitLabel = document.getElementById('btn-submit-foul-label');
  if (foulSubmitLabel) {
    foulSubmitLabel.textContent = `RECORD FOUL FOR ${quizzer.toUpperCase()} (-5 PTS)`;
  }
  const quickFoulLabel = document.getElementById('btn-quick-foul-label');
  if (quickFoulLabel) {
    quickFoulLabel.textContent = `Quick Foul for ${quizzer} (-5 pts • 0 Errors)`;
  }

  // Update legacy submit button if present
  const submitBtn = document.getElementById('score-submit-btn');
  if (submitBtn) {
    if (state.scoreInput.isCorrect) {
      submitBtn.className = 'col-span-2 sm:col-span-1 bg-brand-600 hover:bg-brand-700 active:scale-98 text-white font-black py-3 px-4 rounded-xl text-xs sm:text-sm shadow-md shadow-brand-600/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer';
      submitBtn.innerHTML = `<span>Record for ${escapeHtml(quizzer)} (+${pts} pts) ⚡</span>`;
    } else {
      submitBtn.className = 'col-span-2 sm:col-span-1 bg-rose-600 hover:bg-rose-700 active:scale-98 text-white font-black py-3 px-4 rounded-xl text-xs sm:text-sm shadow-md shadow-rose-600/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer';
      submitBtn.innerHTML = `<span>Record Error for ${escapeHtml(quizzer)} (-${penaltyPts} pts) ❌</span>`;
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
      btn.className = 'w-full py-2 px-1 rounded-xl border-2 border-amber-500 bg-amber-400 text-slate-950 font-black text-xs flex items-center justify-center shadow-md cursor-pointer transition-all active:scale-95 text-center truncate';
      btn.innerHTML = '<span>⚡ Int: YES</span>';
    } else {
      btn.className = 'w-full py-2 px-1 rounded-xl border border-slate-300 bg-white text-slate-700 font-bold text-xs flex items-center justify-center hover:bg-slate-100 cursor-pointer transition-all active:scale-95 shadow-2xs text-center truncate';
      btn.innerHTML = '<span class="text-slate-500">⚡ No Int</span>';
    }
  }
  updateSubmitButtonLabel();
}

function toggleFoul(forceVal) {
  const checkbox = document.getElementById('score-is-foul');
  let newVal = typeof forceVal === 'boolean' ? forceVal : (checkbox ? !checkbox.checked : true);
  if (checkbox) checkbox.checked = newVal;
  state.scoreInput.isFoul = newVal;

  const btn = document.getElementById('btn-toggle-foul');
  if (btn) {
    if (newVal) {
      btn.className = 'w-full py-2 px-1 rounded-xl border-2 border-rose-600 bg-rose-600 text-white font-black text-xs flex items-center justify-center shadow-md cursor-pointer transition-all active:scale-95 text-center truncate';
      btn.innerHTML = '<span>🚩 Foul: YES (-5)</span>';
    } else {
      btn.className = 'w-full py-2 px-1 rounded-xl border border-slate-300 bg-white text-slate-700 font-bold text-xs flex items-center justify-center hover:bg-slate-100 cursor-pointer transition-all active:scale-95 shadow-2xs text-center truncate';
      btn.innerHTML = '<span class="text-slate-500">🚩 No Foul</span>';
    }
  }

  const standardBtns = document.getElementById('standard-answer-buttons');
  const foulBtns = document.getElementById('foul-answer-buttons');
  if (newVal) {
    if (standardBtns) standardBtns.classList.add('hidden');
    if (foulBtns) foulBtns.classList.remove('hidden');
  } else {
    if (standardBtns) standardBtns.classList.remove('hidden');
    if (foulBtns) foulBtns.classList.add('hidden');
  }
  updateSubmitButtonLabel();
}

async function recordFoul() {
  if (state.tbqData?.activeRound?.isCompleted) {
    showMatchToast('🏁 This match is already completed.', 'warning');
    return;
  }

  const team = state.scoreInput.team || 'teamA';
  const quizzer = state.scoreInput.quizzer || '';
  if (!quizzer) {
    alert('Please tap to select a student before recording a foul.');
    return;
  }

  const currentQNum = state.tbqData?.activeRound?.pendingQuestionNum || parseInt(document.getElementById('score-question-num')?.value) || 1;
  const teamName = team === 'teamA' ? (state.tbqData?.activeRound?.teamA?.name || 'Left Table') : (state.tbqData?.activeRound?.teamB?.name || 'Right Table');

  try {
    const res = await authFetch('/api/tbq/foul', {
      method: 'POST',
      body: JSON.stringify({
        matchId: state.activeMatchId,
        team,
        quizzer,
        questionNum: currentQNum,
        reason: `Foul on ${quizzer} (-5)`,
        penalty: 5,
        sheetId: state.currentSheetId
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to record foul.');
      return;
    }

    // Reset foul toggle back to false
    toggleFoul(false);

    state.tbqData.activeRound = data.activeRound;
    renderOfficialScoresheet();

    showMatchToast(`🚩 Foul (-5 pts) recorded for ${quizzer} (${teamName}). Error count unaffected (0 errors added).`, 'warning');
  } catch (err) {
    alert('Error recording foul: ' + err.message);
  }
}

async function deleteFoul(team, foulId) {
  if (!confirm('Remove this foul penalty (-5 pts)?')) return;
  try {
    const res = await authFetch('/api/tbq/foul', {
      method: 'POST',
      body: JSON.stringify({
        matchId: state.activeMatchId,
        team,
        action: 'delete',
        foulId,
        sheetId: state.currentSheetId
      })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to remove foul.');
      return;
    }
    state.tbqData.activeRound = data.activeRound;
    renderOfficialScoresheet();
    showMatchToast('🚩 Foul removed successfully.', 'info');
  } catch (err) {
    alert('Error removing foul.');
  }
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
      body: JSON.stringify({ matchId: state.activeMatchId, sheetId: state.currentSheetId })
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
      body: JSON.stringify({ matchId: state.activeMatchId, sheetId: state.currentSheetId })
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
      statusHtml = `<span class="text-amber-900 font-black">${stat.errors === 0 ? '⭐ PERFECT QO (+10)' : '🎉 QUIZ OUT (+0)'}</span>`;
    } else if (isEO) {
      statusHtml = `<span class="text-rose-700 font-black">❌ ERRORED OUT (3/3)</span>`;
    } else {
      const cStyle = isSelected ? 'text-emerald-100 font-black' : 'text-emerald-700 font-black';
      const eStyle = stat.errors > 0 ? (isSelected ? 'text-rose-200 font-black underline' : 'text-rose-600 font-black') : (isSelected ? 'text-slate-200' : 'text-slate-500');
      const foulBadge = (stat.fouls > 0) ? ` • <span class="${isSelected ? 'text-amber-200' : 'text-amber-700'} font-black" title="${stat.fouls} Fouls (-${stat.fouls * 5} pts)">🚩 ${stat.fouls}</span>` : '';
      statusHtml = `<span class="${cStyle}">✅ ${stat.correct}/6</span> • <span class="${eStyle}">❌ ${stat.errors}/3</span>${foulBadge}`;

      if (stat.correct === 5 && stat.errors === 2) {
        extraWarning = '<div class="text-[9px] font-black text-amber-900 bg-amber-200 rounded px-1 mt-0.5 animate-pulse text-center">⚠️ 1 to QO • 1 to EO</div>';
      } else if (stat.correct === 5) {
        extraWarning = '<div class="text-[9px] font-black text-amber-900 bg-amber-200 rounded px-1 mt-0.5 text-center">⚠️ 1 more to QO</div>';
      } else if (stat.errors === 2) {
        extraWarning = '<div class="text-[9px] font-black text-rose-900 bg-rose-200 rounded px-1 mt-0.5 text-center">⚠️ 1 error to EO</div>';
      }
    }

    const selectedStyle = team === 'teamA'
      ? 'bg-brand-600 border-brand-700 text-white shadow-md ring-2 ring-brand-400'
      : 'bg-rose-600 border-rose-700 text-white shadow-md ring-2 ring-rose-400';

    const unselectedStyle = team === 'teamA'
      ? 'bg-white border-brand-200 text-slate-800 hover:border-brand-400 hover:bg-brand-50/60 shadow-2xs'
      : 'bg-white border-rose-200 text-slate-800 hover:border-rose-400 hover:bg-rose-50/60 shadow-2xs';

    return `
      <button type="button" ${isDisabled ? 'disabled' : ''} onclick="selectStudent('${team}', '${escapeHtml(name)}')" class="w-full p-2 rounded-xl text-left border-2 transition-all flex flex-col justify-between cursor-pointer active:scale-95 ${
        isQO 
          ? 'bg-amber-50/80 border-amber-300 text-amber-950 opacity-80 cursor-not-allowed' 
          : isEO
            ? 'bg-rose-50/80 border-rose-300 text-rose-950 opacity-80 cursor-not-allowed line-through'
            : isSelected 
              ? selectedStyle 
              : unselectedStyle
      }">
        <div class="flex items-center justify-between gap-1 w-full">
          <span class="font-extrabold text-xs sm:text-sm truncate ${isSelected ? 'text-white' : 'text-slate-900'}">
            ${escapeHtml(name)}
          </span>
          <div class="flex items-center gap-1 flex-shrink-0">
            <span class="text-[10px] font-black px-1.5 py-0.2 rounded font-mono-score ${isSelected ? 'bg-white/20 text-white' : (team === 'teamA' ? 'bg-brand-100 text-brand-900' : 'bg-rose-100 text-rose-900')}">
              ${stat.points}p
            </span>
            ${isSelected ? '<span class="text-[9px] font-black bg-white ' + (team === 'teamA' ? 'text-brand-700' : 'text-rose-700') + ' px-1 rounded">✓</span>' : ''}
          </div>
        </div>
        <div class="text-[10px] font-bold mt-1 flex items-center justify-between w-full">
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
        btn.className = 'pts-btn py-2 rounded-xl border-2 border-brand-500 bg-brand-50 font-black text-xs text-brand-900 ring-1 ring-brand-300 shadow-2xs cursor-pointer transition-all active:scale-95 text-center';
      } else {
        btn.className = 'pts-btn py-2 rounded-xl border border-slate-300 bg-white font-black text-xs text-slate-700 hover:bg-slate-100 cursor-pointer transition-all active:scale-95 text-center';
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
      toggleFoul(false);
    } else if (targetQ) {
      selectResult(targetQ.isCorrect);
      toggleInterruption(!!targetQ.isInterruption);
      toggleFoul(false);
      const rebCheck = document.getElementById('score-is-rebound');
      if (rebCheck) rebCheck.checked = !!targetQ.isRebound;
    } else {
      selectResult(true);
      toggleInterruption(false);
      toggleFoul(false);
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
      toggleFoul(false);
      if (activeRound.reboundStatus.team) {
        state.scoreInput.team = activeRound.reboundStatus.team;
      }
    } else {
      const qObj = activeRound.questions.find(q => q.questionNum === qNum);
      if (qObj) {
        selectPoints(qObj.pointValue || 20);
        selectResult(qObj.isCorrect);
        toggleInterruption(!!qObj.isInterruption);
        toggleFoul(false);
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
        toggleFoul(false);
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
        const pointsScored = isCorrect ? `+${ans.pointValue}` : `-${Math.floor(ans.pointValue / 2)}`;
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

  const foulsA = activeRound.teamA?.fouls || [];
  const foulsB = activeRound.teamB?.fouls || [];

  const homeFoulsEl = document.getElementById('summary-home-fouls');
  if (homeFoulsEl) {
    homeFoulsEl.innerHTML = foulsA.length > 0
      ? foulsA.map(f => `<span class="inline-flex items-center gap-1 bg-rose-50 border border-rose-200 text-rose-800 px-1.5 py-0.5 rounded text-[10px] mr-1 mb-1 font-bold"><span>🚩 ${escapeHtml(f.reason)}</span><button type="button" onclick="deleteFoul('teamA', '${f.id}')" title="Delete foul" class="text-rose-500 hover:text-rose-900 ml-0.5 cursor-pointer font-black text-xs">×</button></span>`).join('')
      : 'None';
  }
  const oppFoulsEl = document.getElementById('summary-opp-fouls');
  if (oppFoulsEl) {
    oppFoulsEl.innerHTML = foulsB.length > 0
      ? foulsB.map(f => `<span class="inline-flex items-center gap-1 bg-rose-50 border border-rose-200 text-rose-800 px-1.5 py-0.5 rounded text-[10px] mr-1 mb-1 font-bold"><span>🚩 ${escapeHtml(f.reason)}</span><button type="button" onclick="deleteFoul('teamB', '${f.id}')" title="Delete foul" class="text-rose-500 hover:text-rose-900 ml-0.5 cursor-pointer font-black text-xs">×</button></span>`).join('')
      : 'None';
  }
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
          ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-100 text-amber-900 border border-amber-300">⭐ Perfect QO (+10)</span>`
          : `<span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-50 text-amber-800 border border-amber-200">🎉 Quiz Out (+0)</span>`;
      } else if (isEO) {
        statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-100 text-rose-800 border border-rose-300 animate-pulse">❌ Errored Out (3/3)</span>`;
      } else if (stat.errors === 2) {
        statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-50 text-rose-700 border border-rose-200">⚠️ 1 Error to Lockout</span>`;
      } else if (stat.correct === 5) {
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
                  ${stat.correct}/${activeRound.qoThreshold || 6} C
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
        questionNum: currentQ,
        sheetId: state.currentSheetId
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
        isCorrect: state.scoreInput.isCorrect,
        sheetId: state.currentSheetId
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
    toggleFoul(false);
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
      const qoTarget = result.activeRound?.qoThreshold || 6;
      if (prevCorrect < qoTarget && newStat.correct >= qoTarget) {
        if (newStat.errors === 0) {
          showMatchToast(`⭐ ${newStat.name || answeredQuizzer} has QUIZZED OUT! Perfect ${qoTarget}/${qoTarget} (+10 Bonus Points awarded)!`, 'success');
        } else {
          showMatchToast(`🎉 ${newStat.name || answeredQuizzer} has QUIZZED OUT! ${qoTarget} correct answers. Sits back with maximum score!`, 'warning');
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
      body: JSON.stringify({ matchId: state.activeMatchId, sheetId: state.currentSheetId })
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
      body: JSON.stringify({ matchId: mId, sheetId: state.currentSheetId })
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
        studentsB,
        sheetId: state.currentSheetId
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
        penalty,
        sheetId: state.currentSheetId
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

  // 1. Update Division Segregation Tabs (JBQ B & JBQ C)
  const tabJbqB = document.getElementById('teams-tab-jbq-b');
  const tabJbqC = document.getElementById('teams-tab-jbq-c');

  const countJbqB = document.getElementById('teams-count-jbq-b');
  const countJbqC = document.getElementById('teams-count-jbq-c');

  const divs = state.tbqData?.divisionsSummary || state.allDivisionTeams?.divisionsSummary || state.platformContext?.divisionsSummary || {};
  if (countJbqB) countJbqB.textContent = `${divs.jbq_b?.teamsCount || 0} Teams • ${divs.jbq_b?.matchesCount || 0} M`;
  if (countJbqC) countJbqC.textContent = `${divs.jbq_c?.teamsCount || 0} Teams • ${divs.jbq_c?.matchesCount || 0} M`;

  const lockedDiv = getCoachLockedDivision();

  if (lockedDiv === 'c_level') {
    if (tabJbqB) tabJbqB.classList.add('hidden');
    if (tabJbqC) {
      tabJbqC.classList.remove('hidden');
      tabJbqC.className = 'flex-1 py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-2 shadow-xs whitespace-nowrap bg-amber-400 text-brand-950 cursor-default';
    }
  } else if (lockedDiv === 'b_level') {
    if (tabJbqC) tabJbqC.classList.add('hidden');
    if (tabJbqB) {
      tabJbqB.classList.remove('hidden');
      tabJbqB.className = 'flex-1 py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-2 shadow-xs whitespace-nowrap bg-amber-400 text-brand-950 cursor-default';
    }
  } else {
    if (tabJbqB) tabJbqB.classList.remove('hidden');
    if (tabJbqC) tabJbqC.classList.remove('hidden');
    const activeTabClass = 'flex-1 py-2 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 shadow-xs whitespace-nowrap bg-amber-400 text-brand-950 cursor-pointer';
    const inactiveTabClass = 'flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 whitespace-nowrap text-slate-600 hover:text-slate-900 bg-transparent cursor-pointer';

    if (tabJbqB) tabJbqB.className = divKey === 'jbq_b' ? activeTabClass : inactiveTabClass;
    if (tabJbqC) tabJbqC.className = divKey === 'jbq_c' ? activeTabClass : inactiveTabClass;
  }

  // Resolve teams & matches for the current division
  const isMatchingTbqData = state.tbqData && state.tbqData.division === state.currentDivision;
  const teams = isMatchingTbqData 
    ? (state.tbqData.meet?.teams || []) 
    : ((state.allDivisionTeams && state.allDivisionTeams[divKey]) || (state.tbqData?.meet?.teams || []));
  const matchesList = isMatchingTbqData ? (state.tbqData.matchesList || []) : [];

  // 2. Active Division Banner
  const bannerIcon = document.getElementById('teams-div-banner-icon');
  const bannerTitle = document.getElementById('teams-div-banner-title');
  const bannerDesc = document.getElementById('teams-div-banner-desc');

  if (bannerIcon) bannerIcon.textContent = divKey === 'jbq_c' ? '🌟' : '⚡';
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
                ${(() => {
                  const coachPills = [];
                  if (t.coachName) coachPills.push(`Coach: ${escapeHtml(t.coachName)}`);
                  if (t.coach2Name) coachPills.push(`Co-Coach: ${escapeHtml(t.coach2Name)}`);
                  if (coachPills.length === 0) {
                    return `<span class="bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full text-[10px] font-bold">⚪ No Coach</span>`;
                  }
                  return `<span class="bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-full text-[10px] font-black flex items-center gap-1">🎒 ${coachPills.join(' • ')}</span>`;
                })()}
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
              <span class="text-xs font-black text-slate-800 uppercase tracking-wider">
                Match #${m.matchNumber}
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
  matchesListEl.innerHTML = mHtml || `<p class="text-xs text-slate-400 py-3 text-center">No matches configured in ${getDivisionDisplayName(divKey)}. Tap "+ Add Match" above.</p>`;
  checkStorageStatus();
}

function selectAndOpenMatch(matchId) {
  fetchTbqData(matchId);
  switchTab('scoresheet');
}

// Populate Coach Dropdowns inside Edit Team Modal
async function populateTeamCoachDropdown(selectedCoach1Id, selectedCoach2Id) {
  const select1 = document.getElementById('edit-team-coach');
  const select2 = document.getElementById('edit-team-coach2');
  if (!select1 && !select2) return;

  if (!state.coachesList || state.coachesList.length === 0) {
    try {
      const res = await authFetch('/api/coaches');
      if (res.ok) {
        const data = await res.json();
        state.coachesList = data.coaches || [];
      }
    } catch (e) {
      console.warn('Failed to load coaches list:', e);
    }
  }

  const coaches = state.coachesList || [];

  if (select1) {
    let opts1 = '<option value="">-- No Coach (Unassigned) --</option>';
    coaches.forEach(c => {
      const isSelected = selectedCoach1Id && (c.id === selectedCoach1Id || c.username === selectedCoach1Id);
      const rolePill = c.role === 'supercoach' ? ' (Super Coach)' : '';
      opts1 += `<option value="${c.id}" ${isSelected ? 'selected' : ''}>${escapeHtml(c.name)} (@${escapeHtml(c.username)})${rolePill}</option>`;
    });
    select1.innerHTML = opts1;
  }

  if (select2) {
    let opts2 = '<option value="">-- No 2nd Coach (Unassigned) --</option>';
    coaches.forEach(c => {
      const isSelected = selectedCoach2Id && (c.id === selectedCoach2Id || c.username === selectedCoach2Id);
      const rolePill = c.role === 'supercoach' ? ' (Super Coach)' : '';
      opts2 += `<option value="${c.id}" ${isSelected ? 'selected' : ''}>${escapeHtml(c.name)} (@${escapeHtml(c.username)})${rolePill}</option>`;
    });
    select2.innerHTML = opts2;
  }
}

// EDIT TEAM MODAL
async function openEditTeamModal(teamId) {
  const currentDiv = getActiveDivisionKey();
  const teams = (state.tbqData && state.tbqData.meet && state.tbqData.meet.teams) || [];
  const team = teams.find(t => t.id === teamId);

  const locked = getCoachLockedDivision();
  const divSelect = document.getElementById('edit-team-division');
  if (divSelect) {
    if (locked) {
      divSelect.value = locked === 'c_level' ? 'jbq_c' : 'jbq_b';
      divSelect.disabled = true;
    } else {
      divSelect.disabled = false;
      divSelect.value = currentDiv;
    }
  }

  document.getElementById('edit-team-id').value = team ? team.id : '';
  document.getElementById('edit-team-name').value = team ? team.name : '';
  document.getElementById('edit-team-church').value = team ? team.church : '';
  document.getElementById('edit-team-quizzers').value = team ? (team.quizzers || []).join(', ') : '';

  const c1 = team ? (team.coachId || team.coachUsername || '') : '';
  const c2 = team ? (team.coach2Id || team.coach2Username || '') : '';
  await populateTeamCoachDropdown(c1, c2);

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
  const coachSelect = document.getElementById('edit-team-coach');
  const coach2Select = document.getElementById('edit-team-coach2');
  const coachId = coachSelect ? coachSelect.value : '';
  const coach2Id = coach2Select ? coach2Select.value : '';

  try {
    const res = await authFetch('/api/teams/save', {
      method: 'POST',
      body: JSON.stringify({ teamId, name, church, quizzers: quizzersRaw, division, coachId, coach2Id })
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
  const locked = getCoachLockedDivision();
  const divSelect = document.getElementById('match-division-select');
  if (divSelect) {
    if (locked) {
      divSelect.value = locked === 'c_level' ? 'jbq_c' : 'jbq_b';
      divSelect.disabled = true;
    } else {
      divSelect.disabled = false;
      divSelect.value = currentDiv;
    }
  }

  await fetchTeamsByDivision();
  populateMatchModalTeams(currentDiv);

  document.getElementById('match-edit-id').value = '';
  const badgeEl = document.getElementById('match-modal-badge');
  if (badgeEl) badgeEl.textContent = `${getDivisionDisplayName(currentDiv)} Schedule`;
  const titleEl = document.getElementById('match-modal-title');
  if (titleEl) titleEl.textContent = '➕ Add Match';
  const submitBtn = document.getElementById('match-modal-submit-btn');
  if (submitBtn) submitBtn.textContent = 'Save Match';

  // Inherit active meet automatically from title bar selection
  const meets = state.tbqData?.meetsList || (state.platformContext?.jbq?.meets) || [];
  const activeMeet = meets.find(m => m.id === state.currentMeetId) || state.tbqData?.meet || (meets.length > 0 ? meets[0] : null);
  const meetTitle = activeMeet?.title || activeMeet?.name || 'Meet 1';
  const meetNumMatch = meetTitle.match(/\d+/);
  const activeMeetNum = activeMeet?.meetNum || (meetNumMatch ? parseInt(meetNumMatch[0]) : 1);

  const meetInput = document.getElementById('match-meet-num');
  if (meetInput) meetInput.value = activeMeetNum;

  const nextNum = (state.tbqData && state.tbqData.matchesList ? state.tbqData.matchesList.length + 1 : 1);
  document.getElementById('match-number-input').value = `0${nextNum}`;

  document.getElementById('add-match-modal').classList.remove('hidden');
}

function openEditMatchModal(matchId) {
  const currentDiv = getActiveDivisionKey();
  const locked = getCoachLockedDivision();
  const divSelect = document.getElementById('match-division-select');
  if (divSelect) {
    if (locked) {
      divSelect.value = locked === 'c_level' ? 'jbq_c' : 'jbq_b';
      divSelect.disabled = true;
    } else {
      divSelect.disabled = false;
      divSelect.value = currentDiv;
    }
  }

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
  const activeMeetId = state.currentMeetId || state.tbqData?.meet?.id || null;
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
    meetId: activeMeetId,
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
  if (!state.auth) return;

  try {
    const res = await authFetch('/api/coaches');
    if (!res.ok) return;
    const data = await res.json();
    state.coachesList = data.coaches || [];
    if (state.auth.user.role === 'supercoach') {
      renderCoachesTable(data.coaches);
    }
  } catch (err) {
    console.error('Error fetching coaches:', err);
  }
}

function renderCoachesTable(coaches) {
  const tbody = document.getElementById('coaches-table-tbody');
  if (!tbody) return;

  // Collect all teams across divisions to determine assigned teams for each coach
  const allTeams = [];
  if (state.tbqData?.meet?.teams) {
    allTeams.push(...state.tbqData.meet.teams);
  }
  if (state.allDivisionTeams) {
    if (Array.isArray(state.allDivisionTeams.jbq_b)) allTeams.push(...state.allDivisionTeams.jbq_b);
    if (Array.isArray(state.allDivisionTeams.jbq_c)) allTeams.push(...state.allDivisionTeams.jbq_c);
  }
  // Deduplicate teams by ID
  const uniqueTeamsMap = new Map();
  allTeams.forEach(t => {
    if (t && t.id && !uniqueTeamsMap.has(t.id)) uniqueTeamsMap.set(t.id, t);
  });
  const uniqueTeams = Array.from(uniqueTeamsMap.values());

  let html = '';
  coaches.forEach(c => {
    const isSelf = state.auth && state.auth.user && c.id === state.auth.user.id;
    const assignedTeams = uniqueTeams.filter(t => 
      t.coachId === c.id || t.coachUsername === c.username ||
      t.coach2Id === c.id || t.coach2Username === c.username ||
      (Array.isArray(t.coaches) && t.coaches.some(co => co && (co.id === c.id || co.username === c.username)))
    );

    let assignedHtml = '';
    if (c.role === 'supercoach') {
      assignedHtml = '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300">👑 All Teams (Super Coach)</span>';
    } else if (assignedTeams.length > 0) {
      assignedHtml = assignedTeams.map(t => {
        const isAssistant = (t.coach2Id === c.id || t.coach2Username === c.username);
        const tag = isAssistant ? '(Co-Coach)' : '(Primary)';
        return `<span class="inline-block bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-[10px] font-bold mr-1 mb-1">🎒 ${escapeHtml(t.name)} ${tag}</span>`;
      }).join('');
    } else {
      assignedHtml = '<span class="text-xs text-slate-400 italic">No assigned team</span>';
    }

    html += `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="py-3 font-bold text-slate-800">${escapeHtml(c.name)}</td>
        <td class="py-3 font-mono font-medium text-slate-600">${escapeHtml(c.username)}</td>
        <td class="py-3">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
            c.role === 'supercoach'
              ? 'bg-amber-100 text-amber-900 border border-amber-300'
              : 'bg-purple-100 text-purple-900 border border-purple-300'
          }">
            ${c.role === 'supercoach' ? '👑 Super Coach' : '🎒 JBQ Coach'}
          </span>
        </td>
        <td class="py-3">
          ${assignedHtml}
        </td>
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
    a.download = `jbq-tournament-backup-${new Date().toISOString().slice(0, 10)}.json`;
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

// ==========================================
// 8. QUIZZERS SCORE TRACKER (STUDENTS VIEW)
// ==========================================

async function fetchQuizzersStats() {
  if (!state.auth) return;
  try {
    const res = await authFetch('/api/tbq/quizzers-stats');
    if (!res.ok) {
      if (res.status === 401) {
        logoutCoach();
      }
      return;
    }
    const data = await res.json();
    state.quizzersData = data;
    renderQuizzersUI();
  } catch (err) {
    console.error('Error fetching quizzers stats:', err);
  }
}

function handleQuizzersFilterChange() {
  renderQuizzersUI();
}

function clearQuizzersSearch() {
  const searchInput = document.getElementById('quizzers-search-input');
  if (searchInput) searchInput.value = '';
  renderQuizzersUI();
}

function toggleQuizzerMatchDetails(idx) {
  const el = document.getElementById(`quizzer-matches-${idx}`);
  const btn = document.getElementById(`quizzer-toggle-btn-${idx}`);
  if (!el) return;
  const isHidden = el.classList.contains('hidden');
  el.classList.toggle('hidden', !isHidden);
  if (btn) {
    btn.textContent = isHidden ? '▲ Hide Match Details' : '▼ View Match Details';
  }
}

function renderQuizzersUI() {
  if (!state.quizzersData) return;
  const data = state.quizzersData;
  const isSuper = !!data.isSuper;

  // 1. Role context & title
  const titleEl = document.getElementById('quizzers-view-title');
  const subtitleEl = document.getElementById('quizzers-view-subtitle');
  const badgeEl = document.getElementById('quizzers-role-badge');

  if (isSuper) {
    if (titleEl) titleEl.textContent = '🌟 All Quizzers Leaderboard';
    if (subtitleEl) subtitleEl.textContent = `All churches & teams • ${data.divisionName || 'B-Level'}`;
    if (badgeEl) {
      badgeEl.className = 'text-[9px] font-black px-2 py-0.5 rounded-full border bg-amber-400 text-slate-950 border-amber-300';
      badgeEl.textContent = '👑 Super Coach View';
    }
  } else {
    if (titleEl) titleEl.textContent = '🌟 My Team Quizzers';
    if (subtitleEl) subtitleEl.textContent = `Tracking scores for your team's students alone • ${data.divisionName || 'B-Level'}`;
    if (badgeEl) {
      badgeEl.className = 'text-[9px] font-black px-2 py-0.5 rounded-full border bg-purple-500/20 text-purple-200 border-purple-400/30';
      badgeEl.textContent = `🎒 ${data.coach?.name || 'Coach'}'s Team`;
    }
  }

  // 2. Populate team filter dropdown (preserve current selection if valid)
  const teamFilterEl = document.getElementById('quizzers-team-filter');
  if (teamFilterEl) {
    const prevVal = teamFilterEl.value;
    const teams = data.teams || [];
    let optsHtml = '<option value="all">All Teams</option>';
    teams.forEach(t => {
      optsHtml += `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`;
    });
    teamFilterEl.innerHTML = optsHtml;
    if (prevVal && (prevVal === 'all' || teams.some(t => t.id === prevVal))) {
      teamFilterEl.value = prevVal;
    }
  }

  // 3. Search and Sort states
  const searchInput = document.getElementById('quizzers-search-input');
  const searchVal = (searchInput ? searchInput.value : '').trim().toLowerCase();
  const clearBtn = document.getElementById('quizzers-search-clear');
  if (clearBtn) clearBtn.classList.toggle('hidden', !searchVal);

  const selectedTeam = teamFilterEl ? teamFilterEl.value : 'all';
  const sortSelect = document.getElementById('quizzers-sort-select');
  const sortVal = sortSelect ? sortSelect.value : 'points';

  // 4. Filter quizzers
  let filtered = (data.quizzers || []).filter(q => {
    if (searchVal && !q.name.toLowerCase().includes(searchVal) && !(q.teamName || '').toLowerCase().includes(searchVal)) {
      return false;
    }
    if (selectedTeam !== 'all' && q.teamId !== selectedTeam) {
      return false;
    }
    return true;
  });

  // 5. Sort quizzers
  if (sortVal === 'points') {
    filtered.sort((a, b) => b.totalPoints - a.totalPoints || b.correct - a.correct || a.errors - b.errors);
  } else if (sortVal === 'correct') {
    filtered.sort((a, b) => b.correct - a.correct || b.totalPoints - a.totalPoints);
  } else if (sortVal === 'accuracy') {
    filtered.sort((a, b) => b.accuracy - a.accuracy || b.totalPoints - a.totalPoints);
  } else if (sortVal === 'name') {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  }

  // 6. Summary Stats Chips
  const totalKids = filtered.length;
  const totalPts = filtered.reduce((sum, q) => sum + (q.totalPoints || 0), 0);
  const totalCorrect = filtered.reduce((sum, q) => sum + (q.correct || 0), 0);
  const totalQOs = filtered.reduce((sum, q) => sum + (q.quizOuts || 0), 0);

  const statKids = document.getElementById('quizzers-stat-kids');
  const statPoints = document.getElementById('quizzers-stat-points');
  const statCorrect = document.getElementById('quizzers-stat-correct');
  const statQos = document.getElementById('quizzers-stat-qos');

  if (statKids) statKids.textContent = totalKids;
  if (statPoints) statPoints.textContent = totalPts;
  if (statCorrect) statCorrect.textContent = totalCorrect;
  if (statQos) statQos.textContent = totalQOs;

  // 7. Render Cards List
  const listContainer = document.getElementById('quizzers-cards-list');
  const emptyState = document.getElementById('quizzers-empty-state');
  const emptyTitle = document.getElementById('quizzers-empty-title');
  const emptyDesc = document.getElementById('quizzers-empty-desc');

  if (filtered.length === 0) {
    if (listContainer) listContainer.innerHTML = '';
    if (emptyState) {
      emptyState.classList.remove('hidden');
      if (!isSuper && (!data.teams || data.teams.length === 0)) {
        if (emptyTitle) emptyTitle.textContent = 'No Teams Assigned to Your Account';
        if (emptyDesc) emptyDesc.textContent = 'Ask your tournament coordinator (Super Coach) to assign your team to your coach account in the Teams tab.';
      } else if (searchVal) {
        if (emptyTitle) emptyTitle.textContent = 'No Matching Quizzers';
        if (emptyDesc) emptyDesc.textContent = `No quizzers found matching "${escapeHtml(searchVal)}".`;
      } else {
        if (emptyTitle) emptyTitle.textContent = 'No Quizzers in this Division';
        if (emptyDesc) emptyDesc.textContent = 'No quizzers have been added to teams yet in this division.';
      }
    }
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  let cardsHtml = '';
  filtered.forEach((q, idx) => {
    // Rank medal / badge
    let rankBadge = '';
    if (q.rank === 1) {
      rankBadge = '<span class="w-6 h-6 rounded-full bg-amber-400 text-slate-950 font-black text-xs flex items-center justify-center shadow-xs">🥇</span>';
    } else if (q.rank === 2) {
      rankBadge = '<span class="w-6 h-6 rounded-full bg-slate-300 text-slate-950 font-black text-xs flex items-center justify-center shadow-xs">🥈</span>';
    } else if (q.rank === 3) {
      rankBadge = '<span class="w-6 h-6 rounded-full bg-amber-600 text-white font-black text-xs flex items-center justify-center shadow-xs">🥉</span>';
    } else {
      rankBadge = `<span class="w-6 h-6 rounded-full bg-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center border border-slate-200">#${q.rank}</span>`;
    }

    // Points styling
    const pointsColor = q.totalPoints > 0 ? 'text-amber-950 bg-amber-400/90' : (q.totalPoints < 0 ? 'text-rose-950 bg-rose-300' : 'text-slate-800 bg-slate-200');

    // Matches accordion list
    let matchesHtml = '';
    if (q.matches && q.matches.length > 0) {
      matchesHtml = `
        <div id="quizzer-matches-${idx}" class="hidden mt-2.5 pt-2.5 border-t border-slate-100 space-y-1.5 text-xs">
          <div class="text-[10px] font-black uppercase text-slate-400 tracking-wider">Round-by-Round Breakdown:</div>
          ${q.matches.map(m => `
            <div class="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-100">
              <div class="flex items-center gap-2">
                <span class="font-black text-slate-700">M#${m.matchNumber}</span>
                <span class="text-slate-500">vs ${escapeHtml(m.opponentTeamName)}</span>
                ${m.isQuizzedOut ? `<span class="text-[9px] font-black px-1.5 py-0.2 rounded-full ${m.quizOutBonus > 0 ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-purple-100 text-purple-800'}">⭐ QO</span>` : ''}
                ${m.isErroredOut ? `<span class="text-[9px] font-black px-1.5 py-0.2 rounded-full bg-rose-100 text-rose-800">❌ EO</span>` : ''}
              </div>
              <div class="flex items-center gap-2">
                <span class="text-[11px] font-bold text-emerald-700">✅ ${m.correct}</span>
                <span class="text-[11px] font-bold text-rose-700">❌ ${m.errors}</span>
                <span class="font-black text-xs ${m.points >= 0 ? 'text-emerald-700' : 'text-rose-700'}">${m.points >= 0 ? '+' : ''}${m.points} pts</span>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    cardsHtml += `
      <div class="bg-white rounded-2xl p-3 shadow-2xs border border-slate-200 transition-all hover:border-slate-300">
        <!-- Top Row: Rank, Name, Team, and Points -->
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-start gap-2.5 min-w-0">
            <div class="pt-0.5 flex-shrink-0">${rankBadge}</div>
            <div class="min-w-0">
              <h3 class="text-sm font-black text-slate-900 truncate leading-tight">${escapeHtml(q.name)}</h3>
              <div class="text-[11px] text-slate-500 font-semibold truncate mt-0.5">
                <span>${escapeHtml(q.teamName)}</span>
                ${q.church && q.church !== q.teamName ? `<span class="text-slate-400 font-normal"> • ${escapeHtml(q.church)}</span>` : ''}
              </div>
            </div>
          </div>
          <!-- Points Badge -->
          <div class="flex-shrink-0 text-right">
            <span class="inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-black shadow-2xs ${pointsColor}">
              ${q.totalPoints} pts
            </span>
            ${q.matchesPlayed > 0 ? `<div class="text-[10px] text-slate-400 font-bold mt-0.5">${q.avgPoints} avg/m</div>` : ''}
          </div>
        </div>

        <!-- Middle Row: Stats Badges -->
        <div class="flex items-center gap-1.5 flex-wrap mt-2.5 pt-2 border-t border-slate-100 text-[11px] font-bold">
          <span class="px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200/60">
            ✅ ${q.correct} Correct
          </span>
          <span class="px-2 py-0.5 rounded-lg bg-rose-50 text-rose-800 border border-rose-200/60">
            ❌ ${q.errors} Errors
          </span>
          <span class="px-2 py-0.5 rounded-lg bg-blue-50 text-blue-800 border border-blue-200/60">
            🎯 ${q.accuracy}% Acc
          </span>
          ${q.quizOuts > 0 ? `
            <span class="px-2 py-0.5 rounded-lg bg-amber-50 text-amber-900 border border-amber-300/80 font-black">
              ⭐ ${q.quizOuts} QO ${q.perfectQuizOuts > 0 ? `(${q.perfectQuizOuts} perfect)` : ''}
            </span>
          ` : ''}
          ${q.fouls > 0 ? `
            <span class="px-2 py-0.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200/60">
              ⚠️ ${q.fouls} Foul
            </span>
          ` : ''}
          <span class="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-600 border border-slate-200">
            📊 ${q.matchesPlayed} Match${q.matchesPlayed === 1 ? '' : 'es'}
          </span>
        </div>

        <!-- Optional: Match details toggle if matches exist -->
        ${q.matches && q.matches.length > 0 ? `
          <div class="mt-2 text-right">
            <button id="quizzer-toggle-btn-${idx}" onclick="toggleQuizzerMatchDetails(${idx})" class="text-[11px] text-amber-600 hover:text-amber-700 font-bold active:scale-95 cursor-pointer">
              ▼ View Match Details (${q.matches.length})
            </button>
          </div>
          ${matchesHtml}
        ` : ''}
      </div>
    `;
  });

  if (listContainer) listContainer.innerHTML = cardsHtml;
}

// Live Tournament Poller: Automatically updates standings and matches for spectators & coaches
setInterval(() => {
  if (!state.auth || state.currentTab === 'questions') {
    fetchPublicSummary();
  } else if (state.currentTab === 'teams') {
    fetchTeamsByDivision();
  } else if (state.currentTab === 'quizzers') {
    fetchQuizzersStats();
  }
}, 15000);
