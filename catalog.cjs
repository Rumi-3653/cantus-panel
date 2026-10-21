'use strict';
function backgroundReason(s) {
  const title = (s.title || '').trim();
  // Explicit test fixtures only; ordinary user conversations about testing stay visible.
  if (s.fixture === true ||
      (s.managed && /^(?:Isolated continuity test\. Remember this private test marker:|Isolated Cantus web engineering test\.|Isolated UI permission test\. Work ONLY in this new empty|This is an isolated Cantus engineering test\.)/.test(title))) return '隔離驗證對話';
  if (s.managed) return '';
  if (s.isSubagent || (s.agentPath && s.agentPath !== '/root' && s.agentPath.startsWith('/root/'))) return '子代理';
  if (['subagent','guardian_review','background','automation','scheduled_task','heartbeat'].includes(s.threadSource)) return '背景來源：' + s.threadSource;
  // exec is also the desktop's user-thread runner. Never hide it by itself.
  if (s.threadSource === 'cli' && s.sourceKind === 'exec') return '非互動 CLI';
  if (s.provider === 'claude' && s.source !== 'Claude Desktop' && s.entrypoint === 'sdk-cli') return 'SDK 背景來源';
  // Some delegated CLI runs are indexed as user/exec. Match their explicit
  // dispatch envelopes, never exec, a worktree, or a generic review/test word alone.
  if (s.provider === 'codex' && s.sourceKind === 'exec' &&
      /^(?:You are Codex being delegated by Claude Code as a write-capable implementation agent\.|<codex_delegation>)(?:\r?\n|$)/.test(title)) return '代理派工／審核';
  return '';
}
function presentCatalog(catalog, managed, includeBackground = false) {
  const all = [...managed, ...catalog.sessions].map(s => ({...s, title:typeof s.title==='string'?s.title.slice(0,300):s.title, backgroundReason:backgroundReason(s)}));
  const hiddenCount = all.filter(s => s.backgroundReason).length;
  const sessions = includeBackground ? all : all.filter(s => !s.backgroundReason);
  return {...catalog, sessions, hiddenCount, includeBackground,
    providers:catalog.providers.map(p=>({...p,count:sessions.filter(s=>s.provider===p.provider).length}))};
}
module.exports={backgroundReason,presentCatalog};
