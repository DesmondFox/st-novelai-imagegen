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

const APPEARANCE_SCOPE = 'species, hair color and style, eye color, skin, body type, notable permanent features (fur color and markings, animal ears, tail, horns, scars, tattoos). No clothing, pose or expression.';

const DEFAULT_SCENE_INSTRUCTION = `[Pause the roleplay. Describe what is happening right now in the story as a NovelAI image prompt. Reply ONLY with a JSON object, no other text:
{"prompt": "...", "characters": [{"name": "...", "appearance": "...", "prompt": "...", "position": ""}]}
Rules:
- "prompt": comma-separated Danbooru tags for the whole picture: people count (1girl, 1boy, 2girls, ...), location, background, lighting, time of day, camera angle and framing, mood. Do not describe any character's looks here.
- "characters": every visible character, max 6. "name" is the character's exact name, otherwise a short label.
- "appearance": Danbooru tags for how the character looks: ${APPEARANCE_SCOPE} Take them from the character description, even if recent messages do not mention them. Leave "" for characters whose appearance is already saved: {{nai_names}}.
- "prompt" inside characters: Danbooru tags for that character in this scene: gender tag (girl, boy, ...), pose, action, facial expression, clothing.
- "position": grid cell from A1 to E5 (A..E = left to right, 1..5 = top to bottom), or "" to let the model decide.
- Do not add art style, medium or artist tags (anime, realistic, sketch, watercolor, chibi, ...): the style is set separately.
- Tags only, English, no sentences.]`;

const EXTRACT_SYSTEM_PROMPT = `Convert the character description into NovelAI appearance tags. Reply with one line of comma-separated English Danbooru tags and nothing else. Tags to include: ${APPEARANCE_SCOPE}`;

const UPDATE_INSTRUCTION = `[Pause the roleplay. Saved appearance tags of {{nai_name}}: {{nai_tags}}
Check the story for changes to how {{nai_name}} looks now (haircut, hair color, body, new scars, ...). Reply ONLY with the full updated list of comma-separated English Danbooru tags, no other text: ${APPEARANCE_SCOPE}
If nothing changed, reply with the saved tags unchanged.]`;

const NPC_SCAN_INSTRUCTION = `[Pause the roleplay. List every character in the story so far except: {{nai_names}}. Reply ONLY with a JSON object, no other text:
{"characters": [{"name": "...", "appearance": "..."}]}
"name" is the character's exact name. "appearance" is comma-separated English Danbooru tags: ${APPEARANCE_SCOPE}
Use only what the story says. Skip characters whose looks are not described. Reply {"characters": []} if there is nobody.]`;

/**
 * Checked on V5 Full. The "основные" groups held their style across 8-16 different scenes each;
 * the rest were checked on one scene. Furry presets use e621 medium tags and turn on furry mode.
 */
const STYLE_PRESETS = {
    'Аниме: основные': {
        furry: false,
        styles: {
            'Иллюстрация': 'illustration, official art, detailed background, soft lighting, depth of field, vibrant colors',
            'Полуреализм': 'semi-realistic, painterly, realistic shading, dramatic lighting, detailed',
            'Аниме (cel)': 'anime screencap, anime coloring, cel shading, clean lineart',
        },
    },
    'Фурри: основные': {
        furry: true,
        styles: {
            'Скетч': 'sketch, graphite (artwork), traditional media (artwork), rough lines, partially colored',
        },
    },
    'Аниме: прочие': {
        furry: false,
        styles: {
            'Game CG': 'game cg, visual novel, detailed background, soft shading, bloom',
            'Ретро 90-х': '1990s (style), retro artstyle, anime screencap, cel shading',
            'Масло': 'oil painting (medium), impasto, painterly, traditional media, textured',
            'Акварель': 'watercolor (medium), traditional media, soft colors, paper texture',
            'Флэт': 'flat color, limited palette, thick outlines, simple shading, minimalism',
            'Скетч': 'sketch, pencil (medium), graphite (medium), traditional media, rough lines, partially colored',
            'Пастель': 'pastel colors, soft focus, light particles, dreamy, glowing, bloom',
        },
    },
    'Фурри: прочие': {
        furry: true,
        styles: {
            'Мультяшный': 'toony, cel shading, thick outlines, bright colors',
            'Цифровая живопись': 'digital painting (artwork), detailed fur, soft lighting, painterly, depth of field',
            'Реалистичный мех': 'realistic, detailed fur, fur texture, dramatic lighting, detailed background',
            'Аниме (kemono)': 'anime style, kemono, cel shading, clean lineart, anime coloring',
            'Акварель': 'watercolor (artwork), traditional media (artwork), soft colors, paper texture',
            'Флэт': 'flat colors, limited palette, thick outlines, simple shading, minimalist',
            '3D': '3d (artwork), 3d render, soft lighting, subsurface scattering, detailed fur',
            'Масло': 'oil painting (artwork), impasto, painterly, traditional media (artwork), textured',
        },
    },
    // Only artist tags that visibly changed the picture; ke-ta, akira toriyama, alphonse mucha, rukis, kilinah, chunie did not.
    'Аниме: художники': {
        furry: false,
        styles: {
            'kantoku': 'artist:kantoku',
            'mika pikazo': 'artist:mika pikazo',
            'fuzichoco': 'artist:fuzichoco',
            'yoneyama mai': 'artist:yoneyama mai',
            'wlop': 'artist:wlop',
            'ciloranko': 'artist:ciloranko',
            'ningen mame': 'artist:ningen mame',
        },
    },
    'Фурри: художники': {
        furry: true,
        styles: {
            'kenket': 'artist:kenket',
            'hioshiru': 'artist:hioshiru',
            'honovy': 'artist:honovy',
            'wolfy-nail': 'artist:wolfy-nail',
            'tsampikos': 'artist:tsampikos',
        },
    },
};

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
    style: STYLE_PRESETS['Аниме: основные'].styles['Иллюстрация'],
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
const joinLines = (parts) => parts.map(p => String(p ?? '').trim()).filter(Boolean).join('\n\n');

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

/** Appearance stored in the current chat: NPCs, and card characters whose looks changed in this story. */
const getNpcs = () => ctx().chatMetadata?.[MODULE]?.npcs ?? {};

async function writeNpcs(npcs) {
    const c = ctx();
    c.chatMetadata[MODULE] = { ...c.chatMetadata[MODULE], npcs };
    await c.saveMetadata();
    registerTool();
}

/** Chat entries go first: a change made in one story must win over the card and not touch other chats. */
function getKnownCharacters() {
    const c = ctx();
    return [
        ...Object.entries(getNpcs()).map(([name, tags]) => ({ index: null, name, tags })),
        ...getChatCharacters(),
        { index: null, name: c.name1, tags: settings().user_tags[c.name1] ?? '' },
    ];
}

const uniqueNames = (known) => [...new Set(known.map(k => k.name))];

/** Names of characters whose appearance tags are filled in; the LLM must describe everyone else itself. */
function savedAppearanceNames() {
    const names = uniqueNames(getKnownCharacters().filter(k => k.tags.trim()));
    return names.length ? names.join(', ') : 'nobody';
}

/** Only entries with tags: an empty card field must not hide a chat entry of the same name. */
function findKnown(name) {
    if (!name) return null;
    const n = String(name).trim().toLowerCase();
    const known = getKnownCharacters().filter(k => k.tags.trim());
    return known.find(k => k.name.toLowerCase() === n)
        ?? known.find(k => k.name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0])
        ?? null;
}

/**
 * Saves the appearance the LLM gave for named characters without saved tags.
 * Later images reuse it even after the description leaves the context.
 * @returns {Promise<number>} how many characters were added
 */
async function rememberAppearance(characters) {
    if (!ctx().getCurrentChatId()) return 0;
    const npcs = { ...getNpcs() };
    let added = 0;
    for (const ch of characters) {
        const name = String(ch?.name ?? '').trim();
        const appearance = joinTags(String(ch?.appearance ?? '').split(','));
        if (!name || !appearance || name in npcs || findKnown(name)) continue;
        npcs[name] = appearance;
        added++;
    }
    if (added) {
        await writeNpcs(npcs);
        renderNpcs();
    }
    return added;
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
        prompt: joinTags([known ? known.tags : ch.appearance, ch.prompt]),
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
 * @param {{name?: string, appearance?: string, prompt: string, negative?: string, position?: string}[]} [req.characters]
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

    await rememberAppearance(req.characters ?? []);

    // Style goes first: NovelAI gives earlier tags more weight.
    const prompt = joinTags([furry ? 'fur dataset' : '', s.style, req.prompt, s.quality]);
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
    const instruction = c.substituteParams(settings().scene_instruction.replaceAll('{{nai_names}}', savedAppearanceNames()));

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

/** Asks the LLM for NPCs described in the chat so far, so their looks are saved before they leave the context. */
async function scanNpcs() {
    const c = ctx();
    if (!c.getCurrentChatId()) throw new Error('Чат не открыт');
    const names = uniqueNames(getKnownCharacters()).join(', ');
    const instruction = c.substituteParams(NPC_SCAN_INSTRUCTION.replaceAll('{{nai_names}}', names));

    const toast = toastr.info('LLM ищет NPC…', 'NovelAI', { timeOut: 0, extendedTimeOut: 0 });
    let found;
    try {
        found = parseSceneJson(await c.generateQuietPrompt({ quietPrompt: instruction })).characters;
    } finally {
        toastr.clear(toast);
    }
    const added = await rememberAppearance(found);
    toastr.success(`Новых NPC: ${added}`, 'NovelAI');
}

/** Turns a card or persona description into appearance tags. Uses generateRaw: the chat is not needed. */
async function extractAppearance(description) {
    if (!description.trim()) throw new Error('Описание пустое');
    const toast = toastr.info('LLM читает описание…', 'NovelAI', { timeOut: 0, extendedTimeOut: 0 });
    try {
        return parseTagReply(await ctx().generateRaw({ systemPrompt: EXTRACT_SYSTEM_PROMPT, prompt: description }));
    } finally {
        toastr.clear(toast);
    }
}

function parseTagReply(reply) {
    const tags = joinTags(String(reply).replace(/```\w*/g, '').replace(/^\s*(appearance\s+)?tags\s*:/i, '').split(/[\n,]+/).map(t => t.trim().replace(/^["'`*\s-]+|["'`*\s]+$/g, '')));
    if (!tags) throw new Error('LLM вернула пустой ответ');
    return tags;
}

/**
 * Asks the LLM how the character looks now, shows old and new tags, saves to the chat on confirm.
 * The result goes to the chat, not the card: a new haircut belongs to this story only.
 */
async function updateAppearanceFromChat(name) {
    const c = ctx();
    const chatId = c.getCurrentChatId();
    if (!chatId) throw new Error('Чат не открыт');
    const current = getKnownCharacters().find(k => k.name === name && k.tags.trim())?.tags ?? '';
    const instruction = c.substituteParams(UPDATE_INSTRUCTION
        .replaceAll('{{nai_name}}', name)
        .replaceAll('{{nai_tags}}', current || 'none'));

    const toast = toastr.info(`LLM проверяет внешность: ${name}…`, 'NovelAI', { timeOut: 0, extendedTimeOut: 0 });
    let tags;
    try {
        tags = parseTagReply(await c.generateQuietPrompt({ quietPrompt: instruction }));
    } finally {
        toastr.clear(toast);
    }
    if (tags === current) {
        toastr.info(`${name}: внешность не изменилась`, 'NovelAI');
        return;
    }
    if (!await confirmTagChange(name, current, tags)) return;
    if (ctx().getCurrentChatId() !== chatId) throw new Error('Чат сменился, внешность не сохранена');
    await writeNpcs({ ...getNpcs(), [name]: tags });
    renderNpcs();
}

async function confirmTagChange(name, before, after) {
    const c = ctx();
    const line = (label, text) => {
        const p = document.createElement('p');
        const b = document.createElement('b');
        b.textContent = label;
        p.append(b, text);
        return p;
    };
    const title = document.createElement('h3');
    title.textContent = `${name}: сохранить в этом чате?`;
    const body = document.createElement('div');
    body.append(title, line('Было: ', before || '—'), line('Стало: ', after));
    return await c.callGenericPopup(body, c.POPUP_TYPE.CONFIRM) === c.POPUP_RESULT.AFFIRMATIVE;
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

/** Re-run when the chat or saved tags change: ST sends the description as a fixed string. */
function registerTool() {
    ctx().registerFunctionTool({
        name: 'NovelAIGenerateImage',
        displayName: 'NovelAI Image',
        description: [
            'Draw image(s) with NovelAI (anime / furry illustration model).',
            'Use when the user asks for a picture, drawing, illustration, selfie or to show a scene, or asks for several images.',
            'Prompts are comma-separated Danbooru tags in English, not sentences.',
            `Appearance is added automatically for: ${savedAppearanceNames()} (put their exact name in characters[].name, leave appearance empty).`,
            'For every other character fill characters[].appearance from their character description; it is saved and reused for later images.',
            'Do not add art style, medium or artist tags: the style is set separately.',
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
                            appearance: { type: 'string', description: `Looks of this character: ${APPEARANCE_SCOPE} Empty if it is added automatically.` },
                            prompt: { type: 'string', description: 'Tags for this character in this image: gender tag, pose, action, expression, clothing.' },
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
    nai_ig_style: 'style',
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

    const stylePreset = document.getElementById('nai_ig_style_preset');
    const styleTags = document.getElementById('nai_ig_style');
    for (const [group, { styles }] of Object.entries(STYLE_PRESETS)) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = group;
        for (const name of Object.keys(styles)) optgroup.append(new Option(name, JSON.stringify([group, name])));
        stylePreset.append(optgroup);
    }
    stylePreset.addEventListener('change', () => {
        if (!stylePreset.value) return;
        const [group, name] = JSON.parse(stylePreset.value);
        s.style = styleTags.value = STYLE_PRESETS[group].styles[name];
        s.furry = document.getElementById('nai_ig_furry').checked = STYLE_PRESETS[group].furry;
        stylePreset.value = '';
        ctx().saveSettingsDebounced();
    });

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
    const showError = (err) => toastr.error(String(err.message ?? err), 'NovelAI');

    const writeCharTags = async (index, tags) => {
        const current = ctx().characters[index]?.data?.extensions?.[CARD_FIELD] ?? {};
        await ctx().writeExtensionField(index, CARD_FIELD, { ...current, tags });
        registerTool();
    };
    const writeUserTags = (name, tags) => {
        s.user_tags[name] = tags;
        ctx().saveSettingsDebounced();
        registerTool();
    };
    const confirmReplace = async (current) => {
        if (!current.trim()) return true;
        const c = ctx();
        return await c.callGenericPopup('Заменить текущие теги внешности?', c.POPUP_TYPE.CONFIRM) === c.POPUP_RESULT.AFFIRMATIVE;
    };

    charSelect.addEventListener('change', () => {
        const ch = getChatCharacters().find(x => String(x.index) === charSelect.value);
        charTags.value = ch?.tags ?? '';
    });
    charTags.addEventListener('input', debounce(() => {
        const index = Number(charSelect.value);
        if (!Number.isInteger(index) || charSelect.value === '') return;
        writeCharTags(index, charTags.value);
    }, 800));
    userTags.addEventListener('input', debounce(() => writeUserTags(ctx().name1, userTags.value), 800));

    // Index and name are captured before the LLM call: the user can switch character or persona while it runs.
    document.getElementById('nai_ig_btn_char_extract').addEventListener('click', async () => {
        const index = Number(charSelect.value);
        const ch = ctx().characters[index];
        if (charSelect.value === '' || !ch || !await confirmReplace(charTags.value)) return;
        try {
            const c = ctx();
            const tags = await extractAppearance(c.substituteParams(joinLines([ch.description, ch.personality]), c.name1, ch.name));
            await writeCharTags(index, tags);
            if (charSelect.value === String(index)) charTags.value = tags;
        } catch (err) {
            showError(err);
        }
    });
    document.getElementById('nai_ig_btn_user_extract').addEventListener('click', async () => {
        const name = ctx().name1;
        if (!await confirmReplace(userTags.value)) return;
        try {
            const tags = await extractAppearance(ctx().substituteParams('{{persona}}'));
            writeUserTags(name, tags);
            if (ctx().name1 === name) userTags.value = tags;
        } catch (err) {
            showError(err);
        }
    });
    document.getElementById('nai_ig_btn_char_update').addEventListener('click', () => {
        const ch = ctx().characters[Number(charSelect.value)];
        if (charSelect.value === '' || !ch) return;
        updateAppearanceFromChat(ch.name).catch(showError);
    });
    document.getElementById('nai_ig_btn_user_update').addEventListener('click', () => {
        updateAppearanceFromChat(ctx().name1).catch(showError);
    });
    document.getElementById('nai_ig_btn_npc_scan').addEventListener('click', () => {
        scanNpcs().catch(showError);
    });

    const refreshCharacters = () => {
        const chars = getChatCharacters();
        charSelect.innerHTML = '';
        for (const ch of chars) charSelect.append(new Option(ch.name, String(ch.index)));
        charSelect.disabled = charTags.disabled = chars.length === 0;
        charTags.value = chars[0]?.tags ?? '';
        userTags.value = s.user_tags[ctx().name1] ?? '';
        renderNpcs();
    };
    refreshCharacters();
    ctx().eventSource.on(ctx().eventTypes.CHAT_CHANGED, () => {
        refreshCharacters();
        registerTool();
    });
}

function renderNpcs() {
    const list = document.getElementById('nai_ig_npc_list');
    if (!list) return;
    list.innerHTML = '';
    const chatId = ctx().getCurrentChatId();
    for (const [name, tags] of Object.entries(getNpcs())) {
        const label = document.createElement('b');
        label.textContent = name;
        const update = document.createElement('div');
        update.className = 'menu_button fa-solid fa-rotate';
        update.title = 'Обновить из чата';
        update.addEventListener('click', () => {
            updateAppearanceFromChat(name).catch(err => toastr.error(String(err.message ?? err), 'NovelAI'));
        });
        const del = document.createElement('div');
        del.className = 'menu_button fa-solid fa-trash';
        del.title = 'Забыть';
        del.addEventListener('click', async () => {
            const npcs = { ...getNpcs() };
            delete npcs[name];
            await writeNpcs(npcs);
            renderNpcs();
        });
        const text = document.createElement('textarea');
        text.className = 'text_pole';
        text.rows = 2;
        text.value = tags;
        text.addEventListener('input', debounce(() => {
            // Save fires 800 ms later; by then another chat may be open.
            if (ctx().getCurrentChatId() !== chatId) return;
            writeNpcs({ ...getNpcs(), [name]: text.value });
        }, 800));

        const header = document.createElement('div');
        header.className = 'nai-ig-row nai-ig-npc-header';
        header.append(label, update, del);
        list.append(header, text);
    }
    if (!list.childElementCount) list.innerHTML = '<div class="nai-ig-hint">Пока никого.</div>';
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
