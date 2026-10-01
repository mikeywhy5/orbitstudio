/* Vault gate — decrypts the walkthrough content with the entered password.
   Crypto mirrors vault-src/build-vault.js exactly: PBKDF2-SHA256 derives an
   AES-256-GCM key, and GCM's own auth tag is what verifies the password —
   a wrong password fails to authenticate and throws, so there's no separate
   "is this the right password" check (and nothing to compare against). */
(() => {
  "use strict";

  const gate = document.getElementById("vault-gate");
  const main = document.getElementById("vault-main");
  const form = document.getElementById("vault-form");
  const input = document.getElementById("vault-password");
  const submit = document.getElementById("vault-submit");
  const errorEl = document.getElementById("vault-error");

  if (!gate || !main || !form) return;

  // Web Crypto is only exposed in secure contexts (https:// or localhost).
  // Worth saying plainly rather than failing with a confusing error later.
  if (!window.crypto || !window.crypto.subtle) {
    errorEl.textContent = "This page needs to be served over HTTPS (or localhost) to decrypt.";
    submit.disabled = true;
    return;
  }

  const SALT_BYTES = 16;
  const IV_BYTES = 12;

  function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function decrypt(password) {
    const raw = base64ToBytes(window.__VAULT_PAYLOAD);
    const salt = raw.slice(0, SALT_BYTES);
    const iv = raw.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
    const body = raw.slice(SALT_BYTES + IV_BYTES); // ciphertext + GCM tag

    const baseKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: window.__VAULT_ITERATIONS, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, body);
    return new TextDecoder().decode(plainBuf);
  }

  function reveal(html) {
    main.innerHTML = html;
    main.hidden = false;
    gate.remove();
    document.body.classList.add("is-unlocked");

    // Injected markup, so this button can't be wired up any earlier.
    const lockBtn = document.getElementById("vault-lock");
    if (lockBtn) {
      lockBtn.addEventListener("click", () => {
        sessionStorage.removeItem("orbit-vault-key");
        location.reload();
      });
    }
  }

  async function attempt(password, { silent = false } = {}) {
    try {
      const html = await decrypt(password);
      // Only cached after a successful decrypt, and only for this tab —
      // a refresh mid-meeting shouldn't mean re-typing the password, but
      // closing the tab should lock it again.
      sessionStorage.setItem("orbit-vault-key", password);
      reveal(html);
      return true;
    } catch (err) {
      if (!silent) {
        errorEl.textContent = "Incorrect password.";
        input.value = "";
        input.focus();
      }
      sessionStorage.removeItem("orbit-vault-key");
      return false;
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    submit.disabled = true;
    submit.querySelector(".vault-btn__label").textContent = "Unlocking…";
    await attempt(input.value);
    submit.disabled = false;
    submit.querySelector(".vault-btn__label").textContent = "Unlock";
  });

  const cached = sessionStorage.getItem("orbit-vault-key");
  if (cached) attempt(cached, { silent: true });
})();
