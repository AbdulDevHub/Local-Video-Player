// Runs before first paint (classic script, no inline JS so it also passes the extension's CSP):
// applies the saved theme and marks whether we run as the Chrome extension or the website.
;(() => {
  const root = document.documentElement
  let theme = "dark"
  try {
    theme = localStorage.getItem("lvp:theme") || "dark"
  } catch {}
  root.dataset.theme = theme
  root.dataset.context = location.protocol === "chrome-extension:" ? "extension" : "web"
})()
