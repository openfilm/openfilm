/**
 * What the system notifications for the chat's turns say (turn-notices.mjs), in each of Studio's languages: the
 * project is the title, `{agent}` the agent's name (`agent` for the app's own, which has none), `{error}` why a turn
 * stopped.
 */
export const TURN_NOTICE_WORDS = {
  en: { agent: 'The agent', done: '{agent} has finished.', failed: '{agent} stopped: {error}', asking: '{agent} is waiting for your answer.' },
  'zh-CN': { agent: '智能体', done: '{agent} 做完了。', failed: '{agent} 中断了：{error}', asking: '{agent} 在等你回答。' },
  ja: { agent: 'エージェント', done: '{agent} が完了しました。', failed: '{agent} が中断しました：{error}', asking: '{agent} があなたの回答を待っています。' },
  ko: { agent: '에이전트', done: '{agent}이(가) 끝냈습니다.', failed: '{agent}이(가) 중단되었습니다: {error}', asking: '{agent}이(가) 답을 기다리고 있습니다.' },
  es: { agent: 'El agente', done: '{agent} ha terminado.', failed: '{agent} se detuvo: {error}', asking: '{agent} está esperando tu respuesta.' },
};
