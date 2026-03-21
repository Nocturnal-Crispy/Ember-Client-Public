/**
 * WebSocket client for real-time messaging in Ember
 * Handles channel messaging, presence, and ember subscriptions
 */

export interface WebSocketMessage {
	type: string;
	payload?: any;
	channel_id?: string;
	ember_id?: string;
}

export interface PresenceUpdate {
	user_id: string;
	status: 'online' | 'offline' | 'away' | 'invisible';
	username: string;
}

export interface WebSocketConfig {
	url: string;
	token: string;
	reconnectAttempts?: number;
	reconnectDelay?: number;
}

export class EmberWebSocket {
	private ws: WebSocket | null = null;
	private config: WebSocketConfig;
	private reconnectAttempts = 0;
	private maxReconnectAttempts: number;
	private reconnectDelay: number;
	private isConnecting = false;
	private isManualClose = false;

	// Event handlers
	private onMessageHandlers: Map<string, ((payload: any) => void)[]> = new Map();
	private onConnectionChangeHandlers: ((connected: boolean) => void)[] = [];
	private onErrorHandlers: ((error: Error) => void)[] = [];

	constructor(config: WebSocketConfig) {
		this.config = config;
		this.maxReconnectAttempts = config.reconnectAttempts || 5;
		this.reconnectDelay = config.reconnectDelay || 1000;
	}

	/**
	 * Connect to WebSocket server
	 */
	public connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
				resolve();
				return;
			}

			this.isConnecting = true;
			this.isManualClose = false;

			const wsUrl = `${this.config.url}?token=${this.config.token}`;
			this.ws = new WebSocket(wsUrl);

			this.ws.onopen = () => {
				this.isConnecting = false;
				this.reconnectAttempts = 0;
				this.notifyConnectionChange(true);
				console.log('WebSocket connected');
				resolve();
			};

			this.ws.onclose = (event) => {
				this.isConnecting = false;
				this.notifyConnectionChange(false);

				if (!this.isManualClose && this.reconnectAttempts < this.maxReconnectAttempts) {
					console.log(`WebSocket disconnected, attempting reconnect (${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
					this.reconnectAttempts++;
					setTimeout(() => {
						this.connect().catch(console.error);
					}, this.reconnectDelay * this.reconnectAttempts);
				} else {
					console.log('WebSocket connection closed permanently');
				}
			};

			this.ws.onerror = (error) => {
				this.isConnecting = false;
				const errorObj = new Error(`WebSocket error: ${error}`);
				this.notifyError(errorObj);
				reject(errorObj);
			};

			this.ws.onmessage = (event) => {
				try {
					const message: WebSocketMessage = JSON.parse(event.data);
					this.handleMessage(message);
				} catch (error) {
					console.error('Failed to parse WebSocket message:', error);
				}
			};
		});
	}

	/**
	 * Disconnect from WebSocket server
	 */
	public disconnect(): void {
		this.isManualClose = true;
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}

	/**
	 * Subscribe to a channel
	 */
	public subscribeToChannel(channelId: string): void {
		this.sendMessage({
			type: 'subscribe',
			channel_id: channelId,
		});
	}

	/**
	 * Unsubscribe from a channel
	 */
	public unsubscribeFromChannel(channelId: string): void {
		this.sendMessage({
			type: 'unsubscribe',
			channel_id: channelId,
		});
	}

	/**
	 * Subscribe to an ember
	 */
	public subscribeToEmber(emberId: string): void {
		this.sendMessage({
			type: 'subscribe_ember',
			ember_id: emberId,
		});
	}

	/**
	 * Register handler for presence updates
	 */
	public onPresenceUpdate(handler: (presence: PresenceUpdate) => void): void {
		this.addHandler('presence_update', handler);
	}

	/**
	 * Register handler for connection state changes
	 */
	public onConnectionChange(handler: (connected: boolean) => void): void {
		this.onConnectionChangeHandlers.push(handler);
	}

	/**
	 * Register handler for errors
	 */
	public onError(handler: (error: Error) => void): void {
		this.onErrorHandlers.push(handler);
	}

	/**
	 * Get current connection state
	 */
	public get isConnected(): boolean {
		return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
	}

	/**
	 * Send a message to the WebSocket server
	 */
	private sendMessage(message: WebSocketMessage): void {
		if (this.isConnected && this.ws) {
			this.ws.send(JSON.stringify(message));
		} else {
			console.warn('WebSocket not connected, message not sent:', message);
		}
	}

	/**
	 * Handle incoming WebSocket messages
	 */
	private handleMessage(message: WebSocketMessage): void {
		const handlers = this.onMessageHandlers.get(message.type);
		if (handlers) {
			handlers.forEach(handler => {
				try {
					handler(message.payload);
				} catch (error) {
					console.error(`Error in handler for message type ${message.type}:`, error);
				}
			});
		} else {
			console.log('Unhandled WebSocket message type:', message.type);
		}
	}

	/**
	 * Register a handler for a specific message type
	 */
	private addHandler(type: string, handler: (payload: any) => void): void {
		if (!this.onMessageHandlers.has(type)) {
			this.onMessageHandlers.set(type, []);
		}
		this.onMessageHandlers.get(type)!.push(handler);
	}

	/**
	 * Notify all connection change handlers
	 */
	private notifyConnectionChange(connected: boolean): void {
		this.onConnectionChangeHandlers.forEach(handler => {
			try {
				handler(connected);
			} catch (error) {
				console.error('Error in connection change handler:', error);
			}
		});
	}

	/**
	 * Notify all error handlers
	 */
	private notifyError(error: Error): void {
		this.onErrorHandlers.forEach(handler => {
			try {
				handler(error);
			} catch (error) {
				console.error('Error in error handler:', error);
			}
		});
	}
}

/**
 * Factory function to create a new WebSocket client
 */
export function createWebSocketClient(config: WebSocketConfig): EmberWebSocket {
	return new EmberWebSocket(config);
}
