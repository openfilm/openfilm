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
 * the folders above it; no SYSTEM.md; of skills only OpenFilm's (`skills`: their folder and names, agent-skills.mjs). Besides Pi's read, bash (PowerShell on Windows: pi-config.mjs agentTools), edit and write it has `ask`: questions for
 * the person, with options, shown in the chat as Claude Code's and Codex's are (an ACP form).
 *
 * A conversation's session is kept with the project it is about (chat-store.mjs: `.film/chat/agent/`), so it goes
 * where the project goes. Each prompt may name, in `_meta.openfilm`, the turn's log: each request to the model (its whole
 * context, as Pi sends it, and the answer) is written there (chat-store.mjs's `<turn>.model.jsonl`), only what is new
 * since the request before.
 *
 * Pictures stay unchanged until a request reaches its size/count limit, then a batch of the oldest is left out with
 * room for more (Claude Code's strategy, pi-config.mjs). Pi's custom session entries remember the omissions, including
 * across restoration and compaction. Tool pictures are reduced before Pi saves them. A service refusing a request as too large (HTTP 413, a proxy's page included) is
 * tried again once with half of those pictures, as Pi tries a busy one; that half stays the conversation's limit. A
 * request with no pictures in it is not tried again: its own words are too large, and the turn says so.
 *
 * What Pi does goes to the chat as ACP session updates: its words and thinking as they stream, each tool call (its
 * kind, title and input) and its result, after each answer how full the context is, and a model service tried again.
 */
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, createAgentSession, formatDimensionNote, resizeImage } from '@earendil-works/pi-coding-agent';
import { EnvHttpProxyAgent, install, setGlobalDispatcher } from 'undici';
import { agentSessionsDir, openLog } from './chat-store.mjs';
import { connectorTools } from './pi-connectors.mjs';
import { connectionDetails, observeModelTransport } from './model-transport.mjs';
import { IMAGE_BUDGET, THINKING, TOO_LARGE, WAIT_MINUTES, agentTools, contextUsed, effortOption, fitImages, isModelConnectionError, modelOption, modelsJson, providerOf, retryNotice, stopReason, toolCall, toolContent } from './pi-config.mjs';

/* stdout is the protocol's: anything else Pi or a library prints goes to stderr */
console.log = console.info = console.warn = console.debug = (...args) => process.stderr.write(`${args.map(String).join(' ')}\n`);

/* some services think quietly for minutes before they answer: wait that long for a byte (Node's fetch stops at 5
   minutes), with fetch and its connections from one undici, as Pi's own command line sets them */
const WAIT_MS = WAIT_MINUTES * 60_000;
const PROGRESS_MS = 2 * 60_000;
const TOOL_IMAGE_SIDE = 768;
const TOOL_IMAGE_BYTES = 96 * 1024;
/* environment.mjs passes on the person's proxy; a plain Agent would silently bypass it. */
setGlobalDispatcher(new EnvHttpProxyAgent({
  headersTimeout: WAIT_MS, bodyTimeout: WAIT_MS, proxyTunnel: true,
  connect: { autoSelectFamilyAttemptTimeout: 2000 },
}));
install();

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

/* The models' keys, in this process's memory only: they come on a pipe of their own (fd 3, agents.mjs KEYS_FD), not
   the environment, which every command Pi runs (bash) inherits. One still in the environment (Pi started by hand) is
   taken out of it. */
const keys = await new Promise((resolve) => {
  const chunks = [];
  const pipe = createReadStream('', { fd: 3 });
  pipe.on('data', (chunk) => chunks.push(chunk));
  pipe.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve({}); } });
  pipe.on('error', () => resolve({}));
});
for (const m of models) {
  const key = typeof keys[m.keyEnv] === 'string' && keys[m.keyEnv] ? keys[m.keyEnv] : process.env[m.keyEnv];
  delete process.env[m.keyEnv];
  if (!key) continue;
  await modelRuntime.setRuntimeApiKey(providerOf(m.id), key);
  if (m.levels.some((l) => l !== 'auto')) await modelRuntime.setRuntimeApiKey(THINKING(providerOf(m.id)), key);
}

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
    write({ startedAt, messages, imageContext, toolsNow, answer, modelConnection }) {
      const all = messages.map((m) => JSON.stringify(m));
      let prefix = 0;
      while (prefix < keys.length && prefix < all.length && keys[prefix] === all[prefix]) prefix += 1;
      const toolsKey = JSON.stringify(toolsNow);
      const systemKey = JSON.stringify(answer?.systemPrompt ?? null);
      file.write('call', {
        startedAt, ms: Date.now() - startedAt, prefix, messages: messages.slice(prefix),
        ...(imageContext?.removed ? { imageContext } : {}),
        ...(modelConnection ? { modelConnection } : {}),
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

async function open(client, cwd, resumeId, mcpServers = []) {
  const sessionDir = agentSessionsDir(cwd);
  const file = resumeId ? SessionManager.findById(cwd, resumeId, sessionDir) : null;
  if (resumeId && !file) throw new Error('That conversation is not here any more.');
  const sessionManager = file ? SessionManager.open(file, sessionDir) : SessionManager.create(cwd, sessionDir);
  const settingsManager = SettingsManager.inMemory({ httpIdleTimeoutMs: WAIT_MS, retry: { enabled: true, maxRetries: 2 } });
  /* the request about to go: its whole context, for the turn's log */
  let pending = null;
  const transport = { host: null, attempt: null };
  /* the session's id, once it has one: the questions `ask` puts are the session's */
  let sessionId = null;
  /* the pictures a request carries at most (pi-config.mjs IMAGE_BUDGET), and those the last one carried (bytes) */
  let imageBudget = IMAGE_BUDGET;
  const omittedImages = new Set();
  const imageContextType = 'openfilm-image-context';
  for (const entry of sessionManager.getBranch()) {
    if (entry.type !== 'custom' || entry.customType !== imageContextType) continue;
    for (const key of Array.isArray(entry.data?.omitted) ? entry.data.omitted : []) if (typeof key === 'string') omittedImages.add(key);
    if (Number.isInteger(entry.data?.budget) && entry.data.budget >= 0) imageBudget = Math.min(imageBudget, entry.data.budget);
  }
  const saveImageContext = (omitted = []) => sessionManager.appendCustomEntry(imageContextType, { omitted, budget: imageBudget });
  /* A 413 already halves the budget; that recovery need not halve it a second time for headroom. */
  let imageHeadroom = 0.5;
  let imagesSent = 0;
  let imagesRemoved = 0;
  let imagesPruned = 0;
  let imagePruneReason = null;
  let toldAboutImages = false;
  let awaitingAnswer = false;
  let lastVisible = Date.now();
  const send = (update) => {
    if (update.sessionUpdate === 'agent_message_chunk' || update.sessionUpdate === 'notice') lastVisible = Date.now();
    void client.sessionUpdate({ sessionId, update }).catch(() => {});
  };
  /* the connectors given (connectors.mjs doors): their tools Pi's (pi-connectors.mjs); one that changes things is asked
     of the person at the door, as for every agent */
  const connectors = await connectorTools(mcpServers, { log: (line) => process.stderr.write(`${line}\n`) });
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir: config.agentDir, settingsManager, noExtensions: true, noPromptTemplates: true, noThemes: true,
    /* OpenFilm's skills, and no other Pi would find (in the project, or its own folders), listed in the order named */
    noSkills: !ownSkills.names.length, additionalSkillPaths: ownSkills.paths,
    skillsOverride: (base) => ({ ...base, skills: base.skills.filter((skill) => ownSkills.names.includes(skill.name))
      .sort((a, b) => ownSkills.names.indexOf(a.name) - ownSkills.names.indexOf(b.name)) }),
    systemPromptOverride: () => config.systemPrompt,
    appendSystemPromptOverride: () => [],
    agentsFilesOverride: ({ agentsFiles }) => ({ agentsFiles: agentsFiles.filter((f) => dirname(resolve(f.path)) === resolve(cwd)) }),
    extensionFactories: [
      /* Check the complete context, including its system/tools, before logging it. Keep history stable between batches. */
      { name: 'openfilm-images', hidden: true, factory: (pi) => {
        pi.on('context_with_system', (event, ctx) => {
          const model = ctx.model;
          const fitted = fitImages(event.messages, imageBudget, {
            omitted: omittedImages, headroom: imageHeadroom,
            maxRequestBytes: Math.min(IMAGE_BUDGET, model?.inputLimits?.maxRequestBytes ?? IMAGE_BUDGET),
            // Claude's API accepts 600 on long-context models, 100 on 200K models. Unknown gateways use the lower guard.
            maxImages: model?.inputLimits?.images?.maxPerRequest ?? (/claude/i.test(model?.id ?? '') && model.contextWindow > 200_000 ? 600 : 100),
          });
          imageHeadroom = 0.5;
          imagesSent = fitted.kept;
          imagesRemoved = fitted.removed;
          imagesPruned = fitted.pruned.length;
          imagePruneReason = fitted.reason;
          if (imagesPruned) saveImageContext(fitted.pruned);
          if (imagesPruned && !toldAboutImages) {
            toldAboutImages = true;
            send({ sessionUpdate: 'notice', severity: 'info', title: 'Older pictures were left out of the model’s context.' });
          }
          return fitted.messages === event.messages ? undefined : { messages: fitted.messages };
        });
        pi.on('tool_result', async (event) => {
          if (!event.content.some(block => block.type === 'image')) return;
          const content = [];
          for (const block of event.content) {
            if (block.type !== 'image') { content.push(block); continue; }
            const preview = await resizeImage(Buffer.from(block.data, 'base64'), block.mimeType, {
              maxWidth: TOOL_IMAGE_SIDE, maxHeight: TOOL_IMAGE_SIDE, maxBytes: TOOL_IMAGE_BYTES,
            }).catch(() => null);
            if (!preview) {
              content.push({ type: 'text', text: '[The picture was omitted to keep this turn small. The original is still on disk.]' });
              continue;
            }
            content.push({ type: 'image', mimeType: preview.mimeType, data: preview.data });
            const dimensions = formatDimensionNote(preview);
            if (dimensions) content.push({ type: 'text', text: dimensions });
          }
          return { content, details: event.details };
        });
      } },
      { name: 'openfilm-log', hidden: true, factory: (pi) => {
        pi.on('context_with_system', (event) => {
          const startedAt = Date.now();
          transport.attempt = { startedAt, wire: null };
          pending = { startedAt, messages: event.messages,
            imageContext: { keptBytes: imagesSent, removed: imagesRemoved, pruned: imagesPruned, reason: imagePruneReason } };
        });
      } },
      { name: 'openfilm-ask', hidden: true, factory: (pi) => pi.registerTool(askTool(client, () => sessionId, (waiting) => { awaitingAnswer = waiting; })) },
      { name: 'openfilm-connectors', hidden: true, factory: (pi) => { for (const tool of connectors.tools) pi.registerTool(tool); } },
    ],
  });
  await resourceLoader.reload();
  const startEffort = byId.get(startModel)?.effort ?? 'auto';
  const { session } = await createAgentSession({
    cwd, agentDir: config.agentDir, modelRuntime, model: piModel(startModel, startEffort),
    ...(startEffort !== 'auto' ? { thinkingLevel: startEffort } : {}),
    resourceLoader, sessionManager, settingsManager, tools: [...agentTools(), ...connectors.tools.map((tool) => tool.name)],
  });
  // Use Pi's retry loop so a retry starts after the last completed tool result.
  const retryable = session._isRetryableError.bind(session);
  session._isRetryableError = (message) => {
    if (message.stopReason !== 'error') return false;
    const error = String(message.errorMessage ?? '');
    if (isModelConnectionError(error)) {
      // A second answer could repeat text that was already streamed to the chat.
      return !message.content.some((block) => block.type === 'text' && block.text);
    }
    if (session.retryAttempt > 0) return false;
    return TOO_LARGE.test(error) ? imagesSent > 0 : retryable(message);
  };
  /* what it runs on now, as the chat names it (a conversation taken up again may be on another model and effort) */
  const now = ownOf(session.model);
  const onModel = now.id ?? startModel;
  const levels = byId.get(onModel)?.levels ?? ['auto'];
  const entry = { session, connectors, transport, log: null, answer: null, overflow: null, modelConnection: null, retries: 0, model: onModel,
    effort: now.thinking && levels.includes(session.thinkingLevel) ? session.thinkingLevel : !now.thinking && levels.includes('auto') ? 'auto' : byId.get(onModel)?.effort ?? 'auto' };
  /* a conversation taken up again on a model no longer set up: on the one a session starts on */
  if (!now.id) await use(entry, onModel, entry.effort);
  sessionId = session.sessionId;
  entry.startProgress = () => {
    lastVisible = Date.now();
    toldAboutImages = false;
    return setInterval(() => {
      if (!awaitingAnswer && Date.now() - lastVisible >= PROGRESS_MS) {
        send({ sessionUpdate: 'notice', severity: 'info', title: 'Still working on this turn.' });
      }
    }, 15_000);
  };

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
        /* the turn's last answer: Pi drops one too long for the model from the conversation as it tries to recover */
        entry.answer = message;
        entry.modelConnection = message.stopReason === 'error' && isModelConnectionError(message.errorMessage)
          ? connectionDetails(transport, message, entry.retries) : null;
        /* refused as too large: the request tried again (see below) carries half of its pictures */
        if (message.stopReason === 'error' && TOO_LARGE.test(String(message.errorMessage ?? '')) && imagesSent > 0) {
          imageBudget = Math.floor(imagesSent / 2);
          imageHeadroom = 1;
          saveImageContext();
        }
        if (pending && entry.log) {
          const toolsNow = (session.agent?.state?.tools ?? []).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
          entry.log.write({ ...pending, toolsNow, answer: { message, systemPrompt: session.systemPrompt }, modelConnection: entry.modelConnection });
        }
        pending = null;
        transport.attempt = null;
        const used = contextUsed(message, session.model);
        if (used) send({ sessionUpdate: 'usage_update', ...used });
        break;
      }
      case 'tool_execution_start':
        send({ sessionUpdate: 'tool_call', toolCallId: event.toolCallId, status: 'in_progress', ...toolCall(event.toolName, event.args, connectors.labels) });
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
      case 'auto_retry_start':
        entry.retries = event.attempt;
        /* the service failed or sent nothing in time, and Pi tries again: the chat says so (nothing once it answers) */
        send(retryNotice(isModelConnectionError(event.errorMessage) ? event : { ...event, maxAttempts: 1 }));
        break;
      case 'auto_retry_end':
        entry.retries = 0;
        break;
      case 'compaction_end':
        /* Pi could not make room for the conversation: the turn ends on that (its last answer may not say it) */
        if (event.reason === 'overflow' && event.errorMessage) entry.overflow = event.errorMessage;
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
function askTool(client, sessionOf, setAwaitingAnswer) {
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
      setAwaitingAnswer(true);
      const reply = await client.createElicitation({
        sessionId: sessionOf(), toolCallId, mode: 'form', message: questions[0]?.question ?? '',
        requestedSchema: { type: 'object', properties },
      }).catch(() => ({ action: 'cancel' })).finally(() => setAwaitingAnswer(false));
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

/**
 * A failure with its own text: the SDK sends a plain Error as "Internal error", its text only in `data`. Pi's own words,
 * when the text is plainer (pi-config.mjs failureText), go as `details`.
 */
function failed(e) {
  if (e instanceof acp.RequestError) return e;
  const text = e instanceof Error ? e.message : String(e);
  const data = typeof e?.details === 'string' && e.details !== text ? { details: e.details } : {};
  if (e?.modelConnection) data.modelConnection = e.modelConnection;
  return new acp.RequestError(-32603, text, Object.keys(data).length ? data : undefined);
}

/** A request whose failure the chat shows as it is said. */
const said = (handler) => async (params) => {
  try { return await handler(params); } catch (e) { throw failed(e); }
};

const TURN_CHECKPOINT = 'openfilm-turn';

/** Resume from the last durable user/tool boundary in Pi's own transcript. */
async function resumeTurn(session, id) {
  const branch = session.sessionManager.getBranch();
  const index = branch.findLastIndex((entry) => entry.type === 'custom' && entry.customType === TURN_CHECKPOINT);
  if (index < 0 || branch[index]?.data?.id !== id
    || !branch.slice(index + 1).some((entry) => entry.type === 'message' && entry.message.role === 'user')) {
    throw new Error('The original task has no saved checkpoint to resume.');
  }
  let last = session.agent.state.messages.at(-1);
  if (!last || (last.role === 'assistant' && last.stopReason !== 'error' && last.stopReason !== 'aborted')) {
    throw new Error('The original task has already finished.');
  }
  // Persist the omissions so Pi can't reintroduce an earlier failed attempt when
  // it rebuilds the context for the next retry.
  while (last?.role === 'assistant' && (last.stopReason === 'error' || last.stopReason === 'aborted')) {
    session._omitRecoveryAttempt(last);
    last = session.agent.state.messages.at(-1);
  }
  // Start the session's managed run with no new user message. Calling the underlying
  // agent directly skips the session's post-run retry, compaction and cancellation.
  await session._runAgentPrompt([]);
}

const connection = new acp.AgentSideConnection((client) => ({
  async initialize() {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      /* remote MCP servers taken: the connectors' doors (pi-connectors.mjs) */
      agentCapabilities: { loadSession: false, promptCapabilities: { image: true, embeddedContext: true }, mcpCapabilities: { http: true, sse: false }, sessionCapabilities: { resume: {} } },
      agentInfo: { name: 'pi', title: 'Pi', version: VERSION },
      authMethods: [],
    };
  },
  async authenticate() { return {}; },
  newSession: said((params) => open(client, params.cwd, null, params.mcpServers)),
  resumeSession: said((params) => open(client, params.cwd, params.sessionId, params.mcpServers)),
  prompt: said(async (params) => {
    const entry = sessions.get(params.sessionId);
    if (!entry) throw new Error('This conversation has ended.');
    const { session } = entry;
    const meta = params._meta?.openfilm ?? {};
    entry.log = typeof meta.turnId === 'string' && typeof meta.cwd === 'string' ? modelLog(meta.cwd, meta.turnId) : null;
    entry.answer = null;
    entry.overflow = null;
    entry.modelConnection = null;
    entry.retries = 0;
    const progress = entry.startProgress();
    try {
      await observeModelTransport(session.model.baseUrl, entry.transport, async () => {
        if (meta.recover === true && typeof meta.turnId === 'string') await resumeTurn(session, meta.turnId);
        else {
          if (typeof meta.turnId === 'string') session.sessionManager.appendCustomEntry(TURN_CHECKPOINT, { id: meta.turnId });
          const { text, images } = promptOf(params.prompt);
          await session.prompt(text, images.length ? { images } : undefined);
        }
      });
      const last = entry.answer ?? [...session.messages].reverse().find((m) => m.role === 'assistant');
      return { stopReason: stopReason(entry.overflow && last?.stopReason !== 'aborted' ? { stopReason: 'error', errorMessage: entry.overflow } : last, entry.overflow ? null : entry.modelConnection) };
    } finally {
      clearInterval(progress);
      entry.log?.end();
      entry.log = null;
    }
  }),
  setSessionConfigOption: said(async (params) => {
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
  }),
  async cancel(params) { await sessions.get(params.sessionId)?.session.abort(); },
  async closeSession(params) {
    const entry = sessions.get(params.sessionId);
    entry?.session.dispose();
    void entry?.connectors.close();
    sessions.delete(params.sessionId);
  },
}), acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));

await connection.closed;
for (const { session } of sessions.values()) session.dispose();
process.exit(0);
