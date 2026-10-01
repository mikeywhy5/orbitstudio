# Orbit Studio

Marketing site for Orbit Studio — custom-built websites, based in the Fraser
Valley, B.C. and serving customers worldwide.

Hand-written HTML, CSS and JavaScript. No framework, no build step, no
dependencies — open `index.html` and it runs.

## Pages

| File | Purpose |
| --- | --- |
| `index.html` | The main site: intro gate, hero, services, process, portfolio, testimonials, pricing, contact, arcade game |
| `coming-soon.html` | Standalone holding page. Fully self-contained (inline CSS/JS, no local assets) so it can be deployed on its own |
| `vault.html` | Private client-walkthrough page, AES-GCM encrypted behind a password |

## Running locally

Any static file server works, for example:

```bash
npx serve .
```

Opening `index.html` directly from the filesystem mostly works, but
`vault.html` will not decrypt — the Web Crypto API it uses is only available
over HTTPS or on `localhost`.

## Configuration

Two form endpoints are intentionally left empty. Until each is set, the
feature degrades safely rather than silently discarding anyone's details:

| Setting | Location | Effect while empty |
| --- | --- | --- |
| `REWARD_ENDPOINT` | `js/main.js` | The ring-game reward still unlocks, but the email isn't recorded anywhere (logs a console warning) |
| `NOTIFY_ENDPOINT` | `coming-soon.html` | The "Notify Me" signup box stays hidden entirely, so no address is collected and dropped |

The contact form in `index.html` currently simulates submission and does not
send anywhere — wire it to a form service before relying on it for enquiries.

## Vault page

`vault.html` holds a private sales walkthrough. The content is not in the page;
it ships as an AES-256-GCM encrypted blob in `js/vault-data.js` and is decrypted
in the browser with a PBKDF2-derived key when the correct password is entered.

The plaintext source and the build script live **outside this repository**, in
`vault-src/`, deliberately — a plaintext copy alongside the site would defeat
the encryption. To change the content, edit `vault-src/vault-content.html` and
re-run:

```bash
node vault-src/build-vault.js
```

Note this protects against casual inspection, not a determined attacker: a short
password can be brute-forced offline against the blob. Use a long passphrase if
the content is ever genuinely sensitive.
