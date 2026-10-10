import { onRampFace, rampAxes, rampFrame, rampHeight, rampPoint, rampTop, type Ramp } from './transition.ts';
import { FLIP_TRICKS, GRAB_TRICKS, SHOVE_TRICKS, SPECIAL, SPECIAL_FLIP, SPECIAL_GRAB, SPECIAL_GRIND, SPECIAL_SHOVE, directionOf, grindStyle, type FlipTrick, type GrabKind, type GrindStyle, type SpecialKind, type Spin } from './tricks.ts';

export interface Point { x: number; y: number; z: number }
export interface Rail { id: string; name: string; a: Point; b: Point; width?: number }
export interface SkateWorld {
  /** highest walkable surface below fromY (terrainOnly: the terrain alone, null over holes in it) */
  groundAt(x: number, z: number, fromY: number, terrainOnly?: boolean): number | null;
  move(from: Point, delta: Point): Point & { blocked: boolean; normal?: Point };
  rails?: Rail[];
  /** quarter pipes (analytic riding faces, see transition.ts) */
  ramps?: Ramp[];
  /** spatial lookup for big worlds; falls back to scanning `rails` */
  railsNear?(x: number, z: number, radius: number): Rail[];
  canRideAt?(x: number, z: number, y: number): boolean;
  /** false beyond the edge of the map (where there is nothing to ride): an invisible wall, in the air too */
  inBounds?(x: number, z: number): boolean;
}
/** What the rider has unlocked with Skateboarding levels (see UNLOCKS in skill.ts). */
export interface SkateAbilities {
  /** ollie, wallplant and leap vertical speed multiplier */
  pop: number;
  /** Space in the air beside a wall kicks you up and off it */
  wallplant: boolean;
  /** Agility leaps (a second pop in the air) per air */
  leaps: number;
  /** balance wobble multiplier on grinds and manuals */
  steady: number;
  surgeCooldown: number;
  /** no heavy-landing bails from any height */
  ironKnees: boolean;
  /** special bar fill multiplier */
  specialFill: number;
  /** Surge in the air also lifts you */
  airSurge: boolean;
  /** push speed and top speed added (m/s): better boards */
  push: number;
}
export const BASE_ABILITIES: SkateAbilities = { pop: 1, wallplant: false, leaps: 0, steady: 1, surgeCooldown: 8, ironKnees: false, specialFill: 1, airSurge: false, push: 0 };
export interface SkateInput {
  push: boolean; brake: boolean; steer: number; crouch: boolean; pop: boolean; flip: boolean; shove: boolean;
  manual?: boolean; grind?: boolean;
  /** one-shot: spin the board 180 degrees while rolling (switch between regular and fakie) */
  revert?: boolean;
  /** held: grab the board in the air */
  grab?: boolean;
  /** one-shot: cast Surge (a magic dash along your line) */
  surge?: boolean;
}
type Trick = { name: string; duration: number; elapsed: number; kind: 'flip' | 'shove'; spin: Spin; special?: SpecialKind };
export type SkateEvent = { type: 'land' | 'bail' | 'trick' | 'grind' | 'slide' | 'surge' | 'bonk' | 'sketchy' | 'leap' | 'special'; score: number; names: string[]; combo: number; sketchy?: boolean };
const FIXED_DT = 1 / 120;
/** After a landing the combo stays open this long, so an ollie, revert, manual or powerslide links into it. */
export const LANDING_WINDOW = 0.6;
/** Repeating a trick in one combo scores less each time (THPS): -25% per repeat, never below a quarter. */
export const REPEAT = { step: 0.25, floor: 0.25 };
/** Ollie vertical speed (m/s): uncharged, plus this much more with a full crouch; times the rider's pop. */
export const OLLIE = { base: 4.3, charged: 3.1 };
/** Air moves (vertical speed, m/s): wallplant off a wall, Agility leap; leaps need this much height when falling. */
export const AIR_MOVES = { wallplant: 6.4, leap: 6.2, leapMinHeight: 0.6, plantCooldown: 0.35 };
/** Landings: fall speed (m/s) that bails, how far a flip must be done to finish itself, and what a sketchy
 * landing keeps of the combo. */
export const LANDING = { heavy: 17, flipFinish: 0.5, sketchy: 0.5 };
/** Grind catch zone around a rail line, in meters (see tryGrind). */
/** Wallride tuning: entry needs speed and height; faster entries ride longer. A wall touched within `memory`
 * seconds still catches if you leave the ground beside it (scrape the wall, ollie, ride it). */
export const WALLRIDE = { minSpeed: 3, minHeight: 0.3, maxAngle: 50, gravity: 4, minTime: 0.6, maxTime: 2.2, cooldown: 0.4, memory: 0.5, lift: 1.4, maxLift: 2.4 };
export const GRIND_CATCH = { reach: 0.6, assistedReach: 0.95, below: 0.35, above: 0.6, assistedAbove: 0.8, maxRise: 2.5, endSlack: 0.2 };
/** Wall hits (normal speed, m/s): above `bail` you go down, above `bonk` you lose some speed but keep the combo. */
export const IMPACT = { bail: 11, bonk: 6.5 };
/** A bail: how long you are down, the last part spent getting up, and how fast the slide along the ground stops. */
export const BAIL = { time: 1.6, recover: 0.5, friction: 7, rescue: 1.1 };
/** Automatic gaps: least drop (m) and air time (s) that count. */
export const GAPS = { drop: 2.5, hang: 1.3 };
/** Surge: speed added (m/s), the least it leaves you with, and its cooldown (s). */
export const SURGE = { boost: 5, minimum: 11, cooldown: 8, lift: 4.5 };
/** Rolling physics: gravity along slopes (m/s² per unit sine), pushing tops out at PUSH_SPEED, slopes can carry you to MAX_SPEED. */
export const ROLL = { slopeGravity: 7, friction: 0.42, pushSpeed: 9, maxSpeed: 13, maxPitch: 0.7, rampRun: 0.6, rampPitch: 0.15,
  /** least vertical speed a ramp lip must give to launch you (hill crests stay on the ground) */
  minLaunch: 2,
  /** arcade gravity on quarter pipe faces: you carry more speed to the lip than real physics would give */
  rampGravity: 7.5 };

export class Skater {
  position: Point;
  heading = 0; speed = 0; verticalSpeed = 0; grounded = true;
  charge = 0; totalScore = 0; comboPoints = 0; comboCount = 0;
  message = 'Welcome to Lumbridge · roll out and find a line';
  trick: Trick | null = null;
  bailTime = 0; stumbleTime = 0; balance = 0; manual = false;
  grinding: { rail: Rail; t: number; direction: number } | null = null;
  /** how the board sits on the rail (50-50, boardslide, crooked...): picked by the direction held at the catch */
  grindStyle: GrindStyle | null = null;
  /** held grab in the air */
  grab: { name: string; kind: GrabKind; time: number; perSecond: number; special?: SpecialKind } | null = null;
  /** 0-1 special bar (RS special attack): filled by trick points; full unlocks the special tricks */
  special = 0;
  private lastPoints = 0;
  /** this air: highest point and whether it crossed water (for the automatic gaps) */
  private airPeak = 0; private overWater = false;
  /** this air began with a pop (ollie) or a ramp launch; rolling off a ledge doesn't, and steers instead of spinning */
  private popped = false;
  /** recent safe spots (one every half second) so a rescue lands a few seconds back, clear of the edge */
  private safeTrail: Point[] = []; private safeClock = 0; private noteClock = 0; private wetClock = 0;
  /** unlocked with Skateboarding levels (main.ts sets these from the career) */
  abilities: SkateAbilities = { ...BASE_ABILITIES };
  /** Agility leaps used this air, wallplant cooldown, and how often each trick appeared in the open combo */
  leapsUsed = 0; private plantCooldown = 0; private repeats = new Map<string, number>(); private perchTime = 0;
  noseManual = false;
  /** seconds until Surge can be cast again, and time since the last cast (for its glow) */
  surgeCooldown = 0; surgeTime = 9;
  /** riding a quarter pipe face: arc length s up it, u along the coping, signed speed v along the board's nose
   *  (negative = rolling tail-first) and the board's direction on the face (radians from straight up it) */
  transition: { ramp: Ramp; s: number; u: number; v: number; facing: number } | null = null;
  /** the ramp a vert air left from: the camera keeps facing it and its coping only grinds with Shift */
  private airRamp: Ramp | null = null;
  /** riding along a wall: n = horizontal wall normal (pointing away from the wall), dir = side of the tangent */
  wallride: { nx: number; nz: number; dir: number; time: number; duration: number } | null = null;
  animationTime = 0; landingTime = 0; pushing = false;
  pushTime = 0;
  pitch = 0;
  /** powersliding: -1 / 1 for the side the board is thrown out to, 0 when rolling straight */
  powerslide = 0;
  heightAboveGround=0;
  events: SkateEvent[] = [];
  private accumulator = 0; private airTime = 0; private airHeading = 0;
  private spin = 0; private stance = 0; private safe: Point;
  private relocate = false; private immunity = 0; private railCooldown = 0;
  /** after a bail the body keeps sliding along the line of travel: speed and direction */
  bailSlide = 0; bailHeading = 0;
  private popBuffer = 0; private coyote = 0;
  private departedRail:string|null=null;
  private names: string[] = []; private used = new Set<string>();
  private pending = { flip: false, shove: false, revert: false, surge: false };
  private landWindow = 0; private revertCooldown = 0; private grindTime = 0; private wallCooldown = 0;
  /** the last wall the capsule touched, so a late ollie beside it can still catch a wallride */
  private wallTouch: { nx: number; nz: number; age: number } | null = null;
  /** distance rolled continuously up an incline: a ramp long enough to launch from, unlike a curb */
  private rampRun = 0;
  /** S held when a grind caught (a 5-0): only a fresh press drops you off */
  private brakeLatch = false;
  /** incline of the ground just behind the board (radians): the ramp you are about to leave */
  private inclineBehind = 0;

  constructor(private world: SkateWorld, spawn: Point) { this.position = { ...spawn }; this.safe = { ...spawn }; }
  /** rolling tail-first */
  get fakie() { return this.stance !== 0; }
  get travelHeading() { return this.grounded ? this.heading + this.stance : this.airHeading; }
  /** Direction the chase camera looks: at the ramp while riding or flying above a quarter pipe. */
  get cameraHeading() {
    const ramp = this.transition?.ramp ?? (!this.grounded ? this.airRamp : null);
    return ramp ? ramp.yaw : this.travelHeading;
  }
  /** The board's frame on a ramp face (out of the face, and toward the nose); null anywhere else. */
  get surfaceFrame() {
    const tr = this.transition;
    if (!tr) return null;
    const { tangent, normal } = rampFrame(tr.ramp, tr.s), { ux, uz } = rampAxes(tr.ramp), c = Math.cos(tr.facing), s = Math.sin(tr.facing);
    return { normal, forward: { x: tangent.x * c + ux * s, y: tangent.y * c, z: tangent.z * c + uz * s } };
  }
  get phase() {
    if (this.bailTime > 0) return this.bailTime > BAIL.recover ? 'bail' : 'recover';
    if (this.stumbleTime > 0) return 'stumble';
    if (this.grinding) return 'grind';
    if (this.wallride) return 'wallride';
    if (this.transition) return this.stumbleTime > 0 ? 'stumble' : 'ramp';
    if (this.manual) return 'manual';
    if (!this.grounded) return this.grab ? 'grab' : this.trick?.kind ?? (this.verticalSpeed > 0 && !this.airRamp ? 'pop' : 'air');
    if (this.charge > 0) return 'crouch';
    if (this.landingTime > 0) return 'land';
    if (this.powerslide) return 'slide';
    return this.pushing ? 'push' : 'ride';
  }
  /** tricks in the open combo, in order */
  get comboNames(): readonly string[] { return this.names; }
  get landingCompression() { return Math.min(1,this.landingTime/0.24); }
  drainEvents() { const events = this.events; this.events = []; return events; }

  reset(position: Point, heading = this.heading) {
    this.position = { ...position }; this.safe = { ...position }; this.heading = heading;
    this.speed = this.verticalSpeed = this.charge = this.bailTime = this.stumbleTime = this.accumulator = 0;
    this.airTime = this.spin = this.stance = this.popBuffer = this.landingTime = this.pitch = 0;
    this.grounded = true; this.grinding = null; this.manual = false; this.balance = 0;
    this.pushTime = 0; this.pushing = false;
    this.departedRail=null;this.heightAboveGround=0;
    this.clearCombo(); this.pending = { flip: false, shove: false, revert: false, surge: false };
    this.landWindow = this.revertCooldown = this.wallCooldown = 0; this.wallride = null; this.wallTouch = null;
    this.powerslide = this.rampRun = this.inclineBehind = 0;
    this.grab = null; this.grindStyle = null; this.noseManual = false; this.brakeLatch = false;
    this.transition = null; this.airRamp = null; this.leapsUsed = 0; this.plantCooldown = 0; this.soaring = false;
  }
  /** Agility leaps left in this air. */
  get leapsLeft() { return Math.max(0, this.abilities.leaps - this.leapsUsed); }
  /** seconds left to link a trick after the last landing (0 when no combo is waiting) */
  get linkWindow() { return this.landWindow; }
  /** A higher top speed while it's set (m/s), and downhill gravity multiplied: mega ramp roll-ins (main.ts sets both inside their zones). */
  boostCap = 0; slopeBoost = 1;
  /** flying a long way (catapults, balloon drop-ins): no heavy landings, no hole rescues, no air-time limit until you land */
  soaring = false;
  /** Throws the rider into the air with a velocity (m/s; horizontal along its direction): a catapult. */
  launch(vx: number, vy: number, vz: number, trick?: [string, number]) {
    if (this.bailTime > 0) return;
    if (trick) { this.landWindow = 0; this.addTrick(...trick); }
    this.grinding = null; this.wallride = null; this.transition = null; this.manual = false; this.powerslide = 0;
    this.grounded = false; this.coyote = 0; this.popped = true; this.soaring = true; this.leapsUsed = 0;
    this.speed = Math.hypot(vx, vz); this.airHeading = Math.atan2(-vx, -vz); this.heading = this.airHeading - this.stance;
    this.verticalSpeed = vy; this.airTime = this.spin = 0;
  }
  /** Top speed: the board's, or a mega ramp's. */
  get topSpeed() { return Math.max(ROLL.maxSpeed + this.abilities.push, this.boostCap); }
  /** Seconds of perfect balance left (no wobble on grinds and manuals): the Sandwich Lady's baguette. */
  perfectBalance = 0;
  /** Knocked off the board by something in the world (an Evil Chicken...); the open combo is lost. */
  knockDown(reason: string) { if (this.bailTime === 0) this.bail(reason); }

  update(dt: number, input: SkateInput) {
    if (input.pop) this.popBuffer = 0.16;
    this.pending.flip ||= input.flip; this.pending.shove ||= input.shove; this.pending.revert ||= !!input.revert; this.pending.surge ||= !!input.surge;
    this.accumulator += Math.max(0, Math.min(dt, 0.1));
    while (this.accumulator >= FIXED_DT) {
      this.step(FIXED_DT, input); this.accumulator -= FIXED_DT;
      this.pending = { flip: false, shove: false, revert: false, surge: false };
    }
  }

  private step(dt: number, input: SkateInput) {
    this.animationTime += dt;
    this.pushTime = input.push && this.grounded && !this.manual ? this.pushTime + dt : 0;
    this.immunity = Math.max(0, this.immunity - dt);
    this.railCooldown = Math.max(0, this.railCooldown - dt);
    this.landingTime = Math.max(0, this.landingTime - dt);
    this.popBuffer = Math.max(0, this.popBuffer - dt);
    this.revertCooldown = Math.max(0, this.revertCooldown - dt);
    this.wallCooldown = Math.max(0, this.wallCooldown - dt); this.noteClock -= dt;
    this.surgeCooldown = Math.max(0, this.surgeCooldown - dt); this.surgeTime += dt;
    this.plantCooldown = Math.max(0, this.plantCooldown - dt); this.perfectBalance = Math.max(0, this.perfectBalance - dt);
    // the special bar fills with every point a combo earns and drains while no combo is open
    const gained = this.comboPoints - this.lastPoints, wasReady = this.specialReady; this.lastPoints = this.comboPoints;
    if (gained > 0) this.special = Math.min(1, this.special + (gained / SPECIAL.fill) * this.abilities.specialFill);
    else if (!this.comboCount) this.special = Math.max(0, this.special - SPECIAL.drain * dt);
    if (this.specialReady && !wasReady) this.events.push({ type: 'special', score: 0, names: [], combo: this.comboCount });
    if (this.pending.surge) this.castSurge();
    if (this.wallTouch && (this.wallTouch.age += dt) > WALLRIDE.memory) this.wallTouch = null;
    if (this.landWindow > 0) {
      this.landWindow = Math.max(0, this.landWindow - dt);
      if (this.landWindow === 0 && !this.manual) this.bank();
    }
    this.coyote = this.grounded ? 0.14 : Math.max(0, this.coyote - dt);
    this.pushing = false;
    if (this.bailTime > 0) {
      if (!this.relocate) {
        // the body tumbles on along the line of travel and slides to a stop (walls still stop it)
        this.bailSlide = Math.max(0, this.bailSlide - BAIL.friction * dt);
        if (!this.grounded) this.verticalSpeed -= 14 * dt;
        const slide = this.bailSlide * dt, dx = -Math.sin(this.bailHeading) * slide, dz = -Math.cos(this.bailHeading) * slide;
        const ahead = this.world.canRideAt?.(this.position.x + dx, this.position.z + dz, this.position.y) !== false;
        const next = this.world.move(this.position, { x: ahead ? dx : 0, y: this.grounded ? 0 : this.verticalSpeed * dt, z: ahead ? dz : 0 });
        if (next.blocked) this.bailSlide = 0;
        this.position = { x: next.x, y: next.y, z: next.z };
        const floor = this.world.groundAt(next.x, next.z, next.y + 0.45);
        if (floor !== null && next.y <= floor + 0.06) { this.position.y = floor; this.grounded = true; this.verticalSpeed = 0; }
        else if (this.grounded && (floor === null || floor < next.y - 0.06)) this.grounded = false;
      }
      this.bailTime = Math.max(0, this.bailTime - dt);
      if (this.bailTime === 0) {
        const target = this.relocate ? this.safeTrail[0] ?? this.safe : this.position;
        const remaining = this.accumulator;
        this.reset(target); this.accumulator = remaining; this.immunity = 1.25; this.safeTrail = [{ ...target }];
        this.message = 'Back on the board · keep your line';
      }
      return;
    }
    this.stumbleTime = Math.max(0, this.stumbleTime - dt);
    if (this.grinding) { this.stepGrind(dt, input); return; }
    if (this.wallride) { this.stepWallride(dt); return; }
    if (this.transition) { this.stepTransition(dt, input); return; }

    if (this.grounded) {
      this.leapsUsed = 0;
      this.updatePowerslide(input);
      this.heading += input.steer * (this.manual ? 0.5 : this.powerslide ? 0.9 : 1.5 + Math.min(this.speed, 8) * 0.07) * dt;
      // gravity along the slope (pitch > 0 is uphill along the direction of travel); pushing tops out at
      // pushSpeed but a hill can carry you faster. Pushing fades out up steep banks (gone at ~29°): gravity
      // wins and you roll back down instead of sticking to the bank's face
      const pushes = input.push && !this.manual && !this.powerslide && this.stumbleTime === 0;
      const grip = Math.max(0, Math.min(1, (0.5 - this.pitch) / 0.2));
      let speed = this.speed - ROLL.slopeGravity * Math.sin(this.pitch) * (this.pitch < 0 ? this.slopeBoost : 1) * dt;
      const pushSpeed = ROLL.pushSpeed + this.abilities.push;
      if (pushes && speed < pushSpeed) speed = Math.min(pushSpeed, speed + 5 * grip * dt); else speed -= ROLL.friction * dt;
      if (this.powerslide) speed -= 5.5 * dt; else if (input.brake) speed -= 12 * dt;
      if (speed < 0 && this.pitch > 0.12 && !input.brake) {
        // stalled on a bank or ramp: roll back down tail-first
        speed = -speed; this.stance = this.stance ? 0 : Math.PI; this.pitch = -this.pitch; this.rampRun = 0;
      }
      this.speed = Math.max(0, Math.min(this.topSpeed, speed));
      this.pushing = pushes && this.speed < pushSpeed - 0.2;
      if (input.crouch) this.charge = Math.min(1, this.charge + dt / 0.65);
      if (input.manual && this.speed > 1.3 && !input.crouch) {
        if (!this.manual) {
          this.manual = true; this.landWindow = 0; this.balance = 0; this.noseManual = input.push;
          this.addTrick(this.noseManual ? 'Nose manual' : 'Manual', this.noseManual ? 150 : 100);
        }
        this.balance += ((Math.sin(this.animationTime * 3.1) * 0.24 + 0.09) * this.abilities.steady * (this.perfectBalance > 0 ? 0 : 1) - input.steer * 1.2) * dt;
        this.comboPoints += (this.noseManual ? 85 : 60) * dt;
        if (Math.abs(this.balance) > 1) { this.sketchy(this.balance > 0 ? 'Manual lost · leaned too far right' : 'Manual lost · leaned too far left'); return; }
      } else if (this.manual) { this.manual = false; this.bank(); }
      if (this.pending.revert && !this.manual && this.revertCooldown === 0 && this.stumbleTime === 0) this.revert();
    } else {
      // vert airs spin faster, so a tap turns you around before you come back down (THPS makes this easy too)
      const turn = input.steer * Math.PI * (this.airRamp ? 2.4 : 1.5) * dt;
      if (this.popped) { this.heading += turn; this.spin += turn; }
      else { const carve = input.steer * 1.4 * dt; this.heading += carve; this.airHeading += carve; }
    }
    if (this.popBuffer > 0 && (this.grounded || this.coyote > 0) && this.stumbleTime === 0) this.jump();
    else if (this.popBuffer > 0 && !this.grounded && this.stumbleTime === 0) { if (!this.tryWallplant()) this.tryLeap(); }
    else if (!input.crouch) this.charge = 0;

    if (!this.grounded) {
      if (this.airTime === 0) { this.airPeak = this.position.y; this.overWater = false; }
      this.airPeak = Math.max(this.airPeak, this.position.y);
      if (!this.overWater && this.world.canRideAt?.(this.position.x, this.position.z, this.position.y) === false) this.overWater = true;
      // falling into a hole in the world (nothing below at all): bring the rider back quickly
      if (!this.soaring && this.position.y < this.airPeak - 4 && this.world.groundAt(this.position.x, this.position.z, this.position.y + 0.5) === null) { this.bail('Fell into a hole · back to solid ground', true, true); return; }
      this.airTime += dt; this.verticalSpeed -= 14 * dt;
      const direction = directionOf(input), special = this.specialReady && !!input.grind;
      if (this.pending.flip) this.startTrick(special ? SPECIAL_FLIP : FLIP_TRICKS[direction], 'flip', special ? 'rune' : undefined);
      if (this.pending.shove) this.startTrick(special ? SPECIAL_SHOVE : SHOVE_TRICKS[direction], 'shove', special ? 'teleport' : undefined);
      if (this.trick) this.trick.elapsed = Math.min(this.trick.duration, this.trick.elapsed + dt);
      this.updateGrab(input, dt);
      // holding Space in the air (a tuck) skips grinds and wallrides so you can clear an obstacle
      if (!input.crouch && this.railCooldown === 0 && this.tryGrind(input)) return;
    }
    const direction = this.travelHeading;
    const delta = { x: -Math.sin(direction) * this.speed * dt, y: this.grounded ? 0 : this.verticalSpeed * dt, z: -Math.cos(direction) * this.speed * dt };
    if (this.grounded) {
      if (this.world.canRideAt?.(this.position.x, this.position.z, this.position.y) === false) {
        // already on water or a hole (slid off a wall or a rail's end): roll back out, or be rescued in a moment
        if ((this.wetClock += dt) > 0.6) {
          const hole = this.world.groundAt(this.position.x, this.position.z, this.position.y + 0.5, true) === null;
          this.bail(hole ? 'Fell into a hole · back to solid ground' : 'Splash! · back to dry ground', true, true); return;
        }
      } else if (this.edgeAt(this.position.x + delta.x, this.position.z + delta.z, this.position.y)) {
        this.wetClock = 0;
        const { x, z, y } = this.position, edge = this.edgeAt(x + delta.x, z + delta.z, y);
        // shorelines and the map's edge follow tile edges: glance along them like a wall and keep rolling;
        // only riding straight at one stops you
        const alongX = Math.abs(delta.x) > Math.abs(delta.z) * 0.35 && !this.edgeAt(x + delta.x, z, y);
        const alongZ = !alongX && Math.abs(delta.z) > Math.abs(delta.x) * 0.35 && !this.edgeAt(x, z + delta.z, y);
        if (alongX || alongZ) {
          if (alongX) delta.z = 0; else delta.x = 0;
          const off = Math.atan2(-delta.x, -delta.z) - direction;
          this.heading += Math.atan2(Math.sin(off), Math.cos(off)) * Math.min(1, 8 * dt);
          this.speed *= 1 - 1.5 * dt;
        } else {
          // head-on, or into a corner: stop, and swing the board toward the nearest open direction (tile edges
          // run north-south and east-west) so pushing gets you going again instead of pressing into the edge
          delta.x = delta.z = 0; this.speed = 0;
          let open: number | null = null, best = -2;
          for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
            if (this.edgeAt(x - Math.sin(angle) * 0.3, z - Math.cos(angle) * 0.3, y)) continue;
            if (Math.cos(angle - direction) > best) { best = Math.cos(angle - direction); open = angle; }
          }
          if (open !== null) { const off = open - direction; this.heading += Math.atan2(Math.sin(off), Math.cos(off)) * Math.min(1, 6 * dt); }
        }
        if (this.noteClock <= 0) { this.message = edge === 'map' ? 'Edge of the map · turn around' : edge === 'hole' ? 'Hole ahead · turn around' : 'Water ahead · find a bridge'; this.noteClock = 2; }
      } else this.wetClock = 0;
      const ground = this.supportAt(this.position.x + delta.x, this.position.z + delta.z, this.position.y);
      // up a ramp long enough (not a curb), the vertical speed you carry off its lip launches you
      const throwVy = this.rampRun > ROLL.rampRun && this.inclineBehind > ROLL.rampPitch ? this.speed * Math.tan(Math.min(ROLL.maxPitch, this.inclineBehind)) : 0;
      const rampVy = throwVy >= ROLL.minLaunch ? throwVy : 0;
      const rise = ground === null ? -Infinity : ground - this.position.y;
      if (ground !== null && rise >= -0.42 && rise <= 0.45 && !(rampVy > 0 && rise < (rampVy - 21 * dt) * dt)) delta.y = rise;
      else {
        this.grounded = false; this.airHeading = this.heading + this.stance; this.airTime = this.spin = 0;
        this.verticalSpeed = rampVy; this.powerslide = 0; this.rampRun = 0; this.popped = rampVy > 0;
        if (rampVy > 0) delta.y = rampVy * dt;
      }
    } else if (this.world.inBounds?.(this.position.x + delta.x, this.position.z + delta.z) === false) {
      // flying at the edge of the map: an invisible wall you slide along
      const { x, z } = this.position;
      if (this.world.inBounds(x + delta.x, z)) delta.z = 0; else if (this.world.inBounds(x, z + delta.z)) delta.x = 0; else delta.x = delta.z = 0;
      this.speed = Math.hypot(delta.x, delta.z) / dt;
      if (this.speed > 0.1) this.airHeading = Math.atan2(-delta.x, -delta.z);
      if (this.noteClock <= 0) { this.message = 'Edge of the map · turn around'; this.noteClock = 2; }
    }
    const previous = this.position;
    const next = this.world.move(previous, delta);
    this.position = { x: next.x, y: next.y, z: next.z };
    if (this.grounded ? this.enterRamp() : this.landOnRamp(input)) return;
    const requestedDistance = this.speed * dt;
    const achievedDistance = -(next.x - previous.x) * Math.sin(direction) - (next.z - previous.z) * Math.cos(direction);
    if (next.blocked && (next.normal || requestedDistance - achievedDistance > 0.0001)) {
      const vx = -Math.sin(direction) * this.speed, vz = -Math.cos(direction) * this.speed;
      const nx = next.normal?.x ?? -vx / Math.max(this.speed, 0.001), nz = next.normal?.z ?? -vz / Math.max(this.speed, 0.001);
      const impact = next.normal ? Math.max(0, -(vx * nx + vz * nz)) : Math.max(0, (requestedDistance - achievedDistance) / dt);
      if (next.normal) this.wallTouch = { nx: next.normal.x, nz: next.normal.z, age: 0 };
      if (!this.grounded && next.normal && !input.crouch && this.tryWallride(next.normal, vx, vz)) return;
      // a catapult flight clipping a wall bonks off it instead (you can't steer those)
      if (impact > IMPACT.bail && this.immunity === 0 && !this.soaring) { this.bail('Hard impact · take a moment'); return; }
      const slideX = vx + nx * impact, slideZ = vz + nz * impact, before = this.speed;
      let slide = Math.hypot(slideX, slideZ), travel = Math.atan2(-slideX, -slideZ);
      if (this.grounded && next.normal && (before > 0.3 || input.push) && slide < before * 0.45) {
        // rode (or pushed) straight at it: turn along the wall instead of pinning against it, toward the side
        // you're steering (or already drifting)
        const along = Math.atan2(nz, -nx), drift = (vx * -nz + vz * nx) * 0.02, aim = direction + input.steer * 0.6;
        travel = Math.cos(along - aim) + drift >= Math.cos(along + Math.PI - aim) - drift ? along : along + Math.PI;
        slide = Math.max(slide, Math.min(before * 0.45, 4));
      }
      this.speed = slide * (impact > IMPACT.bonk ? 0.8 : impact > 3 ? 0.97 : 1);
      if (this.speed > 0.2) {
        if (this.grounded) this.heading = travel - this.stance; else this.airHeading = travel;
      }
      if (impact > IMPACT.bonk && this.noteClock <= 0) { this.message = 'Bonk!'; this.noteClock = 2; this.events.push({ type: 'bonk', score: 0, names: [], combo: this.comboCount }); }
    }
    const ground = this.supportAt(next.x, next.z, Math.max(previous.y, next.y));
    this.heightAboveGround=ground===null?2:Math.max(0,this.position.y-ground);
    if (!this.grounded && this.verticalSpeed <= 0 && ground !== null && next.y <= ground + 0.05) {
      this.position.y = ground; this.grounded = true;
      this.departedRail=null; this.airRamp = null;
      if (this.world.canRideAt?.(next.x,next.z,ground) === false) {
        // water or a hole: the combo you flew in with still counts, then you're put back on solid ground
        const hole = this.world.groundAt(next.x, next.z, ground + 0.5, true) === null;
        this.bail(hole ? 'Fell into a hole · back to solid ground' : 'Splash! · back to dry ground', true, true); return;
      }
      const fallSpeed = this.verticalSpeed; this.verticalSpeed = 0;
      const alignment = Math.abs(Math.sin(this.heading - this.airHeading));
      // landing on a downslope (a bank, a ramp's far side) turns the fall into speed and takes the sting out
      const slope = this.slopeAt(next.x, next.z, ground, this.airHeading);
      this.pitch = Math.max(-ROLL.maxPitch, Math.min(ROLL.maxPitch, slope));
      if (slope < -0.05) this.speed = Math.min(this.topSpeed, this.speed - fallSpeed * Math.sin(-slope) * 0.9);
      const soared = this.soaring; this.soaring = false;
      if (!this.abilities.ironKnees && !soared && fallSpeed * Math.cos(slope) < -LANDING.heavy) { this.bail('Heavy landing · that was a long way down'); return; }
      const grabbing = !!this.grab && !!input.grab; this.grab = null;
      const sketchy = this.landingFault(grabbing, this.speed > 2 && alignment > 0.97);
      if (sketchy) this.sketchy(sketchy);
      else { this.awardGaps(ground); this.land(!!input.manual); }
    } else if (!this.grounded && delta.y > 0 && next.y < previous.y + delta.y - 0.005) this.verticalSpeed = 0;
    if (!this.grounded && this.wallTouch && !next.blocked && !input.crouch && this.catchRecentWall()) return;
    // perched in the air on something too steep to stand on (a roof crease, the top of a wall): not falling,
    // not landing; bring the rider down quickly instead of hovering there
    this.perchTime = !this.grounded && this.verticalSpeed < -2 && Math.abs(next.y - previous.y) < 0.002 ? this.perchTime + dt : 0;
    if (this.grounded || this.grinding || this.wallride) this.soaring = false;
    if (this.perchTime > 0.6) { this.bail('Stuck up there · back to solid ground', true, true); return; }
    if (this.position.y < -20 || (this.airTime > 6 && !this.soaring)) { this.bail('Out of bounds · returning to solid ground', true, true); return; }
    if (this.grounded && !next.blocked && this.world.canRideAt?.(this.position.x, this.position.z, this.position.y) !== false) {
      this.safe = { ...this.position };
      if ((this.safeClock += dt) >= 0.5) { this.safeClock = 0; this.safeTrail.push({ ...this.position }); if (this.safeTrail.length > 6) this.safeTrail.shift(); }
    }
    if (this.grounded) {
      // incline ahead of and behind the board, ignoring samples that look over a drop or up a wall
      // measured from the ground right under the board (the rider rides on the highest of several samples,
      // which sits a little up the slope and would flatten it)
      const dx = -Math.sin(this.travelHeading)*0.25, dz = -Math.cos(this.travelHeading)*0.25;
      const y = this.world.groundAt(this.position.x,this.position.z,this.position.y+0.6) ?? this.position.y;
      const front = this.world.groundAt(this.position.x+dx,this.position.z+dz,this.position.y+0.6);
      const back = this.world.groundAt(this.position.x-dx,this.position.z-dz,this.position.y+0.6);
      const ahead = front !== null && front > y - 0.2 ? Math.atan2(front - y, 0.25) : null;
      const behind = back !== null && back < y + 0.2 ? Math.atan2(y - back, 0.25) : null;
      const pitch = ahead !== null && behind !== null ? (ahead + behind) / 2 : ahead ?? behind ?? 0;
      this.pitch += (Math.max(-ROLL.maxPitch,Math.min(ROLL.maxPitch,pitch))-this.pitch)*Math.min(1,dt*16);
      this.inclineBehind = behind ?? 0;
      // a ramp is a sustained incline (both samples up); at its lip only the ground behind still rises
      const onIncline = ahead !== null && behind !== null && ahead > ROLL.rampPitch && behind > ROLL.rampPitch;
      this.rampRun = onIncline ? this.rampRun + this.speed * dt : this.inclineBehind > ROLL.rampPitch ? this.rampRun : 0;
    } else this.pitch *= 0.9;
  }
  /** RS3's Surge: a burst of speed along your line, on the ground or in the air (stretches gaps); 8 s cooldown. */
  private castSurge() {
    if (this.surgeCooldown > 0 || this.bailTime > 0 || this.grinding || this.wallride) {
      if (this.surgeCooldown > 0) this.message = `Surge recharging · ${this.surgeCooldown.toFixed(1)} s`;
      return;
    }
    this.surgeCooldown = this.abilities.surgeCooldown; this.surgeTime = 0;
    if (this.transition) this.transition.v += Math.sign(this.transition.v || 1) * SURGE.boost;
    else this.speed = Math.min(this.topSpeed, Math.max(this.speed + SURGE.boost, SURGE.minimum));
    // mastered (level 99): Surge in the air lifts you too
    if (!this.grounded && !this.transition && this.abilities.airSurge) this.verticalSpeed = Math.max(this.verticalSpeed, 0) + SURGE.lift;
    this.powerslide = 0; this.message = 'Surge!';
    this.events.push({ type: 'surge', score: 0, names: ['Surge'], combo: this.comboCount });
  }
  /** Rolling onto a quarter pipe's face from the floor in front of it. */
  private enterRamp() {
    for (const ramp of this.world.ramps ?? []) {
      const local = onRampFace(ramp, this.position.x, this.position.z);
      if (!local || Math.abs(this.position.y - ramp.origin.y - rampHeight(ramp, local.w)) > 0.35) continue;
      const facing = this.facingOn(ramp), v = this.speed * Math.cos(this.stance);
      if (v * Math.cos(facing) <= 0.05) continue; // rolling along or away from it
      if (this.manual) { this.manual = false; this.bank(); }
      const s = Math.asin(Math.min(1, local.w / ramp.radius)) * ramp.radius;
      this.transition = { ramp, s, u: local.u, v, facing }; this.powerslide = 0;
      this.position = rampPoint(ramp, local.u, s);
      return true;
    }
    return false;
  }
  /** The board's nose direction on a ramp face, from its heading (radians from straight up the face). */
  private facingOn(ramp: Ramp) {
    const { wx, wz, ux, uz } = rampAxes(ramp), nx = -Math.sin(this.heading), nz = -Math.cos(this.heading);
    return Math.atan2(nx * ux + nz * uz, nx * wx + nz * wz);
  }
  /** Coming down onto a quarter pipe's face: keep the speed along the board's line, like a landing. */
  private landOnRamp(input: SkateInput) {
    if (this.verticalSpeed > 0) return false;
    for (const ramp of this.world.ramps ?? []) {
      const local = onRampFace(ramp, this.position.x, this.position.z);
      if (!local) continue;
      const face = ramp.origin.y + rampHeight(ramp, local.w);
      if (this.position.y > face + 0.02 || this.position.y < face - 0.9) continue;
      const angle = Math.asin(Math.min(1, local.w / ramp.radius)), { wx, wz, ux, uz } = rampAxes(ramp);
      const hx = -Math.sin(this.airHeading) * this.speed, hz = -Math.cos(this.airHeading) * this.speed;
      const vs = (hx * wx + hz * wz) * Math.cos(angle) + this.verticalSpeed * Math.sin(angle), vu = hx * ux + hz * uz;
      const facing = this.facingOn(ramp), along = vs * Math.cos(facing) + vu * Math.sin(facing), total = Math.hypot(vs, vu);
      const grabbing = !!this.grab && !!input.grab; this.grab = null;
      this.transition = { ramp, s: angle * ramp.radius, u: local.u, v: along, facing };
      this.position = rampPoint(ramp, local.u, angle * ramp.radius);
      this.grounded = true; this.verticalSpeed = 0; this.airRamp = null; this.departedRail = null;
      const sketchy = this.landingFault(grabbing, total > 2 && Math.abs(along) < total * 0.34);
      if (sketchy) this.sketchy(sketchy);
      else { this.awardGaps(this.position.y); this.land(false); }
      if (this.stumbleTime > 0) this.transition.v *= 0.65;
      this.stance = this.transition.v < 0 ? Math.PI : 0;
      return true;
    }
    return false;
  }
  /** Riding a quarter pipe: gravity along the board's line, A/D carve, W pumps, S drags, Space ollies off. */
  private stepTransition(dt: number, input: SkateInput) {
    const tr = this.transition!, ramp = tr.ramp, top = rampTop(ramp);
    tr.facing += input.steer * 1.6 * dt;
    tr.v -= ROLL.rampGravity * Math.sin(tr.s / ramp.radius) * Math.cos(tr.facing) * dt;
    const roll = 0.5 - (input.push ? 2.2 : 0) + (input.brake ? 6 : 0);
    if (Math.abs(tr.v) > 0.05) tr.v -= Math.sign(tr.v) * Math.min(Math.max(roll, -5) * dt, Math.abs(tr.v));
    const vs = tr.v * Math.cos(tr.facing), vu = tr.v * Math.sin(tr.facing);
    tr.s += vs * dt; tr.u += vu * dt;
    this.stance = tr.v < 0 ? Math.PI : 0; this.speed = Math.abs(tr.v);
    if (input.crouch) this.charge = Math.min(1, this.charge + dt / 0.65);
    if (this.popBuffer > 0 && this.stumbleTime === 0) { this.leaveRamp(true, false); return; }
    if (Math.abs(tr.u) > ramp.width / 2) { this.leaveRamp(false, false); return; }
    if (tr.s >= top.s && vs > 0) { tr.s = top.s; this.leaveRamp(false, true); return; }
    if (tr.s <= 0) { this.exitRamp(); return; }
    this.position = rampPoint(ramp, tr.u, tr.s);
    const nose = this.surfaceFrame!.forward;
    if (Math.hypot(nose.x, nose.z) > 0.05) this.heading = Math.atan2(-nose.x, -nose.z);
    this.pitch = Math.atan2(nose.y, Math.hypot(nose.x, nose.z));
    this.safe = { ...rampPoint(ramp, tr.u, 0) };
  }
  /** Off the face into the air: over the coping, off the side, or with an ollie (which pops out of the face). */
  private leaveRamp(ollie: boolean, lip: boolean) {
    const tr = this.transition!, ramp = tr.ramp, frame = rampFrame(ramp, tr.s), { wx, wz, ux, uz } = rampAxes(ramp);
    const vs = tr.v * Math.cos(tr.facing), vu = tr.v * Math.sin(tr.facing);
    let vx = frame.tangent.x * vs + ux * vu, vy = frame.tangent.y * vs, vz = frame.tangent.z * vs + uz * vu;
    // a vert ramp sends you straight up, drifting just back over the face so you come down into it (like THPS)
    if (lip && rampTop(ramp).angle > 1.3) { const along = vx * wx + vz * wz + 0.4; vx -= wx * along; vz -= wz * along; }
    if (ollie) {
      const pop = 3.6 + this.charge * 2;
      vx += frame.normal.x * pop; vy += frame.normal.y * pop; vz += frame.normal.z * pop;
      if (this.landWindow > 0) { this.landWindow = 0; this.bank(); }
      this.addTrick('Ollie', 100); this.popBuffer = 0; this.charge = 0;
    }
    this.position = rampPoint(ramp, tr.u, tr.s);
    this.transition = null; this.grounded = false; this.airRamp = ramp; this.coyote = 0; this.popped = true;
    this.verticalSpeed = vy; this.speed = Math.hypot(vx, vz);
    this.airHeading = this.speed > 0.2 ? Math.atan2(-vx, -vz) : this.heading;
    this.airTime = this.spin = 0;
  }
  /** Rolled back down onto the flat: carry the speed out along the board's line. */
  private exitRamp() {
    const tr = this.transition!, ramp = tr.ramp, { wx, wz, ux, uz } = rampAxes(ramp), c = Math.cos(tr.facing), s = Math.sin(tr.facing);
    const nx = wx * c + ux * s, nz = wz * c + uz * s;
    this.position = rampPoint(ramp, tr.u, 0);
    this.heading = Math.atan2(-nx, -nz); this.stance = tr.v < 0 ? Math.PI : 0; this.speed = Math.abs(tr.v);
    this.transition = null; this.grounded = true; this.pitch = 0; this.rampRun = 0;
  }
  /** Incline along a heading at a point (radians, positive uphill). */
  private slopeAt(x: number, z: number, y: number, heading: number) {
    const dx = -Math.sin(heading) * 0.3, dz = -Math.cos(heading) * 0.3;
    const front = this.world.groundAt(x + dx, z + dz, y + 0.6), back = this.world.groundAt(x - dx, z - dz, y + 0.6);
    return front !== null && back !== null ? Math.atan2(front - back, 0.6) : 0;
  }
  /** S + A/D at speed throws the board sideways to scrub speed and carve, linking like a revert after a landing. */
  private updatePowerslide(input: SkateInput) {
    if (!this.powerslide) {
      if (!input.brake || Math.abs(input.steer) < 0.3 || this.speed < 3 || this.manual || this.stumbleTime > 0) return;
      this.powerslide = input.steer > 0 ? 1 : -1;
      if (this.landWindow > 0) { this.addTrick('Powerslide', 100); this.landWindow = LANDING_WINDOW; } else this.message = 'Powerslide';
      this.events.push({ type: 'slide', score: 0, names: ['Powerslide'], combo: this.comboCount });
    } else if (!input.brake || this.speed < 1.2) this.powerslide = 0;
  }

  private railsNear(radius: number) { return this.world.railsNear?.(this.position.x, this.position.z, radius) ?? this.world.rails ?? []; }
  private supportAt(x: number, z: number, y: number) {
    let best = this.world.groundAt(x, z, y + 0.46);
    for (const [dx, dz] of [[0.16, 0], [-0.16, 0], [0, 0.16], [0, -0.16]]) {
      const ground = this.world.groundAt(x + dx, z + dz, y + 0.46);
      if (ground !== null && (best === null || ground > best)) best = ground;
    }
    return best;
  }
  /** THPS-style gaps the world gives for free: clearing water, big drops and long hang time. */
  private awardGaps(landing: number) {
    if (this.overWater) this.addTrick('Water gap', 500 + Math.round(this.airTime * 300));
    const drop = this.airPeak - landing;
    if (drop > GAPS.drop) this.addTrick('Big drop', Math.round(150 * drop));
    if (this.airTime > GAPS.hang) this.addTrick('Hang time', Math.round(200 * this.airTime));
  }
  private jump() {
    // popping again inside the landing window links the next air into the same combo (repeats score less)
    this.landWindow = 0;
    this.verticalSpeed = (OLLIE.base + this.charge * OLLIE.charged) * this.abilities.pop; this.grounded = false; this.manual = false; this.popped = true;
    this.airTime = this.spin = 0; this.airHeading = this.heading + this.stance; this.leapsUsed = 0;
    this.popBuffer = this.coyote = 0; this.charge = 0;
    this.addTrick('Ollie', 100);
  }
  /**
   * Wallplant (THPS 4): Space in the air with a wall just ahead (or touched a moment ago) kicks you up and
   * off it, bouncing your line away from the wall. Chains up between walls.
   */
  private tryWallplant() {
    if (!this.abilities.wallplant || this.plantCooldown > 0 || this.airTime < 0.05) return false;
    const direction = this.airHeading, fx = -Math.sin(direction), fz = -Math.cos(direction);
    let normal: { x: number; z: number } | null = null;
    const probe = this.world.move(this.position, { x: fx * 0.4, y: 0, z: fz * 0.4 });
    if (probe.blocked && probe.normal && probe.normal.x * fx + probe.normal.z * fz < -0.2) normal = { x: probe.normal.x, z: probe.normal.z };
    else if (this.wallTouch) normal = { x: this.wallTouch.nx, z: this.wallTouch.nz };
    if (!normal) return false;
    const vx = fx * this.speed, vz = fz * this.speed, into = vx * normal.x + vz * normal.z;
    let rx = vx - 2 * Math.min(0, into) * normal.x, rz = vz - 2 * Math.min(0, into) * normal.z;
    const away = rx * normal.x + rz * normal.z;
    if (away < 2.5) { rx += normal.x * (2.5 - away); rz += normal.z * (2.5 - away); }
    this.speed = Math.min(this.topSpeed, Math.max(3, Math.hypot(rx, rz) * 0.85));
    this.airHeading = Math.atan2(-rx, -rz); this.heading = this.airHeading - this.stance;
    this.verticalSpeed = AIR_MOVES.wallplant * this.abilities.pop;
    this.plantCooldown = AIR_MOVES.plantCooldown; this.wallTouch = null; this.wallCooldown = 0.25; this.popBuffer = 0; this.popped = true;
    this.addTrick('Wallplant', 250);
    return true;
  }
  /** Agility leap: a second pop in the air (Space again), once per air (twice at level 90). */
  private tryLeap() {
    if (this.leapsUsed >= this.abilities.leaps || this.airTime < 0.1) return false;
    // close above the ground on the way down, Space is a buffered ollie for the landing instead
    if (this.verticalSpeed < 0 && this.heightAboveGround < AIR_MOVES.leapMinHeight) return false;
    this.leapsUsed++; this.popBuffer = 0; this.popped = true;
    this.verticalSpeed = Math.max(0, this.verticalSpeed) * 0.3 + AIR_MOVES.leap * this.abilities.pop;
    this.addTrick('Agility leap', 200);
    this.events.push({ type: 'leap', score: 0, names: ['Agility leap'], combo: this.comboCount });
    return true;
  }
  private addTrick(name: string, points: number) {
    const repeats = this.repeats.get(name) ?? 0; this.repeats.set(name, repeats + 1);
    this.comboPoints += Math.round(points * Math.max(REPEAT.floor, 1 - REPEAT.step * repeats));
    this.comboCount++; this.names.push(name); this.message = this.names.join(' + ');
    this.events.push({ type: 'trick', score: 0, names: [name], combo: this.comboCount });
  }
  get specialReady() { return this.special >= 0.999; }
  private startTrick(trick: FlipTrick, kind: Trick['kind'], special?: SpecialKind) {
    if (this.grab || this.used.has(trick.name) || (this.trick && this.trick.elapsed < this.trick.duration)) return;
    this.used.add(trick.name); this.trick = { name: trick.name, duration: trick.duration, elapsed: 0, kind, spin: trick.spin, special };
    this.addTrick(trick.name, trick.points);
  }
  /** Grabs score while held; one of each per jump, and not in the middle of a flip. */
  private updateGrab(input: SkateInput, dt: number) {
    if (this.grab) {
      if (input.grab) { this.grab.time += dt; this.comboPoints += this.grab.perSecond * dt; } else this.grab = null;
      return;
    }
    if (!input.grab || this.airTime < 0.08 || (this.trick && this.trick.elapsed < this.trick.duration)) return;
    const special = this.specialReady && !!input.grind, grab = special ? SPECIAL_GRAB : GRAB_TRICKS[directionOf(input)];
    if (this.used.has(grab.name)) return;
    this.used.add(grab.name); this.trick = null;
    this.grab = { name: grab.name, kind: grab.kind, time: 0, perSecond: grab.perSecond, special: special ? 'dragon' : undefined }; this.addTrick(grab.name, grab.points);
  }
  private land(linkManual: boolean) {
    this.stance = Math.cos(this.heading - this.airHeading) < 0 ? Math.PI : 0;
    // the board snaps onto the line you were flying along (THPS): momentum keeps its direction
    this.heading = this.airHeading - this.stance;
    const turns = Math.floor((Math.abs(this.spin) + 0.25) / Math.PI);
    // spins score on their own too (a plain 180 out of a vert air has no ollie to start the combo)
    if (turns > 0) this.addTrick(`${turns * 180}°`, turns * 180);
    this.landingTime = 0.24; this.airTime = 0; this.trick = null; this.used.clear();
    // a held manual links straight away; otherwise keep the combo open briefly for a revert or manual
    if (!linkManual || this.speed < 1.3) { if (this.comboCount) this.landWindow = LANDING_WINDOW; else this.bank(); }
  }
  /** 180-degree pivot while rolling; scores and links only right after a landing, like a THPS revert. */
  private revert() {
    this.heading += Math.PI; this.stance = this.stance ? 0 : Math.PI;
    this.heading = Math.atan2(Math.sin(this.heading), Math.cos(this.heading));
    this.revertCooldown = 0.45;
    if (this.landWindow > 0) { this.addTrick('Revert', 100); this.landWindow = LANDING_WINDOW; }
    else this.message = this.stance ? 'Riding fakie' : 'Back to regular';
  }
  private bank() {
    if (this.comboCount) {
      const score = Math.round(this.comboPoints) * this.comboCount;
      this.totalScore += score; this.message = `${this.names.join(' + ')} · +${score.toLocaleString()}`;
      this.events.push({ type: 'land', score, names: [...this.names], combo: this.comboCount });
    }
    this.clearCombo();
  }
  /**
   * Why a landing is sketchy, or null when it's clean. A flip that's at least half done finishes itself
   * as you land (forgiving, like THPS on its easier settings).
   */
  private landingFault(grabbing: boolean, sideways: boolean) {
    const trick = this.trick;
    if (trick && trick.elapsed + 0.06 < trick.duration && trick.elapsed >= trick.duration * LANDING.flipFinish) trick.elapsed = trick.duration;
    if (grabbing) return 'Still grabbing on landing';
    if (trick && trick.elapsed + 0.06 < trick.duration) return `Landed mid-${trick.name.toLowerCase()}`;
    if (sideways) return 'Landed sideways';
    return null;
  }
  /** What stops the board at a point: water or a hole in the world, the edge of the map, or nothing. */
  private edgeAt(x: number, z: number, y: number): 'water' | 'hole' | 'map' | null {
    if (this.world.inBounds?.(x, z) === false) return 'map';
    if (this.world.canRideAt?.(x, z, y) !== false) return null;
    return this.world.groundAt(x, z, y + 0.5, true) === null ? 'hole' : 'water';
  }
  /**
   * A sketchy landing (or a lost manual / grind balance): a wobble that still banks the combo at half value.
   * Only real bails (a hard wall hit or a heavy landing) lose it.
   */
  private sketchy(reason: string) {
    this.landWindow = 0;
    let note = reason;
    if (this.comboCount) {
      const score = Math.round(this.comboPoints * LANDING.sketchy) * this.comboCount;
      this.totalScore += score; note = `${reason} · half points +${score.toLocaleString('en-GB')}`;
      this.events.push({ type: 'land', score, names: [...this.names], combo: this.comboCount, sketchy: true });
    }
    this.special *= 0.75;
    this.speed *= 0.85; this.stumbleTime = 0.3; this.manual = false; this.message = note;
    this.airTime = 0; this.clearCombo();
    this.events.push({ type: 'sketchy', score: 0, names: [], combo: 0 });
  }
  /** Down on the ground; `keep` banks the open combo first (water, holes), otherwise it's lost. */
  private bail(reason: string, relocate = false, keep = false) {
    // a combo that already landed still counts
    let note = reason;
    if (this.landWindow > 0 || (keep && this.comboCount)) {
      const before = this.totalScore; this.landWindow = 0; this.bank();
      if (keep && this.totalScore > before) note = `${reason} · combo banked +${(this.totalScore - before).toLocaleString('en-GB')}`;
    }
    this.wallride = null; this.grab = null; this.grindStyle = null; this.transition = null; this.airRamp = null; this.special = keep ? this.special : 0;
    this.bailSlide = relocate ? 0 : Math.min(this.speed * 0.55, 5); this.bailHeading = this.travelHeading;
    this.speed = 0; this.bailTime = relocate ? BAIL.rescue : BAIL.time; this.relocate = relocate;
    this.message = note; this.manual = false; this.grinding = null; this.clearCombo();
    this.events.push({ type: 'bail', score: 0, names: [], combo: 0 });
  }
  private clearCombo() { this.comboPoints = this.comboCount = 0; this.trick = null; this.names = []; this.used.clear(); this.repeats.clear(); }

  /**
   * Magnetic catch: any rail or wall top within reach latches, whether the board is coming down onto it,
   * still rising slowly past it, or catching its lip from slightly below. Shift (assisted) widens the reach.
   * Holding brake in the air skips grinds so you can jump over things.
   */
  private tryGrind(input: SkateInput) {
    const assisted = !!input.grind;
    if (this.speed < 0.8 || (!assisted && this.verticalSpeed > GRIND_CATCH.maxRise)) return false;
    // a flip that's nearly done finishes as you lock on; earlier than that you're still flipping
    if (this.trick && this.trick.elapsed < this.trick.duration * 0.7) return false;
    let best: { rail: Rail; t: number; x: number; y: number; z: number; score: number } | null = null;
    for (const rail of this.railsNear(1.5)) {
      if (rail.id === this.departedRail || (!assisted && this.airRamp && rail.id === `${this.airRamp.id}-coping`)) continue;
      const dx = rail.b.x - rail.a.x, dz = rail.b.z - rail.a.z, lengthSq = dx * dx + dz * dz;
      if (!lengthSq) continue;
      const length = Math.sqrt(lengthSq), slack = GRIND_CATCH.endSlack / length;
      const raw = ((this.position.x - rail.a.x) * dx + (this.position.z - rail.a.z) * dz) / lengthSq;
      if (raw < -slack || raw > 1 + slack) continue;
      const t = Math.max(0, Math.min(1, raw));
      const x = rail.a.x + dx * t, z = rail.a.z + dz * t, y = rail.a.y + (rail.b.y - rail.a.y) * t;
      const side = Math.hypot(x - this.position.x, z - this.position.z), above = this.position.y - y;
      const reach = (rail.width ?? 0.08) / 2 + (assisted ? GRIND_CATCH.assistedReach : GRIND_CATCH.reach);
      if (side > reach || above < -GRIND_CATCH.below || above > (assisted ? GRIND_CATCH.assistedAbove : GRIND_CATCH.above)) continue;
      const score = side + Math.abs(above) * 0.5;
      if (!best || score < best.score) best = { rail, t, x, y, z, score };
    }
    if (!best) return false;
    const { rail, t, x, y, z } = best;
    const dx = rail.b.x - rail.a.x, dz = rail.b.z - rail.a.z;
    const dot = (-Math.sin(this.airHeading) * dx - Math.cos(this.airHeading) * dz) / Math.hypot(dx, dz);
    this.grinding = { rail, t, direction: dot < 0 ? -1 : 1 }; this.balance = 0; this.verticalSpeed = 0; this.grindTime = 0; this.leapsUsed = 0;
    // keep most of the speed even when catching at an angle
    this.speed = Math.max(2.5, this.speed * (0.8 + 0.2 * Math.abs(dot)));
    this.position = { x, y, z }; this.heading = Math.atan2(-dx * this.grinding.direction, -dz * this.grinding.direction); this.airHeading = this.heading; this.stance = 0;
    const style = grindStyle(input.push, input.brake, input.steer > 0.3 ? 1 : input.steer < -0.3 ? -1 : 0);
    this.grindStyle = style; this.brakeLatch = input.brake; this.grab = null;
    this.trick = null; this.addTrick(style.name, style.points);
    this.events.push({ type: 'grind', score: 0, names: [rail.name], combo: this.comboCount });
    return true;
  }
  /** Starts a wallride when the board hits a wall at a glancing angle, with speed, off the ground. */
  private tryWallride(normal: Point, vx: number, vz: number) {
    if (this.wallCooldown > 0 || this.speed < WALLRIDE.minSpeed) return false;
    if (this.trick && this.trick.elapsed < this.trick.duration * 0.7) return false;
    const nx = normal.x, nz = normal.z, tx = -nz, tz = nx;
    const into = Math.max(0, -(vx * nx + vz * nz)), along = vx * tx + vz * tz;
    // approach angle to the wall under maxAngle: along / into > cot(maxAngle)
    if (Math.abs(along) * Math.tan((WALLRIDE.maxAngle * Math.PI) / 180) < into) return false;
    const ground = this.world.groundAt(this.position.x, this.position.z, this.position.y + 0.3);
    if (ground !== null && this.position.y - ground < WALLRIDE.minHeight) return false;
    const dir = along >= 0 ? 1 : -1;
    this.wallride = { nx, nz, dir, time: 0, duration: Math.max(WALLRIDE.minTime, Math.min(WALLRIDE.maxTime, 0.5 + this.speed * 0.17)) };
    this.speed = Math.max(this.speed * 0.92, Math.abs(along));
    // a little lift onto the wall; an ollie's full pop would carry straight up and over
    this.verticalSpeed = Math.min(WALLRIDE.maxLift, Math.max(this.verticalSpeed, WALLRIDE.lift));
    this.airHeading = this.heading = Math.atan2(-tx * dir, -tz * dir); this.spin = 0; this.leapsUsed = 0;
    this.trick = null; this.addTrick('Wallride', 200);
    return true;
  }
  /** Airborne right beside a wall touched a moment ago (a glancing hit on the ground turned us along it). */
  private catchRecentWall() {
    const { nx, nz } = this.wallTouch!;
    const probe = this.world.move(this.position, { x: -nx * 0.08, y: 0, z: -nz * 0.08 });
    if (!probe.blocked || !probe.normal || probe.normal.x * nx + probe.normal.z * nz < 0.8) return false;
    const direction = this.travelHeading;
    return this.tryWallride(probe.normal, -Math.sin(direction) * this.speed, -Math.cos(direction) * this.speed);
  }
  private stepWallride(dt: number) {
    const w = this.wallride!;
    w.time += dt; this.airTime += dt;
    this.comboPoints += 150 * dt;
    this.speed = Math.max(0, this.speed - 0.9 * dt);
    this.verticalSpeed -= WALLRIDE.gravity * dt;
    const tx = -w.nz * w.dir, tz = w.nx * w.dir;
    if (this.popBuffer > 0) {
      // wallie: pop off the wall, angled away from it
      this.popBuffer = 0;
      const ax = tx + w.nx * 0.7, az = tz + w.nz * 0.7;
      this.endWallride();
      this.airHeading = this.heading = Math.atan2(-ax, -az); this.verticalSpeed = 5 * this.abilities.pop;
      this.addTrick('Wallie', 150);
      return;
    }
    // ride along the tangent while leaning into the wall so contact is felt every step
    const next = this.world.move(this.position, { x: tx * this.speed * dt - w.nx * 0.04, y: this.verticalSpeed * dt, z: tz * this.speed * dt - w.nz * 0.04 });
    this.position = { x: next.x, y: next.y, z: next.z };
    const touching = next.blocked && next.normal && next.normal.x * w.nx + next.normal.z * w.nz > 0.6;
    if (touching) { w.nx = next.normal!.x; w.nz = next.normal!.z; } // follow gentle curves (towers)
    const ground = this.world.groundAt(next.x, next.z, next.y + 0.3);
    this.heightAboveGround = ground === null ? 2 : Math.max(0, next.y - ground);
    if (!touching || w.time >= w.duration || this.speed < 1 || (ground !== null && next.y <= ground + 0.05)) this.endWallride();
  }
  private endWallride() {
    const w = this.wallride;
    if (w) { const tx = -w.nz * w.dir, tz = w.nx * w.dir; this.airHeading = this.heading = Math.atan2(-tx, -tz); }
    this.wallride = null; this.wallTouch = null; this.wallCooldown = WALLRIDE.cooldown; this.grounded = false;
  }
  private stepGrind(dt: number, input: SkateInput) {
    const grind = this.grinding!, rail = grind.rail;
    const dx = rail.b.x - rail.a.x, dz = rail.b.z - rail.a.z, length = Math.hypot(dx, dz);
    grind.t += grind.direction * this.speed * dt / length;
    // sloped tops (hills, bridge arches): a little faster downhill, slower uphill, and the board tilts with them
    const rise = ((rail.b.y - rail.a.y) / length) * grind.direction;
    this.speed = Math.max(1, Math.min(10, this.speed - (0.35 + rise * 2.5) * dt));
    this.pitch += (Math.max(-0.45, Math.min(0.45, Math.atan(rise))) - this.pitch) * Math.min(1, dt * 16);
    // balance starts calm and gets harder the longer you hold the grind
    this.grindTime += dt;
    const wobble = Math.min(1, 0.15 + this.grindTime / 5) * (this.grindStyle?.wobble ?? 1) * this.abilities.steady * (this.perfectBalance > 0 ? 0 : 1);
    if (!input.brake) this.brakeLatch = false;
    const drop = input.brake && !this.brakeLatch;
    this.balance += ((Math.sin(this.animationTime * 3) * 0.28 + 0.14) * wobble - input.steer * 1.2) * dt;
    // Shift + a flip key mid-grind with the special bar full: a Godsword grind (locked balance, big points)
    if ((this.pending.flip || this.pending.shove) && input.grind && this.specialReady && !this.grindStyle?.special) {
      this.grindStyle = SPECIAL_GRIND; this.balance = 0; this.addTrick(SPECIAL_GRIND.name, SPECIAL_GRIND.points);
    }
    this.comboPoints += (this.grindStyle?.special ? 500 : 120) * dt;
    const t = Math.max(0, Math.min(1, grind.t));
    this.position = { x: rail.a.x + dx * t, y: rail.a.y + (rail.b.y - rail.a.y) * t, z: rail.a.z + dz * t };
    this.heading = Math.atan2(-dx * grind.direction, -dz * grind.direction); this.stance = 0; this.airHeading = this.heading;
    if ((grind.t<0||grind.t>1)&&!drop&&this.popBuffer===0&&Math.abs(this.balance)<=1&&this.connectGrind(grind))return;
    if (Math.abs(this.balance) > 1 || drop || grind.t < 0 || grind.t > 1 || this.popBuffer > 0) {
      const pop = this.popBuffer > 0;
      this.departedRail=rail.id;
      this.grinding = null; this.grindStyle = null; this.railCooldown = 0.35; this.airTime = this.spin = 0;
      this.verticalSpeed = pop ? 4.8 : 0; this.popBuffer = 0;
      if(drop) {
        const side=input.steer<0?-1:1,offset=(rail.width??0.08)/2+0.30;
        const next=this.world.move(this.position,{x:-dz/length*offset*side,y:0,z:dx/length*offset*side});
        this.position={x:next.x,y:next.y,z:next.z};
      } else if(!pop&&(grind.t<0||grind.t>1)) {
        // Rolled off the end: clear the rail's own top so the landing check doesn't catch it.
        const clear=0.25*grind.direction;
        const next=this.world.move(this.position,{x:dx/length*clear,y:0,z:dz/length*clear});
        this.position={x:next.x,y:next.y,z:next.z};
      }
      if(Math.abs(this.balance)>1)this.sketchy(this.balance>0?'Fell off the grind · leaned too far right':'Fell off the grind · leaned too far left');
      if (pop) this.addTrick('Ollie out', 100);
    }
  }
  private connectGrind(current:NonNullable<Skater['grinding']>) {
    const end=current.direction>0?current.rail.b:current.rail.a;
    const dx=current.rail.b.x-current.rail.a.x,dz=current.rail.b.z-current.rail.a.z,length=Math.hypot(dx,dz);
    let best:{rail:Rail;direction:number;score:number}|null=null;
    for(const rail of this.railsNear(1)) {
      if(rail.id===current.rail.id)continue;
      for(const direction of [1,-1]) {
        const start=direction>0?rail.a:rail.b;
        if(Math.hypot(start.x-end.x,start.z-end.z)>0.4||Math.abs(start.y-end.y)>0.12)continue;
        const rx=(rail.b.x-rail.a.x)*direction,rz=(rail.b.z-rail.a.z)*direction,rl=Math.hypot(rx,rz);
        if(rl<0.1)continue;
        const score=(dx*current.direction*rx+dz*current.direction*rz)/(length*rl);
        if(score<-0.15)continue;
        if(!best||score>best.score)best={rail,direction,score};
      }
    }
    if(!best)return false;
    this.grinding={rail:best.rail,direction:best.direction,t:best.direction>0?0:1};
    this.position={...(best.direction>0?best.rail.a:best.rail.b)};
    return true;
  }
}
