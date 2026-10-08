import { CATALOG } from './engine.js?v=2';
import { RETREAT_PLOTS, distance, walkRoute, plotInteraction, furnitureFromGround, throwPower, throwTarget, scoreThrow } from './retreat-rules.js?v=4';

const $ = id => document.getElementById(id);
export class RetreatController {
  constructor({ act, getWorld, getTime, isLocked, isShared }) {
    Object.assign(this, { act, getWorld, getTime, isLocked, isShared });
    this.view = null; this.loading = null; this.mode = 'roam'; this.seed = 'carrot'; this.plot = 0;
    this.furniture = 'rug'; this.placing = false; this.localBusy = false; this.challenge = null;
    this.best = 0; this.visits = new Set(); this.keys = new Set(); this.route = [];
    try { this.best = Math.max(0, Math.min(900, Number(localStorage.getItem('our-little-days-3d-best')) || 0)); } catch { /* Practice records are optional, never replace world storage. */ }
    $('retreat-close').addEventListener('click', () => $('retreat-dialog').close());
    $('retreat-back').addEventListener('click', () => $('retreat-dialog').close());
    $('retreat-dialog').addEventListener('close', () => {
      this.view?.setActive(false); this.keys.clear(); this.challenge = null; this.view?.hideTarget(); this.route = [];
      document.documentElement.style.overflow = '';
    });
    $('retreat-retry').addEventListener('click', () => this.open());
    document.querySelectorAll('[data-retreat-mode]').forEach(button => button.addEventListener('click', () => this.chooseMode(button.dataset.retreatMode)));
    document.querySelectorAll('[data-retreat-care]').forEach(button => button.addEventListener('click', () => this.care(button.dataset.retreatCare)));
    document.querySelectorAll('[data-retreat-theme]').forEach(button => button.addEventListener('click', () => this.run({ type: 'theme', theme: button.dataset.retreatTheme })));
    document.querySelectorAll('[data-retreat-plot]').forEach(button => button.addEventListener('click', () => {
      this.plot = Number(button.dataset.retreatPlot); const point = RETREAT_PLOTS[this.plot], current = this.view.getPlayer();
      this.startRoute([{ x: -2, z: current.z }, { x: -2, z: point.z + 1.2 }, { x: point.x, z: point.z + 1.2 }]); this.render();
    }));
    $('retreat-seed').addEventListener('change', () => { this.seed = $('retreat-seed').value; this.render(); });
    $('retreat-furniture').addEventListener('change', () => { this.furniture = $('retreat-furniture').value; this.placing = false; this.render(); });
    $('retreat-plant').addEventListener('click', () => this.farm());
    $('retreat-buy').addEventListener('click', async () => {
      const item = this.furniture;
      if (!this.getWorld().owned.includes(item) && !await this.run({ type: 'buy', item })) return;
      if (this.furniture !== item) return;
      this.placing = true; this.note('已选中家具。点击小屋内的地面摆放；窗上挂画会贴在后墙。'); this.render();
    });
    $('retreat-remove').addEventListener('click', () => this.run({ type: 'remove', item: this.furniture }));
    $('retreat-interact').addEventListener('click', () => this.interact());
    $('retreat-turn').addEventListener('click', () => this.view?.turn());
    $('retreat-reset').addEventListener('click', () => { this.route = []; this.view?.reset(); });
    $('retreat-fetch-start').addEventListener('click', () => this.startFetch());
    $('retreat-fetch-throw').addEventListener('click', () => this.throw());
    $('retreat-dialog').addEventListener('keydown', event => {
      if (event.target.closest('input, select') || event.ctrlKey || event.metaKey || event.altKey || !this.view) return;
      const directions = { w: [0, -1], ArrowUp: [0, -1], s: [0, 1], ArrowDown: [0, 1], a: [-1, 0], ArrowLeft: [-1, 0], d: [1, 0], ArrowRight: [1, 0] };
      if (directions[event.key]) { event.preventDefault(); this.keys.add(event.key); this.route = []; this.updateInput(directions); }
      if (event.key.toLowerCase() === 'e' && !event.repeat) { event.preventDefault(); this.interact(); }
      if (event.key === ' ' && this.challenge && !event.repeat) { event.preventDefault(); this.throw(); }
    });
    $('retreat-dialog').addEventListener('keyup', event => { this.keys.delete(event.key); this.updateInput(); });
    window.addEventListener('blur', () => { this.keys.clear(); this.updateInput(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.keys.clear(); this.updateInput(); } });
    document.querySelectorAll('[data-retreat-dir]').forEach(button => {
      const vector = button.dataset.retreatDir.split(',').map(Number);
      let pressedAt = null, suppressClick = false;
      button.addEventListener('pointerdown', event => { pressedAt = performance.now(); suppressClick = false; button.setPointerCapture(event.pointerId); this.route = []; this.view?.input(...vector); });
      const stop = () => { if (pressedAt !== null) { suppressClick = performance.now() - pressedAt > 180; pressedAt = null; } this.view?.input(0, 0); };
      button.addEventListener('pointerup', stop); button.addEventListener('pointercancel', stop); button.addEventListener('lostpointercapture', stop);
      button.addEventListener('click', () => { this.route = []; if (!suppressClick) this.view?.nudge(...vector); suppressClick = false; });
    });
    for (const crop of CATALOG.crops) $('retreat-seed').add(new Option(`${crop.name} · ${crop.cost} 金币`, crop.id));
    for (const item of CATALOG.furniture) $('retreat-furniture').add(new Option(`${item.name} · ${item.cost} 金币`, item.id));
  }
  updateInput() {
    const keys = this.keys;
    this.view?.input(Number(keys.has('d') || keys.has('ArrowRight')) - Number(keys.has('a') || keys.has('ArrowLeft')),
      Number(keys.has('s') || keys.has('ArrowDown')) - Number(keys.has('w') || keys.has('ArrowUp')));
  }
  startRoute(points) {
    let from = this.view.getPlayer(); const route = [];
    for (const point of points) {
      const leg = walkRoute(from, point);
      if (!leg.length) { this.note('这里暂时走不过去，换一个空地位置。'); return; }
      route.push(...leg); from = point;
    }
    this.route = route; this.routeGoal = this.route.shift(); this.view.walkTo(this.routeGoal);
  }
  note(message) { if ($('retreat-notice').textContent !== message) $('retreat-notice').textContent = message; }
  async open() {
    if (!$('retreat-dialog').open) $('retreat-dialog').showModal();
    document.documentElement.style.overflow = 'hidden';
    this.render();
    if (!this.view && !this.loading) {
      $('retreat-loading').hidden = false; $('retreat-retry').hidden = true;
      $('retreat-load-status').textContent = '正在加载原创 3D 场景。你的金币、菜地和家具保持不变。';
      this.loading = import('./retreat-view.js?v=4').then(module => module.createRetreatView({
        container: $('retreat-canvas'),
        onInteract: ({ point }) => {
          if (this.placing) {
            const input = furnitureFromGround(point, this.furniture);
            if (!input) { this.note('请点击小屋室内地面，不是湖水或屋外草地。'); return; }
            this.run(input).then(ok => { if (ok) { this.placing = false; this.render(); } });
          } else this.startRoute([point]);
        },
        onMove: context => { this.context = context; this.render(); },
        onTick: time => this.tick(time),
        onFailure: message => { this.view = null; this.loadingError(message); },
      })).then(view => {
        this.view = view; this.update(); $('retreat-loading').hidden = true;
        view.setActive($('retreat-dialog').open); this.render();
      }).catch(() => this.loadingError('这台设备暂时无法显示此 3D 场景。可重试或返回原来的游戏，存档没有变化。'))
        .finally(() => { this.loading = null; });
    } else this.view?.setActive(true);
    await this.loading;
  }
  loadingError(message) {
    $('retreat-loading').hidden = false; $('retreat-load-status').textContent = message; $('retreat-retry').hidden = false;
  }
  update() { if (this.view) this.view.update(this.getWorld(), this.getTime()); if ($('retreat-dialog').open) this.render(); }
  chooseMode(mode) {
    if (this.challenge && mode !== 'pet') { this.note('先完成这一局六球挑战，或返回日常退出。练习退出不改金币。'); return; }
    this.mode = mode; this.placing = false;
    if (mode === 'farm' && this.view) {
      this.plot = 5; this.startRoute([{ x: -2, z: 6.2 }, { x: -4.5, z: 6.2 }]);
    }
    this.render();
  }
  async run(input) {
    if (!this.view || this.localBusy || this.isLocked()) { this.note('上一笔操作正在保存或等待连接，请稍后。'); return false; }
    this.localBusy = true; this.render();
    try {
      const ok = await this.act(input);
      if (ok) {
        if (['feed', 'play', 'rest'].includes(input.type)) { this.visits.add('pet'); this.view?.touchPet(); }
        if (input.type === 'harvest') this.visits.add('farm');
      }
      return ok;
    } finally { this.localBusy = false; this.update(); }
  }
  async care(type) {
    if (this.view?.getNearby()?.kind !== 'pet') { this.note('先走近猫咪，它也会跟着你。'); return; }
    await this.run({ type });
  }
  async farm() {
    const near = this.view?.getNearby();
    if (near?.kind !== 'plot' || near.index !== this.plot) { this.note('点菜地编号走过去，到达后再操作。'); return; }
    const input = plotInteraction(this.getWorld().plots[this.plot], this.plot, this.seed, this.getTime());
    if (input.action) await this.run(input.action); else this.note('已浇水，等待作物成熟后收获。');
  }
  interact() {
    if (this.challenge) { this.throw(); return; }
    const near = this.view?.getNearby();
    if (near?.kind === 'plot') { this.plot = near.index; this.mode = 'farm'; this.farm(); }
    else if (near?.kind === 'pet') { this.mode = 'pet'; this.view.touchPet(); this.note(`${this.getWorld().pet.name} 正在陪你。选择喂食、陪玩或休息。`); }
    else this.note('走近猫咪或菜地再互动。拖动场景可转动视角。');
    this.render();
  }
  startFetch() {
    if (!this.view || this.challenge) return;
    this.challenge = { start: performance.now(), roundStart: performance.now(), round: 0, hits: 0, score: 0, until: 0 };
    this.view.reset(); this.route = []; this.mode = 'pet'; this.render();
    this.note('六次抛球，45 秒。指针进入绿区时按空格或点抛球。目标会变化，容错逐渐缩小。');
  }
  throw() {
    const game = this.challenge, time = performance.now();
    if (!game || time < game.until || game.round >= 6) return;
    if (time - game.start >= 45000) { this.finishFetch(); return; }
    const power = throwPower(time - game.roundStart, game.round), result = scoreThrow(power, game.round);
    game.score += result.points; game.hits += Number(result.hit); game.round++;
    game.until = time + 3800; this.view.throwBall(power);
    this.note(result.perfect ? '精准落点！猫咪去接球了。' : result.hit ? '进入目标区，接住了！' : '落点偏了。下一球看准绿区再出手。');
    this.render();
  }
  tick(time) {
    if (this.route.length && this.view) {
      // Advance only after the current safe route leg has reached its destination.
      if (!this.routeGoal || distance(this.view.getPlayer(), this.routeGoal) < .02) { this.routeGoal = this.route.shift(); this.view.walkTo(this.routeGoal); }
    }
    const game = this.challenge;
    if (!game) return;
    if (time - game.start >= 45000 || game.round >= 6 && time >= game.until) { this.finishFetch(); return; }
    const waiting = time < game.until;
    if (game.wasWaiting && !waiting) game.roundStart = time;
    game.wasWaiting = waiting;
    $('retreat-fetch-throw').disabled = waiting;
    $('retreat-fetch-time').textContent = `${Math.max(0, Math.ceil((45000 - time + game.start) / 1000))}s`;
    const target = throwTarget(game.round);
    $('retreat-throw-needle').style.left = `${throwPower(time - game.roundStart, game.round) * 100}%`;
    $('retreat-throw-target').style.left = `${(target.power - target.tolerance) * 100}%`;
    $('retreat-throw-target').style.width = `${target.tolerance * 200}%`;
    if (!waiting) this.view.showTarget(target.power, target.tolerance);
  }
  finishFetch() {
    const game = this.challenge; if (!game) return;
    this.challenge = null; this.view?.hideTarget(); this.visits.add('fetch');
    $('retreat-fetch-time').textContent = '0s';
    const record = game.score > this.best; this.best = Math.max(this.best, game.score);
    try { localStorage.setItem('our-little-days-3d-best', String(this.best)); } catch { /* World saving has its own connection and persistence status. */ }
    this.note(`${game.hits}/6 次命中 · ${game.score} 分${record ? ' · 新纪录' : ''}。练习纪录仅存本机，不发金币。可以再玩一局。`);
    this.render();
  }
  render() {
    const state = this.getWorld(), ready = !!this.view, locked = !ready || this.localBusy || this.isLocked();
    document.querySelectorAll('[data-retreat-mode]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.retreatMode === this.mode)); button.disabled = !ready || !!this.challenge && button.dataset.retreatMode !== 'pet'; });
    document.querySelectorAll('[data-retreat-panel]').forEach(panel => panel.hidden = panel.dataset.retreatPanel !== this.mode);
    $('retreat-world-status').textContent = `${state.coins} 金币 · ${this.isShared() ? '共享小家' : '本地试玩'}`;
    $('retreat-mission-pet').textContent = `${this.visits.has('pet') ? '已完成' : '待体验'} · 照顾猫咪`;
    $('retreat-mission-farm').textContent = `${this.visits.has('farm') ? '已完成' : '待体验'} · 种植与收获`;
    $('retreat-mission-fetch').textContent = `${this.visits.has('fetch') ? '已完成' : '待体验'} · 六球挑战`;
    const near = this.view?.getNearby();
    let context = `${this.context?.region || '石径'} · 方向键行走，拖动转动视角`;
    if (near?.kind === 'pet') context = `${state.pet.name} 在身边 · 按 E 照顾它`;
    if (near?.kind === 'plot') context = `${near.label} · 按 E ${plotInteraction(state.plots[near.index], near.index, this.seed, this.getTime()).label}`;
    if (this.placing) context = '布置模式 · 点室内地面摆放选中的家具';
    if (this.challenge) context = '抛球挑战 · 绿区出手，空格 / 抛球';
    if ($('retreat-context').textContent !== context) $('retreat-context').textContent = context;
    $('retreat-pet-stats').textContent = `${state.pet.name} · 饱腹 ${Math.floor(state.pet.hunger)} / 心情 ${Math.floor(state.pet.happiness)} / 精力 ${Math.floor(state.pet.energy)}`;
    document.querySelectorAll('[data-retreat-care]').forEach(button => button.disabled = locked || near?.kind !== 'pet');
    document.querySelectorAll('[data-retreat-theme]').forEach(button => { button.disabled = locked; button.setAttribute('aria-pressed', String(state.adventure.theme === button.dataset.retreatTheme)); });
    document.querySelectorAll('[data-retreat-plot]').forEach(button => { button.disabled = !ready; button.setAttribute('aria-pressed', String(this.plot === Number(button.dataset.retreatPlot))); });
    const plot = plotInteraction(state.plots[this.plot], this.plot, this.seed, this.getTime());
    $('retreat-plant').textContent = `${this.plot + 1} 号菜地 · ${plot.label}`;
    $('retreat-plant').disabled = locked || near?.kind !== 'plot' || near.index !== this.plot || !plot.action;
    $('retreat-crop-status').textContent = plot.state.empty ? '空地。选择种子，点击编号走过去。' : `${CATALOG.crops.find(crop => crop.id === plot.state.crop).name} · ${plot.state.ready ? '已成熟' : `还需 ${Math.ceil(plot.state.remaining / 1000)} 秒`}${plot.state.watered ? ' · 已浇水' : ''}`;
    const owned = state.owned.includes(this.furniture);
    $('retreat-buy').textContent = owned ? '选中并摆放' : `购买 ${CATALOG.furniture.find(item => item.id === this.furniture).cost} 金币`;
    $('retreat-buy').disabled = locked; $('retreat-remove').disabled = locked || !state.placed.some(piece => piece.id === this.furniture);
    $('retreat-furniture').disabled = locked;
    $('retreat-fetch-start').disabled = !ready || !!this.challenge;
    $('retreat-fetch-throw').disabled = !!this.challenge && performance.now() < this.challenge.until;
    $('retreat-fetch-meter').hidden = !this.challenge; $('retreat-fetch-throw').hidden = !this.challenge;
    $('retreat-fetch-score').textContent = this.challenge ? `${this.challenge.round}/6 球 · ${this.challenge.score} 分` : `本机最佳 ${this.best} 分`;
    $('retreat-interact').disabled = !ready; $('retreat-reset').disabled = !ready || !!this.challenge;
    $('retreat-persistence').textContent = this.isShared() ? '照顾、菜地、家具使用共享进度；抛球纪录仅本机。' : '本地试玩自动保存。连接原房间码可继续共享进度。';
  }
}
