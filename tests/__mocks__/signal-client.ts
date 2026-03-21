/**
 * Mock for @signalapp/libsignal-client
 * 
 * This mock provides basic implementations for the Signal client classes
 * used in tests, avoiding the ES module import issues.
 */

export class SessionStore {
  constructor() {}
}

export class IdentityKeyStore {
  constructor() {}
}

export class PreKeyStore {
  constructor() {}
}

export class SignedPreKeyStore {
  constructor() {}
}

export class KyberPreKeyStore {
  constructor() {}
}

export class SenderKeyStore {
  constructor() {}
}

export class PrivateKey {
  static generate(): PrivateKey {
    return new PrivateKey();
  }

  static deserialize(data: Uint8Array): PrivateKey {
    return new PrivateKey();
  }

  serialize(): Uint8Array {
    return new Uint8Array(32);
  }

  getPublicKey(): PublicKey {
    return new PublicKey();
  }

  sign(data: Uint8Array): Uint8Array {
    return new Uint8Array(64);
  }
}

export class PublicKey {
  static deserialize(data: Uint8Array): PublicKey {
    return new PublicKey();
  }

  serialize(): Uint8Array {
    return new Uint8Array(33);
  }
}

export class IdentityKeyPair {
  static generate(): IdentityKeyPair {
    return new IdentityKeyPair(new PublicKey(), new PrivateKey());
  }

  constructor(public readonly publicKey: PublicKey, public readonly privateKey: PrivateKey) {}
}

export class ProtocolAddress {
  constructor(
    public readonly name: string,
    public readonly deviceId: number
  ) {}
}

export class PreKeyBundle {
  constructor(
    public readonly registrationId: number,
    public readonly deviceId: number,
    public readonly preKeyId: number,
    public readonly preKeyPublic: PublicKey,
    public readonly signedPreKeyId: number,
    public readonly signedPreKeyPublic: PublicKey,
    public readonly signedPreKeySignature: Uint8Array,
    public readonly identityKey: PublicKey
  ) {}
}

export class SessionRecord {
  constructor(public readonly data: Uint8Array) {}
}

export class Fingerprint {
  static calculate(
    localIdentityKey: PublicKey,
    remoteIdentityKey: PublicKey
  ): Uint8Array {
    return new Uint8Array(32);
  }
}

export class SignalMessage {
  constructor(public readonly data: Uint8Array) {}
}

export class PreKeySignalMessage {
  constructor(public readonly data: Uint8Array) {}
}
