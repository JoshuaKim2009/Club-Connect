(function() {
  const saved = localStorage.getItem('cc-theme');
  const map = {
    default: ['#131b30','#405aa0','#3498db'],
    forest:  ['#0f2318','#2d6a4f','#52b788'],
    crimson: ['#1a0a0a','#8b1a1a','#e63946'],
    slate:   ['#1a1a2e','#4a4a6a','#9b9bc4']
  };
  const c = map[saved] || map.default;
  const r = document.documentElement;
  r.style.setProperty('--bg-dark',   c[0]);
  r.style.setProperty('--bg-accent', c[1]);
  r.style.setProperty('--bg-light',  c[2]);
})();


const THEMES = {
    default: {
        name: 'Midnight Blue',
        dark: '#131b30',
        accent: '#405aa0',
        light: '#3498db'
    },
    forest: {
        name: 'Forest',
        dark: '#0f2318',
        accent: '#2d6a4f',
        light: '#52b788'
    },
    crimson: {
        name: 'Crimson',
        dark: '#1a0a0a',
        accent: '#8b1a1a',
        light: '#e63946'
    },
    slate: {
        name: 'Slate',
        dark: '#0f0f0f',
        accent: '#464652',
        light: '#65656d'
    }
};

function applyTheme(themeKey) {
    const theme = THEMES[themeKey] || THEMES.default;
    const root = document.documentElement;
    root.style.setProperty('--bg-dark', theme.dark);
    root.style.setProperty('--bg-accent', theme.accent);
    root.style.setProperty('--bg-light', theme.light);
}

function getSavedTheme() {
    return localStorage.getItem('cc-theme') || 'default';
}

function saveTheme(themeKey) {
    localStorage.setItem('cc-theme', themeKey);
    applyTheme(themeKey);
}

applyTheme(getSavedTheme());

window.THEMES = THEMES;
window.saveTheme = saveTheme;
window.getSavedTheme = getSavedTheme;