// Mouse button controller (Primary: Left Mouse Button [0], Secondary: Right Mouse Button [2]).
//  - Throwables: pressing LMB (or RMB) lights the fuse and starts a charge timer (chargePower += dt every frame).
//    Power is linear and capped at maxHoldSec (1.5 s). Releasing fires onRelease({ charge }) with charge in 0..1.
//  - Anything canCharge() rejects (ground-placed items) fires onInstant() on press and never charges.
export class ChargeThrowController {
  constructor(element, { canCharge, onInstant, onIgnite, onRelease, onCancel, onProgress, maxHoldSec = 1.5 }) {
    this.element = element;
    this.canCharge = canCharge;
    this.onInstant = onInstant;
    this.onIgnite = onIgnite;
    this.onRelease = onRelease;
    this.onCancel = onCancel;
    this.onProgress = onProgress;
    this.maxHoldSec = maxHoldSec;
    this.active = false;
    this.activeButton = null;
    this.chargePower = 0; // seconds held, 0..maxHoldSec
    this.handleDown = this.handleDown.bind(this);
    this.handleUp = this.handleUp.bind(this);
    this.handleCancel = this.handleCancel.bind(this);
    element.addEventListener("pointerdown", this.handleDown);
    window.addEventListener("pointerup", this.handleUp);
    window.addEventListener("pointercancel", this.handleCancel);
    window.addEventListener("blur", this.handleCancel);
  }

  get charge() {
    return Math.min(1, this.chargePower / this.maxHoldSec);
  }

  handleDown(event) {
    // Respond to Left Mouse Button (0) and Right Mouse Button (2)
    if ((event.button !== 0 && event.button !== 2) || this.active) return;
    event.preventDefault();
    if (document.pointerLockElement !== this.element) {
      this.element.requestPointerLock?.();
      return;
    }
    if (this.canCharge && !this.canCharge()) {
      this.onInstant?.();
      return;
    }
    this.active = true;
    this.activeButton = event.button;
    this.chargePower = 0;
    this.onIgnite?.();
    this.onProgress?.({ visible: true, charge: 0 });
  }

  // Called once per animation frame with the frame delta in seconds.
  update(dt) {
    if (!this.active) return;
    this.chargePower = Math.min(this.maxHoldSec, this.chargePower + dt);
    this.onProgress?.({ visible: true, charge: this.charge });
  }

  handleUp(event) {
    if (this.activeButton === null || event.button !== this.activeButton || !this.active) return;
    event.preventDefault();
    const charge = this.charge;
    this.active = false;
    this.activeButton = null;
    this.chargePower = 0;
    this.onRelease?.({ charge });
    this.onProgress?.({ visible: false, charge: 0 });
  }

  handleCancel() {
    if (!this.active) return;
    this.active = false;
    this.activeButton = null;
    this.chargePower = 0;
    this.onCancel?.();
    this.onProgress?.({ visible: false, charge: 0 });
  }

  reset() {
    this.active = false;
    this.activeButton = null;
    this.chargePower = 0;
    this.onProgress?.({ visible: false, charge: 0 });
  }
}
