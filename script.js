import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { showAppAlert } from './dialog.js';

const firebaseConfig = {
  apiKey: "AIzaSyCBFod3ng-pAEdQyt-sCVgyUkq-U8AZ65w",
  authDomain: "club-connect-data.firebaseapp.com",
  projectId: "club-connect-data",
  storageBucket: "club-connect-data.firebasestorage.app",
  messagingSenderId: "903230180616",
  appId: "1:903230180616:web:a13856c505770bcc0b30bd",
  measurementId: "G-B8DR377JX6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});


const logoutButton = document.getElementById("logoutButton");
const welcomeMessage = document.getElementById("welcomeMessage");

function setLoggedInUI(displayName) {
  document.querySelector('.tagline').textContent = getDayMessage(displayName);
  logoutButton.innerHTML = '<i class="fa-solid fa-user"></i> PROFILE';
  document.getElementById('dropdown-logout').innerHTML = 'LOGOUT <i class="fa-solid fa-arrow-right-from-bracket"></i>';
  const cta = document.getElementById('cta-action-btn');
  cta.href = 'your_clubs.html';
  cta.innerHTML = 'FIND A CLUB &nbsp;<i class="fa-solid fa-users"></i>';
}

function setLoggedOutUI() {
  document.querySelector('.tagline').textContent = 'THE PLATFORM FOR SCHOOL CLUBS';
  logoutButton.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> LOGIN';
  document.getElementById('dropdown-logout').innerHTML = 'LOGIN <i class="fa-solid fa-arrow-right-to-bracket"></i>';
  const cta = document.getElementById('cta-action-btn');
  cta.href = 'register.html';
  cta.innerHTML = 'CREATE ACCOUNT &nbsp;<i class="fa-solid fa-arrow-right-to-bracket"></i>';
}

window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    const fresh = JSON.parse(localStorage.getItem('cc-user') || 'null');
    if (fresh) setLoggedInUI(fresh.displayName);
    else setLoggedOutUI();
  }
});

const cached = JSON.parse(sessionStorage.getItem('cc-user') || localStorage.getItem('cc-user') || 'null');
if (cached) {
  setLoggedInUI(cached.displayName);
} else {
  setLoggedOutUI();
}

let resolveAuth;
const authReady = new Promise(resolve => resolveAuth = resolve);

onAuthStateChanged(auth, (user) => {
  resolveAuth(user);
  if (user) {
    const data = { displayName: user.displayName, email: user.email, uid: user.uid };
    localStorage.setItem('cc-user', JSON.stringify(data));
    sessionStorage.setItem('cc-user', JSON.stringify(data));
    setLoggedInUI(user.displayName);
  } else {
    sessionStorage.clear();
    localStorage.removeItem('cc-user');
    sessionStorage.removeItem('cc-user');
    setLoggedOutUI();
  }
});

document.getElementById("club-button").onclick = async () => {
    const cached = JSON.parse(
        sessionStorage.getItem('cc-user') || 
        localStorage.getItem('cc-user') || 
        'null'
    );
    if (cached) {
        window.location.href = 'your_clubs.html';
        return;
    }
    const user = await Promise.race([
        authReady,
        new Promise(resolve => setTimeout(() => resolve(null), 4000))
    ]);
    window.location.href = user ? 'your_clubs.html' : 'login.html';
};

logoutButton.onclick = () => {
  const isLoggedIn = auth.currentUser || JSON.parse(sessionStorage.getItem('cc-user') || localStorage.getItem('cc-user') || 'null');
  if (!isLoggedIn) {
    window.location.href = 'login.html';
    return;
  }
  if (document.getElementById('appearance-modal').style.display === 'block') return;
  const dd = document.getElementById('profile-dropdown');
  dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
};

document.getElementById('dropdown-logout').onclick = () => {
  document.getElementById('profile-dropdown').style.display = 'none';
  if (auth.currentUser) {
    signOut(auth).catch(async (e) => await showAppAlert("Error signing out: " + e.message));
  } else {
    window.location.href = 'login.html';
  }
};

document.getElementById('dropdown-appearance').onclick = () => {
  document.getElementById('profile-dropdown').style.display = 'none';
  document.getElementById('profile-overlay').style.display = 'block';
  document.getElementById('appearance-modal').style.display = 'block';
  document.body.classList.add('no-scroll');
  buildThemeOptions();
};

document.getElementById('dropdown-edit-account').onclick = () => {
  document.getElementById('profile-dropdown').style.display = 'none';
  window.location.href = 'edit_account.html';
};

document.getElementById('close-appearance-x').onclick = closeAppearanceModal;
document.getElementById('profile-overlay').onclick = () => {
  document.getElementById('profile-dropdown').style.display = 'none';
  closeAppearanceModal();
};

function closeAppearanceModal() {
  document.getElementById('appearance-modal').style.display = 'none';
  document.getElementById('profile-overlay').style.display = 'none';
  document.body.classList.remove('no-scroll');
}

function buildThemeOptions() {
  const container = document.getElementById('theme-options');
  container.innerHTML = '';
  let pending = window.getSavedTheme();

  Object.entries(window.THEMES).forEach(([key, theme]) => {
    const btn = document.createElement('button');
    btn.className = 'theme-swatch';
    btn.dataset.key = key;
    if (key === pending) btn.classList.add('theme-swatch-active');
    btn.style.background = `linear-gradient(135deg, ${theme.dark} 0%, ${theme.accent} 100%)`;
    btn.onclick = () => {
      pending = key;
      container.querySelectorAll('.theme-swatch').forEach(b => b.classList.remove('theme-swatch-active'));
      btn.classList.add('theme-swatch-active');
    };
    container.appendChild(btn);
  });

  document.getElementById('save-theme-button').onclick = () => {
    localStorage.setItem('cc-theme', pending);
    window.location.reload();
  };
}



document.getElementById('announcements-home-button').addEventListener('click', async () => {
    const cached = JSON.parse(
        sessionStorage.getItem('cc-user') || 
        localStorage.getItem('cc-user') || 
        'null'
    );
    if (cached) {
        window.location.href = 'school_announcements.html'; 
        return;
    }
    const user = await Promise.race([
        authReady,
        new Promise(resolve => setTimeout(() => resolve(null), 4000))
    ]);
    window.location.href = user ? 'school_announcements.html' : 'login.html';
});


const scrollHintBtn = document.getElementById('scroll-hint-btn');
const featuresSection = document.querySelector('.features');

scrollHintBtn.addEventListener('click', () => {
  const top = featuresSection.getBoundingClientRect().top + window.scrollY - 40;
  window.scrollTo({ top, behavior: 'smooth' });
});

const hintObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      scrollHintBtn.classList.add('hidden');
      hintObserver.disconnect();
    }
  });
}, { threshold: 0.02 });

hintObserver.observe(featuresSection);

window.addEventListener('load', () => {
  const start = Date.now();
  authReady.then((user) => {
    if (user) return;
    const elapsed = Date.now() - start;
    const delay = Math.max(0, 50 - elapsed);
    setTimeout(() => {
      const atBottom =
        window.scrollY + window.innerHeight >= document.body.scrollHeight - 10;
      if (!atBottom) {
        scrollHintBtn.classList.add('show');
      }
    }, delay);
  });
});



function getDayMessage(displayName) {
  const day = new Date().getDay();
  const name = displayName;
  const messages = {
    0: `What's up, ${name}!`,
    1: `Back at it, ${name}?`,
    2: `Welcome back, ${name}!`,
    3: `Let's go, ${name}!`,
    4: `Good to see you, ${name}!`,
    5: `Happy Friday, ${name}!`,
    6: `Happy Saturday, ${name}!`,
  };
  return messages[day];
}