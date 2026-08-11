// Role lookups, shared by every club subpage.
//
// The cached value is a paint hint only: it lets a page show the right buttons
// on the first frame instead of waiting a round trip. It never decides
// permissions -- Firestore rules do that, and getRole always re-reads the doc.
// Keys carry the uid, so two accounts in the same tab can't see each other's roles.

import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

function key(clubId, uid) {
    return `role_${clubId}_${uid}`;
}

// Instant, possibly stale, possibly null. Safe for showing/hiding UI early.
export function peekRole(clubId, uid) {
    if (!clubId || !uid) return null;
    try {
        return sessionStorage.getItem(key(clubId, uid));
    } catch {
        return null;   // private mode, storage disabled, etc.
    }
}

// Always reads the member doc. Use this before anything that matters.
export async function getRole(db, clubId, uid, clubSnap = null) {
    if (!clubId || !uid) return null;

    try {
        const memberSnap = await getDoc(doc(db, "clubs", clubId, "members", uid));

        let role;
        if (memberSnap.exists()) {
            role = memberSnap.data().role || 'member';
        } else {
            const snap = clubSnap || await getDoc(doc(db, "clubs", clubId));
            role = (snap.exists() && snap.data().managerUid === uid) ? 'manager' : null;
        }

        try {
            if (role === null) sessionStorage.removeItem(key(clubId, uid));
            else sessionStorage.setItem(key(clubId, uid), role);
        } catch {}

        return role;
    } catch (error) {
        console.error(`Error fetching role for user ${uid} in club ${clubId}:`, error);
        return null;
    }
}

export function clearRoles() {
    try {
        Object.keys(sessionStorage)
            .filter(k => k.startsWith('role_'))
            .forEach(k => sessionStorage.removeItem(k));
    } catch {}
}

export function cacheRole(clubId, uid, role) {
    if (!clubId || !uid) return;
    try {
        if (role === null || role === undefined) sessionStorage.removeItem(key(clubId, uid));
        else sessionStorage.setItem(key(clubId, uid), role);
    } catch {}
}