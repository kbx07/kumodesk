// Applies the chosen light / dark mode before the first paint.
try { var s = localStorage.getItem('kd.scheme'); if (s === 'light' || s === 'dark') document.documentElement.dataset.scheme = s; } catch (e) { /* storage unavailable */ }
