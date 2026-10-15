/**
 * The app's own agent: Pi (`@earendil-works/pi-coding-agent`, MIT) run through its SDK, in a process of its own,
 * speaking ACP on stdin/stdout like the person's Codex and Claude Code adapters do, so the chat takes it the same way
 * (agents.mjs starts it with Electron as Node).
 *
 * What it runs with comes in OPENFILM_PI (JSON; pi-config.mjs): its own folder (`agentDir`: Pi's models and settings,
 * never the person's ~/.pi), the person's models (`models`, each its own service with its key in a variable, its name,
 * the model asked for and its reasoning efforts: pi-config.mjs OwnModel; `model` the id of the one a session starts
 * on; the chat switches between them with the session's `model` option, and a model's efforts with `effort`, for one
 * offering more than one; `auto` sends none), and its whole system prompt (agents.mjs ownAgentPrompt), in place of Pi's. Of the project's instructions only its own AGENTS.md (or CLAUDE.md) is read, not
 * the folders above it; no SYSTEM.md; of skills only OpenFilm's (`skills`: their folder and names, agent-skills.mjs). Besides Pi's read, bash, edit and write it has `ask`: questions for
 * the person, with options, shown in the chat as Claude Code's and Codex's are (an ACP form).
 *
 * A conversation's session is kept with the project it is about (chat-store.mjs: `.film/chat/agent/`), so it goes
 * where the project goes. Each prompt may name, in `_meta.openfilm`, the turn's log: each request to the model (its whole
 * context, as Pi sends it, and the answer) is written there (chat-store.mjs's `<turn>.model.jsonl`), only what is new
 * since the request before.
 *
 * What Pi does goes to the chat as ACP session updates: its words and thinking as they stream, each tool call (its
 * kind, title and input) and its result, and after each answer how full the context is.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, createAgentSession } from '@earendil-works/pi-coding-agent';
import { agentSessionsDir, openLog } from './chat-store.mjs';
import { THINKING, contextUsed, effortOption, modelOption, modelsJson, providerOf, stopReason, toolCall, toolContent } from './pi-config.mjs';

/* stdout is the protocol's: anything else Pi or a library prints goes to stderr */
console.log = console.info = console.warn = console.debug = (...args) => process.stderr.write(`${args.map(String).join(' ')}\n`);

const config = JSON.parse(process.env.OPENFILM_PI ?? '{}');
/** OpenFilm's skills for this session (agent-skills.mjs): Pi loads these and no others */
const ownSkills = { paths: Array.isArray(config.skills?.paths) ? config.skills.paths : [], names: Array.isArray(config.skills?.names) ? config.skills.names : [] };
const VERSION = '1.1.0';
/** @type {import('./pi-config.mjs').OwnModel[]} */
const models = Array.isArray(config.models) ? config.models : [];
const byId = new Map(models.map((m) => [m.id, m]));
const startModel = byId.has(config.model) ? config.model : models[0]?.id;

mkdirSync(config.agentDir, { recursive: true });
const modelsPath = join(config.agentDir, 'models.json');
writeFileSync(modelsPath, JSON.stringify(modelsJson(models), null, 2));
const modelRuntime = await ModelRuntime.create({ authPath: join(config.agentDir, 'auth.json'), modelsPath });

/** Each open session: Pi's, the turn being logged, and its model (the id) and effort as the chat names them. */
const sessions = new Map();

/** Pi's model for one of the person's and an effort: its service as itself for `auto` (no reasoning setting), else thinking. */
function piModel(/** @type {string} */ id, /** @type {string} */ effort) {
  const own = byId.get(id);
  const model = own && modelRuntime.getModel(effort === 'auto' ? providerOf(id) : THINKING(providerOf(id)), own.model);
  if (!model) throw new Error(`No model ${own?.name ?? id}.`);
  return model;
}

/** Which of the person's models Pi's model is (a conversation taken up again names its provider), and whether thinking. */
function ownOf(/** @type {any} */ piModelNow) {
  const provider = String(piModelNow?.provider ?? '');
  const thinking = models.some((m) => provider === THINKING(providerOf(m.id)));
  const own = models.find((m) => provider === providerOf(m.id) || provider === THINKING(providerOf(m.id)));
  return { id: own?.id ?? null, thinking };
}

/** The session's options: the model, and its effort when it offers more than one. */
const optionsOf = (/** @type {{ model: string, effort: string }} */ entry) =>
  [modelOption(models, entry.model), effortOption(byId.get(entry.model)?.levels ?? ['auto'], entry.effort)].filter(Boolean);

/** Put a session on a model and an effort. */
async function use(/** @type {any} */ entry, /** @type {string} */ model, /** @type {string} */ effort) {
  await entry.session.setModel(piModel(model, effort));
  if (effort !== 'auto') entry.session.setThinkingLevel(effort);
  entry.model = model;
  entry.effort = effort;
}

/** The model log of a turn: each request's context and its answer, only what is new since the last request. */
function modelLog(cwd, turnId) {
  const file = openLog(cwd, turnId, (e) => process.stderr.write(`model log: ${e.message}\n`), '.model');
  let keys = [];
  let system = 'null';
  let tools = 'null';
  return {
    write({ startedAt, messages, toolsNow, answer }) {
      const all = messages.map((m) => JSON.stringify(m));
      let prefix = 0;
      while (prefix < keys.length && prefix < all.length && keys[prefix] === all[prefix]) prefix += 1;
      const toolsKey = JSON.stringify(toolsNow);
      const systemKey = JSON.stringify(answer?.systemPrompt ?? null);
      file.write('call', {
        startedAt, ms: Date.now() - startedAt, prefix, messages: messages.slice(prefix),
        ...(toolsKey !== tools ? { tools: toolsNow } : {}), ...(systemKey !== system ? { systemPrompt: answer?.systemPrompt ?? null } : {}),
        answer: answer?.message ?? null,
      });
      keys = all;
      tools = toolsKey;
      system = systemKey;
    },
    end: () => file.end(),
  };
}

async function open(client, cwd, resumeId) {
  const sessionDir = agentSessionsDir(cwd);
  const file = resumeId ? SessionManager.findById(cwd, resumeId, sessionDir) : null;
  if (resumeId && !file) throw new Error('That conversation is not here any more.');
  const sessionManager = file ? SessionManager.open(file, sessionDir) : SessionManager.create(cwd, sessionDir);
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: true, maxRetries: 2 } });
  /* the request about to go: its whole context, for the turn's log */
  let pending = null;
  /* the session's id, once it has one: the questions `ask` puts are the session's */
  let sessionId = null;
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir: config.agentDir, settingsManager, noExtensions: true, noPromptTemplates: true, noThemes: true,
    /* OpenFilm's skills, and no other Pi would find (in the project, or its own folders) */
    noSkills: !ownSkills.names.length, additionalSkillPaths: ownSkills.paths,
    skillsOverride: (base) => ({ ...base, skills: base.skills.filter((skill) => ownSkills.names.includes(skill.name)) }),
    systemPromptOverride: () => config.systemPrompt,
    appendSystemPromptOverride: () => [],
    agentsFilesOverride: ({ agentsFiles }) => ({ agentsFiles: agentsFiles.filter((f) => dirname(resolve(f.path)) === resolve(cwd)) }),
    extensionFactories: [
      { name: 'openfilm-log', hidden: true, factory: (pi) => {
        pi.on('context_with_system', (event) => { pending = { startedAt: Date.now(), messages: event.messages }; });
      } },
      { name: 'openfilm-ask', hidden: true, factory: (pi) => pi.registerTool(askTool(client, () => sessionId)) },
    ],
  });
  await resourceLoader.reload();
  const startEffort = byId.get(startModel)?.effort ?? 'auto';
  const { session } = await createAgentSession({
    cwd, agentDir: config.agentDir, modelRuntime, model: piModel(startModel, startEffort),
    ...(startEffort !== 'auto' ? { thinkingLevel: startEffort } : {}),
    resourceLoader, sessionManager, settingsManager, tools: ['read', 'bash', 'edit', 'write', 'ask'],
  });
  /* what it runs on now, as the chat names it (a conversation taken up again may be on another model and effort) */
  const now = ownOf(session.model);
  const onModel = now.id ?? startModel;
  const levels = byId.get(onModel)?.levels ?? ['auto'];
  const entry = { session, log: null, model: onModel,
    effort: now.thinking && levels.includes(session.thinkingLevel) ? session.thinkingLevel : !now.thinking && levels.includes('auto') ? 'auto' : byId.get(onModel)?.effort ?? 'auto' };
  /* a conversation taken up again on a model no longer set up: on the one a session starts on */
  if (!now.id) await use(entry, onModel, entry.effort);
  sessionId = session.sessionId;
  const send = (update) => { void client.sessionUpdate({ sessionId, update }).catch(() => {}); };

  session.subscribe((event) => {
    switch (event.type) {
      case 'message_update': {
        const e = event.assistantMessageEvent;
        if (e.type === 'text_delta') send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: e.delta } });
        else if (e.type === 'thinking_delta') send({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: e.delta } });
        break;
      }
      case 'message_end': {
        const message = event.message;
        if (message?.role !== 'assistant') break;
        if (pending && entry.log) {
          const toolsNow = (session.agent?.state?.tools ?? []).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
          entry.log.write({ startedAt: pending.startedAt, messages: pending.messages, toolsNow, answer: { message, systemPrompt: session.systemPrompt } });
        }
        pending = null;
        const used = contextUsed(message, session.model);
        if (used) send({ sessionUpdate: 'usage_update', ...used });
        break;
      }
      case 'tool_execution_start':
        send({ sessionUpdate: 'tool_call', toolCallId: event.toolCallId, status: 'in_progress', ...toolCall(event.toolName, event.args) });
        break;
      case 'tool_execution_update': {
        const content = toolContent(event.partialResult);
        if (content.length) send({ sessionUpdate: 'tool_call_update', toolCallId: event.toolCallId, content });
        break;
      }
      case 'tool_execution_end':
        send({ sessionUpdate: 'tool_call_update', toolCallId: event.toolCallId, status: event.isError ? 'failed' : 'completed',
          content: toolContent(event.result), rawOutput: event.result?.content?.filter?.((b) => b?.type === 'text').map((b) => b.text).join('\n') ?? '' });
        break;
      default: break;
    }
  });
  sessions.set(sessionId, entry);
  return { sessionId, configOptions: optionsOf(entry), modes: null };
}

/**
 * `ask`: the agent's questions to the person, each with its options and room for their own words, as an ACP form (the
 * shape agents.mjs formQuestions reads: a field per question, a choice a `oneOf`, beside it a field for the person's own
 * words). Resolves with what they answered, or that they skipped it.
 */
function askTool(client, sessionOf) {
  return {
    name: 'ask',
    label: 'Ask',
    description: 'Ask the person one to three questions, each with two to five short options to choose from; they can also '
      + 'answer in their own words. The turn waits for the answer. Only for a choice you cannot make well yourself.',
    parameters: {
      type: 'object',
      required: ['questions'],
      properties: {
        questions: {
          type: 'array', minItems: 1, maxItems: 3,
          items: {
            type: 'object',
            required: ['question', 'options'],
            properties: {
              question: { type: 'string', description: 'The question, as a full sentence.' },
              header: { type: 'string', description: 'A label of a few words.' },
              options: {
                type: 'array', minItems: 2, maxItems: 5,
                items: { type: 'object', required: ['label'], properties: { label: { type: 'string' }, description: { type: 'string' } } },
              },
              multiSelect: { type: 'boolean', description: 'More than one option may be chosen.' },
            },
          },
        },
      },
    },
    async execute(toolCallId, params) {
      const questions = (params?.questions ?? []).slice(0, 3);
      const properties = {};
      questions.forEach((q, i) => {
        const choices = (q.options ?? []).map((o) => ({ const: String(o.label), title: String(o.label), ...(o.description ? { description: String(o.description) } : {}) }));
        properties[`q${i}`] = q.multiSelect
          ? { type: 'array', title: q.header ?? '', description: q.question, items: { anyOf: choices } }
          : { type: 'string', title: q.header ?? '', description: q.question, oneOf: choices };
        properties[`q${i}_own`] = { type: 'string', title: 'In your own words', _meta: { _askUserQuestionCustomAnswer: { questionId: `q${i}` } } };
      });
      const reply = await client.createElicitation({
        sessionId: sessionOf(), toolCallId, mode: 'form', message: questions[0]?.question ?? '',
        requestedSchema: { type: 'object', properties },
      }).catch(() => ({ action: 'cancel' }));
      const said = reply.action === 'accept' ? questions.map((q, i) => {
        const own = reply.content?.[`q${i}_own`];
        const chosen = reply.content?.[`q${i}`];
        const answer = typeof own === 'string' && own.trim() ? own.trim() : Array.isArray(chosen) ? chosen.join(', ') : chosen;
        return `${q.question}\n${answer ? `Answer: ${answer}` : 'Not answered: decide yourself and say what you chose.'}`;
      }) : ['The person skipped the questions: decide yourself and say what you chose.'];
      return { content: [{ type: 'text', text: said.join('\n\n') }], details: {} };
    },
  };
}

/** A prompt's blocks as Pi takes them: its text (files named by their path) and its pictures. */
function promptOf(blocks) {
  const text = [];
  const images = [];
  for (const b of blocks ?? []) {
    if (b?.type === 'text') text.push(b.text);
    else if (b?.type === 'image' && b.data) images.push({ type: 'image', data: b.data, mimeType: b.mimeType ?? 'image/png' });
    else if (b?.type === 'resource_link') text.push(`@${b.uri?.replace(/^file:\/\//, '') ?? b.name}`);
    else if (b?.type === 'resource' && typeof b.resource?.text === 'string') text.push(`<file path="${b.resource.uri}">\n${b.resource.text}\n</file>`);
  }
  return { text: text.join('\n'), images };
}

const connection = new acp.AgentSideConnection((client) => ({
  async initialize() {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false, promptCapabilities: { image: true, embeddedContext: true }, sessionCapabilities: { resume: {} } },
      agentInfo: { name: 'pi', title: 'Pi', version: VERSION },
      authMethods: [],
    };
  },
  async authenticate() { return {}; },
  async newSession(params) { return open(client, params.cwd, null); },
  async resumeSession(params) { return open(client, params.cwd, params.sessionId); },
  async prompt(params) {
    const entry = sessions.get(params.sessionId);
    if (!entry) throw new Error('This conversation has ended.');
    const { session } = entry;
    const meta = params._meta?.openfilm ?? {};
    entry.log = typeof meta.turnId === 'string' && typeof meta.cwd === 'string' ? modelLog(meta.cwd, meta.turnId) : null;
    try {
      const { text, images } = promptOf(params.prompt);
      await session.prompt(text, images.length ? { images } : undefined);
      const last = [...session.messages].reverse().find((m) => m.role === 'assistant');
      return { stopReason: stopReason(last) };
    } finally {
      entry.log?.end();
      entry.log = null;
    }
  },
  async setSessionConfigOption(params) {
    const entry = sessions.get(params.sessionId);
    if (!entry) throw new Error('This conversation has ended.');
    if (params.configId === 'model') {
      const model = String(params.value);
      const own = byId.get(model);
      if (!own) throw new Error(`No model ${model}.`);
      /* the effort it was on, when this model takes it; else the one this model starts on */
      await use(entry, model, own.levels.includes(entry.effort) ? entry.effort : own.effort);
    } else if (params.configId === 'effort') {
      const effort = String(params.value);
      if (!(byId.get(entry.model)?.levels ?? []).includes(effort)) throw new Error(`${byId.get(entry.model)?.name ?? entry.model} does not take the effort ${effort}.`);
      await use(entry, entry.model, effort);
    } else throw new Error(`No option ${params.configId}.`);
    return { configOptions: optionsOf(entry) };
  },
  async cancel(params) { await sessions.get(params.sessionId)?.session.abort(); },
  async closeSession(params) {
    sessions.get(params.sessionId)?.session.dispose();
    sessions.delete(params.sessionId);
  },
}), acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));

await connection.closed;
for (const { session } of sessions.values()) session.dispose();
process.exit(0);
