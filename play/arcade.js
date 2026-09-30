import { getChallenge, evaluateChallenge } from './arcade-rules.js';

const $ = id => document.getElementById(id);
const GAME_NAMES = { catch: '接住小心意', memory: '记忆花园', fishing: '月光钓鱼' };
const SYMBOLS = ['heart', 'leaf', 'home', 'moon', 'gift', 'bowl'];
const SYMBOL_NAMES = ['心意', '树叶', '小家', '月亮', '礼物', '饭碗'];
function element(tag, className, text) {
  const node = document.createElement(tag); node.className = className || '';
  if (text !== undefined) node.textContent = text;
  return node;
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', `#i-${name}`);
  svg.setAttribute('aria-hidden', 'true'); svg.append(use); return svg;
}

export class ArcadeController {
  constructor({ act, getWorld, getActor, open, feedback }) {
    Object.assign(this, { act, getWorld, getActor, open, feedback });
    this.running = false; this.frame = 0; this.delays = new Set();
    $('close-arcade').addEventListener('click', () => this.exit());
    $('game-done').addEventListener('click', () => this.exit());
    $('game-again').addEventListener('click', () => this.start(this.game));
    $('arcade-dialog').addEventListener('cancel', event => { event.preventDefault(); this.exit(); });
    $('arcade-dialog').addEventListener('close', () => this.stop());
    $('arcade-dialog').addEventListener('keydown', event => this.keyboard(event));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.running && !this.finishing) this.tick();
    });
  }

  later(fn, ms) {
    const timer = setTimeout(() => { this.delays.delete(timer); fn(); }, ms); this.delays.add(timer);
  }

  stop() {
    this.running = false; cancelAnimationFrame(this.frame);
    for (const timer of this.delays) clearTimeout(timer); this.delays.clear();
  }

  exit() {
    if (this.starting || this.finishing) { $('game-save-status').textContent = '请等服务器确认这一局，再关闭。'; return; }
    if (this.running && !window.confirm('退出这一局？本局不领奖，已有的小家进度不会改变。')) return;
    this.stop(); $('arcade-dialog').close();
  }

  async start(game) {
    if (this.starting || this.finishing || this.running) return;
    this.stop(); this.game = game; this.starting = true; this.owner = this.getActor();
    $('arcade-title').textContent = GAME_NAMES[game]; $('game-result').hidden = true;
    $('game-save-status').textContent = '正在准备你们的专属关卡……';
    $('game-board').replaceChildren(); $('game-controls').replaceChildren();
    $('game-score').textContent = '0'; $('game-time').textContent = game === 'memory' ? '60' : '20';
    $('game-again').disabled = true; $('close-arcade').disabled = true;
    if (!$('arcade-dialog').open) this.open();
    try {
      if (!(await this.act({ type: 'game-start', game }))) {
        $('game-save-status').textContent = '关卡还未确认。请恢复连接后退出，再重新开始。'; return;
      }
      this.session = this.getWorld().adventure.sessions[this.owner];
      if (!this.session || this.session.game !== game) throw new Error('关卡未就绪。');
      this.challenge = getChallenge(this.session); this.inputs = []; this.score = 0;
      this.started = performance.now(); this.running = true; this.finishing = false; this.lane = 1;
      $('game-board').className = `game-board ${game}-board`;
      $('game-save-status').textContent = '关卡计时不会因切到后台而暂停。退出本局不领奖。';
      $('game-combo').textContent = '一起加油';
      if (game === 'memory') this.buildMemory(); else if (game === 'catch') this.buildCatch(); else this.buildFishing();
      $('game-board').focus(); this.tick();
    } catch {
      this.stop(); $('game-save-status').textContent = '关卡未能打开，请刷新后再试。';
    } finally { this.starting = false; $('close-arcade').disabled = false; }
  }

  elapsed() { return Math.max(0, Math.floor(performance.now() - this.started)); }
  proof() { return this.inputs.join(','); }
  stamp(value) {
    const previous = this.inputs.length ? Number(this.inputs.at(-1).split(':')[0]) : -1;
    const at = Math.max(previous + 1, this.elapsed());
    if (at > this.challenge.duration || this.inputs.length >= 128) return false;
    this.inputs.push(this.game === 'fishing' ? String(at) : `${at}:${value}`); return true;
  }
  refreshScore() {
    const result = evaluateChallenge(this.session, this.proof(), this.elapsed() + 1);
    const score = result.score || 0, improved = score > this.score;
    this.score = score; $('game-score').textContent = score;
    $('game-combo').textContent = improved ? this.game === 'fishing' ? '收竿成功！' : '接住啦！' : '再找准一点';
    this.feedback(improved ? 'reward' : 'miss'); return improved;
  }

  buildCatch() {
    $('arcade-instructions').textContent = '礼物落到虚线时，点对应一列。键盘 1 / 2 / 3，或左右移动后按空格。';
    this.falling = this.challenge.targets.map((target, index) => {
      const gift = element('span', 'falling-gift'); gift.append(icon(index % 3 === 0 ? 'heart' : 'gift'));
      gift.style.left = `${(target.lane + .5) / 3 * 100}%`; gift.hidden = true; $('game-board').append(gift); return gift;
    });
    $('game-board').append(element('div', 'catch-line', '在这里接住'));
    this.kitten = element('span', 'catch-kitten pet-sprite'); $('game-board').append(this.kitten);
    ['左边', '中间', '右边'].forEach((label, lane) => {
      const button = element('button', 'button paper', label); button.setAttribute('aria-label', `接住${label}的礼物`);
      button.addEventListener('click', () => this.catchGift(lane)); $('game-controls').append(button);
    });
  }
  catchGift(lane) {
    if (!this.running || this.finishing) return;
    this.lane = lane; this.kitten.style.left = `${(lane + .5) / 3 * 100}%`;
    if (!this.stamp(lane)) return;
    const improved = this.refreshScore(); $('game-board').classList.toggle('hit', improved);
    this.later(() => $('game-board').classList.remove('hit'), 160);
  }

  buildMemory() {
    $('arcade-instructions').textContent = '一次翻两张，找到六对图案。图案每局随机，60 秒内完成。';
    this.flipped = []; this.matched = new Set(); this.memoryBusy = false;
    this.cards = this.challenge.deck.map((value, index) => {
      const button = element('button', 'memory-tile'); button.append(element('span', 'card-back', '♡'), icon(SYMBOLS[value]));
      button.setAttribute('aria-label', `第 ${index + 1} 张卡片，未翻开`);
      button.addEventListener('click', () => this.flip(index)); $('game-board').append(button); return button;
    });
    $('game-controls').append(element('p', 'memory-hint', '记住它们的位置，比手速更重要。'));
  }
  flip(index) {
    if (!this.running || this.finishing || this.memoryBusy || this.matched.has(index) || this.flipped.includes(index) || !this.stamp(index)) return;
    const card = this.cards[index]; card.classList.add('flipped'); card.setAttribute('aria-label', `第 ${index + 1} 张卡片，${SYMBOL_NAMES[this.challenge.deck[index]]}`);
    this.flipped.push(index); this.feedback('touch');
    if (this.flipped.length < 2) return;
    const [first, second] = this.flipped; this.memoryBusy = true;
    if (this.challenge.deck[first] === this.challenge.deck[second]) {
      this.matched.add(first); this.matched.add(second);
      for (const position of this.flipped) { this.cards[position].classList.add('matched'); this.cards[position].disabled = true; }
      this.score = this.matched.size / 2; $('game-score').textContent = this.score;
      $('game-combo').textContent = `找到了 ${this.score} / 6 对`; this.feedback('reward');
      this.flipped = []; this.memoryBusy = false;
      if (this.score === 6) this.later(() => this.finish(), Math.max(500, 3100 - this.elapsed()));
    } else {
      $('game-combo').textContent = '记住它们，再试一次';
      this.later(() => {
        for (const position of [first, second]) { this.cards[position].classList.remove('flipped'); this.cards[position].setAttribute('aria-label', `第 ${position + 1} 张卡片，未翻开`); }
        this.flipped = []; this.memoryBusy = false;
      }, 650);
    }
  }

  buildFishing() {
    $('arcade-instructions').textContent = '浮标进入金色区域时收竿。五次机会；点按钮或按空格，太早太晚都钓不到。';
    const moon = element('div', 'pond-moon'); moon.append(icon('moon'));
    const pond = element('div', 'game-pond'); pond.append(element('span', 'pond-ripple'), element('span', 'pond-ripple second'));
    this.float = element('span', 'pond-float'); pond.append(this.float);
    this.fishingLabel = element('p', 'fishing-label', '轻轻等一等，小鱼快来了。');
    const meter = element('div', 'fishing-meter');
    this.zones = this.challenge.targets.map(target => {
      const zone = element('span', 'fishing-zone'); zone.style.left = `${(target.at - target.width / 2) / this.challenge.duration * 100}%`;
      zone.style.width = `${target.width / this.challenge.duration * 100}%`; meter.append(zone); return zone;
    });
    this.marker = element('span', 'fishing-marker'); meter.append(this.marker);
    $('game-board').append(moon, pond, this.fishingLabel, meter);
    const button = element('button', 'button green reel-button', '收竿！'); button.addEventListener('click', () => this.reel()); $('game-controls').append(button);
  }
  reel() {
    if (!this.running || this.finishing || !this.stamp()) return;
    const improved = this.refreshScore(); this.fishingLabel.textContent = improved ? '钓到了！把这份小幸运带回家。' : '小鱼溜走了，等下一个金色区域。';
    this.float.classList.toggle('caught', improved); this.later(() => this.float.classList.remove('caught'), 350);
  }

  keyboard(event) {
    if (!this.running || this.finishing || this.game === 'memory' || event.repeat) return;
    if (this.game === 'catch') {
      if (['1', '2', '3'].includes(event.key)) { event.preventDefault(); this.catchGift(Number(event.key) - 1); }
      else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); this.lane = Math.max(0, Math.min(2, this.lane + (event.key === 'ArrowRight' ? 1 : -1))); this.kitten.style.left = `${(this.lane + .5) / 3 * 100}%`; }
      else if (event.code === 'Space') { event.preventDefault(); this.catchGift(this.lane); }
    } else if (event.code === 'Space') { event.preventDefault(); this.reel(); }
  }

  tick() {
    cancelAnimationFrame(this.frame);
    if (!this.running || this.finishing) return;
    const at = this.elapsed(), remaining = Math.max(0, this.challenge.duration - at);
    $('game-time').textContent = Math.ceil(remaining / 1000);
    if (this.game === 'catch') this.challenge.targets.forEach((target, index) => {
      const offset = at - target.at, gift = this.falling[index]; gift.hidden = offset < -1600 || offset > 450;
      gift.style.top = `${Math.min(89, 77 + offset / 1600 * 65)}%`;
    });
    if (this.game === 'fishing') {
      this.marker.style.left = `${Math.min(100, at / this.challenge.duration * 100)}%`;
      const biting = this.challenge.targets.some(target => Math.abs(at - target.at) <= target.width / 2);
      this.float.classList.toggle('biting', biting); $('game-board').classList.toggle('biting', biting);
    }
    if (at >= this.challenge.duration) { this.finish(); return; }
    this.frame = requestAnimationFrame(() => this.tick());
  }

  async finish() {
    if (!this.running || this.finishing) return;
    this.finishing = true; cancelAnimationFrame(this.frame);
    $('close-arcade').disabled = true; $('game-controls').querySelectorAll('button').forEach(button => button.disabled = true);
    $('game-save-status').textContent = '这一局结束了，正在安全结算……';
    $('game-result').hidden = false; $('game-result-detail').textContent = '请等服务器确认奖励。';
    $('game-again').disabled = true; $('game-done').disabled = true;
    try {
      const success = await this.act({ type: 'game-finish', run: this.session.id, inputs: this.proof() });
      if (!success) { $('game-result-detail').textContent = '结算尚未确认。请等连接恢复；不会重复发放奖励。'; return; }
      this.showResult(this.getWorld().adventure.results[this.owner]);
    } finally {
      this.finishing = false; this.running = false; $('close-arcade').disabled = false;
      $('game-done').disabled = false; $('game-again').disabled = false;
    }
  }

  showResult(result) {
    if (!result || result.run !== this.session.id) { $('game-result-detail').textContent = '进度已保存，请在操作日记查看结算。'; return; }
    this.confirmedRun = result.run;
    const ratio = result.score / result.maxScore, stars = ratio >= .85 ? 3 : ratio >= .5 ? 2 : ratio > 0 ? 1 : 0;
    $('game-stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    $('game-result-title').textContent = ratio >= .85 ? '这一局，闪闪发光。' : ratio >= .5 ? '好默契，再靠近一点。' : '快乐不止在满分那一刻。';
    $('game-result-detail').textContent = `${result.score} / ${result.maxScore} 分 · +${result.reward} 金币 · +${result.xp} 陪伴经验${result.reward === 0 ? '。今天的奖励次数用完或本局未得分，仍可继续练习。' : '。已收入我们的小家。'}`;
    $('game-save-status').textContent = '奖励已保存。另一台手机也能看到这一份快乐。';
    this.feedback(result.score ? 'reward' : 'touch');
  }

  reconcile(state, locked) {
    if (!$('arcade-dialog').open || this.starting) return;
    if (!this.running && !this.finishing) {
      $('game-again').disabled = locked;
      const result = state.adventure.results[this.owner];
      if (this.session && result?.run === this.session.id && this.confirmedRun !== result.run) {
        this.confirmedRun = result.run; this.showResult(result);
      }
    }
  }
}
