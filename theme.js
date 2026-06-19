(function() {
    const saved = localStorage.getItem('cc-theme');
    const map = {
        default: ['#1c375f','#4066a0','#3498db'],
        forest:  ['#2a644a','#45866a','#52b788'],
        crimson: ['#9e3030','#c24848','#f85c69'],
        slate:   ['#1c1c2b','#2e2e44','#686880']
    };
    const c = map[saved] || map.default;
    const r = document.documentElement;
    r.style.setProperty('--bg-dark',   c[0]);
    r.style.setProperty('--bg-accent', c[1]);
    r.style.setProperty('--bg-light',  c[2]);
    const meta = document.getElementById('theme-color-meta');
    if (meta) meta.setAttribute('content', c[0]);
})();


const THEMES = {
    default: {
        name: 'Midnight Blue',
        dark: '#1c375f',
        accent: '#4066a0',
        light: '#3498db'
    },
    forest: {
        name: 'Forest',
        dark: '#2a644a',
        accent: '#45866a',
        light: '#52b788'
    },
    crimson: {
        name: 'Crimson',
        dark: '#9e3030',
        accent: '#c24848',
        light: '#f85c69'
    },
    slate: {
        name: 'Slate',
        dark: '#1c1c2b',
        accent: '#2e2e44',
        light: '#686880'
    }
};

function applyTheme(themeKey) {
    const theme = THEMES[themeKey] || THEMES.default;
    const root = document.documentElement;
    root.style.setProperty('--bg-dark', theme.dark);
    root.style.setProperty('--bg-accent', theme.accent);
    root.style.setProperty('--bg-light', theme.light);
    const metaThemeColor = document.getElementById('theme-color-meta');
    if (metaThemeColor) metaThemeColor.setAttribute('content', theme.dark);
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