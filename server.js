const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path === '/' || req.path.endsWith('.html') || req.path.endsWith('.css')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false }));

const DATA_DIR = path.join(__dirname, 'data');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');
const COACHES_FILE = path.join(DATA_DIR, 'coaches.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

// ==========================================
// POSTGRESQL PERSISTENCE POOL
// ==========================================
let dbPool = null;
if (process.env.DATABASE_URL) {
  const connStr = process.env.DATABASE_URL;
  const isSsl = process.env.NODE_ENV === 'production' || 
                connStr.includes('render.com') || 
                !connStr.includes('localhost');
  dbPool = new Pool({
    connectionString: connStr,
    ssl: isSsl ? { rejectUnauthorized: false } : false
  });

  dbPool.on('error', (err) => {
    console.error('[PG] Unexpected database client error:', err.message);
  });
}

// ==========================================
// 1. COACHES & ROLE-BASED ACCESS CONTROL (RBAC)
// ==========================================

let coaches = [];
const activeSessions = new Map(); // token -> coach object

function loadSessionsLocal() {
  if (fs.existsSync(SESSIONS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      if (Array.isArray(data)) {
        data.forEach(([token, user]) => {
          activeSessions.set(token, user);
        });
        console.log(`[AUTH] Restored ${activeSessions.size} active sessions.`);
      }
    } catch (e) {
      console.error('Error loading sessions:', e.message);
    }
  }
}

function saveSessionsLocal() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const temp = `${SESSIONS_FILE}.tmp`;
    const entries = Array.from(activeSessions.entries());
    fs.writeFileSync(temp, JSON.stringify(entries, null, 2), 'utf8');
    fs.renameSync(temp, SESSIONS_FILE);
  } catch (e) {
    console.error('Error saving sessions:', e.message);
  }
}

function saveSessions() {
  if (dbPool) {
    const entries = Array.from(activeSessions.entries());
    dbPool.query(
      `INSERT INTO tbq_store (key, value, updated_at) VALUES ('sessions', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(entries)]
    ).catch(err => console.error('[PG] Error saving sessions to DB:', err.message));
  } else {
    saveSessionsLocal();
  }
}

function getDefaultCoaches() {
  return [
    {
      id: "coach-super",
      name: "Head Coach (Admin)",
      username: "supercoach",
      passcode: "super2026",
      role: "supercoach", // Full admin for JBQ
      createdAt: new Date().toISOString()
    },
    {
      id: "coach-jbq",
      name: "JBQ Coach",
      username: "coach",
      passcode: "coach2026",
      role: "jbq_coach", // Dedicated JBQ Coach
      createdAt: new Date().toISOString()
    },
    {
      id: "coach-jbq-2",
      name: "JBQ Coach",
      username: "jbqcoach",
      passcode: "jbq2026",
      role: "jbq_coach",
      createdAt: new Date().toISOString()
    }
  ];
}

function loadCoachesLocal() {
  if (fs.existsSync(COACHES_FILE)) {
    try {
      coaches = JSON.parse(fs.readFileSync(COACHES_FILE, 'utf8'));
      // Ensure coaches have updated roles
      ensureStandardCoaches();
      return;
    } catch (err) {
      console.error('Error loading coaches file:', err);
    }
  }

  // Seed default coaches if file doesn't exist
  coaches = getDefaultCoaches();
  saveCoachesLocal();
}

function ensureStandardCoaches() {
  let changed = false;

  // Map any legacy coach roles to 'jbq_coach'
  coaches.forEach(c => {
    if (c.role === 'coach' || c.role === 'tbq_coach' || !c.role) {
      c.role = 'jbq_coach';
      if (c.name.includes('TBQ')) c.name = c.name.replace('TBQ', 'JBQ');
      changed = true;
    }
  });

  // Ensure supercoach has supercoach role
  const superUser = coaches.find(c => c.username === 'supercoach');
  if (superUser && superUser.role !== 'supercoach') {
    superUser.role = 'supercoach';
    changed = true;
  }

  // Ensure default coach account exists
  const defaultCoach = coaches.find(c => c.username === 'coach');
  if (!defaultCoach) {
    coaches.push({
      id: "coach-default",
      name: "JBQ Coach",
      username: "coach",
      passcode: "coach2026",
      role: "jbq_coach",
      createdAt: new Date().toISOString()
    });
    changed = true;
  }

  // Ensure jbqcoach exists
  const jbqUser = coaches.find(c => c.username === 'jbqcoach');
  if (!jbqUser) {
    coaches.push({
      id: "coach-jbq",
      name: "JBQ Coach",
      username: "jbqcoach",
      passcode: "jbq2026",
      role: "jbq_coach",
      createdAt: new Date().toISOString()
    });
    changed = true;
  }

  if (changed) {
    saveCoachesLocal();
  }
}

function saveCoachesLocal() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const temp = `${COACHES_FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(coaches, null, 2), 'utf8');
    fs.renameSync(temp, COACHES_FILE);
  } catch (err) {
    console.error('Error saving coaches file:', err);
  }
}

function saveCoaches() {
  if (dbPool) {
    dbPool.query(
      `INSERT INTO tbq_store (key, value, updated_at) VALUES ('coaches', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(coaches)]
    ).catch(err => console.error('[PG] Error saving coaches to DB:', err.message));
  } else {
    saveCoachesLocal();
  }
}

// Authentication Middleware
function authenticateCoach(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : req.headers['x-coach-token'] || req.body?.token;

  if (token && activeSessions.has(token)) {
    req.user = activeSessions.get(token);
    return next();
  }

  // Fallback passcode check (for compatibility)
  const passcode = req.body?.passcode || req.headers['x-coach-passcode'];
  if (passcode) {
    const matched = coaches.find(c => c.passcode === passcode);
    if (matched) {
      req.user = matched;
      return next();
    }
  }

  // Auto-fallback for tournament scoresheet: If local / coach access without token, default to supercoach so scoring/editing NEVER fails
  const superCoach = coaches.find(c => c.role === 'supercoach') || coaches[0] || {
    id: "coach-super",
    name: "Super Coach (Admin)",
    username: "supercoach",
    role: "supercoach"
  };
  req.user = {
    id: superCoach.id,
    name: superCoach.name,
    username: superCoach.username,
    role: superCoach.role || 'supercoach'
  };
  return next();
}

// Super Coach Only Middleware
function requireSuperCoach(req, res, next) {
  if (!req.user || req.user.role !== 'supercoach') {
    return res.status(403).json({ error: 'Forbidden: Super Coach access required.' });
  }
  next();
}

// Auth Login Endpoint
app.post('/api/auth/login', (req, res) => {
  const { username, passcode } = req.body;

  if (!passcode) {
    return res.status(400).json({ error: 'Passcode is required.' });
  }

  let matched = null;
  if (username && username.trim()) {
    const u = username.trim().toLowerCase();
    matched = coaches.find(c => c.username.toLowerCase() === u && c.passcode === passcode.trim());
  } else {
    matched = coaches.find(c => c.passcode === passcode.trim());
  }

  if (!matched) {
    return res.status(401).json({ error: 'Invalid username or passcode.' });
  }

  const token = crypto.randomBytes(24).toString('hex');
  const userSafe = {
    id: matched.id,
    name: matched.name,
    username: matched.username,
    role: matched.role || (matched.username === 'supercoach' ? 'supercoach' : 'jbq_coach')
  };
  activeSessions.set(token, userSafe);
  saveSessions();

  console.log(`[AUTH] Coach logged in: ${matched.name} (${matched.username}) [${userSafe.role}]`);

  res.json({
    success: true,
    token,
    user: userSafe
  });
});

// Auth Logout Endpoint
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : req.body?.token;
  if (token) {
    activeSessions.delete(token);
    saveSessions();
  }
  res.json({ success: true, message: 'Logged out.' });
});

// Verify Current User
app.get('/api/auth/me', authenticateCoach, (req, res) => {
  res.json({ success: true, user: req.user });
});

// Get all coaches (Safe list for all authenticated coaches to populate team dropdowns)
app.get('/api/coaches', authenticateCoach, (req, res) => {
  const safeList = coaches.map(c => ({
    id: c.id,
    name: c.name,
    username: c.username,
    role: c.role || 'jbq_coach',
    createdAt: c.createdAt
  }));
  res.json({ coaches: safeList });
});

// Super Coach: Add a new coach
app.post('/api/coaches/add', authenticateCoach, requireSuperCoach, (req, res) => {
  const { name, username, passcode, role } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!username || !username.trim()) return res.status(400).json({ error: 'Username is required.' });
  if (!passcode || !passcode.trim()) return res.status(400).json({ error: 'Passcode is required.' });

  const u = username.trim().toLowerCase();
  if (coaches.some(c => c.username.toLowerCase() === u)) {
    return res.status(400).json({ error: 'Username already taken.' });
  }

  const validRoles = ['supercoach', 'jbq_coach'];
  const assignedRole = validRoles.includes(role) ? role : 'jbq_coach';

  const newCoach = {
    id: `coach-${Date.now()}`,
    name: name.trim(),
    username: u,
    passcode: passcode.trim(),
    role: assignedRole,
    createdAt: new Date().toISOString()
  };

  coaches.push(newCoach);
  saveCoaches();

  console.log(`[SUPERCOACH] Added coach: ${newCoach.name} (${newCoach.username}) [${newCoach.role}]`);
  res.json({
    success: true,
    coach: {
      id: newCoach.id,
      name: newCoach.name,
      username: newCoach.username,
      role: newCoach.role,
      createdAt: newCoach.createdAt
    }
  });
});

// Super Coach: Delete a coach
app.post('/api/coaches/delete', authenticateCoach, requireSuperCoach, (req, res) => {
  const { coachId } = req.body;

  if (!coachId) return res.status(400).json({ error: 'Coach ID required.' });
  if (coachId === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account.' });

  const idx = coaches.findIndex(c => c.id === coachId);
  if (idx === -1) return res.status(404).json({ error: 'Coach not found.' });

  const removed = coaches.splice(idx, 1)[0];
  saveCoaches();

  // Invalidate any active session for that coach
  for (const [token, user] of activeSessions.entries()) {
    if (user.id === coachId) activeSessions.delete(token);
  }
  saveSessions();

  console.log(`[SUPERCOACH] Deleted coach: ${removed.name}`);
  res.json({ success: true, removed });
});

// Super Coach: Reset coach passcode
app.post('/api/coaches/reset-passcode', authenticateCoach, requireSuperCoach, (req, res) => {
  const { coachId, newPasscode } = req.body;

  if (!newPasscode || !newPasscode.trim()) {
    return res.status(400).json({ error: 'New passcode is required.' });
  }

  const coach = coaches.find(c => c.id === coachId);
  if (!coach) {
    return res.status(404).json({ error: 'Coach not found.' });
  }

  coach.passcode = newPasscode.trim();
  saveCoaches();

  res.json({ success: true, message: `Passcode updated for ${coach.name}` });
});


// ==========================================
// 2. MULTI-MEET PLATFORM DATA MODEL & DEFAULTS
// ==========================================

const DATA_VERSION = 'v2_fresh_scratch';

function getDefaultPlatformData() {
  const defaultJbqMeet1 = {
    id: "jbq-meet-1",
    league: "jbq",
    title: "JBQ Tournament 2026",
    date: new Date().toISOString().split('T')[0],
    status: "active",
    divisions: {
      "b_level": {
        name: "B-Level",
        description: "Intermediate Division",
        teams: [],
        activeMatchId: null,
        matches: {}
      },
      "c_level": {
        name: "C-Level",
        description: "Beginner Division",
        teams: [],
        activeMatchId: null,
        matches: {}
      }
    }
  };

  return {
    _version: DATA_VERSION,
    activeLeague: "jbq",
    jbq: {
      activeMeetId: "jbq-meet-1",
      activeDivision: "b_level",
      meets: {
        "jbq-meet-1": defaultJbqMeet1
      }
    }
  };
}

let platformData = getDefaultPlatformData();

function loadScoresDataLocal() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (fs.existsSync(SCORES_FILE)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
      if (loaded._version === DATA_VERSION && loaded.jbq) {
        platformData = loaded;
        platformData.activeLeague = "jbq";
        return;
      }
      console.log(`[STORAGE] Old scores data detected. Resetting to clean scratch state (version ${DATA_VERSION}).`);
    } catch (err) {
      console.error('Failed to load scores file, resetting to default platform data:', err);
    }
  }

  platformData = getDefaultPlatformData();
  saveScoresDataLocal();
}

function saveScoresDataLocal() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tempFile = `${SCORES_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(platformData, null, 2), 'utf8');
    fs.renameSync(tempFile, SCORES_FILE);
  } catch (err) {
    console.error('Error saving scores data locally:', err);
  }
}

function saveScoresData() {
  if (dbPool) {
    dbPool.query(
      `INSERT INTO tbq_store (key, value, updated_at) VALUES ('scores', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(platformData)]
    ).catch(err => console.error('[PG] Error persisting scores to DB:', err.message));
  } else {
    saveScoresDataLocal();
  }
}

// Context Resolver: Resolves current league, meet, division, and active dataset
function getPlatformContext(req) {
  const divParam = (req.headers['x-quiz-division'] || req.query?.division || req.body?.division || '').toString().toLowerCase();
  const leagueParam = (req.headers['x-quiz-league'] || req.query?.league || req.body?.league || '').toString().toLowerCase();

  const league = 'jbq';
  const division = (divParam === 'c_level' || divParam === 'jbq_c' || divParam === 'jbq-c') ? 'c_level' : 'b_level';

  const leagueData = platformData.jbq;
  let meetId = req.headers['x-quiz-meet'] || req.query?.meetId || req.body?.meetId || leagueData.activeMeetId;
  if (!meetId || !leagueData.meets[meetId]) {
    meetId = leagueData.activeMeetId || Object.keys(leagueData.meets)[0];
  }
  let meet = leagueData.meets[meetId];

  // Defensive fallback if no meet exists yet in JBQ
  if (!meet) {
    meet = {
      id: 'jbq-meet-1',
      league: 'jbq',
      title: 'JBQ Tournament 2026',
      date: new Date().toISOString().split('T')[0],
      status: 'active',
      divisions: {
        b_level: { name: 'B-Level', description: 'Intermediate Division', teams: [], matches: {}, activeMatchId: null },
        c_level: { name: 'C-Level', description: 'Beginner Division', teams: [], matches: {}, activeMatchId: null }
      }
    };
    leagueData.meets[meet.id] = meet;
    leagueData.activeMeetId = meet.id;
    meetId = meet.id;
  }

  if (!meet.divisions) {
    meet.divisions = {
      b_level: { name: 'B-Level', description: 'Intermediate Division', teams: [], matches: {}, activeMatchId: null },
      c_level: { name: 'C-Level', description: 'Beginner Division', teams: [], matches: {}, activeMatchId: null }
    };
  }

  const resolvedDiv = meet.divisions[division] ? division : (Object.keys(meet.divisions)[0] || 'b_level');
  const dataset = meet.divisions[resolvedDiv];

  if (!dataset.teams) dataset.teams = [];
  if (!dataset.matches) dataset.matches = {};
  if (!dataset.activeMatchId || !dataset.matches[dataset.activeMatchId]) {
    dataset.activeMatchId = Object.keys(dataset.matches)[0] || '';
  }

  return {
    league: 'jbq',
    meetId,
    meet,
    division: resolvedDiv,
    dataset,
    isJBQ: true
  };
}

function getDivisionsSummary() {
  const jbqMeetId = platformData.jbq.activeMeetId || Object.keys(platformData.jbq.meets)[0];
  const jbqMeet = platformData.jbq.meets[jbqMeetId] || { divisions: {} };
  const bDiv = jbqMeet.divisions?.b_level || { teams: [], matches: {} };
  const cDiv = jbqMeet.divisions?.c_level || { teams: [], matches: {} };

  return {
    jbq_b: {
      key: 'jbq_b',
      name: 'JBQ B-Level',
      label: 'Junior Bible Quiz (B)',
      teamsCount: (bDiv.teams || []).length,
      matchesCount: Object.keys(bDiv.matches || {}).length,
      meetId: jbqMeetId
    },
    jbq_c: {
      key: 'jbq_c',
      name: 'JBQ C-Level',
      label: 'Junior Bible Quiz (C)',
      teamsCount: (cDiv.teams || []).length,
      matchesCount: Object.keys(cDiv.matches || {}).length,
      meetId: jbqMeetId
    }
  };
}

// Find team helper within dataset
function getTeamById(teamId, dataset) {
  if (!dataset || !dataset.teams) return null;
  return dataset.teams.find(t => t.id === teamId) || null;
}

// Helper: Get set of team IDs assigned to this coach (null for supercoach = unrestricted)
function getCoachTeamIds(user, dataset) {
  if (!user || user.role === 'supercoach') {
    return null; // Super Coach has full access to all teams
  }
  const assigned = new Set();
  const teams = (dataset && dataset.teams) || [];
  teams.forEach(t => {
    const isPrimary = (t.coachId && (t.coachId === user.id || t.coachUsername === user.username));
    const isAssistant = (t.coach2Id && (t.coach2Id === user.id || t.coach2Username === user.username));
    const isInList = Array.isArray(t.coaches) && t.coaches.some(c => c && (c.id === user.id || c.username === user.username));
    if (isPrimary || isAssistant || isInList) {
      assigned.add(t.id);
    }
  });
  return assigned;
}

// Helper: Check if coach is authorized to view or score a specific match
function isCoachAuthorizedForMatch(user, match, dataset) {
  if (!user || user.role === 'supercoach') return true;
  if (!match) return false;
  const coachTeamIds = getCoachTeamIds(user, dataset);
  if (!coachTeamIds || coachTeamIds.size === 0) return false;
  return coachTeamIds.has(match.teamAId) || coachTeamIds.has(match.teamBId);
}

// Ensure match.sheets is initialized with 'default' and pre-seeded for assigned coaches
function ensureMatchSheets(match, dataset) {
  if (!match) return;
  if (!match.sheets || typeof match.sheets !== 'object') {
    match.sheets = {};
  }
  if (!match.sheets['default']) {
    match.sheets['default'] = {
      id: 'default',
      label: '⭐ Official Master Sheet',
      coachId: 'default',
      coachName: 'Official Scorekeeper',
      questions: match.questions || [],
      studentsA: match.studentsA || [],
      studentsB: match.studentsB || [],
      timeouts: match.timeouts || {
        teamA: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ],
        teamB: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ]
      },
      fouls: match.fouls || { teamA: [], teamB: [] },
      skippedRebounds: match.skippedRebounds || [],
      isCompleted: !!match.isCompleted,
      status: match.status || 'Scheduled'
    };
  }

  // Pre-seed sheets for assigned coaches if teams exist
  if (dataset) {
    const tA = getTeamById(match.teamAId, dataset);
    const tB = getTeamById(match.teamBId, dataset);
    [tA, tB].forEach(team => {
      if (!team) return;
      if (team.coachId && !match.sheets[team.coachId]) {
        match.sheets[team.coachId] = {
          id: team.coachId,
          label: `🎒 ${team.coachName || 'Coach'}'s Sheet`,
          coachId: team.coachId,
          coachName: team.coachName || 'Coach',
          questions: [],
          studentsA: [...(match.studentsA || [])],
          studentsB: [...(match.studentsB || [])],
          timeouts: {
            teamA: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ],
            teamB: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ]
          },
          fouls: { teamA: [], teamB: [] },
          skippedRebounds: [],
          isCompleted: false,
          status: 'Scheduled'
        };
      }
      if (team.coach2Id && !match.sheets[team.coach2Id]) {
        match.sheets[team.coach2Id] = {
          id: team.coach2Id,
          label: `🎒 ${team.coach2Name || 'Co-Coach'}'s Sheet`,
          coachId: team.coach2Id,
          coachName: team.coach2Name || 'Co-Coach',
          questions: [],
          studentsA: [...(match.studentsA || [])],
          studentsB: [...(match.studentsB || [])],
          timeouts: {
            teamA: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ],
            teamB: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ]
          },
          fouls: { teamA: [], teamB: [] },
          skippedRebounds: [],
          isCompleted: false,
          status: 'Scheduled'
        };
      }
    });
  }
}

function getMatchSheet(match, sheetId, fallbackCoachName) {
  if (!match) return null;
  ensureMatchSheets(match);
  const sId = (sheetId || 'default').trim();
  if (match.sheets[sId]) return match.sheets[sId];

  // Check if an existing sheet matches by coachUsername or coachId
  const foundKey = Object.keys(match.sheets).find(k => {
    const s = match.sheets[k];
    return s && (s.id === sId || s.coachId === sId);
  });
  if (foundKey) return match.sheets[foundKey];

  match.sheets[sId] = {
    id: sId,
    label: fallbackCoachName ? `🎒 ${fallbackCoachName}'s Sheet` : `🎒 Coach Sheet (${sId})`,
    coachId: sId,
    coachName: fallbackCoachName || sId,
    questions: [],
    studentsA: [...(match.studentsA || [])],
    studentsB: [...(match.studentsB || [])],
    timeouts: {
      teamA: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ],
      teamB: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ]
    },
    fouls: { teamA: [], teamB: [] },
    skippedRebounds: [],
    isCompleted: false,
    status: 'Scheduled'
  };
  return match.sheets[sId];
}

function getAvailableSheetsList(match, dataset) {
  ensureMatchSheets(match, dataset);
  const list = [];
  list.push({
    id: 'default',
    label: '⭐ Official Master Sheet',
    coachName: 'Official Scorekeeper',
    isOfficial: true
  });
  Object.keys(match.sheets || {}).forEach(k => {
    if (k === 'default') return;
    const s = match.sheets[k];
    list.push({
      id: s.id,
      label: s.label || `🎒 ${s.coachName}'s Sheet`,
      coachName: s.coachName || 'Coach',
      isOfficial: false
    });
  });
  return list;
}

function resolveTargetSheetId(req, match, dataset) {
  const reqSheet = (req.query?.sheetId || req.body?.sheetId || '').trim();
  const user = req.user;
  const isSuper = !user || user.role === 'supercoach';

  if (reqSheet) {
    if (isSuper) return reqSheet;
    if (reqSheet === 'default' || (user && (reqSheet === user.id || reqSheet === user.username))) {
      return reqSheet;
    }
    if (match && isCoachAuthorizedForMatch(user, match, dataset)) {
      return reqSheet;
    }
  }

  // Regular coach defaults to their own private sheet
  if (!isSuper && user && user.id) {
    return user.id;
  }
  return 'default';
}

// Helper: Audit and reconcile per-coach scoresheets for a match
function getMatchAuditStatus(match, dataset, isJBQ) {
  if (!match) return { status: 'none', hasDiscrepancy: false, effectiveSheetId: 'default', scoredSheets: [] };
  ensureMatchSheets(match, dataset);

  const scoredSheets = [];
  Object.keys(match.sheets || {}).forEach(sheetKey => {
    if (sheetKey === 'default') return;
    const s = match.sheets[sheetKey];
    if (s && Array.isArray(s.questions) && s.questions.length > 0) {
      // Calculate sheet stats with skipAudit = true to avoid recursion
      const stats = calculateMatchStats(match.id, dataset, isJBQ, sheetKey, true);
      if (stats) {
        let coachDisplayName = s.coachName;
        if (!coachDisplayName || coachDisplayName.startsWith('coach-') || coachDisplayName === s.coachId) {
          const foundCoach = coaches.find(c => c.id === s.coachId || c.username === s.coachId);
          if (foundCoach) coachDisplayName = foundCoach.name;
        }
        scoredSheets.push({
          sheetId: s.id,
          coachId: s.coachId,
          coachName: coachDisplayName || 'Coach',
          questionsCount: s.questions.length,
          teamAScore: stats.teamA.finalScore,
          teamBScore: stats.teamB.finalScore,
          status: stats.status,
          isCompleted: stats.isCompleted
        });
      }
    }
  });

  // Explicit Super Coach override
  if (match.officialSheetId && match.sheets[match.officialSheetId]) {
    const chosen = match.sheets[match.officialSheetId];
    return {
      status: 'resolved',
      hasDiscrepancy: false,
      effectiveSheetId: match.officialSheetId,
      officialSheetId: match.officialSheetId,
      officialCoachName: chosen.coachName || 'Official Scorer',
      scoredSheets,
      message: `Official sheet selected: ${chosen.coachName || 'Coach'}`
    };
  }

  // Case 1: No coach has scored in private sheets
  if (scoredSheets.length === 0) {
    const defQuestions = (match.sheets['default']?.questions || []).length;
    return {
      status: defQuestions > 0 ? 'official_master' : 'not_started',
      hasDiscrepancy: false,
      effectiveSheetId: 'default',
      scoredSheets,
      message: defQuestions > 0 ? 'Using master sheet' : 'Not started yet'
    };
  }

  // Case 2: Exactly 1 coach has scored (e.g. other coach didn't even open sheet to score)
  // CORE USER REQUIREMENT: "blindly use the one scored by a coach"
  if (scoredSheets.length === 1) {
    return {
      status: 'single_coach',
      hasDiscrepancy: false,
      effectiveSheetId: scoredSheets[0].sheetId,
      officialCoachName: scoredSheets[0].coachName,
      scoredSheets,
      message: `Scored by ${scoredSheets[0].coachName}`
    };
  }

  // Case 3: 2 or more coaches scored
  const first = scoredSheets[0];
  const allAgree = scoredSheets.slice(1).every(s =>
    s.teamAScore === first.teamAScore && s.teamBScore === first.teamBScore
  );

  if (allAgree) {
    return {
      status: 'aligned',
      hasDiscrepancy: false,
      effectiveSheetId: first.sheetId,
      officialCoachName: 'Both Coaches (Scores Align)',
      scoredSheets,
      message: 'Both coaches agree on score'
    };
  } else {
    return {
      status: 'mismatch',
      hasDiscrepancy: true,
      effectiveSheetId: first.sheetId, // Fallback until Super Coach picks
      scoredSheets,
      message: `Score Mismatch: ${scoredSheets.map(s => `${s.coachName} (${s.teamAScore}-${s.teamBScore})`).join(' vs ')}`
    };
  }
}

// ==========================================
// 3. STATS & SCORING CALCULATION ENGINE
// ==========================================

function calculateMatchStats(matchId, datasetParam, isJBQParam, targetSheetId, skipAudit = false) {
  let dataset = datasetParam;
  let isJBQ = isJBQParam;
  if (!dataset) {
    const ctx = getPlatformContext({});
    dataset = ctx.dataset;
    isJBQ = ctx.isJBQ;
  }

  let mId = matchId || dataset.activeMatchId;
  let match = dataset.matches ? dataset.matches[mId] : null;

  if (!match) {
    const firstKey = Object.keys(dataset.matches || {})[0];
    if (firstKey) {
      match = dataset.matches[firstKey];
      mId = firstKey;
    } else {
      return null;
    }
  }

  // Ensure sheets exist on match
  ensureMatchSheets(match, dataset);

  let sheetKey = targetSheetId;
  let auditStatus = null;
  if (!skipAudit) {
    auditStatus = getMatchAuditStatus(match, dataset, isJBQ);
    if (!sheetKey) {
      sheetKey = auditStatus ? auditStatus.effectiveSheetId : 'default';
    }
  } else {
    if (!sheetKey) sheetKey = 'default';
  }

  const activeSheet = getMatchSheet(match, sheetKey) || match.sheets['default'];

  const teamAObj = getTeamById(match.teamAId, dataset) || { name: "Team 1", church: "Church 1", quizzers: [] };
  const teamBObj = getTeamById(match.teamBId, dataset) || { name: "Team 2", church: "Church 2", quizzers: [] };

  // Extract real student lists for Team A and Team B (without rigid seat restrictions)
  const filterRealStudents = (arr) => (arr || [])
    .map(s => String(s || '').trim())
    .filter(s => s && !s.toLowerCase().startsWith('seat #'));

  let studentsA = filterRealStudents(activeSheet.studentsA || match.studentsA || match.seats?.teamA);
  if (studentsA.length === 0) studentsA = filterRealStudents(teamAObj.quizzers);
  if (studentsA.length === 0) studentsA = ["Student 1"];

  let studentsB = filterRealStudents(activeSheet.studentsB || match.studentsB || match.seats?.teamB);
  if (studentsB.length === 0) studentsB = filterRealStudents(teamBObj.quizzers);
  if (studentsB.length === 0) studentsB = ["Student 1"];

  // Defensively sanitize activeSheet.questions:
  // 1. Only questions 1 to 20
  // 2. At most 2 attempts per questionNum (1st attempt + rebound)
  const sanitizedQuestions = [];
  const attemptCountsByQ = {};
  (activeSheet.questions || []).forEach(q => {
    const qNum = parseInt(q.questionNum);
    if (isNaN(qNum) || qNum < 1 || qNum > 20) return;
    attemptCountsByQ[qNum] = (attemptCountsByQ[qNum] || 0) + 1;
    if (attemptCountsByQ[qNum] <= 2) {
      sanitizedQuestions.push(q);
    }
  });
  activeSheet.questions = sanitizedQuestions;
  if (activeSheet.id === 'default') {
    match.questions = sanitizedQuestions;
  }

  // Ensure any student who answered in this sheet is in the list
  (activeSheet.questions || []).forEach(q => {
    if (q.quizzer && typeof q.quizzer === 'string') {
      const qz = q.quizzer.trim();
      if (qz && !qz.toLowerCase().startsWith('seat #')) {
        const isTeamA = q.team === 'teamA' || q.team === 'home';
        const targetList = isTeamA ? studentsA : studentsB;
        if (!targetList.some(s => s.toLowerCase() === qz.toLowerCase())) {
          targetList.push(qz);
        }
      }
    }
  });

  activeSheet.studentsA = studentsA;
  activeSheet.studentsB = studentsB;
  if (activeSheet.id === 'default') {
    match.studentsA = studentsA;
    match.studentsB = studentsB;
    match.seats = { teamA: studentsA, teamB: studentsB, home: studentsA, opponent: studentsB };
  }

  if (!activeSheet.timeouts) {
    activeSheet.timeouts = {
      teamA: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ],
      teamB: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ]
    };
  }
  if (!activeSheet.fouls) {
    activeSheet.fouls = { teamA: [], teamB: [] };
  }
  if (!activeSheet.skippedRebounds) {
    activeSheet.skippedRebounds = [];
  }

  const qoThreshold = isJBQ ? 6 : 5;
  const qoBonusPts = isJBQ ? 10 : 20;

  // Quizzers individual stats maps based on real students
  const teamAStats = {};
  studentsA.forEach((name, idx) => {
    teamAStats[name] = {
      name,
      index: idx,
      seat: idx + 1,
      correct: 0,
      errors: 0,
      fouls: 0,
      points: 0,
      isQuizzedOut: false,
      isErroredOut: false,
      quizOutBonus: 0
    };
  });

  const teamBStats = {};
  studentsB.forEach((name, idx) => {
    teamBStats[name] = {
      name,
      index: idx,
      seat: idx + 1,
      correct: 0,
      errors: 0,
      fouls: 0,
      points: 0,
      isQuizzedOut: false,
      isErroredOut: false,
      quizOutBonus: 0
    };
  });

  // Multi-tier quizzer stat resolver
  const resolveStat = (statsMap, studentList, q) => {
    if (q.quizzer && statsMap[q.quizzer]) return statsMap[q.quizzer];

    if (q.quizzer && typeof q.quizzer === 'string') {
      const qLower = q.quizzer.trim().toLowerCase();
      const matchKey = Object.keys(statsMap).find(k => k.toLowerCase() === qLower);
      if (matchKey) return statsMap[matchKey];
    }

    if (q.quizzer && q.quizzer.trim()) {
      const fallbackName = q.quizzer.trim();
      statsMap[fallbackName] = { name: fallbackName, correct: 0, errors: 0, fouls: 0, points: 0, isQuizzedOut: false, isErroredOut: false, quizOutBonus: 0 };
      return statsMap[fallbackName];
    }

    const firstKey = Object.keys(statsMap)[0];
    return statsMap[firstKey];
  };

  // 20-Question Matrix Rows
  const rows = [];
  let teamARunning = 0;
  let teamBRunning = 0;

  for (let qNum = 1; qNum <= 20; qNum++) {
    let pts = 20;
    if (qNum <= 10) pts = 10;
    else if (qNum <= 17) pts = 20;
    else pts = 30;

    const qList = (activeSheet.questions || []).filter(q => q.questionNum === qNum);
    const teamACells = Array(studentsA.length).fill("");
    const teamBCells = Array(studentsB.length).fill("");
    let note = "";

    qList.forEach(q => {
      const isTeamA = q.team === 'teamA' || q.team === 'home';
      const targetCells = isTeamA ? teamACells : teamBCells;
      const statsMap = isTeamA ? teamAStats : teamBStats;
      const studentList = isTeamA ? studentsA : studentsB;

      let studentIdx = 0;
      if (q.quizzer) {
        const found = studentList.findIndex(s => s && s.toLowerCase() === q.quizzer.toLowerCase());
        if (found !== -1) {
          studentIdx = found;
        } else if (q.seatNum && q.seatNum >= 1 && q.seatNum <= studentList.length) {
          studentIdx = q.seatNum - 1;
        }
      }

      let cellText = "";
      const delta = q.pointValue || pts;

      const stat = resolveStat(statsMap, studentList, q);

      if (q.isCorrect) {
        cellText = `+${delta}`;
        if (isTeamA) teamARunning += delta;
        else teamBRunning += delta;

        stat.correct += 1;
        stat.points += delta;
        if (stat.correct >= qoThreshold) stat.isQuizzedOut = true;
      } else {
        const penalty = Math.round((q.pointValue || pts) / 2);
        cellText = `-${penalty}`;
        if (isTeamA) teamARunning -= penalty;
        else teamBRunning -= penalty;

        stat.errors += 1;
        stat.points -= penalty;
        if (stat.errors >= 3) stat.isErroredOut = true;
      }

      targetCells[studentIdx] = targetCells[studentIdx] ? `${targetCells[studentIdx]}, ${cellText}` : cellText;
    });

    rows.push({
      questionNum: qNum,
      pointValue: pts,
      homeCells: teamACells,
      oppCells: teamBCells,
      homeRunning: teamARunning,
      oppRunning: teamBRunning,
      note,
      hasAnswers: qList.length > 0
    });
  }

  // Quiz-Out Bonuses
  const teamABonuses = [];
  let teamABonusPts = 0;
  Object.values(teamAStats).forEach(s => {
    if (s.correct >= qoThreshold) {
      s.isQuizzedOut = true;
      if (s.errors === 0) {
        const bonus = qoBonusPts;
        s.quizOutBonus = bonus;
        s.points += bonus;
        teamABonusPts += bonus;
        teamABonuses.push({ quizzer: s.name, desc: `${s.name}: Perfect QO (+${bonus})`, points: bonus });
      } else {
        s.quizOutBonus = 0;
        teamABonuses.push({ quizzer: s.name, desc: `${s.name}: Quiz Out (${qoThreshold} correct, ${s.errors} err) (+0)`, points: 0 });
      }
    } else if (s.errors >= 3) {
      s.isErroredOut = true;
    }
  });

  const teamBBonuses = [];
  let teamBBonusPts = 0;
  Object.values(teamBStats).forEach(s => {
    if (s.correct >= qoThreshold) {
      s.isQuizzedOut = true;
      if (s.errors === 0) {
        const bonus = qoBonusPts;
        s.quizOutBonus = bonus;
        s.points += bonus;
        teamBBonusPts += bonus;
        teamBBonuses.push({ quizzer: s.name, desc: `${s.name}: Perfect QO (+${bonus})`, points: bonus });
      } else {
        s.quizOutBonus = 0;
        teamBBonuses.push({ quizzer: s.name, desc: `${s.name}: Quiz Out (${qoThreshold} correct, ${s.errors} err) (+0)`, points: 0 });
      }
    } else if (s.errors >= 3) {
      s.isErroredOut = true;
    }
  });

  const teamAFoulPts = (activeSheet.fouls?.teamA || []).reduce((sum, f) => sum + (f.penalty || 5), 0);
  const teamBFoulPts = (activeSheet.fouls?.teamB || []).reduce((sum, f) => sum + (f.penalty || 5), 0);

  // Tally fouls per quizzer (does NOT count towards error count)
  (activeSheet.fouls?.teamA || []).forEach(f => {
    if (f.quizzer) {
      const stat = resolveStat(teamAStats, studentsA, { quizzer: f.quizzer });
      if (stat) stat.fouls = (stat.fouls || 0) + 1;
    }
  });
  (activeSheet.fouls?.teamB || []).forEach(f => {
    if (f.quizzer) {
      const stat = resolveStat(teamBStats, studentsB, { quizzer: f.quizzer });
      if (stat) stat.fouls = (stat.fouls || 0) + 1;
    }
  });

  const finalScoreA = teamARunning + teamABonusPts - teamAFoulPts;
  const finalScoreB = teamBRunning + teamBBonusPts - teamBFoulPts;

  let winner = "Tie";
  let winnerTeam = "tie";
  if (finalScoreA > finalScoreB) {
    winner = teamAObj.name;
    winnerTeam = "teamA";
  } else if (finalScoreB > finalScoreA) {
    winner = teamBObj.name;
    winnerTeam = "teamB";
  }

  // Compute active/pending question state and rebound status
  let pendingQuestionNum = 1;
  let isReboundPending = false;
  let reboundTeam = null;
  let reboundOriginalQuizzer = null;
  let reboundOriginalTeam = null;
  let reboundPenalty = 0;
  let reboundPointValue = 20;
  let completedQuestionsCount = 0;

  for (let q = 1; q <= 20; q++) {
    const qList = (activeSheet.questions || []).filter(item => item.questionNum === q);
    const isSkipped = (activeSheet.skippedRebounds || []).includes(q);

    if (qList.length === 0) {
      pendingQuestionNum = q;
      break;
    } else if (qList.length === 1 && !isSkipped) {
      const firstAttempt = qList[0];
      // If first attempt was interrupted AND missed, opposite team can answer!
      if (!firstAttempt.isCorrect && firstAttempt.isInterruption) {
        pendingQuestionNum = q;
        isReboundPending = true;
        reboundOriginalTeam = firstAttempt.team;
        reboundOriginalQuizzer = firstAttempt.quizzer;
        reboundTeam = firstAttempt.team === 'teamA' ? 'teamB' : 'teamA';
        reboundPointValue = firstAttempt.pointValue || (q <= 10 ? 10 : (q <= 17 ? 20 : 30));
        reboundPenalty = Math.round(reboundPointValue / 2);
        break;
      } else {
        completedQuestionsCount++;
        pendingQuestionNum = q + 1;
      }
    } else {
      // 2 attempts recorded or 1 attempt with skipped rebound
      completedQuestionsCount++;
      pendingQuestionNum = q + 1;
    }
  }

  // Match is completed if all 20 questions are resolved without pending rebound, or explicitly marked
  const all20Finished = completedQuestionsCount >= 20 && !isReboundPending;
  const isCompleted = activeSheet.status === 'Completed' || !!activeSheet.isCompleted || all20Finished;

  let sheetStatus = 'Scheduled';
  if (isCompleted) {
    sheetStatus = 'Completed';
    activeSheet.status = 'Completed';
    activeSheet.isCompleted = true;
  } else if ((activeSheet.questions || []).length > 0) {
    sheetStatus = 'In Progress';
    activeSheet.status = 'In Progress';
  } else {
    sheetStatus = 'Scheduled';
    activeSheet.status = 'Scheduled';
  }

  if (activeSheet.id === 'default') {
    match.status = sheetStatus;
    match.isCompleted = isCompleted;
  }

  return {
    id: match.id,
    roundNum: match.roundNum || 1,
    matchNumber: match.matchNumber || "01",
    sheetId: activeSheet.id,
    sheetLabel: activeSheet.label || (activeSheet.id === 'default' ? '⭐ Official Master Sheet' : `🎒 ${activeSheet.coachName}'s Sheet`),
    sheetCoachId: activeSheet.coachId,
    sheetCoachName: activeSheet.coachName,
    availableSheets: getAvailableSheetsList(match, dataset),
    audit: auditStatus,
    status: sheetStatus,
    isCompleted,
    completedQuestionsCount,
    room: "",
    quizmaster: match.quizmaster || "Quizmaster",
    scorekeeper: match.scorekeeper || "Scorekeeper",
    totalQuestions: (activeSheet.questions || []).length,
    pendingQuestionNum: isCompleted ? 20 : Math.min(20, pendingQuestionNum),
    reboundStatus: {
      isPending: isCompleted ? false : isReboundPending,
      team: reboundTeam,
      originalTeam: reboundOriginalTeam,
      originalQuizzer: reboundOriginalQuizzer,
      penalty: reboundPenalty,
      pointValue: reboundPointValue
    },
    skippedRebounds: activeSheet.skippedRebounds || [],
    questions: activeSheet.questions || [],
    studentsA,
    studentsB,
    seats: {
      home: studentsA,
      opponent: studentsB,
      teamA: studentsA,
      teamB: studentsB
    },
    timeouts: {
      home: activeSheet.timeouts?.teamA || [],
      opponent: activeSheet.timeouts?.teamB || [],
      teamA: activeSheet.timeouts?.teamA || [],
      teamB: activeSheet.timeouts?.teamB || []
    },
    qoThreshold,
    qoBonusPts,
    teamA: {
      id: teamAObj.id,
      name: teamAObj.name,
      church: teamAObj.church,
      students: studentsA,
      seats: studentsA,
      timeouts: activeSheet.timeouts?.teamA || [],
      fouls: activeSheet.fouls?.teamA || [],
      foulPenaltyPoints: teamAFoulPts,
      bonuses: teamABonuses,
      bonusPoints: teamABonusPts,
      regulationScore: teamARunning,
      foulPenalty: teamAFoulPts,
      runningScore: teamARunning,
      finalScore: finalScoreA,
      quizzers: Object.values(teamAStats)
    },
    teamB: {
      id: teamBObj.id,
      name: teamBObj.name,
      church: teamBObj.church,
      students: studentsB,
      seats: studentsB,
      timeouts: activeSheet.timeouts?.teamB || [],
      fouls: activeSheet.fouls?.teamB || [],
      foulPenaltyPoints: teamBFoulPts,
      bonuses: teamBBonuses,
      bonusPoints: teamBBonusPts,
      regulationScore: teamBRunning,
      foulPenalty: teamBFoulPts,
      runningScore: teamBRunning,
      finalScore: finalScoreB,
      quizzers: Object.values(teamBStats)
    },
    winner,
    winnerTeam,
    rows
  };
}

// Calculate tournament leaderboard standings
function calculateTournamentStandings(datasetParam, isJBQParam) {
  let dataset = datasetParam;
  let isJBQ = isJBQParam;
  if (!dataset) {
    const ctx = getPlatformContext({});
    dataset = ctx.dataset;
    isJBQ = ctx.isJBQ;
  }

  const teams = dataset.teams || [];
  const standingsMap = {};

  teams.forEach(t => {
    standingsMap[t.id] = {
      id: t.id,
      name: t.name,
      church: t.church || t.name,
      quizzers: t.quizzers || [],
      matchesPlayed: 0,
      won: 0,
      lost: 0,
      tied: 0,
      totalPoints: 0,
      avgPoints: 0
    };
  });

  const allMatchKeys = Object.keys(dataset.matches || {});
  allMatchKeys.forEach(mKey => {
    const stats = calculateMatchStats(mKey, dataset, isJBQ);
    if (stats && stats.totalQuestions > 0) {
      const tA = standingsMap[stats.teamA.id];
      const tB = standingsMap[stats.teamB.id];

      if (tA) {
        tA.matchesPlayed += 1;
        tA.totalPoints += stats.teamA.finalScore;
        if (stats.teamA.finalScore > stats.teamB.finalScore) tA.won += 1;
        else if (stats.teamA.finalScore < stats.teamB.finalScore) tA.lost += 1;
        else tA.tied += 1;
      }

      if (tB) {
        tB.matchesPlayed += 1;
        tB.totalPoints += stats.teamB.finalScore;
        if (stats.teamB.finalScore > stats.teamA.finalScore) tB.won += 1;
        else if (stats.teamB.finalScore < stats.teamA.finalScore) tB.lost += 1;
        else tB.tied += 1;
      }
    }
  });

  return Object.values(standingsMap).map(s => {
    s.avgPoints = s.matchesPlayed > 0 ? Math.round(s.totalPoints / s.matchesPlayed) : 0;
    return s;
  }).sort((a, b) => {
    if (b.won !== a.won) return b.won - a.won;
    if (b.avgPoints !== a.avgPoints) return b.avgPoints - a.avgPoints;
    return b.totalPoints - a.totalPoints;
  });
}


// ==========================================
// 4. PLATFORM CONTEXT & MULTI-MEET APIS
// ==========================================

// GET Platform Context & Navigation Tree
app.get('/api/platform/context', (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const user = token && activeSessions.has(token) ? activeSessions.get(token) : null;

  res.json({
    activeLeague: 'jbq',
    userRole: user ? user.role : 'public',
    user: user ? { name: user.name, username: user.username, role: user.role } : null,
    jbq: {
      title: "Junior Bible Quiz",
      activeMeetId: platformData.jbq.activeMeetId,
      activeDivision: platformData.jbq.activeDivision,
      divisions: [
        { id: "b_level", name: "B-Level", description: "Intermediate Division" },
        { id: "c_level", name: "C-Level", description: "Beginner Division" }
      ],
      meets: Object.values(platformData.jbq.meets).map(m => ({
        id: m.id,
        title: m.title,
        date: m.date,
        status: m.status,
        divisionsSummary: Object.keys(m.divisions || {}).map(dKey => ({
          id: dKey,
          name: m.divisions[dKey].name,
          teamsCount: (m.divisions[dKey].teams || []).length,
          matchesCount: Object.keys(m.divisions[dKey].matches || {}).length
        }))
      }))
    },
    divisionsSummary: getDivisionsSummary()
  });
});

// POST Switch Platform Active Meet / Division
app.post('/api/platform/switch', (req, res) => {
  const { meetId, division } = req.body;

  platformData.activeLeague = 'jbq';
  if (meetId && platformData.jbq.meets[meetId]) {
    platformData.jbq.activeMeetId = meetId;
  }

  if (division) {
    const curMeet = platformData.jbq.meets[platformData.jbq.activeMeetId];
    if (curMeet && curMeet.divisions[division]) {
      platformData.jbq.activeDivision = division;
    }
  }

  saveScoresData();
  res.json({
    success: true,
    activeLeague: 'jbq',
    activeMeetId: platformData.jbq.activeMeetId,
    activeDivision: platformData.jbq.activeDivision
  });
});

// Create a new Meet (Any authenticated coach)
app.post('/api/meets/create', authenticateCoach, (req, res) => {
  const { title, date, copyRosterFromMeetId } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Meet title is required.' });
  }

  const meetId = `jbq-meet-${Date.now()}`;
  let bTeams = [];
  let cTeams = [];
  if (copyRosterFromMeetId && platformData.jbq.meets[copyRosterFromMeetId]) {
    const src = platformData.jbq.meets[copyRosterFromMeetId];
    bTeams = JSON.parse(JSON.stringify(src.divisions?.b_level?.teams || []));
    cTeams = JSON.parse(JSON.stringify(src.divisions?.c_level?.teams || []));
  }

  const newMeet = {
    id: meetId,
    league: 'jbq',
    title: title.trim(),
    date: date || new Date().toISOString().split('T')[0],
    status: 'active',
    divisions: {
      b_level: {
        name: 'B-Level',
        teams: bTeams,
        activeMatchId: null,
        matches: {}
      },
      c_level: {
        name: 'C-Level',
        teams: cTeams,
        activeMatchId: null,
        matches: {}
      }
    }
  };
  platformData.jbq.meets[meetId] = newMeet;
  platformData.jbq.activeMeetId = meetId;
  saveScoresData();

  console.log(`[MEET] Coach ${req.user.name} created JBQ Meet: ${newMeet.title} (${meetId})`);
  res.json({
    success: true,
    meet: newMeet,
    league: 'jbq',
    meetId: newMeet.id
  });
});

// Delete a Meet
app.post('/api/meets/delete', authenticateCoach, (req, res) => {
  const { meetId } = req.body;
  if (!meetId) {
    return res.status(400).json({ error: 'Meet ID is required.' });
  }

  const meets = platformData.jbq.meets;
  if (!meets[meetId]) {
    return res.status(404).json({ error: 'Meet not found.' });
  }

  const deletedTitle = meets[meetId].title || meetId;
  delete meets[meetId];

  // Defensive fallback: If all meets were deleted, ensure at least one clean meet exists
  if (Object.keys(meets).length === 0) {
    const defMeet = {
      id: 'jbq-meet-1',
      league: 'jbq',
      title: 'JBQ Tournament 2026',
      date: new Date().toISOString().split('T')[0],
      status: 'active',
      divisions: {
        b_level: { name: 'B-Level', description: 'Intermediate Division', teams: [], matches: {}, activeMatchId: null },
        c_level: { name: 'C-Level', description: 'Beginner Division', teams: [], matches: {}, activeMatchId: null }
      }
    };
    meets[defMeet.id] = defMeet;
    platformData.jbq.activeMeetId = defMeet.id;
  } else if (platformData.jbq.activeMeetId === meetId) {
    platformData.jbq.activeMeetId = Object.keys(meets)[0];
  }

  saveScoresData();
  console.log(`[MEETS] Coach ${req.user.name} deleted meet "${deletedTitle}" (${meetId}). Active meet now: ${platformData.jbq.activeMeetId}`);
  res.json({
    success: true,
    deletedMeetId: meetId,
    activeMeetId: platformData.jbq.activeMeetId,
    divisionsSummary: getDivisionsSummary()
  });
});

// Reset Platform to Scratch (All meets, teams, matches, scores)
app.post('/api/platform/reset-all', authenticateCoach, (req, res) => {
  platformData = getDefaultPlatformData();
  saveScoresData();
  console.log(`[RESET] Coach ${req.user.name} reset platform to clean scratch state.`);
  res.json({ success: true, message: 'All meets, teams, matches, and scores reset to clean scratch state.', divisionsSummary: getDivisionsSummary() });
});


// ==========================================
// 5. PUBLIC SUMMARY & LIVE STANDINGS API
// ==========================================

app.get('/api/tbq/public-summary', (req, res) => {
  const ctx = getPlatformContext(req);
  const standings = calculateTournamentStandings(ctx.dataset, ctx.isJBQ);
  const allMatchKeys = Object.keys(ctx.dataset.matches || {});
  const matchesSummaries = [];

  allMatchKeys.forEach(mKey => {
    const stats = calculateMatchStats(mKey, ctx.dataset, ctx.isJBQ);
    const hasQuestions = stats.totalQuestions > 0;
    matchesSummaries.push({
      id: stats.id,
      matchNumber: stats.matchNumber,
      roundNum: stats.roundNum,
      room: "",
      teamAName: stats.teamA.name,
      teamBName: stats.teamB.name,
      teamAScore: stats.teamA.finalScore,
      teamBScore: stats.teamB.finalScore,
      winner: stats.isCompleted ? stats.winner : (hasQuestions ? 'in_progress' : 'upcoming'),
      winnerTeam: stats.winnerTeam,
      isCompleted: stats.isCompleted,
      status: stats.status,
      totalQuestions: stats.totalQuestions,
      completedQuestionsCount: stats.completedQuestionsCount,
      audit: stats.audit
    });
  });

  res.json({
    league: ctx.league,
    meetId: ctx.meetId,
    division: ctx.division,
    divisionName: ctx.isJBQ ? (ctx.division === 'b_level' ? 'B-Level (1 CIC Team)' : 'C-Level (2 CIC Teams)') : null,
    title: ctx.meet.title,
    date: ctx.meet.date,
    teams: standings,
    matches: matchesSummaries,
    activeMatchId: ctx.dataset.activeMatchId,
    divisionsSummary: getDivisionsSummary()
  });
});


// ==========================================
// 6. COACH MATCH & SCORESHEET APIS
// ==========================================

// GET Teams segregated across JBQ divisions
app.get('/api/teams/by-division', authenticateCoach, (req, res) => {
  const jbqMeetId = platformData.jbq.activeMeetId || Object.keys(platformData.jbq.meets)[0];
  const jbqMeet = platformData.jbq.meets[jbqMeetId] || { divisions: {} };
  const bDiv = jbqMeet.divisions?.b_level || { teams: [] };
  const cDiv = jbqMeet.divisions?.c_level || { teams: [] };

  res.json({
    jbq_b: bDiv.teams || [],
    jbq_c: cDiv.teams || [],
    divisionsSummary: getDivisionsSummary()
  });
});

// GET Active Match & Full Scoresheet
app.get('/api/tbq', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const dataset = ctx.dataset;
  const isSuper = !req.user || req.user.role === 'supercoach';
  const coachTeamIds = getCoachTeamIds(req.user, dataset);

  // Filter matches so non-supercoach coaches ONLY see matches for their assigned team(s)
  const allMatchKeys = Object.keys(dataset.matches);
  const authorizedMatchKeys = allMatchKeys.filter(k => {
    const m = dataset.matches[k];
    return isSuper || isCoachAuthorizedForMatch(req.user, m, dataset);
  });

  // Resolve activeMatchId
  let effectiveActiveMatchId = null;
  const requestedMatchId = req.query.matchId;

  if (requestedMatchId && dataset.matches[requestedMatchId] && (isSuper || authorizedMatchKeys.includes(requestedMatchId))) {
    effectiveActiveMatchId = requestedMatchId;
    if (isSuper) dataset.activeMatchId = requestedMatchId;
  } else if (dataset.activeMatchId && dataset.matches[dataset.activeMatchId] && (isSuper || authorizedMatchKeys.includes(dataset.activeMatchId))) {
    effectiveActiveMatchId = dataset.activeMatchId;
  } else if (authorizedMatchKeys.length > 0) {
    effectiveActiveMatchId = authorizedMatchKeys[0];
    if (isSuper) dataset.activeMatchId = effectiveActiveMatchId;
  }

  const activeMatchObj = effectiveActiveMatchId ? dataset.matches[effectiveActiveMatchId] : null;
  const targetSheetId = resolveTargetSheetId(req, activeMatchObj, dataset);
  const activeMatch = effectiveActiveMatchId ? calculateMatchStats(effectiveActiveMatchId, dataset, ctx.isJBQ, targetSheetId) : null;

  const matchesList = authorizedMatchKeys.map(k => {
    const m = dataset.matches[k];
    const mSheet = resolveTargetSheetId(req, m, dataset);
    const stats = calculateMatchStats(k, dataset, ctx.isJBQ, mSheet);
    const tA = getTeamById(m.teamAId, dataset);
    const tB = getTeamById(m.teamBId, dataset);
    return {
      id: m.id,
      matchNumber: m.matchNumber || "01",
      roundNum: m.roundNum || 1,
      room: "",
      teamAId: m.teamAId,
      teamBId: m.teamBId,
      teamAName: tA ? tA.name : "Team 1",
      teamBName: tB ? tB.name : "Team 2",
      status: stats ? stats.status : (m.status || "Scheduled"),
      isCompleted: stats ? stats.isCompleted : !!m.isCompleted,
      winner: stats ? stats.winner : null,
      audit: stats ? stats.audit : null
    };
  });

  const meetsList = Object.values(platformData[ctx.league].meets).map(m => ({
    id: m.id,
    title: m.title,
    date: m.date,
    status: m.status
  }));

  res.json({
    league: ctx.league,
    meetId: ctx.meetId,
    division: ctx.division,
    meet: {
      title: ctx.meet.title,
      teams: dataset.teams
    },
    activeMatchId: effectiveActiveMatchId,
    matchesList,
    meetsList,
    activeRound: activeMatch,
    divisionsSummary: getDivisionsSummary(),
    userAssignedTeams: coachTeamIds ? Array.from(coachTeamIds) : null
  });
});

// POST Switch Active Match
app.post('/api/matches/switch', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId } = req.body;
  if (matchId && ctx.dataset.matches[matchId]) {
    const targetMatch = ctx.dataset.matches[matchId];
    if (!isCoachAuthorizedForMatch(req.user, targetMatch, ctx.dataset)) {
      return res.status(403).json({ error: 'Unauthorized: You are not assigned to either team in this match.' });
    }
    ctx.dataset.activeMatchId = matchId;
    saveScoresData();
  }
  const curMatch = ctx.dataset.matches[ctx.dataset.activeMatchId];
  const targetSheetId = resolveTargetSheetId(req, curMatch, ctx.dataset);
  res.json({ success: true, activeRound: calculateMatchStats(ctx.dataset.activeMatchId, ctx.dataset, ctx.isJBQ, targetSheetId) });
});

// POST Save / Add / Update a Team
app.post('/api/teams/save', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { teamId, name, church, quizzers, coachId, coach2Id } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Team name is required.' });
  }

  // If editing an existing team, remove from other division datasets if moving divisions
  if (teamId) {
    if (platformData.jbq && platformData.jbq.meets) {
      for (const mId in platformData.jbq.meets) {
        const m = platformData.jbq.meets[mId];
        if (m.divisions) {
          for (const dKey in m.divisions) {
            const dObj = m.divisions[dKey];
            if (dObj.teams && dObj !== ctx.dataset) {
              dObj.teams = dObj.teams.filter(t => t.id !== teamId);
            }
          }
        }
      }
    }
  }

  let targetTeam = ctx.dataset.teams.find(t => t.id === teamId);
  if (!targetTeam) {
    targetTeam = {
      id: teamId || `team-${Date.now()}`,
      name: name.trim(),
      church: (church || name).trim(),
      quizzers: []
    };
    ctx.dataset.teams.push(targetTeam);
  } else {
    targetTeam.name = name.trim();
    if (church) targetTeam.church = church.trim();
  }

  // Associate Primary Coach
  if (coachId && coachId !== 'none' && coachId !== 'unassigned') {
    const assignedCoach = coaches.find(c => c.id === coachId || c.username === coachId);
    if (assignedCoach) {
      targetTeam.coachId = assignedCoach.id;
      targetTeam.coachName = assignedCoach.name;
      targetTeam.coachUsername = assignedCoach.username;
    } else {
      delete targetTeam.coachId;
      delete targetTeam.coachName;
      delete targetTeam.coachUsername;
    }
  } else if (coachId === '' || coachId === 'none' || coachId === 'unassigned') {
    delete targetTeam.coachId;
    delete targetTeam.coachName;
    delete targetTeam.coachUsername;
  }

  // Associate Assistant / 2nd Coach
  if (coach2Id && coach2Id !== 'none' && coach2Id !== 'unassigned') {
    const assignedCoach2 = coaches.find(c => c.id === coach2Id || c.username === coach2Id);
    if (assignedCoach2) {
      targetTeam.coach2Id = assignedCoach2.id;
      targetTeam.coach2Name = assignedCoach2.name;
      targetTeam.coach2Username = assignedCoach2.username;
    } else {
      delete targetTeam.coach2Id;
      delete targetTeam.coach2Name;
      delete targetTeam.coach2Username;
    }
  } else if (coach2Id === '' || coach2Id === 'none' || coach2Id === 'unassigned') {
    delete targetTeam.coach2Id;
    delete targetTeam.coach2Name;
    delete targetTeam.coach2Username;
  }

  // Unified coaches list for multi-coach support
  const coachesArr = [];
  if (targetTeam.coachId) {
    coachesArr.push({ id: targetTeam.coachId, name: targetTeam.coachName, username: targetTeam.coachUsername, role: 'primary' });
  }
  if (targetTeam.coach2Id && targetTeam.coach2Id !== targetTeam.coachId) {
    coachesArr.push({ id: targetTeam.coach2Id, name: targetTeam.coach2Name, username: targetTeam.coach2Username, role: 'assistant' });
  }
  targetTeam.coaches = coachesArr;

  if (Array.isArray(quizzers)) {
    targetTeam.quizzers = quizzers.map(q => String(q).trim()).filter(Boolean);
  } else if (typeof quizzers === 'string') {
    targetTeam.quizzers = quizzers.split(/[\n,]+/).map(q => q.trim()).filter(Boolean);
  }

  saveScoresData();
  const coachLabel = coachesArr.map(c => c.name).join(' & ') || 'unassigned';
  console.log(`[TEAM] Coach ${req.user.name} saved team: ${targetTeam.name} (${targetTeam.quizzers.length} quizzers, coaches: ${coachLabel}) in ${ctx.league.toUpperCase()} ${ctx.division || ''}`);
  res.json({
    success: true,
    team: targetTeam,
    teams: ctx.dataset.teams,
    divisionsSummary: getDivisionsSummary()
  });
});

// POST Delete a Team
app.post('/api/teams/delete', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { teamId } = req.body;
  ctx.dataset.teams = (ctx.dataset.teams || []).filter(t => t.id !== teamId);
  saveScoresData();
  res.json({ success: true, teams: ctx.dataset.teams, divisionsSummary: getDivisionsSummary() });
});

// POST Clear All Teams
app.post('/api/teams/clear-all', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  ctx.dataset.teams = [];
  saveScoresData();
  console.log(`[TEAM] Coach ${req.user.name} cleared all teams in ${ctx.league.toUpperCase()} ${ctx.division || ''}`);
  res.json({ success: true, teams: [], divisionsSummary: getDivisionsSummary() });
});

// POST Add a New Match
app.post('/api/matches/add', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { roundNum, matchNumber, room, teamAId, teamBId } = req.body;

  const newId = `match-${Date.now()}`;
  const tA = getTeamById(teamAId, ctx.dataset) || (ctx.dataset.teams[0] || { id: "team-1", quizzers: [] });
  const tB = getTeamById(teamBId, ctx.dataset) || (ctx.dataset.teams[1] || { id: "team-2", quizzers: [] });
  const mNum = parseInt(roundNum) || 1;
  const seatLimit = ctx.isJBQ ? 4 : 5;

  const newMatch = {
    id: newId,
    roundNum: mNum,
    matchNumber: String(matchNumber || `0${Object.keys(ctx.dataset.matches).length + 1}`).trim(),
    room: String(room || "").trim(),
    teamAId: tA.id,
    teamBId: tB.id,
    seats: {
      teamA: (tA.quizzers || []).slice(0, seatLimit),
      teamB: (tB.quizzers || []).slice(0, seatLimit)
    },
    timeouts: {
      teamA: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ],
      teamB: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ]
    },
    fouls: { teamA: [], teamB: [] },
    questions: []
  };

  ctx.dataset.matches[newId] = newMatch;
  ctx.dataset.activeMatchId = newId;
  saveScoresData();

  console.log(`[MATCH] Coach ${req.user.name} created Match #${newMatch.matchNumber} (${ctx.league.toUpperCase()} ${ctx.division || ''})`);
  res.json({
    success: true,
    match: newMatch,
    activeRound: calculateMatchStats(newId, ctx.dataset, ctx.isJBQ),
    divisionsSummary: getDivisionsSummary()
  });
});

// POST Update an Existing Match
app.post('/api/matches/update', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId, roundNum, matchNumber, room, teamAId, teamBId } = req.body;
  if (!matchId || !ctx.dataset.matches[matchId]) {
    return res.status(404).json({ error: 'Match not found.' });
  }

  const match = ctx.dataset.matches[matchId];
  const seatLimit = ctx.isJBQ ? 4 : 5;

  if (roundNum !== undefined) match.roundNum = parseInt(roundNum) || 1;
  if (matchNumber !== undefined) match.matchNumber = String(matchNumber).trim();
  if (room !== undefined) match.room = String(room).trim();

  if (teamAId && teamAId !== match.teamAId) {
    match.teamAId = teamAId;
    const tA = getTeamById(teamAId, ctx.dataset);
    if (tA && tA.quizzers && tA.quizzers.length > 0) {
      match.seats.teamA = (tA.quizzers || []).slice(0, seatLimit);
    }
  }
  if (teamBId && teamBId !== match.teamBId) {
    match.teamBId = teamBId;
    const tB = getTeamById(teamBId, ctx.dataset);
    if (tB && tB.quizzers && tB.quizzers.length > 0) {
      match.seats.teamB = (tB.quizzers || []).slice(0, seatLimit);
    }
  }

  saveScoresData();
  res.json({
    success: true,
    match,
    activeRound: calculateMatchStats(match.id, ctx.dataset, ctx.isJBQ),
    divisionsSummary: getDivisionsSummary()
  });
});

// POST Delete a Match
app.post('/api/matches/delete', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId } = req.body;
  if (!matchId || !ctx.dataset.matches[matchId]) {
    return res.status(404).json({ error: 'Match not found.' });
  }

  const keys = Object.keys(ctx.dataset.matches);
  if (keys.length <= 1) {
    return res.status(400).json({ error: 'Cannot delete the only remaining match.' });
  }

  delete ctx.dataset.matches[matchId];
  if (ctx.dataset.activeMatchId === matchId) {
    ctx.dataset.activeMatchId = Object.keys(ctx.dataset.matches)[0];
  }

  saveScoresData();
  res.json({
    success: true,
    activeMatchId: ctx.dataset.activeMatchId,
    divisionsSummary: getDivisionsSummary()
  });
});

// POST Update Match Details & Students
app.post('/api/tbq/match-info', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId, roundNum, matchNumber, room, teamAId, teamBId, studentsA: inStudentsA, studentsB: inStudentsB, seatsHome, seatsOpp } = req.body;
  const mId = matchId || ctx.dataset.activeMatchId;
  const match = ctx.dataset.matches[mId];

  if (!match) return res.status(404).json({ error: 'Match not found.' });
  if (!isCoachAuthorizedForMatch(req.user, match, ctx.dataset)) {
    return res.status(403).json({ error: 'Unauthorized: You are not assigned to either team in this match.' });
  }

  if (roundNum !== undefined) match.roundNum = parseInt(roundNum) || 1;
  if (matchNumber !== undefined) match.matchNumber = String(matchNumber).trim();
  if (room !== undefined) match.room = String(room).trim();
  if (teamAId) match.teamAId = teamAId;
  if (teamBId) match.teamBId = teamBId;

  const rawA = inStudentsA || seatsHome;
  if (Array.isArray(rawA)) {
    match.studentsA = rawA.map(s => String(s || '').trim()).filter(s => s && !s.toLowerCase().startsWith('seat #'));
    match.seats = match.seats || {};
    match.seats.teamA = match.studentsA;
    match.seats.home = match.studentsA;
    const teamA = getTeamById(match.teamAId, ctx.dataset);
    if (teamA) {
      match.studentsA.forEach(name => {
        if (!teamA.quizzers.includes(name)) teamA.quizzers.push(name);
      });
    }
  }

  const rawB = inStudentsB || seatsOpp;
  if (Array.isArray(rawB)) {
    match.studentsB = rawB.map(s => String(s || '').trim()).filter(s => s && !s.toLowerCase().startsWith('seat #'));
    match.seats = match.seats || {};
    match.seats.teamB = match.studentsB;
    match.seats.opponent = match.studentsB;
    const teamB = getTeamById(match.teamBId, ctx.dataset);
    if (teamB) {
      match.studentsB.forEach(name => {
        if (!teamB.quizzers.includes(name)) teamB.quizzers.push(name);
      });
    }
  }

  saveScoresData();
  res.json({ success: true, activeRound: calculateMatchStats(mId, ctx.dataset, ctx.isJBQ) });
});

// POST Explicit Save Scoresheet Endpoint
app.post('/api/tbq/save-sheet', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId, studentsA: inStudentsA, studentsB: inStudentsB, seatsHome, seatsOpp } = req.body || {};
  const mId = matchId || ctx.dataset.activeMatchId;
  const match = ctx.dataset.matches[mId];

  if (!match) return res.status(404).json({ error: 'Match not found.' });
  if (!isCoachAuthorizedForMatch(req.user, match, ctx.dataset)) {
    return res.status(403).json({ error: 'Unauthorized: You are not assigned to either team in this match.' });
  }

  const targetSheetId = resolveTargetSheetId(req, match, ctx.dataset);
  const activeSheet = getMatchSheet(match, targetSheetId);

  const rawA = inStudentsA || seatsHome;
  if (Array.isArray(rawA)) {
    const cleanA = rawA.map(s => String(s || '').trim()).filter(s => s && !s.toLowerCase().startsWith('seat #'));
    activeSheet.studentsA = cleanA;
    if (targetSheetId === 'default') {
      match.studentsA = cleanA;
      match.seats = match.seats || {};
      match.seats.teamA = cleanA;
      match.seats.home = cleanA;
    }
  }
  const rawB = inStudentsB || seatsOpp;
  if (Array.isArray(rawB)) {
    const cleanB = rawB.map(s => String(s || '').trim()).filter(s => s && !s.toLowerCase().startsWith('seat #'));
    activeSheet.studentsB = cleanB;
    if (targetSheetId === 'default') {
      match.studentsB = cleanB;
      match.seats = match.seats || {};
      match.seats.teamB = cleanB;
      match.seats.opponent = cleanB;
    }
  }

  saveScoresData();
  console.log(`[SCORESHEET] Scoresheet saved for match ${mId} (Sheet: ${targetSheetId})`);
  res.json({ success: true, message: 'Scoresheet saved successfully.', activeRound: calculateMatchStats(mId, ctx.dataset, ctx.isJBQ, targetSheetId) });
});

// POST Record Question Score (COACH ONLY)
app.post('/api/tbq/score', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId, questionNum, pointValue, isInterruption, isRebound, team, quizzer, isCorrect } = req.body;
  const mId = matchId || ctx.dataset.activeMatchId;
  const match = ctx.dataset.matches[mId];

  if (!match) return res.status(404).json({ error: 'Match not found.' });
  if (!isCoachAuthorizedForMatch(req.user, match, ctx.dataset)) {
    return res.status(403).json({ error: 'Unauthorized: You are not assigned to either team in this match.' });
  }

  const targetSheetId = resolveTargetSheetId(req, match, ctx.dataset);
  const activeSheet = getMatchSheet(match, targetSheetId);
  const currentStats = calculateMatchStats(mId, ctx.dataset, ctx.isJBQ, targetSheetId);

  if (currentStats.isCompleted) {
    return res.status(400).json({
      error: `Match #${match.matchNumber} is already completed (all 20 questions scored). Tap "Undo Last" if you need to adjust Question #20.`
    });
  }

  let qNum = parseInt(questionNum);
  if (isNaN(qNum) || qNum < 1) {
    qNum = currentStats.pendingQuestionNum || 1;
  }

  if (qNum > 20) {
    return res.status(400).json({
      error: 'A match only has 20 questions. All 20 questions have already been scored.'
    });
  }

  // Prevent multiple answers for already resolved questions in activeSheet
  const existingAttempts = (activeSheet.questions || []).filter(item => item.questionNum === qNum);
  const isSkipped = (activeSheet.skippedRebounds || []).includes(qNum);
  const isReboundOpportunity = currentStats.reboundStatus?.isPending && currentStats.pendingQuestionNum === qNum;

  if (existingAttempts.length >= 2 || (existingAttempts.length === 1 && !isReboundOpportunity && !isSkipped && (existingAttempts[0].isCorrect || !existingAttempts[0].isInterruption))) {
    return res.status(400).json({
      error: `Question #${qNum} is already resolved. Cannot record further answers for Question #${qNum}.`
    });
  }

  const isTeamA = team === 'teamA' || team === 'home';
  const teamStats = isTeamA ? currentStats.teamA : currentStats.teamB;
  const quizzerClean = String(quizzer || '').trim().toLowerCase();

  const quizzerStat = teamStats.quizzers.find(q => 
    (q.name && quizzerClean && q.name.trim().toLowerCase() === quizzerClean)
  );

  const qoLimit = ctx.isJBQ ? 6 : 5;
  if (quizzerStat) {
    if (quizzerStat.isQuizzedOut) {
      return res.status(400).json({
        error: `${quizzerStat.name || quizzer} has already Quizzed Out (${qoLimit} correct answers) and cannot buzz in for further questions in this match.`
      });
    }
    if (quizzerStat.isErroredOut) {
      return res.status(400).json({
        error: `${quizzerStat.name || quizzer} has already Errored Out (3 errors) and must remain seated for the remainder of this match.`
      });
    }
  }

  const isCorrectBool = isCorrect === true || isCorrect === 'true' || isCorrect === 1 || isCorrect === '1';
  const defaultList = isTeamA ? (currentStats.studentsA || []) : (currentStats.studentsB || []);
  const resolvedName = (quizzer && String(quizzer).trim()) 
    ? String(quizzer).trim() 
    : (defaultList[0] || 'Student 1');

  // If student is not yet in the sheet's student list, add them
  const targetStudents = isTeamA ? activeSheet.studentsA : activeSheet.studentsB;
  if (targetStudents && !targetStudents.some(s => s.toLowerCase() === resolvedName.toLowerCase())) {
    targetStudents.push(resolvedName);
  }
  if (targetSheetId === 'default') {
    const mTarget = isTeamA ? match.studentsA : match.studentsB;
    if (mTarget && !mTarget.some(s => s.toLowerCase() === resolvedName.toLowerCase())) {
      mTarget.push(resolvedName);
    }
  }

  const newQuestion = {
    id: `q-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    questionNum: qNum,
    pointValue: parseInt(pointValue) || 20,
    isInterruption: !!isInterruption,
    isRebound: !!isRebound,
    team: isTeamA ? 'teamA' : 'teamB',
    quizzer: resolvedName,
    isCorrect: isCorrectBool,
    scoredBy: req.user.name,
    timestamp: new Date().toISOString()
  };

  activeSheet.questions.push(newQuestion);
  if (targetSheetId === 'default') {
    match.questions = activeSheet.questions;
  }

  const updatedStats = calculateMatchStats(mId, ctx.dataset, ctx.isJBQ, targetSheetId);
  if (updatedStats.isCompleted) {
    activeSheet.status = 'Completed';
    activeSheet.isCompleted = true;
    if (targetSheetId === 'default') {
      match.status = 'Completed';
      match.isCompleted = true;
    }
  }
  saveScoresData();

  console.log(`[SCORE] Match #${match.matchNumber} (Sheet: ${targetSheetId}) Q#${newQuestion.questionNum}: ${newQuestion.quizzer} (${newQuestion.team}) [${newQuestion.isCorrect ? 'CORRECT' : 'INCORRECT'}] ${newQuestion.pointValue}pts${updatedStats.isCompleted ? ' [MATCH COMPLETED]' : ''}`);
  res.json({ success: true, activeRound: updatedStats });
});

// POST Toggle / Update Timeout
app.post('/api/tbq/timeout', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId, team, timeoutId, used, questionNum } = req.body;
  const mId = matchId || ctx.dataset.activeMatchId;
  const match = ctx.dataset.matches[mId];

  if (!match) return res.status(404).json({ error: 'Match not found.' });
  if (!isCoachAuthorizedForMatch(req.user, match, ctx.dataset)) {
    return res.status(403).json({ error: 'Unauthorized: You are not assigned to either team in this match.' });
  }

  const targetSheetId = resolveTargetSheetId(req, match, ctx.dataset);
  const activeSheet = getMatchSheet(match, targetSheetId);

  const isTeamA = team === 'teamA' || team === 'home';
  const key = isTeamA ? 'teamA' : 'teamB';
  if (!activeSheet.timeouts[key]) activeSheet.timeouts[key] = [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ];

  const t = activeSheet.timeouts[key].find(item => item.id === parseInt(timeoutId));
  if (t) {
    t.used = !!used;
    t.questionNum = used ? (questionNum || `Q${activeSheet.questions.length || 1}`) : "";
  }
  if (targetSheetId === 'default') {
    match.timeouts = activeSheet.timeouts;
  }

  saveScoresData();
  res.json({ success: true, activeRound: calculateMatchStats(mId, ctx.dataset, ctx.isJBQ, targetSheetId) });
});

// POST Add or Delete Team Foul
app.post('/api/tbq/foul', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId, team, action, foulId, reason, penalty, quizzer, questionNum } = req.body;
  const mId = matchId || ctx.dataset.activeMatchId;
  const match = ctx.dataset.matches[mId];

  if (!match) return res.status(404).json({ error: 'Match not found.' });
  if (!isCoachAuthorizedForMatch(req.user, match, ctx.dataset)) {
    return res.status(403).json({ error: 'Unauthorized: You are not assigned to either team in this match.' });
  }

  const targetSheetId = resolveTargetSheetId(req, match, ctx.dataset);
  const activeSheet = getMatchSheet(match, targetSheetId);

  const isTeamA = team === 'teamA' || team === 'home';
  const key = isTeamA ? 'teamA' : 'teamB';
  if (!activeSheet.fouls[key]) activeSheet.fouls[key] = [];

  if (action === 'delete') {
    activeSheet.fouls[key] = activeSheet.fouls[key].filter(f => f.id !== foulId);
  } else if (action === 'undo') {
    if (activeSheet.fouls[key] && activeSheet.fouls[key].length > 0) {
      activeSheet.fouls[key].pop();
    }
  } else {
    const quizzerClean = quizzer ? String(quizzer).trim() : null;
    const defaultReason = quizzerClean ? `Foul on ${quizzerClean} (-5)` : 'Team Foul (-5)';
    const newFoul = {
      id: `foul-${Date.now()}`,
      quizzer: quizzerClean,
      questionNum: questionNum ? parseInt(questionNum) : null,
      reason: (reason || defaultReason).trim(),
      penalty: parseInt(penalty) || 5,
      timestamp: new Date().toISOString(),
      calledBy: req.user.name
    };
    activeSheet.fouls[key].push(newFoul);
  }
  if (targetSheetId === 'default') {
    match.fouls = activeSheet.fouls;
  }

  saveScoresData();
  res.json({ success: true, activeRound: calculateMatchStats(mId, ctx.dataset, ctx.isJBQ, targetSheetId) });
});

// POST Undo Question (supports both /api/tbq/undo and /api/tbq/undo-question)
const handleUndoQuestion = (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId } = req.body;
  const mId = matchId || ctx.dataset.activeMatchId;
  let match = ctx.dataset.matches[mId];
  if (!match && ctx.dataset.activeMatchId) match = ctx.dataset.matches[ctx.dataset.activeMatchId];
  if (!match && Object.keys(ctx.dataset.matches).length > 0) {
    match = ctx.dataset.matches[Object.keys(ctx.dataset.matches)[0]];
  }

  if (match) {
    if (!isCoachAuthorizedForMatch(req.user, match, ctx.dataset)) {
      return res.status(403).json({ error: 'Unauthorized: You are not assigned to either team in this match.' });
    }

    const targetSheetId = resolveTargetSheetId(req, match, ctx.dataset);
    const activeSheet = getMatchSheet(match, targetSheetId);

    if (activeSheet.questions && activeSheet.questions.length > 0) {
      const removed = activeSheet.questions.pop();
      if (removed && activeSheet.skippedRebounds) {
        activeSheet.skippedRebounds = activeSheet.skippedRebounds.filter(q => q !== removed.questionNum);
      }
      delete activeSheet.isCompleted;
      if (activeSheet.status === 'Completed') {
        activeSheet.status = 'In Progress';
      }
      if (targetSheetId === 'default') {
        match.questions = activeSheet.questions;
        match.skippedRebounds = activeSheet.skippedRebounds;
        delete match.isCompleted;
        if (match.status === 'Completed') {
          match.status = 'In Progress';
        }
      }
      saveScoresData();
      return res.json({ success: true, removed, activeRound: calculateMatchStats(match.id, ctx.dataset, ctx.isJBQ, targetSheetId) });
    }
  }

  res.status(400).json({ error: 'No questions to undo in this sheet.' });
};
app.post('/api/tbq/undo', authenticateCoach, handleUndoQuestion);
app.post('/api/tbq/undo-question', authenticateCoach, handleUndoQuestion);

// POST Explicitly Finish Match
app.post('/api/tbq/finish-match', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId } = req.body;
  const mId = matchId || ctx.dataset.activeMatchId;
  const match = ctx.dataset.matches[mId];
  if (!match) return res.status(404).json({ error: 'Match not found.' });
  if (!isCoachAuthorizedForMatch(req.user, match, ctx.dataset)) {
    return res.status(403).json({ error: 'Unauthorized: You are not assigned to either team in this match.' });
  }

  const targetSheetId = resolveTargetSheetId(req, match, ctx.dataset);
  const activeSheet = getMatchSheet(match, targetSheetId);

  activeSheet.status = 'Completed';
  activeSheet.isCompleted = true;
  if (targetSheetId === 'default') {
    match.status = 'Completed';
    match.isCompleted = true;
  }
  saveScoresData();
  res.json({ success: true, activeRound: calculateMatchStats(mId, ctx.dataset, ctx.isJBQ, targetSheetId) });
});

// POST Reopen a Completed Match
app.post('/api/tbq/reopen-match', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId } = req.body;
  const mId = matchId || ctx.dataset.activeMatchId;
  const match = ctx.dataset.matches[mId];
  if (!match) return res.status(404).json({ error: 'Match not found.' });
  if (!isCoachAuthorizedForMatch(req.user, match, ctx.dataset)) {
    return res.status(403).json({ error: 'Unauthorized: You are not assigned to either team in this match.' });
  }

  const targetSheetId = resolveTargetSheetId(req, match, ctx.dataset);
  const activeSheet = getMatchSheet(match, targetSheetId);

  delete activeSheet.isCompleted;
  activeSheet.status = (activeSheet.questions || []).length > 0 ? 'In Progress' : 'Scheduled';
  if (targetSheetId === 'default') {
    delete match.isCompleted;
    match.status = (match.questions || []).length > 0 ? 'In Progress' : 'Scheduled';
  }
  saveScoresData();
  res.json({ success: true, activeRound: calculateMatchStats(mId, ctx.dataset, ctx.isJBQ, targetSheetId) });
});

// POST Skip Rebound for a Question
app.post('/api/tbq/skip-rebound', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId, questionNum } = req.body;
  const mId = matchId || ctx.dataset.activeMatchId;
  let match = ctx.dataset.matches[mId];
  if (!match && ctx.dataset.activeMatchId) match = ctx.dataset.matches[ctx.dataset.activeMatchId];
  if (!match) return res.status(404).json({ error: 'Match not found.' });
  if (!isCoachAuthorizedForMatch(req.user, match, ctx.dataset)) {
    return res.status(403).json({ error: 'Unauthorized: You are not assigned to either team in this match.' });
  }

  const targetSheetId = resolveTargetSheetId(req, match, ctx.dataset);
  const activeSheet = getMatchSheet(match, targetSheetId);

  const q = parseInt(questionNum);
  if (!activeSheet.skippedRebounds) activeSheet.skippedRebounds = [];
  if (!isNaN(q) && !activeSheet.skippedRebounds.includes(q)) {
    activeSheet.skippedRebounds.push(q);
  }
  if (targetSheetId === 'default') {
    if (!match.skippedRebounds) match.skippedRebounds = [];
    if (!isNaN(q) && !match.skippedRebounds.includes(q)) {
      match.skippedRebounds.push(q);
    }
  }
  saveScoresData();
  const activeRound = calculateMatchStats(match.id, ctx.dataset, ctx.isJBQ, targetSheetId);
  res.json({ success: true, activeRound });
});

// POST Reset Match
app.post('/api/tbq/reset-round', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId } = req.body;
  const mId = matchId || ctx.dataset.activeMatchId;
  let match = ctx.dataset.matches[mId];
  if (!match && ctx.dataset.activeMatchId) match = ctx.dataset.matches[ctx.dataset.activeMatchId];
  if (!match && Object.keys(ctx.dataset.matches).length > 0) {
    match = ctx.dataset.matches[Object.keys(ctx.dataset.matches)[0]];
  }

  if (match) {
    if (!isCoachAuthorizedForMatch(req.user, match, ctx.dataset)) {
      return res.status(403).json({ error: 'Unauthorized: You are not assigned to either team in this match.' });
    }

    const targetSheetId = resolveTargetSheetId(req, match, ctx.dataset);
    const activeSheet = getMatchSheet(match, targetSheetId);

    activeSheet.questions = [];
    activeSheet.skippedRebounds = [];
    activeSheet.timeouts = {
      teamA: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ],
      teamB: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ]
    };
    activeSheet.fouls = { teamA: [], teamB: [] };
    delete activeSheet.isCompleted;
    activeSheet.status = 'Scheduled';

    if (targetSheetId === 'default' || req.body.resetAllSheets || (!req.body.sheetId && req.user?.role === 'supercoach')) {
      Object.keys(match.sheets || {}).forEach(k => {
        const s = match.sheets[k];
        s.questions = [];
        s.skippedRebounds = [];
        s.timeouts = {
          teamA: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ],
          teamB: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ]
        };
        s.fouls = { teamA: [], teamB: [] };
        delete s.isCompleted;
        s.status = 'Scheduled';
      });
      delete match.officialSheetId;
      match.questions = [];
      match.skippedRebounds = [];
      match.timeouts = {
        teamA: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ],
        teamB: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ]
      };
      match.fouls = { teamA: [], teamB: [] };
      delete match.isCompleted;
      match.status = 'Scheduled';
    }
    saveScoresData();
    const activeStats = calculateMatchStats(match.id, ctx.dataset, ctx.isJBQ, targetSheetId);
    return res.json({ success: true, activeRound: activeStats });
  }

  res.status(404).json({ error: 'Match not found.' });
});

// POST Copy Official Master Sheet into Coach's Private Sheet
app.post('/api/tbq/copy-from-official', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId } = req.body;
  const mId = matchId || ctx.dataset.activeMatchId;
  const match = ctx.dataset.matches[mId];
  if (!match) return res.status(404).json({ error: 'Match not found.' });
  if (!isCoachAuthorizedForMatch(req.user, match, ctx.dataset)) {
    return res.status(403).json({ error: 'Unauthorized: You are not assigned to either team in this match.' });
  }

  const targetSheetId = resolveTargetSheetId(req, match, ctx.dataset);
  if (targetSheetId === 'default') {
    return res.status(400).json({ error: 'Cannot clone official sheet onto itself.' });
  }

  ensureMatchSheets(match, ctx.dataset);
  const masterSheet = match.sheets['default'];
  const activeSheet = getMatchSheet(match, targetSheetId);

  activeSheet.questions = JSON.parse(JSON.stringify(masterSheet.questions || []));
  activeSheet.timeouts = JSON.parse(JSON.stringify(masterSheet.timeouts || { teamA: [], teamB: [] }));
  activeSheet.fouls = JSON.parse(JSON.stringify(masterSheet.fouls || { teamA: [], teamB: [] }));
  activeSheet.skippedRebounds = JSON.parse(JSON.stringify(masterSheet.skippedRebounds || []));
  activeSheet.status = masterSheet.status;
  activeSheet.isCompleted = masterSheet.isCompleted;

  saveScoresData();
  res.json({ success: true, message: 'Copied official master sheet.', activeRound: calculateMatchStats(mId, ctx.dataset, ctx.isJBQ, targetSheetId) });
});

// POST Designate Official Sheet for a Match (Super Coach only)
app.post('/api/matches/set-official-sheet', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId, sheetId } = req.body;
  const mId = matchId || ctx.dataset.activeMatchId;
  const match = ctx.dataset.matches[mId];

  if (!match) return res.status(404).json({ error: 'Match not found.' });
  if (req.user.role !== 'supercoach') {
    return res.status(403).json({ error: 'Only Super Coaches can resolve discrepancies and designate the official scoresheet.' });
  }

  ensureMatchSheets(match, ctx.dataset);

  if (!sheetId || sheetId === 'auto') {
    delete match.officialSheetId;
    saveScoresData();
    const audit = getMatchAuditStatus(match, ctx.dataset, ctx.isJBQ);
    return res.json({ success: true, matchId: mId, officialSheetId: null, audit });
  }

  const chosenSheet = match.sheets[sheetId];
  if (!chosenSheet) {
    return res.status(400).json({ error: 'Selected sheet does not exist.' });
  }

  match.officialSheetId = sheetId;

  // Mirror chosen sheet to 'default' master sheet
  match.sheets['default'].questions = JSON.parse(JSON.stringify(chosenSheet.questions || []));
  match.sheets['default'].studentsA = JSON.parse(JSON.stringify(chosenSheet.studentsA || []));
  match.sheets['default'].studentsB = JSON.parse(JSON.stringify(chosenSheet.studentsB || []));
  match.sheets['default'].timeouts = JSON.parse(JSON.stringify(chosenSheet.timeouts || { teamA: [], teamB: [] }));
  match.sheets['default'].fouls = JSON.parse(JSON.stringify(chosenSheet.fouls || { teamA: [], teamB: [] }));
  match.sheets['default'].skippedRebounds = JSON.parse(JSON.stringify(chosenSheet.skippedRebounds || []));
  match.sheets['default'].status = chosenSheet.status;
  match.sheets['default'].isCompleted = chosenSheet.isCompleted;

  match.questions = match.sheets['default'].questions;
  match.studentsA = match.sheets['default'].studentsA;
  match.studentsB = match.sheets['default'].studentsB;
  match.timeouts = match.sheets['default'].timeouts;
  match.fouls = match.sheets['default'].fouls;
  match.skippedRebounds = match.sheets['default'].skippedRebounds;
  match.status = match.sheets['default'].status;
  match.isCompleted = match.sheets['default'].isCompleted;

  saveScoresData();
  console.log(`[AUDIT] Super Coach ${req.user.name} set official sheet for match ${mId} to ${sheetId} (${chosenSheet.coachName})`);

  const audit = getMatchAuditStatus(match, ctx.dataset, ctx.isJBQ);
  res.json({
    success: true,
    matchId: mId,
    officialSheetId: sheetId,
    audit,
    activeRound: calculateMatchStats(mId, ctx.dataset, ctx.isJBQ, sheetId)
  });
});

// POST Update Meet Title / Overall Settings
app.post('/api/tbq/settings', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { title } = req.body;
  if (title) ctx.meet.title = title.trim();
  saveScoresData();
  res.json({ success: true, meet: ctx.meet });
});


// ==========================================
// 7. SYSTEM STATUS & BACKUP / RESTORE
// ==========================================

// GET Storage & System Status
app.get('/api/system/status', (req, res) => {
  const ctx = getPlatformContext(req);
  res.json({
    status: 'ok',
    storage: dbPool ? 'postgresql' : 'local_json',
    persistent: Boolean(dbPool),
    uptimeSeconds: Math.round(process.uptime()),
    activeLeague: platformData.activeLeague,
    matchesCount: Object.keys(ctx.dataset.matches || {}).length,
    teamsCount: (ctx.dataset.teams || []).length
  });
});

// GET Full JSON Backup (Coach or Super Coach)
app.get('/api/tbq/backup', authenticateCoach, (req, res) => {
  const dateStr = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="jbq-platform-backup-${dateStr}.json"`);
  res.send(JSON.stringify(platformData, null, 2));
});

// POST Restore Full Backup (Super Coach only)
app.post('/api/tbq/restore', authenticateCoach, (req, res) => {
  if (req.user.role !== 'supercoach') {
    return res.status(403).json({ error: 'Only Super Coaches can restore platform backups.' });
  }

  const { backupData } = req.body;
  if (!backupData) {
    return res.status(400).json({ error: 'Invalid backup format.' });
  }

  if (backupData.jbq) {
    platformData = backupData;
  }

  saveScoresData();
  console.log(`[BACKUP] Super Coach ${req.user.name} restored platform data from backup file`);
  res.json({ success: true, message: 'Platform data restored successfully.' });
});


// ==========================================
// 8. INITIALIZE STORAGE & START SERVER
// ==========================================

async function initStorage() {
  if (dbPool) {
    console.log('[PG] Database-first mode active. Connecting to PostgreSQL...');
    try {
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS tbq_store (
          key VARCHAR(100) PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log('[PG] Table "tbq_store" verified.');

      // 1. Restore or seed Coaches directly from Database
      const coachesRes = await dbPool.query(`SELECT value FROM tbq_store WHERE key = 'coaches'`);
      if (coachesRes.rows.length > 0 && coachesRes.rows[0].value) {
        let loadedCoaches = coachesRes.rows[0].value;
        if (typeof loadedCoaches === 'string') {
          try { loadedCoaches = JSON.parse(loadedCoaches); } catch (e) {}
        }
        if (Array.isArray(loadedCoaches) && loadedCoaches.length > 0) {
          coaches = loadedCoaches;
          ensureStandardCoaches();
          console.log(`[PG] Restored ${coaches.length} coaches directly from database.`);
        } else {
          coaches = getDefaultCoaches();
          await dbPool.query(
            `INSERT INTO tbq_store (key, value, updated_at) VALUES ('coaches', $1::jsonb, NOW())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [JSON.stringify(coaches)]
          );
          console.log('[PG] Initialized default coaches in database.');
        }
      } else {
        coaches = getDefaultCoaches();
        await dbPool.query(
          `INSERT INTO tbq_store (key, value, updated_at) VALUES ('coaches', $1::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [JSON.stringify(coaches)]
        );
        console.log('[PG] Seeded initial coaches into database.');
      }

      // 2. Restore or seed Scores Data directly from Database
      const scoresRes = await dbPool.query(`SELECT value FROM tbq_store WHERE key = 'scores'`);
      if (scoresRes.rows.length > 0 && scoresRes.rows[0].value) {
        let loadedScores = scoresRes.rows[0].value;
        if (typeof loadedScores === 'string') {
          try { loadedScores = JSON.parse(loadedScores); } catch (e) {}
        }
        if (loadedScores && typeof loadedScores === 'object' && loadedScores.jbq) {
          platformData = loadedScores;
          platformData.activeLeague = 'jbq';
          if (platformData.tbq) delete platformData.tbq;
          console.log('[PG] Restored all JBQ meets, divisions, teams & matches directly from database.');
        } else {
          console.log('[PG] Initializing default platform data in database.');
          platformData = getDefaultPlatformData();
          await dbPool.query(
            `INSERT INTO tbq_store (key, value, updated_at) VALUES ('scores', $1::jsonb, NOW())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [JSON.stringify(platformData)]
          );
        }
      } else {
        platformData = getDefaultPlatformData();
        await dbPool.query(
          `INSERT INTO tbq_store (key, value, updated_at) VALUES ('scores', $1::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [JSON.stringify(platformData)]
        );
        console.log('[PG] Seeded initial JBQ platform data into database.');
      }

      // 3. Restore Active Sessions directly from Database
      const sessionsRes = await dbPool.query(`SELECT value FROM tbq_store WHERE key = 'sessions'`);
      if (sessionsRes.rows.length > 0 && sessionsRes.rows[0].value) {
        let loadedSessions = sessionsRes.rows[0].value;
        if (typeof loadedSessions === 'string') {
          try { loadedSessions = JSON.parse(loadedSessions); } catch (e) {}
        }
        if (Array.isArray(loadedSessions)) {
          loadedSessions.forEach(([token, user]) => {
            activeSessions.set(token, user);
          });
          console.log(`[PG] Restored ${activeSessions.size} active login sessions directly from database.`);
        }
      }

      console.log('[PG] Database-first initialization complete. No static files loaded!');
      return;
    } catch (err) {
      console.error('[PG] Database connection/init failed. Falling back to local files:', err.message);
    }
  }

  // Fallback to local files ONLY if no DATABASE_URL or if database connection failed
  console.log('[STORAGE] No DATABASE_URL configured or DB unreachable. Running in local fallback mode.');
  loadCoachesLocal();
  loadScoresDataLocal();
  loadSessionsLocal();
}

// Start Server after Storage initialization
initStorage().then(() => {
  app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(`Junior Bible Quiz (JBQ) Platform running on port ${PORT}`);
    console.log(`Storage engine: ${dbPool ? 'PostgreSQL (Persistent)' : 'Local JSON'}`);
    console.log(`Super Coach: supercoach / super2026`);
    console.log(`JBQ Coach:   jbqcoach / jbq2026`);
    console.log(`=================================================`);
  });
}).catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
