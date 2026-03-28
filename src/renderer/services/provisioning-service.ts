/**
 * ProvisioningService — handles device provisioning and device management.
 *
 * IIFE renderer module. Manages:
 * - Device list fetching
 * - Device revocation
 * - Provisioning request creation/approval
 * - Provisioning bundle building and importing
 */
(function (): void {
  const log = window.emberLog.createLogger('ProvisioningService');

  interface DeviceInfo {
    id: string;
    publicKey: string;
    identityKey: string;
    protocolVersion: number;
    createdAt: number;
    isCurrent: boolean;
  }

  interface ProvisioningRequest {
    id: string;
    userId: string;
    newDeviceId: string;
    requestingDeviceId: string;
    status: string;
    createdAt: string;
  }

  // ── Device Management ──────────────────────────────────────────────────────

  async function fetchDevices(): Promise<DeviceInfo[]> {
    const auth = await window.getValidAuth();
    if (!auth) return [];

    try {
      const baseUrl = auth.hostname.startsWith('http') ? auth.hostname : `https://${auth.hostname}`;
      const response = await fetch(`${baseUrl}/api/v1/devices`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!response.ok) return [];

      const data = (await response.json()) as { devices: Array<Record<string, unknown>> };
      return (data.devices ?? []).map(d => ({
        id: String(d['id'] ?? ''),
        publicKey: String(d['publicKey'] ?? ''),
        identityKey: String(d['identityKey'] ?? ''),
        protocolVersion: Number(d['protocolVersion'] ?? 0),
        createdAt: Number(d['createdAt'] ?? 0),
        isCurrent: String(d['id'] ?? '') === auth.deviceId,
      }));
    } catch (e) {
      log.error('Failed to fetch devices', { error: String(e) });
      return [];
    }
  }

  async function revokeDevice(deviceId: string): Promise<boolean> {
    const auth = await window.getValidAuth();
    if (!auth) return false;

    try {
      const baseUrl = auth.hostname.startsWith('http') ? auth.hostname : `https://${auth.hostname}`;
      const response = await fetch(`${baseUrl}/api/v1/devices/${deviceId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!response.ok) {
        const errData = (await response.json().catch(() => ({}))) as { error?: string };
        log.error('Failed to revoke device', { device_id: deviceId, error: errData.error });
        return false;
      }

      log.info('Device revoked', { device_id: deviceId });
      return true;
    } catch (e) {
      log.error('Failed to revoke device', { device_id: deviceId, error: String(e) });
      return false;
    }
  }

  // ── Provisioning Flow ─────────────────────────────────────────────────────

  // Creates a provisioning request for the current device to be provisioned by an existing device.
  // Called by a new device that needs to receive encryption keys.
  async function createProvisioningRequest(): Promise<ProvisioningRequest | null> {
    const auth = await window.getValidAuth();
    if (!auth) return null;

    try {
      const baseUrl = auth.hostname.startsWith('http') ? auth.hostname : `https://${auth.hostname}`;
      // newDeviceId = this device (requesting to be provisioned)
      // requestingDeviceId is overridden server-side from the JWT device_id claim
      const response = await fetch(`${baseUrl}/api/v1/provisioning/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ newDeviceId: auth.deviceId }),
      });
      if (!response.ok) return null;

      return (await response.json()) as ProvisioningRequest;
    } catch (e) {
      log.error('Failed to create provisioning request', { error: String(e) });
      return null;
    }
  }

  async function getPendingRequests(): Promise<ProvisioningRequest[]> {
    const auth = await window.getValidAuth();
    if (!auth) return [];

    try {
      const baseUrl = auth.hostname.startsWith('http') ? auth.hostname : `https://${auth.hostname}`;
      const response = await fetch(`${baseUrl}/api/v1/provisioning/pending`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!response.ok) return [];

      const data = (await response.json()) as { requests: ProvisioningRequest[] };
      return data.requests ?? [];
    } catch (e) {
      log.error('Failed to fetch pending requests', { error: String(e) });
      return [];
    }
  }

  async function buildProvisioningBundle(): Promise<string | null> {
    const auth = await window.getValidAuth();
    if (!auth) return null;

    const historyCrypto = window.App?.historyCryptoService;
    if (!historyCrypto) return null;

    try {
      // Collect all CRKs from all embers
      const embers = await window.fetchEmbers();
      const channelKeys: Array<{ emberId: string; epoch: number; crk: string }> = [];

      for (const ember of embers) {
        await historyCrypto.syncCrksForEmber(ember.id);
        const epochs = historyCrypto.getCachedCrkEpochs(ember.id);
        for (const { epoch, crk } of epochs) {
          channelKeys.push({
            emberId: ember.id,
            epoch,
            crk: btoa(String.fromCharCode(...crk)),
          });
        }
      }

      // Collect all cached DM CMKs for the provisioning bundle
      const cachedDmCmks: Array<{ conversationId: string; epoch: number; cmk: Uint8Array }> =
        historyCrypto.getCachedDmCmks?.() ?? [];
      const dmKeys: Array<{ conversationId: string; epoch: number; cmk: string }> =
        cachedDmCmks.map((dk: { conversationId: string; epoch: number; cmk: Uint8Array }) => ({
          conversationId: dk.conversationId,
          epoch: dk.epoch,
          cmk: btoa(String.fromCharCode(...dk.cmk)),
        }));

      const bundle = {
        channelKeys,
        dmKeys,
        metadata: {
          provisionedAt: Date.now(),
          sourceDeviceId: auth.deviceId,
          keyCount: channelKeys.length + dmKeys.length,
        },
      };

      return JSON.stringify(bundle);
    } catch (e) {
      log.error('Failed to build provisioning bundle', { error: String(e) });
      return null;
    }
  }

  async function approveProvisioningRequest(
    requestId: string,
    newDeviceUserId: string,
    newDeviceId: string
  ): Promise<boolean> {
    const auth = await window.getValidAuth();
    if (!auth) return false;

    try {
      const signalManager = window.App?.signalSessionManager;
      if (!signalManager) return false;

      // Build the bundle
      const bundleJson = await buildProvisioningBundle();
      if (!bundleJson) return false;

      // Encrypt bundle to the new device via Signal session
      await signalManager.ensureSession(newDeviceUserId, newDeviceId);
      const address = `${newDeviceUserId}.${newDeviceId}`;
      const bundleBytes = new TextEncoder().encode(bundleJson);
      const encrypted = await signalManager.encrypt(address, bundleBytes);
      const encryptedBundle = btoa(String.fromCharCode(...encrypted.ciphertext));

      // Upload the encrypted bundle
      const baseUrl = auth.hostname.startsWith('http') ? auth.hostname : `https://${auth.hostname}`;
      const response = await fetch(`${baseUrl}/api/v1/provisioning/${requestId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({
          encryptedBundle,
          messageType: encrypted.messageType,
        }),
      });

      if (!response.ok) {
        log.error('Failed to approve provisioning request', { request_id: requestId });
        return false;
      }

      log.info('Provisioning request approved', { request_id: requestId });
      return true;
    } catch (e) {
      log.error('Failed to approve provisioning request', { error: String(e) });
      return false;
    }
  }

  async function downloadAndImportBundle(requestId: string): Promise<boolean> {
    const auth = await window.getValidAuth();
    if (!auth) return false;

    try {
      const signalManager = window.App?.signalSessionManager;
      if (!signalManager) return false;

      const baseUrl = auth.hostname.startsWith('http') ? auth.hostname : `https://${auth.hostname}`;
      const response = await fetch(`${baseUrl}/api/v1/provisioning/${requestId}/bundle`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!response.ok) return false;

      const data = (await response.json()) as {
        encryptedBundle: string;
        senderDeviceId: string;
        senderUserId: string;
        messageType: number;
      };
      if (!data.encryptedBundle) return false;

      // Decrypt the bundle
      const ct = Uint8Array.from(atob(data.encryptedBundle), c => c.charCodeAt(0));
      const bundleBytes = await signalManager.decrypt(
        `${data.senderUserId}.${data.senderDeviceId}`,
        ct,
        data.messageType
      );
      const bundleJson = new TextDecoder().decode(bundleBytes);
      const bundle = JSON.parse(bundleJson) as {
        channelKeys: Array<{ emberId: string; epoch: number; crk: string }>;
        dmKeys: Array<{ conversationId: string; epoch: number; cmk: string }>;
      };

      // Import CRKs into cache
      const historyCrypto = window.App?.historyCryptoService;
      if (!historyCrypto) return false;

      // Import keys into the HistoryCryptoService caches via its class method.
      if (historyCrypto?.importBundle) {
        historyCrypto.importBundle(bundle);
      }

      // Mark provisioning complete
      await fetch(`${baseUrl}/api/v1/provisioning/${requestId}/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}` },
      });

      log.info('Provisioning bundle imported', {
        channel_keys: bundle.channelKeys.length,
        dm_keys: bundle.dmKeys.length,
      });

      return true;
    } catch (e) {
      log.error('Failed to import provisioning bundle', { error: String(e) });
      return false;
    }
  }

  // ── Device Management UI ──────────────────────────────────────────────────

  async function renderDevicesPage(): Promise<void> {
    const container = document.getElementById('settings-page-devices');
    if (!container) return;

    const title = container.querySelector('.settings-page-title');
    container.replaceChildren();
    if (title) container.appendChild(title);

    // Loading indicator
    const loading = document.createElement('p');
    loading.className = 'settings-placeholder-text';
    loading.textContent = 'Loading devices...';
    container.appendChild(loading);

    const devices = await fetchDevices();
    container.removeChild(loading);

    if (devices.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'settings-placeholder-text';
      empty.textContent = 'No devices found.';
      container.appendChild(empty);
      return;
    }

    // Device list
    for (const device of devices) {
      const card = document.createElement('div');
      card.className = 'settings-card device-card';

      const infoRow = document.createElement('div');
      infoRow.className = 'device-info-row';

      const icon = document.createElement('span');
      icon.className = 'device-icon';
      icon.textContent = device.isCurrent ? '💻' : '📱';

      const details = document.createElement('div');
      details.className = 'device-details';

      const idLabel = document.createElement('span');
      idLabel.className = 'device-id';
      idLabel.textContent = `${device.id.substring(0, 8)}...`;
      idLabel.title = device.id;

      const meta = document.createElement('span');
      meta.className = 'device-meta';
      const date = new Date(device.createdAt * 1000);
      meta.textContent = `Protocol v${device.protocolVersion} · Added ${date.toLocaleDateString()}`;

      if (device.isCurrent) {
        const badge = document.createElement('span');
        badge.className = 'device-current-badge';
        badge.textContent = 'Current';
        details.appendChild(badge);
      }

      details.appendChild(idLabel);
      details.appendChild(meta);
      infoRow.appendChild(icon);
      infoRow.appendChild(details);
      card.appendChild(infoRow);

      if (!device.isCurrent) {
        const revokeBtn = document.createElement('button');
        revokeBtn.className = 'device-revoke-btn';
        revokeBtn.textContent = 'Revoke';
        revokeBtn.addEventListener('click', async () => {
          revokeBtn.disabled = true;
          revokeBtn.textContent = 'Revoking...';
          const success = await revokeDevice(device.id);
          if (success) {
            card.remove();
          } else {
            revokeBtn.disabled = false;
            revokeBtn.textContent = 'Revoke';
          }
        });
        card.appendChild(revokeBtn);
      }

      container.appendChild(card);
    }

    // Provisioning section
    const provSection = document.createElement('div');
    provSection.className = 'settings-card provisioning-section';

    const provTitle = document.createElement('h3');
    provTitle.className = 'provisioning-title';
    provTitle.textContent = 'Device Provisioning';
    provSection.appendChild(provTitle);

    const provDesc = document.createElement('p');
    provDesc.className = 'provisioning-description';
    provDesc.textContent =
      'Pending provisioning requests from new devices will appear here. ' +
      'Approve to transfer your encryption keys securely.';
    provSection.appendChild(provDesc);

    // Load pending requests
    const requests = await getPendingRequests();
    if (requests.length > 0) {
      for (const req of requests) {
        const reqCard = document.createElement('div');
        reqCard.className = 'provisioning-request-card';

        const reqInfo = document.createElement('span');
        reqInfo.className = 'provisioning-request-info';
        reqInfo.textContent = `New device: ${req.newDeviceId.substring(0, 8)}...`;
        reqInfo.title = req.newDeviceId;

        const approveBtn = document.createElement('button');
        approveBtn.className = 'provisioning-approve-btn';
        approveBtn.textContent = 'Approve';
        approveBtn.addEventListener('click', async () => {
          approveBtn.disabled = true;
          approveBtn.textContent = 'Approving...';
          const success = await approveProvisioningRequest(req.id, req.userId, req.newDeviceId);
          if (success) {
            approveBtn.textContent = 'Approved';
            approveBtn.className = 'provisioning-approved-btn';
          } else {
            approveBtn.disabled = false;
            approveBtn.textContent = 'Approve';
          }
        });

        reqCard.appendChild(reqInfo);
        reqCard.appendChild(approveBtn);
        provSection.appendChild(reqCard);
      }
    } else {
      const noReqs = document.createElement('p');
      noReqs.className = 'provisioning-no-requests';
      noReqs.textContent = 'No pending provisioning requests.';
      provSection.appendChild(noReqs);
    }

    container.appendChild(provSection);
  }

  // ── Expose globals ────────────────────────────────────────────────────────

  window.renderDevicesPage = renderDevicesPage;
  window.fetchDeviceList = fetchDevices;
  window.revokeDevice = revokeDevice;
  window.createProvisioningRequest = createProvisioningRequest;
  window.approveProvisioningRequest = approveProvisioningRequest;
  window.downloadAndImportBundle = downloadAndImportBundle;
})();
