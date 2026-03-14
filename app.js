// Import Firebase directly from the CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// 1. FIREBASE CONFIGURATION
const firebaseConfig = {
  apiKey: "AIzaSyB4zPjy_s8so3kuP8GEDLKQ-Jff3rYsTZ0",
  authDomain: "fixonet.firebaseapp.com",
  projectId: "fixonet",
  storageBucket: "fixonet.firebasestorage.app",
  messagingSenderId: "131305169389",
  appId: "1:131305169389:web:87aa9ef0067982edefc7e4"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 2. DOM ELEMENTS
const identityScreen = document.getElementById('identity-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const aliasInput = document.getElementById('alias-input');
const keyInput = document.getElementById('key-input');
const initBtn = document.getElementById('init-btn');
const errorText = document.getElementById('error-message');
const userDisplay = document.getElementById('user-display');
const logoutBtn = document.getElementById('logout-btn');

// 3. STATE MANAGEMENT
let currentUser = localStorage.getItem('@superhuman_identity_web');

// 4. CHECK INITIAL STATE
function checkState() {
  if (currentUser) {
    identityScreen.classList.add('hidden');
    dashboardScreen.classList.remove('hidden');
    userDisplay.innerText = currentUser.toUpperCase();
  } else {
    identityScreen.classList.remove('hidden');
    dashboardScreen.classList.add('hidden');
  }
}

// 5. HELPER: GENERATE RANDOM 4-DIGIT TAG
const generateTag = () => Math.floor(1000 + Math.random() * 9000).toString();

// 6. INITIALIZATION LOGIC
async function handleInitialize() {
  const alias = aliasInput.value.trim().toLowerCase();
  const accessKey = keyInput.value.trim();

  // Basic validation
  if (alias.length < 3) {
    errorText.innerText = 'ALIAS MUST BE AT LEAST 3 CHARACTERS';
    return;
  }
  if (!accessKey) {
    errorText.innerText = 'AUTHORIZATION KEY REQUIRED';
    return;
  }

  errorText.innerText = '';
  initBtn.disabled = true;
  initBtn.innerText = 'PROCESSING...';

  try {
    let uniqueId = '';
    let isAvailable = false;

    // Loop to find a unique tag
    while (!isAvailable) {
      const testTag = generateTag();
      const testId = `${alias}#${testTag}`;
      
      const docRef = doc(db, 'users', testId);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        uniqueId = testId;
        isAvailable = true;
        
        // --- THIS IS WHERE THE FIRESTORE RULE IS SATISFIED ---
        // If the 'accessKey' is not 'lunaris', Firebase will throw a permission-denied error here.
        await setDoc(docRef, {
          baseName: alias,
          tag: testTag,
          accessKey: accessKey, 
          createdAt: new Date().toISOString()
        });
      }
    }
    
    // Success: Save locally and swap screens
    localStorage.setItem('@superhuman_identity_web', uniqueId);
    currentUser = uniqueId;
    aliasInput.value = '';
    keyInput.value = '';
    checkState();

  } catch (err) {
    console.error(err);
    // If the rule rejects it, it will trigger this catch block
    if (err.code === 'permission-denied') {
      errorText.innerText = 'ACCESS DENIED: INVALID AUTHORIZATION KEY.';
    } else {
      errorText.innerText = 'NETWORK UPLINK FAILED. TRY AGAIN.';
    }
  } finally {
    initBtn.disabled = false;
    initBtn.innerText = 'INITIALIZE';
  }
}

// 7. EVENT LISTENERS
initBtn.addEventListener('click', handleInitialize);

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('@superhuman_identity_web');
  currentUser = null;
  checkState();
});

// Run on boot
checkState();