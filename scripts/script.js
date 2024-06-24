'use strict';

let preferences = {
	speed: 1.8,
	timeSkip: 10
};


// ----------------------------- VIDEO SELECTION -----------------------------
// DRAG AND DROP
const dragPanel = document.querySelector('#drag-panel');
const dropOverlay = document.querySelector('#drop-overlay');
const droppableElements = document.querySelectorAll('.droppable');
const fileName = document.querySelector('#file-name');
const video = document.querySelector('video');
let localStorageKey;

droppableElements.forEach(droppable => {
	droppable.addEventListener('dragenter', e => {
		if (e.dataTransfer.items[0].type.startsWith('video/')) {
			droppable.dataset.fileHover = true;
			dropOverlay.hidden = false;
			console.info(`A video file has entered #${e.target.id}'s dragging area. The drop overlay is now visible.`);
		}
	});
});

dropOverlay.addEventListener('dragover', e => e.preventDefault());

dropOverlay.addEventListener('drop', async (e) => {
	console.info(`A ${e.dataTransfer.items[0].type} file was dropped on #${e.target.id}.`);
	e.preventDefault();

	// Type check is done in dragenter and in the click handler
	const fileHandle = await e.dataTransfer.items[0].getAsFileSystemHandle();

	manageFileHandle(fileHandle);
	handleDragEnd();
});

dropOverlay.addEventListener('dragleave', handleDragEnd);

function handleDragEnd() {
	dropOverlay.hidden = true;
	droppableElements.forEach(droppable => {
		delete droppable.dataset.fileHover;
	});
	console.info('The drag event has ended. The drop overlay was hidden.');
}

// FILE INPUT
const filePicker = document.querySelector('#file-picker');
filePicker.addEventListener('click', async () => {
	try {
		const [fileHandle] = await window.showOpenFilePicker({
			excludeAcceptAllOption: true,
			types: [
				{
					description: 'Videos',
					accept: {
						'video/*': ['.avi', '.mp4', '.mpeg', '.ogv', '.ts', '.webm', '.3gp', '.3g2']
					}
				}
			],
			multiple: false
		});

		manageFileHandle(fileHandle);
	} catch (abortError) { }
});

// FILE HANDLING
async function manageFileHandle(fileHandle) {
	const file = await fileHandle.getFile();

	if (video.src) {
		console.info('A video change was detected. Saving the old video state in local storage…');
		updateLocalStorage();
		URL.revokeObjectURL(video.src);
	} else {
		dragPanel.hidden = true;
		player.hidden = false;
		console.info('The drag panel was hidden. The player is now visible.');
	}

	// Don't change the order of these lines!
	localStorageKey = await hashFile(file);
	video.src = URL.createObjectURL(file);

	// Remove the file extension
	fileName.textContent = file.name.replace(/\.[^.]+$/, '');

	// Update the media session on first play
	video.addEventListener('seeked', () => {
		const artwork = capture();
		navigator.mediaSession.metadata = new MediaMetadata({
			title: fileName.textContent,
			artwork: [
				{ src: artwork, sizes: '512x512', type: 'image/png' }
			]
		});
		console.info('Title and artwork for Global Media Controls updated.');
	}, { once: true });

	// Bind the global media controls to the video
	const actionHandlers = [
		['seekbackward', replay],
		['seekforward', forward]
	];

	for (const [action, handler] of actionHandlers) {
		navigator.mediaSession.setActionHandler(action, handler);
	}
}

// ----------------------------- CONTROL PLAYBACK [BOTTOM NAVIGATION] -----------------------------
const player = document.querySelector('.player');
const playBtn = document.querySelector('.play-btn');
const fullscreenBtn = document.querySelector('.fullscreen-btn');
const zoomBtn = document.querySelector('.zoom-btn');
const speedControls = document.querySelector('#speed-controls');

// Play/pause
playBtn.onclick = togglePlay;
video.onclick = togglePlay;
video.onpause = () => { playBtn.textContent = 'play_arrow'; };
video.onplay = () => { playBtn.textContent = 'pause'; };

// Fullscreen Button
let fullscreenState = 0; // 0: Normal, 1: Fullscreen + Stretch

function handleFullScreenButton() {
    if (fullscreenState === 0) { // If the video is in normal state
        player.requestFullscreen(); // Go fullscreen
        if (stretchingMode === 0) {
            toggleStretchVideo(); // Stretch the video if it's not stretched
        }
        fullscreenState = 1;
    } else { // If the video is in fullscreen + stretch state
        document.exitFullscreen(); // Exit fullscreen
        if (stretchingMode !== 0) {
            toggleStretchVideo(); // Unstretch the video if it's stretched
        }
        fullscreenState = 0;
    }
}

fullscreenBtn.onclick = handleFullScreenButton;
document.onfullscreenchange = () => {
    if (fullscreenState === 0) {
        fullscreenBtn.textContent = 'fullscreen';
    } else {
        fullscreenBtn.textContent = 'fullscreen_exit';
    }
};

video.addEventListener('dblclick', toggleFullScreen);

// Zoom
zoomBtn.onclick = toggleZoom;

function toggleZoom() {
    if (!div.classList.contains('hidden')) {
        div.classList.add('hidden'); // Hide the controls if they're not hidden
    } else {
        div.classList.remove('hidden'); // Show the controls if they're hidden
    }
    if (fullscreenState === 1) {
        toggleStretchVideo(); // Update the stretch mode based on the new visibility state of the video bar
		toggleStretchVideo();
    }
    if (fullscreenState === 0) { // If the video is in normal state
        handleFullScreenButton(); // Go fullscreen and stretch the video
    }
}

function toggleZoomCrop() {
	if (zoomBtn.textContent === 'zoom_out_map') {
		video.style.objectFit = 'cover';
		zoomBtn.textContent = 'crop_free';
	} else {
		video.style.objectFit = 'contain';
		zoomBtn.textContent = 'zoom_out_map';
	}
}

// Speed
video.onratechange = () => {
	speedControls.value = video.playbackRate.toFixed(2);
};

speedControls.onchange = () => {
	// Caused by keyboard shortcuts
	speedControls.value = parseFloat(speedControls.value).toFixed(2);
	video.playbackRate = clamp(0.1, speedControls.value, 16);
};

speedControls.oninput = () => {
	// Caused by keyboard input
	speedControls.value = parseFloat(speedControls.value).toFixed(2);
};

// ----------------------------- TIME -----------------------------
const progressBar = document.querySelector('#video-bar');
const timeIndicator = document.querySelector('#time-indicator');
const currentTime = document.querySelector('.current-time');
const timeRemaining = document.querySelector('.time-remaining');
const replayBtn = document.querySelector('.replay-btn');
const forwardBtn = document.querySelector('.forward-btn');
const duration = document.querySelector('.duration');

video.addEventListener('loadedmetadata', () => {
	if (localStorage.getItem(localStorageKey)) {
		restoreFromLocalStorage();
	} else {
		console.info('No video state found in local storage.');
	}

	updateProgressBarValue();
	updateIndicators();
	duration.textContent = secondsToTime(video.duration);
});

video.addEventListener('timeupdate', () => {
	if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
		console.info('The video metadata is not loaded yet. Skipping timeupdate event.');
		return;
	}

	updateProgressBarValue();
	updateIndicators();
});

// Seek to the point clicked on the progress bar
progressBar.addEventListener('input', () => {
	video.currentTime = (progressBar.valueAsNumber * video.duration) / 100;

	// Needed to show the time in real-time when the progress bar is dragged
	updateIndicators();
});

function updateProgressBarValue() {
	progressBar.valueAsNumber = (video.currentTime * 100) / video.duration;
}

function updateIndicators() {
	progressBar.style.setProperty("--progress", `${progressBar.valueAsNumber}%`);
	currentTime.textContent = secondsToTime(video.currentTime);
	timeRemaining.textContent = `-${secondsToTime(video.duration - video.currentTime)}`;
}

// progressBar also has tabindex="-1"
progressBar.onfocus = () => { progressBar.blur(); };

replayBtn.onclick = replay;
forwardBtn.onclick = forward;

// Toggle current time/remaining time
timeIndicator.addEventListener('click', () => {
	[timeRemaining.hidden, currentTime.hidden] = [currentTime.hidden, timeRemaining.hidden];
});

video.addEventListener('emptied', () => {
	// Needed when another video is loaded while the current one is playing
	playBtn.textContent = 'play_arrow';
});

// Save time in local storage when the window is closed/refreshed
window.onbeforeunload = () => {
	if (video.src && !video.ended) {
		updateLocalStorage();
	}
};

// CLEANUP
console.groupCollapsed('Saved states of videos last opened more than 30 days ago will be deleted.');
for (const key of Object.keys(localStorage)) {
	const entryDate = new Date(JSON.parse(localStorage.getItem(key)).last_opened);
	if (entryDate < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) {
		localStorage.removeItem(key);
		console.info(`${key} deleted.`);
	} else {
		console.info(`${key} kept.`);
	}
}
console.groupEnd();

video.onended = () => {
	localStorage.removeItem(localStorageKey);
	console.info('Video ended. Video state deleted from local storage.');
};


// ----------------------------- KEYBOARD SHORTCUTS -----------------------------
let isFullScreenKey = false; // Variable to track if 'f' or 'g' was pressed
let div = document.querySelector('.controls'); //Hide Playbar/Controls

document.addEventListener('keydown', (e) => {
	// Ignore key presses when a modifier key is pressed
	if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey)
		return;

	if (e.key !== ' ') {
		document.activeElement.blur();
	}

	switch (e.key) {
		case ' ': // Toggle play
			if (document.activeElement.tagName === 'BUTTON')
				break;
			togglePlay();
			break;
		case 'g':
			isFullScreenKey = true; // Set the variable to true when 'g' is pressed
			if (fullscreenState === 1 && div.classList.contains('hidden')) { // If the video is in fullscreen state
				toggleStretchVideo(); // Exit fullscreen and unstretch the video
				document.exitFullscreen();
				if (!div.classList.contains('hidden')) {
					div.classList.add('hidden'); // Hide the controls if they're not hidden
				} else {
					div.classList.remove('hidden'); // Show the controls if they're hidden
				}
				fullscreenState = 0;
			} else {
				toggleZoom();
			}
			break;
		case 'd': // Slow down
		case 'D':
			speedControls.stepDown();
			speedControls.dispatchEvent(new Event('change'));
			break;
		case 's': // Speed up
		case 'S':
			speedControls.stepUp();
			speedControls.dispatchEvent(new Event('change'));
			break;
		case 'ArrowLeft': // Rewind
			if (document.activeElement.tagName !== 'INPUT')
				replay();
			break;
		case 'ArrowRight': // Advance
			if (document.activeElement.tagName !== 'INPUT')
				forward();
			break;
		case 'a': // Reset speed
		case 'A':
			video.playbackRate = video.defaultPlaybackRate;
			break;
		case 'q': // Preferred fast speed
		case 'Q':
			if (video.playbackRate === 1.7) {
				video.playbackRate = 1;
			} else {video.playbackRate = 1.7;}
			break;
		case 'w': // Preferred fast speed
		case 'W':
			if (video.playbackRate === 2) video.playbackRate = 1;
			else video.playbackRate = 2;
			break;
		case 'e': // Preferred fast speed
		case 'E':
			if (video.playbackRate === 2.7) video.playbackRate = 1;
			else video.playbackRate = 2.7;
			break;
		case 't': // Preferred fast speed
		case 'T':
			if (video.playbackRate === 4) video.playbackRate = 1;
			else video.playbackRate = 4;
			break;
		case 'r': // Traverse Speeds
		case 'R':
			if (video.playbackRate === 1) video.playbackRate = 3;
			else if (video.playbackRate === 3) video.playbackRate = 4;
			else if (video.playbackRate === 4) video.playbackRate = 2;
			else video.playbackRate = 1;
			break;
		case 'h':
		case 'H': // //Hide Playbar/Controls
			if (fullscreenState === 1) { // If the video is in fullscreen state
				if (div.classList.contains('hidden')) { // Same as pressing 'f'
					toggleStretchVideo();
					if (!div.classList.contains('hidden')) {
						div.classList.add('hidden'); // Hide the controls if they're not hidden
					} else {
						div.classList.remove('hidden'); // Show the controls if they're hidden
					}
					toggleStretchVideo();
				} else { // Same as pressing 'g'
					toggleZoom();
				}
			} else {
				// If not in fullscreen mode, hide the video bar normally
				if (div.classList.contains('hidden')) {
					div.classList.remove('hidden');
				} else {
					div.classList.add('hidden');
				}
			}
			break;
		case 'm': // Toggle mute
			toggleMute();
			break;
		case 'c': // Toggle zoom
			toggleZoomCrop();
			break;
		case 'u': // Toggle video stretching
		  toggleStretchVideo();
		  break;
		case 'p': // Toggle PiP
			togglePictureInPicture();
			break;
		case 'f':
		case 'F':
			if (document.activeElement.tagName !== 'BUTTON' && document.activeElement.tagName !== 'INPUT') {
				if (fullscreenState === 1 && div.classList.contains('hidden')) { // If the video is in fullscreen state
					toggleStretchVideo();
					if (!div.classList.contains('hidden')) {
						div.classList.add('hidden'); // Hide the controls if they're not hidden
					} else {
						div.classList.remove('hidden'); // Show the controls if they're hidden
					}
					toggleStretchVideo();
				} else {
					isFullScreenKey = true; // Set the variable to true when 'f' is pressed
					handleFullScreenButton();
				}
			}
	}
});

function togglePlay() {
	video.paused ? video.play() : video.pause();
}

function toggleMute() {
	video.muted = !video.muted;
}

function clamp(min, value, max) {
	return Math.min(Math.max(value, min), max);
}

function replay() {
	video.currentTime = Math.max(video.currentTime - preferences.timeSkip, 0);
}

function forward() {
	video.currentTime = Math.min(video.currentTime + preferences.timeSkip, video.duration);
}

function togglePictureInPicture() {
	(document.pictureInPictureElement) ?
		document.exitPictureInPicture() :
		video.requestPictureInPicture();
}

// Add this function to check visibility state
function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
        // Page is not visible, perform actions here
        if (stretchingMode !== 0) {
            toggleStretchVideo(); // If the video is stretched, toggleStretchVideo to unstretch
        }
        div.classList.remove('hidden'); // Show the video bar
		fullscreenState = 0;
    }
}

// Attach the event listener for visibility change
document.addEventListener('visibilitychange', handleVisibilityChange);

// Modify the toggleFullScreen function
function toggleFullScreen() {
    if (document.fullscreenElement) {
        // Check if the document is currently in fullscreen
        document.exitFullscreen();
		if (div.classList.contains('hidden')) {
			div.classList.remove('hidden'); // Show the controls if they're hidden
		}
		fullscreenState = 0;
    } else {
        player.requestFullscreen();
    }
}

document.addEventListener('fullscreenchange', (event) => {
	if (!document.fullscreenElement) {
	  // If the video is not in fullscreen mode
	  if (stretchingMode !== 0) {
		toggleStretchVideo(); // If the video is stretched, unstretch it
	  }
	  if (div.classList.contains('hidden')) {
		div.classList.remove('hidden'); // Show the video bar
	  }
	  fullscreenState = 0;
	}
	//isFullScreenKey = false; && !isFullScreenKey // Reset the variable after the fullscreen change
});

let stretchingMode = 0; // 0: Original, 1: Strech Video
let isVideoReady = false; // Add this flag

video.onloadedmetadata = function() {
    isVideoReady = true; // Set the flag to true when the video is ready
    if (fullscreenState === 1) { // If the video is in fullscreen state
        toggleStretchVideo(); // Stretch the video when it's ready
    }
};

function toggleStretchVideo() {
    if (!isVideoReady) return; // If the video is not ready, ignore the stretch
  
	// Calculate the scale factor based on the video's aspect ratio
	const aspect = video.videoWidth / video.videoHeight;
	let mode;
  
	if (aspect >= 1.77) { // 16:9 video
	  mode = div.classList.contains('hidden') ? 'mode-1' : 'fullscreen-mode-1';
	} else { // 4:3 video
	  mode = div.classList.contains('hidden') ? 'mode-2' : 'fullscreen-mode-2';
	}
  
	if (stretchingMode === 0) {
	  stretchingMode = 1;
	  video.classList.add('stretchClass', mode);
	  console.log(`Video stretching enabled. Mode: ${mode}`);
	} else {
	  stretchingMode = 0;
	  video.classList.remove('stretchClass', 'mode-1', 'mode-2', 'fullscreen-mode-1', 'fullscreen-mode-2');
	  console.log(`Video stretching disabled. Mode: ${mode}`);
	}
}

function toggleTimeIndicator() {
	[currentTime.hidden, timeRemaining.hidden] = [timeRemaining.hidden, currentTime.hidden];
}

// Convert seconds to time in format (h:)mm:ss
// Use https://tc39.es/proposal-temporal/docs/duration.html when available
function secondsToTime(seconds) {
	return new Date(seconds * 1000).toISOString().substring((seconds >= 3600) ? 12 : 14, 19);
}


// ----------------------------- UTILITIES -----------------------------
async function hashFile(file) {
	// Get byte array of file
	const arrayBuffer = await file.arrayBuffer();

	// Hash the byte array
	const hashAsArrayBuffer = await crypto.subtle.digest('SHA-1', arrayBuffer);

	// Get the hex value of each byte and store it in an array
	const hashAsUint8 = new Uint8Array(hashAsArrayBuffer);
	const hashAsArray = Array.from(hashAsUint8);

	// Convert each byte to a hex string
	const hashAsString = hashAsArray.map(b => b.toString(16).padStart(2, '0')).join('');
	return hashAsString;
}

function updateLocalStorage() {
	let state = {
		timer: video.currentTime,
		playbackRate: video.playbackRate,
		last_opened: Date.now()
	};
	localStorage.setItem(localStorageKey, JSON.stringify(state));
	console.info('Video state saved in local storage.');
}

function restoreFromLocalStorage() {
	let state = JSON.parse(localStorage.getItem(localStorageKey));
	video.currentTime = state.timer;
	video.playbackRate = state.playbackRate;
	console.info('Video state restored from local storage.');
}

function capture() {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 512;

	const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
	const x = (canvas.width / 2) - (video.videoWidth / 2) * scale;
	const y = (canvas.height / 2) - (video.videoHeight / 2) * scale;

	const context = canvas.getContext('2d');
	context.drawImage(video, x, y, video.videoWidth * scale, video.videoHeight * scale);

	const dataURL = canvas.toDataURL();

	return dataURL;
}

// ----------------------------- PROGRESS BAR SEEKER GIANT -----------------------------
let originalTime = undefined;
let isActivated = false;

// Add event listener for keydown
window.addEventListener('keydown', (e) => {
    if (e.key === 'A') {
        isActivated = !isActivated;  // Toggle the activation state
        if (isActivated) {
            originalTime = video.currentTime;  // Save the original time
			if (!video.paused) {  // If the video is playing
                video.pause();  // Pause the video
            }
        } else {
            video.currentTime = originalTime;  // Reset the video's current time to the original time
        }
    }
});

// Add event listener for mousemove
window.addEventListener('mousemove', (e) => {
    if (isActivated) {  // Only update the video's current time if the feature is activated
        let rect = progressBar.getBoundingClientRect();
        let x = e.clientX - rect.left;  // Get the x coordinate of the mouse
        let percent = x / rect.width;  // Calculate the percentage of the progress bar that was hovered over
        video.currentTime = percent * video.duration;  // Update the video's current time
    }
});

// Add event listener for click
progressBar.addEventListener('click', (e) => {
    if (isActivated) {  // Only update the original time if the feature is activated
        let rect = e.target.getBoundingClientRect();
        let x = e.clientX - rect.left;  // Get the x coordinate of the mouse
        let percent = x / rect.width;  // Calculate the percentage of the progress bar that was clicked
        originalTime = percent * video.duration;  // Update the original time to the clicked position
        video.currentTime = originalTime;  // Update the video's current time to the clicked position
        isActivated = false;  // Deactivate the feature
    }
});

// Add event listener for play
video.addEventListener('play', () => {
    if (isActivated) {  // If the feature is activated
        isActivated = false;  // Deactivate the feature
        originalTime = video.currentTime;  // Update the original time to the current time of the video
    }
});

// ----------------------------- PROGRESS BAR SEEKER SMALL -----------------------------
document.addEventListener('DOMContentLoaded', function () {
    const videoBar = document.getElementById('video-bar');
    const seekerPreview = document.getElementById('seeker-preview');
    const mainVideo = document.getElementById('main-video');
    const previewVideo = document.createElement('video');

    let isVideoLoaded = false;
    let isSeekerActive = false;
	let aspectRatio, seekerWidth; // Declare here

    mainVideo.addEventListener('loadedmetadata', function () {
        isVideoLoaded = true;

		// Calculate aspectRatio and seekerWidth here
        aspectRatio = mainVideo.videoWidth / mainVideo.videoHeight;
        seekerWidth = aspectRatio >= 1.77 ? 340 : 260;
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'a') {
            isSeekerActive = !isSeekerActive;
        }
    });

    mainVideo.addEventListener('play', function () {
        isSeekerActive = false;
    });

    videoBar.addEventListener('click', function (e) {
        isSeekerActive = false;
    });

    videoBar.addEventListener('mousemove', function (e) {
        if (!isVideoLoaded || !isSeekerActive) return;

        const rect = videoBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        const previewTime = percent * mainVideo.duration;

        // Update seeker preview position
        const previewLeft = e.clientX - seekerWidth/2;
        seekerPreview.style.left = `${previewLeft}px`;

        // Display seeker preview
        seekerPreview.style.display = 'block';

        // Update seeker preview content based on the current time
        previewVideo.src = mainVideo.src;
        previewVideo.currentTime = previewTime;
        seekerPreview.innerHTML = `
            <div>${formatTime(previewTime)}</div>
        `;
        seekerPreview.prepend(previewVideo);
    });

    videoBar.addEventListener('mouseleave', function () {
        // Hide seeker preview when leaving the video bar
        seekerPreview.style.display = 'none';
    });

    // Helper function to format time in M:SS
    function formatTime(time) {
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
    }
});