# Player for local videos

<img height="400" alt="Extension Screenshot" src="https://github.com/AbdulDevHub/Local-Video-Player/blob/main/Extension%20Screenshot.png?raw=true">

## Overview

This a video player for local videos whose main features are:

* Light/dark theme (following system preferences)
* Continue watching from where you left off[^1]
* Volume amplification up to 500% for quiet videos
* Improved speed controls with preset cycling and fine adjustments
* [Keyboard shortcuts](#keyboard-shortcuts)
* Global Media Controls integration
* Works offline

[^1]: The video state is saved in the browser's local storage. If you clear your browser's data, the state will be lost. Saved state will be deleted upon video completion or for videos last played more than 30 days ago.

## Setup

To install and use this extension locally, follow these steps:

1. Clone the repository
2. Navigate to the project directory
3. Open the Chrome browser and go to `chrome://extensions/`
4. Enable Developer mode by ticking the checkbox in the upper-right corner.
5. Click on the "Load unpacked" button.
6. Select the directory containing your unpacked extension.

## Usage

To use the extension, click on its tooltip icon or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>.
This shortcut can be changed by visiting <chrome://extensions/shortcuts> (you may need to copy and paste this URL in the address bar).

The page shown in the screenshots will open.
To open a video, drag and drop it there or click on the button.
If another video is opened, its state will be saved and the dragged video will be opened.

### Speed Controls

The player features an improved speed control interface with three buttons:

* **Center display**: Click to cycle through preset speeds (1.0x → 1.5x → 2.0x → 2.5x → 3.0x → 4.0x → back to 1.0x). Shows a ★ indicator when on a preset speed.
* **− button**: Decrease speed by 0.1x for fine-grained control
* **+ button**: Increase speed by 0.1x for fine-grained control

Speed range: 0.1x to 16.0x

### Keyboard shortcuts

The following keyboard shortcuts are supported:

|                          Key                           | Action                             |
| :----------------------------------------------------: | ---------------------------------- |
|            <kbd>Space</kbd><br><kbd>K</kbd>            | Toggle play/pause                  |
|                      <kbd>D</kbd>                      | Slow down by 0.1x                  |
|                      <kbd>S</kbd>                      | Speed up by 0.1x                   |
|                   <kbd>&larr;</kbd>                    | Rewind 10 seconds                  |
|                   <kbd>&rarr;</kbd>                    | Forward 10 seconds                 |
|                   <kbd>&uarr;</kbd>                    | Increase volume                    |
|                   <kbd>&darr;</kbd>                    | Decrease volume                    |
|                      <kbd>A</kbd>                      | Reset to default speed (1x)        |
|                   <kbd>Click Speed</kbd>               | Toggle time elapsed/remaining      |
|                      <kbd>M</kbd>                      | Toggle mute                        |
|                      <kbd>C</kbd>                      | Toggle video zoom                  |
|                      <kbd>P</kbd>                      | Toggle PiP                         |
|            <kbd>F</kbd><br><kbd>Enter</kbd>            | Toggle fullscreen                  |
|                      <kbd>G</kbd>                      | Toggle fullscreen or zoom          |
|                      <kbd>Q</kbd>                      | Set speed to 1.5x or reset to 1x   |
|                      <kbd>W</kbd>                      | Set speed to 2x or reset to 1x     |
|                      <kbd>E</kbd>                      | Set speed to 2.5x or reset to 1x   |
|                      <kbd>R</kbd>                      | Set speed to 3x or reset to 1x     |
|                      <kbd>T</kbd>                      | Set speed to 4x or reset to 1x     |
|                      <kbd>H</kbd>                      | Hide playbar/controls              |
|                      <kbd>U</kbd>                      | Toggle video stretching            |
|                <kbd>CTRL + ↑→↓← </kbd>                 | Stretch video ↑→↓← slightly        |
|                      <kbd>Z</kbd>                      | Toggle giant video seeker mode     |
|                      <kbd>z</kbd>                      | Toggle small video seeker mode     |
|                      <kbd>V</kbd>                      | Toggle preview bar                 |

## Contributing

While this is a personal project, I'm open to collaboration. If you have suggestions for improvements, please open an issue.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

<br>
