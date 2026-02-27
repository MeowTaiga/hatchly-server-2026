/**
 * Canonical pose keys for pet.pose in MongoDB.
 * Shared with frontend — validate poseKey against this.
 */
export const PET_POSES = ['sleeping', 'sleepy', 'sitting', 'standing', 'walking', 'happy', 'hungry', 'sad', 'wow', 'eating'] as const;

export type PetPose = (typeof PET_POSES)[number];

export function isValidPoseKey(key: string): key is PetPose {
  return (PET_POSES as readonly string[]).includes(key);
}

/**
 * Richer AI prompts per pose key. Avoids generic outputs (e.g. hungry → tongue out).
 * Used when poseKey matches a known entry; otherwise posePrompt is used as-is.
 */
export const POSE_PROMPTS: Partial<Record<PetPose, string>> = {
  sleeping: 'sleeping peacefully, eyes closed, body relaxed in a cozy curled or lying position',
  sleepy: 'drowsy and tired but with a cute mouth, half-closed droopy eyes, head slightly bowed, relaxed body',
  sitting: 'sitting upright, alert but relaxed posture, front paws together',
  standing: 'standing on all fours, alert and ready, ears perked',
  walking: 'walking or trotting forward, mid-stride, natural movement',
  happy: 'cheerful and joyful, bright eyes, warm smile, perky ears, relaxed excited posture',
  hungry: 'looking hungry with pleading hopeful eyes, soft hopeful expression, perhaps looking expectantly toward food or holding stomach gently — NO tongue sticking out',
  sad: 'sad and downcast, droopy ears, tearful or watery eyes, slumped posture, melancholy expression',
  wow: 'amazed and impressed, sparkling star-shaped gleams in both eyes, mouth slightly open in wonder, perky interested expression',
  eating: 'eating or chewing happily, face near food, content focused expression',
};
