// Import the functions you need from the SDKs you need
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
const analytics = getAnalytics(app);


const auth = getAuth(app);


//submit
const submit = document.getElementById("login-submit");

submit.addEventListener("click", function(event){
  
  event.preventDefault()
  const email = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  

  signInWithEmailAndPassword(auth, email, password)
    .then((userCredential) => {
      // Signed up 
      const user = userCredential.user;
      window.location.href = "index.html";
    })
    .catch(async (error) => {
      const errorCode = error.code;
      let userFriendlyMessage = "An unexpected error occurred during login. Please try again.";

      switch (errorCode) {
        case 'auth/invalid-email': 
          userFriendlyMessage = "The email address you entered is not valid.";
          break;
        case 'auth/user-disabled': 
          userFriendlyMessage = "This account has been disabled. Please contact support.";
          break;
        case 'auth/user-not-found': 
          userFriendlyMessage = "No user found with this email. Please check your email or register.";
          break;
        case 'auth/wrong-password': 
          userFriendlyMessage = "Incorrect password. Please try again.";
          break;
        case 'auth/invalid-credential': 
          userFriendlyMessage = "Invalid login credentials. Please check your email and password.";
          break;
        default:
          userFriendlyMessage = `Error: ${error.message}`;
          break;
      }
      await showAppAlert(userFriendlyMessage);
    });

});




