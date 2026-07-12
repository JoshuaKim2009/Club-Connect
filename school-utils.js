import { doc, setDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

function slug(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function schoolDocId(state, county, schoolName) {
  return `${slug(state)}_${slug(county)}_${slug(schoolName)}`;
}

export async function getOrCreateSchool(db, state, county, schoolName) {
  const id = schoolDocId(state, county, schoolName);
  const ref = doc(db, "schools", id);
  await setDoc(ref, {
    schoolId: id,
    name: schoolName,
    nameLower: schoolName.toLowerCase(),
    state,
    stateLower: state.toLowerCase(),
    county,
    countyLower: county.toLowerCase(),
  }, { merge: true });
  return id;
}

export async function fetchSchoolsForCounty(db, state, county) {
  if (!state || !county) return [];
  const schoolsRef = collection(db, "schools");
  const q = query(
    schoolsRef,
    where("stateLower", "==", state.toLowerCase()),
    where("countyLower", "==", county.toLowerCase())
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

export function normalizeSchoolName(schoolName) {
  const trimmed = schoolName.trim();

  if (!trimmed) {
    return { valid: false, normalized: '', error: 'Please enter a school name.' };
  }

  const words = trimmed.split(' ');

  if (words.length === 1) {
    const word = words[0];
    if (word.length >= 2 && word.length <= 5 && /^[a-zA-Z]+$/.test(word)) {
      return {
        valid: false,
        normalized: '',
        error: 'Please spell out the full school name without abbreviations.'
      };
    }
  }

  let normalized = trimmed;

  if (normalized.toUpperCase().endsWith(' HS') || normalized.toUpperCase().endsWith(' H.S') || normalized.toUpperCase().endsWith(' H.S.')) {
    if (!normalized.toLowerCase().endsWith('high school')) {
      if (normalized.toUpperCase().endsWith(' HS')) {
        normalized = normalized.slice(0, -2) + 'High School';
      } else if (normalized.toUpperCase().endsWith(' H.S.')) {
        normalized = normalized.slice(0, -4) + 'High School';
      } else if (normalized.toUpperCase().endsWith(' H.S')) {
        normalized = normalized.slice(0, -3) + 'High School';
      }
    }
  }

  if (normalized.toUpperCase().endsWith(' MS') || normalized.toUpperCase().endsWith(' M.S') || normalized.toUpperCase().endsWith(' M.S.')) {
    if (!normalized.toLowerCase().endsWith('middle school')) {
      if (normalized.toUpperCase().endsWith(' MS')) {
        normalized = normalized.slice(0, -2) + 'Middle School';
      } else if (normalized.toUpperCase().endsWith(' M.S.')) {
        normalized = normalized.slice(0, -4) + 'Middle School';
      } else if (normalized.toUpperCase().endsWith(' M.S')) {
        normalized = normalized.slice(0, -3) + 'Middle School';
      }
    }
  }

  if (normalized.toUpperCase().endsWith(' ES') || normalized.toUpperCase().endsWith(' E.S') || normalized.toUpperCase().endsWith(' E.S.')) {
    if (!normalized.toLowerCase().endsWith('elementary school')) {
      if (normalized.toUpperCase().endsWith(' ES')) {
        normalized = normalized.slice(0, -2) + 'Elementary School';
      } else if (normalized.toUpperCase().endsWith(' E.S.')) {
        normalized = normalized.slice(0, -4) + 'Elementary School';
      } else if (normalized.toUpperCase().endsWith(' E.S')) {
        normalized = normalized.slice(0, -3) + 'Elementary School';
      }
    }
  }

  if (normalized.toLowerCase().endsWith(' high')) normalized = normalized + ' School';
  if (normalized.toLowerCase().endsWith(' middle')) normalized = normalized + ' School';
  if (normalized.toLowerCase().endsWith(' elementary')) normalized = normalized + ' School';

  while (normalized.includes('  ')) {
    normalized = normalized.replace('  ', ' ');
  }
  normalized = normalized.trim();

  return { valid: true, normalized: normalized, error: '' };
}