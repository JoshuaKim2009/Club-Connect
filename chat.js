import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert, showAppConfirm } from "./dialog.js";


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


let isLoggedIn = false;
let userEmail = "";
let userName = "";
let role = null;


onAuthStateChanged(auth, async (user) => {
  if (user) {
    role = await getMemberRoleForClub(clubId, currentUser.uid);
    console.log(`User ${currentUser.uid} role for club ${clubId}: ${role}`);
    isLoggedIn = true;
    userName = user.displayName || "";
    userEmail = user.email || "";

    console.log("Logged in:", userEmail);

    // TODO: update UI for logged-in state
  } else {
    isLoggedIn = false;
    userName = "";
    userEmail = "";

    console.log("User signed out");

    // TODO: update UI for logged-out state
  }
});

function getUrlParameter(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
}

// Function to get the user's role in specific club
async function getMemberRoleForClub(clubId, uid) {
    if (!clubId || !uid) return null;
    
    const memberDoc = await getDoc(doc(db, "clubs", clubId, "members", uid));
    if (memberDoc.exists()) return memberDoc.data().role || 'member';
    
    const clubDoc = await getDoc(doc(db, "clubs", clubId));
    return clubDoc.data()?.managerUid === uid ? 'manager' : 'member';
}

window.goToClubPage = function() {
    const currentClubId = getUrlParameter('clubId');
    const returnToPage = getUrlParameter('returnTo');

    if (currentClubId) {
        let redirectUrl = 'your_clubs.html';

        if (returnToPage === 'manager') {
            redirectUrl = `club_page_manager.html?id=${currentClubId}`;
        } else if (returnToPage === 'member') {
            redirectUrl = `club_page_member.html?id=${currentClubId}`;
        } else {
            console.warn("Invalid or missing 'returnTo' parameter, defaulting to manager page.");
            redirectUrl = `club_page_manager.html?id=${currentClubId}`;
        }
        window.location.href = redirectUrl;
    } else {
        window.location.href = 'your_clubs.html';
    }
}

const backButton = document.getElementById("back-button");
if (backButton) {
  backButton.addEventListener("click", async () => {
    window.goToClubPage();
  });
}


