import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
// You'll need getAuth and onAuthStateChanged to get the current user
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
// You'll need getFirestore, doc, and getDoc to fetch user and club documents
import { getFirestore, doc, getDoc, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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
const db = getFirestore(app);

let clubNames = []; 
let clubIds = [];
let currentUser = null;
let memberClubNames = [];
let memberClubIds = [];
let userDocRef = null;
let unsubscribeUserDoc = null;


async function loadManagedClubs() {
  clubNames = [];
  clubIds = [];
  const container = document.getElementById("clubContainer");
  if (!currentUser || !currentUser.uid) {
    console.warn("No user logged in. Cannot load clubs.");
    return;
  }

  try {

    
    console.log(`Fetching document for user: ${currentUser.uid}`);
    const userDocRef = doc(db, "users", currentUser.uid);
    const userDocSnap = await getDoc(userDocRef, { source: 'server' });
    if (userDocSnap.exists()) {
        const userData = userDocSnap.data();
        const managedClubs = userData.managed_clubs || [];
        const memberClubs = userData.member_clubs || [];

        if (managedClubs.length === 0) {
            console.log("User does not manage any clubs.");
            const loading_text = document.getElementById('your-clubs-loading-text');
            loading_text.textContent = "NO CLUBS YET";
            loading_text.hidden = true;
            const btn = document.createElement("button");
            btn.textContent = "NO CLUBS YET";
            btn.className = "club-btn fancy-void-button";
            container.appendChild(btn);
            if(memberClubs.length !== 0){
              Array.from(container.children).forEach(child => {
                if (child.classList.contains("club-btn")) { 
                    container.removeChild(child);
                }
              });
            }
            return;
        }

        console.log(`Found ${managedClubs.length} managed club IDs:`, managedClubs);

        const clubPromises = managedClubs.map(clubId => getDoc(doc(db, "clubs", clubId)));
        const clubSnapshots = await Promise.all(clubPromises); 

        clubSnapshots.forEach(clubSnap => {
            if (clubSnap.exists()) {
            const clubData = clubSnap.data();
            clubNames.push(clubData.clubName); 
            clubIds.push(clubSnap.id); 
            } else {
            console.warn(`Club document with ID ${clubSnap.id} not found.`);
            }
        });

        console.log("Managed Club Names (variable 'clubNames'):", clubNames);
        console.log("Managed Club IDs (variable 'clubIds'):", clubIds);

        displayList(clubNames, clubIds)
        

    } else {
      console.warn("User document not found for current user.");
    }
  } catch (error) {
    console.error("Error loading managed clubs:", error);
  }
}

async function loadMemberClubs() {
  memberClubNames = [];
  memberClubIds = [];
  const container = document.getElementById("memberClubContainer");
  const memberClubLoadingText = document.getElementById('member-clubs-loading-text');

  if (!currentUser || !currentUser.uid) {
    console.warn("No user logged in. Cannot load member clubs.");
    memberClubLoadingText.textContent = "Please log in to see your joined clubs.";
    return;
  }

  try {
    console.log(`Fetching document for user: ${currentUser.uid}`);
    const userDocRef = doc(db, "users", currentUser.uid);
    const userDocSnap = await getDoc(userDocRef, { source: 'server' });

    if (userDocSnap.exists()) {
        const userData = userDocSnap.data();
        const memberClubs = userData.member_clubs || []; 

        if (memberClubs.length === 0) {
            console.log("User is not a member of any clubs.");
            memberClubLoadingText.textContent = "NO CLUBS YET"; 
            memberClubLoadingText.hidden = true;
            const btn = document.createElement("button");
            btn.textContent = "NO CLUBS YET";
            btn.className = "club-btn fancy-void-button";
            container.appendChild(btn);
        } else {
            memberClubLoadingText.textContent = ""; 
            console.log(`Found ${memberClubs.length} member club IDs:`, memberClubs);

            const clubPromises = memberClubs.map(clubId => getDoc(doc(db, "clubs", clubId)));
            const clubSnapshots = await Promise.all(clubPromises);

            clubSnapshots.forEach(clubSnap => {
                if (clubSnap.exists()) {
                    const clubData = clubSnap.data();
                    memberClubNames.push(clubData.clubName); 
                    memberClubIds.push(clubSnap.id);
                } else {
                    console.warn(`Member club document with ID ${clubSnap.id} not found.`);
                }
            });

            console.log("Member Club Names:", memberClubNames); 
            console.log("Member Club IDs:", memberClubIds);
        }
        
        displayMemberClubs(memberClubNames, memberClubIds);

    } else {
      console.warn("User document not found for current user.");
      memberClubLoadingText.textContent = "User data not found.";
    }
  } catch (error) {
    console.error("Error loading member clubs:", error); 
    memberClubLoadingText.textContent = "Error loading joined clubs.";
  }
}


onAuthStateChanged(auth, (user) => {
  currentUser = user; 
  if (user) {
      console.log("Auth state changed: User is logged in.", user.uid);
      
      userDocRef = doc(db, "users", currentUser.uid);
      setupRealtimeClubUpdates();

  } else {
      console.log("Auth state changed: No user is logged in.");
      clubNames = []; 
      clubIds = [];
      document.getElementById("clubContainer").innerHTML = ""; 

      memberClubNames = [];
      memberClubIds = [];
      document.getElementById("memberClubContainer").innerHTML = "";
      document.getElementById('member-clubs-loading-text').textContent = "NO CLUBS YET";

      if (unsubscribeUserDoc) {
          unsubscribeUserDoc();
          unsubscribeUserDoc = null;
      }
  }
});


function displayList(listNames, listIds) {
    const container = document.getElementById("clubContainer");
    const containerText = document.getElementById("your-clubs-loading-text");

    if (!container) {
        console.error("HTML element with id 'clubContainer' not found.");
        return;
    }

    
    Array.from(container.children).forEach(child => {
        if (child.classList.contains("club-btn")) { 
            container.removeChild(child);
        }
    });



    containerText.style.display = 'none'; 
    containerText.textContent = ""; 


    for(let i = 0; i < listNames.length; i++){
        const name = listNames[i];
        const uid = listIds[i]; 

        const btn = document.createElement("button");

        btn.textContent = name; 

        const roleSpan = document.createElement("span");
        roleSpan.textContent = " Manager";
        roleSpan.classList.add("club-role-text"); 
        btn.appendChild(roleSpan);


        btn.dataset.clubId = uid;
        btn.className = "club-btn fancy-button"; 

        btn.addEventListener("click", () => {
            window.location.href = `club_page_manager.html?id=${btn.dataset.clubId}`;
        });

        container.appendChild(btn);
    }
}

function capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

async function displayMemberClubs(listNames, listIds) {
    const container = document.getElementById("memberClubContainer");
    const containerText = document.getElementById("member-clubs-loading-text");
    
    if (!container) {
        console.error("HTML element with id 'memberClubContainer' not found.");
        return;
    }

    Array.from(container.children).forEach(child => {
        if (child.classList.contains("club-btn")) { 
            container.removeChild(child);
        }
    });

    containerText.style.display = 'none';
    containerText.textContent = "";

    const rolePromises = listIds.map(clubId => getMemberRoleForClub(clubId, currentUser.uid));

    const roles = await Promise.all(rolePromises); 

    for(let i = 0; i < listNames.length; i++){
        const name = listNames[i];
        const clubId = listIds[i]; 
        const currentRole = roles[i];

        if (!currentRole) {
            console.warn(`Could not determine role for club ${clubId}. Skipping button creation.`);
            continue;
        }

        const btn = document.createElement("button");
        //btn.textContent = `${name} | ${currentRole.toUpperCase()}`; 
        btn.textContent = name; 

        const roleSpan = document.createElement("span");
        roleSpan.textContent = ` ${capitalizeFirstLetter(currentRole)}`;
        roleSpan.classList.add("club-role-text");

        btn.appendChild(roleSpan); 


        btn.dataset.clubId = clubId;
        btn.dataset.userRole = currentRole; 
        btn.className = "club-btn fancy-button member-club-btn"; 
        btn.style.cursor = "pointer"; 

        btn.addEventListener("click", async () => {
            const clickedClubId = btn.dataset.clubId;
            const clickedUserRole = btn.dataset.userRole; 

            if (clickedUserRole === 'manager' || clickedUserRole === 'admin'){
                window.location.href = `club_page_manager.html?id=${clickedClubId}`;
            } else if (clickedUserRole === 'member'){
                window.location.href = `club_page_member.html?id=${clickedClubId}`;
            } else {
                await showAppAlert("Could not determine your role for this club. Please try again.");
                console.error("Unknown role for redirection:", clickedUserRole);
            }
        });
        
        container.appendChild(btn);
    }
}









async function getMemberRoleForClub(clubID, memberUid) {
  if (!clubID || !memberUid) {
    console.warn("getMemberRoleForClub: clubID or memberUid is missing.");
    return null;
  }
  try {
    const memberRoleRef = doc(db, "clubs", clubID, "members", memberUid);
    const memberRoleSnap = await getDoc(memberRoleRef, { source: 'server' });
    if (memberRoleSnap.exists() && memberRoleSnap.data().role) {
      return memberRoleSnap.data().role;
    } else {
      const clubRef = doc(db, "clubs", clubID);
      const clubSnap = await getDoc(clubRef, { source: 'server' }); 
      if (clubSnap.exists() && clubSnap.data().managerUid === memberUid) {
          return 'manager'; 
      }
      console.warn(`Role document not found for user ${memberUid} in club ${clubID}. Defaulting to 'member'.`);
      return 'member'; 
    }
  } catch (error) {
    console.error(`Error fetching role for user ${memberUid} in club ${clubID}:`, error);
    return null; 
  }
}





function setupRealtimeClubUpdates() {
    if (unsubscribeUserDoc) {
        unsubscribeUserDoc();
    }

    unsubscribeUserDoc = onSnapshot(userDocRef, (userDocSnap) => {
        console.log("User document updated in real-time. Refreshing club lists.");
        loadManagedClubs();
        loadMemberClubs();
    }, (error) => {
        console.error("Error listening to user document for club updates:", error);
        showAppAlert("Real-time club updates failed: " + error.message);
    });
}