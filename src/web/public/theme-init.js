// Apply the saved theme before first paint to avoid a flash of the wrong theme.
// An external file, so the Content-Security-Policy can forbid inline scripts.
try {
  var t = localStorage.getItem('rpm.theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
} catch (e) {}
