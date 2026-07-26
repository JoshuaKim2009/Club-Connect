import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
    getFirestore,
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    doc,
    getDoc,
    collection,
    query,
    orderBy,
    getDocs,
    addDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { showAppAlert, showAppConfirm } from './dialog.js';
import { handleUserSwitch } from './auth-guard.js';


const firebaseConfig = {
    apiKey: "AIzaSyCBFod3ng-pAEdQyt-sCVgyUkq-U8AZ65w",
    authDomain: "club-connect-data.firebaseapp.com",
    projectId: "club-connect-data",
    storageBucket: "club-connect-data.firebasestorage.app",
    messagingSenderId: "903230180616",
    appId: "1:903230180616:web:a13856c505770bcc0b30bd",
    measurementId: "G-B8DR377JX6"
};

const app  = initializeApp(firebaseConfig);
const db   = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const auth = getAuth(app);

let currentUser = null;
let clubId=null;
let currentUserRole = null;
let categoriesCache = [];
let sortableInstance = null;
let reorderMode = false;
let isEditingCategory = false;

const resourcesContainer = document.getElementById('resourcesContainer');
const noResourcesMessage = document.getElementById('noResourcesMessage');
const noResourcesMessageAdmin = document.getElementById('noResourcesMessageAdmin');
const addCategoryButton = document.getElementById('add-category-button');
const categoryCreationModal = document.getElementById('category-creation-modal');
const categoryOverlay= document.getElementById('popup-overlay');
const buttonRow = document.getElementById('button-row');


document.body.classList.add('no-scroll');

function getUrlParameter(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
}

async function getMemberRoleForClub(clubId, uid) {
    if (!clubId || !uid) return null;

    const cacheKey = `role_${clubId}_${uid}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return cached;

    try {
        const memberRoleRef = doc(db, "clubs", clubId, "members", uid);
        const memberRoleSnap = await getDoc(memberRoleRef);

        let role;
        if (memberRoleSnap.exists()) {
            role = memberRoleSnap.data().role || 'member';
        } else {
            const clubRef = doc(db, "clubs", clubId);
            const clubSnap = await getDoc(clubRef);
            role = (clubSnap.exists() && clubSnap.data().managerUid === uid) ? 'manager' : null;
        }

        if (role !== null) sessionStorage.setItem(cacheKey, role);
        return role;
    } catch (error) {
        console.error(`Error fetching role for user ${uid} in club ${clubId}:`, error);
        return null;
    }
}

function isAdmin() {
    return currentUserRole === 'manager' || currentUserRole === 'admin';
}

function showOverlay() { categoryOverlay.style.display = 'block'; document.body.classList.add('no-scroll'); }
function hideOverlay() { categoryOverlay.style.display = 'none';  document.body.classList.remove('no-scroll'); }



window.goToClubPage = function () {
    const returnTo = getUrlParameter('returnTo');
    if (clubId) {
        window.location.href = returnTo === 'member'
            ? `club_page_member.html?id=${clubId}`
            : `club_page_manager.html?id=${clubId}`;
    } else {
        window.location.href = 'your_clubs.html';
    }
};



onAuthStateChanged(auth, async (user) => {
    if (!handleUserSwitch(user)) {
        if (!user) window.location.href = 'login.html';
        return;
    }
    currentUser = user;
    clubId = getUrlParameter('clubId');

    if (!clubId) {
        window.location.href = 'your_clubs.html';
        return;
    }

    try {
        const clubSnap = await getDoc(doc(db, "clubs", clubId));
        if (!clubSnap.exists()) {
            hideLoadingScreen();
            noResourcesMessage.style.display = 'none';
            showContainerError(resourcesContainer, "This club doesn't exist.");
            return;
        }
        currentUserRole = await getMemberRoleForClub(clubId, user.uid);
        if (currentUserRole === null) {
            hideLoadingScreen();
            noResourcesMessage.style.display = 'none';
            showContainerError(resourcesContainer, "You're not a member of this club.");
            return;
        }
        await fetchCategoryData();
        if (isAdmin()) {
            addCategoryButton.style.display = 'block';
            addCategoryButton.addEventListener('click', handleAddCategory);
            const reorderButton = document.getElementById('reorder-button');
            reorderButton.style.display = categoriesCache.length >= 2 ? 'block' : 'none';
        }
        hideLoadingScreen();
        renderAllCategories();
    } catch (error) {
        hideLoadingScreen();
        console.error("Error:", error);
        noResourcesMessage.style.display = 'none';
        showContainerError(resourcesContainer, "Oops! Something went wrong.", true);
    }
});

function handleAddCategory() {
    if (reorderMode) { showAppAlert("Finish reordering first!"); return; }
    const titleInput = document.getElementById('category-title-input');
    titleInput.classList.remove('input-error');
    showOverlay();
    categoryCreationModal.style.display = 'flex';
}

function hideCategoryModal() {
    categoryCreationModal.style.display = 'none';
    hideOverlay();
    const titleInput = document.getElementById('category-title-input');
    titleInput.value = '';
    titleInput.classList.remove('input-error');
}

document.getElementById('cancel-category-button').addEventListener('click', hideCategoryModal);

document.getElementById('post-category-button').addEventListener('click', async () => {
    const titleInput = document.getElementById('category-title-input');
    const title = titleInput.value.trim();

    if (!title) {
        titleInput.classList.remove('input-error');
        void titleInput.offsetWidth;
        titleInput.classList.add('input-error');
        titleInput.focus();
        return;
    }

    try {
        const docRef = await addDoc(collection(db, "clubs", clubId, "resourceSections"), {
            title, links: [], order: categoriesCache.length,
            createdAt: serverTimestamp(),
            createdByUid: currentUser.uid,
            createdByName: currentUser.displayName || "Anonymous",
            clubId
        });
        hideCategoryModal();
        await fetchAndDisplayCategories();
        requestAnimationFrame(() => scrollToCategory(docRef.id));
    } catch (e) {
        await showAppAlert("Failed to create category: " + e.message);
    }
});

async function fetchCategoryData() {
    const snap = await getDocs(
        query(collection(db, "clubs", clubId, "resourceSections"), orderBy("createdAt", "asc"))
    );
    categoriesCache = [];
    snap.forEach((d, i) => {
        const data = d.data();
        categoriesCache.push({ id: d.id, title: data.title, links: data.links || [], order: data.order ?? i });
    });
    categoriesCache.sort((a, b) => a.order - b.order);
}

function renderAllCategories(skipAnimation = false) {
    resourcesContainer.innerHTML = '';

    const visibleCategories = isAdmin()
        ? categoriesCache
        : categoriesCache.filter(cat => cat.links.length > 0);

    if (visibleCategories.length === 0) {
        noResourcesMessage.style.display = isAdmin() ? 'none' : 'block';
        noResourcesMessageAdmin.style.display = isAdmin() ? 'block' : 'none';
        resourcesContainer.style.marginTop = '0px';
        return;
    }
    noResourcesMessage.style.display = 'none';
    noResourcesMessageAdmin.style.display = 'none';
    resourcesContainer.style.marginTop = isAdmin() ? '-12px' : '-48px';
    visibleCategories.forEach((cat, i) => {
        const el = createCategoryElement(cat);
        el.dataset.id = cat.id;
        resourcesContainer.appendChild(el);
        if (!skipAnimation) animateCardIn(el, i);
    });
    if (isAdmin()) {
        setupReorder();
        document.getElementById('reorder-button').style.display = categoriesCache.length >= 2 ? 'block' : 'none';
    }
}

async function fetchAndDisplayCategories() {
    await fetchCategoryData();
    renderAllCategories(true);
}

function hideLoadingScreen() {
    const overlay = document.getElementById('loading-overlay');
    const content = document.getElementById('content');
    if (overlay) {
        overlay.classList.add('hidden');
        document.body.classList.remove('no-scroll');
        overlay.addEventListener('transitionend', () => {
            if (overlay.classList.contains('hidden')) overlay.style.display = 'none';
        }, { once: true });
    } else {
        document.body.classList.remove('no-scroll');
    }
    if (content) {
        content.style.display = 'block';
        Array.from(content.querySelectorAll(':scope > *')).forEach((item, i) => {
            if (item === resourcesContainer || item === buttonRow) {
                item.classList.add('revealed-child');
            } else {
                setTimeout(() => item.classList.add('revealed-child'), i * 200);
            }
        });
    }
}
function createCategoryElement(category) {
    const div = document.createElement('div');
    div.className = 'category';
    div.dataset.id = category.id;
    div.innerHTML = `
        <div class="category-header">
            <h3>${category.title}</h3>
            ${isAdmin() ? `<button class="edit-category-button" title="Edit category"><i class="fa-solid fa-pen-to-square"></i></button>` : ''}
        </div>
        <div class="links-container" id="links-${category.id}">
            ${category.links.map(link => {
                const url = link.url.startsWith('http') ? link.url : 'https://' + link.url;
                return `<div class="link-item"><i class="fa-solid fa-link link-item-icon"></i><a href="${url}" target="_blank">${link.title}</a></div>`;
            }).join('')}
            ${isAdmin() ? `<button class="add-link-button" data-category-id="${category.id}">+ Add Link</button>` : ''}
        </div>
    `;
    if (isAdmin()) {
        div.querySelector('.edit-category-button').addEventListener('click', async () => {
            if (reorderMode) {
                reorderMode = false;
                sortableInstance.option('disabled', true);
                const reorderButton = document.getElementById('reorder-button');
                reorderButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/></svg>';
                reorderButton.classList.remove('save-mode');
                resourcesContainer.classList.remove('reorder-mode');
                const updates = [];
                resourcesContainer.querySelectorAll('.category, .editing-category-card').forEach((el, i) => {
                    updates.push(updateDoc(doc(db, "clubs", clubId, "resourceSections", el.dataset.id), { order: i }));
                });
                await Promise.all(updates);
            }
            openEditingCard(category, div);
        });
        div.querySelector('.add-link-button').addEventListener('click', () => openAddLinkModal(category));
    }
    return div;
}



function openEditingCard(category, existingCard) {
    if (isEditingCategory) {
        showAppAlert("Please finish editing before starting another edit."); 
        return; 
    }
    isEditingCategory = true;
    const editingCategory = { ...category, links: category.links.map(l => ({ ...l })) };

    const editCard = document.createElement('div');
    editCard.className = 'editing-category-card';
    editCard.dataset.id = category.id;
    editCard.innerHTML = `
        <div class="edit-card-section" id="title-section-${category.id}">
            <span class="edit-card-section-label">Category Name</span>
            <textarea class="edit-card-title-input" rows="1">${category.title}</textarea>
        </div>
    `;

    const titleSection = editCard.querySelector(`#title-section-${category.id}`);
    const titleInput = editCard.querySelector('.edit-card-title-input');

    let linksSection = null;

    function buildLinksSection() {
        if (linksSection) linksSection.remove();

        if (editingCategory.links.length === 0) {
            linksSection = null;
            const existingAddBtn = titleSection.querySelector('.add-link-inline-btn');
            if (!existingAddBtn) {
                const addBtn = document.createElement('button');
                addBtn.className = 'add-link-inline-btn';
                addBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
                addBtn.title = 'Add link';
                addBtn.addEventListener('click', () => {
                    editingCategory.links.push({ title: '', url: '' });
                    buildLinksSection();
                    const rows = linksSection.querySelectorAll('.edit-link-row');
                    const lastRow = rows[rows.length - 1];
                    if (lastRow) lastRow.querySelector('.edit-link-title-input')?.focus();
                });
                titleSection.appendChild(addBtn);
            }
            return;
        }

        const existingAddBtn = titleSection.querySelector('.add-link-inline-btn');
        if (existingAddBtn) existingAddBtn.remove();

        linksSection = document.createElement('div');
        linksSection.className = 'edit-card-section';

        const linksLabel = document.createElement('span');
        linksLabel.className = 'edit-card-section-label';
        linksLabel.textContent = 'Links';
        linksSection.appendChild(linksLabel);

        editingCategory.links.forEach((link, index) => {
            linksSection.appendChild(buildLinkRow(link, index, editingCategory, buildLinksSection));
        });

        const addBtn = document.createElement('button');
        addBtn.className = 'add-link-inline-btn';
        addBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
        addBtn.title = 'Add link';
        addBtn.addEventListener('click', () => {
            editingCategory.links.push({ title: '', url: '' });
            buildLinksSection();
            const rows = linksSection.querySelectorAll('.edit-link-row');
            const lastRow = rows[rows.length - 1];
            if (lastRow) lastRow.querySelector('.edit-link-title-input')?.focus();
        });
        linksSection.appendChild(addBtn);

        editCard.insertBefore(linksSection, actionsRow);
    }

    const actionsRow = document.createElement('div');
    actionsRow.className = 'edit-card-actions';

    const doneBtn = document.createElement('button');
    doneBtn.className = 'fancy-button edit-card-save-btn';
    doneBtn.innerHTML = 'DONE';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'fancy-button edit-card-delete-btn';
    deleteBtn.innerHTML = 'DELETE';

    actionsRow.appendChild(doneBtn);
    actionsRow.appendChild(deleteBtn);
    editCard.appendChild(actionsRow);

    buildLinksSection();

    doneBtn.addEventListener('click', async () => {
        const newTitle = titleInput.value.trim();
        if (!newTitle) { await showAppAlert("Title can't be empty!"); return; }

        const rows = linksSection ? linksSection.querySelectorAll('.edit-link-row') : [];
        const updatedLinks = [];
        rows.forEach((row) => {
            const t = row.querySelector('.edit-link-title-input').value.trim();
            const u = row.querySelector('.edit-link-url-input').value.trim();
            if (t && u) updatedLinks.push({ title: t, url: u });
        });

        const linksChanged = updatedLinks.length !== category.links.length ||
            updatedLinks.some((l, i) => l.title !== category.links[i].title || l.url !== category.links[i].url);
        const titleChanged = newTitle !== category.title;

        if (!titleChanged && !linksChanged) {
            editCard.replaceWith(existingCard);
            isEditingCategory = false;
            requestAnimationFrame(() => scrollToCategory(category.id));
            return;
        }

        try {
            await updateDoc(doc(db, "clubs", clubId, "resourceSections", category.id), {
                title: newTitle,
                links: updatedLinks
            });
            isEditingCategory = false;
            await fetchAndDisplayCategories();
            requestAnimationFrame(() => scrollToCategory(category.id));
        } catch (e) {
            await showAppAlert("Failed to save: " + e.message);
        }
    });

    deleteBtn.addEventListener('click', async () => {
        const confirmed = await showAppConfirm(`Are you sure you want to delete the entire "${category.title}" category?`);
        if (!confirmed) return;
        try {
            await deleteDoc(doc(db, "clubs", clubId, "resourceSections", category.id));
            isEditingCategory = false;
            await fetchAndDisplayCategories();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (e) {
            await showAppAlert("Failed to delete: " + e.message);
        }
    });

    existingCard.replaceWith(editCard);
}



function buildLinkRow(link, index, editingCategory, rebuildLinks) {
    const row = document.createElement('div');
    row.className = 'edit-link-row';

    const inner = document.createElement('div');
    inner.className = 'edit-link-row-top';

    const linkIcon = document.createElement('i');
    linkIcon.className = 'fa-solid fa-link edit-link-row-icon';

    const fields = document.createElement('div');
    fields.className = 'edit-link-row-fields';

    const tInput = document.createElement('input');
    tInput.type = 'text';
    tInput.className = 'edit-link-title-input';
    tInput.value = link.title;
    tInput.placeholder = 'Link title';

    const uInput = document.createElement('input');
    uInput.type = 'text';
    uInput.className = 'edit-link-url-input';
    uInput.value = link.url;
    uInput.placeholder = 'Paste link here';

    fields.appendChild(tInput);
    fields.appendChild(uInput);

    const trashBtn = document.createElement('button');
    trashBtn.className = 'edit-link-icon-btn';
    trashBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
    trashBtn.title = 'Remove link';

    inner.appendChild(linkIcon);
    inner.appendChild(fields);
    inner.appendChild(trashBtn);
    row.appendChild(inner);

    trashBtn.addEventListener('click', () => {
        editingCategory.links.splice(index, 1);
        rebuildLinks();
    });

    return row;
}



function setupReorder() {
    const reorderButton = document.getElementById('reorder-button');
    reorderButton.style.pointerEvents = '';
    reorderButton.style.opacity = '';
    reorderButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/></svg>';
    const h = addCategoryButton.offsetHeight;
    reorderButton.style.height = h + 'px';
    reorderButton.style.width  = h + 'px';
    reorderButton.classList.remove('save-mode');
    reorderMode = false;

    if (sortableInstance) {
        sortableInstance.destroy();
        sortableInstance = null;
    }

    sortableInstance = window.Sortable.create(resourcesContainer, {
        animation: 150, forceFallback: true,
        ghostClass: 'sortable-ghost', dragClass: 'sortable-drag',
        disabled: true,
        onStart: (evt) => {
            const s = document.createElement('style');
            s.id = 'drag-cursor-style';
            s.innerHTML = '* { cursor: grabbing !important; }';
            document.head.appendChild(s);
            const w = evt.item.offsetWidth;
            setTimeout(() => {
                const fallback = document.querySelector('.sortable-fallback');
                if (fallback) {
                    fallback.style.setProperty('width', w + 'px', 'important');
                    fallback.style.setProperty('max-width', w + 'px', 'important');
                    fallback.style.setProperty('box-sizing', 'border-box', 'important');
                }
            }, 10);
        },
        onEnd: () => document.getElementById('drag-cursor-style')?.remove()
    });

    reorderButton.onclick = async () => {
        if (isEditingCategory) {
            await showAppAlert("Please finish editing before reordering.");
            return;
        }
        if (!reorderMode) {
            reorderMode = true;
            sortableInstance.option('disabled', false);
            reorderButton.innerHTML = '<i class="fa-solid fa-check"></i>';
            reorderButton.classList.add('save-mode');
            resourcesContainer.classList.add('reorder-mode');
        } else {
            reorderMode = false;
            sortableInstance.option('disabled', true);
            reorderButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/></svg>';
            reorderButton.classList.remove('save-mode');
            resourcesContainer.classList.remove('reorder-mode');
            const updates = [];
            resourcesContainer.querySelectorAll('.category, .editing-category-card').forEach((el, i) => {
                updates.push(updateDoc(doc(db, "clubs", clubId, "resourceSections", el.dataset.id), { order: i }));
            });
            await Promise.all(updates);
        }
    };
}

const addLinkModal = document.getElementById('add-link-modal');
let activeLinkCategoryId = null;

function openAddLinkModal(category) {
    activeLinkCategoryId = category.id;
    const titleInput = document.getElementById('link-title-input');
    const urlInput = document.getElementById('link-url-input');
    titleInput.value = '';
    urlInput.value   = '';
    titleInput.classList.remove('input-error');
    urlInput.classList.remove('input-error');
    showOverlay();
    addLinkModal.style.display = 'flex';
}

function hideAddLinkModal() {
    addLinkModal.style.display = 'none';
    hideOverlay();
    activeLinkCategoryId = null;
    document.getElementById('link-title-input').classList.remove('input-error');
    document.getElementById('link-url-input').classList.remove('input-error');
}

document.getElementById('cancel-link-button').addEventListener('click', hideAddLinkModal);

document.getElementById('save-link-button').addEventListener('click', async () => {
    const titleInput = document.getElementById('link-title-input');
    const urlInput = document.getElementById('link-url-input');
    const title = titleInput.value.trim();
    const url   = urlInput.value.trim();

    titleInput.classList.remove('input-error');
    urlInput.classList.remove('input-error');

    if (!title || !url) {
        if (!title) {
            void titleInput.offsetWidth;
            titleInput.classList.add('input-error');
        }
        if (!url) {
            void urlInput.offsetWidth;
            urlInput.classList.add('input-error');
        }
        (!title ? titleInput : urlInput).focus();
        return;
    }

    const savedCategoryId = activeLinkCategoryId;

    try {
        const sectionRef  = doc(db, "clubs", clubId, "resourceSections", savedCategoryId);
        const sectionSnap = await getDoc(sectionRef);
        const existing    = sectionSnap.data().links || [];
        await updateDoc(sectionRef, { links: [...existing, { title, url }] });
        hideAddLinkModal();
        await fetchAndDisplayCategories();
        requestAnimationFrame(() => scrollToCategory(savedCategoryId));
    } catch (e) {
        await showAppAlert("Failed to save link: " + e.message);
    }
});

[
  document.getElementById('category-title-input'),
  document.getElementById('link-title-input'),
  document.getElementById('link-url-input')
].forEach(input => {
  input.addEventListener('input', () => input.classList.remove('input-error'));
});


function animateCardIn(card, index = 0) {
    card.style.opacity = '0';
    card.style.transform = 'translateY(16px)';
    card.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out';
    setTimeout(() => {
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
    }, index * 80);
}


function showContainerError(container, message, showRetry = false, topMargin = '-20px') {
    if (!container) return;
    container.innerHTML = `
        <div style="text-align: center; padding: 20px; margin-top: ${topMargin};">
            <p class="fancy-label">${message}</p>
            <div style="display: flex; justify-content: center; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
                ${showRetry
                    ? `<button class="fancy-button" onclick="window.location.reload()" style="font-size: 24px;">TRY AGAIN</button>`
                    : `<button class="fancy-button" onclick="window.location.href='your_clubs.html'" style="font-size: 24px;">GO TO MY CLUBS</button>`
                }
            </div>
        </div>
    `;
}


categoryOverlay.addEventListener('click', (e) => {
    if (e.target !== categoryOverlay) return;

    if (categoryCreationModal.style.display === 'flex') {
        hideCategoryModal();
    } else if (addLinkModal.style.display === 'flex') {
        hideAddLinkModal();
    }
});


function scrollToCategory(categoryId) {
    const card = resourcesContainer.querySelector(`.category[data-id="${categoryId}"]`);
    if (!card) return;

    const rect = card.getBoundingClientRect();
    const isFullyVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;

    if (!isFullyVisible) {
        window.scrollTo({ top: rect.top + window.pageYOffset - 90, behavior: 'smooth' });
    }
}