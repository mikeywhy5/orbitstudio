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

All three forms post to one Formspree form, `xppqjblz`. They are told apart
in the inbox by the `_subject` each one sends:

| Setting | Location | Subject line it sends |
| --- | --- | --- |
| `CONTACT_ENDPOINT` | `js/main.js` | New enquiry from orbitstudio |
| `REWARD_ENDPOINT` | `js/main.js` | Reward claimed on orbitstudio (6RINGS) |
| `NOTIFY_ENDPOINT` | `coming-soon.html` | (Formspree default) |

Emptying any of them again is a supported state, and each degrades in the way
that suits what it promises rather than silently discarding someone's details:

| Setting | Effect while empty |
| --- | --- |
| `REWARD_ENDPOINT` | The reward still unlocks — it was earned by clearing the game — but the email is not recorded (logs a console warning) |
| `NOTIFY_ENDPOINT` | The "Notify Me" box stays hidden entirely, since its only promise is future contact |

The contact form never reports success it has not had. A failed send keeps the
typed message in the form and offers the email address and phone number
instead, because an enquiry that fails silently is worse than one that fails
visibly: the sender walks away believing they reached us.

`MAIL_TO` in `the-vault.html` is the address a visitor's shortlist is addressed to.
It needs no service: "Email my list" builds a `mailto:` link and hands it to the
visitor's own mail app, which also means nothing is sent without them pressing
send. Mail clients cap mailto URLs near 2 KB, so long shortlists drop to
reference numbers only, then to a clipboard copy.


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
