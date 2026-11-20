// Theme switching and website-only extras (offline service worker, install button)
// The theme is picked in Settings (Dark, Light or Match system)
const root = document.documentElement

export const getTheme = () => root.dataset.theme || "dark"

export function setTheme(theme) {
  root.dataset.theme = theme
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  document.querySelector('meta[name="theme-color"]').content = dark ? "#16171b" : "#f4f5f7"
  try {
    localStorage.setItem("lvp:theme", theme)
  } catch {}
}

export function initTheme() {
  setTheme(getTheme())
}

export function initWebApp() {
  if (root.dataset.context !== "web") return

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch((error) => console.warn("Service worker failed:", error))
  }

  const installBtn = document.querySelector("#install-btn")
  let deferredPrompt = null
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault()
    deferredPrompt = e
    installBtn.hidden = false
  })
  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    deferredPrompt = null
    installBtn.hidden = true
  })
  window.addEventListener("appinstalled", () => (installBtn.hidden = true))
}
