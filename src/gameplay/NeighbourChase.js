export class NeighbourChase {
  constructor({ scene, createMesh, duration = 18, speed = 4.85, onCaught, onEscaped, onTimer }) {
    this.scene = scene;
    this.createMesh = createMesh;
    this.duration = duration;
    this.speed = speed;
    this.onCaught = onCaught;
    this.onEscaped = onEscaped;
    this.onTimer = onTimer;

    this.active = false;
    this.mode = "idle"; // "idle", "warning", "chasing"
    this.stage = "idle";
    this.mesh = null;
    this.remaining = 0;
    this.scoldDuration = 4.5;
    this.scoldTimer = 0;
    this.x = 0;
    this.z = 0;
    this.step = 0;
    this.waypoint = { x: 0, z: 0 };
    this.house = null;
    this.houseId = null;
    this.onWarningComplete = null;
  }

  // 1. WARNING MODE: Walk out of door onto thinnai, scold, and walk back inside
  startWarning(house, { onStart, onComplete } = {}) {
    if (this.active || !house) return false;
    this.active = true;
    this.mode = "warning";
    this.house = house;
    this.houseId = house.id;
    this.onWarningComplete = onComplete;

    this.mesh = this.createMesh();
    // Start at the recessed house door
    this.x = house.doorX ?? (house.side * 3.82);
    this.z = house.doorZ ?? house.z;
    this.stage = "walk-out";
    // Target is the front edge of the thinnai
    this.waypoint = { x: house.x, z: house.z };
    this.mesh.position.set(this.x, house.y ?? 0.36, this.z);
    this.scene.add(this.mesh);

    onStart?.();
    return true;
  }

  // 2. CHASE MODE: Rush out onto street and aggressively pursue player for 18 seconds
  startChase(house) {
    if (this.active) {
      this.stop(); // Preempt warning if player provoked during warning
    }
    if (!house) return false;
    this.active = true;
    this.mode = "chasing";
    this.house = house;
    this.houseId = house.id;
    this.remaining = this.duration;

    this.mesh = this.createMesh();
    // Start on thinnai
    this.x = house.x;
    this.z = house.z;
    this.stage = "exit-thinnai";
    this.waypoint = { x: house.exitX ?? (house.side * 1.5), z: house.z };
    this.mesh.position.set(this.x, 0, this.z);
    this.scene.add(this.mesh);

    this.onTimer?.(this.remaining, "chasing");
    return true;
  }

  update(dt, player, playerAlive) {
    if (!this.active || !playerAlive || !this.mesh) return;

    if (this.mode === "warning") {
      this.updateWarning(dt);
    } else if (this.mode === "chasing") {
      this.updateChase(dt, player);
    }
  }

  updateWarning(dt) {
    const arms = this.mesh.userData?.arms || [];
    this.step += dt * 8;

    if (this.stage === "walk-out") {
      const dx = this.waypoint.x - this.x;
      const dz = this.waypoint.z - this.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.22) {
        // Arrived at front of veranda -> start scolding
        this.stage = "scold";
        this.scoldTimer = this.scoldDuration;
        this.mesh.rotation.y = this.house.side > 0 ? -Math.PI / 2 : Math.PI / 2;
      } else {
        const step = Math.min(dist, 2.4 * dt);
        this.x += (dx / dist) * step;
        this.z += (dz / dist) * step;
        this.mesh.rotation.y = Math.atan2(dx, dz);
        // Subtle arm swing
        if (arms.length >= 2) {
          arms[0].rotation.x = Math.sin(this.step) * 0.4;
          arms[1].rotation.x = -Math.sin(this.step) * 0.4;
        }
      }
      this.mesh.position.set(this.x, (this.house.y ?? 0.36) + Math.abs(Math.sin(this.step * 1.5)) * 0.04, this.z);
    } else if (this.stage === "scold") {
      this.scoldTimer -= dt;
      // Vigorous angry fist shaking while scolding
      if (arms.length >= 2) {
        arms[0].rotation.x = -1.2 + Math.sin(this.step * 2.5) * 0.45;
        arms[1].rotation.x = -1.2 - Math.sin(this.step * 2.5) * 0.45;
      }
      this.mesh.position.y = (this.house.y ?? 0.36) + Math.abs(Math.sin(this.step * 3)) * 0.025;

      if (this.scoldTimer <= 0) {
        // Warning finished -> walk back inside
        this.stage = "walk-in";
        this.waypoint = { x: this.house.doorX ?? (this.house.side * 3.82), z: this.house.doorZ ?? this.house.z };
      }
    } else if (this.stage === "walk-in") {
      const dx = this.waypoint.x - this.x;
      const dz = this.waypoint.z - this.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.22) {
        // Reached door -> end warning and trigger cooldown
        const cb = this.onWarningComplete;
        this.stop();
        cb?.();
        return;
      } else {
        const step = Math.min(dist, 2.2 * dt);
        this.x += (dx / dist) * step;
        this.z += (dz / dist) * step;
        this.mesh.rotation.y = Math.atan2(dx, dz);
        if (arms.length >= 2) {
          arms[0].rotation.x = Math.sin(this.step) * 0.3;
          arms[1].rotation.x = -Math.sin(this.step) * 0.3;
        }
      }
      this.mesh.position.set(this.x, (this.house.y ?? 0.36) + Math.abs(Math.sin(this.step * 1.5)) * 0.04, this.z);
    }
  }

  updateChase(dt, player) {
    this.remaining = Math.max(0, this.remaining - dt);
    this.onTimer?.(this.remaining, "chasing");

    if (this.remaining <= 0) {
      this.stop();
      this.onEscaped?.();
      return;
    }

    const target = this.stage === "exit-thinnai" ? this.waypoint : player;
    const dx = target.x - this.x;
    const dz = target.z - this.z;
    const distance = Math.hypot(dx, dz);

    if (this.stage === "exit-thinnai" && distance < 0.42) {
      this.stage = "chase-player";
    } else if (this.stage === "chase-player" && distance < 0.82 && (player.feet ?? 0) < 1.4) {
      this.stop();
      this.onCaught?.();
      return;
    }

    if (distance > 0.001) {
      const step = Math.min(distance, this.speed * dt);
      this.x += (dx / distance) * step;
      this.z += (dz / distance) * step;
      this.mesh.rotation.y = Math.atan2(dx, dz);
    }

    this.step += dt * 13;
    const arms = this.mesh.userData?.arms || [];
    if (arms.length >= 2) {
      arms[0].rotation.x = Math.sin(this.step) * 0.7;
      arms[1].rotation.x = -Math.sin(this.step) * 0.7;
    }
    this.mesh.position.set(this.x, Math.abs(Math.sin(this.step)) * 0.055, this.z);
  }

  stop() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.traverse?.(object => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach(material => material.dispose?.());
        else object.material?.dispose?.();
      });
    }
    this.mesh = null;
    this.active = false;
    this.mode = "idle";
    this.stage = "idle";
    this.remaining = 0;
    this.house = null;
    this.houseId = null;
  }
}
