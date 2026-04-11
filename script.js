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

onAuthStateChanged(auth, (user) => {
  if (user) {
    let userName = user.displayName;
    document.getElementById("welcomeMessage").innerHTML = "Welcome, " + userName;
    document.getElementById("club-button").onclick = () => window.location.href = 'your_clubs.html';

    logoutButton.innerHTML = 'LOGOUT <i id="logout-icon" class="fa-solid fa-arrow-right-from-bracket"></i>';
    logoutButton.onclick = () => {
        signOut(auth).then(() => {
            console.log("User signed out successfully.");
        }).catch(async (error) => {
            console.error("Error signing out:", error);
            await showAppAlert("Error signing out: " + error.message);
        });
    };
  } else {
    document.getElementById("club-button").onclick = () => window.location.href = 'login.html';
    document.getElementById("welcomeMessage").innerHTML = "Welcome, please <a href='login.html' class='goldLink'>login</a>";

    logoutButton.innerHTML = 'LOGIN <i id="logout-icon" class="fa-solid fa-arrow-right-to-bracket"></i>';
    logoutButton.onclick = () => window.location.href = 'login.html';
  }
});