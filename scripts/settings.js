// User settings (saved in localStorage) and the settings dialog.
// Standalone on purpose: player.js and the feature modules import `settings` to read values.
const KEY = "lvp:settings"

export const DEFAULTS = {
  controls: {
    home: true,
    skip: true,
    next: true,
    volume: true,
    time: true,
    name: true,
    speed: true,
    subtitles: true,
    playlist: true,
    shortcuts: true,
    fullscreen: true,
    zoom: true,
  },
  autoplay: true,
  resume: true,
  skip: 10,
  stretchVertical: false,
  maxStretch: 1.35,
}

// Which control-bar elements each "controls.*" setting shows or hides
const CONTROL_SELECTORS = {
  home: ".home-btn",
  skip: ".rewind-btn, .forward-btn",
  next: ".next-btn",
  volume: ".volume-container",
  time: "#time-indicator",
  name: "#file-name-container",
  speed: ".speed-control-container",
  subtitles: ".controls .menu-anchor",
  playlist: ".playlist-btn",
  shortcuts: ".help-btn",
  fullscreen: ".fullscreen-btn",
  zoom: ".zoom-btn",
}

const clone = (value) => JSON.parse(JSON.stringify(value))

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY)) ?? {}
    const merged = { ...clone(DEFAULTS), ...saved, controls: { ...DEFAULTS.controls, ...saved.controls } }
    // Only values the UI offers (icons exist for 5/10/30 s skips)
    if (![5, 10, 30].includes(merged.skip)) merged.skip = DEFAULTS.skip
    if (!(Number(merged.maxStretch) >= 1)) merged.maxStretch = DEFAULTS.maxStretch
    return merged
  } catch {
    return clone(DEFAULTS)
  }
}

export const settings = load()
const listeners = new Set()

export function onSettingsChange(listener) {
  listeners.add(listener)
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {}
  listeners.forEach((listener) => listener(settings))
}

function applyControls() {
  for (const [name, selector] of Object.entries(CONTROL_SELECTORS)) {
    document.querySelectorAll(selector).forEach((el) => el.classList.toggle("ctl-off", !settings.controls[name]))
  }
}

// ----------------------------- DIALOG -----------------------------
export function initSettings({ getTheme, setTheme }) {
  const dialog = document.querySelector("#settings-dialog")
  const form = document.querySelector("#settings-form")

  const fill = () => {
    for (const el of form.elements) {
      if (!el.name) continue
      const [group, key] = el.name.split(".")
      const value = key ? settings[group][key] : el.name === "theme" ? getTheme() : settings[group]
      if (el.type === "checkbox") el.checked = Boolean(value)
      else el.value = String(value)
    }
  }

  form.addEventListener("change", (e) => {
    const el = e.target
    if (!el.name) return
    if (el.name === "theme") return setTheme(el.value)
    const [group, key] = el.name.split(".")
    const value = el.type === "checkbox" ? el.checked : Number(el.value)
    if (key) settings[group][key] = value
    else settings[group] = value
    save()
  })
  form.addEventListener("submit", (e) => e.preventDefault())

  document.querySelector("#settings-reset").addEventListener("click", () => {
    Object.assign(settings, clone(DEFAULTS))
    setTheme("dark")
    save()
    fill()
  })

  document.querySelectorAll("[data-open-settings]").forEach((button) =>
    button.addEventListener("click", () => {
      fill()
      const host = document.fullscreenElement ?? document.body
      if (dialog.parentElement !== host) host.append(dialog)
      dialog.showModal()
    })
  )

  onSettingsChange(applyControls)
  applyControls()
}
