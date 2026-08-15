import { Farm, type IFarm } from '../models/Farm.js';
import {
  MINING_ENERGY_COST,
  MINING_ENERGY_EMPTY_MSG,
  MINING_ENERGY_REGEN_MS,
} from '../constants/miningEnergy.js';
import { miningEnergyCapFromLevel } from '../constants/skillPerks.js';
import { getUserSkillLevel } from './SkillXpService.js';

export interface MiningEnergyView {
  energy: number;
  cap: number;
  updatedAt: Date;
}

export function miningEnergyStateUpdate(view: MiningEnergyView) {
  return {
    miningEnergy: view.energy,
    miningEnergyCap: view.cap,
    miningEnergyAt: view.updatedAt.getTime(),
  };
}

function applyRegenInMemory(farm: IFarm, cap: number, now: number): MiningEnergyView {
  let energy = farm.miningEnergy;
  let at = farm.miningEnergyAt?.getTime();

  if (energy == null || at == null || !Number.isFinite(energy)) {
    farm.miningEnergy = cap;
    farm.miningEnergyAt = new Date(now);
    return { energy: cap, cap, updatedAt: farm.miningEnergyAt };
  }

  energy = Math.max(0, Math.floor(energy));
  if (energy > cap) {
    energy = cap;
    farm.miningEnergy = energy;
  }

  if (energy >= cap) {
    farm.miningEnergy = cap;
    if (now - at > MINING_ENERGY_REGEN_MS) {
      farm.miningEnergyAt = new Date(now);
    }
    return { energy: cap, cap, updatedAt: farm.miningEnergyAt ?? new Date(now) };
  }

  const gained = Math.floor((now - at) / MINING_ENERGY_REGEN_MS);
  if (gained > 0) {
    energy = Math.min(cap, energy + gained);
    at = at + gained * MINING_ENERGY_REGEN_MS;
    farm.miningEnergy = energy;
    farm.miningEnergyAt = new Date(at);
  }

  return {
    energy: farm.miningEnergy ?? 0,
    cap,
    updatedAt: farm.miningEnergyAt ?? new Date(now),
  };
}

export async function syncMiningEnergy(
  userId: string,
  farm: IFarm,
  now = Date.now(),
): Promise<MiningEnergyView> {
  const level = await getUserSkillLevel(userId, 'mining');
  const cap = miningEnergyCapFromLevel(level);
  return applyRegenInMemory(farm, cap, now);
}

export async function consumeMiningEnergy(userId: string, farm: IFarm): Promise<MiningEnergyView> {
  const before = await syncMiningEnergy(userId, farm);
  if (farm.isModified('miningEnergy') || farm.isModified('miningEnergyAt')) {
    await farm.save();
  }

  const updated = await Farm.findOneAndUpdate(
    { _id: farm._id, miningEnergy: { $gte: MINING_ENERGY_COST } },
    { $inc: { miningEnergy: -MINING_ENERGY_COST } },
    { new: true },
  );
  if (!updated) throw new Error(MINING_ENERGY_EMPTY_MSG);

  const spentFromCap = before.energy >= before.cap;
  if (spentFromCap) {
    updated.miningEnergyAt = new Date();
    await updated.save();
  }

  farm.miningEnergy = updated.miningEnergy;
  farm.miningEnergyAt = updated.miningEnergyAt ?? before.updatedAt;

  return {
    energy: updated.miningEnergy ?? 0,
    cap: before.cap,
    updatedAt: farm.miningEnergyAt ?? new Date(),
  };
}

export async function refundMiningEnergy(userId: string, farm: IFarm): Promise<MiningEnergyView> {
  const view = await syncMiningEnergy(userId, farm);
  const next = Math.min(view.cap, view.energy + MINING_ENERGY_COST);
  farm.miningEnergy = next;
  if (next >= view.cap) farm.miningEnergyAt = new Date();
  await farm.save();
  return {
    energy: farm.miningEnergy ?? next,
    cap: view.cap,
    updatedAt: farm.miningEnergyAt ?? new Date(),
  };
}
