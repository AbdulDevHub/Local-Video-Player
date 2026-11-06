// Entry point: the core player (player.js) wires itself up on import; feature modules attach here.
import "./player.js"
import { initFiles } from "./files.js"
import { initPlaylist } from "./playlist.js"
import { initSubtitles } from "./subtitles.js"
import { initLibrary } from "./library.js"
import { initShortcuts } from "./shortcuts.js"
import { initTools } from "./tools.js"
import { initTheme, initWebApp } from "./pwa.js"

initTheme()
initFiles()
initPlaylist()
initSubtitles()
initShortcuts()
initTools()
initLibrary()
initWebApp()
