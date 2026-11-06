// Entry point: the core player (player.js) wires itself up on import; feature modules attach here.
import "./player.js"
import { initFiles } from "./files.js"
import { initPlaylist } from "./playlist.js"
import { initSubtitles } from "./subtitles.js"
import { initLibrary } from "./library.js"
import { initShortcuts } from "./shortcuts.js"
import { initTools } from "./tools.js"
import { initSettings } from "./settings.js"
import { initTheme, initWebApp, getTheme, setTheme } from "./pwa.js"

// Shared dialog behaviour: close buttons, click on the backdrop, header links into the About sheet
function initDialogs() {
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.close()
    })
    dialog.querySelectorAll("[data-close-dialog]").forEach((b) => b.addEventListener("click", () => dialog.close()))
  })
  const about = document.querySelector("#about-dialog")
  document.querySelectorAll("[data-open-about]").forEach((button) =>
    button.addEventListener("click", () => {
      about.showModal()
      about.querySelector(`#${button.dataset.openAbout}`)?.scrollIntoView({ block: "start" })
    })
  )
}

initTheme()
initFiles()
initPlaylist()
initSubtitles()
initShortcuts()
initTools()
initLibrary()
initSettings({ getTheme, setTheme })
initDialogs()
initWebApp()
