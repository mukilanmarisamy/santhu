// First-run tutorial and on-demand help. Press H or use the "How to play" button to reopen it.
const STORAGE_KEY = "santhu-tutorial-seen-v1";

const STEPS = [
  {
    title: "Move and look",
    lead: "Click the game view once to lock the mouse. Esc releases it.",
    rows: [
      [["W", "A", "S", "D"], "Walk around the lane."],
      [["Mouse"], "Look around."],
      [["Space"], "Jump, about 1.2 m. Enough to hop onto parapets and across alleys."],
      [["1", "–", "9"], "Pick a cracker from the bar at the bottom."],
      [["H"], "Open this tutorial again at any time."]
    ],
    tip: "Your health bar is top-left. Blasts close to you hurt."
  },
  {
    title: "Placed crackers",
    lead: "Wala (2), Flower Pot (4), Chakkar (5), Sky Shot (6), Photo Flash (8), Multi-Shot (9).",
    rows: [
      [["Left click"], "Drops the cracker flat under your feet."],
      [["Right click"], "Does the same thing, instantly."],
      [["4 s"], "Every placed cracker has a 4 second fuse. Sparks show it is lit. Walk away."],
      [["Wala"], "Lays a 10 m chain in the direction you are facing."]
    ],
    tip: "Standing on the cracker when the fuse ends is a bad idea."
  },
  {
    title: "Throwing bombs",
    lead: "Laxmi Bomb (1), Hydro Bomb (3), Color Smoke (7).",
    rows: [
      [["Hold left mouse"], "Lights the fuse and charges power. The bar fills over 1.5 seconds."],
      [["Release"], "Throws. A tap drops it near your feet, a full charge arcs far down the street."],
      [["Hidden fuse"], "There is no timer on screen. The fuse is short and keeps burning in the air."],
      [["Tap left mouse"], "Throws with minimum power immediately."]
    ],
    tip: "Hold too long and it explodes in your hand: heavy damage, and a Hydro Bomb sends you to hospital."
  },
  {
    title: "The neighbours",
    lead: "Only loud blasts count: Laxmi and Hydro bombs.",
    rows: [
      [["2 blasts"], "Two loud blasts near the same house within 8 seconds, or any blast on its veranda, and the neighbour steps out and shouts."],
      [["4 blasts"], "Four within 8 seconds and he sprints after you for 18 seconds."],
      [["Caught"], "You get scolded and sent home."],
      [["Escape"], "Outrun him, or climb: he cannot catch you above 1.4 m, so rooftops are safe."]
    ],
    tip: "His words appear in a speech bubble above his head."
  },
  {
    title: "Rooftops and the map",
    lead: "Houses stand shoulder to shoulder with narrow alleys between them.",
    rows: [
      [["Stairs"], "Every third alley has open concrete stairs. Walk in and climb to the roof."],
      [["Roofs"], "Jump from roof to roof across the alleys. Parapets stop you at the edges."],
      [["Hospital"], "North end of the lane. You respawn there after WASTED."],
      [["Playground"], "South end. Open ground for long throws and Sky Shots."],
      [["Day / Night"], "Top-right button switches the lighting."]
    ],
    tip: "Real crackers are dangerous. Keep this one in the game."
  }
];

export class Tutorial {
  constructor({ onOpen, onClose } = {}) {
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.index = 0;
    this.isOpen = false;

    this.root = document.createElement("div");
    this.root.className = "tutorial hidden";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.innerHTML = `
      <div class="tutorial-card">
        <div class="tutorial-step" data-ref="step"></div>
        <h2 class="tutorial-title" data-ref="title"></h2>
        <p class="tutorial-lead" data-ref="lead"></p>
        <ul class="tutorial-rows" data-ref="rows"></ul>
        <div class="tutorial-tip" data-ref="tip"></div>
        <div class="tutorial-dots" data-ref="dots"></div>
        <div class="tutorial-actions">
          <button type="button" class="tutorial-btn ghost" data-ref="skip">Skip</button>
          <span class="tutorial-spacer"></span>
          <button type="button" class="tutorial-btn" data-ref="back">Back</button>
          <button type="button" class="tutorial-btn primary" data-ref="next">Next</button>
        </div>
      </div>`;
    document.body.appendChild(this.root);
    const ref = name => this.root.querySelector(`[data-ref="${name}"]`);
    this.el = Object.fromEntries(["step", "title", "lead", "rows", "tip", "dots", "skip", "back", "next"].map(n => [n, ref(n)]));

    this.el.next.addEventListener("click", () => this.next());
    this.el.back.addEventListener("click", () => this.back());
    this.el.skip.addEventListener("click", () => this.close());
    // Capture phase: while the tutorial is open, keys never reach the game.
    document.addEventListener("keydown", e => this.onKey(e), true);
    document.querySelector("#help-toggle")?.addEventListener("click", () => (this.isOpen ? this.close() : this.open()));
  }

  hasSeen() {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  }

  markSeen() {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* storage unavailable: show again next time */ }
  }

  showFirstRun() {
    if (!this.hasSeen()) this.open();
  }

  open(index = 0) {
    this.index = index;
    this.isOpen = true;
    this.render();
    this.root.classList.remove("hidden");
    document.exitPointerLock?.();
    this.onOpen?.();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add("hidden");
    this.markSeen();
    this.onClose?.();
  }

  next() {
    if (this.index >= STEPS.length - 1) this.close();
    else { this.index++; this.render(); }
  }

  back() {
    if (this.index > 0) { this.index--; this.render(); }
  }

  onKey(e) {
    const k = e.key.toLowerCase();
    if (!this.isOpen) {
      if (k === "h" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) this.open();
      return;
    }
    e.stopImmediatePropagation();
    if (["arrowright", "enter", " ", "d"].includes(k)) { e.preventDefault(); this.next(); }
    else if (["arrowleft", "a"].includes(k)) { e.preventDefault(); this.back(); }
    else if (k === "escape" || k === "h") { e.preventDefault(); this.close(); }
  }

  render() {
    const s = STEPS[this.index];
    const last = this.index === STEPS.length - 1;
    this.el.step.textContent = `Step ${this.index + 1} of ${STEPS.length}`;
    this.el.title.textContent = s.title;
    this.el.lead.textContent = s.lead;
    this.el.rows.innerHTML = s.rows
      .map(([keys, text]) => `<li><span class="tutorial-keys">${keys.map(k => `<kbd>${k}</kbd>`).join("")}</span><span>${text}</span></li>`)
      .join("");
    this.el.tip.textContent = s.tip;
    this.el.dots.innerHTML = STEPS.map((_, i) => `<i class="${i === this.index ? "on" : ""}"></i>`).join("");
    this.el.back.style.visibility = this.index === 0 ? "hidden" : "visible";
    this.el.skip.style.visibility = last ? "hidden" : "visible";
    this.el.next.textContent = last ? "Start playing" : "Next";
  }
}
