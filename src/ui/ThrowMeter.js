// Shows throw power only. The fuse is deliberately invisible: no countdown numbers or timers.
export class ThrowMeter {
  constructor(root) {
    this.root = root;
    this.fill = root.querySelector("#throw-fill");
    this.percent = root.querySelector("#throw-percent");
    this.label = root.querySelector("#throw-label");
    this.hint = root.querySelector("#throw-hint");
  }

  update({ visible, charge }) {
    this.root.classList.toggle("hidden", !visible);
    const value = Math.round(charge * 100);
    this.fill.style.width = `${value}%`;
    this.fill.className = "h-full rounded-full bg-amber-400";
    this.percent.textContent = `${value}%`;
    this.label.textContent = "THROW POWER";
    this.hint.textContent = "The fuse is lit. Release the left mouse button to throw.";
  }
}
