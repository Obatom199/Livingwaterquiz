// ============================================================
//  BIBLE STUDY CBT — app.js
//  All data lives in localStorage so nothing needs a server.
// ============================================================

const APP_KEY   = 'bibleCBT';
const EXAM_MINS = 60; // default exam duration in minutes

// ── Helpers ─────────────────────────────────────────────────
const save  = (k, v) => localStorage.setItem(`${APP_KEY}_${k}`, JSON.stringify(v));
const load  = (k, fallback=null) => { try { const r = localStorage.getItem(`${APP_KEY}_${k}`); return r ? JSON.parse(r) : fallback; } catch { return fallback; } };
const clear = (k) => localStorage.removeItem(`${APP_KEY}_${k}`);

/** Fisher-Yates shuffle — returns NEW shuffled array */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Seed-based shuffle using student PIN so same student always gets same order */
function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = [...seed].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Data layer ───────────────────────────────────────────────

/** Returns the full questions array (both groups share the same 150) */
function getQuestions() {
  return load('questions', []);
}

function saveQuestions(qs) {
  save('questions', qs);
}

/** Returns students array: [{id, name, pin, group:'youth'|'adult', done:false}] */
function getStudents() {
  return load('students', []);
}

function saveStudents(students) {
  save('students', students);
}

/** Returns all submissions: [{studentId, answers:[{qId,chosen}], score, total, date}] */
function getSubmissions() {
  return load('submissions', []);
}

function saveSubmission(sub) {
  const subs = getSubmissions();
  // Replace if student already submitted
  const idx = subs.findIndex(s => s.studentId === sub.studentId);
  if (idx >= 0) subs[idx] = sub; else subs.push(sub);
  save('submissions', subs);
}

// ── Session helpers ──────────────────────────────────────────

/** Active exam session stored per-tab so two students can run in parallel tabs */
function getSession() {
  try {
    const r = sessionStorage.getItem(`${APP_KEY}_session`);
    return r ? JSON.parse(r) : null;
  } catch { return null; }
}

function saveSession(s) {
  sessionStorage.setItem(`${APP_KEY}_session`, JSON.stringify(s));
}

function clearSession() {
  sessionStorage.removeItem(`${APP_KEY}_session`);
}

// ── Login ────────────────────────────────────────────────────

/**
 * Attempt to log a student in.
 * Returns {ok:true, student} or {ok:false, error}
 */
function studentLogin(name, pin) {
  const students = getStudents();
  const student  = students.find(
    s => s.name.trim().toLowerCase() === name.trim().toLowerCase()
      && s.pin === pin.trim()
  );
  if (!student) return { ok: false, error: 'Name or PIN not found. Please check and try again.' };

  const questions = getQuestions();
  if (questions.length === 0) return { ok: false, error: 'No questions loaded yet. Please contact the admin.' };

  // Build this student's shuffled question order (seeded by their PIN so reproducible)
  const questionOrder = seededShuffle(
    questions.map((_, i) => i),   // array of indices
    student.pin + student.id
  );

  const session = {
    studentId:     student.id,
    studentName:   student.name,
    group:         student.group,
    questionOrder, // array of original indices, shuffled
    answers:       {},  // { [displayPos]: chosenOptionIndex }
    currentPos:    0,
    startTime:     Date.now(),
    durationMs:    EXAM_MINS * 60 * 1000,
    submitted:     false,
  };

  saveSession(session);
  return { ok: true, student };
}

// ── Exam helpers ─────────────────────────────────────────────

/** Get the question to display at position pos */
function getQuestionAtPos(session, pos) {
  const questions = getQuestions();
  const origIdx   = session.questionOrder[pos];
  return { ...questions[origIdx], origIdx };
}

/** Record an answer */
function recordAnswer(pos, chosenIdx) {
  const session = getSession();
  if (!session) return;
  session.answers[pos] = chosenIdx;
  saveSession(session);
}

/** Submit exam — returns score object */
function submitExam() {
  const session   = getSession();
  if (!session || session.submitted) return null;

  const questions = getQuestions();
  let correct = 0;

  const answers = session.questionOrder.map((origIdx, pos) => {
    const q        = questions[origIdx];
    const chosen   = session.answers[pos] ?? -1;
    const isRight  = chosen === q.answer;
    if (isRight) correct++;
    return { qId: origIdx, chosen, correct: isRight };
  });

  const score = {
    studentId:  session.studentId,
    studentName:session.studentName,
    group:      session.group,
    answers,
    score:      correct,
    total:      questions.length,
    percent:    Math.round((correct / questions.length) * 100),
    timeTaken:  Math.round((Date.now() - session.startTime) / 1000),
    date:       new Date().toISOString(),
  };

  saveSubmission(score);

  // Mark student as done
  const students = getStudents();
  const s = students.find(x => x.id === session.studentId);
  if (s) { s.done = true; saveStudents(students); }

  session.submitted = true;
  saveSession(session);

  return score;
}

/** Time remaining in seconds */
function timeRemaining(session) {
  const elapsed = Date.now() - session.startTime;
  return Math.max(0, Math.floor((session.durationMs - elapsed) / 1000));
}

function formatTime(secs) {
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// ── Admin helpers ────────────────────────────────────────────

function generateId() {
  return Math.random().toString(36).slice(2, 9).toUpperCase();
}

/**
 * Parse a bulk question import.
 * Expected format (one question per block):
 *   Q: Question text
 *   A: Option A text
 *   B: Option B text
 *   C: Option C text
 *   D: Option D text
 *   ANS: B
 *
 * Returns {questions:[], errors:[]}
 */
function parseBulkQuestions(text) {
  const questions = [];
  const errors    = [];
  const blocks    = text.trim().split(/\n\s*\n+/);

  blocks.forEach((block, i) => {
    const lines = block.trim().split('\n').map(l => l.trim()).filter(Boolean);
    const get   = (prefix) => {
      const l = lines.find(x => x.toUpperCase().startsWith(prefix + ':'));
      return l ? l.slice(prefix.length + 1).trim() : null;
    };

    const qText = get('Q');
    const a     = get('A');
    const b     = get('B');
    const c     = get('C');
    const d     = get('D');
    const ans   = get('ANS');

    if (!qText || !a || !b || !c || !d || !ans) {
      errors.push(`Block ${i+1}: missing field(s). Needs Q, A, B, C, D, ANS.`);
      return;
    }

    const ansMap = { A: 0, B: 1, C: 2, D: 3 };
    const ansIdx = ansMap[ans.toUpperCase()];
    if (ansIdx === undefined) {
      errors.push(`Block ${i+1}: ANS must be A, B, C, or D.`);
      return;
    }

    questions.push({ text: qText, options: [a, b, c, d], answer: ansIdx });
  });

  return { questions, errors };
}

function clearAllData() {
  ['questions','students','submissions'].forEach(k => clear(k));
}

// ── Export for use in other pages ───────────────────────────
window.CBT = {
  // data
  getQuestions, saveQuestions,
  getStudents,  saveStudents,
  getSubmissions, saveSubmission,
  // session
  getSession, saveSession, clearSession,
  // exam
  studentLogin, getQuestionAtPos, recordAnswer, submitExam,
  timeRemaining, formatTime,
  // admin
  generateId, parseBulkQuestions, clearAllData,
  shuffle,
  EXAM_MINS,
};
