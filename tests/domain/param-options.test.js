/**
 * domain/nai/param-options · 对照表、换模型回退、Variety、成对字段展开。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    NAI_MODEL_OPTIONS,
    NAI_SAMPLER_OPTIONS,
    NAI_NOISE_SCHEDULE_OPTIONS,
    NAI_UC_PRESET_OPTIONS,
    NAI_SIZE_PRESETS,
    UC_PRESET_NONE,
    classifyNaiModel,
    coerceNaiParams,
    computeVarietySigma,
    expandNaiParamFields,
    formatNaiModelInput,
    isKnownNaiModel,
    isNaiMediumModel,
    resolveNaiModelInput,
    isMultipleOf64,
    matchSizePresetId,
    mergeNaiParamsForGenerate,
    officialQualityTags,
    officialUndesiredContent,
    noiseSchedulesForModel,
    reconcileParamsForModel,
    samplersForModel,
    smeaFlagsFromMode,
    smeaModeFromFlags,
    supportsCfgRescale,
    supportsNoiseScheduleSelect,
    supportsSmea,
    supportsTransparentBackground,
    supportsVariety,
    ucPresetsForModel,
} from '../../src/domain/nai/param-options.js';
import { defaultNaiParams } from '../../src/domain/model/nai-params.js';
import { assembleNaiPayload } from '../../src/domain/nai/payload-assembler.js';
import { emptyNaiCaption } from '../../src/domain/model/nai-params.js';
import { ERROR_CATEGORY } from '../../src/infra/errors.js';

describe('V5 Medium', () => {
    for (const model of ['nai-diffusion-5-full-medium', 'nai-diffusion-5-full-medium-inpainting']) {
        it(`${model}: catalog and model switch enforce official constraints`, () => {
            assert.ok(isKnownNaiModel(model));
            assert.ok(isNaiMediumModel(model));
            assert.equal(resolveNaiModelInput(formatNaiModelInput(model)), model);
            assert.equal(classifyNaiModel(model), 'v5');
            assert.equal(supportsCfgRescale(model), false);
            assert.equal(supportsTransparentBackground(model), true);
            assert.deepEqual(samplersForModel(model).map((o) => o.value), ['k_euler_ancestral']);
            assert.deepEqual(ucPresetsForModel(model).map((o) => o.value), [0]);
            const { params } = reconcileParamsForModel({
                ...defaultNaiParams(), steps: 28, sampler: 'k_euler', ucPreset: 4,
                cfg_rescale: 0.5, scale: 7, noise_schedule: 'native',
            }, model);
            assert.equal(params.steps, 14);
            assert.equal(params.sampler, 'k_euler_ancestral');
            assert.equal(params.ucPreset, 0);
            assert.equal(params.tag_hint_uc_preset, true);
            assert.equal(params.cfg_rescale, 0);
            assert.equal(params.noise_schedule, 'karras');
            assert.equal(params.scale, 7);
            assert.equal(isNaiMediumModel('nai-diffusion-5-full'), false);
            assert.equal(isNaiMediumModel('nai-diffusion-5-curated'), false);
        });

        it(`${model}: inherited parameters fall back; invalid explicit overrides fail`, () => {
            const base = { ...defaultNaiParams(), sampler: 'k_euler', ucPreset: 4, cfg_rescale: 0.3 };
            const inherited = mergeNaiParamsForGenerate(base, { model });
            assert.equal(inherited.ok, true);
            assert.equal(inherited.value.params.steps, 14);
            assert.equal(inherited.value.params.sampler, 'k_euler_ancestral');
            assert.equal(inherited.value.params.ucPreset, 0);
            assert.equal(inherited.value.params.cfg_rescale, 0);
            for (const [field, value] of [
                ['steps', 28], ['sampler', 'k_euler'], ['ucPreset', 4],
                ['cfg_rescale', 0.3], ['tag_hint_uc_preset', false],
            ]) {
                const result = mergeNaiParamsForGenerate(base, { model, [field]: value });
                assert.equal(result.ok, false, field);
                assert.equal(result.error.code, 'NAI_PARAMS_INVALID');
                assert.equal(result.error.context.field, field);
            }
            assert.equal(mergeNaiParamsForGenerate(base, {
                model, steps: 14, sampler: 'k_euler_ancestral', ucPreset: 0, cfg_rescale: 0,
            }).ok, true);
        });

        it(`${model}: sends fixed UC only and preserves prompt drafts`, () => {
            const caption = emptyNaiCaption();
            caption.v4_prompt.caption.base_caption = 'a landscape, -3::hat::';
            caption.v4_prompt.caption.char_captions = [{ char_caption: 'girl', centers: [{ x: 0.3, y: 0.5 }] }];
            caption.v4_negative_prompt.caption.base_caption = 'CUSTOM_SCENE_NEG';
            caption.v4_negative_prompt.caption.char_captions = [{ char_caption: 'CUSTOM_CHAR_NEG' }];
            const artist = { positivePrompt: 'ARTIST_POS', negativePrompt: 'CUSTOM_ARTIST_NEG' };
            const original = structuredClone({ caption, artist });
            const payload = assembleNaiPayload({
                caption, artist, params: { ...defaultNaiParams(), model },
                replaceCharacterKeywords: false,
                paramOverrides: { steps: 28, sampler: 'k_euler', ucPreset: 4, cfg_rescale: 0.5 },
            });
            assert.equal(payload.model, model);
            assert.equal(payload.parameters.steps, 14);
            assert.equal(payload.parameters.sampler, 'k_euler_ancestral');
            assert.equal(payload.parameters.cfg_rescale, 0);
            assert.equal(payload.parameters.ucPreset, 0);
            assert.equal(payload.negative_prompt, officialUndesiredContent(model, 0));
            assert.equal(payload.parameters.negative_prompt, payload.negative_prompt);
            assert.equal(payload.parameters.v4_negative_prompt.caption.base_caption, payload.negative_prompt);
            assert.deepEqual(payload.parameters.v4_negative_prompt.caption.char_captions, [
                { char_caption: '', centers: [{ x: 0.3, y: 0.5 }] },
            ]);
            assert.equal(JSON.stringify(payload).includes('CUSTOM_'), false);
            assert.match(payload.input, /ARTIST_POS, a landscape, -3::hat::/);
            assert.deepEqual(payload.parameters.v4_prompt.caption.char_captions, caption.v4_prompt.caption.char_captions);
            assert.deepEqual({ caption, artist }, original);
            const high = assembleNaiPayload({
                caption, artist, params: { ...defaultNaiParams(), model: 'nai-diffusion-5-full' },
                replaceCharacterKeywords: false,
            });
            assert.match(high.negative_prompt, /CUSTOM_ARTIST_NEG, CUSTOM_SCENE_NEG/);
            assert.equal(high.parameters.v4_negative_prompt.caption.char_captions[0].char_caption, 'CUSTOM_CHAR_NEG');
        });
    }
});

describe('param-options catalog', () => {
    it('lists only V4+ models the assembler can shape', () => {
        const ids = NAI_MODEL_OPTIONS.map((o) => o.value);
        assert.ok(ids.includes('nai-diffusion-5-curated'));
        assert.ok(ids.includes('nai-diffusion-4-5-full'));
        assert.ok(ids.includes('nai-diffusion-5-full'));
        assert.ok(ids.includes('nai-diffusion-5-full-inpainting'));
        assert.ok(ids.includes('nai-diffusion-4-5-curated-inpainting'));
        assert.ok(ids.includes('nai-diffusion-4-5-full-inpainting'));
        assert.ok(ids.includes('nai-diffusion-4-curated-inpainting'));
        assert.ok(ids.includes('nai-diffusion-4-full-inpainting'));
        assert.equal(ids.includes('nai-diffusion-5-curated-inpainting'), false);
        assert.equal(NAI_MODEL_OPTIONS[0].value, 'nai-diffusion-5-curated');
        assert.equal(NAI_MODEL_OPTIONS[0].label, 'NAI Diffusion V5 Curated');
        assert.equal(ids.some((id) => id.includes('diffusion-3')), false);
        assert.equal(ids.some((id) => id.includes('diffusion-2')), false);
        assert.ok(isKnownNaiModel('nai-diffusion-4-5-full'));
        assert.equal(isKnownNaiModel('nai-diffusion-3'), false);
    });

    it('resolves a preset label, a display string, or a hand-typed id', () => {
        assert.equal(
            resolveNaiModelInput('NAI Diffusion V5 Curated'),
            'nai-diffusion-5-curated',
        );
        assert.equal(
            resolveNaiModelInput('NAI Diffusion V5 Curated（nai-diffusion-5-curated）'),
            'nai-diffusion-5-curated',
        );
        assert.equal(resolveNaiModelInput('nai-diffusion-5-curated'), 'nai-diffusion-5-curated');
        assert.equal(resolveNaiModelInput('  nai-diffusion-6-full  '), 'nai-diffusion-6-full');
        assert.equal(resolveNaiModelInput(''), '');
        assert.equal(
            formatNaiModelInput('nai-diffusion-5-curated'),
            'NAI Diffusion V5 Curated（nai-diffusion-5-curated）',
        );
        assert.equal(formatNaiModelInput('nai-diffusion-6-full'), 'nai-diffusion-6-full');
    });

    it('samplers / noise / uc / size presets match sources', () => {
        assert.deepEqual(
            NAI_SAMPLER_OPTIONS.map((o) => o.value),
            [
                'k_euler_ancestral',
                'k_euler',
                'k_dpmpp_2s_ancestral',
                'k_dpmpp_2m',
                'k_dpmpp_sde',
                'ddim_v3',
            ],
        );
        assert.deepEqual(
            NAI_NOISE_SCHEDULE_OPTIONS.map((o) => o.value),
            ['karras', 'native', 'exponential', 'polyexponential'],
        );
        assert.deepEqual(
            NAI_UC_PRESET_OPTIONS.map((o) => o.value),
            [0, 1, 2, 3, 4],
        );
        assert.equal(UC_PRESET_NONE, 4);
        assert.equal(NAI_SIZE_PRESETS.length, 3);
        assert.equal(matchSizePresetId(832, 1216), 'portrait');
        assert.equal(matchSizePresetId(800, 1200), 'custom');
        assert.equal(isMultipleOf64(832), true);
        assert.equal(isMultipleOf64(833), false);
    });

    it('model capabilities follow app behavior', () => {
        assert.equal(classifyNaiModel('nai-diffusion-5-curated'), 'v5');
        assert.equal(classifyNaiModel('nai-diffusion-5-full'), 'v5');
        assert.equal(classifyNaiModel('nai-diffusion-5-full-inpainting'), 'v5');
        assert.equal(classifyNaiModel('nai-diffusion-4-5-full'), 'v45');
        assert.equal(supportsSmea('nai-diffusion-4-5-full'), false);
        assert.equal(supportsSmea('nai-diffusion-5-full'), false);
        assert.equal(supportsSmea('nai-diffusion-3'), true);
        assert.equal(supportsVariety('nai-diffusion-4-5-full'), true);
        assert.equal(supportsVariety('nai-diffusion-5-full'), false);
        assert.equal(supportsCfgRescale('nai-diffusion-5-full'), true);
        assert.equal(supportsCfgRescale('nai-diffusion-4-full'), true);
        assert.equal(supportsCfgRescale('nai-diffusion-4-5-full'), true);
        assert.equal(supportsNoiseScheduleSelect('nai-diffusion-5-full'), false);
        assert.equal(noiseSchedulesForModel('nai-diffusion-5-full').length, 1);
        assert.equal(supportsTransparentBackground('nai-diffusion-5-full'), true);
        assert.equal(supportsTransparentBackground('nai-diffusion-4-5-full'), false);
    });
});

describe('variety sigma (app wM)', () => {
    it('matches Math.sqrt(w*h/1011712)*58 for 832×1216', () => {
        const expected = Math.sqrt((832 * 1216) / 1011712) * 58;
        assert.equal(computeVarietySigma(832, 1216), expected);
        assert.equal(expected, 58);
    });
});

describe('reconcile / coerce on model change', () => {
    it('falls back unsupported sampler / noise / uc with notices', () => {
        const { params, notices } = reconcileParamsForModel({
            ...defaultNaiParams(),
            sampler: 'not-a-sampler',
            noise_schedule: 'bogus',
            ucPreset: 99,
        }, 'nai-diffusion-4-5-full');
        assert.equal(params.sampler, 'k_euler_ancestral');
        assert.equal(params.noise_schedule, 'karras');
        assert.equal(params.ucPreset, 0);
        assert.ok(notices.length >= 3);
    });

    it('V5 forces karras, clears variety / smea, keeps cfg rescale', () => {
        const { params, notices } = reconcileParamsForModel({
            ...defaultNaiParams(),
            noise_schedule: 'native',
            skip_cfg_above_sigma: 58,
            cfg_rescale: 0.5,
            sm: true,
            sm_dyn: true,
        }, 'nai-diffusion-5-full');
        assert.equal(params.noise_schedule, 'karras');
        assert.equal(params.skip_cfg_above_sigma, null);
        assert.equal(params.cfg_rescale, 0.5);
        assert.equal(params.sm, false);
        assert.equal(params.sm_dyn, false);
        assert.ok(notices.some((n) => n.includes('Karras')));
        assert.ok(notices.some((n) => n.includes('Variety')));
    });

    it('hand-typed model id is kept', () => {
        const { params, notices } = reconcileParamsForModel(
            defaultNaiParams(),
            'nai-diffusion-6-full',
        );
        assert.equal(params.model, 'nai-diffusion-6-full');
        assert.equal(notices.some((n) => n.includes('不受支持')), false);
    });

    it('empty model falls back to default', () => {
        const { params, notices } = reconcileParamsForModel(defaultNaiParams(), '  ');
        assert.equal(params.model, defaultNaiParams().model);
        assert.ok(notices[0].includes('未填写模型'));
    });
});

describe('paired field expand + assemble', () => {
    it('quality / uc none / transparent expand as pairs', () => {
        const off = expandNaiParamFields({
            ...defaultNaiParams(),
            model: 'nai-diffusion-5-full',
            qualityToggle: false,
            ucPreset: UC_PRESET_NONE,
            straight_alpha: true,
        });
        assert.equal(off.qualityToggle, false);
        assert.equal(off.tag_hint_qt, false);
        assert.equal(off.ucPreset, 4);
        assert.equal(off.tag_hint_uc_preset, false);
        assert.equal(off.straight_alpha, true);
        assert.equal(off.tag_hint_transparent_background, true);
        assert.equal(off.skip_cfg_above_sigma, null);
        assert.equal('sm' in off, false);
    });

    it('Variety on 4.5 recomputes sigma; SMEA absent', () => {
        const out = expandNaiParamFields({
            ...defaultNaiParams(),
            model: 'nai-diffusion-4-5-full',
            width: 1024,
            height: 1024,
            skip_cfg_above_sigma: 1,
            sm: true,
            sm_dyn: true,
        });
        assert.equal(out.skip_cfg_above_sigma, computeVarietySigma(1024, 1024));
        assert.equal('sm' in out, false);
    });

    it('assembleNaiPayload uses expand (paired + no SMEA on 4.5)', () => {
        const result = assembleNaiPayload({
            caption: emptyNaiCaption(),
            params: {
                ...defaultNaiParams(),
                qualityToggle: true,
                ucPreset: 0,
                skip_cfg_above_sigma: 1,
                sm: true,
                sm_dyn: true,
                straight_alpha: true,
            },
            artist: null,
            replaceCharacterKeywords: false,
        });
        assert.equal(result.parameters.qualityToggle, true);
        assert.equal(result.parameters.tag_hint_qt, true);
        assert.equal(result.parameters.tag_hint_uc_preset, true);
        assert.equal(result.parameters.skip_cfg_above_sigma, 58);
        assert.equal('sm' in result.parameters, false);
        // 4.5 不支持透明底 → 关，也不改提示词
        assert.equal(result.parameters.straight_alpha, false);
        assert.equal(result.parameters.tag_hint_transparent_background, false);
        assert.equal(result.input.includes('transparent background'), false);
    });

    it('V5 transparent switch prepends the prompt tag', () => {
        const result = assembleNaiPayload({
            caption: {
                ...emptyNaiCaption(),
                v4_prompt: {
                    caption: {
                        base_caption: '1girl, classroom',
                        char_captions: [],
                    },
                },
            },
            params: {
                ...defaultNaiParams(),
                model: 'nai-diffusion-5-full',
                straight_alpha: true,
            },
            artist: null,
            replaceCharacterKeywords: false,
        });
        assert.equal(
            result.input,
            `transparent background, 1girl, classroom, ${officialQualityTags(true)}`,
        );
        assert.equal(result.parameters.v4_prompt.caption.base_caption, result.input);
        const again = assembleNaiPayload({
            caption: {
                ...emptyNaiCaption(),
                v4_prompt: {
                    caption: {
                        base_caption: 'transparent background, already',
                        char_captions: [],
                    },
                },
            },
            params: {
                ...defaultNaiParams(),
                model: 'nai-diffusion-5-full',
                tag_hint_transparent_background: true,
            },
            artist: null,
            replaceCharacterKeywords: false,
        });
        assert.equal(again.input, `transparent background, already, ${officialQualityTags(true)}`);
    });

    it('writes official quality tags and UC text, without an nsfw prefix', () => {
        const off = assembleNaiPayload({
            caption: {
                ...emptyNaiCaption(),
                v4_prompt: { caption: { base_caption: 'scene', char_captions: [] } },
                v4_negative_prompt: { caption: { base_caption: 'bad hands', char_captions: [] } },
            },
            params: {
                ...defaultNaiParams(),
                qualityToggle: false,
                ucPreset: 4,
            },
            artist: null,
            replaceCharacterKeywords: false,
        });
        assert.equal(off.input, 'scene');
        assert.equal(off.negative_prompt, 'bad hands');

        const light = assembleNaiPayload({
            caption: {
                ...emptyNaiCaption(),
                v4_prompt: { caption: { base_caption: 'scene', char_captions: [] } },
                v4_negative_prompt: { caption: { base_caption: 'bad hands', char_captions: [] } },
            },
            params: {
                ...defaultNaiParams(),
                model: 'nai-diffusion-5-full',
                qualityToggle: true,
                ucPreset: 1,
            },
            artist: null,
            replaceCharacterKeywords: false,
        });
        const uc = officialUndesiredContent('nai-diffusion-5-full', 1);
        assert.equal(light.input, `scene, ${officialQualityTags(true)}`);
        assert.equal(light.negative_prompt, `${uc}, bad hands`);
        assert.equal(light.negative_prompt.includes('nsfw'), false);
        assert.equal(uc.includes('bad hands'), true);
        assert.equal(officialUndesiredContent('nai-diffusion-4-5-full', 1).includes('bad hands'), false);
    });

    it('smea mode helpers', () => {
        assert.equal(smeaModeFromFlags(true, true), 'smea_dyn');
        assert.deepEqual(smeaFlagsFromMode('smea'), { sm: true, sm_dyn: false });
        assert.deepEqual(smeaFlagsFromMode('off'), { sm: false, sm_dyn: false });
    });

    it('coerceNaiParams silently fixes illegal combos for UI / save', () => {
        const coerced = coerceNaiParams({
            ...defaultNaiParams(),
            model: 'nai-diffusion-5-full',
            sampler: 'nope',
            noise_schedule: 'exponential',
            skip_cfg_above_sigma: 99,
        });
        assert.equal(coerced.sampler, 'k_euler_ancestral');
        assert.equal(coerced.noise_schedule, 'karras');
        assert.equal(coerced.skip_cfg_above_sigma, null);
    });
});

describe('mergeNaiParamsForGenerate (4.14)', () => {
    it('explicit hand-typed model is accepted', () => {
        const r = mergeNaiParamsForGenerate(defaultNaiParams(), {
            model: 'NAI Diffusion V5 Curated（nai-diffusion-5-curated）',
        });
        assert.equal(r.ok, true);
        assert.equal(r.value.params.model, 'nai-diffusion-5-curated');
    });

    it('explicit empty model → Err', () => {
        const r = mergeNaiParamsForGenerate(defaultNaiParams(), { model: '  ' });
        assert.equal(r.ok, false);
        assert.equal(r.error.context.field, 'model');
    });

    it('explicit illegal sampler → Err with field / allowed context', () => {
        const r = mergeNaiParamsForGenerate(defaultNaiParams(), {
            sampler: 'not-a-sampler',
        });
        assert.equal(r.ok, false);
        assert.equal(r.error.category, ERROR_CATEGORY.DOMAIN);
        assert.equal(r.error.code, 'NAI_PARAMS_INVALID');
        assert.equal(r.error.context.field, 'sampler');
        assert.ok(Array.isArray(r.error.context.allowed));
        assert.match(r.error.message, /采样器「not-a-sampler」/);
    });

    it('explicit Variety on V5 → Err', () => {
        const r = mergeNaiParamsForGenerate(defaultNaiParams(), {
            model: 'nai-diffusion-5-full',
            skip_cfg_above_sigma: 58,
        });
        assert.equal(r.ok, false);
        assert.equal(r.error.context.field, 'skip_cfg_above_sigma');
        assert.match(r.error.message, /不支持 Variety/);
    });

    it('explicit width not multiple of 64 → Err', () => {
        const r = mergeNaiParamsForGenerate(defaultNaiParams(), { width: 800 });
        assert.equal(r.ok, false);
        assert.equal(r.error.context.field, 'width');
        assert.match(r.error.message, /宽「800」无效/);
    });

    it('only switch model: inherited illegal fields fall back (no Err)', () => {
        const base = {
            ...defaultNaiParams(),
            model: 'nai-diffusion-4-5-full',
            noise_schedule: 'native',
            skip_cfg_above_sigma: 58,
            cfg_rescale: 0.4,
            sm: true,
            sm_dyn: true,
            straight_alpha: false,
        };
        const r = mergeNaiParamsForGenerate(base, { model: 'nai-diffusion-5-full' });
        assert.equal(r.ok, true);
        assert.equal(r.value.params.model, 'nai-diffusion-5-full');
        assert.equal(r.value.params.noise_schedule, 'karras');
        assert.equal(r.value.params.skip_cfg_above_sigma, null);
        assert.equal(r.value.params.cfg_rescale, 0.4);
        assert.equal(r.value.params.sm, false);
        assert.equal(r.value.params.sm_dyn, false);
    });

    it('passes non-schema keys through as extras', () => {
        const r = mergeNaiParamsForGenerate(defaultNaiParams(), {
            some_native_field: 1,
        });
        assert.equal(r.ok, true);
        assert.equal(r.value.extras.some_native_field, 1);
    });
});
