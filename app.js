import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ==========================================
// 1. FIREBASE SETUP
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyB4zPjy_s8so3kuP8GEDLKQ-Jff3rYsTZ0",
  authDomain: "fixonet.firebaseapp.com",
  projectId: "fixonet"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ==========================================
// 2. GLOBAL STATE (Context Equivalents)
// ==========================================
// 2. DOM ELEMENTS (Ensure these exist in index.html)
// ==========================================
const identityScreen = document.getElementById('identity-screen');
const mainApp = document.getElementById('main-app'); // Renamed from dashboard-screen
const aliasInput = document.getElementById('alias-input');
const keyInput = document.getElementById('key-input');
const initBtn = document.getElementById('init-btn');
const errorText = document.getElementById('error-message');
// ==========================================
const state = {
  
  userId: localStorage.getItem('@superhuman_identity_web'),
  unallocated: parseFloat(localStorage.getItem('@superhuman_unallocated')) || 0,
  habits: JSON.parse(localStorage.getItem('@superhuman_habits_pure')) ||[],
  focusHistory: JSON.parse(localStorage.getItem('@superhuman_focus')) ||[],
  localDirectives: JSON.parse(localStorage.getItem('@superhuman_directives')) || [],
  sharedDirectives:[],
  
  // Timer State
  activeFocusDirectiveId: null,
  timerInterval: null,
  timeLeft: 25 * 60,
  initialTime: 25 * 60,
  isActive: false,
  
  // Link State
  isLinked: false,
  partnerId: '',
  roomId: null,
  pendingRequest: null,
  sharedRoomData: null,

  // UI State
  currentTab: 'tab-habits',
  viewingDirectiveId: null,
  selectedDays:[0,1,2,3,4,5,6]
};

// ==========================================
// 3. UTILS & HELPERS
// ==========================================
const generateTag = () => Math.floor(1000 + Math.random() * 9000).toString();
const getTodayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const saveLocal = () => {
  localStorage.setItem('@superhuman_unallocated', state.unallocated.toString());
  localStorage.setItem('@superhuman_habits_pure', JSON.stringify(state.habits));
  localStorage.setItem('@superhuman_focus', JSON.stringify(state.focusHistory));
  localStorage.setItem('@superhuman_directives', JSON.stringify(state.localDirectives));
};

// ==========================================
// 4. FIREBASE LISTENERS (Multiplayer Sync)
// ==========================================
let unsubUser, unsubSharedDirs, unsubRoom;

function setupFirebaseListeners() {
  if (!state.userId) return;

  // 1. Listen to User Doc (Uplink requests / Sync status)
  unsubUser = onSnapshot(doc(db, 'users', state.userId), (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      state.isLinked = !!(data.activeFocusRoom && data.focusPartner);
      state.partnerId = data.focusPartner || '';
      state.roomId = data.activeFocusRoom || null;
      state.pendingRequest = data.pendingFocusRequest || null;
      
      if (state.pendingRequest) showUplinkPopup();
      else hideUplinkPopup();
      
      updateFocusUI();
      if(state.roomId) setupRoomListener(state.roomId);
    }
  });

  // 2. Listen to Shared Directives
  const q = query(collection(db, 'shared_directives'), where('participants', 'array-contains', state.userId));
  unsubSharedDirs = onSnapshot(q, (snapshot) => {
    const fetched =[];
    snapshot.forEach(docSnap => fetched.push({ ...docSnap.data(), id: docSnap.id }));
    state.sharedDirectives = fetched;
    if(state.currentTab === 'tab-directives') renderDirectives();
    if(state.viewingDirectiveId) renderDirectiveDetail(state.viewingDirectiveId);
  });
}

function setupRoomListener(roomId) {
  if (unsubRoom) unsubRoom();
  unsubRoom = onSnapshot(doc(db, 'focus_rooms', roomId), (snap) => {
    if (snap.exists()) {
      state.sharedRoomData = snap.data();
      const sd = state.sharedRoomData;
      
      if (sd.duration) state.initialTime = Number(sd.duration);

      if (sd.status === 'running') {
        state.isActive = true;
        const elapsed = Math.max(0, Math.floor((Date.now() - Number(sd.startTime)) / 1000));
        const trueRemaining = Math.max(0, Number(sd.allocatedTime) - elapsed);
        state.timeLeft = trueRemaining;
        startLocalTimerLoop();
      } else {
        state.isActive = false;
        stopLocalTimerLoop();
        state.timeLeft = Number(sd.allocatedTime);
      }
      updateFocusUI();
    }
  });
}

// ==========================================
// 5. CORE INITIALIZATION
// ==========================================

function bootApp() {
  if (state.userId) {
    // Safety check to prevent the "Cannot read properties of null" error
    if (identityScreen && mainApp) {
      identityScreen.classList.add('hidden');
      mainApp.classList.remove('hidden');
      
      const settingsId = document.getElementById('settings-user-id');
      if (settingsId) settingsId.innerText = state.userId;
      
      setupFirebaseListeners();
      renderAll();
    }
  } else {
    if (identityScreen && mainApp) {
      identityScreen.classList.remove('hidden');
      mainApp.classList.add('hidden');
    }
  }
}

document.getElementById('init-btn').addEventListener('click', async () => {
  const alias = document.getElementById('alias-input').value.trim().toLowerCase();
  const key = document.getElementById('key-input').value.trim();
  const err = document.getElementById('error-message');

  if (alias.length < 3) return err.innerText = 'ALIAS MUST BE > 2 CHARS';
  if (!key) return err.innerText = 'KEY REQUIRED';
  err.innerText = 'PROCESSING...';

  try {
    let uniqueId = '', isAvailable = false;
    while (!isAvailable) {
      const testId = `${alias}#${generateTag()}`;
      const docRef = doc(db, 'users', testId);
      const snap = await getDoc(docRef);
      if (!snap.exists()) {
        await setDoc(docRef, { baseName: alias, tag: testId.split('#')[1], accessKey: key, createdAt: new Date().toISOString() });
        uniqueId = testId;
        isAvailable = true;
      }
    }
    localStorage.setItem('@superhuman_identity_web', uniqueId);
    state.userId = uniqueId;
    bootApp();
  } catch (e) {
    err.innerText = e.code === 'permission-denied' ? 'ACCESS DENIED: INVALID KEY' : 'NETWORK ERROR';
  }
});

// ==========================================
// 6. ROUTING & UI REFRESH
// ==========================================
function switchTab(tabId) {
  state.currentTab = tabId;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active-tab'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(tabId).classList.add('active-tab');
  document.querySelector(`.nav-btn[data-tab="${tabId}"]`).classList.add('active');
  
  let title = 'PROTOCOL';
  if(tabId === 'tab-directives') title = 'DIRECTIVES';
  if(tabId === 'tab-focus') title = 'DEEP WORK';
  if(tabId === 'tab-analytics') { title = 'TELEMETRY'; renderAnalytics(); }
  if(tabId === 'tab-settings') title = 'CONFIGURE';
  document.getElementById('screen-title').innerText = title;

  renderAll();
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', (e) => switchTab(e.currentTarget.dataset.tab));
});

function renderAll() {
  if (state.currentTab === 'tab-habits') renderHabits();
  if (state.currentTab === 'tab-directives') renderDirectives();
  updateHeaderBadge();
}

function updateHeaderBadge() {
  const badge = document.getElementById('header-badge');
  const globalStreak = calculateGlobalStreak();
  if (state.currentTab === 'tab-directives') {
    badge.innerText = `POOL: $${state.unallocated.toLocaleString()}`;
    badge.classList.remove('active');
  } else {
    badge.innerText = `${globalStreak} DAY STREAK`;
    if(globalStreak > 0) badge.classList.add('active'); else badge.classList.remove('active');
  }
}

// ==========================================
// 7. HABITS LOGIC
// ==========================================
function renderHabits() {
  const list = document.getElementById('habits-list');
  list.innerHTML = '';
  const todayStr = getTodayStr();
  const dayOfWeek = new Date().getDay();

  // 1. Pinned Directives
  const allDirs =[...state.localDirectives, ...state.sharedDirectives];
  const pinnedTasks = allDirs.filter(d => d.isPinned && d.type === 'TASK');
  
  pinnedTasks.forEach(task => {
    list.innerHTML += createListItemHTML(task.id, task.title, task.isCompleted, true, 0);
  });

  // 2. Scheduled Habits
  const todaysHabits = state.habits.filter(h => h.frequency.includes(dayOfWeek));
  todaysHabits.forEach(habit => {
    const isCompleted = !!habit.history[todayStr];
    list.innerHTML += createListItemHTML(habit.id, habit.name, isCompleted, false, calcStreak(habit));
  });

  if(list.innerHTML === '') list.innerHTML = '<p class="section-label" style="text-align:center;">NO TASKS TODAY.</p>';

  // Attach Listeners
  list.querySelectorAll('.list-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if(e.target.closest('.delete-habit-btn')) return; // handled separately
      const id = el.dataset.id;
      const isDir = el.dataset.isdir === 'true';
      if(isDir) toggleDirectiveTask(id, el.classList.contains('completed'));
      else toggleHabit(id, todayStr);
    });
  });

  list.querySelectorAll('.delete-habit-btn').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      state.habits = state.habits.filter(h => h.id !== e.currentTarget.dataset.id);
      saveLocal(); renderHabits();
    });
  });
}

function createListItemHTML(id, name, isCompleted, isDir, streak) {
  return `
    <div class="list-item ${isCompleted ? 'completed' : ''} ${isDir ? 'directive' : ''}" data-id="${id}" data-isdir="${isDir}">
      <div class="item-left">
        <div class="checkbox">${isCompleted ? '<i class="fa-solid fa-check"></i>' : ''}</div>
        <span class="item-name">${isDir ? '<i class="fa-solid fa-bolt" style="color:#AA00FF; margin-right:5px;"></i>' : ''}${name}</span>
      </div>
      <div class="item-right">
        ${streak > 0 ? `<span style="color:#00FFFF; font-weight:bold;">${streak} <i class="fa-solid fa-bolt"></i></span>` : ''}
        ${!isDir ? `<button class="icon-btn delete-habit-btn" data-id="${id}" style="color:#FF3333;"><i class="fa-solid fa-xmark"></i></button>` : ''}
      </div>
    </div>
  `;
}

// Add Habit Form
document.querySelectorAll('.day-badge').forEach(b => {
  b.addEventListener('click', (e) => {
    const day = parseInt(e.target.dataset.day);
    if(state.selectedDays.includes(day)) state.selectedDays = state.selectedDays.filter(d => d !== day);
    else state.selectedDays.push(day);
    e.target.classList.toggle('active');
  });
});

document.getElementById('add-habit-btn').addEventListener('click', () => {
  const input = document.getElementById('new-habit-input');
  if(!input.value.trim() || state.selectedDays.length === 0) return;
  state.habits.push({ id: Date.now().toString(), name: input.value.trim().toUpperCase(), frequency:[...state.selectedDays], history: {}, totalCompletions: 0 });
  input.value = ''; saveLocal(); renderHabits();
});

function toggleHabit(id, dateStr) {
  const habit = state.habits.find(h => h.id === id);
  if(habit.history[dateStr]) { delete habit.history[dateStr]; habit.totalCompletions--; }
  else { habit.history[dateStr] = true; habit.totalCompletions++; }
  saveLocal(); renderHabits(); updateHeaderBadge();
}

function calcStreak(habit) {
  let streak = 0, checkDate = new Date();
  for(let i=0; i<365; i++) {
    const dStr = checkDate.toISOString().split('T')[0];
    if(habit.frequency.includes(checkDate.getDay())) {
      if(habit.history[dStr]) streak++; else if(dStr !== getTodayStr()) break;
    }
    checkDate.setDate(checkDate.getDate()-1);
  }
  return streak;
}

function calculateGlobalStreak() {
  let streak = 0, checkDate = new Date();
  checkDate.setDate(checkDate.getDate() - 1); 
  for (let i = 0; i < 365; i++) {
    const dStr = checkDate.toISOString().split('T')[0];
    const sched = state.habits.filter(h => h.frequency.includes(checkDate.getDay()));
    if (sched.length > 0) {
      if (sched.every(h => h.history[dStr])) streak++; else break; 
    }
    checkDate.setDate(checkDate.getDate() - 1);
  }
  const tStr = getTodayStr(), tHabits = state.habits.filter(h => h.frequency.includes(new Date().getDay()));
  if (tHabits.length > 0 && tHabits.every(h => h.history[tStr])) streak++;
  return streak;
}

// ==========================================
// 8. DIRECTIVES MATH & UI
// ==========================================
function getCombinedDirectives() { return[...state.localDirectives, ...state.sharedDirectives]; }

function getDirectiveStats(id) {
  const all = getCombinedDirectives();
  const dir = all.find(d => d.id === id);
  if(!dir) return { progress:0, currentStr:'', targetStr:'', isComplete:false, totalTime:0 };

  // Recurse Time
  const getTimeMap = (dId) => {
    let map = {};
    const d = all.find(x => x.id === dId);
    if(d?.timeInvested) Object.entries(d.timeInvested).forEach(([u,m]) => map[u] = (map[u]||0)+m);
    all.filter(x => x.parentId === dId).forEach(c => {
      Object.entries(getTimeMap(c.id)).forEach(([u,m]) => map[u] = (map[u]||0)+m);
    });
    return map;
  };
  const timeMap = getTimeMap(id);
  const totalTime = Object.values(timeMap).reduce((a,b)=>a+b,0);
  const children = all.filter(d => d.parentId === id);

  let p = 0, cStr = '', tStr = '', done = false;

  if(children.length > 0) {
    let totP = 0; children.forEach(c => totP += getDirectiveStats(c.id).progress);
    p = totP / children.length; cStr = `${Math.floor(p*100)}%`; tStr='100%'; done = p>=1;
  } else {
    if(dir.type === 'FINANCE') { p = dir.target>0 ? Math.min(dir.current/dir.target, 1) : 0; cStr = `$${dir.current}`; done = p>=1; }
    else if(dir.type === 'TIME') { p = dir.target>0 ? Math.min(totalTime/dir.target, 1) : 0; cStr = `${Math.floor(totalTime/60)}h ${totalTime%60}m`; done = p>=1; }
    else { p = dir.isCompleted?1:0; cStr = dir.isCompleted?'DONE':'PENDING'; done = dir.isCompleted; }
  }
  return { progress: p, currentStr: cStr, targetStr: tStr, isComplete: done, totalTime };
}

function generateSVGCircle(progress, isDone, isShared) {
  const r = 40, circ = 2 * Math.PI * r, off = circ - (progress * circ);
  const col = isDone ? '#00FFFF' : (isShared ? '#AA00FF' : '#FFF');
  return `
    <svg width="90" height="90" viewBox="0 0 90 90" style="transform: rotate(-90deg);">
      <circle cx="45" cy="45" r="${r}" stroke="#222" stroke-width="6" fill="none" />
      <circle cx="45" cy="45" r="${r}" stroke="${col}" stroke-width="6" fill="none" stroke-dasharray="${circ}" stroke-dashoffset="${off}" stroke-linecap="round" />
    </svg>
    <div class="circle-text">${Math.floor(progress * 100)}%</div>
  `;
}

function renderDirectives() {
  const grid = document.getElementById('directives-grid');
  grid.innerHTML = '';
  const roots = getCombinedDirectives().filter(d => !d.parentId);
  
  roots.forEach(r => {
    const stats = getDirectiveStats(r.id);
    const div = document.createElement('div');
    div.className = 'goal-circle';
    div.innerHTML = `
      ${r.isShared ? '<i class="fa-solid fa-network-wired shared-badge"></i>' : ''}
      <div class="svg-wrapper">${generateSVGCircle(stats.progress, stats.isComplete, r.isShared)}</div>
      <div class="goal-title" style="${stats.isComplete?'color:#00FFFF':''}">${r.title}</div>
      <div class="goal-subtext">${stats.currentStr}</div>
    `;
    div.onclick = () => showDirectiveDetail(r.id);
    grid.appendChild(div);
  });
}

// INJECT CAPITAL POOL
document.getElementById('inject-capital-btn').onclick = () => {
  const val = parseFloat(document.getElementById('inject-capital-input').value);
  if(val>0) { state.unallocated += val; saveLocal(); updateHeaderBadge(); document.getElementById('inject-capital-input').value=''; }
};

// ADD MASTER DIRECTIVE
document.getElementById('add-master-directive-btn').onclick = () => {
  const title = prompt("MASTER PROJECT NAME:");
  if(title) {
    const newDir = { id: Date.now().toString(), parentId: null, title: title.toUpperCase(), type: 'TASK', target: 1, current: 0, isCompleted: false, isPinned: false, isShared: false, participants:[state.userId], createdAt: new Date().toISOString() };
    state.localDirectives.push(newDir); saveLocal(); renderDirectives();
  }
};

// ==========================================
// 9. DIRECTIVE DETAIL VIEW
// ==========================================
function showDirectiveDetail(id) {
  state.viewingDirectiveId = id;
  document.getElementById('tab-directives').style.display = 'none';
  document.getElementById('tab-directive-detail').style.display = 'block';
  renderDirectiveDetail(id);
}

document.getElementById('back-to-directives').onclick = () => {
  state.viewingDirectiveId = null;
  document.getElementById('tab-directive-detail').style.display = 'none';
  document.getElementById('tab-directives').style.display = 'block';
  renderDirectives();
};

async function renderDirectiveDetail(id) {
  const dir = getCombinedDirectives().find(d => d.id === id);
  if(!dir) return;
  const stats = getDirectiveStats(id);
  const children = getCombinedDirectives().filter(d => d.parentId === id);

  document.getElementById('detail-stats').innerHTML = `
    <div style="position:relative; width:120px; height:120px;">
      <svg width="120" height="120" viewBox="0 0 120 120" style="transform: rotate(-90deg);">
        <circle cx="60" cy="60" r="55" stroke="#222" stroke-width="8" fill="none"/>
        <circle cx="60" cy="60" r="55" stroke="${stats.isComplete?'#00FFFF':'#FFF'}" stroke-width="8" fill="none" stroke-dasharray="345.5" stroke-dashoffset="${345.5 - (stats.progress*345.5)}" stroke-linecap="round"/>
      </svg>
      <div style="position:absolute; top:0; left:0; width:100%; height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center;">
        <span style="font-size:24px; font-weight:bold;">${Math.floor(stats.progress*100)}%</span>
        <span style="font-size:10px; color:#666;">${stats.currentStr}</span>
      </div>
    </div>
  `;

  // Sharing Setup
  const shareBox = document.getElementById('share-directive-box');
  if(!dir.parentId && !dir.isShared) shareBox.style.display = 'flex'; else shareBox.style.display = 'none';
  
  // Render Sub-Directives
  const list = document.getElementById('sub-directives-list');
  list.innerHTML = '';
  children.forEach(c => {
    const cStats = getDirectiveStats(c.id);
    const hasChild = getCombinedDirectives().some(d=>d.parentId===c.id);
    
    let actionsHTML = '';
    if(!hasChild && (c.type==='TASK'||c.type==='TIME')) {
      actionsHTML = `
        <div style="display:flex; justify-content:space-between; margin-top:15px; border-top:1px solid #222; padding-top:10px;">
          <button class="icon-btn toggle-task-btn" data-id="${c.id}"><i class="fa-regular ${c.isCompleted?'fa-circle-check" style="color:#00FFFF"':'fa-circle"'}"></i></button>
          <button class="dashed-btn pin-task-btn" data-id="${c.id}" style="margin:0; width:auto; padding:5px 10px; ${c.isPinned?'background:#00FFFF; color:#000':''}"><i class="fa-solid fa-bolt"></i> PIN</button>
        </div>`;
    } else if(!hasChild && c.type==='FINANCE' && !cStats.isComplete) {
      actionsHTML = `
        <div style="display:flex; margin-top:15px; border-top:1px solid #222; padding-top:10px;">
          <input type="number" id="alloc-${c.id}" placeholder="AMT" style="margin-right:10px;">
          <button class="btn alloc-btn" data-id="${c.id}" style="width:auto; padding:0 15px;">INJECT</button>
        </div>`;
    }

    list.innerHTML += `
      <div class="list-item" style="flex-direction:column; align-items:stretch; cursor:default;">
        <div style="display:flex; justify-content:space-between; cursor:pointer;" onclick="showDirectiveDetail('${c.id}')">
          <span style="font-weight:bold; ${cStats.isComplete?'color:#00FFFF; text-decoration:line-through;':''}">${c.title}</span>
          <span style="color:#666; font-size:12px;">${cStats.currentStr}</span>
        </div>
        ${actionsHTML}
      </div>`;
  });

  // Attach Sub-Directive Events
  document.querySelectorAll('.toggle-task-btn').forEach(b => b.onclick = (e) => toggleDirectiveTask(e.currentTarget.dataset.id));
  document.querySelectorAll('.pin-task-btn').forEach(b => b.onclick = (e) => togglePin(e.currentTarget.dataset.id));
  document.querySelectorAll('.alloc-btn').forEach(b => b.onclick = (e) => {
    const id = e.currentTarget.dataset.id;
    const val = parseFloat(document.getElementById(`alloc-${id}`).value);
    allocateFunds(id, val);
  });
}

// Logic implementations for Directives
async function toggleDirectiveTask(id, forceValue=null) {
  const dir = getCombinedDirectives().find(d=>d.id===id);
  const newVal = forceValue !== null ? !forceValue : !dir.isCompleted;
  if(dir.isShared) await updateDoc(doc(db,'shared_directives',id), {isCompleted: newVal});
  else { dir.isCompleted = newVal; saveLocal(); }
  if(state.viewingDirectiveId) renderDirectiveDetail(state.viewingDirectiveId);
  renderHabits();
}

async function togglePin(id) {
  const dir = getCombinedDirectives().find(d=>d.id===id);
  if(dir.isShared) await updateDoc(doc(db,'shared_directives',id), {isPinned: !dir.isPinned});
  else { dir.isPinned = !dir.isPinned; saveLocal(); }
  renderDirectiveDetail(state.viewingDirectiveId);
}

async function allocateFunds(id, amount) {
  if(!amount || state.unallocated < amount) return alert("INSUFFICIENT FUNDS");
  const dir = getCombinedDirectives().find(d=>d.id===id);
  state.unallocated -= amount;
  if(dir.isShared) {
    const myC = (dir.contributions?.[state.userId]||0)+amount;
    await updateDoc(doc(db,'shared_directives',id), { current: dir.current+amount, [`contributions.${state.userId}`]: myC });
  } else {
    dir.current += amount; saveLocal();
  }
  updateHeaderBadge();
  renderDirectiveDetail(state.viewingDirectiveId);
}

document.getElementById('target-lock-btn').onclick = () => {
  state.activeFocusDirectiveId = state.viewingDirectiveId;
  const dir = getCombinedDirectives().find(d=>d.id===state.viewingDirectiveId);
  document.getElementById('focus-target-badge').innerText = `TARGET LOCKED: ${dir.title}`;
  document.getElementById('focus-target-badge').classList.add('locked');
  switchTab('tab-focus');
};

document.getElementById('delete-directive-btn').onclick = async () => {
  if(!confirm("DELETE TARGET & SUB-TARGETS?")) return;
  const id = state.viewingDirectiveId;
  const toDel = [id];
  const getC = (pId) => { getCombinedDirectives().filter(d=>d.parentId===pId).forEach(c=>{toDel.push(c.id); getC(c.id);}); };
  getC(id);

  const isShared = getCombinedDirectives().find(d=>d.id===id)?.isShared;
  if(isShared) {
    const batch = writeBatch(db);
    toDel.forEach(dId => batch.delete(doc(db, 'shared_directives', dId)));
    await batch.commit();
  } else {
    state.localDirectives = state.localDirectives.filter(d => !toDel.includes(d.id));
    saveLocal();
  }
  if(state.activeFocusDirectiveId === id) { state.activeFocusDirectiveId = null; updateFocusUI(); }
  document.getElementById('back-to-directives').click();
};

document.getElementById('show-add-sub-btn').onclick = () => document.getElementById('add-sub-form').classList.remove('hidden');
document.getElementById('sub-type-select').onchange = (e) => {
  document.getElementById('sub-target-input').style.display = e.target.value === 'TASK' ? 'none' : 'block';
};
document.getElementById('confirm-add-sub').onclick = async () => {
  const title = document.getElementById('sub-title-input').value.trim().toUpperCase();
  const type = document.getElementById('sub-type-select').value;
  const target = parseFloat(document.getElementById('sub-target-input').value) || 0;
  if(!title) return;

  const p = getCombinedDirectives().find(d=>d.id===state.viewingDirectiveId);
  const newDir = { id: Date.now().toString(), parentId: p.id, title, type, target: type==='TIME'?target*60:target, current:0, isCompleted:false, isPinned:false, isShared:p.isShared, participants:p.participants, timeInvested:{[state.userId]:0}, createdAt: new Date().toISOString() };
  if(newDir.type==='FINANCE') newDir.contributions = {[state.userId]:0};

  if(p.isShared) await setDoc(doc(db, 'shared_directives', newDir.id), newDir);
  else { state.localDirectives.push(newDir); saveLocal(); }
  
  document.getElementById('add-sub-form').classList.add('hidden');
  document.getElementById('sub-title-input').value = '';
  renderDirectiveDetail(p.id);
};

// ==========================================
// 10. FOCUS TIMER & SYNDICATE
// ==========================================
function formatTime(secs) {
  const m = Math.floor(secs/60), s = secs%60;
  return `${m<10?'0':''}${m}:${s<10?'0':''}${s}`;
}

function updateFocusUI() {
  document.getElementById('timer-display').innerText = formatTime(state.timeLeft);
  document.getElementById('timer-status').innerText = state.isActive ? "PROTOCOL ACTIVE" : "SYSTEM IDLE";
  document.getElementById('timer-display').className = state.isActive ? 'timer-text active' : 'timer-text';
  document.getElementById('toggle-timer-btn').innerHTML = state.isActive ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
  
  const b = document.getElementById('sync-badge-btn');
  if(state.isLinked) {
    b.classList.add('active');
    document.getElementById('sync-text').innerText = `UPLINK: ${state.partnerId.split('#')[0].toUpperCase()}`;
  } else {
    b.classList.remove('active');
    document.getElementById('sync-text').innerText = "SOLO INSTANCE";
  }

  // History Render
  const hl = document.getElementById('focus-history-list');
  hl.innerHTML = state.focusHistory.slice(0,4).map(s => `
    <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
      <span style="color:#FFF;">${s.date}</span>
      <span style="color:#00FFFF; font-weight:bold;">${s.minutes} MIN</span>
    </div>
  `).join('');
}

document.querySelectorAll('.preset-btn').forEach(b => {
  b.onclick = async (e) => {
    if(state.isActive) return;
    document.querySelectorAll('.preset-btn').forEach(x=>x.classList.remove('active'));
    e.target.classList.add('active');
    const m = parseInt(e.target.dataset.mins);
    state.initialTime = m*60; state.timeLeft = m*60;
    if(state.isLinked && state.roomId) await updateDoc(doc(db,'focus_rooms',state.roomId), {status:'idle', duration:m*60, allocatedTime:m*60});
    updateFocusUI();
  }
});

document.getElementById('toggle-timer-btn').onclick = async () => {
  if(state.isLinked && state.roomId) {
    const ref = doc(db, 'focus_rooms', state.roomId);
    if(!state.isActive) await updateDoc(ref, {status:'running', startTime:Date.now(), allocatedTime:state.timeLeft});
    else await updateDoc(ref, {status:'paused', allocatedTime:state.timeLeft});
  } else {
    if(!state.isActive) startLocalTimerLoop(); else stopLocalTimerLoop();
  }
};

document.getElementById('reset-timer-btn').onclick = async () => {
  if(state.isLinked && state.roomId) await updateDoc(doc(db,'focus_rooms',state.roomId), {status:'idle', allocatedTime:state.initialTime});
  else { stopLocalTimerLoop(); state.timeLeft = state.initialTime; updateFocusUI(); }
};

function startLocalTimerLoop() {
  state.isActive = true; updateFocusUI();
  if(state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    if(state.isLinked && state.sharedRoomData?.status === 'running') {
      const elapsed = Math.max(0, Math.floor((Date.now() - state.sharedRoomData.startTime)/1000));
      const rem = Math.max(0, state.sharedRoomData.allocatedTime - elapsed);
      state.timeLeft = rem;
    } else {
      state.timeLeft = Math.max(0, state.timeLeft - 1);
    }
    updateFocusUI();

    if(state.timeLeft === 0) {
      stopLocalTimerLoop();
      handleSessionComplete();
    }
  }, 1000);
}

function stopLocalTimerLoop() { state.isActive = false; clearInterval(state.timerInterval); updateFocusUI(); }

async function handleSessionComplete() {
  const mins = state.initialTime/60;
  state.focusHistory.unshift({ id: Date.now().toString(), date: getTodayStr(), minutes: mins });
  saveLocal();

  // Target Injection
  if(state.activeFocusDirectiveId) {
    const dId = state.activeFocusDirectiveId;
    const dir = getCombinedDirectives().find(d=>d.id===dId);
    if(dir) {
      const myTime = (dir.timeInvested?.[state.userId]||0) + mins;
      if(dir.isShared) await updateDoc(doc(db,'shared_directives',dId), {[`timeInvested.${state.userId}`]: myTime});
      else { dir.timeInvested[state.userId] = myTime; saveLocal(); }
    }
  }

  state.timeLeft = state.initialTime; updateFocusUI();
  if(state.isLinked && state.roomId) await updateDoc(doc(db,'focus_rooms',state.roomId), {status:'idle', allocatedTime:state.initialTime});
}

// Uplink Logic
document.getElementById('sync-badge-btn').onclick = () => {
  if(state.isLinked) {
    showModal('SYNDICATE UPLINK', `
      <div style="text-align:center;">
        <i class="fa-solid fa-earth-americas" style="font-size:40px; color:#00FFFF; margin-bottom:20px;"></i>
        <p style="color:#666; font-size:12px; letter-spacing:2px;">CONNECTED TO:</p>
        <p style="color:#00FFFF; font-size:20px; font-family:monospace; margin-bottom:30px;">${state.partnerId}</p>
        <button id="sever-link-btn" class="dashed-btn" style="border-color:#FF3333; color:#FF3333;">SEVER CONNECTION</button>
      </div>
    `);
    document.getElementById('sever-link-btn').onclick = async () => {
      if(state.roomId) await updateDoc(doc(db,'focus_rooms',state.roomId), {status:'idle'});
      await updateDoc(doc(db,'users',state.userId), {focusPartner:null, activeFocusRoom:null});
      if(state.partnerId) await updateDoc(doc(db,'users',state.partnerId), {focusPartner:null, activeFocusRoom:null});
      hideModal();
    };
  } else {
    showModal('SYNDICATE UPLINK', `
      <p style="color:#888; font-size:12px; margin-bottom:20px;">Enter partner ID to send uplink request.</p>
      <input type="text" id="partner-request-input" placeholder="e.g. viktor#1234" style="text-align:center; margin-bottom:20px;">
      <button id="send-request-btn" class="btn">SEND REQUEST</button>
    `);
    document.getElementById('send-request-btn').onclick = async () => {
      const pId = document.getElementById('partner-request-input').value.trim();
      if(!pId || pId===state.userId) return;
      const snap = await getDoc(doc(db,'users',pId));
      if(!snap.exists()) return alert("ID NOT FOUND");
      await updateDoc(doc(db,'users',pId), {pendingFocusRequest: state.userId});
      alert("REQUEST SENT"); hideModal();
    };
  }
};

function showUplinkPopup() {
  document.getElementById('uplink-popup').classList.remove('hidden');
  document.getElementById('uplink-request-text').innerHTML = `<span style="color:#FFF; font-weight:bold;">${state.pendingRequest.split('#')[0].toUpperCase()}</span> IS REQUESTING SYNC.`;
}
function hideUplinkPopup() { document.getElementById('uplink-popup').classList.add('hidden'); }

document.getElementById('deny-uplink-btn').onclick = async () => {
  await updateDoc(doc(db,'users',state.userId), {pendingFocusRequest:null});
};
document.getElementById('accept-uplink-btn').onclick = async () => {
  const newRoomId = `room_${[state.userId, state.pendingRequest].sort().join('_')}`;
  await setDoc(doc(db,'focus_rooms',newRoomId), { participants:[state.userId, state.pendingRequest], status:'idle', duration:state.initialTime, allocatedTime:state.initialTime});
  await updateDoc(doc(db,'users',state.userId), { focusPartner:state.pendingRequest, activeFocusRoom:newRoomId, pendingFocusRequest:null});
  await updateDoc(doc(db,'users',state.pendingRequest), { focusPartner:state.userId, activeFocusRoom:newRoomId });
};

// ==========================================
// 11. ANALYTICS (Chart.js)
// ==========================================
let trendChartInstance, pieChartInstance;
function renderAnalytics() {
  document.getElementById('stat-streak').innerText = calculateGlobalStreak();
  const totMins = state.focusHistory.reduce((s,i)=>s+i.minutes,0);
  document.getElementById('stat-focus').innerText = `${Math.floor(totMins/60)}H ${totMins%60}M`;

  // 7-Day Trend Data
  const labels=[], data=[];
  for(let i=6; i>=0; i--) {
    const d = new Date(); d.setDate(d.getDate()-i);
    labels.push(['S','M','T','W','T','F','S'][d.getDay()]);
    const dStr = d.toISOString().split('T')[0];
    data.push(state.focusHistory.filter(x=>x.date===dStr).reduce((s,x)=>s+x.minutes,0));
  }

  const ctxTrend = document.getElementById('trendChart').getContext('2d');
  if(trendChartInstance) trendChartInstance.destroy();
  trendChartInstance = new Chart(ctxTrend, {
    type: 'line', data: { labels, datasets:[{ data, borderColor:'#AA00FF', backgroundColor:'rgba(170,0,255,0.1)', fill:true, tension:0.4 }] },
    options: { plugins:{legend:{display:false}}, scales:{ y:{beginAtZero:true, grid:{color:'#222'}, ticks:{color:'#666'}}, x:{grid:{color:'#222'}, ticks:{color:'#666'}} } }
  });

  // Pie Chart Data
  let tC=0, fC=0, hC=0;
  getCombinedDirectives().forEach(d => { if(d.type==='TASK')tC++; if(d.type==='FINANCE')fC++; if(d.type==='TIME')hC++; });
  
  const ctxPie = document.getElementById('pieChart').getContext('2d');
  if(pieChartInstance) pieChartInstance.destroy();
  pieChartInstance = new Chart(ctxPie, {
    type: 'doughnut', data: { labels:['TASKS','CAPITAL','HOURS'], datasets:[{ data:[tC, fC, hC], backgroundColor:['#00FFFF','#AA00FF','#FFF'], borderWidth:0 }] },
    options: { plugins:{legend:{labels:{color:'#FFF', font:{family:'monospace'}}}} }
  });
}

// ==========================================
// 12. SETTINGS
// ==========================================
document.getElementById('update-alias-btn').onclick = async () => {
  const n = document.getElementById('new-alias-input').value.trim().toLowerCase();
  if(n.length<3) return alert("ALIAS MUST BE > 2 CHARS");
  const newId = `${n}#${state.userId.split('#')[1]}`;
  if(newId === state.userId) return;
  
  try {
    const oldRef = doc(db,'users',state.userId);
    const snap = await getDoc(oldRef);
    await setDoc(doc(db,'users',newId), {...snap.data(), baseName:n});
    await deleteDoc(oldRef);
    localStorage.setItem('@superhuman_identity_web', newId);
    state.userId = newId; document.getElementById('settings-user-id').innerText = newId;
    alert("ALIAS UPDATED"); setupFirebaseListeners();
  } catch(e) { alert("NETWORK ERROR"); }
};

document.getElementById('purge-btn').onclick = () => {
  if(confirm("PURGE IDENTITY FROM DEVICE? (This logs you out)")) {
    localStorage.removeItem('@superhuman_identity_web');
    location.reload();
  }
};

// ==========================================
// 13. MODAL UTILS
// ==========================================
function showModal(title, html) {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-body').innerHTML = `
    <div class="modal-header">
      <h3 class="modal-title">${title}</h3>
      <button class="icon-btn" onclick="hideModal()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    ${html}
  `;
}
window.hideModal = () => document.getElementById('modal-overlay').classList.add('hidden');

// Boot
if(state.userId) bootApp();