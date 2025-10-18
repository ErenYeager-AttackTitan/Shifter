/*!
 * ShifterJS v2.0
 * Full-featured adaptive streaming library for .shft / .shifter
 * Live & VOD, adaptive bitrate, audio, subtitles, thumbnails, caching
 */

class ShifterAutoPlayer {
    constructor() {
        this.initVideos();
    }

    initVideos() {
        const videos = document.querySelectorAll('video[data-shifter]');
        videos.forEach(video => {
            const manifestUrl = video.getAttribute('data-shifter');
            if (manifestUrl) {
                new ShifterInstance(video, manifestUrl);
            }
        });
    }
}

class ShifterInstance {
    constructor(video, manifestUrl) {
        this.video = video;
        this.manifestUrl = manifestUrl;
        this.manifest = null;
        this.levels = [];
        this.currentLevel = null;
        this.fragmentIndex = 0;
        this.live = false;
        this.buffer = 5; // seconds per fragment
        this.fragmentCache = new Set();
        this.thumbnails = [];
        this.subtitles = [];
        this.mediaSource = null;
        this.sourceBuffer = null;
        this.audioBuffer = null;
        this.thumbnailContainer = null;
        this.prefetchCount = 3; // number of fragments to prefetch in live mode
        this.loadManifest();
    }

    async loadManifest() {
        if (this.manifest) return; // Already loaded
        try {
            const res = await fetch(this.manifestUrl);
            this.manifest = await res.json();
            this.live = this.manifest.tag === "live";
            this.levels = this.manifest.adaptive;
            console.log("Shifter manifest loaded:", this.manifest);

            if (this.levels[0]?.thumbnailChunks) {
                this.thumbnails = this.levels[0].thumbnailChunks;
            }
            if (this.levels[0]?.subtitleChunks) {
                this.subtitles = this.levels[0].subtitleChunks;
            }

            this.setupThumbnailContainer();
            this.selectInitialLevel();
        } catch (e) {
            console.error("Failed to load manifest:", e);
        }
    }

    selectInitialLevel() {
        // Default: choose lowest bitrate as starting point
        this.currentLevel = this.levels.reduce((prev, level) => level.bitrate < prev.bitrate ? level : prev, this.levels[0]);
        this.setupMediaSource();
    }

    setupMediaSource() {
        if (!('MediaSource' in window)) {
            console.error("MediaSource not supported.");
            return;
        }
        this.mediaSource = new MediaSource();
        this.video.src = URL.createObjectURL(this.mediaSource);
        this.mediaSource.addEventListener('sourceopen', () => this.appendNextFragment());
        this.video.addEventListener('timeupdate', () => this.updateThumbnail());
    }

    async appendNextFragment() {
        if (this.fragmentIndex >= this.currentLevel.videoChunks.length) {
            if (this.live) {
                setTimeout(() => this.appendNextFragment(), 1000);
            }
            return;
        }

        // Check cache to avoid re-request
        const fragKey = `${this.currentLevel.resolution}_${this.fragmentIndex}`;
        if (this.fragmentCache.has(fragKey)) {
            this.fragmentIndex++;
            setTimeout(() => this.appendNextFragment(), this.buffer * 1000);
            return;
        }

        const vUrl = this.currentLevel.videoChunks[this.fragmentIndex];
        const aUrl = this.currentLevel.audioChunks[this.fragmentIndex];

        try {
            const [vResp, aResp] = await Promise.all([fetch(vUrl), fetch(aUrl)]);
            const vData = await vResp.arrayBuffer();
            const aData = await aResp.arrayBuffer();

            if (!this.sourceBuffer) this.sourceBuffer = this.mediaSource.addSourceBuffer('video/webm; codecs="vp9,opus"');
            if (!this.sourceBuffer.updating) this.sourceBuffer.appendBuffer(vData);

            if (!this.audioBuffer) this.audioBuffer = this.mediaSource.addSourceBuffer('audio/webm; codecs="opus"');
            if (!this.audioBuffer.updating) this.audioBuffer.appendBuffer(aData);

            this.fragmentCache.add(fragKey);
        } catch (e) {
            console.error("Error loading fragment:", e);
        }

        this.fragmentIndex++;
        setTimeout(() => this.appendNextFragment(), this.buffer * 1000);

        // Adaptive bitrate switch
        this.adaptiveSwitch();
        // Prefetch next fragments for live
        if (this.live) this.prefetchNextFragments();
    }

    adaptiveSwitch() {
        // Simplified: pick highest bitrate that is less than estimated network speed
        const speeds = this.levels.map(l => l.bitrate);
        const suitable = speeds.filter(b => b <= 5e6).pop();
        if (suitable && suitable !== this.currentLevel.bitrate) {
            const newLevel = this.levels.find(l => l.bitrate === suitable);
            if (newLevel) {
                console.log("Switching level to:", newLevel.resolution);
                this.currentLevel = newLevel;
                this.fragmentIndex = 0;
                this.appendNextFragment();
            }
        }
    }

    async prefetchNextFragments() {
        for (let i = this.fragmentIndex; i < this.fragmentIndex + this.prefetchCount; i++) {
            if (i >= this.currentLevel.videoChunks.length) break;
            const fragKey = `${this.currentLevel.resolution}_${i}`;
            if (this.fragmentCache.has(fragKey)) continue;
            const vUrl = this.currentLevel.videoChunks[i];
            const aUrl = this.currentLevel.audioChunks[i];
            try {
                const [vResp, aResp] = await Promise.all([fetch(vUrl), fetch(aUrl)]);
                const vData = await vResp.arrayBuffer();
                const aData = await aResp.arrayBuffer();
                if (!this.sourceBuffer.updating) this.sourceBuffer.appendBuffer(vData);
                if (!this.audioBuffer.updating) this.audioBuffer.appendBuffer(aData);
                this.fragmentCache.add(fragKey);
            } catch (e) {
                console.error("Prefetch failed for fragment", i, e);
            }
        }
    }

    setupThumbnailContainer() {
        let container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.bottom = '60px';
        container.style.left = '50%';
        container.style.transform = 'translateX(-50%)';
        container.style.width = '160px';
        container.style.height = '90px';
        container.style.pointerEvents = 'none';
        container.style.display = 'none';
        container.style.border = '1px solid #ccc';
        container.style.backgroundColor = '#000';
        container.style.zIndex = '1000';
        container.style.overflow = 'hidden';
        let img = document.createElement('img');
        img.style.width = '100%';
        img.style.height = '100%';
        container.appendChild(img);
        this.thumbnailContainer = container;
        this.thumbnailImage = img;
        this.video.parentElement.style.position = 'relative';
        this.video.parentElement.appendChild(container);
    }

    updateThumbnail() {
        if (!this.thumbnailContainer || this.thumbnails.length === 0) return;
        let idx = Math.floor(this.video.currentTime / this.buffer);
        if (idx >= this.thumbnails.length) idx = this.thumbnails.length - 1;
        this.thumbnailImage.src = this.thumbnails[idx];
        this.thumbnailContainer.style.display = 'block';
        clearTimeout(this.thumbTimeout);
        this.thumbTimeout = setTimeout(() => { this.thumbnailContainer.style.display = 'none'; }, 1000);
    }

    attachSubtitles(trackElement) {
        this.subtitles.forEach(url => {
            fetch(url).then(res => res.text()).then(txt => {
                const cue = new VTTCue(0, this.buffer, txt);
                trackElement.addCue(cue);
            });
        });
    }
}

// Auto-init
document.addEventListener('DOMContentLoaded', () => { window.ShifterAutoPlayer = new ShifterAutoPlayer(); });

/* Usage:
<video data-shifter="manifest.shifter" controls autoplay></video>
<script src="shifter.js"></script>
*/
  
