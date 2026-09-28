// NovelAI Image Gen (V4.5/V5) — UI side. Requires the "nai-imagegen" server plugin.
import { saveBase64AsFile } from '../../../utils.js';

const MODULE = 'nai_imagegen';
const CARD_FIELD = 'nai_imagegen';
const API = '/api/plugins/nai-imagegen';
const FOLDER_URL = new URL('.', import.meta.url).href;

const ORIENTATIONS = {
    portrait: { width: 832, height: 1216 },
    landscape: { width: 1216, height: 832 },
    square: { width: 1024, height: 1024 },
};

const DEFAULT_SCENE_INSTRUCTION = `[Pause the roleplay. Describe what is happening right now in the story as a NovelAI image prompt. Reply ONLY with a JSON object, no other text:
{"prompt": "...", "characters": [{"name": "...", "prompt": "...", "position": ""}]}
Rules:
- "prompt": comma-separated Danbooru tags for the whole picture: people count (1girl, 1boy, 2girls, 1girl 1boy, ...), location, background, lighting, time of day, camera angle and framing, mood. Do not describe any character's looks here.
- "characters": every visible character, max 6. "name" is the exact name for known characters ({{nai_names}}), otherwise a short label. "prompt" is Danbooru tags for that character only: gender tag (girl, boy, ...), pose, action, facial expression, clothing; add hair/eyes/body tags only for characters that are not known.
- "position": grid cell from A1 to E5 (A..E = left to right, 1..5 = top to bottom), or "" to let the model decide.
- Tags only, English, no sentences.]`;

const DEFAULT_SETTINGS = {
    model: 'nai-diffusion-5-full',
    furry: false,
    orientation: 'portrait',
    steps: 28,
    scale: 5,
    cfg_rescale: 0,
    sampler: 'k_euler_ancestral',
    noise_schedule: 'karras',
    seed: -1,
    variety_boost: false,
    decrisper: false,
    quality: 'very aesthetic, masterpiece, no text',
    negative: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page',
    tool_enabled: true,
    max_count: 4,
    scene_instruction: DEFAULT_SCENE_INSTRUCTION,
    user_tags: {},
};

let pluginAvailable = false;
let busy = false;

const ctx = () => SillyTavern.getContext();

function settings() {
    const all = ctx().extensionSettings;
    all[MODULE] ??= {};
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
        if (all[MODULE][k] === undefined) all[MODULE][k] = structuredClone(v);
    }
    return all[MODULE];
}

const joinTags = (parts) => parts.map(p => String(p ?? '').trim().replace(/^,+|,+$/g, '').trim()).filter(Boolean).join(', ');

// ---------- characters ----------

/** Characters present in the current chat (single or group) plus the user persona. */
function getChatCharacters() {
    const c = ctx();
    let list = [];
    if (c.groupId) {
        const group = c.groups.find(g => g.id == c.groupId);
        list = (group?.members ?? []).map(av => c.characters.findIndex(ch => ch.avatar === av)).filter(i => i >= 0);
    } else if (c.characterId !== undefined && c.characters[c.characterId]) {
        list = [Number(c.characterId)];
    }
    return list.map(i => ({
        index: i,
        name: c.characters[i].name,
        tags: c.characters[i].data?.extensions?.[CARD_FIELD]?.tags ?? '',
    }));
}

function getKnownCharacters() {
    const c = ctx();
    return [
        ...getChatCharacters(),
        { index: null, name: c.name1, tags: settings().user_tags[c.name1] ?? '' },
    ];
}

function findKnown(name) {
    if (!name) return null;
    const n = String(name).trim().toLowerCase();
    const known = getKnownCharacters();
    return known.find(k => k.name.toLowerCase() === n)
        ?? known.find(k => k.name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0])
        ?? null;
}

/** "C3" / "left" / "" → {x, y} or {} */
function parsePosition(pos) {
    const p = String(pos ?? '').trim().toLowerCase();
    const grid = p.match(/^([a-e])\s*([1-5])$/);
    if (grid) {
        const step = (i) => Math.round((0.1 + 0.2 * i) * 10) / 10;
        return { x: step(grid[1].charCodeAt(0) - 97), y: step(Number(grid[2]) - 1) };
    }
    const words = { left: 0.1, 'center-left': 0.3, center: 0.5, middle: 0.5, 'center-right': 0.7, right: 0.9 };
    if (p in words) return { x: words[p], y: 0.5 };
    return {};
}

function resolveCharacter(ch) {
    const known = findKnown(ch.name);
    return {
        prompt: joinTags([known?.tags, ch.prompt]),
        negative: ch.negative ?? '',
        ...parsePosition(ch.position),
    };
}

// ---------- generation ----------

async function callPlugin(path, body) {
    const res = await fetch(API + path, {
        method: 'POST',
        headers: ctx().getRequestHeaders(),
        body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.error || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return data;
}

/**
 * @param {object} req
 * @param {string} req.prompt Base prompt (scene tags)
 * @param {{name?: string, prompt: string, negative?: string, position?: string}[]} [req.characters]
 * @param {number} [req.count]
 * @param {string} [req.orientation]
 * @param {string} [req.model]
 * @param {boolean} [req.furry]
 * @returns {Promise<string[]>} URLs of saved images
 */
async function generateImages(req) {
    if (!pluginAvailable) throw new Error('Серверный плагин nai-imagegen не найден. См. README.');
    if (busy) throw new Error('Генерация уже идёт.');

    const s = settings();
    const c = ctx();
    const chatId = c.getCurrentChatId();
    const count = Math.min(Math.max(1, Number(req.count) || 1), Math.max(1, Number(s.max_count) || 1));
    const dims = ORIENTATIONS[req.orientation] ?? ORIENTATIONS[s.orientation] ?? ORIENTATIONS.portrait;
    const furry = req.furry ?? s.furry;

    const prompt = joinTags([furry ? 'fur dataset' : '', req.prompt, s.quality]);
    const characters = (req.characters ?? []).map(resolveCharacter).filter(ch => ch.prompt);
    const folder = c.groupId ? (c.groups.find(g => g.id == c.groupId)?.name ?? 'group') : (c.name2 || 'nai');

    busy = true;
    const urls = [];
    const toast = toastr.info('', 'NovelAI', { timeOut: 0, extendedTimeOut: 0 });
    try {
        for (let i = 0; i < count; i++) {
            toast.find('.toast-message').text(`Генерация ${i + 1}/${count}…`);
            const body = {
                model: req.model || s.model,
                ...dims,
                steps: Number(s.steps),
                scale: Number(s.scale),
                cfg_rescale: Number(s.cfg_rescale),
                sampler: s.sampler,
                noise_schedule: s.noise_schedule,
                variety_boost: !!s.variety_boost,
                decrisper: !!s.decrisper,
                seed: Number(s.seed) >= 0 ? Number(s.seed) + i : -1,
                prompt,
                negative_prompt: s.negative,
                characters,
            };

            let result;
            for (let attempt = 0; ; attempt++) {
                try {
                    result = await callPlugin('/generate', body);
                    break;
                } catch (err) {
                    // NovelAI allows one generation at a time; back off on 429.
                    if (err.status === 429 && attempt < 3) {
                        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
                        continue;
                    }
                    throw err;
                }
            }

            const filename = `nai_${c.humanizedDateTime()}_${i}`;
            urls.push(await saveBase64AsFile(result.image, folder, filename, 'png'));
        }
    } finally {
        busy = false;
        toastr.clear(toast);
    }

    if (ctx().getCurrentChatId() !== chatId) {
        toastr.warning('Чат сменился — картинки сохранены, но не добавлены в чат.', 'NovelAI');
        return urls;
    }
    await postImagesMessage(urls, req.prompt, characters);
    return urls;
}

async function postImagesMessage(urls, prompt, characters) {
    const c = ctx();
    const title = joinTags([prompt, ...characters.map(ch => ch.prompt)]);
    const message = {
        name: c.groupId ? 'NovelAI' : c.name2,
        is_user: false,
        // Hidden from the LLM context so tag soup doesn't leak into the roleplay.
        is_system: true,
        send_date: new Date().toISOString(),
        mes: '',
        extra: {
            media: urls.map(url => ({ url, type: 'image', title, source: 'generated' })),
            media_display: 'gallery',
            media_index: 0,
            inline_image: false,
        },
    };
    c.chat.push(message);
    const id = c.chat.length - 1;
    await c.eventSource.emit(c.eventTypes.MESSAGE_RECEIVED, id, 'extension');
    c.addOneMessage(message);
    await c.eventSource.emit(c.eventTypes.CHARACTER_MESSAGE_RENDERED, id, 'extension');
    await c.saveChat();
    setTimeout(() => c.scrollOnMediaLoad?.(), 100);
}

// ---------- auto scene ----------

function parseSceneJson(text) {
    const cleaned = String(text).replace(/```(?:json)?/gi, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('LLM не вернула JSON');
    const data = JSON.parse(cleaned.slice(start, end + 1));
    return {
        prompt: String(data.prompt ?? ''),
        characters: Array.isArray(data.characters) ? data.characters : [],
    };
}

async function generateScene({ count, orientation } = {}) {
    const c = ctx();
    const names = getKnownCharacters().map(k => k.name).join(', ');
    const instruction = c.substituteParams(settings().scene_instruction.replaceAll('{{nai_names}}', names));

    const toast = toastr.info('LLM описывает сцену…', 'NovelAI', { timeOut: 0, extendedTimeOut: 0 });
    let scene;
    try {
        const reply = await c.generateQuietPrompt({ quietPrompt: instruction });
        scene = parseSceneJson(reply);
    } finally {
        toastr.clear(toast);
    }
    console.debug('[nai-imagegen] scene', scene);
    return generateImages({ ...scene, count, orientation });
}

// ---------- slash commands ----------

/** "/nai scene tags ; Name> char tags @B3 ; char tags" — ';' because '|' is the STscript pipe. */
function parseInlinePrompt(text) {
    const [base, ...chars] = String(text).split(';').map(s => s.trim());
    return {
        prompt: base,
        characters: chars.filter(Boolean).map(seg => {
            let position = '';
            seg = seg.replace(/@\s*([a-e][1-5]|left|center|right)\s*$/i, (_, p) => { position = p; return ''; }).trim();
            let name;
            const named = seg.match(/^([^,:]{1,40})>\s*(.*)$/);
            if (named) { name = named[1].trim(); seg = named[2]; }
            return { name, prompt: seg, position };
        }),
    };
}

function registerCommands() {
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, SlashCommandNamedArgument, ARGUMENT_TYPE } = ctx();
    const commonArgs = () => [
        SlashCommandNamedArgument.fromProps({ name: 'count', description: 'количество картинок', typeList: [ARGUMENT_TYPE.NUMBER], defaultValue: '1' }),
        SlashCommandNamedArgument.fromProps({ name: 'orientation', description: 'portrait / landscape / square', typeList: [ARGUMENT_TYPE.STRING], enumList: Object.keys(ORIENTATIONS) }),
    ];

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'nai',
        helpString: 'NovelAI V4.5/V5. Формат: <code>/nai теги сцены ; Имя&gt; теги персонажа @B3 ; теги второго @D3</code>. Имя&gt; подставит сохранённую внешность.',
        returns: 'URL картинок через запятую',
        namedArgumentList: [
            ...commonArgs(),
            SlashCommandNamedArgument.fromProps({ name: 'model', description: 'id модели', typeList: [ARGUMENT_TYPE.STRING] }),
            SlashCommandNamedArgument.fromProps({ name: 'furry', description: 'furry mode', typeList: [ARGUMENT_TYPE.BOOLEAN] }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({ description: 'промпт', typeList: [ARGUMENT_TYPE.STRING], isRequired: true }),
        ],
        callback: async (args, text) => {
            try {
                const furry = args.furry === undefined ? undefined : String(args.furry) === 'true';
                const urls = await generateImages({
                    ...parseInlinePrompt(text),
                    count: args.count, orientation: args.orientation, model: args.model, furry,
                });
                return urls.join(', ');
            } catch (err) {
                toastr.error(String(err.message ?? err), 'NovelAI');
                return '';
            }
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'naiscene',
        helpString: 'LLM описывает текущую сцену (с разбивкой по персонажам) и генерирует картинку в NovelAI.',
        returns: 'URL картинок через запятую',
        namedArgumentList: commonArgs(),
        callback: async (args) => {
            try {
                return (await generateScene({ count: args.count, orientation: args.orientation })).join(', ');
            } catch (err) {
                toastr.error(String(err.message ?? err), 'NovelAI');
                return '';
            }
        },
    }));
}

// ---------- function tool ----------

function registerTool() {
    ctx().registerFunctionTool({
        name: 'NovelAIGenerateImage',
        displayName: 'NovelAI Image',
        description: [
            'Draw image(s) with NovelAI (anime / furry illustration model).',
            'Use when the user asks for a picture, drawing, illustration, selfie or to show a scene, or asks for several images.',
            'Prompts are comma-separated Danbooru tags in English, not sentences.',
            'Known characters\' appearance is added automatically when you put their exact name in characters[].name.',
        ].join(' '),
        parameters: Object.freeze({
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: 'Tags for the whole image: people count (1girl, 2boys, 1girl 1boy...), location, background, lighting, camera angle, framing, mood. No character appearance here.',
                },
                characters: {
                    type: 'array',
                    description: 'Visible characters, max 6.',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Exact character name if known, otherwise a short label.' },
                            prompt: { type: 'string', description: 'Tags for this character only: gender tag, pose, action, expression, clothing; appearance tags only if the character is not known.' },
                            position: { type: 'string', description: 'Grid cell A1..E5 (A-E left to right, 1-5 top to bottom) or empty for auto.' },
                        },
                        required: ['prompt'],
                    },
                },
                count: { type: 'integer', description: 'Number of images (variations) to draw. Default 1.' },
                orientation: { type: 'string', enum: Object.keys(ORIENTATIONS) },
            },
            required: ['prompt'],
        }),
        action: async (args) => {
            const urls = await generateImages({
                prompt: args?.prompt ?? '',
                characters: Array.isArray(args?.characters) ? args.characters : [],
                count: args?.count,
                orientation: args?.orientation,
            });
            return `Generated ${urls.length} image(s); they are already shown to the user in the chat. Continue the conversation naturally, do not paste links.`;
        },
        formatMessage: (args) => `NovelAI: рисую ${Number(args?.count) || 1} шт.…`,
        shouldRegister: () => pluginAvailable && !!settings().tool_enabled,
    });
}

// ---------- settings UI ----------

const BINDINGS = {
    nai_ig_model: 'model',
    nai_ig_furry: 'furry',
    nai_ig_orientation: 'orientation',
    nai_ig_steps: 'steps',
    nai_ig_scale: 'scale',
    nai_ig_cfg_rescale: 'cfg_rescale',
    nai_ig_sampler: 'sampler',
    nai_ig_noise_schedule: 'noise_schedule',
    nai_ig_seed: 'seed',
    nai_ig_variety_boost: 'variety_boost',
    nai_ig_decrisper: 'decrisper',
    nai_ig_quality: 'quality',
    nai_ig_negative: 'negative',
    nai_ig_tool: 'tool_enabled',
    nai_ig_max_count: 'max_count',
    nai_ig_scene_instruction: 'scene_instruction',
};

function bindSettings() {
    const s = settings();
    for (const [id, key] of Object.entries(BINDINGS)) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.type === 'checkbox') el.checked = !!s[key];
        else el.value = s[key];
        el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', () => {
            s[key] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
            ctx().saveSettingsDebounced();
        });
    }

    document.getElementById('nai_ig_btn_reset').addEventListener('click', () => {
        s.scene_instruction = DEFAULT_SCENE_INSTRUCTION;
        document.getElementById('nai_ig_scene_instruction').value = s.scene_instruction;
        ctx().saveSettingsDebounced();
    });
    document.getElementById('nai_ig_btn_scene').addEventListener('click', () => {
        generateScene().catch(err => toastr.error(String(err.message ?? err), 'NovelAI'));
    });
    document.getElementById('nai_ig_btn_balance').addEventListener('click', async () => {
        try {
            const data = await callPlugin('/status');
            const steps = data?.trainingStepsLeft;
            const total = typeof steps === 'object' && steps
                ? (steps.fixedTrainingStepsLeft ?? 0) + (steps.purchasedTrainingSteps ?? 0)
                : steps;
            toastr.info(`Anlas: ${total ?? '?'}`, 'NovelAI');
        } catch (err) {
            toastr.error(String(err.message ?? err), 'NovelAI');
        }
    });

    const charSelect = document.getElementById('nai_ig_char_select');
    const charTags = document.getElementById('nai_ig_char_tags');
    const userTags = document.getElementById('nai_ig_user_tags');

    const saveCharTags = debounce(async () => {
        const index = Number(charSelect.value);
        if (!Number.isInteger(index) || charSelect.value === '') return;
        const current = ctx().characters[index]?.data?.extensions?.[CARD_FIELD] ?? {};
        await ctx().writeExtensionField(index, CARD_FIELD, { ...current, tags: charTags.value });
    }, 800);

    charSelect.addEventListener('change', () => {
        const ch = getChatCharacters().find(x => String(x.index) === charSelect.value);
        charTags.value = ch?.tags ?? '';
    });
    charTags.addEventListener('input', saveCharTags);
    userTags.addEventListener('input', () => {
        s.user_tags[ctx().name1] = userTags.value;
        ctx().saveSettingsDebounced();
    });

    const refreshCharacters = () => {
        const chars = getChatCharacters();
        charSelect.innerHTML = '';
        for (const ch of chars) charSelect.append(new Option(ch.name, String(ch.index)));
        charSelect.disabled = charTags.disabled = chars.length === 0;
        charTags.value = chars[0]?.tags ?? '';
        userTags.value = s.user_tags[ctx().name1] ?? '';
    };
    refreshCharacters();
    ctx().eventSource.on(ctx().eventTypes.CHAT_CHANGED, refreshCharacters);
}

function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function addWandButton() {
    const item = document.createElement('div');
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = '<div class="fa-solid fa-image extensionsMenuExtensionButton"></div>NAI: нарисовать сцену';
    item.addEventListener('click', () => {
        generateScene().catch(err => toastr.error(String(err.message ?? err), 'NovelAI'));
    });
    document.getElementById('extensionsMenu')?.append(item);
}

async function checkPlugin() {
    const status = document.getElementById('nai_ig_plugin_status');
    try {
        const res = await fetch(API + '/probe', { headers: ctx().getRequestHeaders() });
        pluginAvailable = res.ok;
    } catch {
        pluginAvailable = false;
    }
    if (status) {
        status.textContent = pluginAvailable
            ? '✔ Серверный плагин подключён'
            : '✘ Серверный плагин не найден: включите enableServerPlugins в config.yaml и перезапустите ST';
    }
}

jQuery(async () => {
    settings();
    const html = await (await fetch(FOLDER_URL + 'settings.html')).text();
    $('#extensions_settings2').append(html);
    bindSettings();
    addWandButton();
    await checkPlugin();
    registerCommands();
    registerTool();
});
