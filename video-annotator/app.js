const video = document.getElementById('main-video');
const videoUpload = document.getElementById('video-upload');
const videoUrl = document.getElementById('video-url');
const loadUrlBtn = document.getElementById('load-url-btn');
const videoSizeSlider = document.getElementById('video-size');
const videoContainer = document.getElementById('video-container');

const playPauseBtn = document.getElementById('play-pause-btn');
const seekSlider = document.getElementById('seek-slider');
const timeDisplay = document.getElementById('time-display');
const frameInput = document.getElementById('frame-input');

const eventTypesList = document.getElementById('event-types-list');
const addEventBtn = document.getElementById('add-event-btn');
const newEventName = document.getElementById('new-event-name');
const newEventType = document.getElementById('new-event-type');
const newEventShortcut = document.getElementById('new-event-shortcut');

const annotationsBody = document.getElementById('annotations-body');
const exportBtn = document.getElementById('export-btn');
const importUpload = document.getElementById('import-upload');
const fpsInput = document.getElementById('fps-input');

function getFPS() {
    return parseFloat(fpsInput.value) || 30;
}

let state = {
    eventTypes: [],
    annotations: [],
    activeRanges: {} // typeName -> startFrame
};

// True once a video has successfully loaded. Drag-and-drop video loading is
// disabled from then on so in-progress annotation work cannot be clobbered by
// an accidental drop; swap videos intentionally via the Upload Video button or
// the Load URL bar instead.
let videoLoaded = false;

// The loaded video's filename (with extension). It is recorded verbatim in the
// export as the "video" field (provenance) and shown above the player; with the
// extension stripped it also names the exported JSON (annotations_<name>.json).
let videoFileName = '';

// --- Video Loading ---

function baseNameWithoutExtension(nameOrPath) {
    const base = nameOrPath.split('/').pop().split('\\').pop();
    const dotIndex = base.lastIndexOf('.');
    return dotIndex > 0 ? base.slice(0, dotIndex) : base;
}

function setVideoFilename(displayName) {
    document.getElementById('video-filename').textContent = displayName;
}

videoUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadVideoFile(file);
});

loadUrlBtn.addEventListener('click', () => {
    if (videoUrl.value) {
        video.src = videoUrl.value;
        let path = videoUrl.value.split('?')[0].split('#')[0];
        try { path = decodeURIComponent(path); } catch (err) { /* keep raw */ }
        const segment = path.split('/').pop().split('\\').pop() || videoUrl.value;
        videoFileName = segment;
        setVideoFilename(segment);
    }
});

// --- Drag and Drop ---

function loadVideoFile(file) {
    videoFileName = file.name;
    setVideoFilename(file.name);
    video.src = URL.createObjectURL(file);
}

// Whole-page drag-and-drop. A dropped file is routed by type: a video loads
// into the player, a .json file imports as annotations. We always preventDefault
// so a stray drop can never make the browser navigate away and discard the
// session. Video loading is gated on videoLoaded -- once a video is in place it
// can only be swapped via the Upload Video button or the Load URL bar, so
// in-progress work is never clobbered by an accidental drop. (Annotation JSON
// can still be imported at any time, which is how you resume saved work.)
function isJsonFile(file) {
    return file.type === 'application/json'
        || file.name.toLowerCase().endsWith('.json');
}

function draggingFiles(event) {
    return event.dataTransfer
        && Array.from(event.dataTransfer.types).includes('Files');
}

document.addEventListener('dragover', (e) => {
    if (!draggingFiles(e)) return;
    e.preventDefault();
    document.body.classList.add('drag-over');
});

document.addEventListener('dragleave', (e) => {
    // Only clear when the cursor leaves the window, not when it crosses between
    // child elements (those bubble a dragleave up to document as well).
    if (e.relatedTarget === null) document.body.classList.remove('drag-over');
});

document.addEventListener('drop', (e) => {
    if (!draggingFiles(e)) return;
    e.preventDefault();
    document.body.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (file.type.startsWith('video/')) {
        if (!videoLoaded) loadVideoFile(file);   // disabled once a video is loaded
    } else if (isJsonFile(file)) {
        // Importing replaces everything in memory, so confirm first if there is
        // unsaved annotation work that would be overwritten.
        if (state.annotations.length > 0 && !window.confirm(
                `Replace the ${state.annotations.length} annotation(s) currently `
                + `in memory with the contents of ${file.name}?`)) {
            return;
        }
        importJsonFile(file);
    }
});

video.addEventListener('loadedmetadata', () => {
    videoLoaded = true;
    seekSlider.max = video.duration;
    updateTimeDisplay();
});

// --- Controls ---

videoSizeSlider.addEventListener('input', (e) => {
    const scale = e.target.value;
    videoContainer.style.transform = `scale(${scale})`;
});

playPauseBtn.addEventListener('click', () => {
    if (video.paused) {
        video.play();
        playPauseBtn.innerText = 'Pause';
    } else {
        video.pause();
        playPauseBtn.innerText = 'Play';
    }
});

video.addEventListener('ended', () => {
    playPauseBtn.innerText = 'Play';
});

video.addEventListener('timeupdate', () => {
    updateTimeDisplay();
});

frameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const frame = parseInt(frameInput.value) || 0;
        video.currentTime = frame / getFPS();
        frameInput.blur();
        updateTimeDisplay();
    }
});

seekSlider.addEventListener('mousedown', () => seekSlider._dragging = true);
seekSlider.addEventListener('mouseup', () => seekSlider._dragging = false);
seekSlider.addEventListener('input', () => {
    video.currentTime = seekSlider.value;
    updateTimeDisplay();
});

function updateTimeDisplay() {
    if (!seekSlider._dragging) {
        seekSlider.value = video.currentTime;
    }
    const cur = formatTime(video.currentTime);
    const dur = formatTime(video.duration || 0);
    timeDisplay.innerText = `${cur} / ${dur}`;

    const frame = Math.floor(video.currentTime * getFPS());
    if (document.activeElement !== frameInput) {
        frameInput.value = frame;
    }
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// --- Toast Notifications ---

const toastContainer = document.getElementById('toast-container');

// Briefly show a small message dropping down from the top of the screen, then
// slide it back up and remove it. Used to flag attempts to double-annotate a
// frame, where no annotation is added.
function showToast(message, durationMs = 1000) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('toast-hiding');
        toast.addEventListener('animationend', () => toast.remove());
    }, durationMs);
}

// --- Annotation Logic ---

addEventBtn.addEventListener('click', () => {
    const name = newEventName.value.trim();
    if (!name) return;

    const type = newEventType.value;
    const shortcut = newEventShortcut.value.trim() || name[0].toLowerCase();

    if (state.eventTypes.find(t => t.name === name)) {
        alert('Event type already exists');
        return;
    }

    state.eventTypes.push({ name, type, shortcut });
    newEventName.value = '';
    newEventShortcut.value = '';
    renderEventTypes();
});

function renderEventTypes() {
    eventTypesList.innerHTML = '';
    state.eventTypes.forEach(t => {
        const div = document.createElement('div');
        div.className = 'event-type-item';
        div.innerHTML = `
            <span><strong>${t.name}</strong> (${t.type})</span>
            <span class="shortcut-tag">Key: ${t.shortcut}</span>
        `;
        eventTypesList.appendChild(div);
    });
}

window.addEventListener('keydown', (e) => {
    // Ignore typing in text/number inputs and selects, but NOT the seek slider:
    // we still want the frame-stepping and shortcut hotkeys to work when the
    // scrubber has focus, and our handlers' preventDefault() then suppresses the
    // range input's native (framerate-ignorant) arrow-key step.
    if (e.target !== seekSlider
        && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;

    const key = e.key.toLowerCase();
    const type = state.eventTypes.find(t => t.shortcut.toLowerCase() === key);

    if (type) {
        const currentFrame = Math.floor(video.currentTime * getFPS());

        if (type.type === 'point') {
            // Guard against double-annotating: pressing the same hotkey twice on
            // the same frame would otherwise create an identical duplicate point.
            const alreadyAnnotated = state.annotations.some(a =>
                a.typeName === type.name
                && a.startFrame === currentFrame
                && a.endFrame === currentFrame);
            if (alreadyAnnotated) {
                showToast(`Frame ${currentFrame} already annotated with "${type.name}"`);
            } else {
                state.annotations.push({
                    typeName: type.name,
                    startFrame: currentFrame,
                    endFrame: currentFrame
                });
            }
        } else {
            // Range logic
            if (state.activeRanges[type.name] !== undefined) {
                // End the range
                const start = state.activeRanges[type.name];
                state.annotations.push({
                    typeName: type.name,
                    startFrame: start,
                    endFrame: currentFrame
                });
                delete state.activeRanges[type.name];
            } else {
                // Start the range
                state.activeRanges[type.name] = currentFrame;
                console.log(`Started range for ${type.name} at ${currentFrame}`);
            }
        }
        renderAnnotations();
    }

    // Frame stepping: arrow keys and comma/period
    if (e.key === 'ArrowLeft' || e.key === ',') {
        e.preventDefault();
        video.currentTime = Math.max(0, video.currentTime - 1 / getFPS());
        updateTimeDisplay();
    }
    if (e.key === 'ArrowRight' || e.key === '.') {
        e.preventDefault();
        video.currentTime = Math.min(video.duration, video.currentTime + 1 / getFPS());
        updateTimeDisplay();
    }

    // Space to play/pause
    if (e.code === 'Space') {
        e.preventDefault();
        playPauseBtn.click();
    }
});

function renderAnnotations() {
    annotationsBody.innerHTML = '';
    // Sort by frame
    const sorted = [...state.annotations].sort((a, b) => a.startFrame - b.startFrame);

    sorted.forEach((ann, idx) => {
        const tr = document.createElement('tr');
        if (state.activeRanges[ann.typeName] !== undefined && ann.endFrame === ann.startFrame) {
            // This is an active range being shown as a point until finished
        }
        tr.innerHTML = `
            <td onclick="jumpToFrame(${ann.startFrame})" style="cursor:pointer; color:var(--accent)">${ann.typeName}</td>
            <td>${ann.startFrame}</td>
            <td>${ann.endFrame}</td>
            <td>
                <button class="btn-primary" style="padding: 2px 5px; font-size: 0.7rem;" onclick="jumpToFrame(${ann.startFrame})">Go</button>
                <button class="btn-delete" onclick="deleteAnnotation(${state.annotations.indexOf(ann)})">del</button>
            </td>
        `;
        annotationsBody.appendChild(tr);
    });

    // Also show active ranges somehow? 
    // Let's add an 'active' section or just rows in the table
    Object.keys(state.activeRanges).forEach(name => {
        const tr = document.createElement('tr');
        tr.style.opacity = '0.6';
        tr.style.borderLeft = '2px solid var(--accent)';
        tr.innerHTML = `
            <td>${name} (Recording...)</td>
            <td>${state.activeRanges[name]}</td>
            <td>-</td>
            <td><button class="btn-delete" onclick="cancelRange('${name}')">cancel</button></td>
        `;
        annotationsBody.prepend(tr);
    });
}

window.jumpToFrame = (frame) => {
    video.currentTime = frame / getFPS();
};

window.cancelRange = (name) => {
    delete state.activeRanges[name];
    renderAnnotations();
}

window.deleteAnnotation = (index) => {
    state.annotations.splice(index, 1);
    renderAnnotations();
};

// --- Export / Import ---

exportBtn.addEventListener('click', () => {
    if (state.annotations.length === 0) {
        exportBtn.textContent = 'No annotations to export';
        exportBtn.style.background = '#a05252';
        exportBtn.style.color = '#fff';
        setTimeout(() => {
            exportBtn.textContent = 'Export JSON';
            exportBtn.style.background = '';
            exportBtn.style.color = '';
        }, 1000);
        return;
    }
    const exportData = { ...state, fps: getFPS() };
    delete exportData.activeRanges;
    if (videoFileName) exportData.video = videoFileName;
    const data = JSON.stringify(exportData, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = videoFileName
        ? `annotations_${baseNameWithoutExtension(videoFileName)}.json`
        : 'annotations.json';
    a.click();
});

function importJsonFile(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const imported = JSON.parse(event.target.result);
            if (imported.eventTypes && imported.annotations) {
                if (imported.fps) fpsInput.value = imported.fps;
                state = imported;
                state.activeRanges = {};
                renderEventTypes();
                renderAnnotations();
            }
        } catch (err) {
            alert('Invalid JSON file');
        }
    };
    reader.readAsText(file);
}

importUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importJsonFile(file);
});

// Drag-and-drop annotation import is handled by the unified whole-page drop
// handler near the top of this file (routes .json files to importJsonFile).
