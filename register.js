import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-analytics.js";
import { getAuth, createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";


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
const db = getFirestore(app); 



//submit
const submit = document.getElementById("register-submit");

submit.addEventListener("click", async function(event){

  event.preventDefault()
  const email = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;
  const displayName = document.getElementById("name").value;
  if (password !== confirmPassword) {
    await showAppAlert("Passwords do not match. Please try again.");
    return; 
  }

  createUserWithEmailAndPassword(auth, email, password)
    .then(async (userCredential) => {
      const user = userCredential.user;

      
      if (user && displayName) {
        try {
          await updateProfile(user, {
            displayName: displayName,
          });

          await setDoc(doc(db, "users", user.uid), {
            name: displayName,
            email: email,
            //managed_clubs: [],
            //member_clubs: [] 
          });
          
          


          
          await showAppAlert("User registered and profile created!");

        } catch (error) { 
          await showAppAlert("Error during user profile setup (Auth profile or Firestore): " + error.message);
        }
      } else if (user) {
          await showAppAlert("User registered, but no display name was provided. Data not saved to Firestore.");
      }

      window.location.href = "index.html";
    })
    .catch(async (error) => {
      const errorCode = error.code;
      let userFriendlyMessage = "An unexpected error occurred. Please try again.";

      switch (errorCode) {
        case 'auth/email-already-in-use': 
          userFriendlyMessage = "This email is already registered. Please sign in or use a different email.";
          break;
        case 'auth/invalid-email': 
          userFriendlyMessage = "The email address is not valid.";
          break;
        case 'auth/weak-password': 
          userFriendlyMessage = "The password is too weak. Please choose a stronger password.";
          break;
        case 'auth/operation-not-allowed': 
          userFriendlyMessage = "Email/password sign-up is not enabled. Please contact support.";
          break;
        default:
          userFriendlyMessage = `Error: ${error.message}`; // Fallback
          break;
      }
      await showAppAlert(userFriendlyMessage);
    });

});




