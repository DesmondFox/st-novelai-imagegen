// SillyTavern server plugin: NovelAI image generation (V4.5 / V5) with multi-character prompts.
// Mounted at /api/plugins/nai-imagegen. Uses the NovelAI token saved in ST's API Connections.

const IMAGE_NOVELAI = 'https://image.novelai.net';

// Variety Boost sigma constants, same as SillyTavern's src/endpoints/novelai.js
const REFERENCE_PIXEL_COUNT = 832 * 1216;
const SIGMA_MAGIC_NUMBER = 19;
const SIGMA_MAGIC_NUMBER_V4_5 = 58;

const ALLOWED_MODELS = [
    'nai-diffusion-5-full',
    'nai-diffusion-5-curated',
    'nai-diffusion-4-5-full',
    'nai-diffusion-4-5-curated',
    'nai-diffusion-4-full',
    'nai-diffusion-4-curated-preview',
];

let readSecret, SECRET_KEYS, extractFileFromZipBuffer;

export const info = {
    id: 'nai-imagegen',
    name: 'NovelAI Image Gen (V4.5/V5)',
    description: 'NovelAI V4.5/V5 image generation with multi-character prompts and furry mode.',
};

/**
 * @param {import('express').Router} router
 */
export async function init(router) {
    // Plugin lives in <ST>/plugins/<folder>/plugin.mjs, so ST sources are two levels up.
    ({ readSecret, SECRET_KEYS } = await import('../../src/endpoints/secrets.js'));
    ({ extractFileFromZipBuffer } = await import('../../src/util.js'));

    router.get('/probe', (_req, res) => res.send({ ok: true, models: ALLOWED_MODELS }));

    router.post('/status', async (req, res) => {
        const key = getKey(req);
        if (!key) return res.status(400).send({ error: 'NovelAI token is not set in API Connections.' });
        try {
            const r = await fetch(`${IMAGE_NOVELAI}/user/subscription`, {
                headers: { 'Authorization': `Bearer ${key}` },
            });
            if (!r.ok) return res.status(r.status).send({ error: await r.text() });
            return res.send(await r.json());
        } catch (error) {
            console.error('[nai-imagegen] status failed', error);
            return res.status(500).send({ error: String(error) });
        }
    });

    router.post('/generate', async (req, res) => {
        const key = getKey(req);
        if (!key) return res.status(400).send({ error: 'NovelAI token is not set in API Connections.' });

        const body = req.body ?? {};
        const model = ALLOWED_MODELS.includes(body.model) ? body.model : ALLOWED_MODELS[0];

        try {
            const payload = buildPayload(model, body);
            console.debug('[nai-imagegen] request', model, payload.input);

            const r = await fetch(`${IMAGE_NOVELAI}/ai/generate-image`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!r.ok) {
                const text = await r.text();
                let message = text;
                try { message = JSON.parse(text).message ?? text; } catch { /* not JSON */ }
                console.warn('[nai-imagegen] NovelAI error', r.status, text);
                return res.status(r.status >= 400 && r.status < 600 ? r.status : 500).send({ error: `NovelAI ${r.status}: ${message}` });
            }

            const png = await extractFileFromZipBuffer(await r.arrayBuffer(), '.png');
            if (!png) return res.status(500).send({ error: 'NovelAI response contained no PNG.' });

            return res.send({ image: png.toString('base64'), seed: payload.parameters.seed });
        } catch (error) {
            console.error('[nai-imagegen] generate failed', error);
            return res.status(500).send({ error: String(error) });
        }
    });
}

function getKey(req) {
    return readSecret(req.user.directories, SECRET_KEYS.NOVEL);
}

const clamp01 = (v) => Math.min(0.9, Math.max(0.1, Number(v)));

/**
 * Builds a V4+ generate-image request body.
 * body.characters: [{ prompt, negative, x?, y? }] — x/y in 0.1..0.9, omitted = auto placement.
 */
function buildPayload(model, body) {
    const width = snap64(body.width ?? 832);
    const height = snap64(body.height ?? 1216);
    const seed = Number.isInteger(body.seed) && body.seed >= 0 ? body.seed : Math.floor(Math.random() * 4294967295);
    const prompt = String(body.prompt ?? '');
    const negative = String(body.negative_prompt ?? '');

    const characters = (Array.isArray(body.characters) ? body.characters : [])
        .filter(c => c && String(c.prompt ?? '').trim())
        .slice(0, 6);
    const useCoords = characters.some(c => c.x != null && c.y != null);
    const centerOf = (c) => ({
        x: c.x != null ? clamp01(c.x) : 0.5,
        y: c.y != null ? clamp01(c.y) : 0.5,
    });

    // Sigma constant for V5 is unknown, so Variety Boost is only applied to V4/V4.5.
    const isV5 = model.includes('nai-diffusion-5');
    const isV45 = model.includes('nai-diffusion-4-5');
    const varietyBoost = !!body.variety_boost && !isV5;

    return {
        input: prompt,
        model,
        action: 'generate',
        parameters: {
            params_version: 3,
            width,
            height,
            scale: Number(body.scale ?? 5),
            sampler: String(body.sampler ?? 'k_euler_ancestral'),
            steps: Math.min(50, Math.max(1, Number(body.steps ?? 28))),
            n_samples: 1,
            seed,
            extra_noise_seed: seed,
            ucPreset: 0,
            qualityToggle: false,
            autoSmea: false,
            sm: false,
            sm_dyn: false,
            dynamic_thresholding: !!body.decrisper,
            controlnet_strength: 1,
            legacy: false,
            add_original_image: true,
            cfg_rescale: Number(body.cfg_rescale ?? 0),
            noise_schedule: String(body.noise_schedule ?? 'karras'),
            legacy_v3_extend: false,
            legacy_uc: false,
            uncond_scale: 1,
            deliberate_euler_ancestral_bug: false,
            prefer_brownian: true,
            skip_cfg_above_sigma: varietyBoost
                ? Math.sqrt((width * height) / REFERENCE_PIXEL_COUNT) * (isV45 ? SIGMA_MAGIC_NUMBER_V4_5 : SIGMA_MAGIC_NUMBER)
                : null,
            use_coords: useCoords,
            normalize_reference_strength_multiple: true,
            inpaintImg2ImgStrength: 1,
            negative_prompt: negative,
            prompt,
            characterPrompts: characters.map(c => ({
                prompt: String(c.prompt),
                uc: String(c.negative ?? ''),
                center: centerOf(c),
                enabled: true,
            })),
            v4_prompt: {
                caption: {
                    base_caption: prompt,
                    char_captions: characters.map(c => ({ char_caption: String(c.prompt), centers: [centerOf(c)] })),
                },
                use_coords: useCoords,
                use_order: true,
            },
            v4_negative_prompt: {
                caption: {
                    base_caption: negative,
                    char_captions: characters.map(c => ({ char_caption: String(c.negative ?? ''), centers: [centerOf(c)] })),
                },
                legacy_uc: false,
            },
            reference_image_multiple: [],
            reference_information_extracted_multiple: [],
            reference_strength_multiple: [],
        },
    };
}

function snap64(v) {
    const n = Math.round(Number(v) / 64) * 64;
    return Math.min(2048, Math.max(64, n || 64));
}
