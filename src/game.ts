import * as THREE from 'three';
import { cfg } from './config';
import { initPhysics, PhysicsWorld } from './physics/world';
import { type Arena } from './physics/arena';
import { type Spawn } from './core/arenaLayout';
import { Ball } from './physics/ball';
import { Car } from './physics/car';
import { BoostPads } from './physics/boostPads';
import { Simulation, type SimCar } from './sim/simulation';
import { NetClient } from './net/client';
import { TouchSource } from './input/touch';
import { takeScreen } from './ui/fullscreen';
import type { BlindSide } from './state/blindSide';
import { MODIFIERS } from './state/modifiers';
import { BOSSES } from './state/bosses';
import { UPGRADES } from './state/upgrades';
import { CLOSE, type RoundMessage, type RunMessage } from './server/protocol';
import { normaliseCode } from './server/roomCode';
import { configuredServer } from './net/serverAddress';
import type { MatchPhase } from './state/match';
import { Controls } from './input/controls';
import { emptyInput, type CarInput } from './input/types';
import { Bot, type BotRole } from './ai/bot';
import {
  createRenderer,
  buildArenaMesh,
  disposeArenaMesh,
  captureArenaEnvironment,
  type Renderer,
} from './render/scene';
import { buildStadium, type Stadium } from './render/stadium';
import { loadAssets, EMPTY_ASSETS, type GameAssets } from './render/assets';
import { GoalMoment } from './render/goalMoment';
import { Ribbon } from './render/ribbon';
import { Replay } from './render/replay';
import { clamp } from './core/mathx';
import { buildArenaLayout } from './core/arenaLayout';
import {
  createCarMesh,
  createBallMesh,
  createBoostPadVisuals,
  disposeCarMesh,
  type PadVisuals,
} from './render/entities';
import { ChaseCamera } from './render/chaseCamera';
import { TransformInterpolator } from './core/interpolate';
import { Loop } from './core/loop';
import { Hud } from './ui/hud';
import { Radar } from './ui/radar';
import { MatchHud } from './ui/matchHud';
import { TweakPanel } from './ui/tweakPanel';
import { Match, formatClock, type GoalEvent, type MatchResult } from './state/match';
import { Run, type RunSummary } from './state/run';
import { buildRound, type RoundSpec, type RoundOpponent } from './state/round';
import { ConfigOverrides } from './state/configOverride';
import { needsArenaRebuild } from './state/modifiers';
import { applyUpgrades, type Upgrade } from './state/upgrades';
import { resetModifiers } from './physics/car';
import { RunHud } from './ui/runHud';
import { ReplayHud } from './ui/replayHud';
import { Shell, type Screen } from './ui/shell';
import { Particles } from './render/particles';
import { Sound } from './audio/sound';

/**
 * Wires the systems together: physics, rendering, input, AI, match flow, run.
 *
 * Stage 4: a gauntlet run. Each round builds its own match rules, opponent set
 * and modifiers from a RoundSpec; losing one ends the run. Upgrades between
 * rounds are step 5, so for now a cleared round pauses briefly and carries on.
 */

/** Everything that belongs to one car on the pitch. */
interface CarEntry {
  car: Car;
  mesh: THREE.Group;
  interp: TransformInterpolator;
  flame: THREE.Mesh;
  /** The streak that appears as the car approaches supersonic. */
  streak: Ribbon;
  /** Tracks the crossing, so the shock ring fires once rather than per frame. */
  wasSupersonic: boolean;
  /** Null for the player. */
  bot: Bot | null;
  spawn: Spawn;
}

/** Centre first, then wide, then the inside pair. */

const TEAM_COLOUR = { 0: 0x4fc3f7, 1: 0xff7043 } as const;

const IMPACT_COLOUR = new THREE.Color(0xfff2d0);
const GOAL_COLOUR_BLUE = new THREE.Color(0x7fd4ff);
const GOAL_COLOUR_ORANGE = new THREE.Color(0xffa070);
const TRAIL_COLOUR_BLUE = new THREE.Color(0xffc14d);
const TRAIL_COLOUR_ORANGE = new THREE.Color(0xff8a50);

/** How long the upgrade picker ignores keys and buttons after it opens. */
const PICKER_GRACE_MS = 600;

/** `?quality=low` or `?quality=high` on the address, to force the graphics either way. */
function qualityAsked(): 'low' | 'high' | null {
  const q = new URLSearchParams(location.search).get('quality');
  return q === 'low' || q === 'high' ? q : null;
}

/** Menu items that put the player on the pitch, where a phone goes fullscreen. */
const PLAY_ITEMS = new Set(['start', 'again', 'freeplay', 'resume', 'restart']);

/** A server URL without its query, for showing to a person. */
function serverLabel(url: string): string {
  return url.split('?')[0] ?? url;
}

export class Game {
  /**
   * The game itself, with nothing attached to it.
   *
   * Everything below is presentation hanging off it. The accessors are there so
   * the hundred-odd places that say `this.ball` keep saying `this.ball` — the
   * point of this split is that there is one simulation, not that every call
   * site learns a new path to it.
   */
  private readonly sim: Simulation;
  private get phys(): PhysicsWorld {
    return this.sim.phys;
  }
  private get arena(): Arena {
    return this.sim.arena;
  }
  private arenaMesh: THREE.Group;
  /**
   * The building around the pitch. Built once: a round modifier can change the
   * goals, which rebuilds the arena, but it never changes the stands.
   */
  private readonly stadium: Stadium;
  /** Bloom off, a smaller shadow map and a thinner crowd; see enterLowPower. */
  private lowPower = false;
  /** Optional art files; empty unless something was dropped in public/assets. */
  private readonly assets: GameAssets;
  /** The goal celebration, which also owns the slow motion. */
  private readonly goalMoment: GoalMoment;
  /** The ball's trail. */
  private readonly ballTrail: Ribbon;
  /** Goal replays, and the countdown to one starting. */
  private readonly replay = new Replay();
  private replayPending = -1;
  /** Last frame's time scale, so the slow-motion sweep fires on the edge. */
  private lastTimeScale = 1;
  /** Last frame's boost, so spending can be measured from the tank. */
  private lastBoost = cfg.boost.start;
  /** The ring thrown off when a car crosses into supersonic. */
  private readonly sonicRing: THREE.Mesh;
  private readonly sonicRingMaterial: THREE.MeshBasicMaterial;
  private sonicRingClock = 0;
  private get ball(): Ball {
    return this.sim.ball;
  }
  private get pads(): BoostPads {
    return this.sim.pads;
  }

  private readonly entries: CarEntry[] = [];
  /**
   * The input handed to the simulation, keyed by car index.
   *
   * Reused rather than rebuilt each step, and holding exactly one entry today.
   * It is a map because that is the shape a networked build needs: several
   * people's input arriving for several cars.
   */
  private readonly playerInput = new Map<number, CarInput>();
  /**
   * Set when this game is a client of a server rather than its own authority.
   *
   * Solo play is unchanged: the game owns its run and steps its own
   * simulation. Joined to a server, the same simulation becomes a prediction
   * and the run arrives over the wire. Everything between those two — the
   * renderer, the HUD, the camera, the car — does not know the difference,
   * which is the point of having moved the simulation out in the first place.
   */
  private net: NetClient | null = null;
  /** The upgrade card a pad or the arrows would take. */
  private pickerIndex = 0;
  /** When the picker opened, for the grace period. */
  private pickerOpenedAt = -1;
  /** True online when someone else is the one choosing. */
  private pickerLocked = false;
  /** Whether the car list has been rebuilt from the server's yet. */
  private remoteCarsBuilt = false;
  /** The round's tuning when a server is dictating it. */
  private readonly remoteConfig = new ConfigOverrides();
  /** Index 0 is always the player. */
  private get player(): CarEntry {
    // Online, ours is whichever seat the server gave us. It used to be car 0
    // regardless, so the second person into a room had the first person's
    // camera and the first person's boost and speed on their HUD.
    const seat = this.net?.carIndex;
    if (seat != null && this.entries[seat]) return this.entries[seat];
    return this.entries[0]!;
  }
  /** Collider handle to entry, for attributing ball contacts. */

  private readonly render: Renderer;
  private readonly chase: ChaseCamera;
  private readonly ballMesh: THREE.Mesh;
  private readonly padVisuals: PadVisuals;
  private readonly ballInterp: TransformInterpolator;

  private readonly controls: Controls;
  private readonly touch: TouchSource;
  private readonly hud: Hud;
  private readonly radar: Radar;
  private readonly matchHud: MatchHud;
  private readonly runHud: RunHud;
  private readonly replayHud: ReplayHud;
  private readonly shell: Shell;
  private readonly particles = new Particles();
  private readonly sound = new Sound();
  private readonly panel: TweakPanel;
  private readonly loop: Loop;

  private get match(): Match {
    return this.sim.match;
  }
  private run: Run;
  /** Set to make a run's modifier picks repeatable; see restartRun. */
  private runSeed: number | null = null;
  /** Which screen the player is looking at. */
  private screen: Screen = 'title';
  /** True while free play is running instead of a gauntlet round. */
  private freePlay = false;
  /** Last countdown number announced, so the beep fires once per number. */
  private lastCountdownBeep = -1;
  /** Tracks supersonic, so the whoosh fires on crossing rather than per frame. */
  private wasSupersonic = false;
  /** Clock for the slow orbit behind the menus. */
  private menuShotTime = 0;
  /** What the title screen last said about a pad, so it can be refreshed. */
  private titleShowedPad = false;
  /** Round modifiers. Reverted and re-applied every round. */
  private readonly roundOverrides = new ConfigOverrides();
  /**
   * Run upgrades that change the world rather than just the player's car.
   * A separate layer so it can sit on top of the round's modifiers and be
   * rebuilt in a fixed order.
   */
  private readonly runOverrides = new ConfigOverrides();
  /** Stands in for the keyboard while `advance()` drives the game. */
  private inputOverride: Partial<CarInput> | null = null;
  private time = 0;
  private readonly scratch = new THREE.Vector3();

  private readonly ui: HTMLElement;

  private constructor(
    ui: HTMLElement,
    render: Renderer,
    assets: GameAssets = EMPTY_ASSETS,
  ) {
    this.ui = ui;
    this.assets = assets;
    this.sim = new Simulation();

    this.render = render;
    this.arenaMesh = buildArenaMesh();
    this.render.scene.add(this.arenaMesh);
    this.stadium = buildStadium(buildArenaLayout());
    this.render.scene.add(this.stadium.group);
    // A phone or tablet starts in low power rather than discovering it: the
    // adaptive resolution takes twenty seconds of bad frames to reach its
    // floor, which is the first twenty seconds anyone sees of the game.
    const quality = qualityAsked();
    const touchscreen = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    if (quality === 'low' || (touchscreen && quality !== 'high')) {
      this.enterLowPower(quality === 'low' ? 'asked for on the address' : 'touchscreen device');
    }

    // Reflections, from the arena itself. Taken here because the building is
    // in the scene and no car or ball is yet: those move, and baking one in
    // would smear a stale car across every reflective surface in the game.
    //
    // A supplied radiance map wins if there is one, but there rarely is, and
    // the arena's own reflections beat a photograph of a different building.
    const captured = captureArenaEnvironment(this.render, cfg.render.envCaptureHeight);
    const environment = assets.environment ?? captured;
    if (environment) this.render.scene.environment = environment;
    this.chase = new ChaseCamera(this.render.camera);
    this.ballMesh = createBallMesh();
    this.padVisuals = createBoostPadVisuals(this.pads.pads);
    this.render.scene.add(this.ballMesh, this.padVisuals.group, this.particles.points);
    this.ballInterp = new TransformInterpolator(this.ballMesh);
    this.ballInterp.snap(this.ball.position, this.ball.body.rotation());

    this.addCar(0, 0, null);

    this.controls = new Controls();
    this.touch = new TouchSource(ui);
    this.controls.attachTouch(this.touch);
    this.hud = new Hud(ui);
    this.radar = new Radar(ui);
    this.matchHud = new MatchHud(ui);
    this.runHud = new RunHud(ui);
    this.runHud.onPick = (index) => this.takeUpgrade(index);
    this.replayHud = new ReplayHud(ui);
    this.shell = new Shell(ui);
    this.shell.onChoose = (id) => {
      // A click is a user gesture, which is what an AudioContext needs. Only a
      // key press unlocked it before, so someone who only used the mouse never
      // heard anything.
      this.sound.unlock();
      this.sound.menuSelect();
      // Also a gesture, which fullscreen needs as much as audio does.
      if (this.touch.active && PLAY_ITEMS.has(id)) takeScreen();
      this.choose(id);
    };
    this.shell.onlineAvailable = configuredServer() !== null;
    this.panel = new TweakPanel(ui);
    this.panel.onChange(() => this.syncConfig());

    this.run = this.makeRun();
    this.runHud.showBest(this.run.best);
    // The game opens on the title screen rather than mid-round: a run should
    // start because the player asked for one.
    // Before the first round is applied: applying a round sets up a kickoff,
    // which clears the trails, and a kickoff that runs before they exist takes
    // the whole game down on boot.
    this.ballTrail = new Ribbon({
      segments: cfg.trails.ballSegments,
      width: cfg.trails.ballWidth,
      colour: new THREE.Color(0x9fd8ff),
      sampleInterval: cfg.trails.sampleInterval,
      teleport: cfg.trails.teleport,
    });
    this.render.scene.add(this.ballTrail.mesh);

    this.sonicRingMaterial = new THREE.MeshBasicMaterial({
      color: 0xdff1ff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.sonicRing = new THREE.Mesh(new THREE.RingGeometry(0.76, 1, 40), this.sonicRingMaterial);
    this.sonicRing.visible = false;
    this.render.scene.add(this.sonicRing);


    this.applyRound(buildRound(1, Math.random));
    // One poll before the title screen is drawn, so a pad that is already
    // connected is reported as such instead of only after the first frame.
    this.controls.poll();
    this.shell.showTitle(this.run.best, this.sound.muted, this.controls.padConnected);
    this.syncHudVisibility();
    this.chase.snapTo(this.player.car.position, this.player.car.forward());

    this.goalMoment = new GoalMoment({
      scene: this.render.scene,
      particles: this.particles,
      stadium: this.stadium,
    });
    this.goalMoment.setArena(this.arenaMesh);

    this.loop = new Loop(
      { fixed: (dt) => this.fixedStep(dt), render: (dt, alpha) => this.renderFrame(dt, alpha) },
      () => cfg.physics.fixedDt,
      () => cfg.physics.maxStepsPerFrame,
      () => this.goalMoment.timeScale,
    );

    window.addEventListener('config:hot', () => this.syncConfig());
  }

  static async create(
    canvas: HTMLCanvasElement,
    ui: HTMLElement,
    serverUrl?: string,
  ): Promise<Game> {
    await initPhysics();
    // The renderer is needed to prefilter a radiance map, and nothing can be
    // built before the physics is up, so assets load between the two. Missing
    // files are the normal case and are not an error: see render/assets.ts.
    const probe = createRenderer(canvas);
    const assets = await loadAssets(probe.renderer);
    const game = new Game(ui, probe, assets);
    await game.warmUp();
    if (serverUrl) game.join(serverUrl);
    return game;
  }

  /**
   * Sheds the work a phone cannot afford, once and for the rest of the visit.
   *
   * One way only. Coming back out when frames recover would flip the crowd
   * and the glow on and off as the load changed, which looks worse than
   * either setting held still.
   */
  private enterLowPower(reason: string): void {
    if (this.lowPower) return;
    this.lowPower = true;
    this.render.setLowPower();
    this.stadium.thinCrowd(cfg.render.lowPower.crowdKeep);
    console.info(`[lighttown] low-power mode: ${reason}`);
  }

  /**
   * Compiles every shader the scene uses, while the loading screen is up.
   *
   * three.js otherwise compiles a material's shader the first time it is drawn,
   * so the first frame of the title screen compiled 25 of them at once: a
   * quarter-second freeze on a fast laptop, and seconds on a phone. Compiled
   * here, the work happens before anything is on screen, and in parallel
   * where the browser can. The frame drawn after it does the same for the
   * post-processing passes, which are not in the scene.
   */
  private async warmUp(): Promise<void> {
    await this.render.compile();
    this.render.draw();
  }

  start(): void {
    this.loop.start();
  }

  // --- joining a server ----------------------------------------------------

  /**
   * Hands authority over the run to a server.
   *
   * Solo, this game decides what happens and the screen shows it. Joined, the
   * server decides and this game predicts: the same simulation, stepped on the
   * same input, corrected whenever the server's answer arrives. The HUD, the
   * camera and the car are told nothing about which of the two is happening.
   */
  private join(url: string): void {
    const net = new NetClient(url);
    this.net = net;
    net.onRound = (round) => this.applyRemoteRound(round);
    net.onRun = (run) => this.applyRemoteRun(run);
    // The celebration, the sound and the replay all hang off a goal the server
    // counted. Left to the local match they never fired at all in a joined
    // game: that match is not being played here, so it never sees one.
    net.onGoal = (goal) =>
      this.onGoal({
        team: goal.team,
        ownGoal: goal.ownGoal,
        score: goal.score,
        decisive: false,
      });
    net.onKickoff = () => this.setUpKickoff();
    net.onRefused = (code) => this.onRefused(code);
    net.onDropped = () =>
      this.shell.showMessage(
        'Connection lost',
        'The server stopped answering. The room is kept for a minute if you go back in.',
      );

    this.screen = 'online';
    this.shell.showConnecting(serverLabel(url));
    net.connect(() => {
      // Straight into play: a server decides when a round starts, so there is
      // nothing for a title screen to offer.
      this.screen = 'playing';
      this.freePlay = false;
      this.shell.hide();
      this.syncHudVisibility();

      const room = net.room;
      if (room) {
        // The address bar becomes the invitation. It also has to stop saying
        // `room=new`, or reloading the page would open a second room rather
        // than going back into this one.
        const params = new URLSearchParams(location.search);
        params.set('room', room);
        history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
        this.hud.showRoom(room, net.recording);
      }
    });
  }

  /** Says why the server turned us away, in terms of what to do about it. */
  private onRefused(code: number): void {
    const asked = new URLSearchParams(location.search).get('room') ?? '';
    if (code === CLOSE.NO_SUCH_ROOM) {
      this.shell.showMessage(
        'No such room',
        `Nothing is running under "${asked.toUpperCase()}". Rooms close a minute after everyone leaves.`,
      );
    } else if (code === CLOSE.ROOM_FULL) {
      this.shell.showMessage('Room full', 'Both seats in that room are taken.');
    } else if (code === CLOSE.SERVER_FULL) {
      this.shell.showMessage('Server busy', 'There is no space for another room right now. Try again shortly.');
    } else {
      this.shell.showMessage(
        'Could not connect',
        `Nothing answered at ${serverLabel(this.net?.url ?? '')}. Is the server running?`,
      );
    }
  }

  /**
   * Goes online by reloading into it.
   *
   * A page load rather than a switch in place: joined and solo differ in who
   * owns the run, the config, the car count and the arena, and unwinding all of
   * that live is a lot of code to get exactly right for no gain. The load also
   * leaves a URL in the address bar that is the invitation.
   */
  private goOnline(room: string): void {
    const params = new URLSearchParams(location.search);
    const server = configuredServer();
    // The menu only offers this when there is a server, so this is a guard
    // against being called some other way, not an expected path.
    if (!server) return;
    // Only the room goes on the address. The server is found the same way
    // again after the reload -- from the page's own `?server` if it had one,
    // or the build's -- and leaving it off keeps the invitation short.
    params.set('room', room);
    location.search = params.toString();
  }

  /** Back to solo, the same way. */
  private leaveOnline(): void {
    this.net?.disconnect();
    location.href = location.pathname;
  }

  /** The server's round: its tuning, its arena, its label. */
  private applyRemoteRound(round: RoundMessage): void {

    this.remoteConfig.revert();
    this.remoteConfig.apply(round.config);

    if (round.rebuildArena) this.rebuildArena();
    this.sim.syncConfig();

    // Rebuilt from ids rather than sent whole: modifiers carry functions, which
    // JSON cannot hold, and the client must not run them in any case — the
    // config above already says what they did.
    const modifiers = round.modifierIds
      .map((id) => MODIFIERS.find((m) => m.id === id))
      .filter((m): m is (typeof MODIFIERS)[number] => m !== undefined);
    const boss = round.bossId ? (BOSSES.find((b) => b.id === round.bossId) ?? null) : null;
    const spec = {
      index: round.index,
      isBoss: round.isBoss,
      boss,
      lineup: [],
      tier: round.tier,
      opponents: round.opponents,
      modifiers,
      rules: round.rules,
      label: round.label,
      // Never sent: the bots that need it are on the server, and anything on
      // the wire is something a curious player can read.
      blindSide: null,
    };

    this.run.spec = spec;
    this.run.phase = 'round';
    this.runHud.roundStart(spec);
    this.matchHud.reset();
    this.setUpKickoff();
  }

  /**
   * Builds cars until there are as many here as the server is describing.
   *
   * The count is the server's to decide — it created them — so this follows
   * rather than assumes. Teams are taken from the seat count the server was
   * started with, which is the one thing a client still has to be told.
   */
  private matchRemoteCars(teams: readonly (0 | 1)[]): void {
    if (teams.length === 0) return;

    // The first time, throw away every car the solo setup made. They include
    // a bot with its own brain, which went on driving one of the server's cars
    // between snapshots -- usually the other human's -- so it was dragged back
    // into place thirty times a second.
    let keep = this.remoteCarsBuilt ? this.entries.length : 0;
    // After that, keep each car only while it is still the team the server
    // says it is. Teams do not change per index in practice, because humans
    // are seated first and bots after; this is what keeps it true if that
    // ever stops being so.
    for (let i = 0; i < keep && i < teams.length; i++) {
      if (this.entries[i]!.car.team !== teams[i]) {
        keep = i;
        break;
      }
    }
    // Rounds with fewer bots than the last: surplus cars go too. They used to
    // be left where they were, frozen on the pitch, because nothing described
    // them any more and nothing removed them either.
    keep = Math.min(keep, teams.length);
    while (this.entries.length > keep) this.dropLastCar();

    const seat = this.net?.carIndex;
    const perTeam = [0, 0];
    for (let i = 0; i < this.entries.length; i++) perTeam[this.entries[i]!.car.team]!++;
    for (let i = this.entries.length; i < teams.length; i++) {
      const team = teams[i]!;
      this.dressCar(this.sim.addCar(team, perTeam[team]!++, null), i === seat);
    }

    if (!this.remoteCarsBuilt) {
      this.remoteCarsBuilt = true;
      this.chase.snapTo(this.player.car.position, this.player.car.forward());
    }
  }

  /** Removes the last car, simulated and visible, keeping the lists aligned. */
  private dropLastCar(): void {
    const entry = this.entries.pop();
    if (!entry) return;
    this.sim.removeLastCar();
    this.releaseCar(entry);
  }

  /** The server's run state, mirrored into the one the HUD already reads. */
  private applyRemoteRun(message: RunMessage): void {
    const run = this.run;
    const byId = (id: string): (typeof UPGRADES)[number] | undefined =>
      UPGRADES.find((u) => u.id === id);

    run.phase = message.phase;
    run.offer = message.offer.map(byId).filter((u): u is (typeof UPGRADES)[number] => !!u);
    run.upgrades.length = 0;
    for (const id of message.taken) {
      const upgrade = byId(id);
      if (upgrade) run.upgrades.push(upgrade);
    }
    run.stats.roundsCleared = message.roundsCleared;
    run.stats.goalsFor = message.goalsFor;
    run.stats.goalsAgainst = message.goalsAgainst;
    this.runHud.showOwned(run.upgrades);

    if (message.phase === 'between' && run.offer.length > 0) {
      // Only one person picks. Everyone else is told who, rather than being
      // shown cards that do nothing when pressed -- which reads as stuck.
      const mine = message.chooser !== null && message.chooser === this.net?.clientId;
      this.openPicker(run.spec ?? this.run.spec!, run.offer, mine ? null : 'Your teammate');
    }
  }

  // --- setup -------------------------------------------------------------

  /** Adds a car. `botLevel` null makes it the player's. */
  private addCar(
    team: 0 | 1,
    slot: number,
    botLevel: number | null,
    role: BotRole = 'balanced',
  ): CarEntry {
    const sim = this.sim.addCar(team, slot, botLevel, role);
    return this.dressCar(sim, botLevel === null);
  }

  /**
   * Builds everything visible that belongs to a simulated car.
   *
   * Separate from `addCar` because the opposition is created by the
   * simulation when a round's lineup changes, and those cars need dressing too.
   */
  private dressCar(sim: SimCar, isPlayer: boolean): CarEntry {
    const car = sim.car;
    const mesh = this.assets.carModel
      ? (this.assets.carModel.clone(true) as THREE.Group)
      : createCarMesh(TEAM_COLOUR[car.team]);
    this.render.scene.add(mesh);

    const streak = new Ribbon({
      segments: cfg.trails.carSegments,
      width: cfg.trails.carWidth,
      colour: new THREE.Color(isPlayer ? 0xcfe9ff : 0xffd2b0),
      sampleInterval: cfg.trails.sampleInterval,
      teleport: cfg.trails.teleport,
    });
    this.render.scene.add(streak.mesh);

    const entry: CarEntry = {
      car,
      mesh,
      streak,
      wasSupersonic: false,
      interp: new TransformInterpolator(mesh),
      flame: mesh.getObjectByName('flame') as THREE.Mesh,
      bot: sim.bot,
      spawn: sim.spawn,
    };
    entry.interp.snap(car.position, car.body.rotation());
    this.entries.push(entry);
    return entry;
  }

  /**
   * Sets the world up for a round: modifiers, arena, opponents, match rules.
   *
   * Modifiers are reverted first, so a round always builds on the config the
   * file shipped with rather than on whatever the last round left behind.
   */
  private applyRound(spec: RoundSpec): void {
    // Unwound in the reverse of the order it was applied, so each layer puts
    // back exactly what it found.
    this.runOverrides.revert();
    this.roundOverrides.revert();

    for (const mod of spec.modifiers) mod.apply(this.roundOverrides);

    // Upgrades go on top of the round's modifiers, and are rebuilt from
    // standard every round: applying them incrementally would compound an
    // upgrade the player only took once.
    resetModifiers(this.player.car.mods);
    applyUpgrades(this.run.upgrades, {
      mods: this.player.car.mods,
      overrides: this.runOverrides,
    });

    // Goal dimensions are baked into colliders and meshes, so those modifiers
    // need the arena rebuilt rather than a value written.
    if (needsArenaRebuild(spec.modifiers) || this.rebuiltArena) {
      this.rebuildArena();
      this.rebuiltArena = needsArenaRebuild(spec.modifiers);
    }

    this.setOpponents(spec.lineup, spec.blindSide);
    this.syncConfig();
    this.runHud.showOwned(this.run.upgrades);

    this.sim.startMatch(spec.rules, {
      onGoal: (e) => this.onGoal(e),
      onKickoff: () => this.setUpKickoff(),
      onEnd: (r) => this.onMatchEnd(r),
    });
    this.matchHud.reset();
    this.runHud.roundStart(spec);
    this.setUpKickoff();
  }

  /** True while the arena is built at non-default dimensions. */
  private rebuiltArena = false;

  private rebuildArena(): void {
    this.sim.rebuildArena();
    this.render.scene.remove(this.arenaMesh);
    disposeArenaMesh(this.arenaMesh);
    this.arenaMesh = buildArenaMesh();
    this.render.scene.add(this.arenaMesh);
    this.goalMoment.setArena(this.arenaMesh);
  }

  /**
   * Matches the opposition to the round's lineup.
   *
   * The simulation decides who exists; this adds and removes the visible part
   * to match. The two lists stay index-aligned because the simulation only ever
   * appends and pops, and `dressCar` appends in the same order.
   */
  private setOpponents(lineup: readonly RoundOpponent[], blindSide: BlindSide | null = null): void {
    const { added, removed } = this.sim.setOpponents(lineup, blindSide);
    for (const sim of added) this.dressCar(sim, false);
    for (let i = 0; i < removed.length; i++) {
      const entry = this.entries.pop();
      if (!entry) break;
      this.releaseCar(entry);
    }
  }

  /** Takes a car's visuals off the pitch and frees them. */
  private releaseCar(entry: CarEntry): void {
    this.render.scene.remove(entry.mesh);
    this.render.scene.remove(entry.streak.mesh);
    entry.streak.dispose();
    // A car cloned from a loaded model shares its buffers with the model and
    // with every other car, so only a car built here owns anything to free.
    if (!this.assets.carModel) disposeCarMesh(entry.mesh);
  }

  private onGoal(event: GoalEvent): void {
    this.matchHud.goal(event);
    const forPlayer = event.team === 0;
    this.sound.goal(forPlayer);
    this.chase.kick(34);
    // Solo only. A replay runs about five seconds and the server pauses for
    // two and a half, so in a joined game it would still be playing back while
    // everybody else had kicked off again -- and the client is frozen while it
    // runs, so it would be watching a replay instead of the match. Everything
    // else about a goal still happens.
    if (!this.net) this.replayPending = cfg.replay.startAfter;
    this.goalMoment.trigger(
      this.ball.position,
      this.ball.position.x > 0 ? 1 : -1,
      forPlayer ? GOAL_COLOUR_BLUE : GOAL_COLOUR_ORANGE,
    );
  }

  private onMatchEnd(result: MatchResult): void {
    // No match-level win/lose banner: in a gauntlet the run card says what
    // happened ("Round cleared", "Run over"), and both at once collide.
    this.run.finishRound(result, this.match.playedSeconds);
  }

  /** Everyone back to their lines, ball on the spot, pads back up. */
  private setUpKickoff(): void {
    this.sim.resetKickoff();
    for (const entry of this.entries) {
      entry.interp.snap(entry.car.position, entry.car.body.rotation());
    }
    this.ballInterp.snap(this.ball.position, this.ball.body.rotation());
    // Everything has just teleported to its kickoff spot. The ribbons guard
    // against a jump on their own, but clearing here means not even one frame
    // of a streak drawn from where the ball was to where it now is.
    this.ballTrail.clear();
    for (const entry of this.entries) {
      entry.streak.clear();
      entry.wasSupersonic = false;
    }
    // A recording must never span a kickoff, or the replay of the next goal
    // opens with everything teleporting back to the halfway line.
    this.replay.reset();
    this.replayPending = -1;
    this.replayHud.hide();
    this.chase.snapTo(this.player.car.position, this.player.car.forward());
  }

  // --- simulation --------------------------------------------------------

  private fixedStep(dt: number): void {
    // A replay is a recording being played back, so nothing may advance while
    // it runs: not the physics, not the clock, not the bots. The match is held
    // here rather than paused inside Match, so the replay stays a thing the
    // renderer does and the match rules never have to know about it.
    if (this.replay.playing) return;

    this.time += dt;

    for (const entry of this.entries) {
      entry.interp.record(entry.car.position, entry.car.body.rotation());
    }
    this.ballInterp.record(this.ball.position, this.ball.body.rotation());

    // Recorded from the bodies, not the interpolated meshes: the meshes lag by
    // design, and a replay should show where things were.
    this.replay.record(
      dt,
      this.entries.map((e) => ({ position: e.car.position, rotation: e.car.body.rotation() })),
      { position: this.ball.position, rotation: this.ball.body.rotation() },
    );

    const phase = this.match.phase;
    // Only 'playing' hands control over. The countdown holds everyone on their
    // line; after a goal the ball keeps rolling for show but nobody drives.
    const live = this.screen === 'playing';
    const driving = live && (this.freePlay || (phase === 'playing' && this.run.phase === 'round'));
    const frozen =
      !live || (!this.freePlay && (phase === 'countdown' || phase === 'ended' || this.run.phase !== 'round'));

    // The player's input, read here because the keyboard is not the
    // simulation's business. A networked build fills this map from the wire
    // instead, and nothing below changes.
    const input = this.inputOverride
      ? { ...emptyInput(), ...this.inputOverride }
      : this.controls.read();
    this.playerInput.set(this.net?.carIndex ?? 0, input);
    if (!driving && !this.inputOverride) {
      // Keeps the jump latch from banking a press for after the countdown.
      this.controls.read();
    }

    // Joined to a server, the local simulation is a prediction: the same step
    // on the same input, then corrected whenever the server's answer lands.
    // The server owns the clock and the round, so neither is run here.
    const net = this.net;
    if (net) {
      // Driven by the snapshots, not by the round message: the round arrives
      // first, before any snapshot has said how many cars there are, so doing
      // this there left the opposition missing from the client entirely.
      this.matchRemoteCars(net.snapshotTeams);
      net.send(input);
    }
    const events = this.sim.step(dt, {
      driving: net ? net.isConnected : driving,
      frozen: net ? false : frozen,
      clock: net ? false : live && !this.freePlay,
      inputs: this.playerInput,
    });
    if (net) {
      net.reconcile(this.sim);
      // The match is being played on the server, so the one here exists only to
      // be shown. Without this the HUD sits on a countdown that never ends.
      this.match.mirror({
        clock: net.clock,
        score: net.score,
        phase: net.phase as MatchPhase,
      });
    }

    for (const picked of events.padPickups) {
      if (picked.car === this.player.car) this.run.stats.driving.pads++;
      this.sound.pad(picked.pad.big);
      this.particles.burst({ x: picked.pad.x, y: 40, z: picked.pad.z }, picked.pad.big ? 18 : 8, {
        colour: TRAIL_COLOUR_BLUE,
        speed: 420,
        size: 24,
        life: 0.45,
      });
    }
    for (const touch of events.ballTouches) {
      const entry = this.entryFor(touch.by.car);
      if (entry) this.onBallTouched(entry, touch.closing);
    }
    for (const hit of events.carHits) {
      this.onCarsCollided(hit.at, hit.closing, !hit.a.bot || !hit.b.bot);
    }

    if (driving) this.recordDriving(dt);
  }

  /** Sound, sparks and a camera kick where two cars met. The shove is physics,
   *  and happens in the simulation. */
  private onCarsCollided(
    at: { x: number; y: number; z: number },
    closing: number,
    involvesPlayer: boolean,
  ): void {
    this.sound.hit(closing);
    this.particles.burst(at, closing > 1200 ? 14 : 7, {
      colour: IMPACT_COLOUR,
      speed: 160 + closing * 0.25,
      size: 22,
      life: 0.3,
    });
    if (involvesPlayer) this.chase.kick(Math.min(16, closing / 180));
  }

  /** The visuals belonging to a simulated car. */
  private entryFor(car: Car): CarEntry | undefined {
    return this.entries.find((e) => e.car === car);
  }

  /** Sound and sparks for a car-on-ball touch, scaled by how hard it was. */
  private onBallTouched(entry: CarEntry, closing: number): void {
    const bv = this.ball.velocity;
    this.sound.hit(closing);
    this.particles.burst(this.ball.position, closing > 900 ? 16 : 8, {
      colour: IMPACT_COLOUR,
      speed: 200 + closing * 0.3,
      size: 26,
      life: 0.35,
    });
    // Only the player's own touches shake the view, or a scrum is unreadable.
    if (!entry.bot) {
      this.chase.kick(Math.min(14, closing / 220));
      const driving = this.run.stats.driving;
      driving.touches++;
      // The speed the ball leaves at, not the closing speed: that is the
      // number anyone means by how hard they hit it.
      const left = Math.hypot(bv.x, bv.y, bv.z);
      driving.hardestTouch = Math.max(driving.hardestTouch, left);
    }
  }


  // --- rendering ---------------------------------------------------------

  private renderFrame(dt: number, alpha: number): void {
    // Gamepads are polled, not pushed: the browser hands out snapshots, so a
    // fresh read is needed every frame before anything asks for input.
    this.controls.poll();

    for (const entry of this.entries) {
      entry.interp.apply(alpha);
      const boosting = entry.car.input.boost && entry.car.boost > 0;
      entry.flame.visible = boosting;
      if (boosting) {
        entry.flame.scale.setScalar(0.8 + Math.random() * 0.4);
        this.emitBoostTrail(entry, dt);
      }
    }
    this.ballInterp.apply(alpha);
    this.padVisuals.sync(this.pads.pads, this.time);
    this.particles.setProjection(
      this.render.renderer.domElement.clientHeight || window.innerHeight,
      this.render.camera.fov,
    );
    this.particles.update(dt);
    this.updateContinuousAudio();

    const player = this.player;
    if (this.screen === 'title' || this.screen === 'summary') {
      // An establishing shot behind the menu rather than the chase camera's
      // view from a parked car's bumper. The arena is the thing worth looking
      // at on the way in, and the chase camera is snapped back into place when
      // a round starts, so nothing inherits this position.
      this.menuShotTime += dt;
      const a = this.menuShotTime * cfg.camera.menuOrbitSpeed;
      const cam = this.render.camera;
      cam.position.set(
        Math.cos(a) * cfg.camera.menuOrbitRadius,
        cfg.camera.menuOrbitHeight,
        Math.sin(a) * cfg.camera.menuOrbitRadius * 0.62,
      );
      cam.lookAt(0, 120, 0);
    } else {
      this.chase.update(
        dt,
        player.mesh.position,
        player.car.velocity,
        player.car.forward(),
        this.ballMesh.position,
        { grounded: player.car.grounded, normal: player.car.groundNormal },
      );
    }

    // Hand the real frame time to the adaptive resolution. `dt` here is the
    // render delta, which is the frame time whatever the physics did inside it.
    this.render.pace(dt * 1000);
    if (!this.lowPower && this.render.struggling && qualityAsked() !== 'high') {
      this.enterLowPower('frames are slow at the lowest resolution');
    }

    // Before the replay, not after it. The winning goal starts a replay at the
    // same moment the picker opens, and a replay frame returns early -- so a
    // pick pressed during it was read by nobody and then cleared, and the
    // picker looked frozen for five seconds.
    this.handlePicker();

    if (this.updateReplay(dt)) {
      // Playing back: the meshes and the camera are the replay's, and the
      // live trails would be drawn from stale positions.
      this.hud.setDevice(this.controls.device);
      this.controls.endFrame();
      this.render.pace(dt * 1000);
      this.render.draw();
      return;
    }

    this.updateTrails(dt);
    this.goalMoment.update(dt);

    // The slow motion gets a falling sweep going in and a rising one coming
    // back. Fired on the crossings rather than per frame, or it stacks a new
    // oscillator every frame for a second and the result is a siren.
    const scale = this.goalMoment.timeScale;
    if (scale < 1 && this.lastTimeScale >= 1) this.sound.timeDilation(true);
    else if (scale >= 1 && this.lastTimeScale < 1) this.sound.timeDilation(false);
    this.lastTimeScale = scale;

    this.stadium.update(dt, {
      blue: this.match.score[0],
      orange: this.match.score[1],
      clock: formatClock(this.match.clock),
      label: this.roundLabel,
    });

    this.handleHotkeys();
    this.hud.setDevice(this.controls.device);
    this.hud.update(player.car, this.chase.ballCam);
    this.radar.update({
      layout: this.arena.layout,
      ball: this.ball.position,
      pads: this.pads.pads,
      cars: this.entries.map((entry) => ({
        x: entry.car.position.x,
        y: entry.car.position.y,
        z: entry.car.position.z,
        fwdX: entry.car.fwd.x,
        fwdZ: entry.car.fwd.z,
        team: entry.car.team,
        isPlayer: entry === player,
      })),
    });
    this.matchHud.update(this.match, dt);
    this.runHud.update(this.run, dt);
    this.controls.endFrame();

    this.render.draw();
  }

  private handleHotkeys(): void {
    // Any input at all is a gesture, which is what an AudioContext needs.
    if (this.controls.anyPressed) this.sound.unlock();

    if (this.shell.visible) {
      // A pad connected while the title screen is up should show there without
      // needing the screen to be reopened.
      if (this.screen === 'title' && this.controls.padConnected !== this.titleShowedPad) {
        this.titleShowedPad = this.controls.padConnected;
        this.shell.showTitle(this.run.best, this.sound.muted, this.titleShowedPad);
      }
      this.handleMenuKeys();
      return;
    }

    if (this.controls.pressed('pause')) {
      this.pause();
      return;
    }
    if (this.controls.pressed('ballCam')) this.chase.toggleBallCam();
    if (this.controls.pressed('tuning')) this.panel.toggle();
    if (this.controls.pressed('mute')) this.sound.toggleMute();
    if (this.controls.pressed('resetBall')) this.ball.reset();

  }

  // --- screens -----------------------------------------------------------

  private handleMenuKeys(): void {
    if (this.controls.pressed('menuUp')) {
      this.shell.move(-1);
      this.sound.menuMove();
    }
    if (this.controls.pressed('menuDown')) {
      this.shell.move(1);
      this.sound.menuMove();
    }
    const picks: readonly ('pick1' | 'pick2' | 'pick3' | 'pick4')[] = [
      'pick1',
      'pick2',
      'pick3',
      'pick4',
    ];
    for (const [i, action] of picks.entries()) {
      if (this.controls.pressed(action)) {
        const id = this.shell.pick(i + 1);
        if (id) {
          this.sound.menuSelect();
          this.choose(id);
        }
        return;
      }
    }
    if (this.controls.pressed('menuSelect')) {
      const id = this.shell.selectedId;
      if (id) {
        this.sound.menuSelect();
        this.choose(id);
      }
      return;
    }
    // Pause resumes from the pause menu, which is where it was triggered.
    if (this.controls.pressed('pause') && this.screen === 'paused') this.choose('resume');
  }

  /** Acts on a menu item. The shell reports the choice; this one makes it. */
  private choose(id: string): void {
    switch (id) {
      case 'start':
      case 'again':
        this.beginRun();
        return;
      case 'freeplay':
        this.beginFreePlay();
        return;
      case 'resume':
        this.screen = 'playing';
        this.shell.hide();
        this.syncHudVisibility();
        return;
      case 'restart':
        this.beginRun();
        return;
      case 'quit':
        this.toTitle();
        return;
      case 'online':
        this.screen = 'online';
        this.shell.showOnline();
        return;
      case 'create':
        this.goOnline('new');
        return;
      case 'joinroom':
        this.askForCode();
        return;
      case 'back':
        this.screen = 'title';
        this.shell.showTitle(this.run.best, this.sound.muted, this.controls.padConnected);
        return;
      case 'leave':
        this.leaveOnline();
        return;
      case 'mute': {
        const muted = this.sound.toggleMute();
        // Redraw the screen so the label matches.
        if (this.screen === 'title') {
          this.shell.showTitle(this.run.best, muted, this.controls.padConnected);
        }
        else if (this.screen === 'paused') {
          this.shell.showPause(this.roundLabel, muted, this.net?.room ?? null);
        }
        return;
      }
    }
  }

  /**
   * Hides the gameplay HUD behind the title and summary screens, where a
   * scoreboard and a round number are describing a round nobody is playing.
   * The pause screen keeps it, so you can see the state you are returning to.
   */
  private syncHudVisibility(): void {
    const hide = this.screen === 'title' || this.screen === 'summary';
    this.ui.classList.toggle('menu-open', hide);
    // Free play has no clock and no opposition, so a scoreboard and a frozen
    // countdown would both be describing something that is not happening.
    this.ui.classList.toggle('free-play', this.freePlay);
  }

  private get roundLabel(): string {
    if (this.freePlay) return 'Free play';
    const spec = this.run.spec;
    return spec ? `Round ${spec.index} · ${spec.label}` : '';
  }

  private beginRun(): void {
    this.freePlay = false;
    this.screen = 'playing';
    this.shell.hide();
    this.particles.clear();
    this.runHud.showBest(this.run.best);
    this.syncHudVisibility();
    this.run.start();
  }

  /** No clock, no opponents, no way to lose: somewhere to learn the car. */
  private beginFreePlay(): void {
    this.freePlay = true;
    this.screen = 'playing';
    this.shell.hide();
    this.particles.clear();
    const spec = buildRound(1, Math.random);
    this.applyRound({ ...spec, lineup: [], opponents: 0, modifiers: [], label: 'Free play' });
    this.runHud.freePlay();
    this.syncHudVisibility();
  }

  /** The code box, and what to say when what was typed cannot be a code. */
  private askForCode(error?: string): void {
    this.shell.showJoin(
      (typed) => {
        const code = normaliseCode(typed);
        if (!code) {
          this.askForCode('That is not a code: four letters and digits, no 0, O, 1, I or L.');
          return;
        }
        this.goOnline(code);
      },
      () => this.shell.showOnline(),
      error,
    );
  }

  private pause(): void {
    if (this.screen !== 'playing') return;
    this.screen = 'paused';
    this.sound.setBoost(0);
    this.shell.showPause(this.roundLabel, this.sound.muted, this.net?.room ?? null);
    this.syncHudVisibility();
  }

  private toTitle(): void {
    this.screen = 'title';
    this.freePlay = false;
    this.sound.setBoost(0);
    this.particles.clear();
    this.shell.showTitle(this.run.best, this.sound.muted, this.controls.padConnected);
    this.syncHudVisibility();
  }

  // --- effects -----------------------------------------------------------

  /** Exhaust plume behind a boosting car. */
  private emitBoostTrail(entry: CarEntry, dt: number): void {
    const count = Math.min(6, Math.max(2, Math.round(dt * 420)));
    const back = entry.car.forward(this.scratch).multiplyScalar(-1);
    const p = entry.car.position;
    const v = entry.car.velocity;
    const exhaust = cfg.car.hitbox.length * 0.6;
    for (let i = 0; i < count; i++) {
      this.particles.emit({
        position: {
          x: p.x + back.x * exhaust,
          y: p.y + back.y * exhaust + 4,
          z: p.z + back.z * exhaust,
        },
        // Thrown backwards, but carrying some of the car's own speed so the
        // plume streams behind rather than hanging where it was made.
        velocity: {
          x: back.x * 520 + v.x * 0.3,
          y: back.y * 520 + v.y * 0.3,
          z: back.z * 520 + v.z * 0.3,
        },
        colour: entry.bot ? TRAIL_COLOUR_ORANGE : TRAIL_COLOUR_BLUE,
        size: 55,
        life: 0.42,
        spread: 90,
        drag: 2.0,
      });
    }
  }

  /**
   * Accumulates what the player did, for the run summary.
   *
   * Only while actually driving: a countdown, a replay or a paused game would
   * otherwise pile up airborne seconds while the car sits on its line, and the
   * summary would be quietly wrong in a way nobody would think to check.
   */
  private recordDriving(dt: number): void {
    const car = this.player.car;
    const d = this.run.stats.driving;
    const speed = car.speed;

    d.distance += speed * dt;
    if (speed > d.topSpeed) d.topSpeed = speed;
    if (car.isSupersonic) d.supersonicSeconds += dt;
    if (!car.grounded) d.airborneSeconds += dt;

    // Boost spent, from what the tank actually lost. Reading the drain rate
    // would count boost the car never had, since holding the button with an
    // empty tank does nothing.
    const burned = this.lastBoost - car.boost;
    if (burned > 0) d.boostSpent += burned;
    this.lastBoost = car.boost;
  }

  /**
   * Runs the goal replay. Returns true while one is playing.
   *
   * Started a beat after the goal rather than on it, so the celebration's slow
   * motion gets its moment first: a replay that cuts in over the hitstop
   * throws away the one frame the whole celebration is built around.
   */
  private updateReplay(dt: number): boolean {
    if (this.replayPending >= 0) {
      this.replayPending -= dt;
      if (this.replayPending < 0) {
        this.replayPending = -1;
        // Framed on where the ball ended up, which is in the net.
        if (!this.replay.start(this.ball.position)) return false;
        this.replayHud.show();
        this.sound.replaySting(true);
        // The boost loop is a live sound and the world is not live. Left
        // running it holds a thrust note under a replay of something that
        // finished seconds ago.
        this.sound.setBoost(0);
      }
    }

    if (!this.replay.playing) return false;

    // Skippable. Nobody wants to watch the same replay at round twenty.
    if (this.controls.pressed('menuSelect') || this.controls.pressed('pause')) {
      this.replay.stop();
      this.replayHud.hide();
      this.sound.replaySting(false);
      this.restoreFromReplay();
      return false;
    }

    const meshes = this.entries.map((e) => e.mesh);
    this.replay.apply(meshes, this.ballMesh);
    this.replay.frameCamera(this.render.camera, this.ballMesh);
    this.replayHud.update(dt);

    if (!this.replay.update(dt)) {
      this.replayHud.hide();
      this.sound.replaySting(false);
      this.restoreFromReplay();
      return false;
    }
    return true;
  }

  /**
   * Puts the meshes back where the simulation actually left them.
   *
   * The replay moved them to wherever the recording was. Without this the
   * first frame after it is the end of the replay rather than the live world,
   * which reads as the ball teleporting.
   */
  private restoreFromReplay(): void {
    for (const entry of this.entries) {
      entry.interp.snap(entry.car.position, entry.car.body.rotation());
    }
    this.ballInterp.snap(this.ball.position, this.ball.body.rotation());
    this.ballTrail.clear();
    for (const entry of this.entries) entry.streak.clear();
    this.chase.snapTo(this.player.car.position, this.player.car.forward());
  }

  /**
   * Trails behind the ball and behind a car at speed, and the ring a car
   * throws off as it goes supersonic.
   *
   * Faded in across a range rather than switched on at a threshold: a trail
   * that appears the instant a number is crossed blinks on and off while the
   * speed hovers there, which reads as a fault rather than as speed.
   */
  private updateTrails(dt: number): void {
    const t = cfg.trails;
    const camera = this.render.camera;

    const bv = this.ball.velocity;
    const ballSpeed = Math.hypot(bv.x, bv.y, bv.z);
    const ballStrength = clamp((ballSpeed - t.ballFrom) / (t.ballFull - t.ballFrom), 0, 1);
    this.ballTrail.update(dt, this.ballMesh.position, camera, ballStrength);

    for (const entry of this.entries) {
      const speed = entry.car.speed;
      const from = cfg.car.supersonicSpeed - t.carFadeRange;
      const strength = clamp((speed - from) / t.carFadeRange, 0, 1);
      entry.streak.update(dt, entry.mesh.position, camera, strength);

      // The ring fires on the crossing, not while above it.
      const now = entry.car.isSupersonic;
      if (now && !entry.wasSupersonic) {
        const p = entry.mesh.position;
        this.sonicRing.position.set(p.x, p.y, p.z);
        this.sonicRing.quaternion.copy(camera.quaternion);
        this.sonicRing.visible = true;
        this.sonicRingClock = 0;
      }
      entry.wasSupersonic = now;
    }

    if (this.sonicRing.visible) {
      this.sonicRingClock += dt;
      const ring = this.sonicRingClock / cfg.goal.sonicRingSeconds;
      if (ring >= 1) {
        this.sonicRing.visible = false;
        this.sonicRingMaterial.opacity = 0;
      } else {
        this.sonicRing.scale.setScalar(Math.max(1, cfg.goal.sonicRingRadius * ring));
        this.sonicRingMaterial.opacity = (1 - ring) ** 2 * cfg.goal.sonicRingOpacity;
      }
    }
  }

  /** Sounds that track state rather than events. */
  private updateContinuousAudio(): void {
    const car = this.player.car;
    const live = this.screen === 'playing';
    const boosting = live && car.input.boost && car.boost > 0;
    this.sound.setBoost(boosting ? 0.5 + 0.5 * Math.min(1, car.speed / cfg.car.maxSpeed) : 0);

    if (live && car.isSupersonic && !this.wasSupersonic) this.sound.supersonic();
    this.wasSupersonic = car.isSupersonic;

    // One beep per number of the countdown.
    if (live && !this.freePlay && this.match.phase === 'countdown') {
      const n = Math.ceil(this.match.countdownRemaining);
      if (n !== this.lastCountdownBeep) {
        this.lastCountdownBeep = n;
        this.sound.countdown(n);
      }
    } else {
      this.lastCountdownBeep = -1;
    }
  }

  /** Opens the upgrade picker, with the first card highlighted. */
  private openPicker(spec: RoundSpec, offer: readonly Upgrade[], waitingFor: string | null): void {
    this.runHud.offerUpgrades(spec, offer, waitingFor);
    this.pickerIndex = 0;
    this.pickerLocked = waitingFor !== null;
    if (!this.pickerLocked) this.runHud.highlightOption(0);
    this.pickerOpenedAt = performance.now();
  }

  /**
   * Every way to take an upgrade, in one place: 1 to 3, the arrows or A/D or
   * the d-pad to move and Enter, Space or A to take, and the cards themselves.
   *
   * A pad had no way at all before -- the number shortcuts were keyboard-only
   * and nothing else picked -- so anyone on a controller who cleared a round
   * was stuck on this screen for good.
   */
  private handlePicker(): void {
    if (this.freePlay || this.run.phase !== 'between' || this.pickerLocked) return;
    if (!this.runHud.pickerOpen) return;
    const count = this.run.offer.length;
    if (count === 0) return;

    // A moment's grace before anything is taken. The winning goal is usually
    // scored mid-jump, and jump is Space on a keyboard and A on a pad -- both of
    // which also mean "take this one". Without the pause, the press that put
    // the ball in takes the first card before anyone has seen the three.
    if (performance.now() - this.pickerOpenedAt < PICKER_GRACE_MS) return;

    const c = this.controls;
    if (c.pressed('menuLeft') || c.pressed('menuUp')) {
      this.pickerIndex = (this.pickerIndex - 1 + count) % count;
      this.runHud.highlightOption(this.pickerIndex);
      this.sound.menuMove();
    }
    if (c.pressed('menuRight') || c.pressed('menuDown')) {
      this.pickerIndex = (this.pickerIndex + 1) % count;
      this.runHud.highlightOption(this.pickerIndex);
      this.sound.menuMove();
    }

    let chosen = -1;
    const keys = ['pick1', 'pick2', 'pick3'] as const;
    for (const [i, key] of keys.entries()) if (c.pressed(key)) chosen = i;
    if (chosen < 0 && c.pressed('menuSelect')) chosen = this.pickerIndex;
    if (chosen >= 0 && chosen < count) this.takeUpgrade(chosen);
  }

  /** Takes a card, cutting short a replay if one is playing over the picker. */
  private takeUpgrade(index: number): void {
    if (this.pickerLocked || this.run.phase !== 'between') return;
    if (this.replay.playing) {
      this.replay.stop();
      this.replayHud.hide();
      this.sound.replaySting(false);
      this.restoreFromReplay();
    }
    this.replayPending = -1;
    this.sound.menuSelect();
    this.pickUpgrade(index);
  }

  /** Takes the nth offered upgrade. Exposed for the console and for tests. */
  pickUpgrade(index: number): void {
    // Joined to a server, the pick is a request: the server decides whether
    // this client is the one allowed to make it, and tells everyone the result.
    if (this.net) {
      this.net.choose(index);
      return;
    }
    this.run.choose(index);
  }

  /** Re-reads every tunable that is cached rather than read per step. */
  private syncConfig(): void {
    this.sim.syncConfig();
  }

  /**
   * Starts a fresh run from round one. Bound to R.
   *
   * Pass a seed to make the modifier picks repeatable, which is the only way to
   * chase a bug that only shows up in one round's particular combination.
   */
  restartRun(seed?: number): void {
    if (seed !== undefined) {
      this.runSeed = seed;
      this.run = this.makeRun();
    }
    this.runHud.showBest(this.run.best);
    this.run.start();
  }

  private makeRun(): Run {
    const handlers = {
      onRoundStart: (spec: RoundSpec) => this.applyRound(spec),
      onRoundCleared: (spec: RoundSpec, _stats: unknown, offer: readonly Upgrade[]) =>
        this.openPicker(spec, offer, null),
      onUpgradeTaken: (_upgrade: Upgrade, owned: readonly Upgrade[]) =>
        this.runHud.showOwned(owned),
      onRunOver: (summary: RunSummary) => {
        // The record may have just changed, so refresh the line that shows it.
        this.runHud.showBest(this.run.best);
        this.screen = 'summary';
        this.shell.showSummary(summary, this.run.upgrades, this.run.best);
        this.syncHudVisibility();
      },
    };
    if (this.runSeed === null) return new Run(handlers);
    let s = this.runSeed >>> 0;
    return new Run(handlers, () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    });
  }

  /** Kept for the console and for scripted checks. */
  resetPlay(): void {
    this.restartRun();
  }

  /**
   * Advances the simulation by a fixed amount and draws one frame, without
   * waiting on requestAnimationFrame. Used for scripted verification and for
   * stepping through a situation while tuning.
   */
  advance(seconds: number, input?: Partial<CarInput>): void {
    const dt = cfg.physics.fixedDt;
    const steps = Math.max(1, Math.round(seconds / dt));
    // Goes through the real fixed step, so this cannot drift from normal play.
    this.inputOverride = input ?? null;
    try {
      for (let i = 0; i < steps; i++) this.fixedStep(dt);
    } finally {
      this.inputOverride = null;
    }
    // The real render path, so stepping the game cannot drift from playing it.
    // Keeping a second cut-down version of this is how the boost trail, the
    // hotkeys and the match update each went missing from scripted checks in
    // turn; there is now only one.
    this.renderFrame(seconds, 1);
  }

  /** Live view for the console and for scripted checks. */
  get debug(): {
    readonly car: Car;
    readonly cars: readonly Car[];
    readonly bots: readonly Bot[];
    readonly ball: Ball;
    readonly arena: Arena;
    readonly pads: BoostPads;
    readonly phys: PhysicsWorld;
    readonly match: Match;
    readonly run: Run;
    readonly overrides: ConfigOverrides;
    readonly runOverrides: ConfigOverrides;
    readonly screen: Screen;
    readonly freePlay: boolean;
    readonly controls: Controls;
  } {
    // Getters rather than a snapshot: the match is replaced on every restart,
    // and a held reference to the old one silently reports stale state.
    const game = this;
    return {
      get car() {
        return game.player.car;
      },
      get cars() {
        return game.entries.map((e) => e.car);
      },
      get bots() {
        return game.entries.flatMap((e) => (e.bot ? [e.bot] : []));
      },
      get ball() {
        return game.ball;
      },
      get arena() {
        return game.arena;
      },
      get pads() {
        return game.pads;
      },
      get phys() {
        return game.phys;
      },
      get match() {
        return game.match;
      },
      get run() {
        return game.run;
      },
      get overrides() {
        return game.roundOverrides;
      },
      get runOverrides() {
        return game.runOverrides;
      },
      get screen() {
        return game.screen;
      },
      get freePlay() {
        return game.freePlay;
      },
      get controls() {
        return game.controls;
      },
    };
  }
}
