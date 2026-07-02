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
const frameTotal = document.getElementById('frame-total');
const rateInfo = document.getElementById('rate-info');
const indexStatus = document.getElementById('index-status');

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

const sortToggle = document.getElementById('sort-toggle');
const sortMenu = document.getElementById('sort-menu');

// --- Frame index: the heart of frame-accurate annotation ---
//
// HTML <video> has no concept of a frame; it only exposes currentTime (float
// seconds), and converting that to a frame number with an assumed fps is not
// reliable (floating-point boundaries, NTSC rates, variable frame rate). So we
// never trust currentTime->frame arithmetic. Instead, on load we demux the
// container with mp4box to read every frame's exact presentation timestamp,
// giving an authoritative table. The CANONICAL state is then the integer
// `currentFrame`; we navigate by COMMANDING the video to a frame and never by
// reading back which frame it landed on (Firefox in particular reports a bogus
// post-seek mediaTime). See videoIndex / seekToFrame / frameAtTime below.
//
// videoIndex: { pts:[seconds], dur:[seconds], nFrames, isVFR, fps, avgFps }
//   pts/dur are in the <video>.currentTime (movie) timeline.
let videoIndex = null;
let currentFrame = 0;
let playbackTrackingStarted = false;
let alignmentChecked = false;

function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clampFrame(frame) {
    if (!videoIndex) return 0;
    return Math.max(0, Math.min(frame, videoIndex.nFrames - 1));
}

// The seek target for a frame: the MIDPOINT of its display interval. Seeking to
// a frame boundary (pts[N]) lands on the previous frame in every browser tested;
// the midpoint has half an interval of margin in both directions and lands on
// frame N reliably. This is the variable-frame-rate generalization of the
// constant-rate (N + 0.5) / fps.
function midpointTime(frame) {
    const pts = videoIndex.pts;
    const start = pts[frame];
    const end = (frame + 1 < pts.length)
        ? pts[frame + 1]
        : start + (videoIndex.dur[frame] || (start - (pts[frame - 1] ?? start)) || 0.04);
    return (start + end) / 2;
}

// Frame displayed at movie-timeline time t: the last frame whose pts <= t.
function frameAtTime(t) {
    const pts = videoIndex.pts;
    let low = 0, high = pts.length - 1, answer = 0;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (pts[mid] <= t) { answer = mid; low = mid + 1; } else { high = mid - 1; }
    }
    return answer;
}

function seekToFrame(frame) {
    if (!videoIndex) return;
    currentFrame = clampFrame(frame);
    let target = midpointTime(currentFrame);
    const duration = video.duration || target;
    target = Math.min(Math.max(target, 0), Math.max(0, duration - 1e-6));
    video.currentTime = target;
    updateFrameUI();
}

function stepFrame(delta) {
    seekToFrame(currentFrame + delta);
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
    if (!videoUrl.value) return;
    video.src = videoUrl.value;
    let path = videoUrl.value.split('?')[0].split('#')[0];
    try { path = decodeURIComponent(path); } catch (err) { /* keep raw */ }
    const segment = path.split('/').pop().split('\\').pop() || videoUrl.value;
    videoFileName = segment;
    setVideoFilename(segment);
    // Frame indexing needs the raw bytes; fetch them (subject to CORS).
    indexVideoFromUrl(videoUrl.value);
});

// --- Drag and Drop ---

function loadVideoFile(file) {
    videoFileName = file.name;
    setVideoFilename(file.name);
    video.src = URL.createObjectURL(file);
    indexVideoFromFile(file);
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

// --- Frame index construction (mp4box demux) ---

// A byte-source reader: { size, read(start, end) -> Promise<ArrayBuffer> }.
// Lets the demuxer pull only the ranges it needs instead of the whole file.
function fileReader(file) {
    return { size: file.size, read: (start, end) => file.slice(start, end).arrayBuffer() };
}

async function urlReader(url) {
    const head = await fetch(url, { method: 'HEAD' });
    const size = Number(head.headers.get('Content-Length'));
    if (!size || head.headers.get('Accept-Ranges') !== 'bytes') {
        throw new Error('range requests unsupported');
    }
    return {
        size,
        read: async (start, end) => {
            const response = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } });
            return response.arrayBuffer();
        },
    };
}

// Build the per-frame presentation-time table in the <video>.currentTime (movie)
// timeline. We only ever need the container's moov (the index), never the mdat
// (the frame bytes), so this NEVER loads the whole file: it feeds mp4box chunks
// on demand, lets it skip the mdat (appendBuffer returns the next byte offset it
// wants), and reads per-frame timing from the parsed sample table rather than
// extracting any sample data. Memory stays ~ the size of the index no matter how
// large the video is.
async function demuxFrameIndex(reader) {
    if (typeof MP4Box === 'undefined') throw new Error('mp4box library not loaded');
    const mp4 = MP4Box.createFile();
    let ready = false, track = null, movieTimescale = 1, errorMessage = null;
    mp4.onError = (err) => { errorMessage = err; };
    mp4.onReady = (info) => {
        ready = true;
        movieTimescale = info.timescale;
        track = info.videoTracks && info.videoTracks[0];
    };

    // Feed chunks until the moov is parsed (onReady fires synchronously inside
    // appendBuffer). The returned offset jumps past the mdat for moov-at-end
    // files, so we read only ftyp + box headers + moov.
    const CHUNK = 1 << 20; // 1 MiB
    let position = 0;
    while (!ready) {
        if (errorMessage) throw new Error('mp4box: ' + errorMessage);
        if (position >= reader.size) break;
        const end = Math.min(position + CHUNK, reader.size);
        const buffer = await reader.read(position, end);
        buffer.fileStart = position;
        const next = mp4.appendBuffer(buffer);
        if (ready) break;
        position = (typeof next === 'number' && next > position) ? next : end;
    }
    if (errorMessage) throw new Error('mp4box: ' + errorMessage);
    if (!ready || !track) {
        throw new Error('No video track / moov not found (not a supported MP4/MOV?)');
    }

    // Per-frame timing straight from the parsed sample table (no media data).
    // mp4box yields samples in DECODE order; with B-frames the composition times
    // are non-monotonic there, so sort by composition time for presentation order.
    const samples = mp4.getTrackSamplesInfo(track.id);
    const mediaTimescale = track.timescale;
    const ordered = samples.slice().sort((a, b) => a.cts - b.cts);

    // Edit list -> movie timeline. A trim edit (media_time >= 0) shifts the media
    // start to movie time 0; a leading empty edit (media_time === -1) inserts a
    // delay. Identity edits leave it alone.
    let trimOffset = 0, emptyDelay = 0;
    const edits = track.edits;
    if (edits && edits.length) {
        for (const edit of edits) {
            if (edit.media_time === -1) emptyDelay += edit.segment_duration / movieTimescale;
            else { trimOffset = edit.media_time / mediaTimescale; break; }
        }
    }
    const pts = ordered.map(s => s.cts / mediaTimescale - trimOffset + emptyDelay);
    const dur = ordered.map(s => s.duration / mediaTimescale);
    mp4.flush();
    return { pts, dur, nFrames: pts.length };
}

function applyFrameIndex(index) {
    const deltas = [];
    for (let i = 1; i < index.pts.length; i++) deltas.push(index.pts[i] - index.pts[i - 1]);
    const medianDelta = median(deltas);
    // Constant-rate files can still have a stray off-length frame (encoder
    // timebase rounding, a different final frame), so flag VFR only when a
    // meaningful FRACTION of intervals deviate, not just a single outlier.
    let deviating = 0;
    if (medianDelta > 0) {
        for (const d of deltas) if (Math.abs(d - medianDelta) / medianDelta > 0.05) deviating++;
    }
    index.isVFR = deltas.length > 0 && (deviating / deltas.length) > 0.01;
    index.avgFps = index.pts.length > 1
        ? (index.pts.length - 1) / (index.pts[index.pts.length - 1] - index.pts[0])
        : 0;
    index.fps = index.isVFR ? null : (medianDelta > 0 ? 1 / medianDelta : 0);

    videoIndex = index;
    alignmentChecked = false;
    seekSlider.max = index.nFrames - 1;
    frameInput.max = index.nFrames - 1;
    frameTotal.textContent = `/ ${index.nFrames - 1}`;
    rateInfo.textContent = index.isVFR
        ? `VFR (~${index.avgFps.toFixed(2)} fps)`
        : `${index.fps.toFixed(2)} fps`;
    indexStatus.textContent = `${index.nFrames} frames`;
    indexStatus.style.color = '';

    currentFrame = 0;
    // Show the first frame once the video can seek.
    if (video.readyState >= 1) seekToFrame(0);
    else video.addEventListener('loadedmetadata', () => seekToFrame(0), { once: true });
}

function reportIndexFailure(error) {
    videoIndex = null;
    indexStatus.textContent = 'Indexing failed: ' + error.message;
    indexStatus.style.color = 'var(--danger, #a05252)';
    console.error('Frame indexing failed:', error);
    showToast('Could not index this video for frame-accurate annotation: '
        + error.message, 4000);
}

async function indexVideoFromFile(file) {
    videoIndex = null;
    indexStatus.textContent = 'Indexing…';
    indexStatus.style.color = '';
    try {
        applyFrameIndex(await demuxFrameIndex(fileReader(file)));
    } catch (error) {
        reportIndexFailure(error);
    }
}

async function indexVideoFromUrl(url) {
    videoIndex = null;
    indexStatus.textContent = 'Indexing…';
    indexStatus.style.color = '';
    try {
        let reader;
        try {
            // Prefer range requests so a remote video is also streamed, not
            // pulled in full.
            reader = await urlReader(url);
        } catch (rangeError) {
            // Server lacks range support: fall back to one fetch, wrapped as a
            // reader over the in-memory bytes.
            const buffer = await (await fetch(url)).arrayBuffer();
            reader = { size: buffer.byteLength, read: (s, e) => Promise.resolve(buffer.slice(s, e)) };
        }
        applyFrameIndex(await demuxFrameIndex(reader));
    } catch (error) {
        reportIndexFailure(new Error(error.message
            + ' (URL must be CORS-accessible; otherwise load the file directly)'));
    }
}

video.addEventListener('loadedmetadata', () => {
    videoLoaded = true;
    startPlaybackTracking();
    updateFrameUI();
});

// During playback the displayed frame is read from requestVideoFrameCallback's
// mediaTime, which is reliable WHILE PLAYING (its post-seek value is not, which
// is why stepping/seeking rely on the commanded integer instead). The loop runs
// continuously and only writes currentFrame while playing, so a paused/stepped
// frame keeps the value we commanded.
function startPlaybackTracking() {
    if (playbackTrackingStarted) return;
    if (typeof video.requestVideoFrameCallback !== 'function') return;
    playbackTrackingStarted = true;
    const onFrame = (now, metadata) => {
        if (videoIndex) {
            const frame = frameAtTime(metadata.mediaTime);
            // One-time sanity check that the demuxed table matches the playback
            // clock (catches an exotic edit list we failed to account for).
            if (!alignmentChecked) {
                alignmentChecked = true;
                const residual = Math.abs(videoIndex.pts[frame] - metadata.mediaTime);
                if (residual > 0.010) {
                    console.warn('Frame index alignment residual', residual, 's');
                    showToast('Warning: frame index may be misaligned for this '
                        + 'video — verify before relying on indices', 4000);
                }
            }
            if (!video.paused) {
                currentFrame = frame;
                updateFrameUI();
            }
        }
        video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
}

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
    updateFrameUI();
});

frameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        seekToFrame(parseInt(frameInput.value) || 0);
        frameInput.blur();
    }
});

// The seek slider is in FRAME units (min 0, max nFrames-1, step 1), so dragging
// lands on exact frames rather than the old coarse one-second resolution.
seekSlider.addEventListener('mousedown', () => seekSlider._dragging = true);
seekSlider.addEventListener('mouseup', () => seekSlider._dragging = false);
seekSlider.addEventListener('input', () => {
    seekToFrame(parseInt(seekSlider.value) || 0);
});

function updateFrameUI() {
    const duration = video.duration || 0;
    timeDisplay.innerText = `${formatTime(video.currentTime || 0)} / ${formatTime(duration)}`;
    if (videoIndex) {
        if (!seekSlider._dragging) seekSlider.value = currentFrame;
        if (document.activeElement !== frameInput) frameInput.value = currentFrame;
    }
    updateFrameAnnotations();
}

// Overlay above the top-right of the video listing, as a " | "-separated list,
// the distinct event types whose committed annotations span the current frame
// (point annotations on exactly this frame, range annotations enclosing it).
// In-progress ranges are excluded since they are not committed yet. Driven by
// both frame changes (updateFrameUI) and annotation edits (renderAnnotations).
function updateFrameAnnotations() {
    const frame = currentFrame;
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
        const frame = currentFrame;

        if (addType.type === 'point') {
            // Guard against double-annotating: pressing the same hotkey twice on
            // the same frame would otherwise create an identical duplicate point.
            const alreadyAnnotated = state.annotations.some(a =>
                a.typeName === addType.name
                && a.startFrame === frame
                && a.endFrame === frame);
            if (alreadyAnnotated) {
                showToast(`Frame ${frame} already annotated with "${addType.name}"`);
            } else {
                state.annotations.push({
                    typeName: addType.name,
                    startFrame: frame,
                    endFrame: frame
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
                    startFrame: Math.min(marked, frame),
                    endFrame: Math.max(marked, frame)
                });
                delete state.activeRanges[addType.name];
            } else {
                // Start the range
                state.activeRanges[addType.name] = frame;
                console.log(`Started range for ${addType.name} at ${frame}`);
            }
        }
        renderAnnotations();
    } else if (removeType) {
        const frame = currentFrame;

        if (removeType.type === 'range') {
            if (state.activeRanges[removeType.name] !== undefined) {
                // A range is mid-recording: the remove key cancels it.
                delete state.activeRanges[removeType.name];
            } else {
                // Find completed ranges of this type that span the current frame.
                const matches = state.annotations.filter(a =>
                    a.typeName === removeType.name
                    && a.startFrame <= frame
                    && a.endFrame >= frame);
                if (matches.length === 0) {
                    showToast(`No "${removeType.name}" annotation at frame ${frame} to remove`);
                } else if (matches.length === 1) {
                    state.annotations.splice(state.annotations.indexOf(matches[0]), 1);
                } else {
                    showToast(`${matches.length} different "${removeType.name}" ranges span `
                        + `frame ${frame}, so nothing was deleted -- use the del `
                        + `button to remove a specific one`, 3000);
                }
            }
        } else {
            // Point: an exact frame match (at most one per type per frame).
            const index = state.annotations.findIndex(a =>
                a.typeName === removeType.name
                && a.startFrame === frame
                && a.endFrame === frame);
            if (index === -1) {
                showToast(`No "${removeType.name}" annotation at frame ${frame} to remove`);
            } else {
                state.annotations.splice(index, 1);
            }
        }
        renderAnnotations();
    }

    // Frame stepping: arrow keys and comma/period
    if (e.key === 'ArrowLeft' || e.key === ',') {
        e.preventDefault();
        stepFrame(-1);
    }
    if (e.key === 'ArrowRight' || e.key === '.') {
        e.preventDefault();
        stepFrame(1);
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

    sorted.forEach((ann) => {
        const tr = document.createElement('tr');
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

    // Show any in-progress ranges (recording, not yet committed) at the top.
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
    seekToFrame(frame);
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
    // Frame indices are the canonical record. We also write each annotation's
    // exact presentation time in seconds (derived from the frame index table)
    // as provenance, plus the detected frame-rate metadata.
    const exportData = {
        video: videoFileName || undefined,
        frameRate: videoIndex ? (videoIndex.isVFR ? 'variable' : videoIndex.fps) : undefined,
        isVariableFrameRate: videoIndex ? videoIndex.isVFR : undefined,
        nFrames: videoIndex ? videoIndex.nFrames : undefined,
        eventTypes: state.eventTypes,
        annotations: state.annotations.map(a => ({
            typeName: a.typeName,
            startFrame: a.startFrame,
            endFrame: a.endFrame,
            startTime: videoIndex ? videoIndex.pts[a.startFrame] : undefined,
            endTime: videoIndex ? videoIndex.pts[a.endFrame] : undefined,
        })),
    };
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
                state = {
                    eventTypes: imported.eventTypes,
                    annotations: imported.annotations.map(a => ({
                        typeName: a.typeName,
                        startFrame: a.startFrame,
                        endFrame: a.endFrame,
                    })),
                    activeRanges: {},
                };
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
