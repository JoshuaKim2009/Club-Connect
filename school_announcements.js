import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, collectionGroup, query, where, orderBy, limit, startAfter, getDocs, getCountFromServer } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert } from './dialog.js';
import { handleUserSwitch } from './auth-guard.js';
import { getRole } from './roleCache.js';

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
const db = getFirestore(app);
const auth = getAuth(app);

const PAGE_SIZE = 5;

let currentUser = null;
let currentSchoolId = null;
let currentPage = 1;

let totalCount = 0;
let totalPages = 1;
let cursors = [null];
let currentPageAnnouncements = [];

let memberNames = {};

// ===================== DEMO MODE (delete this whole block before shipping) =====================
const DEMO_MODE = true;
const DEMO_ALLOWED_EMAILS = ["jotae1628@gmail.com", "jotae912@gmail.com"];

// Edit freely — add/remove/reorder entries.
const DEMO_ANNOUNCEMENTS_RAW = [
	{
		authorName: "Albert Einstein",
		title: "Calling all coders!",
		content: "Interested in competitive programming? Come join the Competitive Coding Club every Monday in Room 250!",
		clubName: "Competitive Coding Club",
		clubId: "REPLACE_WITH_A_REAL_CLUB_ID",
		date: "2026-09-25 14:35"
	},
	{
		authorName: "Leonardo Da Vinci",
		title: "Art Supplies Drive",
		content: "Art Club is hosting a supplies drive on Thursday at lunch. Bring new or gently used art supplies to support local students. They will be donated to nonprofits, shelters, churches, and schools with low-funded art programs.",
		clubName: "Art Club",
		clubId: "REPLACE_WITH_A_REAL_CLUB_ID",
		date: "2026-09-22 14:56"
	},
	{
		authorName: "Abraham Lincoln",
		title: "Join the Debate Team!",
		content: "If you like speaking and debating, check out the Debate Team. At the Club Fair, we will be at the back right corner of the gym. Come by and sign up!",
		clubName: "Debate Team",
		clubId: "REPLACE_WITH_A_REAL_CLUB_ID",
		date: "2026-09-14 18:43"
	},
	{
		authorName: "Mark Twain",
		title: "Want to support literacy in our community?",
		content: "The Literature Club is collecting books to donate to local libraries and schools. Bring your old favorites and help support literacy in our community! Please drop off your donations in the box outside Room 228.",
		clubName: "Literature Club",
		clubId: "REPLACE_WITH_A_REAL_CLUB_ID",
		date: "2026-09-21 07:12"
	},
	{
		authorName: "George Washington",
		title: "Help Plan Spirit Week!",
		content: "Student Government is looking for student ideas for Spirit Week. Please submit your suggestions here: https://forms.gle/LsU3pTEBiCx4udEP7",
		clubName: "Student Government",
		clubId: "REPLACE_WITH_A_REAL_CLUB_ID",
		date: "2026-09-01 07:24"
	},
	{
		authorName: "Marie Curie",
		title: "Interested in Biomedical Science?",
		content: "The BioMed Club is looking for students interested in exploring the field of biomedical science. Learn more at club day on the 15th!",
		clubName: "BioMed Club",
		clubId: "REPLACE_WITH_A_REAL_CLUB_ID",
		date: "2026-09-12 13:34"
	},
	{
		authorName: "Nikola Tesla",
		title: "Check out Robotics Club at the Club Fair",
		content: "We have started making progress on building the initial design for our first robot and we are excited to demo it at the club fair. Visit us at Table 72 and sign up for the club!",
		clubName: "Robotics Club",
		clubId: "REPLACE_WITH_A_REAL_CLUB_ID",
		date: "2026-09-14 17:02"
	},
	{
		authorName: "Benjamin Franklin",
		title: "First school tournament complete!",
		content: "Thanks to everyone who came out to our first in school chess tournament of the year yesterday! We had students of all experience levels compete, from people playing their first tournament to returning members who have been playing for years. It was great seeing everyone challenge themselves and meet other players. Congratulations to our winner Isaac Newton, and we hope to see even more students at our next meeting!",
		clubName: "Chess Club",
		clubId: "REPLACE_WITH_A_REAL_CLUB_ID",
		date: "2026-09-18 16:13"
	},
	{
		authorName: "Andrew Carnegie",
		title: "Join DECA!",
		content: "DECA is a business club that helps students prepare for the future by exploring fields such as marketing, finance, hospitality, and management. Join DECA and learn how you can compete in events, develop real-world skills, and meet other students interested in business!",
		clubName: "DECA",
		clubId: "REPLACE_WITH_A_REAL_CLUB_ID",
		date: "2026-09-10 15:21"
	},
	{
		authorName: "Jane Addams",
		title: "Thanks everyone for an amazing turnout!!!!",
		content: "Huge thanks to everyone who participated in our fall food drive! Together, we collected over 300 cans and nonperishable food items to donate to a local food pantry!!",
		clubName: "Key Club",
		clubId: "REPLACE_WITH_A_REAL_CLUB_ID",
		date: "2026-09-05 11:09"
	},
];

function isDemoUser(user) {
	return DEMO_MODE && !!user && !!user.email &&
		DEMO_ALLOWED_EMAILS.includes(user.email.toLowerCase());
}

function buildDemoAnnouncements() {
	return DEMO_ANNOUNCEMENTS_RAW.map((item, i) => {
		const fakeUid = `demo-fake-uid-${i}`;
		memberNames[fakeUid] = item.authorName;
		const parsedDate = new Date(item.date.replace(' ', 'T'));
		return {
			id: `demo-${i}`,
			clubId: item.clubId,
			clubName: item.clubName,
			title: item.title,
			content: item.content,
			createdByUid: fakeUid,
			createdAt: { toDate: () => parsedDate }
		};
	});
}

// Built once per page load: every real announcement for the school + the fakes, sorted together.
let demoMergedList = null;

async function getDemoMergedList(schoolId) {
	if (demoMergedList) return demoMergedList;
	const snap = await getDocs(schoolAnnouncementsQueryBase(schoolId));
	const real = [];
	snap.forEach(docSnap => real.push({ id: docSnap.id, ...docSnap.data() }));
	const merged = [...real, ...buildDemoAnnouncements()];
	merged.sort((a, b) => b.createdAt.toDate() - a.createdAt.toDate());
	demoMergedList = merged;
	return merged;
}

// Drop-in replacements for refreshCount / fetchSchoolAnnouncementsPage.
// Non-demo users: pass straight through to your real, untouched functions.
async function refreshCountForDisplay(schoolId, user) {
	if (!isDemoUser(user)) return refreshCount(schoolId);
	const merged = await getDemoMergedList(schoolId);
	totalCount = merged.length;
	totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
}

async function fetchPageForDisplay(schoolId, page, user) {
	if (!isDemoUser(user)) return fetchSchoolAnnouncementsPage(schoolId, page);
	const merged = await getDemoMergedList(schoolId);
	const start = (page - 1) * PAGE_SIZE;
	return merged.slice(start, start + PAGE_SIZE);
}
// ===================== END DEMO MODE =====================

async function resolveName(uid) {
    if (!uid) return "Unknown";
    if (memberNames[uid]) return memberNames[uid];
    try {
        const userSnap = await getDoc(doc(db, "users", uid));
        memberNames[uid] = (userSnap.exists() && userSnap.data().name) ? userSnap.data().name : "Unknown";
        return memberNames[uid];
    } catch (error) {
        console.error(`Failed to resolve name for ${uid}:`, error);
        return "Unknown";
    }
}

const announcementsContainer = document.getElementById('announcementsContainer');
const noAnnouncementsMessage = document.getElementById('noAnnouncementsMessage');

document.body.classList.add('no-scroll');
let loadingScreenHidden = false;

function hideLoadingScreen() {
    if (loadingScreenHidden) return;
    loadingScreenHidden = true;
    const overlay = document.getElementById('loading-overlay');
    const content = document.getElementById('content');
    overlay.classList.add('hidden');
    document.body.classList.remove('no-scroll');
    overlay.addEventListener('transitionend', () => {
        if (overlay.classList.contains('hidden')) overlay.style.display = 'none';
    }, { once: true });

    content.style.display = 'block';
    Array.from(content.querySelectorAll(':scope > *')).forEach(item => {
        item.classList.add('revealed-child');
    });
}

function showContainerError(message, showRetry = false, topMargin = '61px', redirectUrl = 'index.html', buttonText = 'GO HOME') {
    const content = document.getElementById('content');
    content.innerHTML = `
		<div class="revealed-child" style="text-align: center; padding: 20px; margin-top: ${topMargin};">
			<p class="fancy-label">${message}</p>
			<div style="display: flex; justify-content: center; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
			${showRetry
				? `<button type="button" class="fancy-button" onclick="window.location.reload()" style="font-size: 24px;">TRY AGAIN</button>`
				: `<button type="button" class="fancy-button" onclick="window.location.href='${redirectUrl}'" style="font-size: 24px;">${buttonText}</button>`
			}
			</div>
		</div>
    `;
}

async function getUserSchoolId(uid) {
    if (!uid) return null;

    const cacheKey = `schoolId_${uid}`;
    const cachedSchoolId = sessionStorage.getItem(cacheKey);
    if (cachedSchoolId) return cachedSchoolId;

    try {
        const docSnap = await getDoc(doc(db, "users", uid));

        if (!docSnap.exists() || !docSnap.data().schoolId) {
            return null;
        }

        const schoolId = docSnap.data().schoolId;
        sessionStorage.setItem(cacheKey, schoolId);
        return schoolId;
    } catch (error) {
        console.error("Error getting user school ID:", error);
        return null;
    }
}

function schoolAnnouncementsQueryBase(schoolId) {
    return query(
        collectionGroup(db, "publicAnnouncements"),
        where("schoolId", "==", schoolId),
        orderBy("createdAt", "desc")
    );
}

async function refreshCount(schoolId) {
    const snap = await getCountFromServer(schoolAnnouncementsQueryBase(schoolId));
    totalCount = snap.data().count;
    totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
}

async function fetchSchoolAnnouncementsPage(schoolId, page) {
    const base = schoolAnnouncementsQueryBase(schoolId);
    const afterCursor = cursors[page - 1]; 
    const pageQuery = afterCursor
        ? query(base, startAfter(afterCursor), limit(PAGE_SIZE))
        : query(base, limit(PAGE_SIZE));

    const snap = await getDocs(pageQuery);
    const announcementsList = [];
    snap.forEach((docSnap) => {
        announcementsList.push({ id: docSnap.id, ...docSnap.data() });
    });

    if (snap.docs.length > 0) {
        cursors[page] = snap.docs[snap.docs.length - 1];
    }

    return announcementsList;
}

onAuthStateChanged(auth, async (user) => {
	if (!handleUserSwitch(user)) {
		if (!user) window.location.href = 'login.html';
		return;
	}
	currentUser = user;

	try {
		const schoolId = await getUserSchoolId(user.uid);
		currentSchoolId = schoolId;

		if (!schoolId) {
			showContainerError("You haven't added a school yet.", false, '61px', 'edit_account.html', 'ADD SCHOOL');
			hidePagination();
			hideLoadingScreen();
			return;
		}

		cursors = [null];
		currentPage = 1;

		//temporary DELETE LATER
		// await refreshCount(schoolId);
		await refreshCountForDisplay(schoolId, user);

		if (totalCount === 0) {
			showEmpty("NOTHING HERE YET!");
			hidePagination();
			hideLoadingScreen();
			return;
		}

		await renderPage(1);
		hideLoadingScreen();
	} catch (error) {
		console.error("Error loading school announcements:", error);
		showContainerError("Oops! Something went wrong.", true);
		hideLoadingScreen();
	}
});

function renderPaginationButtons(page, totalPages) {
	const controls = document.getElementById('pagination-controls');
	const inner = document.getElementById('pagination-inner');
	controls.style.display = 'flex';
	inner.innerHTML = '';

	let pagesToShow = [];
	if (totalPages === 2) {
		pagesToShow = [1, 2];
	} else if (page === 1) {
		pagesToShow = [1, 2, 3];
	} else if (page === totalPages) {
		pagesToShow = [totalPages - 2, totalPages - 1, totalPages];
	} else {
		pagesToShow = [page - 1, page, page + 1];
	}
	pagesToShow = pagesToShow.filter(p => p >= 1 && p <= totalPages);

	pagesToShow.forEach(p => {
		const btn = document.createElement('button');
		btn.textContent = p;
		btn.className = 'pagination-btn' + (p === page ? ' active-page' : '');
		if (p !== page) {
			btn.addEventListener('click', async () => {
				try {
					await renderPage(p);
					window.scrollTo({ top: 0, behavior: 'instant' });
				} catch (error) {
					console.error("Error loading page:", error);
					await showAppAlert("Couldn't load that page. Please try again.");
				}
			});
		}
		inner.appendChild(btn);
	});
}

function hidePagination() {
	const paginationControls = document.getElementById('pagination-controls');
	if (paginationControls) paginationControls.style.display = 'none';
	const inner = document.getElementById('pagination-inner');
	if (inner) inner.innerHTML = '';
}

async function renderPage(page) {
	page = Math.max(1, Math.min(page, totalPages));
	currentPage = page;

	// temporary DELETE LATER
	// const pageItems = await fetchSchoolAnnouncementsPage(currentSchoolId, currentPage);
	const pageItems = await fetchPageForDisplay(currentSchoolId, currentPage, currentUser);

	if (pageItems.length === 0) {
		showEmpty("NOTHING HERE YET!");
		hidePagination();
		return;
	}

	await attachClubInfo(pageItems, currentUser.uid);
	currentPageAnnouncements = pageItems;

	announcementsContainer.innerHTML = '';
	if (noAnnouncementsMessage) noAnnouncementsMessage.style.display = 'none';

	const cards = pageItems.map(announcement => createAnnouncementCard(announcement));

	cards.forEach((card, index) => {
		card.style.opacity = '0';
		card.style.transform = 'translateY(16px)';
		card.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out';
		announcementsContainer.appendChild(card);

		setTimeout(() => {
		card.style.opacity = '1';
		card.style.transform = 'translateY(0)';
		}, index * 80);
	});

	if (totalPages > 1) {
		renderPaginationButtons(currentPage, totalPages);
	} else {
		hidePagination();
	}
}

function createAnnouncementCard(data) {
	const cardDiv = document.createElement('div');
	cardDiv.className = 'announcement-card display-announcement-card';
	cardDiv.dataset.announcementId = data.id;

	const canNavigate = data.role === 'manager' || data.role === 'admin' || data.role === 'member';

	cardDiv.innerHTML = `
		<h3>
			<span class="club-label ${canNavigate ? 'club-label--link' : ''}" data-club-id="${escapeHtml(data.clubId)}">${escapeHtml(data.clubName)}</span><br>
			${escapeHtml(data.title)}
		</h3>
		<p>${linkifyText(data.content)}</p>
		<p class="announcement-meta">
			${escapeHtml(data.authorName)} · ${formatTimestamp(data.createdAt)}
		</p>
	`;

	if (canNavigate) {
		const label = cardDiv.querySelector('.club-label--link');
		label.addEventListener('click', () => {
			window.location.href = `club_page.html?clubId=${data.clubId}`;
		});
	}

	return cardDiv;
}

async function attachClubInfo(announcements, uid) {
	const uniqueClubIds = [...new Set(announcements.map(a => a.clubId))];

	const infoByClub = {};
	await Promise.all(uniqueClubIds.map(async (clubId) => {
		const clubSnap = await getDoc(doc(db, "clubs", clubId));
		const clubName = clubSnap.exists() ? (clubSnap.data().clubName || 'Unknown Club') : 'Unknown Club';
		if (clubSnap.exists()) {
			Object.assign(memberNames, clubSnap.data().memberNames || {});
		}
		const role = await getRole(db, clubId, uid, clubSnap.exists() ? clubSnap : undefined);
		infoByClub[clubId] = { clubName, role };
	}));

	await Promise.all(
		[...new Set(announcements.map(a => a.createdByUid))].map(uid => resolveName(uid))
	);

	announcements.forEach(a => {
		a.clubName = a.clubName || infoByClub[a.clubId].clubName;
		a.role = infoByClub[a.clubId].role;
		a.authorName = memberNames[a.createdByUid] || "Unknown";
	});
}


function showEmpty(msg) {
  	announcementsContainer.innerHTML = `<p class="fancy-label empty-state-label">${msg}</p>`;
}

function formatTimestamp(timestamp) {
	if (!timestamp || !timestamp.toDate) return 'N/A';
	const date = timestamp.toDate();
	return date.toLocaleDateString(undefined, {
		year: 'numeric', month: 'short', day: 'numeric',
		hour: 'numeric', minute: '2-digit'
	});
}

function linkifyText(text) {
	const escaped = escapeHtml(text);
	const urlPattern = /((https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/[^\s]*)?)/g;
	return escaped.replace(urlPattern, (url) => {
		const href = url.startsWith('http') ? url : 'https://' + url;
		return `<a href="${href}" target="_blank" class="message-link">${url}</a>`;
	});
}

function escapeHtml(str) {
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}