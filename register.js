// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-analytics.js";
import { getAuth, createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries
import { showAppAlert, showAppConfirm } from './dialog.js';

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
const analytics = getAnalytics(app);


const auth = getAuth(app);
const db = getFirestore(app); // Initialize Firestore



//submit
const submit = document.getElementById("register-submit");

submit.addEventListener("click", function(event){

  event.preventDefault()
  const email = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  // Get the display name from an input field (make sure you have an input with id="name" in your HTML)
  const displayName = document.getElementById("name").value;

  createUserWithEmailAndPassword(auth, email, password)
    .then(async (userCredential) => { // <--- **IMPORTANT: Added 'async' here**
      const user = userCredential.user;

      
      // Check if a user object exists and if a displayName was provided
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

        } catch (error) { // Changed 'updateError' to 'error' for broader catching
          await showAppAlert("Error during user profile setup (Auth profile or Firestore): " + error.message);
          // IMPORTANT: If you want the page to NOT redirect on *any* setup error, add 'return;' here.
          // For now, let's let it try to redirect but you can uncomment 'return;' if you prefer it stops.
          // return;
        }
      } else if (user) {
          await showAppAlert("User registered, but no display name was provided. Data not saved to Firestore.");
      }

      // ... (rest of your code, including window.location.href redirect)
      window.location.href = "index.html";
    })
    .catch(async (error) => {
      // This catch block handles errors from createUserWithEmailAndPassword itself
      const errorCode = error.code;
      const errorMessage = error.message;
      await showAppAlert("Invalid submission: " + errorMessage)
    });

});




