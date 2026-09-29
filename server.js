const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const SLOTS_FILE = path.join(DATA_DIR, 'slots.json');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');
const COACHES_FILE = path.join(DATA_DIR, 'coaches.json');

const DEFAULT_STUDENTS = [
  'Jade',
  'Noah',
  'Prakash',
  'Deevena',
  'Amiel',
  'Hosanna',
  'Isabelle'
];

// ==========================================
// 1. COACHES & AUTHENTICATION
// ==========================================

let coaches = [];
const activeSessions = new Map(); // token -> coach object

function loadCoaches() {
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
      id: "coach-super-" + Date.now(),
      name: "Head Coach",
      username: "supercoach",
      passcode: "super2026",
      role: "supercoach",
      createdAt: new Date().toISOString()
    },
    {
      id: "coach-asst-" + Date.now(),
      name: "Team Coach",
      username: "coach",
      passcode: "coach2026",
      role: "coach",
      createdAt: new Date().toISOString()
    }
  ];
  saveCoaches();
}

function saveCoaches() {
  try {
    const temp = `${COACHES_FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(coaches, null, 2), 'utf8');
    fs.renameSync(temp, COACHES_FILE);
  } catch (err) {
    console.error('Error saving coaches file:', err);
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
    // If only passcode provided, search by passcode
    matched = coaches.find(c => c.passcode === passcode.trim());
  }

  if (!matched) {
    return res.status(401).json({ error: 'Invalid username or passcode.' });
  }

  // Generate session token
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

  // Invalidate any active sessions for this coach
  for (const [token, user] of activeSessions.entries()) {
    if (user.id === coachId) activeSessions.delete(token);
  }

  console.log(`[SUPERCOACH] Deleted coach: ${removed.name}`);
  res.json({ success: true, removed });
});

// Super Coach: Reset a coach's passcode
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
// 2. PRACTICE SLOTS & ROSTER MANAGEMENT
// ==========================================

function getDefaultSlotsData() {
  return {
    settings: {
      title: "TBQ 1-on-1 Practice Sessions",
      description: "15-minute practice and quizzing prep slots with Coach. Please pick up to 2 slots for your quizzer across Tuesday and Wednesday!",
      targetQuizzers: 7,
      students: DEFAULT_STUDENTS
    },
    days: [
      {
        id: "day-tue-2026-09-29",
        dateString: "2026-09-29",
        dayOfWeek: "Tuesday",
        formattedDate: "Tuesday, Sept 29, 2026",
        timeWindow: "6:30 PM – 8:00 PM",
        slots: [
          { id: "tue-1830", startTime: "6:30 PM", endTime: "6:45 PM", start24: "18:30", end24: "18:45", status: "available" },
          { id: "tue-1845", startTime: "6:45 PM", endTime: "7:00 PM", start24: "18:45", end24: "19:00", status: "available" },
          { id: "tue-1900", startTime: "7:00 PM", endTime: "7:15 PM", start24: "19:00", end24: "19:15", status: "available" },
          { id: "tue-1915", startTime: "7:15 PM", endTime: "7:30 PM", start24: "19:15", end24: "19:30", status: "available" },
          { id: "tue-1930", startTime: "7:30 PM", endTime: "7:45 PM", start24: "19:30", end24: "19:45", status: "available" },
          { id: "tue-1945", startTime: "7:45 PM", endTime: "8:00 PM", start24: "19:45", end24: "20:00", status: "available" }
        ]
      },
      {
        id: "day-wed-2026-09-30",
        dateString: "2026-09-30",
        dayOfWeek: "Wednesday",
        formattedDate: "Wednesday, Sept 30, 2026",
        timeWindow: "6:00 PM – 7:30 PM",
        slots: [
          { id: "wed-1800", startTime: "6:00 PM", endTime: "6:15 PM", start24: "18:00", end24: "18:15", status: "available" },
          { id: "wed-1815", startTime: "6:15 PM", endTime: "6:30 PM", start24: "18:15", end24: "18:30", status: "available" },
          { id: "wed-1830", startTime: "6:30 PM", endTime: "6:45 PM", start24: "18:30", end24: "18:45", status: "available" },
          { id: "wed-1845", startTime: "6:45 PM", endTime: "7:00 PM", start24: "18:45", end24: "19:00", status: "available" },
          { id: "wed-1900", startTime: "7:00 PM", endTime: "7:15 PM", start24: "19:00", end24: "19:15", status: "available" },
          { id: "wed-1915", startTime: "7:15 PM", endTime: "7:30 PM", start24: "19:15", end24: "19:30", status: "available" }
        ]
      }
    ]
  };
}

let scheduleData = null;

function loadSlotsData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (fs.existsSync(SLOTS_FILE)) {
    try {
      const raw = fs.readFileSync(SLOTS_FILE, 'utf8');
      scheduleData = JSON.parse(raw);
      if (!scheduleData.settings) scheduleData.settings = {};
      if (!scheduleData.settings.students) scheduleData.settings.students = DEFAULT_STUDENTS;
      return;
    } catch (err) {
      console.error('Failed to load slots file, resetting to default:', err);
    }
  }

  scheduleData = getDefaultSlotsData();
  saveSlotsData();
}

function saveSlotsData() {
  try {
    const tempFile = `${SLOTS_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(scheduleData, null, 2), 'utf8');
    fs.renameSync(tempFile, SLOTS_FILE);
  } catch (err) {
    console.error('Error saving slots data:', err);
  }
}

function getStudentBookings(studentName) {
  if (!studentName) return [];
  const bookings = [];
  for (const day of scheduleData.days) {
    for (const slot of day.slots) {
      if (slot.status === 'booked' && slot.bookedBy && slot.bookedBy.toLowerCase() === studentName.toLowerCase()) {
        bookings.push({ slot, day });
      }
    }
  }
  return bookings;
}

function getStudentBooking(studentName) {
  const bookings = getStudentBookings(studentName);
  return bookings[0] || null;
}

// GET all slots and students status (Public)
app.get('/api/slots', (req, res) => {
  const currentStudents = scheduleData.settings.students || DEFAULT_STUDENTS;
  const studentsStatus = currentStudents.map(name => {
    const bookings = getStudentBookings(name);
    return {
      name,
      bookingCount: bookings.length,
      maxSlots: 2,
      isBooked: bookings.length >= 2,
      bookings: bookings.map(b => ({
        slotId: b.slot.id,
        day: b.day.formattedDate,
        dayOfWeek: b.day.dayOfWeek,
        time: `${b.slot.startTime} – ${b.slot.endTime}`
      })),
      // Backward compatibility fields
      slotId: bookings[0] ? bookings[0].slot.id : null,
      day: bookings[0] ? bookings[0].day.formattedDate : null,
      time: bookings[0] ? `${bookings[0].slot.startTime} – ${bookings[0].slot.endTime}` : null
    };
  });

  res.json({
    settings: scheduleData.settings,
    students: studentsStatus,
    days: scheduleData.days
  });
});

// POST book a slot (Public: just student name)
app.post('/api/book', (req, res) => {
  const { slotId, quizzerName } = req.body;

  if (!slotId || !quizzerName || typeof quizzerName !== 'string' || !quizzerName.trim()) {
    return res.status(400).json({ error: 'Please choose a student name.' });
  }

  const cleanName = quizzerName.trim();
  const existingBookings = getStudentBookings(cleanName);
  if (existingBookings.length >= 2) {
    const reservedList = existingBookings
      .map(b => `${b.day.dayOfWeek} at ${b.slot.startTime}`)
      .join(' and ');
    return res.status(400).json({
      error: `${cleanName} already has 2 slots reserved (${reservedList}). Each quizzer can book a maximum of 2 slots.`
    });
  }

  let targetSlot = null;
  let targetDay = null;

  for (const day of scheduleData.days) {
    const s = day.slots.find(slot => slot.id === slotId);
    if (s) {
      targetSlot = s;
      targetDay = day;
      break;
    }
  }

  if (!targetSlot) return res.status(404).json({ error: 'Slot not found.' });

  if (targetSlot.status === 'booked') {
    return res.status(409).json({
      error: `This slot was just booked by "${targetSlot.bookedBy}". Please select an open slot.`
    });
  }

  targetSlot.status = 'booked';
  targetSlot.bookedBy = cleanName;
  targetSlot.bookedAt = new Date().toISOString();

  saveSlotsData();

  const totalBooked = existingBookings.length + 1;
  console.log(`[BOOKED] Slot ${targetSlot.id} booked for ${cleanName} (${totalBooked}/2 slots)`);

  res.json({
    success: true,
    message: `Slot booked successfully for ${cleanName}! (${totalBooked} of 2 slots reserved)`,
    slot: targetSlot,
    bookingCount: totalBooked,
    day: {
      id: targetDay.id,
      dayOfWeek: targetDay.dayOfWeek,
      formattedDate: targetDay.formattedDate
    }
  });
});

// Coach: Add a new student/kid to team roster
app.post('/api/roster/add-student', authenticateCoach, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Student name is required.' });

  const cleanName = name.trim();
  if (!scheduleData.settings.students) scheduleData.settings.students = [];

  if (scheduleData.settings.students.some(s => s.toLowerCase() === cleanName.toLowerCase())) {
    return res.status(400).json({ error: `Student "${cleanName}" is already on the roster.` });
  }

  scheduleData.settings.students.push(cleanName);
  scheduleData.settings.targetQuizzers = scheduleData.settings.students.length;
  saveSlotsData();

  // Also sync to scoresData homeQuizzers
  if (!scoresData.meet.homeQuizzers) scoresData.meet.homeQuizzers = [];
  if (!scoresData.meet.homeQuizzers.some(s => s.toLowerCase() === cleanName.toLowerCase())) {
    scoresData.meet.homeQuizzers.push(cleanName);
    saveScoresData();
  }

  console.log(`[ROSTER] Coach ${req.user.name} added student: ${cleanName}`);
  res.json({ success: true, students: scheduleData.settings.students });
});

// Coach: Remove a student from team roster
app.post('/api/roster/remove-student', authenticateCoach, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Student name is required.' });

  const cleanName = name.trim();
  scheduleData.settings.students = (scheduleData.settings.students || []).filter(s => s.toLowerCase() !== cleanName.toLowerCase());
  scheduleData.settings.targetQuizzers = scheduleData.settings.students.length;
  saveSlotsData();

  scoresData.meet.homeQuizzers = (scoresData.meet.homeQuizzers || []).filter(s => s.toLowerCase() !== cleanName.toLowerCase());
  saveScoresData();

  console.log(`[ROSTER] Coach ${req.user.name} removed student: ${cleanName}`);
  res.json({ success: true, students: scheduleData.settings.students });
});

// Coach: Cancel / Reopen a practice slot
app.post('/api/admin/cancel', authenticateCoach, (req, res) => {
  const { slotId } = req.body;

  for (const day of scheduleData.days) {
    const slot = day.slots.find(s => s.id === slotId);
    if (slot) {
      const prev = slot.bookedBy;
      slot.status = 'available';
      delete slot.bookedBy;
      delete slot.bookedAt;
      saveSlotsData();
      return res.json({ success: true, message: `Slot reopened for ${prev}` });
    }
  }
  res.status(404).json({ error: 'Slot not found.' });
});

// Coach: Add slot
app.post('/api/admin/add-slot', authenticateCoach, (req, res) => {
  const { dayId, startTime, endTime } = req.body;
  const day = scheduleData.days.find(d => d.id === dayId);
  if (!day) return res.status(404).json({ error: 'Day not found.' });

  const newSlot = {
    id: `${day.id}-custom-${Date.now()}`,
    startTime: startTime.trim(),
    endTime: endTime.trim(),
    status: 'available'
  };
  day.slots.push(newSlot);
  saveSlotsData();
  res.json({ success: true, slot: newSlot });
});

// Coach: Delete slot
app.post('/api/admin/delete-slot', authenticateCoach, (req, res) => {
  const { slotId } = req.body;
  for (const day of scheduleData.days) {
    const idx = day.slots.findIndex(s => s.id === slotId);
    if (idx !== -1) {
      const removed = day.slots.splice(idx, 1);
      saveSlotsData();
      return res.json({ success: true, slot: removed[0] });
    }
  }
  res.status(404).json({ error: 'Slot not found.' });
});

// Calendar .ics download
app.get('/api/calendar/:slotId', (req, res) => {
  const { slotId } = req.params;
  let targetSlot = null;
  let targetDay = null;

  for (const day of scheduleData.days) {
    const s = day.slots.find(slot => slot.id === slotId);
    if (s) {
      targetSlot = s;
      targetDay = day;
      break;
    }
  }

  if (!targetSlot || targetSlot.status !== 'booked') {
    return res.status(404).send('Booking not found');
  }

  const dateStr = targetDay.dateString.replace(/-/g, '');
  const startHours = targetSlot.start24 ? targetSlot.start24.replace(':', '') : '1830';
  const endHours = targetSlot.end24 ? targetSlot.end24.replace(':', '') : '1845';

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TBQ Quiz Coaching//Slot Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:tbq-${targetSlot.id}@churchquiz`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
    `DTSTART:${dateStr}T${startHours}00`,
    `DTEND:${dateStr}T${endHours}00`,
    `SUMMARY:TBQ Practice: ${targetSlot.bookedBy} with Coach`,
    `DESCRIPTION:Teen Bible Quiz 1-on-1 Practice Session with Coach for ${targetSlot.bookedBy}.`,
    'LOCATION:Church TBQ Practice Room',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="TBQ_Practice_${targetSlot.bookedBy.replace(/[^a-zA-Z0-9]/g, '_')}.ics"`);
  res.send(icsContent);
});

// ==========================================
// 3. TBQ MATCH SCOREKEEPER (COACH ONLY)
// ==========================================

function getDefaultScoresData() {
  return {
    meet: {
      title: "TBQ Quiz Meet",
      homeChurch: "Our Church TBQ",
      opponentChurch: "Opponent Church",
      totalRounds: 3,
      homeQuizzers: DEFAULT_STUDENTS,
      opponentQuizzers: ["Opponent 1", "Opponent 2", "Opponent 3", "Opponent 4", "Opponent 5"]
    },
    currentRound: 1,
    rounds: {
      "1": { roundNum: 1, questions: [] }
    }
  };
}

let scoresData = null;

function loadScoresData() {
  if (fs.existsSync(SCORES_FILE)) {
    try {
      scoresData = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
      if (!scoresData.meet.homeQuizzers) scoresData.meet.homeQuizzers = DEFAULT_STUDENTS;
      return;
    } catch (err) {
      console.error('Failed to load scores file, resetting to default:', err);
    }
  }

  scoresData = getDefaultScoresData();
  saveScoresData();
}

function saveScoresData() {
  try {
    const tempFile = `${SCORES_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(scoresData, null, 2), 'utf8');
    fs.renameSync(tempFile, SCORES_FILE);
  } catch (err) {
    console.error('Error saving scores data:', err);
  }
}

function calculateRoundStats(roundNum) {
  const roundKey = String(roundNum);
  const round = scoresData.rounds[roundKey] || { roundNum, questions: [] };

  const homeStats = {};
  (scoresData.meet.homeQuizzers || []).forEach(q => {
    homeStats[q] = { name: q, correct: 0, errors: 0, points: 0, isQuizzedOut: false, quizOutBonus: 0 };
  });

  const oppStats = {};
  (scoresData.meet.opponentQuizzers || []).forEach(q => {
    oppStats[q] = { name: q, correct: 0, errors: 0, points: 0, isQuizzedOut: false, quizOutBonus: 0 };
  });

  let homeTotalScore = 0;
  let oppTotalScore = 0;

  round.questions.forEach(q => {
    const isHome = q.team === 'home';
    const statsMap = isHome ? homeStats : oppStats;
    const quizzerStat = statsMap[q.quizzer];

    if (q.isCorrect) {
      if (quizzerStat) {
        quizzerStat.correct += 1;
        quizzerStat.points += q.pointValue;
        if (quizzerStat.correct === 5 && !quizzerStat.isQuizzedOut) {
          quizzerStat.isQuizzedOut = true;
          if (quizzerStat.errors === 0) {
            quizzerStat.quizOutBonus = 20;
            quizzerStat.points += 20;
            if (isHome) homeTotalScore += 20;
            else oppTotalScore += 20;
          }
        }
      }
      if (isHome) homeTotalScore += q.pointValue;
      else oppTotalScore += q.pointValue;
    } else {
      if (quizzerStat) quizzerStat.errors += 1;
      if (q.isInterruption) {
        const penalty = Math.round(q.pointValue / 2);
        if (quizzerStat) quizzerStat.points -= penalty;
        if (isHome) homeTotalScore -= penalty;
        else oppTotalScore -= penalty;
      }
    }
  });

  return {
    roundNum,
    homeTeam: {
      name: scoresData.meet.homeChurch,
      totalScore: homeTotalScore,
      quizzers: Object.values(homeStats)
    },
    opponentTeam: {
      name: scoresData.meet.opponentChurch,
      totalScore: oppTotalScore,
      quizzers: Object.values(oppStats)
    },
    questions: round.questions
  };
}

// GET TBQ Meet & Round Data (COACH ONLY)
app.get('/api/tbq', authenticateCoach, (req, res) => {
  const roundNum = parseInt(req.query.round || scoresData.currentRound || 1);
  const roundStats = calculateRoundStats(roundNum);

  res.json({
    meet: scoresData.meet,
    currentRound: roundNum,
    activeRound: roundStats
  });
});

// POST Update Meet & Opponent Settings (COACH ONLY)
app.post('/api/tbq/settings', authenticateCoach, (req, res) => {
  const { title, homeChurch, opponentChurch, totalRounds, opponentQuizzers } = req.body;

  if (title) scoresData.meet.title = title.trim();
  if (homeChurch) scoresData.meet.homeChurch = homeChurch.trim();
  if (opponentChurch) scoresData.meet.opponentChurch = opponentChurch.trim();
  if (totalRounds && !isNaN(totalRounds)) scoresData.meet.totalRounds = Math.max(1, parseInt(totalRounds));

  if (Array.isArray(opponentQuizzers)) {
    scoresData.meet.opponentQuizzers = opponentQuizzers.map(q => q.trim()).filter(Boolean);
  } else if (typeof opponentQuizzers === 'string') {
    scoresData.meet.opponentQuizzers = opponentQuizzers.split(',').map(q => q.trim()).filter(Boolean);
  }

  saveScoresData();
  console.log(`[TBQ] Coach ${req.user.name} updated meet settings`);
  res.json({ success: true, meet: scoresData.meet });
});

// POST Record Question Score (COACH ONLY)
app.post('/api/tbq/score', authenticateCoach, (req, res) => {
  const { roundNum, pointValue, isInterruption, team, quizzer, isCorrect } = req.body;
  const rNum = parseInt(roundNum || scoresData.currentRound || 1);
  const rKey = String(rNum);

  if (!scoresData.rounds[rKey]) {
    scoresData.rounds[rKey] = { roundNum: rNum, questions: [] };
  }

  const round = scoresData.rounds[rKey];
  const currentStats = calculateRoundStats(rNum);
  const teamStats = team === 'home' ? currentStats.homeTeam : currentStats.opponentTeam;
  const quizzerStat = teamStats.quizzers.find(q => q.name === quizzer);

  if (quizzerStat && quizzerStat.isQuizzedOut) {
    return res.status(400).json({ error: `${quizzer} has already Quizzed Out with 5 questions and cannot answer further questions in this round.` });
  }

  const newQuestion = {
    id: `q-${Date.now()}`,
    questionNum: round.questions.length + 1,
    pointValue: parseInt(pointValue) || 20,
    isInterruption: !!isInterruption,
    team: team === 'opponent' ? 'opponent' : 'home',
    quizzer: (quizzer || 'Unknown').trim(),
    isCorrect: !!isCorrect,
    scoredBy: req.user.name,
    timestamp: new Date().toISOString()
  };

  round.questions.push(newQuestion);
  scoresData.currentRound = rNum;
  saveScoresData();

  res.json({ success: true, activeRound: calculateRoundStats(rNum) });
});

// POST Undo Question (COACH ONLY)
app.post('/api/tbq/undo', authenticateCoach, (req, res) => {
  const { roundNum } = req.body;
  const rNum = parseInt(roundNum || scoresData.currentRound || 1);
  const rKey = String(rNum);

  if (scoresData.rounds[rKey] && scoresData.rounds[rKey].questions.length > 0) {
    const removed = scoresData.rounds[rKey].questions.pop();
    saveScoresData();
    return res.json({ success: true, removed, activeRound: calculateRoundStats(rNum) });
  }

  res.status(400).json({ error: 'No questions to undo in this round.' });
});

// POST Reset Round (COACH ONLY)
app.post('/api/tbq/reset-round', authenticateCoach, (req, res) => {
  const { roundNum } = req.body;
  const rNum = parseInt(roundNum || 1);
  scoresData.rounds[String(rNum)] = { roundNum: rNum, questions: [] };
  saveScoresData();
  res.json({ success: true, activeRound: calculateRoundStats(rNum) });
});

// Initialize
loadCoaches();
loadSlotsData();
loadScoresData();

// Start Server
app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`TBQ Coaching Platform running on http://localhost:${PORT}`);
  console.log(`Super Coach login: supercoach / super2026`);
  console.log(`Regular Coach login: coach / coach2026`);
  console.log(`=================================================`);
});
