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
const newEventRemoveShortcut = document.getElementById('new-event-remove-shortcut');

const frameAnnotations = document.getElementById('frame-annotations');
const annotationsBody = document.getElementById('annotations-body');
const exportBtn = document.getElementById('export-btn');
const importUpload = document.getElementById('import-upload');
const fpsInput = document.getElementById('fps-input');

const sortToggle = document.getElementById('sort-toggle');
const sortMenu = document.getElementById('sort-menu');

function getFPS() {
    return parseFloat(fpsInput.value) || 30;
}

// --- Annotation sorting ---

// Each sort option is a comparator over two annotations. The arrow follows the
// GNOME/file-manager convention where up means the largest value sits at the
// top: "up" puts the highest start frame (or alphabetically last type name)
// first, "down" puts the lowest start frame (or A-first type name) first.
const sortComparators = {
    event_up: (a, b) => b.typeName.localeCompare(a.typeName),
    event_down: (a, b) => a.typeName.localeCompare(b.typeName),
    start_up: (a, b) => b.startFrame - a.startFrame,
    start_down: (a, b) => a.startFrame - b.startFrame,
};

const sortLabels = {
    event_up: 'Event ↑',
    event_down: 'Event ↓',
    start_up: 'Start ↑',
    start_down: 'Start ↓',
};

// The options ordered most-recently-selected first. The front element is the
// current primary sort; the rest act as successive tiebreakers, so selecting a
// new option both makes it primary and demotes the previous primary to the top
// tiebreaker. Defaults to "Start up" primary, matching the dropdown's initial label.
let sortRecency = ['start_up', 'event_down', 'start_down', 'event_up'];

function compareAnnotations(a, b) {
    for (const key of sortRecency) {
        const result = sortComparators[key](a, b);
        if (result !== 0) return result;
    }
    return 0;
}

function selectSort(key) {
    sortRecency = [key, ...sortRecency.filter(k => k !== key)];
    sortToggle.textContent = sortLabels[key];
    Array.from(sortMenu.children).forEach(li =>
        li.classList.toggle('selected', li.dataset.key === key));
    renderAnnotations();
}

// Toggle the menu open/closed. stopPropagation keeps the document-level
// click-to-close handler below from immediately closing what we just opened.
sortToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    sortMenu.hidden = !sortMenu.hidden;
});

sortMenu.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-key]');
    if (!li) return;
    selectSort(li.dataset.key);
    sortMenu.hidden = true;
});

// Any click elsewhere, or Escape, closes the menu.
document.addEventListener('click', () => { sortMenu.hidden = true; });
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') sortMenu.hidden = true;
});

// Reflect the default selection in the menu highlight on load.
Array.from(sortMenu.children).forEach(li =>
    li.classList.toggle('selected', li.dataset.key === sortRecency[0]));

// Pin the toggle's width to its widest possible label so it does not resize as
// the selection changes. We measure each label in the toggle element itself
// (synchronously, before paint, so there is no flicker) to capture its exact
// font, padding, and border, then lock that as the min-width. Re-run once the
// web font has loaded since fallback-font metrics differ.
function fitSortToggleWidth() {
    const current = sortToggle.textContent;
    let widest = 0;
    Object.values(sortLabels).forEach(label => {
        sortToggle.textContent = label;
        widest = Math.max(widest, sortToggle.offsetWidth);
    });
    sortToggle.textContent = current;
    sortToggle.style.minWidth = widest + 'px';
}

fitSortToggleWidth();
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitSortToggleWidth);
}

let state = {
    eventTypes: [],
    annotations: [],
    activeRanges: {} // typeName -> startFrame
};

// True once a video has successfully loaded. From then on, replacing the video
// via drag-and-drop asks for confirmation first so in-progress annotation work
// cannot be clobbered by an accidental drop; the Upload Video button and the
// Load URL bar swap videos without prompting.
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
// session. Once a video is in place, dropping a new one prompts for
// confirmation before swapping so in-progress work is never clobbered by an
// accidental drop. (Annotation JSON can still be imported at any time, which is
// how you resume saved work.)
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
        // Once a video is loaded, replacing it via an accidental drop would
        // discard the session, so confirm before swapping.
        if (videoLoaded && !window.confirm(
                `Replace the current video (${videoFileName}) with ${file.name}? `
                + `Your existing annotations will be kept.`)) {
            return;
        }
        loadVideoFile(file);
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
    updateFrameAnnotations();
}

// Overlay above the top-right of the video listing, as a " | "-separated list,
// the distinct event types whose committed annotations span the current frame
// (point annotations on exactly this frame, range annotations enclosing it).
// In-progress ranges are excluded since they are not committed yet. Driven by
// both frame changes (updateTimeDisplay) and annotation edits (renderAnnotations).
function updateFrameAnnotations() {
    const frame = Math.floor(video.currentTime * getFPS());
    const names = [];
    state.annotations.forEach(a => {
        if (a.startFrame <= frame && a.endFrame >= frame
            && !names.includes(a.typeName)) {
            names.push(a.typeName);
        }
    });
    frameAnnotations.textContent = names.join(' | ');
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
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

// Typing in the "add" key box mirrors the capitalized key into the "remove" key
// box, clobbering whatever is there. Typing directly in the "remove" box is left
// untouched, so it can be overridden with any key the user prefers.
newEventShortcut.addEventListener('input', () => {
    newEventRemoveShortcut.value = newEventShortcut.value.toUpperCase();
});

addEventBtn.addEventListener('click', () => {
    const name = newEventName.value.trim();
    if (!name) return;

    const type = newEventType.value;
    const shortcut = newEventShortcut.value.trim() || name[0].toLowerCase();
    const removeShortcut = newEventRemoveShortcut.value.trim() || shortcut.toUpperCase();

    if (state.eventTypes.find(t => t.name === name)) {
        alert('Event type already exists');
        return;
    }

    state.eventTypes.push({ name, type, shortcut, removeShortcut });
    newEventName.value = '';
    newEventShortcut.value = '';
    newEventRemoveShortcut.value = '';
    renderEventTypes();
});

function renderEventTypes() {
    eventTypesList.innerHTML = '';
    state.eventTypes.forEach(t => {
        const div = document.createElement('div');
        div.className = 'event-type-item';
        const removeShortcut = t.removeShortcut || t.shortcut.toUpperCase();
        const typeSuffix = t.type === 'range' ? ' (range)' : '';
        div.innerHTML = `
            <span><strong>${t.name}</strong>${typeSuffix} (${t.shortcut}/${removeShortcut})</span>
            <button class="btn-delete" onclick="removeEventType('${t.name}')">del</button>
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

    // Matching is case-sensitive so the add key (e.g. "f") and the remove key
    // (e.g. "F", i.e. Shift+f) can be told apart. We check add first, then remove.
    const addType = state.eventTypes.find(t => t.shortcut === e.key);
    const removeType = state.eventTypes.find(t =>
        (t.removeShortcut || t.shortcut.toUpperCase()) === e.key);

    if (addType) {
        const currentFrame = Math.floor(video.currentTime * getFPS());

        if (addType.type === 'point') {
            // Guard against double-annotating: pressing the same hotkey twice on
            // the same frame would otherwise create an identical duplicate point.
            const alreadyAnnotated = state.annotations.some(a =>
                a.typeName === addType.name
                && a.startFrame === currentFrame
                && a.endFrame === currentFrame);
            if (alreadyAnnotated) {
                showToast(`Frame ${currentFrame} already annotated with "${addType.name}"`);
            } else {
                state.annotations.push({
                    typeName: addType.name,
                    startFrame: currentFrame,
                    endFrame: currentFrame
                });
            }
        } else {
            // Range logic
            if (state.activeRanges[addType.name] !== undefined) {
                // End the range. Store the smaller frame as the start and the
                // larger as the end, regardless of which the user marked first.
                const marked = state.activeRanges[addType.name];
                state.annotations.push({
                    typeName: addType.name,
                    startFrame: Math.min(marked, currentFrame),
                    endFrame: Math.max(marked, currentFrame)
                });
                delete state.activeRanges[addType.name];
            } else {
                // Start the range
                state.activeRanges[addType.name] = currentFrame;
                console.log(`Started range for ${addType.name} at ${currentFrame}`);
            }
        }
        renderAnnotations();
    } else if (removeType) {
        const currentFrame = Math.floor(video.currentTime * getFPS());

        if (removeType.type === 'range') {
            if (state.activeRanges[removeType.name] !== undefined) {
                // A range is mid-recording: the remove key cancels it.
                delete state.activeRanges[removeType.name];
            } else {
                // Find completed ranges of this type that span the current frame.
                const matches = state.annotations.filter(a =>
                    a.typeName === removeType.name
                    && a.startFrame <= currentFrame
                    && a.endFrame >= currentFrame);
                if (matches.length === 0) {
                    showToast(`No "${removeType.name}" annotation at frame ${currentFrame} to remove`);
                } else if (matches.length === 1) {
                    state.annotations.splice(state.annotations.indexOf(matches[0]), 1);
                } else {
                    showToast(`${matches.length} different "${removeType.name}" ranges span `
                        + `frame ${currentFrame}, so nothing was deleted -- use the del `
                        + `button to remove a specific one`, 3000);
                }
            }
        } else {
            // Point: an exact frame match (at most one per type per frame).
            const index = state.annotations.findIndex(a =>
                a.typeName === removeType.name
                && a.startFrame === currentFrame
                && a.endFrame === currentFrame);
            if (index === -1) {
                showToast(`No "${removeType.name}" annotation at frame ${currentFrame} to remove`);
            } else {
                state.annotations.splice(index, 1);
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
    // Sort by the user's chosen "Sort by" option, with previously-selected
    // options applied as successive tiebreakers (see compareAnnotations).
    const sorted = [...state.annotations].sort(compareAnnotations);

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

    updateFrameAnnotations();
}

window.jumpToFrame = (frame) => {
    video.currentTime = frame / getFPS();
};

window.cancelRange = (name) => {
    delete state.activeRanges[name];
    renderAnnotations();
}

// Remove an event type from the menu. Existing annotations of this type are
// intentionally left in place; only an in-progress range recording (which could
// no longer be ended once its hotkey is gone) is cancelled.
window.removeEventType = (name) => {
    state.eventTypes = state.eventTypes.filter(t => t.name !== name);
    delete state.activeRanges[name];
    renderEventTypes();
    renderAnnotations();
};

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
