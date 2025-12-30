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

onAuthStateChanged(auth, (user) => {
  if (user) {
    // User is signed in
    let isLoggedIn = true;
    let userName = user.displayName;
    let userEmail = user.email; // Access the user's email directly from the user object
    document.getElementById("welcomeMessage").innerHTML = "Signed in as " + userName;
    document.getElementById("logoutButton").classList.remove("hidden");
    document.getElementById("logoutButton").classList.add("show");
    document.getElementById("club-button").classList.remove("hidden");
    document.getElementById("club-button").classList.add("show");
  } else {
    // User is signed out
    let isLoggedIn = false;
    document.getElementById("logoutButton").classList.remove("show");
    document.getElementById("logoutButton").classList.add("hidden");
    document.getElementById("club-button").classList.remove("show");
    document.getElementById("club-button").classList.add("hidden");
    document.getElementById("welcomeMessage").innerHTML = "Welcome, please <a href = 'login.html' class='goldLink'> login </a>"
  }
});



const logoutButton = document.getElementById("logoutButton");

// Add event listener for the logout button
if (logoutButton) { // Check if the button exists before adding listener
    logoutButton.addEventListener('click', () => {
        signOut(auth).then(() => {
            // Sign-out successful.
            console.log("User signed out successfully.");
            // The onAuthStateChanged listener will handle UI updates
            // and potentially redirection to the login page.
        }).catch(async (error) => {
            // An error happened.
            console.error("Error signing out:", error);
            await showAppAlert("Error signing out: " + error.message);
        });
    });
}






const clubButton = document.getElementById("club-button");
if (clubButton) {
  clubButton.addEventListener("click", function() {
    window.location.href = "your_clubs.html";
  });
}






