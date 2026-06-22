import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-analytics.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert, showAppConfirm } from './dialog.js';

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



function getLoginErrorMessage(code) {
  switch (code) {
    case 'auth/invalid-email':
      return "That doesn't look like a valid email address. Please double-check it.";
    case 'auth/user-disabled':
      return "This account has been disabled. Please contact support for help.";
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return "Incorrect email or password. Please check your details and try again.";
    case 'auth/too-many-requests':
      return "Too many failed attempts. Please wait a moment before trying again.";
    case 'auth/network-request-failed':
      return "Couldn't reach the server. Please check your internet connection and try again.";
    default:
      return "Something went wrong during login. Please try again.";
  }
}



const submit = document.getElementById("login-submit");

function resetSubmit() {
  submit.disabled = false;
  submit.innerHTML = 'Login';
}

submit.addEventListener("click", async function(event) {
  event.preventDefault();

  submit.style.width  = submit.offsetWidth  + 'px';
  submit.style.height = submit.offsetHeight + 'px';
  submit.disabled = true;
  submit.innerHTML = '<span class="spinner"></span>';

  const email    = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    const data = { displayName: user.displayName, email: user.email, uid: user.uid };
    localStorage.setItem('cc-user', JSON.stringify(data));
    sessionStorage.setItem('cc-user', JSON.stringify(data));
    window.location.href = "index.html";
  } catch (error) {
    resetSubmit();
    await showAppAlert(getLoginErrorMessage(error.code));
  }
});