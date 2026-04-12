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

const cachedName = sessionStorage.getItem('cc-username');
if (cachedName) {
  document.getElementById('welcomeMessage').innerHTML = "Welcome, " + cachedName;
  logoutButton.innerHTML = '<i class="fa-solid fa-user"></i> PROFILE';
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    let userName = user.displayName;
    document.getElementById("welcomeMessage").innerHTML = "Welcome, " + userName;
    document.getElementById("club-button").onclick = () => window.location.href = 'your_clubs.html';

    logoutButton.innerHTML = ' <i id="logout-icon" class="fa-solid fa-user"></i> PROFILE';
    document.getElementById('dropdown-logout').innerHTML = 'LOGOUT <i class="fa-solid fa-arrow-right-from-bracket"></i>';
    sessionStorage.setItem('cc-username', user.displayName);

  } else {
    document.getElementById("club-button").onclick = () => window.location.href = 'login.html';
    document.getElementById("welcomeMessage").innerHTML = "Welcome, please <a href='login.html' class='goldLink'>login</a>";

    logoutButton.innerHTML = 'LOGIN <i id="logout-icon" class="fa-solid fa-arrow-right-to-bracket"></i>';
    document.getElementById('dropdown-logout').innerHTML = 'LOGIN <i class="fa-solid fa-arrow-right-to-bracket"></i>';
    sessionStorage.removeItem('cc-username');

  }
});


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
  const current = window.getSavedTheme();
  Object.entries(window.THEMES).forEach(([key, theme]) => {
    const btn = document.createElement('button');
    btn.className = 'theme-swatch';
    if (key === current) btn.classList.add('theme-swatch-active');
    btn.style.background = `linear-gradient(135deg, ${theme.dark} 0%, ${theme.accent} 100%)`;
    btn.onclick = () => {
      window.saveTheme(key);
      buildThemeOptions();
    };
    container.appendChild(btn);
  });
}