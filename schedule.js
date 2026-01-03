import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert, showAppConfirm } from './dialog.js'; // Assuming dialog.js is present and correct

// Your web app's Firebase configuration (copied from your club_page_manager.js)
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
const db = getFirestore(app);
const auth = getAuth(app);

// Global variables to store authentication and club information
let currentUser = null; // Will store the authenticated Firebase user object
let clubId = null;      // Will store the club ID from the URL

// Get reference to the <h1> element for the page title
const clubScheduleTitle = document.getElementById('clubScheduleTitle');


// --- Helper Functions ---

// Function to get a query parameter from the URL
// This will look for 'clubId' as passed from club_page_manager.js
function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    var results = regex.exec(location.search);
    return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
}

// Function to go back to the home/clubs page
// This is made global so the onclick="goToHome()" in schedule.html can find it.
window.goToHome = function() {
    const clubIdFromUrl = getUrlParameter('clubId'); // Get clubId using the correct parameter name
    if (clubIdFromUrl) {
        // If we came from a specific club page, go back there
        window.location.href = `club_page_manager.html?id=${clubIdFromUrl}`;
    } else {
        // Otherwise, go to the general list of clubs
        window.location.href = 'your_clubs.html';
    }
}


// --- Authentication State Listener ---
// This runs whenever the user's authentication state changes
onAuthStateChanged(auth, async (user) => {
    currentUser = user; // Update the global currentUser variable
    clubId = getUrlParameter('clubId'); // Get the clubId from the current page's URL using 'clubId'

    if (user) {
        // User is signed in
        if (clubId) {
            // Club ID is present in the URL, try to fetch club details to set the title
            const clubRef = doc(db, "clubs", clubId);
            try {
                const clubSnap = await getDoc(clubRef);
                if (clubSnap.exists()) {
                    if (clubScheduleTitle) { 
                        clubScheduleTitle.textContent = `${clubSnap.data().clubName} Schedule`;
                    }
                } else {
                    // Club document not found in Firestore
                    if (clubScheduleTitle) {
                        clubScheduleTitle.textContent = "Club Schedule (Club Not Found)";
                    }
                }
            } catch (error) {
                // Error fetching club details
                console.error("Error fetching club details for title:", error);
                if (clubScheduleTitle) {
                    clubScheduleTitle.textContent = "Error Loading Schedule";
                }
            }
        } else {
            // No clubId found in the URL
            if (clubScheduleTitle) {
                clubScheduleTitle.textContent = "Error: No Club ID Provided";
            }
        }
    } else {
        // No user is signed in, redirect to the login page
        console.log("No user authenticated on schedule page. Redirecting to login.");
        if (clubScheduleTitle) {
            clubScheduleTitle.textContent = "Not Authenticated";
        }
        setTimeout(() => {
            window.location.href = 'login.html'; 
        }, 2000); 
    }
});