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

// Global state variables
let isLoggedIn = false;
let userEmail = "";
let userName = "";
let role = null;
let clubId = null;
let currentUser = null;

// DOM elements
const chatInput = document.getElementById('chatInput');
const inputContainer = document.getElementById('inputContainer');
const chatMessages = document.getElementById('chatMessages');
const sendButton = document.getElementById('sendButton');
const backButton = document.getElementById("back-button");

// Get URL parameters
function getUrlParameter(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
}

// Initialize clubId from URL
clubId = getUrlParameter('clubId');

// Function to get the user's role in specific club (placeholder for now)
async function getMemberRoleForClub(clubId, uid) {
    if (!clubId || !uid) return null;
    
    // TODO: Implement Firebase Firestore logic
    // const memberDoc = await getDoc(doc(db, "clubs", clubId, "members", uid));
    // if (memberDoc.exists()) return memberDoc.data().role || 'member';
    // 
    // const clubDoc = await getDoc(doc(db, "clubs", clubId));
    // return clubDoc.data()?.managerUid === uid ? 'manager' : 'member';
    
    // For now, return a default value
    return 'member';
}

// Auth state listener
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    isLoggedIn = true;
    userName = user.displayName || "";
    userEmail = user.email || "";
    
    console.log("Logged in:", userEmail);
    
    // Get role for the current club
    if (clubId) {
      role = await getMemberRoleForClub(clubId, currentUser.uid);
      console.log(`User ${currentUser.uid} role for club ${clubId}: ${role}`);
    }

    // TODO: update UI for logged-in state
  } else {
    currentUser = null;
    isLoggedIn = false;
    userName = "";
    userEmail = "";
    role = null;

    console.log("User signed out");

    // TODO: update UI for logged-out state
  }
});

// Navigation function
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

// Back button handler
if (backButton) {
  backButton.addEventListener("click", () => {
    window.goToClubPage();
  });
}

// Send message function
function sendMessage() {
    const message = chatInput.value.trim();
    if (message) {
        const messageWrapper = document.createElement('div');
        messageWrapper.className = 'message-wrapper sent';
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message sent';
        messageDiv.textContent = message;
        
        messageWrapper.appendChild(messageDiv);
        chatMessages.appendChild(messageWrapper);
        
        chatInput.value = '';
        
        // Scroll to bottom
        setTimeout(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }, 50);
        
        // TODO: Send message to Firebase
        console.log("Message sent:", message);
    }
}

// Event listeners for sending messages
if (sendButton) {
    sendButton.addEventListener('click', sendMessage);
}

if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
}

// Auto-scroll to bottom on load
window.addEventListener('load', () => {
    setTimeout(() => {
        if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }, 100);
});

// Keyboard handling for mobile (moved from inline script)
if (chatInput && inputContainer && chatMessages) {
    // Handle iOS keyboard appearance
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            const viewportHeight = window.visualViewport.height;
            const windowHeight = window.innerHeight;
            const keyboardHeight = windowHeight - viewportHeight;
            
            if (keyboardHeight > 0) {
                // Keyboard is visible
                inputContainer.style.bottom = `${keyboardHeight}px`;
                chatMessages.style.paddingBottom = `${keyboardHeight + 85}px`;
                
                // Scroll to bottom when keyboard appears
                setTimeout(() => {
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }, 100);
            } else {
                // Keyboard is hidden
                inputContainer.style.bottom = `env(safe-area-inset-bottom)`;
                chatMessages.style.paddingBottom = `calc(85px + env(safe-area-inset-bottom) + 20px)`;
            }
        });
    }

    // Alternative method for Android and other devices
    let lastHeight = window.innerHeight;
    window.addEventListener('resize', () => {
        const currentHeight = window.innerHeight;
        const diff = lastHeight - currentHeight;
        
        if (diff > 150) { // Keyboard appeared
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        
        lastHeight = currentHeight;
    });
}