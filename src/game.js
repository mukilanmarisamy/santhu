
    import * as THREE from "three";
import { ChargeThrowController } from "./gameplay/ChargeThrowController.js";
import { NeighbourChase } from "./gameplay/NeighbourChase.js";
import { ThrowMeter } from "./ui/ThrowMeter.js";
import { Tutorial } from "./ui/Tutorial.js";
// style.css loaded via index.html

    const mount = document.querySelector("#game");
    const statusEl = document.querySelector("#status");
    const healthLabel = document.querySelector("#health-label");
    const healthFill = document.querySelector("#health-fill");
    const damageFlash = document.querySelector("#damage-flash");
    const photoFlash = document.querySelector("#photo-flash");
    const wastedScreen = document.querySelector("#wasted-screen");
    const caughtScreen = document.querySelector("#caught-screen");
    const caughtText = document.querySelector("#caught-text");
    const speechBubble = document.querySelector("#speech-bubble");
    const speechText = document.querySelector("#speech-text");
    const menu = document.querySelector("#menu");
    const smokeSelect = document.querySelector("#smoke-color");
    const chasePanel = document.querySelector("#chase-panel");
    const chaseFill = document.querySelector("#chase-fill");
    const chaseTime = document.querySelector("#chase-time");
    const throwMeter = new ThrowMeter(document.querySelector("#throw-meter"));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080d1a);
    scene.fog = new THREE.Fog(0x080d1a, 35, 340);

    const camera = new THREE.PerspectiveCamera(76, innerWidth / innerHeight, .08, 1800);
    camera.rotation.order = "YXZ";

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "low-power" });
    if ("physicallyCorrectLights" in renderer && !("useLegacyLights" in renderer)) renderer.physicallyCorrectLights = true;
    // Keep the render target modest so large particle bursts do not overwhelm integrated GPUs.
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.0));
    renderer.setSize(innerWidth, innerHeight);
    if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace; else renderer.outputEncoding = 3001;
    if (THREE.ACESFilmicToneMapping) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    mount.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xc3d9ff, 0x665342, .62);
    scene.add(hemi);
    const sunlight = new THREE.DirectionalLight(0xffe6bd, .24);
    sunlight.position.set(-16, 32, 13);
    scene.add(sunlight);

    const mat = (color, roughness = .9, extra = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness, ...extra });

    const materials = {
      dirt: mat(0x9a8060), lane: mat(0x77736a), concrete: mat(0x9a9385),
      brick: mat(0x984f3f), trim: mat(0x57483c), pink: mat(0xe8799a),
      blue: mat(0x5ca7d2), yellow: mat(0xe9c35b), green: mat(0x78a46b),
      cream: mat(0xdac6a0), dark: mat(0x303138), foliage: mat(0x245d36),
      foliageLight: mat(0x418044), bark: mat(0x644832)
    };

    const buildings = [];
    const floorTargets = [];
    const verandas = [];

    function box(x, y, z, sx, sy, sz, material, name = "") {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
      mesh.position.set(x, y, z);
      if (name) mesh.name = name;
      scene.add(mesh);
      return mesh;
    }

    // ═══ WORLD LAYOUT (scaled-up town) ═════════════════════════════════════════
    // Houses are locked side by side; the only break between neighbours is a 1.3-unit alley.
    const HOUSE_DEPTH = 9.25, ALLEY_GAP = 1.3, HOUSE_PITCH = HOUSE_DEPTH + ALLEY_GAP;
    const HOUSES_PER_SIDE = 9, MAIN_WIDTH = 8.2, FRONT_X = 3.82, HOUSE_HEIGHT = 6.4;
    const STAIR_GAPS = [1, 4, 7];            // alley indices (between house g and g+1) that hold a rooftop staircase
    const houseSegments = Array.from({ length: HOUSES_PER_SIDE }, (_, i) => (i - (HOUSES_PER_SIDE - 1) / 2) * HOUSE_PITCH);
    const streetHalf = houseSegments[HOUSES_PER_SIDE - 1] + HOUSE_DEPTH / 2 + 3;
    const X_LIMIT = 42, Z_LIMIT = streetHalf + 32;
    const STEP_UP = 0.45, GRAVITY = 17, JUMP_FORCE = 6.6;
    const stairFlights = [];

    // Large continuous floor lets tossed crackers travel and land without a world-edge cutoff.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), materials.dirt);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -.03;
    ground.name = "street-and-ground";
    ground.userData.surfaceY = 0;
    scene.add(ground);
    floorTargets.push(ground);

    // Long narrow santhu lane between the close-packed houses.
    box(0, .005, 0, 4.5, .04, streetHalf * 2, materials.lane, "santhu");
    box(0, .028, 0, .045, .012, streetHalf * 2 - 2, mat(0x938a76), "drain-line");
    const drainMat = mat(0x555753);
    for (let z = -streetHalf + 3; z < streetHalf - 2; z += 3) {
      box(-2.05, .04, z, .18, .025, .42, drainMat, "drain-cover");
    }

    const palette = [
      materials.pink, materials.blue, materials.yellow, materials.green, materials.cream,
      mat(0x9b7aa8, 0.9), mat(0xc98463, 0.9), mat(0x5d9991, 0.9), mat(0xb86b6b, 0.9), mat(0x6d7fa3, 0.9)
    ];

    // Adds an axis-aligned wall box that is both visible and solid.
    function solidBox(xc, yc, zc, sx, sy, sz, material, name, top) {
      const mesh = box(xc, yc, zc, sx, sy, sz, material, name);
      buildings.push({
        id: name, minX: xc - sx / 2, maxX: xc + sx / 2, minZ: zc - sz / 2, maxZ: zc + sz / 2,
        height: top, top
      });
      return mesh;
    }

    function makeHouse(side, z, wash, height, opts) {
      const { label, index, openPlusZ, openMinusZ } = opts;
      const houseDepth = HOUSE_DEPTH;
      const houseId = `house-${side}-${index}`;
      const frontWallX = side * FRONT_X;
      const mainWidth = MAIN_WIDTH;
      const mainX = side * (FRONT_X + mainWidth / 2);
      const roofTop = height + 0.16;

      // 1. Enclosed main block
      box(mainX, height / 2, z, mainWidth, height, houseDepth, wash, "house-main");
      buildings.push({
        id: houseId,
        minX: Math.min(side * FRONT_X, side * (FRONT_X + mainWidth)),
        maxX: Math.max(side * FRONT_X, side * (FRONT_X + mainWidth)),
        minZ: z - houseDepth / 2, maxZ: z + houseDepth / 2,
        height, top: roofTop
      });

      // 2. Side wing walls framing the thinnai
      const wingThickness = 0.32, wingWidth = 1.57;
      const wingX = side * (2.25 + wingWidth / 2);
      for (const dz of [-houseDepth / 2 + wingThickness / 2, houseDepth / 2 - wingThickness / 2]) {
        box(wingX, 1.4, z + dz, wingWidth, 2.8, wingThickness, wash, "thinnai-wing-wall");
        buildings.push({
          id: `${houseId}-wing`,
          minX: Math.min(side * 2.25, side * FRONT_X), maxX: Math.max(side * 2.25, side * FRONT_X),
          minZ: z + dz - wingThickness / 2, maxZ: z + dz + wingThickness / 2,
          height: 2.8, top: 2.8
        });
      }

      // 3. Integrated thinnai veranda
      const porchWidth = 1.55;
      const porchX = side * (2.25 + porchWidth / 2);
      const porchDepth = houseDepth - wingThickness * 2 - 0.08;
      const porchTop = 0.36;
      const porch = box(porchX, porchTop / 2, z, porchWidth, porchTop, porchDepth, mat(0x9a3d2e, 0.75), "thinnai-veranda");
      porch.userData.surfaceY = porchTop;
      porch.userData.houseId = houseId;
      floorTargets.push(porch);
      box(side * 2.15, 0.08, z, 0.26, 0.16, 2.6, mat(0x787268), "thinnai-step");

      const kolam = new THREE.Mesh(
        new THREE.PlaneGeometry(0.85, 1.4),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.68, depthWrite: false })
      );
      kolam.rotation.x = -Math.PI / 2;
      kolam.position.set(porchX, porchTop + 0.005, z);
      scene.add(kolam);

      verandas.push({
        id: houseId, label, side, z, x: porchX,
        exitX: side * 1.5, doorX: frontWallX, doorZ: z,
        minX: Math.min(side * 2.25, side * FRONT_X), maxX: Math.max(side * 2.25, side * FRONT_X),
        minZ: z - porchDepth / 2, maxZ: z + porchDepth / 2,
        y: porchTop,
        blastHistory: [],        // timestamps of loud blasts (rolling window, see onDetonation)
        warnCooldownUntil: 0
      });

      // 4. Pillars on pedestals
      const pillarX = side * 2.38;
      const pedestalMat = mat(0x56534e), columnMat = mat(0x5e3c23, 0.65), capMat = mat(0x4a2e1a);
      for (const dz of [-2.4, 0, 2.4]) {
        box(pillarX, 0.22, z + dz, 0.22, 0.44, 0.22, pedestalMat, "pillar-base");
        const column = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.08, 2.45, 10), columnMat);
        column.position.set(pillarX, 1.66, z + dz);
        scene.add(column);
        box(pillarX, 2.92, z + dz, 0.24, 0.12, 0.24, capMat, "pillar-capital");
      }
      box(pillarX, 2.98, z, 0.14, 0.12, porchDepth + 0.2, capMat, "porch-lintel-beam");

      // 5. Sloping tiled eave
      const eave = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.08, houseDepth), mat(0x944231, 0.8));
      eave.position.set(side * 3.08, 3.25, z);
      eave.rotation.z = side * 0.16;
      scene.add(eave);

      // 6. Flat rooftop terrace (motta maadi)
      const roof = box(mainX, height + 0.08, z, mainWidth, 0.16, houseDepth, materials.concrete, "motta-maadi");
      roof.userData.surfaceY = roofTop;
      floorTargets.push(roof);

      // Parapets are solid. The wall facing a staircase alley has a gap at the landing so the roof is reachable.
      const p = 0.16, ph = 0.52, py = roofTop + ph / 2;
      const u0 = FRONT_X, u1 = FRONT_X + mainWidth, openLo = 10.7, openHi = 11.86;
      const parapet = (uA, uB, zc, sz) => {
        solidBox(side * (uA + uB) / 2, py, zc, uB - uA, ph, sz, materials.trim, `${houseId}-parapet`, roofTop + ph);
      };
      for (const [dir, open] of [[-1, openMinusZ], [1, openPlusZ]]) {
        const zc = z + dir * (houseDepth / 2 - p / 2);
        if (open) { parapet(u0, openLo, zc, p); if (u1 - openHi >= 0.2) parapet(openHi, u1, zc, p); }
        else parapet(u0, u1, zc, p);
      }
      parapet(u1 - p, u1, z, houseDepth);          // back wall
      parapet(u0, u0 + p, z, houseDepth);          // street-facing lip

      // 7. Door and windows on the recessed front wall
      box(frontWallX, 1.35, z, 0.08, 2.3, 1.25, mat(0x3e281b), "door");
      box(frontWallX - side * 0.05, 2.52, z, 0.14, 0.14, 1.5, mat(0xc99448), "door-lintel");
      box(frontWallX - side * 0.06, 1.35, z + 0.12, 0.04, 0.14, 0.04, mat(0xd4af37, 0.3, { metalness: 0.8 }), "door-handle");
      const winMat = mat(0x1a2634, 0.4, { emissive: 0x221a0f, emissiveIntensity: 0.15 });
      const upperMat = mat(0x182937, 0.35, { emissive: 0x3c2a15, emissiveIntensity: 0.18 });
      for (const dz of [-2.6, 2.6]) {
        box(frontWallX, 1.55, z + dz, 0.08, 1.3, 1.1, winMat, "thinnai-window");
        box(frontWallX - side * 0.06, 0.85, z + dz, 0.16, 0.1, 1.3, materials.trim, "thinnai-sill");
        box(frontWallX, 4.4, z + dz, 0.08, 1.45, 1.35, upperMat, "upper-window");
        box(frontWallX - side * 0.08, 3.62, z + dz, 0.18, 0.12, 1.55, materials.trim, "upper-sill");
      }
    }

    // Freestanding open stair flight that lives entirely inside one alley gap.
    // u = distance from the lane centre line (x * side). Treads have open risers, rails and stringers on both sides.
    function buildGapStairs(side, gapZ, roofTop) {
      const u0 = 2.45, u1 = 10.9, landLen = 0.96, treadW = 1.1, treadT = 0.1;
      const count = Math.ceil(roofTop / 0.215);
      const rise = roofTop / count, run = (u1 - u0) / count;
      const concrete = materials.concrete;
      const steel = mat(0x4a3b2c, 0.6, { metalness: 0.4 });
      const beamMat = mat(0x756f64);

      for (let i = 0; i < count; i++) {
        const uc = u0 + (i + 0.5) * run;
        const tread = box(side * uc, (i + 1) * rise - treadT / 2, gapZ, run + 0.02, treadT, treadW, concrete, "stair-tread");
        tread.userData.surfaceY = (i + 1) * rise;
        floorTargets.push(tread);
      }
      const landing = box(side * (u1 + landLen / 2), roofTop - 0.06, gapZ, landLen, 0.12, treadW, concrete, "stair-landing");
      landing.userData.surfaceY = roofTop;
      floorTargets.push(landing);

      const L = Math.hypot(u1 - u0, roofTop), ang = Math.atan2(roofTop, u1 - u0);
      const midU = (u0 + u1) / 2, lineMid = roofTop / 2 + rise / 2;
      for (const dz of [-0.56, 0.56]) {
        const beam = box(side * midU, lineMid - treadT - 0.14, gapZ + dz, L, 0.28, 0.08, beamMat, "stair-stringer");
        beam.rotation.z = side * ang;
        const rail = box(side * midU, lineMid + 0.9, gapZ + dz, L, 0.05, 0.05, steel, "stair-handrail");
        rail.rotation.z = side * ang;
        for (let i = 0; i < count; i += 3) {
          box(side * (u0 + (i + 0.5) * run), (i + 1) * rise + 0.45, gapZ + dz, 0.03, 0.9, 0.03, steel, "stair-baluster");
        }
        // concrete piers under the stringers
        for (const t of [0.3, 0.62, 0.92]) {
          const u = u0 + t * (u1 - u0);
          const h = Math.max(0.2, (Math.floor((u - u0) / run) + 1) * rise - 0.35);
          box(side * u, h / 2, gapZ + dz, 0.16, h, 0.1, beamMat, "stair-pier");
        }
      }
      // pier + guard rail at the landing end so nobody walks off the back of the alley
      box(side * (u1 + landLen - 0.1), (roofTop - 0.12) / 2, gapZ, 0.16, roofTop - 0.12, treadW, beamMat, "landing-pier");
      solidBox(side * (u1 + landLen + 0.04), roofTop + 0.45, gapZ, 0.08, 0.9, ALLEY_GAP, steel, "landing-guard", roofTop + 0.9);

      stairFlights.push({ side, gapZ, halfW: ALLEY_GAP / 2, u0, u1, landLen, rise, run, count, top: roofTop });
    }

    for (let i = 0; i < HOUSES_PER_SIDE; i++) {
      const z = houseSegments[i];
      for (const side of [-1, 1]) {
        makeHouse(side, z, palette[(i * 2 + (side > 0 ? 1 : 0)) % palette.length], HOUSE_HEIGHT, {
          label: `${side > 0 ? "East" : "West"} house ${i + 1}`,
          index: i,
          openPlusZ: STAIR_GAPS.includes(i),
          openMinusZ: STAIR_GAPS.includes(i - 1)
        });
      }
    }
    for (const g of STAIR_GAPS) {
      const gapZ = (houseSegments[g] + houseSegments[g + 1]) / 2;
      for (const side of [-1, 1]) buildGapStairs(side, gapZ, HOUSE_HEIGHT + 0.16);
    }

    // Public Government Hospital at the north end of the lane (door faces the street).
    const hospitalX = 0, hospitalZ = -(streetHalf + 16), hospitalW = 11, hospitalD = 9, hospitalH = 6.5;
    const hospitalFront = hospitalZ + hospitalD / 2;
    box(hospitalX, hospitalH / 2, hospitalZ, hospitalW, hospitalH, hospitalD, mat(0xd6d0b8), "government-hospital");
    box(hospitalX, hospitalH + .08, hospitalZ, hospitalW, .16, hospitalD, materials.concrete, "hospital-roof");
    box(hospitalX, 3.2, hospitalFront + .04, 7.6, .75, .12,
      mat(0xf0f0e9, .8, { emissive: 0x172b22, emissiveIntensity: .1 }), "hospital-sign");
    box(hospitalX, 3.25, hospitalFront + .12, .28, .58, .08, mat(0x229452), "hospital-cross-v");
    box(hospitalX, 3.25, hospitalFront + .12, .58, .28, .08, mat(0x229452), "hospital-cross-h");
    box(hospitalX, 1.25, hospitalFront + .06, 1.6, 2.5, .08, mat(0x554539), "hospital-door");
    buildings.push({
      id: "hospital", minX: hospitalX - hospitalW / 2, maxX: hospitalX + hospitalW / 2,
      minZ: hospitalZ - hospitalD / 2, maxZ: hospitalZ + hospitalD / 2, height: hospitalH, top: hospitalH + .16
    });
    const hospital = { x: hospitalX, z: hospitalFront + 3.5 };

    // Starting home on the lane next to the initial spawn.
    const home = { x: 0, z: 13, feet: 0 };

    // Large dusty open playground (maidaanam) at the south end of the lane: room for long throws.
    const lotW = 40, lotD = 30, lotCX = 0, lotCZ = streetHalf + 18;
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(lotW, lotD), mat(0xb69b70));
    lot.rotation.x = -Math.PI / 2;
    lot.position.set(lotCX, .012, lotCZ);
    lot.name = "maidaanam";
    lot.userData.surfaceY = .02;
    scene.add(lot);
    floorTargets.push(lot);
    const lotWallMat = mat(0x806044);
    for (const [x, z, sx, sz] of [
      [lotCX - lotW / 2, lotCZ, .25, lotD], [lotCX + lotW / 2, lotCZ, .25, lotD],
      [lotCX, lotCZ + lotD / 2, lotW, .25]
    ]) solidBox(x, .28, z, sx, .56, sz, lotWallMat, "lot-boundary", .56);

    const stoneMat = mat(0x85745b);
    for (let i = 0; i < 90; i++) {
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(.04 + Math.random() * .11, 0), stoneMat);
      stone.position.set(lotCX + (Math.random() - .5) * (lotW - 2), .045, lotCZ + (Math.random() - .5) * (lotD - 2));
      stone.scale.y = .3;
      scene.add(stone);
    }

    // Square kulam with brick frame and animated water, beside the playground.
    const pondX = -26, pondZ = streetHalf + 9, pondSize = 6.2;
    box(pondX, -.12, pondZ, pondSize + .7, .24, pondSize + .7, mat(0x574b3e), "kulam-bed");
    const waterGeo = new THREE.PlaneGeometry(pondSize, pondSize, 24, 24);
    waterGeo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(waterGeo, new THREE.MeshPhongMaterial({
      color: 0x286b98, transparent: true, opacity: .84, shininess: 90, side: THREE.DoubleSide
    }));
    water.position.set(pondX, .06, pondZ);
    scene.add(water);
    for (const [x, z, sx, sz] of [
      [pondX, pondZ - pondSize / 2 - .18, pondSize + .7, .36],
      [pondX, pondZ + pondSize / 2 + .18, pondSize + .7, .36],
      [pondX - pondSize / 2 - .18, pondZ, .36, pondSize],
      [pondX + pondSize / 2 + .18, pondZ, .36, pondSize]
    ]) box(x, .38, z, sx, .76, sz, materials.brick, "kulam-brick-wall");

    // Low-poly coconut and neem trees plus banana shrubs around lane edges.
    function leaf(position, scale, material, rotation = 0) {
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), material);
      m.position.copy(position);
      m.scale.set(scale[0], scale[1], scale[2]);
      m.rotation.y = rotation;
      scene.add(m);
    }
    function coconutTree(x, z) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.13, .23, 5.6, 7), materials.bark);
      trunk.position.set(x, 2.8, z);
      scene.add(trunk);
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI * 2;
        const frond = new THREE.Mesh(new THREE.ConeGeometry(.23, 3.6, 5), materials.foliageLight);
        frond.position.set(x + Math.cos(a) * 1.2, 5.7, z + Math.sin(a) * 1.2);
        frond.rotation.z = Math.cos(a) * .8;
        frond.rotation.x = Math.sin(a) * .8;
        scene.add(frond);
      }
      leaf(new THREE.Vector3(x, 5.55, z), [.5, .42, .5], materials.foliage);
    }
    function neemTree(x, z) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.16, .25, 4.4, 7), materials.bark);
      trunk.position.set(x, 2.2, z);
      scene.add(trunk);
      for (let i = 0; i < 7; i++) {
        const a = i * Math.PI * 2 / 7;
        leaf(new THREE.Vector3(x + Math.cos(a) * 1.05, 4.3 + Math.sin(i * 2) * .4, z + Math.sin(a) * 1.05),
          [1.15, .95, 1.1], i % 2 ? materials.foliage : materials.foliageLight, a);
      }
    }
    function bananaShrub(x, z) {
      for (let i = 0; i < 7; i++) {
        const a = i * Math.PI * 2 / 7;
        const frond = new THREE.Mesh(new THREE.ConeGeometry(.15, 2 + Math.random(), 5), materials.foliageLight);
        frond.position.set(x + Math.cos(a) * .45, .95, z + Math.sin(a) * .45);
        frond.rotation.z = Math.cos(a) * .55;
        frond.rotation.x = Math.sin(a) * .55;
        scene.add(frond);
      }
    }
    coconutTree(-3.3, -(streetHalf + 1));
    coconutTree(3.3, -(streetHalf + 1));
    neemTree(-4.4, streetHalf - 1.2);
    neemTree(4.4, streetHalf - 1.2);
    bananaShrub(-6.5, streetHalf - 1);
    bananaShrub(-7.5, streetHalf + 1.5);
    bananaShrub(6.5, -(streetHalf - 1));
    bananaShrub(7.5, -(streetHalf + 1.5));

    // Warm street lamps, enabled at night.
    const lamps = [];
    for (const [x, z] of [[-1.55, -33], [1.55, -11], [-1.55, 11], [1.55, 33]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.06, .1, 4.4, 8), materials.dark);
      pole.position.set(x, 2.2, z);
      scene.add(pole);
      box(x, 4.42, z, .55, .08, .1, materials.dark, "lamp-arm");
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(.14, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffd17d }));
      bulb.position.set(x, 4.35, z);
      scene.add(bulb);
      const light = new THREE.PointLight(0xffbb68, 0, 11, 2);
      light.position.set(x, 4.05, z);
      scene.add(light);
      lamps.push({ light, bulb });
    }

    const starPositions = new Float32Array(850 * 3);
    for (let i = 0; i < 850; i++) {
      const a = Math.random() * Math.PI * 2, r = 110 + Math.random() * 60;
      starPositions[i * 3] = Math.cos(a) * r;
      starPositions[i * 3 + 1] = 9 + Math.random() * 37;
      starPositions[i * 3 + 2] = Math.sin(a) * r;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdce9ff, size: .13, sizeAttenuation: true }));
    scene.add(stars);

    let isDay = false;
    function setDayMode(day) {
      isDay = day;
      if (day) {
        scene.background.set(0x9bc9e9);
        scene.fog.color.set(0xc4ddeb);
        scene.fog.near = 45;
        scene.fog.far = 380;
        hemi.intensity = 2.15;
        hemi.color.set(0xdaf0ff);
        hemi.groundColor.set(0x8d7558);
        sunlight.intensity = 3.7;
        stars.visible = false;
        lamps.forEach(({ light, bulb }) => {
          light.intensity = 0;
          bulb.material.color.set(0xb9c9d1);
        });
        renderer.toneMappingExposure = 1.12;
        document.querySelector("#mode-toggle").textContent = "🌙 Night Mode";
      } else {
        scene.background.set(0x080d1a);
        scene.fog.color.set(0x080d1a);
        scene.fog.near = 35;
        scene.fog.far = 340;
        hemi.intensity = .62;
        hemi.color.set(0x7e91c2);
        hemi.groundColor.set(0x211c1a);
        sunlight.intensity = .24;
        stars.visible = true;
        lamps.forEach(({ light, bulb }) => {
          light.intensity = 25;
          bulb.material.color.set(0xffd17d);
        });
        renderer.toneMappingExposure = 1.32;
        document.querySelector("#mode-toggle").textContent = "☀️ Day Mode";
      }
    }
    document.querySelector("#mode-toggle").addEventListener("click", () => setDayMode(!isDay));
    setDayMode(false);

    // Pure Web Audio synthesis; no downloaded sound files.
    const Sound = (() => {
      let ctx = null;
      let noiseBuffer = null;
      const loops = new Map();

      function init() {
        if (!ctx) {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (!AudioContext) return null;
          ctx = new AudioContext();
          const length = Math.floor(ctx.sampleRate * 2);
          noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
          const data = noiseBuffer.getChannelData(0);
          for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === "suspended") ctx.resume();
        return ctx;
      }

      function noisePop(volume = .32, duration = .18, cutoff = 9000) {
        const c = init();
        if (!c) return;
        const source = c.createBufferSource();
        const filter = c.createBiquadFilter();
        const gain = c.createGain();
        source.buffer = noiseBuffer;
        filter.type = "highpass";
        filter.frequency.setValueAtTime(cutoff, c.currentTime);
        gain.gain.setValueAtTime(Math.max(.0001, volume), c.currentTime);
        gain.gain.exponentialRampToValueAtTime(.0001, c.currentTime + duration);
        source.connect(filter).connect(gain).connect(c.destination);
        source.start();
        source.stop(c.currentTime + duration);
      }

      function hydroBoom() {
        const c = init();
        if (!c) return;
        const now = c.currentTime;
        const osc = c.createOscillator();
        const oscGain = c.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(105, now);
        osc.frequency.exponentialRampToValueAtTime(34, now + .55);
        oscGain.gain.setValueAtTime(.85, now);
        oscGain.gain.exponentialRampToValueAtTime(.0001, now + .8);
        osc.connect(oscGain).connect(c.destination);
        osc.start(now);
        osc.stop(now + .82);

        const source = c.createBufferSource();
        const lowpass = c.createBiquadFilter();
        const gain = c.createGain();
        source.buffer = noiseBuffer;
        lowpass.type = "lowpass";
        lowpass.frequency.setValueAtTime(420, now);
        lowpass.frequency.exponentialRampToValueAtTime(75, now + .65);
        gain.gain.setValueAtTime(.6, now);
        gain.gain.exponentialRampToValueAtTime(.0001, now + .72);
        source.connect(lowpass).connect(gain).connect(c.destination);
        source.start(now);
        source.stop(now + .75);
      }

      function whistle(duration = 1.1) {
        const c = init();
        if (!c) return;
        const now = c.currentTime;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(420, now);
        osc.frequency.exponentialRampToValueAtTime(1500, now + duration * .85);
        gain.gain.setValueAtTime(.0001, now);
        gain.gain.linearRampToValueAtTime(.11, now + .08);
        gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
        osc.connect(gain).connect(c.destination);
        osc.start(now);
        osc.stop(now + duration);
      }

      function startHiss(key, volume = .055) {
        const c = init();
        if (!c || loops.has(key)) return;
        const source = c.createBufferSource();
        const filter = c.createBiquadFilter();
        const gain = c.createGain();
        source.buffer = noiseBuffer;
        source.loop = true;
        filter.type = "lowpass";
        filter.frequency.value = 3200;
        gain.gain.value = volume;
        source.connect(filter).connect(gain).connect(c.destination);
        source.start();
        loops.set(key, { source, gain });
      }

      function stopHiss(key) {
        const c = ctx;
        const loop = loops.get(key);
        if (!c || !loop) return;
        loops.delete(key);
        const now = c.currentTime;
        loop.gain.gain.cancelScheduledValues(now);
        loop.gain.gain.setValueAtTime(Math.max(.0001, loop.gain.gain.value), now);
        loop.gain.gain.exponentialRampToValueAtTime(.0001, now + .12);
        try { loop.source.stop(now + .14); } catch {}
      }

      function scold() {
        const c = init();
        if (!c) return;
        const now = c.currentTime;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(380, now);
        osc.frequency.setValueAtTime(230, now + .12);
        osc.frequency.setValueAtTime(340, now + .25);
        osc.frequency.setValueAtTime(180, now + .42);
        gain.gain.setValueAtTime(.0001, now);
        gain.gain.linearRampToValueAtTime(.17, now + .025);
        gain.gain.exponentialRampToValueAtTime(.0001, now + .58);
        osc.connect(gain).connect(c.destination);
        osc.start(now);
        osc.stop(now + .6);
        noisePop(.16, .12, 1500);
      }

      return { init, noisePop, hydroBoom, whistle, startHiss, stopHiss, scold };
    })();

    const player = {
      x: 0, z: 12, feet: 0, vy: 0, yaw: Math.PI, pitch: 0,
      grounded: true, speed: 5.4, health: 100,
      state: "alive", lastDamage: -10, freeze: 0
    };
    const eyeHeight = 1.62;
    const keys = new Set();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const raycaster = new THREE.Raycaster();
    raycaster.far = 1500;

    function syncCamera() {
      camera.position.set(player.x, player.feet + eyeHeight, player.z);
      camera.rotation.set(player.pitch, player.yaw, 0, "YXZ");
    }

    function updateHealthUI() {
      const health = Math.max(0, Math.min(100, player.health));
      healthLabel.textContent = `${Math.ceil(health)}%`;
      healthFill.style.width = `${health}%`;
      healthFill.className = "h-full rounded-full transition-[width] duration-150 " +
        (health > 60 ? "bg-emerald-400" : health > 30 ? "bg-amber-400" : "bg-red-500");
    }

    function removeObject(root) {
      if (!root) return;
      scene.remove(root);
      root.traverse?.(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) m.dispose();
        }
      });
      if (root.isMesh) {
        root.geometry?.dispose();
        if (root.material) {
          for (const m of Array.isArray(root.material) ? root.material : [root.material]) m.dispose();
        }
      }
    }

    // Fade residue during its final second; remove exactly 15 seconds after registration.
    const residueRecords = new Set();
    function scheduleResidue(root, delay = 15000) {
      if (!root) return;
      root.traverse?.(obj => {
        if (!obj.material) return;
        obj.material = Array.isArray(obj.material)
          ? obj.material.map(m => {
              const c = m.clone();
              c.transparent = true;
              return c;
            })
          : obj.material.clone();
        if (!Array.isArray(obj.material)) {
          obj.material.transparent = true;
          obj.material.depthWrite = false;
        }
      });
      if (root.isMesh && root.material) {
        root.material.transparent = true;
        root.material.depthWrite = false;
      }
      const record = { root, fading: false, fadeStart: performance.now() + delay - 1000 };
      residueRecords.add(record);
      setTimeout(() => { record.fading = true; }, Math.max(0, delay - 1000));
      setTimeout(() => {
        residueRecords.delete(record);
        removeObject(root);
      }, delay);
    }

    function setCharred(root) {
      root.traverse(obj => {
        const list = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
        for (const m of list) {
          if (m.color) m.color.set(0x333333);
          if (m.emissive) m.emissive.set(0x000000);
        }
      });
    }

    // Reusable, capacity-bounded particle pool. Only active slots are updated each frame.
    const PARTICLE_CAP = 6000;
    const pPos = new Float32Array(PARTICLE_CAP * 3);
    const pVel = new Float32Array(PARTICLE_CAP * 3);
    const pColor = new Float32Array(PARTICLE_CAP * 3);
    const pLife = new Float32Array(PARTICLE_CAP);
    const pMaxLife = new Float32Array(PARTICLE_CAP);
    const pSize = new Float32Array(PARTICLE_CAP);
    const pKind = new Uint8Array(PARTICLE_CAP); // 0 sparks, 1 colored dust/smoke, 2 persistent paper
    const freeSlots = [];
    const activeSlots = [];
    let nextSlot = 0;

    const drawPos = new Float32Array(PARTICLE_CAP * 3);
    const drawColor = new Float32Array(PARTICLE_CAP * 3);
    const drawSize = new Float32Array(PARTICLE_CAP);
    const drawAlpha = new Float32Array(PARTICLE_CAP);
    const drawKind = new Float32Array(PARTICLE_CAP);

    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute("position", new THREE.BufferAttribute(drawPos, 3).setUsage(THREE.DynamicDrawUsage));
    particleGeo.setAttribute("aColor", new THREE.BufferAttribute(drawColor, 3).setUsage(THREE.DynamicDrawUsage));
    particleGeo.setAttribute("aSize", new THREE.BufferAttribute(drawSize, 1).setUsage(THREE.DynamicDrawUsage));
    particleGeo.setAttribute("aAlpha", new THREE.BufferAttribute(drawAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    particleGeo.setAttribute("aKind", new THREE.BufferAttribute(drawKind, 1).setUsage(THREE.DynamicDrawUsage));

    const particleMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        attribute float aKind;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vKind;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * (290.0 / max(1.0, -mv.z)), 1.0, 54.0);
          vColor = aColor;
          vAlpha = aAlpha;
          vKind = aKind;
        }`,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        varying float vKind;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p);
          if (vKind > 1.5) {
            if (abs(p.x) > .43 || abs(p.y) > .25) discard;
          } else if (d > .5) discard;
          float edge = vKind > .5 && vKind < 1.5 ? smoothstep(.5, .05, d) : smoothstep(.5, .16, d);
          gl_FragColor = vec4(vColor, vAlpha * edge);
        }`
    });
    const particlePoints = new THREE.Points(particleGeo, particleMat);
    particlePoints.frustumCulled = false;
    scene.add(particlePoints);

    const COLORS = {
      gold: [[1, .56, .06], [1, .83, .26], [1, .97, .68]],
      silver: [[.85, .92, 1], [1, 1, 1], [.57, .75, 1]],
      paper: [[.38, .36, .34], [.65, .61, .57], [.67, .12, .13]],
      rainbow: [[.58, .12, 1], [.24, .28, 1], [1, .18, .35], [1, .54, .08], [1, .84, .25]],
      red: [[1, .05, .08], [.85, .02, .06]],
      green: [[.05, 1, .2], [.02, .72, .12]],
      blue: [[.04, .35, 1], [.1, .75, 1]]
    };

    function emit(x, y, z, vx, vy, vz, color, life, size, kind = 0) {
      if (activeSlots.length >= PARTICLE_CAP) return;
      const i = freeSlots.length ? freeSlots.pop() : (nextSlot < PARTICLE_CAP ? nextSlot++ : -1);
      if (i < 0) return;
      const j = i * 3;
      pPos[j] = x; pPos[j + 1] = y; pPos[j + 2] = z;
      pVel[j] = vx; pVel[j + 1] = vy; pVel[j + 2] = vz;
      pColor[j] = color[0]; pColor[j + 1] = color[1]; pColor[j + 2] = color[2];
      pLife[i] = pMaxLife[i] = life;
      pSize[i] = size;
      pKind[i] = kind;
      activeSlots.push(i);
    }

    function burst(x, y, z, count, palette, speedMin, speedMax, lifeMin, lifeMax, size = .12, kind = 0) {
      for (let n = 0; n < count; n++) {
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
        const h = Math.sqrt(1 - u * u);
        const speed = speedMin + Math.random() * (speedMax - speedMin);
        const color = palette[(Math.random() * palette.length) | 0];
        emit(x, y, z, Math.cos(a) * h * speed, u * speed, Math.sin(a) * h * speed,
          color, lifeMin + Math.random() * (lifeMax - lifeMin), size * (.65 + Math.random() * .8), kind);
      }
    }

    function updateParticles(dt) {
      let write = 0;
      for (let read = 0; read < activeSlots.length; read++) {
        const i = activeSlots[read], j = i * 3;
        const life = pLife[i] - dt;
        if (life <= 0) {
          freeSlots.push(i);
          continue;
        }
        pLife[i] = life;
        const age = 1 - life / pMaxLife[i];

        if (pKind[i] === 1) {
          const drag = Math.pow(.87, dt * 60);
          pVel[j] *= drag;
          pVel[j + 2] *= drag;
          pVel[j + 1] -= .16 * dt;
        } else if (pKind[i] === 2) {
          const drag = Math.pow(.965, dt * 60);
          pVel[j] *= drag;
          pVel[j + 2] *= drag;
          pVel[j + 1] -= 5.8 * dt;
        } else {
          pVel[j + 1] -= 5.2 * dt;
          pVel[j] *= Math.pow(.994, dt * 60);
          pVel[j + 2] *= Math.pow(.994, dt * 60);
        }

        pPos[j] += pVel[j] * dt;
        pPos[j + 1] += pVel[j + 1] * dt;
        pPos[j + 2] += pVel[j + 2] * dt;

        if (pPos[j + 1] < .035 && pKind[i] !== 1) {
          pPos[j + 1] = .035;
          pVel[j + 1] *= pKind[i] === 2 ? -.04 : -.13;
          pVel[j] *= .76;
          pVel[j + 2] *= .76;
        }

        const k = write++;
        drawPos[k * 3] = pPos[j];
        drawPos[k * 3 + 1] = pPos[j + 1];
        drawPos[k * 3 + 2] = pPos[j + 2];
        drawColor[k * 3] = pColor[j];
        drawColor[k * 3 + 1] = pColor[j + 1];
        drawColor[k * 3 + 2] = pColor[j + 2];
        drawSize[k] = pSize[i] * (pKind[i] === 1 ? 1 + age * 1.65 : 1);
        drawAlpha[k] = pKind[i] === 1
          ? (1 - age) * .7
          : pKind[i] === 2
            ? (age > .91 ? Math.max(0, (1 - age) / .09) : .95)
            : Math.min(1, life * 3.6);
        drawKind[k] = pKind[i];
        activeSlots[k] = i;
      }
      activeSlots.length = write;
      particleGeo.setDrawRange(0, write);
      // Upload only the live particle data. Uploading all 24,000 allocated
      // slots every frame causes a large GPU transfer and can stall weaker GPUs
      // exactly when a large firework burst appears.
      if (write > 0) {
        for (const attr of Object.values(particleGeo.attributes)) {
          if (attr.clearUpdateRanges && attr.addUpdateRange) {
            attr.clearUpdateRanges();
            attr.addUpdateRange(0, write * attr.itemSize);
          } else if (attr.updateRange) {
            attr.updateRange.offset = 0;
            attr.updateRange.count = write * attr.itemSize;
          }
          attr.needsUpdate = true;
        }
      }
    }

    // The per-particle 15-second lifetime gives landed scraps a fixed cleanup window.
    const items = [
      { id: "paper", name: "Paper / Laxmi Bomb", hint: "Toss · fuse + scraps", key: "1", place: false },
      { id: "wala", name: "1000 Wala", hint: "Place · erratic chain", key: "2", place: true },
      { id: "hydro", name: "Hydro Bomb", hint: "Toss · boom + shake", key: "3", place: false },
      { id: "flower", name: "Flower Pot", hint: "Place · gold fountain", key: "4", place: true },
      { id: "chakkar", name: "Ground Chakkar", hint: "Place · drifting sparks", key: "5", place: true },
      { id: "sky", name: "Sky Shot", hint: "Place · aerial burst", key: "6", place: true },
      { id: "smoke", name: "Color Smoke Bomb", hint: "Toss · 12s dust emitter", key: "7", place: false },
      { id: "photo", name: "Photo Flash", hint: "Place · 8 strobes / 4s", key: "8", place: true },
      { id: "multi", name: "Multi-Shot Box", hint: "Place · 16 rockets", key: "9", place: true }
    ];

    let selected = "paper";
    for (const item of items) {
      const button = document.createElement("button");
      button.dataset.id = item.id;
      button.className = "rounded-lg border border-white/10 bg-white/[.04] px-2 py-1 text-left transition hover:bg-white/10 shrink-0 sm:rounded-xl sm:px-2.5 sm:py-2";
      button.innerHTML = `<span class="flex items-center justify-between gap-1"><b class="text-[9px] leading-tight sm:text-xs">${item.name}</b><span class="rounded bg-white/10 px-1 py-0.5 text-[8px] text-amber-200 sm:text-[10px]">${item.key}</span></span><span class="mt-0.5 hidden text-[9px] leading-tight text-slate-400 sm:block sm:text-[10px]">${item.hint}</span>`;
      button.addEventListener("click", e => {
        e.stopPropagation();
        selectItem(item.id);
        const menuDrawer = document.querySelector("#menu-drawer");
        const menuArrow = document.querySelector("#menu-arrow-icon");
        if (window.innerWidth < 768 && menuDrawer) {
          menuDrawer.classList.add("hidden");
          if (menuArrow) menuArrow.textContent = "▲";
        }
      });
      menu.appendChild(button);
    }

    function selectItem(id) {
      selected = id;
      const item = items.find(v => v.id === id);
      for (const b of menu.children) {
        const on = b.dataset.id === id;
        b.classList.toggle("border-amber-300/70", on);
        b.classList.toggle("bg-amber-400/10", on);
        b.classList.toggle("border-white/10", !on);
      }
      const labelEl = document.querySelector("#selected-cracker-label");
      if (labelEl && item) labelEl.textContent = item.name;
      statusEl.textContent = `${item?.name || id} selected — aim and use.`;
    }
    selectItem(selected);
    const toggleMenuBtn = document.querySelector("#toggle-menu-btn");
    const menuDrawer = document.querySelector("#menu-drawer");
    const menuArrow = document.querySelector("#menu-arrow-icon");

    toggleMenuBtn?.addEventListener("click", e => {
      e.stopPropagation();
      if (!menuDrawer) return;
      const isHidden = menuDrawer.classList.toggle("hidden");
      if (menuArrow) menuArrow.textContent = isHidden ? "▲" : "▼";
    });


    const burnMarks = [];
    function makeBurnMark(x, z) {
      const mark = new THREE.Mesh(new THREE.CircleGeometry(.72, 32),
        new THREE.MeshBasicMaterial({ color: 0x292a2b, transparent: true, opacity: .78, depthWrite: false }));
      mark.rotation.x = -Math.PI / 2;
      mark.position.set(x, .025, z);
      scene.add(mark);
      burnMarks.push(mark);
      scheduleResidue(mark, 15000);
    }

    const explosives = [];
    const rockets = [];
    const fireballs = [];
    const pointFlash = new THREE.PointLight(0xffffff, 0, 30, 1.7);
    scene.add(pointFlash);
    let pointFlashPower = 0;
    let overlayPower = 0;
    let redDamagePower = 0;
    let shake = 0;
    let photoStrobePower = 0;
    let damageClock = 0;

    // Brief full-screen light from an explosion. This function is called by
    // paper, hydro and rocket bursts; without it, the first burst throws a
    // ReferenceError and stops the animation loop.
    function flash(power = 1) {
      overlayPower = Math.max(overlayPower, power);
    }

    // Damage is evaluated in full 3D space against the player's camera location.
    function damageAt(x, y, z, maxDamage, radius = 3) {
      if (player.state !== "alive") return;
      const dx = camera.position.x - x;
      const dy = camera.position.y - y;
      const dz = camera.position.z - z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance > radius || damageClock - player.lastDamage < .28) return;
      const strength = Math.max(.18, 1 - distance / radius);
      const amount = maxDamage * strength;
      player.health = Math.max(0, player.health - amount);
      player.lastDamage = damageClock;
      redDamagePower = Math.max(redDamagePower, .55);
      updateHealthUI();
      if (player.health <= 0) startWasted();
    }

    const neighbourChase = new NeighbourChase({
      scene,
      createMesh: createNeighbourMesh,
      duration: 18,
      speed: 4.85,
      onCaught: () => catchPlayer(),
      onEscaped: () => {
        chasePanel.classList.add("hidden");
        statusEl.textContent = `You escaped! ${pickLine(ESCAPE_LINES)}`;
      },
      onTimer: (remaining, mode) => {
        chasePanel.classList.remove("hidden");
        if (mode === "chasing") {
          chaseTime.textContent = `${remaining.toFixed(1)}s`;
          chaseFill.style.width = `${Math.max(0, (remaining / 18) * 100)}%`;
        }
      }
    });

    function nearestHouseToLocation(x, z) {
      let closest = null;
      let minDist = Infinity;
      for (const h of verandas) {
        const dist = Math.hypot(x - h.x, z - h.z);
        if (dist < minDist) {
          minDist = dist;
          closest = h;
        }
      }
      return { house: closest, distance: minDist };
    }

    function nearestHouseToPlayer() {
      return nearestHouseToLocation(player.x, player.z).house || verandas[0];
    }

    // ═══ NEIGHBOUR AGGRO: rolling-window blast counter + speech-cloud bubble ═══
    // Only loud blasts (Paper / Hydro) are counted, per house, inside a rolling BLAST_WINDOW seconds.
    // 2+ blasts: neighbour steps out and shouts a warning. 4+ blasts: sprint chase.
    const BLAST_WINDOW = 8, WARN_BLASTS = 2, CHASE_BLASTS = 4, WARN_COOLDOWN = 10;
    // Random neighbour dialogue pools. pickLine never repeats the previous line from the same pool.
    const WARN_LINES = [
      "Yov! Enna veetu vaasal-la dummu dummu nu vedi podura?!",
      "Dei! Konjam niruthu da, kaadhu kizhiyudhu!",
      "Innoru thadava potta avlodhan, odi poiru!",
      "Paapa thoongudhu da, vedi podaadhe!",
      "Paatti bayandhutaanga da, konjam nirutthu!",
      "Naai ellam bayandhu odudhu! Vera edathula podu!",
      "Exam time da, padikka vidu pa!",
      "Yaar veettu pillai nee? Appa kitta solla porein!",
      "Sandhu muzhuka ore sattham da, konjam amaidhiya iru!",
      "Oru nimisham amaidhiya iru da, thalai vedikkudhu!",
      "Ivlo vedi podanuma da? Time paaru!"
    ];
    const VERANDA_LINES = [
      "Enna thinnai mela bomb podura?! Poi vera edathula podu!",
      "Dei, en veetu thinnai-la vedi-ya? Edu adha!",
      "Veetu munnaadi kolam ellam pochu da, vera edathula podu!",
      "Thinnai-la ukkaara vidu da, bomb podaadha!"
    ];
    const CHASE_LINES = [
      "Nillu da! Odaadha!",
      "Pudikkaama vida maatten da!",
      "Inga vaa da, thambi!",
      "Oditta pidichiruvein, nillu!",
      "Appa kitta solli vachikkaren, vaa inga!",
      "Vedi podura kaila-ye pudikkaren paaru!",
      "Ethukku odura? Nillu da!"
    ];
    // Shown on the caught screen: the neighbour or your parents, picked at random.
    const CAUGHT_LINES = [
      "Neighbour: \u201cPudichitten! Ippo sollu, yaaru da nee?!\u201d",
      "Neighbour: \u201cInime en veetu pakkam vandha, appa kitta solliduven!\u201d",
      "Neighbour: \u201cKulandhai-nu vittaa romba pannura da!\u201d",
      "Your parents: \u201cDeepavali-la yaradhu ipdi thongu thongu nu bomb poduvanga?!\u201d",
      "Your parents: \u201cNeighbour-ku munnadi maanam pochu da, vaa veetukku!\u201d"
    ];
    // Status line when the neighbour gives up the chase.
    const ESCAPE_LINES = [
      "He went back muttering: \u201cHmm, poi thola, inime varaadhe!\u201d",
      "He gave up: \u201cSeri seri, ippo vitturen, aana paaththukko!\u201d",
      "He stopped, out of breath: \u201cThoongura time-la vandhu thollai!\u201d"
    ];
    const lastLine = new Map();
    function pickLine(list) {
      if (list.length === 1) return list[0];
      let line;
      do { line = list[(Math.random() * list.length) | 0]; } while (line === lastLine.get(list));
      lastLine.set(list, line);
      return line;
    }

    function showBubble(text, angry = false) {
      speechText.textContent = text;
      speechBubble.classList.toggle("angry", angry);
      speechBubble.classList.remove("hidden");
    }

    function hideBubble() {
      speechBubble.classList.add("hidden");
    }

    // Keeps the bubble anchored above the neighbour's head in screen space; hidden when he is behind the camera.
    const bubbleVec = new THREE.Vector3();
    function updateSpeechBubble() {
      const mesh = neighbourChase.mesh;
      if (!neighbourChase.active || !mesh || player.state !== "alive") { hideBubble(); return; }
      camera.updateMatrixWorld();
      bubbleVec.set(mesh.position.x, mesh.position.y + 2.25, mesh.position.z);
      const dist = camera.position.distanceTo(bubbleVec);
      bubbleVec.project(camera);
      if (bubbleVec.z > 1) { speechBubble.style.visibility = "hidden"; return; }
      speechBubble.style.visibility = "visible";
      const sx = THREE.MathUtils.clamp((bubbleVec.x * .5 + .5) * innerWidth, 110, innerWidth - 110);
      const sy = THREE.MathUtils.clamp((-bubbleVec.y * .5 + .5) * innerHeight, 70, innerHeight - 150);
      const scale = THREE.MathUtils.clamp(16 / Math.max(dist, 1), .7, 1.15);
      speechBubble.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
    }

    function triggerWarning(house, line = null) {
      if (player.state !== "alive" || neighbourChase.active) return;
      const text = line || pickLine(WARN_LINES);
      neighbourChase.startWarning(house, {
        onStart: () => {
          Sound.scold();
          showBubble(text, false);
          statusEl.textContent = `${house.label}: the neighbour came out to shout at you.`;
        },
        onComplete: () => {
          house.warnCooldownUntil = damageClock + WARN_COOLDOWN;
          hideBubble();
        }
      });
    }

    function triggerChase(house, reason) {
      if (player.state !== "alive") return;
      house.blastHistory = [];
      const started = neighbourChase.startChase(house);
      if (started) {
        Sound.scold();
        statusEl.textContent = reason;
        showBubble(pickLine(CHASE_LINES), true);
        chasePanel.classList.remove("hidden");
        chaseTime.textContent = "18.0s";
        chaseFill.style.width = "100%";
      }
    }

    function onDetonation(x, z, { verandaHouse = null } = {}) {
      if (player.state !== "alive" || neighbourChase.mode === "chasing") return;
      const now = damageClock;
      const { house, distance } = verandaHouse
        ? { house: verandaHouse, distance: 0 }
        : nearestHouseToLocation(x, z);
      if (!house || distance > 24) return;

      house.blastHistory.push(now);
      house.blastHistory = house.blastHistory.filter(t => now - t <= BLAST_WINDOW);
      const count = house.blastHistory.length;

      if (count >= CHASE_BLASTS) {
        triggerChase(house, `${CHASE_BLASTS} loud blasts in ${BLAST_WINDOW} seconds! ${house.label}'s neighbour is chasing you!`);
        return;
      }
      const warnReady = now >= house.warnCooldownUntil && !neighbourChase.active;
      if (warnReady && (verandaHouse || count >= WARN_BLASTS)) {
        triggerWarning(house, verandaHouse ? pickLine(VERANDA_LINES) : null);
        return;
      }
      statusEl.textContent = `Loud blast near ${house.label} (${count}/${CHASE_BLASTS} in ${BLAST_WINDOW}s).`;
    }

    function createNeighbourMesh() {
      const root = new THREE.Group();
      const shirt = mat(0xc64b34);
      const skin = mat(0x9c694d);
      const dhoti = mat(0xe4ddc8);
      const dark = mat(0x352d2a);

      const torso = new THREE.Mesh(new THREE.BoxGeometry(.52, .78, .3), shirt);
      torso.position.y = 1.12;
      root.add(torso);

      const head = new THREE.Mesh(new THREE.SphereGeometry(.23, 12, 10), skin);
      head.position.y = 1.72;
      root.add(head);

      const hair = new THREE.Mesh(new THREE.SphereGeometry(.24, 12, 8), dark);
      hair.position.set(0, 1.86, 0);
      hair.scale.y = .48;
      root.add(hair);

      const lower = new THREE.Mesh(new THREE.CylinderGeometry(.24, .3, .64, 10), dhoti);
      lower.position.y = .42;
      root.add(lower);

      const arms = [];
      for (const x of [-.34, .34]) {
        const armPivot = new THREE.Group();
        armPivot.position.set(x, 1.35, 0);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(.085, .1, .65, 7), skin);
        arm.position.set(0, -0.26, 0);
        arm.rotation.z = x < 0 ? -.18 : .18;
        armPivot.add(arm);
        root.add(armPivot);
        arms.push(armPivot);
      }
      root.userData.arms = arms;

      for (const x of [-.14, .14]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(.09, .1, .48, 7), dark);
        leg.position.set(x, .12, 0);
        root.add(leg);
      }
      root.traverse(o => { o.frustumCulled = false; });
      root.frustumCulled = false;
      return root;
    }

    function startWasted() {
      if (player.state !== "alive") return;
      neighbourChase.stop();
      hideBubble();
      chasePanel.classList.add("hidden");
      if (heldCracker) {
        if (heldCracker.fuseKey) Sound.stopHiss(heldCracker.fuseKey);
        removeObject(heldCracker.model);
        heldCracker = null;
      }
      throwController.reset();
      player.state = "wasted";
      player.freeze = 0;
      keys.clear();
      wastedScreen.classList.remove("hidden");
      wastedScreen.classList.add("flex");
      statusEl.textContent = "WASTED — heading to Government Hospital.";
      setTimeout(() => {
        player.health = 100;
        player.x = hospital.x;
        player.z = hospital.z;
        player.feet = 0;
        player.vy = 0;
        player.state = "alive";
        player.lastDamage = damageClock;
        updateHealthUI();
        wastedScreen.classList.add("hidden");
        wastedScreen.classList.remove("flex");
        statusEl.textContent = "Respawned at Government Hospital.";
      }, 3000);
    }

    function catchPlayer() {
      if (player.state !== "alive") return;
      if (heldCracker) {
        if (heldCracker.fuseKey) Sound.stopHiss(heldCracker.fuseKey);
        removeObject(heldCracker.model);
        heldCracker = null;
      }
      throwController.reset();
      player.state = "caught";
      caughtText.textContent = pickLine(CAUGHT_LINES);
      player.freeze = 0;
      keys.clear();
      caughtScreen.classList.remove("hidden");
      caughtScreen.classList.add("flex");
      Sound.scold();
      statusEl.textContent = "The neighbour caught you. Back home after the scolding.";
      neighbourChase.stop();
      hideBubble();
      chasePanel.classList.add("hidden");
      setTimeout(() => {
        for (const h of verandas) {
          h.blastHistory = [];
          h.warnCooldownUntil = 0;
        }
        player.health = 100;
        player.x = home.x;
        player.z = home.z;
        player.feet = home.feet;
        player.vy = 0;
        player.state = "alive";
        player.lastDamage = damageClock;
        updateHealthUI();
        caughtScreen.classList.add("hidden");
        caughtScreen.classList.remove("flex");
        statusEl.textContent = "Home again. Keep the neighbourhood peaceful!";
      }, 3000);
    }

    function updateNeighbour(dt) {
      neighbourChase.update(dt, { x: player.x, z: player.z, feet: player.feet }, player.state === "alive");
    }

    const crackerColors = {
      paper: 0xa91825, hydro: 0x183d2d, flower: 0x173b6d, chakkar: 0xe9e5d6,
      sky: 0x9f4b24, smoke: 0xe9c82e, photo: 0xaeb4b6, multi: 0x80502f
    };

    function makeCrackerModel(id) {
      const group = new THREE.Group();
      const bodyMat = mat(crackerColors[id] || 0xc98b3e, .82);

      if (id === "paper") {
        // Authentic Cylindrical Paper / Lakshmi Bomb
        const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.32, 24), mat(0x1e7e34, 0.5));
        cylinder.rotation.z = Math.PI / 2;
        group.add(cylinder);

        // Red Goddess Lakshmi label band in the middle
        const label = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.13, 24), mat(0xc92b23, 0.6));
        label.rotation.z = Math.PI / 2;
        group.add(label);

        // Gold foil border rings flanking the label
        for (const ox of [-0.068, 0.068]) {
          const goldStripe = new THREE.Mesh(
            new THREE.CylinderGeometry(0.083, 0.083, 0.012, 24),
            mat(0xdfa020, 0.35, { metalness: 0.5 })
          );
          goldStripe.position.x = ox;
          goldStripe.rotation.z = Math.PI / 2;
          group.add(goldStripe);
        }

        // Crimped paper end-caps
        for (const ox of [-0.16, 0.16]) {
          const plug = new THREE.Mesh(
            new THREE.CylinderGeometry(0.076, 0.076, 0.015, 18),
            mat(0x135324, 0.8)
          );
          plug.position.x = ox;
          plug.rotation.z = Math.PI / 2;
          group.add(plug);
        }

        // Curled visco fuse extending from front end
        const fuse = new THREE.Mesh(
          new THREE.CylinderGeometry(0.015, 0.018, 0.14, 8),
          mat(0xe8e5d9, 0.9)
        );
        fuse.position.set(0.20, 0.04, 0);
        fuse.rotation.z = -Math.PI / 3;
        group.add(fuse);
      } else if (id === "hydro") {
        // Authentic Spherical Hydro / Jute Ball Bomb
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 20), mat(0x274e32, 0.92));
        group.add(core);

        // Cross-wound jute twine loops wrapping the sphere
        const twineMat = mat(0x1f3f28, 0.95);
        const wrapAngles = [
          [0, 0, 0],
          [Math.PI / 2, 0, 0],
          [Math.PI / 4, Math.PI / 4, 0],
          [-Math.PI / 4, Math.PI / 3, 0],
          [Math.PI / 6, -Math.PI / 4, 0],
          [Math.PI / 3, 0, Math.PI / 4]
        ];
        for (const [rx, ry, rz] of wrapAngles) {
          const torus = new THREE.Mesh(
            new THREE.TorusGeometry(0.158, 0.012, 6, 24),
            twineMat
          );
          torus.rotation.set(rx, ry, rz);
          group.add(torus);
        }

        // Central golden paper band
        const bellyBand = new THREE.Mesh(
          new THREE.TorusGeometry(0.162, 0.018, 6, 28),
          mat(0xdfa020, 0.4, { metalness: 0.35 })
        );
        bellyBand.rotation.x = Math.PI / 2;
        group.add(bellyBand);

        // Top black fuse grommet
        const grommet = new THREE.Mesh(
          new THREE.CylinderGeometry(0.028, 0.032, 0.02, 12),
          mat(0x1a1a1a, 0.8)
        );
        grommet.position.y = 0.162;
        group.add(grommet);

        // Stiff pink/red ignition fuse
        const fuse = new THREE.Mesh(
          new THREE.CylinderGeometry(0.016, 0.022, 0.16, 8),
          mat(0xe91e63, 0.7)
        );
        fuse.position.set(0.02, 0.23, 0);
        fuse.rotation.z = -0.22;
        group.add(fuse);
      } else if (id === "flower") {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(.28, .52, 9), bodyMat);
        cone.position.y = .27;
        group.add(cone);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(.245, .025, 6, 14), mat(0x243f72));
        rim.rotation.x = Math.PI / 2;
        rim.position.y = .04;
        group.add(rim);
      } else if (id === "chakkar") {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(.29, .29, .08, 20), mat(0xe9e5d6));
        disc.position.y = .06;
        group.add(disc);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(.085, .085, .11, 10), mat(0xd2482e));
        hub.position.y = .12;
        group.add(hub);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(.2, .012, 5, 20), mat(0xc84f3e));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = .11;
        group.add(ring);
      } else if (id === "sky" || id === "multi") {
        const size = id === "multi" ? .68 : .42;
        const base = new THREE.Mesh(new THREE.BoxGeometry(size, id === "multi" ? .5 : .34, size),
          mat(id === "multi" ? 0x744126 : 0x8e4829));
        base.position.y = id === "multi" ? .25 : .17;
        group.add(base);
        const tubeCount = id === "multi" ? 9 : 1;
        for (let i = 0; i < tubeCount; i++) {
          const ox = id === "multi" ? ((i % 3) - 1) * .19 : 0;
          const oz = id === "multi" ? (Math.floor(i / 3) - 1) * .19 : 0;
          const tube = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .34, 8), mat(0x385c39));
          tube.position.set(ox, id === "multi" ? .57 : .49, oz);
          group.add(tube);
        }
      } else if (id === "smoke") {
        const can = new THREE.Mesh(new THREE.CylinderGeometry(.17, .17, .42, 12),
          mat(0xe8c72e, .48, { metalness: .55 }));
        can.position.y = .22;
        group.add(can);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, .055, 12),
          mat(0xa84631, .45, { metalness: .4 }));
        cap.position.y = .45;
        group.add(cap);
      } else if (id === "photo") {
        const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, .28, 14),
          mat(0xaeb4b6, .35, { metalness: .72 }));
        cylinder.position.y = .15;
        group.add(cylinder);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(.135, .135, .035, 14),
          mat(0x4b4d4e, .4, { metalness: .6 }));
        cap.position.y = .305;
        group.add(cap);
      }

      group.traverse(o => { o.frustumCulled = false; });
      group.frustumCulled = false;
      return group;
    }

    function makeWalaPath(start, heading) {
      const group = new THREE.Group();
      const segmentCount = 76;
      const segmentMeshes = [];
      const redMaterial = mat(0xb42522);
      for (let i = 0; i < segmentCount; i++) {
        const t = i / (segmentCount - 1);
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 10 / segmentCount * 1.25, 5), redMaterial);
        seg.rotation.x = Math.PI / 2;
        seg.position.set(Math.sin(t * Math.PI * 4) * .22, .075 + Math.sin(t * 19) * .008, -t * 10);
        group.add(seg);
        segmentMeshes.push(seg);
      }
      group.position.set(start.x, start.y, start.z);
      group.rotation.y = heading;
      scene.add(group);
      return { group, segmentMeshes, segmentCount, heading };
    }

    function spawnPaperScraps(x, y, z) {
      // Hundreds of tiny flat rectangular scraps: high-velocity radial launch, drag, then settle.
      for (let i = 0; i < 470; i++) {
        const a = Math.random() * Math.PI * 2;
        const u = Math.random() * 2 - 1;
        const horizontal = Math.sqrt(1 - u * u);
        const speed = 4 + Math.random() * 14;
        const color = COLORS.paper[(Math.random() * COLORS.paper.length) | 0];
        emit(x, y, z,
          Math.cos(a) * horizontal * speed,
          Math.max(.7, u * speed + 2),
          Math.sin(a) * horizontal * speed,
          color, 15, .035 + Math.random() * .055, 2);
      }
    }

    function explodePaper(c, { inHand = false } = {}) {
      if (c.fuseKey) Sound.stopHiss(c.fuseKey);
      if (!inHand && (c.landed || c.y < 0.6)) makeBurnMark(c.x, c.z);
      spawnPaperScraps(c.x, inHand ? c.y : .2, c.z);
      burst(c.x, c.y + .2, c.z, 42, COLORS.silver, 3, 10, .2, .62, .1);
      Sound.noisePop(.72, .24, 1700);
      flash(.9);
      pointFlash.position.set(c.x, c.y + .5, c.z);
      pointFlashPower = Math.max(pointFlashPower, 90);
      if (!inHand) damageAt(c.x, c.y, c.z, 28, 3);   // proximity damage from the exact blast coordinates (mid-air included)
      const vHouse = (c.houseId && verandas.find(v => v.id === c.houseId)) || verandaAt(c.x, c.z);
      onDetonation(c.x, c.z, { verandaHouse: vHouse });
    }

    function explodeHydro(c, { inHand = false } = {}) {
      if (c.fuseKey) Sound.stopHiss(c.fuseKey);
      shake = Math.max(shake, .9);
      Sound.hydroBoom();
      flash(1.4);
      burst(c.x, c.y + .2, c.z, 280, [[1, .18, .02], [1, .42, .04], [1, .78, .18]], 1, 9, .35, 1.15, .25);
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14),
        new THREE.MeshBasicMaterial({ color: 0xff6a18, transparent: true, opacity: .9, depthWrite: false }));
      sphere.position.set(c.x, c.y + .25, c.z);
      sphere.scale.setScalar(.2);
      scene.add(sphere);
      fireballs.push({ mesh: sphere, age: 0, life: .52 });
      pointFlash.position.set(c.x, c.y + .8, c.z);
      pointFlashPower = Math.max(pointFlashPower, 160);
      if (!inHand) damageAt(c.x, c.y, c.z, 40, 3);   // proximity damage from the exact blast coordinates (mid-air included)
      const vHouse = (c.houseId && verandas.find(v => v.id === c.houseId)) || verandaAt(c.x, c.z);
      onDetonation(c.x, c.z, { verandaHouse: vHouse });
    }

    // Smoke canister: a pop plus a coloured dust cloud. Not a loud blast, so it never feeds the neighbour counter.
    function explodeSmoke(c, { inHand = false } = {}) {
      if (c.fuseKey) Sound.stopHiss(c.fuseKey);
      Sound.noisePop(.4, .18, 900);
      flash(.3);
      const puffs = inHand ? 6 : 3;
      for (let n = 0; n < puffs; n++) emitColoredDust(c);
      if (!inHand) {
        c.activated = true;        // emitter keeps running for 12 s, in the air or on the ground
        c.emitterElapsed = 0;
        c.age = 0;
        Sound.startHiss(c.soundKey, .025);
        damageAt(c.x, c.y, c.z, 6, 2.5);
      }
    }

    function explodeRocket(x, y, z, countDetonation = true) {
      burst(x, y, z, 500, COLORS.rainbow, 4, 16, 1.35, 3.5, .18);
      burst(x, y, z, 100, COLORS.gold, 2, 8, .8, 2.2, .13);
      Sound.noisePop(.55, .3, 1100);
      flash(.72);
      pointFlash.position.set(x, y, z);
      damageAt(x, y, z, 25, 3);
    }

    function launchRocket(x, z, peak = 24, tilt = true, countDetonation = true, baseY = 0) {
      const rocket = new THREE.Group();
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(.055, .075, .38, 7),
        mat(0x37643c, .6, { emissive: 0x285328, emissiveIntensity: .9 }));
      rocket.add(tube);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(.075, .16, 7),
        mat(0xd45d2f, .55, { emissive: 0x8a3417, emissiveIntensity: .6 }));
      nose.position.y = .27;
      rocket.add(nose);
      rocket.position.set(x, .4 + baseY, z);
      rocket.traverse(o => { o.frustumCulled = false; });
      rocket.frustumCulled = false;
      scene.add(rocket);

      const tiltX = tilt ? (Math.random() - .5) * 1.35 : 0;
      const tiltZ = tilt ? (Math.random() - .5) * 1.35 : 0;
      rockets.push({
        mesh: rocket, x, z, y: .4 + baseY,
        vx: tiltX, vy: 18 + Math.random() * 2, vz: tiltZ,
        peak: peak + Math.random() * 2, age: 0,
        countDetonation
      });
      Sound.whistle(1.25);
      damageAt(x, .5 + baseY, z, 8, 3);
    }

    function makeCrackerRecord(id, target) {
      const uid = `${id}-${performance.now().toFixed(1)}-${Math.random().toString(36).slice(2, 6)}`;
      return {
        id, uid, soundKey: `snd-${uid}`, model: makeCrackerModel(id),
        x: target.x, y: target.y, z: target.z,
        vx: 0, vy: 0, vz: 0, age: 0, landed: true,
        fuse: 0, fuseDuration: 0, fuseKey: null, ignitedAt: 0,
        armed: false,           // throwable with a live hidden fuse (paper / hydro / smoke)
        placedFuse: 0,          // seconds left on a ground-placed item's walk-away fuse
        color: smokeSelect.value, activated: false,
        nextRocket: .5, shotCount: 0, strobeCount: 0, nextStrobe: .1,
        path: null, chainStep: 0, chainTimers: null, photoKey: null,
        driftX: target.x, driftZ: target.z, driftStartX: target.x, driftStartZ: target.z
      };
    }

    // Throw / fuse tuning. Fuses are invisible to the player: no countdown text anywhere in the UI.
    const THROWABLES = ["paper", "hydro", "smoke"];
    const FUSE_SECONDS = { paper: 2.5, hydro: 2.2, smoke: 3.0 };
    const PLACED_FUSE = 4.0;                         // walk-away fuse for every ground-placed item
    const THROW_MIN_SPEED = 2.2, THROW_MAX_SPEED = 24; // m/s at 0% and 100% charge (100% = 1.5 s of holding RMB)
    const HAND_BLAST_DAMAGE = { paper: 60, hydro: 100, smoke: 10 };

    // Ground-placed items always land flat directly under the player's feet.
    function floorTarget() {
      return { x: player.x, y: supportY(player.x, player.z, player.feet), z: player.z };
    }

    function damagePlayer(amount) {
      if (player.state !== "alive") return;
      player.health = Math.max(0, player.health - amount);
      player.lastDamage = damageClock;
      redDamagePower = Math.max(redDamagePower, .9);
      shake = Math.max(shake, 1.2);
      updateHealthUI();
      if (player.health <= 0) startWasted();
    }

    function dropPlaced(item) {
      if (player.state !== "alive" || player.freeze > 0) return;
      Sound.init();
      const id = item.id;
      const target = floorTarget();
      const rec = makeCrackerRecord(id, target);
      rec.model.position.set(target.x, target.y, target.z);
      scene.add(rec.model);
      rec.placedFuse = PLACED_FUSE;
      rec.fuseKey = `fuse-${rec.uid}`;
      Sound.startHiss(rec.fuseKey, .02);
      if (id === "wala") {
        rec.path = makeWalaPath(target, player.yaw);
        rec.model.visible = false;
        rec.chainTimers = Array.from({ length: rec.path.segmentCount }, (_, i) =>
          (i / (rec.path.segmentCount - 1)) * 7.2 + (Math.random() - .5) * .12);
      }
      explosives.push(rec);
      statusEl.textContent = `${item.name} dropped at your feet. Walk away!`;
    }

    // Left click: placed items drop instantly; throwables are RMB-only (hold to light and charge).
    function useSelected() {
      if (player.state !== "alive" || player.freeze > 0) return;
      Sound.init();
      if (document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock();
        statusEl.textContent = "Mouse locked. Aim with the crosshair, then click again to use.";
        return;
      }
      const item = items.find(v => v.id === selected);
      if (item.place) dropPlaced(item);
      else statusEl.textContent = `${item.name}: hold the left mouse button to light and charge, release to throw.`;
    }

    let heldCracker = null;

    function currentHandPosition() {
      camera.getWorldDirection(forward);
      right.set(-forward.z, 0, forward.x).normalize();
      return new THREE.Vector3(
        camera.position.x + forward.x * .48 + right.x * .28,
        camera.position.y - .24 + forward.y * .48,
        camera.position.z + forward.z * .48 + right.z * .28
      );
    }

    // Held bomb: the hidden fuse is already burning. Running out of fuse in the hand is a self-inflicted blast.
    function detonateInHand() {
      const c = heldCracker;
      if (!c) return;
      heldCracker = null;
      throwController.reset();
      if (c.fuseKey) Sound.stopHiss(c.fuseKey);
      c.x = camera.position.x;
      c.y = camera.position.y - .25;
      c.z = camera.position.z;
      c.landed = false;
      if (c.id === "paper") explodePaper(c, { inHand: true });
      else if (c.id === "hydro") explodeHydro(c, { inHand: true });
      else explodeSmoke(c, { inHand: true });
      removeObject(c.model);
      if (player.state === "alive") {
        player.freeze = 1.4;
        keys.clear();
        statusEl.textContent = "💥 BOOM! It exploded in your hand!";
        damagePlayer(HAND_BLAST_DAMAGE[c.id] ?? 60);
      }
    }

    function updateHeldCracker(dt) {
      if (!heldCracker?.model) return;
      const p = currentHandPosition();
      heldCracker.x = p.x;
      heldCracker.y = p.y;
      heldCracker.z = p.z;
      heldCracker.model.position.copy(p);
      heldCracker.model.rotation.set(.18, player.yaw + .25, .35);
      if (!heldCracker.armed) return;

      heldCracker.fuse -= dt;
      if (Math.random() < 0.85) {
        emit(
          p.x + (Math.random() - 0.5) * 0.05, p.y + 0.12, p.z + (Math.random() - 0.5) * 0.05,
          (Math.random() - 0.5) * 1.4, 0.8 + Math.random() * 1.5, (Math.random() - 0.5) * 1.4,
          COLORS.gold[(Math.random() * COLORS.gold.length) | 0], 0.12 + Math.random() * 0.15, 0.055
        );
      }
      if (heldCracker.fuse <= 0) detonateInHand();
    }

    // Release: speed scales linearly with charge. A tap drops it near the feet; a full charge arcs far down the street or lot.
    function throwBomb({ charge = 0 } = {}) {
      const rec = heldCracker;
      if (!rec || player.state !== "alive") return;
      heldCracker = null;
      camera.getWorldDirection(forward).normalize();
      const origin = currentHandPosition();
      rec.x = origin.x; rec.y = origin.y; rec.z = origin.z;
      rec.model.position.copy(origin);
      const power = THREE.MathUtils.clamp(charge, 0, 1);
      const speed = THROW_MIN_SPEED + power * (THROW_MAX_SPEED - THROW_MIN_SPEED);
      rec.vx = forward.x * speed;
      rec.vy = forward.y * speed + 1.2 + power * 3.6;
      rec.vz = forward.z * speed;
      rec.landed = false;
      rec.age = 0;
      explosives.push(rec);   // the fuse keeps burning from the moment of ignition
      statusEl.textContent = `${items.find(v => v.id === rec.id).name} thrown at ${Math.round(power * 100)}% power!`;
    }

    function igniteHeldBomb() {
      if (player.state !== "alive" || player.freeze > 0 || !THROWABLES.includes(selected)) return;
      Sound.init();
      const item = items.find(v => v.id === selected);
      const hand = currentHandPosition();
      const rec = makeCrackerRecord(selected, hand);
      rec.landed = false;
      rec.armed = true;
      rec.ignitedAt = performance.now();
      rec.fuseDuration = FUSE_SECONDS[selected];
      rec.fuse = rec.fuseDuration;
      rec.fuseKey = `fuse-${rec.ignitedAt}`;
      rec.model.position.copy(hand);
      scene.add(rec.model);
      heldCracker = rec;
      Sound.startHiss(rec.fuseKey, .025);
      statusEl.textContent = `${item.name} lit! Release the left mouse button to throw.`;
    }

    function releaseHeldBomb({ charge }) {
      if (!heldCracker) return;
      throwBomb({ charge });
    }

    const throwController = new ChargeThrowController(renderer.domElement, {
      canCharge: () => THROWABLES.includes(selected),
      onInstant: () => {
        const item = items.find(v => v.id === selected);
        if (item?.place) dropPlaced(item);
      },
      onIgnite: igniteHeldBomb,
      onRelease: releaseHeldBomb,
      onCancel: () => {
        if (heldCracker) {
          if (heldCracker.fuseKey) Sound.stopHiss(heldCracker.fuseKey);
          removeObject(heldCracker.model);
          heldCracker = null;
        }
      },
      onProgress: state => throwMeter.update(state)
    });

    // Handled by ChargeThrowController on pointerdown/pointerup
    renderer.domElement.addEventListener("click", event => { event.preventDefault(); });
    renderer.domElement.addEventListener("contextmenu", e => e.preventDefault());

    function emitColoredDust(c) {
      const palette = COLORS[c.color] || COLORS.red;
      for (let n = 0; n < 34; n++) {
        const u = Math.random() * 2 - 1;
        const a = Math.random() * Math.PI * 2;
        const h = Math.sqrt(1 - u * u);
        const speed = 2 + Math.random() * 7;
        emit(c.x, c.y + .22, c.z,
          Math.cos(a) * h * speed, u * speed + .8, Math.sin(a) * h * speed,
          palette[(Math.random() * palette.length) | 0],
          3.2 + Math.random() * 3.4, .15 + Math.random() * .18, 1);
      }
    }

    function triggerWalaPop(rec, index) {
      const t = index / (rec.path.segmentCount - 1);
      const lx = Math.sin(t * Math.PI * 4) * .22;
      const lz = -t * 10;
      const a = rec.path.heading;
      const x = rec.x + lx * Math.cos(a) + lz * Math.sin(a);
      const z = rec.z - lx * Math.sin(a) + lz * Math.cos(a);
      const segment = rec.path.segmentMeshes[index];

      if (segment) {
        segment.visible = false;
        burst(x, .13, z, 2 + (Math.random() * 3 | 0), COLORS.paper, .4, 2.2, 15, 15, .045, 2);
        burst(x, .13, z, 4 + (Math.random() * 5 | 0), COLORS.silver, .7, 4.2, .09, .3, .075);
        segment.scale.set(1 + Math.random() * .9, 1, 1 + Math.random() * .9);
      }
      burst(x, .13, z, 4, COLORS.paper, .2, .8, 1.2, 2.5, .35, 1);
      if (Math.random() < .72) burst(x, .13, z, 2, COLORS.gold, .5, 2.5, .12, .35, .07);
      pointFlash.position.set(x, .3, z);
      pointFlashPower = Math.max(pointFlashPower, 45 + Math.random() * 80);
      Sound.noisePop(.18 + Math.random() * .24, .09 + Math.random() * .08, 2300 + Math.random() * 6000);
      damageAt(x, .15, z, 4, 3);
    }

    function verandaAt(x, z) {
      return verandas.find(v => x >= v.minX && x <= v.maxX && z >= v.minZ && z <= v.maxZ) || null;
    }

    // Landing surface for a falling projectile: street, veranda slab, roof, parapet or stair tread.
    function projectileFloorY(x, z, previousY) {
      return topSurfaceBelow(x, z, previousY + .001);
    }

    // Tossed crackers bounce off house walls instead of flying through them.
    function bounceOffWalls(c, px, pz) {
      for (const b of buildings) {
        if (b.top <= c.y + .05) continue;   // above the wall top
        if (c.x > b.minX && c.x < b.maxX && c.z > b.minZ && c.z < b.maxZ) {
          if (px <= b.minX || px >= b.maxX) { c.x = px; c.vx *= -.35; }
          else { c.z = pz; c.vz *= -.35; }
          return;
        }
      }
    }

    function updateExplosives(dt) {
      for (let i = explosives.length - 1; i >= 0; i--) {
        const c = explosives[i];
        c.age += dt;

        // Ground-placed items: strict walk-away fuse before anything fires.
        if (c.placedFuse > 0) {
          c.placedFuse -= dt;
          c.age = 0;
          if (Math.random() < .8) {
            emit(c.x + (Math.random() - .5) * .08, c.y + .14, c.z + (Math.random() - .5) * .08,
              (Math.random() - .5) * 1.2, .6 + Math.random() * 1.4, (Math.random() - .5) * 1.2,
              COLORS.gold[(Math.random() * COLORS.gold.length) | 0], .15 + Math.random() * .18, .06);
          }
          if (c.placedFuse > 0) continue;
          c.placedFuse = 0;
          if (c.fuseKey) Sound.stopHiss(c.fuseKey);
          if (c.id === "sky") {
            launchRocket(c.x, c.z, 24, false, true, c.y);
            scheduleResidue(c.model);
            c.model = null;
            explosives.splice(i, 1);
            continue;
          }
          if (c.id === "multi") { c.activated = true; c.nextRocket = .2; }
          else if (c.id === "photo") {
            c.activated = true;
            Sound.startHiss(c.soundKey, .025);
          }
        }

        // Armed throwables: hidden backend fuse runs in hand, mid-air and on the ground, and detonates at the exact 3D position.
        if (c.armed) {
          c.fuse -= dt;
          if (Math.random() < 0.75) {
            emit(c.x + (Math.random() - 0.5) * 0.08, c.y + 0.12, c.z + (Math.random() - 0.5) * 0.08,
              (Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 1.4, (Math.random() - 0.5) * 1.2,
              COLORS.gold[(Math.random() * COLORS.gold.length) | 0], 0.15 + Math.random() * 0.18, 0.06);
          }
          if (c.fuse <= 0) {
            c.armed = false;
            if (c.fuseKey) Sound.stopHiss(c.fuseKey);
            const wasMidAir = !c.landed && c.y > 0.5;
            if (c.id === "paper") explodePaper(c);
            else if (c.id === "hydro") explodeHydro(c);
            else explodeSmoke(c);
            if (c.id !== "smoke") {
              if (c.model) {
                if (wasMidAir) removeObject(c.model);
                else { setCharred(c.model); scheduleResidue(c.model); }
              }
              if (wasMidAir && player.state === "alive") {
                statusEl.textContent = `💥 Mid-air detonation! The ${c.id === "hydro" ? "Hydro Bomb" : "Lakshmi Bomb"} exploded in the air!`;
              }
              explosives.splice(i, 1);
              continue;
            }
          }
        }

        // Smoke emitter (after its pop): 12 s of dust, whether it is still falling or already landed.
        if (c.id === "smoke" && c.activated) {
          c.emitterElapsed += dt;
          if (c.emitterElapsed >= 12) {
            Sound.stopHiss(c.soundKey);
            if (c.model) { setCharred(c.model); scheduleResidue(c.model); c.model = null; }
            explosives.splice(i, 1);
            continue;
          }
          emitColoredDust(c);
        }

        if (c.id === "paper" || c.id === "hydro" || c.id === "smoke") {
          if (!c.landed) {
            const previousY = c.y, px = c.x, pz = c.z;
            c.vy -= 9.81 * dt;
            c.x += c.vx * dt;
            c.y += c.vy * dt;
            c.z += c.vz * dt;
            c.vx *= Math.pow(.997, dt * 60);
            c.vz *= Math.pow(.997, dt * 60);
            bounceOffWalls(c, px, pz);
            c.model.rotation.x += c.vz * dt;
            c.model.rotation.z -= c.vx * dt;

            const floorY = projectileFloorY(c.x, c.z, previousY);
            if (c.y <= floorY + .22) {
              c.y = floorY + .22;
              c.vx *= .35;
              c.vz *= .35;
              c.vy = 0;
              c.landed = true;
              c.age = 0;
              const landedVeranda = verandaAt(c.x, c.z);
              if (landedVeranda && Math.abs(floorY - landedVeranda.y) < .08) {
                c.houseId = landedVeranda.id;
              }
            }
            c.model.position.set(c.x, c.y, c.z);
          }
        } else if (c.id === "wala") {
          while (c.chainStep < c.chainTimers.length && c.age >= c.chainTimers[c.chainStep]) {
            triggerWalaPop(c, c.chainStep);
            c.chainStep++;
          }
          if (c.age < 7.25) {
            Sound.startHiss(c.soundKey, .018);
          } else {
            Sound.stopHiss(c.soundKey);
            removeObject(c.path.group);
            explosives.splice(i, 1);
            continue;
          }
        } else if (c.id === "flower") {
          if (c.age < 6) {
            // Wide, low-profile fountain: lower vertical velocity and stronger outward spread.
            for (let n = 0; n < 64; n++) {
              const a = Math.random() * Math.PI * 2;
              const horizontal = 1.1 + Math.random() * 3.1;
              const palette = Math.random() < .27 ? COLORS.silver : COLORS.gold;
              emit(c.x + (Math.random() - .5) * .12, c.y + .25, c.z + (Math.random() - .5) * .12,
                Math.cos(a) * horizontal, 3.6 + Math.random() * 1.7, Math.sin(a) * horizontal,
                palette[(Math.random() * palette.length) | 0], .7 + Math.random() * 1.4, .07 + Math.random() * .05);
            }
            Sound.startHiss(c.soundKey, .045);
          } else {
            Sound.stopHiss(c.soundKey);
            setCharred(c.model);
            scheduleResidue(c.model);
            c.model = null;
            explosives.splice(i, 1);
            continue;
          }
        } else if (c.id === "chakkar") {
          if (c.age < 5.5) {
            c.model.rotation.y += dt * 48;
            c.x = c.driftStartX + Math.sin(c.age * 1.6) * .65 + Math.sin(c.age * 4.3) * .2;
            c.z = c.driftStartZ + Math.cos(c.age * 1.25) * .6 + Math.sin(c.age * 3.7) * .18;
            c.model.position.set(c.x, c.y, c.z);
            for (let n = 0; n < 32; n++) {
              const a = c.age * 38 + n * .31;
              const speed = 3.5 + Math.random() * 4.5;
              const palette = Math.random() < .5 ? COLORS.gold : COLORS.green;
              emit(c.x + Math.cos(a) * .2, c.y + .13, c.z + Math.sin(a) * .2,
                Math.cos(a) * speed, .12 + Math.random() * .4, Math.sin(a) * speed,
                palette[(Math.random() * palette.length) | 0], .22 + Math.random() * .5, .08);
            }
            Sound.startHiss(c.soundKey, .035);
          } else {
            Sound.stopHiss(c.soundKey);
            setCharred(c.model);
            scheduleResidue(c.model);
            c.model = null;
            explosives.splice(i, 1);
            continue;
          }
        } else if (c.id === "multi") {
          // 16 rockets, one every 1.2 seconds, each with a subtly different XZ tilt.
          if (c.shotCount < 16 && c.age >= c.nextRocket) {
            const ox = (Math.random() - .5) * .42;
            const oz = (Math.random() - .5) * .42;
            launchRocket(c.x + ox, c.z + oz, 24 + Math.random() * 5, true, true, c.y);
            c.shotCount++;
            c.nextRocket += 1.2;
          }
          if (c.shotCount >= 16 && c.age >= c.nextRocket + .5) {
            setCharred(c.model);
            scheduleResidue(c.model);
            c.model = null;
            explosives.splice(i, 1);
            continue;
          }
        } else if (c.id === "photo") {
          if (c.strobeCount < 8 && c.age >= c.nextStrobe) {
            photoStrobePower = 1.7;
            c.strobeCount++;
            c.nextStrobe += .5;
            Sound.noisePop(.12, .08, 5000);
          }
          if (c.age >= 4) {
            Sound.stopHiss(c.soundKey);
            setCharred(c.model);
            scheduleResidue(c.model);
            c.model = null;
            explosives.splice(i, 1);
            continue;
          }
        }
      }
    }

    function updateRockets(dt) {
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.age += dt;
        r.vy -= 9.81 * dt;
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        r.z += r.vz * dt;
        r.mesh.position.set(r.x, r.y, r.z);
        r.mesh.rotation.x = Math.PI / 2;

        if (Math.random() < .9) {
          emit(r.x + (Math.random() - .5) * .05, r.y - .23, r.z + (Math.random() - .5) * .05,
            (Math.random() - .5) * .25, -1.5 - Math.random() * 1.4, (Math.random() - .5) * .25,
            COLORS.paper[1], 1.1 + Math.random() * .7, .12, 1);
        }

        if (r.y >= r.peak || r.vy <= 0) {
          explodeRocket(r.x, r.y, r.z, r.countDetonation !== false);
          removeObject(r.mesh);
          rockets.splice(i, 1);
        }
      }
    }

    function updateFireballs(dt) {
      for (let i = fireballs.length - 1; i >= 0; i--) {
        const f = fireballs[i];
        f.age += dt;
        const t = Math.min(1, f.age / f.life);
        f.mesh.scale.setScalar(.2 + t * 3.5);
        f.mesh.material.opacity = .9 * (1 - t) * (1 - t);
        if (f.age >= f.life) {
          removeObject(f.mesh);
          fireballs.splice(i, 1);
        }
      }
    }

    // ═══ VERTICAL PHYSICS, SURFACES AND COLLISION ═════════════════════════════
    // Height of a stair flight at (x, z), or null if the point is not on the flight.
    function stairSurface(f, x, z) {
      if (Math.abs(z - f.gapZ) > f.halfW) return null;
      const u = x * f.side;
      if (u < f.u0 || u > f.u1 + f.landLen) return null;
      if (u >= f.u1) return f.top;
      return (Math.floor((u - f.u0) / f.run) + 1) * f.rise;
    }

    // Highest walkable/landable surface at (x, z) that is not above maxY. Street level is 0.
    function topSurfaceBelow(x, z, maxY) {
      let best = 0;
      for (const v of verandas) {
        if (x >= v.minX && x <= v.maxX && z >= v.minZ && z <= v.maxZ && v.y <= maxY && v.y > best) best = v.y;
      }
      for (const b of buildings) {
        if (b.top <= maxY && b.top > best && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) best = b.top;
      }
      for (const f of stairFlights) {
        const h = stairSurface(f, x, z);
        if (h !== null && h <= maxY && h > best) best = h;
      }
      return best;
    }

    // Floor under the player: anything up to one step above the feet counts as walkable.
    function supportY(x, z, feet) {
      return topSurfaceBelow(x, z, feet + STEP_UP);
    }

    function collidesAt(x, z, feet) {
      for (const b of buildings) {
        if (b.top > feet + STEP_UP &&
            x > b.minX - .18 && x < b.maxX + .18 && z > b.minZ - .18 && z < b.maxZ + .18) return true;
      }
      return false;
    }

    function movePlayer(dx, dz) {
      const nx = THREE.MathUtils.clamp(player.x + dx, -X_LIMIT, X_LIMIT);
      const nz = THREE.MathUtils.clamp(player.z + dz, -Z_LIMIT, Z_LIMIT);
      if (!collidesAt(nx, player.z, player.feet)) player.x = nx;
      if (!collidesAt(player.x, nz, player.feet)) player.z = nz;
    }

    // Gravity is subtracted every frame; landing on the street, a veranda, a stair tread or a roof resets the jump flag.
    function stepVertical(dt) {
      const support = supportY(player.x, player.z, player.feet);
      player.vy -= GRAVITY * dt;
      player.feet += player.vy * dt;
      if (player.feet <= support) {
        player.feet = support;
        player.vy = 0;
        player.grounded = true;
      } else {
        player.grounded = false;
      }
    }

    function tryJump() {
      if (player.state !== "alive" || player.freeze > 0 || !player.grounded) return;
      player.vy = JUMP_FORCE;
      player.grounded = false;
    }

    function useStairs() {
      if (player.state !== "alive") return;
      statusEl.textContent = "Walk into a narrow alley and climb the open stairs to reach the rooftops. Space jumps.";
    }

    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement === renderer.domElement) {
        statusEl.textContent = "Mouse locked. WASD move · Space jump · Left click to use/throw (hold to charge power).";
      }
    });
    document.addEventListener("mousemove", e => {
      if (document.pointerLockElement !== renderer.domElement || player.state !== "alive" || player.freeze > 0) return;
      player.yaw -= e.movementX * .0022;
      player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * .0022, -1.48, 1.48);
    });

    document.addEventListener("keydown", e => {
      const key = e.key.toLowerCase();
      const isSpace = e.code === "Space" || e.keyCode === 32 || key === " ";
      if ([ "w", "a", "s", "d", " " ].includes(key) || isSpace) e.preventDefault();
      if (player.state !== "alive") return;
      keys.add(key);
      if (isSpace && !e.repeat) tryJump();
      if (!e.repeat && key === "e") useStairs();
      const item = items.find(v => v.key === e.key);
      if (item) selectItem(item.id);
    });
    document.addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => keys.clear());


    const tutorial = new Tutorial({
      onOpen: () => { keys.clear(); throwController.reset(); },
      onClose: () => { statusEl.textContent = "Click the game view to lock the mouse. Press H any time for the tutorial."; }
    });
    tutorial.showFirstRun();

    const clock = new THREE.Clock();
    let elapsed = 0;

    function updateResidueFades(now) {
      for (const r of residueRecords) {
        if (!r.fading) continue;
        const t = THREE.MathUtils.clamp((now - r.fadeStart) / 1000, 0, 1);
        r.root.traverse?.(obj => {
          if (!obj.material) return;
          const list = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of list) m.opacity = 1 - t;
        });
      }
    }

    
    // --- Mobile Touch Controls Support ---
    const isTouchDevice = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
    const mobileControls = document.querySelector("#mobile-controls");
    const joystickZone = document.querySelector("#joystick-zone");
    const joystickKnob = document.querySelector("#joystick-knob");
    const btnFire = document.querySelector("#btn-fire");
    const btnJump = document.querySelector("#btn-jump");
    const btnStairs = document.querySelector("#btn-stairs");

    let joyTouchId = null;
    let joyCenter = { x: 0, y: 0 };
    let joyDelta = { x: 0, y: 0 };

    if (isTouchDevice && mobileControls) {
      mobileControls.classList.remove("hidden");
      statusEl.textContent = "Touch joystick to move · Swipe to look · Tap or hold THROW!";
    }

    // Virtual Joystick for walking
    if (joystickZone && joystickKnob) {
      joystickZone.addEventListener("touchstart", e => {
        e.preventDefault();
        const touch = e.changedTouches[0];
        joyTouchId = touch.identifier;
        const rect = joystickZone.getBoundingClientRect();
        joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }, { passive: false });

      window.addEventListener("touchmove", e => {
        for (let i = 0; i < e.changedTouches.length; i++) {
          const touch = e.changedTouches[i];
          if (touch.identifier === joyTouchId) {
            const dx = touch.clientX - joyCenter.x;
            const dy = touch.clientY - joyCenter.y;
            const dist = Math.hypot(dx, dy);
            const maxRadius = 32;
            const angle = Math.atan2(dy, dx);
            const clampedDist = Math.min(dist, maxRadius);
            const knobX = Math.cos(angle) * clampedDist;
            const knobY = Math.sin(angle) * clampedDist;
            joystickKnob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;
            joyDelta.x = knobX / maxRadius;
            joyDelta.y = knobY / maxRadius;
          }
        }
      }, { passive: false });

      const resetJoy = () => {
        joyTouchId = null;
        joyDelta.x = 0;
        joyDelta.y = 0;
        joystickKnob.style.transform = "translate(-50%, -50%)";
      };
      window.addEventListener("touchend", e => {
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === joyTouchId) resetJoy();
        }
      });
      window.addEventListener("touchcancel", resetJoy);
    }

    // Touch Look (swipe anywhere on screen outside buttons to rotate camera)
    let lookTouchId = null;
    let lastLookX = 0, lastLookY = 0;

    window.addEventListener("touchstart", e => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === joyTouchId) continue;
        const target = touch.target;
        if (target.closest?.("#mobile-controls") || target.closest?.("#menu") || target.closest?.("button") || target.closest?.("select")) continue;
        if (lookTouchId === null) {
          lookTouchId = touch.identifier;
          lastLookX = touch.clientX;
          lastLookY = touch.clientY;
        }
      }
    }, { passive: true });

    window.addEventListener("touchmove", e => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === lookTouchId) {
          const dx = touch.clientX - lastLookX;
          const dy = touch.clientY - lastLookY;
          lastLookX = touch.clientX;
          lastLookY = touch.clientY;
          if (player.state === "alive" && player.freeze <= 0) {
            player.yaw -= dx * 0.0045;
            player.pitch = THREE.MathUtils.clamp(player.pitch - dy * 0.0045, -1.48, 1.48);
          }
        }
      }
    }, { passive: true });

    const endLook = e => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === lookTouchId) lookTouchId = null;
      }
    };
    window.addEventListener("touchend", endLook);
    window.addEventListener("touchcancel", endLook);

    // Mobile Action buttons
    btnJump?.addEventListener("touchstart", e => { e.preventDefault(); tryJump(); }, { passive: false });
    btnStairs?.addEventListener("touchstart", e => { e.preventDefault(); useStairs(); }, { passive: false });

    btnFire?.addEventListener("touchstart", e => {
      e.preventDefault();
      throwController.handleDown({ button: 0, isVirtualButton: true, preventDefault: () => {} });
    }, { passive: false });

    btnFire?.addEventListener("touchend", e => {
      e.preventDefault();
      throwController.handleUp({ button: 0, isVirtualButton: true, preventDefault: () => {} });
    }, { passive: false });
    btnFire?.addEventListener("touchcancel", e => {
      e.preventDefault();
      throwController.handleCancel();
    }, { passive: false });

function animate() {
      requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), .033);
      elapsed += dt;
      damageClock += dt;

      const waterPos = water.geometry.attributes.position;
      for (let i = 0; i < waterPos.count; i++) {
        const x = waterPos.getX(i), z = waterPos.getZ(i);
        waterPos.setY(i, Math.sin(x * 2.2 + elapsed * 1.4) * .018 + Math.cos(z * 1.8 + elapsed) * .014);
      }
      waterPos.needsUpdate = true;
      water.geometry.computeVertexNormals();

      if (player.state === "alive") {
        if (player.freeze > 0) {
          player.freeze = Math.max(0, player.freeze - dt);
        } else {
          camera.getWorldDirection(forward);
          forward.y = 0;
          forward.normalize();
          right.set(-forward.z, 0, forward.x);
          let dx = 0, dz = 0;
          if (keys.has("w")) { dx += forward.x; dz += forward.z; }
          if (keys.has("s")) { dx -= forward.x; dz -= forward.z; }
          if (keys.has("d")) { dx += right.x; dz += right.z; }
          if (keys.has("a")) { dx -= right.x; dz -= right.z; }
          if (joyDelta.x !== 0 || joyDelta.y !== 0) {
            dx += forward.x * (-joyDelta.y) + right.x * joyDelta.x;
            dz += forward.z * (-joyDelta.y) + right.z * joyDelta.x;
          }
          const len = Math.hypot(dx, dz);
          if (len) movePlayer(dx / len * player.speed * dt, dz / len * player.speed * dt);
        }
        stepVertical(dt);
      }

      syncCamera();
      throwController.update(dt);
      updateHeldCracker(dt);
      updateExplosives(dt);
      updateRockets(dt);
      updateFireballs(dt);
      updateNeighbour(dt);
      updateSpeechBubble();
      updateParticles(dt);
      updateResidueFades(performance.now());

      overlayPower = Math.max(0, overlayPower - dt * 8);
      redDamagePower = Math.max(0, redDamagePower - dt * 1.5);
      photoStrobePower = Math.max(0, photoStrobePower - dt * 12);
      pointFlashPower = Math.max(0, pointFlashPower - dt * 1900);
      pointFlash.intensity = pointFlashPower;

      damageFlash.style.opacity = String(Math.min(.55, redDamagePower));
      photoFlash.style.opacity = String(Math.min(1, Math.max(photoStrobePower, overlayPower * .55)));

      let shakeX = 0, shakeY = 0;
      if (shake > 0) {
        shakeX = (Math.random() - .5) * shake * .18;
        shakeY = (Math.random() - .5) * shake * .14;
        shake = Math.max(0, shake - dt * 1.8);
      }
      camera.position.x += shakeX;
      camera.position.y += shakeY;
      renderer.render(scene, camera);
    }

    window.addEventListener("resize", () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.0));
    });

    updateHealthUI();
    syncCamera();
    animate();
  