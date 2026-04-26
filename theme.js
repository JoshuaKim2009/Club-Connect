(function() {
    const saved = localStorage.getItem('cc-theme');
    const map = {
        default: ['#152242','#405aa0','#3498db'],
        forest:  ['#18422b','#2d6a4f','#52b788'],
        crimson: ['#6b1b1b','#a53131','#f85c69'],
        slate:   ['#0f0f0f','#21213f','#9b9bc4']
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
        dark: '#152242',
        accent: '#405aa0',
        light: '#3498db'
    },
    forest: {
        name: 'Forest',
        dark: '#18422b',
        accent: '#2d6a4f',
        light: '#52b788'
    },
    crimson: {
        name: 'Crimson',
        dark: '#6b1b1b',
        accent: '#a53131',
        light: '#f85c69'
    },
    slate: {
        name: 'Slate',
        dark: '#080813',
        accent: '#232342',
        light: '#9b9bc4'
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