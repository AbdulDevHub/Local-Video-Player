// SRT/VTT subtitles drawn in our own overlay (works with zoom/stretch, styleable, adjustable delay)
import { bus, elements } from "./player.js"
import { hud, toast } from "./hud.js"

const overlay = document.querySelector("#subtitle-overlay")
const menu = document.querySelector("#subtitles-menu")
const button = document.querySelector(".subtitles-btn")
const nameEl = document.querySelector("#subtitles-name")
const toggleEl = document.querySelector("#subtitles-toggle")
const offsetEl = document.querySelector("#subtitles-offset")
const sizeEl = document.querySelector("#subtitles-size")
const input = document.querySelector("#subtitles-input")

const prefs = { size: 1 }
try {
  prefs.size = Number(localStorage.getItem("lvp:subtitle-size")) || 1
} catch {}

const state = { cues: [], offset: 0, enabled: true, name: "", lastHtml: "", frame: 0 }

// ----------------------------- PARSING -----------------------------
function parseTimestamp(text) {
  const parts = text.trim().replace(",", ".").split(":").map(Number)
  if (parts.some(Number.isNaN)) return NaN
  return parts.reduce((total, part) => total * 60 + part, 0)
}

const escapeHtml = (text) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])

// Keeps <i>, <b> and <u>; drops everything else (VTT voice/class tags, ASS {\an8} overrides…)
function cleanText(text) {
  const stripped = text.replace(/\{\\[^}]*\}/g, "").replace(/<(?!\/?[ibu]>)[^>]*>/gi, "")
  return escapeHtml(stripped)
    .replace(/&lt;(\/?)([ibu])&gt;/gi, "<$1$2>")
    .split("\n")
    .join("<br>")
}

export function parseSubtitles(text) {
  const cues = []
  const blocks = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/)
  for (const block of blocks) {
    const lines = block.split("\n")
    const timingIndex = lines.findIndex((line) => line.includes("-->"))
    if (timingIndex === -1) continue
    const [startText, endRest] = lines[timingIndex].split("-->")
    const start = parseTimestamp(startText)
    const end = parseTimestamp(endRest.trim().split(/\s+/)[0])
    const body = lines.slice(timingIndex + 1).join("\n").trim()
    if (Number.isFinite(start) && Number.isFinite(end) && body) cues.push({ start, end, html: cleanText(body) })
  }
  return cues.sort((a, b) => a.start - b.start)
}

// ----------------------------- RENDERING -----------------------------
function render() {
  const time = elements.video.currentTime - state.offset
  const html = state.enabled
    ? state.cues
        .filter((cue) => cue.start <= time && time < cue.end)
        .map((cue) => `<span>${cue.html}</span>`)
        .join("")
    : ""
  if (html !== state.lastHtml) {
    overlay.innerHTML = html
    state.lastHtml = html
  }
}

function loop() {
  render()
  state.frame = elements.video.paused ? 0 : requestAnimationFrame(loop)
}

function updateMenu() {
  nameEl.textContent = state.name || "No subtitles loaded"
  toggleEl.setAttribute("aria-checked", String(state.enabled))
  toggleEl.querySelector(".material-icon").textContent = state.enabled ? "check_box" : "check_box_outline_blank"
  toggleEl.disabled = !state.cues.length
  offsetEl.textContent = `${state.offset > 0 ? "+" : ""}${state.offset.toFixed(1)}s`
  sizeEl.textContent = `${Math.round(prefs.size * 100)}%`
  button.textContent = state.cues.length && state.enabled ? "subtitles" : "subtitles_off"
  overlay.style.setProperty("--sub-scale", prefs.size)
}

export const subtitles = {
  async load(file) {
    const cues = parseSubtitles(await file.text())
    if (!cues.length) return toast(`“${file.name}” has no readable subtitles`)
    Object.assign(state, { cues, offset: 0, enabled: true, name: file.name, lastHtml: "" })
    updateMenu()
    render()
    toast(`Subtitles loaded: ${file.name}`)
  },

  reset() {
    Object.assign(state, { cues: [], offset: 0, name: "", lastHtml: "" })
    overlay.innerHTML = ""
    updateMenu()
  },

  toggle() {
    if (!state.cues.length) return hud.show("subtitles_off", "No subtitles: drop an .srt or .vtt file")
    state.enabled = !state.enabled
    updateMenu()
    render()
    hud.show(state.enabled ? "subtitles" : "subtitles_off", state.enabled ? "Subtitles on" : "Subtitles off")
  },

  shiftOffset(delta) {
    state.offset = Math.round((state.offset + delta) * 10) / 10
    updateMenu()
    render()
    hud.show("schedule", `Subtitle delay ${offsetEl.textContent}`)
  },

  resize(delta) {
    prefs.size = Math.min(2.5, Math.max(0.5, Math.round((prefs.size + delta) * 10) / 10))
    try {
      localStorage.setItem("lvp:subtitle-size", prefs.size)
    } catch {}
    updateMenu()
  },

  toggleMenu(force) {
    const open = force ?? menu.hidden
    menu.hidden = !open
    button.setAttribute("aria-expanded", String(open))
    if (open) menu.dataset.overlayOpen = ""
    else delete menu.dataset.overlayOpen
  },
}

export function initSubtitles() {
  updateMenu()
  bus.addEventListener("media:loaded", subtitles.reset)
  elements.video.addEventListener("play", () => {
    cancelAnimationFrame(state.frame)
    loop()
  })
  elements.video.addEventListener("seeked", render)
  elements.video.addEventListener("pause", render)

  button.addEventListener("click", (e) => {
    e.stopPropagation()
    subtitles.toggleMenu()
  })
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target)) subtitles.toggleMenu(false)
  })
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) subtitles.toggleMenu(false)
  })

  document.querySelector("#subtitles-load").addEventListener("click", () => input.click())
  input.addEventListener("change", () => {
    if (input.files[0]) subtitles.load(input.files[0])
    input.value = ""
    subtitles.toggleMenu(false)
  })
  toggleEl.addEventListener("click", subtitles.toggle)
  menu.querySelectorAll("[data-sub-offset]").forEach((el) =>
    el.addEventListener("click", () => subtitles.shiftOffset(Number(el.dataset.subOffset)))
  )
  menu.querySelectorAll("[data-sub-size]").forEach((el) =>
    el.addEventListener("click", () => subtitles.resize(Number(el.dataset.subSize)))
  )
}
