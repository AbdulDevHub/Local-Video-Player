// On-screen feedback: the small status pill (HUD), the big play/pause pulse and toasts
const hudEl = document.querySelector("#hud")
const pulseEl = document.querySelector("#pulse")
const toastsEl = document.querySelector("#toasts")
let hudTimer

const icon = (name) => `<span class="material-icon" aria-hidden="true">${name}</span>`

export const hud = {
  show(iconName, text) {
    hudEl.innerHTML = `${iconName ? icon(iconName) : ""}<span></span>`
    hudEl.lastElementChild.textContent = text
    hudEl.classList.add("visible")
    clearTimeout(hudTimer)
    hudTimer = setTimeout(() => hudEl.classList.remove("visible"), 900)
  },

  pulse(iconName) {
    pulseEl.innerHTML = icon(iconName)
    pulseEl.classList.remove("animate")
    void pulseEl.offsetWidth // restart the animation
    pulseEl.classList.add("animate")
  },
}

// toast("Saved", { action: { label: "Undo", onClick }, timeout: 5000 })
export function toast(text, { action, timeout = 4000 } = {}) {
  // Fullscreen hides everything outside the fullscreen element, so follow it there
  const host = document.fullscreenElement ?? document.body
  if (toastsEl.parentElement !== host) host.append(toastsEl)

  const el = document.createElement("div")
  el.className = "toast"
  el.innerHTML = "<span></span>"
  el.firstElementChild.textContent = text
  if (action) {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = action.label
    button.addEventListener("click", () => {
      action.onClick()
      dismiss()
    })
    el.append(button)
  }
  toastsEl.append(el)
  requestAnimationFrame(() => el.classList.add("visible"))

  function dismiss() {
    el.classList.remove("visible")
    setTimeout(() => el.remove(), 300)
  }
  setTimeout(dismiss, timeout)
  return dismiss
}
