/**
 * Friends and Direct Messages Manager
 * Handles friend system, DM conversations, and private calls
 */
class FriendsManager {
    constructor(app) {
        this.app = app;
        this.wsManager = app.wsManager;
        this.webrtcManager = app.webrtcManager;
        this.friends = [];
        this.pendingRequests = { incoming: [], outgoing: [] };
        this.conversations = [];
        this.currentDmChannelId = null;
        this.currentDmFriendId = null;
        this.dmTypingTimeout = null;
        this.incomingCall = null;
        this.activeCallChannelId = null;
        this.activeCallFriendId = null;
        this.activeCallHasVideo = false;
        this.callEndTimeout = null;

        this.init();
    }

    async init() {
        this.setupWebSocketHandlers();
        this.setupUIHandlers();
        this.setupWebRTCCallbacks();
        this.setupDmCallResizer();
        this.setupDmVoiceTileContextMenu();
        await this.loadFriends();
        await this.loadPendingRequests();
        await this.loadConversations();
        this.updatePendingBadge();
        await this.checkAndRestoreActiveCall();
    }

    /**
     * Check if user has an active DM call and restore it
     */
    async checkAndRestoreActiveCall() {
        try {
            const response = await fetch('/api/dm/active-call');
            const data = await response.json();
            
            console.log('checkAndRestoreActiveCall response:', data);
            
            if (data.success && data.active_call) {
                const { voice_channel_id, friend_id, members } = data.active_call;
                
                console.log('Active call found:', voice_channel_id, 'friend:', friend_id, 'members:', members);
                
                // Restore call state FIRST
                this.activeCallChannelId = voice_channel_id;
                this.activeCallFriendId = friend_id;
                
                // Show friends panel
                document.getElementById('server-view')?.classList.add('hidden');
                document.getElementById('friends-view')?.classList.remove('hidden');
                document.getElementById('btn-home')?.classList.remove('active');
                document.getElementById('btn-friends')?.classList.add('active');
                
                // Open DM conversation with this friend
                await this.openDmConversation(friend_id);
                
                // FORCE show call UI regardless of other state
                const callArea = document.getElementById('dm-call-area');
                if (callArea) {
                    callArea.classList.remove('hidden');
                    const savedHeight = localStorage.getItem('dm-call-area-height');
                    callArea.style.height = savedHeight || '300px';
                }
                
                // Add voice members
                const display = document.getElementById('dm-voice-members-display');
                if (display) {
                    display.innerHTML = '';
                    members.forEach(member => {
                        this.addDmVoiceMember(
                            member.user_id,
                            member.display_name || member.username,
                            member.avatar
                        );
                    });
                }
                
                // Rejoin WebRTC
                if (this.webrtcManager) {
                    this.webrtcManager.joinVoiceChannel(voice_channel_id);
                }
                
                console.log('Restored active DM call:', voice_channel_id);
            }
        } catch (error) {
            console.error('Error checking for active call:', error);
        }
    }

    /**
     * Setup resizable divider for DM call area
     */
    setupDmCallResizer() {
        const resizer = document.getElementById('dm-call-resizer');
        const callArea = document.getElementById('dm-call-area');
        
        if (!resizer || !callArea) return;
        
        let isResizing = false;
        let startY = 0;
        let startHeight = 0;
        
        const savedHeight = localStorage.getItem('dm-call-area-height');
        if (savedHeight) {
            callArea.style.height = savedHeight;
        }
        
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            startY = e.clientY;
            startHeight = callArea.offsetHeight;
            resizer.classList.add('resizing');
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const deltaY = e.clientY - startY;
            const newHeight = Math.max(200, Math.min(startHeight + deltaY, window.innerHeight - 200));
            callArea.style.height = newHeight + 'px';
        });
        
        document.addEventListener('mouseup', () => {
            if (!isResizing) return;
            isResizing = false;
            resizer.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            
            // Save height preference
            localStorage.setItem('dm-call-area-height', callArea.style.height);
        });
    }

    setupWebRTCCallbacks() {
        // Per-user audio settings for DM calls
        this.dmUserAudioSettings = {}; // userId -> { volume: 100, muted: false, videoHidden: false, streamHidden: false }
        
        // Intercept camera state changes to update DM video display for local user
        const originalOnCameraChange = this.webrtcManager.onCameraChange;
        this.webrtcManager.onCameraChange = (cameraOn) => {
            // If we're in a DM call, update our own video tile
            if (this.activeCallChannelId) {
                this.updateDmVideoDisplay(window.APP_CONFIG.userId, cameraOn);
            }
            // Also call original handler for server voice
            if (originalOnCameraChange) {
                originalOnCameraChange(cameraOn);
            }
        };
        
        // Intercept remote video changes for DM calls
        const originalOnRemoteVideoChange = this.webrtcManager.onRemoteVideoChange;
        this.webrtcManager.onRemoteVideoChange = (userId, hasVideo, videoElement) => {
            // If we're in a DM call, handle it in DM UI
            if (this.activeCallChannelId) {
                this.handleDmRemoteVideo(userId, hasVideo, videoElement);
            }
            // Also call original handler for server voice
            if (originalOnRemoteVideoChange) {
                originalOnRemoteVideoChange(userId, hasVideo, videoElement);
            }
        };
        
        // Intercept remote screen share for DM calls
        const originalOnRemoteScreenShareChange = this.webrtcManager.onRemoteScreenShareChange;
        this.webrtcManager.onRemoteScreenShareChange = (userId, hasScreen, videoElement) => {
            if (this.activeCallChannelId) {
                this.handleDmRemoteScreenShare(userId, hasScreen, videoElement);
            }
            if (originalOnRemoteScreenShareChange) {
                originalOnRemoteScreenShareChange(userId, hasScreen, videoElement);
            }
        };
        
        // Intercept local screen share changes for DM calls
        const originalOnScreenShareChange = this.webrtcManager.onScreenShareChange;
        this.webrtcManager.onScreenShareChange = (isSharing) => {
            if (this.activeCallChannelId) {
                if (isSharing) {
                    this.addDmScreenShareTile(window.APP_CONFIG.userId, window.APP_CONFIG.username, true, this.webrtcManager.screenStream);
                } else {
                    this.removeDmScreenShareTile(window.APP_CONFIG.userId);
                }
            }
            if (originalOnScreenShareChange) {
                originalOnScreenShareChange(isSharing);
            }
        };
    }

    /**
     * Setup context menu for DM voice tiles
     */
    setupDmVoiceTileContextMenu() {
        // Use the same context menu as server voice but for DM tiles
        document.addEventListener('contextmenu', (e) => {
            const tile = e.target.closest('#dm-voice-members-display .voice-member-card');
            if (!tile) return;
            if (!this.activeCallChannelId) return;
            
            e.preventDefault();
            
            const userId = tile.dataset.userId;
            const isScreenShare = tile.dataset.screenShare === 'true';
            const username = tile.querySelector('.username')?.textContent || 'User';
            
            this.showDmVoiceTileContextMenu(e.clientX, e.clientY, userId, username, isScreenShare);
        });
    }

    showDmVoiceTileContextMenu(x, y, userId, username, isScreenShare) {
        // Use the existing voice-tile-context-menu from index.twig
        const menu = document.getElementById('voice-tile-context-menu');
        if (!menu) return;
        
        // Store context for the app's handlers
        this.app._contextMenuUserId = userId;
        this.app._contextMenuIsScreenShare = isScreenShare;
        this.app._contextMenuIsDm = true; // Flag for DM context
        
        const isOwnUser = userId == window.APP_CONFIG.userId;
        
        // Set username
        document.getElementById('ctx-menu-username').textContent = username;
        
        // Init audio settings for this user if needed
        if (!this.dmUserAudioSettings[userId]) {
            this.dmUserAudioSettings[userId] = { volume: 100, muted: false, videoHidden: false, streamHidden: false, streamMuted: false };
        }
        const settings = this.dmUserAudioSettings[userId];
        
        // Get all elements
        const volumeSection = document.getElementById('ctx-volume-section');
        const divider1 = document.getElementById('ctx-divider-1');
        const divider2 = document.getElementById('ctx-divider-2');
        const muteBtn = document.getElementById('ctx-toggle-mute');
        const videoBtn = document.getElementById('ctx-toggle-video');
        const streamMuteBtn = document.getElementById('ctx-toggle-stream-mute');
        const streamBtn = document.getElementById('ctx-toggle-stream');
        const streamAudioBtn = document.getElementById('ctx-toggle-stream-audio');
        
        // Hide everything first
        volumeSection.style.display = 'none';
        divider1.style.display = 'none';
        divider2.style.display = 'none';
        muteBtn.style.display = 'none';
        videoBtn.style.display = 'none';
        streamMuteBtn.style.display = 'none';
        streamBtn.style.display = 'none';
        streamAudioBtn.style.display = 'none';
        
        if (isScreenShare) {
            if (isOwnUser) {
                // Own screen share: show audio toggle
                streamAudioBtn.style.display = '';
                const audioIcon = streamAudioBtn.querySelector('.material-icons');
                const audioText = streamAudioBtn.querySelector('span:last-child');
                
                const audioTrack = this.webrtcManager?.screenStream?.getAudioTracks()[0];
                const hasAudio = this.webrtcManager?.screenShareHasAudio || false;
                
                if (!audioTrack) {
                    audioIcon.textContent = 'mic_off';
                    audioText.textContent = 'Audio Not Available';
                    streamAudioBtn.classList.add('disabled');
                    streamAudioBtn.classList.remove('active');
                } else if (hasAudio) {
                    audioIcon.textContent = 'mic';
                    audioText.textContent = 'Stream Audio On';
                    streamAudioBtn.classList.add('active');
                    streamAudioBtn.classList.remove('disabled');
                } else {
                    audioIcon.textContent = 'mic_off';
                    audioText.textContent = 'Stream Audio Off';
                    streamAudioBtn.classList.remove('active');
                    streamAudioBtn.classList.remove('disabled');
                }
            } else {
                // Other user's screen share
                volumeSection.style.display = '';
                divider1.style.display = '';
                divider2.style.display = '';
                
                const slider = document.getElementById('ctx-volume-slider');
                slider.value = settings.volume;
                document.getElementById('ctx-volume-value').textContent = settings.volume + '%';
                
                streamMuteBtn.style.display = '';
                const smIcon = streamMuteBtn.querySelector('.material-icons');
                const smText = streamMuteBtn.querySelector('span:last-child');
                if (settings.streamMuted) {
                    smIcon.textContent = 'volume_up';
                    smText.textContent = 'Unmute Stream';
                    streamMuteBtn.classList.add('active');
                } else {
                    smIcon.textContent = 'volume_off';
                    smText.textContent = 'Mute Stream';
                    streamMuteBtn.classList.remove('active');
                }
                
                streamBtn.style.display = '';
                const stIcon = streamBtn.querySelector('.material-icons');
                const stText = streamBtn.querySelector('span:last-child');
                if (settings.streamHidden) {
                    stIcon.textContent = 'live_tv';
                    stText.textContent = 'Watch Stream';
                } else {
                    stIcon.textContent = 'tv_off';
                    stText.textContent = 'Leave Stream';
                }
            }
        } else {
            // User tile
            if (isOwnUser) {
                menu.classList.add('hidden');
                return;
            } else {
                volumeSection.style.display = '';
                divider1.style.display = '';
                
                const slider = document.getElementById('ctx-volume-slider');
                slider.value = settings.volume;
                document.getElementById('ctx-volume-value').textContent = settings.volume + '%';
                
                muteBtn.style.display = '';
                const muteIcon = muteBtn.querySelector('.material-icons');
                const muteText = muteBtn.querySelector('span:last-child');
                if (settings.muted) {
                    muteIcon.textContent = 'volume_up';
                    muteText.textContent = 'Unmute User';
                    muteBtn.classList.add('active');
                } else {
                    muteIcon.textContent = 'volume_off';
                    muteText.textContent = 'Mute User';
                    muteBtn.classList.remove('active');
                }
                
                if (this.dmTileHasVideo(userId)) {
                    videoBtn.style.display = '';
                    const vidIcon = videoBtn.querySelector('.material-icons');
                    const vidText = videoBtn.querySelector('span:last-child');
                    if (settings.videoHidden) {
                        vidIcon.textContent = 'videocam';
                        vidText.textContent = 'Show Video';
                        videoBtn.classList.add('active');
                    } else {
                        vidIcon.textContent = 'videocam_off';
                        vidText.textContent = 'Hide Video';
                        videoBtn.classList.remove('active');
                    }
                }
            }
        }
        
        // Position menu
        const menuWidth = 260;
        const menuHeight = 300;
        let posX = x;
        let posY = y;
        
        if (x + menuWidth > window.innerWidth) posX = window.innerWidth - menuWidth - 8;
        if (y + menuHeight > window.innerHeight) posY = window.innerHeight - menuHeight - 8;
        
        menu.style.left = posX + 'px';
        menu.style.top = posY + 'px';
        menu.classList.remove('hidden');
    }

    dmTileHasVideo(userId) {
        const card = document.querySelector(`#dm-voice-members-display .voice-member-card[data-user-id="${userId}"]:not([data-screen-share])`);
        if (!card) return false;
        const videoContainer = card.querySelector('.video-container');
        return videoContainer && !videoContainer.classList.contains('hidden');
    }

    setDmUserVolume(userId, volume) {
        if (!this.dmUserAudioSettings[userId]) {
            this.dmUserAudioSettings[userId] = { volume: 100, muted: false, videoHidden: false, streamHidden: false };
        }
        this.dmUserAudioSettings[userId].volume = volume;
        
        const audio = document.getElementById(`audio-${userId}`);
        if (audio) {
            audio.volume = Math.min(volume / 100, 1.0);
        }
    }

    toggleDmUserMute(userId) {
        if (!this.dmUserAudioSettings[userId]) {
            this.dmUserAudioSettings[userId] = { volume: 100, muted: false, videoHidden: false, streamHidden: false };
        }
        
        this.dmUserAudioSettings[userId].muted = !this.dmUserAudioSettings[userId].muted;
        
        const audio = document.getElementById(`audio-${userId}`);
        if (audio) {
            audio.muted = this.dmUserAudioSettings[userId].muted;
        }
    }

    toggleDmUserVideoHidden(userId) {
        if (!this.dmUserAudioSettings[userId]) {
            this.dmUserAudioSettings[userId] = { volume: 100, muted: false, videoHidden: false, streamHidden: false };
        }
        
        this.dmUserAudioSettings[userId].videoHidden = !this.dmUserAudioSettings[userId].videoHidden;
        
        const card = document.querySelector(`#dm-voice-members-display .voice-member-card[data-user-id="${userId}"]:not([data-screen-share])`);
        if (card) {
            card.classList.toggle('video-hidden', this.dmUserAudioSettings[userId].videoHidden);
        }
    }

    toggleDmStreamWatch(userId) {
        if (!this.dmUserAudioSettings[userId]) {
            this.dmUserAudioSettings[userId] = { volume: 100, muted: false, videoHidden: false, streamHidden: true };
        }
        
        this.dmUserAudioSettings[userId].streamHidden = !this.dmUserAudioSettings[userId].streamHidden;
        
        const card = document.querySelector(`#dm-voice-members-display .voice-member-card[data-user-id="${userId}"][data-screen-share="true"]`);
        if (card) {
            card.classList.toggle('video-hidden', this.dmUserAudioSettings[userId].streamHidden);
            
            // Update badge
            const badge = card.querySelector('.stream-badge');
            if (badge) badge.remove();
            
            if (this.dmUserAudioSettings[userId].streamHidden) {
                const newBadge = document.createElement('button');
                newBadge.className = 'stream-badge stream-watch';
                newBadge.innerHTML = '<span class="material-icons" style="font-size:14px;vertical-align:middle;margin-right:2px;">live_tv</span> Watch';
                card.appendChild(newBadge);
                newBadge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleDmStreamWatch(userId);
                });
            }
        }
    }

    toggleDmStreamMute(userId) {
        if (!this.dmUserAudioSettings[userId]) {
            this.dmUserAudioSettings[userId] = { volume: 100, muted: false, videoHidden: false, streamHidden: false, streamMuted: false };
        }
        
        this.dmUserAudioSettings[userId].streamMuted = !this.dmUserAudioSettings[userId].streamMuted;
        
        const audio = document.getElementById(`screen-audio-${userId}`);
        if (audio) {
            audio.muted = this.dmUserAudioSettings[userId].streamMuted;
        }
    }

    handleDmRemoteScreenShare(userId, hasScreen, videoElement) {
        if (hasScreen) {
            // Find username from the existing member card
            const memberCard = document.querySelector(`#dm-voice-members-display [data-user-id="${userId}"]:not([data-screen-share])`);
            const username = memberCard?.querySelector('.username')?.textContent || 'User';
            
            // If no videoElement provided, try to get the stream from the hidden element
            let videoSource = videoElement;
            if (!videoSource) {
                const remoteScreenVideo = document.getElementById(`screen-video-${userId}`);
                if (remoteScreenVideo && remoteScreenVideo.srcObject) {
                    videoSource = remoteScreenVideo;
                }
            }
            
            if (videoSource) {
                this.addDmScreenShareTile(userId, username, false, videoSource);
            }
        } else {
            this.removeDmScreenShareTile(userId);
        }
    }

    addDmScreenShareTile(userId, username, isLocal, videoElementOrStream) {
        const voiceDisplay = document.getElementById('dm-voice-members-display');
        if (!voiceDisplay) return;
        
        // Remove existing screen share tile
        const existingTile = voiceDisplay.querySelector(`[data-user-id="${userId}"][data-screen-share="true"]`);
        if (existingTile) {
            existingTile.remove();
        }
        
        const tile = document.createElement('div');
        tile.className = 'voice-member-card screen-share-card';
        tile.dataset.userId = userId;
        tile.dataset.screenShare = 'true';
        
        const isOwnStream = userId == window.APP_CONFIG.userId;
        
        // Remote streams hidden by default
        if (!this.dmUserAudioSettings[userId]) {
            this.dmUserAudioSettings[userId] = { volume: 100, muted: false, videoHidden: false, streamHidden: !isOwnStream, streamMuted: false };
        }
        if (!isOwnStream && this.dmUserAudioSettings[userId].streamHidden === undefined) {
            this.dmUserAudioSettings[userId].streamHidden = true;
        }
        const isHidden = !isOwnStream && this.dmUserAudioSettings[userId].streamHidden;
        
        tile.innerHTML = `
            <div class="screen-share-container">
                <video class="screen-share-video" autoplay playsinline muted></video>
            </div>
            <div class="user-info-overlay">
                <span class="material-icons text-sm" style="color: var(--brand-success);">screen_share</span>
                <span class="username">${username}'s Screen</span>
            </div>
            <button class="btn-spotlight" title="Focus View">
                <span class="material-icons text-lg">fullscreen</span>
            </button>
        `;
        
        if (isHidden) {
            tile.classList.add('video-hidden');
            const badge = document.createElement('button');
            badge.className = 'stream-badge stream-watch';
            badge.innerHTML = '<span class="material-icons" style="font-size:14px;vertical-align:middle;margin-right:2px;">live_tv</span> Watch';
            tile.appendChild(badge);
            badge.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleDmStreamWatch(userId);
            });
        }
        
        voiceDisplay.appendChild(tile);
        
        // Set up video stream
        const video = tile.querySelector('.screen-share-video');
        if (isLocal && this.webrtcManager?.screenStream) {
            video.srcObject = this.webrtcManager.screenStream;
            video.play().catch(e => console.log('Screen share preview play error:', e));
        } else if (videoElementOrStream) {
            if (videoElementOrStream instanceof MediaStream) {
                video.srcObject = videoElementOrStream;
            } else if (videoElementOrStream.srcObject) {
                video.srcObject = videoElementOrStream.srcObject;
            }
            video.play().catch(e => console.log('Remote screen share play error:', e));
        }
        
        // Update grid
        this.updateDmVoiceGridLayout();
        
        // Spotlight handler
        tile.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('.stream-badge')) return;
            this.app.openSpotlightScreenShare?.(userId);
        });
        
        tile.querySelector('.btn-spotlight')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.app.openSpotlightScreenShare?.(userId);
        });
    }

    removeDmScreenShareTile(userId) {
        const tile = document.querySelector(`#dm-voice-members-display [data-user-id="${userId}"][data-screen-share="true"]`);
        if (tile) {
            const video = tile.querySelector('video');
            if (video) video.srcObject = null;
            tile.remove();
            this.updateDmVoiceGridLayout();
        }
    }

    handleDmRemoteVideo(userId, hasVideo, videoElement) {
        const memberCard = document.querySelector(`#dm-voice-members-display [data-user-id="${userId}"]:not([data-screen-share])`);
        if (!memberCard) return;
        
        const videoContainer = memberCard.querySelector('.video-container');
        const voiceContent = memberCard.querySelector('.voice-member-content');
        const existingVideo = memberCard.querySelector('.user-video');
        const cameraIcon = memberCard.querySelector('.camera-icon');
        
        if (hasVideo) {
            if (videoContainer) {
                videoContainer.classList.remove('hidden');
                videoContainer.style.display = 'block';
            }
            if (voiceContent) voiceContent.classList.add('hidden');
            
            // Copy the stream to our video element
            if (existingVideo) {
                if (videoElement && videoElement.srcObject) {
                    existingVideo.srcObject = videoElement.srcObject;
                } else {
                    // Try to get stream from standalone video element created by webrtc
                    const remoteVideo = document.getElementById(`video-${userId}`);
                    if (remoteVideo && remoteVideo.srcObject) {
                        existingVideo.srcObject = remoteVideo.srcObject;
                    }
                }
                existingVideo.play().catch(e => console.log('DM remote video play error:', e));
            }
            
            if (cameraIcon) cameraIcon.classList.remove('hidden');
        } else {
            if (videoContainer) {
                videoContainer.classList.add('hidden');
                videoContainer.style.display = '';
            }
            if (voiceContent) voiceContent.classList.remove('hidden');
            if (existingVideo) existingVideo.srcObject = null;
            if (cameraIcon) cameraIcon.classList.add('hidden');
        }
    }

    // ========================
    // WebSocket Event Handlers
    // ========================

    setupWebSocketHandlers() {
        // Friend request received
        this.wsManager.on('friend_request_received', (data) => {
            this.handleFriendRequestReceived(data);
        });

        // Friend request accepted
        this.wsManager.on('friend_request_accepted', (data) => {
            this.handleFriendRequestAccepted(data);
        });

        // Friend status update
        this.wsManager.on('friend_status_update', (data) => {
            this.updateFriendStatus(data.user_id, data.status);
        });

        // DM new message
        this.wsManager.on('dm_new_message', (data) => {
            this.handleDmMessage(data);
        });

        // DM typing
        this.wsManager.on('dm_user_typing', (data) => {
            this.showDmTypingIndicator(data.username);
        });

        // Incoming call
        this.wsManager.on('dm_call_incoming', (data) => {
            this.handleIncomingCall(data);
        });

        // Call responses
        this.wsManager.on('dm_call_accepted', (data) => {
            this.handleCallAccepted(data);
        });

        // Call declined
        this.wsManager.on('dm_call_declined', (data) => {
            this.handleCallDeclined(data);
        });

        // Call unavailable (user went offline or is in another call)
        this.wsManager.on('dm_call_unavailable', (data) => {
            this.app.showNotification('User is offline', 'error');
            this.endCallCompletely();
        });

        // DM call ended (all participants left)
        this.wsManager.on('dm_call_ended', (data) => {
            console.log('DM call ended:', data);
            if (this.activeCallChannelId && data.channel_id == this.activeCallChannelId) {
                this.app.showNotification('Call ended', 'info');
                this.endCallCompletely();
            }
        });

        // Voice joined - check if it's a DM call
        this.wsManager.on('voice_joined', (data) => {
            if (data.channel_type === 'dm' && this.activeCallChannelId) {
                this.onDmVoiceJoined(data);
            }
        });

        // Voice user joined DM call
        this.wsManager.on('voice_user_joined', (data) => {
            if (data.channel_type === 'dm' && this.activeCallChannelId) {
                this.onDmVoiceUserJoined(data);
            }
        });

        // Voice user left DM call
        this.wsManager.on('voice_user_left', (data) => {
            if (this.activeCallChannelId && data.channel_id === this.activeCallChannelId) {
                this.onDmVoiceUserLeft(data);
            }
        });

        // Speaking indicator for DM calls
        this.wsManager.on('user_speaking', (data) => {
            if (this.activeCallChannelId) {
                this.updateDmSpeakingIndicator(data.user_id, data.speaking);
            }
        });

        // Remote camera state for DM calls
        this.wsManager.on('user_camera_state', (data) => {
            if (this.activeCallChannelId) {
                this.handleDmRemoteCameraState(data.user_id, data.camera_on);
            }
        });
    }

    handleDmRemoteCameraState(userId, cameraOn) {
        const memberCard = document.querySelector(`#dm-voice-members-display [data-user-id="${userId}"]:not([data-screen-share])`);
        if (!memberCard) return;
        
        const videoContainer = memberCard.querySelector('.video-container');
        const voiceContent = memberCard.querySelector('.voice-member-content');
        const cameraIcon = memberCard.querySelector('.camera-icon');
        const videoElement = memberCard.querySelector('.user-video');
        
        if (cameraOn) {
            if (videoContainer) {
                videoContainer.classList.remove('hidden');
                videoContainer.style.display = 'block';
            }
            if (voiceContent) voiceContent.classList.add('hidden');
            
            // Try to get the stream from the hidden video element created by WebRTC
            if (videoElement && !videoElement.srcObject) {
                const remoteVideo = document.getElementById(`video-${userId}`);
                if (remoteVideo && remoteVideo.srcObject) {
                    videoElement.srcObject = remoteVideo.srcObject;
                    videoElement.play().catch(e => console.log('DM remote video play error:', e));
                }
            }
        } else {
            if (videoContainer) {
                videoContainer.classList.add('hidden');
                videoContainer.style.display = '';
            }
            if (voiceContent) voiceContent.classList.remove('hidden');
            if (videoElement) videoElement.srcObject = null;
        }
        
        if (cameraIcon) {
            cameraIcon.classList.toggle('hidden', !cameraOn);
        }
    }

    // ========================
    // UI Event Handlers
    // ========================

    setupUIHandlers() {
        // Home button (logo) - go back to server view
        document.getElementById('btn-home')?.addEventListener('click', () => {
            this.hideFriendsPanel();
        });

        // Friends button in server list
        document.getElementById('btn-friends')?.addEventListener('click', () => {
            this.showFriendsPanel();
        });

        // Add friend form
        document.getElementById('add-friend-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.sendFriendRequest();
        });

        // Tab switching in friends panel
        document.querySelectorAll('.friends-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.switchFriendsTab(tab.dataset.tab);
            });
        });

        // Friends list clicks
        document.getElementById('friends-list')?.addEventListener('click', (e) => {
            const friendItem = e.target.closest('.friend-item');
            if (!friendItem) return;

            const friendId = parseInt(friendItem.dataset.friendId);

            if (e.target.closest('.btn-dm-friend')) {
                this.openDmConversation(friendId);
            } else if (e.target.closest('.btn-call-friend')) {
                this.startVoiceCall(friendId, false);
            } else if (e.target.closest('.btn-video-call-friend')) {
                this.startVoiceCall(friendId, true);
            } else if (e.target.closest('.btn-remove-friend')) {
                this.removeFriend(friendId);
            }
        });

        // Pending requests list clicks
        document.getElementById('pending-requests-list')?.addEventListener('click', (e) => {
            const requestItem = e.target.closest('.request-item');
            if (!requestItem) return;

            const requestId = parseInt(requestItem.dataset.requestId);

            if (e.target.closest('.btn-accept-request')) {
                this.acceptFriendRequest(requestId);
            } else if (e.target.closest('.btn-decline-request')) {
                this.declineFriendRequest(requestId);
            } else if (e.target.closest('.btn-cancel-request')) {
                this.cancelFriendRequest(requestId);
            }
        });

        // DM conversation list clicks
        document.getElementById('dm-conversations-list')?.addEventListener('click', (e) => {
            const dmItem = e.target.closest('.dm-conversation-item');
            if (dmItem) {
                const channelId = parseInt(dmItem.dataset.channelId);
                const friendId = parseInt(dmItem.dataset.friendId);
                this.openDmChannel(channelId, friendId);
            }
        });

        // DM message form
        document.getElementById('dm-message-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.sendDmMessage();
        });

        // DM message input typing
        document.getElementById('dm-message-input')?.addEventListener('input', () => {
            this.handleDmTyping();
        });

        // DM call buttons
        document.getElementById('dm-call-btn')?.addEventListener('click', () => {
            this.startVoiceCall(this.currentDmFriendId, false);
        });

        document.getElementById('dm-video-call-btn')?.addEventListener('click', () => {
            this.startVoiceCall(this.currentDmFriendId, true);
        });

        // Incoming call modal buttons
        document.getElementById('accept-call-btn')?.addEventListener('click', () => {
            this.acceptIncomingCall();
        });

        document.getElementById('decline-call-btn')?.addEventListener('click', () => {
            this.declineIncomingCall();
        });

        // Back to server button
        document.getElementById('btn-back-to-server')?.addEventListener('click', () => {
            this.hideFriendsPanel();
        });

        // DM header call buttons
        document.getElementById('dm-btn-voice-call')?.addEventListener('click', () => {
            if (this.currentDmFriendId) {
                this.startVoiceCall(this.currentDmFriendId, false);
            }
        });

        document.getElementById('dm-btn-video-call')?.addEventListener('click', () => {
            if (this.currentDmFriendId) {
                this.startVoiceCall(this.currentDmFriendId, true);
            }
        });

        // DM Voice Controls
        document.getElementById('dm-voice-btn-mute')?.addEventListener('click', () => {
            this.app.toggleMute();
            this.updateDmMuteUI();
        });

        document.getElementById('dm-voice-btn-deafen')?.addEventListener('click', () => {
            this.app.toggleDeafen();
            this.updateDmDeafenUI();
        });

        document.getElementById('dm-voice-btn-camera')?.addEventListener('click', () => {
            this.toggleDmCamera();
        });

        document.getElementById('dm-voice-btn-screenshare')?.addEventListener('click', () => {
            this.toggleDmScreenShare();
        });

        document.getElementById('dm-voice-btn-disconnect')?.addEventListener('click', () => {
            this.leaveCall();
        });
    }

    updateDmMuteUI() {
        const btn = document.getElementById('dm-voice-btn-mute');
        const icon = btn?.querySelector('.material-icons');
        if (icon) {
            const isMuted = this.webrtcManager?.isMuted;
            icon.textContent = isMuted ? 'mic_off' : 'mic';
            btn.classList.toggle('bg-resonance-danger', isMuted);
            btn.classList.toggle('bg-resonance-bg-secondary', !isMuted);
        }
    }

    updateDmDeafenUI() {
        const btn = document.getElementById('dm-voice-btn-deafen');
        const icon = btn?.querySelector('.material-icons');
        if (icon) {
            const isDeafened = this.webrtcManager?.isDeafened;
            icon.textContent = isDeafened ? 'headset_off' : 'headphones';
            btn.classList.toggle('bg-resonance-danger', isDeafened);
            btn.classList.toggle('bg-resonance-bg-secondary', !isDeafened);
        }
    }

    async toggleDmCamera() {
        try {
            const isCameraOn = await this.webrtcManager.toggleCamera();
            const btn = document.getElementById('dm-voice-btn-camera');
            const icon = btn?.querySelector('.material-icons');
            if (icon) {
                icon.textContent = isCameraOn ? 'videocam' : 'videocam_off';
                btn.classList.toggle('bg-resonance-success', isCameraOn);
                btn.classList.toggle('bg-resonance-bg-secondary', !isCameraOn);
            }
            
            // Update video display for self
            this.updateDmVideoDisplay(window.APP_CONFIG.userId, isCameraOn);
        } catch (error) {
            console.error('Error toggling camera:', error);
            this.app.showNotification('Failed to access camera', 'error');
        }
    }

    async toggleDmScreenShare() {
        try {
            const isSharing = await this.webrtcManager.toggleScreenShare();
            const btn = document.getElementById('dm-voice-btn-screenshare');
            const icon = btn?.querySelector('.material-icons');
            if (icon) {
                icon.textContent = isSharing ? 'stop_screen_share' : 'screen_share';
                btn.classList.toggle('bg-resonance-success', isSharing);
                btn.classList.toggle('bg-resonance-bg-secondary', !isSharing);
            }
        } catch (error) {
            console.error('Error toggling screen share:', error);
            this.app.showNotification('Failed to share screen', 'error');
        }
    }

    updateDmVideoDisplay(userId, cameraOn) {
        const memberCard = document.querySelector(`#dm-voice-members-display [data-user-id="${userId}"]`);
        if (!memberCard) return;
        
        const videoContainer = memberCard.querySelector('.video-container');
        const voiceContent = memberCard.querySelector('.voice-member-content');
        const videoElement = memberCard.querySelector('.user-video');
        const cameraIcon = memberCard.querySelector('.camera-icon');
        
        if (cameraOn && userId == window.APP_CONFIG.userId && this.webrtcManager?.localVideoStream) {
            // Show my video
            if (videoContainer) {
                videoContainer.classList.remove('hidden');
                videoContainer.style.display = 'block';
            }
            if (voiceContent) voiceContent.classList.add('hidden');
            if (videoElement) {
                videoElement.srcObject = this.webrtcManager.localVideoStream;
                videoElement.classList.add('local-video-mirror');
            }
        } else if (!cameraOn) {
            // Hide video, show avatar
            if (videoContainer) {
                videoContainer.classList.add('hidden');
                videoContainer.style.display = '';
            }
            if (voiceContent) voiceContent.classList.remove('hidden');
            if (videoElement) videoElement.srcObject = null;
        }
        
        if (cameraIcon) {
            cameraIcon.classList.toggle('hidden', !cameraOn);
        }
    }

    // ========================
    // API Methods
    // ========================

    async loadFriends() {
        try {
            const response = await fetch('/api/friends', {
                headers: { 'X-CSRF-Token': this.app.csrfToken }
            });
            const data = await response.json();
            if (data.success) {
                this.friends = data.friends || [];
                this.renderFriendsList();
            }
        } catch (error) {
            console.error('Failed to load friends:', error);
        }
    }

    async loadPendingRequests() {
        try {
            const response = await fetch('/api/friends/pending', {
                headers: { 'X-CSRF-Token': this.app.csrfToken }
            });
            const data = await response.json();
            if (data.success) {
                this.pendingRequests = data;
                this.renderPendingRequests();
                this.updatePendingBadge();
            }
        } catch (error) {
            console.error('Failed to load pending requests:', error);
        }
    }

    async loadConversations() {
        try {
            const response = await fetch('/api/dm/conversations', {
                headers: { 'X-CSRF-Token': this.app.csrfToken }
            });
            const data = await response.json();
            if (data.success) {
                this.conversations = data.conversations || [];
                this.renderConversationsList();
            }
        } catch (error) {
            console.error('Failed to load conversations:', error);
        }
    }

    async sendFriendRequest() {
        const input = document.getElementById('add-friend-username');
        const username = input?.value?.trim();

        if (!username) {
            this.app.showNotification('Please enter a username', 'error');
            return;
        }

        try {
            const response = await fetch('/api/friends/request', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.app.csrfToken
                },
                body: JSON.stringify({ username })
            });

            const data = await response.json();

            if (data.success) {
                this.app.showNotification('Friend request sent!', 'success');
                input.value = '';
                
                // Notify target via WebSocket
                if (data.request_id && data.target_user_id) {
                    this.wsManager.send({
                        type: 'friend_request',
                        request_id: data.request_id,
                        target_user_id: data.target_user_id
                    });
                }
                
                await this.loadPendingRequests();
            } else {
                this.app.showNotification(data.error || 'Failed to send request', 'error');
            }
        } catch (error) {
            console.error('Failed to send friend request:', error);
            this.app.showNotification('Failed to send friend request', 'error');
        }
    }

    async acceptFriendRequest(requestId) {
        try {
            const response = await fetch(`/api/friends/request/${requestId}/accept`, {
                method: 'POST',
                headers: { 'X-CSRF-Token': this.app.csrfToken }
            });

            const data = await response.json();

            if (data.success) {
                this.app.showNotification('Friend request accepted!', 'success');
                
                // Notify original sender via WebSocket
                this.wsManager.send({
                    type: 'friend_request_response',
                    target_user_id: data.friend?.id,
                    accepted: true,
                    dm_channel_id: data.dm_channel_id,
                    voice_channel_id: data.voice_channel_id
                });

                await this.loadFriends();
                await this.loadPendingRequests();
                await this.loadConversations();
            } else {
                this.app.showNotification(data.error || 'Failed to accept request', 'error');
            }
        } catch (error) {
            console.error('Failed to accept friend request:', error);
        }
    }

    async declineFriendRequest(requestId) {
        try {
            const response = await fetch(`/api/friends/request/${requestId}/decline`, {
                method: 'POST',
                headers: { 'X-CSRF-Token': this.app.csrfToken }
            });

            const data = await response.json();

            if (data.success) {
                this.app.showNotification('Friend request declined', 'success');
                await this.loadPendingRequests();
            } else {
                this.app.showNotification(data.error || 'Failed to decline request', 'error');
            }
        } catch (error) {
            console.error('Failed to decline friend request:', error);
        }
    }

    async cancelFriendRequest(requestId) {
        try {
            const response = await fetch(`/api/friends/request/${requestId}`, {
                method: 'DELETE',
                headers: { 'X-CSRF-Token': this.app.csrfToken }
            });

            const data = await response.json();

            if (data.success) {
                this.app.showNotification('Friend request cancelled', 'success');
                await this.loadPendingRequests();
            } else {
                this.app.showNotification(data.error || 'Failed to cancel request', 'error');
            }
        } catch (error) {
            console.error('Failed to cancel friend request:', error);
        }
    }

    async removeFriend(friendId) {
        if (!confirm('Are you sure you want to remove this friend?')) {
            return;
        }

        try {
            const response = await fetch(`/api/friends/${friendId}`, {
                method: 'DELETE',
                headers: { 'X-CSRF-Token': this.app.csrfToken }
            });

            const data = await response.json();

            if (data.success) {
                this.app.showNotification('Friend removed', 'success');
                await this.loadFriends();
                await this.loadConversations();
            } else {
                this.app.showNotification(data.error || 'Failed to remove friend', 'error');
            }
        } catch (error) {
            console.error('Failed to remove friend:', error);
        }
    }

    // ========================
    // DM Methods
    // ========================

    async openDmConversation(friendId) {
        try {
            const response = await fetch(`/api/friends/${friendId}/dm`, {
                headers: { 'X-CSRF-Token': this.app.csrfToken }
            });

            const data = await response.json();

            if (data.success) {
                // Ensure we're in friends view
                document.getElementById('server-view')?.classList.add('hidden');
                document.getElementById('friends-view')?.classList.remove('hidden');
                document.getElementById('btn-home')?.classList.remove('active');
                document.getElementById('btn-friends')?.classList.add('active');
                
                this.openDmChannel(data.dm_channel_id, friendId);
            } else {
                this.app.showNotification(data.error || 'Failed to open DM', 'error');
            }
        } catch (error) {
            console.error('Failed to open DM conversation:', error);
        }
    }

    async openDmChannel(channelId, friendId) {
        // Leave current DM channel if any
        if (this.currentDmChannelId && this.currentDmChannelId !== channelId) {
            this.wsManager.send({ type: 'leave_dm', channel_id: this.currentDmChannelId });
        }

        this.currentDmChannelId = channelId;
        this.currentDmFriendId = friendId;

        // Join DM channel for real-time updates
        this.wsManager.send({ type: 'join_dm', channel_id: channelId });

        // Load messages
        await this.loadDmMessages(channelId);

        // Show DM view
        this.showDmView(friendId);

        // Update active state in conversation list
        document.querySelectorAll('.dm-conversation-item').forEach(item => {
            item.classList.toggle('active', parseInt(item.dataset.channelId) === channelId);
        });
    }

    async loadDmMessages(channelId) {
        try {
            const response = await fetch(`/api/dm/${channelId}/messages`, {
                headers: { 'X-CSRF-Token': this.app.csrfToken }
            });

            const data = await response.json();

            if (data.success) {
                this.renderDmMessages(data.messages || []);
            }
        } catch (error) {
            console.error('Failed to load DM messages:', error);
        }
    }

    async sendDmMessage() {
        const input = document.getElementById('dm-message-input');
        const content = input?.value?.trim();

        if (!content || !this.currentDmChannelId) {
            return;
        }

        // Clear input immediately
        input.value = '';

        // Send via WebSocket
        this.wsManager.send({
            type: 'dm_message',
            channel_id: this.currentDmChannelId,
            content: content
        });
    }

    handleDmTyping() {
        if (this.dmTypingTimeout) {
            clearTimeout(this.dmTypingTimeout);
        }

        this.wsManager.send({
            type: 'dm_typing',
            channel_id: this.currentDmChannelId
        });

        this.dmTypingTimeout = setTimeout(() => {
            this.dmTypingTimeout = null;
        }, 3000);
    }

    handleDmMessage(data) {
        if (data.channel_id !== this.currentDmChannelId) {
            // Show notification for messages in other conversations
            this.app.showNotification(`New message from ${data.message?.username || 'someone'}`, 'info');
            
            // Update unread indicator
            const convItem = document.querySelector(`.dm-conversation-item[data-channel-id="${data.channel_id}"]`);
            if (convItem) {
                convItem.classList.add('has-unread');
            }
            return;
        }

        // Add message to current view
        this.appendDmMessage(data.message);
    }

    showDmTypingIndicator(username) {
        const indicator = document.getElementById('dm-typing-indicator');
        if (indicator) {
            indicator.textContent = `${username} is typing...`;
            indicator.style.display = 'block';

            clearTimeout(this.dmTypingHideTimeout);
            this.dmTypingHideTimeout = setTimeout(() => {
                indicator.style.display = 'none';
            }, 3000);
        }
    }

    // ========================
    // Voice/Video Call Methods
    // ========================

    async startVoiceCall(friendId, withVideo = false) {
        if (!friendId) return;

        try {
            // Get voice channel for this friend
            const response = await fetch(`/api/dm/voice/${friendId}`, {
                headers: { 'X-CSRF-Token': this.app.csrfToken }
            });

            const data = await response.json();
            console.log('Voice channel response:', data);

            if (!data.success || !data.voice_channel_id) {
                console.error('Voice channel error:', data);
                this.app.showNotification(data.error || 'Failed to get voice channel', 'error');
                return;
            }

            // Store call state
            this.activeCallChannelId = data.voice_channel_id;
            this.activeCallFriendId = friendId;
            this.activeCallHasVideo = withVideo;

            // Switch to friends view and open DM conversation FIRST
            await this.openDmConversation(friendId);
            
            // Show call area
            this.showDmCallArea();

            // Leave any existing voice channel
            if (this.app.currentVoiceChannelId) {
                await this.app.leaveVoiceChannel();
            }

            // Send call invite via WebSocket
            this.wsManager.send({
                type: 'dm_call_invite',
                target_user_id: friendId,
                voice_channel_id: data.voice_channel_id,
                has_video: withVideo
            });

            // Join the DM voice channel using the same method as server voice
            this.wsManager.send({
                type: 'join_dm_voice',
                channel_id: data.voice_channel_id,
                target_user_id: friendId
            });

            // Use WebRTC manager to join (same as server voice)
            await this.webrtcManager.getLocalStream();
            this.webrtcManager.currentVoiceChannel = data.voice_channel_id;

            // If video call, start camera
            if (withVideo) {
                await this.webrtcManager.startCamera();
            }

            // Start voice activity detection
            if (this.webrtcManager.analyser) {
                this.webrtcManager.startVoiceActivityDetection();
            }

            this.app.showNotification('Calling...', 'info');

        } catch (error) {
            console.error('Failed to start call:', error);
            this.app.showNotification('Failed to start call: ' + error.message, 'error');
            this.activeCallChannelId = null;
            this.activeCallFriendId = null;
        }
    }

    handleIncomingCall(data) {
        this.incomingCall = data;

        // Show incoming call modal
        const modal = document.getElementById('incoming-call-modal');
        const callerName = document.getElementById('incoming-caller-name');
        const callType = document.getElementById('incoming-call-type');

        if (modal && callerName) {
            callerName.textContent = data.from_user?.username || 'Unknown';
            if (callType) {
                callType.textContent = data.has_video ? 'Video Call' : 'Voice Call';
            }
            modal.classList.remove('hidden');

            // Auto-decline after 30 seconds
            this.callTimeout = setTimeout(() => {
                this.declineIncomingCall();
            }, 30000);
        }
    }

    async acceptIncomingCall() {
        if (!this.incomingCall) return;

        clearTimeout(this.callTimeout);

        const modal = document.getElementById('incoming-call-modal');
        if (modal) modal.classList.add('hidden');

        const callData = this.incomingCall;
        this.incomingCall = null;

        try {
            // Store call state
            this.activeCallChannelId = callData.voice_channel_id;
            this.activeCallFriendId = callData.from_user?.id;
            this.activeCallHasVideo = callData.has_video;

            // Switch to friends view and open DM conversation with caller FIRST
            await this.openDmConversation(callData.from_user?.id);
            
            // Show call area
            this.showDmCallArea();

            // Leave any existing server voice channel
            if (this.app.currentVoiceChannelId) {
                await this.app.leaveVoiceChannel();
            }

            // Send acceptance via WebSocket
            this.wsManager.send({
                type: 'dm_call_response',
                target_user_id: callData.from_user?.id,
                accepted: true,
                voice_channel_id: callData.voice_channel_id
            });

            // Join DM voice channel
            this.wsManager.send({
                type: 'join_dm_voice',
                channel_id: callData.voice_channel_id,
                target_user_id: callData.from_user?.id
            });

            // Use WebRTC manager to join (same as server voice)
            await this.webrtcManager.getLocalStream();
            this.webrtcManager.currentVoiceChannel = callData.voice_channel_id;

            // If video call, start camera
            if (callData.has_video) {
                await this.webrtcManager.startCamera();
            }

            // Start voice activity detection
            if (this.webrtcManager.analyser) {
                this.webrtcManager.startVoiceActivityDetection();
            }

        } catch (error) {
            console.error('Failed to accept call:', error);
            this.app.showNotification('Failed to join call: ' + error.message, 'error');
            this.leaveCall();
        }
    }

    declineIncomingCall() {
        if (!this.incomingCall) return;

        clearTimeout(this.callTimeout);

        const modal = document.getElementById('incoming-call-modal');
        if (modal) modal.classList.add('hidden');

        // Send decline via WebSocket
        this.wsManager.send({
            type: 'dm_call_response',
            target_user_id: this.incomingCall.from_user?.id,
            accepted: false,
            voice_channel_id: this.incomingCall.voice_channel_id
        });

        this.incomingCall = null;
    }

    handleCallAccepted(data) {
        this.app.showNotification(`${data.by_user?.username || 'User'} accepted your call`, 'success');
    }

    handleCallDeclined(data) {
        this.app.showNotification(`${data.by_user?.username || 'User'} declined your call`, 'info');
        this.endCallCompletely();
    }

    /**
     * Leave the call but keep UI visible if other participant is still in
     */
    leaveCall() {
        // Clear any pending call end timeout
        if (this.callEndTimeout) {
            clearTimeout(this.callEndTimeout);
            this.callEndTimeout = null;
        }
        
        // Leave voice channel (WebRTC + WebSocket)
        this.wsManager.leaveVoice();
        this.webrtcManager.leaveVoiceChannel();
        
        // Remove ourselves from the display
        const myUserId = window.APP_CONFIG?.userId;
        if (myUserId) {
            this.removeDmVoiceMember(myUserId);
        }
        
        // DON'T hide the call area or reset state!
        // The call is still active, we just left it
        // User can rejoin by clicking call button again
    }

    /**
     * End call completely - hide UI and reset all state
     * Only called when call is truly over (both left or declined)
     */
    endCallCompletely() {
        // Clear any pending call end timeout
        if (this.callEndTimeout) {
            clearTimeout(this.callEndTimeout);
            this.callEndTimeout = null;
        }
        
        // Leave voice channel
        this.wsManager.leaveVoice();
        this.webrtcManager.leaveVoiceChannel();
        
        this.activeCallChannelId = null;
        this.activeCallFriendId = null;
        this.activeCallHasVideo = false;

        // Hide DM call area
        this.hideDmCallArea();
    }

    /**
     * @deprecated Use leaveCall() or endCallCompletely() instead
     */
    endCall() {
        this.leaveCall();
    }

    // ========================
    // DM Call UI Methods
    // ========================

    showDmCallArea() {
        const callArea = document.getElementById('dm-call-area');
        if (callArea) {
            callArea.classList.remove('hidden');
            // Restore saved height
            const savedHeight = localStorage.getItem('dm-call-area-height');
            if (savedHeight) {
                callArea.style.height = savedHeight;
            } else {
                callArea.style.height = '300px'; // Default height
            }
        }
    }

    hideDmCallArea() {
        const callArea = document.getElementById('dm-call-area');
        if (callArea) {
            callArea.classList.add('hidden');
        }
        
        // Clear voice members display
        const voiceDisplay = document.getElementById('dm-voice-members-display');
        if (voiceDisplay) {
            voiceDisplay.innerHTML = '';
        }
    }

    addDmVoiceMember(userId, username, avatar) {
        const voiceDisplay = document.getElementById('dm-voice-members-display');
        if (!voiceDisplay) return;
        
        // Check if member already exists
        if (voiceDisplay.querySelector(`[data-user-id="${userId}"]`)) return;
        
        const memberCard = document.createElement('div');
        memberCard.className = 'voice-member-card';
        memberCard.dataset.userId = userId;
        
        const avatarHtml = avatar 
            ? `<img src="${avatar}" class="avatar-img" alt="">`
            : `<div class="avatar-placeholder">${(username || '?').charAt(0).toUpperCase()}</div>`;
        
        memberCard.innerHTML = `
            <!-- Video Container (hidden by default) -->
            <div class="video-container hidden">
                <video class="user-video" autoplay playsinline muted></video>
            </div>
            
            <!-- Avatar Container -->
            <div class="voice-member-content">
                <div class="avatar-container">
                    <div class="voice-member-avatar">
                        ${avatarHtml}
                        <div class="speaking-ring"></div>
                    </div>
                </div>
            </div>
            
            <!-- User Info Overlay (always visible at bottom) -->
            <div class="user-info-overlay">
                <span class="username">${username}</span>
                <div class="status-icons">
                    <span class="material-icons muted-icon hidden" title="Muted">mic_off</span>
                    <span class="material-icons camera-icon hidden" title="Camera On">videocam</span>
                </div>
            </div>
        `;
        
        voiceDisplay.appendChild(memberCard);
        
        // Update grid layout
        this.updateDmVoiceGridLayout();
        
        // If this is me and camera is already on, show video immediately
        if (userId == window.APP_CONFIG.userId && this.webrtcManager?.isCameraOn && this.webrtcManager?.localVideoStream) {
            this.updateDmVideoDisplay(userId, true);
        }
    }

    updateDmVoiceGridLayout() {
        const voiceDisplay = document.getElementById('dm-voice-members-display');
        if (voiceDisplay) {
            const count = voiceDisplay.querySelectorAll('.voice-member-card').length;
            voiceDisplay.dataset.count = count;
            voiceDisplay.className = 'voice-grid flex flex-wrap justify-center gap-4';
        }
    }

    removeDmVoiceMember(userId) {
        const memberCard = document.querySelector(`#dm-voice-members-display [data-user-id="${userId}"]`);
        if (memberCard) {
            memberCard.remove();
            this.updateDmVoiceGridLayout();
        }
    }

    updateDmSpeakingIndicator(userId, speaking) {
        const memberCard = document.querySelector(`#dm-voice-members-display [data-user-id="${userId}"]`);
        if (!memberCard) return;
        
        const ring = memberCard.querySelector('.speaking-ring');
        const avatar = memberCard.querySelector('.avatar-img, .avatar-placeholder');
        
        if (ring) {
            ring.classList.toggle('active', speaking);
        }
        if (avatar) {
            avatar.style.borderColor = speaking ? 'rgb(87, 242, 135)' : 'transparent';
        }
    }

    onDmVoiceJoined(data) {
        console.log('DM voice joined:', data);
        
        // Show DM call area (stay in friends view with chat visible)
        this.showDmCallArea();
        
        // Add myself to voice members
        this.addDmVoiceMember(
            window.APP_CONFIG.userId,
            window.APP_CONFIG.username,
            window.APP_CONFIG.avatar
        );
        
        // Create WebRTC connections to existing members
        if (data.members) {
            data.members.forEach(async (member) => {
                // Add member to UI
                this.addDmVoiceMember(
                    member.id || member.user_id,
                    member.username,
                    member.avatar
                );
                
                // Create peer connection
                await this.webrtcManager.createPeerConnection(member.id || member.user_id, true);
            });
        }
    }

    onDmVoiceUserJoined(data) {
        console.log('DM voice user joined:', data);
        
        // Cancel any pending call end timeout - the user rejoined
        if (this.callEndTimeout) {
            clearTimeout(this.callEndTimeout);
            this.callEndTimeout = null;
            this.app.showNotification('Participant rejoined the call', 'success');
        }
        
        // Add to DM voice UI
        const user = data.user || data;
        this.addDmVoiceMember(
            user.id || user.user_id,
            user.username,
            user.avatar
        );
    }

    onDmVoiceUserLeft(data) {
        console.log('DM voice user left:', data);
        
        // Remove from DM voice UI
        const userId = data.user_id || data.user?.id;
        this.removeDmVoiceMember(userId);
        
        // Don't end call immediately - start a timeout
        // The other person left, but they might rejoin
        const timeoutSeconds = window.APP_CONFIG.dmCallTimeout || 120;
        
        this.app.showNotification(`The other participant left. Call will end in ${Math.floor(timeoutSeconds / 60)} minute(s) if they don't rejoin.`, 'warning');
        
        // Clear any existing timeout
        if (this.callEndTimeout) {
            clearTimeout(this.callEndTimeout);
        }
        
        // Set timeout to end call
        this.callEndTimeout = setTimeout(() => {
            if (this.activeCallChannelId) {
                this.app.showNotification('Call ended - timeout reached', 'info');
                this.endCallCompletely();
            }
        }, timeoutSeconds * 1000);
    }

    // ========================
    // Render Methods
    // ========================

    renderFriendsList() {
        const list = document.getElementById('friends-list');
        if (!list) return;

        if (this.friends.length === 0) {
            list.innerHTML = `
                <div class="empty-state text-center py-8">
                    <span class="material-icons text-4xl text-resonance-text-muted">person_off</span>
                    <p class="text-resonance-text-muted mt-2">No friends yet</p>
                </div>
            `;
            return;
        }

        list.innerHTML = this.friends.map(friend => `
            <div class="friend-item flex items-center justify-between p-3 rounded-lg hover:bg-resonance-bg-hover cursor-pointer" data-friend-id="${friend.friend_id}">
                <div class="flex items-center gap-3">
                    <div class="relative">
                        ${friend.avatar 
                            ? `<img src="${friend.avatar}" class="w-10 h-10 rounded-full object-cover" alt="">`
                            : `<div class="w-10 h-10 rounded-full bg-resonance-brand flex items-center justify-center text-white font-medium">${(friend.username || '?').charAt(0).toUpperCase()}</div>`
                        }
                        <span class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-resonance-bg-secondary ${friend.is_online ? 'bg-resonance-success' : 'bg-resonance-text-muted'}"></span>
                    </div>
                    <div>
                        <div class="font-medium text-resonance-text">${friend.display_name || friend.username}</div>
                        <div class="text-xs text-resonance-text-muted">${friend.is_online ? 'Online' : 'Offline'}</div>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <button class="btn-dm-friend p-2 rounded-lg hover:bg-resonance-bg-tertiary" title="Message">
                        <span class="material-icons text-xl text-resonance-text-secondary">chat</span>
                    </button>
                    <button class="btn-call-friend p-2 rounded-lg hover:bg-resonance-bg-tertiary" title="Voice Call">
                        <span class="material-icons text-xl text-resonance-text-secondary">call</span>
                    </button>
                    <button class="btn-video-call-friend p-2 rounded-lg hover:bg-resonance-bg-tertiary" title="Video Call">
                        <span class="material-icons text-xl text-resonance-text-secondary">videocam</span>
                    </button>
                    <button class="btn-remove-friend p-2 rounded-lg hover:bg-resonance-bg-tertiary" title="Remove Friend">
                        <span class="material-icons text-xl text-resonance-danger">person_remove</span>
                    </button>
                </div>
            </div>
        `).join('');
    }

    renderPendingRequests() {
        const list = document.getElementById('pending-requests-list');
        if (!list) return;

        const incoming = this.pendingRequests.incoming || [];
        const outgoing = this.pendingRequests.outgoing || [];

        if (incoming.length === 0 && outgoing.length === 0) {
            list.innerHTML = `
                <div class="empty-state text-center py-8">
                    <span class="material-icons text-4xl text-resonance-text-muted">mail_outline</span>
                    <p class="text-resonance-text-muted mt-2">No pending requests</p>
                </div>
            `;
            return;
        }

        let html = '';

        if (incoming.length > 0) {
            html += `<div class="text-xs font-medium text-resonance-text-muted uppercase mb-2">Incoming — ${incoming.length}</div>`;
            html += incoming.map(req => `
                <div class="request-item flex items-center justify-between p-3 rounded-lg hover:bg-resonance-bg-hover" data-request-id="${req.id}">
                    <div class="flex items-center gap-3">
                        ${req.avatar 
                            ? `<img src="${req.avatar}" class="w-10 h-10 rounded-full object-cover" alt="">`
                            : `<div class="w-10 h-10 rounded-full bg-resonance-brand flex items-center justify-center text-white font-medium">${(req.username || '?').charAt(0).toUpperCase()}</div>`
                        }
                        <div class="font-medium text-resonance-text">${req.username}</div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button class="btn-accept-request p-2 rounded-lg bg-resonance-success hover:bg-green-600" title="Accept">
                            <span class="material-icons text-white">check</span>
                        </button>
                        <button class="btn-decline-request p-2 rounded-lg bg-resonance-danger hover:bg-red-600" title="Decline">
                            <span class="material-icons text-white">close</span>
                        </button>
                    </div>
                </div>
            `).join('');
        }

        if (outgoing.length > 0) {
            html += `<div class="text-xs font-medium text-resonance-text-muted uppercase mb-2 mt-4">Outgoing — ${outgoing.length}</div>`;
            html += outgoing.map(req => `
                <div class="request-item flex items-center justify-between p-3 rounded-lg hover:bg-resonance-bg-hover" data-request-id="${req.id}">
                    <div class="flex items-center gap-3">
                        ${req.avatar 
                            ? `<img src="${req.avatar}" class="w-10 h-10 rounded-full object-cover" alt="">`
                            : `<div class="w-10 h-10 rounded-full bg-resonance-brand flex items-center justify-center text-white font-medium">${(req.username || '?').charAt(0).toUpperCase()}</div>`
                        }
                        <div class="font-medium text-resonance-text">${req.username}</div>
                    </div>
                    <button class="btn-cancel-request p-2 rounded-lg hover:bg-resonance-bg-tertiary" title="Cancel Request">
                        <span class="material-icons text-resonance-danger">close</span>
                    </button>
                </div>
            `).join('');
        }

        list.innerHTML = html;
    }

    renderConversationsList() {
        const list = document.getElementById('dm-conversations-list');
        if (!list) return;

        if (this.conversations.length === 0) {
            list.innerHTML = `
                <div class="empty-state text-center py-4">
                    <p class="text-resonance-text-muted text-sm">No conversations yet</p>
                </div>
            `;
            return;
        }

        list.innerHTML = this.conversations.map(conv => `
            <div class="dm-conversation-item flex items-center gap-3 p-2 rounded-lg hover:bg-resonance-bg-hover cursor-pointer ${conv.channel_id === this.currentDmChannelId ? 'active bg-resonance-bg-hover' : ''}" data-channel-id="${conv.channel_id}" data-friend-id="${conv.friend_id}">
                <div class="relative">
                    ${conv.avatar 
                        ? `<img src="${conv.avatar}" class="w-8 h-8 rounded-full object-cover" alt="">`
                        : `<div class="w-8 h-8 rounded-full bg-resonance-brand flex items-center justify-center text-white text-sm font-medium">${(conv.username || '?').charAt(0).toUpperCase()}</div>`
                    }
                    <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-resonance-bg-secondary ${conv.is_online ? 'bg-resonance-success' : 'bg-resonance-text-muted'}"></span>
                </div>
                <span class="text-sm font-medium text-resonance-text truncate">${conv.display_name || conv.username}</span>
            </div>
        `).join('');
    }

    renderDmMessages(messages) {
        const container = document.getElementById('dm-messages-list');
        if (!container) return;

        if (messages.length === 0) {
            container.innerHTML = `
                <div class="empty-state text-center py-8">
                    <span class="material-icons text-4xl text-resonance-text-muted">chat_bubble_outline</span>
                    <p class="text-resonance-text-muted mt-2">Start the conversation!</p>
                </div>
            `;
            return;
        }

        container.innerHTML = messages.map(msg => this.createDmMessageHtml(msg)).join('');
        container.scrollTop = container.scrollHeight;
    }

    appendDmMessage(message) {
        const container = document.getElementById('dm-messages-list');
        if (!container) return;

        // Remove empty state if present
        const emptyState = container.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const msgHtml = this.createDmMessageHtml(message);
        container.insertAdjacentHTML('beforeend', msgHtml);
        container.scrollTop = container.scrollHeight;
    }

    createDmMessageHtml(msg) {
        const isOwn = msg.user_id == window.APP_CONFIG.userId;
        const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        return `
            <div class="message flex gap-3 p-2 hover:bg-resonance-bg-hover rounded ${isOwn ? 'flex-row-reverse' : ''}">
                <div class="flex-shrink-0">
                    ${msg.avatar 
                        ? `<img src="${msg.avatar}" class="w-10 h-10 rounded-full object-cover" alt="">`
                        : `<div class="w-10 h-10 rounded-full bg-resonance-brand flex items-center justify-center text-white font-medium">${(msg.username || '?').charAt(0).toUpperCase()}</div>`
                    }
                </div>
                <div class="flex-1 ${isOwn ? 'text-right' : ''}">
                    <div class="flex items-baseline gap-2 ${isOwn ? 'flex-row-reverse' : ''}">
                        <span class="font-medium text-resonance-text">${msg.display_name || msg.username}</span>
                        <span class="text-xs text-resonance-text-muted">${time}</span>
                    </div>
                    <div class="text-resonance-text-secondary mt-1">${this.escapeHtml(msg.content)}</div>
                </div>
            </div>
        `;
    }

    // ========================
    // UI State Methods
    // ========================

    showFriendsPanel() {
        // Hide server view
        document.getElementById('server-view')?.classList.add('hidden');
        // Show friends view
        document.getElementById('friends-view')?.classList.remove('hidden');
        // Update active state in server list
        document.getElementById('btn-home')?.classList.remove('active');
        document.getElementById('btn-friends')?.classList.add('active');
        
        // If there's an active DM call, show the DM content with call area
        if (this.activeCallChannelId && this.currentDmChannelId && this.activeCallFriendId == this.currentDmFriendId) {
            document.getElementById('dm-content')?.classList.remove('hidden');
            document.getElementById('friends-content')?.classList.add('hidden');
            this.showDmCallArea();
        } else if (this.currentDmChannelId) {
            // We have a DM open
            document.getElementById('dm-content')?.classList.remove('hidden');
            document.getElementById('friends-content')?.classList.add('hidden');
            // Show call area if there's an active call with this friend
            if (this.activeCallChannelId && this.activeCallFriendId == this.currentDmFriendId) {
                this.showDmCallArea();
            }
            // Don't hide call area - it's hidden by default in HTML
        } else {
            // No DM open, show friends content
            document.getElementById('friends-content')?.classList.remove('hidden');
            document.getElementById('dm-content')?.classList.add('hidden');
        }
        
        // Reload data
        this.loadFriends();
        this.loadPendingRequests();
        this.loadConversations();
    }

    hideFriendsPanel() {
        // Show server view
        document.getElementById('server-view')?.classList.remove('hidden');
        // Hide friends view
        document.getElementById('friends-view')?.classList.add('hidden');
        // Update active state
        document.getElementById('btn-friends')?.classList.remove('active');
        document.getElementById('btn-home')?.classList.add('active');
        
        // Don't leave DM channel or end call - user can still receive messages
        // and call continues in background
    }

    showDmView(friendId) {
        const friend = this.friends.find(f => f.friend_id == friendId || f.id == friendId);
        
        // Update DM header name
        const headerName = document.getElementById('dm-header-name');
        if (headerName && friend) {
            headerName.textContent = friend.display_name || friend.username;
        }

        // Show DM content area
        document.getElementById('dm-content')?.classList.remove('hidden');
        document.getElementById('friends-content')?.classList.add('hidden');
        
        // If there's an active call with this friend, show call area
        // The call area stays hidden by default (HTML has hidden class)
        // and is only shown when explicitly called via showDmCallArea()
        if (this.activeCallChannelId && this.activeCallFriendId == friendId) {
            this.showDmCallArea();
        }
        // DO NOT hide call area here - it causes race conditions
    }

    switchFriendsTab(tab) {
        // Update tab buttons
        document.querySelectorAll('.friends-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tab);
        });

        // Show/hide content
        document.getElementById('friends-all-panel')?.classList.toggle('hidden', tab !== 'all');
        document.getElementById('friends-pending-panel')?.classList.toggle('hidden', tab !== 'pending');
        document.getElementById('friends-add-panel')?.classList.toggle('hidden', tab !== 'add');
        
        // Hide DM content, show friends content
        document.getElementById('dm-content')?.classList.add('hidden');
        document.getElementById('friends-content')?.classList.remove('hidden');
        
        // Reload data for specific tabs
        if (tab === 'all') {
            this.loadFriends();
        } else if (tab === 'pending') {
            this.loadPendingRequests();
        }
    }

    updatePendingBadge() {
        const count = (this.pendingRequests.incoming || []).length;
        
        // Update sidebar badge
        const sidebarBadge = document.getElementById('pending-requests-badge');
        if (sidebarBadge) {
            sidebarBadge.textContent = count;
            sidebarBadge.style.display = count > 0 ? 'flex' : 'none';
        }
        
        // Update tab badge
        const tabBadge = document.getElementById('pending-tab-badge');
        if (tabBadge) {
            tabBadge.textContent = count;
            tabBadge.style.display = count > 0 ? 'flex' : 'none';
        }
    }

    updateFriendStatus(userId, status) {
        const friend = this.friends.find(f => f.friend_id === userId);
        if (friend) {
            friend.is_online = status === 'online';
            this.renderFriendsList();
            this.renderConversationsList();
        }
    }

    handleFriendRequestReceived(data) {
        this.app.showNotification(`${data.from_user?.username || 'Someone'} sent you a friend request!`, 'info');
        this.loadPendingRequests();
    }

    handleFriendRequestAccepted(data) {
        this.app.showNotification(`${data.by_user?.username || 'Someone'} accepted your friend request!`, 'success');
        this.loadFriends();
        this.loadPendingRequests();
        this.loadConversations();
    }

    // ========================
    // Utility Methods
    // ========================

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Export for use
window.FriendsManager = FriendsManager;
