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
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');
const COACHES_FILE = path.join(DATA_DIR, 'coaches.json');

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
// 1. COACHES & AUTHENTICATION
// ==========================================

let coaches = [];
const activeSessions = new Map(); // token -> coach object

function loadCoachesLocal() {
  if (fs.existsSync(COACHES_FILE)) {
    try {
      coaches = JSON.parse(fs.readFileSync(COACHES_FILE, 'utf8'));
      return;
    } catch (err) {
      console.error('Error loading coaches file:', err);
    }
  }

  // Seed default coaches if file doesn't exist
  coaches = [
    {
      id: "coach-super",
      name: "Head Coach",
      username: "supercoach",
      passcode: "super2026",
      role: "supercoach",
      createdAt: new Date().toISOString()
    },
    {
      id: "coach-assistant",
      name: "Team Coach",
      username: "coach",
      passcode: "coach2026",
      role: "coach",
      createdAt: new Date().toISOString()
    }
  ];
  saveCoachesLocal();
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

  return res.status(401).json({ error: 'Unauthorized: Coach login required.' });
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
    role: matched.role
  };
  activeSessions.set(token, userSafe);

  console.log(`[AUTH] Coach logged in: ${matched.name} (${matched.username}) [${matched.role}]`);

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
  if (token) activeSessions.delete(token);
  res.json({ success: true, message: 'Logged out.' });
});

// Verify Current User
app.get('/api/auth/me', authenticateCoach, (req, res) => {
  res.json({ success: true, user: req.user });
});

// Super Coach: List all coaches
app.get('/api/coaches', authenticateCoach, requireSuperCoach, (req, res) => {
  const list = coaches.map(c => ({
    id: c.id,
    name: c.name,
    username: c.username,
    passcode: c.passcode,
    role: c.role,
    createdAt: c.createdAt
  }));
  res.json({ success: true, coaches: list });
});

// Super Coach: Add new coach
app.post('/api/coaches/add', authenticateCoach, requireSuperCoach, (req, res) => {
  const { name, username, passcode, role } = req.body;

  if (!name || !username || !passcode) {
    return res.status(400).json({ error: 'Name, username, and passcode are required.' });
  }

  const cleanUser = username.trim().toLowerCase();
  if (coaches.some(c => c.username.toLowerCase() === cleanUser)) {
    return res.status(400).json({ error: `Username "${cleanUser}" already exists.` });
  }

  const newCoach = {
    id: 'coach-' + Date.now(),
    name: name.trim(),
    username: cleanUser,
    passcode: passcode.trim(),
    role: role === 'supercoach' ? 'supercoach' : 'coach',
    createdAt: new Date().toISOString()
  };

  coaches.push(newCoach);
  saveCoaches();

  console.log(`[SUPERCOACH] Added coach: ${newCoach.name} (${newCoach.username}) [${newCoach.role}]`);
  res.json({ success: true, coach: newCoach });
});

// Super Coach: Delete a coach
app.post('/api/coaches/delete', authenticateCoach, requireSuperCoach, (req, res) => {
  const { coachId } = req.body;

  if (coachId === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own Super Coach account.' });
  }

  const idx = coaches.findIndex(c => c.id === coachId);
  if (idx === -1) {
    return res.status(404).json({ error: 'Coach not found.' });
  }

  const removed = coaches.splice(idx, 1)[0];
  saveCoaches();

  for (const [token, user] of activeSessions.entries()) {
    if (user.id === coachId) activeSessions.delete(token);
  }

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
// 2. TBQ 4-TEAM TOURNAMENT DATA STORAGE
// ==========================================

function getDefaultScoresData() {
  return {
    meet: {
      title: "TBQ Tournament 2026",
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
      ]
    },
    activeMatchId: "match-1",
    matches: {
      "match-1": {
        id: "match-1",
        roundNum: 1,
        matchNumber: "01",
        room: "201",
        quizmaster: "Pastor John",
        scorekeeper: "Sarah M.",
        teamAId: "team-cic-1",
        teamBId: "team-3",
        seats: {
          teamA: ["Sam", "Mia", "Ben", "Jade", "Noah"],
          teamB: ["Leo", "Ava", "Eli", "Timothy", "Hannah"]
        },
        timeouts: {
          teamA: [
            { id: 1, used: true, questionNum: "Q8" },
            { id: 2, used: false, questionNum: "" }
          ],
          teamB: [
            { id: 1, used: true, questionNum: "Q4" },
            { id: 2, used: true, questionNum: "Q18" }
          ]
        },
        fouls: {
          teamA: [],
          teamB: [
            { id: "foul-1", reason: "Bench talking (-5)", penalty: 5, timestamp: "2026-10-02T18:00:00.000Z" }
          ]
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
        room: "202",
        quizmaster: "Pastor David",
        scorekeeper: "Linda K.",
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
}

let scoresData = null;

function loadScoresDataLocal() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (fs.existsSync(SCORES_FILE)) {
    try {
      scoresData = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
      if (!scoresData.meet) scoresData.meet = getDefaultScoresData().meet;
      if (!scoresData.meet.teams) scoresData.meet.teams = getDefaultScoresData().meet.teams;
      if (!scoresData.matches) scoresData.matches = getDefaultScoresData().matches;
      if (!scoresData.activeMatchId || !scoresData.matches[scoresData.activeMatchId]) {
        scoresData.activeMatchId = Object.keys(scoresData.matches)[0] || "match-1";
      }
      return;
    } catch (err) {
      console.error('Failed to load scores file, resetting to default:', err);
    }
  }

  scoresData = getDefaultScoresData();
  saveScoresDataLocal();
}

function saveScoresDataLocal() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tempFile = `${SCORES_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(scoresData, null, 2), 'utf8');
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
      [scoresData]
    ).catch(err => console.error('[PG] Error persisting scores to DB:', err.message));
  }
}

// Find team helper
function getTeamById(teamId) {
  if (!scoresData.meet.teams) scoresData.meet.teams = [];
  return scoresData.meet.teams.find(t => t.id === teamId) || null;
}

// Calculate 20-Question Scoresheet for a given match
function calculateMatchStats(matchId) {
  let mId = matchId || scoresData.activeMatchId;
  let match = scoresData.matches[mId];

  if (!match) {
    const firstKey = Object.keys(scoresData.matches)[0];
    if (firstKey) {
      match = scoresData.matches[firstKey];
      mId = firstKey;
    } else {
      match = {
        id: "match-1",
        roundNum: 1,
        matchNumber: "01",
        room: "201",
        quizmaster: "Pastor John",
        scorekeeper: "Sarah M.",
        teamAId: "team-cic-1",
        teamBId: "team-3",
        seats: {
          teamA: ["Sam", "Mia", "Ben", "Jade", "Noah"],
          teamB: ["Quizzer 1", "Quizzer 2", "Quizzer 3", "Quizzer 4", "Quizzer 5"]
        },
        timeouts: {
          teamA: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ],
          teamB: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ]
        },
        fouls: { teamA: [], teamB: [] },
        questions: []
      };
      scoresData.matches["match-1"] = match;
    }
  }

  const teamAObj = getTeamById(match.teamAId) || { name: "Team A", church: "Church A", quizzers: [] };
  const teamBObj = getTeamById(match.teamBId) || { name: "Team B", church: "Church B", quizzers: [] };

  if (!match.seats) {
    match.seats = {
      teamA: (teamAObj.quizzers || []).slice(0, 5),
      teamB: (teamBObj.quizzers || []).slice(0, 5)
    };
  }
  while (match.seats.teamA.length < 5) match.seats.teamA.push(`Seat #${match.seats.teamA.length + 1}`);
  while (match.seats.teamB.length < 5) match.seats.teamB.push(`Seat #${match.seats.teamB.length + 1}`);

  if (!match.timeouts) {
    match.timeouts = {
      teamA: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ],
      teamB: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ]
    };
  }
  if (!match.fouls) {
    match.fouls = { teamA: [], teamB: [] };
  }

  // Quizzers individual stats map
  const teamAStats = {};
  match.seats.teamA.forEach((name, idx) => {
    if (name) teamAStats[name] = { seat: idx + 1, name, correct: 0, errors: 0, points: 0, isQuizzedOut: false, isErroredOut: false, quizOutBonus: 0 };
  });
  (teamAObj.quizzers || []).forEach(name => {
    if (!teamAStats[name]) teamAStats[name] = { seat: null, name, correct: 0, errors: 0, points: 0, isQuizzedOut: false, isErroredOut: false, quizOutBonus: 0 };
  });

  const teamBStats = {};
  match.seats.teamB.forEach((name, idx) => {
    if (name) teamBStats[name] = { seat: idx + 1, name, correct: 0, errors: 0, points: 0, isQuizzedOut: false, isErroredOut: false, quizOutBonus: 0 };
  });
  (teamBObj.quizzers || []).forEach(name => {
    if (!teamBStats[name]) teamBStats[name] = { seat: null, name, correct: 0, errors: 0, points: 0, isQuizzedOut: false, isErroredOut: false, quizOutBonus: 0 };
  });

  // Calculate 20 questions grid
  const maxQuestionRecorded = match.questions.length > 0 ? Math.max(...match.questions.map(q => q.questionNum)) : 0;
  const totalRows = Math.max(20, maxQuestionRecorded);
  const rows = [];

  let teamARunning = 0;
  let teamBRunning = 0;

  // Group questions by questionNum
  const qMap = {};
  match.questions.forEach(q => {
    if (!qMap[q.questionNum]) qMap[q.questionNum] = [];
    qMap[q.questionNum].push(q);
  });

  for (let qNum = 1; qNum <= totalRows; qNum++) {
    const qList = qMap[qNum] || [];

    // Official standard TBQ points:
    // Q1 - Q8: 10 pts
    // Q9 - Q17: 20 pts
    // Q18 - Q20: 30 pts
    let defaultPts = qNum <= 8 ? 10 : (qNum <= 17 ? 20 : 30);
    let pts = qList.length > 0 ? qList[0].pointValue : defaultPts;

    const teamACells = ["", "", "", "", ""];
    const teamBCells = ["", "", "", "", ""];
    let note = "";

    qList.forEach(q => {
      const isTeamA = q.team === 'teamA' || q.team === 'home';
      const seatList = isTeamA ? match.seats.teamA : match.seats.teamB;
      const targetCells = isTeamA ? teamACells : teamBCells;
      const statsMap = isTeamA ? teamAStats : teamBStats;
      const stat = statsMap[q.quizzer];

      let seatIdx = (typeof q.seatNum === 'number' && q.seatNum >= 1 && q.seatNum <= 5)
        ? q.seatNum - 1
        : seatList.indexOf(q.quizzer);
      if (seatIdx === -1 || seatIdx > 4) seatIdx = 0;

      let cellText = "";
      if (q.isCorrect) {
        let delta = q.pointValue;
        cellText = q.isRebound ? `+${delta}*` : `+${delta}`;
        if (q.isRebound) note = note ? `${note}, Rebound` : "Rebound";

        if (isTeamA) teamARunning += delta;
        else teamBRunning += delta;

        if (stat) {
          stat.correct += 1;
          stat.points += delta;
          if (stat.correct >= 5) stat.isQuizzedOut = true;
        }
      } else {
        if (q.isInterruption) {
          const penalty = Math.round(q.pointValue / 2);
          cellText = `-${penalty}`;
          if (isTeamA) teamARunning -= penalty;
          else teamBRunning -= penalty;

          if (stat) {
            stat.errors += 1;
            stat.points -= penalty;
            if (stat.errors >= 3) stat.isErroredOut = true;
          }
        } else {
          cellText = "0";
          if (stat) {
            stat.errors += 1;
            if (stat.errors >= 3) stat.isErroredOut = true;
          }
        }
      }

      targetCells[seatIdx] = targetCells[seatIdx] ? `${targetCells[seatIdx]}, ${cellText}` : cellText;
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

  // Quiz-Out Bonuses:
  // ONLY Perfect Quiz-Out (5 correct with 0 errors) receives +20 bonus!
  // If a quizzer has errors and reaches 5 correct, they Quiz Out (Forward), but receive NO bonus (+0).
  const teamABonuses = [];
  let teamABonusPts = 0;
  Object.values(teamAStats).forEach(s => {
    if (s.correct >= 5) {
      s.isQuizzedOut = true;
      if (s.errors === 0) {
        const bonus = 20;
        s.quizOutBonus = bonus;
        s.points += bonus;
        teamABonusPts += bonus;
        teamABonuses.push({ quizzer: s.name, desc: `${s.name}: Perfect QO (+20)`, points: bonus });
      } else {
        s.quizOutBonus = 0;
        teamABonuses.push({ quizzer: s.name, desc: `${s.name}: Quiz Out (5 correct, ${s.errors} err) (+0)`, points: 0 });
      }
    } else if (s.errors >= 3) {
      s.isErroredOut = true;
    }
  });

  const teamBBonuses = [];
  let teamBBonusPts = 0;
  Object.values(teamBStats).forEach(s => {
    if (s.correct >= 5) {
      s.isQuizzedOut = true;
      if (s.errors === 0) {
        const bonus = 20;
        s.quizOutBonus = bonus;
        s.points += bonus;
        teamBBonusPts += bonus;
        teamBBonuses.push({ quizzer: s.name, desc: `${s.name}: Perfect QO (+20)`, points: bonus });
      } else {
        s.quizOutBonus = 0;
        teamBBonuses.push({ quizzer: s.name, desc: `${s.name}: Quiz Out (5 correct, ${s.errors} err) (+0)`, points: 0 });
      }
    } else if (s.errors >= 3) {
      s.isErroredOut = true;
    }
  });

  // Team Fouls deduction (-5 per foul)
  let teamAFoulPenalty = 0;
  (match.fouls.teamA || match.fouls.home || []).forEach(f => teamAFoulPenalty += (parseInt(f.penalty) || 5));

  let teamBFoulPenalty = 0;
  (match.fouls.teamB || match.fouls.opponent || []).forEach(f => teamBFoulPenalty += (parseInt(f.penalty) || 5));

  // Official Final Score
  const finalTeamAScore = teamARunning + teamABonusPts - teamAFoulPenalty;
  const finalTeamBScore = teamBRunning + teamBBonusPts - teamBFoulPenalty;

  let winner = "tie";
  if (finalTeamAScore > finalTeamBScore) winner = "teamA";
  else if (finalTeamBScore > finalTeamAScore) winner = "teamB";

  return {
    id: match.id,
    meetNum: match.meetNum || match.roundNum || 1,
    roundNum: match.meetNum || match.roundNum || 1,
    matchNumber: match.matchNumber || "01",
    room: match.room || "201",
    quizmaster: match.quizmaster || "Pastor John",
    scorekeeper: match.scorekeeper || "Sarah M.",
    teamA: {
      id: match.teamAId,
      name: teamAObj.name,
      church: teamAObj.church,
      regulationScore: teamARunning,
      bonusPoints: teamABonusPts,
      bonuses: teamABonuses,
      foulPenalty: teamAFoulPenalty,
      fouls: match.fouls.teamA || match.fouls.home || [],
      finalScore: finalTeamAScore,
      seats: match.seats.teamA,
      quizzers: Object.values(teamAStats)
    },
    teamB: {
      id: match.teamBId,
      name: teamBObj.name,
      church: teamBObj.church,
      regulationScore: teamBRunning,
      bonusPoints: teamBBonusPts,
      bonuses: teamBBonuses,
      foulPenalty: teamBFoulPenalty,
      fouls: match.fouls.teamB || match.fouls.opponent || [],
      finalScore: finalTeamBScore,
      seats: match.seats.teamB,
      quizzers: Object.values(teamBStats)
    },
    seats: {
      home: match.seats.teamA,
      opponent: match.seats.teamB
    },
    homeTeam: {
      name: teamAObj.name,
      finalScore: finalTeamAScore,
      regulationScore: teamARunning,
      bonusPoints: teamABonusPts,
      bonuses: teamABonuses,
      foulPenalty: teamAFoulPenalty,
      fouls: match.fouls.teamA || match.fouls.home || [],
      quizzers: Object.values(teamAStats)
    },
    opponentTeam: {
      name: teamBObj.name,
      finalScore: finalTeamBScore,
      regulationScore: teamBRunning,
      bonusPoints: teamBBonusPts,
      bonuses: teamBBonuses,
      foulPenalty: teamBFoulPenalty,
      fouls: match.fouls.teamB || match.fouls.opponent || [],
      quizzers: Object.values(teamBStats)
    },
    timeouts: {
      home: match.timeouts.teamA || match.timeouts.home || [],
      opponent: match.timeouts.teamB || match.timeouts.opponent || []
    },
    rows,
    winner,
    totalQuestions: match.questions.length,
    questions: match.questions
  };
}

// Compute Standings / Leaderboard for all 4 teams
function calculateTournamentStandings() {
  const teams = scoresData.meet.teams || [];
  const standingsMap = {};

  teams.forEach(t => {
    standingsMap[t.id] = {
      id: t.id,
      name: t.name,
      church: t.church,
      quizzers: t.quizzers || [],
      matchesPlayed: 0,
      won: 0,
      lost: 0,
      tied: 0,
      totalPoints: 0,
      avgPoints: 0
    };
  });

  const allMatchKeys = Object.keys(scoresData.matches || {});
  allMatchKeys.forEach(mKey => {
    const stats = calculateMatchStats(mKey);
    if (stats.totalQuestions > 0) {
      const a = standingsMap[stats.teamA.id];
      const b = standingsMap[stats.teamB.id];

      if (a) {
        a.matchesPlayed += 1;
        a.totalPoints += stats.teamA.finalScore;
        if (stats.winner === 'teamA') a.won += 1;
        else if (stats.winner === 'teamB') a.lost += 1;
        else a.tied += 1;
      }

      if (b) {
        b.matchesPlayed += 1;
        b.totalPoints += stats.teamB.finalScore;
        if (stats.winner === 'teamB') b.won += 1;
        else if (stats.winner === 'teamA') b.lost += 1;
        else b.tied += 1;
      }
    }
  });

  const list = Object.values(standingsMap);
  list.forEach(item => {
    item.avgPoints = item.matchesPlayed > 0 ? Math.round(item.totalPoints / item.matchesPlayed) : 0;
  });

  // Sort by Wins (descending), then Total Points (descending)
  list.sort((x, y) => {
    if (y.won !== x.won) return y.won - x.won;
    return y.totalPoints - x.totalPoints;
  });

  return list;
}

// ==========================================
// 3. PUBLIC SUMMARY ENDPOINT (NO LOGIN REQUIRED)
// ==========================================
app.get('/api/tbq/public-summary', (req, res) => {
  const standings = calculateTournamentStandings();
  const allMatchKeys = Object.keys(scoresData.matches || {});
  const matchesSummaries = [];

  allMatchKeys.forEach(mKey => {
    const stats = calculateMatchStats(mKey);
    const hasQuestions = stats.totalQuestions > 0;
    matchesSummaries.push({
      id: stats.id,
      matchNumber: stats.matchNumber,
      meetNum: stats.meetNum,
      roundNum: stats.meetNum,
      room: stats.room,
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
    title: scoresData.meet.title,
    teams: standings,
    matches: matchesSummaries,
    activeMatchId: scoresData.activeMatchId
  });
});

// ==========================================
// 4. COACH MATCH APIS (AUTHENTICATED)
// ==========================================

// GET Active Match & Full Scoresheet
app.get('/api/tbq', authenticateCoach, (req, res) => {
  const matchId = req.query.matchId || scoresData.activeMatchId;
  if (matchId && scoresData.matches[matchId]) {
    scoresData.activeMatchId = matchId;
  }
  const activeMatch = calculateMatchStats(scoresData.activeMatchId);

  const matchesList = Object.keys(scoresData.matches).map(k => {
    const m = scoresData.matches[k];
    const tA = getTeamById(m.teamAId);
    const tB = getTeamById(m.teamBId);
    return {
      id: m.id,
      matchNumber: m.matchNumber || "01",
      meetNum: m.meetNum || m.roundNum || 1,
      roundNum: m.meetNum || m.roundNum || 1,
      room: m.room || "201",
      teamAId: m.teamAId,
      teamBId: m.teamBId,
      quizmaster: m.quizmaster || "Quizmaster",
      scorekeeper: m.scorekeeper || "Scorekeeper",
      teamAName: tA ? tA.name : "Team A",
      teamBName: tB ? tB.name : "Team B"
    };
  });

  res.json({
    meet: scoresData.meet,
    activeMatchId: scoresData.activeMatchId,
    matchesList,
    activeRound: activeMatch // Active match stats
  });
});

// POST Switch Active Match
app.post('/api/matches/switch', authenticateCoach, (req, res) => {
  const { matchId } = req.body;
  if (matchId && scoresData.matches[matchId]) {
    scoresData.activeMatchId = matchId;
    saveScoresData();
  }
  res.json({ success: true, activeRound: calculateMatchStats(scoresData.activeMatchId) });
});

// POST Save / Add / Update a Team (Tomorrow morning quick configuration!)
app.post('/api/teams/save', authenticateCoach, (req, res) => {
  const { teamId, name, church, quizzers } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Team name is required.' });
  }

  if (!scoresData.meet.teams) scoresData.meet.teams = [];

  let targetTeam = scoresData.meet.teams.find(t => t.id === teamId);
  if (!targetTeam) {
    targetTeam = {
      id: teamId || `team-${Date.now()}`,
      name: name.trim(),
      church: (church || name).trim(),
      quizzers: []
    };
    scoresData.meet.teams.push(targetTeam);
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
  res.json({ success: true, team: targetTeam, teams: scoresData.meet.teams });
});

// POST Delete a Team
app.post('/api/teams/delete', authenticateCoach, (req, res) => {
  const { teamId } = req.body;
  scoresData.meet.teams = (scoresData.meet.teams || []).filter(t => t.id !== teamId);
  saveScoresData();
  res.json({ success: true, teams: scoresData.meet.teams });
});

// POST Add a New Match / Round
app.post('/api/matches/add', authenticateCoach, (req, res) => {
  const { meetNum, roundNum, matchNumber, room, quizmaster, scorekeeper, teamAId, teamBId } = req.body;

  const newId = `match-${Date.now()}`;
  const tA = getTeamById(teamAId) || (scoresData.meet.teams[0] || { id: "team-1", quizzers: [] });
  const tB = getTeamById(teamBId) || (scoresData.meet.teams[1] || { id: "team-2", quizzers: [] });
  const mNum = parseInt(meetNum || roundNum) || 1;

  const newMatch = {
    id: newId,
    meetNum: mNum,
    roundNum: mNum,
    matchNumber: String(matchNumber || `0${Object.keys(scoresData.matches).length + 1}`).trim(),
    room: String(room || "201").trim(),
    quizmaster: String(quizmaster || "Quizmaster").trim(),
    scorekeeper: String(scorekeeper || "Scorekeeper").trim(),
    teamAId: tA.id,
    teamBId: tB.id,
    seats: {
      teamA: (tA.quizzers || []).slice(0, 5),
      teamB: (tB.quizzers || []).slice(0, 5)
    },
    timeouts: {
      teamA: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ],
      teamB: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ]
    },
    fouls: { teamA: [], teamB: [] },
    questions: []
  };

  scoresData.matches[newId] = newMatch;
  scoresData.activeMatchId = newId;
  saveScoresData();

  console.log(`[MATCH] Coach ${req.user.name} created Match #${newMatch.matchNumber} (Meet ${newMatch.meetNum})`);
  res.json({ success: true, match: newMatch, activeRound: calculateMatchStats(newId) });
});

// POST Update an Existing Match
app.post('/api/matches/update', authenticateCoach, (req, res) => {
  const { matchId, meetNum, roundNum, matchNumber, room, quizmaster, scorekeeper, teamAId, teamBId } = req.body;
  if (!matchId || !scoresData.matches[matchId]) {
    return res.status(404).json({ error: 'Match not found.' });
  }

  const match = scoresData.matches[matchId];

  if (meetNum !== undefined || roundNum !== undefined) {
    const num = parseInt(meetNum || roundNum) || 1;
    match.meetNum = num;
    match.roundNum = num;
  }
  if (matchNumber !== undefined) match.matchNumber = String(matchNumber).trim();
  if (room !== undefined) match.room = String(room).trim();
  if (quizmaster !== undefined) match.quizmaster = String(quizmaster).trim();
  if (scorekeeper !== undefined) match.scorekeeper = String(scorekeeper).trim();

  // If team changed, update team ID and seating if appropriate
  if (teamAId && teamAId !== match.teamAId) {
    match.teamAId = teamAId;
    const tA = getTeamById(teamAId);
    if (tA && tA.quizzers && tA.quizzers.length > 0) {
      match.seats.teamA = (tA.quizzers || []).slice(0, 5);
    }
  }
  if (teamBId && teamBId !== match.teamBId) {
    match.teamBId = teamBId;
    const tB = getTeamById(teamBId);
    if (tB && tB.quizzers && tB.quizzers.length > 0) {
      match.seats.teamB = (tB.quizzers || []).slice(0, 5);
    }
  }

  saveScoresData();
  console.log(`[MATCH] Coach ${req.user.name} updated Match #${match.matchNumber} (Meet ${match.meetNum})`);
  res.json({ success: true, match, activeRound: calculateMatchStats(match.id) });
});

// POST Delete a Match
app.post('/api/matches/delete', authenticateCoach, (req, res) => {
  const { matchId } = req.body;
  if (!matchId || !scoresData.matches[matchId]) {
    return res.status(404).json({ error: 'Match not found.' });
  }

  const keys = Object.keys(scoresData.matches);
  if (keys.length <= 1) {
    return res.status(400).json({ error: 'Cannot delete the only remaining match.' });
  }

  const deletedNum = scoresData.matches[matchId].matchNumber;
  delete scoresData.matches[matchId];

  if (scoresData.activeMatchId === matchId) {
    scoresData.activeMatchId = Object.keys(scoresData.matches)[0];
  }

  saveScoresData();
  console.log(`[MATCH] Coach ${req.user.name} deleted Match #${deletedNum} (${matchId})`);
  res.json({ success: true, activeMatchId: scoresData.activeMatchId });
});

// POST Update Match Details & Seating
app.post('/api/tbq/match-info', authenticateCoach, (req, res) => {
  const { matchId, meetNum, roundNum, matchNumber, room, quizmaster, scorekeeper, teamAId, teamBId, seatsHome, seatsOpp } = req.body;
  const mId = matchId || scoresData.activeMatchId;
  const match = scoresData.matches[mId];

  if (!match) return res.status(404).json({ error: 'Match not found.' });

  if (meetNum !== undefined || roundNum !== undefined) {
    const num = parseInt(meetNum || roundNum) || 1;
    match.meetNum = num;
    match.roundNum = num;
  }
  if (matchNumber !== undefined) match.matchNumber = String(matchNumber).trim();
  if (room !== undefined) match.room = String(room).trim();
  if (quizmaster !== undefined) match.quizmaster = String(quizmaster).trim();
  if (scorekeeper !== undefined) match.scorekeeper = String(scorekeeper).trim();
  if (teamAId) match.teamAId = teamAId;
  if (teamBId) match.teamBId = teamBId;

  if (Array.isArray(seatsHome)) {
    match.seats.teamA = seatsHome.map(s => String(s || '').trim()).slice(0, 5);
  }
  if (Array.isArray(seatsOpp)) {
    match.seats.teamB = seatsOpp.map(s => String(s || '').trim()).slice(0, 5);
  }

  saveScoresData();
  console.log(`[TBQ] Coach ${req.user.name} updated Match #${match.matchNumber} info`);
  res.json({ success: true, activeRound: calculateMatchStats(mId) });
});

// POST Record Question Score (COACH ONLY)
app.post('/api/tbq/score', authenticateCoach, (req, res) => {
  const { matchId, questionNum, pointValue, isInterruption, isRebound, team, quizzer, seatNum, isCorrect } = req.body;
  const mId = matchId || scoresData.activeMatchId;
  const match = scoresData.matches[mId];

  if (!match) return res.status(404).json({ error: 'Match not found.' });

  let qNum = parseInt(questionNum);
  if (isNaN(qNum) || qNum < 1) {
    qNum = match.questions.length + 1;
  }

  const currentStats = calculateMatchStats(mId);
  const isTeamA = team === 'teamA' || team === 'home';
  const teamStats = isTeamA ? currentStats.teamA : currentStats.teamB;
  const quizzerStat = teamStats.quizzers.find(q => q.name.toLowerCase() === (quizzer || '').toLowerCase());

  if (quizzerStat) {
    if (quizzerStat.isQuizzedOut) {
      return res.status(400).json({
        error: `${quizzer} has already Quizzed Out (5 correct answers) and cannot buzz in for further questions in this match.`
      });
    }
    if (quizzerStat.isErroredOut) {
      return res.status(400).json({
        error: `${quizzer} has already Errored Out (3 errors) and must remain seated for the remainder of this match.`
      });
    }
  }

  const newQuestion = {
    id: `q-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    questionNum: qNum,
    pointValue: parseInt(pointValue) || 20,
    isInterruption: !!isInterruption,
    isRebound: !!isRebound,
    team: isTeamA ? 'teamA' : 'teamB',
    quizzer: (quizzer || 'Quizzer').trim(),
    seatNum: parseInt(seatNum) || 1,
    isCorrect: !!isCorrect,
    scoredBy: req.user.name,
    timestamp: new Date().toISOString()
  };

  match.questions.push(newQuestion);
  saveScoresData();

  console.log(`[TBQ] Match #${match.matchNumber} Q#${newQuestion.questionNum}: ${newQuestion.quizzer} (${newQuestion.team}) [${newQuestion.isCorrect ? 'CORRECT' : 'INCORRECT'}] ${newQuestion.pointValue}pts`);
  res.json({ success: true, activeRound: calculateMatchStats(mId) });
});

// POST Toggle / Update Timeout
app.post('/api/tbq/timeout', authenticateCoach, (req, res) => {
  const { matchId, team, timeoutId, used, questionNum } = req.body;
  const mId = matchId || scoresData.activeMatchId;
  const match = scoresData.matches[mId];

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
  res.json({ success: true, activeRound: calculateMatchStats(mId) });
});

// POST Add or Delete Team Foul
app.post('/api/tbq/foul', authenticateCoach, (req, res) => {
  const { matchId, team, action, foulId, reason, penalty } = req.body;
  const mId = matchId || scoresData.activeMatchId;
  const match = scoresData.matches[mId];

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
  res.json({ success: true, activeRound: calculateMatchStats(mId) });
});

// POST Undo Question
app.post('/api/tbq/undo', authenticateCoach, (req, res) => {
  const { matchId } = req.body;
  const mId = matchId || scoresData.activeMatchId;
  const match = scoresData.matches[mId];

  if (match && match.questions.length > 0) {
    const removed = match.questions.pop();
    saveScoresData();
    return res.json({ success: true, removed, activeRound: calculateMatchStats(mId) });
  }

  res.status(400).json({ error: 'No questions to undo in this match.' });
});

// POST Reset Match
app.post('/api/tbq/reset-round', authenticateCoach, (req, res) => {
  const { matchId } = req.body;
  const mId = matchId || scoresData.activeMatchId;
  const match = scoresData.matches[mId];

  if (match) {
    match.questions = [];
    match.timeouts = {
      teamA: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ],
      teamB: [ { id: 1, used: false, questionNum: "" }, { id: 2, used: false, questionNum: "" } ]
    };
    match.fouls = { teamA: [], teamB: [] };
    saveScoresData();
  }

  res.json({ success: true, activeRound: calculateMatchStats(mId) });
});

// POST Update Meet Title / Overall Settings
app.post('/api/tbq/settings', authenticateCoach, (req, res) => {
  const { title } = req.body;
  if (title) scoresData.meet.title = title.trim();
  saveScoresData();
  res.json({ success: true, meet: scoresData.meet });
});

// ==========================================
// 6. SYSTEM STATUS & BACKUP / RESTORE
// ==========================================

// GET Storage & System Status
app.get('/api/system/status', (req, res) => {
  res.json({
    status: 'ok',
    storage: dbPool ? 'postgresql' : 'local_json',
    persistent: Boolean(dbPool),
    uptimeSeconds: Math.round(process.uptime()),
    matchesCount: Object.keys(scoresData?.matches || {}).length,
    teamsCount: (scoresData?.meet?.teams || []).length
  });
});

// GET Full JSON Backup (Coach or Super Coach)
app.get('/api/tbq/backup', authenticateCoach, (req, res) => {
  const dateStr = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="tbq-tournament-backup-${dateStr}.json"`);
  res.send(JSON.stringify(scoresData, null, 2));
});

// POST Restore Full Backup (Super Coach only)
app.post('/api/tbq/restore', authenticateCoach, (req, res) => {
  if (req.user.role !== 'supercoach') {
    return res.status(403).json({ error: 'Only Super Coaches can restore tournament backups.' });
  }

  const { backupData } = req.body;
  if (!backupData || !backupData.meet || !backupData.matches) {
    return res.status(400).json({ error: 'Invalid backup format. Must contain "meet" and "matches".' });
  }

  scoresData = backupData;
  saveScoresData();
  console.log(`[BACKUP] Super Coach ${req.user.name} restored tournament data from backup file`);
  res.json({ success: true, message: 'Tournament data restored successfully.', activeMatchId: scoresData.activeMatchId });
});

// ==========================================
// INITIALIZE STORAGE & START SERVER
// ==========================================
async function initStorage() {
  // Always load from local files first
  loadCoachesLocal();
  loadScoresDataLocal();

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
    if (scoresRes.rows.length > 0 && scoresRes.rows[0].value && scoresRes.rows[0].value.meet) {
      scoresData = scoresRes.rows[0].value;
      console.log(`[PG] Restored scores from database (${Object.keys(scoresData.matches || {}).length} matches).`);
      saveScoresDataLocal();
    } else {
      await dbPool.query(
        `INSERT INTO tbq_store (key, value, updated_at) VALUES ('scores', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [scoresData]
      );
      console.log(`[PG] Seeded tournament scores into database.`);
    }

    console.log('[PG] Database sync complete. Scores are permanently persisted to PostgreSQL!');
  } catch (err) {
    console.error('[PG] Database initialization error (fallback to local files active):', err.message);
  }
}

// Start Server after Storage initialization
initStorage().then(() => {
  app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(`TBQ Multi-Team Platform running on port ${PORT}`);
    console.log(`Storage engine: ${dbPool ? 'PostgreSQL (Persistent)' : 'Local JSON'}`);
    console.log(`Super Coach login: supercoach / super2026`);
    console.log(`Regular Coach login: coach / coach2026`);
    console.log(`=================================================`);
  });
}).catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
