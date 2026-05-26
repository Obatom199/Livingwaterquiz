// ============================================================
//  BIBLE STUDY CBT — app.js
//  Data stored in Supabase so all laptops stay in sync.
// ============================================================

const SUPABASE_URL  = 'https://jdqzqfpelatygsojovfg.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkcXpxZnBlbGF0eWdzb2pvdmZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MTgxMzQsImV4cCI6MjA5NTI5NDEzNH0.jK2paV7QhkF64y0ssj0MfjDyF4SpqxO-yaNoJOZImeU';
const EXAM_MINS     = 60;
const APP_KEY       = 'bibleCBT';

// ── Supabase REST helper ─────────────────────────────────────
async function sb(table, options = {}) {
  const {
    method   = 'GET',
    filters  = '',
    body     = null,
    headers  = {},
  } = options;

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
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

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

async function saveQuestions(qs) {
  // Insert all in one batch
  return await sb('questions', { method: 'POST', body: qs });
}

async function clearQuestions() {
  // Delete all rows
  await sb('questions', {
    method: 'DELETE',
    filters: 'id=gte.0',
    headers: { 'Prefer': 'return=minimal' },
  });
}

// ── Students ─────────────────────────────────────────────────
async function getStudents() {
  const rows = await sb('students', { filters: 'select=id,name,pin,group_name,done&order=name.asc' });
  return rows.map(r => ({
    id:    r.id,
    name:  r.name,
    pin:   r.pin,
    group: r.group_name,
    done:  r.done,
  }));
}

async function addStudent(student) {
  const rows = await sb('students', {
    method: 'POST',
    body: { id: student.id, name: student.name, pin: student.pin, group_name: student.group, done: false },
  });
  return rows[0];
}

async function removeStudent(id) {
  await sb('students', {
    method: 'DELETE',
    filters: `id=eq.${id}`,
    headers: { 'Prefer': 'return=minimal' },
  });
}

async function markStudentDone(id) {
  await sb('students', {
    method: 'PATCH',
    filters: `id=eq.${id}`,
    body: { done: true },
    headers: { 'Prefer': 'return=minimal' },
  });
}

async function resetAllDone() {
  await sb('students', {
    method: 'PATCH',
    filters: 'done=eq.true',
    body: { done: false },
    headers: { 'Prefer': 'return=minimal' },
  });
  // Also clear all submissions
  await sb('submissions', {
    method: 'DELETE',
    filters: 'id=gte.0',
    headers: { 'Prefer': 'return=minimal' },
  });
}

// ── Submissions ───────────────────────────────────────────────
async function getSubmissions() {
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

async function saveSubmission(sub) {
  // Upsert by student_id
  await sb('submissions', {
    method: 'POST',
    body: {
      student_id:   sub.studentId,
      student_name: sub.studentName,
      group_name:   sub.group,
      answers:      sub.answers,
      score:        sub.score,
      total:        sub.total,
      percent:      sub.percent,
      time_taken:   sub.timeTaken,
      date:         sub.date,
    },
    headers: {
      'Prefer': 'resolution=merge-duplicates,return=minimal',
      'on_conflict': 'student_id',
    },
  });
}

// ── Session (stays local per tab — this is correct) ──────────
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
async function studentLogin(name, pin) {
  let students, questions;

  try {
    [students, questions] = await Promise.all([getStudents(), getQuestions()]);
  } catch (e) {
    return { ok: false, error: 'Could not connect to the server. Check your internet connection.' };
  }

  const student = students.find(
    s => s.name.trim().toLowerCase() === name.trim().toLowerCase()
      && s.pin === pin.trim()
  );

  if (!student) return { ok: false, error: 'Name or PIN not found. Please check and try again.' };
  if (questions.length === 0) return { ok: false, error: 'No questions loaded yet. Please contact the admin.' };

  const questionOrder = seededShuffle(
    questions.map((_, i) => i),
    student.pin + student.id
  );

  const session = {
    studentId:     student.id,
    studentName:   student.name,
    group:         student.group,
    questionOrder,
    questions,      // cache questions in session so exam page doesn't need to fetch
    answers:       {},
    currentPos:    0,
    startTime:     Date.now(),
    durationMs:    EXAM_MINS * 60 * 1000,
    submitted:     false,
  };

  saveSession(session);
  return { ok: true, student };
}

// ── Exam helpers ─────────────────────────────────────────────
function getQuestionAtPos(session, pos) {
  const origIdx = session.questionOrder[pos];
  return { ...session.questions[origIdx], origIdx };
}

function recordAnswer(pos, chosenIdx) {
  const session = getSession();
  if (!session) return;
  session.answers[pos] = chosenIdx;
  saveSession(session);
}

async function submitExam() {
  const session = getSession();
  if (!session || session.submitted) return null;

  const questions = session.questions;
  let correct = 0;

  const answers = session.questionOrder.map((origIdx, pos) => {
    const q       = questions[origIdx];
    const chosen  = session.answers[pos] ?? -1;
    const isRight = chosen === q.answer;
    if (isRight) correct++;
    return { qId: origIdx, chosen, correct: isRight };
  });

  const score = {
    studentId:   session.studentId,
    studentName: session.studentName,
    group:       session.group,
    answers,
    score:       correct,
    total:       questions.length,
    percent:     Math.round((correct / questions.length) * 100),
    timeTaken:   Math.round((Date.now() - session.startTime) / 1000),
    date:        new Date().toISOString(),
  };

  await saveSubmission(score);
  await markStudentDone(session.studentId);

  session.submitted = true;
  saveSession(session);

  return score;
}

// ── Timer helpers ────────────────────────────────────────────
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

function parseBulkQuestions(text) {
  const questions = [];
  const errors    = [];
  const blocks    = text.trim().split(/\n(?=Q:)/);

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

    if (!qText || !a || !b || !c || !ans) {
      errors.push(`Block ${i+1}: missing field(s).`);
      return;
    }

    const ansMap = { A: 0, B: 1, C: 2, D: 3 };
    const ansIdx = ansMap[ans.toUpperCase()];
    if (ansIdx === undefined) {
      errors.push(`Block ${i+1}: ANS must be A, B, C, or D.`);
      return;
    }

    // D is optional (some questions only have 3 options)
    const options = d ? [a, b, c, d] : [a, b, c];
    questions.push({ text: qText, options, answer: ansIdx });
  });

  return { questions, errors };
}

async function clearAllData() {
  await Promise.all([
    clearQuestions(),
    sb('students',    { method: 'DELETE', filters: 'id=gte.0',   headers: { 'Prefer': 'return=minimal' } }),
    sb('submissions', { method: 'DELETE', filters: 'id=gte.0',   headers: { 'Prefer': 'return=minimal' } }),
  ]);
}

// ── Export ───────────────────────────────────────────────────
window.CBT = {
  // questions
  getQuestions, saveQuestions, clearQuestions,
  // students
  getStudents, addStudent, removeStudent, markStudentDone, resetAllDone,
  // submissions
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
