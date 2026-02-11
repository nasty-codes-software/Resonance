/**
 * Main Application Controller
 * Handles UI interactions, WebSocket events, and manages all features
 */
class App {
    constructor() {
        this.wsManager = null;
        this.webrtcManager = null;
        this.soundboardManager = null;
        this.friendsManager = null;
        this.currentChannelId = null;
        this.currentVoiceChannelId = null;
        this.typingTimeout = null;
        this.csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
        this.voicePreviewActive = false;

        this.init();
    }

    async init() {
        // Initialize WebSocket manager
        this.wsManager = new WebSocketManager(window.APP_CONFIG);
        this.wsManager.connect();

        // Initialize WebRTC manager
        this.webrtcManager = new WebRTCManager(this.wsManager);
        
        // Setup speaking indicator callback - THIS IS THE FIX
        this.webrtcManager.onSpeakingChange = (speaking) => {
            console.log('Speaking change detected:', speaking);
            // Update local UI immediately
            this.updateSpeakingIndicator(window.APP_CONFIG.userId, speaking);
            // Broadcast to other users via WebSocket
            if (this.wsManager && this.wsManager.isConnected) {
                this.wsManager.sendSpeaking(speaking);
            }
        };
        
        // Setup camera state callback
        this.webrtcManager.onCameraChange = (cameraOn) => {
            console.log('Camera state changed:', cameraOn);
            this.updateCameraUI(cameraOn);
            this.updateLocalVideoDisplay(cameraOn);
        };
        
        // Setup remote video callback
        this.webrtcManager.onRemoteVideoChange = (userId, hasVideo, videoElement) => {
            // Ignore events for own user - handled by onCameraChange
            if (userId == window.APP_CONFIG.userId) {
                console.log('Ignoring remote video change for self');
                return;
            }
            console.log('Remote video change:', userId, hasVideo);
            this.updateRemoteVideoDisplay(userId, hasVideo, videoElement);
        };

        // Setup screen share state callback (local user)
        this.webrtcManager.onScreenShareChange = (isSharing) => {
            console.log('Screen share state changed:', isSharing);
            this.updateScreenShareUI(isSharing);
            if (isSharing) {
                this.addScreenShareTile(window.APP_CONFIG.userId, window.APP_CONFIG.username, true);
            } else {
                this.removeScreenShareTile(window.APP_CONFIG.userId);
            }
        };

        // Setup remote screen share callback
        this.webrtcManager.onRemoteScreenShareChange = (userId, isSharing, videoElement) => {
            console.log('Remote screen share change:', userId, isSharing);
            // Skip if this is our own screen share state echoed back from the server
            if (userId === window.APP_CONFIG.userId) return;
            if (isSharing) {
                // Get username from existing member card
                const memberCard = document.querySelector(`#voice-members-display .voice-member-card[data-user-id="${userId}"]:not([data-screen-share])`);
                const username = memberCard?.querySelector('.username')?.textContent || 'User';
                this.addScreenShareTile(userId, username, false, videoElement);
            } else {
                this.removeScreenShareTile(userId);
            }
        };

        // Initialize Soundboard manager
        this.soundboardManager = new SoundboardManager(this.wsManager, this.webrtcManager);

        // Initialize Friends manager (after WebSocket is ready)
        this.wsManager.on('auth_success', () => {
            if (window.FriendsManager && !this.friendsManager) {
                this.friendsManager = new FriendsManager(this);
            }
        });

        // Setup event handlers
        this.setupWebSocketHandlers();
        this.setupUIHandlers();
        this.setupModalHandlers();
        this.setupSettingsHandlers();
        this.setupUserCardHandlers();

        // Join current channel if one is active
        const currentChannelId = document.getElementById('current-channel-id')?.value;
        if (currentChannelId) {
            this.currentChannelId = parseInt(currentChannelId);
            this.wsManager.on('auth_success', () => {
                this.wsManager.joinChannel(this.currentChannelId);
            });
        }

        // Scroll messages to bottom
        this.scrollMessagesToBottom();
        
        // Populate audio devices for settings
        this.populateAudioDevices();

        console.log('App initialized');
    }

    // ========================
    // WebSocket Event Handlers
    // ========================
    
    setupWebSocketHandlers() {
        this.wsManager.on('connected', () => {
            this.showNotification('Connected to server', 'success');
        });

        this.wsManager.on('disconnected', () => {
            this.showNotification('Disconnected from server', 'error');
        });

        this.wsManager.on('auth_success', (data) => {
            console.log('Authenticated as:', data.user.username);
        });

        // Chat events
        this.wsManager.on('new_message', (data) => {
            this.handleNewMessage(data.message);
        });

        this.wsManager.on('user_typing', (data) => {
            this.showTypingIndicator(data.username);
        });

        // User events
        this.wsManager.on('user_online', (data) => {
            this.addOnlineUser(data);
        });

        this.wsManager.on('user_offline', (data) => {
            this.removeOnlineUser(data.user_id);
        });

        // Voice events
        this.wsManager.on('voice_joined', (data) => {
            console.log('Voice joined:', data);
            
            // DM calls are handled by FriendsManager which calls our methods directly
            if (data.channel_type === 'dm') return;

            this.showVoiceConnectionPanel(data.channel_name);
            
            // Add myself to the voice members list
            this.addVoiceMember({
                channel_id: data.channel_id,
                user: {
                    id: window.APP_CONFIG.userId,
                    username: window.APP_CONFIG.username
                }
            });
            
            // Add existing members to UI
            if (data.members) {
                data.members.forEach(member => {
                    this.addVoiceMember({
                        channel_id: data.channel_id,
                        user: {
                            id: member.user_id || member.id,
                            username: member.username
                        }
                    });
                    
                    // If member is screen sharing, mark it so WebRTC knows
                    if (member.screen_sharing) {
                        this.webrtcManager.screenShareUsers.add(member.user_id || member.id);
                    }
                });
            }
        });
        
        this.wsManager.on('voice_left', (data) => {
            console.log('Voice left');
            this.hideVoiceConnectionPanel();
            
            // Remove myself from voice members list
            this.removeVoiceMember({ user_id: window.APP_CONFIG.userId });
        });

        this.wsManager.on('voice_state_update', (data) => {
            this.updateVoiceChannelUI(data);
        });
        
        this.wsManager.on('voice_user_joined', (data) => {
            if (data.channel_type === 'dm') return;
            this.addVoiceMember(data);
        });
        
        this.wsManager.on('voice_user_left', (data) => {
            if (data.channel_type === 'dm') return;
            this.removeVoiceMember(data);
        });
        
        // Handle being force disconnected from voice by another user
        this.wsManager.on('voice_force_disconnected', (data) => {
            this.showNotification(data.message || 'You have been disconnected from voice', 'warning');
            this.hideVoiceConnectionPanel();
            this.currentVoiceChannelId = null;
            this.removeVoiceMember({ user_id: window.APP_CONFIG.userId });
            this.showTextChannelView();
        });
        
        // Speaking indicator events - Listen for other users speaking
        this.wsManager.on('user_speaking', (data) => {
            console.log('User speaking event:', data);
            this.updateSpeakingIndicator(data.user_id, data.speaking);
        });
        
        // Camera state events - Listen for other users camera state
        this.wsManager.on('user_camera_state', (data) => {
            console.log('User camera state event:', data);
            this.updateRemoteCameraIndicator(data.user_id, data.camera_on);
        });
        
        // Screen share state events - Listen for other users screen share state
        this.wsManager.on('user_screen_share_state', (data) => {
            console.log('User screen share state event:', data);
            // WebRTC manager handles the actual track signaling;
            // this is just for the UI state notification
        });
    }

    // ========================
    // UI Event Handlers
    // ========================
    
    setupUIHandlers() {
        // Message form
        document.getElementById('message-form')?.addEventListener('submit', (e) => {
            this.handleSendMessage(e);
        });

        // Message input typing indicator
        document.getElementById('message-input')?.addEventListener('input', () => {
            this.handleTyping();
        });

        // Text channel clicks
        document.getElementById('channels-container')?.addEventListener('click', (e) => {
            const channelItem = e.target.closest('.channel-item.text-channel');
            if (channelItem && !e.target.closest('.channel-actions')) {
                const channelId = parseInt(channelItem.dataset.channelId);
                // Always show text view, even if same channel (might be in voice view)
                this.showTextChannelView();
                this.switchChannel(channelId);
            }
            
            // Voice channel header click
            const voiceHeader = e.target.closest('.voice-channel-header');
            if (voiceHeader && !e.target.closest('.channel-actions')) {
                this.joinVoiceChannel(parseInt(voiceHeader.dataset.channelId));
            }
            
            // Category toggle (click on header but not on action buttons)
            const categoryHeader = e.target.closest('.category-header');
            if (categoryHeader && !e.target.closest('.category-actions')) {
                const category = categoryHeader.closest('.category');
                category.classList.toggle('collapsed');
                const arrow = categoryHeader.querySelector('.category-arrow');
                if (arrow) {
                    arrow.textContent = category.classList.contains('collapsed') ? 'chevron_right' : 'expand_more';
                }
            }
            
            // Edit channel button
            const editChannelBtn = e.target.closest('.btn-edit-channel');
            if (editChannelBtn) {
                e.stopPropagation();
                const channelId = parseInt(editChannelBtn.dataset.channelId);
                const channelType = editChannelBtn.dataset.channelType;
                this.openEditChannelModal(channelId, channelType);
            }
            
            // Add channel to category
            const addChannelBtn = e.target.closest('.btn-add-channel');
            if (addChannelBtn) {
                e.stopPropagation();
                const categoryId = addChannelBtn.dataset.categoryId;
                document.getElementById('add-channel-category-id').value = categoryId;
                this.openModal('modal-add-channel');
            }
            
            // Edit category button
            const editCategoryBtn = e.target.closest('.btn-edit-category');
            if (editCategoryBtn) {
                e.stopPropagation();
                const categoryId = editCategoryBtn.dataset.categoryId;
                this.openEditCategoryModal(categoryId);
            }
        });

        // Soundboard clicks
        document.getElementById('soundboard')?.addEventListener('click', (e) => {
            const soundBtn = e.target.closest('.sound-btn');
            if (soundBtn) {
                this.playSound(parseInt(soundBtn.dataset.soundId));
            }
        });

        // Message actions (edit, delete, pin)
        document.getElementById('messages-list')?.addEventListener('click', (e) => {
            const message = e.target.closest('.message');
            if (!message) return;
            
            const messageId = message.dataset.messageId;
            const messageUserId = message.dataset.userId;
            
            if (e.target.closest('.btn-edit-message')) {
                // Only allow editing own messages
                if (messageUserId != window.APP_CONFIG.userId) {
                    this.showNotification('You can only edit your own messages', 'error');
                    return;
                }
                this.startEditMessage(messageId, message);
            } else if (e.target.closest('.btn-delete-message')) {
                this.deleteMessage(messageId, messageUserId);
            } else if (e.target.closest('.btn-pin-message')) {
                this.togglePinMessage(messageId);
            }
        });

        // Mute/Deafen/Settings buttons (sidebar)
        document.getElementById('btn-mute')?.addEventListener('click', () => this.toggleMute());
        document.getElementById('btn-deafen')?.addEventListener('click', () => this.toggleDeafen());
        document.getElementById('btn-settings')?.addEventListener('click', () => {
            this.openModal('modal-user-settings');
            this.startVoiceLevelPreview();
        });

        // Voice disconnect button (sidebar)
        document.getElementById('btn-disconnect-voice')?.addEventListener('click', () => {
            this.leaveVoiceChannel();
        });
        
        // Disconnect other members from voice (permission-based)
        document.addEventListener('click', (e) => {
            const disconnectBtn = e.target.closest('.btn-disconnect-member');
            if (disconnectBtn) {
                e.stopPropagation();
                
                // Check permission before even trying
                const canDisconnect = window.hasPermission('move_members') || window.hasPermission('administrator');
                if (!canDisconnect) {
                    this.showNotification('You do not have permission to disconnect members', 'error');
                    return;
                }
                
                const userId = disconnectBtn.dataset.userId;
                if (userId) {
                    this.disconnectVoiceMember(userId);
                }
            }
        });
        
        // Voice view controls
        document.getElementById('voice-btn-mute')?.addEventListener('click', () => this.toggleMute());
        document.getElementById('voice-btn-deafen')?.addEventListener('click', () => this.toggleDeafen());
        document.getElementById('voice-btn-camera')?.addEventListener('click', () => this.toggleCamera());
        document.getElementById('voice-btn-screenshare')?.addEventListener('click', () => this.toggleScreenShare());
        document.getElementById('voice-btn-soundboard')?.addEventListener('click', () => {
            document.getElementById('soundboard-panel')?.classList.toggle('hidden');
        });
        document.getElementById('voice-btn-disconnect')?.addEventListener('click', () => {
            this.leaveVoiceChannel();
        });
        
        // Spotlight exit button
        document.getElementById('btn-exit-spotlight')?.addEventListener('click', () => {
            this.closeSpotlight();
        });
        
        // Voice fullscreen toggle
        document.getElementById('btn-voice-fullscreen')?.addEventListener('click', () => {
            this.toggleVoiceFullscreen();
        });
        
        // Voice tile context menu
        this.setupVoiceTileContextMenu();
        
        // Channel header actions
        document.getElementById('btn-pinned-messages')?.addEventListener('click', () => this.togglePinnedMessages());
        document.getElementById('btn-toggle-members')?.addEventListener('click', () => this.toggleMembersSidebar());
        
        // Channel search
        const searchInput = document.getElementById('channel-search-input');
        let searchTimeout;
        searchInput?.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => this.searchMessages(e.target.value), 300);
        });
        searchInput?.addEventListener('focus', () => {
            document.getElementById('search-results-popup')?.classList.remove('hidden');
        });
        document.getElementById('close-search-results')?.addEventListener('click', () => {
            document.getElementById('search-results-popup')?.classList.add('hidden');
        });
        
        // File attachment
        document.getElementById('btn-attach-file')?.addEventListener('click', () => {
            document.getElementById('file-input')?.click();
        });
        document.getElementById('file-input')?.addEventListener('change', (e) => this.handleFileAttachment(e));
        
        // Clipboard paste for screenshots
        document.getElementById('message-input')?.addEventListener('paste', (e) => this.handlePaste(e));
        
        // Emoji picker
        document.getElementById('btn-emoji-picker')?.addEventListener('click', () => {
            document.getElementById('emoji-picker')?.classList.toggle('hidden');
        });
        document.getElementById('emoji-picker')?.addEventListener('click', (e) => {
            const emojiBtn = e.target.closest('.emoji-btn');
            if (emojiBtn) {
                const emoji = emojiBtn.dataset.emoji;
                const input = document.getElementById('message-input');
                if (input) {
                    input.value += emoji;
                    input.focus();
                }
                document.getElementById('emoji-picker')?.classList.add('hidden');
            }
        });
        
        // Close popups when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#emoji-picker') && !e.target.closest('#btn-emoji-picker')) {
                document.getElementById('emoji-picker')?.classList.add('hidden');
            }
            if (!e.target.closest('#pinned-messages-popup') && !e.target.closest('#btn-pinned-messages')) {
                document.getElementById('pinned-messages-popup')?.classList.add('hidden');
            }
            if (!e.target.closest('#search-results-popup') && !e.target.closest('#channel-search-input')) {
                document.getElementById('search-results-popup')?.classList.add('hidden');
            }
        });

        // Add category button
        document.getElementById('btn-add-category')?.addEventListener('click', () => {
            document.getElementById('edit-category-id').value = '';
            document.getElementById('category-name').value = '';
            document.getElementById('modal-category-title').textContent = 'Create Category';
            document.getElementById('btn-delete-category').style.display = 'none';
            this.openModal('modal-category');
        });

        // Upload sound button
        document.getElementById('btn-upload-sound')?.addEventListener('click', () => {
            this.openModal('modal-upload-sound');
        });
        
        // Channel type selection
        document.getElementById('btn-select-text-channel')?.addEventListener('click', () => {
            const categoryId = document.getElementById('add-channel-category-id').value;
            document.getElementById('text-channel-category-id').value = categoryId;
            document.getElementById('edit-text-channel-id').value = '';
            document.getElementById('text-channel-name').value = '';
            document.getElementById('text-channel-desc').value = '';
            document.getElementById('modal-text-channel-title').textContent = 'Create Text Channel';
            document.getElementById('btn-delete-text-channel').style.display = 'none';
            this.closeModal('modal-add-channel');
            this.openModal('modal-text-channel');
        });
        
        document.getElementById('btn-select-voice-channel')?.addEventListener('click', () => {
            const categoryId = document.getElementById('add-channel-category-id').value;
            document.getElementById('voice-channel-category-id').value = categoryId;
            document.getElementById('edit-voice-channel-id').value = '';
            document.getElementById('voice-channel-name').value = '';
            document.getElementById('voice-channel-limit').value = '0';
            document.getElementById('modal-voice-channel-title').textContent = 'Create Voice Channel';
            document.getElementById('btn-delete-voice-channel').style.display = 'none';
            this.closeModal('modal-add-channel');
            this.openModal('modal-voice-channel');
        });

        // Server settings button
        document.getElementById('btn-server-settings')?.addEventListener('click', () => {
            this.openServerSettings();
        });
    }

    // ========================
    // Modal Handlers
    // ========================
    
    setupModalHandlers() {
        // Close modals on overlay/close/cancel click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.querySelector('.modal-overlay')?.addEventListener('click', () => {
                this.closeModal(modal.id);
            });
            modal.querySelector('.modal-close')?.addEventListener('click', () => {
                this.closeModal(modal.id);
            });
            modal.querySelector('.modal-cancel')?.addEventListener('click', () => {
                this.closeModal(modal.id);
            });
        });

        // Category form
        document.getElementById('form-category')?.addEventListener('submit', (e) => {
            this.handleCategorySubmit(e);
        });
        
        document.getElementById('btn-delete-category')?.addEventListener('click', () => {
            this.handleDeleteCategory();
        });

        // Text channel form
        document.getElementById('form-text-channel')?.addEventListener('submit', (e) => {
            this.handleTextChannelSubmit(e);
        });
        
        document.getElementById('btn-delete-text-channel')?.addEventListener('click', () => {
            this.handleDeleteTextChannel();
        });

        // Voice channel form
        document.getElementById('form-voice-channel')?.addEventListener('submit', (e) => {
            this.handleVoiceChannelSubmit(e);
        });
        
        document.getElementById('btn-delete-voice-channel')?.addEventListener('click', () => {
            this.handleDeleteVoiceChannel();
        });

        // Upload sound form
        document.getElementById('form-upload-sound')?.addEventListener('submit', (e) => {
            this.handleUploadSound(e);
        });
    }

    // ========================
    // Settings Handlers
    // ========================
    
    setupSettingsHandlers() {
        // Settings tabs navigation
        document.querySelectorAll('.settings-nav-item[data-tab]').forEach(item => {
            item.addEventListener('click', () => {
                const tab = item.dataset.tab;
                
                // Update nav - remove active styling from all, add to clicked
                document.querySelectorAll('.settings-nav-item').forEach(i => {
                    i.classList.remove('bg-resonance-bg-selected', 'text-white');
                    i.classList.add('text-resonance-text-secondary');
                });
                item.classList.add('bg-resonance-bg-selected', 'text-white');
                item.classList.remove('text-resonance-text-secondary');
                
                // Update content - hide all tabs, show selected
                document.querySelectorAll('.settings-tab').forEach(t => t.classList.add('hidden'));
                document.getElementById(`tab-${tab}`)?.classList.remove('hidden');
                
                // Start voice preview on voice tab
                if (tab === 'voice') {
                    this.startVoiceLevelPreview();
                } else {
                    this.stopVoiceLevelPreview();
                }
            });
        });

        // Account form
        document.getElementById('form-user-account')?.addEventListener('submit', (e) => {
            this.handleAccountSubmit(e);
        });

        // Profile form
        document.getElementById('form-user-profile')?.addEventListener('submit', (e) => {
            this.handleProfileSubmit(e);
        });

        // Voice settings form
        document.getElementById('form-voice-settings')?.addEventListener('submit', (e) => {
            this.handleVoiceSettingsSubmit(e);
        });

        // Avatar upload
        document.getElementById('btn-change-avatar')?.addEventListener('click', () => {
            document.getElementById('avatar-input').click();
        });
        
        document.getElementById('avatar-input')?.addEventListener('change', (e) => {
            this.handleAvatarUpload(e.target.files[0]);
        });
        
        document.getElementById('btn-remove-avatar')?.addEventListener('click', () => {
            this.removeAvatar();
        });

        // Banner upload
        document.getElementById('btn-change-banner')?.addEventListener('click', () => {
            document.getElementById('banner-input').click();
        });
        
        document.getElementById('banner-input')?.addEventListener('change', (e) => {
            this.handleBannerUpload(e.target.files[0]);
        });
        
        document.getElementById('btn-remove-banner')?.addEventListener('click', () => {
            this.removeBanner();
        });

        // Banner color change
        document.getElementById('settings-banner-color')?.addEventListener('change', (e) => {
            document.getElementById('banner-preview').style.backgroundColor = e.target.value;
            document.getElementById('preview-banner').style.backgroundColor = e.target.value;
        });

        // Display name preview
        document.getElementById('settings-display-name')?.addEventListener('input', (e) => {
            document.getElementById('preview-displayname').textContent = e.target.value || 'Display Name';
        });
    }

    // ========================
    // User Card Handlers
    // ========================
    
    setupUserCardHandlers() {
        // Click on user avatars/names to show user card
        document.addEventListener('click', (e) => {
            const userElement = e.target.closest('.user-clickable');
            if (userElement) {
                e.stopPropagation();
                const userId = userElement.dataset.userId;
                this.showUserCard(userId, e.clientX, e.clientY);
            }
            
            // Close user card when clicking outside
            const userCard = document.getElementById('user-card');
            if (userCard && userCard.style.display !== 'none' && !e.target.closest('.user-card') && !e.target.closest('.user-clickable')) {
                userCard.style.display = 'none';
            }
        });
    }

    async showUserCard(userId, x, y) {
        try {
            const response = await fetch(`/api/user/${userId}/profile`);
            const data = await response.json();
            
            if (!data.user) return;
            
            const user = data.user;
            const card = document.getElementById('user-card');
            
            // Set banner
            const banner = document.getElementById('user-card-banner');
            if (user.banner) {
                banner.innerHTML = `<img src="${user.banner}" alt="Banner">`;
            } else {
                banner.innerHTML = '';
                banner.style.backgroundColor = user.banner_color || '#5865F2';
            }
            
            // Set avatar
            const avatar = document.getElementById('user-card-avatar');
            if (user.avatar) {
                avatar.innerHTML = `<img src="${user.avatar}" alt="Avatar">`;
            } else {
                avatar.innerHTML = user.username.charAt(0).toUpperCase();
            }
            
            // Set info
            document.getElementById('user-card-displayname').textContent = user.display_name || user.username;
            document.getElementById('user-card-username').textContent = user.username;
            document.getElementById('user-card-bio').textContent = user.bio || 'No bio set.';
            document.getElementById('user-card-joined').textContent = new Date(user.created_at).toLocaleDateString();
            
            // Set roles
            const rolesContainer = document.getElementById('user-card-roles');
            rolesContainer.innerHTML = '';
            if (user.roles && user.roles.length > 0) {
                user.roles.forEach(role => {
                    const roleEl = document.createElement('span');
                    roleEl.className = 'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border';
                    roleEl.style.backgroundColor = role.color + '20';
                    roleEl.style.borderColor = role.color;
                    roleEl.innerHTML = `<span class="w-2 h-2 rounded-full" style="background:${role.color}"></span>${role.name}`;
                    rolesContainer.appendChild(roleEl);
                });
            }
            
            // Position card
            card.style.left = Math.min(x, window.innerWidth - 320) + 'px';
            card.style.top = Math.min(y, window.innerHeight - 400) + 'px';
            card.style.display = 'block';
            
        } catch (error) {
            console.error('Error loading user card:', error);
        }
    }

    // ========================
    // Voice Channel Management
    // ========================
    
    async joinVoiceChannel(channelId) {
        try {
            // Leave current voice channel first
            if (this.currentVoiceChannelId) {
                await this.leaveVoiceChannel();
            }

            console.log('Joining voice channel:', channelId);
            await this.webrtcManager.joinVoiceChannel(channelId);
            this.currentVoiceChannelId = channelId;
            
            // Get channel name for display - use voice-channel-header selector
            const voiceChannelHeader = document.querySelector(`.voice-channel-header[data-channel-id="${channelId}"]`);
            const channelName = voiceChannelHeader?.querySelector('.channel-name')?.textContent || 'Voice Channel';
            this.showVoiceConnectionPanel(channelName);
            
            // Mark voice channel as active, remove active from text channels
            document.querySelectorAll('.channel-item').forEach(item => {
                item.classList.remove('active', 'bg-resonance-bg-selected', 'text-white');
            });
            document.querySelectorAll('.voice-channel-header').forEach(item => {
                const isActive = parseInt(item.dataset.channelId) === channelId;
                item.classList.toggle('active', isActive);
                item.classList.toggle('bg-resonance-bg-selected', isActive);
                item.classList.toggle('text-white', isActive);
            });
            
            // Switch to voice channel view
            this.showVoiceChannelView(channelName);
            
        } catch (error) {
            console.error('Error joining voice channel:', error);
            this.showNotification('Failed to join voice channel. Check microphone permissions.', 'error');
        }
    }

    async leaveVoiceChannel() {
        // Check for regular server voice channel OR DM call
        const isDmCall = this.friendsManager?.activeCallChannelId;
        
        if (!this.currentVoiceChannelId && !isDmCall) return;
        
        console.log('Leaving voice channel');
        
        // If it was a DM call, use FriendsManager's endCall
        if (isDmCall && this.friendsManager) {
            this.friendsManager.endCall();
            return;
        }
        
        // Server voice channel
        await this.webrtcManager.leaveVoiceChannel();
        this.currentVoiceChannelId = null;
        
        this.hideVoiceConnectionPanel();
        
        // Reset speaking indicator
        this.updateSpeakingIndicator(window.APP_CONFIG.userId, false);
        
        // Reset camera UI
        this.updateCameraUI(false);
        
        // Reset screen share UI
        this.updateScreenShareUI(false);
        
        // Exit voice fullscreen if active
        const container = document.querySelector('.flex.h-full');
        if (container?.classList.contains('voice-fullscreen-active')) {
            this.toggleVoiceFullscreen();
        }
        
        // Hide context menu
        document.getElementById('voice-tile-context-menu')?.classList.add('hidden');
        
        // Switch back to text channel view
        this.showTextChannelView();
    }

    async disconnectVoiceMember(userId) {
        if (!confirm('Disconnect this user from voice?')) return;
        
        try {
            const response = await fetch(`/api/voice/disconnect/${userId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.csrfToken
                }
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to disconnect user');
            }
            
            // Send WebSocket message to notify all clients (including the target user)
            this.wsManager.forceDisconnectVoice(userId);
            
            this.showNotification('User disconnected from voice', 'success');
        } catch (error) {
            console.error('Error disconnecting user:', error);
            this.showNotification(error.message, 'error');
        }
    }

    showVoiceChannelView(channelName) {
        // Update header
        document.getElementById('channel-header-icon').textContent = 'volume_up';
        document.getElementById('current-channel-name').textContent = channelName;
        
        // Hide text view, show voice view
        document.getElementById('text-channel-view')?.classList.add('hidden');
        document.getElementById('voice-channel-view')?.classList.remove('hidden');
        
        // Hide members sidebar (voice members are shown in main area)
        document.getElementById('members-sidebar')?.classList.add('hidden');
        
        // Clear and prepare voice members display
        const voiceDisplay = document.getElementById('voice-members-display');
        if (voiceDisplay) {
            voiceDisplay.innerHTML = '';
        }
    }

    showTextChannelView() {
        // Update header
        document.getElementById('channel-header-icon').textContent = 'tag';
        
        // Show text view, hide voice view
        document.getElementById('text-channel-view')?.classList.remove('hidden');
        document.getElementById('voice-channel-view')?.classList.add('hidden');
        
        // Show members sidebar
        document.getElementById('members-sidebar')?.classList.remove('hidden');
        
        // Hide soundboard panel if open
        document.getElementById('soundboard-panel')?.classList.add('hidden');
    }

    showVoiceConnectionPanel(channelName) {
        const panel = document.getElementById('voice-connection-panel');
        if (panel) {
            panel.classList.remove('hidden');
            document.getElementById('connected-voice-channel').textContent = channelName;
        }
    }

    hideVoiceConnectionPanel() {
        const panel = document.getElementById('voice-connection-panel');
        if (panel) {
            panel.classList.add('hidden');
        }
    }

    addVoiceMember(data) {
        const channelId = data.channel_id;
        
        // Check if user can disconnect members
        const canDisconnect = window.hasPermission('move_members') || window.hasPermission('administrator');
        
        // Add to sidebar list
        const sidebarContainer = document.getElementById(`voice-members-${channelId}`);
        if (sidebarContainer && !sidebarContainer.querySelector(`[data-user-id="${data.user.id}"]`)) {
            const li = document.createElement('li');
            li.className = 'voice-member flex items-center gap-2 py-1 px-2 rounded text-resonance-text-secondary text-sm group';
            li.dataset.userId = data.user.id;
            const avatarHtml = data.user.avatar 
                ? `<img src="${data.user.avatar}" class="w-6 h-6 rounded-full object-cover" alt="">`
                : `<div class="w-6 h-6 rounded-full bg-resonance-brand flex items-center justify-center text-xs font-semibold text-white">${data.user.username.charAt(0).toUpperCase()}</div>`;
            
            const disconnectBtnHtml = canDisconnect 
                ? `<button class="btn-disconnect-member hidden group-hover:block p-0.5 rounded hover:bg-resonance-danger/20" data-user-id="${data.user.id}" title="Disconnect">
                    <span class="material-icons text-sm text-resonance-danger">call_end</span>
                </button>`
                : '';
            
            li.innerHTML = `
                <div class="member-avatar">${avatarHtml}</div>
                <span class="member-name truncate flex-1">${data.user.username}</span>
                ${disconnectBtnHtml}
            `;
            sidebarContainer.appendChild(li);
        }
        
        // Add to voice view display (main area) - Discord-style card
        const voiceDisplay = document.getElementById('voice-members-display');
        if (voiceDisplay && !voiceDisplay.querySelector(`[data-user-id="${data.user.id}"]`)) {
            const memberCard = document.createElement('div');
            memberCard.className = 'voice-member-card';
            memberCard.dataset.userId = data.user.id;
            
            const avatarHtml = data.user.avatar 
                ? `<img src="${data.user.avatar}" class="avatar-img" alt="">`
                : `<div class="avatar-placeholder">${data.user.username.charAt(0).toUpperCase()}</div>`;
            
            const disconnectBtnHtml = canDisconnect 
                ? `<button class="btn-disconnect-member p-1.5 rounded-full bg-black/50 hover:bg-resonance-danger" data-user-id="${data.user.id}" title="Disconnect">
                    <span class="material-icons text-sm text-white">call_end</span>
                </button>`
                : '';
            
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
                    <span class="username">${data.user.username}</span>
                    <div class="status-icons">
                        <span class="material-icons muted-icon hidden" title="Muted">mic_off</span>
                        <span class="material-icons camera-icon hidden" title="Camera On">videocam</span>
                    </div>
                </div>
                
                <!-- Spotlight Button -->
                <button class="btn-spotlight" title="Focus View">
                    <span class="material-icons text-lg">fullscreen</span>
                </button>
                
                ${disconnectBtnHtml}
            `;
            
            voiceDisplay.appendChild(memberCard);
            
            // Update grid count
            this.updateVoiceGridLayout();
            
            // Add click handler for spotlight - clicking entire tile opens spotlight
            memberCard.addEventListener('click', (e) => {
                // Don't trigger spotlight on button clicks, context menu, or stream badge
                if (e.target.closest('button') || e.target.closest('.stream-badge') || e.target.closest('.voice-context-menu')) return;
                this.openSpotlight(data.user.id);
            });
            
            // Spotlight button also works
            memberCard.querySelector('.btn-spotlight')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openSpotlight(data.user.id);
            });
            
            // If this is me and camera is already on, show video immediately
            if (data.user.id == window.APP_CONFIG.userId && this.webrtcManager?.isCameraOn && this.webrtcManager?.localVideoStream) {
                console.log('Camera already on when adding self to voice display');
                this.updateLocalVideoDisplay(true);
            }
        }
    }
    
    updateVoiceGridLayout() {
        const voiceDisplay = document.getElementById('voice-members-display');
        if (voiceDisplay) {
            const count = voiceDisplay.querySelectorAll('.voice-member-card').length;
            voiceDisplay.dataset.count = Math.min(count, 12).toString();
            console.log('Voice grid updated, count:', count);
        }
    }

    removeVoiceMember(data) {
        // Remove from sidebar
        document.querySelectorAll(`.voice-member[data-user-id="${data.user_id}"]`).forEach(el => el.remove());
        
        // Remove from voice display
        document.querySelector(`#voice-members-display [data-user-id="${data.user_id}"]:not([data-screen-share])`)?.remove();
        
        // Remove screen share tile if exists
        this.removeScreenShareTile(data.user_id);
        
        // Update grid layout
        this.updateVoiceGridLayout();
        
        // Close spotlight if this user was spotlighted
        if (this.spotlightUserId == data.user_id) {
            this.closeSpotlight();
        }
        
        // Remove speaking indicator
        this.updateSpeakingIndicator(data.user_id, false);
    }
    
    // ========================
    // Spotlight/Focus View
    // ========================
    
    openSpotlight(userId) {
        const memberCard = document.querySelector(`#voice-members-display .voice-member-card[data-user-id="${userId}"]:not([data-screen-share])`);
        if (!memberCard) return;
        
        this.spotlightUserId = userId;
        this.spotlightIsScreenShare = false;
        
        const spotlight = document.getElementById('voice-spotlight');
        const content = document.getElementById('spotlight-content');
        if (!spotlight || !content) return;
        
        // Get user info
        const username = memberCard.querySelector('.username')?.textContent || 'User';
        const videoContainer = memberCard.querySelector('.video-container');
        const hasVideo = videoContainer && !videoContainer.classList.contains('hidden');
        const avatarEl = memberCard.querySelector('.avatar-img, .avatar-placeholder');
        
        // Build spotlight content
        if (hasVideo) {
            // Clone video stream
            const videoSrc = memberCard.querySelector('.user-video')?.srcObject;
            content.innerHTML = `
                <video autoplay playsinline muted style="width:100%;height:100%;object-fit:contain;"></video>
                <div class="spotlight-username">${username}</div>
            `;
            const video = content.querySelector('video');
            if (video && videoSrc) {
                video.srcObject = videoSrc;
            }
        } else {
            // Show avatar
            const initial = username.charAt(0).toUpperCase();
            const avatarSrc = avatarEl?.src;
            if (avatarSrc) {
                content.innerHTML = `
                    <img src="${avatarSrc}" class="spotlight-avatar" style="width:200px;height:200px;border-radius:50%;object-fit:cover;">
                    <div class="spotlight-username">${username}</div>
                `;
            } else {
                content.innerHTML = `
                    <div class="spotlight-avatar">${initial}</div>
                    <div class="spotlight-username">${username}</div>
                `;
            }
        }
        
        spotlight.classList.remove('hidden');
    }
    
    closeSpotlight() {
        this.spotlightUserId = null;
        this.spotlightIsScreenShare = false;
        const spotlight = document.getElementById('voice-spotlight');
        if (spotlight) {
            spotlight.classList.add('hidden');
            document.getElementById('spotlight-content').innerHTML = '';
        }
    }

    // ========================
    // Voice Fullscreen Toggle
    // ========================
    
    toggleVoiceFullscreen() {
        const container = document.querySelector('.flex.h-full');
        const btn = document.getElementById('btn-voice-fullscreen');
        if (!container || !btn) return;
        
        const isFullscreen = container.classList.toggle('voice-fullscreen-active');
        btn.classList.toggle('active', isFullscreen);
        
        const icon = btn.querySelector('.material-icons');
        if (icon) {
            icon.textContent = isFullscreen ? 'fullscreen_exit' : 'fullscreen';
        }
    }

    // ========================
    // Voice Tile Context Menu
    // ========================
    
    setupVoiceTileContextMenu() {
        // Per-user volume/mute state storage
        this.userAudioSettings = {}; // userId -> { volume: 100, muted: false, videoHidden: false }
        
        // Right-click on voice tiles
        document.addEventListener('contextmenu', (e) => {
            const tile = e.target.closest('.voice-member-card');
            if (!tile) return;
            
            e.preventDefault();
            
            const userId = tile.dataset.userId;
            const isScreenShare = tile.dataset.screenShare === 'true';
            const username = tile.querySelector('.username')?.textContent || 'User';
            
            this.showVoiceTileContextMenu(e.clientX, e.clientY, userId, username, isScreenShare);
        });
        
        // Close context menu on click outside
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('voice-tile-context-menu');
            if (menu && !menu.contains(e.target)) {
                menu.classList.add('hidden');
            }
        });
        
        // Close context menu on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.getElementById('voice-tile-context-menu')?.classList.add('hidden');
            }
        });
        
        // Volume slider
        document.getElementById('ctx-volume-slider')?.addEventListener('input', (e) => {
            const volume = parseInt(e.target.value);
            document.getElementById('ctx-volume-value').textContent = volume + '%';
            
            if (this._contextMenuUserId) {
                if (this._contextMenuIsDm && this.friendsManager) {
                    this.friendsManager.setDmUserVolume(this._contextMenuUserId, volume);
                } else {
                    this.setUserVolume(this._contextMenuUserId, volume);
                }
            }
        });
        
        // Mute toggle
        document.getElementById('ctx-toggle-mute')?.addEventListener('click', () => {
            if (this._contextMenuUserId) {
                if (this._contextMenuIsDm && this.friendsManager) {
                    this.friendsManager.toggleDmUserMute(this._contextMenuUserId);
                } else {
                    this.toggleUserMute(this._contextMenuUserId);
                }
                document.getElementById('voice-tile-context-menu')?.classList.add('hidden');
            }
        });
        
        // Video toggle
        document.getElementById('ctx-toggle-video')?.addEventListener('click', () => {
            if (this._contextMenuUserId) {
                if (this._contextMenuIsDm && this.friendsManager) {
                    this.friendsManager.toggleDmUserVideoHidden(this._contextMenuUserId);
                } else {
                    this.toggleUserVideoHidden(this._contextMenuUserId, this._contextMenuIsScreenShare);
                }
                document.getElementById('voice-tile-context-menu')?.classList.add('hidden');
            }
        });
        
        // Stream toggle (watch/leave)
        document.getElementById('ctx-toggle-stream')?.addEventListener('click', () => {
            if (this._contextMenuUserId) {
                if (this._contextMenuIsDm && this.friendsManager) {
                    this.friendsManager.toggleDmStreamWatch(this._contextMenuUserId);
                } else {
                    this.toggleStreamWatch(this._contextMenuUserId, this._contextMenuIsScreenShare);
                }
                document.getElementById('voice-tile-context-menu')?.classList.add('hidden');
            }
        });
        
        // Stream mute (mute a remote stream's audio)
        document.getElementById('ctx-toggle-stream-mute')?.addEventListener('click', () => {
            if (this._contextMenuUserId) {
                if (this._contextMenuIsDm && this.friendsManager) {
                    this.friendsManager.toggleDmStreamMute(this._contextMenuUserId);
                } else {
                    this.toggleStreamMute(this._contextMenuUserId);
                }
                document.getElementById('voice-tile-context-menu')?.classList.add('hidden');
            }
        });
        
        // Stream audio toggle (own stream - share/stop sharing audio)
        document.getElementById('ctx-toggle-stream-audio')?.addEventListener('click', (e) => {
            if (e.currentTarget.classList.contains('disabled')) return;
            this.toggleOwnStreamAudio();
            document.getElementById('voice-tile-context-menu')?.classList.add('hidden');
        });
    }
    
    showVoiceTileContextMenu(x, y, userId, username, isScreenShare) {
        const menu = document.getElementById('voice-tile-context-menu');
        if (!menu) return;
        
        this._contextMenuUserId = userId;
        this._contextMenuIsScreenShare = isScreenShare;
        this._contextMenuIsDm = false; // Server voice, not DM
        
        const isOwnUser = userId == window.APP_CONFIG.userId;
        
        // Set username
        document.getElementById('ctx-menu-username').textContent = username;
        
        // Init audio settings for this user if needed
        if (!this.userAudioSettings[userId]) {
            this.userAudioSettings[userId] = { volume: 100, muted: false, videoHidden: false, streamHidden: false, streamMuted: false };
        }
        const settings = this.userAudioSettings[userId];
        
        // Get all elements
        const volumeSection = document.getElementById('ctx-volume-section');
        const divider1 = document.getElementById('ctx-divider-1');
        const divider2 = document.getElementById('ctx-divider-2');
        const muteBtn = document.getElementById('ctx-toggle-mute');
        const videoBtn = document.getElementById('ctx-toggle-video');
        const streamMuteBtn = document.getElementById('ctx-toggle-stream-mute');
        const streamBtn = document.getElementById('ctx-toggle-stream');
        const streamAudioBtn = document.getElementById('ctx-toggle-stream-audio');
        
        // Hide everything first, then selectively show
        volumeSection.style.display = 'none';
        divider1.style.display = 'none';
        divider2.style.display = 'none';
        muteBtn.style.display = 'none';
        videoBtn.style.display = 'none';
        streamMuteBtn.style.display = 'none';
        streamBtn.style.display = 'none';
        streamAudioBtn.style.display = 'none';
        
        if (isScreenShare) {
            // ===== SCREEN SHARE TILE =====
            if (isOwnUser) {
                // Own screen share: show audio toggle
                streamAudioBtn.style.display = '';
                const audioIcon = streamAudioBtn.querySelector('.material-icons');
                const audioText = streamAudioBtn.querySelector('span:last-child');
                
                // Check if the source even has an audio track
                const audioTrack = this.webrtcManager?.screenStream?.getAudioTracks()[0];
                const hasAudio = this.webrtcManager?.screenShareHasAudio || false;
                
                if (!audioTrack) {
                    // Source doesn't support audio (monitor/window)
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
                // Other user's screen share: volume, mute stream, watch/leave
                volumeSection.style.display = '';
                divider1.style.display = '';
                divider2.style.display = '';
                
                // Volume slider
                const slider = document.getElementById('ctx-volume-slider');
                slider.value = settings.volume;
                document.getElementById('ctx-volume-value').textContent = settings.volume + '%';
                
                // Mute stream button
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
                
                // Watch/Leave stream
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
            // ===== USER TILE (camera/avatar) =====
            if (isOwnUser) {
                // Own user tile: no options needed (use the controls bar instead)
                // Close menu immediately - nothing useful to show
                menu.classList.add('hidden');
                return;
            } else {
                // Other user's tile: volume, mute, hide video
                volumeSection.style.display = '';
                divider1.style.display = '';
                
                // Volume slider
                const slider = document.getElementById('ctx-volume-slider');
                slider.value = settings.volume;
                document.getElementById('ctx-volume-value').textContent = settings.volume + '%';
                
                // Mute user
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
                
                // Hide video - only show if user has video active
                if (this.tileHasVideo(userId)) {
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
    
    tileHasVideo(userId) {
        const card = document.querySelector(`#voice-members-display .voice-member-card[data-user-id="${userId}"]:not([data-screen-share])`);
        if (!card) return false;
        const videoContainer = card.querySelector('.video-container');
        return videoContainer && !videoContainer.classList.contains('hidden');
    }
    
    setUserVolume(userId, volume) {
        if (!this.userAudioSettings[userId]) {
            this.userAudioSettings[userId] = { volume: 100, muted: false, videoHidden: false, streamHidden: false };
        }
        this.userAudioSettings[userId].volume = volume;
        
        // Apply volume to audio element
        const audio = document.getElementById(`audio-${userId}`);
        if (audio) {
            audio.volume = Math.min(volume / 100, 1.0);
            // For values > 100, we use a gain node if available
            if (volume > 100) {
                audio.volume = 1.0;
                // Boost via gain
                this.applyUserGain(userId, volume / 100);
            } else {
                this.applyUserGain(userId, 1.0);
            }
        }
    }
    
    applyUserGain(userId, gainValue) {
        // Create per-user gain node for volume boost above 100%
        if (!this._userGainNodes) this._userGainNodes = {};
        
        const audio = document.getElementById(`audio-${userId}`);
        if (!audio) return;
        
        if (!this._userAudioContexts) this._userAudioContexts = {};
        
        if (!this._userGainNodes[userId]) {
            try {
                const ctx = new AudioContext();
                const source = ctx.createMediaElementSource(audio);
                const gain = ctx.createGain();
                source.connect(gain);
                gain.connect(ctx.destination);
                this._userGainNodes[userId] = gain;
                this._userAudioContexts[userId] = ctx;
            } catch (e) {
                console.log('Could not create user gain node:', e);
                return;
            }
        }
        
        if (this._userGainNodes[userId]) {
            this._userGainNodes[userId].gain.value = gainValue;
        }
    }
    
    toggleUserMute(userId) {
        if (!this.userAudioSettings[userId]) {
            this.userAudioSettings[userId] = { volume: 100, muted: false, videoHidden: false, streamHidden: false };
        }
        
        const settings = this.userAudioSettings[userId];
        settings.muted = !settings.muted;
        
        const audio = document.getElementById(`audio-${userId}`);
        if (audio) {
            audio.muted = settings.muted;
        }
    }
    
    toggleUserVideoHidden(userId, isScreenShare) {
        if (!this.userAudioSettings[userId]) {
            this.userAudioSettings[userId] = { volume: 100, muted: false, videoHidden: false, streamHidden: false };
        }
        
        const settings = this.userAudioSettings[userId];
        settings.videoHidden = !settings.videoHidden;
        
        // Find the card
        const selector = isScreenShare 
            ? `#voice-members-display .voice-member-card[data-user-id="${userId}"][data-screen-share="true"]`
            : `#voice-members-display .voice-member-card[data-user-id="${userId}"]:not([data-screen-share])`;
        const card = document.querySelector(selector);
        
        if (card) {
            card.classList.toggle('video-hidden', settings.videoHidden);
        }
    }
    
    toggleStreamWatch(userId, isScreenShare) {
        if (!this.userAudioSettings[userId]) {
            this.userAudioSettings[userId] = { volume: 100, muted: false, videoHidden: false, streamHidden: false };
        }
        
        const settings = this.userAudioSettings[userId];
        settings.streamHidden = !settings.streamHidden;
        
        // Find the relevant tile
        const selector = isScreenShare
            ? `#voice-members-display .voice-member-card[data-user-id="${userId}"][data-screen-share="true"]`
            : `#voice-members-display .voice-member-card[data-user-id="${userId}"]:not([data-screen-share])`;
        const card = document.querySelector(selector);
        
        if (card) {
            card.classList.toggle('video-hidden', settings.streamHidden);
            
            // Update stream badge on the tile
            let badge = card.querySelector('.stream-badge');
            if (settings.streamHidden) {
                // Show "Watch" badge
                if (!badge) {
                    badge = document.createElement('button');
                    badge.className = 'stream-badge stream-watch';
                    badge.innerHTML = '<span class="material-icons" style="font-size:14px;vertical-align:middle;margin-right:2px;">live_tv</span> Watch';
                    card.appendChild(badge);
                    badge.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.toggleStreamWatch(userId, isScreenShare);
                    });
                } else {
                    badge.className = 'stream-badge stream-watch';
                    badge.innerHTML = '<span class="material-icons" style="font-size:14px;vertical-align:middle;margin-right:2px;">live_tv</span> Watch';
                }
            } else {
                // Remove badge or change to "Leave"
                if (badge) badge.remove();
            }
        }
    }

    /**
     * Mute/unmute a remote screen share stream's audio
     */
    toggleStreamMute(userId) {
        if (!this.userAudioSettings[userId]) {
            this.userAudioSettings[userId] = { volume: 100, muted: false, videoHidden: false, streamHidden: false, streamMuted: false };
        }
        
        const settings = this.userAudioSettings[userId];
        settings.streamMuted = !settings.streamMuted;
        
        // Mute the user's audio element (screen share audio comes through the same peer connection)
        const audio = document.getElementById(`audio-${userId}`);
        if (audio) {
            audio.muted = settings.streamMuted || settings.muted;
        }
        
        // Also mute/unmute the screen share video element itself (if it has audio tracks)
        const screenTile = document.querySelector(`#voice-members-display .voice-member-card[data-user-id="${userId}"][data-screen-share="true"]`);
        if (screenTile) {
            const video = screenTile.querySelector('video');
            if (video) {
                video.muted = settings.streamMuted;
            }
        }
    }
    
    /**
     * Toggle audio sharing on own screen share
     */
    toggleOwnStreamAudio() {
        if (!this.webrtcManager?.isScreenSharing || !this.webrtcManager?.screenStream) {
            this.showNotification('No active screen share', 'error');
            return;
        }
        
        try {
            this.webrtcManager.toggleScreenShareAudio();
            const hasAudio = this.webrtcManager.screenShareHasAudio;
            this.showNotification(hasAudio ? 'Stream audio enabled' : 'Stream audio disabled', 'success');
        } catch (error) {
            if (error.message === 'no-audio-track') {
                this.showNotification('This source doesn\'t support audio. Share a browser tab for audio.', 'error');
            } else {
                this.showNotification('Could not toggle stream audio', 'error');
            }
        }
    }

    // ========================
    // Speaking Indicator
    // ========================
    
    updateSpeakingIndicator(userId, speaking) {
        console.log('Updating speaking indicator for user', userId, speaking);
        
        // Update voice member in sidebar
        const voiceMembers = document.querySelectorAll(`.voice-member[data-user-id="${userId}"]`);
        voiceMembers.forEach(member => {
            member.classList.toggle('speaking', speaking);
        });
        
        // Update voice member card in main voice view
        const voiceMemberCard = document.querySelector(`#voice-members-display .voice-member-card[data-user-id="${userId}"]`);
        if (voiceMemberCard) {
            // Toggle speaking class on card
            voiceMemberCard.classList.toggle('speaking', speaking);
            
            // Update speaking ring on avatar
            const speakingRing = voiceMemberCard.querySelector('.speaking-ring');
            if (speakingRing) {
                speakingRing.style.opacity = speaking ? '1' : '0';
            }
            
            // Update avatar border
            const avatar = voiceMemberCard.querySelector('.avatar-img, .avatar-placeholder');
            if (avatar) {
                avatar.classList.toggle('ring-4', speaking);
                avatar.classList.toggle('ring-resonance-success', speaking);
            }
        }
        
        // Update spotlight if this user is in spotlight
        const spotlightContent = document.querySelector('.spotlight-content[data-user-id="' + userId + '"]');
        if (spotlightContent) {
            spotlightContent.classList.toggle('speaking', speaking);
        }
        
        // Update user panel if it's the current user
        if (userId == window.APP_CONFIG.userId) {
            const userPanel = document.getElementById('user-panel');
            if (userPanel) {
                userPanel.classList.toggle('speaking', speaking);
            }
            
            // Also add visual feedback to user avatar
            const userAvatar = userPanel?.querySelector('.user-avatar, .user-avatar-img');
            if (userAvatar) {
                userAvatar.classList.toggle('speaking', speaking);
            }
        }
    }

    // ========================
    // Mute/Deafen
    // ========================
    
    toggleMute() {
        const isMuted = this.webrtcManager.toggleMute();
        
        // Update sidebar button
        const sidebarBtn = document.getElementById('btn-mute');
        if (sidebarBtn) {
            const icon = sidebarBtn.querySelector('.material-icons');
            if (icon) icon.textContent = isMuted ? 'mic_off' : 'mic';
            sidebarBtn.classList.toggle('text-resonance-danger', isMuted);
        }
        
        // Update voice view button
        const voiceBtn = document.getElementById('voice-btn-mute');
        if (voiceBtn) {
            const icon = voiceBtn.querySelector('.material-icons');
            if (icon) icon.textContent = isMuted ? 'mic_off' : 'mic';
            voiceBtn.classList.toggle('bg-resonance-danger', isMuted);
            voiceBtn.classList.toggle('bg-resonance-bg-secondary', !isMuted);
        }
        
        if (isMuted) {
            this.updateSpeakingIndicator(window.APP_CONFIG.userId, false);
        }
    }

    toggleDeafen() {
        const isDeafened = this.webrtcManager.toggleDeafen();
        
        // Update sidebar button
        const sidebarBtn = document.getElementById('btn-deafen');
        if (sidebarBtn) {
            const icon = sidebarBtn.querySelector('.material-icons');
            if (icon) icon.textContent = isDeafened ? 'headset_off' : 'headphones';
            sidebarBtn.classList.toggle('text-resonance-danger', isDeafened);
        }
        
        // Update voice view button
        const voiceBtn = document.getElementById('voice-btn-deafen');
        if (voiceBtn) {
            const icon = voiceBtn.querySelector('.material-icons');
            if (icon) icon.textContent = isDeafened ? 'headset_off' : 'headphones';
            voiceBtn.classList.toggle('bg-resonance-danger', isDeafened);
            voiceBtn.classList.toggle('bg-resonance-bg-secondary', !isDeafened);
        }
    }

    // ========================
    // Camera/Video
    // ========================
    
    async toggleCamera() {
        try {
            const isCameraOn = await this.webrtcManager.toggleCamera();
            console.log('Camera toggled:', isCameraOn);
        } catch (error) {
            console.error('Error toggling camera:', error);
            this.showNotification('Failed to access camera. Check permissions.', 'error');
        }
    }
    
    updateCameraUI(cameraOn) {
        // Update camera button in voice controls
        const cameraBtn = document.getElementById('voice-btn-camera');
        if (cameraBtn) {
            const icon = cameraBtn.querySelector('.material-icons');
            if (icon) icon.textContent = cameraOn ? 'videocam' : 'videocam_off';
            cameraBtn.classList.toggle('bg-resonance-success', cameraOn);
            cameraBtn.classList.toggle('bg-resonance-bg-secondary', !cameraOn);
        }
    }
    
    updateLocalVideoDisplay(cameraOn) {
        console.log('updateLocalVideoDisplay called:', cameraOn, 'userId:', window.APP_CONFIG.userId);
        
        const myCard = document.querySelector(`#voice-members-display [data-user-id="${window.APP_CONFIG.userId}"]`);
        if (!myCard) {
            console.log('My card not found in voice display');
            return;
        }
        
        const videoContainer = myCard.querySelector('.video-container');
        const avatarContainer = myCard.querySelector('.avatar-container');
        const videoElement = myCard.querySelector('.user-video');
        const usernameLabel = myCard.querySelector('.username-label');
        const cameraIcon = myCard.querySelector('.camera-icon');
        
        console.log('Found elements:', !!videoContainer, !!avatarContainer, !!videoElement);
        console.log('Local video stream:', this.webrtcManager?.localVideoStream);
        console.log('Video tracks:', this.webrtcManager?.localVideoStream?.getVideoTracks());
        
        if (cameraOn && this.webrtcManager?.localVideoStream) {
            console.log('Showing video for local user');
            
            // Show video container, hide avatar
            if (videoContainer) {
                videoContainer.classList.remove('hidden');
                videoContainer.style.display = 'block';
            }
            if (avatarContainer) {
                avatarContainer.classList.add('hidden');
                avatarContainer.style.display = 'none';
            }
            if (usernameLabel) {
                usernameLabel.classList.add('hidden');
                usernameLabel.style.display = 'none';
            }
            
            // Set video stream
            if (videoElement) {
                videoElement.srcObject = this.webrtcManager.localVideoStream;
                videoElement.classList.add('local-video-mirror');
                videoElement.onloadedmetadata = () => {
                    console.log('Video metadata loaded, playing...');
                    videoElement.play().catch(e => console.log('Video play error:', e));
                };
            }
            
            // Show camera icon
            if (cameraIcon) {
                cameraIcon.classList.remove('hidden');
            }
            
            // Add class to card for styling
            myCard.classList.add('has-video');
        } else {
            console.log('Hiding video for local user');
            
            // Hide video, show avatar
            if (videoContainer) {
                videoContainer.classList.add('hidden');
                videoContainer.style.display = '';
            }
            if (avatarContainer) {
                avatarContainer.classList.remove('hidden');
                avatarContainer.style.display = '';
            }
            if (usernameLabel) {
                usernameLabel.classList.remove('hidden');
                usernameLabel.style.display = '';
            }
            
            // Clear video stream
            if (videoElement) {
                videoElement.srcObject = null;
            }
            
            // Hide camera icon
            if (cameraIcon) {
                cameraIcon.classList.add('hidden');
            }
            
            // Remove class from card
            myCard.classList.remove('has-video');
        }
    }
    
    updateRemoteVideoDisplay(userId, hasVideo, videoElement) {
        console.log('updateRemoteVideoDisplay called:', userId, hasVideo);
        
        const memberCard = document.querySelector(`#voice-members-display [data-user-id="${userId}"]`);
        if (!memberCard) {
            console.log('Member card not found for user:', userId);
            return;
        }
        
        const videoContainer = memberCard.querySelector('.video-container');
        const avatarContainer = memberCard.querySelector('.avatar-container');
        const existingVideo = memberCard.querySelector('.user-video');
        const usernameLabel = memberCard.querySelector('.username-label');
        const cameraIcon = memberCard.querySelector('.camera-icon');
        
        if (hasVideo && videoElement) {
            console.log('Showing video for remote user:', userId);
            
            // Show video, hide avatar
            videoContainer?.classList.remove('hidden');
            avatarContainer?.classList.add('hidden');
            usernameLabel?.classList.add('hidden');
            
            // Replace or set video element
            if (existingVideo && videoElement.srcObject) {
                existingVideo.srcObject = videoElement.srcObject;
                existingVideo.play().catch(e => console.log('Remote video play error:', e));
            }
            
            // Show camera icon
            cameraIcon?.classList.remove('hidden');
            
            // Add class to card
            memberCard.classList.add('has-video');
        } else {
            console.log('Hiding video for remote user:', userId);
            
            // Hide video, show avatar
            videoContainer?.classList.add('hidden');
            avatarContainer?.classList.remove('hidden');
            usernameLabel?.classList.remove('hidden');
            
            // Clear video stream
            if (existingVideo) {
                existingVideo.srcObject = null;
            }
            
            // Hide camera icon
            cameraIcon?.classList.add('hidden');
            
            // Remove class from card
            memberCard.classList.remove('has-video');
        }
    }
    
    updateRemoteCameraIndicator(userId, cameraOn) {
        // Ignore events for own user - handled by updateLocalVideoDisplay
        if (userId == window.APP_CONFIG.userId) {
            return;
        }
        
        const memberCard = document.querySelector(`#voice-members-display [data-user-id="${userId}"]:not([data-screen-share])`);
        if (!memberCard) return;
        
        const cameraIcon = memberCard.querySelector('.camera-icon');
        if (cameraIcon) {
            if (cameraOn) {
                cameraIcon.classList.remove('hidden');
            } else {
                cameraIcon.classList.add('hidden');
            }
        }
    }

    // ========================
    // Screen Sharing
    // ========================
    
    async toggleScreenShare() {
        try {
            const isSharing = await this.webrtcManager.toggleScreenShare();
            console.log('Screen share toggled:', isSharing);
        } catch (error) {
            console.error('Error toggling screen share:', error);
            if (error.name !== 'NotAllowedError') {
                this.showNotification('Failed to share screen. Check permissions.', 'error');
            }
        }
    }
    
    updateScreenShareUI(isSharing) {
        // Update screen share button in voice controls
        const shareBtn = document.getElementById('voice-btn-screenshare');
        if (shareBtn) {
            const icon = shareBtn.querySelector('.material-icons');
            if (icon) icon.textContent = isSharing ? 'stop_screen_share' : 'screen_share';
            shareBtn.classList.toggle('bg-resonance-success', isSharing);
            shareBtn.classList.toggle('bg-resonance-bg-secondary', !isSharing);
        }
    }
    
    /**
     * Add an extra tile for screen share in the voice grid.
     * This tile is separate from the user's avatar/camera tile.
     */
    addScreenShareTile(userId, username, isLocal, videoElement) {
        const voiceDisplay = document.getElementById('voice-members-display');
        if (!voiceDisplay) return;
        
        // Remove existing screen share tile for this user if any
        const existingTile = voiceDisplay.querySelector(`[data-user-id="${userId}"][data-screen-share="true"]`);
        if (existingTile) {
            existingTile.remove();
        }
        
        const tile = document.createElement('div');
        tile.className = 'voice-member-card screen-share-card';
        tile.dataset.userId = userId;
        tile.dataset.screenShare = 'true';
        
        const isOwnStream = userId == window.APP_CONFIG.userId;
        
        // Remote streams are hidden by default until user chooses to watch
        // Own streams are always visible
        if (!this.userAudioSettings[userId]) {
            this.userAudioSettings[userId] = { volume: 100, muted: false, videoHidden: false, streamHidden: !isOwnStream, streamMuted: false };
        }
        // If it's a new remote stream, default to hidden
        if (!isOwnStream && this.userAudioSettings[userId].streamHidden === undefined) {
            this.userAudioSettings[userId].streamHidden = true;
        }
        const isHidden = !isOwnStream && this.userAudioSettings[userId].streamHidden;
        
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
        
        // Remote streams hidden by default - show Watch badge
        if (isHidden) {
            tile.classList.add('video-hidden');
            const badge = document.createElement('button');
            badge.className = 'stream-badge stream-watch';
            badge.innerHTML = '<span class="material-icons" style="font-size:14px;vertical-align:middle;margin-right:2px;">live_tv</span> Watch';
            tile.appendChild(badge);
            badge.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleStreamWatch(userId, true);
            });
        }
        
        voiceDisplay.appendChild(tile);
        
        // Set up video stream
        const video = tile.querySelector('.screen-share-video');
        if (isLocal && this.webrtcManager?.screenStream) {
            video.srcObject = this.webrtcManager.screenStream;
            video.play().catch(e => console.log('Screen share preview play error:', e));
        } else if (videoElement && videoElement.srcObject) {
            video.srcObject = videoElement.srcObject;
            video.play().catch(e => console.log('Remote screen share play error:', e));
        }
        
        // Update grid
        this.updateVoiceGridLayout();
        
        // Add click handler for spotlight - clicking entire tile opens spotlight
        tile.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('.stream-badge') || e.target.closest('.voice-context-menu')) return;
            this.openSpotlightScreenShare(userId);
        });
        
        // Spotlight button also works
        tile.querySelector('.btn-spotlight')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openSpotlightScreenShare(userId);
        });
    }
    
    /**
     * Remove the screen share tile for a user
     */
    removeScreenShareTile(userId) {
        const tile = document.querySelector(`#voice-members-display [data-user-id="${userId}"][data-screen-share="true"]`);
        if (tile) {
            const video = tile.querySelector('video');
            if (video) video.srcObject = null;
            tile.remove();
            this.updateVoiceGridLayout();
        }
        
        // Close spotlight if screen share was spotlighted
        if (this.spotlightUserId == userId && this.spotlightIsScreenShare) {
            this.closeSpotlight();
        }
    }
    
    /**
     * Open spotlight for a screen share tile
     */
    openSpotlightScreenShare(userId) {
        const screenTile = document.querySelector(`#voice-members-display [data-user-id="${userId}"][data-screen-share="true"]`);
        if (!screenTile) return;
        
        this.spotlightUserId = userId;
        this.spotlightIsScreenShare = true;
        
        const spotlight = document.getElementById('voice-spotlight');
        const content = document.getElementById('spotlight-content');
        if (!spotlight || !content) return;
        
        const username = screenTile.querySelector('.username')?.textContent || 'Screen Share';
        const videoSrc = screenTile.querySelector('.screen-share-video')?.srcObject;
        
        content.innerHTML = `
            <video autoplay playsinline muted style="width:100%;height:100%;object-fit:contain;"></video>
            <div class="spotlight-username">${username}</div>
        `;
        
        const video = content.querySelector('video');
        if (video && videoSrc) {
            video.srcObject = videoSrc;
        }
        
        spotlight.classList.remove('hidden');
    }

    // ========================
    // Channel Management
    // ========================
    
    async switchChannel(channelId) {
        if (channelId === this.currentChannelId) return;

        if (this.currentChannelId) {
            this.wsManager.leaveChannel(this.currentChannelId);
        }

        this.currentChannelId = channelId;
        this.wsManager.joinChannel(channelId);

        document.querySelectorAll('.channel-item').forEach(item => {
            item.classList.toggle('active', parseInt(item.dataset.channelId) === channelId);
            item.classList.toggle('bg-resonance-bg-selected', parseInt(item.dataset.channelId) === channelId);
            item.classList.toggle('text-white', parseInt(item.dataset.channelId) === channelId);
        });

        document.getElementById('current-channel-id').value = channelId;
        
        // Ensure text channel view is shown
        this.showTextChannelView();
        document.getElementById('channel-header-icon').textContent = 'tag';
        
        await this.loadChannelMessages(channelId);
    }

    async loadChannelMessages(channelId) {
        try {
            const response = await fetch(`/api/channels/${channelId}/messages`);
            const data = await response.json();
            
            document.getElementById('current-channel-name').textContent = data.channel.name;
            document.getElementById('message-input').placeholder = `Message #${data.channel.name}`;

            const messagesContainer = document.getElementById('messages-list');
            messagesContainer.innerHTML = '';

            if (data.messages.length === 0) {
                messagesContainer.innerHTML = '<div id="no-messages" class="flex flex-col items-center justify-center h-full text-resonance-text-muted"><span class="material-icons-outlined text-6xl mb-4">chat_bubble_outline</span><p class="text-lg">No messages yet. Be the first to send one!</p></div>';
            } else {
                data.messages.forEach(msg => {
                    messagesContainer.appendChild(this.createMessageElement(msg));
                });
            }

            this.scrollMessagesToBottom();
        } catch (error) {
            console.error('Error loading messages:', error);
        }
    }

    // ========================
    // Message Handling
    // ========================
    
    handleSendMessage(e) {
        e.preventDefault();
        
        const input = document.getElementById('message-input');
        const content = input.value.trim();

        if (!content || !this.currentChannelId) return;

        this.wsManager.sendMessage(this.currentChannelId, content);
        input.value = '';
    }

    handleNewMessage(message) {
        if (message.channel_id !== this.currentChannelId) return;

        const messagesContainer = document.getElementById('messages-list');
        document.getElementById('no-messages')?.remove();

        const messageEl = this.createMessageElement(message);
        messagesContainer.appendChild(messageEl);
        this.scrollMessagesToBottom();
    }

    createMessageElement(message) {
        const div = document.createElement('div');
        div.className = 'message flex gap-4 p-4 hover:bg-resonance-bg-secondary rounded transition-colors group relative';
        div.dataset.messageId = message.id;
        div.dataset.userId = message.user_id;
        
        // Build attachment HTML if present
        let attachmentHtml = '';
        if (message.attachment_url) {
            if (message.attachment_type === 'image') {
                attachmentHtml = `
                    <div class="message-attachment mt-2">
                        <a href="${message.attachment_url}" target="_blank" class="block">
                            <img src="${message.attachment_url}" alt="${this.escapeHtml(message.attachment_name || 'Image')}" 
                                 class="max-w-md max-h-80 rounded-lg border border-resonance-bg-tertiary hover:border-resonance-brand transition-colors cursor-pointer">
                        </a>
                    </div>
                `;
            } else {
                attachmentHtml = `
                    <div class="message-attachment mt-2">
                        <a href="${message.attachment_url}" download="${this.escapeHtml(message.attachment_name || 'file')}" 
                           class="inline-flex items-center gap-2 px-3 py-2 bg-resonance-bg-tertiary rounded-lg border border-resonance-bg-modifier hover:bg-resonance-bg-modifier transition-colors">
                            <span class="material-icons text-resonance-text-muted">attach_file</span>
                            <span class="text-resonance-text-primary">${this.escapeHtml(message.attachment_name || 'Download file')}</span>
                        </a>
                    </div>
                `;
            }
        }

        // Avatar with image support
        const avatarHtml = message.avatar 
            ? `<img src="${message.avatar}" class="w-10 h-10 rounded-full object-cover cursor-pointer user-clickable" data-user-id="${message.user_id}" alt="">`
            : `<div class="w-10 h-10 rounded-full bg-resonance-brand flex items-center justify-center text-white font-semibold cursor-pointer user-clickable" data-user-id="${message.user_id}">${message.username.charAt(0).toUpperCase()}</div>`;

        // Edited indicator
        const editedHtml = message.edited ? '<span class="text-xs text-resonance-text-muted">(edited)</span>' : '';

        // Pinned indicator
        const pinnedHtml = message.pinned ? '<span class="material-icons text-xs text-yellow-500 ml-1" title="Pinned">push_pin</span>' : '';
        
        // Permission checks for action buttons
        const isOwnMessage = message.user_id == window.APP_CONFIG.userId;
        const canManageMessages = window.hasPermission('manage_messages');
        const isAdmin = window.hasPermission('administrator');
        
        // Edit: only own messages
        const canEdit = isOwnMessage;
        // Delete: own messages OR manage messages permission OR admin
        const canDelete = isOwnMessage || canManageMessages || isAdmin;
        // Pin: manage messages permission OR admin
        const canPin = canManageMessages || isAdmin;
        
        // Build action buttons based on permissions
        let actionButtons = '';
        if (canPin || canEdit || canDelete) {
            actionButtons = `
                <div class="message-actions absolute right-2 top-2 hidden group-hover:flex bg-resonance-bg-tertiary rounded shadow-lg border border-resonance-bg-hover">
                    ${canPin ? `<button class="btn-pin-message p-1.5 hover:bg-resonance-bg-hover rounded-l transition-colors" title="${message.pinned ? 'Unpin' : 'Pin'}">
                        <span class="material-icons text-sm text-resonance-text-muted hover:text-yellow-500">push_pin</span>
                    </button>` : ''}
                    ${canEdit ? `<button class="btn-edit-message p-1.5 hover:bg-resonance-bg-hover transition-colors" title="Edit">
                        <span class="material-icons text-sm text-resonance-text-muted hover:text-resonance-brand">edit</span>
                    </button>` : ''}
                    ${canDelete ? `<button class="btn-delete-message p-1.5 hover:bg-resonance-bg-hover rounded-r transition-colors" title="Delete">
                        <span class="material-icons text-sm text-resonance-text-muted hover:text-resonance-danger">delete</span>
                    </button>` : ''}
                </div>
            `;
        }
        
        div.innerHTML = `
            <div class="message-avatar">${avatarHtml}</div>
            <div class="message-content flex-1 min-w-0">
                <div class="message-header flex items-center gap-2 mb-1">
                    <span class="message-author font-medium text-white hover:underline cursor-pointer user-clickable" data-user-id="${message.user_id}">${this.escapeHtml(message.username)}</span>
                    <span class="message-timestamp text-xs text-resonance-text-muted">${message.created_at}</span>
                    ${editedHtml}
                    ${pinnedHtml}
                </div>
                <div class="message-text text-resonance-text-primary break-words">${this.escapeHtml(message.content)}</div>
                ${attachmentHtml}
            </div>
            ${actionButtons}
        `;
        return div;
    }

    handleTyping() {
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
        }
        
        this.wsManager.sendTyping(this.currentChannelId);
        
        this.typingTimeout = setTimeout(() => {
            this.typingTimeout = null;
        }, 3000);
    }

    showTypingIndicator(username) {
        const indicator = document.getElementById('typing-indicator');
        const text = document.getElementById('typing-text');
        
        if (indicator && text) {
            text.textContent = `${username} is typing...`;
            indicator.style.display = 'flex';
            
            setTimeout(() => {
                indicator.style.display = 'none';
            }, 3000);
        }
    }

    // ========================
    // Message Actions
    // ========================

    startEditMessage(messageId, messageEl) {
        const textEl = messageEl.querySelector('.message-text');
        const currentText = textEl.textContent;
        
        // Replace text with input
        textEl.innerHTML = `
            <div class="flex gap-2">
                <input type="text" class="edit-message-input flex-1 px-2 py-1 bg-resonance-input rounded text-resonance-text-primary focus:outline-none focus:ring-2 focus:ring-resonance-brand" value="${this.escapeHtml(currentText)}">
                <button class="save-edit-btn px-2 py-1 bg-resonance-brand text-white text-sm rounded hover:bg-resonance-brand-hover">Save</button>
                <button class="cancel-edit-btn px-2 py-1 bg-resonance-bg-tertiary text-resonance-text-primary text-sm rounded hover:bg-resonance-bg-hover">Cancel</button>
            </div>
        `;
        
        const input = textEl.querySelector('.edit-message-input');
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        
        // Save handler
        textEl.querySelector('.save-edit-btn').onclick = async () => {
            const newContent = input.value.trim();
            if (newContent && newContent !== currentText) {
                await this.saveEditMessage(messageId, newContent);
            }
            textEl.textContent = newContent || currentText;
        };
        
        // Cancel handler
        textEl.querySelector('.cancel-edit-btn').onclick = () => {
            textEl.textContent = currentText;
        };
        
        // Enter to save, Escape to cancel
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                textEl.querySelector('.save-edit-btn').click();
            } else if (e.key === 'Escape') {
                textEl.querySelector('.cancel-edit-btn').click();
            }
        };
    }

    async saveEditMessage(messageId, content) {
        try {
            const response = await fetch(`/api/messages/${messageId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.csrfToken
                },
                body: JSON.stringify({ content })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to edit message');
            }
            
            // Update the edited indicator
            const messageEl = document.querySelector(`.message[data-message-id="${messageId}"]`);
            if (messageEl) {
                const header = messageEl.querySelector('.message-header');
                if (!header.querySelector('.text-xs.text-resonance-text-muted:not(.message-timestamp)')) {
                    const editedSpan = document.createElement('span');
                    editedSpan.className = 'text-xs text-resonance-text-muted';
                    editedSpan.textContent = '(edited)';
                    header.appendChild(editedSpan);
                }
            }
            
            this.showNotification('Message edited', 'success');
        } catch (error) {
            console.error('Error editing message:', error);
            this.showNotification(error.message, 'error');
        }
    }

    async deleteMessage(messageId, messageUserId) {
        // Check if user can delete (own message or has permission)
        const isOwnMessage = messageUserId == window.APP_CONFIG.userId;
        const canManageMessages = window.hasPermission('manage_messages');
        const isAdmin = window.hasPermission('administrator');
        const canDelete = isOwnMessage || canManageMessages || isAdmin;
        
        if (!canDelete) {
            this.showNotification('You do not have permission to delete this message', 'error');
            return;
        }
        
        if (!confirm('Delete this message?')) return;
        
        try {
            const response = await fetch(`/api/messages/${messageId}`, {
                method: 'DELETE',
                headers: { 'X-CSRF-Token': this.csrfToken }
            });
            
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to delete message');
            }
            
            // Remove from DOM
            document.querySelector(`.message[data-message-id="${messageId}"]`)?.remove();
            this.showNotification('Message deleted', 'success');
        } catch (error) {
            console.error('Error deleting message:', error);
            this.showNotification(error.message, 'error');
        }
    }

    async togglePinMessage(messageId) {
        // Check permission
        const canManageMessages = window.hasPermission('manage_messages');
        const isAdmin = window.hasPermission('administrator');
        
        if (!canManageMessages && !isAdmin) {
            this.showNotification('You do not have permission to pin messages', 'error');
            return;
        }
        
        try {
            const response = await fetch(`/api/messages/${messageId}/pin`, {
                method: 'POST',
                headers: { 'X-CSRF-Token': this.csrfToken }
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to toggle pin');
            }
            
            // Update UI
            const messageEl = document.querySelector(`.message[data-message-id="${messageId}"]`);
            if (messageEl) {
                const header = messageEl.querySelector('.message-header');
                const pinIcon = header.querySelector('.material-icons.text-yellow-500');
                
                if (data.pinned) {
                    if (!pinIcon) {
                        const pin = document.createElement('span');
                        pin.className = 'material-icons text-xs text-yellow-500 ml-1';
                        pin.title = 'Pinned';
                        pin.textContent = 'push_pin';
                        header.appendChild(pin);
                    }
                } else {
                    pinIcon?.remove();
                }
            }
            
            this.showNotification(data.pinned ? 'Message pinned' : 'Message unpinned', 'success');
        } catch (error) {
            console.error('Error toggling pin:', error);
            this.showNotification(error.message, 'error');
        }
    }

    // ========================
    // Form Submissions
    // ========================
    
    async handleCategorySubmit(e) {
        e.preventDefault();
        
        const categoryId = document.getElementById('edit-category-id').value;
        const name = document.getElementById('category-name').value.trim();
        
        if (!name) return;
        
        const url = categoryId ? `/api/categories/${categoryId}` : '/api/categories';
        const method = categoryId ? 'PUT' : 'POST';
        
        try {
            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.csrfToken
                },
                body: JSON.stringify({ name })
            });
            
            const result = await response.json();
            
            if (result.success || result.category) {
                this.closeModal('modal-category');
                this.showNotification(categoryId ? 'Category updated!' : 'Category created!', 'success');
                location.reload();
            } else {
                this.showNotification(result.error || 'Failed to save category', 'error');
            }
        } catch (error) {
            console.error('Error:', error);
            this.showNotification('Failed to save category', 'error');
        }
    }

    async handleDeleteCategory() {
        const categoryId = document.getElementById('edit-category-id').value;
        if (!categoryId || !confirm('Delete this category? Channels will be moved to uncategorized.')) return;
        
        try {
            const response = await fetch(`/api/categories/${categoryId}`, {
                method: 'DELETE',
                headers: { 'X-CSRF-Token': this.csrfToken }
            });
            
            if (response.ok) {
                this.closeModal('modal-category');
                this.showNotification('Category deleted!', 'success');
                location.reload();
            }
        } catch (error) {
            this.showNotification('Failed to delete category', 'error');
        }
    }

    async handleTextChannelSubmit(e) {
        e.preventDefault();
        
        const channelId = document.getElementById('edit-text-channel-id').value;
        const categoryId = document.getElementById('text-channel-category-id').value;
        const name = document.getElementById('text-channel-name').value.trim();
        const description = document.getElementById('text-channel-desc').value.trim();

        if (!name) return;

        const url = channelId ? `/api/channels/${channelId}` : '/api/channels';
        const method = channelId ? 'PUT' : 'POST';

        try {
            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.csrfToken
                },
                body: JSON.stringify({ name, description, category_id: categoryId || null })
            });

            const result = await response.json();

            if (result.success || result.channel) {
                this.closeModal('modal-text-channel');
                this.showNotification(channelId ? 'Channel updated!' : 'Channel created!', 'success');
                location.reload();
            } else {
                this.showNotification(result.error || 'Failed to save channel', 'error');
            }
        } catch (error) {
            this.showNotification('Failed to save channel', 'error');
        }
    }

    async handleDeleteTextChannel() {
        const channelId = document.getElementById('edit-text-channel-id').value;
        if (!channelId || !confirm('Delete this channel? All messages will be lost.')) return;
        
        try {
            const response = await fetch(`/api/channels/${channelId}`, {
                method: 'DELETE',
                headers: { 'X-CSRF-Token': this.csrfToken }
            });
            
            if (response.ok) {
                this.closeModal('modal-text-channel');
                this.showNotification('Channel deleted!', 'success');
                location.reload();
            }
        } catch (error) {
            this.showNotification('Failed to delete channel', 'error');
        }
    }

    async handleVoiceChannelSubmit(e) {
        e.preventDefault();
        
        const channelId = document.getElementById('edit-voice-channel-id').value;
        const categoryId = document.getElementById('voice-channel-category-id').value;
        const name = document.getElementById('voice-channel-name').value.trim();
        const maxUsers = parseInt(document.getElementById('voice-channel-limit').value) || 0;

        if (!name) return;

        const url = channelId ? `/api/voice/${channelId}` : '/api/voice';
        const method = channelId ? 'PUT' : 'POST';

        try {
            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.csrfToken
                },
                body: JSON.stringify({ name, max_users: maxUsers, category_id: categoryId || null })
            });

            const result = await response.json();

            if (result.success || result.channel) {
                this.closeModal('modal-voice-channel');
                this.showNotification(channelId ? 'Voice channel updated!' : 'Voice channel created!', 'success');
                location.reload();
            } else {
                this.showNotification(result.error || 'Failed to save channel', 'error');
            }
        } catch (error) {
            this.showNotification('Failed to save voice channel', 'error');
        }
    }

    async handleDeleteVoiceChannel() {
        const channelId = document.getElementById('edit-voice-channel-id').value;
        if (!channelId || !confirm('Delete this voice channel?')) return;
        
        try {
            const response = await fetch(`/api/voice/${channelId}`, {
                method: 'DELETE',
                headers: { 'X-CSRF-Token': this.csrfToken }
            });
            
            if (response.ok) {
                this.closeModal('modal-voice-channel');
                this.showNotification('Voice channel deleted!', 'success');
                location.reload();
            }
        } catch (error) {
            this.showNotification('Failed to delete channel', 'error');
        }
    }

    async handleUploadSound(e) {
        e.preventDefault();
        
        const name = document.getElementById('sound-name').value.trim();
        const file = document.getElementById('sound-file').files[0];

        if (!file) {
            this.showNotification('Please select a file', 'error');
            return;
        }

        try {
            const result = await this.soundboardManager.uploadSound(file, name);
            
            const soundboard = document.getElementById('soundboard');
            const btn = document.createElement('button');
            btn.className = 'px-3 py-2 bg-resonance-bg-secondary hover:bg-resonance-bg-tertiary rounded text-xs text-resonance-text-primary transition-colors truncate';
            btn.dataset.soundId = result.sound.id;
            btn.title = result.sound.name;
            btn.textContent = result.sound.name.substring(0, 8);
            soundboard.appendChild(btn);

            this.closeModal('modal-upload-sound');
            this.showNotification('Sound uploaded!', 'success');
        } catch (error) {
            this.showNotification(error.message, 'error');
        }
    }

    async handleAccountSubmit(e) {
        e.preventDefault();
        
        const username = document.getElementById('settings-username').value.trim();
        const email = document.getElementById('settings-email').value.trim();
        const currentPassword = document.getElementById('settings-current-password').value;
        const newPassword = document.getElementById('settings-new-password').value;

        const data = { username, email };
        if (currentPassword && newPassword) {
            data.current_password = currentPassword;
            data.new_password = newPassword;
        }

        try {
            const response = await fetch('/api/user/account', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.csrfToken
                },
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (result.success) {
                this.showNotification('Account updated!', 'success');
                document.getElementById('settings-current-password').value = '';
                document.getElementById('settings-new-password').value = '';
            } else {
                this.showNotification(result.error || 'Failed to update account', 'error');
            }
        } catch (error) {
            this.showNotification('Failed to update account', 'error');
        }
    }

    async handleProfileSubmit(e) {
        e.preventDefault();
        
        const data = {
            display_name: document.getElementById('settings-display-name').value.trim(),
            bio: document.getElementById('settings-bio').value.trim(),
            custom_status: document.getElementById('settings-custom-status').value.trim(),
            status: document.getElementById('settings-status').value,
            banner_color: document.getElementById('settings-banner-color').value
        };

        try {
            const response = await fetch('/api/user/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.csrfToken
                },
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (result.success) {
                this.showNotification('Profile updated!', 'success');
                
                // Update UI - user panel display name
                const displayName = data.display_name || document.getElementById('settings-username')?.value;
                const userInfoPanel = document.getElementById('user-info-panel');
                if (userInfoPanel && displayName) {
                    const nameEl = userInfoPanel.querySelector('.text-sm.font-semibold');
                    if (nameEl) nameEl.textContent = displayName;
                }
                
                // Update custom status
                if (data.custom_status) {
                    const statusEl = document.querySelector('#user-info-panel .text-xs.text-resonance-text-secondary');
                    if (statusEl) statusEl.textContent = data.custom_status;
                }
                
                // Update preview
                const previewName = document.getElementById('preview-displayname');
                if (previewName) previewName.textContent = displayName;
            } else {
                this.showNotification(result.error || 'Failed to update profile', 'error');
            }
        } catch (error) {
            this.showNotification('Failed to update profile', 'error');
        }
    }

    async handleVoiceSettingsSubmit(e) {
        e.preventDefault();
        
        const voiceSensitivity = document.getElementById('voice-sensitivity').value;

        try {
            const response = await fetch('/api/user/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.csrfToken
                },
                body: JSON.stringify({ voice_sensitivity: parseInt(voiceSensitivity) })
            });

            const result = await response.json();

            if (result.success) {
                // Update WebRTC threshold
                if (this.webrtcManager) {
                    this.webrtcManager.speakingThreshold = parseInt(voiceSensitivity);
                }
                this.showNotification('Voice settings saved!', 'success');
            } else {
                this.showNotification(result.error || 'Failed to save settings', 'error');
            }
        } catch (error) {
            this.showNotification('Failed to save voice settings', 'error');
        }
    }

    async handleAvatarUpload(file) {
        if (!file) return;
        
        const formData = new FormData();
        formData.append('avatar', file);
        
        try {
            const response = await fetch('/api/user/avatar', {
                method: 'POST',
                headers: { 'X-CSRF-Token': this.csrfToken },
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                document.getElementById('avatar-preview').innerHTML = `<img src="${result.avatar}" alt="Avatar">`;
                document.getElementById('preview-avatar').innerHTML = `<img src="${result.avatar}" alt="Avatar">`;
                this.showNotification('Avatar updated!', 'success');
            } else {
                this.showNotification(result.error || 'Failed to upload avatar', 'error');
            }
        } catch (error) {
            this.showNotification('Failed to upload avatar', 'error');
        }
    }

    async handleBannerUpload(file) {
        if (!file) return;
        
        const formData = new FormData();
        formData.append('banner', file);
        
        try {
            const response = await fetch('/api/user/banner', {
                method: 'POST',
                headers: { 'X-CSRF-Token': this.csrfToken },
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                document.getElementById('banner-preview').innerHTML = `<img src="${result.banner}" alt="Banner">`;
                document.getElementById('preview-banner').innerHTML = `<img src="${result.banner}" alt="Banner">`;
                this.showNotification('Banner updated!', 'success');
            } else {
                this.showNotification(result.error || 'Failed to upload banner', 'error');
            }
        } catch (error) {
            this.showNotification('Failed to upload banner', 'error');
        }
    }

    async removeAvatar() {
        try {
            const response = await fetch('/api/user/avatar', {
                method: 'DELETE',
                headers: { 'X-CSRF-Token': this.csrfToken }
            });
            
            if (response.ok) {
                const username = document.getElementById('settings-username').value;
                document.getElementById('avatar-preview').innerHTML = username.charAt(0).toUpperCase();
                document.getElementById('preview-avatar').innerHTML = username.charAt(0).toUpperCase();
                this.showNotification('Avatar removed!', 'success');
            }
        } catch (error) {
            this.showNotification('Failed to remove avatar', 'error');
        }
    }

    async removeBanner() {
        try {
            const response = await fetch('/api/user/banner', {
                method: 'DELETE',
                headers: { 'X-CSRF-Token': this.csrfToken }
            });
            
            if (response.ok) {
                document.getElementById('banner-preview').innerHTML = '';
                document.getElementById('preview-banner').innerHTML = '';
                this.showNotification('Banner removed!', 'success');
            }
        } catch (error) {
            this.showNotification('Failed to remove banner', 'error');
        }
    }

    // ========================
    // Edit Modals
    // ========================
    
    async openEditChannelModal(channelId, channelType) {
        try {
            const endpoint = channelType === 'text' ? `/api/channels/${channelId}` : `/api/voice/${channelId}`;
            const response = await fetch(endpoint);
            const data = await response.json();
            
            if (!data.channel) return;
            
            if (channelType === 'text') {
                document.getElementById('edit-text-channel-id').value = channelId;
                document.getElementById('text-channel-name').value = data.channel.name;
                document.getElementById('text-channel-desc').value = data.channel.description || '';
                document.getElementById('text-channel-category-id').value = data.channel.category_id || '';
                document.getElementById('modal-text-channel-title').textContent = 'Edit Text Channel';
                document.getElementById('btn-delete-text-channel').style.display = 'inline-block';
                this.openModal('modal-text-channel');
            } else {
                document.getElementById('edit-voice-channel-id').value = channelId;
                document.getElementById('voice-channel-name').value = data.channel.name;
                document.getElementById('voice-channel-limit').value = data.channel.max_users || 0;
                document.getElementById('voice-channel-category-id').value = data.channel.category_id || '';
                document.getElementById('modal-voice-channel-title').textContent = 'Edit Voice Channel';
                document.getElementById('btn-delete-voice-channel').style.display = 'inline-block';
                this.openModal('modal-voice-channel');
            }
        } catch (error) {
            this.showNotification('Failed to load channel', 'error');
        }
    }

    async openEditCategoryModal(categoryId) {
        try {
            const response = await fetch(`/api/categories/${categoryId}`);
            const data = await response.json();
            
            if (!data.category) return;
            
            document.getElementById('edit-category-id').value = categoryId;
            document.getElementById('category-name').value = data.category.name;
            document.getElementById('modal-category-title').textContent = 'Edit Category';
            document.getElementById('btn-delete-category').style.display = 'inline-block';
            this.openModal('modal-category');
        } catch (error) {
            this.showNotification('Failed to load category', 'error');
        }
    }

    // ========================
    // Voice Level Preview
    // ========================
    
    startVoiceLevelPreview() {
        if (this.webrtcManager && this.webrtcManager.analyser) {
            this.voicePreviewActive = true;
            this.updateVoiceLevelPreview();
        } else {
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    const audioContext = new AudioContext();
                    const source = audioContext.createMediaStreamSource(stream);
                    this.previewAnalyser = audioContext.createAnalyser();
                    this.previewAnalyser.fftSize = 256;
                    source.connect(this.previewAnalyser);
                    this.previewStream = stream;
                    this.previewAudioContext = audioContext;
                    this.voicePreviewActive = true;
                    this.updateVoiceLevelPreview();
                })
                .catch(err => {
                    console.warn('Could not get audio for preview:', err);
                });
        }
    }

    updateVoiceLevelPreview() {
        if (!this.voicePreviewActive) return;

        const analyser = this.webrtcManager?.analyser || this.previewAnalyser;
        if (!analyser) return;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);

        const sum = dataArray.reduce((a, b) => a + b, 0);
        const average = sum / dataArray.length;
        const volume = Math.min(100, (average / 128) * 100);

        const voiceLevel = document.querySelector('.voice-level-bar');
        if (voiceLevel) {
            voiceLevel.style.width = volume + '%';
            const sensitivity = document.getElementById('voice-sensitivity')?.value || 30;
            voiceLevel.style.background = average > parseInt(sensitivity) ? '#3ba55d' : '#72767d';
        }

        requestAnimationFrame(() => this.updateVoiceLevelPreview());
    }

    stopVoiceLevelPreview() {
        this.voicePreviewActive = false;
        if (this.previewStream) {
            this.previewStream.getTracks().forEach(track => track.stop());
            this.previewStream = null;
        }
        if (this.previewAudioContext) {
            this.previewAudioContext.close();
            this.previewAudioContext = null;
        }
        this.previewAnalyser = null;
    }

    async populateAudioDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const inputSelect = document.getElementById('input-device');
            const outputSelect = document.getElementById('output-device');
            
            devices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                
                if (device.kind === 'audioinput' && inputSelect) {
                    option.textContent = device.label || `Microphone ${inputSelect.options.length}`;
                    inputSelect.appendChild(option);
                } else if (device.kind === 'audiooutput' && outputSelect) {
                    option.textContent = device.label || `Speaker ${outputSelect.options.length}`;
                    outputSelect.appendChild(option);
                }
            });
        } catch (error) {
            console.warn('Could not enumerate audio devices:', error);
        }
    }

    // ========================
    // Utility Methods
    // ========================
    
    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            modal.querySelector('form')?.reset();
            
            if (modalId === 'modal-user-settings') {
                this.stopVoiceLevelPreview();
            }
        }
    }

    scrollMessagesToBottom() {
        const container = document.getElementById('messages-container');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }

    // ========================
    // Channel Header Features
    // ========================

    toggleMembersSidebar() {
        const sidebar = document.getElementById('members-sidebar');
        const btn = document.getElementById('btn-toggle-members');
        if (sidebar) {
            sidebar.classList.toggle('hidden');
            btn?.classList.toggle('bg-resonance-bg-active');
        }
    }

    togglePinnedMessages() {
        const popup = document.getElementById('pinned-messages-popup');
        if (popup) {
            const isHidden = popup.classList.toggle('hidden');
            if (!isHidden && this.currentChannelId) {
                this.loadPinnedMessages();
            }
        }
    }

    async loadPinnedMessages() {
        const container = document.getElementById('pinned-messages-list');
        if (!container || !this.currentChannelId) return;

        try {
            const response = await fetch(`/api/channels/${this.currentChannelId}/pinned`);
            const data = await response.json();

            if (data.messages && data.messages.length > 0) {
                container.innerHTML = data.messages.map(msg => `
                    <div class="p-2 hover:bg-resonance-bg-hover rounded">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="font-medium text-white text-sm">${this.escapeHtml(msg.username)}</span>
                            <span class="text-xs text-resonance-text-muted">${msg.created_at}</span>
                        </div>
                        <p class="text-sm text-resonance-text-primary">${this.escapeHtml(msg.content)}</p>
                    </div>
                `).join('');
            } else {
                container.innerHTML = '<p class="text-resonance-text-muted text-sm text-center py-8">No pinned messages</p>';
            }
        } catch (error) {
            console.error('Error loading pinned messages:', error);
            container.innerHTML = '<p class="text-resonance-text-muted text-sm text-center py-8">Failed to load pinned messages</p>';
        }
    }

    async searchMessages(query) {
        const container = document.getElementById('search-results-list');
        if (!container) return;

        if (!query || query.length < 2) {
            container.innerHTML = '<p class="text-resonance-text-muted text-sm text-center py-8">Type at least 2 characters to search...</p>';
            return;
        }

        try {
            // Search all channels globally
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            const data = await response.json();

            if (data.messages && data.messages.length > 0) {
                container.innerHTML = data.messages.map(msg => `
                    <div class="search-result p-2 hover:bg-resonance-bg-hover rounded cursor-pointer" 
                         data-message-id="${msg.id}" 
                         data-channel-id="${msg.channel_id}">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-xs text-resonance-brand font-medium">#${this.escapeHtml(msg.channel_name)}</span>
                            <span class="text-xs text-resonance-text-muted">•</span>
                            <span class="font-medium text-white text-sm">${this.escapeHtml(msg.username)}</span>
                            <span class="text-xs text-resonance-text-muted">${msg.created_at}</span>
                        </div>
                        <p class="text-sm text-resonance-text-primary">${this.highlightSearch(msg.content, query)}</p>
                    </div>
                `).join('');

                // Add click handlers for navigation
                container.querySelectorAll('.search-result').forEach(el => {
                    el.onclick = () => this.navigateToMessage(el.dataset.channelId, el.dataset.messageId);
                });
            } else {
                container.innerHTML = '<p class="text-resonance-text-muted text-sm text-center py-8">No messages found</p>';
            }
        } catch (error) {
            console.error('Error searching messages:', error);
            container.innerHTML = '<p class="text-resonance-text-muted text-sm text-center py-8">Search failed</p>';
        }
    }

    async navigateToMessage(channelId, messageId) {
        // Close search popup
        document.getElementById('search-results-popup')?.classList.add('hidden');
        document.getElementById('channel-search-input').value = '';

        // Always switch to text view first
        this.showTextChannelView();

        // Switch to the channel if different
        if (this.currentChannelId != channelId) {
            await this.switchChannel(parseInt(channelId));
            
            // Wait for messages to load
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Find and highlight the message
        const messageEl = document.querySelector(`.message[data-message-id="${messageId}"]`);
        if (messageEl) {
            messageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            messageEl.classList.add('bg-yellow-500/20');
            setTimeout(() => {
                messageEl.classList.remove('bg-yellow-500/20');
            }, 2000);
        }
    }

    highlightSearch(text, query) {
        const escaped = this.escapeHtml(text);
        const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return escaped.replace(regex, '<mark class="bg-yellow-500/30 text-white rounded px-0.5">$1</mark>');
    }

    async handleFileAttachment(e) {
        const file = e.target.files[0];
        if (!file) return;

        await this.uploadFile(file);
        
        // Reset input
        e.target.value = '';
    }

    async uploadFile(file, messageText = '') {
        if (!this.currentChannel) {
            this.showNotification('Please select a channel first', 'error');
            return;
        }

        // Validate file size (max 10MB)
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
            this.showNotification('File too large. Maximum size is 10MB', 'error');
            return;
        }

        // Show upload indicator
        this.showNotification(`Uploading ${file.name}...`, 'info');

        const formData = new FormData();
        formData.append('file', file);
        formData.append('message', messageText);

        try {
            const response = await fetch(`/api/channels/${this.currentChannel}/upload`, {
                method: 'POST',
                headers: {
                    'X-CSRF-Token': this.csrfToken
                },
                body: formData
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Upload failed');
            }

            // Remove notification
            document.querySelector('.notification')?.remove();

            // The WebSocket will handle adding the message to the chat
            // But we can also add it directly for immediate feedback
            if (data.message) {
                this.addMessageToChat(data.message);
            }

            this.showNotification('File uploaded successfully!', 'success');
        } catch (error) {
            console.error('Upload error:', error);
            this.showNotification(error.message || 'Failed to upload file', 'error');
        }
    }

    handlePaste(e) {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) {
                    // Get any text in the message input to include with the image
                    const messageInput = document.getElementById('message-input');
                    const messageText = messageInput?.value?.trim() || '';
                    this.uploadFile(file, messageText);
                    // Clear the input after sending
                    if (messageInput) messageInput.value = '';
                }
                break;
            }
        }
    }

    // ========================
    // Server Settings
    // ========================

    async openServerSettings() {
        // Only admins can access server settings
        const isAdmin = window.APP_CONFIG?.isAdmin || window.hasPermission('administrator');
        if (!isAdmin) {
            this.showNotification('You do not have permission to access server settings', 'error');
            return;
        }
        
        this.openModal('modal-server-settings');
        this.setupServerSettingsNavigation();
        await this.loadRoles();
        await this.loadMembers();
        await this.loadInviteCodes();
    }

    setupServerSettingsNavigation() {
        document.querySelectorAll('.server-settings-nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                
                // Update nav buttons
                document.querySelectorAll('.server-settings-nav-item').forEach(b => {
                    b.classList.remove('bg-resonance-bg-selected', 'text-white');
                    b.classList.add('text-resonance-text-secondary', 'hover:bg-resonance-bg-hover', 'hover:text-resonance-text-primary');
                });
                btn.classList.add('bg-resonance-bg-selected', 'text-white');
                btn.classList.remove('text-resonance-text-secondary', 'hover:bg-resonance-bg-hover', 'hover:text-resonance-text-primary');

                // Update content tabs
                document.querySelectorAll('.server-settings-tab').forEach(t => t.classList.add('hidden'));
                document.getElementById(`server-tab-${tab}`)?.classList.remove('hidden');
            });
        });

        // Create role button
        document.getElementById('btn-create-role')?.addEventListener('click', () => {
            this.showRoleModal();
        });

        // Role form
        document.getElementById('form-role')?.addEventListener('submit', (e) => this.handleRoleSubmit(e));
        
        // Color picker sync
        document.getElementById('role-color')?.addEventListener('input', (e) => {
            document.getElementById('role-color-hex').value = e.target.value;
        });
        document.getElementById('role-color-hex')?.addEventListener('input', (e) => {
            if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
                document.getElementById('role-color').value = e.target.value;
            }
        });

        // Save member roles button
        document.getElementById('btn-save-member-roles')?.addEventListener('click', () => this.saveMemberRoles());

        // Create invite button
        document.getElementById('btn-create-invite')?.addEventListener('click', () => {
            this.openModal('modal-invite');
        });

        // Invite form
        document.getElementById('form-invite')?.addEventListener('submit', (e) => this.handleInviteSubmit(e));

        // Delete user confirmation button
        document.getElementById('btn-confirm-delete-user')?.addEventListener('click', () => this.confirmDeleteUser());
    }

    async loadRoles() {
        try {
            const response = await fetch('/api/roles', {
                headers: { 'X-CSRF-Token': this.csrfToken }
            });
            const data = await response.json();
            
            if (data.roles) {
                this.renderRolesList(data.roles);
            }
        } catch (error) {
            console.error('Error loading roles:', error);
        }
    }

    renderRolesList(roles) {
        const container = document.getElementById('roles-list');
        if (!container) return;

        if (roles.length === 0) {
            container.innerHTML = '<p class="text-resonance-text-muted text-sm">No roles configured</p>';
            return;
        }

        container.innerHTML = roles.map(role => `
            <div class="flex items-center justify-between p-3 bg-resonance-bg-tertiary rounded hover:bg-resonance-bg-hover cursor-pointer transition-colors" 
                 data-role-id="${role.id}" onclick="app.editRole(${role.id})">
                <div class="flex items-center gap-3">
                    <div class="w-4 h-4 rounded-full" style="background-color: ${role.color}"></div>
                    <span class="text-resonance-text-primary font-medium">${this.escapeHtml(role.name)}</span>
                    ${role.is_default ? '<span class="text-xs text-resonance-text-muted">(Default)</span>' : ''}
                </div>
                <span class="material-icons text-resonance-text-muted text-sm">chevron_right</span>
            </div>
        `).join('');
        
        this.roles = roles;
    }

    showRoleModal(role = null) {
        document.getElementById('edit-role-id').value = role?.id || '';
        document.getElementById('role-name').value = role?.name || '';
        document.getElementById('role-color').value = role?.color || '#5865f2';
        document.getElementById('role-color-hex').value = role?.color || '#5865f2';
        
        // Permissions array from API (now string-based)
        const permissions = role?.permissions || [];
        
        // General Server Permissions
        document.getElementById('perm-admin').checked = permissions.includes('administrator');
        document.getElementById('perm-manage-channels').checked = permissions.includes('manage_channels');
        document.getElementById('perm-manage-roles').checked = permissions.includes('manage_roles');
        
        // Membership
        document.getElementById('perm-kick-members').checked = permissions.includes('kick_members');
        document.getElementById('perm-ban-members').checked = permissions.includes('ban_members');
        
        // Text Channels
        document.getElementById('perm-send-messages').checked = permissions.includes('send_messages');
        document.getElementById('perm-manage-messages').checked = permissions.includes('manage_messages');
        document.getElementById('perm-attach-files').checked = permissions.includes('attach_files');
        document.getElementById('perm-mention-everyone').checked = permissions.includes('mention_everyone');
        
        // Voice Channels
        document.getElementById('perm-use-voice').checked = permissions.includes('use_voice');
        document.getElementById('perm-speak').checked = permissions.includes('speak');
        document.getElementById('perm-mute-members').checked = permissions.includes('mute_members');
        document.getElementById('perm-deafen-members').checked = permissions.includes('deafen_members');
        document.getElementById('perm-move-members').checked = permissions.includes('move_members');
        document.getElementById('perm-manage-sounds').checked = permissions.includes('manage_sounds');

        document.getElementById('modal-role-title').textContent = role ? 'Edit Role' : 'Create Role';
        document.getElementById('btn-delete-role').classList.toggle('hidden', !role || role.is_default);
        
        if (role && !role.is_default) {
            document.getElementById('btn-delete-role').onclick = () => this.deleteRole(role.id);
        }
        
        this.openModal('modal-role');
    }

    editRole(roleId) {
        const role = this.roles?.find(r => r.id === roleId);
        if (role) {
            this.showRoleModal(role);
        }
    }

    async handleRoleSubmit(e) {
        e.preventDefault();

        const roleId = document.getElementById('edit-role-id').value;
        const name = document.getElementById('role-name').value.trim();
        const color = document.getElementById('role-color').value;

        // Collect permissions as array of string names
        const permissions = [];
        if (document.getElementById('perm-admin')?.checked) permissions.push('administrator');
        if (document.getElementById('perm-manage-channels')?.checked) permissions.push('manage_channels');
        if (document.getElementById('perm-manage-roles')?.checked) permissions.push('manage_roles');
        if (document.getElementById('perm-manage-messages')?.checked) permissions.push('manage_messages');
        if (document.getElementById('perm-kick-members')?.checked) permissions.push('kick_members');
        if (document.getElementById('perm-ban-members')?.checked) permissions.push('ban_members');
        if (document.getElementById('perm-manage-sounds')?.checked) permissions.push('manage_sounds');
        if (document.getElementById('perm-use-voice')?.checked) permissions.push('use_voice');
        if (document.getElementById('perm-speak')?.checked) permissions.push('speak');
        if (document.getElementById('perm-mute-members')?.checked) permissions.push('mute_members');
        if (document.getElementById('perm-deafen-members')?.checked) permissions.push('deafen_members');
        if (document.getElementById('perm-move-members')?.checked) permissions.push('move_members');
        if (document.getElementById('perm-send-messages')?.checked) permissions.push('send_messages');
        if (document.getElementById('perm-attach-files')?.checked) permissions.push('attach_files');
        if (document.getElementById('perm-mention-everyone')?.checked) permissions.push('mention_everyone');

        if (!name) {
            this.showNotification('Role name is required', 'error');
            return;
        }

        try {
            const url = roleId ? `/api/roles/${roleId}` : '/api/roles';
            const method = roleId ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.csrfToken
                },
                body: JSON.stringify({ name, color, permissions })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to save role');
            }

            this.closeModal('modal-role');
            await this.loadRoles();
            this.showNotification(roleId ? 'Role updated' : 'Role created', 'success');
        } catch (error) {
            this.showNotification(error.message, 'error');
        }
    }

    async deleteRole(roleId) {
        if (!confirm('Are you sure you want to delete this role?')) return;

        try {
            const response = await fetch(`/api/roles/${roleId}`, {
                method: 'DELETE',
                headers: { 'X-CSRF-Token': this.csrfToken }
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to delete role');
            }

            this.closeModal('modal-role');
            await this.loadRoles();
            this.showNotification('Role deleted', 'success');
        } catch (error) {
            this.showNotification(error.message, 'error');
        }
    }

    async loadMembers() {
        try {
            const response = await fetch('/api/members', {
                headers: { 'X-CSRF-Token': this.csrfToken }
            });
            const data = await response.json();
            
            if (data.members) {
                this.renderMembersList(data.members);
            }
        } catch (error) {
            console.error('Error loading members:', error);
        }
    }

    renderMembersList(members) {
        const container = document.getElementById('members-list');
        if (!container) return;

        if (members.length === 0) {
            container.innerHTML = '<p class="text-resonance-text-muted text-sm">No members found</p>';
            return;
        }

        const currentUserId = window.APP_CONFIG?.userId;
        const isCurrentUserAdmin = window.APP_CONFIG?.isAdmin;

        container.innerHTML = members.map(member => {
            const avatarHtml = member.avatar 
                ? `<img src="${member.avatar}" class="w-10 h-10 rounded-full object-cover" alt="">`
                : `<div class="w-10 h-10 rounded-full bg-resonance-brand flex items-center justify-center text-white font-semibold">${member.username.charAt(0).toUpperCase()}</div>`;
            
            // Check if target member has admin role
            const memberRoles = member.roles || [];
            const isMemberAdmin = memberRoles.some(r => r.name === 'Admin');
            
            // Can only delete: if current user is admin, target is not self, and target is not admin
            const showDelete = isCurrentUserAdmin && member.id !== currentUserId && !isMemberAdmin;
            
            return `
            <div class="flex items-center justify-between p-3 bg-resonance-bg-tertiary rounded hover:bg-resonance-bg-hover transition-colors">
                <div class="flex items-center gap-3 flex-1 cursor-pointer" onclick="app.openMemberRoles(${member.id}, '${this.escapeHtml(member.username)}')">
                    ${avatarHtml}
                    <div>
                        <div class="text-resonance-text-primary font-medium" style="color: ${member.role_color || '#fff'}">${this.escapeHtml(member.display_name || member.username)}</div>
                        <div class="text-xs text-resonance-text-muted">${this.escapeHtml(member.username)}</div>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <div class="flex gap-1">
                        ${memberRoles.map(r => `
                            <span class="px-2 py-0.5 text-xs rounded" style="background-color: ${r.color}20; color: ${r.color}">${this.escapeHtml(r.name)}</span>
                        `).join('')}
                    </div>
                    ${showDelete ? `
                        <button onclick="event.stopPropagation(); app.showDeleteUserModal(${member.id}, '${this.escapeHtml(member.username)}')" 
                                class="p-2 rounded hover:bg-resonance-danger text-resonance-text-muted hover:text-white transition-colors ml-2" title="Delete user">
                            <span class="material-icons text-sm">delete</span>
                        </button>
                    ` : ''}
                </div>
            </div>
        `}).join('');
        
        this.members = members;

        // Search filter
        document.getElementById('member-search')?.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            container.querySelectorAll('[onclick]').forEach(el => {
                const name = el.textContent.toLowerCase();
                el.style.display = name.includes(query) ? '' : 'none';
            });
        });
    }

    async openMemberRoles(userId, username) {
        document.getElementById('assign-role-user-id').value = userId;
        document.getElementById('assign-role-username').textContent = username;
        document.getElementById('assign-role-avatar').textContent = username.charAt(0).toUpperCase();

        // Load available roles and user's current roles
        try {
            const [rolesRes, userRolesRes] = await Promise.all([
                fetch('/api/roles', { headers: { 'X-CSRF-Token': this.csrfToken } }),
                fetch(`/api/members/${userId}/roles`, { headers: { 'X-CSRF-Token': this.csrfToken } })
            ]);

            const rolesData = await rolesRes.json();
            const userRolesData = await userRolesRes.json();

            const userRoleIds = (userRolesData.roles || []).map(r => r.id);
            const container = document.getElementById('assign-role-list');
            
            container.innerHTML = (rolesData.roles || []).map(role => `
                <label class="flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-resonance-bg-hover">
                    <input type="checkbox" value="${role.id}" ${userRoleIds.includes(role.id) ? 'checked' : ''} ${role.is_default ? 'disabled' : ''}
                           class="w-4 h-4 rounded bg-resonance-input border-resonance-bg-hover text-resonance-brand focus:ring-resonance-brand">
                    <div class="w-3 h-3 rounded-full" style="background-color: ${role.color}"></div>
                    <span class="text-sm text-resonance-text-primary">${this.escapeHtml(role.name)}</span>
                    ${role.is_default ? '<span class="text-xs text-resonance-text-muted">(Default)</span>' : ''}
                </label>
            `).join('');

            this.openModal('modal-assign-role');
        } catch (error) {
            console.error('Error loading member roles:', error);
            this.showNotification('Failed to load member roles', 'error');
        }
    }

    async saveMemberRoles() {
        const userId = document.getElementById('assign-role-user-id').value;
        const checkboxes = document.querySelectorAll('#assign-role-list input[type="checkbox"]:checked');
        const roleIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

        try {
            const response = await fetch(`/api/members/${userId}/roles`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.csrfToken
                },
                body: JSON.stringify({ roles: roleIds })
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to update roles');
            }

            this.closeModal('modal-assign-role');
            await this.loadMembers();
            this.showNotification('Member roles updated', 'success');
        } catch (error) {
            this.showNotification(error.message, 'error');
        }
    }

    // ========================
    // Invite Codes Management
    // ========================

    async loadInviteCodes() {
        try {
            const response = await fetch('/api/admin/invite-codes', {
                headers: { 'X-CSRF-Token': this.csrfToken }
            });
            
            if (response.status === 403) {
                document.getElementById('invites-list').innerHTML = 
                    '<p class="text-resonance-text-muted text-sm">You don\'t have permission to manage invite codes.</p>';
                return;
            }
            
            const data = await response.json();
            
            if (data.codes) {
                this.renderInvitesList(data.codes);
            }
        } catch (error) {
            console.error('Error loading invite codes:', error);
        }
    }

    renderInvitesList(codes) {
        const container = document.getElementById('invites-list');
        if (!container) return;

        if (codes.length === 0) {
            container.innerHTML = '<p class="text-resonance-text-muted text-sm">No invite codes yet. Create one to invite new members.</p>';
            return;
        }

        container.innerHTML = codes.map(code => {
            const isExpired = code.expires_at && new Date(code.expires_at) < new Date();
            const isMaxedOut = code.max_uses && code.uses >= code.max_uses;
            const isValid = !isExpired && !isMaxedOut;
            
            return `
            <div class="flex items-center justify-between p-3 bg-resonance-bg-tertiary rounded ${isValid ? '' : 'opacity-50'}">
                <div class="flex items-center gap-4">
                    <div class="font-mono text-lg tracking-widest ${isValid ? 'text-resonance-brand' : 'text-resonance-text-muted'}">${code.code}</div>
                    <div class="text-sm text-resonance-text-muted">
                        <span>Uses: ${code.uses}${code.max_uses ? '/' + code.max_uses : ''}</span>
                        ${code.expires_at ? ` • ${isExpired ? 'Expired' : 'Expires: ' + new Date(code.expires_at).toLocaleDateString()}` : ' • Never expires'}
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="app.copyInviteCode('${code.code}')" class="p-2 rounded hover:bg-resonance-bg-hover text-resonance-text-muted hover:text-white transition-colors" title="Copy code">
                        <span class="material-icons text-sm">content_copy</span>
                    </button>
                    <button onclick="app.revokeInviteCode(${code.id})" class="p-2 rounded hover:bg-resonance-danger text-resonance-text-muted hover:text-white transition-colors" title="Revoke code">
                        <span class="material-icons text-sm">delete</span>
                    </button>
                </div>
            </div>
        `}).join('');
    }

    copyInviteCode(code) {
        navigator.clipboard.writeText(code).then(() => {
            this.showNotification('Invite code copied to clipboard', 'success');
        }).catch(() => {
            this.showNotification('Failed to copy code', 'error');
        });
    }

    async handleInviteSubmit(e) {
        e.preventDefault();

        const maxUses = document.getElementById('invite-max-uses').value;
        const expiresIn = document.getElementById('invite-expires').value;

        try {
            const response = await fetch('/api/admin/invite-codes', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.csrfToken
                },
                body: JSON.stringify({
                    max_uses: maxUses ? parseInt(maxUses) : null,
                    expires_in: expiresIn ? parseInt(expiresIn) : null
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to create invite code');
            }

            this.closeModal('modal-invite');
            document.getElementById('form-invite').reset();
            await this.loadInviteCodes();
            this.showNotification(`Invite code created: ${data.code.code}`, 'success');
        } catch (error) {
            this.showNotification(error.message, 'error');
        }
    }

    async revokeInviteCode(codeId) {
        if (!confirm('Are you sure you want to revoke this invite code?')) return;

        try {
            const response = await fetch(`/api/admin/invite-codes/${codeId}`, {
                method: 'DELETE',
                headers: { 'X-CSRF-Token': this.csrfToken }
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to revoke invite code');
            }

            await this.loadInviteCodes();
            this.showNotification('Invite code revoked', 'success');
        } catch (error) {
            this.showNotification(error.message, 'error');
        }
    }

    // ========================
    // User Deletion (Admin)
    // ========================

    showDeleteUserModal(userId, username) {
        document.getElementById('delete-user-id').value = userId;
        document.getElementById('delete-user-name').textContent = username;
        this.openModal('modal-delete-user');
    }

    async confirmDeleteUser() {
        const userId = document.getElementById('delete-user-id').value;

        try {
            const response = await fetch(`/api/admin/users/${userId}`, {
                method: 'DELETE',
                headers: { 'X-CSRF-Token': this.csrfToken }
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to delete user');
            }

            this.closeModal('modal-delete-user');
            await this.loadMembers();
            this.showNotification('User deleted successfully', 'success');
        } catch (error) {
            this.showNotification(error.message, 'error');
        }
    }

    showNotification(message, type = 'info') {
        document.querySelector('.notification')?.remove();

        const notification = document.createElement('div');
        const typeClasses = {
            'info': 'bg-resonance-brand',
            'success': 'bg-resonance-success',
            'error': 'bg-resonance-danger',
            'warning': 'bg-yellow-500'
        };
        notification.className = `notification fixed bottom-4 right-4 px-4 py-3 rounded-lg text-white font-medium shadow-lg z-50 transition-opacity duration-300 ${typeClasses[type] || typeClasses.info}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    updateVoiceChannelUI(data) {
        // Handle voice state updates from server
        console.log('Voice state update:', data);
        
        if (data.action === 'leave') {
            // Remove user from all voice member lists in sidebar
            document.querySelectorAll(`.voice-member[data-user-id="${data.user_id}"]`).forEach(el => el.remove());
            
            // Remove from voice display (main voice view) - both regular card and screen share tile
            document.querySelectorAll(`#voice-members-display [data-user-id="${data.user_id}"]`).forEach(el => el.remove());
            
            // Update grid layout
            this.updateVoiceGridLayout();
            
            // Remove speaking indicator
            this.updateSpeakingIndicator(data.user_id, false);
        } else if (data.action === 'join') {
            // Add user to sidebar voice member list
            const sidebarContainer = document.getElementById(`voice-members-${data.channel_id}`);
            if (sidebarContainer && !sidebarContainer.querySelector(`[data-user-id="${data.user_id}"]`)) {
                // Check if user can disconnect members
                const canDisconnect = window.hasPermission('move_members') || window.hasPermission('administrator');
                
                const li = document.createElement('li');
                li.className = 'voice-member flex items-center gap-2 py-1 px-2 rounded text-resonance-text-secondary text-sm group';
                li.dataset.userId = data.user_id;
                
                const avatarHtml = data.avatar 
                    ? `<img src="${data.avatar}" class="w-6 h-6 rounded-full object-cover" alt="">`
                    : `<div class="w-6 h-6 rounded-full bg-resonance-brand flex items-center justify-center text-xs font-semibold text-white">${(data.username || 'U').charAt(0).toUpperCase()}</div>`;
                
                const disconnectBtnHtml = canDisconnect 
                    ? `<button class="btn-disconnect-member hidden group-hover:block p-0.5 rounded hover:bg-resonance-danger/20" data-user-id="${data.user_id}" title="Disconnect">
                        <span class="material-icons text-sm text-resonance-danger">call_end</span>
                    </button>`
                    : '';
                
                li.innerHTML = `
                    <div class="member-avatar">${avatarHtml}</div>
                    <span class="member-name truncate flex-1">${data.username || 'User'}</span>
                    ${disconnectBtnHtml}
                `;
                sidebarContainer.appendChild(li);
            }
        }
    }

    addOnlineUser(user) {
        const list = document.getElementById('online-users');
        if (!list || list.querySelector(`[data-user-id="${user.user_id}"]`)) return;

        const li = document.createElement('li');
        li.className = 'member-item flex items-center gap-3 px-2 py-1.5 rounded cursor-pointer hover:bg-resonance-bg-hover user-clickable';
        li.dataset.userId = user.user_id;
        const avatarHtml = user.avatar 
            ? `<img src="${user.avatar}" class="w-8 h-8 rounded-full object-cover" alt="">`
            : `<div class="w-8 h-8 rounded-full bg-resonance-brand flex items-center justify-center text-white text-sm font-medium">${user.username.charAt(0).toUpperCase()}</div>`;
        li.innerHTML = `
            <div class="relative">
                ${avatarHtml}
                <span class="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-resonance-success rounded-full border-2 border-resonance-bg-secondary"></span>
            </div>
            <span class="text-resonance-text-secondary text-sm font-medium">${user.display_name || user.username}</span>
        `;
        list.appendChild(li);
        
        const count = document.getElementById('online-count');
        if (count) count.textContent = list.children.length;
    }

    removeOnlineUser(userId) {
        const userEl = document.querySelector(`#online-users [data-user-id="${userId}"]`);
        if (userEl) {
            userEl.remove();
            const count = document.getElementById('online-count');
            const list = document.getElementById('online-users');
            if (count && list) count.textContent = list.children.length;
        }
    }

    async playSound(soundId) {
        try {
            await this.soundboardManager.playSoundById(soundId);
        } catch (error) {
            console.error('Error playing sound:', error);
            this.showNotification('Failed to play sound', 'error');
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
