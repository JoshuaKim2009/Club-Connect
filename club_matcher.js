// club_matcher.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, query, where, getDocs, doc, getDoc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert } from "./dialog.js";
import { handleUserSwitch } from "./auth-guard.js";
import { ROLE_LABELS } from "./roleLabels.js";
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";


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

const db = initializeFirestore(app, {
	localCache: persistentLocalCache({
		tabManager: persistentMultipleTabManager()
	})
});

const auth = getAuth(app);

document.body.classList.add("no-scroll");

let embedder = null;

let currentUser = null;
let currentSchoolId = null;
let currentSchool = null;
let loadingScreenHidden = false;
let pixelAdder = "160px";
const clubsCache = new Map();

const matcherForm = document.getElementById("clubMatcherForm");
const interestsInput = document.getElementById("interests-input");
const clubsGrid = document.getElementById("clubsGrid");


function hideLoadingScreen() {
	if (loadingScreenHidden) return;

	loadingScreenHidden = true;

	const overlay = document.getElementById("loading-overlay");
	const content = document.getElementById("content");

	if (overlay) {
		overlay.classList.add("hidden");
		document.body.classList.remove("no-scroll");

		overlay.addEventListener("transitionend", () => {
			if (overlay.classList.contains("hidden")) {
				overlay.style.display = "none";
			}
		}, { once: true });
	} else {
		document.body.classList.remove("no-scroll");
	}

	if (content) {
		content.style.display = "block";

		Array.from(
			content.querySelectorAll(":scope > *")
		).forEach(item => {
			item.classList.add("revealed-child");
		});
	}
}

function showContainerError(message, showRetry = false, topMargin = pixelAdder, redirectUrl = "index.html", buttonText = "GO HOME") {
	const content = document.getElementById("content");

	content.innerHTML = `
		<div class="revealed-child" style="text-align: center; padding: 20px; margin-top: ${topMargin};">
			<p class="fancy-label">${escapeHtml(message)}</p>
			<div style="display: flex; justify-content: center; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
			${showRetry
				? `<button type="button" class="fancy-button" onclick="window.location.reload()" style="font-size: 24px;">TRY AGAIN</button>`
				: `<button type="button" class="fancy-button" onclick="window.location.href='${redirectUrl}'" style="font-size: 24px;">${buttonText}</button>`
			}
			</div>
		</div>
	`;
}


function escapeHtml(str) {
	return String(str ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

async function getUserSchoolId(uid) {
	if (!uid) return null;

	const cacheKey = `schoolId_${uid}`;
	const cachedSchoolId = sessionStorage.getItem(cacheKey);
	if (cachedSchoolId) return cachedSchoolId;

	const userSnap = await getDoc(doc(db, "users", uid));

	if (!userSnap.exists() || !userSnap.data().schoolId) {
		return null;
	}

	const schoolId = userSnap.data().schoolId;
	sessionStorage.setItem(cacheKey, schoolId);
	return schoolId;
}

async function fetchUserSchool() {
	const schoolId = await getUserSchoolId(currentUser.uid);

	if (!schoolId) {
		throw new Error("NO_SCHOOL");
	}

	currentSchoolId = schoolId;

	const schoolRef = doc(db, "schools", schoolId);
	const schoolSnap = await getDoc(schoolRef);

	if (!schoolSnap.exists()) {
		throw new Error("SCHOOL_NOT_FOUND");
	}

	currentSchool = {
		id: schoolSnap.id,
		...schoolSnap.data()
	};

	return currentSchool;
}

async function getSchoolClubs(schoolId) {
	if (clubsCache.has(schoolId)) {
		return clubsCache.get(schoolId);
	}

	const clubsQuery = query(
		collection(db, "clubs"),
		where("schoolId", "==", schoolId),
		where("visibility", "==", "public")
	);

	const clubsSnap = await getDocs(clubsQuery);

	const clubs = clubsSnap.docs.map(docSnap => ({
		id: docSnap.id,
		...docSnap.data()
	}));

	clubsCache.set(schoolId, clubs);

	return clubs;
}

onAuthStateChanged(auth, async (user) => {
	if (!handleUserSwitch(user)) {
		if (!user) {
			window.location.href = "login.html";
		}

		return;
	}

	currentUser = user;

	try {
		await fetchUserSchool();

		console.log("Current school:", currentSchool);

		hideLoadingScreen();

	} catch (error) {
		console.error("Error loading matcher data:", error);
		if (error.message === "NO_SCHOOL") {
			showContainerError(
				"You haven't added a school yet.",
				false,
				pixelAdder,
				"edit_account.html",
				"ADD SCHOOL"
			);

		} else if (error.message === "SCHOOL_NOT_FOUND") {
			showContainerError("We couldn't find your school.", true);
		} else {
			showContainerError("Oops! Something went wrong.", true);
		}

		hideLoadingScreen();
	}
});

function normalizeInterests(input) {
	return input
		.trim()
		.replace(/\s+/g, " ");
}


function clearResults() {
	clubsGrid.innerHTML = "";
}

matcherForm.addEventListener("submit", async (e) => {
	e.preventDefault();

	const interests = normalizeInterests(interestsInput.value);

	if (!interests) {
		await showAppAlert("Please tell us about some of your interests.");
		return;
	}

	if (!currentSchoolId) {
		await showAppAlert("We couldn't determine your school.");
		return;
	}

		clearResults();

	console.log("Club Matcher interests:", interests);

	let allClubs;
	try {
		allClubs = await getSchoolClubs(currentSchoolId);
	} catch (error) {
		console.error("Error fetching clubs:", error);
		await showAppAlert("Something went wrong while finding clubs.");
		return;
	}

    // club recommendation logic

    if (allClubs.length === 0) {
        // handle empty state here
        return;
    }

    const interestsVector = await getEmbedding(interests);

    let maxSim = -Infinity;
    let maxClub = null;

    for (let i = 0; i < allClubs.length; i++) {
        const club = allClubs[i];
        const topics = club.topics || [];
        const topicString = topics.join(", ");
        const description = club.description || "";

        const descriptionVector = await getEmbedding(description);
        const topicsVector = await getEmbedding(topicString);

        const similarity = Math.max(
            cosineSimilarity(interestsVector, descriptionVector),
            cosineSimilarity(interestsVector, topicsVector)
        );

        if (similarity > maxSim) {
            maxSim = similarity;
            maxClub = club;
        }
    }

    console.log("Best match:", maxClub.clubName, "score:", maxSim);
    if (maxClub) {
        renderClubMatch(maxClub);
    } else {
        await showAppAlert("No clubs found that matched your interests");
    }
});


// embedding model logic

let modelLoadingPromise = null;

function loadModel() {
    if (!modelLoadingPromise) {
        modelLoadingPromise = pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
        { dtype: "q8" }
    ).then(model => {
        embedder = model;
        return model;
    });
    }
    return modelLoadingPromise;
}

loadModel();

async function getEmbedding(text) {
    if (!embedder) {
        await loadModel();
    }

    const output = await embedder(
        text,
        {
            pooling: "mean",
            normalize: true
        }
    );
    return Array.from(output.data);
}

function cosineSimilarity(a, b) {
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        magnitudeA += a[i] * a[i];
        magnitudeB += b[i] * b[i];
    }
    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);
    return dotProduct / (magnitudeA * magnitudeB);
}


// rendering the card 

function renderClubMatch(club) {
	clubsGrid.innerHTML = "";
	createClubCard(club);
	requestAnimationFrame(() => scrollToResults());
}

function createClubCard(data) {
	const clubId = data.id;
	const clubName = data.clubName || "Unnamed Club";
	const schoolName = data.schoolName || "Unknown School";
	const category = data.category || "";
	const description = data.description || "";
	const joinCode = data.joinCode || "";
	const pendingMemberUIDs = data.pendingMemberUIDs || [];
	const memberUIDs = data.memberUIDs || [];
	const clubSponsor = data.clubSponsor || "";
	const clubLeader = data.clubLeader || "";
	const schoolEmail = data.schoolEmail || "";
	const roomNumber = data.roomNumber || "";
	const meetingSchedule = data.meetingSchedule || "";

	const isPending = currentUser && pendingMemberUIDs.includes(currentUser.uid);
	const isMember = currentUser && memberUIDs.includes(currentUser.uid);

	const hasMoreInfo = clubSponsor || clubLeader || schoolEmail || roomNumber || meetingSchedule;
	const footerClass = hasMoreInfo ? "club-join-wrapper" : "club-card-footer";

	const card = document.createElement("div");
	card.className = "club-card";
	card.innerHTML = `
		<div class="club-card-header">
			<span class="club-card-name">${escapeHtml(clubName)}</span>
			<span class="club-card-activity">${escapeHtml(category)}</span>
		</div>
		<div class="club-card-body">
			<span><i class="fa-solid fa-school"></i> ${escapeHtml(schoolName)}</span>
			<p class="club-description">${escapeHtml(description)}</p>
		</div>
		${hasMoreInfo ? `
		<button class="club-more-btn">
			<i class="fa-solid fa-chevron-down"></i><span class="more-btn-text"> More Info</span>
		</button>
		<div class="club-more-drawer">
			${clubSponsor ? `<span><span class="field-label">Club Sponsor:</span> ${escapeHtml(clubSponsor)}</span>` : ""}
			${clubLeader ? `<span><span class="field-label">Student Representative:</span> ${escapeHtml(clubLeader)}</span>` : ""}
			${schoolEmail ? `<span><span class="field-label">Contact Email:</span> ${escapeHtml(schoolEmail)}</span>` : ""}
			${roomNumber ? `<span><span class="field-label">Meeting Location:</span> ${escapeHtml(roomNumber)}</span>` : ""}
			${meetingSchedule ? `<span><span class="field-label">Meeting Schedule:</span> ${escapeHtml(meetingSchedule)}</span>` : ""}
		</div>` : ""}
		<div class="${footerClass}">
			<button class="club-join-btn fancy-button" data-club-id="${clubId}" data-join-code="${escapeHtml(joinCode)}" ${isPending || isMember ? "disabled" : ""}>
				${isMember ? "JOINED" : isPending ? "SENT" : "REQUEST TO JOIN"}
			</button>
		</div>
	`;
	clubsGrid.appendChild(card);
}

function documentTopOf(el) {
	let y = 0;
	for (let node = el; node; node = node.offsetParent) y += node.offsetTop;
	return y;
}

function scrollToResults() {
	if (!clubsGrid || !clubsGrid.firstElementChild) return;

	const headerHeight = document.querySelector(".chat-header").offsetHeight;
	const cardRect = clubsGrid.firstElementChild.getBoundingClientRect();

	const isFullyVisible =
		cardRect.top >= headerHeight &&
		cardRect.bottom <= window.innerHeight;

	if (isFullyVisible) return;

	const top = documentTopOf(clubsGrid);
	window.scrollTo({ top: top - headerHeight + 92, behavior: "smooth" });
}


clubsGrid.addEventListener("click", async (e) => {
	e.preventDefault();

	const moreBtn = e.target.closest(".club-more-btn");
	if (moreBtn) {
		const drawer = moreBtn.nextElementSibling;
		const icon = moreBtn.querySelector("i");
		const label = moreBtn.querySelector(".more-btn-text");
		const isOpen = drawer.classList.toggle("open");
		icon.style.transform = isOpen ? "rotate(180deg)" : "";
		label.textContent = isOpen ? " Less Info" : " More Info";
		return;
	}

	if (!e.target.classList.contains("club-join-btn")) return;

	if (!currentUser) {
		await showAppAlert("You must be logged in to join a club.");
		return;
	}

	const clubId = e.target.dataset.clubId;
	const clubRef = doc(db, "clubs", clubId);
	const clubSnap = await getDoc(clubRef);

	if (!clubSnap.exists()) {
		await showAppAlert("Club not found.");
		return;
	}

	const clubData = clubSnap.data();

	if (clubData.managerUid === currentUser.uid) {
		await showAppAlert(`You are the ${ROLE_LABELS.manager.toLowerCase()} of this club.`);
		return;
	}
	if ((clubData.memberUIDs || []).includes(currentUser.uid)) {
		await showAppAlert("You are already a member of this club.");
		return;
	}
	if ((clubData.pendingMemberUIDs || []).includes(currentUser.uid)) {
		await showAppAlert("You have already sent a join request for this club.");
		return;
	}

	e.target.textContent = "SENT";
	e.target.disabled = true;
	await updateDoc(clubRef, { pendingMemberUIDs: arrayUnion(currentUser.uid) });
});