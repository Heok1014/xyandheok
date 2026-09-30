import { ARCADE_GAMES, ARCADE_LIMITS, evaluateChallenge } from './arcade-rules.js';

const HOUR = 3_600_000;
const MAX_TIME = 253_402_271_999_999;
const MAX_NUMBER = Number.MAX_SAFE_INTEGER;
const ACTORS = new Set(['heok', 'xy']);
const ACTIONS = new Set(['feed', 'play', 'rest', 'rename', 'plant', 'water', 'harvest', 'buy', 'place', 'remove', 'claim', 'game-start', 'game-finish', 'order', 'gift', 'theme']);
const THEMES = new Set(['morning', 'sunset', 'night']);
const NEW_ACTION_FIELDS = new Map([
  ['game-start', new Set(['type', 'actor', 'game'])],
  ['game-finish', new Set(['type', 'actor', 'run', 'inputs'])],
  ['order', new Set(['type', 'actor', 'order'])],
  ['gift', new Set(['type', 'actor'])],
  ['theme', new Set(['type', 'actor', 'theme'])],
]);
const COOLDOWNS = Object.freeze({ feed: 5_000, play: 5_000, rest: 15_000, rename: 5_000 });
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
});

export const CATALOG = Object.freeze({
  crops: Object.freeze([
    Object.freeze({ id: 'carrot', name: '胡萝卜', cost: 8, reward: 14, duration: 20_000, xp: 3 }),
    Object.freeze({ id: 'strawberry', name: '草莓', cost: 18, reward: 30, duration: 45_000, xp: 5 }),
    Object.freeze({ id: 'sunflower', name: '向日葵', cost: 25, reward: 42, duration: 90_000, xp: 8 }),
  ]),
  furniture: Object.freeze([
    Object.freeze({ id: 'rug', name: '地毯', cost: 0 }),
    Object.freeze({ id: 'sofa', name: '沙发', cost: 45 }),
    Object.freeze({ id: 'plant', name: '绿植', cost: 18 }),
    Object.freeze({ id: 'lamp', name: '台灯', cost: 25 }),
    Object.freeze({ id: 'bookshelf', name: '书架', cost: 35 }),
    Object.freeze({ id: 'painting', name: '挂画', cost: 20 }),
    Object.freeze({ id: 'table', name: '桌子', cost: 28 }),
    Object.freeze({ id: 'bed', name: '床', cost: 55 }),
  ]),
});

const crops = new Map(CATALOG.crops.map(item => [item.id, item]));
const furniture = new Map(CATALOG.furniture.map(item => [item.id, item]));
const TASKS = Object.freeze([
  { id: 'feed', name: '喂团团一次', target: 1, reward: 10 },
  { id: 'water', name: '浇水两次', target: 2, reward: 12 },
  { id: 'harvest', name: '收获两次', target: 2, reward: 15 },
  { id: 'decorate', name: '布置一次小家', target: 1, reward: 10 },
  { id: 'together', name: '两个人一起照顾小家', target: 2, reward: 20 },
]);
const taskIds = new Set(TASKS.map(task => task.id));

export const ORDERS = Object.freeze([
  Object.freeze({ id: 'veggie-box', name: '邻居的蔬菜箱', needs: Object.freeze({ carrot: 3 }), reward: 18, xp: 4 }),
  Object.freeze({ id: 'berry-basket', name: '双人草莓野餐', needs: Object.freeze({ strawberry: 2 }), reward: 24, xp: 5 }),
  Object.freeze({ id: 'sunshine', name: '阳光小花束', needs: Object.freeze({ sunflower: 1, carrot: 1 }), reward: 22, xp: 5 }),
]);
const orders = new Map(ORDERS.map(order => [order.id, order]));

// Achievements award permanent badges, not extra currency or XP.
export const ACHIEVEMENTS = Object.freeze([
  Object.freeze({ id: 'green-thumb', name: '小小园艺家', description: '累计收获十株作物', metric: 'harvest', target: 10 }),
  Object.freeze({ id: 'good-neighbor', name: '暖心邻居', description: '累计完成三张订单', metric: 'orders', target: 3 }),
  Object.freeze({ id: 'arcade-duo', name: '小游戏搭档', description: '累计完成十场小游戏', metric: 'games', target: 10 }),
  Object.freeze({ id: 'gentle-care', name: '细心的陪伴', description: '累计照顾团团与花田二十次', metric: 'care', target: 20 }),
  Object.freeze({ id: 'close-hearts', name: '心意相通', description: '默契值达到一百', metric: 'bond', target: 100 }),
]);
const achievementIds = new Set(ACHIEVEMENTS.map(achievement => achievement.id));

// Read only own data properties: inherited keys and getters are not save data.
function read(object, key) {
  if (!object || typeof object !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value : {};
}

function entries(value, limit = 64) {
  if (!Array.isArray(value)) return [];
  return Array.from({ length: Math.min(value.length, limit) }, (_, index) => read(value, String(index)));
}

function integer(value, fallback = 0, max = MAX_NUMBER) {
  return Number.isSafeInteger(value) && value >= 0 && value <= max ? value : fallback;
}

function timestamp(value, fallback) {
  return integer(value, fallback, MAX_TIME);
}

function checkNow(now) {
  if (timestamp(now, null) === null) throw new RangeError('now must be a finite nonnegative integer timestamp');
  return now;
}

function day(now) {
  const parts = dayFormatter.formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}

function freshDaily(now) {
  return { date: day(now), counts: { feed: 0, water: 0, harvest: 0, decorate: 0 }, claimed: [], roles: [] };
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function stat(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, 20, 100) : fallback;
}

function nameValue(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && [...name].length <= 20 && !/[\u0000-\u001f\u007f-\u009f<>]/u.test(name) ? name : null;
}

function unique(values, allowed) {
  return [...new Set(entries(values).filter(value => allowed.has(value)))];
}

function freshAdventure(now) {
  return {
    inventory: { carrot: 0, strawberry: 0, sunflower: 0 }, bond: 0,
    totals: { harvest: 0, orders: 0, games: 0, care: 0 },
    sessions: { heok: null, xy: null }, results: { heok: null, xy: null },
    best: { catch: 0, memory: 0, fishing: 0 }, theme: 'morning',
    daily: { date: day(now), orders: [], games: { heok: 0, xy: 0 }, gifts: [] }, achievements: [],
  };
}

function sessionSeed(actor, revision, startedAt) {
  let seed = 2_166_136_261;
  for (const character of `${actor}:${revision}:${startedAt}`) {
    seed = Math.imul(seed ^ character.charCodeAt(0), 16_777_619) >>> 0;
  }
  return seed;
}

function makeSession(actor, revision, game, startedAt) {
  const seed = sessionSeed(actor, revision, startedAt);
  return { id: `${actor}:${revision}:${startedAt}:${seed}`, game, seed, startedAt };
}

function validRun(id, actor, revision, startedAt) {
  if (typeof id !== 'string' || id.length > 100) return false;
  const parts = id.split(':');
  if (parts.length !== 4 || !/^[1-9]\d*$/u.test(parts[1])) return false;
  const counter = integer(Number(parts[1]), null);
  return counter !== null && counter <= revision && id === makeSession(actor, counter, 'catch', startedAt).id;
}

function canFinish(game, score, elapsed) {
  return game === 'memory' ? elapsed >= 60_000 || (score === 6 && elapsed >= 3_000) : elapsed >= 20_000;
}

function normalizeSession(raw, actor, revision, now) {
  const source = record(raw);
  const id = read(source, 'id');
  const game = read(source, 'game');
  const seed = integer(read(source, 'seed'), null, 0xffff_ffff);
  const startedAt = timestamp(read(source, 'startedAt'), null);
  if (typeof game !== 'string' || !Object.hasOwn(ARCADE_GAMES, game) || seed === null ||
      startedAt === null || startedAt > now || now - startedAt > ARCADE_LIMITS.sessionLifetime) return null;
  if (!validRun(id, actor, revision, startedAt)) return null;
  const expectedSeed = Number(id.split(':')[3]);
  return seed === expectedSeed ? { id, game, seed, startedAt } : null;
}

function normalizeResult(raw, actor, revision, now) {
  const source = record(raw);
  const run = read(source, 'run');
  const game = read(source, 'game');
  if (typeof game !== 'string' || !Object.hasOwn(ARCADE_GAMES, game) || typeof run !== 'string' || run.length > 100) return null;
  const startedAt = timestamp(Number(run.split(':')[2]), null);
  if (startedAt === null || !validRun(run, actor, revision, startedAt)) return null;
  const maxScore = ARCADE_GAMES[game].maxScore;
  const score = integer(read(source, 'score'), null, maxScore);
  const reward = integer(read(source, 'reward'), null, 20);
  const xp = integer(read(source, 'xp'), null, 8);
  const at = timestamp(read(source, 'at'), null);
  if (read(source, 'maxScore') !== maxScore || score === null || reward === null || xp === null || at === null ||
      at > now || at < startedAt || at - startedAt > ARCADE_LIMITS.sessionLifetime || !canFinish(game, score, at - startedAt)) return null;
  if (!(reward === 0 && xp === 0) && !(reward === Math.floor(20 * score / maxScore) && xp === Math.floor(8 * score / maxScore))) return null;
  return { run, game, score, maxScore, reward, xp, at };
}

function normalizeAdventure(raw, revision, now) {
  const source = record(raw);
  const adventure = freshAdventure(now);
  const inventory = record(read(source, 'inventory'));
  for (const key of Object.keys(adventure.inventory)) adventure.inventory[key] = integer(read(inventory, key));
  adventure.bond = integer(read(source, 'bond'), 0, 10_000);
  const totals = record(read(source, 'totals'));
  for (const key of Object.keys(adventure.totals)) adventure.totals[key] = integer(read(totals, key));
  const sessions = record(read(source, 'sessions'));
  for (const actor of ACTORS) adventure.sessions[actor] = normalizeSession(read(sessions, actor), actor, revision, now);
  const results = record(read(source, 'results'));
  for (const actor of ACTORS) adventure.results[actor] = normalizeResult(read(results, actor), actor, revision, now);
  const best = record(read(source, 'best'));
  for (const game of Object.keys(ARCADE_GAMES)) adventure.best[game] = integer(read(best, game), 0, ARCADE_GAMES[game].maxScore);
  const theme = read(source, 'theme');
  if (THEMES.has(theme)) adventure.theme = theme;
  const daily = record(read(source, 'daily'));
  if (read(daily, 'date') === adventure.daily.date) {
    adventure.daily.orders = unique(read(daily, 'orders'), orders);
    adventure.daily.gifts = unique(read(daily, 'gifts'), ACTORS);
    const games = record(read(daily, 'games'));
    for (const actor of ACTORS) {
      // Saturate excessive valid counts rather than reopening a spent reward budget.
      adventure.daily.games[actor] = Math.min(ARCADE_LIMITS.dailyGames, integer(read(games, actor)));
    }
  }
  adventure.achievements = unique(read(source, 'achievements'), achievementIds);
  return adventure;
}

export function createWorld(now = Date.now()) {
  checkNow(now);
  return {
    version: 1, revision: 0, coins: 120, xp: 0,
    pet: { name: '团团', hunger: 75, happiness: 75, energy: 80, lastUpdated: now },
    plots: Array(6).fill(null), owned: ['rug'], placed: [{ id: 'rug', x: 50, y: 74 }],
    daily: freshDaily(now), journal: [], lastActions: {}, lastUpdated: now, adventure: freshAdventure(now),
  };
}

function normalizePlot(value, now) {
  const plot = record(value);
  const crop = crops.get(read(plot, 'crop'));
  const plantedAt = timestamp(read(plot, 'plantedAt'), null);
  if (!crop || plantedAt === null || plantedAt > now || plantedAt + crop.duration > MAX_TIME) return null;
  const watered = read(plot, 'watered') === true;
  const latest = plantedAt + crop.duration;
  const earliest = plantedAt + (watered ? Math.ceil(crop.duration * 0.75) : crop.duration);
  const savedReady = timestamp(read(plot, 'readyAt'), latest);
  const readyAt = savedReady >= earliest && savedReady <= latest ? savedReady : latest;
  return { crop: crop.id, plantedAt, readyAt, watered };
}

export function normalizeWorld(raw, now = Date.now()) {
  checkNow(now);
  const source = record(raw);
  const state = createWorld(now);
  if (read(source, 'version') !== 1) return state;
  for (const key of ['revision', 'coins', 'xp']) state[key] = integer(read(source, key), state[key]);
  state.lastUpdated = Math.min(now, timestamp(read(source, 'lastUpdated'), now));
  const pet = record(read(source, 'pet'));
  state.pet = {
    name: nameValue(read(pet, 'name')) || '团团',
    hunger: stat(read(pet, 'hunger'), 75), happiness: stat(read(pet, 'happiness'), 75),
    energy: stat(read(pet, 'energy'), 80),
    lastUpdated: Math.min(now, timestamp(read(pet, 'lastUpdated'), state.lastUpdated)),
  };
  const lastActions = record(read(source, 'lastActions'));
  for (const type of Object.keys(COOLDOWNS)) {
    const at = timestamp(read(lastActions, type), null);
    if (at !== null) state.lastActions[type] = Math.min(now, at);
  }
  const plots = entries(read(source, 'plots'), 6);
  state.plots = Array.from({ length: 6 }, (_, index) => normalizePlot(plots[index], now));
  state.owned = unique(read(source, 'owned'), furniture);
  if (!state.owned.includes('rug')) state.owned.unshift('rug');
  state.placed = [];
  for (const value of entries(read(source, 'placed'))) {
    const placement = record(value);
    const id = read(placement, 'id');
    const x = read(placement, 'x');
    const y = read(placement, 'y');
    if (!state.owned.includes(id) || state.placed.some(item => item.id === id) ||
        !Number.isFinite(x) || !Number.isFinite(y)) continue;
    state.placed.push({ id, x: clamp(x, 8, 92), y: clamp(y, 25, 90) });
    if (state.placed.length === 8) break;
  }
  const daily = record(read(source, 'daily'));
  if (read(daily, 'date') === state.daily.date) {
    const counts = record(read(daily, 'counts'));
    for (const key of Object.keys(state.daily.counts)) state.daily.counts[key] = integer(read(counts, key));
    state.daily.claimed = unique(read(daily, 'claimed'), taskIds);
    state.daily.roles = unique(read(daily, 'roles'), ACTORS);
  }
  state.journal = entries(read(source, 'journal')).flatMap(value => {
    const entry = record(value);
    const at = timestamp(read(entry, 'at'), null);
    const type = read(entry, 'type');
    const actor = read(entry, 'actor');
    const message = read(entry, 'message');
    return at !== null && at <= now && ACTIONS.has(type) && (actor === null || ACTORS.has(actor)) &&
      typeof message === 'string' && message.length <= 160 && !/[\u0000-\u001f<>]/u.test(message)
      ? [{ at, type, actor, message }] : [];
  }).slice(-40);
  state.adventure = normalizeAdventure(read(source, 'adventure'), state.revision, now);
  return state;
}

export function advanceWorld(raw, now = Date.now()) {
  checkNow(now);
  const savedAt = timestamp(read(record(raw), 'lastUpdated'), now);
  // Preserve a short clock rollback without double decay or reopening yesterday's rewards.
  // Imports use normalizeWorld directly; implausible future anchors are never trusted.
  const at = savedAt > now && savedAt - now <= 24 * HOUR ? savedAt : now;
  const state = normalizeWorld(raw, at);
  const hours = Math.min(24 * HOUR, Math.max(0, at - state.pet.lastUpdated)) / HOUR;
  state.pet.hunger = clamp(state.pet.hunger - hours * 3, 20, 100);
  state.pet.happiness = clamp(state.pet.happiness - hours * 2, 20, 100);
  state.pet.energy = clamp(state.pet.energy + hours * 4, 20, 100);
  state.pet.lastUpdated = at;
  state.lastUpdated = at;
  return state;
}

export function getCropStatus(plot, now = Date.now()) {
  checkNow(now);
  const value = normalizePlot(plot, now);
  if (!value) return { status: 'empty', empty: true, ready: false, crop: null, remaining: 0, progress: 0, watered: false };
  const remaining = Math.max(0, value.readyAt - now);
  return {
    status: remaining === 0 ? 'ready' : 'growing', empty: false, ready: remaining === 0,
    crop: value.crop, remaining, watered: value.watered,
    progress: clamp((now - value.plantedAt) / (value.readyAt - value.plantedAt), 0, 1),
  };
}

export function getLevel(state) {
  return 1 + Math.floor(integer(read(record(state), 'xp')) / 40);
}

function dailyTasks(state) {
  return TASKS.map(task => {
    const progress = task.id === 'together' ? state.daily.roles.length : state.daily.counts[task.id];
    return { ...task, progress, complete: progress >= task.target, claimed: state.daily.claimed.includes(task.id) };
  });
}

export function getDailyTasks(state, now = Date.now()) {
  return dailyTasks(advanceWorld(state, now));
}

export function getAdventure(raw, now = Date.now()) {
  const adventure = advanceWorld(raw, now).adventure;
  const bondLevel = 1 + Math.floor(adventure.bond / 100);
  const bondTitle = adventure.bond >= 500 ? '心有灵犀' : adventure.bond >= 200 ? '亲密搭档'
    : adventure.bond >= 100 ? '默契伙伴' : adventure.bond >= 40 ? '渐渐靠近' : '初见心动';
  return {
    ...adventure, bondLevel, bondTitle,
    limits: {
      dailyGames: ARCADE_LIMITS.dailyGames, sessionLifetime: ARCADE_LIMITS.sessionLifetime,
      gamesRemaining: Object.fromEntries([...ACTORS].map(actor => [actor, ARCADE_LIMITS.dailyGames - adventure.daily.games[actor]])),
      giftsRemaining: Object.fromEntries([...ACTORS].map(actor => [actor, adventure.daily.gifts.includes(actor) ? 0 : 1])),
      ordersRemaining: ORDERS.filter(order => !adventure.daily.orders.includes(order.id)).map(order => order.id),
    },
    achievementDisplay: ACHIEVEMENTS.map(achievement => ({
      ...achievement, earned: adventure.achievements.includes(achievement.id),
      progress: Math.min(achievement.target, achievement.metric === 'bond' ? adventure.bond : adventure.totals[achievement.metric]),
    })),
  };
}

export function applyAction(raw, rawAction, now = Date.now()) {
  const state = advanceWorld(raw, now);
  const at = state.lastUpdated;
  const action = record(rawAction);
  const type = read(action, 'type');
  const actor = read(action, 'actor');
  const fail = message => ({ state, ok: false, message });
  if (!ACTIONS.has(type)) return fail('未知的操作。');
  if (actor !== undefined && !ACTORS.has(actor)) return fail('未知的伙伴。');
  const allowedFields = NEW_ACTION_FIELDS.get(type);
  if (allowedFields && (Object.getOwnPropertyNames(action).some(key => !allowedFields.has(key)) || Object.getOwnPropertySymbols(action).length)) return fail('操作包含未知字段。');
  if (['game-start', 'game-finish', 'gift'].includes(type) && !ACTORS.has(actor)) return fail('请指定参与的伙伴。');
  if (state.revision === MAX_NUMBER) return fail('存档版本计数已达上限。');
  const cooldown = COOLDOWNS[type];
  if (cooldown !== undefined && state.lastActions[type] !== undefined && at - state.lastActions[type] < cooldown) {
    return fail('团团需要缓一缓，稍后再试。');
  }
  let coins = 0;
  let xp = 0;
  let count = null;
  let message;
  let change;
  // Require a full point of benefit; fractional decay must not reopen XP farming.
  if (type === 'feed') {
    if (state.pet.hunger > 99) return fail('团团已经吃饱了。');
    coins = -6; xp = 2; count = 'feed'; message = '团团吃得很开心。';
    change = () => { state.pet.hunger = Math.min(100, state.pet.hunger + 20); state.pet.happiness = Math.min(100, state.pet.happiness + 4); };
  } else if (type === 'play') {
    if (state.pet.energy < 30) return fail('团团需要先休息。');
    if (state.pet.happiness > 99) return fail('团团已经很开心了，稍后再玩吧。');
    xp = 2; message = '你们陪团团玩了一会儿。';
    change = () => { state.pet.energy -= 10; state.pet.happiness = Math.min(100, state.pet.happiness + 16); };
  } else if (type === 'rest') {
    if (state.pet.energy >= 100) return fail('团团已经精神满满。');
    message = '团团舒舒服服地休息了。';
    change = () => { state.pet.energy = Math.min(100, state.pet.energy + 25); };
  } else if (type === 'rename') {
    const name = nameValue(read(action, 'name'));
    if (!name) return fail('名字须为 1 至 20 个字符，不能包含控制字符或尖括号。');
    if (name === state.pet.name) return fail('团团已经叫这个名字了。');
    message = `小伙伴现在叫${name}。`;
    change = () => { state.pet.name = name; };
  } else if (['plant', 'water', 'harvest'].includes(type)) {
    const index = read(action, 'index');
    if (!Number.isInteger(index) || index < 0 || index >= 6) return fail('请选择有效的田地。');
    const plot = state.plots[index];
    if (type === 'plant') {
      const crop = crops.get(read(action, 'crop'));
      if (!crop) return fail('未知的种子。');
      if (plot) return fail('这块田已经种了作物。');
      if (at + crop.duration > MAX_TIME) return fail('种植时间超出有效范围。');
      coins = -crop.cost; message = `种下了${crop.name}。`;
      change = () => { state.plots[index] = { crop: crop.id, plantedAt: at, readyAt: at + crop.duration, watered: false }; };
    } else {
      if (!plot) return fail('这块田还没有作物。');
      const ready = plot.readyAt <= at;
      if (type === 'water') {
        if (ready) return fail('作物成熟了，可以收获了。');
        if (plot.watered) return fail('这株作物已经浇过水了。');
        count = 'water'; message = '浇水后，作物会更快成熟。';
        change = () => { plot.readyAt = at + Math.ceil((plot.readyAt - at) * 0.75); plot.watered = true; };
      } else {
        if (!ready) return fail('作物还没成熟。');
        const crop = crops.get(plot.crop);
        coins = crop.reward; xp = crop.xp; count = 'harvest'; message = `收获了${crop.name}。`;
        change = () => { state.plots[index] = null; };
      }
    }
  } else if (['buy', 'place', 'remove'].includes(type)) {
    const item = furniture.get(read(action, 'item'));
    if (!item) return fail('未知的家具。');
    const position = state.placed.findIndex(entry => entry.id === item.id);
    if (type === 'buy') {
      if (state.owned.includes(item.id)) return fail('已经拥有这件家具。');
      coins = -item.cost; message = `买下了${item.name}。`;
      change = () => { state.owned.push(item.id); };
    } else {
      if (!state.owned.includes(item.id)) return fail('请先购买这件家具。');
      if (type === 'remove') {
        if (position < 0) return fail('这件家具已经在仓库里。');
        message = `${item.name}收回了仓库。`;
        change = () => { state.placed.splice(position, 1); };
      } else {
        const x = read(action, 'x'); const y = read(action, 'y');
        if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return fail('家具位置必须是有效数字。');
        if (position < 0 && state.placed.length >= 8) return fail('小家最多摆放八件家具。');
        const placement = { id: item.id, x: clamp(x, 8, 92), y: clamp(y, 25, 90) };
        if (position >= 0 && state.placed[position].x === placement.x && state.placed[position].y === placement.y) return fail('家具已经在这个位置了。');
        count = 'decorate'; message = `布置了${item.name}。`;
        change = () => { if (position < 0) state.placed.push(placement); else state.placed[position] = placement; };
      }
    }
  } else if (type === 'claim') {
    const task = dailyTasks(state).find(entry => entry.id === read(action, 'task'));
    if (!task) return fail('未知的每日任务。');
    if (task.claimed) return fail('今天已经领取过这个奖励。');
    if (!task.complete) return fail('这个任务还没完成。');
    coins = task.reward; message = `领取了每日任务奖励：${task.name}。`;
    change = () => { state.daily.claimed.push(task.id); };
  } else if (type === 'game-start') {
    const game = read(action, 'game');
    if (typeof game !== 'string' || !Object.hasOwn(ARCADE_GAMES, game)) return fail('未知的小游戏。');
    if (at > now) return fail('时钟回拨期间不能开始小游戏。');
    const session = makeSession(actor, state.revision + 1, game, now);
    message = '开始小游戏。';
    change = () => { state.adventure.sessions[actor] = session; };
  } else if (type === 'game-finish') {
    const session = state.adventure.sessions[actor];
    if (!session || read(action, 'run') !== session.id) return fail('小游戏会话无效或已经结束。');
    const result = evaluateChallenge(session, read(action, 'inputs'), now - session.startedAt);
    if (!result.ok) return fail(result.message);
    if (!canFinish(session.game, result.score, now - session.startedAt)) return fail('小游戏还没达到可结算条件。');
    const rewarded = state.adventure.daily.games[actor] < ARCADE_LIMITS.dailyGames;
    if (rewarded) {
      coins = Math.floor(20 * result.score / result.maxScore);
      xp = Math.floor(8 * result.score / result.maxScore);
    }
    message = `${result.message}${rewarded ? '' : '今天的奖励次数已用完，本局为练习。'}`;
    change = () => {
      state.adventure.sessions[actor] = null;
      state.adventure.results[actor] = {
        run: session.id, game: session.game, score: result.score, maxScore: result.maxScore, reward: coins, xp, at: now,
      };
      state.adventure.best[session.game] = Math.max(state.adventure.best[session.game], result.score);
      state.adventure.totals.games += 1;
      if (rewarded) {
        state.adventure.daily.games[actor] += 1;
        if (result.score > 0) state.adventure.bond = Math.min(10_000, state.adventure.bond + 3);
      }
    };
  } else if (type === 'order') {
    const order = orders.get(read(action, 'order'));
    if (!order) return fail('未知的订单。');
    if (state.adventure.daily.orders.includes(order.id)) return fail('今天已完成这张订单。');
    if (Object.entries(order.needs).some(([crop, amount]) => state.adventure.inventory[crop] < amount)) return fail('仓库里的作物不足。');
    coins = order.reward; xp = order.xp; message = `完成订单：${order.name}。`;
    change = () => {
      for (const [crop, amount] of Object.entries(order.needs)) state.adventure.inventory[crop] -= amount;
      state.adventure.daily.orders.push(order.id);
      state.adventure.totals.orders += 1;
    };
  } else if (type === 'gift') {
    if (state.adventure.daily.gifts.includes(actor)) return fail('今天已经送过心意了。');
    message = '送出一份小心意，默契更近了一步。';
    change = () => {
      state.adventure.daily.gifts.push(actor);
      state.adventure.bond = Math.min(10_000, state.adventure.bond + 8);
    };
  } else {
    const theme = read(action, 'theme');
    if (!THEMES.has(theme)) return fail('未知的小家主题。');
    if (state.adventure.theme === theme) return fail('已经使用这个主题了。');
    message = '换上了新的小家主题。';
    change = () => { state.adventure.theme = theme; };
  }
  if (state.coins + coins < 0) return fail('金币不足。');
  if (!Number.isSafeInteger(state.coins + coins) || !Number.isSafeInteger(state.xp + xp) ||
      (count && state.daily.counts[count] === MAX_NUMBER)) return fail('存档数值已达上限。');
  const care = ['feed', 'play', 'rest', 'water'].includes(type);
  const metric = care ? 'care' : type === 'harvest' ? 'harvest' : type === 'order' ? 'orders' : type === 'game-finish' ? 'games' : null;
  if ((metric && state.adventure.totals[metric] === MAX_NUMBER) ||
      (type === 'harvest' && state.adventure.inventory[state.plots[read(action, 'index')].crop] === MAX_NUMBER)) return fail('冒险数值已达上限。');
  // Capture the crop before the basic harvest clears its plot.
  const harvestedCrop = type === 'harvest' ? state.plots[read(action, 'index')].crop : null;
  change();
  if (harvestedCrop) {
    state.adventure.inventory[harvestedCrop] += 1;
    state.adventure.totals.harvest += 1;
  }
  if (care) {
    state.adventure.totals.care += 1;
    state.adventure.bond = Math.min(10_000, state.adventure.bond + 2);
  }
  if (metric || type === 'gift') {
    for (const achievement of ACHIEVEMENTS) {
      const progress = achievement.metric === 'bond' ? state.adventure.bond : state.adventure.totals[achievement.metric];
      if (progress >= achievement.target && !state.adventure.achievements.includes(achievement.id)) state.adventure.achievements.push(achievement.id);
    }
  }
  state.coins += coins;
  state.xp += xp;
  if (count) state.daily.counts[count] += 1;
  if (cooldown !== undefined) state.lastActions[type] = at;
  if (actor && !state.daily.roles.includes(actor)) state.daily.roles.push(actor);
  state.revision += 1;
  state.journal.push({ at, type, actor: actor || null, message });
  state.journal = state.journal.slice(-40);
  return { state, ok: true, message };
}

// Local save repair is not authorization: cloud callers must authenticate actors
// and own balances, timestamps, revisions, and action-id deduplication server-side.
export function serializeWorld(state, now = Date.now()) {
  return JSON.stringify(normalizeWorld(state, now));
}

export function importWorld(text, now = Date.now()) {
  checkNow(now);
  if (typeof text !== 'string' || text.length > 100_000) throw new TypeError('Save must be a JSON string of at most 100000 characters');
  const parsed = JSON.parse(text);
  if (read(record(parsed), 'version') !== 1) throw new TypeError('Unsupported save version');
  return normalizeWorld(parsed, now);
}
