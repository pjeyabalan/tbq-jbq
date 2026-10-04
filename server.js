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

function getDefaultCoaches() {
  return [
    {
      id: "coach-super",
      name: "Super Coach (Admin)",
      username: "supercoach",
      passcode: "super2026",
      role: "supercoach", // Full admin for TBQ and JBQ
      createdAt: new Date().toISOString()
    },
    {
      id: "coach-tbq",
      name: "TBQ Coach",
      username: "coach",
      passcode: "coach2026",
      role: "tbq_coach", // Dedicated TBQ Coach
      createdAt: new Date().toISOString()
    },
    {
      id: "coach-jbq",
      name: "JBQ Coach",
      username: "jbqcoach",
      passcode: "jbq2026",
      role: "jbq_coach", // Dedicated JBQ Coach (B & C Levels)
      createdAt: new Date().toISOString()
    }
  ];
}

function loadCoachesLocal() {
  if (fs.existsSync(COACHES_FILE)) {
    try {
      coaches = JSON.parse(fs.readFileSync(COACHES_FILE, 'utf8'));
      // Ensure coaches have updated roles and jbqcoach exists
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

  // Map any legacy 'coach' role to 'tbq_coach'
  coaches.forEach(c => {
    if (c.role === 'coach' || !c.role) {
      c.role = 'tbq_coach';
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
  const tbqUser = coaches.find(c => c.username === 'coach');
  if (!tbqUser) {
    coaches.push({
      id: "coach-tbq",
      name: "TBQ Coach",
      username: "coach",
      passcode: "coach2026",
      role: "tbq_coach",
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
  saveCoachesLocal();
  if (dbPool) {
    dbPool.query(
      `INSERT INTO tbq_store (key, value, updated_at) VALUES ('coaches', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(coaches)]
    ).catch(err => console.error('[PG] Error saving coaches to DB:', err.message));
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
    role: matched.role || (matched.username === 'supercoach' ? 'supercoach' : matched.username === 'jbqcoach' ? 'jbq_coach' : 'tbq_coach')
  };
  activeSessions.set(token, userSafe);
  saveSessionsLocal();

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
    saveSessionsLocal();
  }
  res.json({ success: true, message: 'Logged out.' });
});

// Verify Current User
app.get('/api/auth/me', authenticateCoach, (req, res) => {
  res.json({ success: true, user: req.user });
});

// Super Coach: Get all coaches
app.get('/api/coaches', authenticateCoach, requireSuperCoach, (req, res) => {
  const safeList = coaches.map(c => ({
    id: c.id,
    name: c.name,
    username: c.username,
    role: c.role || 'tbq_coach',
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

  const validRoles = ['supercoach', 'tbq_coach', 'jbq_coach'];
  const assignedRole = validRoles.includes(role) ? role : 'tbq_coach';

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
  saveSessionsLocal();

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

function getDefaultPlatformData() {
  // TBQ Meet 1
  const defaultTbqMeet1 = {
    id: "tbq-meet-1",
    league: "tbq",
    title: "TBQ Meet 1 (October 2026)",
    date: "2026-10-03",
    status: "active",
    teams: [
      {
        id: "team-cic-1",
        name: "Chicago Indian Church - Team 1",
        church: "Chicago Indian Church",
        quizzers: ["Sam", "Mia", "Ben", "Jade", "Noah"]
      },
      {
        id: "team-cic-2",
        name: "Chicago Indian Church - Team 2",
        church: "Chicago Indian Church",
        quizzers: ["Prakash", "Deevena", "Amiel", "Hosanna", "Isabelle"]
      },
      {
        id: "team-3",
        name: "Team 3 (TBD)",
        church: "Opponent Church A",
        quizzers: ["Leo", "Ava", "Eli", "Timothy", "Hannah"]
      },
      {
        id: "team-4",
        name: "Team 4 (TBD)",
        church: "Opponent Church B",
        quizzers: ["Quizzer 1", "Quizzer 2", "Quizzer 3", "Quizzer 4", "Quizzer 5"]
      }
    ],
    activeMatchId: "match-1",
    matches: {
      "match-1": {
        id: "match-1",
        roundNum: 1,
        matchNumber: "01",
        room: "",
        quizmaster: "Pastor John",
        scorekeeper: "Sarah M.",
        teamAId: "team-cic-1",
        teamBId: "team-3",
        seats: {
          teamA: ["Sam", "Mia", "Ben", "Jade", "Noah"],
          teamB: ["Leo", "Ava", "Eli", "Timothy", "Hannah"]
        },
        timeouts: {
          teamA: [ { id: 1, used: true, questionNum: "Q8" }, { id: 2, used: false, questionNum: "" } ],
          teamB: [ { id: 1, used: true, questionNum: "Q4" }, { id: 2, used: true, questionNum: "Q18" } ]
        },
        fouls: {
          teamA: [],
          teamB: [ { id: "foul-1", reason: "Bench talking (-5)", penalty: 5, timestamp: "2026-10-02T18:00:00.000Z" } ]
        },
        questions: [
          { id: "q-1", questionNum: 1, pointValue: 10, team: "teamA", quizzer: "Sam", seatNum: 1, isCorrect: true, isInterruption: false, isRebound: false },
          { id: "q-2", questionNum: 2, pointValue: 20, team: "teamA", quizzer: "Mia", seatNum: 2, isCorrect: true, isInterruption: false, isRebound: false },
          { id: "q-3", questionNum: 3, pointValue: 10, team: "teamB", quizzer: "Leo", seatNum: 1, isCorrect: true, isInterruption: false, isRebound: false },
          { id: "q-4a", questionNum: 4, pointValue: 30, team: "teamA", quizzer: "Sam", seatNum: 1, isCorrect: false, isInterruption: true, isRebound: false },
          { id: "q-4b", questionNum: 4, pointValue: 30, team: "teamB", quizzer: "Ava", seatNum: 2, isCorrect: true, isInterruption: false, isRebound: true },
          { id: "q-5", questionNum: 5, pointValue: 20, team: "teamA", quizzer: "Ben", seatNum: 3, isCorrect: true, isInterruption: false, isRebound: false },
          { id: "q-6", questionNum: 6, pointValue: 20, team: "teamA", quizzer: "Sam", seatNum: 1, isCorrect: true, isInterruption: false, isRebound: false },
          { id: "q-7", questionNum: 7, pointValue: 10, team: "teamB", quizzer: "Leo", seatNum: 1, isCorrect: true, isInterruption: false, isRebound: false },
          { id: "q-8", questionNum: 8, pointValue: 20, team: "teamA", quizzer: "Mia", seatNum: 2, isCorrect: true, isInterruption: false, isRebound: false },
          { id: "q-9", questionNum: 9, pointValue: 20, team: "teamB", quizzer: "Ava", seatNum: 2, isCorrect: true, isInterruption: false, isRebound: false },
          { id: "q-10", questionNum: 10, pointValue: 20, team: "teamA", quizzer: "Jade", seatNum: 4, isCorrect: true, isInterruption: false, isRebound: false },
          { id: "q-11", questionNum: 11, pointValue: 20, team: "teamB", quizzer: "Eli", seatNum: 3, isCorrect: true, isInterruption: false, isRebound: false },
          { id: "q-12", questionNum: 12, pointValue: 20, team: "teamA", quizzer: "Mia", seatNum: 2, isCorrect: true, isInterruption: false, isRebound: false },
          { id: "q-13", questionNum: 13, pointValue: 20, team: "teamB", quizzer: "Timothy", seatNum: 4, isCorrect: true, isInterruption: false, isRebound: false },
          { id: "q-14", questionNum: 14, pointValue: 20, team: "teamA", quizzer: "Ben", seatNum: 3, isCorrect: true, isInterruption: false, isRebound: false },
          { id: "q-15", questionNum: 15, pointValue: 20, team: "teamB", quizzer: "Hannah", seatNum: 5, isCorrect: true, isInterruption: false, isRebound: false },
          { id: "q-16", questionNum: 16, pointValue: 20, team: "teamA", quizzer: "Sam", seatNum: 1, isCorrect: true, isInterruption: false, isRebound: false },
          { id: "q-17", questionNum: 17, pointValue: 20, team: "teamA", quizzer: "Sam", seatNum: 1, isCorrect: true, isInterruption: false, isRebound: false },
          { id: "q-18", questionNum: 18, pointValue: 30, team: "teamA", quizzer: "Mia", seatNum: 2, isCorrect: true, isInterruption: false, isRebound: false },
          { id: "q-19", questionNum: 19, pointValue: 20, team: "teamB", quizzer: "Eli", seatNum: 3, isCorrect: true, isInterruption: false, isRebound: false },
          { id: "q-20", questionNum: 20, pointValue: 10, team: "teamA", quizzer: "Sam", seatNum: 1, isCorrect: true, isInterruption: false, isRebound: false }
        ]
      },
      "match-2": {
        id: "match-2",
        roundNum: 1,
        matchNumber: "02",
        room: "",
        teamAId: "team-cic-2",
        teamBId: "team-4",
        seats: {
          teamA: ["Prakash", "Deevena", "Amiel", "Hosanna", "Isabelle"],
          teamB: ["Quizzer 1", "Quizzer 2", "Quizzer 3", "Quizzer 4", "Quizzer 5"]
        },
        timeouts: {
          teamA: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ],
          teamB: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ]
        },
        fouls: { teamA: [], teamB: [] },
        questions: []
      }
    }
  };

  // TBQ Meet 2 (Nov/Dec 2026)
  const defaultTbqMeet2 = {
    id: "tbq-meet-2",
    league: "tbq",
    title: "TBQ Meet 2 (Nov / Dec 2026)",
    date: "2026-11-21",
    status: "upcoming",
    teams: JSON.parse(JSON.stringify(defaultTbqMeet1.teams)),
    activeMatchId: "match-tbq-2-1",
    matches: {
      "match-tbq-2-1": {
        id: "match-tbq-2-1",
        roundNum: 1,
        matchNumber: "01",
        room: "",
        teamAId: "team-cic-1",
        teamBId: "team-3",
        seats: {
          teamA: ["Sam", "Mia", "Ben", "Jade", "Noah"],
          teamB: ["Leo", "Ava", "Eli", "Timothy", "Hannah"]
        },
        timeouts: { teamA: [{ id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" }], teamB: [{ id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" }] },
        fouls: { teamA: [], teamB: [] },
        questions: []
      }
    }
  };

  // JBQ Meet 1 (October 16, 2026)
  const defaultJbqMeet1 = {
    id: "jbq-meet-1",
    league: "jbq",
    title: "JBQ Meet 1 (October 16, 2026)",
    date: "2026-10-16",
    status: "active",
    divisions: {
      "b_level": {
        name: "B-Level",
        description: "Intermediate Division (1 CIC Team)",
        teams: [
          {
            id: "jbq-team-cic-b1",
            name: "Chicago Indian Church - B1",
            church: "Chicago Indian Church",
            quizzers: ["Noah", "Ethan", "Chloe", "Sarah"]
          },
          {
            id: "jbq-team-opp-b1",
            name: "Calvary Church - B1",
            church: "Calvary Church",
            quizzers: ["Mark", "Luke", "John", "Paul"]
          }
        ],
        activeMatchId: "jbq-b-match-1",
        matches: {
          "jbq-b-match-1": {
            id: "jbq-b-match-1",
            roundNum: 1,
            matchNumber: "B-01",
            room: "",
            teamAId: "jbq-team-cic-b1",
            teamBId: "jbq-team-opp-b1",
            seats: {
              teamA: ["Noah", "Ethan", "Chloe", "Sarah"],
              teamB: ["Mark", "Luke", "John", "Paul"]
            },
            timeouts: {
              teamA: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ],
              teamB: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ]
            },
            fouls: { teamA: [], teamB: [] },
            questions: []
          }
        }
      },
      "c_level": {
        name: "C-Level",
        description: "Beginner Division (2 CIC Teams)",
        teams: [
          {
            id: "jbq-team-cic-c1",
            name: "Chicago Indian Church - C1",
            church: "Chicago Indian Church",
            quizzers: ["David", "Grace", "Lucas", "Maya"]
          },
          {
            id: "jbq-team-cic-c2",
            name: "Chicago Indian Church - C2",
            church: "Chicago Indian Church",
            quizzers: ["Joshua", "Hannah", "Caleb", "Ruth"]
          },
          {
            id: "jbq-team-opp-c1",
            name: "First Assembly - C1",
            church: "First Assembly",
            quizzers: ["Tim", "Anna", "Rachel", "Samuel"]
          }
        ],
        activeMatchId: "jbq-c-match-1",
        matches: {
          "jbq-c-match-1": {
            id: "jbq-c-match-1",
            roundNum: 1,
            matchNumber: "C-01",
            room: "",
            teamAId: "jbq-team-cic-c1",
            teamBId: "jbq-team-cic-c2",
            seats: {
              teamA: ["David", "Grace", "Lucas", "Maya"],
              teamB: ["Joshua", "Hannah", "Caleb", "Ruth"]
            },
            timeouts: {
              teamA: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ],
              teamB: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ]
            },
            fouls: { teamA: [], teamB: [] },
            questions: []
          }
        }
      }
    }
  };

  // JBQ Meet 2 (Nov/Dec 2026)
  const defaultJbqMeet2 = {
    id: "jbq-meet-2",
    league: "jbq",
    title: "JBQ Meet 2 (Nov / Dec 2026)",
    date: "2026-11-20",
    status: "upcoming",
    divisions: {
      "b_level": {
        name: "B-Level",
        description: "Intermediate Division (1 CIC Team)",
        teams: [
          {
            id: "jbq-team-cic-b1",
            name: "Chicago Indian Church - B1",
            church: "Chicago Indian Church",
            quizzers: ["Noah", "Ethan", "Chloe", "Sarah"]
          }
        ],
        activeMatchId: "jbq-b2-match-1",
        matches: {
          "jbq-b2-match-1": {
            id: "jbq-b2-match-1",
            roundNum: 1,
            matchNumber: "B-01",
            room: "",
            teamAId: "jbq-team-cic-b1",
            teamBId: "jbq-team-cic-b1",
            seats: {
              teamA: ["Noah", "Ethan", "Chloe", "Sarah"],
              teamB: ["Seat 1", "Seat 2", "Seat 3", "Seat 4"]
            },
            timeouts: { teamA: [{ id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" }], teamB: [{ id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" }] },
            fouls: { teamA: [], teamB: [] },
            questions: []
          }
        }
      },
      "c_level": {
        name: "C-Level",
        description: "Beginner Division (2 CIC Teams)",
        teams: [
          {
            id: "jbq-team-cic-c1",
            name: "Chicago Indian Church - C1",
            church: "Chicago Indian Church",
            quizzers: ["David", "Grace", "Lucas", "Maya"]
          },
          {
            id: "jbq-team-cic-c2",
            name: "Chicago Indian Church - C2",
            church: "Chicago Indian Church",
            quizzers: ["Joshua", "Hannah", "Caleb", "Ruth"]
          }
        ],
        activeMatchId: "jbq-c2-match-1",
        matches: {
          "jbq-c2-match-1": {
            id: "jbq-c2-match-1",
            roundNum: 1,
            matchNumber: "C-01",
            room: "",
            teamAId: "jbq-team-cic-c1",
            teamBId: "jbq-team-cic-c2",
            seats: {
              teamA: ["David", "Grace", "Lucas", "Maya"],
              teamB: ["Joshua", "Hannah", "Caleb", "Ruth"]
            },
            timeouts: { teamA: [{ id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" }], teamB: [{ id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" }] },
            fouls: { teamA: [], teamB: [] },
            questions: []
          }
        }
      }
    }
  };

  return {
    activeLeague: "tbq",
    tbq: {
      activeMeetId: "tbq-meet-1",
      meets: {
        "tbq-meet-1": defaultTbqMeet1,
        "tbq-meet-2": defaultTbqMeet2
      }
    },
    jbq: {
      activeMeetId: "jbq-meet-1",
      activeDivision: "b_level",
      meets: {
        "jbq-meet-1": defaultJbqMeet1,
        "jbq-meet-2": defaultJbqMeet2
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
      if (loaded.tbq && loaded.jbq) {
        platformData = loaded;
        return;
      }
      
      // Backward compatibility: Migrate legacy single-meet structure into TBQ Meet 1
      if (loaded.meet && loaded.matches) {
        console.log('[MIGRATION] Migrating legacy single-meet scores to Multi-Meet platform structure');
        platformData.tbq.meets['tbq-meet-1'].title = loaded.meet.title || "TBQ Meet 1 (October 2026)";
        platformData.tbq.meets['tbq-meet-1'].teams = loaded.meet.teams || [];
        platformData.tbq.meets['tbq-meet-1'].matches = loaded.matches || {};
        platformData.tbq.meets['tbq-meet-1'].activeMatchId = loaded.activeMatchId || Object.keys(loaded.matches)[0] || "match-1";
        saveScoresDataLocal();
        return;
      }
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
  saveScoresDataLocal();
  if (dbPool) {
    dbPool.query(
      `INSERT INTO tbq_store (key, value, updated_at) VALUES ('scores', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [platformData]
    ).catch(err => console.error('[PG] Error persisting scores to DB:', err.message));
  }
}

// Context Resolver: Resolves current league, meet, division, and active dataset
function getPlatformContext(req) {
  let league = (req.headers['x-quiz-league'] || req.query?.league || req.body?.league || platformData.activeLeague || 'tbq').toLowerCase();
  if (league !== 'jbq') league = 'tbq';

  // Role permissions check
  if (req.user) {
    if (req.user.role === 'jbq_coach') {
      league = 'jbq';
    } else if (req.user.role === 'tbq_coach' || req.user.role === 'coach') {
      league = 'tbq';
    }
  }

  const leagueData = platformData[league];
  let meetId = req.headers['x-quiz-meet'] || req.query?.meetId || req.body?.meetId || leagueData.activeMeetId;
  if (!leagueData.meets[meetId]) {
    meetId = leagueData.activeMeetId || Object.keys(leagueData.meets)[0];
  }
  const meet = leagueData.meets[meetId];

  let division = null;
  let dataset = null;
  if (league === 'jbq') {
    division = req.headers['x-quiz-division'] || req.query?.division || req.body?.division || leagueData.activeDivision || 'b_level';
    if (!meet.divisions || !meet.divisions[division]) {
      division = Object.keys(meet.divisions || {})[0] || 'b_level';
    }
    dataset = meet.divisions[division];
  } else {
    dataset = meet;
  }

  if (!dataset.teams) dataset.teams = [];
  if (!dataset.matches) dataset.matches = {};
  if (!dataset.activeMatchId || !dataset.matches[dataset.activeMatchId]) {
    dataset.activeMatchId = Object.keys(dataset.matches)[0] || '';
  }

  return {
    league,
    meetId,
    meet,
    division,
    dataset,
    isJBQ: league === 'jbq'
  };
}

// Find team helper within dataset
function getTeamById(teamId, dataset) {
  if (!dataset || !dataset.teams) return null;
  return dataset.teams.find(t => t.id === teamId) || null;
}

// ==========================================
// 3. STATS & SCORING CALCULATION ENGINE
// ==========================================

function calculateMatchStats(matchId, datasetParam, isJBQParam) {
  let dataset = datasetParam;
  let isJBQ = isJBQParam;
  if (!dataset) {
    const ctx = getPlatformContext({});
    dataset = ctx.dataset;
    isJBQ = ctx.isJBQ;
  }

  let mId = matchId || dataset.activeMatchId;
  let match = dataset.matches[mId];

  if (!match) {
    const firstKey = Object.keys(dataset.matches)[0];
    if (firstKey) {
      match = dataset.matches[firstKey];
      mId = firstKey;
    } else {
      match = {
        id: "match-1",
        roundNum: 1,
        matchNumber: "01",
        room: "",
        teamAId: dataset.teams[0]?.id || "team-1",
        teamBId: dataset.teams[1]?.id || "team-2",
        seats: {
          teamA: (dataset.teams[0]?.quizzers || []).slice(0, isJBQ ? 4 : 5),
          teamB: (dataset.teams[1]?.quizzers || []).slice(0, isJBQ ? 4 : 5)
        },
        timeouts: {
          teamA: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ],
          teamB: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ]
        },
        fouls: { teamA: [], teamB: [] },
        questions: []
      };
      dataset.matches["match-1"] = match;
    }
  }

  const teamAObj = getTeamById(match.teamAId, dataset) || { name: "Team 1", church: "Church 1", quizzers: [] };
  const teamBObj = getTeamById(match.teamBId, dataset) || { name: "Team 2", church: "Church 2", quizzers: [] };

  // Extract real student lists for Team A and Team B (without rigid seat restrictions)
  const filterRealStudents = (arr) => (arr || [])
    .map(s => String(s || '').trim())
    .filter(s => s && !s.toLowerCase().startsWith('seat #'));

  let studentsA = filterRealStudents(match.studentsA || match.seats?.teamA);
  if (studentsA.length === 0) studentsA = filterRealStudents(teamAObj.quizzers);
  if (studentsA.length === 0) studentsA = ["Student 1"];

  let studentsB = filterRealStudents(match.studentsB || match.seats?.teamB);
  if (studentsB.length === 0) studentsB = filterRealStudents(teamBObj.quizzers);
  if (studentsB.length === 0) studentsB = ["Student 1"];

  // Ensure any student who answered in this match is in the list
  (match.questions || []).forEach(q => {
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

  match.studentsA = studentsA;
  match.studentsB = studentsB;
  match.seats = { teamA: studentsA, teamB: studentsB, home: studentsA, opponent: studentsB };

  if (!match.timeouts) {
    match.timeouts = {
      teamA: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ],
      teamB: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ]
    };
  }
  if (!match.fouls) {
    match.fouls = { teamA: [], teamB: [] };
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
      statsMap[fallbackName] = { name: fallbackName, correct: 0, errors: 0, points: 0, isQuizzedOut: false, isErroredOut: false, quizOutBonus: 0 };
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

    const qList = (match.questions || []).filter(q => q.questionNum === qNum);
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
        if (q.isInterruption) {
          const penalty = Math.round(q.pointValue / 2);
          cellText = `-${penalty}`;
          if (isTeamA) teamARunning -= penalty;
          else teamBRunning -= penalty;

          stat.errors += 1;
          stat.points -= penalty;
          if (stat.errors >= 3) stat.isErroredOut = true;
        } else {
          cellText = "0 (Err)";
          stat.errors += 1;
          if (stat.errors >= 3) stat.isErroredOut = true;
        }
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

  const teamAFoulPts = (match.fouls?.teamA || []).reduce((sum, f) => sum + (f.penalty || 5), 0);
  const teamBFoulPts = (match.fouls?.teamB || []).reduce((sum, f) => sum + (f.penalty || 5), 0);

  const finalScoreA = teamARunning + teamABonusPts - teamAFoulPts;
  const finalScoreB = teamBRunning + teamBBonusPts - teamBFoulPts;

  let winner = "Tie";
  if (finalScoreA > finalScoreB) winner = teamAObj.name;
  else if (finalScoreB > finalScoreA) winner = teamBObj.name;

  // Compute active/pending question state and rebound status
  let pendingQuestionNum = 1;
  let isReboundPending = false;
  let reboundTeam = null;
  let reboundOriginalQuizzer = null;
  let reboundOriginalTeam = null;
  let reboundPenalty = 0;
  let reboundPointValue = 20;

  for (let q = 1; q <= 20; q++) {
    const qList = (match.questions || []).filter(item => item.questionNum === q);
    const isSkipped = (match.skippedRebounds || []).includes(q);

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
      }
    }
    pendingQuestionNum = q + 1;
  }
  if (pendingQuestionNum > 20) pendingQuestionNum = 20;

  return {
    id: match.id,
    roundNum: match.roundNum || 1,
    matchNumber: match.matchNumber || "01",
    room: "",
    quizmaster: match.quizmaster || "Quizmaster",
    scorekeeper: match.scorekeeper || "Scorekeeper",
    totalQuestions: (match.questions || []).length,
    pendingQuestionNum,
    reboundStatus: {
      isPending: isReboundPending,
      team: reboundTeam,
      originalTeam: reboundOriginalTeam,
      originalQuizzer: reboundOriginalQuizzer,
      penalty: reboundPenalty,
      pointValue: reboundPointValue
    },
    skippedRebounds: match.skippedRebounds || [],
    questions: match.questions || [],
    studentsA,
    studentsB,
    seats: {
      home: studentsA,
      opponent: studentsB,
      teamA: studentsA,
      teamB: studentsB
    },
    timeouts: {
      home: match.timeouts?.teamA || [],
      opponent: match.timeouts?.teamB || [],
      teamA: match.timeouts?.teamA || [],
      teamB: match.timeouts?.teamB || []
    },
    qoThreshold,
    qoBonusPts,
    teamA: {
      id: teamAObj.id,
      name: teamAObj.name,
      church: teamAObj.church,
      students: studentsA,
      seats: studentsA,
      timeouts: match.timeouts?.teamA || [],
      fouls: match.fouls?.teamA || [],
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
      timeouts: match.timeouts?.teamB || [],
      fouls: match.fouls?.teamB || [],
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
    if (stats.totalQuestions > 0) {
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
    activeLeague: platformData.activeLeague,
    userRole: user ? user.role : 'public',
    user: user ? { name: user.name, username: user.username, role: user.role } : null,
    tbq: {
      title: "Teen Bible Quiz",
      activeMeetId: platformData.tbq.activeMeetId,
      meets: Object.values(platformData.tbq.meets).map(m => ({
        id: m.id,
        title: m.title,
        date: m.date,
        status: m.status,
        matchesCount: Object.keys(m.matches || {}).length,
        teamsCount: (m.teams || []).length
      }))
    },
    jbq: {
      title: "Junior Bible Quiz",
      activeMeetId: platformData.jbq.activeMeetId,
      activeDivision: platformData.jbq.activeDivision,
      divisions: [
        { id: "b_level", name: "B-Level (1 CIC Team)", description: "Intermediate Division" },
        { id: "c_level", name: "C-Level (2 CIC Teams)", description: "Beginner Division" }
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
    }
  });
});

// POST Switch Platform Active League / Meet / Division
app.post('/api/platform/switch', (req, res) => {
  const { league, meetId, division } = req.body;

  if (league) {
    const l = league.toLowerCase();
    if (l === 'tbq' || l === 'jbq') {
      platformData.activeLeague = l;
    }
  }

  const curLeague = platformData.activeLeague;
  if (meetId && platformData[curLeague].meets[meetId]) {
    platformData[curLeague].activeMeetId = meetId;
  }

  if (curLeague === 'jbq' && division) {
    const curMeet = platformData.jbq.meets[platformData.jbq.activeMeetId];
    if (curMeet && curMeet.divisions[division]) {
      platformData.jbq.activeDivision = division;
    }
  }

  saveScoresData();
  res.json({
    success: true,
    activeLeague: platformData.activeLeague,
    activeMeetId: platformData[platformData.activeLeague].activeMeetId,
    activeDivision: platformData.jbq.activeDivision
  });
});

// Super Coach: Create a new Meet (e.g. Meet 2 in Nov/Dec)
app.post('/api/meets/create', authenticateCoach, requireSuperCoach, (req, res) => {
  const { league, title, date, copyRosterFromMeetId } = req.body;
  const l = (league || 'tbq').toLowerCase() === 'jbq' ? 'jbq' : 'tbq';

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Meet title is required.' });
  }

  const meetId = `${l}-meet-${Date.now()}`;

  if (l === 'tbq') {
    let teams = [];
    if (copyRosterFromMeetId && platformData.tbq.meets[copyRosterFromMeetId]) {
      teams = JSON.parse(JSON.stringify(platformData.tbq.meets[copyRosterFromMeetId].teams || []));
    } else {
      teams = [
        { id: `team-cic-1`, name: "Chicago Indian Church - Team 1", church: "Chicago Indian Church", quizzers: ["Sam", "Mia", "Ben", "Jade", "Noah"] },
        { id: `team-cic-2`, name: "Chicago Indian Church - Team 2", church: "Chicago Indian Church", quizzers: ["Prakash", "Deevena", "Amiel", "Hosanna", "Isabelle"] },
        { id: `team-3`, name: "Team 3 (TBD)", church: "Opponent Church A", quizzers: ["Leo", "Ava", "Eli", "Timothy", "Hannah"] },
        { id: `team-4`, name: "Team 4 (TBD)", church: "Opponent Church B", quizzers: ["Quizzer 1", "Quizzer 2", "Quizzer 3", "Quizzer 4", "Quizzer 5"] }
      ];
    }

    const newMeet = {
      id: meetId,
      league: 'tbq',
      title: title.trim(),
      date: date || new Date().toISOString().split('T')[0],
      status: 'upcoming',
      teams,
      activeMatchId: 'match-1',
      matches: {
        'match-1': {
          id: 'match-1',
          roundNum: 1,
          matchNumber: '01',
          room: '',
          teamAId: teams[0]?.id || 'team-1',
          teamBId: teams[1]?.id || 'team-2',
          seats: {
            teamA: (teams[0]?.quizzers || []).slice(0, 5),
            teamB: (teams[1]?.quizzers || []).slice(0, 5)
          },
          timeouts: { teamA: [{ id: 1, used: false, questionNum: '' }, { id: 2, used: false, questionNum: '' }], teamB: [{ id: 1, used: false, questionNum: '' }, { id: 2, used: false, questionNum: '' }] },
          fouls: { teamA: [], teamB: [] },
          questions: []
        }
      }
    };
    platformData.tbq.meets[meetId] = newMeet;
    platformData.tbq.activeMeetId = meetId;
  } else {
    // JBQ
    let bTeams = [];
    let cTeams = [];
    if (copyRosterFromMeetId && platformData.jbq.meets[copyRosterFromMeetId]) {
      const src = platformData.jbq.meets[copyRosterFromMeetId];
      bTeams = JSON.parse(JSON.stringify(src.divisions?.b_level?.teams || []));
      cTeams = JSON.parse(JSON.stringify(src.divisions?.c_level?.teams || []));
    } else {
      bTeams = [
        { id: 'jbq-team-cic-b1', name: 'Chicago Indian Church - B1', church: 'Chicago Indian Church', quizzers: ['Noah', 'Ethan', 'Chloe', 'Sarah'] },
        { id: 'jbq-team-opp-b1', name: 'Opponent Church - B1', church: 'Opponent Church', quizzers: ['Opponent 1', 'Opponent 2', 'Opponent 3', 'Opponent 4'] }
      ];
      cTeams = [
        { id: 'jbq-team-cic-c1', name: 'Chicago Indian Church - C1', church: 'Chicago Indian Church', quizzers: ['David', 'Grace', 'Lucas', 'Maya'] },
        { id: 'jbq-team-cic-c2', name: 'Chicago Indian Church - C2', church: 'Chicago Indian Church', quizzers: ['Joshua', 'Hannah', 'Caleb', 'Ruth'] },
        { id: 'jbq-team-opp-c1', name: 'Opponent Church - C1', church: 'Opponent Church', quizzers: ['Junior A', 'Junior B', 'Junior C', 'Junior D'] }
      ];
    }

    const newMeet = {
      id: meetId,
      league: 'jbq',
      title: title.trim(),
      date: date || new Date().toISOString().split('T')[0],
      status: 'upcoming',
      divisions: {
        b_level: {
          name: 'B-Level',
          teams: bTeams,
          activeMatchId: 'jbq-b-match-1',
          matches: {
            'jbq-b-match-1': {
              id: 'jbq-b-match-1',
              roundNum: 1,
              matchNumber: 'B-01',
              room: '',
              teamAId: bTeams[0]?.id || 'b1',
              teamBId: bTeams[1]?.id || 'b2',
              seats: {
                teamA: (bTeams[0]?.quizzers || []).slice(0, 4),
                teamB: (bTeams[1]?.quizzers || []).slice(0, 4)
              },
              timeouts: { teamA: [{ id: 1, used: false, questionNum: '' }, { id: 2, used: false, questionNum: '' }], teamB: [{ id: 1, used: false, questionNum: '' }, { id: 2, used: false, questionNum: '' }] },
              fouls: { teamA: [], teamB: [] },
              questions: []
            }
          }
        },
        c_level: {
          name: 'C-Level',
          teams: cTeams,
          activeMatchId: 'jbq-c-match-1',
          matches: {
            'jbq-c-match-1': {
              id: 'jbq-c-match-1',
              roundNum: 1,
              matchNumber: 'C-01',
              room: '',
              teamAId: cTeams[0]?.id || 'c1',
              teamBId: cTeams[1]?.id || 'c2',
              seats: {
                teamA: (cTeams[0]?.quizzers || []).slice(0, 4),
                teamB: (cTeams[1]?.quizzers || []).slice(0, 4)
              },
              timeouts: { teamA: [{ id: 1, used: false, questionNum: '' }, { id: 2, used: false, questionNum: '' }], teamB: [{ id: 1, used: false, questionNum: '' }, { id: 2, used: false, questionNum: '' }] },
              fouls: { teamA: [], teamB: [] },
              questions: []
            }
          }
        }
      }
    };
    platformData.jbq.meets[meetId] = newMeet;
    platformData.jbq.activeMeetId = meetId;
  }

  saveScoresData();
  console.log(`[MEET] Super Coach created new Meet: ${title} (${l.toUpperCase()})`);
  res.json({ success: true, meetId, league: l });
});

// Super Coach: Delete a Meet
app.post('/api/meets/delete', authenticateCoach, requireSuperCoach, (req, res) => {
  const { league, meetId } = req.body;
  const l = (league || 'tbq').toLowerCase() === 'jbq' ? 'jbq' : 'tbq';

  const meets = platformData[l].meets;
  if (Object.keys(meets).length <= 1) {
    return res.status(400).json({ error: 'Cannot delete the only remaining meet in this league.' });
  }

  if (!meets[meetId]) {
    return res.status(404).json({ error: 'Meet not found.' });
  }

  delete meets[meetId];
  if (platformData[l].activeMeetId === meetId) {
    platformData[l].activeMeetId = Object.keys(meets)[0];
  }

  saveScoresData();
  res.json({ success: true, activeMeetId: platformData[l].activeMeetId });
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
      winner: hasQuestions ? stats.winner : 'upcoming',
      status: hasQuestions ? (stats.totalQuestions >= 20 ? 'Completed' : 'In Progress') : 'Scheduled',
      totalQuestions: stats.totalQuestions
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
    activeMatchId: ctx.dataset.activeMatchId
  });
});


// ==========================================
// 6. COACH MATCH & SCORESHEET APIS
// ==========================================

// GET Active Match & Full Scoresheet
app.get('/api/tbq', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const dataset = ctx.dataset;

  const matchId = req.query.matchId || dataset.activeMatchId;
  if (matchId && dataset.matches[matchId]) {
    dataset.activeMatchId = matchId;
  }
  const activeMatch = calculateMatchStats(dataset.activeMatchId, dataset, ctx.isJBQ);

  const matchesList = Object.keys(dataset.matches).map(k => {
    const m = dataset.matches[k];
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
      teamBName: tB ? tB.name : "Team 2"
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
    activeMatchId: dataset.activeMatchId,
    matchesList,
    meetsList,
    activeRound: activeMatch
  });
});

// POST Switch Active Match
app.post('/api/matches/switch', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId } = req.body;
  if (matchId && ctx.dataset.matches[matchId]) {
    ctx.dataset.activeMatchId = matchId;
    saveScoresData();
  }
  res.json({ success: true, activeRound: calculateMatchStats(ctx.dataset.activeMatchId, ctx.dataset, ctx.isJBQ) });
});

// POST Save / Add / Update a Team
app.post('/api/teams/save', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { teamId, name, church, quizzers } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Team name is required.' });
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

  if (Array.isArray(quizzers)) {
    targetTeam.quizzers = quizzers.map(q => String(q).trim()).filter(Boolean);
  } else if (typeof quizzers === 'string') {
    targetTeam.quizzers = quizzers.split(/[\n,]+/).map(q => q.trim()).filter(Boolean);
  }

  saveScoresData();
  console.log(`[TEAM] Coach ${req.user.name} saved team: ${targetTeam.name} (${targetTeam.quizzers.length} quizzers)`);
  res.json({ success: true, team: targetTeam, teams: ctx.dataset.teams });
});

// POST Delete a Team
app.post('/api/teams/delete', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { teamId } = req.body;
  ctx.dataset.teams = (ctx.dataset.teams || []).filter(t => t.id !== teamId);
  saveScoresData();
  res.json({ success: true, teams: ctx.dataset.teams });
});

// POST Clear All Teams
app.post('/api/teams/clear-all', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  ctx.dataset.teams = [];
  saveScoresData();
  console.log(`[TEAM] Coach ${req.user.name} cleared all teams`);
  res.json({ success: true, teams: [] });
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

  console.log(`[MATCH] Coach ${req.user.name} created Match #${newMatch.matchNumber} (${ctx.league.toUpperCase()})`);
  res.json({ success: true, match: newMatch, activeRound: calculateMatchStats(newId, ctx.dataset, ctx.isJBQ) });
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
  res.json({ success: true, match, activeRound: calculateMatchStats(match.id, ctx.dataset, ctx.isJBQ) });
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
  res.json({ success: true, activeMatchId: ctx.dataset.activeMatchId });
});

// POST Update Match Details & Students
app.post('/api/tbq/match-info', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId, roundNum, matchNumber, room, teamAId, teamBId, studentsA: inStudentsA, studentsB: inStudentsB, seatsHome, seatsOpp } = req.body;
  const mId = matchId || ctx.dataset.activeMatchId;
  const match = ctx.dataset.matches[mId];

  if (!match) return res.status(404).json({ error: 'Match not found.' });

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

  const rawA = inStudentsA || seatsHome;
  if (Array.isArray(rawA)) {
    match.studentsA = rawA.map(s => String(s || '').trim()).filter(s => s && !s.toLowerCase().startsWith('seat #'));
    match.seats = match.seats || {};
    match.seats.teamA = match.studentsA;
    match.seats.home = match.studentsA;
  }
  const rawB = inStudentsB || seatsOpp;
  if (Array.isArray(rawB)) {
    match.studentsB = rawB.map(s => String(s || '').trim()).filter(s => s && !s.toLowerCase().startsWith('seat #'));
    match.seats = match.seats || {};
    match.seats.teamB = match.studentsB;
    match.seats.opponent = match.studentsB;
  }

  saveScoresData();
  console.log(`[SCORESHEET] Scoresheet saved for match ${mId}`);
  res.json({ success: true, message: 'Scoresheet saved successfully.', activeRound: calculateMatchStats(mId, ctx.dataset, ctx.isJBQ) });
});

// POST Record Question Score (COACH ONLY)
app.post('/api/tbq/score', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId, questionNum, pointValue, isInterruption, isRebound, team, quizzer, isCorrect } = req.body;
  const mId = matchId || ctx.dataset.activeMatchId;
  const match = ctx.dataset.matches[mId];

  if (!match) return res.status(404).json({ error: 'Match not found.' });

  let qNum = parseInt(questionNum);
  if (isNaN(qNum) || qNum < 1) {
    qNum = match.questions.length + 1;
  }

  const currentStats = calculateMatchStats(mId, ctx.dataset, ctx.isJBQ);
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

  // If student is not yet in the match's student list, add them
  const targetStudents = isTeamA ? match.studentsA : match.studentsB;
  if (targetStudents && !targetStudents.some(s => s.toLowerCase() === resolvedName.toLowerCase())) {
    targetStudents.push(resolvedName);
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

  match.questions.push(newQuestion);
  saveScoresData();

  console.log(`[SCORE] Match #${match.matchNumber} Q#${newQuestion.questionNum}: ${newQuestion.quizzer} (${newQuestion.team}) [${newQuestion.isCorrect ? 'CORRECT' : 'INCORRECT'}] ${newQuestion.pointValue}pts`);
  res.json({ success: true, activeRound: calculateMatchStats(mId, ctx.dataset, ctx.isJBQ) });
});

// POST Toggle / Update Timeout
app.post('/api/tbq/timeout', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId, team, timeoutId, used, questionNum } = req.body;
  const mId = matchId || ctx.dataset.activeMatchId;
  const match = ctx.dataset.matches[mId];

  if (!match) return res.status(404).json({ error: 'Match not found.' });

  const isTeamA = team === 'teamA' || team === 'home';
  const key = isTeamA ? 'teamA' : 'teamB';
  if (!match.timeouts[key]) match.timeouts[key] = [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ];

  const t = match.timeouts[key].find(item => item.id === parseInt(timeoutId));
  if (t) {
    t.used = !!used;
    t.questionNum = used ? (questionNum || `Q${match.questions.length || 1}`) : "";
  }

  saveScoresData();
  res.json({ success: true, activeRound: calculateMatchStats(mId, ctx.dataset, ctx.isJBQ) });
});

// POST Add or Delete Team Foul
app.post('/api/tbq/foul', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId, team, action, foulId, reason, penalty } = req.body;
  const mId = matchId || ctx.dataset.activeMatchId;
  const match = ctx.dataset.matches[mId];

  if (!match) return res.status(404).json({ error: 'Match not found.' });

  const isTeamA = team === 'teamA' || team === 'home';
  const key = isTeamA ? 'teamA' : 'teamB';
  if (!match.fouls[key]) match.fouls[key] = [];

  if (action === 'delete') {
    match.fouls[key] = match.fouls[key].filter(f => f.id !== foulId);
  } else {
    const newFoul = {
      id: `foul-${Date.now()}`,
      reason: (reason || 'Team Foul (-5)').trim(),
      penalty: parseInt(penalty) || 5,
      timestamp: new Date().toISOString(),
      calledBy: req.user.name
    };
    match.fouls[key].push(newFoul);
  }

  saveScoresData();
  res.json({ success: true, activeRound: calculateMatchStats(mId, ctx.dataset, ctx.isJBQ) });
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

  if (match && match.questions && match.questions.length > 0) {
    const removed = match.questions.pop();
    if (removed && match.skippedRebounds) {
      match.skippedRebounds = match.skippedRebounds.filter(q => q !== removed.questionNum);
    }
    saveScoresData();
    return res.json({ success: true, removed, activeRound: calculateMatchStats(match.id, ctx.dataset, ctx.isJBQ) });
  }

  res.status(400).json({ error: 'No questions to undo in this match.' });
};
app.post('/api/tbq/undo', authenticateCoach, handleUndoQuestion);
app.post('/api/tbq/undo-question', authenticateCoach, handleUndoQuestion);

// POST Skip Rebound for a Question
app.post('/api/tbq/skip-rebound', authenticateCoach, (req, res) => {
  const ctx = getPlatformContext(req);
  const { matchId, questionNum } = req.body;
  const mId = matchId || ctx.dataset.activeMatchId;
  let match = ctx.dataset.matches[mId];
  if (!match && ctx.dataset.activeMatchId) match = ctx.dataset.matches[ctx.dataset.activeMatchId];
  if (!match) return res.status(404).json({ error: 'Match not found.' });

  const q = parseInt(questionNum);
  if (!match.skippedRebounds) match.skippedRebounds = [];
  if (!match.skippedRebounds.includes(q)) {
    match.skippedRebounds.push(q);
  }
  saveScoresData();
  const activeRound = calculateMatchStats(match.id, ctx.dataset, ctx.isJBQ);
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
    match.questions = [];
    match.skippedRebounds = [];
    match.timeouts = {
      teamA: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ],
      teamB: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ]
    };
    match.fouls = { teamA: [], teamB: [] };
    saveScoresData();
  }

  const activeStats = calculateMatchStats(match ? match.id : mId, ctx.dataset, ctx.isJBQ);
  res.json({ success: true, activeRound: activeStats });
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
  res.setHeader('Content-Disposition', `attachment; filename="tbq-jbq-platform-backup-${dateStr}.json"`);
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

  if (backupData.tbq && backupData.jbq) {
    platformData = backupData;
  } else if (backupData.meet && backupData.matches) {
    platformData.tbq.meets['tbq-meet-1'].meet = backupData.meet;
    platformData.tbq.meets['tbq-meet-1'].teams = backupData.meet.teams || [];
    platformData.tbq.meets['tbq-meet-1'].matches = backupData.matches || {};
    platformData.tbq.meets['tbq-meet-1'].activeMatchId = backupData.activeMatchId || 'match-1';
  }

  saveScoresData();
  console.log(`[BACKUP] Super Coach ${req.user.name} restored platform data from backup file`);
  res.json({ success: true, message: 'Platform data restored successfully.' });
});


// ==========================================
// 8. INITIALIZE STORAGE & START SERVER
// ==========================================

async function initStorage() {
  loadCoachesLocal();
  loadScoresDataLocal();
  loadSessionsLocal();

  if (!dbPool) {
    console.log('[STORAGE] No DATABASE_URL configured. Running with local JSON storage.');
    return;
  }

  try {
    console.log('[PG] Connecting to PostgreSQL database...');
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS tbq_store (
        key VARCHAR(100) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[PG] Table "tbq_store" verified.');

    // 1. Restore or seed Coaches
    const coachesRes = await dbPool.query(`SELECT value FROM tbq_store WHERE key = 'coaches'`);
    if (coachesRes.rows.length > 0 && Array.isArray(coachesRes.rows[0].value) && coachesRes.rows[0].value.length > 0) {
      coaches = coachesRes.rows[0].value;
      ensureStandardCoaches();
      console.log(`[PG] Restored ${coaches.length} coaches from database.`);
      saveCoachesLocal();
    } else {
      await dbPool.query(
        `INSERT INTO tbq_store (key, value, updated_at) VALUES ('coaches', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [JSON.stringify(coaches)]
      );
      console.log(`[PG] Seeded coaches table into database.`);
    }

    // 2. Restore or seed Scores Data
    const scoresRes = await dbPool.query(`SELECT value FROM tbq_store WHERE key = 'scores'`);
    if (scoresRes.rows.length > 0 && scoresRes.rows[0].value) {
      const loaded = scoresRes.rows[0].value;
      if (loaded.tbq && loaded.jbq) {
        platformData = loaded;
        console.log(`[PG] Restored multi-meet platform data from database.`);
        saveScoresDataLocal();
      } else if (loaded.meet && loaded.matches) {
        console.log(`[PG] Migrating existing database scores into Multi-Meet platform structure.`);
        platformData.tbq.meets['tbq-meet-1'].title = loaded.meet.title || "TBQ Meet 1 (October 2026)";
        platformData.tbq.meets['tbq-meet-1'].teams = loaded.meet.teams || [];
        platformData.tbq.meets['tbq-meet-1'].matches = loaded.matches || {};
        platformData.tbq.meets['tbq-meet-1'].activeMatchId = loaded.activeMatchId || 'match-1';
        saveScoresData();
      }
    } else {
      await dbPool.query(
        `INSERT INTO tbq_store (key, value, updated_at) VALUES ('scores', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [platformData]
      );
      console.log(`[PG] Seeded multi-meet platform data into database.`);
    }

    console.log('[PG] Database sync complete. All TBQ & JBQ data permanently persisted to PostgreSQL!');
  } catch (err) {
    console.error('[PG] Database initialization error (fallback to local files active):', err.message);
  }
}

// Start Server after Storage initialization
initStorage().then(() => {
  app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(`TBQ & JBQ Multi-Meet Platform running on port ${PORT}`);
    console.log(`Storage engine: ${dbPool ? 'PostgreSQL (Persistent)' : 'Local JSON'}`);
    console.log(`Super Coach: supercoach / super2026`);
    console.log(`TBQ Coach:   coach / coach2026`);
    console.log(`JBQ Coach:   jbqcoach / jbq2026`);
    console.log(`=================================================`);
  });
}).catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
