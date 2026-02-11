/**
 * WebSocket Connection Manager
 * Handles connection, reconnection, and message routing
 */
class WebSocketManager {
    constructor(config) {
        this.config = config;
        this.socket = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.handlers = {};
        this.messageQueue = [];
        this.isConnected = false;
        this.isClosingIntentionally = false;

        // Close WebSocket cleanly on page unload/reload
        window.addEventListener('beforeunload', () => {
            this.isClosingIntentionally = true;
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.close(1000, 'Page unload');
            }
        });
    }

    connect() {
        const wsUrl = `ws://${this.config.wsHost}:${this.config.wsPort}`;
        
        console.log(`Connecting to WebSocket: ${wsUrl}`);

        // Close any existing socket before creating a new one
        if (this.socket) {
            this.isClosingIntentionally = true;
            try { this.socket.close(); } catch(e) {}
            this.socket = null;
        }
        this.isClosingIntentionally = false;

        this.socket = new WebSocket(wsUrl);
        
        this.socket.onopen = () => this.handleOpen();
        this.socket.onclose = (e) => this.handleClose(e);
        this.socket.onerror = (e) => this.handleError(e);
        this.socket.onmessage = (e) => this.handleMessage(e);
    }

    handleOpen() {
        console.log('WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        // Authenticate
        this.send({
            type: 'auth',
            user_id: this.config.userId,
            session_token: this.config.csrfToken
        });
        
        // Flush queued messages
        while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift();
            this.send(msg);
        }
        
        this.emit('connected');
    }

    handleClose(event) {
        console.log('WebSocket closed', event);
        this.isConnected = false;
        this.emit('disconnected');
        
        // Don't reconnect if page is unloading or we closed intentionally
        if (this.isClosingIntentionally) {
            return;
        }
        
        // Attempt reconnection
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
            setTimeout(() => this.connect(), delay);
        } else {
            console.error('Max reconnection attempts reached');
            this.emit('reconnect_failed');
        }
    }

    handleError(error) {
        console.error('WebSocket error', error);
        this.emit('error', error);
    }

    handleMessage(event) {
        try {
            const data = JSON.parse(event.data);
            console.log('WebSocket message:', data);
            
            // Emit specific event type
            if (data.type) {
                this.emit(data.type, data);
            }
            
            // Emit generic message event
            this.emit('message', data);
        } catch (error) {
            console.error('Failed to parse message:', error);
        }
    }

    send(data) {
        if (this.isConnected && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(data));
        } else {
            // Queue message for later
            this.messageQueue.push(data);
        }
    }

    on(event, handler) {
        if (!this.handlers[event]) {
            this.handlers[event] = [];
        }
        this.handlers[event].push(handler);
    }

    off(event, handler) {
        if (this.handlers[event]) {
            this.handlers[event] = this.handlers[event].filter(h => h !== handler);
        }
    }

    emit(event, data) {
        if (this.handlers[event]) {
            this.handlers[event].forEach(handler => handler(data));
        }
    }

    disconnect() {
        if (this.socket) {
            this.socket.close();
        }
    }

    // Chat specific methods
    joinChannel(channelId) {
        this.send({ type: 'join_channel', channel_id: channelId });
    }

    leaveChannel(channelId) {
        this.send({ type: 'leave_channel', channel_id: channelId });
    }

    sendMessage(channelId, content) {
        this.send({
            type: 'chat_message',
            channel_id: channelId,
            content: content
        });
    }

    sendTyping(channelId) {
        this.send({
            type: 'typing',
            channel_id: channelId
        });
    }

    // Voice specific methods
    joinVoice(channelId) {
        this.send({ type: 'join_voice', channel_id: channelId });
    }

    leaveVoice() {
        this.send({ type: 'leave_voice' });
    }

    sendWebRTCOffer(targetUserId, offer) {
        this.send({
            type: 'webrtc_offer',
            target_user_id: targetUserId,
            payload: offer
        });
    }

    sendWebRTCAnswer(targetUserId, answer) {
        this.send({
            type: 'webrtc_answer',
            target_user_id: targetUserId,
            payload: answer
        });
    }

    sendWebRTCIce(targetUserId, candidate) {
        this.send({
            type: 'webrtc_ice',
            target_user_id: targetUserId,
            payload: candidate
        });
    }

    playSound(channelId, soundId) {
        this.send({
            type: 'play_sound',
            channel_id: channelId,
            sound_id: soundId
        });
    }

    sendSpeaking(speaking) {
        this.send({
            type: 'speaking',
            speaking: speaking
        });
    }

    forceDisconnectVoice(targetUserId) {
        this.send({
            type: 'force_disconnect_voice',
            target_user_id: targetUserId
        });
    }

    // Camera and stream specific methods
    sendCameraState(cameraOn) {
        this.send({
            type: 'camera_state',
            camera_on: cameraOn
        });
    }

    sendScreenShareState(screenSharing) {
        this.send({
            type: 'screen_share_state',
            screen_sharing: screenSharing
        });
    }

    // DM specific methods
    joinDm(channelId) {
        this.send({ type: 'join_dm', channel_id: channelId });
    }

    leaveDm(channelId) {
        this.send({ type: 'leave_dm', channel_id: channelId });
    }

    sendDmMessage(channelId, content) {
        this.send({
            type: 'dm_message',
            channel_id: channelId,
            content: content
        });
    }

    sendDmTyping(channelId) {
        this.send({
            type: 'dm_typing',
            channel_id: channelId
        });
    }

    joinDmVoice(channelId, targetUserId) {
        this.send({
            type: 'join_dm_voice',
            channel_id: channelId,
            target_user_id: targetUserId
        });
    }
}

// Export for use in other modules
window.WebSocketManager = WebSocketManager;
