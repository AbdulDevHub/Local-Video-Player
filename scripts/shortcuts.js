// The "?" keyboard shortcuts dialog
export const SHORTCUTS = [
  {
    title: "Playback",
    keys: [
      [["Space", "K"], "Play / pause"],
      [["←"], "Skip back (5/10/30s in Settings)"],
      [["→"], "Skip forward"],
      [["0", "–", "9"], "Jump to 0% – 90%"],
      [[",", "."], "Previous / next frame (paused)"],
      [["N"], "Next in playlist"],
      [["B"], "Previous in playlist"],
      [["L"], "Show playlist"],
    ],
  },
  {
    title: "Speed",
    keys: [
      [["S"], "Speed up by 0.1×"],
      [["D"], "Slow down by 0.1×"],
      [["A"], "Reset to 1×"],
      [["Q"], "1.5× (press again for 1×)"],
      [["W"], "2×"],
      [["E"], "2.5×"],
      [["R"], "3×"],
      [["T"], "4×"],
    ],
  },
  {
    title: "Sound & subtitles",
    keys: [
      [["↑"], "Volume up (to 500%)"],
      [["↓"], "Volume down"],
      [["M"], "Mute"],
      [["Y"], "Subtitles on / off"],
    ],
  },
  {
    title: "View",
    keys: [
      [["F"], "Fullscreen"],
      [["G"], "Fullscreen or zoom"],
      [["C"], "Crop to fill"],
      [["U"], "Stretch to fill"],
      [["Ctrl", "+", "↑→↓←"], "Fine-tune stretch"],
      [["P"], "Picture-in-picture"],
      [["H"], "Hide controls"],
      [["V"], "Thin progress bar (controls hidden)"],
    ],
  },
  {
    title: "Tools",
    keys: [
      [["["], "Set loop start (A)"],
      [["]"], "Set loop end (B)"],
      [["\\"], "Clear loop"],
      [["I"], "Save screenshot"],
      [["Shift", "+", "Z"], "Giant seeker (move mouse to scrub)"],
      [["Z"], "Turn progress bar thumbnails on/off"],
      [["O"], "Open files"],
      [["?"], "This list"],
    ],
  },
]

const dialog = document.querySelector("#shortcuts-dialog")

function build() {
  const groups = document.querySelector("#shortcut-groups")
  groups.replaceChildren(
    ...SHORTCUTS.map(({ title, keys }) => {
      const section = document.createElement("section")
      const heading = document.createElement("h3")
      heading.textContent = title
      const dl = document.createElement("dl")
      for (const [combo, label] of keys) {
        const dt = document.createElement("dt")
        combo.forEach((key) => {
          if (key === "+" || key === "–") return dt.append(` ${key} `)
          const kbd = document.createElement("kbd")
          kbd.textContent = key
          dt.append(kbd)
        })
        const dd = document.createElement("dd")
        dd.textContent = label
        dl.append(dt, dd)
      }
      section.append(heading, dl)
      return section
    })
  )
}

export const shortcutsDialog = {
  open() {
    // Inside fullscreen only the fullscreen element is visible, so move the dialog there
    const host = document.fullscreenElement === document.documentElement ? document.body : (document.fullscreenElement ?? document.body)
    if (dialog.parentElement !== host) host.append(dialog)
    if (!dialog.open) dialog.showModal()
  },
  toggle() {
    dialog.open ? dialog.close() : shortcutsDialog.open()
  },
}

export function initShortcuts() {
  build()
  document.querySelectorAll("[data-open-shortcuts]").forEach((el) => el.addEventListener("click", shortcutsDialog.open))
  document.querySelector("#shortcuts-close").addEventListener("click", () => dialog.close())
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close() // click on the backdrop
  })
}
