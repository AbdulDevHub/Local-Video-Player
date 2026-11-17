// Sideways wheel → vertical scroll (e.g. the thumb wheel on an MX Master), for people who scroll
// pages with it. Userscripts can't run on extension pages, so the player does it itself.
// Turned on or off in Settings → Mouse.
import { settings, onSettingsChange } from "./settings.js"

// Smooth scrolling makes rapid wheel steps stutter, so it's switched off while this is on
const noSmooth = document.createElement("style")
noSmooth.textContent = "*, *::before, *::after { scroll-behavior: auto !important; }"

function scrollableParent(el) {
  for (; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el)
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) return el
  }
  return null
}

function onWheel(e) {
  if (!settings.sidewaysScroll || e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
  const target = document.elementFromPoint(e.clientX, e.clientY)
  if (!target) return
  // Leave sliders alone (volume, progress bar)
  if (target.closest("input[type=range]")) return
  e.preventDefault()
  const scroller = scrollableParent(target)
  if (scroller) scroller.scrollTop += e.deltaX
  else window.scrollBy({ top: e.deltaX, left: 0, behavior: "auto" })
}

export function initSidewaysScroll() {
  const apply = () => {
    if (settings.sidewaysScroll) document.head.append(noSmooth)
    else noSmooth.remove()
  }
  window.addEventListener("wheel", onWheel, { passive: false })
  onSettingsChange(apply)
  apply()
}
