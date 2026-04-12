import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
//import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-analytics.js";
import { getAuth, onAuthStateChanged, signOut} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert, showAppConfirm } from './dialog.js';

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCBFod3ng-pAEdQyt-sCVgyUkq-U8AZ65w",
  authDomain: "club-connect-data.firebaseapp.com",
  projectId: "club-connect-data",
  storageBucket: "club-connect-data.firebasestorage.app",
  messagingSenderId: "903230180616",
  appId: "1:903230180616:web:a13856c505770bcc0b30bd",
  measurementId: "G-B8DR377JX6"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
//const analytics = getAnalytics(app);


const auth = getAuth(app);




var userEmail = "";
var userName = "";

var isLoggedIn = false;

const logoutButton = document.getElementById("logoutButton");

const cachedUser = JSON.parse(localStorage.getItem('cc-user') || 'null');
if (cachedUser) {
  document.getElementById("welcomeMessage").innerHTML = "Welcome, " + cachedUser.displayName;
  document.getElementById("club-button").onclick = () => window.location.href = 'your_clubs.html';
  logoutButton.innerHTML = '<i id="logout-icon" class="fa-solid fa-user"></i> PROFILE';
  document.getElementById('dropdown-logout').innerHTML = 'LOGOUT <i class="fa-solid fa-arrow-right-from-bracket"></i>';
} else {
  // Show logged-out state immediately while Firebase loads
  document.getElementById("welcomeMessage").innerHTML = "Welcome, please <a href='login.html' class='goldLink'>login</a>";
  logoutButton.innerHTML = 'LOGIN <i id="logout-icon" class="fa-solid fa-arrow-right-to-bracket"></i>';
  document.getElementById('dropdown-logout').innerHTML = 'LOGIN <i class="fa-solid fa-arrow-right-to-bracket"></i>';
}

let resolveAuth;
const authReady = new Promise(resolve => resolveAuth = resolve);

onAuthStateChanged(auth, (user) => {
  resolveAuth(user); 

  if (user) {
    localStorage.setItem('cc-user', JSON.stringify({ displayName: user.displayName, email: user.email, uid: user.uid }));
    document.getElementById("welcomeMessage").innerHTML = "Welcome, " + user.displayName;
    logoutButton.innerHTML = '<i id="logout-icon" class="fa-solid fa-user"></i> PROFILE';
    document.getElementById('dropdown-logout').innerHTML = 'LOGOUT <i class="fa-solid fa-arrow-right-from-bracket"></i>';
  } else {
    localStorage.removeItem('cc-user');
    document.getElementById("welcomeMessage").innerHTML = "Welcome, please <a href='login.html' class='goldLink'>login</a>";
    logoutButton.innerHTML = 'LOGIN <i id="logout-icon" class="fa-solid fa-arrow-right-to-bracket"></i>';
    document.getElementById('dropdown-logout').innerHTML = 'LOGIN <i class="fa-solid fa-arrow-right-to-bracket"></i>';
  }
});

document.getElementById("club-button").onclick = async () => {
  const user = await authReady; // instant if already resolved, otherwise waits
  window.location.href = user ? 'your_clubs.html' : 'login.html';
};


logoutButton.onclick = () => {
  if (!auth.currentUser) {
    window.location.href = 'login.html';
    return;
  }
  const dd = document.getElementById('profile-dropdown');
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
};

document.getElementById('dropdown-logout').onclick = () => {
  document.getElementById('profile-dropdown').style.display = 'none';
  const user = auth.currentUser;
  if (user) {
    signOut(auth).catch(async (e) => await showAppAlert("Error signing out: " + e.message));
  } else {
    window.location.href = 'login.html';
  }
};

document.getElementById('dropdown-appearance').onclick = () => {
  document.getElementById('profile-dropdown').style.display = 'none';
  document.getElementById('profile-overlay').style.display = 'block';
  document.getElementById('appearance-modal').style.display = 'block';
  buildThemeOptions();
};

document.getElementById('close-appearance').onclick = closeAppearanceModal;
document.getElementById('profile-overlay').onclick = () => {
  document.getElementById('profile-dropdown').style.display = 'none';
  closeAppearanceModal();
};

function closeAppearanceModal() {
  document.getElementById('appearance-modal').style.display = 'none';
  document.getElementById('profile-overlay').style.display = 'none';
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