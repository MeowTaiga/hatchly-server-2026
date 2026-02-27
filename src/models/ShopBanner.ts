import mongoose, { type Document, Schema } from 'mongoose';
import { basePlugin } from './plugins/basePlugin.js';

/**
 * Shop section banner shown at the top of the Shop tab.
 * Each banner represents a tappable section (e.g. Seasonal, Easter).
 *
 * @property key - Unique section id (e.g. 'seasonal', 'easter')
 * @property label - Display name (e.g. 'Seasonal', 'Easter Sale')
 * @property imageUrl - Optional banner image (generated via admin or uploaded)
 * @property displayImage - When true, show imageUrl in the banner (admin toggle)
 * @property sortOrder - Order in the horizontal strip (lower = left)
 */
export interface IShopBanner extends Document {
  key: string;
  label: string;
  imageUrl?: string;
  displayImage: boolean;
  sortOrder: number;
  /** Shop section this banner belongs to (e.g. 'fishing_shop'). null/undefined = main shop only. */
  shopSection?: string;
  createdAt: Date;
  updatedAt: Date;
}

const shopBannerSchema = new Schema<IShopBanner>({
  key: { type: String, required: true, index: true },
  label: { type: String, required: true },
  imageUrl: { type: String },
  displayImage: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 },
  shopSection: { type: String, default: undefined },
});

shopBannerSchema.index({ key: 1, shopSection: 1 }, { unique: true });
shopBannerSchema.plugin(basePlugin);

export const ShopBanner = mongoose.model<IShopBanner>('ShopBanner', shopBannerSchema);
