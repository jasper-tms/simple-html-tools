const video = document.getElementById('main-video');
const videoUpload = document.getElementById('video-upload');
const videoUrl = document.getElementById('video-url');
const loadUrlBtn = document.getElementById('load-url-btn');
const videoSizeSlider = document.getElementById('video-size');
const videoContainer = document.getElementById('video-container');

const playPauseBtn = document.getElementById('play-pause-btn');
const seekSlider = document.getElementById('seek-slider');
const timeDisplay = document.getElementById('time-display');
const frameDisplay = document.getElementById('frame-display');

const eventTypesList = document.getElementById('event-types-list');
const addEventBtn = document.getElementById('add-event-btn');
const newEventName = document.getElementById('new-event-name');
const newEventType = document.getElementById('new-event-type');
const newEventShortcut = document.getElementById('new-event-shortcut');

const annotationsBody = document.getElementById('annotations-body');
const exportBtn = document.getElementById('export-btn');
const importUpload = document.getElementById('import-upload');

const FPS = 30; // Default frame rate

let state = {
    eventTypes: [],
    annotations: [],
    activeRanges: {} // typeName -> startFrame
};

// --- Video Loading ---

videoUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadVideoFile(file);
});

loadUrlBtn.addEventListener('click', () => {
    if (videoUrl.value) {
        video.src = videoUrl.value;
    }
});

// --- Drag and Drop ---

function loadVideoFile(file) {
    video.src = URL.createObjectURL(file);
}

videoContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    videoContainer.classList.add('drag-over');
});

videoContainer.addEventListener('dragleave', () => {
    videoContainer.classList.remove('drag-over');
});

videoContainer.addEventListener('drop', (e) => {
    e.preventDefault();
    videoContainer.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) {
        loadVideoFile(file);
    }
});

video.addEventListener('loadedmetadata', () => {
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

video.addEventListener('timeupdate', () => {
    if (!seekSlider._dragging) {
        seekSlider.value = video.currentTime;
    }
    updateTimeDisplay();
});

seekSlider.addEventListener('mousedown', () => seekSlider._dragging = true);
seekSlider.addEventListener('mouseup', () => seekSlider._dragging = false);
seekSlider.addEventListener('input', () => {
    video.currentTime = seekSlider.value;
    updateTimeDisplay();
});

function updateTimeDisplay() {
    const cur = formatTime(video.currentTime);
    const dur = formatTime(video.duration || 0);
    timeDisplay.innerText = `${cur} / ${dur}`;

    const frame = Math.floor(video.currentTime * FPS);
    frameDisplay.innerText = `Frame: ${frame}`;
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
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
    // Ignore if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    const key = e.key.toLowerCase();
    const type = state.eventTypes.find(t => t.shortcut.toLowerCase() === key);

    if (type) {
        const currentFrame = Math.floor(video.currentTime * FPS);

        if (type.type === 'point') {
            state.annotations.push({
                typeName: type.name,
                startFrame: currentFrame,
                endFrame: currentFrame,
                shortcut: type.shortcut
            });
        } else {
            // Range logic
            if (state.activeRanges[type.name] !== undefined) {
                // End the range
                const start = state.activeRanges[type.name];
                state.annotations.push({
                    typeName: type.name,
                    startFrame: start,
                    endFrame: currentFrame,
                    shortcut: type.shortcut
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
        video.currentTime = Math.max(0, video.currentTime - 1 / FPS);
        updateTimeDisplay();
    }
    if (e.key === 'ArrowRight' || e.key === '.') {
        e.preventDefault();
        video.currentTime = Math.min(video.duration, video.currentTime + 1 / FPS);
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
            <td>${ann.shortcut}</td>
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
            <td>-</td>
            <td><button class="btn-delete" onclick="cancelRange('${name}')">cancel</button></td>
        `;
        annotationsBody.prepend(tr);
    });
}

window.jumpToFrame = (frame) => {
    video.currentTime = frame / FPS;
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
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'annotations.json';
    a.click();
});

importUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const imported = JSON.parse(event.target.result);
            if (imported.eventTypes && imported.annotations) {
                state = imported;
                state.activeRanges = {}; // Reset active ranges on import
                renderEventTypes();
                renderAnnotations();
            }
        } catch (err) {
            alert('Invalid JSON file');
        }
    };
    reader.readAsText(file);
});
