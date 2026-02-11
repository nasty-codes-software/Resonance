/**
 * Soundboard Manager
 * Handles sound playback, uploads, and mixing with WebRTC
 */
class SoundboardManager {
    constructor(wsManager, webrtcManager) {
        this.wsManager = wsManager;
        this.webrtcManager = webrtcManager;
        this.sounds = new Map();
        this.audioContext = null;
        this.localGain = null;
        
        this.setupWebSocketHandlers();
    }

    setupWebSocketHandlers() {
        this.wsManager.on('play_sound', (data) => this.handlePlaySound(data));
    }

    async initAudio() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.localGain = this.audioContext.createGain();
            this.localGain.connect(this.audioContext.destination);
        }
        
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    /**
     * Play a sound locally and broadcast to voice channel
     */
    async playSoundById(soundId) {
        console.log('Playing sound:', soundId);
        const soundUrl = `/api/sounds/${soundId}/play`;
        
        // Play locally
        await this.playLocally(soundUrl);
        
        // Broadcast to voice channel if connected
        if (this.webrtcManager && this.webrtcManager.currentVoiceChannel) {
            // Play through WebRTC to other users
            await this.webrtcManager.playSound(soundUrl);
            
            // Also notify via WebSocket for UI updates
            this.wsManager.playSound(
                this.webrtcManager.currentVoiceChannel, 
                soundId
            );
        }
    }

    /**
     * Play sound locally only (for preview or when receiving from others)
     */
    async playLocally(soundUrl) {
        console.log('Playing locally:', soundUrl);
        await this.initAudio();
        
        try {
            const response = await fetch(soundUrl);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            console.log('Audio buffer size:', arrayBuffer.byteLength);
            
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            console.log('Audio decoded, duration:', audioBuffer.duration);
            
            const source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.localGain);
            source.start(0);
            console.log('Audio playback started');
            
            return source;
        } catch (error) {
            console.error('Error playing sound locally:', error);
            throw error;
        }
    }

    /**
     * Handle incoming sound play from other users
     */
    async handlePlaySound(data) {
        console.log(`Sound ${data.sound_id} triggered by ${data.triggered_by}`);
        
        // Sound is already coming through WebRTC audio stream
        // This handler is just for UI feedback
        this.showSoundNotification(data.sound_id, data.triggered_by);
    }

    showSoundNotification(soundId, username) {
        const btn = document.querySelector(`[data-sound-id="${soundId}"]`);
        if (btn) {
            btn.classList.add('playing');
            setTimeout(() => btn.classList.remove('playing'), 500);
        }
    }

    /**
     * Upload a new sound
     */
    async uploadSound(file, name) {
        const formData = new FormData();
        formData.append('sound', file);
        if (name) {
            formData.append('name', name);
        }

        const response = await fetch('/api/sounds', {
            method: 'POST',
            headers: {
                'X-CSRF-Token': window.APP_CONFIG.csrfToken
            },
            body: formData
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Upload failed');
        }

        return response.json();
    }

    /**
     * Delete a sound
     */
    async deleteSound(soundId) {
        const response = await fetch(`/api/sounds/${soundId}`, {
            method: 'DELETE',
            headers: {
                'X-CSRF-Token': window.APP_CONFIG.csrfToken
            }
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Delete failed');
        }

        return response.json();
    }

    /**
     * Load all sounds
     */
    async loadSounds() {
        const response = await fetch('/api/sounds');
        const data = await response.json();
        
        this.sounds.clear();
        for (const sound of data.sounds) {
            this.sounds.set(sound.id, sound);
        }
        
        return data.sounds;
    }

    setVolume(volume) {
        if (this.localGain) {
            this.localGain.gain.value = Math.max(0, Math.min(1, volume));
        }
    }
}

// Export for use in other modules
window.SoundboardManager = SoundboardManager;
