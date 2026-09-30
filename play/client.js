export class WorldClient {
  constructor(base, fetcher = (...args) => fetch(...args)) {
    this.base = base?.replace(/\/$/, '');
    this.fetcher = fetcher;
    this.pending = null;
  }
  async request(path, code, body) {
    if (!this.base) throw new Error('云端尚未上线，现在可以先玩本地版。');
    const response = await this.fetcher(`${this.base}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(code ? { 'X-Room-Code': code } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12000), cache: 'no-store', referrerPolicy: 'no-referrer'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || '连接失败，请稍后重试。');
    return data;
  }
  create() { return this.request('rooms', null, {}); }
  read(code) { return this.request('world', code); }
  async act(code, actor, action) {
    // An uncertain response must retry the same action ID, never spend twice.
    this.pending ??= { code, body: { id: crypto.randomUUID(), actor, action } };
    if (this.pending.code !== code) throw new Error('请先完成上一个小家的操作。');
    const result = await this.request('action', code, this.pending.body);
    this.pending = null;
    return result;
  }
}
