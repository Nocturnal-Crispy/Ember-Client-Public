/**
 * InviteEphemeralKeyService - Manages ephemeral key distributions for Signal Protocol invites.
 *
 * Handles creation, distribution, and processing of ephemeral keys for
 * invite-based Signal Protocol group key establishment.
 */

import type { AuthData } from '../../shared';
import { SignalSessionManager } from '../managers/signal-session-manager';

export interface InviteEphemeralKeyPackage {
  invite_id: string;
  ember_id: string;
  epoch_id: string;
  encrypted_package: string;
  created_at: number;
}

export interface InviteSenderKeyDistribution {
  invite_id: string;
  ember_id: string;
  sender_user_id: string;
  sender_device_id: string;
  distribution_message: string;
  created_at: number;
}

export interface InvitePendingPredistribution {
  invite_id: string;
  ember_id: string;
  user_id: string;
  device_id: string;
  predistribution_data: string;
  created_at: number;
}

export interface CreateInviteEphemeralKeysRequest {
  invite_id: string;
  ember_id: string;
  epoch_id: string;
  key_packages: {
    user_id: string;
    device_id: string;
    encrypted_key_package: string;
  }[];
}

export interface CreateSenderKeyDistributionRequest {
  invite_id: string;
  ember_id: string;
  distribution_message: string;
}

export class InviteEphemeralKeyService {
  private auth: AuthData;
  private signalSessionManager: SignalSessionManager;

  constructor(auth: AuthData, signalSessionManager: SignalSessionManager) {
    if (!auth) {
      throw new Error('Auth data is required');
    }
    if (!signalSessionManager) {
      throw new Error('SignalSessionManager is required');
    }

    this.auth = auth;
    this.signalSessionManager = signalSessionManager;
  }

  /**
   * Get the base URL for API calls
   */
  private getBaseUrl(): string {
    return this.auth.hostname.startsWith('http') ? this.auth.hostname : `https://${this.auth.hostname}`;
  }

  /**
   * Create ephemeral key packages for an invite
   */
  async createInviteEphemeralKeys(request: CreateInviteEphemeralKeysRequest): Promise<void> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v1/invites/${request.invite_id}/ephemeral-keys`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Failed to create invite ephemeral keys: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to create invite ephemeral keys:', error);
      throw error;
    }
  }

  /**
   * Get ephemeral key packages for an invite
   */
  async getInviteEphemeralKeys(inviteId: string): Promise<InviteEphemeralKeyPackage[]> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v1/invites/${inviteId}/ephemeral-keys`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch invite ephemeral keys: ${response.status}`);
      }

      const data = await response.json();
      return data.ephemeral_keys || [];
    } catch (error) {
      console.error('Failed to get invite ephemeral keys:', error);
      throw error;
    }
  }

  /**
   * Create sender key distribution for an invite
   */
  async createInviteSenderKeyDistribution(request: CreateSenderKeyDistributionRequest): Promise<void> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v1/invites/${request.invite_id}/sender-key-distributions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Failed to create invite sender key distribution: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to create invite sender key distribution:', error);
      throw error;
    }
  }

  /**
   * Get sender key distributions for an invite
   */
  async getInviteSenderKeyDistributions(inviteId: string): Promise<InviteSenderKeyDistribution[]> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v1/invites/${inviteId}/sender-key-distributions`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch invite sender key distributions: ${response.status}`);
      }

      const data = await response.json();
      return data.sender_key_distributions || [];
    } catch (error) {
      console.error('Failed to get invite sender key distributions:', error);
      throw error;
    }
  }

  /**
   * Get pending predistributions for an invite
   */
  async getInvitePendingPredistributions(inviteId: string): Promise<InvitePendingPredistribution[]> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v1/invites/${inviteId}/pending-predistributions`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch invite pending predistributions: ${response.status}`);
      }

      const data = await response.json();
      return data.pending_predistributions || [];
    } catch (error) {
      console.error('Failed to get invite pending predistributions:', error);
      throw error;
    }
  }

  /**
   * Process pending predistributions for an invite
   */
  async processInvitePendingPredistributions(inviteId: string): Promise<void> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v1/invites/${inviteId}/pending-predistributions/process`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to process invite pending predistributions: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to process invite pending predistributions:', error);
      throw error;
    }
  }

  /**
   * Generate ephemeral key packages for invite acceptance
   */
  async generateInviteEphemeralKeys(inviteId: string, emberId: string): Promise<CreateInviteEphemeralKeysRequest> {
    try {
      // Get current epoch for the ember
      const currentEpoch = await this.signalSessionManager.getCurrentEpoch(emberId);
      if (!currentEpoch) {
        throw new Error('No current epoch found for ember');
      }

      // Generate ephemeral key packages for the current user's devices
      const keyPackages = [];
      
      // For now, generate a simple key package (in reality, this would use proper cryptographic operations)
      const ephemeralKey = this.generateEphemeralKey();
      
      keyPackages.push({
        user_id: this.auth.user_id,
        device_id: this.auth.device_id,
        encrypted_key_package: await this.encryptEphemeralKeyPackage(ephemeralKey, currentEpoch.id),
      });

      return {
        invite_id: inviteId,
        ember_id: emberId,
        epoch_id: currentEpoch.id,
        key_packages: keyPackages,
      };
    } catch (error) {
      console.error('Failed to generate invite ephemeral keys:', error);
      throw error;
    }
  }

  /**
   * Generate sender key distribution for invite
   */
  async generateInviteSenderKeyDistribution(inviteId: string, emberId: string): Promise<CreateSenderKeyDistributionRequest> {
    try {
      // Create sender key distribution using SignalSessionManager
      const distributionMessage = await this.signalSessionManager.createSenderKeyDistribution(emberId);
      
      // Convert to base64 for transport
      // P1-3 FIX: Use Buffer-based encoding to prevent stack overflow for large payloads
      const distributionMessageBase64 = Buffer.from(distributionMessage).toString('base64');

      return {
        invite_id: inviteId,
        ember_id: emberId,
        distribution_message: distributionMessageBase64,
      };
    } catch (error) {
      console.error('Failed to generate invite sender key distribution:', error);
      throw error;
    }
  }

  /**
   * Process invite ephemeral keys on acceptance
   */
  async processInviteEphemeralKeys(inviteId: string, emberId: string): Promise<void> {
    try {
      // Get all ephemeral key packages for the invite
      const ephemeralKeys = await this.getInviteEphemeralKeys(inviteId);
      
      // Process each key package
      for (const keyPackage of ephemeralKeys) {
        await this.processEphemeralKeyPackage(keyPackage);
      }

      // Get and process sender key distributions
      const senderKeyDistributions = await this.getInviteSenderKeyDistributions(inviteId);
      
      for (const distribution of senderKeyDistributions) {
        await this.processSenderKeyDistribution(distribution);
      }

      // Process pending predistributions
      await this.processInvitePendingPredistributions(inviteId);
    } catch (error) {
      console.error('Failed to process invite ephemeral keys:', error);
      throw error;
    }
  }

  /**
   * Process an individual ephemeral key package
   */
  private async processEphemeralKeyPackage(keyPackage: InviteEphemeralKeyPackage): Promise<void> {
    try {
      // Decrypt the key package (simplified implementation)
      const decryptedPackage = await this.decryptEphemeralKeyPackage(keyPackage.encrypted_package);
      
      // Store the ephemeral key for the current epoch
      // In reality, this would integrate with the SignalSessionManager
      console.log('Processed ephemeral key package:', {
        invite_id: keyPackage.invite_id,
        ember_id: keyPackage.ember_id,
        epoch_id: keyPackage.epoch_id,
      });
    } catch (error) {
      console.error('Failed to process ephemeral key package:', error);
      throw error;
    }
  }

  /**
   * Process a sender key distribution
   */
  private async processSenderKeyDistribution(distribution: InviteSenderKeyDistribution): Promise<void> {
    try {
      // Convert base64 back to bytes
      const distributionBytes = new Uint8Array(
        atob(distribution.distribution_message)
          .split('')
          .map(char => char.charCodeAt(0))
      );

      // Process using SignalSessionManager
      await this.signalSessionManager.processSenderKeyDistribution(
        `${distribution.sender_user_id}.${distribution.sender_device_id}`,
        distributionBytes
      );

      console.log('Processed sender key distribution:', {
        invite_id: distribution.invite_id,
        ember_id: distribution.ember_id,
        sender_user_id: distribution.sender_user_id,
        sender_device_id: distribution.sender_device_id,
      });
    } catch (error) {
      console.error('Failed to process sender key distribution:', error);
      throw error;
    }
  }

  /**
   * Generate an ephemeral key (simplified implementation)
   */
  private generateEphemeralKey(): string {
    // In reality, this would use proper cryptographic key generation
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Encrypt an ephemeral key package (simplified implementation)
   */
  private async encryptEphemeralKeyPackage(key: string, epochId: string): Promise<string> {
    // In reality, this would use proper cryptographic encryption with the epoch key
    // For now, return a base64-encoded placeholder
    const packageData = JSON.stringify({
      ephemeral_key: key,
      epoch_id: epochId,
      timestamp: Date.now(),
    });
    
    return btoa(packageData);
  }

  /**
   * Decrypt an ephemeral key package (simplified implementation)
   */
  private async decryptEphemeralKeyPackage(encryptedPackage: string): Promise<any> {
    // In reality, this would use proper cryptographic decryption
    // For now, decode the base64 and parse JSON
    const packageData = atob(encryptedPackage);
    return JSON.parse(packageData);
  }

  /**
   * Setup complete ephemeral key distribution for an invite
   */
  async setupInviteEphemeralKeys(inviteId: string, emberId: string): Promise<void> {
    try {
      // Generate and create ephemeral key packages
      const ephemeralKeysRequest = await this.generateInviteEphemeralKeys(inviteId, emberId);
      await this.createInviteEphemeralKeys(ephemeralKeysRequest);

      // Generate and create sender key distribution
      const senderKeyRequest = await this.generateInviteSenderKeyDistribution(inviteId, emberId);
      await this.createInviteSenderKeyDistribution(senderKeyRequest);

      console.log('Invite ephemeral keys setup complete:', {
        invite_id: inviteId,
        ember_id: emberId,
      });
    } catch (error) {
      console.error('Failed to setup invite ephemeral keys:', error);
      throw error;
    }
  }

  /**
   * Complete invite acceptance with ephemeral key processing
   */
  async completeInviteAcceptance(inviteId: string, emberId: string): Promise<void> {
    try {
      // Process all ephemeral keys and distributions
      await this.processInviteEphemeralKeys(inviteId, emberId);

      console.log('Invite acceptance completed with ephemeral key processing:', {
        invite_id: inviteId,
        ember_id: emberId,
      });
    } catch (error) {
      console.error('Failed to complete invite acceptance:', error);
      throw error;
    }
  }
}

// Export globally for script loading compatibility
(window as any).InviteEphemeralKeyService = InviteEphemeralKeyService;
