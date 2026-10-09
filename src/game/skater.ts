export interface Point { x: number; y: number; z: number }
export interface Rail { id: string; name: string; a: Point; b: Point; width?: number }
export interface SkateWorld {
  groundAt(x: number, z: number, fromY: number): number | null;
  move(from: Point, delta: Point): Point & { blocked: boolean; normal?: Point };
  rails?: Rail[];
  canRideAt?(x: number, z: number, y: number): boolean;
}
export interface SkateInput {
  push: boolean; brake: boolean; steer: number; crouch: boolean; pop: boolean; flip: boolean; shove: boolean;
  manual?: boolean; grind?: boolean;
}
type Trick = { name: string; duration: number; elapsed: number; kind: 'flip' | 'shove' };
export type SkateEvent = { type: 'land' | 'bail' | 'trick' | 'grind'; score: number; names: string[]; combo: number };
const FIXED_DT = 1 / 120;

export class Skater {
  position: Point;
  heading = 0; speed = 0; verticalSpeed = 0; grounded = true;
  charge = 0; totalScore = 0; comboPoints = 0; comboCount = 0;
  message = 'Welcome to Lumbridge · roll out and find a line';
  trick: Trick | null = null;
  bailTime = 0; stumbleTime = 0; balance = 0; manual = false;
  grinding: { rail: Rail; t: number; direction: number } | null = null;
  animationTime = 0; landingTime = 0; pushing = false;
  pushTime = 0;
  pitch = 0;
  heightAboveGround=0;
  events: SkateEvent[] = [];
  private accumulator = 0; private airTime = 0; private airHeading = 0;
  private spin = 0; private stance = 0; private safe: Point;
  private relocate = false; private immunity = 0; private railCooldown = 0;
  private popBuffer = 0; private coyote = 0;
  private departedRail:string|null=null;
  private names: string[] = []; private used = new Set<string>();
  private pending = { flip: false, shove: false };

  constructor(private world: SkateWorld, spawn: Point) { this.position = { ...spawn }; this.safe = { ...spawn }; }
  get travelHeading() { return this.grounded ? this.heading + this.stance : this.airHeading; }
  get phase() {
    if (this.bailTime > 0) return this.bailTime > 0.45 ? 'bail' : 'recover';
    if (this.stumbleTime > 0) return 'stumble';
    if (this.grinding) return 'grind';
    if (this.manual) return 'manual';
    if (!this.grounded) return this.trick?.kind ?? (this.verticalSpeed > 0 ? 'pop' : 'air');
    if (this.charge > 0) return 'crouch';
    if (this.landingTime > 0) return 'land';
    return this.pushing ? 'push' : 'ride';
  }
  get landingCompression() { return Math.min(1,this.landingTime/0.24); }
  drainEvents() { const events = this.events; this.events = []; return events; }

  reset(position: Point, heading = this.heading) {
    this.position = { ...position }; this.safe = { ...position }; this.heading = heading;
    this.speed = this.verticalSpeed = this.charge = this.bailTime = this.stumbleTime = this.accumulator = 0;
    this.airTime = this.spin = this.stance = this.popBuffer = this.landingTime = this.pitch = 0;
    this.grounded = true; this.grinding = null; this.manual = false; this.balance = 0;
    this.pushTime = 0; this.pushing = false;
    this.departedRail=null;this.heightAboveGround=0;
    this.clearCombo(); this.pending = { flip: false, shove: false };
  }

  update(dt: number, input: SkateInput) {
    if (input.pop) this.popBuffer = 0.16;
    this.pending.flip ||= input.flip; this.pending.shove ||= input.shove;
    this.accumulator += Math.max(0, Math.min(dt, 0.1));
    while (this.accumulator >= FIXED_DT) {
      this.step(FIXED_DT, input); this.accumulator -= FIXED_DT;
      this.pending = { flip: false, shove: false };
    }
  }

  private step(dt: number, input: SkateInput) {
    this.animationTime += dt;
    this.pushTime = input.push && this.grounded && !this.manual ? this.pushTime + dt : 0;
    this.immunity = Math.max(0, this.immunity - dt);
    this.railCooldown = Math.max(0, this.railCooldown - dt);
    this.landingTime = Math.max(0, this.landingTime - dt);
    this.popBuffer = Math.max(0, this.popBuffer - dt);
    this.coyote = this.grounded ? 0.14 : Math.max(0, this.coyote - dt);
    this.pushing = false;
    if (this.bailTime > 0) {
      if (!this.relocate && !this.grounded) {
        this.verticalSpeed -= 14 * dt;
        const next = this.world.move(this.position, { x: 0, y: this.verticalSpeed * dt, z: 0 });
        this.position = { x: next.x, y: next.y, z: next.z };
        const floor = this.world.groundAt(next.x, next.z, next.y + 0.45);
        if (floor !== null && next.y <= floor + 0.06) { this.position.y = floor; this.grounded = true; this.verticalSpeed = 0; }
      }
      this.bailTime = Math.max(0, this.bailTime - dt);
      if (this.bailTime === 0) {
        const target = this.relocate ? this.safe : this.position;
        const remaining = this.accumulator;
        this.reset(target); this.accumulator = remaining; this.immunity = 1.25;
        this.message = 'Back on the board · keep your line';
      }
      return;
    }
    this.stumbleTime = Math.max(0, this.stumbleTime - dt);
    if (this.grinding) { this.stepGrind(dt, input); return; }

    if (this.grounded) {
      this.heading += input.steer * (this.manual ? 0.5 : 1.5 + Math.min(this.speed, 8) * 0.07) * dt;
      this.speed = Math.max(0, Math.min(9, this.speed + (input.push && !this.manual ? 5 : -0.55) * dt - (input.brake ? 12 * dt : 0)));
      this.pushing = input.push && !this.manual && this.speed < 8.8 && this.stumbleTime === 0;
      if (input.crouch) this.charge = Math.min(1, this.charge + dt / 0.65);
      if (input.manual && this.speed > 1.3 && !input.crouch) {
        if (!this.manual) { this.manual = true; this.balance = 0; this.addTrick('Manual', 100); }
        this.balance += (Math.sin(this.animationTime * 3.1) * 0.3 + 0.12 - input.steer * 1.2) * dt;
        this.comboPoints += 60 * dt;
        if (Math.abs(this.balance) > 1) { this.stumble('Manual lost · rebalance your weight'); return; }
      } else if (this.manual) { this.manual = false; this.bank(); }
    } else {
      const turn = input.steer * Math.PI * 1.5 * dt;
      this.heading += turn; this.spin += turn;
    }
    if (this.popBuffer > 0 && (this.grounded || this.coyote > 0) && this.stumbleTime === 0) this.jump();
    else if (!input.crouch) this.charge = 0;

    if (!this.grounded) {
      this.airTime += dt; this.verticalSpeed -= 14 * dt;
      if (this.pending.flip) this.startTrick('Kickflip', 300, 0.42, 'flip');
      if (this.pending.shove) this.startTrick('Pop shove-it', 200, 0.35, 'shove');
      if (this.trick) this.trick.elapsed = Math.min(this.trick.duration, this.trick.elapsed + dt);
      if (!input.brake && this.railCooldown === 0 && this.tryGrind(!!input.grind)) return;
    }
    const direction = this.travelHeading;
    const delta = { x: -Math.sin(direction) * this.speed * dt, y: this.grounded ? 0 : this.verticalSpeed * dt, z: -Math.cos(direction) * this.speed * dt };
    if (this.grounded) {
      if (this.world.canRideAt?.(this.position.x+delta.x,this.position.z+delta.z,this.position.y) === false) {
        delta.x = delta.z = 0; this.speed = 0; this.message = 'Water ahead · find a bridge';
      }
      const ground = this.supportAt(this.position.x + delta.x, this.position.z + delta.z, this.position.y);
      if (ground !== null && ground - this.position.y >= -0.42 && ground - this.position.y <= 0.45) delta.y = ground - this.position.y;
      else { this.grounded = false; this.airHeading = this.heading + this.stance; this.airTime = this.spin = 0; this.verticalSpeed = 0; }
    }
    const previous = this.position;
    const next = this.world.move(previous, delta);
    this.position = { x: next.x, y: next.y, z: next.z };
    const requestedDistance = this.speed * dt;
    const achievedDistance = -(next.x - previous.x) * Math.sin(direction) - (next.z - previous.z) * Math.cos(direction);
    if (next.blocked && (next.normal || requestedDistance - achievedDistance > 0.0001)) {
      const vx = -Math.sin(direction) * this.speed, vz = -Math.cos(direction) * this.speed;
      const nx = next.normal?.x ?? -vx / Math.max(this.speed, 0.001), nz = next.normal?.z ?? -vz / Math.max(this.speed, 0.001);
      const impact = next.normal ? Math.max(0, -(vx * nx + vz * nz)) : Math.max(0, (requestedDistance - achievedDistance) / dt);
      if (impact > 7.8 && this.immunity === 0) { this.bail('Hard impact · take a moment'); return; }
      const slideX = vx + nx * impact, slideZ = vz + nz * impact;
      this.speed = Math.hypot(slideX, slideZ) * (impact > 0.2 ? 0.97 : 1);
      if (this.speed > 0.2) {
        const travel = Math.atan2(-slideX, -slideZ);
        if (this.grounded) this.heading = travel - this.stance; else this.airHeading = travel;
      }
      if (impact > 1.5) this.message = 'Bumped · steer away and keep rolling';
    }
    const ground = this.supportAt(next.x, next.z, Math.max(previous.y, next.y));
    this.heightAboveGround=ground===null?2:Math.max(0,this.position.y-ground);
    if (!this.grounded && this.verticalSpeed <= 0 && ground !== null && next.y <= ground + 0.05) {
      this.position.y = ground; this.grounded = true;
      this.departedRail=null;
      if (this.world.canRideAt?.(next.x,next.z,ground) === false) { this.bail('Water landing · returning to dry ground', true); return; }
      const fallSpeed = this.verticalSpeed; this.verticalSpeed = 0;
      const alignment = Math.abs(Math.sin(this.heading - this.airHeading));
      if (fallSpeed < -14) { this.bail('Heavy landing · catch your breath'); return; }
      if ((this.trick && this.trick.elapsed + 0.06 < this.trick.duration) || (this.speed > 2 && alignment > 0.94)) this.stumble('Sketchy landing · combo lost');
      else this.land(!!input.manual);
    } else if (!this.grounded && delta.y > 0 && next.y < previous.y + delta.y - 0.005) this.verticalSpeed = 0;
    if (this.position.y < -20 || this.airTime > 6) { this.bail('Out of bounds · returning to solid ground', true); return; }
    if (this.grounded && !next.blocked) this.safe = { ...this.position };
    if (this.grounded) {
      const dx = -Math.sin(this.travelHeading)*0.25, dz = -Math.cos(this.travelHeading)*0.25;
      const front = this.world.groundAt(this.position.x+dx,this.position.z+dz,this.position.y+0.6);
      const back = this.world.groundAt(this.position.x-dx,this.position.z-dz,this.position.y+0.6);
      const pitch = front !== null && back !== null ? Math.atan2(front-back,0.5) : 0;
      this.pitch += (Math.max(-0.45,Math.min(0.45,pitch))-this.pitch)*Math.min(1,dt*16);
    } else this.pitch *= 0.9;
  }

  private supportAt(x: number, z: number, y: number) {
    let best = this.world.groundAt(x, z, y + 0.46);
    for (const [dx, dz] of [[0.16, 0], [-0.16, 0], [0, 0.16], [0, -0.16]]) {
      const ground = this.world.groundAt(x + dx, z + dz, y + 0.46);
      if (ground !== null && (best === null || ground > best)) best = ground;
    }
    return best;
  }
  private jump() {
    this.verticalSpeed = 4.3 + this.charge * 2; this.grounded = false; this.manual = false;
    this.airTime = this.spin = 0; this.airHeading = this.heading + this.stance;
    this.popBuffer = this.coyote = 0; this.charge = 0;
    this.addTrick('Ollie', 100);
  }
  private addTrick(name: string, points: number) {
    this.comboPoints += points; this.comboCount++; this.names.push(name); this.message = this.names.join(' + ');
    this.events.push({ type: 'trick', score: 0, names: [name], combo: this.comboCount });
  }
  private startTrick(name: string, points: number, duration: number, kind: Trick['kind']) {
    if (this.used.has(name) || (this.trick && this.trick.elapsed < this.trick.duration)) return;
    this.used.add(name); this.trick = { name, duration, elapsed: 0, kind }; this.addTrick(name, points);
  }
  private land(linkManual: boolean) {
    this.stance = Math.cos(this.heading - this.airHeading) < 0 ? Math.PI : 0;
    const turns = Math.floor((Math.abs(this.spin) + 0.25) / Math.PI);
    if (turns > 0 && this.comboCount) this.addTrick(`${turns * 180}°`, turns * 180);
    this.landingTime = 0.24; this.airTime = 0; this.trick = null; this.used.clear();
    if (!linkManual || this.speed < 1.3) this.bank();
  }
  private bank() {
    if (this.comboCount) {
      const score = Math.round(this.comboPoints) * this.comboCount;
      this.totalScore += score; this.message = `${this.names.join(' + ')} · +${score.toLocaleString()}`;
      this.events.push({ type: 'land', score, names: [...this.names], combo: this.comboCount });
    }
    this.clearCombo();
  }
  private stumble(reason: string) {
    this.speed *= 0.65; this.stumbleTime = 0.35; this.manual = false; this.message = reason;
    this.airTime = 0; this.clearCombo();
    this.events.push({ type: 'bail', score: 0, names: ['stumble'], combo: 0 });
  }
  private bail(reason: string, relocate = false) {
    this.speed = 0; this.bailTime = 1.05; this.relocate = relocate;
    this.message = reason; this.manual = false; this.grinding = null; this.clearCombo();
    this.events.push({ type: 'bail', score: 0, names: [], combo: 0 });
  }
  private clearCombo() { this.comboPoints = this.comboCount = 0; this.trick = null; this.names = []; this.used.clear(); }

  private tryGrind(assisted:boolean) {
    if (this.speed < 0.8 || this.verticalSpeed > (assisted?1:0)) return false;
    if(this.trick&&this.trick.elapsed+0.05<this.trick.duration)return false;
    for (const rail of this.world.rails ?? []) {
      if(rail.id===this.departedRail)continue;
      const dx = rail.b.x - rail.a.x, dz = rail.b.z - rail.a.z, lengthSq = dx * dx + dz * dz;
      if (!lengthSq) continue;
      const t = ((this.position.x - rail.a.x) * dx + (this.position.z - rail.a.z) * dz) / lengthSq;
      if (t < 0 || t > 1) continue;
      const x = rail.a.x + dx * t, z = rail.a.z + dz * t, y = rail.a.y + (rail.b.y - rail.a.y) * t;
      const catchWidth=assisted?0.48:(rail.width??0.08)/2+0.2;
      if (Math.hypot(x - this.position.x, z - this.position.z) > catchWidth || this.position.y<y-0.04 || this.position.y-y>(assisted?0.34:0.22)) continue;
      const dot = (-Math.sin(this.airHeading) * dx - Math.cos(this.airHeading) * dz) / Math.sqrt(lengthSq);
      this.grinding = { rail, t, direction: dot<0?-1:1 }; this.balance = 0; this.verticalSpeed = 0;
      this.speed=Math.max(1,this.speed*Math.max(0.55,Math.abs(dot)));
      this.position={x,y,z};this.heading=Math.atan2(-dx*this.grinding.direction,-dz*this.grinding.direction);this.airHeading=this.heading;this.stance=0;
      this.trick = null; this.addTrick('50-50 grind', 250);
      this.events.push({ type: 'grind', score: 0, names: [rail.name], combo: this.comboCount });
      return true;
    }
    return false;
  }
  private stepGrind(dt: number, input: SkateInput) {
    const grind = this.grinding!, rail = grind.rail;
    const dx = rail.b.x - rail.a.x, dz = rail.b.z - rail.a.z, length = Math.hypot(dx, dz);
    grind.t += grind.direction * this.speed * dt / length;
    this.speed = Math.max(1, this.speed - 0.35 * dt);
    this.balance += (Math.sin(this.animationTime * 3) * 0.28 + 0.14 - input.steer * 1.2) * dt;
    this.comboPoints += 120 * dt;
    const t = Math.max(0, Math.min(1, grind.t));
    this.position = { x: rail.a.x + dx * t, y: rail.a.y + (rail.b.y - rail.a.y) * t, z: rail.a.z + dz * t };
    this.heading = Math.atan2(-dx * grind.direction, -dz * grind.direction); this.stance = 0; this.airHeading = this.heading;
    if ((grind.t<0||grind.t>1)&&!input.brake&&this.popBuffer===0&&Math.abs(this.balance)<=1&&this.connectGrind(grind))return;
    if (Math.abs(this.balance) > 1 || input.brake || grind.t < 0 || grind.t > 1 || this.popBuffer > 0) {
      const pop = this.popBuffer > 0;
      this.departedRail=rail.id;
      this.grinding = null; this.railCooldown = 0.35; this.airTime = this.spin = 0;
      this.verticalSpeed = pop ? 4.8 : 0; this.popBuffer = 0;
      if(input.brake) {
        const side=input.steer<0?-1:1,offset=(rail.width??0.08)/2+0.30;
        const next=this.world.move(this.position,{x:-dz/length*offset*side,y:0,z:dx/length*offset*side});
        this.position={x:next.x,y:next.y,z:next.z};
      } else if(!pop&&(grind.t<0||grind.t>1)) {
        // Rolled off the end: clear the rail's own top so the landing check doesn't catch it.
        const clear=0.25*grind.direction;
        const next=this.world.move(this.position,{x:dx/length*clear,y:0,z:dz/length*clear});
        this.position={x:next.x,y:next.y,z:next.z};
      }
      if(Math.abs(this.balance)>1)this.stumble('Lost grind balance · combo lost');
      if (pop) this.addTrick('Ollie out', 100);
    }
  }
  private connectGrind(current:NonNullable<Skater['grinding']>) {
    const end=current.direction>0?current.rail.b:current.rail.a;
    const dx=current.rail.b.x-current.rail.a.x,dz=current.rail.b.z-current.rail.a.z,length=Math.hypot(dx,dz);
    let best:{rail:Rail;direction:number;score:number}|null=null;
    for(const rail of this.world.rails??[]) {
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
