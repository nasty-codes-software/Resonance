/**
 * WebRTC Voice Communication Manager
 * Handles peer connections, audio streams, and voice channel management
 */
class WebRTCManager {
    constructor(wsManager) {
        this.wsManager = wsManager;
        this.localStream = null;
        this.localVideoStream = null;
        this.peers = {}; // userId -> RTCPeerConnection
        this.audioContext = null;
        this.gainNode = null;
        this.destination = null;
        this.currentVoiceChannel = null;
        this.isMuted = false;
        this.isDeafened = false;
        this.isCameraOn = false;
        this.isScreenSharing = false;
        this.screenShareHasAudio = false;
        this.screenStream = null;
        this.onCameraChange = null; // Callback for camera state changes
        this.onRemoteVideoChange = null; // Callback for remote video state changes
        this.onScreenShareChange = null; // Callback for screen share state changes
        this.onRemoteScreenShareChange = null; // Callback for remote screen share changes
        this.screenShareUsers = new Set(); // Track which users are screen sharing
        
        // Voice Activity Detection
        this.analyser = null;
        this.vadInterval = null;
        this.isSpeaking = false;
        this.speakingThreshold = 25; // Adjust sensitivity (lowered for better detection)
        this.silenceThreshold = 15; // Lower threshold to stop speaking (hysteresis)
        this.speakingFrames = 0; // Counter for consecutive speaking frames
        this.silenceFrames = 0; // Counter for consecutive silence frames
        this.minSpeakingFrames = 2; // Min frames to start speaking
        this.minSilenceFrames = 10; // Min frames to stop speaking (prevents rapid toggling)
        this.onSpeakingChange = null; // Callback for UI updates
        
        // ICE servers configuration
        this.iceServers = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
        
        this.setupWebSocketHandlers();
    }

    setupWebSocketHandlers() {
        this.wsManager.on('voice_joined', (data) => this.handleVoiceJoined(data));
        this.wsManager.on('voice_user_joined', (data) => this.handleUserJoined(data));
        this.wsManager.on('voice_user_left', (data) => this.handleUserLeft(data));
        this.wsManager.on('webrtc_offer', (data) => this.handleOffer(data));
        this.wsManager.on('webrtc_answer', (data) => this.handleAnswer(data));
        this.wsManager.on('webrtc_ice', (data) => this.handleIceCandidate(data));
        this.wsManager.on('user_camera_state', (data) => this.handleRemoteCameraState(data));
        this.wsManager.on('user_screen_share_state', (data) => this.handleRemoteScreenShareState(data));
    }
    
    handleRemoteCameraState(data) {
        console.log('Remote camera state:', data);
        if (this.onRemoteVideoChange) {
            this.onRemoteVideoChange(data.user_id, data.camera_on);
        }
    }

    handleRemoteScreenShareState(data) {
        console.log('Remote screen share state:', data);
        // Ignore our own screen share state echoed back from the server
        if (data.user_id === window.APP_CONFIG?.userId) return;
        if (data.screen_sharing) {
            this.screenShareUsers.add(data.user_id);
        } else {
            this.screenShareUsers.delete(data.user_id);
        }
        if (this.onRemoteScreenShareChange) {
            this.onRemoteScreenShareChange(data.user_id, data.screen_sharing);
        }
    }

    async initAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.destination = this.audioContext.createMediaStreamDestination();
            this.gainNode = this.audioContext.createGain();
            this.gainNode.connect(this.destination);
        }
        
        // Resume if suspended (required by browsers)
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    async getLocalStream() {
        if (this.localStream) {
            return this.localStream;
        }

        try {
            await this.initAudioContext();
            
            // Get microphone stream
            const micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });

            // Create audio source from microphone
            const micSource = this.audioContext.createMediaStreamSource(micStream);
            
            // Setup Voice Activity Detection
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 512;
            this.analyser.smoothingTimeConstant = 0.4;
            micSource.connect(this.analyser);
            
            micSource.connect(this.gainNode);

            // Use the mixed output stream
            this.localStream = this.destination.stream;
            
            // Store original mic stream for muting
            this.micStream = micStream;
            
            // Start voice activity detection
            this.startVoiceActivityDetection();

            console.log('Local audio stream initialized');
            return this.localStream;
        } catch (error) {
            console.error('Error getting local stream:', error);
            throw error;
        }
    }
    
    /**
     * Get local video stream from camera
     */
    async getLocalVideoStream() {
        if (this.localVideoStream) {
            return this.localVideoStream;
        }

        try {
            const videoStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1920, min: 1280 },
                    height: { ideal: 1080, min: 720 },
                    frameRate: { ideal: 30 },
                    facingMode: 'user'
                },
                audio: false
            });

            this.localVideoStream = videoStream;
            const settings = videoStream.getVideoTracks()[0].getSettings();
            console.log('Local video stream initialized:', settings.width + 'x' + settings.height + '@' + settings.frameRate + 'fps');
            return this.localVideoStream;
        } catch (error) {
            console.error('Error getting video stream:', error);
            throw error;
        }
    }

    /**
     * Toggle camera on/off
     */
    async toggleCamera() {
        if (this.isCameraOn) {
            await this.stopCamera();
        } else {
            await this.startCamera();
        }
        return this.isCameraOn;
    }

    /**
     * Start camera and add video track to all peer connections
     */
    async startCamera() {
        try {
            await this.getLocalVideoStream();
            
            // Add video track to all existing peer connections
            const videoTrack = this.localVideoStream.getVideoTracks()[0];
            
            for (const userId in this.peers) {
                const pc = this.peers[userId];
                // Check if we already have a video sender
                const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (videoSender) {
                    await videoSender.replaceTrack(videoTrack);
                } else {
                    pc.addTrack(videoTrack, this.localVideoStream);
                }
                
                // Set video bitrate for this peer
                await this.setVideoBitrate(pc);
            }

            this.isCameraOn = true;
            
            // Notify via callback
            if (this.onCameraChange) {
                this.onCameraChange(true);
            }
            
            // Notify other users via WebSocket
            if (this.currentVoiceChannel) {
                this.wsManager.sendCameraState(true);
            }

            console.log('Camera started');
            return this.localVideoStream;
        } catch (error) {
            console.error('Error starting camera:', error);
            throw error;
        }
    }

    /**
     * Stop camera and remove video track from all peer connections
     */
    async stopCamera() {
        if (this.localVideoStream) {
            // Stop all video tracks
            this.localVideoStream.getVideoTracks().forEach(track => {
                track.stop();
            });

            // Remove video track from all peer connections
            for (const userId in this.peers) {
                const pc = this.peers[userId];
                const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (videoSender) {
                    pc.removeTrack(videoSender);
                }
            }

            this.localVideoStream = null;
        }

        this.isCameraOn = false;
        
        // Notify via callback
        if (this.onCameraChange) {
            this.onCameraChange(false);
        }
        
        // Notify other users via WebSocket
        if (this.currentVoiceChannel) {
            this.wsManager.sendCameraState(false);
        }

        console.log('Camera stopped');
    }

    /**
     * Toggle screen sharing on/off
     */
    async toggleScreenShare() {
        if (this.isScreenSharing) {
            await this.stopScreenShare();
        } else {
            await this.startScreenShare();
        }
        return this.isScreenSharing;
    }

    /**
     * Start screen sharing and add screen track to all peer connections
     * Screen share uses a separate video track labeled 'screen' so peers can distinguish it
     */
    async startScreenShare() {
        try {
            this.screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                    frameRate: { ideal: 30 }
                },
                audio: true  // Request audio upfront — browser will capture if source supports it
            });

            const screenTrack = this.screenStream.getVideoTracks()[0];

            // Label the track so receivers know it's a screen share
            screenTrack._isScreenShare = true;

            // Handle audio track if the source provided one (e.g. browser tab)
            const audioTrack = this.screenStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack._isScreenShareAudio = true;
                // Audio starts enabled by default
                this.screenShareHasAudio = true;
                
                audioTrack.onended = () => {
                    console.log('Screen share audio track ended');
                    this.screenShareHasAudio = false;
                };
                console.log('Screen share includes audio');
            } else {
                this.screenShareHasAudio = false;
                console.log('Screen share source does not provide audio (monitor/window)');
            }

            // When user stops sharing via browser UI (clicking "Stop sharing")
            screenTrack.onended = () => {
                console.log('Screen share track ended by browser');
                this.stopScreenShare();
            };

            // Add all screen share tracks to all existing peer connections
            for (const userId in this.peers) {
                const pc = this.peers[userId];
                pc.addTrack(screenTrack, this.screenStream);
                if (audioTrack) {
                    pc.addTrack(audioTrack, this.screenStream);
                }
                await this.setScreenShareBitrate(pc);
            }

            this.isScreenSharing = true;

            // Notify via callback
            if (this.onScreenShareChange) {
                this.onScreenShareChange(true);
            }

            // Notify other users via WebSocket
            if (this.currentVoiceChannel) {
                this.wsManager.sendScreenShareState(true);
            }

            console.log('Screen sharing started');
            return this.screenStream;
        } catch (error) {
            console.error('Error starting screen share:', error);
            throw error;
        }
    }

    /**
     * Toggle audio on/off for the current screen share.
     * Audio is captured at the start (if the source supports it).
     * This simply enables/disables the existing audio track — no new picker needed.
     */
    toggleScreenShareAudio() {
        if (!this.isScreenSharing || !this.screenStream) {
            throw new Error('No active screen share');
        }
        
        const audioTrack = this.screenStream.getAudioTracks()[0];
        
        if (!audioTrack) {
            // Source didn't provide audio (monitor/window share)
            throw new Error('no-audio-track');
        }
        
        // Toggle the track's enabled state
        audioTrack.enabled = !audioTrack.enabled;
        this.screenShareHasAudio = audioTrack.enabled;
        
        console.log('Screen share audio ' + (audioTrack.enabled ? 'enabled' : 'disabled'));
    }

    /**
     * Stop screen sharing and remove screen track from all peer connections
     */
    async stopScreenShare() {
        if (this.screenStream) {
            // Stop all tracks (including audio if shared)
            this.screenStream.getTracks().forEach(track => track.stop());

            // Remove screen share tracks from all peer connections
            for (const userId in this.peers) {
                const pc = this.peers[userId];
                const senders = pc.getSenders();
                for (const sender of senders) {
                    if (sender.track && (sender.track._isScreenShare || sender.track._isScreenShareAudio)) {
                        pc.removeTrack(sender);
                    }
                }
            }

            this.screenStream = null;
        }

        this.isScreenSharing = false;
        this.screenShareHasAudio = false;

        // Notify via callback
        if (this.onScreenShareChange) {
            this.onScreenShareChange(false);
        }

        // Notify other users via WebSocket
        if (this.currentVoiceChannel) {
            this.wsManager.sendScreenShareState(false);
        }

        console.log('Screen sharing stopped');
    }

    /**
     * Set higher bitrate for screen share
     */
    async setScreenShareBitrate(pc) {
        const senders = pc.getSenders();
        for (const sender of senders) {
            if (sender.track && sender.track._isScreenShare) {
                const params = sender.getParameters();
                if (!params.encodings || params.encodings.length === 0) {
                    params.encodings = [{}];
                }
                // Set max bitrate to 12 Mbps for screen share (higher quality for text readability)
                params.encodings[0].maxBitrate = 12000000; 
                params.encodings[0].maxFramerate = 60; // Allow higher framerate for smoother screen share
                params.degradationPreference = 'maintain-resolution';
                try {
                    await sender.setParameters(params);
                    console.log('Screen share bitrate set to 12 Mbps');
                } catch (e) {
                    console.log('Could not set screen share bitrate:', e);
                }
            }
        }
    }

    /**
     * Get local video element for preview
     */
    getLocalVideoElement() {
        if (!this.localVideoStream) return null;
        
        let video = document.getElementById('local-video-preview');
        if (!video) {
            video = document.createElement('video');
            video.id = 'local-video-preview';
            video.autoplay = true;
            video.muted = true; // Mute local preview to avoid echo
            video.playsInline = true;
        }
        video.srcObject = this.localVideoStream;
        return video;
    }
    
    startVoiceActivityDetection() {
        if (this.vadInterval) {
            clearInterval(this.vadInterval);
        }
        
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        // Reset counters
        this.speakingFrames = 0;
        this.silenceFrames = 0;
        
        this.vadInterval = setInterval(() => {
            if (!this.analyser || this.isMuted) {
                if (this.isSpeaking) {
                    this.isSpeaking = false;
                    this.speakingFrames = 0;
                    this.silenceFrames = 0;
                    this.notifySpeakingChange(false);
                }
                return;
            }
            
            this.analyser.getByteFrequencyData(dataArray);
            
            // Calculate average volume (weighted towards voice frequencies 85-255 Hz)
            let sum = 0;
            let voiceSum = 0;
            const voiceStart = Math.floor(bufferLength * 0.05); // ~85 Hz
            const voiceEnd = Math.floor(bufferLength * 0.4); // ~800 Hz (human voice range)
            
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
            }
            
            // Focus on voice frequency range for better detection
            for (let i = voiceStart; i < voiceEnd; i++) {
                voiceSum += dataArray[i];
            }
            
            const average = sum / bufferLength;
            const voiceAverage = voiceSum / (voiceEnd - voiceStart);
            
            // Use the higher of the two for detection
            const level = Math.max(average, voiceAverage);
            
            // Hysteresis-based detection to prevent rapid toggling
            if (!this.isSpeaking) {
                // Need to exceed higher threshold to start speaking
                if (level > this.speakingThreshold) {
                    this.speakingFrames++;
                    this.silenceFrames = 0;
                    if (this.speakingFrames >= this.minSpeakingFrames) {
                        this.isSpeaking = true;
                        this.notifySpeakingChange(true);
                    }
                } else {
                    this.speakingFrames = 0;
                }
            } else {
                // Need to go below lower threshold for sustained period to stop
                if (level < this.silenceThreshold) {
                    this.silenceFrames++;
                    this.speakingFrames = 0;
                    if (this.silenceFrames >= this.minSilenceFrames) {
                        this.isSpeaking = false;
                        this.notifySpeakingChange(false);
                    }
                } else {
                    this.silenceFrames = 0;
                    this.speakingFrames++;
                }
            }
        }, 50); // Check every 50ms
    }
    
    stopVoiceActivityDetection() {
        if (this.vadInterval) {
            clearInterval(this.vadInterval);
            this.vadInterval = null;
        }
        this.isSpeaking = false;
        this.notifySpeakingChange(false);
    }
    
    notifySpeakingChange(speaking) {
        if (this.onSpeakingChange) {
            this.onSpeakingChange(speaking);
        }
        
        // Also notify via WebSocket for other users
        if (this.currentVoiceChannel) {
            this.wsManager.send({
                type: 'speaking',
                speaking: speaking,
                channel_id: this.currentVoiceChannel
            });
        }
    }

    async joinVoiceChannel(channelId) {
        try {
            // Leave current channel first
            if (this.currentVoiceChannel) {
                await this.leaveVoiceChannel();
            }

            // Get local stream
            await this.getLocalStream();
            
            // Always restart voice activity detection when joining
            if (this.analyser) {
                this.startVoiceActivityDetection();
            }

            // Join via WebSocket
            this.wsManager.joinVoice(channelId);
            this.currentVoiceChannel = channelId;

            console.log(`Joining voice channel: ${channelId}`);
        } catch (error) {
            console.error('Error joining voice channel:', error);
            throw error;
        }
    }

    async leaveVoiceChannel() {
        // Stop voice activity detection
        this.stopVoiceActivityDetection();
        
        // Stop camera if on
        if (this.isCameraOn) {
            await this.stopCamera();
        }
        
        // Stop screen share if active
        if (this.isScreenSharing) {
            await this.stopScreenShare();
        }
        
        // Close all peer connections
        for (const userId in this.peers) {
            this.closePeerConnection(userId);
        }

        // Notify server
        this.wsManager.leaveVoice();
        this.currentVoiceChannel = null;

        console.log('Left voice channel');
    }

    async handleVoiceJoined(data) {
        console.log('Voice joined, existing members:', data.members);
        
        // Create connections to existing members
        for (const member of data.members) {
            await this.createPeerConnection(member.id, true);
        }
    }

    async handleUserJoined(data) {
        console.log('User joined voice:', data.user);
        
        // Wait for their offer (they're the newcomer, we don't initiate)
        // The new user will send offers to us
    }

    handleUserLeft(data) {
        console.log('User left voice:', data.user_id);
        this.closePeerConnection(data.user_id);
    }

    async createPeerConnection(userId, createOffer = false) {
        if (this.peers[userId]) {
            console.log(`Peer connection already exists for user ${userId}`);
            return this.peers[userId];
        }

        console.log(`Creating peer connection for user ${userId}`);
        
        const pc = new RTCPeerConnection(this.iceServers);
        this.peers[userId] = pc;

        // Add local audio stream tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }
        
        // Add local video stream if camera is on
        if (this.localVideoStream && this.isCameraOn) {
            this.localVideoStream.getVideoTracks().forEach(track => {
                pc.addTrack(track, this.localVideoStream);
            });
            console.log('Added video track to new peer connection');
        }

        // Add screen share stream if sharing
        if (this.screenStream && this.isScreenSharing) {
            this.screenStream.getVideoTracks().forEach(track => {
                pc.addTrack(track, this.screenStream);
            });
            console.log('Added screen share track to new peer connection');
        }

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.wsManager.sendWebRTCIce(userId, event.candidate);
            }
        };

        // Handle connection state changes
        pc.onconnectionstatechange = () => {
            console.log(`Connection state for ${userId}: ${pc.connectionState}`);
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                this.closePeerConnection(userId);
            }
        };
        
        // Handle negotiation needed (when tracks are added/removed)
        pc.onnegotiationneeded = async () => {
            console.log(`Negotiation needed for ${userId}`);
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                this.wsManager.sendWebRTCOffer(userId, offer);
                this.setVideoBitrate(pc);
            } catch (error) {
                console.error('Error during renegotiation:', error);
            }
        };

        // Handle incoming audio/video stream
        pc.ontrack = (event) => {
            console.log(`Received track from user ${userId}:`, event.track.kind);
            this.handleRemoteTrack(userId, event.track, event.streams[0]);
        };

        // Create offer if we're initiating
        if (createOffer) {
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                this.wsManager.sendWebRTCOffer(userId, offer);
                
                // Set video bitrate after offer is created
                this.setVideoBitrate(pc);
            } catch (error) {
                console.error('Error creating offer:', error);
            }
        }

        return pc;
    }
    
    /**
     * Set higher video bitrate for better quality
     */
    async setVideoBitrate(pc) {
        const senders = pc.getSenders();
        for (const sender of senders) {
            if (sender.track?.kind === 'video') {
                const params = sender.getParameters();
                if (!params.encodings || params.encodings.length === 0) {
                    params.encodings = [{}];
                }
                // Set max bitrate to 4 Mbps for HD video
                params.encodings[0].maxBitrate = 4000000;
                params.encodings[0].maxFramerate = 30;
                // Disable bandwidth degradation
                params.degradationPreference = 'maintain-resolution';
                try {
                    await sender.setParameters(params);
                    console.log('Video bitrate set to 4 Mbps');
                } catch (e) {
                    console.log('Could not set video bitrate:', e);
                }
            }
        }
    }

    async handleOffer(data) {
        console.log(`Received offer from user ${data.from_user_id}`);
        
        const pc = await this.createPeerConnection(data.from_user_id, false);
        
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.payload));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            this.wsManager.sendWebRTCAnswer(data.from_user_id, answer);
            
            // Set video bitrate after answer
            this.setVideoBitrate(pc);
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    }

    async handleAnswer(data) {
        console.log(`Received answer from user ${data.from_user_id}`);
        
        const pc = this.peers[data.from_user_id];
        if (!pc) {
            console.error(`No peer connection for user ${data.from_user_id}`);
            return;
        }

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.payload));
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }

    async handleIceCandidate(data) {
        const pc = this.peers[data.from_user_id];
        if (!pc) {
            console.error(`No peer connection for user ${data.from_user_id}`);
            return;
        }

        try {
            await pc.addIceCandidate(new RTCIceCandidate(data.payload));
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }

    handleRemoteTrack(userId, track, stream) {
        if (track.kind === 'audio') {
            // Create audio element for playback
            let audio = document.getElementById(`audio-${userId}`);
            
            if (!audio) {
                audio = document.createElement('audio');
                audio.id = `audio-${userId}`;
                audio.autoplay = true;
                audio.style.display = 'none';
                document.body.appendChild(audio);
            }

            audio.srcObject = stream;
            audio.muted = this.isDeafened;
        } else if (track.kind === 'video') {
            // Determine if this is a screen share or camera track
            // Screen share is the second video stream from a user, or comes from
            // a user we know is screen sharing
            const isScreenShare = this.screenShareUsers.has(userId) && this.isSecondVideoStream(userId, stream);
            
            if (isScreenShare) {
                console.log(`Received SCREEN SHARE track from user ${userId}`);
                
                // Create video element for screen share
                let video = document.createElement('video');
                video.id = `screen-video-${userId}`;
                video.autoplay = true;
                video.playsInline = true;
                video.muted = true;
                video.className = 'screen-share-video w-full h-full object-contain';
                video.srcObject = stream;
                
                // Notify callback about remote screen share
                if (this.onRemoteScreenShareChange) {
                    this.onRemoteScreenShareChange(userId, true, video);
                }
                
                // Handle track ended
                track.onended = () => {
                    console.log(`Screen share track ended for user ${userId}`);
                    this.screenShareUsers.delete(userId);
                    if (this.onRemoteScreenShareChange) {
                        this.onRemoteScreenShareChange(userId, false, null);
                    }
                };
                
                // Also store the stream reference for later identification
                if (!this._remoteScreenStreams) this._remoteScreenStreams = {};
                this._remoteScreenStreams[userId] = stream.id;
            } else {
                // Handle camera video track
                console.log(`Received CAMERA track from user ${userId}`);
                
                let video = document.getElementById(`video-${userId}`);
                
                if (!video) {
                    video = document.createElement('video');
                    video.id = `video-${userId}`;
                    video.autoplay = true;
                    video.playsInline = true;
                    video.muted = true;
                    video.className = 'remote-video w-full h-full object-cover rounded-lg';
                    video.style.display = 'none';
                }

                video.srcObject = stream;
                
                // Store stream id for camera to help identify screen shares later
                if (!this._remoteCameraStreams) this._remoteCameraStreams = {};
                this._remoteCameraStreams[userId] = stream.id;
                
                // Notify callback about remote video availability
                if (this.onRemoteVideoChange) {
                    this.onRemoteVideoChange(userId, true, video);
                }
                
                // Handle track ended
                track.onended = () => {
                    console.log(`Video track ended for user ${userId}`);
                    if (this.onRemoteVideoChange) {
                        this.onRemoteVideoChange(userId, false, null);
                    }
                };
            }
        }
    }

    /**
     * Check if this is a second video stream from the user (i.e., screen share)
     * by comparing stream IDs with previously seen camera streams
     */
    isSecondVideoStream(userId, stream) {
        if (!this._remoteCameraStreams) this._remoteCameraStreams = {};
        if (!this._remoteScreenStreams) this._remoteScreenStreams = {};
        
        // If we already have a camera stream with a different ID, this is the screen share
        const knownCameraStreamId = this._remoteCameraStreams[userId];
        if (knownCameraStreamId && knownCameraStreamId !== stream.id) {
            return true;
        }
        
        // If this stream was previously identified as screen share
        if (this._remoteScreenStreams[userId] === stream.id) {
            return true;
        }
        
        // If the user doesn't have a camera on, this first video must be screen share
        // Check: do we have any video element for camera for this user?
        const existingCameraVideo = document.getElementById(`video-${userId}`);
        if (existingCameraVideo && existingCameraVideo.srcObject && existingCameraVideo.srcObject.id !== stream.id) {
            return true;
        }
        
        // If no camera stream known at all but user IS screen sharing, it's a screen share
        if (!knownCameraStreamId && this.screenShareUsers.has(userId)) {
            // No camera stream known => first video from this user while they're marked as screen sharing
            // This IS the screen share
            return true;
        }
        
        return false;
    }

    closePeerConnection(userId) {
        const pc = this.peers[userId];
        if (pc) {
            pc.close();
            delete this.peers[userId];
        }

        // Remove audio element
        const audio = document.getElementById(`audio-${userId}`);
        if (audio) {
            audio.remove();
        }
        
        // Remove video element
        const video = document.getElementById(`video-${userId}`);
        if (video) {
            video.remove();
        }
        
        // Remove screen share video element
        const screenVideo = document.getElementById(`screen-video-${userId}`);
        if (screenVideo) {
            screenVideo.remove();
        }
        
        // Clean up stream tracking
        if (this._remoteCameraStreams) delete this._remoteCameraStreams[userId];
        if (this._remoteScreenStreams) delete this._remoteScreenStreams[userId];
        this.screenShareUsers.delete(userId);
        
        // Notify about video removal
        if (this.onRemoteVideoChange) {
            this.onRemoteVideoChange(userId, false, null);
        }
        
        // Notify about screen share removal
        if (this.onRemoteScreenShareChange) {
            this.onRemoteScreenShareChange(userId, false, null);
        }
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        
        if (this.micStream) {
            this.micStream.getAudioTracks().forEach(track => {
                track.enabled = !this.isMuted;
            });
        }
        
        return this.isMuted;
    }

    toggleDeafen() {
        this.isDeafened = !this.isDeafened;
        
        // Mute all remote audio
        document.querySelectorAll('audio[id^="audio-"]').forEach(audio => {
            audio.muted = this.isDeafened;
        });
        
        // Note: We do NOT auto-mute the microphone when deafening.
        // User can still speak even when deafened (they just can't hear others).
        // This allows the speaking indicator to work correctly when output is muted.
        
        return this.isDeafened;
    }

    /**
     * Play a sound and mix it into the outgoing audio stream
     * All connected peers will hear this sound
     */
    async playSound(soundUrl) {
        if (!this.audioContext) {
            await this.initAudioContext();
        }

        try {
            const response = await fetch(soundUrl);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            
            const source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.gainNode);
            source.start(0);
            
            console.log('Playing sound through voice channel');
            
            return source;
        } catch (error) {
            console.error('Error playing sound:', error);
            throw error;
        }
    }

    cleanup() {
        // Stop voice activity detection
        this.stopVoiceActivityDetection();
        
        // Stop camera if on
        if (this.isCameraOn) {
            this.stopCamera();
        }
        
        // Stop screen share if active
        if (this.isScreenSharing) {
            this.stopScreenShare();
        }
        
        // Stop local video stream
        if (this.localVideoStream) {
            this.localVideoStream.getTracks().forEach(track => track.stop());
            this.localVideoStream = null;
        }
        
        // Stop local streams
        if (this.micStream) {
            this.micStream.getTracks().forEach(track => track.stop());
        }
        
        // Close all peer connections
        for (const userId in this.peers) {
            this.closePeerConnection(userId);
        }
        
        // Close audio context
        if (this.audioContext) {
            this.audioContext.close();
        }
        
        this.isCameraOn = false;
    }
}

// Export for use in other modules
window.WebRTCManager = WebRTCManager;
