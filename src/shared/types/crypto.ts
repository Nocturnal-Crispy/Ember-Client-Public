/** Signal Protocol group messaging crypto state types. */

/** Encryption mode for a conversation/ember. */
export type CryptoMode = 'pairwise_bootstrap' | 'sender_key_active';

/** Sender key distribution lifecycle status. */
export type SenderKeyStatus = 'not_initialized' | 'distributing' | 'active' | 'rotation_required';

/** Wire type for message envelope routing. */
export type WireType = 'prekey' | 'signal' | 'sender_key';

/** Distribution receipt status for tracking per-member acknowledgment. */
export type DistributionReceiptStatus = 'pending' | 'sent' | 'acknowledged';

/** Per-ember crypto state tracking the sender key lifecycle. */
export interface ConversationCryptoState {
  readonly cryptoMode: CryptoMode;
  readonly senderKeyStatus: SenderKeyStatus;
  readonly activeDistributionId: string | null;
  readonly senderKeyEpoch: number;
}

/** Message envelope with wire type for decryption routing. */
export interface CryptoMessageEnvelope {
  readonly messageId: string;
  readonly conversationId: string;
  readonly wireType: WireType;
  readonly distributionId: string | null;
  readonly ciphertext: string;
  readonly senderAddress: string;
}

/** Tracks per-recipient sender key distribution acknowledgment. */
export interface SenderKeyDistributionReceipt {
  readonly conversationId: string;
  readonly distributionId: string;
  readonly recipientUserId: string;
  readonly recipientDeviceId: string;
  readonly status: DistributionReceiptStatus;
  readonly epoch: number;
}

/** Default crypto state for newly created embers/conversations. */
export const DEFAULT_CRYPTO_STATE: ConversationCryptoState = {
  cryptoMode: 'pairwise_bootstrap',
  senderKeyStatus: 'not_initialized',
  activeDistributionId: null,
  senderKeyEpoch: 0,
};
