export const ARCADE_LIMITS = Object.freeze({ dailyGames: 5, sessionLifetime: 300_000, maxInputs: 128, maxInputLength: 4_096 });
export const ARCADE_GAMES = Object.freeze({
  catch: Object.freeze({ duration: 20_000, maxScore: 15 }),
  memory: Object.freeze({ duration: 60_000, maxScore: 6 }),
  fishing: Object.freeze({ duration: 20_000, maxScore: 5 }),
});

function read(value, key) {
  if (!value || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function gameRule(game) {
  return typeof game === 'string' && Object.hasOwn(ARCADE_GAMES, game) ? ARCADE_GAMES[game] : null;
}

// Unsigned 32-bit arithmetic has identical results in browser, Node, and Deno.
function randomGenerator(seed) {
  let value = seed >>> 0;
  return max => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return Math.floor((value / 4_294_967_296) * max);
  };
}

export function getChallenge(session) {
  const game = read(session, 'game');
  const seed = read(session, 'seed');
  const rule = gameRule(game);
  if (!rule || !Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) return null;
  const random = randomGenerator(seed);
  if (game === 'catch') return {
    duration: rule.duration,
    targets: Array.from({ length: 15 }, (_, index) => ({ at: 1_000 + index * 1_200, lane: random(3) })),
  };
  if (game === 'fishing') return {
    duration: rule.duration,
    targets: Array.from({ length: 5 }, (_, index) => ({ at: (index + 1) * 3_000, width: 600 + random(201) })),
  };
  const deck = Array.from({ length: 12 }, (_, index) => index % 6);
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const other = random(index + 1);
    [deck[index], deck[other]] = [deck[other], deck[index]];
  }
  return { duration: rule.duration, deck };
}

export function evaluateChallenge(session, inputs, elapsed) {
  const challenge = getChallenge(session);
  const game = read(session, 'game');
  const maxScore = gameRule(game)?.maxScore || 0;
  const fail = message => ({ ok: false, score: 0, maxScore, message });
  if (!challenge) return fail('无效的小游戏会话。');
  if (!Number.isSafeInteger(elapsed) || elapsed < 0 || elapsed > ARCADE_LIMITS.sessionLifetime) return fail('无效或已过期的游戏时间。');
  if (typeof inputs !== 'string' || inputs.length > ARCADE_LIMITS.maxInputLength) return fail('游戏输入过长或格式错误。');
  const tokens = inputs === '' ? [] : inputs.split(',');
  if (tokens.length > ARCADE_LIMITS.maxInputs) return fail('游戏输入次数过多。');
  const pattern = game === 'fishing' ? /^(0|[1-9]\d*)$/u
    : game === 'catch' ? /^(0|[1-9]\d*):([0-2])$/u : /^(0|[1-9]\d*):([0-9]|1[01])$/u;
  const events = [];
  let previous = -1;
  for (const token of tokens) {
    if (!pattern.test(token)) return fail('游戏输入格式错误。');
    const [at, index] = token.split(':').map(Number);
    // There is no tolerance for client timestamps beyond actual server elapsed time.
    if (!Number.isSafeInteger(at) || at <= previous || at > challenge.duration || at > elapsed) return fail('游戏输入时间无效。');
    previous = at;
    events.push({ at, index });
  }
  let score = 0;
  if (game === 'memory') {
    const matched = new Set();
    let first = null;
    for (const event of events) {
      if (matched.has(event.index) || first === event.index) return fail('不能重复翻开已配对或当前翻开的卡片。');
      if (first === null) first = event.index;
      else {
        if (challenge.deck[first] === challenge.deck[event.index]) {
          matched.add(first); matched.add(event.index); score += 1;
        }
        first = null;
      }
    }
  } else {
    const hit = new Set();
    for (const event of events) {
      const index = challenge.targets.findIndex((target, targetIndex) => !hit.has(targetIndex) &&
        Math.abs(event.at - target.at) <= (game === 'catch' ? 450 : target.width / 2) &&
        (game !== 'catch' || event.index === target.lane));
      if (index >= 0) { hit.add(index); score += 1; }
    }
  }
  return { ok: true, score, maxScore, message: `小游戏得分 ${score}/${maxScore}。` };
}
