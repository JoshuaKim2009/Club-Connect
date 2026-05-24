import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore, doc, updateDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
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

const displayNameInput = document.getElementById('displayName');
const saveBtn = document.getElementById('save-submit');

onAuthStateChanged(auth, (user) => {
    if (user) {
        displayNameInput.value = user.displayName || '';
    } else {
        window.location.href = 'login.html';
    }
});

saveBtn.addEventListener('click', async () => {
    const newDisplayName = displayNameInput.value.trim();

    if (!newDisplayName) {
        await showAppAlert("Display name cannot be empty.");
        return;
    }

    saveBtn.style.width = saveBtn.offsetWidth + 'px';
    saveBtn.style.height = saveBtn.offsetHeight + 'px';
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner"></span>';

    try {
        const user = auth.currentUser;

        await updateProfile(user, { displayName: newDisplayName });

        await updateDoc(doc(db, "users", user.uid), {
            name: newDisplayName
        });

        const data = { displayName: newDisplayName, email: user.email, uid: user.uid };
        localStorage.setItem('cc-user', JSON.stringify(data));
        sessionStorage.setItem('cc-user', JSON.stringify(data));

        await showAppAlert("Account updated successfully!");
        history.back();

    } catch (error) {
        await showAppAlert("Failed to update account: " + error.message);
        saveBtn.disabled = false;
        saveBtn.innerHTML = 'SAVE';
    }
});