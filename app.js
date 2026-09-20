/* ===== Default Data ===== */
const defaultData = {
    cbfs: {
        name: 'CBFS',
        icon: '🏢',
        headings: {
            'q3-audit': {
                name: 'Q3 Audit',
                tasks: [
                    { id: 1, name: 'إنهاء التقرير المالي', deadline: '2026-09-30', estimate: 8, priority: 'high', completed: false, subtasks: [
                        { name: 'تجميع البيانات', completed: true },
                        { name: 'التحليل المالي', completed: false }
                    ] }
                ]
            }
        }
    },
    projects: {
        name: 'المشاريع',
        icon: '💼',
        headings: {
            'pos': {
                name: 'POS Software',
                tasks: [
                    { id: 2, name: 'تصميم Database', deadline: '2026-10-01', estimate: 5, priority: 'high', completed: false, subtasks: [] }
                ]
            }
        }
    },
    study: {
        name: 'الدراسة',
        icon: '📚',
        headings: {
            'acca': {
                name: 'ACCA PM',
                tasks: [
                    { id: 3, name: 'دراسة Module 1', deadline: '2026-10-05', estimate: 4, priority: 'high', completed: false, subtasks: [] }
                ]
            }
        }
    }
};

const STORAGE_KEY = 'lifeAppData';
const USERS_KEY = 'lifeAppUsers';
const SESSION_KEY = 'lifeAppSession';
const WA_PHONE_KEY = 'lifeAppWaPhone';
const SYNC_CFG_KEY = 'lifeAppSyncConfig';
const URGENT_DAYS = 3;

/* ===== State ===== */
let data = JSON.parse(JSON.stringify(defaultData));
let notes = [];
let editingNoteId = null;
let currentUser = null;
let currentArea = null;
let currentView = 'tasks';
let currentEditTaskId = null;
let currentEditHeading = null;
let currentEditArea = null;
let currentSubtaskTaskId = null;
let currentSubtaskHeading = null;
let currentSubtaskArea = null;
let expandedSection = null;
let confirmCallback = null;
let tnCtx = null;
let tnEditId = null;
let taskIdCounter = Date.now();

/* ===== Cloud Sync (Firebase) state ===== */
let fbApp = null;
let fbAuth = null;
let fbDb = null;
let fbUser = null;
let fbUnsub = null;
let fbPushTimer = null;
let fbApplyingRemote = false;
let fbEnabled = false;
let pendingCloudPassword = null;

function getUserDataKey(username) {
    return 'lifeAppData_' + username;
}
function getUserNotesKey(username) {
    return 'lifeAppNotes_' + username;
}

function randomSalt() {
    if (window.crypto && crypto.getRandomValues) {
        const a = new Uint8Array(12);
        crypto.getRandomValues(a);
        return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function hashPassword(salt, password) {
    const str = salt + ':' + password;
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
        try {
            const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) { /* fallback below */ }
    }
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
    }
    return 'h' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

function getUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY)) || {}; }
    catch (e) { return {}; }
}

function saveUsers(users) {
    try { localStorage.setItem(USERS_KEY, JSON.stringify(users)); }
    catch (e) { console.error('Error saving users:', e); }
}

async function ensureDefaultUsers() {
    const users = getUsers();
    if (Object.keys(users).length === 0) {
        const salt = randomSalt();
        users['admin'] = { salt, hash: await hashPassword(salt, 'admin123') };
        saveUsers(users);
    }
}

function getSession() {
    try { return localStorage.getItem(SESSION_KEY); }
    catch (e) { return null; }
}
function setSession(user) {
    try { localStorage.setItem(SESSION_KEY, user); } catch (e) {}
}
function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
}

function switchAuthTab(tab) {
    document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
    document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
    document.getElementById('authTabLoginBtn').classList.toggle('active', tab === 'login');
    document.getElementById('authTabRegBtn').classList.toggle('active', tab === 'register');
}

function showAuthMsg(elId, msg, ok) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'auth-msg' + (ok ? ' ok' : ' error');
}

async function handleLogin(event) {
    event.preventDefault();
    const user = document.getElementById('loginUser').value.trim();
    const pass = document.getElementById('loginPass').value;

    if (!user || !pass) {
        showAuthMsg('loginMsg', 'أدخل اسم المستخدم وكلمة المرور');
        return false;
    }

    const users = getUsers();
    const rec = users[user];

    if (rec) {
        const h = await hashPassword(rec.salt, pass);
        if (h === rec.hash) {
            pendingCloudPassword = pass;
            setSession(user);
            await openApp(user);
            connectCloud(user, pass);
            showToast('👋 مرحباً بعودتك يا ' + user);
            return false;
        }
    }

    initFirebase();
    if (fbEnabled && fbAuth) {
        const email = getFbEmail(user);
        try {
            const logged = await fbAuth.signInWithEmailAndPassword(email, pass);
            if (logged && logged.user) {
                const salt = randomSalt();
                users[user] = { salt, hash: await hashPassword(salt, pass) };
                saveUsers(users);
                fbUser = logged.user;
                pendingCloudPassword = pass;
                setSession(user);
                await openApp(user);
                await afterCloudConnect(user);
                updateSyncUI();
                showToast('👋 مرحباً بعودتك يا ' + user + ' ☁️');
                return false;
            }
        } catch (e) {
            if (rec) {
                showAuthMsg('loginMsg', 'كلمة المرور غير صحيحة');
            } else {
                showAuthMsg('loginMsg', 'اسم المستخدم غير موجود');
            }
            return false;
        }
    }

    if (rec) {
        showAuthMsg('loginMsg', 'كلمة المرور غير صحيحة');
    } else {
        showAuthMsg('loginMsg', 'اسم المستخدم غير موجود');
    }
    return false;
}

async function handleRegister(event) {
    event.preventDefault();
    const user = document.getElementById('regUser').value.trim();
    const pass = document.getElementById('regPass').value;
    const pass2 = document.getElementById('regPass2').value;

    if (!/^[\u0600-\u06FFa-zA-Z0-9_.-]{3,20}$/.test(user)) {
        showAuthMsg('regMsg', 'اسم المستخدم: 3-20 حرفاً (أحرف، أرقام، نقطة، شرطة فقط)');
        return false;
    }
    if (pass.length < 6) {
        showAuthMsg('regMsg', 'كلمة المرور يجب أن تكون 6 أحرف على الأقل');
        return false;
    }
    if (pass !== pass2) {
        showAuthMsg('regMsg', 'كلمتا المرور غير متطابقتين');
        return false;
    }

    const users = getUsers();
    if (users[user]) {
        showAuthMsg('regMsg', 'اسم المستخدم موجود بالفعل');
        return false;
    }

    initFirebase();
    if (fbEnabled && fbAuth) {
        const email = getFbEmail(user);
        const methodz = await fbAuth.fetchSignInMethodsForEmail(email);
        if (methodz && methodz.length > 0) {
            showAuthMsg('regMsg', 'اسم المستخدم موجود بالفعل في السحابة — استخدم تسجيل الدخول من الجهاز الأصلي');
            return false;
        }
    }

    const salt = randomSalt();
    users[user] = { salt, hash: await hashPassword(salt, pass) };
    saveUsers(users);
    setSession(user);
    await openApp(user);
    if (fbEnabled) {
        const ok = await connectCloud(user, pass);
        if (!ok) { showAuthMsg('regMsg', 'تعذر إنشاء الحساب السحابي — تحقق من إعدادات المزامنة'); return false; }
    }
    showToast('🎉 تم إنشاء حسابك بنجاح');
    return false;
}

function openChangePassModal() {
    document.getElementById('chCur').value = '';
    document.getElementById('chNew').value = '';
    document.getElementById('chNew2').value = '';
    document.getElementById('userMenu').classList.remove('active');
    openModal('changePassModal');
}

async function changePassword() {
    const cur = document.getElementById('chCur').value;
    const nw = document.getElementById('chNew').value;
    const cf = document.getElementById('chNew2').value;

    const users = getUsers();
    const rec = users[currentUser];
    if (!rec) return;

    const h = await hashPassword(rec.salt, cur);
    if (h !== rec.hash) {
        showToast('كلمة المرور الحالية غير صحيحة', 'error');
        return;
    }
    if (nw.length < 6) {
        showToast('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل', 'error');
        return;
    }
    if (nw !== cf) {
        showToast('كلمتا المرور غير متطابقتين', 'error');
        return;
    }

    const salt = randomSalt();
    rec.salt = salt;
    rec.hash = await hashPassword(salt, nw);
    saveUsers(users);
    try {
        if (fbAuth && fbAuth.currentUser && fbEnabled) {
            fbAuth.currentUser.updatePassword(nw).catch(() => {});
        }
    } catch (e) { /* ignore */ }
    if (fbEnabled && fbUser) pushToCloudNow(currentUser);
    closeModal('changePassModal');
    showToast('🔑 تم تغيير كلمة المرور بنجاح');
}

function toggleUserMenu(event) {
    event.stopPropagation();
    const menu = document.getElementById('userMenu');
    if (!menu) return;
    document.querySelectorAll('.dropdown-menu.active').forEach(m => { if (m !== menu) m.classList.remove('active'); });
    menu.classList.toggle('active');
}

/* ===== Persistence ===== */
function loadData() {
    if (!currentUser) return;
    try {
        const saved = localStorage.getItem(getUserDataKey(currentUser));
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                data = parsed;
                return;
            }
        }
        // First login: migrate old shared data if it belongs to the admin
        const legacy = localStorage.getItem(STORAGE_KEY);
        if (currentUser === 'admin' && legacy) {
            try {
                const parsed = JSON.parse(legacy);
                if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                    data = parsed;
                    localStorage.setItem(getUserDataKey(currentUser), JSON.stringify(data));
                    localStorage.removeItem(STORAGE_KEY);
                    return;
                }
            } catch (e) { /* ignore */ }
        }
        data = JSON.parse(JSON.stringify(defaultData));
    } catch (e) {
        console.error('Error loading data:', e);
        data = JSON.parse(JSON.stringify(defaultData));
    }
}

function saveData() {
    if (!currentUser) return;
    try {
        localStorage.setItem(getUserDataKey(currentUser), JSON.stringify(data));
    } catch (e) {
        console.error('Error saving data:', e);
        showToast('تعذر حفظ البيانات', 'error');
    }
    schedulePush();
}

/* ===== Notes persistence ===== */
function loadNotes() {
    if (!currentUser) { notes = []; return; }
    try {
        notes = JSON.parse(localStorage.getItem(getUserNotesKey(currentUser))) || [];
        if (!Array.isArray(notes)) notes = [];
    } catch (e) {
        console.error('Error loading notes:', e);
        notes = [];
    }
}

function saveNotes() {
    if (!currentUser) return;
    try {
        localStorage.setItem(getUserNotesKey(currentUser), JSON.stringify(notes));
    } catch (e) {
        console.error('Error saving notes:', e);
    }
    schedulePush();
}

/* ===== Cloud Sync (Firebase) ===== */
function getSyncConfig() {
    try { return JSON.parse(localStorage.getItem(SYNC_CFG_KEY)) || null; }
    catch (e) { return null; }
}

function getFbEmail(username) {
    let safe = '';
    for (const ch of username) {
        if (/[a-zA-Z0-9_.-]/.test(ch)) safe += ch;
        else safe += 'u' + ch.codePointAt(0).toString(16);
    }
    const part = safe.slice(0, 40) || 'user';
    return part + '@hayaati.local';
}

function initFirebase() {
    if (fbApp || !window.firebase) return;
    const cfg = getSyncConfig();
    if (!cfg || !cfg.apiKey || !cfg.projectId) return;
    try {
        fbApp = firebase.initializeApp(cfg);
        fbAuth = firebase.auth(fbApp);
        fbDb = firebase.firestore(fbApp);
        fbEnabled = true;
        updateSyncUI();
    } catch (e) {
        console.error('Firebase init error:', e);
        fbEnabled = false;
    }
}

function openSyncModal() {
    document.getElementById('userMenu').classList.remove('active');
    const cfg = getSyncConfig();
    try {
        document.getElementById('syncConfigInput').value = cfg ? JSON.stringify(cfg, null, 4) : '';
    } catch (e) {
        document.getElementById('syncConfigInput').value = '';
    }
    updateSyncUI();
    openModal('syncModal');
}

function updateSyncUI() {
    const dot = document.getElementById('syncStatusDot');
    const txt = document.getElementById('syncStatusTxt');
    if (!dot || !txt) return;
    const cfg = getSyncConfig();
    if (!cfg) {
        dot.className = 'sync-dot off';
        txt.textContent = 'المزامنة غير مفعّلة — منفّلة محلياً';
    } else if (fbUser) {
        dot.className = 'sync-dot on';
        txt.textContent = 'متصل بالسحابة ويعمل تلقائياً';
    } else {
        dot.className = 'sync-dot cfg';
        txt.textContent = 'إعدادات محفوظة — سجّل الدخول للاتصال';
    }
}

function saveSyncConfig() {
    const raw = document.getElementById('syncConfigInput').value.trim();
    if (!raw) {
        showToast('الصق إعدادات Firebase أولاً', 'error');
        return;
    }
    try {
        const cfg = parseFirebaseConfig(raw);
        localStorage.setItem(SYNC_CFG_KEY, JSON.stringify(cfg));
        fbApp = null; fbAuth = null; fbDb = null; fbUser = null; fbEnabled = false;
        initFirebase();
        if (currentUser) {
            if (pendingCloudPassword) connectCloud(currentUser, pendingCloudPassword);
            else reconnectCloud();
        }
        closeModal('syncModal');
        showToast('☁️ تم حفظ إعدادات المزامنة');
    } catch (e) {
        showToast('تعذر قراءة الإعدادات: ' + e.message, 'error');
    }
}

function parseFirebaseConfig(raw) {
    let line = raw;
    const m = line.match(/({[^}]*})/s);
    if (m) {
        try {
            const obj = JSON.parse(m[1] || '{}');
            if (obj.apiKey && obj.projectId) {
                return {
                    apiKey: obj.apiKey,
                    authDomain: obj.authDomain || (obj.projectId + '.firebaseapp.com'),
                    projectId: obj.projectId,
                    storageBucket: obj.storageBucket || (obj.projectId + '.appspot.com'),
                    messagingSenderId: obj.messagingSenderId || '',
                    appId: obj.appId || ''
                };
            }
        } catch (e) { /* try loose parsing below */ }
    }
    const pick = (rex) => { const mm = line.match(rex); return mm ? mm[1].replace(/['"]/g, '').trim() : ''; };
    const cfg = {
        apiKey: pick(/"apiKey"\s*:\s*"([^"]+)"/) || pick(/apiKey\s*:\s*'([^']+)'/) || pick(/apiKey\s*:\s*"([^"]+)"/),
        authDomain: pick(/"authDomain"\s*:\s*"([^"]+)"/) || pick(/authDomain\s*:\s*'([^']+)'/),
        projectId: pick(/"projectId"\s*:\s*"([^"]+)"/) || pick(/projectId\s*:\s*'([^']+)'/),
        storageBucket: pick(/"storageBucket"\s*:\s*"([^"]+)"/) || pick(/storageBucket\s*:\s*'([^']+)'/),
        messagingSenderId: pick(/"messagingSenderId"\s*:\s*"([^"]+)"/) || pick(/messagingSenderId\s*:\s*'([^']+)'/),
        appId: pick(/"appId"\s*:\s*"([^"]+)"/) || pick(/appId\s*:\s*'([^']+)'/),
    };
    if (!cfg.apiKey || !cfg.projectId) throw new Error('لا يمكن العثور على apiKey و projectId');
    return cfg;
}

async function connectCloud(username, password) {
    initFirebase();
    if (!fbEnabled || !fbAuth || !fbDb) {
        fbUser = null;
        updateSyncUI();
        return false;
    }
    try {
        const email = getFbEmail(username);
        if (!password) { updateSyncUI(); return false; }
        let userCred;
        try {
            userCred = await fbAuth.signInWithEmailAndPassword(email, password);
        } catch (e) {
            const code = e && e.code ? e.code : '';
            if (code === 'auth/user-not-found') {
                userCred = await fbAuth.createUserWithEmailAndPassword(email, password);
            } else {
                updateSyncUI();
                return false;
            }
        }
        fbUser = userCred.user;
        afterCloudConnect(username);
        updateSyncUI();
        return true;
    } catch (e) {
        console.error('Cloud connect error:', e);
        fbUser = null;
        updateSyncUI();
        return false;
    }
}

async function afterCloudConnect(username) {
    const uid = fbUser.uid;
    const docRef = fbDb.collection('hayaati_users').doc(uid);

    let firstRead = null;
    try {
        const snap = await docRef.get();
        firstRead = snap.exists ? snap.data() : null;
    } catch (e) {
        console.error('Cloud initial read error:', e);
    }

    const lastRev = getLocalRev(username);

    if (firstRead) {
        const remoteRev = firstRead._rev || 0;
        if (remoteRev > lastRev) {
            applyCloudPayload(firstRead, username, remoteRev);
        } else if (remoteRev < lastRev) {
            pushToCloudNow(username);
        } else {
            applyCloudPayload(firstRead, username, remoteRev);
        }
    } else {
        pushToCloudNow(username);
    }

    if (fbUnsub) fbUnsub();
    fbUnsub = docRef.onSnapshot((snap) => {
        if (!snap.exists) { pushToCloudNow(username); return; }
        const remote = snap.data();
        const remoteRev = remote._rev || 0;
        const cur = getLocalRev(username);
        if (remoteRev > cur) {
            applyCloudPayload(remote, username, remoteRev);
        }
    }, () => { /* ignore */ });
}

function applyCloudPayload(remote, username, remoteRev) {
    if (!remote) return;
    fbApplyingRemote = true;
    let changed = false;
    try {
        if (remote.dataJson) {
            const parsed = JSON.parse(remote.dataJson);
            if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                data = parsed;
                localStorage.setItem(getUserDataKey(username), remote.dataJson);
                changed = true;
            }
        }
        if (remote.notesJson) {
            const parsedN = JSON.parse(remote.notesJson);
            if (Array.isArray(parsedN)) {
                notes = parsedN;
                localStorage.setItem(getUserNotesKey(username), remote.notesJson);
                changed = true;
            }
        }
        if (remote.waPhone) {
            localStorage.setItem(WA_PHONE_KEY + '_' + username, remote.waPhone);
        }
        setLocalRev(username, remoteRev);
        if (changed && currentUser === username) renderAfterCloudSync();
    } catch (e) {
        console.error('Cloud apply error:', e);
    } finally {
        fbApplyingRemote = false;
    }
}

function getLocalRev(username) {
    try { return parseInt(localStorage.getItem('lifeAppRev_' + username) || '0', 10); }
    catch (e) { return 0; }
}
function setLocalRev(username, rev) {
    try { localStorage.setItem('lifeAppRev_' + username, String(rev)); } catch (e) {}
}

function renderAfterCloudSync() {
    if (!currentUser) return;
    renderAreaList();
    renderDashboardFilters();
    renderTaskContent();
    if (currentView === 'dashboard') updateDashboard();
    if (currentView === 'calendar') renderCalendar();
    if (currentView === 'notes') renderNotes();
}

function schedulePush() {
    if (!fbEnabled || !fbUser || !currentUser || fbApplyingRemote) return;
    clearTimeout(fbPushTimer);
    fbPushTimer = setTimeout(() => pushToCloudNow(currentUser), 400);
}

function pushToCloudNow(username) {
    username = username || currentUser;
    if (!fbEnabled || !fbUser || !username || fbApplyingRemote) return;
    const rev = Date.now();
    try {
        fbDb.collection('hayaati_users').doc(fbUser.uid).set({
            dataJson: JSON.stringify(data),
            notesJson: JSON.stringify(notes),
            waPhone: getWaPhone(),
            _rev: rev
        });
        setLocalRev(username, rev);
    } catch (e) {
        console.error('Cloud push error:', e);
    }
}

function disableSync() {
    try {
        if (fbUnsub) { try { fbUnsub(); } catch (e) {} fbUnsub = null; }
    } catch (e) {}
    fbUser = null;
    localStorage.removeItem(SYNC_CFG_KEY);
    if (fbAuth && fbAuth.currentUser) { try { fbAuth.signOut(); } catch (e) {} }
    closeModal('syncModal');
    showToast('⛔ تم إيقاف المزامنة السحابية');
    updateSyncUI();
}

function logout() {
    if (fbUnsub) { try { fbUnsub(); } catch (e) {} fbUnsub = null; }
    try { if (fbAuth && fbAuth.currentUser) fbAuth.signOut(); } catch (e) {}
    fbUser = null;
    clearSession();
    location.reload();
}

/* ===== WhatsApp phone ===== */
function getWaPhone() {
    if (!currentUser) return '';
    try { return localStorage.getItem(WA_PHONE_KEY + '_' + currentUser) || ''; }
    catch (e) { return ''; }
}
function setWaPhone(phone) {
    try { localStorage.setItem(WA_PHONE_KEY + '_' + currentUser, phone); }
    catch (e) {}
}

function newTaskId() {
    taskIdCounter += 1;
    return taskIdCounter;
}

/* ===== Utilities ===== */
function esc(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function countAreaTasks(areaKey) {
    const area = data[areaKey];
    let n = 0;
    if (area && area.headings) {
        Object.values(area.headings).forEach(h => {
            if (h.tasks) n += h.tasks.length;
        });
    }
    return n;
}

function isTaskUrgent(deadline) {
    if (!deadline) return false;
    const d = new Date(deadline);
    if (isNaN(d)) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.ceil((d - today) / (1000 * 60 * 60 * 24));
    return days >= 0 && days <= URGENT_DAYS;
}

function isTaskOverdue(deadline) {
    if (!deadline) return false;
    const d = new Date(deadline);
    if (isNaN(d)) return false;
    d.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d < today;
}

function daysUntil(deadline) {
    const d = new Date(deadline);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.ceil((d - today) / (1000 * 60 * 60 * 24));
}

function formatDate(date) {
    try {
        return new Intl.DateTimeFormat('ar-OM', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
    } catch (e) {
        return date.toDateString();
    }
}

function dueLabel(deadline) {
    if (!deadline) return '';
    if (isTaskOverdue(deadline)) return '❌ متأخرة';
    const days = daysUntil(deadline);
    if (days === 0) return '🔴 اليوم';
    if (days === 1) return '🔴 غداً';
    if (days <= URGENT_DAYS) return `⚡ بعد ${days} أيام`;
    return `📅 ${days} أيام متبقية`;
}

function showToast(msg, type = 'success') {
    const box = document.getElementById('toastBox');
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.innerHTML = msg;
    box.appendChild(t);
    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transition = 'opacity .4s';
        setTimeout(() => t.remove(), 400);
    }, 2800);
}

function confirmAction(title, text, cb) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmText').textContent = text;
    confirmCallback = cb;
    openModal('confirmModal');
}
document.getElementById('confirmBtn') ? document.getElementById('confirmBtn').addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    closeModal('confirmModal');
    confirmCallback = null;
}) : null;

/* ===== Modal helpers ===== */
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
function closeAllModals() {
    document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
}

function toggleAddMenu() {
    const menu = document.getElementById('addMenu');
    menu.classList.toggle('active');
}

/* ===== View switching ===== */
function switchView(view) {
    currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + view)?.classList.add('active');
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.nav-tab[data-view="${view}"]`).classList.add('active');

    if (view === 'dashboard') setTimeout(() => updateDashboard(), 50);
    if (view === 'calendar') renderCalendar();
    if (view === 'notes') renderNotes();
}

/* ===== Areas ===== */
function renderAreaList() {
    const list = document.getElementById('areaList');
    const countEl = document.getElementById('areaCount');
    if (!list) return;

    list.innerHTML = '';
    const keys = data ? Object.keys(data) : [];

    countEl.textContent = keys.length + ' مناطق';

    if (keys.length === 0) {
        list.innerHTML = '<div class="empty-state"><span class="empty-icon">🗂️</span><h3>لا توجد مناطق</h3><p>ابدأ بإضافة منطقتك الأولى</p></div>';
        return;
    }

    keys.forEach(key => {
        const area = data[key];
        if (!area || !area.name) return;

        const btn = document.createElement('div');
        btn.className = 'area-btn' + (currentArea === key ? ' active' : '');
        btn.setAttribute('role', 'button');
        btn.onclick = () => switchArea(key);

        btn.innerHTML = `
            <span class="area-icon">${esc(area.icon || '📌')}</span>
            <span>${esc(area.name)}</span>
            <span class="area-meta">${countAreaTasks(key)} مهام</span>
            <button class="area-del-btn" title="حذف المنطقة" onclick="event.stopPropagation(); deleteArea('${key}')">🗑</button>
        `;
        list.appendChild(btn);
    });
}

function switchArea(areaKey) {
    if (!data || !data[areaKey]) return;
    currentArea = areaKey;
    renderAreaList();
    renderTaskContent();
}

function deleteArea(areaKey) {
    const area = data[areaKey];
    confirmAction('حذف المنطقة', `هل تريد حذف "${area.name}" وجميع عناوينها ومهامها؟`, () => {
        delete data[areaKey];
        if (currentArea === areaKey) {
            currentArea = data && Object.keys(data).length > 0 ? Object.keys(data)[0] : null;
        }
        saveData();
        renderAreaList();
        renderTaskContent();
        renderDashboardFilters();
        showToast(`تم حذف "${area.name}"`);
    });
}

/* ===== Headings ===== */
function deleteHeading(areaKey, headingKey) {
    const heading = data[areaKey].headings[headingKey];
    confirmAction('حذف العنوان', `هل تريد حذف "${heading.name}" وجميع مهامه؟`, () => {
        delete data[areaKey].headings[headingKey];
        saveData();
        renderTaskContent();
        showToast(`تم حذف "${heading.name}"`);
    });
}

/* ===== Tasks rendering ===== */
function renderTaskContent() {
    const content = document.getElementById('taskContent');
    const hero = document.getElementById('areaTitleDisplay');
    if (!content) return;

    if (!currentArea || !data[currentArea]) {
        hero.innerHTML = '<span class="area-hero-icon">📋</span><div><h2>اختر منطقة من القائمة</h2><p>أو أنشئ منطقة جديدة للبدء</p></div>';
        content.innerHTML = '<div class="empty-state"><span class="empty-icon">🗂️</span><h3>لا توجد بيانات</h3><p>أنشئ منطقة جديدة ثم أضف عناوين ومهام</p></div>';
        return;
    }

    const area = data[currentArea];
    const headings = area.headings || {};
    const keys = Object.keys(headings);

    let totalTasks = 0, completedTasks = 0, urgentTasks = 0;
    keys.forEach(hk => {
        const h = headings[hk];
        if (h.tasks) {
            h.tasks.forEach(t => {
                totalTasks++;
                if (t.completed) completedTasks++;
                if (!t.completed && isTaskUrgent(t.deadline)) urgentTasks++;
            });
        }
    });

    hero.innerHTML = `
        <span class="area-hero-icon">${esc(area.icon || '📍')}</span>
        <div>
            <h2>${esc(area.name)}</h2>
            <p>${keys.length} عناوين · ${totalTasks} مهام</p>
        </div>
        <div class="hero-stats">
            <span class="stat-chip">✅ ${completedTasks}/${totalTasks} مكتملة</span>
            <span class="stat-chip">⚡ ${urgentTasks} عاجلة</span>
        </div>
    `;

    if (keys.length === 0) {
        content.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📌</span>
                <h3>لا توجد عناوين في ${esc(area.name)}</h3>
                <p>أضف عنواناً رئيسياً أولاً (مثل: Q3 Audit أو POS Software)</p>
                <br>
                <button class="btn btn-primary" onclick="openAddHeadingModal()">+ إضافة عنوان</button>
            </div>`;
        return;
    }

    content.innerHTML = '';

    keys.forEach(headingKey => {
        const heading = headings[headingKey];
        if (!heading) return;
        const tasks = heading.tasks || [];

        const doneCount = tasks.filter(t => t.completed).length;
        const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;

        const section = document.createElement('div');
        section.className = 'heading-section';

        let tasksHtml = '';
        if (tasks.length === 0) {
            tasksHtml = '<div class="empty-state" style="padding:20px;"><span class="empty-icon">📝</span><h3>لا مهام بعد</h3><p>أضف مهمة لهذا العنوان</p></div>';
        } else {
            tasksHtml = tasks.map(task => renderTaskCard(currentArea, headingKey, task)).join('');
        }

        section.innerHTML = `
            <div class="heading-title">
                <span class="h-icon">📌</span>
                <span>${esc(heading.name)}</span>
                <button class="btn btn-sm btn-outline" onclick="openAddTaskModal('${currentArea}', '${headingKey}')">+ مهمة</button>
                <div class="h-progress">
                    <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
                    <span class="progress-label">${pct}%</span>
                </div>
                <button class="heading-del-btn" title="حذف العنوان" onclick="deleteHeading('${currentArea}', '${headingKey}')">🗑</button>
            </div>
            ${tasksHtml}
        `;
        content.appendChild(section);
    });
}

function renderTaskCard(areaKey, headingKey, task) {
    const urgent = isTaskUrgent(task.deadline);
    const overdue = isTaskOverdue(task.deadline);
    const priorityClass = task.priority === 'high' ? 'high-priority' : 'low-priority';

    const priorityBadge = task.priority === 'high'
        ? '<span class="badge important">🔴 مهم</span>'
        : '<span class="badge low">🟢 أقل أهمية</span>';
    const urgencyBadge = overdue
        ? '<span class="badge urgent">⚠️ متأخرة</span>'
        : (urgent ? '<span class="badge urgent">⚡ عاجل</span>' : '<span class="badge normal">عادي</span>');

    let subtasksHtml = '';
    if (task.subtasks && task.subtasks.length > 0) {
        const stDone = task.subtasks.filter(s => s.completed).length;
        subtasksHtml = `
            <div class="subtasks">
                <div class="subtasks-label">🔽 مهام فرعية (${stDone}/${task.subtasks.length})</div>
                ${task.subtasks.map((st, idx) => `
                    <div class="subtask-item ${st.completed ? 'completed' : ''}">
                        <input type="checkbox" ${st.completed ? 'checked' : ''} onchange="toggleSubtask('${areaKey}', '${headingKey}', ${task.id}, ${idx})">
                        <label onclick="toggleSubtask('${areaKey}', '${headingKey}', ${task.id}, ${idx})">${esc(st.name)}</label>
                        <button class="subtask-del-btn" onclick="deleteSubtask('${areaKey}', '${headingKey}', ${task.id}, ${idx})">×</button>
                    </div>`).join('')}
            </div>`;
    }

    const dueCls = overdue ? 'over' : (urgent ? 'soon' : '');
    const dueTxt = dueLabel(task.deadline);

    const noteCount = (task.notes && task.notes.length) || 0;
    const hasNote = noteCount > 0 || !!task.details;
    const notesChip = `
        <button class="tn-chip ${hasNote ? 'active' : ''}" onclick="event.stopPropagation(); openTaskNotesModal('${areaKey}', '${headingKey}', ${task.id})"
            title="${hasNote ? 'عرض ملاحظات المهمة (' + (noteCount || 'تفاصيل') + ')' : 'إضافة ملاحظة لهذه المهمة'}">
            📝 ${noteCount || ''}
        </button>`;

    return `
        <div class="task-card ${priorityClass} ${task.completed ? 'completed' : ''} ${overdue ? 'overdue' : ''}">
            <div class="priority-stack">
                ${priorityBadge}
                ${urgencyBadge}
            </div>
            <div class="task-content">
                <div class="task-title">${esc(task.name)}</div>
                <div class="task-meta">
                    ${task.deadline ? `<span class="task-due ${dueCls}">${dueTxt}</span>` : ''}
                    <span>⏱️ ${task.estimate || 0} ساعة</span>
                    ${notesChip}
                </div>
                ${subtasksHtml}
            </div>
            <div class="task-actions">
                <input type="checkbox" class="task-check" ${task.completed ? 'checked' : ''} onchange="toggleTask('${areaKey}', '${headingKey}', ${task.id})" title="إكمال المهمة">
                <button class="menu-btn" onclick="toggleTaskMenu(event)">⋯</button>
                <div class="dropdown-menu">
                    <button class="dropdown-item" onclick="openEditTaskModal('${areaKey}', '${headingKey}', ${task.id})">✏️ تعديل</button>
                    <button class="dropdown-item" onclick="openSubtaskModal('${areaKey}', '${headingKey}', ${task.id})">➕ مهمة فرعية</button>
                    <button class="dropdown-item" onclick="openTaskNotesModal('${areaKey}', '${headingKey}', ${task.id})">📝 ملاحظات المهمة</button>
                    <button class="dropdown-item" onclick="sendWhatsAppReminder('${areaKey}', '${headingKey}', ${task.id})">📲 تذكير واتساب</button>
                    <button class="dropdown-item danger" onclick="deleteTask('${areaKey}', '${headingKey}', ${task.id})">🗑 حذف</button>
                </div>
            </div>
        </div>`;
}

function toggleTaskMenu(event) {
    event.stopPropagation();
    const btn = event.target;
    const menu = btn.nextElementSibling;
    document.querySelectorAll('.dropdown-menu.active').forEach(m => { if (m !== menu) m.classList.remove('active'); });
    menu.classList.toggle('active');
}

/* ===== Task operations ===== */
function findTask(areaKey, headingKey, taskId) {
    if (!data[areaKey] || !data[areaKey].headings || !data[areaKey].headings[headingKey]) return null;
    return data[areaKey].headings[headingKey].tasks.find(t => t && t.id === taskId) || null;
}

function findTaskAndParent(areaKey, headingKey, taskId) {
    const heading = data[areaKey]?.headings?.[headingKey];
    if (!heading) return null;
    const task = heading.tasks.find(t => t && t.id === taskId);
    return task ? { task, heading } : null;
}

function toggleTask(areaKey, headingKey, taskId) {
    const found = findTaskAndParent(areaKey, headingKey, taskId);
    if (!found) return;
    found.task.completed = !found.task.completed;
    if (found.task.completed) {
        showToast('🎉 أحسنت! اكتملت المهمة');
    }
    saveData();
    renderTaskContent();
    if (currentView === 'dashboard') updateDashboard();
}

function toggleSubtask(areaKey, headingKey, taskId, idx) {
    const found = findTaskAndParent(areaKey, headingKey, taskId);
    if (!found || !found.task.subtasks || !found.task.subtasks[idx]) return;
    found.task.subtasks[idx].completed = !found.task.subtasks[idx].completed;
    saveData();
    renderTaskContent();
    if (currentView === 'dashboard') updateDashboard();
}

function deleteSubtask(areaKey, headingKey, taskId, idx) {
    const found = findTaskAndParent(areaKey, headingKey, taskId);
    if (!found) return;
    found.task.subtasks.splice(idx, 1);
    saveData();
    renderTaskContent();
}

function deleteTask(areaKey, headingKey, taskId) {
    const found = findTaskAndParent(areaKey, headingKey, taskId);
    if (!found) return;
    confirmAction('حذف المهمة', `هل تريد حذف "${found.task.name}"؟`, () => {
        found.heading.tasks = found.heading.tasks.filter(t => t.id !== taskId);
        saveData();
        renderTaskContent();
        renderAreaList();
        if (currentView === 'dashboard') updateDashboard();
        showToast('تم حذف المهمة');
    });
}

/* ===== Add Area ===== */
function openAddAreaModal() {
    document.getElementById('areaName').value = '';
    document.getElementById('areaEmoji').value = '';
    document.getElementById('addMenu').classList.remove('active');
    openModal('addAreaModal');
    setTimeout(() => document.getElementById('areaName').focus(), 60);
}

function addArea() {
    const name = document.getElementById('areaName').value.trim();
    const emoji = document.getElementById('areaEmoji').value.trim();

    if (!name) {
        showToast('أدخل اسم المنطقة', 'error');
        return;
    }

    if (!data) data = {};

    const key = name.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/gi, '_').replace(/^_+|_+$/g, '');
    if (data[key]) {
        showToast('هذه المنطقة موجودة بالفعل', 'warning');
        return;
    }

    data[key] = { name, icon: emoji || '📌', headings: {} };
    saveData();
    renderAreaList();
    renderDashboardFilters();
    switchArea(key);
    closeModal('addAreaModal');
    showToast(`تم إضافة منطقة "${name}"`);
}

/* ===== Add Heading ===== */
function openAddHeadingModal(preArea) {
    const select = document.getElementById('headingArea');
    select.innerHTML = '<option value="">اختر منطقة</option>';
    Object.keys(data || {}).forEach(key => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = (data[key].icon || '') + ' ' + data[key].name;
        select.appendChild(opt);
    });
    if (preArea) select.value = preArea;
    else if (currentArea) select.value = currentArea;

    document.getElementById('headingName').value = '';
    document.getElementById('addMenu').classList.remove('active');
    openModal('addHeadingModal');
    setTimeout(() => document.getElementById('headingName').focus(), 60);
}

function addHeading() {
    const area = document.getElementById('headingArea').value;
    const name = document.getElementById('headingName').value.trim();

    if (!area || !name) {
        showToast('اختر منطقة وأدخل اسم العنوان', 'error');
        return;
    }
    if (!data[area]) {
        showToast('المنطقة غير موجودة', 'error');
        return;
    }
    if (!data[area].headings) data[area].headings = {};

    const key = name.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/gi, '_').replace(/^_+|_+$/g, '');
    if (data[area].headings[key]) {
        showToast('هذا العنوان موجود بالفعل', 'warning');
        return;
    }

    data[area].headings[key] = { name, tasks: [] };
    saveData();
    if (currentArea === area) renderTaskContent();
    closeModal('addHeadingModal');
    showToast(`تم إضافة عنوان "${name}"`);
}

/* ===== Add Task ===== */
function openAddTaskModal(preArea, preHeading) {
    const areaSelect = document.getElementById('taskArea');
    const headingSelect = document.getElementById('taskHeading');

    areaSelect.innerHTML = '<option value="">اختر منطقة</option>';
    Object.keys(data || {}).forEach(key => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = (data[key].icon || '') + ' ' + data[key].name;
        areaSelect.appendChild(opt);
    });

    if (preArea) {
        areaSelect.value = preArea;
        updateHeadingOptions();
        if (preHeading) headingSelect.value = preHeading;
    } else if (currentArea) {
        areaSelect.value = currentArea;
        updateHeadingOptions();
    }

    document.getElementById('taskName').value = '';
    document.getElementById('taskDeadline').value = '';
    document.getElementById('taskEstimate').value = '';
    document.getElementById('taskPriority').value = 'high';
    document.getElementById('taskNotes').value = '';
    document.getElementById('addMenu').classList.remove('active');
    closeAllModals();
    openModal('addTaskModal');
    setTimeout(() => document.getElementById('taskName').focus(), 60);
}

function updateHeadingOptions() {
    const area = document.getElementById('taskArea').value;
    const headingSelect = document.getElementById('taskHeading');
    headingSelect.innerHTML = '<option value="">اختر عنوان</option>';
    if (area && data[area] && data[area].headings) {
        Object.keys(data[area].headings).forEach(key => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = data[area].headings[key].name;
            headingSelect.appendChild(opt);
        });
    }
}

function addTask() {
    const area = document.getElementById('taskArea').value;
    const heading = document.getElementById('taskHeading').value;
    const name = document.getElementById('taskName').value.trim();
    const deadline = document.getElementById('taskDeadline').value;
    const estimate = parseFloat(document.getElementById('taskEstimate').value);
    const priority = document.getElementById('taskPriority').value;
    const notes = document.getElementById('taskNotes').value.trim();

    if (!area || !heading || !name) {
        showToast('املأ المنطقة والعنوان واسم المهمة', 'error');
        return;
    }
    if (!data[area] || !data[area].headings || !data[area].headings[heading]) {
        showToast('المنطقة أو العنوان غير صحيح', 'error');
        return;
    }

    data[area].headings[heading].tasks.push({
        id: newTaskId(),
        name,
        deadline,
        estimate: isNaN(estimate) ? 0 : estimate,
        priority,
        completed: false,
        details: notes || '',
        subtasks: []
    });

    saveData();
    if (currentArea === area) {
        renderTaskContent();
        renderAreaList();
    }
    closeModal('addTaskModal');
    showToast(`تمت إضافة المهمة "${name}"`);
    if (currentView === 'dashboard') updateDashboard();
}

/* ===== Edit Task ===== */
function openEditTaskModal(areaKey, headingKey, taskId) {
    const found = findTaskAndParent(areaKey, headingKey, taskId);
    if (!found) return;

    currentEditArea = areaKey;
    currentEditHeading = headingKey;
    currentEditTaskId = taskId;

    document.getElementById('editTaskName').value = found.task.name || '';
    document.getElementById('editTaskDeadline').value = found.task.deadline || '';
    document.getElementById('editTaskEstimate').value = found.task.estimate || '';
    document.getElementById('editTaskPriority').value = found.task.priority || 'high';
    document.getElementById('editTaskNotes').value = found.task.details || '';

    openModal('editTaskModal');
}

function saveEditTask() {
    const found = findTaskAndParent(currentEditArea, currentEditHeading, currentEditTaskId);
    if (!found) return;

    found.task.name = document.getElementById('editTaskName').value.trim();
    found.task.deadline = document.getElementById('editTaskDeadline').value;
    found.task.estimate = parseFloat(document.getElementById('editTaskEstimate').value) || 0;
    found.task.priority = document.getElementById('editTaskPriority').value;
    found.task.details = document.getElementById('editTaskNotes').value.trim() || '';

    saveData();
    renderTaskContent();
    if (currentView === 'dashboard') updateDashboard();
    closeModal('editTaskModal');
    showToast('تم حفظ التعديلات');
}

/* ===== Subtasks ===== */
function openSubtaskModal(areaKey, headingKey, taskId) {
    currentSubtaskArea = areaKey;
    currentSubtaskHeading = headingKey;
    currentSubtaskTaskId = taskId;
    document.getElementById('subtaskName').value = '';
    openModal('addSubtaskModal');
    setTimeout(() => document.getElementById('subtaskName').focus(), 60);
}

function addSubtask() {
    const name = document.getElementById('subtaskName').value.trim();
    if (!name) {
        showToast('أدخل اسم المهمة الفرعية', 'error');
        return;
    }
    const found = findTaskAndParent(currentSubtaskArea, currentSubtaskHeading, currentSubtaskTaskId);
    if (!found) return;

    if (!Array.isArray(found.task.subtasks)) found.task.subtasks = [];
    found.task.subtasks.push({ name, completed: false });

    saveData();
    renderTaskContent();
    closeModal('addSubtaskModal');
    showToast('تمت إضافة مهمة فرعية');
}

/* ===== Task-specific Notes ===== */
function getTnContext() {
    if (!tnCtx) return null;
    return findTaskAndParent(tnCtx.areaKey, tnCtx.headingKey, tnCtx.taskId);
}

function openTaskNotesModal(areaKey, headingKey, taskId) {
    const found = findTaskAndParent(areaKey, headingKey, taskId);
    if (!found) return;

    tnCtx = { areaKey, headingKey, taskId };
    tnEditId = null;

    document.getElementById('tnTitle').textContent = '📝 ملاحظات: ' + found.task.name;
    document.getElementById('tnDetails').value = found.task.details || '';
    document.getElementById('tnNewNote').value = '';
    document.getElementById('tnAddBtn').textContent = '+ إضافة ملاحظة';

    renderTaskNotesList();
    openModal('taskNotesModal');
}

function ensureTaskNotes(task) {
    if (!Array.isArray(task.notes)) task.notes = [];
    return task.notes;
}

function renderTaskNotesList() {
    const found = getTnContext();
    const list = document.getElementById('tnList');
    if (!found || !list) return;

    const notesArr = ensureTaskNotes(found.task);
    if (notesArr.length === 0) {
        list.innerHTML = '<div class="tn-empty">لا توجد ملاحظات بعد لهذه المهمة — أضف أول ملاحظة 📝</div>';
        return;
    }

    const sorted = [...notesArr].sort((a, b) => (b.ts || 0) - (a.ts || 0));
    list.innerHTML = sorted.map(n => `
        <div class="tn-item ${tnEditId === n.id ? 'editing' : ''}">
            <div class="tn-content">${esc(n.content)}</div>
            <div class="tn-meta">
                <span>🗓️ ${formatShortDate(n.ts || Date.now())}</span>
                <span class="spacer"></span>
                <button class="icon-btn" title="تعديل" onclick="editTaskNote(${n.id})">✏️</button>
                <button class="icon-btn danger" title="حذف" onclick="deleteTaskNote(${n.id})">🗑️</button>
            </div>
        </div>`).join('');
}

function editTaskNote(noteId) {
    const found = getTnContext();
    if (!found) return;
    const note = ensureTaskNotes(found.task).find(n => n.id === noteId);
    if (!note) return;

    tnEditId = noteId;
    document.getElementById('tnNewNote').value = note.content;
    document.getElementById('tnAddBtn').textContent = '💾 حفظ التعديل';
    document.getElementById('tnNewNote').focus();
    renderTaskNotesList();
}

function addTaskNote() {
    const found = getTnContext();
    if (!found) return;

    const content = document.getElementById('tnNewNote').value.trim();
    if (!content) {
        showToast('اكتب محتوّى الملاحظة أولاً', 'error');
        return;
    }

    const notesArr = ensureTaskNotes(found.task);
    if (tnEditId) {
        const note = notesArr.find(n => n.id === tnEditId);
        if (note) {
            note.content = content;
            note.ts = Date.now();
        }
        tnEditId = null;
        document.getElementById('tnAddBtn').textContent = '+ إضافة ملاحظة';
    } else {
        notesArr.push({ id: newTaskId(), content, ts: Date.now() });
    }

    document.getElementById('tnNewNote').value = '';
    saveData();
    renderTaskNotesList();
    renderTaskContent();
    if (currentView === 'dashboard') updateDashboard();
    if (currentView === 'calendar') renderCalendar();
    showToast('✅ تم حفظ الملاحظة');
}

function deleteTaskNote(noteId) {
    const found = getTnContext();
    if (!found) return;

    confirmAction('حذف الملاحظة', 'هل تريد حذف هذه الملاحظة من المهمة؟', () => {
        const notesArr = ensureTaskNotes(found.task);
        found.task.notes = notesArr.filter(n => n.id !== noteId);
        if (tnEditId === noteId) {
            tnEditId = null;
            document.getElementById('tnAddBtn').textContent = '+ إضافة ملاحظة';
        }
        saveData();
        renderTaskNotesList();
        renderTaskContent();
        if (currentView === 'dashboard') updateDashboard();
        if (currentView === 'calendar') renderCalendar();
        showToast('تم حذف الملاحظة');
    });
}

function saveTnDetails() {
    const found = getTnContext();
    if (!found) return;
    found.task.details = document.getElementById('tnDetails').value.trim();
    saveData();
    renderTaskContent();
    if (currentView === 'dashboard') updateDashboard();
    if (currentView === 'calendar') renderCalendar();
    showToast('💾 تم حفظ تفاصيل المهمة');
}

/* ===== Dashboard ===== */
function renderDashboardFilters() {
    const select = document.getElementById('filterArea');
    select.innerHTML = '<option value="">جميع المناطق</option>';
    Object.keys(data || {}).forEach(key => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = (data[key].icon || '') + ' ' + data[key].name;
        select.appendChild(opt);
    });
}

function getFilteredTasks(onlyActive = true) {
    const area = document.getElementById('filterArea').value;
    const timeframe = document.getElementById('filterTime').value;
    const status = document.getElementById('filterStatus').value;

    const areasToCheck = area ? [area] : Object.keys(data || {});
    let tasks = [];

    areasToCheck.forEach(aKey => {
        const a = data[aKey];
        if (!a || !a.headings) return;
        Object.entries(a.headings).forEach(([hKey, heading]) => {
            if (!heading || !Array.isArray(heading.tasks)) return;
            heading.tasks.forEach(task => {
                if (task && isInTimeframe(task.deadline, timeframe) && isInStatus(task, status)) {
                    tasks.push({ ...task, _area: a.name, _areaKey: aKey, _icon: a.icon, _heading: heading.name, _headingKey: hKey });
                }
            });
        });
    });

    return tasks;
}

function isInStatus(task, status) {
    if (status === 'all') return true;
    return !task.completed;
}

function isInTimeframe(deadline, timeframe) {
    if (!timeframe) return true;
    if (!deadline) return false;

    const d = new Date(deadline);
    d.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    switch (timeframe) {
        case 'today': return d.getTime() === today.getTime();
        case 'week': return d >= today && d <= new Date(today.getTime() + 6 * 86400000);
        case 'month': return d >= today && d <= new Date(today.getTime() + 29 * 86400000);
        default: return true;
    }
}

function updateDashboard() {
    const tasks = getFilteredTasks();

    const counts = {
        'high-urgent': 0,
        'high-normal': 0,
        'low-urgent': 0,
        'low-normal': 0
    };
    const allCounts = {
        'high-urgent': 0,
        'high-normal': 0,
        'low-urgent': 0,
        'low-normal': 0
    };

    tasks.forEach(task => {
        if (task.completed) return;
        const sec = task.priority + '-' + (isTaskUrgent(task.deadline) ? 'urgent' : 'normal');
        counts[sec]++;
    });

    // All tasks (including completed) for stats
    const area = document.getElementById('filterArea').value;
    const timeframe = document.getElementById('filterTime').value;
    allTasks(area, timeframe).forEach(task => {
        const sec = task.priority + '-' + (isTaskUrgent(task.deadline) ? 'urgent' : 'normal');
        allCounts[sec]++;
    });

    renderStatsStrip(tasks);
    renderPriorityCards(counts);

    const container = document.getElementById('tasksByPriority');
    container.innerHTML = '';
    if (expandedSection) {
        const filtered = tasks.filter(t => !t.completed && (t.priority + '-' + (isTaskUrgent(t.deadline) ? 'urgent' : 'normal')) === expandedSection);
        if (filtered.length > 0) {
            renderExpandedSection(container, expandedSection, filtered);
        } else {
            expandedSection = null;
        }
    }
}

function allTasks(area, timeframe) {
    const areasToCheck = area ? [area] : Object.keys(data || {});
    let tasks = [];
    areasToCheck.forEach(aKey => {
        const a = data[aKey];
        if (!a || !a.headings) return;
        Object.values(a.headings).forEach(heading => {
            if (!heading || !Array.isArray(heading.tasks)) return;
            heading.tasks.forEach(task => {
                if (task) tasks.push(task);
            });
        });
    });
    return tasks;
}

function renderStatsStrip(tasks) {
    const active = tasks.filter(t => !t.completed);
    const done = tasks.filter(t => t.completed);
    const urgent = active.filter(t => isTaskUrgent(t.deadline));
    const overdue = active.filter(t => isTaskOverdue(t.deadline));
    const totalHours = tasks.reduce((s, t) => s + (t.estimate || 0), 0);

    const pct = tasks.length ? Math.round((done.length / tasks.length) * 100) : 0;

    document.getElementById('statsStrip').innerHTML = `
        <div class="stat-card">
            <div class="stat-ic purple">📋</div>
            <div><div class="stat-num">${tasks.length}</div><div class="stat-lbl">إجمالي المهام</div></div>
        </div>
        <div class="stat-card">
            <div class="stat-ic green">✅</div>
            <div><div class="stat-num">${pct}%</div><div class="stat-lbl">${done.length} مكتملة</div></div>
        </div>
        <div class="stat-card">
            <div class="stat-ic red">⏰</div>
            <div><div class="stat-num">${urgent.length}</div><div class="stat-lbl">${overdue.length > 0 ? overdue.length + ' متأخرة · ' : ''}عاجلة</div></div>
        </div>
        <div class="stat-card">
            <div class="stat-ic amber">⚡</div>
            <div><div class="stat-num">${totalHours}</div><div class="stat-lbl">ساعة مقدرة</div></div>
        </div>
    `;
}

const SECTION_META = {
    'high-urgent': { title: '🔴 مهم وعاجل', sub: 'نفّذها فوراً', icon: '🔥' },
    'high-normal': { title: '🟠 مهم وعادي', sub: 'خطّط لها', icon: '📅' },
    'low-urgent': { title: '🟡 أقل أهمية وعاجل', sub: 'فوّضها', icon: '⚡' },
    'low-normal': { title: '🟢 أقل أهمية وعادي', sub: 'أنجزها في وقت الفراغ', icon: '🌿' }
};

function renderPriorityCards(counts) {
    const grid = document.getElementById('priorityDashboard');
    grid.innerHTML = Object.entries(SECTION_META).map(([key, meta]) => `
        <div class="priority-card ${key} ${expandedSection === key ? 'active' : ''}" onclick="expandSection('${key}')">
            <div class="card-badge">${meta.icon}</div>
            <div class="card-title">${meta.title}</div>
            <div class="card-count">${counts[key]}</div>
            <div class="card-label">${meta.sub}</div>
        </div>
    `).join('');
}

function expandSection(section) {
    if (expandedSection === section) {
        expandedSection = null;
    } else {
        expandedSection = section;
    }
    updateDashboard();
    if (expandedSection) {
        const el = document.getElementById('tasksByPriority');
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function renderExpandedSection(container, section, tasks) {
    const meta = SECTION_META[section];
    container.innerHTML = `
        <div class="priority-group-section">
            <div class="heading-title">
                <span class="h-icon">${meta.icon}</span>
                <span>${meta.title}</span>
                <span style="font-size:.8rem;color:var(--text-muted);font-weight:500;">${tasks.length} مهام</span>
            </div>
            ${tasks.map(t => `
                <div class="task-card ${t.priority === 'high' ? 'high-priority' : 'low-priority'}">
                    <div class="priority-stack">
                        ${t.priority === 'high' ? '<span class="badge important">مهم</span>' : '<span class="badge low">أقل</span>'}
                        ${isTaskUrgent(t.deadline) ? '<span class="badge urgent">عاجل</span>' : '<span class="badge normal">عادي</span>'}
                    </div>
                    <div class="task-content" style="cursor:pointer" onclick="switchAreaAndOpenTask('${t._areaKey}', '${t._headingKey}', ${t.id})">
                        <div class="task-title">${esc(t.name)}</div>
                        <div class="task-meta">
                            <span>🏢 ${esc(t._area)}</span>
                            <span>📌 ${esc(t._heading)}</span>
                            ${t.deadline ? `<span class="task-due ${isTaskOverdue(t.deadline) ? 'over' : 'soon'}">${dueLabel(t.deadline)}</span>` : ''}
                            <span>⏱️ ${t.estimate || 0}h</span>
                        </div>
                    </div>
                    <input type="checkbox" class="task-check" ${t.completed ? 'checked' : ''} onchange="toggleTask('${t._areaKey}', '${t._headingKey}', ${t.id})">
                </div>`).join('')}
        </div>
    `;
}

function switchAreaAndOpenTask(areaKey, headingKey, taskId) {
    switchView('tasks');
    switchArea(areaKey);
    openEditTaskModal(areaKey, headingKey, taskId);
}

/* ===== Calendar ===== */
function renderCalendar() {
    const container = document.getElementById('calendarContent');
    if (!container) return;

    const tasks = getFilteredTasks();
    const active = tasks.filter(t => !t.completed);

    const overdue = active.filter(t => isTaskOverdue(t.deadline));
    const upcoming = active.filter(t => !isTaskOverdue(t.deadline) && t.deadline).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    const noDate = active.filter(t => !t.deadline);
    const done = tasks.filter(t => t.completed);

    let html = '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (active.length === 0 && done.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="empty-icon">🗓️</span><h3>لا توجد مهام</h3><p>أضف مهاماً لتظهر هنا</p></div>';
        return;
    }

    if (overdue.length > 0) {
        html += `
            <div class="day-group overdue-marker"><div class="day-head">
                <span class="day-icon">⚠️</span>متأخرات
                <span class="day-when">${overdue.length} مهام تجاوزت موعدها</span>
            </div>
            ${overdue.map(t => calTaskRow(t)).join('')}</div>`;
    }

    const groups = {};
    upcoming.forEach(t => {
        const day = t.deadline;
        if (!groups[day]) groups[day] = [];
        groups[day].push(t);
    });

    Object.entries(groups).sort((a, b) => new Date(a[0]) - new Date(b[0])).forEach(([day, dayTasks]) => {
        const d = new Date(day);
        const diff = Math.ceil((d - today) / 86400000);
        const when = diff === 0 ? 'اليوم' : diff === 1 ? 'غداً' : `بعد ${diff} أيام`;
        html += `
            <div class="day-group"><div class="day-head">
                <span class="day-icon">📅</span>${formatDate(d)}
                <span class="day-when">${when}</span>
            </div>
            ${dayTasks.map(t => calTaskRow(t)).join('')}</div>`;
    });

    if (noDate.length > 0) {
        html += `
            <div class="day-group"><div class="day-head">
                <span class="day-icon">🔓</span>بدون موعد
                <span class="day-when">${noDate.length} مهام</span>
            </div>
            ${noDate.map(t => calTaskRow(t)).join('')}</div>`;
    }

    if (done.length > 0) {
        html += `
            <div class="day-group"><div class="day-head">
                <span class="day-icon">✅</span>المكتملة
                <span class="day-when">${done.length} مهام</span>
            </div>
            ${done.map(t => calTaskRow(t)).join('')}</div>`;
    }

    container.innerHTML = html;
}

function calTaskRow(t) {
    const pri = t.priority === 'high' ? '<span class="badge important">مهم</span>' : '<span class="badge low">أقل</span>';
    const noteCount = (t.notes && t.notes.length) || 0;
    const hasNote = noteCount > 0 || !!t.details;
    const notesChip = `
        <button class="tn-chip ${hasNote ? 'active' : ''}" onclick="event.stopPropagation(); openTaskNotesModal('${t._areaKey}', '${t._headingKey}', ${t.id})"
            title="${hasNote ? 'عرض ملاحظات المهمة' : 'إضافة ملاحظة لهذه المهمة'}">
            📝 ${noteCount || ''}
        </button>`;
    return `
        <div class="task-card ${t.priority === 'high' ? 'high-priority' : 'low-priority'} ${t.completed ? 'completed' : ''}" style="cursor:pointer" onclick="openEditTaskModal('${t._areaKey}', '${t._headingKey}', ${t.id})">
            <div class="priority-stack">${pri}</div>
            <div class="task-content">
                <div class="task-title">${esc(t.name)}</div>
                <div class="task-meta">
                    <span>🏢 ${esc(t._area)}</span>
                    <span>📌 ${esc(t._heading)}</span>
                    ${t.deadline ? `<span>by ${t.deadline}</span>` : ''}
                    ${notesChip}
                </div>
            </div>
        </div>`;
}

/* ===== Export / Import / Reset ===== */
function exportData() {
    const payload = { version: 2, data, notes };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hayaati-backup-' + new Date().toISOString().split('T')[0] + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('📤 تم تصدير البيانات');
    document.getElementById('addMenu').classList.remove('active');
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const parsed = JSON.parse(e.target.result);
            if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                if (parsed.version === 2 && parsed.data) {
                    data = parsed.data;
                    notes = Array.isArray(parsed.notes) ? parsed.notes : [];
                } else {
                    data = parsed;
                }
                if (currentArea && !data[currentArea]) currentArea = null;
                saveData();
                saveNotes();
                renderAreaList();
                renderDashboardFilters();
                renderTaskContent();
                if (currentView === 'dashboard') updateDashboard();
                if (currentView === 'calendar') renderCalendar();
                if (currentView === 'notes') renderNotes();
                showToast('📥 تم استيراد البيانات بنجاح');
            } else {
                showToast('ملف غير صالح', 'error');
            }
        } catch (err) {
            showToast('تعذر قراءة الملف', 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
    document.getElementById('addMenu').classList.remove('active');
}

function resetData() {
    confirmAction('إعادة تعيين', 'سيتم حذف جميع بياناتك الحالية والعودة للبيانات الافتراضية. هل أنت متأكد؟', () => {
        data = JSON.parse(JSON.stringify(defaultData));
        currentArea = Object.keys(data)[0];
        localStorage.removeItem(getUserDataKey(currentUser));
        saveData();
        renderAreaList();
        renderDashboardFilters();
        renderTaskContent();
        if (currentView === 'dashboard') updateDashboard();
        if (currentView === 'calendar') renderCalendar();
        showToast('تمت إعادة التعيين بنجاح');
    });
    document.getElementById('addMenu').classList.remove('active');
}

/* ===== WhatsApp Reminders ===== */
function buildWaUrl(text) {
    const phone = getWaPhone();
    const base = phone ? 'https://wa.me/' + phone : 'https://wa.me/';
    return base + '?text=' + encodeURIComponent(text);
}

function sendWhatsAppReminder(areaKey, headingKey, taskId) {
    const found = findTaskAndParent(areaKey, headingKey, taskId);
    if (!found) return;
    const t = found.task;
    const area = data[areaKey];
    const heading = area ? area.headings[headingKey] : null;

    let msg = '🔔 تذكير بمهمة\n';
    msg += '\n📌 ' + t.name;
    if (area) msg += '\n🏢 ' + area.name + (heading ? ' / ' + heading.name : '');
    if (t.deadline) msg += '\n📅 الموعد: ' + t.deadline + ' (' + dueLabel(t.deadline) + ')';
    if (t.estimate) msg += '\n⏱️ الوقت المقدر: ' + t.estimate + ' ساعة';
    if (t.details) msg += '\n\n📝 التفاصيل:\n' + t.details;
    msg += '\n\n✅ اضغط لإرسال هذا التذكير عبر الواتساب';

    window.open(buildWaUrl(msg), '_blank');
    showToast('📲 تم فتح واتساب مع رسالة التذكير');
}

function sendBulkReminder() {
    const urgentTasks = [];
    Object.keys(data || {}).forEach(aKey => {
        const area = data[aKey];
        if (!area || !area.headings) return;
        Object.values(area.headings).forEach(heading => {
            if (!heading || !heading.tasks) return;
            heading.tasks.forEach(t => {
                if (!t.completed && t.deadline && (isTaskUrgent(t.deadline) || isTaskOverdue(t.deadline))) {
                    urgentTasks.push({ ...t, _area: area.name, _heading: heading.name });
                }
            });
        });
    });

    if (urgentTasks.length === 0) {
        showToast('لا توجد مهام عاجلة للتذكير', 'warning');
        document.getElementById('addMenu').classList.remove('active');
        return;
    }

    let msg = '🔔 تذكيرات بالمهام المستحقة:\n';
    urgentTasks.slice(0, 20).forEach((t, i) => {
        msg += '\n' + (i + 1) + '. ' + t.name;
        msg += '\n   🏢 ' + t._area + (t._heading ? ' / ' + t._heading : '');
        if (t.deadline) msg += '\n   📅 ' + t.deadline + ' (' + dueLabel(t.deadline) + ')';
    });
    msg += '\n\n✅ أرسلها لترتيب أولوياتك';

    window.open(buildWaUrl(msg), '_blank');
    showToast('📲 تم فتح واتساب مع ' + urgentTasks.length + ' من التذكيرات');
    document.getElementById('addMenu').classList.remove('active');
}

function openWaSettingsModal() {
    document.getElementById('waPhone').value = getWaPhone();
    document.getElementById('addMenu').classList.remove('active');
    openModal('waSettingsModal');
}

function saveWaSettings() {
    const phone = document.getElementById('waPhone').value.trim().replace(/\D/g, '');
    setWaPhone(phone);
    closeModal('waSettingsModal');
    if (phone) showToast('✅ تم حفظ رقم الواتساب');
    else showToast('سيتم اختيار الرقم عند كل إرسال', 'warning');
}

/* ===== Notes ===== */
function renderNotes() {
    const container = document.getElementById('notesContent');
    if (!container) return;

    if (!notes.length) {
        container.innerHTML = `
            <div class="note-empty">
                <div style="font-size:3rem;margin-bottom:12px;">📝</div>
                <h3 style="color:var(--text);margin-bottom:6px;">لا توجد ملاحظات</h3>
                <p style="font-size:.9rem;">أنشئ ملاحظة لأي نقطة — فكرة، رقم، تفاصيل اجتماع أو أي شرح تريد حفظه</p>
                <br>
                <button class="btn btn-primary" onclick="openAddNoteModal()">+ ملاحظة جديدة</button>
            </div>`;
        return;
    }

    const sorted = [...notes].sort((a, b) =>
        (b.pinned === true ? 1 : 0) - (a.pinned === true ? 1 : 0) || (b.updated || b.created || 0) - (a.updated || a.created || 0)
    );

    container.innerHTML = '<div class="notes-grid">' + sorted.map(noteCardHtml).join('') + '</div>';
}

function noteCardHtml(n) {
    const content = (n.content || '').trim();
    return `
        <div class="note-card ${n.pinned ? 'pinned' : ''}">
            <div class="note-head">
                ${n.pinned ? '<span class="note-pin-tag">📌 مثبتة</span>' : ''}
                <div class="note-title">${esc(n.title || 'ملاحظة بدون عنوان')}</div>
            </div>
            ${content ? `<div class="note-content">${esc(content)}</div>` : '<div style="color:var(--text-muted);font-size:.85rem;">(بدون تفاصيل)</div>'}
            <div class="note-meta">
                <span>🗓️ ${formatShortDate(n.created || Date.now())}</span>
                <div class="note-actions">
                    <button class="icon-btn ${n.pinned ? 'toggled' : ''}" title="تثبيت في الأعلى" onclick="togglePinNote(${n.id})">📌</button>
                    <button class="icon-btn" title="تعديل" onclick="openEditNoteModal(${n.id})">✏️</button>
                    <button class="icon-btn danger" title="حذف" onclick="deleteNote(${n.id})">🗑️</button>
                </div>
            </div>
        </div>`;
}

function openAddNoteModal() {
    editingNoteId = null;
    document.getElementById('noteModalTitle').textContent = '📝 ملاحظة جديدة';
    document.getElementById('noteTitle').value = '';
    document.getElementById('noteContent').value = '';
    document.getElementById('notePinned').checked = false;
    document.getElementById('addMenu').classList.remove('active');
    closeAllModals();
    openModal('addNoteModal');
    setTimeout(() => document.getElementById('noteTitle').focus(), 60);
}

function openEditNoteModal(id) {
    const note = notes.find(n => n.id === id);
    if (!note) return;
    editingNoteId = id;
    document.getElementById('noteModalTitle').textContent = '✏️ تعديل ملاحظة';
    document.getElementById('noteTitle').value = note.title || '';
    document.getElementById('noteContent').value = note.content || '';
    document.getElementById('notePinned').checked = !!note.pinned;
    openModal('addNoteModal');
}

function saveNote() {
    const title = document.getElementById('noteTitle').value.trim();
    const content = document.getElementById('noteContent').value;
    const pinned = document.getElementById('notePinned').checked;

    if (!title.trim() && !content.trim()) {
        showToast('أدخل عنواناً أو تفاصيل للملاحظة', 'error');
        return;
    }

    if (editingNoteId) {
        const note = notes.find(n => n.id === editingNoteId);
        if (note) {
            note.title = title;
            note.content = content;
            note.pinned = pinned;
            note.updated = Date.now();
        }
    } else {
        notes.push({
            id: newTaskId(),
            title,
            content,
            pinned,
            created: Date.now(),
            updated: Date.now()
        });
    }

    saveNotes();
    renderNotes();
    closeModal('addNoteModal');
    showToast('✅ تم حفظ الملاحظة');
}

function togglePinNote(id) {
    const note = notes.find(n => n.id === id);
    if (!note) return;
    note.pinned = !note.pinned;
    note.updated = Date.now();
    saveNotes();
    renderNotes();
}

function deleteNote(id) {
    const note = notes.find(n => n.id === id);
    if (!note) return;
    confirmAction('حذف الملاحظة', note.title ? `هل تريد حذف "${note.title}"؟` : 'هل تريد حذف هذه الملاحظة؟', () => {
        notes = notes.filter(n => n.id !== id);
        saveNotes();
        renderNotes();
        showToast('تم حذف الملاحظة');
    });
}

function formatShortDate(ts) {
    try {
        return new Intl.DateTimeFormat('ar-OM', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ts));
    } catch (e) {
        return new Date(ts).toLocaleDateString();
    }
}

/* ===== Mail Import ===== */
function openMailImportModal() {
    const areaSelect = document.getElementById('mailArea');
    areaSelect.innerHTML = '<option value="">اختر منطقة</option>';
    Object.keys(data || {}).forEach(key => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = (data[key].icon || '') + ' ' + data[key].name;
        areaSelect.appendChild(opt);
    });
    if (currentArea) areaSelect.value = currentArea;

    const headingSelect = document.getElementById('mailHeading');
    headingSelect.innerHTML = '<option value="">اختر (أو يُنشأ تلقائياً)</option>';
    populateMailHeadings();

    document.getElementById('mailBody').value = '';
    document.getElementById('mailPreview').innerHTML = '';
    document.getElementById('addMenu').classList.remove('active');
    closeAllModals();
    openModal('mailImportModal');
    setTimeout(() => document.getElementById('mailBody').focus(), 60);
}

function populateMailHeadings() {
    const area = document.getElementById('mailArea').value;
    const headingSelect = document.getElementById('mailHeading');
    headingSelect.innerHTML = '<option value="">اختر (أو يُنشأ تلقائياً)</option>';
    if (area && data[area] && data[area].headings) {
        Object.keys(data[area].headings).forEach(key => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = data[area].headings[key].name;
            headingSelect.appendChild(opt);
        });
    }
}

const AR_MONTHS = {
    'يناير': 0, 'فبراير': 1, 'مارس': 2, 'أبريل': 3, 'ابريل': 3, 'مايو': 4, 'يونيو': 5, 'يوليو': 6,
    'أغسطس': 7, 'اغسطس': 7, 'سبتمبر': 8, 'أكتوبر': 9, 'اكتوبر': 9, 'نوفمبر': 10, 'ديسمبر': 11
};
const EN_MONTHS = {
    'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5, 'july': 6,
    'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
};

function toISODate(y, m, d) {
    const dt = new Date(y, m, d);
    if (isNaN(dt)) return '';
    const Y = dt.getFullYear();
    const M = String(dt.getMonth() + 1).padStart(2, '0');
    const D = String(dt.getDate()).padStart(2, '0');
    return Y + '-' + M + '-' + D;
}

function nextDateFromMonth(mIdx, day) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nowYear = today.getFullYear();
    let cand = new Date(nowYear, mIdx, day);
    if (cand < today) cand = new Date(nowYear + 1, mIdx, day);
    return cand;
}

function extractDeadline(text) {
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t) return '';

    // ISO: 2026-10-20
    let m = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (m) return toISODate(+m[1], +m[2] - 1, +m[3]);

    // dd/mm/yyyy or dd-mm-yyyy
    m = t.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
    if (m) {
        let y = +m[3];
        if (y < 100) y += 2000;
        return toISODate(y, +m[2] - 1, +m[1]);
    }

    // relative Arabic dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    m = t.match(/البارحة|خلال\s+(\d{1,2})\s+أيام|بعد\s+(\d{1,2})\s+أيام|في\s+(\d{1,2})\s+أيام|غداً|غدا|اليوم|بعد\s+غد|نهاية\s+\s*هذا\s+الأسبوع|الأسبوع\s+القادم|الأسبوع\s+المقبل/);
    if (m) {
        let days = null;
        if (m[0] === 'البارحة') days = -1;
        else if (m[0] === 'غداً' || m[0] === 'غدا') days = 1;
        else if (m[0] === 'بعد غد') days = 2;
        else if (m[0] === 'اليوم') days = 0;
        else if (m[1]) days = +m[1];
        else if (m[2]) days = +m[2];
        else if (m[3]) days = +m[3];
        else if (m[0] === 'نهاية هذا الأسبوع') days = 5 - today.getDay();
        else if (m[0] === 'الأسبوع القادم' || m[0] === 'الأسبوع المقبل') days = 7;
        if (days !== null) {
            const nd = new Date(today);
            nd.setDate(nd.getDate() + days);
            return toISODate(nd.getFullYear(), nd.getMonth(), nd.getDate());
        }
    }

    // Arabic month names: "20 أكتوبر" or "20 أكتوبر 2026"
    for (const name in AR_MONTHS) {
        const idx = t.indexOf(name);
        if (idx === -1) continue;
        const before = t.slice(Math.max(0, idx - 10), idx);
        const after = t.slice(idx + name.length, idx + name.length + 12);
        const dm = before.match(/(?:قبل|على|من|في|\s)?(\d{1,2})\s*$/);
        const ym = after.match(/\s*(\d{4})/);
        let day = dm ? +dm[1] : null;
        if (!day) {
            const am = after.match(/^\s*(\d{1,2})/);
            if (am) day = +am[1];
        }
        if (day && day >= 1 && day <= 31) {
            const year = ym && +ym[1] >= 2020 ? +ym[1] : null;
            const dt = year ? new Date(year, AR_MONTHS[name], day) : nextDateFromMonth(AR_MONTHS[name], day);
            if (!isNaN(dt)) return toISODate(dt.getFullYear(), dt.getMonth(), dt.getDate());
        }
    }

    // English month names: "20 October 2026" or "October 20"
    for (const name in EN_MONTHS) {
        const idx = t.toLowerCase().indexOf(name);
        if (idx === -1) continue;
        const seg = t.slice(Math.max(0, idx - 12), idx + name.length + 14);
        const em = seg.match(/(\d{1,2})\s*([A-Za-z]+)\s*(\d{2,4})?/);
        if (em && EN_MONTHS[em[2].toLowerCase()] !== undefined) {
            let day = +em[1];
            const year = em[3] ? +em[3] : null;
            const mIdx = EN_MONTHS[em[2].toLowerCase()];
            if (day >= 1 && day <= 31) {
                const dt = year ? new Date(year, mIdx, day) : nextDateFromMonth(mIdx, day);
                if (!isNaN(dt)) return toISODate(dt.getFullYear(), dt.getMonth(), dt.getDate());
            }
        }
    }

    return '';
}

function extractSender(text) {
    const m = text.match(/^(?:from|من)\s*[:：]\s*([^\n]+)/im);
    if (m) {
        const raw = m[1].trim();
        const em = raw.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
        const nm = raw.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').trim();
        if (em && nm && nm !== em[0]) return nm + ' <' + em[0] + '>';
        return em ? em[0] : nm;
    }
    return '';
}

function extractTitle(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const subj = l.match(/^(?:subject|الموضوع|عنوان)\s*[:：]\s*(.+)/i);
        if (subj) return cleanSubject(subj[1]);
        if (/^(re|fw|fwd|رد|إعادة|اعادة|عاجل)\s*[:：]/i.test(l)) {
            const inner = l.replace(/^(re|fw|fwd|رد|إعادة|اعادة|عاجل)\s*[:：]\s*/i, '');
            if (inner.trim()) return cleanSubject(inner.trim());
        }
    }
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/^(from|to|cc|bcc|date|sent|من|إلى|الى|مرسل|تاريخ)\s*[:：]/i.test(l)) continue;
        if (/^(السلام|مرحباً|مرحبا|تحية|حياك الله|أخي|أختي|عزيزي|كيف حالك|السيد|السيدة)/i.test(l)) continue;
        if (l.length < 4) continue;
        if (/^(http|www\.)/i.test(l)) continue;
        return l.replace(/^[\s\-•*·]+/, '').slice(0, 80);
    }
    return 'مهمة جديدة من البريد';
}

function cleanSubject(s) {
    return s.replace(/^(\s*(re|fw|fwd|رد|إعادة|اعادة)\s*[:：]\s*)+/gi, '').replace(/["'“”]/g, '').trim() || 'مهمة جديدة من البريد';
}

function extractPriority(text, deadline) {
    const t = text.toLowerCase();
    if (/عاجل|عاجلة|urgent|asap|فوراً|فورا|مهم جدا|مهم جداً|high priority|الان|الآن|deadline today/.test(t)) return 'high';
    if (deadline) {
        const days = daysUntil(deadline);
        if (!isNaN(days) && days >= 0 && days <= 3) return 'high';
    }
    return 'low';
}

function showMailPreview() {
    const textStr = document.getElementById('mailBody').value.trim();
    const preview = document.getElementById('mailPreview');
    if (!textStr) { preview.innerHTML = ''; return; }

    const info = parseMail(textStr);
    const comment = document.getElementById('mailHeading').value
        ? ''
        : '<div class="pv-item" style="color:#b7791f;">ℹ️ سيتم إنشاء عنوان جديد تلقائياً باسم المهمة</div>';

    preview.innerHTML = `
        <div class="pv-label">النتيجة المتوقعة:</div>
        <div class="pv-item"><b>العنوان</b> ${esc(info.title)}</div>
        <div class="pv-item"><b>المرسل</b> ${info.sender ? esc(info.sender) : '—'}</div>
        <div class="pv-item"><b>الموعد</b> ${info.deadline || 'غير محدد'}</div>
        <div class="pv-item"><b>الأولوية</b> ${info.priority === 'high' ? '🔴 مهم' : '🟢 أقل أهمية'}</div>
        ${comment}`;
}

function parseMail(text) {
    const deadline = extractDeadline(text);
    return {
        title: extractTitle(text),
        sender: extractSender(text),
        deadline,
        priority: extractPriority(text, deadline)
    };
}

function slugify(name) {
    return name.toLowerCase().replace(/[^\w\u0600-\u06FF\s-]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}

function importMailAsTask() {
    const raw = document.getElementById('mailBody').value.trim();
    if (!raw) { showToast('الصق محتوّى الإيميل أولاً', 'error'); return; }

    const area = document.getElementById('mailArea').value;
    if (!area || !data[area]) { showToast('اختر المنطقة الوجهة', 'error'); return; }

    const info = parseMail(raw);
    if (!data[area].headings) data[area].headings = {};

    let headingKey = document.getElementById('mailHeading').value;
    if (!headingKey) {
        headingKey = slugify(info.title) || ('بريد_' + Date.now());
        let baseKey = headingKey;
        let i = 1;
        while (data[area].headings[headingKey]) {
            headingKey = baseKey + '_' + i;
            i++;
        }
        data[area].headings[headingKey] = { name: info.title, tasks: [] };
    }
    if (!data[area].headings[headingKey]) {
        data[area].headings[headingKey] = { name: info.title, tasks: [] };
    }

    const details = [
        '📧 مستوردة من بريد',
        info.sender ? 'المرسل: ' + info.sender : 'المرسل: غير معروف',
        'التاريخ: ' + formatShortDate(Date.now()),
        '',
        '────────────',
        '',
        raw
    ].join('\n');

    data[area].headings[headingKey].tasks.push({
        id: newTaskId(),
        name: info.title,
        deadline: info.deadline,
        estimate: 0,
        priority: info.priority,
        completed: false,
        details,
        subtasks: []
    });

    saveData();
    closeModal('mailImportModal');
    switchArea(area);
    currentArea = area;
    switchView('tasks');
    showToast('✅ تم تحويل البريد إلى مهمة في "' + data[area].name + '"');
}

/* ===== Init ===== */
async function init() {
    await ensureDefaultUsers();

    document.addEventListener('click', (e) => {
        document.querySelectorAll('.add-menu.active, .dropdown-menu.active').forEach(m => {
            if (!m.closest('.add-wrap') && !m.closest('.task-actions') && !m.closest('.user-wrap')) {
                m.classList.remove('active');
            }
        });
    });

    document.getElementById('loginUser').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('loginPass').focus();
    });
    document.getElementById('regUser').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('regPass').focus();
    });
    document.getElementById('regPass').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('regPass2').focus();
    });

    const sessionUser = getSession();
    if (sessionUser && getUsers()[sessionUser]) {
        await openApp(sessionUser);
    } else {
        showLogin();
    }
}

function showLogin() {
    clearSession();
    document.getElementById('loginUser').value = '';
    document.getElementById('loginPass').value = '';
    showAuthMsg('loginMsg', '');
    showAuthMsg('regMsg', '');
    switchAuthTab('login');
    document.getElementById('authOverlay').classList.remove('closed');
    setTimeout(() => document.getElementById('loginUser').focus(), 100);
}

async function openApp(user) {
    currentUser = user;

    document.getElementById('userAvatar').textContent = user.charAt(0).toUpperCase();
    document.getElementById('userName').textContent = user;

    loadData();
    loadNotes();
    renderAreaList();
    renderDashboardFilters();
    if (data && Object.keys(data).length > 0) {
        switchArea(Object.keys(data)[0]);
    }
    renderCalendar();
    document.getElementById('dashDate').textContent = formatDate(new Date());
    document.getElementById('authOverlay').classList.add('closed');
    reconnectCloud();
}

function reconnectCloud() {
    initFirebase();
    if (!fbEnabled || !fbAuth) return;
    const user = currentUser;
    if (!user) return;

    if (fbAuth.currentUser) {
        fbUser = fbAuth.currentUser;
        afterCloudConnect(user);
        updateSyncUI();
        return;
    }
    fbAuth.onAuthStateChanged((u) => {
        if (u && !fbUser) {
            fbUser = u;
            afterCloudConnect(user);
            updateSyncUI();
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}