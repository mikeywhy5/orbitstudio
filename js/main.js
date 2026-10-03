(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;

  /* ======================================================================
     Reset on bfcache restore — if the user leaves (e.g. an external work
     link) and comes back via the browser's Back button, most browsers
     restore the page instantly from cache exactly as it was left: rings
     already hit, circles already charged, intro already skipped. A plain
     reload re-runs everything from a clean slate instead. pageshow with
     persisted:true is the standard way to detect that specific case (a
     normal first load or forward navigation never sets it).
     ====================================================================== */
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      sessionStorage.removeItem("orbit-intro-seen");
      location.reload();
    }
  });
  // Read once, up front, so every section below (intro gate, cursor setup) agrees
  // on whether the intro is actually going to play this load.
  const introAlreadySeen = Boolean(sessionStorage.getItem("orbit-intro-seen"));
  // Assigned by the intro cursor setup below, but read by revealSite()/enterSite()
  // (defined next, and possibly called synchronously before that setup runs) —
  // declared here, first, so they're never read before their own declaration runs.
  let teardownIntroCursor = null;
  let suckInShipCursor = null;
  let resetIdlePulse = null;
  // Assigned by the process fill-circle setup below, called by "Back to Top"
  // (declared here for the same reason as the two above — read across sections).
  let resetProcessFillCircles = null;
  // Same reasoning: these are read by revealSite()'s home-trail setup, which
  // can run before the section further down that would otherwise declare them.
  const cursorShip = document.getElementById("cursor-ship");
  const cursorTrail = document.getElementById("cursor-trail");
  const cursorDot = document.getElementById("cursor-dot");
  const cursorIdlePulse = document.getElementById("cursor-idle-pulse");

  // Must match --warp-duration in styles.css
  const WARP_DURATION = 1700;

  /* ======================================================================
     Smooth scroll (Lenis) — same inertia/easing model used on khula.studio
     ====================================================================== */
  let lenis = null;
  if (!reduceMotion && typeof window.Lenis !== "undefined") {
    lenis = new window.Lenis({
      duration: 1.15,
      easing: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)), // easeOutExpo
      smoothWheel: true,
      touchMultiplier: 1.1,
      anchors: false, // we handle anchor clicks ourselves, below, to control the nav offset
      autoRaf: true,
    });
  }

  function scrollToTarget(target) {
    if (lenis) {
      // Matches the section[id] { scroll-margin-top: 90px } fallback in styles.css
      lenis.scrollTo(target, { offset: typeof target === "number" ? 0 : -90 });
    } else {
      const behavior = reduceMotion ? "auto" : "smooth";
      if (typeof target === "number") window.scrollTo({ top: target, behavior });
      else target.scrollIntoView({ behavior, block: "start" });
    }
  }

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      const id = link.getAttribute("href");
      if (!id || id.length < 2) return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      scrollToTarget(target);
      history.pushState(null, "", id);
    });
  });

  /* ======================================================================
     Intro gate
     ====================================================================== */
  const intro = document.getElementById("intro");
  const introEnter = document.getElementById("intro-enter");
  const introCta = document.getElementById("intro-cta");
  const site = document.getElementById("site");
  const hero = document.querySelector(".hero");
  const body = document.body;

  // Assigned once the ambient starfield loops are initialized below.
  let cancelIntroStarfield = null;
  let cancelHeroStarfield = null;

  // A subtle ambient trail for the rest of the site, in the site's own brand
  // colors (cyan → violet, matching the hero's background glows) — decoupled
  // from the (now static, lag-free) cursor icon itself, just a passive trail
  // of particles spawned at the live mouse position as it moves.
  let homeCursorTrailStarted = false;
  function initHomeCursorTrail() {
    if (!cursorTrail || reduceMotion || isCoarsePointer || homeCursorTrailStarted) return;
    homeCursorTrailStarted = true;

    const MIN_DIST = 16;
    const LIFETIME = 1300;
    const MAX_PARTICLES = 80;
    const DISMISS_SELECTOR = "header, footer, a, button, [role='button']";
    let lastX = null;
    let lastY = null;
    let count = 0;
    let wasOverClickable = false;

    const IDLE_DELAY = 2000;
    let idleTimer = null;
    function startIdleTimer(x, y) {
      clearTimeout(idleTimer);
      if (cursorIdlePulse) cursorIdlePulse.classList.remove("is-pulsing");
      idleTimer = setTimeout(() => {
        if (!cursorIdlePulse) return;
        cursorIdlePulse.style.setProperty("--idle-x", x + "px");
        cursorIdlePulse.style.setProperty("--idle-y", y + "px");
        cursorIdlePulse.classList.add("is-pulsing");
      }, IDLE_DELAY);
    }
    // Exposed so enterSite()/goBackToEntrance() can kill a pulse that's
    // already showing — otherwise it keeps looping (animation: infinite)
    // at its last position forever, right through screen transitions,
    // since nothing inside this closure ever runs again once the mouse
    // stops moving on this page.
    resetIdlePulse = () => {
      clearTimeout(idleTimer);
      if (cursorIdlePulse) cursorIdlePulse.classList.remove("is-pulsing");
    };

    function spawn(x, y) {
      if (count >= MAX_PARTICLES) return;
      const particle = document.createElement("span");
      particle.className = "trail-particle";
      const size = 4 + Math.random() * 3;
      particle.style.width = size + "px";
      particle.style.height = size + "px";
      particle.style.left = x + "px";
      particle.style.top = y + "px";
      cursorTrail.appendChild(particle);
      count++;

      requestAnimationFrame(() => particle.classList.add("is-home-fading"));
      setTimeout(() => {
        if (particle.isConnected) {
          particle.remove();
          count--;
        }
      }, LIFETIME);
    }

    // Instantly wipes any live particles rather than letting them fade out
    // on their usual (much slower) schedule, so the trail doesn't visually
    // trail across the header/footer/buttons while the cursor is over them.
    function dismissAllInstantly() {
      cursorTrail.querySelectorAll(".trail-particle").forEach((particle) => {
        particle.classList.add("is-dismissing");
        setTimeout(() => {
          if (particle.isConnected) {
            particle.remove();
            count--;
          }
        }, 90);
      });
    }

    document.addEventListener("mousemove", (e) => {
      // This listener is attached once and never torn down, but "Back to
      // Entrance Page" can send the user back to the intro screen — where
      // its own red trail is the only trail that should show. Gate on the
      // same class revealSite()/goBackToEntrance() already toggle, rather
      // than adding a second listener lifecycle to manage.
      if (!document.body.classList.contains("has-static-ship-cursor")) return;

      startIdleTimer(e.clientX, e.clientY);

      const overClickable = Boolean(e.target && e.target.closest && e.target.closest(DISMISS_SELECTOR));
      if (overClickable) {
        if (!wasOverClickable) dismissAllInstantly();
        wasOverClickable = true;
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      wasOverClickable = false;

      if (lastX === null) {
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      if (Math.hypot(e.clientX - lastX, e.clientY - lastY) > MIN_DIST) {
        spawn(e.clientX, e.clientY);
        lastX = e.clientX;
        lastY = e.clientY;
      }
    });
  }

  function revealSite() {
    site.removeAttribute("aria-hidden");
    site.removeAttribute("inert");
    body.classList.remove("no-scroll");
    // Hand off from the intro's rotating, trail-leaving ship cursor to a
    // plain static ship-icon cursor for the rest of the site.
    if (teardownIntroCursor) teardownIntroCursor();
    body.classList.add("has-static-ship-cursor");
    initHomeCursorTrail();
  }

  function enterSite() {
    if (intro.classList.contains("is-leaving")) return;

    sessionStorage.setItem("orbit-intro-seen", "1");

    // Clear any lingering rocket-trail particles right away, so the warp/
    // suck-in has full visual impact instead of competing with leftover trail.
    if (cursorTrail) {
      cursorTrail.querySelectorAll(".trail-particle").forEach((p) => p.remove());
    }
    if (resetIdlePulse) resetIdlePulse();

    // The ship gets pulled into the black hole right as the warp kicks off.
    if (suckInShipCursor) suckInShipCursor();

    if (reduceMotion) {
      revealSite();
      intro.classList.add("is-hidden");
      focusMain();
      return;
    }

    if (cancelIntroStarfield) cancelIntroStarfield();
    runBlackHoleWarp(document.getElementById("intro-canvas"), WARP_DURATION);

    intro.classList.add("is-leaving");
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      intro.classList.add("is-hidden");
      intro.removeEventListener("animationend", finish);

      // The reveal happens now, not at click time, so the hero's "emerging
      // from the black hole" animation is what the user actually sees.
      revealSite();

      if (cancelHeroStarfield) cancelHeroStarfield();
      cancelHeroStarfield = (
        initParticleCanvas(document.getElementById("hero-canvas"), {
          density: 16000,
          maxLink: 150,
          speed: 0.16,
          burst: true,
        }) || {}
      ).cancel;

      if (hero) hero.classList.add("is-emerging");
      focusMain();
    };
    intro.addEventListener("animationend", finish);
    // Safety fallback in case animationend doesn't fire for every browser/context
    setTimeout(finish, WARP_DURATION + 150);
  }

  function focusMain() {
    const main = document.getElementById("main-content");
    if (main) {
      main.setAttribute("tabindex", "-1");
      main.focus({ preventScroll: true });
    }
  }

  function skipIntroInstant() {
    revealSite();
    intro.classList.add("is-hidden");
    sessionStorage.setItem("orbit-intro-seen", "1");
  }

  // "Back to Entrance Page": undoes revealSite() and resets the ring game so
  // it can be played again, then leaves the user at the intro's normal idle
  // state (spinning logo, 5 blue rings) — a fresh click-to-enter replays the
  // whole black-hole/emerge sequence from scratch.
  function goBackToEntrance() {
    if (mobileMenu.classList.contains("is-open")) closeMobileMenu();

    document.querySelectorAll(".intro-ring").forEach((ring) => ring.classList.remove("is-hit"));
    document.body.classList.remove("is-triumphant", "is-claimed");
    const pulse = document.getElementById("intro-red-pulse");
    if (pulse) pulse.classList.remove("is-pulsing");

    // Same "start fresh" treatment as the ring game above, for the "How It
    // Works" fill-circles further down the homepage.
    if (resetProcessFillCircles) resetProcessFillCircles();

    // Undo the finished black-hole warp's end state so it can play again.
    intro.classList.remove("is-leaving", "is-hidden");
    if (hero) hero.classList.remove("is-emerging");

    // Re-lock the main site behind the intro.
    site.setAttribute("aria-hidden", "true");
    site.setAttribute("inert", "");
    body.classList.add("no-scroll");

    // Hand back from the static pointer to the fancy rotating ship + trail.
    body.classList.remove("has-static-ship-cursor");
    if (cursorShip) cursorShip.classList.remove("is-sucked-in", "is-active");
    if (cursorDot) cursorDot.classList.remove("is-sucked-in", "is-active");
    if (cursorTrail) cursorTrail.innerHTML = "";
    if (resetIdlePulse) resetIdlePulse();
    if (canRunIntroCursor) setupIntroCursor();

    // The warp replaced this loop with its own effect and never restarts it.
    startIntroStarfield();

    // A fresh "first visit" again, including across a stray reload.
    sessionStorage.removeItem("orbit-intro-seen");

    introEnter.focus();
  }

  introEnter.addEventListener("click", enterSite);
  // its own button now, so Enter and Space are handled natively
  if (introCta) introCta.addEventListener("click", enterSite);
  introEnter.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      enterSite();
    }
  });
  [document.getElementById("back-to-entrance"), document.getElementById("back-to-entrance-mobile")].forEach((btn) => {
    if (btn) btn.addEventListener("click", goBackToEntrance);
  });

  if (introAlreadySeen) {
    skipIntroInstant();
  }

  /* ======================================================================
     Ring-game reward — email gate. Clearing the rings reveals that there IS
     a reward, but not what it is; the discount amount and code stay hidden
     until an email is submitted.

     REWARD_ENDPOINT is where captured emails get sent. It is intentionally
     empty by default, and while it's empty the reward still unlocks exactly
     as normal — the address just isn't recorded anywhere. Paste a Formspree
     form URL in to start actually collecting them. See the note in the
     handler for why a send failure never blocks the reveal.
     ====================================================================== */
  const REWARD_ENDPOINT = ""; // e.g. "https://formspree.io/f/abcdwxyz"
  const REWARD_CLAIMED_KEY = "orbit-reward-claimed";

  function rewardAlreadyClaimed() {
    try {
      return sessionStorage.getItem(REWARD_CLAIMED_KEY) === "1";
    } catch (err) {
      return false; // private mode / storage blocked
    }
  }

  const claimForm = document.getElementById("intro-claim-form");
  if (claimForm) {
    const claimWrap = document.getElementById("intro-claim");
    const claimInput = document.getElementById("intro-claim-email");
    const claimBtn = document.getElementById("intro-claim-submit");
    const claimMsg = document.getElementById("intro-claim-msg");

    claimForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = claimInput.value.trim();

      // Same pattern the contact form validates against, for consistency.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        claimWrap.classList.add("has-error");
        claimMsg.textContent = "Please enter a valid email address.";
        claimInput.focus();
        return;
      }

      claimWrap.classList.remove("has-error");
      claimMsg.textContent = "";
      claimBtn.disabled = true;
      claimBtn.textContent = "Unlocking…";

      if (REWARD_ENDPOINT) {
        try {
          await fetch(REWARD_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ email, source: "Entrance ring game — 6RINGS reward" }),
          });
        } catch (err) {
          // Non-blocking on purpose: they earned the reward by clearing the
          // game, so a failed send is ours to chase up, not a wall to put in
          // front of them.
          console.warn("[orbit] Reward email failed to send:", err);
        }
      } else {
        console.warn(
          '[orbit] REWARD_ENDPOINT is empty in js/main.js — the reward unlocked, but "' +
            email +
            '" was NOT recorded anywhere.'
        );
      }

      try {
        sessionStorage.setItem(REWARD_CLAIMED_KEY, "1");
      } catch (err) {
        /* private mode — the reveal below still works, it just won't persist */
      }

      // Restored even though the form is about to hide, so replaying the
      // intro never turns up a stuck "Unlocking…" button.
      claimBtn.disabled = false;
      claimBtn.textContent = "Unlock Reward";
      document.body.classList.add("is-claimed");
    });
  }

  /* ======================================================================
     Sticky nav
     ====================================================================== */
  const nav = document.getElementById("nav");
  function onScrollNav() {
    if (window.scrollY > 40) nav.classList.add("is-scrolled");
    else nav.classList.remove("is-scrolled");
  }
  document.addEventListener("scroll", onScrollNav, { passive: true });
  onScrollNav();

  /* ======================================================================
     Mobile menu
     ====================================================================== */
  const navToggle = document.getElementById("nav-toggle");
  const mobileMenu = document.getElementById("mobile-menu");

  function closeMobileMenu() {
    mobileMenu.classList.remove("is-open");
    mobileMenu.setAttribute("aria-hidden", "true");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Open menu");
  }
  function openMobileMenu() {
    mobileMenu.classList.add("is-open");
    mobileMenu.setAttribute("aria-hidden", "false");
    navToggle.setAttribute("aria-expanded", "true");
    navToggle.setAttribute("aria-label", "Close menu");
  }
  navToggle.addEventListener("click", () => {
    const isOpen = mobileMenu.classList.contains("is-open");
    isOpen ? closeMobileMenu() : openMobileMenu();
  });
  mobileMenu.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeMobileMenu));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mobileMenu.classList.contains("is-open")) closeMobileMenu();
  });

  /* ======================================================================
     Scroll reveal
     ====================================================================== */
  const revealEls = document.querySelectorAll("[data-reveal]");
  revealEls.forEach((el) => {
    const delay = el.getAttribute("data-reveal-delay");
    if (delay) el.style.setProperty("--reveal-delay", delay);
  });

  if (reduceMotion) {
    revealEls.forEach((el) => el.classList.add("is-visible"));
  } else if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    );
    revealEls.forEach((el) => revealObserver.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("is-visible"));
  }

  /* ======================================================================
     Magnetic buttons (desktop, fine pointer only)
     ====================================================================== */
  if (!reduceMotion && !isCoarsePointer) {
    document.querySelectorAll(".magnetic").forEach((btn) => {
      btn.addEventListener("mousemove", (e) => {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        btn.style.transform = `translate(${x * 0.18}px, ${y * 0.35}px)`;
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.transform = "translate(0, 0)";
      });
    });
  }

  /* ======================================================================
     Work card tilt (desktop, fine pointer only)
     ====================================================================== */
  if (!reduceMotion && !isCoarsePointer) {
    document.querySelectorAll("[data-tilt]").forEach((card) => {
      card.addEventListener("mousemove", (e) => {
        const rect = card.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width - 0.5;
        const py = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = `perspective(600px) rotateX(${(-py * 18).toFixed(2)}deg) rotateY(${(px * 24).toFixed(2)}deg) translateY(-8px) scale(1.03)`;
      });
      card.addEventListener("mouseleave", () => {
        card.style.transform = "";
      });
    });
  }

  /* ======================================================================
     Process fill-circles — fires automatically just before #work (the next
     section) is about to scroll up and cover #process, and plays out on its
     own timer. Purely decorative: scrolling is never held up or hijacked
     for it, so the user can keep scrolling straight past without watching
     it if they want — it was locking/scrubbing the page before, which read
     as the site getting stuck rather than a nice-to-have flourish.
     ====================================================================== */
  if (!reduceMotion) {
    const processSection = document.getElementById("process");
    const steps = Array.from(document.querySelectorAll(".process__step"));
    const circles = steps.map((step) => step.querySelector(".fill-circle")).filter(Boolean);
    let processTriggered = false;

    const setSectionCharged = (charged) => {
      if (!processSection) return;
      const wasCharged = processSection.classList.contains("is-charged");
      if (charged === wasCharged) return;
      processSection.classList.toggle("is-charged", charged);
      if (charged) {
        processSection.classList.remove("is-flashing");
        void processSection.offsetWidth;
        processSection.classList.add("is-flashing");
        setTimeout(() => processSection.classList.remove("is-flashing"), 600);

        const processCanvas = document.getElementById("process-canvas");
        if (processCanvas && !processCanvas.dataset.started) {
          processCanvas.dataset.started = "1";
          initParticleCanvas(processCanvas, {
            density: 9000,
            maxLink: 120,
            speed: 0.3,
            color: "34, 211, 238",
            colorAlt: "103, 232, 249",
          });
        }
      } else {
        processSection.classList.remove("is-flashing");
      }
    };

    // A pure function of progress (0–1 across all 5 circles) — recomputing
    // every circle's fill from scratch on every call is what makes this
    // trivially reversible (scroll back up and it just drains) without any
    // separate "un-fill" logic.
    const applyProgress = (progress) => {
      steps.forEach((step, i) => {
        const circle = circles[i];
        if (!circle) return;
        const liquid = circle.querySelector(".fill-circle__liquid");
        const segStart = i / steps.length;
        const segEnd = (i + 1) / steps.length;
        const segProgress = Math.min(1, Math.max(0, (progress - segStart) / (segEnd - segStart)));
        if (liquid) liquid.style.height = segProgress * 100 + "%";
        step.classList.toggle("is-filling", segProgress > 0 && segProgress < 1);
        circle.classList.toggle("is-charged", segProgress >= 1);
      });
      setSectionCharged(progress >= 1);
    };

    const runChargeCascade = () => {
      const FILL_MS = 1100;
      const STAGGER_MS = 180;
      steps.forEach((step, i) => {
        const startAt = i * STAGGER_MS;
        setTimeout(() => applyProgress((i + 1) / steps.length), startAt + FILL_MS);
      });
    };

    // Fires once the circles themselves are fully on screen with 5px to
    // spare. The negative bottom rootMargin pulls the viewport's bottom
    // edge up by 5px and threshold 1 waits for the whole circle to clear
    // it — together that's exactly "scrolled 5px past the circles".
    // Watching one circle is enough: all five sit on the same row, so they
    // share a top/bottom edge.
    const firstCircle = document.querySelector(".fill-circle-wrap");
    if (firstCircle && "IntersectionObserver" in window) {
      const circleObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && !processTriggered) {
              processTriggered = true;
              runChargeCascade();
            }
          });
        },
        { threshold: 1, rootMargin: "0px 0px -5px 0px" }
      );
      circleObserver.observe(firstCircle);
    }

    resetProcessFillCircles = () => {
      processTriggered = false;
      applyProgress(0);
      steps.forEach((step) => step.classList.remove("is-filling"));
    };
  }

  /* ======================================================================
     Cursor: a little ship that points the way it's moving, trailing
     fading rocket exhaust behind it (desktop, fine pointer only).
     A named function, not a one-shot block, so "Back to Entrance Page" can
     call it again to restart the whole intro experience — every variable
     below (ringsHit, active, curX/curY, etc.) is a fresh closure each call,
     which is exactly the reset the ring game needs.
     ====================================================================== */
  function setupIntroCursor() {
    document.body.classList.add("has-ship-cursor");
    cursorTrail.classList.add("is-above-intro"); // sit above the intro overlay, not behind text

    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 2;
    let curX = targetX;
    let curY = targetY;
    let curAngle = 0;
    let targetAngle = 0;
    let lastEmitX = curX;
    let lastEmitY = curY;
    let active = false;
    let rafId = null;

    const TRAIL_LIFETIME = 8000; // ms — matches the trail-life animation duration in styles.css
    const MAX_PARTICLES = 140;
    let particleCount = 0;

    // Ring mini-game: fly through all of them to trigger the red pulse.
    const introRings = Array.from(document.querySelectorAll(".intro-ring"));
    const introRedPulse = document.getElementById("intro-red-pulse");
    let ringsHit = 0;

    function checkRingCollisions(x, y) {
      if (ringsHit >= introRings.length) return;
      introRings.forEach((ring) => {
        if (ring.classList.contains("is-hit")) return;
        const rect = ring.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dist = Math.hypot(x - cx, y - cy);
        if (dist < rect.width / 2 + 4) {
          ring.classList.add("is-hit");
          ringsHit++;
          if (ringsHit >= introRings.length) {
            // On body, not intro — the ship/glow elements this also recolors
            // live outside #intro in the DOM (they're reused by the home
            // page's trail), so the flag needs a common ancestor.
            document.body.classList.add("is-triumphant");
            // Already gave their email earlier this session — don't make them
            // hand it over twice (and don't send a duplicate).
            if (rewardAlreadyClaimed()) document.body.classList.add("is-claimed");
            if (introRedPulse) introRedPulse.classList.add("is-pulsing");
          }
        }
      });
    }

    // Shortest-path angle interpolation so the ship never spins the long way around.
    function angleLerp(a, b, t) {
      const diff = ((((b - a) % 360) + 540) % 360) - 180;
      return a + diff * t;
    }

    function spawnTrailParticle(x, y, headingDeg) {
      if (particleCount >= MAX_PARTICLES) return;
      // Once "CONGRATULATIONS" is showing, the trail shouldn't draw over the
      // reward text/button (it renders above the intro overlay — see
      // .cursor-trail.is-above-intro — so it would otherwise cut right
      // across them). Only suppressed over the button's own area; the
      // trail still shows normally everywhere else on screen.
      if (document.body.classList.contains("is-triumphant")) {
        const over = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        };
        // the CTA and the email box sit outside the logo button now
        if (over(introEnter) || over(introCta) || over(document.getElementById("intro-claim"))) return;
      }
      const rad = ((headingDeg + 180) * Math.PI) / 180; // point back, opposite of travel
      const perp = rad + Math.PI / 2;
      const tailOffset = 13;
      const jitter = (Math.random() - 0.5) * 6;
      const px = x + Math.cos(rad) * tailOffset + Math.cos(perp) * jitter;
      const py = y + Math.sin(rad) * tailOffset + Math.sin(perp) * jitter;

      const particle = document.createElement("span");
      particle.className = "trail-particle";
      particle.style.left = px + "px";
      particle.style.top = py + "px";
      const size = 4 + Math.random() * 4; // px — organic flame-puff variation
      particle.style.width = size + "px";
      particle.style.height = size + "px";
      cursorTrail.appendChild(particle);
      particleCount++;

      // Blue while the ring game is still in progress, red once all 5 rings
      // have been hit — matches the ship/logo recoloring on the same trigger.
      const fadeClass = document.body.classList.contains("is-triumphant") ? "is-fading" : "is-fading-blue";
      requestAnimationFrame(() => particle.classList.add(fadeClass));
      setTimeout(() => {
        particle.remove();
        particleCount--;
      }, TRAIL_LIFETIME);
    }

    function onMouseMove(e) {
      targetX = e.clientX;
      targetY = e.clientY;
      // The dot marks the exact live cursor position — no lag, unlike the ship.
      cursorDot.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      if (!active) {
        active = true;
        cursorShip.classList.add("is-active");
        cursorDot.classList.add("is-active");
      }
    }
    function onMouseLeave() {
      active = false;
      cursorShip.classList.remove("is-active");
      cursorDot.classList.remove("is-active");
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseleave", onMouseLeave);

    function raf() {
      const dx = targetX - curX;
      const dy = targetY - curY;
      curX += dx * 0.2;
      curY += dy * 0.2;

      if (Math.hypot(dx, dy) > 0.6) {
        targetAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
      }
      curAngle = angleLerp(curAngle, targetAngle, 0.2);

      cursorShip.style.transform = `translate(${curX}px, ${curY}px) rotate(${curAngle}deg)`;

      if (active) checkRingCollisions(curX, curY);

      if (active && Math.hypot(curX - lastEmitX, curY - lastEmitY) > 10) {
        spawnTrailParticle(curX, curY, curAngle);
        lastEmitX = curX;
        lastEmitY = curY;
      }

      rafId = requestAnimationFrame(raf);
    }
    rafId = requestAnimationFrame(raf);

    // Stops position updates (rAF loop, listeners) without touching the trail
    // container's contents/z-index — shared by the explosion (which still
    // needs the trail elevated above the intro for its fragments) and the
    // full teardown below (which runs later, once those fragments are done).
    function stopIntroCursorUpdates() {
      cancelAnimationFrame(rafId);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseleave", onMouseLeave);
      cursorShip.classList.remove("is-active");
      cursorDot.classList.remove("is-active");
    }

    // This fun, rotating, trail-leaving cursor is an intro-screen-only flourish.
    // Once the user enters the site, it hands off to a plain static cursor icon
    // (see the "has-static-ship-cursor" class) that behaves like a normal pointer.
    teardownIntroCursor = () => {
      stopIntroCursorUpdates();
      cursorTrail.classList.remove("is-above-intro");
      cursorTrail.innerHTML = ""; // clear any still-fading particles immediately
      document.body.classList.remove("has-ship-cursor");
    };

    // Click-to-enter: the ship gets pulled toward the center and shrinks
    // away — sucked into the black hole that's about to swallow the screen,
    // rather than exploding apart. Capture its current position/heading into
    // custom properties so the CSS keyframe animates from wherever it was
    // last, rather than snapping to a fixed spot.
    suckInShipCursor = () => {
      stopIntroCursorUpdates();
      cursorShip.style.setProperty("--ship-x", curX + "px");
      cursorShip.style.setProperty("--ship-y", curY + "px");
      cursorShip.style.setProperty("--ship-angle", curAngle + "deg");
      cursorShip.classList.add("is-sucked-in");
      cursorDot.style.setProperty("--dot-x", curX + "px");
      cursorDot.style.setProperty("--dot-y", curY + "px");
      cursorDot.classList.add("is-sucked-in");
    };
  }

  const canRunIntroCursor = Boolean(cursorShip && cursorTrail && cursorDot && !reduceMotion && !isCoarsePointer);
  if (canRunIntroCursor && !introAlreadySeen) {
    setupIntroCursor();
  }

  /* ======================================================================
     Back to top
     ====================================================================== */
  const backToTop = document.getElementById("back-to-top");
  if (backToTop) {
    document.addEventListener(
      "scroll",
      () => {
        if (window.scrollY > window.innerHeight * 0.8) backToTop.classList.add("is-visible");
        else backToTop.classList.remove("is-visible");
      },
      { passive: true }
    );
    backToTop.addEventListener("click", () => {
      scrollToTarget(0);

      // Reset the process fill-circles and rearm the cascade so scrolling
      // back down to the section triggers it again.
      if (resetProcessFillCircles) resetProcessFillCircles();
    });
  }

  /* ======================================================================
     Testimonial carousel
     ====================================================================== */
  const track = document.getElementById("testimonial-track");
  if (track) {
    const slides = Array.from(track.children);
    const dotsWrap = document.getElementById("testimonial-dots");
    const prevBtn = document.getElementById("testimonial-prev");
    const nextBtn = document.getElementById("testimonial-next");
    let index = 0;
    let timer = null;

    slides.forEach((_, i) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "testimonial__dot" + (i === 0 ? " is-active" : "");
      dot.setAttribute("aria-label", `Go to testimonial ${i + 1}`);
      dot.addEventListener("click", () => goTo(i));
      dotsWrap.appendChild(dot);
    });
    const dots = Array.from(dotsWrap.children);

    function render() {
      track.style.transform = `translateX(-${index * 100}%)`;
      slides.forEach((s, i) => s.setAttribute("aria-hidden", i === index ? "false" : "true"));
      dots.forEach((d, i) => d.classList.toggle("is-active", i === index));
    }

    function goTo(i) {
      index = (i + slides.length) % slides.length;
      render();
      restart();
    }

    function next() { goTo(index + 1); }
    function prev() { goTo(index - 1); }

    function restart() {
      if (reduceMotion) return;
      clearInterval(timer);
      timer = setInterval(next, 6000);
    }

    prevBtn.addEventListener("click", prev);
    nextBtn.addEventListener("click", next);

    const wrapper = track.closest(".testimonial");
    wrapper.addEventListener("mouseenter", () => clearInterval(timer));
    wrapper.addEventListener("mouseleave", restart);
    wrapper.addEventListener("focusin", () => clearInterval(timer));
    wrapper.addEventListener("focusout", restart);

    // touch swipe
    let touchStartX = null;
    track.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
    track.addEventListener("touchend", (e) => {
      if (touchStartX === null) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 40) dx < 0 ? next() : prev();
      touchStartX = null;
    });

    render();
    restart();
  }

  /* ======================================================================
     Contact form (client-side only)
     ====================================================================== */
  const form = document.getElementById("contact-form");
  if (form) {
    const successEl = document.getElementById("contact-success");
    const submitBtn = form.querySelector(".contact__submit");

    function setError(field, message) {
      const wrapper = field.closest(".field");
      wrapper.classList.toggle("has-error", Boolean(message));
      const errEl = wrapper.querySelector(".field__error");
      if (errEl) errEl.textContent = message || "";
    }

    function validateField(field) {
      if (!field.hasAttribute("required")) return true;
      if (field.type === "email") {
        const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value.trim());
        setError(field, ok ? "" : "Please enter a valid email address.");
        return ok;
      }
      const ok = field.value.trim().length > 0;
      setError(field, ok ? "" : "This field is required.");
      return ok;
    }

    ["f-name", "f-email", "f-message"].forEach((id) => {
      const field = document.getElementById(id);
      field.addEventListener("blur", () => validateField(field));
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const fields = [document.getElementById("f-name"), document.getElementById("f-email"), document.getElementById("f-message")];
      const results = fields.map(validateField);
      if (results.includes(false)) {
        const firstInvalid = fields[results.indexOf(false)];
        firstInvalid.focus();
        return;
      }

      submitBtn.classList.add("is-loading");
      submitBtn.disabled = true;

      setTimeout(() => {
        submitBtn.classList.remove("is-loading");
        submitBtn.disabled = false;
        successEl.textContent = "Thanks — your message is in! We'll reply within one business day.";
        form.reset();
      }, 1000);
    });
  }

  /* ======================================================================
     Footer year
     ====================================================================== */
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ======================================================================
     Work card countdown demo — purely decorative, no real target date, so
     it just re-randomizes each digit on an interval to read as "live."
     ====================================================================== */
  (function initCountdownDemo() {
    const nums = document.querySelectorAll(".countdown-demo [data-countdown-num]");
    if (!nums.length) return;
    const maxes = [99, 23, 59, 59]; // Days, Hrs, Min, Sec ranges
    function randomize() {
      nums.forEach((el, i) => {
        el.textContent = String(Math.floor(Math.random() * (maxes[i] + 1))).padStart(2, "0");
      });
    }
    randomize();
    setInterval(randomize, 900);
  })();

  /* ======================================================================
     Requiem card rain backdrop — generates a modest number of streak
     elements once; each one's horizontal position, thickness, opacity,
     fall speed, and (negative, so it starts already mid-fall) delay are
     randomized so the loop never looks synchronized. See .requiem-rain in
     CSS for the actual fall animation.
     ====================================================================== */
  (function initRequiemRain() {
    const container = document.getElementById("requiem-rain");
    if (!container || reduceMotion) return;
    const DROP_COUNT = 45;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < DROP_COUNT; i++) {
      const drop = document.createElement("span");
      drop.className = "drop";
      const duration = 0.8 + Math.random() * 1.4;
      drop.style.left = Math.random() * 100 + "%";
      drop.style.borderLeftWidth = (2 + Math.random() * 10) + "px";
      drop.style.opacity = (0.25 + Math.random() * 0.6).toFixed(2);
      drop.style.animationDuration = duration + "s";
      drop.style.animationDelay = -(Math.random() * duration) + "s";
      frag.appendChild(drop);
    }
    container.appendChild(frag);
  })();

  /* ======================================================================
     Requiem card lightning — strikes on a fixed 7s interval (the original
     SCSS this was adapted from triggered it on click-and-hold, which
     doesn't make sense for a small passive background card).
     ====================================================================== */
  (function initRequiemLightning() {
    const flash = document.getElementById("requiem-lightning");
    if (!flash || reduceMotion) return;
    setInterval(() => {
      flash.classList.remove("is-flashing");
      void flash.offsetWidth; // restart the animation each strike
      flash.classList.add("is-flashing");
    }, 7000);
  })();

  /* ======================================================================
     Canvas: shared particle network
     ====================================================================== */
  function initParticleCanvas(canvas, options) {
    if (!canvas || reduceMotion) return;
    const ctx = canvas.getContext("2d");
    let width, height, particles, dpr;
    let rafId = null;
    const opts = Object.assign(
      {
        density: 14000,
        maxLink: 140,
        speed: 0.15,
        color: "34, 211, 238",
        colorAlt: "139, 92, 246",
        burst: false,
        // Optional: when checkTriumphant() returns true, particles draw in
        // triumphantColor/triumphantColorAlt instead, and move
        // triumphantSpeedMult times faster — checked every frame, so the
        // switch is instant and needs no re-init (used by the intro's
        // starfield once all 5 rings are hit). Speed multiplies the base
        // velocity per-frame rather than mutating it, so it cleanly reverts
        // if is-triumphant is ever removed (e.g. "Back to Entrance Page").
        checkTriumphant: null,
        triumphantColor: null,
        triumphantColorAlt: null,
        triumphantSpeedMult: 1,
        // Optional: once triumphant, randomly perturbs each particle's own
        // velocity every frame (instead of just moving faster in the same
        // straight line) so the field reads as chaotic/erratic, not just sped up.
        triumphantErratic: false,
      },
      options
    );

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(90, Math.round((width * height) / opts.density));
      const cx = width / 2;
      const cy = height / 2;
      particles = Array.from({ length: count }, () => {
        if (opts.burst) {
          // Erupt from a point at the center, then settle into ambient drift —
          // matches the hero "emerging from the black hole" reveal. Speed and
          // settle window are pushed well past the ambient drift's own scale
          // so the expansion actually reads as a dramatic burst outward,
          // not just a slightly-faster start.
          const angle = Math.random() * Math.PI * 2;
          const burstSpeed = 2.5 + Math.random() * 4.5;
          return {
            x: cx + (Math.random() - 0.5) * 16,
            y: cy + (Math.random() - 0.5) * 16,
            vx: Math.cos(angle) * burstSpeed,
            vy: Math.sin(angle) * burstSpeed,
            alt: Math.random() > 0.7,
            settleFrames: 100 + Math.floor(Math.random() * 60),
          };
        }
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * opts.speed,
          vy: (Math.random() - 0.5) * opts.speed,
          alt: Math.random() > 0.7,
          settleFrames: 0,
        };
      });
    }

    function step() {
      const triumphant = opts.checkTriumphant && opts.checkTriumphant();
      const col = triumphant && opts.triumphantColor ? opts.triumphantColor : opts.color;
      const colAlt = triumphant && opts.triumphantColorAlt ? opts.triumphantColorAlt : opts.colorAlt;
      const speedMult = triumphant ? opts.triumphantSpeedMult : 1;

      ctx.clearRect(0, 0, width, height);
      particles.forEach((p) => {
        if (p.settleFrames > 0) {
          p.settleFrames--;
          p.vx *= 0.975;
          p.vy *= 0.975;
          if (p.settleFrames === 0) {
            p.vx = (Math.random() - 0.5) * opts.speed;
            p.vy = (Math.random() - 0.5) * opts.speed;
          }
        }
        if (triumphant && opts.triumphantErratic) {
          const jitter = opts.speed * 0.9;
          p.vx += (Math.random() - 0.5) * jitter;
          p.vy += (Math.random() - 0.5) * jitter;
          const maxV = opts.speed * 2.2;
          const mag = Math.hypot(p.vx, p.vy) || 1;
          if (mag > maxV) {
            p.vx = (p.vx / mag) * maxV;
            p.vy = (p.vy / mag) * maxV;
          }
        }
        p.x += p.vx * speedMult;
        p.y += p.vy * speedMult;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
      });

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < opts.maxLink) {
            const alpha = 1 - dist / opts.maxLink;
            ctx.strokeStyle = `rgba(${col}, ${alpha * 0.35})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      particles.forEach((p) => {
        ctx.fillStyle = `rgba(${p.alt ? colAlt : col}, 0.85)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      });

      rafId = requestAnimationFrame(step);
    }

    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 200);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        cancelAnimationFrame(rafId);
      } else {
        rafId = requestAnimationFrame(step);
      }
    });

    resize();
    rafId = requestAnimationFrame(step);

    return { cancel: () => cancelAnimationFrame(rafId) };
  }

  /* ======================================================================
     Canvas: "black hole" warp — stars streak outward and accelerate,
     as if the viewer is being pulled through the intro logo.
     ====================================================================== */
  function runBlackHoleWarp(canvas, duration) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const maxDist = Math.hypot(width, height) / 2 + 40;
    const count = 160;
    // Scattered across the whole screen, not clustered near center — this is
    // the "sucked into the black hole" direction: stars pulled inward and
    // consumed, not flown past like warp-speed travel.
    const stars = Array.from({ length: count }, () => ({
      angle: Math.random() * Math.PI * 2,
      dist: 40 + Math.random() * (maxDist - 40),
      alt: Math.random() > 0.72,
    }));

    const start = performance.now();

    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      const accel = Math.pow(t, 3);

      // Longer-lived trail early on, quicker clear once streaks are fast and thin.
      ctx.fillStyle = `rgba(3, 4, 8, ${0.2 + accel * 0.15})`;
      ctx.fillRect(0, 0, width, height);

      const speed = 3 + accel * 90;

      stars.forEach((s) => {
        if (s.dist <= 0) return; // already pulled into the center and consumed
        const prevDist = s.dist;
        s.dist = Math.max(0, s.dist - speed);
        const x1 = cx + Math.cos(s.angle) * prevDist;
        const y1 = cy + Math.sin(s.angle) * prevDist;
        const x2 = cx + Math.cos(s.angle) * s.dist;
        const y2 = cy + Math.sin(s.angle) * s.dist;

        ctx.strokeStyle = `rgba(${s.alt ? "139, 92, 246" : "34, 211, 238"}, ${Math.min(1, 0.35 + accel)})`;
        ctx.lineWidth = 1 + accel * 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      });

      if (t < 1) requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  // Reusable so "Back to Entrance Page" can restart it — the black-hole warp
  // replaces this loop on the way out and never restarts it on its own.
  function startIntroStarfield() {
    if (cancelIntroStarfield) cancelIntroStarfield();
    cancelIntroStarfield = (
      initParticleCanvas(document.getElementById("intro-canvas"), {
        density: 9000,
        maxLink: 120,
        speed: 0.4,
        checkTriumphant: () => document.body.classList.contains("is-triumphant"),
        triumphantColor: "244, 63, 94",
        triumphantColorAlt: "251, 113, 133",
        // Once all 5 rings are hit, movement should read as a significant,
        // energetic shift on top of the already-brisk ambient drift.
        triumphantSpeedMult: 8,
        triumphantErratic: true,
      }) || {}
    ).cancel;
  }
  startIntroStarfield();

  cancelHeroStarfield = (
    initParticleCanvas(document.getElementById("hero-canvas"), { density: 16000, maxLink: 150, speed: 0.16 }) || {}
  ).cancel;

  /* ======================================================================
     Arcade — "Defend the Orbit". A small, self-contained shoot-'em-up:
     the ship tracks pointer X, click/tap fires, enemies spawn from the top
     and drift down. Pointer events (not mouse-specific) so touch dragging
     and tapping work too, even though the section copy is written for mice.
     Runs regardless of prefers-reduced-motion — it's opt-in gameplay behind
     a Start button, not unsolicited motion.
     ====================================================================== */
  (() => {
    const canvas = document.getElementById("arcade-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const arcade = canvas.closest(".arcade");
    const overlay = document.getElementById("arcade-overlay");
    const overlayTitle = document.getElementById("arcade-overlay-title");
    const overlayText = document.getElementById("arcade-overlay-text");
    const startBtn = document.getElementById("arcade-start");
    const scoreEl = document.getElementById("arcade-score");
    const livesEl = document.getElementById("arcade-lives");

    let width = 0;
    let height = 0;
    // Depth-based parallax starfield — purely a backdrop, no gameplay effect,
    // just drifting past to sell a sense of forward motion through space.
    let stars = [];
    function initStars() {
      stars = Array.from({ length: 70 }, () => {
        const depth = Math.random();
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          depth,
          speed: 0.6 + depth * 2.2,
          length: 4 + depth * 14,
        };
      });
    }
    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initStars();
    }
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    const player = { x: 0, y: 0, w: 34, h: 24 };
    let pointerX = null;
    let bullets = [];
    let enemies = [];
    let particles = [];
    let score = 0;
    let lives = 3;
    let running = false;
    let rafId = null;
    let lastTime = 0;
    let lastSpawn = 0;
    let spawnInterval = 1300;
    // Held-down fire: isFiring just tracks pointer state, the cooldown in
    // update() is what actually paces the shots into a rapid-fire stream
    // instead of one bullet per frame.
    let isFiring = false;
    let lastFireTime = 0;
    const FIRE_COOLDOWN_MS = 180;

    function resetGame() {
      bullets = [];
      enemies = [];
      particles = [];
      score = 0;
      lives = 3;
      spawnInterval = 1300;
      isFiring = false;
      scoreEl.textContent = "0";
      livesEl.textContent = "3";
      player.x = width / 2;
      player.y = height - 36;
    }

    function pointerToCanvasX(clientX) {
      const rect = canvas.getBoundingClientRect();
      return clientX - rect.left;
    }
    function onPointerMove(e) {
      pointerX = pointerToCanvasX(e.clientX);
    }
    function startFiring() {
      isFiring = true;
      lastFireTime = 0; // forces an immediate shot on the very next tick
    }
    function stopFiring() {
      isFiring = false;
    }

    function spawnEnemy() {
      const w = 26 + Math.random() * 12;
      enemies.push({
        x: Math.random() * (width - w) + w / 2,
        y: -20,
        w,
        h: w * 0.75,
        vy: 0.9 + Math.random() * 1.1,
        vx: (Math.random() - 0.5) * 0.7,
      });
    }

    function spawnBurst(x, y, color) {
      for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * 2 * i) / 8;
        particles.push({ x, y, vx: Math.cos(angle) * 2.2, vy: Math.sin(angle) * 2.2, life: 1, color });
      }
    }

    function loseLife() {
      lives -= 1;
      livesEl.textContent = String(Math.max(0, lives));
      if (lives <= 0) endGame();
    }

    function update(dt, timestamp) {
      stars.forEach((s) => {
        s.y += s.speed;
        if (s.y - s.length > height) {
          s.y = -2;
          s.x = Math.random() * width;
        }
      });

      if (pointerX !== null) {
        player.x += (pointerX - player.x) * 0.25;
        player.x = Math.max(player.w / 2, Math.min(width - player.w / 2, player.x));
      }

      if (isFiring && timestamp - lastFireTime >= FIRE_COOLDOWN_MS) {
        lastFireTime = timestamp;
        bullets.push({ x: player.x, y: player.y - player.h / 2 });
      }

      if (timestamp - lastSpawn > spawnInterval) {
        lastSpawn = timestamp;
        spawnEnemy();
        spawnInterval = Math.max(450, spawnInterval - 12);
      }

      bullets.forEach((b) => (b.y -= 6));
      bullets = bullets.filter((b) => b.y > -10);

      enemies.forEach((en) => {
        en.y += en.vy;
        en.x += en.vx;
        // Bounce off the side walls instead of drifting past them — an
        // enemy that wanders outside the canvas is one the player can
        // never line up a shot on, so it'd cost a life for free.
        if (en.x - en.w / 2 < 0) {
          en.x = en.w / 2;
          en.vx = Math.abs(en.vx);
        } else if (en.x + en.w / 2 > width) {
          en.x = width - en.w / 2;
          en.vx = -Math.abs(en.vx);
        }
      });

      for (let i = enemies.length - 1; i >= 0; i--) {
        const en = enemies[i];
        for (let j = bullets.length - 1; j >= 0; j--) {
          const b = bullets[j];
          if (Math.abs(en.x - b.x) < en.w / 2 + 3 && Math.abs(en.y - b.y) < en.h / 2 + 3) {
            spawnBurst(en.x, en.y, "139, 92, 246");
            enemies.splice(i, 1);
            bullets.splice(j, 1);
            score += 10;
            scoreEl.textContent = String(score);
            break;
          }
        }
      }

      for (let i = enemies.length - 1; i >= 0; i--) {
        const en = enemies[i];
        const reachedBottom = en.y - en.h / 2 > height;
        const hitPlayer =
          Math.abs(en.x - player.x) < (en.w + player.w) / 2.6 && Math.abs(en.y - player.y) < (en.h + player.h) / 2.6;
        if (reachedBottom || hitPlayer) {
          if (hitPlayer) spawnBurst(player.x, player.y, "34, 211, 238");
          enemies.splice(i, 1);
          loseLife();
        }
      }

      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= dt * 2.2;
      });
      particles = particles.filter((p) => p.life > 0);
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);

      // Streaks, not dots — a short line trailing back the way each star
      // came (opposite its direction of travel), longer and thicker the
      // faster/closer that star is, to read as motion blur rather than snow.
      stars.forEach((s) => {
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.2 + s.depth * 0.5})`;
        ctx.lineWidth = 0.3 + s.depth * 0.6;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x, s.y - s.length);
        ctx.stroke();
      });

      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.fillStyle = "#22d3ee";
      ctx.beginPath();
      ctx.moveTo(0, -player.h / 2);
      ctx.lineTo(player.w / 2, player.h / 2);
      ctx.lineTo(0, player.h / 4);
      ctx.lineTo(-player.w / 2, player.h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = "#67e8f9";
      bullets.forEach((b) => {
        ctx.beginPath();
        ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.fillStyle = "#8b5cf6";
      enemies.forEach((en) => {
        ctx.save();
        ctx.translate(en.x, en.y);
        ctx.beginPath();
        ctx.moveTo(0, en.h / 2);
        ctx.lineTo(en.w / 2, -en.h / 2);
        ctx.lineTo(-en.w / 2, -en.h / 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });

      particles.forEach((p) => {
        ctx.fillStyle = `rgba(${p.color}, ${Math.max(0, p.life)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    function loop(timestamp) {
      const dt = Math.min(0.05, (timestamp - lastTime) / 1000 || 0);
      lastTime = timestamp;
      update(dt, timestamp);
      draw();
      if (running) rafId = requestAnimationFrame(loop);
    }

    function startGame() {
      resizeCanvas();
      resetGame();
      overlay.classList.add("is-hidden");
      running = true;
      lastTime = performance.now();
      lastSpawn = lastTime;
      rafId = requestAnimationFrame(loop);
    }

    function endGame() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      overlayTitle.textContent = "Game Over";
      overlayText.textContent = `Final score: ${score}`;
      startBtn.textContent = "Play Again";
      overlay.classList.remove("is-hidden");
    }

    startBtn.addEventListener("click", startGame);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerdown", startFiring);
    // On window, not just the canvas — releasing after the pointer has
    // drifted off the canvas (dragging on touch, or a fast mouse move)
    // should still stop the rapid fire instead of leaving it stuck on.
    window.addEventListener("pointerup", stopFiring);
    window.addEventListener("pointercancel", stopFiring);
    // Keeps the ship steerable even if the pointer drifts onto the HUD/
    // overlay text or briefly off the canvas edge while dragging on touch.
    if (arcade) arcade.addEventListener("pointermove", onPointerMove);
  })();
})();
