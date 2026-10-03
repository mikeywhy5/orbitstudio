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
| `the-vault.html` | **The Vault** — catalogue of 584 motion effects behind a password. Visitors star favourites and email the shortlist |

## Running locally

Any static file server works, for example:

```bash
npx serve .
```

Opening `index.html` directly from the filesystem mostly works, but
`the-vault.html` will not unlock — it hashes the password with the Web Crypto
API, which browsers only expose over HTTPS or on `localhost`.

## Configuration

Two form endpoints are intentionally left empty. Until each is set, the
feature degrades safely rather than silently discarding anyone's details:

| Setting | Location | Effect while empty |
| --- | --- | --- |
| `REWARD_ENDPOINT` | `js/main.js` | The ring-game reward still unlocks, but the email isn't recorded anywhere (logs a console warning) |
| `NOTIFY_ENDPOINT` | `coming-soon.html` | The "Notify Me" signup box stays hidden entirely, so no address is collected and dropped |

`MAIL_TO` in `the-vault.html` is the address a visitor's shortlist is addressed to.
It needs no service: "Email my list" builds a `mailto:` link and hands it to the
visitor's own mail app, which also means nothing is sent without them pressing
send. Mail clients cap mailto URLs near 2 KB, so long shortlists drop to
reference numbers only, then to a clipboard copy.

The contact form in `index.html` currently simulates submission and does not
send anywhere — wire it to a form service before relying on it for enquiries.

## The Vault

`the-vault.html` is a catalogue of 584 motion effects a prospective client can
browse on their own. They star what they like, and **Export** either copies the
shortlist or opens their mail app addressed to `MAIL_TO`. Favourites live in
their browser, so they can leave and come back to the same list.

It opens behind a password (`showcase`), kept as a SHA-256 digest rather than
in plain text. **This is a deterrent, not a lock.** Every effect still ships
inside the file, so anyone willing to open devtools can read past the gate —
what it buys is that the showcase is not simply there for anyone who finds the
URL. For real secrecy the payload would have to be encrypted, as the old
`vault.html` did it, and the password would have to be long enough not to
guess.

Two settings near the end of the file:

| Constant | What it does |
| --- | --- |
| `GATE_HASH` | SHA-256 of the password. Change it with `node -e "console.log(require('crypto').createHash('sha256').update('newpassword').digest('hex'))"` |
| `PAGE_CAT` / `PAGE_ALL` | How many cards a category (15) and the All tab (25) open with, and how many each "Show more" adds |

Cards are built once and hidden past the limit, so a stage that has not been
revealed never loads its iframe — that is what keeps 584 live demos affordable.
