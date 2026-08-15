import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { protect, requireRole } from '../middleware/auth.js';
import { catchAsync } from '../utils/catchAsync.js';
import { success } from '../utils/response.js';
import { createLogger } from '../config/logger.js';
import { openAIService } from '../services/OpenAIService.js';
import { storageService } from '../services/StorageService.js';
import { User } from '../models/User.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  matchCategories,
  pickRandomPets,
  buildPetImagePrompt,
  ALL_PETS,
  LIGHT_COLORS,
  DARK_COLORS,
  type GeneratedPet,
} from '../constants/pets.js';
import { isValidPoseKey, POSE_PROMPTS } from '../constants/petPoses.js';
import { petService } from '../services/PetService.js';
import { createDefaultSkills } from '../services/SkillXpService.js';
const log = createLogger('PetsRoute');
const router = Router();

// ─── Schemas ────────────────────────────────────────────────────────────────

const generateSchema = {
  body: z.object({
    personalityVibe: z.string().min(1),
    companionStyle: z.string().min(1),
  }),
};

const selectSchema = {
  body: z.object({
    name: z.string().min(1),
    customName: z.string().min(1),
    vibe: z.string().min(1),
    category: z.string().min(1),
    special: z.boolean(),
    baseColor: z.string().min(1),
    secondaryColor: z.string().min(1),
    image: z.string().min(1), // base64 data URI
  }),
};

const generatePoseSchema = {
  body: z.object({
    /** User's pose description, e.g. "sleeping", "sitting", "excited" */
    posePrompt: z.string().min(1).max(200),
    /** Key to store under pet.pose — must be a valid PetPose (sleeping, sleepy, sitting, standing, happy) */
    poseKey: z.string().min(1).max(50),
    /** If true, also updates the pet's main imageUrl with the generated pose */
    saveAsDefault: z.boolean().optional().default(false),
  }),
};

const updatePetImageSchema = {
  body: z.object({
    imageUrl: z.string().url(),
  }),
};

const savePoseSchema = {
  body: z.object({
    poseKey: z.string().refine(isValidPoseKey, { message: 'Invalid pose key' }),
    imageUrl: z.string().url(),
  }),
};

const generateOneSchema = {
  body: z.object({
    name: z.string().min(1),
    vibe: z.string().min(1),
    baseColor: z.string().min(1),
    secondaryColor: z.string().min(1),
    customName: z.string().optional(),
  }),
};

// ─── GET /pets/catalog ──────────────────────────────────────────────────────

/**
 * Returns all pets available for onboarding. Admin-only.
 * Used by pet-pose admin to change pet to any from catalog.
 */
router.get(
  '/catalog',
  protect,
  requireRole('admin', 'superadmin'),
  catchAsync(async (_req, res) => {
    const pets = ALL_PETS.map((p) => ({ name: p.name, vibe: p.vibe, category: p.category }));
    success(res, { pets });
  }),
);

// ─── POST /pets/generate-one ─────────────────────────────────────────────────

/**
 * Generates a single pet image for a chosen pet from the catalog and updates the user's pet.
 * Admin-only. Uses gpt-image-1-mini.
 */
router.post(
  '/generate-one',
  protect,
  requireRole('admin', 'superadmin'),
  validate(generateOneSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const { name, vibe, baseColor, secondaryColor, customName } = req.body;

    const def = ALL_PETS.find((p) => p.name === name && p.vibe === vibe);
    if (!def) {
      throw new AppError(`Pet "${name}" with vibe "${vibe}" not found in catalog`, 400, 'PET_NOT_FOUND');
    }

    const pet: GeneratedPet = {
      ...def,
      baseColor,
      secondaryColor,
    };

    log.info({ userId, petName: name }, 'Generating single pet from catalog');

    const prompt = buildPetImagePrompt(pet);
    const imageDataUri = await openAIService.generateImageBase64(prompt, {
      model: 'gpt-image-1-mini',
    });

    const imageUrl = await storageService.uploadBase64(imageDataUri, `pets/${userId}`);

    const user = await User.findById(userId).select('pet').lean();
    const currentPet = user?.pet;

    await User.findByIdAndUpdate(
      userId,
      {
        pet: {
          name,
          customName: customName ?? name,
          vibe,
          category: def.category,
          special: def.special,
          baseColor,
          secondaryColor,
          imageUrl,
          level: currentPet?.level ?? 1,
          xp: currentPet?.xp ?? 0,
          xpToNextLevel: currentPet?.xpToNextLevel ?? 100,
          hunger: currentPet?.hunger ?? 100,
          happy: currentPet?.happy ?? 100,
          mood: currentPet?.mood ?? 100,
        },
      },
      { new: true, runValidators: true },
    );

    const updated = await User.findById(userId).select('pet').lean();
    log.info({ userId, imageUrl }, 'Pet replaced with new generated image');

    success(res, { pet: updated?.pet });
  }),
);

// ─── POST /pets/generate ────────────────────────────────────────────────────

/**
 * Generates 3 random pet options based on the user's personality answers.
 * Each pet gets a unique chibi illustration via GPT-image-1-mini.
 *
 * Returns the pet metadata + base64 image data URIs.
 * The frontend calls this after phone verification so images generate
 * while the user fills out the remaining onboarding screens.
 */
router.post(
  '/generate',
  protect,
  validate(generateSchema),
  catchAsync(async (req, res) => {
    const { personalityVibe, companionStyle } = req.body;

    log.info({ personalityVibe, companionStyle, userId: req.user?._id?.toString() }, 'Generating pet options');

    const categories = matchCategories(personalityVibe, companionStyle);
    const pets = pickRandomPets(categories, 3);

    log.info(
      { categories, pets: pets.map((p) => p.name) },
      'Selected pet candidates, generating images',
    );

    const results = await Promise.all(
      pets.map(async (pet: GeneratedPet) => {
        const prompt = buildPetImagePrompt(pet);
        try {
          const imageDataUri = await openAIService.generateImageBase64(prompt, {
            model: 'gpt-image-1-mini',
          });
          return { ...pet, image: imageDataUri };
        } catch (err) {
          log.warn({ err, pet: pet.name }, 'Image gen failed for pet, using placeholder');
          return { ...pet, image: null };
        }
      }),
    );

    success(res, { pets: results });
  }),
);

// ─── POST /pets/save-draft ──────────────────────────────────────────────────

/**
 * Eagerly persists the user's chosen pet during onboarding so it
 * survives app crashes / force-closes on the subscription page.
 *
 * Uploads the base64 image to R2 and saves pet metadata to the user
 * document but does **not** flip `onboardingComplete`.
 * Idempotent — safe to call multiple times.
 */
router.post(
  '/save-draft',
  protect,
  validate(selectSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const { name, customName, vibe, category, special, baseColor, secondaryColor, image } = req.body;

    log.info({ userId, petName: name, customName }, '[save-draft] Persisting pet early — uploading image to R2');

    const imageUrl = await storageService.uploadBase64(image, `pets/${userId}`);

    log.info({ userId, imageUrl }, '[save-draft] Pet image uploaded, saving to user document (onboardingComplete untouched)');

    const user = await User.findByIdAndUpdate(
      userId,
      {
        pet: {
          name, customName, vibe, category, special, baseColor, secondaryColor, imageUrl,
          level: 0, xp: 0, xpToNextLevel: 1,
        },
      },
      { new: true, runValidators: true },
    );

    if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

    if (!user.skills) {
      user.skills = createDefaultSkills();
      user.markModified('skills');
      await user.save();
    }

    log.info({ userId, hasPet: !!user.pet }, '[save-draft] Pet draft saved successfully');

    success(res, { pet: user.pet });
  }),
);

// ─── POST /pets/select ──────────────────────────────────────────────────────

/**
 * Called when the user confirms their chosen pet during onboarding.
 *
 * 1. Decodes the base64 image and uploads it to Cloudflare R2
 * 2. Saves the pet metadata + public image URL to the user document
 * 3. Sets `onboardingComplete: true`
 * 4. Returns the persisted pet with the permanent R2 URL
 *
 * Kept for backward compatibility — the primary onboarding flow now
 * uses `save-draft` + `completeOnboarding` instead.
 */
router.post(
  '/select',
  protect,
  validate(selectSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const { name, customName, vibe, category, special, baseColor, secondaryColor, image } = req.body;

    log.info({ userId, petName: name, customName }, 'User selecting pet — uploading image to R2');

    const imageUrl = await storageService.uploadBase64(image, `pets/${userId}`);

    log.info({ userId, imageUrl }, 'Pet image uploaded, saving to user document');

    const user = await User.findByIdAndUpdate(
      userId,
      {
        pet: {
          name, customName, vibe, category, special, baseColor, secondaryColor, imageUrl,
          level: 0, xp: 0, xpToNextLevel: 1,
        },
        onboardingComplete: true,
      },
      { new: true, runValidators: true },
    );

    if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

    if (!user.skills) {
      user.skills = createDefaultSkills();
      user.markModified('skills');
      await user.save();
    }

    success(res, {
      pet: user.pet,
    });
  }),
);

// ─── POST /pets/generate-pose ────────────────────────────────────────────────

/**
 * Generates a new pose of the user's pet using their current pet image as reference.
 * Uses OpenAI's image edit API with high input fidelity to preserve style, colors,
 * and proportions exactly — only the pose/action changes per the user's prompt.
 *
 * @example posePrompt: "sleeping" → same pet, sleeping pose
 * @example posePrompt: "sitting and waving" → same pet, sitting and waving
 */
router.post(
  '/generate-pose',
  protect,
  requireRole('admin', 'superadmin'),
  validate(generatePoseSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const { posePrompt, poseKey, saveAsDefault } = req.body;

    const user = await User.findById(userId).select('pet').lean();
    if (!user?.pet?.imageUrl) {
      throw new AppError('No pet image found', 400, 'PET_IMAGE_REQUIRED');
    }

    const refUrl = user.pet.imageUrl;
    log.info({ userId, posePrompt }, 'Generating pet pose from reference');

    const imageRes = await fetch(refUrl);
    if (!imageRes.ok) {
      throw new AppError('Failed to fetch pet image', 502, 'FETCH_IMAGE_FAILED');
    }
    const arrayBuffer = await imageRes.arrayBuffer();
    const refBase64 = Buffer.from(arrayBuffer).toString('base64');

    const effectivePrompt =
      (isValidPoseKey(poseKey) && POSE_PROMPTS[poseKey]) ?? posePrompt;

    const prompt = `Recreate this exact pet character in a new pose. CRITICAL:
- Keep the pet's proportions, art style, colors, markings, and species EXACTLY identical.
- Preserve the black outlines and cel-shaded/cartoon line-art style — the reference has dark outlines around all features; your output MUST have the same black outlines.
- Only change the pose or expression to: ${effectivePrompt}.
The result must look like the same pet in the exact same art style, just in a different pose.`;

    const dataUri = await openAIService.editImageBase64(refBase64, prompt, {
      size: '1024x1024',
      quality: 'medium',
      background: 'transparent',
      inputFidelity: 'high',
    });

    const imageUrl = await storageService.uploadBase64(dataUri, `pets/${userId}/poses`);

    await User.findByIdAndUpdate(userId, {
      $set: {
        [`pet.pose.${poseKey}`]: imageUrl,
        ...(saveAsDefault && { 'pet.imageUrl': imageUrl }),
      },
    });
    if (saveAsDefault) log.info({ userId, imageUrl }, 'Pet pose saved as default');
    log.info({ userId, poseKey, imageUrl }, 'Pet pose saved to pet.pose');

    success(res, { imageUrl, poseKey, savedAsDefault: saveAsDefault ?? false });
  }),
);

// ─── PATCH /pets/me/image ────────────────────────────────────────────────────

/**
 * Updates the authenticated user's pet image URL.
 * Used when the user selects a generated pose to use as their main pet image.
 */
router.patch(
  '/me/image',
  protect,
  validate(updatePetImageSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const { imageUrl } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      { 'pet.imageUrl': imageUrl },
      { new: true, runValidators: true },
    );

    if (!user?.pet) throw new AppError('No pet found', 404, 'PET_NOT_FOUND');

    log.info({ userId, imageUrl }, 'Pet image updated');
    success(res, { pet: user.pet });
  }),
);

// ─── PATCH /pets/me/pose ──────────────────────────────────────────────────────

/**
 * Saves an image URL to a pose slot (e.g. pet.pose.sleeping).
 * Admin-only. Used when assigning a generated preview to a pose without re-generating.
 */
router.patch(
  '/me/pose',
  protect,
  requireRole('admin', 'superadmin'),
  validate(savePoseSchema),
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const { poseKey, imageUrl } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { [`pet.pose.${poseKey}`]: imageUrl } },
      { new: true, runValidators: true },
    );

    if (!user?.pet) throw new AppError('No pet found', 404, 'PET_NOT_FOUND');

    log.info({ userId, poseKey, imageUrl }, 'Pet pose saved');
    success(res, { pet: user.pet });
  }),
);

// ─── POST /pets/me/pet ───────────────────────────────────────────────────────

/**
 * Pet interaction: tap to pet. Awards XP, boosts happy.
 * Max 3 per hour; over-petting decreases happy and mood (sour).
 */
router.post(
  '/me/pet',
  protect,
  catchAsync(async (req, res) => {
    const userId = req.user?._id?.toString();
    if (!userId) throw new AppError('Not authenticated', 401, 'AUTH_REQUIRED');

    const result = await petService.pet(userId);
    if (!result.pet) throw new AppError('No pet found', 404, 'PET_NOT_FOUND');

    success(res, {
      pet: result.pet,
      xpGained: result.xpGained,
      overPet: result.overPet,
    });
  }),
);

export default router;
