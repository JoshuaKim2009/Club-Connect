import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-analytics.js";
import { getAuth, createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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
const db = getFirestore(app);


function getRegisterErrorMessage(code) {
  switch (code) {
    case 'auth/email-already-in-use':
      return "An account with this email already exists. Try logging in instead.";
    case 'auth/invalid-email':
      return "That doesn't look like a valid email address. Please double-check it.";
    case 'auth/weak-password':
      return "Your password is too weak. Try something longer with a mix of letters and numbers.";
    case 'auth/operation-not-allowed':
      return "Registration is currently unavailable. Please try again later.";
    case 'auth/too-many-requests':
      return "Too many attempts in a short time. Please wait a moment and try again.";
    case 'auth/network-request-failed':
      return "Couldn't reach the server. Please check your internet connection and try again.";
    default:
      return "Something went wrong while creating your account. Please try again.";
  }
}

const submit = document.getElementById("register-submit");

function resetSubmit() {
  submit.disabled = false;
  submit.innerHTML = 'Register';
}

submit.addEventListener("click", async function(event) {
  event.preventDefault();

  submit.style.width  = submit.offsetWidth  + 'px';
  submit.style.height = submit.offsetHeight + 'px';
  submit.disabled = true;
  submit.innerHTML = '<span class="spinner"></span>';

  const displayName     = document.getElementById("name").value.trim();
  const email           = document.getElementById("username").value.trim();
  const password        = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;

  if (!displayName) {
    await showAppAlert("Please enter your full name.");
    resetSubmit();
    return;
  }

  if (password !== confirmPassword) {
    await showAppAlert("Your passwords don't match. Please try again.");
    resetSubmit();
    return;
  }

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    await updateProfile(user, { displayName });
    await setDoc(doc(db, "users", user.uid), { name: displayName, email });

    const data = { displayName, email, uid: user.uid };
    localStorage.setItem('cc-user', JSON.stringify(data));
    sessionStorage.setItem('cc-user', JSON.stringify(data));

    await showAppAlert("Welcome to Club Connect! Your account is ready.");
    window.location.href = "index.html";

  } catch (error) {
    await showAppAlert(getRegisterErrorMessage(error.code));
    resetSubmit();
  }
});