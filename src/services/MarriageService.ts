import mongoose from 'mongoose';
import { Friend } from '../models/Friend.js';
import { Marriage, marriagePair, otherSpouse, type IMarriage } from '../models/Marriage.js';
import { SharedGoal } from '../models/SharedGoal.js';
import { User } from '../models/User.js';
import { AppError } from '../middleware/errorHandler.js';

export interface MarriagePartnerPublic {
  id: string;
  username?: string;
  petName?: string;
  petImageUrl?: string;
}

export interface MarriagePublic {
  id: string;
  status: 'pending' | 'married';
  partner: MarriagePartnerPublic;
  proposedByMe: boolean;
}

async function toPartner(userId: string): Promise<MarriagePartnerPublic> {
  const user = await User.findById(userId).select('username pet').lean();
  if (!user) return { id: userId };
  return {
    id: userId,
    ...(user.username ? { username: user.username } : {}),
    ...(user.pet?.customName || user.pet?.name
      ? { petName: user.pet.customName || user.pet.name }
      : {}),
    ...(user.pet?.imageUrl ? { petImageUrl: user.pet.imageUrl } : {}),
  };
}

export function toMarriagePublic(doc: IMarriage, viewerId: string, partner: MarriagePartnerPublic): MarriagePublic {
  return {
    id: String(doc._id),
    status: doc.status,
    partner,
    proposedByMe: String(doc.proposedBy) === viewerId,
  };
}

export async function findMarriageForUser(userId: string): Promise<IMarriage | null> {
  const oid = new mongoose.Types.ObjectId(userId);
  return Marriage.findOne({
    $or: [{ userLow: oid }, { userHigh: oid }],
    status: { $in: ['pending', 'married'] },
  });
}

export async function requireMarried(userId: string): Promise<IMarriage> {
  const marriage = await findMarriageForUser(userId);
  if (!marriage || marriage.status !== 'married') {
    throw new AppError('You need to be married to share goals', 400, 'NOT_MARRIED');
  }
  return marriage;
}

export async function getMarriagePublic(userId: string): Promise<MarriagePublic | null> {
  const marriage = await findMarriageForUser(userId);
  if (!marriage) return null;
  const partner = await toPartner(otherSpouse(marriage, userId));
  return toMarriagePublic(marriage, userId, partner);
}

async function assertFriends(a: string, b: string): Promise<void> {
  const from = new mongoose.Types.ObjectId(a);
  const to = new mongoose.Types.ObjectId(b);
  const friend = await Friend.findOne({
    status: 'accepted',
    $or: [
      { fromUserId: from, toUserId: to },
      { fromUserId: to, toUserId: from },
    ],
  }).lean();
  if (!friend) throw new AppError('You can only marry a friend', 400, 'NOT_FRIENDS');
}

export async function proposeMarriage(fromUserId: string, toUserId: string): Promise<MarriagePublic> {
  if (fromUserId === toUserId) throw new AppError('You cannot marry yourself', 400, 'SELF_MARRY');
  if (!mongoose.isValidObjectId(toUserId)) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  const target = await User.findById(toUserId).select('status').lean();
  if (!target || target.status !== 'active') throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  await assertFriends(fromUserId, toUserId);

  const mine = await findMarriageForUser(fromUserId);
  if (mine) {
    throw new AppError(
      mine.status === 'married' ? 'You are already married' : 'You already have a pending proposal',
      400,
      'ALREADY_MARRIED',
    );
  }
  const theirs = await findMarriageForUser(toUserId);
  if (theirs) {
    throw new AppError('They already have a marriage or pending proposal', 400, 'PARTNER_BUSY');
  }

  const pair = marriagePair(fromUserId, toUserId);
  const created = await Marriage.create({
    ...pair,
    proposedBy: new mongoose.Types.ObjectId(fromUserId),
    status: 'pending',
  });
  const partner = await toPartner(toUserId);
  return toMarriagePublic(created, fromUserId, partner);
}

export async function respondToMarriage(
  userId: string,
  marriageId: string,
  status: 'accepted' | 'rejected',
): Promise<MarriagePublic | null> {
  if (!mongoose.isValidObjectId(marriageId)) throw new AppError('Proposal not found', 404, 'NOT_FOUND');
  const marriage = await Marriage.findById(marriageId);
  if (!marriage) throw new AppError('Proposal not found', 404, 'NOT_FOUND');

  const low = String(marriage.userLow);
  const high = String(marriage.userHigh);
  if (userId !== low && userId !== high) throw new AppError('Not your proposal', 403, 'FORBIDDEN');
  if (String(marriage.proposedBy) === userId) {
    throw new AppError('Only the other person can respond', 403, 'FORBIDDEN');
  }
  if (marriage.status !== 'pending') throw new AppError('This proposal is no longer pending', 400, 'ALREADY_RESPONDED');

  if (status === 'rejected') {
    await marriage.deleteOne();
    return null;
  }

  marriage.status = 'married';
  await marriage.save();
  const partner = await toPartner(otherSpouse(marriage, userId));
  return toMarriagePublic(marriage, userId, partner);
}

export async function endMarriage(userId: string): Promise<void> {
  const marriage = await findMarriageForUser(userId);
  if (!marriage) throw new AppError('No marriage to end', 404, 'NOT_FOUND');
  await SharedGoal.updateMany({ marriageId: marriage._id }, { $set: { archived: true, enabled: false } });
  await marriage.deleteOne();
}
