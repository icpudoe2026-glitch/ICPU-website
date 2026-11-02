/* ==================================================================
   LESSON PULSE — evidence-based exit tickets for evaluative practice
   ICPU × NSW Department of Education prototype

   ▶ TO GO LIVE: replace `null` below with your Firebase web config
     (Firebase console → Project settings → Your apps → Web app).
     Leave it as null to run in demo mode (data stays in this browser).
   ================================================================== */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDtL90pDSJGEcrrxAtZuG1PGDnWk700Qz8",
  authDomain: "icpu-lesson-pulse.firebaseapp.com",
  projectId: "icpu-lesson-pulse",
  storageBucket: "icpu-lesson-pulse.firebasestorage.app",
  messagingSenderId: "814840486850",
  appId: "1:814840486850:web:5367fd043b050a1ef6d45b",
  measurementId: "G-4409Z3ESEM"
};

/* ▶ LIVE DEMO: the pamphlet QR code opens ?t=demo. Ticking "Use as the live
     demo ticket" when creating an exit ticket saves it under this ID,
     replacing the previous demo ticket, so that link always opens the latest
     one. Presenters watch it at #/lesson/demo (signed in as its owner).
     Between sessions, anyone who scans is told the demo opens during the
     session. */
const DEMO_ID = "demo";

const QUERY = new URLSearchParams(location.search);

// Open a ready-made teacher dashboard with example classes, kept in the
// visitor's own browser, so an audience can explore it without an account.
const SAMPLE_PATH = /\/teacher-sample(?:\/index\.html)?\/?$/.test(location.pathname);
const SAMPLE_MODE = QUERY.has("sample") || (SAMPLE_PATH && !QUERY.get("t"));

// Local copies (localhost, or the file opened from disk) always run in demo
// mode, so editing never needs a Firebase login or touches live data.
const LOCAL_DEMO = ["localhost", "127.0.0.1", ""].includes(location.hostname);

const FB_VERSION = "10.12.2";
const TICKET_HOURS = 24;
const TICKET_MS = TICKET_HOURS * 3600 * 1000;
const ON_TRACK = 70;   // % positive at or above = on track
const MONITOR = 50;    // % positive at or above = monitor; below = act

/* ------------------------------------------------------------------
   UTILITIES
   ------------------------------------------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (x, n) => (n ? Math.round((100 * x) / n) : 0);
function randomId(len = 20) {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return Array.from(b, x => a[x % a.length]).join("");
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const fmtDate = ms => new Date(ms).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
const fmtDateTime = ms => new Date(ms).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
function fmtLeft(ms) {
  const m = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(m / 60), mm = m % 60;
  return h ? `${h}h ${mm}m` : `${mm}m`;
}
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function wpick(rnd, w) {
  const tot = w.reduce((a, b) => a + b, 0);
  let r = rnd() * tot;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
  return w.length - 1;
}

const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--brand)"/><path d="M5 17h5l2.6-6.5 4.2 12.5 3.1-9 1.9 3H27" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ------------------------------------------------------------------
   THE EVIDENCE MODEL
   Each question evaluates an aspect of the TEACHING, and each maps to
   a What Works Best 2025 practice or a Quality Teaching Rounds item.
   ------------------------------------------------------------------ */
const AGREE = ["Not really", "A bit", "Mostly", "Definitely"];
const QUESTIONS = [
  { key: "clarity", type: "agree", text: "I knew what I was meant to learn today, and what good work looks like." },
  { key: "explain", type: "agree", text: "The teacher's explanations and examples helped me understand." },
  { key: "understand", type: "agree", text: "I understand today's work now." },
  { key: "growth", type: "agree", text: "I know more now than I did at the start of the lesson." },
  { key: "feedback", type: "agree", text: "I got feedback today that helped me improve." },
  { key: "relevance", type: "agree", text: "I can see why today's learning matters." },
  { key: "prior", type: "choice", text: "How much of today's content did you already know?", hint: "For example, from primary school or a previous class.", options: ["All new to me", "A little", "About half", "Most of it"] },
  { key: "challenge", type: "choice", text: "Today's work was…", options: ["Too easy", "Just right", "Too hard"] },
  { key: "pace", type: "choice", text: "The pace of the lesson was…", options: ["Too slow", "Just right", "Too fast"] },
  { key: "unsure", type: "text", text: "One thing I'm still unsure about", hint: "Optional — leave blank if nothing." }
];
const REQUIRED_KEYS = QUESTIONS.filter(q => q.type !== "text").map(q => q.key);

const MEASURES = [
  { key: "clarity", label: "Learning goal clear", short: "Goal clear", src: "WWB 2025 · Assessment & Explicit teaching; QTR · Explicit quality criteria" },
  { key: "explain", label: "Explanations helped", short: "Explanations", src: "WWB 2025 · Explicit teaching" },
  { key: "understand", label: "Understands the work", short: "Understands", src: "WWB 2025 · Assessment" },
  { key: "growth", label: "Learning moved forward", short: "Moved forward", src: "WWB 2025 · Using data to inform practice" },
  { key: "feedback", label: "Feedback helped", short: "Feedback", src: "WWB 2025 · Effective feedback" },
  { key: "relevance", label: "Sees why it matters", short: "Relevance", src: "QTR student survey · Relevance" },
  { key: "challenge", label: "Challenge just right", short: "Challenge", src: "WWB 2025 · High expectations" },
  { key: "pace", label: "Pace just right", short: "Pace", src: "WWB 2025 · Explicit teaching (pacing)" }
];
const STATUS = {
  on: { label: "On track", icon: "✓" },
  monitor: { label: "Monitor", icon: "!" },
  act: { label: "Act", icon: "✕" },
  none: { label: "No data", icon: "–" }
};
function isPositive(r, key) {
  const v = r[key];
  if (key === "challenge" || key === "pace") return v === 2;
  return v >= 3;
}
function statusOf(p, n) { if (!n) return "none"; return p >= ON_TRACK ? "on" : p >= MONITOR ? "monitor" : "act"; }
function measureStats(resp) {
  const n = resp.length;
  return MEASURES.map(m => {
    const pos = resp.filter(r => isPositive(r, m.key)).length;
    const p = pct(pos, n);
    return { ...m, n, pos, pct: p, status: statusOf(p, n) };
  });
}
function dist(resp, key, k) {
  const d = Array(k).fill(0);
  resp.forEach(r => { const v = r[key]; if (v >= 1 && v <= k) d[v - 1]++; });
  return d;
}
const onTrackCount = stats => stats.filter(s => s.status === "on").length;

function publicLesson(l) {
  return {
    id: l.id, title: l.title, intention: l.intention || "", className: l.className || "",
    yearLevel: l.yearLevel || "", subject: l.subject || "", expiresAtMs: l.expiresAtMs
  };
}

/* ------------------------------------------------------------------
   BACKEND A — FIREBASE (Auth + Firestore). The 24-hour expiry is
   enforced by the Firestore security rules, not just this page.
   ------------------------------------------------------------------ */
async function makeFirebaseBackend(cfg) {
  const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
  const [appM, authM, fs] = await Promise.all([
    import(base + "firebase-app.js"),
    import(base + "firebase-auth.js"),
    import(base + "firebase-firestore.js")
  ]);
  const app = appM.initializeApp(cfg);
  const auth = authM.getAuth(app);
  const db = fs.getFirestore(app);
  const { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, onSnapshot, serverTimestamp, Timestamp } = fs;
  let pendingProfile = null;

  return {
    mode: "firebase",
    onAuth(cb) {
      authM.onAuthStateChanged(auth, async u => {
        if (!u) { cb(null); return; }
        let prof = {};
        try { const s = await getDoc(doc(db, "teachers", u.uid)); if (s.exists()) prof = s.data(); } catch (e) { /* profile is optional */ }
        cb({
          uid: u.uid, email: u.email,
          name: u.displayName || prof.name || (pendingProfile && pendingProfile.name) || "",
          school: prof.school || (pendingProfile && pendingProfile.school) || ""
        });
      });
    },
    async signUp({ name, school, email, password }) {
      pendingProfile = { name, school };
      const c = await authM.createUserWithEmailAndPassword(auth, email.trim(), password);
      await authM.updateProfile(c.user, { displayName: name });
      await setDoc(doc(db, "teachers", c.user.uid), { name, school, email: email.trim(), createdAt: serverTimestamp() });
    },
    signIn: (email, pw) => authM.signInWithEmailAndPassword(auth, email.trim(), pw),
    signOut: () => authM.signOut(auth),
    resetPassword: email => authM.sendPasswordResetEmail(auth, email.trim()),

    watchTeacherData(uid, cb, onErr) {
      const st = { classes: {}, lessons: {}, responses: {} };
      const respUnsubs = {};
      let stopped = false;
      const emit = debounce(() => cb({ classes: { ...st.classes }, lessons: { ...st.lessons }, responses: { ...st.responses } }), 40);
      // A new ticket appears here before the server has finished saving it,
      // so the security rules can briefly refuse to list its responses, which
      // ends the listener. Retry with backoff while the ticket still exists,
      // otherwise live updates stop until the page is reloaded.
      const watchResponses = (id, attempt = 0) => {
        respUnsubs[id] = onSnapshot(collection(db, "lessons", id, "responses"), rs => {
          st.responses[id] = rs.docs.map(r => r.data());
          emit();
        }, () => {
          delete respUnsubs[id];
          setTimeout(() => {
            if (!stopped && st.lessons[id] && !respUnsubs[id]) watchResponses(id, attempt + 1);
          }, Math.min(30000, 1000 * 2 ** attempt));
        });
      };
      const u1 = onSnapshot(query(collection(db, "classes"), where("ownerUid", "==", uid)), snap => {
        st.classes = {};
        snap.forEach(d => { st.classes[d.id] = { id: d.id, ...d.data() }; });
        emit();
      }, onErr);
      const u2 = onSnapshot(query(collection(db, "lessons"), where("ownerUid", "==", uid)), snap => {
        const seen = new Set();
        st.lessons = {};
        snap.forEach(d => {
          const x = d.data();
          seen.add(d.id);
          st.lessons[d.id] = { ...x, id: d.id, expiresAtMs: x.expiresAt && x.expiresAt.toMillis ? x.expiresAt.toMillis() : 0 };
          if (!respUnsubs[d.id]) watchResponses(d.id);
        });
        Object.keys(respUnsubs).forEach(id => {
          if (!seen.has(id)) { respUnsubs[id](); delete respUnsubs[id]; delete st.responses[id]; }
        });
        emit();
      }, onErr);
      return () => { stopped = true; u1(); u2(); Object.values(respUnsubs).forEach(f => f()); };
    },
    async createClass(uid, data) {
      const r = await addDoc(collection(db, "classes"), { ...data, ownerUid: uid, createdAtMs: Date.now() });
      return r.id;
    },
    async createLesson(uid, data, opts = {}) {
      const id = opts.id || randomId(20);
      const now = Date.now();
      await setDoc(doc(db, "lessons", id), {
        ...data, ownerUid: uid, createdAtMs: opts.createdAtMs || now,
        // openedAt is stamped by Google's servers; the security rules close the
        // ticket 24h after it no matter what any device clock says.
        openedAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(now + TICKET_MS)
      });
      return id;
    },
    closeLesson: id => updateDoc(doc(db, "lessons", id), { expiresAt: Timestamp.fromMillis(Date.now()) }),
    async deleteLesson(id) {
      const rs = await getDocs(collection(db, "lessons", id, "responses"));
      await Promise.all(rs.docs.map(d => deleteDoc(d.ref)));
      await deleteDoc(doc(db, "lessons", id));
    },
    async deleteClass(classId, lessonIds) {
      for (const lid of lessonIds) await this.deleteLesson(lid);
      await deleteDoc(doc(db, "classes", classId));
    },
    async getLessonPublic(id) {
      try {
        const s = await getDoc(doc(db, "lessons", id));
        if (!s.exists()) return { status: "missing" };
        const x = s.data();
        const exp = x.expiresAt.toMillis();
        return { status: exp > Date.now() ? "open" : "closed", lesson: publicLesson({ ...x, id, expiresAtMs: exp }) };
      } catch (e) {
        // Rules can deny expired tickets or other reads. A denial alone
        // doesn't establish that a ticket has closed.
        if (e && e.code === "permission-denied") return { status: "unavailable" };
        throw e;
      }
    },
    submitResponse: (id, r) => addDoc(collection(db, "lessons", id, "responses"), { ...r, createdAt: serverTimestamp() }),
    async bulkSubmit(id, arr) {
      for (let i = 0; i < arr.length; i += 20) {
        await Promise.all(arr.slice(i, i + 20).map(r => addDoc(collection(db, "lessons", id, "responses"), { ...r, createdAt: serverTimestamp() })));
      }
    }
  };
}

/* ------------------------------------------------------------------
   BACKEND B — DEMO MODE (this browser only, via localStorage).
   Same interface, so every screen works identically.
   ------------------------------------------------------------------ */
function makeDemoBackend(prefix = "lp3-demo") {
  const KEY = prefix + "-db", SKEY = prefix + "-session";
  const listeners = new Set();
  let authCb = null;
  function load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* corrupt store */ }
    return d && d.users ? d : { users: {}, classes: {}, lessons: {}, responses: {} };
  }
  function save(d) { localStorage.setItem(KEY, JSON.stringify(d)); listeners.forEach(f => f()); }
  window.addEventListener("storage", e => {
    if (e.key === KEY) listeners.forEach(f => f());
    if (e.key === SKEY && authCb) authCb(currentUser());
  });
  async function hash(s) {
    if (crypto.subtle) {
      const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("lp3:" + s));
      return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, "0")).join("");
    }
    return "x" + s.length + s.split("").reverse().join("");
  }
  function currentUser() {
    const uid = localStorage.getItem(SKEY);
    if (!uid) return null;
    const u = Object.values(load().users).find(x => x.uid === uid);
    return u ? { uid: u.uid, email: u.email, name: u.name, school: u.school } : null;
  }
  const fail = (code, msg) => Object.assign(new Error(msg || code), { code });

  return {
    mode: "demo",
    onAuth(cb) { authCb = cb; setTimeout(() => cb(currentUser()), 0); },
    async signUp({ name, school, email, password }) {
      email = email.trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) throw fail("auth/invalid-email");
      if (password.length < 6) throw fail("auth/weak-password");
      const d = load();
      if (d.users[email]) throw fail("auth/email-already-in-use");
      const uid = randomId(16);
      d.users[email] = { uid, name, school, email, pw: await hash(password) };
      save(d);
      localStorage.setItem(SKEY, uid);
      authCb && authCb(currentUser());
      return uid;
    },
    async signIn(email, password) {
      email = email.trim().toLowerCase();
      const u = load().users[email];
      if (!u || u.pw !== (await hash(password))) throw fail("auth/invalid-credential");
      localStorage.setItem(SKEY, u.uid);
      authCb && authCb(currentUser());
    },
    async signOut() { localStorage.removeItem(SKEY); authCb && authCb(null); },
    async resetPassword() { throw fail("demo/no-reset"); },
    watchTeacherData(uid, cb) {
      const emit = () => {
        const d = load();
        const classes = {}, lessons = {}, responses = {};
        Object.values(d.classes).filter(c => c.ownerUid === uid).forEach(c => { classes[c.id] = c; });
        Object.values(d.lessons).filter(l => l.ownerUid === uid).forEach(l => { lessons[l.id] = l; responses[l.id] = d.responses[l.id] || []; });
        cb({ classes, lessons, responses });
      };
      listeners.add(emit);
      emit();
      return () => listeners.delete(emit);
    },
    async createClass(uid, data) {
      const d = load(), id = randomId(16);
      d.classes[id] = { ...data, id, ownerUid: uid, createdAtMs: Date.now() };
      save(d);
      return id;
    },
    async createLesson(uid, data, opts = {}) {
      const d = load(), id = opts.id || randomId(20), now = Date.now();
      d.lessons[id] = { ...data, id, ownerUid: uid, createdAtMs: opts.createdAtMs || now, expiresAtMs: now + TICKET_MS };
      d.responses[id] = [];
      save(d);
      return id;
    },
    async closeLesson(id) { const d = load(); if (d.lessons[id]) { d.lessons[id].expiresAtMs = Date.now(); save(d); } },
    async deleteLesson(id) { const d = load(); delete d.lessons[id]; delete d.responses[id]; save(d); },
    async deleteClass(classId) {
      const d = load();
      Object.values(d.lessons).filter(l => l.classId === classId).forEach(l => { delete d.lessons[l.id]; delete d.responses[l.id]; });
      delete d.classes[classId];
      save(d);
    },
    async getLessonPublic(id) {
      const l = load().lessons[id];
      if (!l) return { status: "missing" };
      return { status: l.expiresAtMs > Date.now() ? "open" : "closed", lesson: publicLesson(l) };
    },
    async submitResponse(id, r) {
      const d = load(), l = d.lessons[id];
      if (!l || l.expiresAtMs <= Date.now()) throw fail("permission-denied");
      (d.responses[id] = d.responses[id] || []).push({ ...r, createdAtMs: Date.now() });
      save(d);
    },
    async bulkSubmit(id, arr) {
      const d = load();
      (d.responses[id] = d.responses[id] || []).push(...arr.map(r => ({ ...r, createdAtMs: Date.now() })));
      save(d);
    }
  };
}

/* ------------------------------------------------------------------
   SAMPLE DATA — clearly tagged; lets a teacher see the comparison
   before they have real old/new syllabus data of their own.
   ------------------------------------------------------------------ */
const SAMPLE_PLAN = [
  { name: "7B Maths", yearLevel: "7", subject: "Mathematics", syllabus: "new", lessons: ["Fractions of a quantity", "Equivalent fractions", "Introducing percentages"], unsure: ["Fractions bigger than 1", "When to simplify", "Turning percentages into decimals"] },
  { name: "7D Maths", yearLevel: "7", subject: "Mathematics", syllabus: "old", lessons: ["Fractions of a quantity", "Equivalent fractions", "Introducing percentages"], unsure: ["Why we multiply then divide", "Percentages over 100", "Nothing — all good"] },
  { name: "8A Science", yearLevel: "8", subject: "Science", syllabus: "new", lessons: ["States of matter", "Particle model", "Changes of state"], unsure: ["What happens to particles when they melt", "The difference between evaporating and boiling", "Writing a method"] },
  { name: "8C Science", yearLevel: "8", subject: "Science", syllabus: "old", lessons: ["States of matter", "Particle model", "Changes of state"], unsure: ["Sublimation", "Drawing the particle diagrams", "Nothing — all good"] }
];
const SAMPLE_W = {
  new: { clarity: [2, 4, 9, 8], explain: [2, 5, 9, 6], understand: [3, 6, 9, 5], growth: [2, 5, 9, 7], feedback: [4, 7, 8, 4], relevance: [2, 5, 9, 7], prior: [7, 6, 4, 3], challenge: [3, 13, 6], pace: [3, 13, 6] },
  old: { clarity: [3, 7, 8, 4], explain: [2, 6, 9, 5], understand: [2, 5, 10, 6], growth: [5, 8, 7, 3], feedback: [4, 8, 7, 4], relevance: [5, 8, 6, 3], prior: [2, 4, 7, 9], challenge: [8, 12, 2], pace: [6, 12, 3] }
};
async function seedSample(backend, uid) {
  let seed = 4021;
  for (const c of SAMPLE_PLAN) {
    const classId = await backend.createClass(uid, { name: c.name, yearLevel: c.yearLevel, subject: c.subject, syllabus: c.syllabus, sample: true });
    for (let i = 0; i < c.lessons.length; i++) {
      const createdAtMs = Date.now() - (c.lessons.length - i) * 2 * 86400000 - 3600000;
      const lid = await backend.createLesson(uid, {
        classId, title: c.lessons[i], intention: "", className: c.name, yearLevel: c.yearLevel, subject: c.subject
      }, { createdAtMs });
      const rnd = mulberry32(seed++);
      const w = SAMPLE_W[c.syllabus];
      const n = 18 + Math.floor(rnd() * 7);
      const arr = [];
      for (let k = 0; k < n; k++) {
        const r = {};
        REQUIRED_KEYS.forEach(key => { r[key] = 1 + wpick(rnd, w[key]); });
        r.unsure = rnd() < 0.35 ? c.unsure[wpick(rnd, [5, 3, 2])] : "";
        arr.push(r);
      }
      await backend.bulkSubmit(lid, arr);
      await backend.closeLesson(lid);
    }
  }
}

/* ==================================================================
   CHARTS — inline SVG (validated palette: blue/orange categorical,
   one-hue ordinal ramp, blue↔red diverging with neutral midpoint)
   ================================================================== */
function roundTopRect(x, y, w, h, r) {
  if (h <= 0) return "";
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}L${x},${y + r}Q${x},${y} ${x + r},${y}L${x + w - r},${y}Q${x + w},${y} ${x + w},${y + r}L${x + w},${y + h}Z`;
}
function hRect(x, y, w, h, rl, rr) {
  const r1 = Math.min(rl, w / 2, h / 2), r2 = Math.min(rr, w / 2, h / 2);
  return `M${x + r1},${y}L${x + w - r2},${y}Q${x + w},${y} ${x + w},${y + r2}L${x + w},${y + h - r2}Q${x + w},${y + h} ${x + w - r2},${y + h}L${x + r1},${y + h}Q${x},${y + h} ${x},${y + h - r1}L${x},${y + r1}Q${x},${y} ${x + r1},${y}Z`;
}
const tipAttr = html => `data-tip="${esc(html)}" tabindex="0"`;

function columnChart(labels, values, colors, aria) {
  const W = 400, H = 200, mL = 6, mR = 6, mT = 24, mB = 28;
  const pw = W - mL - mR, ph = H - mT - mB;
  const total = values.reduce((a, b) => a + b, 0);
  const maxV = Math.max(4, ...values);
  const band = pw / labels.length, bw = 26;
  const step = maxV <= 8 ? 2 : maxV <= 20 ? 5 : 10;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">`;
  for (let g = step; g <= maxV; g += step) {
    const gy = mT + ph - (g / maxV) * ph;
    s += `<line x1="${mL}" x2="${W - mR}" y1="${gy}" y2="${gy}" stroke="var(--line)" stroke-width="1"/>`;
  }
  s += `<line x1="${mL}" x2="${W - mR}" y1="${mT + ph}" y2="${mT + ph}" stroke="var(--ink-3)" stroke-opacity=".5" stroke-width="1"/>`;
  labels.forEach((lab, i) => {
    const v = values[i], h = (v / maxV) * ph, x = mL + band * i + (band - bw) / 2, y = mT + ph - h;
    s += `<path d="${roundTopRect(x, y, bw, h, 4)}" fill="${colors[i]}"/>`;
    s += `<text x="${x + bw / 2}" y="${y - 7}" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--ink-2)">${v}</text>`;
    s += `<text x="${mL + band * i + band / 2}" y="${H - 8}" text-anchor="middle" font-size="11.5" fill="var(--ink-3)">${esc(lab)}</text>`;
    s += `<rect x="${mL + band * i}" y="${mT - 8}" width="${band}" height="${ph + 8}" fill="transparent" ${tipAttr(`<b>${esc(lab)}</b><br>${v} of ${total} students (${pct(v, total)}%)`)}/>`;
  });
  return s + `</svg>`;
}

/* 100% stacked bar as HTML so it scales to any width without stretching text */
function stackBar(segs, n, aria, label) {
  if (!n) return `<div class="stack empty" role="img" aria-label="${esc(aria)}: no responses"></div>`;
  const live = segs.filter(s => s.v > 0);
  const summary = live.map(s => `${s.label} ${pct(s.v, n)}%`).join(", ");
  return `<div class="stack" role="img" aria-label="${esc(aria)}: ${esc(summary)}">${live.map(s => {
    const p = pct(s.v, n);
    return `<span style="flex:${s.v} 1 0;background:${s.color};color:${s.ink}" ${tipAttr(`<b>${esc(label)}: ${esc(s.label)}</b><br>${s.v} of ${n} students (${p}%)`)}>${p >= 10 ? p + "%" : ""}</span>`;
  }).join("")}</div>`;
}

function groupedBars(rows) {
  const W = 820, rowH = 54, mL = 196, mR = 128, mT = 6;
  const H = mT + rows.length * rowH;
  const pw = W - mL - mR, bh = 14;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Percentage of positive responses, new versus old syllabus">`;
  [0, 25, 50, 75, 100].forEach(t => {
    const gx = mL + (t / 100) * pw;
    s += `<line x1="${gx}" x2="${gx}" y1="${mT}" y2="${H - 4}" stroke="var(--line)" stroke-width="1"/>`;
  });
  rows.forEach((r, i) => {
    const y0 = mT + i * rowH + 9;
    s += `<text x="${mL - 12}" y="${y0 + bh + 3}" text-anchor="end" font-size="13" font-weight="650" fill="var(--ink-2)">${esc(r.label)}</text>`;
    [["new", r.a, "var(--new)", 0], ["old", r.b, "var(--old)", bh + 4]].forEach(([k, v, col, off]) => {
      const w = v.n ? Math.max((v.pct / 100) * pw, 3) : 0;
      if (v.n) {
        s += `<path d="${hRect(mL, y0 + off, w, bh, 0, 4)}" fill="${col}"/>`;
        s += `<text x="${mL + w + 7}" y="${y0 + off + bh - 2.5}" font-size="12" font-weight="700" fill="var(--ink-2)">${v.pct}%</text>`;
      }
    });
    if (r.a.n && r.b.n) {
      const d = r.a.pct - r.b.pct;
      const txt = d === 0 ? "No difference" : `${d > 0 ? "+" : "−"}${Math.abs(d)} pts ${d > 0 ? "New" : "Old"}`;
      s += `<text x="${W - 4}" y="${y0 + bh + 3}" text-anchor="end" font-size="12.5" font-weight="750" fill="var(--ink)">${txt}</text>`;
    }
    const tip = `<b>${esc(r.label)}</b><br>New syllabus: ${r.a.n ? r.a.pct + "% (" + r.a.pos + " of " + r.a.n + ")" : "no data"}<br>Old syllabus: ${r.b.n ? r.b.pct + "% (" + r.b.pos + " of " + r.b.n + ")" : "no data"}`;
    s += `<rect x="0" y="${mT + i * rowH}" width="${W}" height="${rowH}" fill="transparent" ${tipAttr(tip)}/>`;
  });
  return s + `</svg>`;
}

const ORD = ["var(--ord-1)", "var(--ord-2)", "var(--ord-3)", "var(--ord-4)"];
const ORD_INK = ["var(--ord-ink-1)", "#ffffff", "#ffffff", "var(--ord-ink-4)"];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function readinessSegs(d) {
  return ["All new", "A little", "About half", "Most of it"].map((label, i) => ({ label, v: d[i], color: ORD[i], ink: ORD_INK[i] }));
}
function legendHTML(items) {
  return `<div class="legend">${items.map(([c, l]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`).join("")}</div>`;
}

/* tooltip — one delegated handler for every [data-tip] */
(function wireTooltips() {
  const tip = $("#tooltip");
  const place = (x, y) => {
    const w = tip.offsetWidth, maxX = document.documentElement.scrollWidth - w - 8;
    tip.style.left = Math.min(x + 14, maxX) + "px";
    tip.style.top = y - 10 - tip.offsetHeight + "px";
  };
  document.addEventListener("mouseover", e => {
    const t = e.target.closest && e.target.closest("[data-tip]");
    if (!t) return;
    tip.innerHTML = t.dataset.tip; tip.style.display = "block"; place(e.pageX, e.pageY);
  });
  document.addEventListener("mousemove", e => { if (tip.style.display === "block") place(e.pageX, e.pageY); });
  document.addEventListener("mouseout", e => { const t = e.target.closest && e.target.closest("[data-tip]"); if (t) tip.style.display = "none"; });
  document.addEventListener("focusin", e => {
    const t = e.target.closest && e.target.closest("[data-tip]");
    if (!t) return;
    const r = t.getBoundingClientRect();
    tip.innerHTML = t.dataset.tip; tip.style.display = "block"; place(r.left + window.scrollX, r.top + window.scrollY);
  });
  document.addEventListener("focusout", () => { tip.style.display = "none"; });
})();

function qrSvg(text) {
  try {
    const q = window.qrcode(0, "M");
    q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true, alt: "QR code for the exit ticket link" });
  } catch (e) { return ""; }
}
const APP_URL = new URL("./", import.meta.url).href;
const ticketUrl = id => `${APP_URL}?t=${encodeURIComponent(id)}${SAMPLE_MODE ? "&sample" : ""}`;
const simulatorUrl = id => `${APP_URL}?t=demoauto&lesson=${encodeURIComponent(id)}${SAMPLE_MODE ? "&sample" : ""}`;

/* ==================================================================
   APP STATE + RENDER LOOP
   ================================================================== */
let backend = null;
const S = {
  authReady: false, user: null, unwatch: null,
  data: { classes: {}, lessons: {}, responses: {} },
  ui: { authTab: "signin", authErr: "", newClass: false, newTicket: false, projector: null, cmpYear: "all", cmpSubject: "all", cmpTable: false, busy: false }
};

function route() {
  const h = location.hash.replace(/^#\/?/, "").split("/");
  if (h[0] === "class" && h[1]) return { name: "class", id: h[1] };
  if (h[0] === "lesson" && h[1]) return { name: "lesson", id: h[1] };
  if (h[0] === "compare") return { name: "compare" };
  return { name: "classes" };
}
const lessonsOf = classId => Object.values(S.data.lessons).filter(l => l.classId === classId).sort((a, b) => b.createdAtMs - a.createdAtMs);
const respOf = lessonId => S.data.responses[lessonId] || [];
const isOpen = l => l.expiresAtMs > Date.now();

function render() {
  const app = $("#app");
  const keep = {};
  app.querySelectorAll("input[id], select[id], textarea[id]").forEach(el => {
    keep[el.id] = (el.type === "radio" || el.type === "checkbox") ? { c: el.checked } : { v: el.value };
  });
  const act = document.activeElement, actId = act && act.id;
  let sel = null;
  try { if (actId && act.selectionStart != null) sel = [act.selectionStart, act.selectionEnd]; } catch (e) { /* not a text field */ }

  app.innerHTML = view();

  Object.entries(keep).forEach(([id, s]) => {
    const el = document.getElementById(id);
    if (!el || el.readOnly) return;
    if ("c" in s) el.checked = s.c; else el.value = s.v;
  });
  if (actId) {
    const el = document.getElementById(actId);
    if (el) { el.focus({ preventScroll: true }); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* ignore */ } }
  }
}
const scheduleRender = debounce(render, 50);

function view() {
  if (!S.authReady) return `<div class="loading">Loading Lesson Pulse…</div>`;
  if (!S.user) return authView();
  const r = route();
  let body;
  if (r.name === "class") body = classView(r.id);
  else if (r.name === "lesson") body = lessonView(r.id);
  else if (r.name === "compare") body = compareView();
  else body = classesView();
  return topbar(r) + body + projectorModal();
}

function topbar(r) {
  const onClasses = r.name !== "compare";
  return `<header class="topbar">
    <a class="brand" href="#/">${LOGO}<span>Lesson Pulse</span></a>
    <nav class="nav" aria-label="Main">
      <a href="#/" class="${onClasses ? "on" : ""}">Classes</a>
      <a href="#/compare" class="${!onClasses ? "on" : ""}">Compare syllabuses</a>
    </nav>
    <div class="who"><span class="who-name">${SAMPLE_MODE ? "Exploring as" : "Signed in as"} <b>${esc(S.user.name || S.user.email)}</b></span>
      ${SAMPLE_MODE ? "" : '<button class="btn ghost sm" data-act="signout">Sign out</button>'}</div>
  </header>
  ${backend.mode === "demo" ? `<div class="demo-bar">${SAMPLE_MODE
    ? "Sample dashboard: example classes and responses, saved on this device only. Explore freely."
    : "Demo mode: accounts and responses are saved in this browser only. Connect Firebase (see the setup guide) so students can respond from their own devices."}</div>` : ""}`;
}

/* ---------------- AUTH ---------------- */
function authView() {
  const up = S.ui.authTab === "signup";
  return `<div class="auth">
    <section class="auth-pitch">
      ${LOGO}
      <h1>Evaluate your teaching, one lesson at a time.</h1>
      <p>Students answer a one-minute exit ticket. You see which parts of your teaching are on track, and how your new-syllabus classes compare with your old-syllabus classes.</p>
      <ul class="auth-points">
        <li>Questions drawn from the Department's What Works Best 2025 evidence guides and Quality Teaching Rounds surveys</li>
        <li>Exit-ticket links and QR codes that close automatically after 24 hours</li>
        <li>Anonymous for students: no student accounts or logins</li>
      </ul>
    </section>
    <section class="auth-card card">
      <div class="seg" role="tablist">
        <button type="button" role="tab" aria-selected="${!up}" class="${!up ? "on" : ""}" data-act="authtab" data-tab="signin">Sign in</button>
        <button type="button" role="tab" aria-selected="${up}" class="${up ? "on" : ""}" data-act="authtab" data-tab="signup">Create account</button>
      </div>
      <form class="auth-form" id="f-auth" novalidate>
        ${up ? `<label class="fld"><span>Your name</span><input id="a-name" autocomplete="name" maxlength="60" placeholder="e.g. Ms Chen"></label>
        <label class="fld"><span>School <em>(optional)</em></span><input id="a-school" maxlength="80" placeholder="e.g. Parramatta High School"></label>` : ""}
        <label class="fld"><span>Email</span><input id="a-email" type="email" autocomplete="email" maxlength="120"></label>
        <label class="fld"><span>Password</span><input id="a-pw" type="password" autocomplete="${up ? "new-password" : "current-password"}" minlength="6" placeholder="${up ? "At least 6 characters" : ""}"></label>
        <button class="btn primary wide" type="submit" ${S.ui.busy ? "disabled" : ""}>${up ? "Create account" : "Sign in"}</button>
      </form>
      <p class="err-msg" role="alert">${esc(S.ui.authErr)}</p>
      <div class="auth-foot">
        ${!up && backend.mode === "firebase" ? `<button class="link-btn" data-act="reset">Forgot password?</button>` : "<span></span>"}
        <span>${backend.mode === "demo" ? "Demo mode: saved in this browser" : "Secured by Firebase Authentication"}</span>
      </div>
    </section>
  </div>`;
}
function authMessage(e) {
  const c = (e && e.code) || "";
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return "That email and password don't match an account.";
  if (c.includes("email-already-in-use")) return "An account already uses this email. Sign in instead.";
  if (c.includes("weak-password")) return "Use a password with at least 6 characters.";
  if (c.includes("invalid-email") || c.includes("missing-email")) return "Enter a valid email address.";
  if (c.includes("too-many-requests")) return "Too many attempts. Wait a minute, then try again.";
  if (c.includes("network-request-failed")) return "No connection. Check your internet and try again.";
  if (c.includes("operation-not-allowed")) return "Email sign-in isn't switched on in Firebase yet (setup guide, step 3).";
  if (c.includes("demo/no-reset")) return "Password reset needs the live Firebase version.";
  return "Something went wrong signing in. Try again.";
}

/* ---------------- CLASSES ---------------- */
const SUBJECTS = ["English", "Mathematics", "Science", "History", "Geography", "PDHPE", "Music", "Visual Arts", "Drama", "Technology", "Languages", "Commerce"];
function classesView() {
  const classes = Object.values(S.data.classes).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  const cards = classes.map(c => {
    const ls = lessonsOf(c.id);
    const nResp = ls.reduce((a, l) => a + respOf(l.id).length, 0);
    const open = ls.find(isOpen);
    const latest = ls.find(l => respOf(l.id).length);
    const latestOn = latest ? onTrackCount(measureStats(respOf(latest.id))) : 0;
    return `<a class="class-card card" href="#/class/${esc(c.id)}">
      <div class="cc-top"><span class="syl-pill ${c.syllabus === "old" ? "old" : "new"}">${c.syllabus === "old" ? "Old syllabus" : "New syllabus"}</span>${c.sample ? `<span class="tag">Sample</span>` : ""}</div>
      <h3>${esc(c.name)}</h3>
      <p class="meta">Year ${esc(c.yearLevel)} · ${esc(c.subject)}</p>
      <div class="cc-stats"><span><b>${ls.length}</b> exit ticket${ls.length === 1 ? "" : "s"}</span><span><b>${nResp}</b> response${nResp === 1 ? "" : "s"}</span></div>
      <div class="cc-foot">${open ? `<span class="live-chip">Exit ticket open</span>` : latest ? `Latest lesson: <b>${latestOn} of 8</b> indicators on track` : `No responses yet`}</div>
    </a>`;
  }).join("");

  return `<main class="page">
    <div class="page-head">
      <div><h1>Your classes</h1><p class="sub">Create a class for each group you teach, then send an exit ticket after a lesson.</p></div>
      ${!S.ui.newClass ? `<button class="btn primary" data-act="new-class">+ New class</button>` : ""}
    </div>
    ${S.ui.newClass ? newClassForm() : ""}
    ${classes.length ? `<div class="class-grid">${cards}</div>
      ${classes.some(c => c.sample) ? "" : `<p class="footer-note">Want to try the syllabus comparison before you have real data? <button class="link-btn" data-act="seed">Add four sample classes</button></p>`}`
      : (!S.ui.newClass ? `<section class="card empty">
        <h2>No classes yet</h2>
        <p>Start by creating a class: its name, year level, subject, and whether it's taught under the new or old syllabus. Or load sample classes to explore the dashboards first.</p>
        <div class="row"><button class="btn primary" data-act="new-class">+ Create your first class</button><button class="btn ghost" data-act="seed" ${S.ui.busy ? "disabled" : ""}>Load sample classes</button></div>
      </section>` : "")}
  </main>`;
}
function newClassForm() {
  return `<form class="card form-card" id="f-class">
    <h2>New class</h2>
    <div class="fields">
      <label class="fld"><span>Class name</span><input id="c-name" maxlength="40" placeholder="e.g. 7B Maths" required></label>
      <label class="fld"><span>Year level</span><select id="c-year">${["7", "8", "9", "10", "11", "12"].map(y => `<option value="${y}">Year ${y}</option>`).join("")}</select></label>
      <label class="fld"><span>Subject</span><input id="c-subject" list="subject-list" maxlength="40" placeholder="e.g. Mathematics" required><datalist id="subject-list">${SUBJECTS.map(s => `<option value="${s}">`).join("")}</datalist></label>
    </div>
    <fieldset class="syl"><legend>Which syllabus is this class taught under?</legend>
      <div class="syl-opts">
        <label class="syl-opt"><input type="radio" name="c-syl" id="c-syl-new" value="new" checked><span><b>New syllabus</b><small>The reformed NESA syllabus being rolled out 2024–2030</small></span></label>
        <label class="syl-opt"><input type="radio" name="c-syl" id="c-syl-old" value="old"><span><b>Old syllabus</b><small>The previous syllabus, still being taught out</small></span></label>
      </div>
    </fieldset>
    <p class="err-msg" id="c-err" role="alert"></p>
    <div class="form-actions"><button type="button" class="btn ghost" data-act="cancel-class">Cancel</button><button class="btn primary" type="submit">Create class</button></div>
  </form>`;
}

/* ---------------- ONE CLASS ---------------- */
function classView(id) {
  const c = S.data.classes[id];
  if (!c) return notFound("This class doesn't exist, or it was deleted.");
  const ls = lessonsOf(id);
  const rows = ls.map(l => {
    const resp = respOf(l.id), st = measureStats(resp);
    return `<tr>
      <td class="l"><a href="#/lesson/${esc(l.id)}">${esc(l.title)}</a><small>${fmtDate(l.createdAtMs)} · ${isOpen(l) ? `<span class="live-chip">Open</span>` : "Closed"}</small></td>
      <td class="n">${resp.length}</td>
      ${st.map(s => `<td class="st-${s.status}" title="${esc(s.label)}: ${STATUS[s.status].label}">${s.n ? `<span class="g" aria-hidden="true">${STATUS[s.status].icon}</span>${s.pct}%` : "–"}</td>`).join("")}
    </tr>`;
  }).join("");
  const demo = S.data.lessons[DEMO_ID];
  const tickets = ls.map(l => {
    const n = respOf(l.id).length;
    return `<li><a class="ticket-row" href="#/lesson/${esc(l.id)}">
      <span class="t-main"><b>${esc(l.title)}</b><small>${fmtDate(l.createdAtMs)} · ${n} response${n === 1 ? "" : "s"} ${isOpen(l) ? `<span class="live-chip">Open</span>` : `<span class="closed-chip">Closed</span>`}${l.id === DEMO_ID ? `<span class="tag gold">Live demo</span>` : ""}</small></span>
      <span class="t-go">View results →</span>
    </a></li>`;
  }).join("");
  return `<main class="page">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Classes</a><span>/</span><span>${esc(c.name)}</span></nav>
    <div class="page-head">
      <div><h1>${esc(c.name)}</h1><p class="sub">Year ${esc(c.yearLevel)} · ${esc(c.subject)} <span class="syl-pill ${c.syllabus === "old" ? "old" : "new"}">${c.syllabus === "old" ? "Old syllabus" : "New syllabus"}</span>${c.sample ? `<span class="tag">Sample</span>` : ""}</p></div>
      ${!S.ui.newTicket ? `<button class="btn primary" data-act="new-ticket">+ New exit ticket</button>` : ""}
    </div>
    ${S.ui.newTicket ? `<form class="card form-card" id="f-ticket">
      <h2>New exit ticket</h2>
      <div class="fields" style="grid-template-columns:1fr 1.4fr">
        <label class="fld"><span>Lesson title</span><input id="t-title" maxlength="80" placeholder="e.g. Fractions of a quantity" required></label>
        <label class="fld"><span>Learning intention <em>(optional, shown to students)</em></span><input id="t-intent" maxlength="160" placeholder="e.g. We are learning to find a fraction of a whole number"></label>
      </div>
      <p class="hint">You'll get a link and QR code for students. It stops accepting responses ${TICKET_HOURS} hours after you create it.</p>
      ${SAMPLE_MODE ? "" : `<label class="syl-opt demo-opt"><input type="checkbox" id="t-demo"><span><b>Use as the live demo ticket</b><small>The pamphlet QR code (link ending ?t=${DEMO_ID}) will open this ticket.${demo ? ` This replaces the current demo ticket, "${esc(demo.title)}", and deletes its ${respOf(DEMO_ID).length} response${respOf(DEMO_ID).length === 1 ? "" : "s"}.` : ""}</small></span></label>`}
      <p class="err-msg" id="t-err" role="alert"></p>
      <div class="form-actions"><button type="button" class="btn ghost" data-act="cancel-ticket">Cancel</button><button class="btn primary" type="submit">Create exit ticket</button></div>
    </form>` : ""}
    ${ls.length ? `<section class="card">
      <div class="card-head"><h2>Exit tickets</h2></div>
      <p class="card-sub">Open one to see its results, share its QR code, or delete it.</p>
      <ul class="tickets">${tickets}</ul>
    </section>` : ""}
    <section class="card">
      <div class="card-head"><h2>Indicators across lessons</h2></div>
      <p class="card-sub">Each cell shows the percentage of students who responded positively. An indicator that stays amber or red across several lessons is the one to work on. ✓ on track (${ON_TRACK}%+) · ! monitor (${MONITOR}–${ON_TRACK - 1}%) · ✕ act (below ${MONITOR}%)</p>
      ${ls.length ? `<div class="scroll-x"><table class="heat">
        <thead><tr><th class="l">Lesson</th><th>Responses</th>${MEASURES.map(m => `<th>${esc(m.short)}</th>`).join("")}</tr></thead>
        <tbody>${rows}</tbody></table></div>`
      : `<div class="waiting"><h2>No exit tickets yet</h2><p>After your next lesson with ${esc(c.name)}, create an exit ticket and share it with the class.</p></div>`}
    </section>
    <div><button class="btn danger-ghost sm" data-act="delete-class" data-id="${esc(id)}">Delete this class</button></div>
  </main>`;
}

/* ---------------- ONE LESSON (the evaluative dashboard) ---------------- */
function lessonView(id) {
  const l = S.data.lessons[id];
  if (!l) return notFound("This exit ticket doesn't exist, or its class was deleted.");
  const c = S.data.classes[l.classId] || { name: l.className, yearLevel: l.yearLevel, subject: l.subject };
  const resp = respOf(id), n = resp.length, open = isOpen(l);
  const stats = measureStats(resp), on = onTrackCount(stats);
  const url = ticketUrl(id);

  const share = open ? `<section class="share card">
      <div class="qr">${qrSvg(url)}</div>
      <div>
        <div class="share-status"><span class="live-chip">Open</span><span>Closes in <span data-countdown="${l.expiresAtMs}">${fmtLeft(l.expiresAtMs - Date.now())}</span></span></div>
        <h2>Share this exit ticket with your class</h2>
        <p>Students scan the QR code or open the link. No login needed, and answers are anonymous.</p>
        <div class="link-row"><input id="share-url" readonly value="${esc(url)}" aria-label="Exit ticket link"><button class="btn primary" data-act="copy" data-url="${esc(url)}">Copy link</button></div>
        <div class="share-actions">
          <button class="btn ghost sm" data-act="projector" data-id="${esc(id)}">Show QR full screen</button>
          <a class="btn ghost sm" href="${esc(url)}" target="_blank" rel="noopener">Preview as a student</a>
          <a class="btn ghost sm" href="${esc(simulatorUrl(id))}" target="_blank" rel="noopener">Simulate responses</a>
          <button class="btn danger-ghost sm" data-act="close-ticket" data-id="${esc(id)}">Close now</button>
        </div>
      </div>
    </section>`
    : `<section class="share closed card"><span class="closed-chip">Closed</span><span>This exit ticket closed ${fmtDateTime(l.expiresAtMs)}. Its link no longer accepts responses.</span></section>`;

  let body;
  if (!n) {
    body = `<section class="card waiting">
      <h2>${open ? "Waiting for responses…" : "No responses were recorded"}</h2>
      <p>${open ? "Responses appear here live as students submit them." : "This exit ticket closed before anyone responded."}</p>
    </section>`;
  } else {
    const prior = dist(resp, "prior", 4), ch = dist(resp, "challenge", 3), pa = dist(resp, "pace", 3);
    const newP = pct(prior[0], n), knewP = pct(prior[3], n);
    const flag = newP >= 20 && knewP >= 20
      ? `<b>Wide readiness spread.</b> ${knewP}% already knew most of this content while ${newP}% found it all new, which can mean different primary-school coverage. Plan a tiered starter or an extension pathway.`
      : knewP >= 40 ? `<b>High prior knowledge.</b> ${knewP}% already knew most of this content. A quick pre-test could let the class move on sooner.`
      : newP >= 40 ? `<b>Mostly new content.</b> ${newP}% met this content for the first time. Allow more modelling and guided practice.`
      : `<b>Even starting point.</b> Most students began from a similar level of prior knowledge.`;
    const unsure = groupUnsure(resp), hidden = resp.filter(r => hasBadLanguage(r.unsure)).length;
    body = `
    <section class="hero-row">
      <div class="hero card">
        <div class="hero-num">${on}<span>/ 8</span></div>
        <div class="hero-lbl">indicators on track</div>
        <div class="hero-meta"><span><b style="color:var(--ink)">${n}</b> response${n === 1 ? "" : "s"}</span>${open ? `<span class="live-chip">Live</span>` : ""}</div>
      </div>
      <div class="ind-grid">${stats.map(s => `<div class="ind" ${tipAttr(`<b>${esc(s.label)}</b><br>${s.pos} of ${s.n} students responded positively<br>${esc(s.src)}`)}>
        <div><span class="st-chip st-${s.status}"><i aria-hidden="true">${STATUS[s.status].icon}</i>${STATUS[s.status].label}</span></div>
        <div class="ind-name">${esc(s.label)}</div>
        <div class="ind-pct">${s.pct}<small>%</small></div>
        <div class="meter"><span class="f-${s.status}" style="width:${s.pct}%"></span></div>
        <div class="ind-n">${s.pos} of ${s.n} students</div>
      </div>`).join("")}</div>
    </section>
    <div class="two-col">
      <section class="card">
        <div class="card-head"><h2>Readiness spread</h2></div>
        <p class="card-sub">"How much of today's content did you already know?" This is the assumed-knowledge check for students arriving from many primary schools.</p>
        <div class="chart">${columnChart(["All new to me", "A little", "About half", "Most of it"], prior, ORD, "Prior knowledge distribution")}</div>
        <div class="flag">${flag}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Challenge and pace</h2></div>
        <p class="card-sub">The middle segment is the target. Large outer segments show who the lesson didn't fit.</p>
        <p class="sub-h">Challenge</p>
        ${legendHTML([["var(--div-lo)", "Too easy"], ["var(--div-mid)", "Just right"], ["var(--div-hi)", "Too hard"]])}
        <div class="chart">${stackBar([{ label: "Too easy", v: ch[0], color: "var(--div-lo)", ink: "#fff" }, { label: "Just right", v: ch[1], color: "var(--div-mid)", ink: "var(--ink)" }, { label: "Too hard", v: ch[2], color: "var(--div-hi)", ink: "#fff" }], n, "Challenge responses", "Challenge")}</div>
        <p class="sub-h">Pace</p>
        ${legendHTML([["var(--div-lo)", "Too slow"], ["var(--div-mid)", "Just right"], ["var(--div-hi)", "Too fast"]])}
        <div class="chart">${stackBar([{ label: "Too slow", v: pa[0], color: "var(--div-lo)", ink: "#fff" }, { label: "Just right", v: pa[1], color: "var(--div-mid)", ink: "var(--ink)" }, { label: "Too fast", v: pa[2], color: "var(--div-hi)", ink: "#fff" }], n, "Pace responses", "Pace")}</div>
      </section>
    </div>
    <div class="two-col">
      <section class="card">
        <div class="card-head"><h2>Suggested next steps</h2></div>
        <p class="card-sub">Generated from this lesson's weakest indicators, each linked to a What Works Best practice.</p>
        <ul class="steps">${nextSteps(stats, resp).map(s => `<li><b>${esc(s.t)}</b><p>${esc(s.d)}</p><small>${esc(s.src)}</small></li>`).join("")}</ul>
      </section>
      <section class="card">
        <div class="card-head"><h2>Still unsure about…</h2></div>
        <p class="card-sub">Students' own words, grouped. Use the most common one as tomorrow's starter question.</p>
        ${unsure.length ? `<ul class="unsure">${unsure.slice(0, 8).map(u => `<li><span class="count">×${u.count}</span><span>${esc(u.text)}</span></li>`).join("")}</ul>` : hidden ? "" : `<p class="card-sub">No students added a comment.</p>`}
        ${hidden ? `<p class="card-sub">${hidden} comment${hidden === 1 ? " was" : "s were"} hidden for inappropriate language.</p>` : ""}
      </section>
    </div>`;
  }

  return `<main class="page${id === DEMO_ID ? " full" : ""}">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Classes</a><span>/</span><a href="#/class/${esc(l.classId)}">${esc(c.name)}</a><span>/</span><span>${esc(l.title)}</span></nav>
    <div class="page-head"><div>
      <h1>${esc(l.title)}</h1>
      <p class="sub">${esc(c.name)} · Year ${esc(c.yearLevel)} · ${esc(c.subject)} · ${fmtDate(l.createdAtMs)}${id === DEMO_ID ? `<span class="tag gold">Live demo</span>` : ""}</p>
      ${l.intention ? `<div class="intent"><span>Learning intention</span>${esc(l.intention)}</div>` : ""}
    </div></div>
    ${share}
    ${body}
    ${aboutIndicators()}
    <div><button class="btn danger-ghost sm" data-act="delete-ticket" data-id="${esc(id)}">Delete this exit ticket</button></div>
  </main>`;
}

/* ------------------------------------------------------------------
   LANGUAGE FILTER for the free-text answer. Checked when a student
   submits (they're asked to rephrase) and again when comments are shown,
   so nothing offensive reaches the dashboard or a projector even if it
   was sent some other way. Matching ignores case, accents, l33t spelling
   (sh1t, a$$), stretched letters (fuuuck) and spaced-out letters (f u c k).
   ------------------------------------------------------------------ */
// Blocked anywhere, even inside another word ("bullshit").
const BAD_ANYWHERE = ["fuck", "shit", "bitch"];
// Blocked at the start of a word, so any ending is caught ("wankers").
const BAD_PREFIX = ["cunt", "nigg", "wank", "twat", "slut", "whore", "bastard", "bollock", "porn", "piss", "dickhead",
  "asshole", "arsehole", "dildo", "jizz", "faggot", "bellend", "skank", "pussy"];
// Blocked only as whole words, because they hide inside innocent ones ("class", "Dickens", "grape").
const BAD_WORD = ["ass", "arse", "dick", "dicks", "cock", "cocks", "prick", "pricks", "tit", "tits", "titties",
  "cum", "fag", "fags", "rape", "raped", "raping", "retard", "retards", "retarded", "crap", "crappy",
  "fuk", "fck", "fk", "fkn", "fking", "fcking", "kys", "stfu", "wtf"];
// Each letter may repeat ("fuuuck"); a doubled letter needs at least two ("ass" but not "as").
const stretchy = w => w.match(/(.)\1*/g).map(run => run[0] + (run.length > 1 ? `{${run.length},}` : "+")).join("");
const BAD_RE = new RegExp([
  ...BAD_ANYWHERE.map(stretchy),
  ...BAD_PREFIX.map(w => "\\b" + stretchy(w)),
  ...BAD_WORD.map(w => "\\b" + stretchy(w) + "\\b")
].join("|"));
// Innocent words that contain a blocked one; removed before checking.
const NOT_BAD = /\b(?:shi+take|matsushita|pissarro|pussycats?|pussy ?willows?)\b/g;
const LEET = { "0": "o", "1": "i", "!": "i", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t" };
function hasBadLanguage(text) {
  const plain = String(text || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(NOT_BAD, " ");
  // Checked with and without l33t swaps, so "a$$" is caught but "crap!" still ends at "p".
  return [plain, plain.replace(/[0-9!@$]/g, c => LEET[c] || c)].some(t =>
    BAD_RE.test(t.replace(/\b[a-z]\b(?:[^a-z]{1,3}[a-z]\b)+/g, m => m.replace(/[^a-z]/g, ""))));
}

function groupUnsure(resp) {
  const m = new Map();
  resp.forEach(r => {
    const t = (r.unsure || "").trim();
    if (!t || hasBadLanguage(t)) return;
    const k = t.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
    if (!m.has(k)) m.set(k, { text: t, count: 0 });
    m.get(k).count++;
  });
  return [...m.values()].sort((a, b) => b.count - a.count);
}
function nextSteps(stats, resp) {
  const n = resp.length, out = [];
  const pr = dist(resp, "prior", 4), ch = dist(resp, "challenge", 3), pa = dist(resp, "pace", 3);
  const knewP = pct(pr[3], n), newP = pct(pr[0], n);
  if (newP >= 20 && knewP >= 20) out.push({ t: "Plan for the readiness spread", d: `${knewP}% already knew most of this and ${newP}% found it all new. Start next lesson with a tiered task so both groups work at the right level.`, src: "WWB 2025 · Using data to inform practice (baseline data)" });
  const tips = {
    clarity: { t: "Make the goal and success criteria explicit", d: "Share the learning intention at the start, show an example of good work, and revisit both at the end of the lesson.", src: "WWB 2025 · Assessment, Explicit teaching" },
    explain: { t: "Strengthen the modelling", d: "Use a worked example, then a guided \"we do\" step before students practise on their own.", src: "WWB 2025 · Explicit teaching" },
    understand: { t: "Re-check understanding next lesson", d: "Open with a short retrieval quiz or hinge question on today's key idea, and re-teach where it breaks down.", src: "WWB 2025 · Assessment" },
    growth: { t: "Make sure learning moved forward", d: knewP >= 30 ? "Many students already knew this content. Pre-test the next topic so they can move on sooner." : "Break the next lesson into smaller steps, with a quick check after each one.", src: "WWB 2025 · Using data to inform practice" },
    feedback: { t: "Build feedback into practice time", d: "Mini whiteboards, cold-call checks or brief written comments give students something to act on before the lesson ends.", src: "WWB 2025 · Effective feedback" },
    relevance: { t: "Show why the learning matters", d: "Link today's content to a real-world use, or to where it leads next in the syllabus.", src: "QTR student survey · Relevance" },
    challenge: ch[0] >= ch[2]
      ? { t: "Raise the challenge", d: `${pct(ch[0], n)}% found the work too easy. Add an extension task that stretches students who are ready.`, src: "WWB 2025 · High expectations" }
      : { t: "Add scaffolding", d: `${pct(ch[2], n)}% found the work too hard. Add a worked example or sentence starters before independent practice.`, src: "WWB 2025 · High expectations" },
    pace: pa[2] >= pa[0]
      ? { t: "Slow down at key steps", d: `${pct(pa[2], n)}% found the pace too fast. Pause for a quick check before moving to each new step.`, src: "WWB 2025 · Explicit teaching" }
      : { t: "Pick up the pace", d: `${pct(pa[0], n)}% found it too slow. Trim repeated explanation for students who are ready to move on.`, src: "WWB 2025 · Explicit teaching" }
  };
  stats.filter(s => s.status === "act" || s.status === "monitor").sort((a, b) => a.pct - b.pct).forEach(s => out.push(tips[s.key]));
  if (!out.length) out.push({ t: "Everything is on track", d: `Every indicator is at ${ON_TRACK}% or above. Note what you did in this lesson so you, or a colleague, can repeat it.`, src: "WWB 2025 · Collaboration" });
  return out.slice(0, 4);
}
function aboutIndicators() {
  return `<details class="card about" style="padding:18px 22px">
    <summary>About these indicators: the evidence behind each question</summary>
    <p class="card-sub" style="margin-top:10px">Each indicator is the percentage of students responding positively ("Mostly" or "Definitely", or "Just right" for challenge and pace). Tracking the percentage of positive responses over time mirrors the analysis method of the Department's Quality Teaching Rounds surveys. Thresholds: on track ${ON_TRACK}%+, monitor ${MONITOR}–${ON_TRACK - 1}%, act below ${MONITOR}%.</p>
    <div class="scroll-x"><table class="dv">
      <thead><tr><th>Indicator</th><th>What students are asked</th><th>Evidence base</th></tr></thead>
      <tbody>${MEASURES.map(m => `<tr><td><b>${esc(m.label)}</b></td><td>${esc(QUESTIONS.find(q => q.key === m.key).text)}</td><td>${esc(m.src)}</td></tr>`).join("")}
      <tr><td><b>Readiness spread</b></td><td>How much of today's content did you already know?</td><td>WWB 2025 · Using data to inform practice: baseline data (Goss et al. 2015)</td></tr></tbody>
    </table></div>
  </details>`;
}
function projectorModal() {
  const id = S.ui.projector;
  const l = id && S.data.lessons[id];
  if (!l) return "";
  const url = ticketUrl(id), n = respOf(id).length;
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="Exit ticket QR code">
    <div class="modal-box">
      <button class="btn ghost sm modal-close" data-act="projector-close">Close</button>
      <p class="eyebrow">Exit ticket · ${esc(l.className || "")}</p>
      <h2>${esc(l.title)}</h2>
      <div class="qr">${qrSvg(url)}</div>
      <p class="m-url">${esc(url)}</p>
      <div class="m-count">${isOpen(l) ? `<span class="live-chip">Open</span><span>${n} response${n === 1 ? "" : "s"} so far · closes in <span data-countdown="${l.expiresAtMs}">${fmtLeft(l.expiresAtMs - Date.now())}</span></span>` : `<span class="closed-chip">Closed</span>`}</div>
    </div>
  </div>`;
}

/* ---------------- COMPARE: NEW vs OLD SYLLABUS ---------------- */
function compareView() {
  const classes = Object.values(S.data.classes);
  const years = [...new Set(classes.map(c => String(c.yearLevel)))].sort((a, b) => a - b);
  const subjects = [...new Set(classes.map(c => c.subject))].sort();
  const fy = S.ui.cmpYear, fs = S.ui.cmpSubject;
  const g = { new: { classes: [], tickets: 0, resp: [] }, old: { classes: [], tickets: 0, resp: [] } };
  classes.filter(c => (fy === "all" || String(c.yearLevel) === fy) && (fs === "all" || c.subject === fs)).forEach(c => {
    const grp = g[c.syllabus === "old" ? "old" : "new"];
    grp.classes.push(c);
    lessonsOf(c.id).forEach(l => { grp.tickets++; grp.resp.push(...respOf(l.id)); });
  });
  const sNew = measureStats(g.new.resp), sOld = measureStats(g.old.resp);
  const avg = st => st[0].n ? Math.round(st.reduce((a, s) => a + s.pct, 0) / st.length) : null;
  const both = g.new.resp.length && g.old.resp.length;

  const filters = `<div class="filter-row">
    <label class="fld"><span>Year level</span><select id="cmp-year" data-change="cmp-year"><option value="all">All years</option>${years.map(y => `<option value="${esc(y)}" ${fy === y ? "selected" : ""}>Year ${esc(y)}</option>`).join("")}</select></label>
    <label class="fld"><span>Subject</span><select id="cmp-subject" data-change="cmp-subject"><option value="all">All subjects</option>${subjects.map(s => `<option value="${esc(s)}" ${fs === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></label>
  </div>`;

  const tile = (k, st, grp) => {
    const a = avg(st);
    return `<div class="cmp-tile card">
      <div><span class="syl-pill ${k}">${k === "new" ? "New syllabus" : "Old syllabus"}</span><div class="lbl" style="margin-top:10px">Average positive response</div></div>
      <div class="big">${a === null ? "–" : a}<small>${a === null ? "" : "%"}</small></div>
      <div class="counts"><span>${plural(grp.classes.length, "class", "classes").replace(/^(\d+)/, "<b>$1</b>")}</span><span>${plural(grp.tickets, "exit ticket", "exit tickets").replace(/^(\d+)/, "<b>$1</b>")}</span><span>${plural(grp.resp.length, "response", "responses").replace(/^(\d+)/, "<b>$1</b>")}</span></div>
    </div>`;
  };

  let main;
  if (!both) {
    main = `<section class="card empty">
      <h2>Not enough data to compare yet</h2>
      <p>The comparison needs responses from at least one new-syllabus class and one old-syllabus class${fy !== "all" || fs !== "all" ? " matching these filters" : ""}. ${classes.some(c => c.sample) ? "" : "You can load sample classes to see how it works."}</p>
      <div class="row">${classes.some(c => c.sample) ? "" : `<button class="btn ghost" data-act="seed" ${S.ui.busy ? "disabled" : ""}>Load sample classes</button>`}<a class="btn primary" href="#/">Go to your classes</a></div>
    </section>`;
  } else {
    const rows = MEASURES.map((m, i) => ({ label: m.label, a: sNew[i], b: sOld[i] }));
    const pN = dist(g.new.resp, "prior", 4), pO = dist(g.old.resp, "prior", 4);
    const small = g.new.resp.length < 30 || g.old.resp.length < 30;
    const classRows = [...g.new.classes, ...g.old.classes].map(c => {
      const ls = lessonsOf(c.id), r = ls.flatMap(l => respOf(l.id)), st = measureStats(r);
      return `<tr><td><a href="#/class/${esc(c.id)}"><b>${esc(c.name)}</b></a>${c.sample ? ` <span class="tag">Sample</span>` : ""}</td><td>Year ${esc(c.yearLevel)}</td><td>${esc(c.subject)}</td><td><span class="syl-pill ${c.syllabus === "old" ? "old" : "new"}">${c.syllabus === "old" ? "Old" : "New"}</span></td><td class="num">${ls.length}</td><td class="num">${r.length}</td><td class="num">${r.length ? onTrackCount(st) + " / 8" : "–"}</td></tr>`;
    }).join("");
    main = `
    <section class="card">
      <div class="card-head"><h2>Indicators: new vs old syllabus</h2><button class="toggle" data-act="cmp-table">${S.ui.cmpTable ? "Show chart" : "Show table"}</button></div>
      <p class="card-sub">Percentage of positive student responses for each indicator, pooled across every class in each group.${small ? " <b>Small sample:</b> fewer than 30 responses on one side, so treat differences with caution." : ""}</p>
      ${S.ui.cmpTable ? `<div class="scroll-x"><table class="dv"><thead><tr><th>Indicator</th><th class="num">New syllabus</th><th class="num">Old syllabus</th><th class="num">Difference</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td><b>${esc(r.label)}</b></td><td class="num">${r.a.pct}% <small>(${r.a.pos}/${r.a.n})</small></td><td class="num">${r.b.pct}% <small>(${r.b.pos}/${r.b.n})</small></td><td class="num">${r.a.pct - r.b.pct > 0 ? "+" : ""}${r.a.pct - r.b.pct} pts</td></tr>`).join("")}
      </tbody></table></div>`
      : `${legendHTML([["var(--new)", "New syllabus"], ["var(--old)", "Old syllabus"]])}<div class="chart scroll-x"><div style="min-width:620px">${groupedBars(rows)}</div></div>`}
    </section>
    <section class="card">
      <div class="card-head"><h2>Readiness spread: new vs old syllabus</h2></div>
      <p class="card-sub">How much of each lesson's content students already knew. If new-syllabus content overlaps less with what students learned in primary school, the "All new" share grows.</p>
      ${legendHTML(readinessSegs([0, 0, 0, 0]).map(s => [s.color, s.label]))}
      <p class="sub-h">New syllabus · ${g.new.resp.length} responses</p>
      <div class="chart">${stackBar(readinessSegs(pN), g.new.resp.length, "Prior knowledge, new syllabus", "New syllabus")}</div>
      <p class="sub-h">Old syllabus · ${g.old.resp.length} responses</p>
      <div class="chart">${stackBar(readinessSegs(pO), g.old.resp.length, "Prior knowledge, old syllabus", "Old syllabus")}</div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Classes in this comparison</h2></div>
      <div class="scroll-x"><table class="dv"><thead><tr><th>Class</th><th>Year</th><th>Subject</th><th>Syllabus</th><th class="num">Exit tickets</th><th class="num">Responses</th><th class="num">On track (all lessons)</th></tr></thead><tbody>${classRows}</tbody></table></div>
    </section>
    <p class="caveat"><b>Reading this fairly:</b> differences are prompts for a professional conversation, not verdicts. Classes, topics, timing and teachers also differ between the groups. Look for patterns that hold across several classes, and check them against other evidence such as student work and assessment results, as What Works Best recommends.</p>`;
  }

  return `<main class="page">
    <div class="page-head"><div><h1>New vs old syllabus</h1><p class="sub">Compare student responses from every class you teach under the new syllabus against every class under the old one.</p></div></div>
    ${filters}
    <div class="cmp-tiles">${tile("new", sNew, g.new)}${tile("old", sOld, g.old)}</div>
    ${main}
  </main>`;
}

function notFound(msg) {
  return `<main class="page"><section class="card empty"><h2>Not found</h2><p>${esc(msg)}</p><div class="row"><a class="btn primary" href="#/">Back to your classes</a></div></section></main>`;
}

/* ==================================================================
   TEACHER EVENTS
   ================================================================== */
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const act = b.dataset.act;
  if (act === "authtab") { S.ui.authTab = b.dataset.tab; S.ui.authErr = ""; render(); return; }
  if (act === "reset") {
    const email = ($("#a-email") || {}).value || "";
    if (!email.trim()) { S.ui.authErr = "Type your email above first, then press Forgot password."; render(); return; }
    try { await backend.resetPassword(email); toast("Password reset email sent"); } catch (err) { S.ui.authErr = authMessage(err); render(); }
    return;
  }
  if (act === "signout") { await backend.signOut(); location.hash = "#/"; return; }
  if (act === "new-class") { S.ui.newClass = true; render(); setTimeout(() => { const el = $("#c-name"); el && el.focus(); }, 0); return; }
  if (act === "cancel-class") { S.ui.newClass = false; render(); return; }
  if (act === "new-ticket") { S.ui.newTicket = true; render(); setTimeout(() => { const el = $("#t-title"); el && el.focus(); }, 0); return; }
  if (act === "cancel-ticket") { S.ui.newTicket = false; render(); return; }
  if (act === "copy") {
    const url = b.dataset.url;
    try { await navigator.clipboard.writeText(url); toast("Link copied"); }
    catch (err) { const el = $("#share-url"); if (el) { el.select(); } toast("Press Ctrl+C (or ⌘C) to copy the selected link"); }
    return;
  }
  if (act === "projector") { S.ui.projector = b.dataset.id; render(); return; }
  if (act === "projector-close") { S.ui.projector = null; render(); return; }
  if (act === "close-ticket") {
    if (!confirm("Close this exit ticket now? Students will no longer be able to respond.")) return;
    try { await backend.closeLesson(b.dataset.id); toast("Exit ticket closed"); } catch (err) { toast("Couldn't close it. Check your connection and try again."); }
    return;
  }
  if (act === "delete-ticket") {
    const l = S.data.lessons[b.dataset.id];
    if (!l || !confirm(`Delete the exit ticket "${l.title}" and all of its responses? This can't be undone.`)) return;
    location.hash = `#/class/${l.classId}`;
    try { await backend.deleteLesson(l.id); toast("Exit ticket deleted"); }
    catch (err) { toast("Couldn't delete the exit ticket. Try again."); }
    return;
  }
  if (act === "delete-class") {
    const c = S.data.classes[b.dataset.id];
    if (!c || !confirm(`Delete ${c.name} and all of its exit tickets and responses? This can't be undone.`)) return;
    try { await backend.deleteClass(c.id, lessonsOf(c.id).map(l => l.id)); location.hash = "#/"; toast(`${c.name} deleted`); }
    catch (err) { toast("Couldn't delete the class. Try again."); }
    return;
  }
  if (act === "seed") {
    if (S.ui.busy) return;
    S.ui.busy = true; render(); toast("Adding sample classes…");
    try { await seedSample(backend, S.user.uid); toast("Sample classes added"); }
    catch (err) { console.error(err); toast("Couldn't add the sample classes. Try again."); }
    S.ui.busy = false; render();
    return;
  }
  if (act === "cmp-table") { S.ui.cmpTable = !S.ui.cmpTable; render(); return; }
});
document.addEventListener("change", e => {
  const k = e.target.dataset && e.target.dataset.change;
  if (k === "cmp-year") { S.ui.cmpYear = e.target.value; render(); }
  if (k === "cmp-subject") { S.ui.cmpSubject = e.target.value; render(); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && S.ui.projector) { S.ui.projector = null; render(); } });

document.addEventListener("submit", async e => {
  const f = e.target;
  if (!["f-auth", "f-class", "f-ticket"].includes(f.id)) return;
  e.preventDefault();
  if (f.id === "f-auth") {
    const up = S.ui.authTab === "signup";
    const email = $("#a-email").value, pw = $("#a-pw").value;
    const name = up ? $("#a-name").value.trim() : "", school = up ? $("#a-school").value.trim() : "";
    if (up && !name) { S.ui.authErr = "Add your name so it appears on your dashboard."; render(); return; }
    if (!email.trim() || !pw) { S.ui.authErr = "Enter your email and password."; render(); return; }
    S.ui.busy = true; S.ui.authErr = ""; render();
    try {
      if (up) { await backend.signUp({ name, school, email, password: pw }); if (S.user) { S.user.name = name; S.user.school = school; } }
      else await backend.signIn(email, pw);
    } catch (err) { S.ui.authErr = authMessage(err); }
    S.ui.busy = false; render();
    return;
  }
  if (f.id === "f-class") {
    const name = $("#c-name").value.trim(), subject = $("#c-subject").value.trim(), yearLevel = $("#c-year").value;
    const syllabus = $("#c-syl-old").checked ? "old" : "new";
    if (!name || !subject) { $("#c-err").textContent = "Add a class name and a subject."; return; }
    try {
      const id = await backend.createClass(S.user.uid, { name, yearLevel, subject, syllabus });
      S.ui.newClass = false; location.hash = `#/class/${id}`; toast(`${name} created`); render();
    } catch (err) { $("#c-err").textContent = "Couldn't save the class. Check your connection and try again."; }
    return;
  }
  if (f.id === "f-ticket") {
    const r = route(), c = S.data.classes[r.id];
    const title = $("#t-title").value.trim(), intention = $("#t-intent").value.trim();
    if (!title) { $("#t-err").textContent = "Give the lesson a title so you can find it later."; return; }
    const asDemo = !!($("#t-demo") && $("#t-demo").checked), prev = asDemo && S.data.lessons[DEMO_ID];
    if (prev && !confirm(`Replace the current demo ticket "${prev.title}"? Its ${respOf(DEMO_ID).length} responses will be deleted. This can't be undone.`)) return;
    try {
      if (prev) await backend.deleteLesson(DEMO_ID);
      const id = await backend.createLesson(S.user.uid, { classId: c.id, title, intention, className: c.name, yearLevel: c.yearLevel, subject: c.subject }, asDemo ? { id: DEMO_ID } : {});
      S.ui.newTicket = false; location.hash = `#/lesson/${id}`; toast(asDemo ? "Live demo ticket created. The pamphlet QR code now opens it." : "Exit ticket created. Share the link or QR code."); render();
    } catch (err) {
      $("#t-err").textContent = asDemo
        ? "Couldn't make this the demo ticket. If the current demo ticket belongs to another account, delete it from that account first."
        : "Couldn't create the exit ticket. Check your connection and try again.";
    }
  }
});

function tickCountdowns() {
  let expired = false;
  document.querySelectorAll("[data-countdown]").forEach(el => {
    const left = Number(el.dataset.countdown) - Date.now();
    if (left <= 0) expired = true;
    el.textContent = fmtLeft(left);
  });
  if (expired) render();
}

function teacherBoot() {
  backend.onAuth(u => {
    S.authReady = true;
    if (S.unwatch) { S.unwatch(); S.unwatch = null; }
    S.user = u;
    S.data = { classes: {}, lessons: {}, responses: {} };
    if (u) {
      S.unwatch = backend.watchTeacherData(u.uid, d => { S.data = d; scheduleRender(); },
        () => toast("Lost the connection to your data. Reload the page."));
    }
    render();
  });
  window.addEventListener("hashchange", () => { S.ui.newClass = false; S.ui.newTicket = false; S.ui.projector = null; render(); window.scrollTo(0, 0); });
  setInterval(tickCountdowns, 20000);
}

/* ==================================================================
   STUDENT EXIT TICKET  (?t=<ticket id>)
   ================================================================== */
async function studentBoot(id) {
  const app = $("#app");
  const shell = inner => `<div class="stu"><div class="stu-top">${LOGO}<span>Lesson Pulse</span><span class="anon">Anonymous exit ticket</span></div>${inner}</div>`;
  const msg = (icon, cls, h, p) => shell(`<section class="card stu-msg"><div class="big ${cls}" aria-hidden="true">${icon}</div><h1>${h}</h1><p>${p}</p></section>`);
  const closedMsg = () => msg("⏱", "no", "This exit ticket has closed", `Exit tickets accept responses for ${TICKET_HOURS} hours after your teacher creates them. Ask your teacher for a new link.`);
  const isDemo = id === DEMO_ID;
  const demoMsg = () => msg("⏱", "no", "The live demo isn't open right now", "It opens during the Lesson Pulse session. Scan this code again then.");

  let res;
  try { res = await backend.getLessonPublic(id); }
  catch (e) { app.innerHTML = msg("!", "no", "Couldn't load the exit ticket", "Check your internet connection, then reload this page."); return; }
  if (res.status === "missing" && backend.mode === "demo" && !isDemo) {
    app.innerHTML = msg("!", "no", "This page is in demo mode", "Demo mode only works in the one browser where the exit ticket was created, so this device can't open it. Your teacher needs to put the Firebase-connected version online.");
    return;
  }
  if (res.status !== "open") { app.innerHTML = isDemo ? demoMsg() : closedMsg(); return; }
  // The demo ID is reused every session, so remember which demo ticket was answered.
  const doneKey = "lp3-done-" + id + (isDemo ? "-" + res.lesson.expiresAtMs : "");
  let done = false;
  try { done = localStorage.getItem(doneKey) === "1"; } catch (e) { /* storage blocked */ }
  if (done) { app.innerHTML = msg("✓", "ok", "You've already answered", "Thanks! Your response to this exit ticket is already in."); return; }

  const L = res.lesson;
  const qs = QUESTIONS.map((q, i) => {
    if (q.type === "text") return `<fieldset class="q"><legend><span class="qn">${i + 1}</span><span>${esc(q.text)}<small>${esc(q.hint)}</small></span></legend>
      <textarea id="s-unsure" maxlength="280" placeholder="e.g. I get confused when the fraction is bigger than 1"></textarea></fieldset>`;
    const opts = q.type === "agree" ? AGREE : q.options;
    return `<fieldset class="q" data-q="${q.key}"><legend><span class="qn">${i + 1}</span><span>${esc(q.text)}${q.hint ? `<small>${esc(q.hint)}</small>` : ""}</span></legend>
      <div class="opts ${opts.length === 4 ? "four" : "three"}">${opts.map((o, k) => `<label class="opt"><input type="radio" name="${q.key}" value="${k + 1}"><span>${esc(o)}</span></label>`).join("")}</div></fieldset>`;
  }).join("");

  app.innerHTML = shell(`<section class="card stu-intro">
      <p class="eyebrow">${esc(L.className)}${L.yearLevel ? ` · Year ${esc(L.yearLevel)}` : ""}${L.subject ? ` · ${esc(L.subject)}` : ""}</p>
      <h1>${esc(L.title)}</h1>
      ${L.intention ? `<div class="intent"><span>Today's learning intention</span>${esc(L.intention)}</div>` : ""}
      <p class="note">Answer honestly. Your teacher uses this to improve their lessons, and your name isn't recorded. Takes about a minute.</p>
    </section>
    <form id="f-stu" novalidate>${qs}
      <div class="stu-submit"><p class="err-msg" id="s-err" role="alert"></p><button class="btn primary wide" type="submit">Send my answers</button></div>
    </form>`);

  $("#f-stu").addEventListener("change", e => { const fs = e.target.closest("fieldset.q"); if (fs) fs.classList.remove("missing"); });
  $("#f-stu").addEventListener("submit", async e => {
    e.preventDefault();
    const r = {}; const missing = [];
    REQUIRED_KEYS.forEach(k => {
      const el = document.querySelector(`input[name="${k}"]:checked`);
      if (el) r[k] = Number(el.value); else missing.push(k);
    });
    document.querySelectorAll("fieldset.q").forEach(fs => fs.classList.toggle("missing", missing.includes(fs.dataset.q)));
    if (missing.length) {
      $("#s-err").textContent = `Answer the ${missing.length} highlighted question${missing.length === 1 ? "" : "s"} first.`;
      const first = document.querySelector(`fieldset.q[data-q="${missing[0]}"]`);
      first && first.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    r.unsure = $("#s-unsure").value.trim().slice(0, 280);
    if (hasBadLanguage(r.unsure)) {
      const fs = $("#s-unsure").closest("fieldset");
      fs.classList.add("missing");
      fs.scrollIntoView({ behavior: "smooth", block: "center" });
      $("#s-err").textContent = "Please rephrase your last answer without that language, or leave it blank.";
      return;
    }
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Sending…";
    try {
      await backend.submitResponse(id, r);
      try { localStorage.setItem(doneKey, "1"); } catch (err) { /* storage blocked */ }
      app.innerHTML = msg("✓", "ok", "Thanks, your answers are in", "Your teacher will use the class's responses to plan the next lesson.");
      window.scrollTo(0, 0);
    } catch (err) {
      if (err && err.code === "permission-denied") { app.innerHTML = closedMsg(); return; }
      btn.disabled = false; btn.textContent = "Send my answers";
      $("#s-err").textContent = "Your answers didn't send. Check your connection and press Send again.";
    }
  });
}

/* ==================================================================
   RESPONSE SIMULATOR  (?t=demoauto) — a presenter tool. Once started it
   sends a made-up student response to the live demo ticket every 5–10
   seconds, so the dashboard fills up on screen while you present.
   ================================================================== */
const SIM_COMMENTS = ["When to use this method", "How to set out my working", "The last example",
  "Why my answer was different", "The difference between the two methods", "What the question was asking"];
function simulatedResponse(rnd) {
  const r = {};
  REQUIRED_KEYS.forEach(k => { r[k] = 1 + wpick(rnd, SAMPLE_W.new[k]); });
  // Weighted so some comments repeat and group together on the dashboard.
  r.unsure = rnd() < 0.35 ? SIM_COMMENTS[wpick(rnd, [5, 4, 3, 2, 2, 1])] : "";
  return r;
}
async function simulatorBoot() {
  const app = $("#app"), rnd = mulberry32(Date.now() & 0x7fffffff);
  // Legacy ?t=demoauto keeps targeting the pamphlet demo. Ticket dashboard
  // links select their exact lesson and preserve sample/live storage.
  const lessonId = QUERY.get("lesson") || DEMO_ID;
  let running = false, sent = 0, gen = 0, nextAt = 0, lock = null, ticker = null;
  // Timers in a worker keep a 5–10 s pace in a background tab, where the
  // page's own timers can be slowed to once a minute.
  try { ticker = new Worker(URL.createObjectURL(new Blob(["onmessage = e => setTimeout(() => postMessage(e.data.gen), e.data.ms);"], { type: "text/javascript" }))); }
  catch (e) { /* workers unavailable: use page timers */ }
  if (ticker) ticker.onmessage = e => tick(e.data);
  const wait = (ms, g) => ticker ? ticker.postMessage({ ms, gen: g }) : setTimeout(() => tick(g), ms);

  const shell = inner => `<main class="page sim"><section class="card"><p class="eyebrow">Presenter tool</p><h1>Simulate live responses</h1>${inner}</section></main>`;
  const max = () => Math.min(200, Math.max(1, parseInt($("#sim-max").value, 10) || 30));
  const status = msg => {
    const el = $("#sim-status");
    if (el) el.textContent = msg || (running ? `Sent ${sent} of ${max()} · next in ${Math.max(0, Math.ceil((nextAt - Date.now()) / 1000))}s` : `Sent ${sent}.`);
  };

  async function keepAwake(on) {
    try {
      if (on && !lock && navigator.wakeLock) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); }
      if (!on && lock) { await lock.release(); lock = null; }
    } catch (e) { /* wake lock unsupported or refused */ }
  }
  function schedule() { const ms = 5000 + rnd() * 5000; nextAt = Date.now() + ms; wait(ms, ++gen); status(); }
  function start() {
    if (sent >= max()) sent = 0;
    running = true; $("#sim-go").textContent = "Pause"; keepAwake(true); schedule();
  }
  function stop(msg) {
    running = false; gen++; keepAwake(false);
    $("#sim-go").textContent = sent >= max() ? "Start again" : sent ? "Resume" : "Start";
    status(msg);
  }
  async function tick(g) {
    if (!running || g !== gen) return;
    try { await backend.submitResponse(lessonId, simulatedResponse(rnd)); sent++; }
    catch (e) {
      if (e && e.code === "permission-denied") { stop("Sending was denied. The ticket may have closed, or database permissions may be blocking responses."); return; }
      /* connection hiccup: try again on the next beat */
    }
    if (!running || g !== gen) return; // paused while sending
    if (sent >= max()) stop(`Done: sent ${sent} responses.`); else schedule();
  }

  async function load() {
    app.innerHTML = shell(`<p class="card-sub">Checking the live demo ticket…</p>`);
    let res;
    try { res = await backend.getLessonPublic(lessonId); } catch (e) { res = { status: "error" }; }
    if (res.status !== "open") {
      const message = res.status === "error"
        ? "Couldn't reach the ticket. Check your connection."
        : res.status === "unavailable"
        ? "The database denied access to this ticket. It may have expired, or database permissions may be blocking access."
        : res.status === "closed"
        ? "This ticket has closed. Open a new ticket and use its Simulate responses link."
        : "The selected ticket doesn't exist in this dashboard's data.";
      app.innerHTML = shell(`<p class="card-sub">${message}</p>
        <p class="card-sub">Open your ticket in the <a href="${esc(new URL(SAMPLE_MODE ? "teacher-sample/" : "teacher/", APP_URL).href)}">teacher dashboard</a> and choose <b>Simulate responses</b>. The original autodemo link only targets a ticket created with <b>Use as the live demo ticket</b> ticked.</p>
        <div><button class="btn primary" id="sim-retry">Check again</button></div>`);
      $("#sim-retry").onclick = load;
      return;
    }
    app.innerHTML = shell(`
      <p class="card-sub">Sends a made-up student response to the selected ticket every 5–10 seconds, so its dashboard fills up while you present. These responses are saved in the ticket's results. Keep this page open, ideally in its own window.</p>
      <div class="sim-target">Sending to <b>${esc(res.lesson.title)}</b><span class="live-chip">Open</span></div>
      <div class="sim-row">
        <label class="fld"><span>Stop after</span><input id="sim-max" type="number" min="1" max="200" value="30"></label>
        <button class="btn primary" id="sim-go">Start</button>
      </div>
      <p class="sim-status" id="sim-status" role="status">Not started.</p>`);
    $("#sim-go").onclick = () => running ? stop("Paused.") : start();
  }

  setInterval(() => { if (running) status(); }, 1000);
  document.addEventListener("visibilitychange", () => { if (running && document.visibilityState === "visible") keepAwake(true); });
  load();
}

/* ==================================================================
   SAMPLE DASHBOARD  (?sample) — signs in as a sample teacher, creating
   the account and its sample classes on the first visit.
   ================================================================== */
async function openSample() {
  const email = "sample-teacher@lessonpulse.demo", password = "sample-dashboard";
  try { await backend.signIn(email, password); }
  catch (e) {
    const uid = await backend.signUp({ name: "Sample Teacher", school: "", email, password });
    await seedSample(backend, uid);
  }
}

/* ==================================================================
   BOOT
   ================================================================== */
(async function boot() {
  // The default link opens the public preview. Keep root student and
  // simulator links working; /teacher is the real teacher sign-in.
  const entryPath = location.pathname.replace(/\/index\.html$/, "/").replace(/\/$/, "");
  const rootPath = new URL(APP_URL).pathname.replace(/\/$/, "");
  if (entryPath === rootPath && !QUERY.get("t")) {
    const target = new URL("teacher-sample/", APP_URL);
    target.search = location.search;
    target.hash = location.hash;
    location.replace(target.href);
    return;
  }
  try {
    backend = FIREBASE_CONFIG && !LOCAL_DEMO && !SAMPLE_MODE
      ? await makeFirebaseBackend(FIREBASE_CONFIG)
      : makeDemoBackend(SAMPLE_MODE ? "lp3-sample" : undefined);
  }
  catch (e) {
    console.error(e);
    $("#app").innerHTML = `<main class="page"><section class="card empty"><h2>Couldn't connect to the database</h2><p>Check your internet connection and the Firebase settings at the top of this file, then reload.</p></section></main>`;
    return;
  }
  const t = QUERY.get("t");
  if (t === "demoauto" || t === "autodemo") simulatorBoot();
  else if (t) studentBoot(t);
  else { if (SAMPLE_MODE) await openSample(); teacherBoot(); }
})();

