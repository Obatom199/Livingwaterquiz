// ============================================================
//  BIBLE STUDY CBT — app.js (FIXED)
//  Data stored in Supabase
// ============================================================

const SUPABASE_URL  = 'https://jdqzqfpelatygsojovfg.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkcXpxZnBlbGF0eWdzb2pvdmZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MTgxMzQsImV4cCI6MjA5NTI5NDEzNH0.jK2paV7QhkF64y0ssj0MfjDyF4SpqxO-yaNoJOZImeU';
const APP_KEY       = 'bibleCBT';

// ── Supabase REST helper ─────────────────────────────────────
async function sb(table, options = {}) {
  const { method = 'GET', filters = '', body = null, headers = {} } = options;
  const url = `${SUPABASE_URL}/rest/v1/${table}${filters ? '?' + filters : ''}`;

  const res = await fetch(url, {
    method,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type':  'application/json',
      'Prefer':        method === 'POST' ? 'return=representation' : 'return=representation',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${method} ${table}: ${err}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

// ── Shuffle helpers ──────────────────────────────────────────
function shuffle(arr) { /* unchanged */ 
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function seededShuffle(arr, seed) { /* unchanged */ 
  const a = [...arr];
  let s = [...seed].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Questions ────────────────────────────────────────────────
async function getQuestions() {
  const rows = await sb('questions', { filters: 'select=id,text,options,answer&order=id.asc' });
  return rows.map(r => ({
    id:      r.id,
    text:    r.text,
    options: r.options,
    answer:  r.answer,
  }));
}

// ... (saveQuestions, clearQuestions remain the same)

async function saveQuestions(qs) {
  return await sb('questions', { method: 'POST', body: qs });
}

async function clearQuestions() {
  await sb('questions', {
    method: 'DELETE',
    filters: 'id=gte.0',
    headers: { 'Prefer': 'return=minimal' },
  });
}

// ── Students & Submissions (unchanged except minor improvements) ──
async function getStudents() { /* unchanged */ 
  const rows = await sb('students', { filters: 'select=id,name,pin,group_name,done&order=name.asc' });
  return rows.map(r => ({
    id:    r.id,
    name:  r.name,
    pin:   r.pin,
    group: r.group_name,
    done:  r.done,
  }));
}

// ... keep other student and submission functions as they were

async function getSubmissions() { /* unchanged */ 
  const rows = await sb('submissions', { filters: 'select=*&order=score.desc' });
  return rows.map(r => ({
    studentId:   r.student_id,
    studentName: r.student_name,
    group:       r.group_name,
    answers:     r.answers,
    score:       r.score,
    total:       r.total,
    percent:     r.percent,
    timeTaken:   r.time_taken,
    date:        r.date,
  }));
}

// ── Get Duration from Settings ─────────────────────────────────
function getExamDuration() {
  const saved = localStorage.getItem('bibleCBT_duration');
  return saved ? parseInt(saved) : 60;
}

// ── Session & Login (Updated with dynamic duration) ───────────
function getSession() { /* unchanged */ 
  try {
    const r = sessionStorage.getItem(`${APP_KEY}_session`);
    return r ? JSON.parse(r) : null;
  } catch { return null; }
}

function saveSession(s) {
  sessionStorage.setItem(`${APP_KEY}_session`, JSON.stringify(s));
}

async function studentLogin(name, pin) {
  let students, questions;

  try {
    [students, questions] = await Promise.all([getStudents(), getQuestions()]);
  } catch (e) {
    return { ok: false, error: 'Could not connect to the server.' };
  }

  const student = students.find(s => 
    s.name.trim().toLowerCase() === name.trim().toLowerCase() && s.pin === pin.trim()
  );

  if (!student) return { ok: false, error: 'Name or PIN not found.' };
  if (questions.length === 0) return { ok: false, error: 'No questions loaded yet.' };

  const questionOrder = seededShuffle(questions.map((_, i) => i), student.pin + student.id);

  const session = {
    studentId:     student.id,
    studentName:   student.name,
    group:         student.group,
    questionOrder,
    questions,
    answers:       {},
    currentPos:    0,
    startTime:     Date.now(),
    durationMs:    getExamDuration() * 60 * 1000,   // ← FIXED: Use admin setting
    submitted:     false,
  };

  saveSession(session);
  return { ok: true, student };
}

// Rest of exam functions remain mostly same...

function timeRemaining(session) {
  const elapsed = Date.now() - session.startTime;
  return Math.max(0, Math.floor((session.durationMs - elapsed) / 1000));
}

// Admin helpers
function generateId() {
  return Math.random().toString(36).slice(2, 9).toUpperCase();
}

// ... keep parseBulkQuestions and clearAllData as they were

window.CBT = {
  getQuestions, saveQuestions, clearQuestions,
  getStudents, addStudent, removeStudent, markStudentDone, resetAllDone,
  getSubmissions, saveSubmission,
  getSession, saveSession, clearSession,
  studentLogin, getQuestionAtPos, recordAnswer, submitExam,
  timeRemaining, formatTime,
  generateId, parseBulkQuestions, clearAllData,
  getExamDuration,   // ← Added
  shuffle,
};
